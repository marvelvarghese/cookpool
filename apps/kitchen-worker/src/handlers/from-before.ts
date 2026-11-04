import {
  FROM_BEFORE_DEFAULT_LIMIT,
  FROM_BEFORE_MAX_LIMIT,
  type FromBeforePantry,
  type ItemHistoryEntry,
  type ItemHistoryResponse,
  type Recipe,
  type RecipeIngredient,
  type RecipeMatch,
  type RecipesResponse,
} from "@saas/contracts/kitchen";
import type {
  KitchenItemHistoryRecord,
  KitchenRecipeIngredientRecord,
  KitchenRecipeMatchRecord,
  KitchenRecipeRecord,
} from "@saas/db/kitchen";
import { isUnit } from "@saas/kitchen-engine/units";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { canUseIn, type MemberGroup } from "../groups-client.js";
import { successResponse, unavailable, validationError } from "../http.js";
import { toPublicId } from "../ids.js";
import {
  PERSONAL_PANTRY_NAME,
  daysBetween,
  displayQuantity,
  groupPantryRef,
  limitParam,
  personalPantryRef,
  queryParam,
} from "../pantry.js";
import { Fields } from "../validate.js";
import { myGroups } from "./dishes.js";

// From before (SM-8, cookpool-simpler design §3): the type-ahead on Bought
// and on Cook.
//
//   GET /v1/kitchen/me/items/history?q=&limit=   names bought before, with last time's details
//   GET /v1/kitchen/me/dishes/recipes?q=&limit=  dishes cooked before, ingredients matched to items usable now
//
// Each is one membership hop (the caller's groups, as the cross-pantry reads
// take them) and ONE D1 read, however much history there is: the app runs
// them as someone types. What they cover is what the caller can read already:
//
//   - history: their own pantry and every group they are in with a group
//     role (each of those roles reads the pantry, kitchen.pantry.read — the
//     cross-pantry reads' rule, ./pantries.ts);
//   - recipes: the dishes they cooked and those shared with any of their
//     groups (the dish list's rule, ./dishes.ts); an ingredient's match comes
//     only from their own pantry or a group where their role holds
//     kitchen.item.use, so cooking it again is not refused.
//
// Where something came from is named only when the caller can see it: a group
// they are not in (anymore) or another cook's own pantry reads as null.

interface Params {
  fields: Fields;
  q: string;
  limit: number;
}

function params(request: Request): Params {
  const url = new URL(request.url);
  const fields = new Fields();
  const q = queryParam(fields, url) ?? "";
  const limit = limitParam(fields, url, FROM_BEFORE_DEFAULT_LIMIT, FROM_BEFORE_MAX_LIMIT);
  return { fields, q, limit };
}

function groupsById(groups: readonly MemberGroup[]): Map<string, MemberGroup> {
  return new Map(groups.map((g) => [g.orgId as string, g]));
}

function personal(): FromBeforePantry {
  return { kind: "personal", orgId: null, name: PERSONAL_PANTRY_NAME };
}

function inGroup(group: MemberGroup): FromBeforePantry {
  return { kind: "group", orgId: group.publicId, name: group.name };
}

// ── Items bought before ────────────────────────────────────

/** A name bought before as the API shows it; null for a group outside `groups` (the read never returns one). */
function historyEntry(record: KitchenItemHistoryRecord, groups: ReadonlyMap<string, MemberGroup>): ItemHistoryEntry | null {
  const { item } = record;
  let pantry = personal();
  if (item.orgId !== null) {
    const group = groups.get(item.orgId);
    if (!group) return null;
    pantry = inGroup(group);
  }
  return {
    name: item.name,
    category: item.category,
    dimension: item.dimension,
    unit: item.displayUnit,
    quantity: displayQuantity(item.qtyBoughtMilli, item.displayUnit),
    qtyMilli: item.qtyBoughtMilli,
    priceMinor: item.priceMinor,
    currency: item.currency,
    pantry,
    paidBy: item.paidBy,
    wastePolicy: item.wastePolicy,
    // A use-by set before the day it was bought (an edit can) fills in as "the same day".
    useByDays: item.expiresOn === null ? null : Math.max(0, daysBetween(item.boughtOn, item.expiresOn)),
    times: record.times,
    lastBoughtOn: item.boughtOn,
  };
}

