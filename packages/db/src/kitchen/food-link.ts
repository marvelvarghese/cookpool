// How an item links to a food (Cookpool RC-4, migration 340_kitchen_foods):
// ONE SQL expression, used to look a name up (the repository's matchFood) and
// to link an item as it is added (`linkFoodStatement`, in the add's own
// batch), so the two never disagree. Its own module so the pantry and dish
// writes can use it without importing the food list's repository.

import type { SqlStatement } from "../d1/executor.js";

/**
 * The food a folded name `key` (an SQL expression, already lower(trim())) is
 * on the names table: the name itself, else the name without a plural "es"
 * or "s" when those agree on exactly one food; NULL otherwise.
 */
export function nameMatchSql(key: string): string {
  return `COALESCE(
    (SELECT n.food_key FROM kitchen_food_names n WHERE n.name_key = ${key}),
    (SELECT CASE WHEN COUNT(DISTINCT n.food_key) = 1 THEN MIN(n.food_key) END
       FROM kitchen_food_names n
       WHERE n.name_key IN (
         CASE WHEN length(${key}) > 2 AND substr(${key}, -2) = 'es' THEN substr(${key}, 1, length(${key}) - 2) END,
         CASE WHEN length(${key}) > 1 AND substr(${key}, -1) = 's' THEN substr(${key}, 1, length(${key}) - 1) END
       ))
  )`;
}

/**
 * The food an item named `name` in the pantry (`ownerKind`, `ownerId`) links
 * to — all three SQL expressions: the pantry's answer for the name when it
 * has one (NULL for "none of these"), else the names table's match.
 */
export function foodOfNameSql(name: string, ownerKind: string, ownerId: string): string {
  const key = `lower(trim(${name}))`;
  const answer = `FROM kitchen_food_answers a WHERE a.owner_kind = ${ownerKind} AND a.owner_id = ${ownerId} AND a.name_key = ${key}`;
  return `CASE WHEN EXISTS (SELECT 1 ${answer}) THEN (SELECT a.food_key ${answer}) ELSE ${nameMatchSql(key)} END`;
}

/**
 * Link one item to its food (or leave it unlinked), from its own name and
 * pantry: the statement an add runs right after the item's insert, in the
 * same batch (an item, a dish's "just bought it" items).
 */
export function linkFoodStatement(itemId: string): SqlStatement {
  return {
    text: `UPDATE kitchen_items
           SET food_key = ${foodOfNameSql("kitchen_items.name", "kitchen_items.owner_kind", "COALESCE(kitchen_items.owner_subject_id, kitchen_items.org_id)")}
           WHERE id = $1`,
    params: [itemId],
  };
}
