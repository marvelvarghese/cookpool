// Recipes' storage (Cookpool RC-4, migration 350_kitchen_recipes).
//
// A recipe is a template: a name, serves N, lines and steps, owned by one
// person (or Cookpool's system user). Who may see it is kitchen-worker's
// business — visibility depends on membership, read at request time — so the
// reads here take the scope the worker decided (the owner's own, Cookpool's,
// others' shown to their groups) and never a deleted recipe.
//
// A recipe's lines and steps are written with it, and replaced as a whole on
// an edit, each list as ONE statement over a JSON parameter (`json_each`), so
// 40 lines never meet D1's cap on bound parameters. A write is ONE batch; an
// edit's statements are guarded by the owner, so a recipe that is not the
// caller's — or deleted, or Cookpool's — changes nothing. Deleting is soft:
// the row stays for its copies and its dishes.
//
// Every read also says how many live copies were saved of the recipe ("saved
// by N", through kitchen_recipes_source_idx) and when the viewer last cooked
// it (their latest dish with it that is not canceled, through
// kitchen_dishes_cook_recipe_idx).

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "../d1/errors.js";
import { mapDishIngredient } from "./dishes.js";
import { Params, likeEscape } from "./pantry.js";
import type {
  KitchenRecipeLineRecord,
  KitchenRecipeTemplateRecord,
  KitchenRecipeVisibility,
  KitchenRepository,
  KitchenResult,
} from "./types.js";

/** The recipes part of the kitchen repository. */
export type RecipesRepository = Pick<
  KitchenRepository,
  | "getRecipe"
  | "getRecipeByLinkCode"
  | "listRecipes"
  | "createRecipe"
  | "updateRecipe"
  | "deleteRecipe"
  | "setRecipeLink"
  | "lastCook"
>;

const RECIPE_COLUMNS = `r.id, r.owner_id, r.name, r.serves_half, r.minutes, r.visibility, r.link_code, r.source_recipe_id,
  r.source_owner_id, r.source_owner_name, r.is_system, r.kind, r.created_at, r.updated_at, r.deleted_at`;

/** "Saved by N" and the viewer's last cook, for the recipe aliased `r`; `viewer` is the placeholder of the viewer's id. */
function extrasSql(viewer: string): string {
  return `(SELECT COUNT(*) FROM kitchen_recipes c WHERE c.source_recipe_id = r.id AND c.deleted_at IS NULL) AS saved_by,
    (SELECT MAX(d.cooked_at) FROM kitchen_dishes d
      WHERE d.cook = ${viewer} AND d.recipe_id = r.id AND d.state <> 'canceled') AS last_cooked_at`;
}

/** Who may change a recipe: its owner, while it is live and not Cookpool's ($1 the recipe, $2 the owner). */
const OWNED = "id = $1 AND owner_id = $2 AND deleted_at IS NULL AND is_system = 0";
const OWNED_EXISTS = `EXISTS (SELECT 1 FROM kitchen_recipes WHERE ${OWNED})`;

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapLine(row: Row): KitchenRecipeLineRecord {
  return {
    position: Number(row.position),
    foodKey: nullableString(row.food_key),
    name: row.name as string,
    qtyMilli: nullableNumber(row.qty_milli),
    unit: nullableString(row.unit),
    toTaste: Number(row.to_taste) === 1,
    isMain: Number(row.is_main) === 1,
  };
}

function mapRecipe(row: Row, lines: KitchenRecipeLineRecord[], steps: string[]): KitchenRecipeTemplateRecord {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    name: row.name as string,
    servesHalf: Number(row.serves_half),
    minutes: nullableNumber(row.minutes),
    visibility: row.visibility as KitchenRecipeVisibility,
    linkCode: nullableString(row.link_code),
    sourceRecipeId: nullableString(row.source_recipe_id),
    sourceOwnerId: nullableString(row.source_owner_id),
    sourceOwnerName: nullableString(row.source_owner_name),
    isSystem: Number(row.is_system) === 1,
    kind: nullableString(row.kind),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string) : null,
    lines,
    steps,
    savedBy: Number(row.saved_by ?? 0),
    lastCookedAt: row.last_cooked_at ? new Date(row.last_cooked_at as string) : null,
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

