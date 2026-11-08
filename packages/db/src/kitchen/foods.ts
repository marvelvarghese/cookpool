// The food list's storage (Cookpool RC-4, migration 340_kitchen_foods).
//
// One shared list of foods links what people buy to what recipes call for.
// A name is matched the way SQLite folds it — lower(trim(name)), ASCII
// letters only, as the pantry search and the measures fold names — so the
// match is ONE SQL expression (`foodOfNameSql`), used both to look a name up
// (matchFood) and to link an item as it is added (`linkFoodStatement`, in the
// add's own batch): the two can never disagree. A pantry's answer for a name
// ("Is Kanda onion?") wins over the names table, a "none of these" answer
// included; then the name itself; then the name without a plural "es" or
// "s", when those agree on exactly one food. Anything else stays unlinked.
//
// A food may carry a density (g_per_ml, migration 360_kitchen_cookpool_recipes):
// grams per millilitre, so the match can meet a spoon of it with a weight.
//
// Always have is a short list per person. Until they first save it they read
// the default (salt and water): kitchen_always_have_lists records that they
// have, so a list they emptied stays empty.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isForeignKeyViolation } from "../d1/errors.js";
import { nameMatchSql } from "./food-link.js";
import { ITEM_COLUMNS, Params, itemColumns, likeEscape, mapItem, scopeClause } from "./pantry.js";
import type {
  KitchenAlwaysHave,
  KitchenFoodDimension,
  KitchenFoodRecord,
  KitchenFoodSearchRecord,
  KitchenPantryOwner,
  KitchenRepository,
  KitchenResult,
} from "./types.js";

/** The foods part of the kitchen repository. */
export type FoodsRepository = Pick<
  KitchenRepository,
  | "searchFoods"
  | "getFoods"
  | "matchFood"
  | "setFoodAnswer"
  | "getAlwaysHave"
  | "setAlwaysHave"
  | "listFoodItems"
  | "listUnlinkedItems"
  | "itemFoods"
>;

/** What a person always has until they save their own list (contracts' DEFAULT_ALWAYS_HAVE). */
export const KITCHEN_DEFAULT_ALWAYS_HAVE: readonly string[] = ["salt", "water"];

const FOOD_COLUMNS = "f.key, f.name, f.dimension, f.each_g, f.category, f.g_per_ml";

type Row = Record<string, unknown>;

