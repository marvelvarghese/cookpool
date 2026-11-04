// "From before" (Cookpool SM-8): what the caller bought and cooked before, for
// the type-ahead on Bought and Cook. Each read is ONE statement however much
// history there is — the app runs it while someone types — and needs no new
// index: the pantries and dishes in scope are found through the indexes the
// lists already use (by owner and by group), and the name is matched on the
// rows found.
//
// Both group by name case-insensitively with window functions: COUNT(*) says
// how often, ROW_NUMBER() picks the newest record, whose fields fill the form.
// Names starting with the text typed rank first, then names with a word
// starting with it, then names containing it; newest first within each.
//
// The recipes read is one statement of materialized steps, so SQLite cannot
// reorder them into a scan of every pantry: the recipes (dishes in scope,
// newest per name, at most `limit`), their newest dish's ingredients (looked
// up by dish, CROSS JOIN keeping that order), the usable items carrying one of
// those names (through the owner and group indexes), and the best of those
// per ingredient.

import type { SqlExecutor } from "../d1/executor.js";
import { ITEM_COLUMNS, Params, likeEscape, mapItem, scopeClause } from "./pantry.js";
import type {
  KitchenDimension,
  KitchenRecipeIngredientRecord,
  KitchenRecipeRecord,
  KitchenRepository,
  KitchenResult,
} from "./types.js";

/** The "from before" part of the kitchen repository. */
export type HistoryRepository = Pick<KitchenRepository, "itemHistory" | "recipes">;

type Row = Record<string, unknown>;

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * How `column` matches `q`: the WHERE clause (none for an empty `q`) and the
 * rank — 0 when it starts with `q`, 1 when a word in it does, 2 when it only
 * contains it.
 */
function nameMatch(params: Params, column: string, q: string): { where: string; rank: string } {
  if (q === "") return { where: "", rank: "0" };
  const text = likeEscape(q);
  const contains = params.add(`%${text}%`);
  const starts = params.add(`${text}%`);
  const word = params.add(`% ${text}%`);
  return {
    where: `AND lower(${column}) LIKE lower(${contains}) ESCAPE '\\'`,
    rank: `CASE
             WHEN lower(${column}) LIKE lower(${starts}) ESCAPE '\\' THEN 0
             WHEN lower(${column}) LIKE lower(${word}) ESCAPE '\\' THEN 1
             ELSE 2
           END`,
  };
}