const NOT_FOUND: KitchenResult<never> = { ok: false, error: { kind: "not_found" } };

/** A refused recipe write: a taken link code, a food not on the list, a value out of range. */
function writeError(err: unknown): KitchenResult<never> {
  if (isUniqueViolation(err)) {
    // The one-main index is a unique one too; anything else unique is the link code.
    if (/kitchen_recipe_lines/.test(err instanceof Error ? err.message : String(err))) {
      return { ok: false, error: { kind: "invalid", reason: "two_main_lines" } };
    }
    return { ok: false, error: { kind: "conflict", entity: "kitchen_recipe_link" } };
  }
  if (isForeignKeyViolation(err)) return { ok: false, error: { kind: "invalid", reason: "unknown_food" } };
  if (isCheckViolation(err)) return { ok: false, error: { kind: "invalid", reason: "recipe_out_of_range" } };
  return internal(err);
}

/** The lines as one JSON parameter: each one's position is its index. */
function linesJson(lines: readonly Omit<KitchenRecipeLineRecord, "position">[]): string {
  return JSON.stringify(
    lines.map((l) => ({ f: l.foodKey, n: l.name, q: l.qtyMilli, u: l.unit, t: l.toTaste ? 1 : 0, m: l.isMain ? 1 : 0 })),
  );
}

/** Insert the lines in `$json` (see `linesJson`) for recipe `$recipe`, when `guard` holds. */
function insertLines(recipe: string, json: string, guard = ""): string {
  return `INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main)
          SELECT ${recipe}, CAST(key AS INTEGER), json_extract(value, '$.f'), json_extract(value, '$.n'),
                 json_extract(value, '$.q'), json_extract(value, '$.u'), json_extract(value, '$.t'), json_extract(value, '$.m')
          FROM json_each(${json})${guard ? ` WHERE ${guard}` : ""}`;
}

function insertSteps(recipe: string, json: string, guard = ""): string {
  return `INSERT INTO kitchen_recipe_steps (recipe_id, position, text)
          SELECT ${recipe}, CAST(key AS INTEGER), value FROM json_each(${json})${guard ? ` WHERE ${guard}` : ""}`;
}