function mapFood(row: Row): KitchenFoodRecord {
  return {
    key: row.key as string,
    name: row.name as string,
    dimension: row.dimension as KitchenFoodDimension,
    eachG: row.each_g === null || row.each_g === undefined ? null : Number(row.each_g),
    category: row.category as string,
    gPerMl: row.g_per_ml === null || row.g_per_ml === undefined ? null : Number(row.g_per_ml),
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

/** The pantry's owner_id: the person for a personal pantry, the group for a group's. */
function ownerIdOf(owner: KitchenPantryOwner): string {
  return owner.kind === "user" ? owner.subjectId : owner.orgId;
}

/** `scopeClause` over the table aliased `alias`. */
function aliasedScope(params: Params, scope: { ownerSubjectId: string | null; orgIds: readonly string[] }, alias: string): string {
  const groups = `${alias}.org_id IN (SELECT value FROM json_each(${params.add(JSON.stringify(scope.orgIds))}))`;
  if (scope.ownerSubjectId === null) return `(${groups})`;
  return `(${alias}.owner_subject_id = ${params.add(scope.ownerSubjectId)} OR ${groups})`;
}

export function createFoodsRepository(executor: SqlExecutor): FoodsRepository {
  async function alwaysHave(userId: string): Promise<KitchenAlwaysHave> {
    const [set, rows] = await Promise.all([
      executor.execute("SELECT 1 AS one FROM kitchen_always_have_lists WHERE user_id = $1", [userId]),
      executor.execute("SELECT food_key FROM kitchen_always_have WHERE user_id = $1 ORDER BY food_key", [userId]),
    ]);
    if (set.rows.length === 0) return { foodKeys: [...KITCHEN_DEFAULT_ALWAYS_HAVE], isSet: false };
    return { foodKeys: rows.rows.map((r) => r.food_key as string), isSet: true };
  }

  return {
    async searchFoods(q, limit) {
      try {
        if (q === null || q === "") {
          const result = await executor.execute(
            `SELECT ${FOOD_COLUMNS}, lower(f.name) AS matched_name FROM kitchen_foods f ORDER BY lower(f.name), f.key LIMIT $1`,
            [limit],
          );
          return { ok: true, value: result.rows.map((row) => ({ ...mapFood(row), matchedName: row.matched_name as string })) };
        }
        // Every name that matches, best tier first; then each food once, by its best name.
        const like = likeEscape(q);
        const result = await executor.execute(
          `WITH hits AS (
             SELECT n.food_key, n.name_key,
                    CASE WHEN n.name_key = $1 THEN 0
                         WHEN n.name_key LIKE $2 || '%' ESCAPE '\\' THEN 1
                         WHEN n.name_key LIKE '% ' || $2 || '%' ESCAPE '\\' THEN 2
                         ELSE 3 END AS tier
             FROM kitchen_food_names n
             WHERE n.name_key LIKE '%' || $2 || '%' ESCAPE '\\'
           ),
           best AS (
             SELECT food_key, name_key, tier,
                    ROW_NUMBER() OVER (PARTITION BY food_key ORDER BY tier, length(name_key), name_key) AS rn
             FROM hits
           )
           SELECT ${FOOD_COLUMNS}, b.name_key AS matched_name, b.tier
           FROM best b JOIN kitchen_foods f ON f.key = b.food_key
           WHERE b.rn = 1
           ORDER BY b.tier, lower(f.name), f.key
           LIMIT $3`,
          [q, like, limit],
        );
        return {
          ok: true,
          value: result.rows.map((row): KitchenFoodSearchRecord => ({ ...mapFood(row), matchedName: row.matched_name as string })),
        };
      } catch (err) {
        return internal(err);
      }
    },

    async getFoods(keys) {
      if (keys.length === 0) return { ok: true, value: [] };
      try {
        const result = await executor.execute(
          `SELECT ${FOOD_COLUMNS} FROM kitchen_foods f WHERE f.key IN (SELECT value FROM json_each($1)) ORDER BY lower(f.name), f.key`,
          [JSON.stringify([...new Set(keys)])],
        );
        return { ok: true, value: result.rows.map(mapFood) };
      } catch (err) {
        return internal(err);
      }
    },

    async matchFood(name) {
      try {
        const result = await executor.execute(
          `SELECT ${FOOD_COLUMNS} FROM kitchen_foods f WHERE f.key = ${nameMatchSql("lower(trim($1))")}`,
          [name],
        );
        const row = result.rows[0];
        return { ok: true, value: row ? mapFood(row) : null };
      } catch (err) {
        return internal(err);
      }
    },

    async setFoodAnswer({ owner, name, foodKey, actor, now }) {
      const ownerId = ownerIdOf(owner);
      const pantry =
        owner.kind === "user"
          ? "owner_kind = 'user' AND owner_subject_id = $2"
          : "owner_kind = 'group' AND org_id = $2";
      const statements: SqlStatement[] = [
        {
          text: `INSERT INTO kitchen_food_answers (owner_kind, owner_id, name_key, food_key, answered_by, created_at, updated_at)
                 VALUES ($1, $2, lower(trim($3)), $4, $5, $6, $6)
                 ON CONFLICT (owner_kind, owner_id, name_key) DO UPDATE SET
                   food_key = excluded.food_key,
                   answered_by = excluded.answered_by,
                   updated_at = excluded.updated_at
                 RETURNING owner_kind, owner_id, name_key, food_key, answered_by, created_at, updated_at`,
          params: [owner.kind, ownerId, name, foodKey, actor, now],
        },
        {
          // Every item of that name in that pantry follows the answer at once.
          text: `UPDATE kitchen_items SET food_key = $3
                 WHERE ${pantry} AND lower(trim(name)) = lower(trim($1))
                 RETURNING id`,
          params: [name, ownerId, foodKey],
        },
      ];
      try {
        const [answered, linked] = await executeBatch(executor, statements);
        const row = answered?.rows[0];
        if (!row) return internal("kitchen: food answer returned no row");
        return {
          ok: true,
          value: {
            answer: {
              ownerKind: row.owner_kind as "user" | "group",
              ownerId: row.owner_id as string,
              nameKey: row.name_key as string,
              foodKey: (row.food_key as string | null) ?? null,
              answeredBy: row.answered_by as string,
              createdAt: new Date(row.created_at as string),
              updatedAt: new Date(row.updated_at as string),
            },
            linkedItems: linked?.rows.length ?? 0,
          },
        };
      } catch (err) {
        // The food is checked first; a refusal here means it went from the list.
        if (isForeignKeyViolation(err)) return { ok: false, error: { kind: "invalid", reason: "unknown_food" } };
        return internal(err);
      }
    },

    async getAlwaysHave(userId) {
      try {
        return { ok: true, value: await alwaysHave(userId) };
      } catch (err) {
        return internal(err);
      }
    },

    async setAlwaysHave(userId, foodKeys, now) {
      const keys = JSON.stringify([...new Set(foodKeys)]);
      try {
        await executeBatch(executor, [
          {
            text: `INSERT INTO kitchen_always_have_lists (user_id, updated_at) VALUES ($1, $2)
                   ON CONFLICT (user_id) DO UPDATE SET updated_at = excluded.updated_at`,
            params: [userId, now],
          },
          {
            text: `DELETE FROM kitchen_always_have WHERE user_id = $1 AND food_key NOT IN (SELECT value FROM json_each($2))`,
            params: [userId, keys],
          },
          {
            text: `INSERT OR IGNORE INTO kitchen_always_have (user_id, food_key, created_at)
                   SELECT $1, value, $3 FROM json_each($2)`,
            params: [userId, keys, now],
          },
        ]);
        return { ok: true, value: await alwaysHave(userId) };
      } catch (err) {
        if (isForeignKeyViolation(err)) return { ok: false, error: { kind: "invalid", reason: "unknown_food" } };
        return internal(err);
      }
    },

    async listFoodItems(scope, foodKeys) {
      if (foodKeys.length === 0 || (scope.ownerSubjectId === null && scope.orgIds.length === 0)) return { ok: true, value: [] };
      const params = new Params();
      try {
        const result = await executor.execute(
          `SELECT ${ITEM_COLUMNS}, food_key FROM kitchen_items
           WHERE state = 'active' AND qty_left_milli > 0
             AND food_key IN (SELECT value FROM json_each(${params.add(JSON.stringify([...new Set(foodKeys)]))}))
             AND ${scopeClause(params, scope)}
           ORDER BY id`,
          params.values,
        );
        return { ok: true, value: result.rows.map((row) => ({ item: mapItem(row), foodKey: row.food_key as string })) };
      } catch (err) {
        return internal(err);
      }
    },

    async itemFoods(itemIds) {
      if (itemIds.length === 0) return { ok: true, value: new Map() };
      try {
        const result = await executor.execute(
          "SELECT id, food_key FROM kitchen_items WHERE id IN (SELECT value FROM json_each($1))",
          [JSON.stringify([...new Set(itemIds)])],
        );
        return { ok: true, value: new Map(result.rows.map((row) => [row.id as string, (row.food_key as string | null) ?? null])) };
      } catch (err) {
        return internal(err);
      }
    },

    async listUnlinkedItems(scope, limit) {
      if (scope.ownerSubjectId === null && scope.orgIds.length === 0) return { ok: true, value: [] };
      const params = new Params();
      try {
        // One item per name and pantry, never one whose name the pantry answered.
        const result = await executor.execute(
          `SELECT ${itemColumns("i")}
           FROM kitchen_items i
           WHERE i.state = 'active' AND i.qty_left_milli > 0 AND i.food_key IS NULL
             AND ${aliasedScope(params, scope, "i")}
             AND NOT EXISTS (
               SELECT 1 FROM kitchen_food_answers a
               WHERE a.owner_kind = i.owner_kind AND a.owner_id = COALESCE(i.owner_subject_id, i.org_id)
                 AND a.name_key = lower(trim(i.name)))
             AND i.id = (
               SELECT j.id FROM kitchen_items j
               WHERE j.state = 'active' AND j.qty_left_milli > 0 AND j.food_key IS NULL
                 AND j.owner_kind = i.owner_kind AND COALESCE(j.owner_subject_id, j.org_id) = COALESCE(i.owner_subject_id, i.org_id)
                 AND lower(trim(j.name)) = lower(trim(i.name))
               ORDER BY j.created_at DESC, j.id LIMIT 1)
           ORDER BY i.created_at DESC, i.id
           LIMIT ${params.add(limit)}`,
          params.values,
        );
        return { ok: true, value: result.rows.map(mapItem) };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