export async function handleItemHistory(ctx: RequestContext, request: Request): Promise<Response> {
  const { fields, q, limit } = params(request);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const byId = groupsById(groups);

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () =>
      repo.itemHistory({ ownerSubjectId: ctx.actor.subjectId, orgIds: groups.map((g) => g.orgId), q, limit }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    const items = found.value.flatMap((record) => historyEntry(record, byId) ?? []);
    return successResponse<ItemHistoryResponse>({ items }, ctx.requestId);
  });
}

// ── Dishes cooked before ───────────────────────────────────

/** Where an ingredient came from, as the caller sees it (see `RecipeIngredient.pantry`). */
function sourcePantry(
  ingredient: KitchenRecipeIngredientRecord,
  recipe: KitchenRecipeRecord,
  me: string,
  groups: ReadonlyMap<string, MemberGroup>,
): FromBeforePantry | null {
  if (ingredient.orgId === null) return recipe.cook === me ? personal() : null;
  const group = groups.get(ingredient.orgId);
  return group ? inGroup(group) : null;
}

function recipeMatch(match: KitchenRecipeMatchRecord, groups: ReadonlyMap<string, MemberGroup>): RecipeMatch | null {
  const id = toPublicId("itm", match.itemId);
  if (match.orgId === null) {
    return { itemId: id, ref: `me:${id}`, pantry: personalPantryRef(), qtyLeftMilli: match.qtyLeftMilli, canUse: true };
  }
  const group = groups.get(match.orgId);
  if (!group) return null; // The read matches only in the caller's groups.
  return {
    itemId: id,
    ref: `org:${group.publicId}:${id}`,
    pantry: groupPantryRef(group),
    qtyLeftMilli: match.qtyLeftMilli,
    canUse: canUseIn(group),
  };
}

function toRecipe(record: KitchenRecipeRecord, me: string, groups: ReadonlyMap<string, MemberGroup>): Recipe {
  const ingredients: RecipeIngredient[] = record.ingredients.map((i) => ({
    name: i.name,
    qtyMilli: i.qtyMilli,
    quantity: isUnit(i.unit) ? displayQuantity(i.qtyMilli, i.unit) : i.qtyMilli / 1000,
    unit: i.unit,
    dimension: i.dimension,
    pantry: sourcePantry(i, record, me, groups),
    match: i.match ? recipeMatch(i.match, groups) : null,
  }));
  const shared = record.orgId ? groups.get(record.orgId) : undefined;
  return {
    name: record.name,
    times: record.times,
    lastCookedAt: record.cookedAt.toISOString(),
    portionsHalf: record.portionsHalf,
    extrasMinor: record.extrasMinor,
    totalMinor: record.totalMinor,
    currency: record.currency,
    // A group the caller has left cannot be cooked for again.
    orgId: shared ? shared.publicId : null,
    ingredients,
  };
}

export async function handleRecipes(ctx: RequestContext, request: Request): Promise<Response> {
  const { fields, q, limit } = params(request);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const byId = groupsById(groups);
  const me = ctx.actor.subjectId;

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () =>
      repo.recipes({
        subjectId: me,
        orgIds: groups.map((g) => g.orgId),
        usableOrgIds: groups.filter(canUseIn).map((g) => g.orgId),
        q,
        limit,
      }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    return successResponse<RecipesResponse>(
      { recipes: found.value.map((record) => toRecipe(record, me, byId)) },
      ctx.requestId,
    );
  });
}