export function createRecipesRepository(executor: SqlExecutor): RecipesRepository {
  /** These recipe rows, each with its lines and steps in order (two reads, however many recipes). */
  async function withParts(rows: readonly Row[]): Promise<KitchenRecipeTemplateRecord[]> {
    if (rows.length === 0) return [];
    const ids = JSON.stringify(rows.map((r) => r.id as string));
    const [lines, steps] = await Promise.all([
      executor.execute(
        `SELECT recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main FROM kitchen_recipe_lines
         WHERE recipe_id IN (SELECT value FROM json_each($1)) ORDER BY recipe_id, position`,
        [ids],
      ),
      executor.execute(
        `SELECT recipe_id, position, text FROM kitchen_recipe_steps
         WHERE recipe_id IN (SELECT value FROM json_each($1)) ORDER BY recipe_id, position`,
        [ids],
      ),
    ]);
    const linesOf = new Map<string, KitchenRecipeLineRecord[]>();
    for (const row of lines.rows) {
      const list = linesOf.get(row.recipe_id as string) ?? [];
      list.push(mapLine(row));
      linesOf.set(row.recipe_id as string, list);
    }
    const stepsOf = new Map<string, string[]>();
    for (const row of steps.rows) {
      const list = stepsOf.get(row.recipe_id as string) ?? [];
      list.push(row.text as string);
      stepsOf.set(row.recipe_id as string, list);
    }
    return rows.map((row) => mapRecipe(row, linesOf.get(row.id as string) ?? [], stepsOf.get(row.id as string) ?? []));
  }

  /** One recipe by `where` (over `r`, $1 the viewer), deleted ones only with `withDeleted`. */
  async function findRecipe(where: string, params: unknown[], withDeleted = false): Promise<KitchenRecipeTemplateRecord | null> {
    const result = await executor.execute(
      `SELECT ${RECIPE_COLUMNS}, ${extrasSql("$1")} FROM kitchen_recipes r
       WHERE ${where}${withDeleted ? "" : " AND r.deleted_at IS NULL"}`,
      params,
    );
    const [recipe] = await withParts(result.rows);
    return recipe ?? null;
  }

  return {
    async getRecipe(recipeId, viewer) {
      try {
        const recipe = await findRecipe("r.id = $2", [viewer, recipeId]);
        return recipe ? { ok: true, value: recipe } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async getRecipeByLinkCode(code, viewer) {
      try {
        const recipe = await findRecipe("r.link_code = $2 AND r.visibility = 'link'", [viewer, code]);
        return recipe ? { ok: true, value: recipe } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async listRecipes(query) {
      const params = new Params();
      const viewer = params.add(query.viewer);
      const any: string[] = [];
      if (query.ownerId) any.push(`r.owner_id = ${params.add(query.ownerId)}`);
      if (query.system) any.push("r.is_system = 1");
      if (query.sharedBy && query.sharedBy.length > 0) {
        any.push(
          `(r.owner_id IN (SELECT value FROM json_each(${params.add(JSON.stringify(query.sharedBy))}))
            AND r.visibility IN ('groups', 'link') AND r.is_system = 0)`,
        );
      }
      if (any.length === 0) return { ok: true, value: [] };
      const where = [`r.deleted_at IS NULL`, `(${any.join(" OR ")})`];
      if (query.q) where.push(`lower(r.name) LIKE lower(${params.add(`%${likeEscape(query.q)}%`)}) ESCAPE '\\'`);
      if (query.kind) where.push(`r.kind = ${params.add(query.kind)}`);
      try {
        const result = await executor.execute(
          `SELECT ${RECIPE_COLUMNS}, ${extrasSql(viewer)} FROM kitchen_recipes r
           WHERE ${where.join(" AND ")}
           ORDER BY r.created_at DESC, r.id DESC
           LIMIT ${params.add(query.limit)}`,
          params.values,
        );
        return { ok: true, value: await withParts(result.rows) };
      } catch (err) {
        return internal(err);
      }
    },

    async createRecipe(input) {
      const statements: SqlStatement[] = [
        {
          text: `INSERT INTO kitchen_recipes (
                   id, owner_id, name, serves_half, minutes, visibility, link_code, source_recipe_id, source_owner_id,
                   source_owner_name, is_system, kind, created_at, updated_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $12)`,
          params: [
            input.id, input.ownerId, input.name, input.servesHalf, input.minutes, input.visibility, input.linkCode,
            input.source?.recipeId ?? null, input.source?.ownerId ?? null, input.source?.ownerName ?? null, input.kind, input.now,
          ],
        },
        { text: insertLines("$1", "$2"), params: [input.id, linesJson(input.lines)] },
        { text: insertSteps("$1", "$2"), params: [input.id, JSON.stringify(input.steps)] },
      ];
      try {
        await executeBatch(executor, statements);
      } catch (err) {
        return writeError(err);
      }
      try {
        const recipe = await findRecipe("r.id = $2", [input.ownerId, input.id]);
        return recipe ? { ok: true, value: recipe } : internal("kitchen: created recipe not found");
      } catch (err) {
        return internal(err);
      }
    },

    async updateRecipe({ recipeId, ownerId, changes, lines, steps, now }) {
      const params = new Params();
      params.add(recipeId);
      params.add(ownerId);
      const sets = [`updated_at = ${params.add(now)}`];
      if (changes.name !== undefined) sets.push(`name = ${params.add(changes.name)}`);
      if (changes.servesHalf !== undefined) sets.push(`serves_half = ${params.add(changes.servesHalf)}`);
      if (changes.minutes !== undefined) sets.push(`minutes = ${params.add(changes.minutes)}`);
      if (changes.kind !== undefined) sets.push(`kind = ${params.add(changes.kind)}`);
      if (changes.visibility !== undefined) {
        const visibility = params.add(changes.visibility);
        sets.push(`visibility = ${visibility}`);
        sets.push(`link_code = CASE WHEN ${visibility} = 'link' THEN COALESCE(link_code, ${params.add(changes.newLinkCode ?? null)}) ELSE NULL END`);
      }
      const statements: SqlStatement[] = [
        { text: `UPDATE kitchen_recipes SET ${sets.join(", ")} WHERE ${OWNED} RETURNING id`, params: params.values },
      ];
      if (lines) {
        statements.push(
          { text: `DELETE FROM kitchen_recipe_lines WHERE recipe_id = $1 AND ${OWNED_EXISTS}`, params: [recipeId, ownerId] },
          { text: insertLines("$1", "$3", OWNED_EXISTS), params: [recipeId, ownerId, linesJson(lines)] },
        );
      }
      if (steps) {
        statements.push(
          { text: `DELETE FROM kitchen_recipe_steps WHERE recipe_id = $1 AND ${OWNED_EXISTS}`, params: [recipeId, ownerId] },
          { text: insertSteps("$1", "$3", OWNED_EXISTS), params: [recipeId, ownerId, JSON.stringify(steps)] },
        );
      }
      try {
        const [updated] = await executeBatch(executor, statements);
        if (!updated || updated.rows.length === 0) return NOT_FOUND;
      } catch (err) {
        return writeError(err);
      }
      try {
        const recipe = await findRecipe("r.id = $2", [ownerId, recipeId]);
        return recipe ? { ok: true, value: recipe } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async deleteRecipe(recipeId, ownerId, now) {
      try {
        const result = await executor.execute(
          `UPDATE kitchen_recipes SET deleted_at = $3, updated_at = $3 WHERE ${OWNED} RETURNING id`,
          [recipeId, ownerId, now],
        );
        if (result.rows.length === 0) return NOT_FOUND;
        const recipe = await findRecipe("r.id = $2", [ownerId, recipeId], true);
        return recipe ? { ok: true, value: recipe } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async setRecipeLink(recipeId, ownerId, code, now) {
      try {
        const result = await executor.execute(
          code
            ? `UPDATE kitchen_recipes SET visibility = 'link', link_code = $4, updated_at = $3 WHERE ${OWNED} RETURNING id`
            : `UPDATE kitchen_recipes
               SET visibility = CASE WHEN visibility = 'link' THEN 'groups' ELSE visibility END, link_code = NULL, updated_at = $3
               WHERE ${OWNED} RETURNING id`,
          code ? [recipeId, ownerId, now, code] : [recipeId, ownerId, now],
        );
        if (result.rows.length === 0) return NOT_FOUND;
      } catch (err) {
        return writeError(err);
      }
      try {
        const recipe = await findRecipe("r.id = $2", [ownerId, recipeId]);
        return recipe ? { ok: true, value: recipe } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async lastCook(viewer, recipeId) {
      try {
        const dish = await executor.execute(
          `SELECT d.id, d.cooked_at, d.recipe_factor_milli, d.portions_half FROM kitchen_dishes d
           WHERE d.cook = $1 AND d.recipe_id = $2 AND d.state <> 'canceled'
           ORDER BY d.cooked_at DESC, d.id DESC LIMIT 1`,
          [viewer, recipeId],
        );
        const row = dish.rows[0];
        if (!row) return { ok: true, value: null };
        const ingredients = await executor.execute(
          `SELECT di.item_id, i.name, di.position, di.qty_milli, di.unit, di.label, di.cost_minor, di.org_id, di.paid_by,
                  di.use_txn_id, di.recipe_line
           FROM kitchen_dish_ingredients di JOIN kitchen_items i ON i.id = di.item_id
           WHERE di.dish_id = $1 AND di.recipe_line IS NOT NULL
           ORDER BY di.position`,
          [row.id],
        );
        return {
          ok: true,
          value: {
            dishId: row.id as string,
            cookedAt: new Date(row.cooked_at as string),
            recipeFactorMilli: nullableNumber(row.recipe_factor_milli),
            portionsHalf: Number(row.portions_half),
            ingredients: ingredients.rows.map(mapDishIngredient),
          },
        };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
