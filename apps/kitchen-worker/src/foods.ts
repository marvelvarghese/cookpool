// The food list (Cookpool RC-4, cookpool-recipes design §2, §3.4): what the
// food handlers and the recipe handlers share — a food's public shape,
// matchFood, the bodies of PUT …/food-answers and PUT …/always-have, and the
// check that every food a request names is on the list.
//
// A name is matched the way the database folds it (`foodNameKey`: trimmed,
// ASCII letters lower-cased) — as itself, else without a plural "es" or "s"
// when those agree on one food. The same expression links an item to its
// food when it is added (packages/db kitchen/food-link.ts), so the match the
// API reports is the link the pantry keeps.

import {
  FOODS_DEFAULT_LIMIT,
  FOODS_MAX_LIMIT,
  MAX_ALWAYS_HAVE,
  foodNameKey,
  type KitchenFood,
} from "@saas/contracts/kitchen";
import type { Uuid } from "@saas/db/ids";
import type { KitchenFoodRecord, KitchenRepository } from "@saas/db/kitchen";
import type { RequestContext } from "./context.js";
import { parseOrgPublicId } from "./ids.js";
import { MAX_NAME, MAX_QUERY, limitParam } from "./pantry.js";
import { Fields, type FieldErrors } from "./validate.js";

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

/** A food key as the list writes them: lower-case ASCII, digits and underscores. */
const FOOD_KEY_RE = /^[a-z0-9_]{1,40}$/;

export function toKitchenFood(record: KitchenFoodRecord): KitchenFood {
  return {
    key: record.key,
    name: record.name,
    dimension: record.dimension,
    eachG: record.eachG,
    category: record.category,
    gPerMl: record.gPerMl,
  };
}

/**
 * matchFood (design §2): the one food `name` names, or null — lower-case,
 * trim, then the names table as itself, else without a plural "es" or "s".
 * Undefined when the database could not be read.
 */
export async function matchFood(
  ctx: Pick<RequestContext, "timings">,
  repo: KitchenRepository,
  name: string,
): Promise<KitchenFood | null | undefined> {
  const found = await ctx.timings.measure("db", () => repo.matchFood(name));
  if (!found.ok) return undefined;
  return found.value ? toKitchenFood(found.value) : null;
}

/** `?q=&limit=` of GET /v1/kitchen/foods: `q` folded as names are. */
export function parseFoodsQuery(url: URL): Parsed<{ q: string | null; limit: number }> {
  const fields = new Fields();
  const raw = url.searchParams.get("q") ?? "";
  if (raw.length > MAX_QUERY) fields.add("q", `Must be at most ${MAX_QUERY} characters`);
  const q = foodNameKey(raw.trim());
  const limit = limitParam(fields, url, FOODS_DEFAULT_LIMIT, FOODS_MAX_LIMIT);
  return fields.ok ? { ok: true, value: { q: q === "" ? null : q, limit } } : { ok: false, fields: fields.errors };
}

/** A food key a request names: its shape here, whether it is on the list by `unknownFoods`. */
export function foodKeyValue(fields: Fields, name: string, value: unknown): string | undefined {
  if (typeof value === "string" && FOOD_KEY_RE.test(value)) return value;
  return fields.add(name, "Must be a food's key from the food list (GET /v1/kitchen/foods)");
}

/**
 * The keys of `wanted` (field name → key) that are not on the food list, as
 * field errors; an empty object when every one is. Null when the list could
 * not be read.
 */
export async function unknownFoods(
  ctx: Pick<RequestContext, "timings">,
  repo: KitchenRepository,
  wanted: ReadonlyMap<string, string>,
): Promise<{ errors: FieldErrors; foods: Map<string, KitchenFoodRecord> } | null> {
  const keys = [...new Set(wanted.values())];
  const found = await ctx.timings.measure("db", () => repo.getFoods(keys));
  if (!found.ok) return null;
  const foods = new Map(found.value.map((f) => [f.key, f]));
  const errors: FieldErrors = {};
  for (const [field, key] of wanted) {
    if (!foods.has(key)) (errors[field] ??= []).push(`No food "${key}" on the food list`);
  }
  return { errors, foods };
}

export interface ParsedFoodAnswer {
  /** As folded (`foodNameKey`). */
  nameKey: string;
  foodKey: string | null;
  /** The group's pantry; null for the caller's own. */
  orgId: Uuid | null;
}

/** A PUT /v1/kitchen/me/food-answers body: `{ nameKey, foodKey, orgId? }`. */
export function parseFoodAnswer(body: Record<string, unknown>): Parsed<ParsedFoodAnswer> {
  const fields = new Fields();
  let nameKey: string | undefined;
  if (typeof body.nameKey === "string" && foodNameKey(body.nameKey.trim()).length >= 1 && body.nameKey.trim().length <= MAX_NAME) {
    nameKey = foodNameKey(body.nameKey.trim());
  } else {
    fields.add("nameKey", `Must be the item's name, 1 to ${MAX_NAME} characters`);
  }
  let foodKey: string | null | undefined;
  if (body.foodKey === null) foodKey = null;
  else foodKey = foodKeyValue(fields, "foodKey", body.foodKey);
  let orgId: Uuid | null = null;
  if (body.orgId !== undefined && body.orgId !== null) {
    orgId = typeof body.orgId === "string" ? parseOrgPublicId(body.orgId) : null;
    if (!orgId) fields.add("orgId", "Must be a group's org_ id, or null for your own pantry");
  }
  if (!fields.ok || nameKey === undefined || foodKey === undefined) return { ok: false, fields: fields.errors };
  return { ok: true, value: { nameKey, foodKey, orgId } };
}

/** A PUT /v1/kitchen/me/always-have body: `{ foodKeys }`, 0 to MAX_ALWAYS_HAVE keys, each once. */
export function parseAlwaysHave(body: Record<string, unknown>): Parsed<string[]> {
  const fields = new Fields();
  if (!Array.isArray(body.foodKeys)) return { ok: false, fields: { foodKeys: [`Must be a list of at most ${MAX_ALWAYS_HAVE} food keys`] } };
  if (body.foodKeys.length > MAX_ALWAYS_HAVE) fields.add("foodKeys", `At most ${MAX_ALWAYS_HAVE} foods`);
  const keys: string[] = [];
  body.foodKeys.slice(0, MAX_ALWAYS_HAVE).forEach((value: unknown, i) => {
    const key = foodKeyValue(fields, `foodKeys[${i}]`, value);
    if (key === undefined) return;
    if (keys.includes(key)) fields.add(`foodKeys[${i}]`, "Name each food once");
    else keys.push(key);
  });
  return fields.ok ? { ok: true, value: keys } : { ok: false, fields: fields.errors };
}