export function createHistoryRepository(executor: SqlExecutor): HistoryRepository {
  return {
    async itemHistory(query) {
      const params = new Params();
      const scope = scopeClause(params, query);
      const match = nameMatch(params, "name", query.q);
      try {
        // Removed items were added by mistake, and leftovers were cooked, not
        // bought: neither is something to buy again.
        const result = await executor.execute(
          `WITH seen AS (
             SELECT ${ITEM_COLUMNS},
                    ${match.rank} AS match_rank,
                    COUNT(*) OVER (PARTITION BY lower(name)) AS times,
                    ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY bought_on DESC, created_at DESC, id DESC) AS newest
             FROM kitchen_items
             WHERE state <> 'removed' AND source_dish_id IS NULL AND ${scope}
               ${match.where}
           )
           SELECT ${ITEM_COLUMNS}, times FROM seen
           WHERE newest = 1
           ORDER BY match_rank, bought_on DESC, created_at DESC, id DESC
           LIMIT ${params.add(query.limit)}`,
          params.values,
        );
        return { ok: true, value: result.rows.map((row) => ({ item: mapItem(row), times: Number(row.times) })) };
      } catch (err) {
        return internal(err);
      }
    },

    async recipes(query) {
      const params = new Params();
      const me = params.add(query.subjectId);
      const groups = params.add(JSON.stringify(query.orgIds));
      const usable = params.add(JSON.stringify(query.usableOrgIds));
      const match = nameMatch(params, "d.name", query.q);
      try {
        const result = await executor.execute(
          `WITH seen AS (
             SELECT d.id, d.cook, d.org_id, d.name, d.portions_half, d.extras_minor, d.total_minor, d.currency,
                    d.cooked_at,
                    ${match.rank} AS match_rank,
                    COUNT(*) OVER (PARTITION BY lower(d.name)) AS times,
                    ROW_NUMBER() OVER (PARTITION BY lower(d.name) ORDER BY d.cooked_at DESC, d.id DESC) AS newest
             FROM kitchen_dishes d
             WHERE d.state <> 'canceled'
               AND (d.cook = ${me} OR d.org_id IN (SELECT value FROM json_each(${groups})))
               ${match.where}
           ),
           recipes AS MATERIALIZED (
             SELECT * FROM seen
             WHERE newest = 1
             ORDER BY match_rank, cooked_at DESC, id DESC
             LIMIT ${params.add(query.limit)}
           ),
           ingredients AS MATERIALIZED (
             SELECT di.dish_id, di.item_id, di.position, di.qty_milli, di.unit, di.org_id,
                    i.name, lower(i.name) AS name_key, i.dimension,
                    (r.cook = ${me} AND di.org_id IS NULL) AS from_mine
             FROM recipes r
             CROSS JOIN kitchen_dish_ingredients di ON di.dish_id = r.id
             CROSS JOIN kitchen_items i ON i.id = di.item_id
           ),
           candidates AS MATERIALIZED (
             SELECT c.id, c.org_id, lower(c.name) AS name_key, c.dimension, c.qty_left_milli, c.expires_on
             FROM kitchen_items c
             WHERE c.state = 'active' AND c.qty_left_milli > 0
               AND (c.owner_subject_id = ${me} OR c.org_id IN (SELECT value FROM json_each(${usable})))
               AND lower(c.name) IN (SELECT name_key FROM ingredients)
           ),
           matched AS (
             SELECT g.dish_id, g.item_id, g.position, g.qty_milli, g.unit, g.org_id, g.name, g.dimension,
                    c.id AS match_id, c.org_id AS match_org_id, c.qty_left_milli AS match_left_milli,
                    ROW_NUMBER() OVER (
                      PARTITION BY g.dish_id, g.item_id
                      ORDER BY CASE WHEN c.org_id = g.org_id OR (g.from_mine AND c.org_id IS NULL) THEN 0 ELSE 1 END,
                               c.qty_left_milli DESC, COALESCE(c.expires_on, '9999-12-31'), c.id
                    ) AS pick
             FROM ingredients g
             LEFT JOIN candidates c ON c.name_key = g.name_key AND c.dimension = g.dimension
           )
           SELECT r.id, r.cook, r.org_id, r.name, r.portions_half, r.extras_minor, r.total_minor, r.currency,
                  r.cooked_at, r.times,
                  m.item_id, m.name AS item_name, m.dimension, m.position, m.qty_milli, m.unit,
                  m.org_id AS item_org_id, m.match_id, m.match_org_id, m.match_left_milli
           FROM recipes r
           LEFT JOIN matched m ON m.dish_id = r.id AND m.pick = 1
           ORDER BY r.match_rank, r.cooked_at DESC, r.id DESC, m.position`,
          params.values,
        );

        // One row per ingredient (one with no ingredient columns for a dish
        // without any), in recipe order: fold them into recipes.
        const recipes: KitchenRecipeRecord[] = [];
        let current: KitchenRecipeRecord | undefined;
        for (const row of result.rows as Row[]) {
          const dishId = row.id as string;
          if (!current || current.dishId !== dishId) {
            current = {
              dishId,
              cook: row.cook as string,
              orgId: nullableString(row.org_id),
              name: row.name as string,
              portionsHalf: Number(row.portions_half),
              extrasMinor: Number(row.extras_minor),
              totalMinor: Number(row.total_minor),
              currency: row.currency as string,
              cookedAt: new Date(row.cooked_at as string),
              times: Number(row.times),
              ingredients: [],
            };
            recipes.push(current);
          }
          if (row.item_id === null || row.item_id === undefined) continue;
          const ingredient: KitchenRecipeIngredientRecord = {
            itemId: row.item_id as string,
            name: row.item_name as string,
            dimension: row.dimension as KitchenDimension,
            position: Number(row.position),
            qtyMilli: Number(row.qty_milli),
            unit: row.unit as string,
            orgId: nullableString(row.item_org_id),
            match:
              row.match_id === null || row.match_id === undefined
                ? null
                : {
                    itemId: row.match_id as string,
                    orgId: nullableString(row.match_org_id),
                    qtyLeftMilli: Number(row.match_left_milli),
                  },
          };
          current.ingredients.push(ingredient);
        }
        return { ok: true, value: recipes };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
