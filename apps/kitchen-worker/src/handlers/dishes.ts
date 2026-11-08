import {
  DEFAULT_KITCHEN_CURRENCY,
  KITCHEN_ERROR_REASONS,
  type DishResponse,
  type DishesPage,
  type KitchenDishState,
} from "@saas/contracts/kitchen";
import { asUuid, type Uuid } from "@saas/db/ids";
import type { KitchenDishRecord, KitchenDishScope, KitchenDishesCursor, KitchenRepository } from "@saas/db/kitchen";
import { formatMinor } from "@saas/kitchen-engine/money";
import { requireGroupAction, requireOrgAction } from "../authz.js";
import type { OrgContext, RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { emailDishPosted } from "../emails.js";
import {
  DEFAULT_DISHES_LIMIT,
  MAX_DISHES_LIMIT,
  cursorParam,
  dishAudits,
  dishErrorResponse,
  encodeDishesCursor,
  parseDish,
  planDish,
  stateParam,
  toKitchenDish,
} from "../dishes.js";
import { canUseIn, type MemberGroup } from "../groups-client.js";
import { conflict, forbidden, notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { readMeasures, type MeasureBook } from "../measures.js";
import { limitParam } from "../pantry.js";
import { Fields } from "../validate.js";
import { canSee } from "../recipes.js";

// Dishes:
//
//   POST /v1/kitchen/me/dishes                     cook — kitchen.dish.cook in the group it is shared with,
//                                                  kitchen.item.use in every group it takes from
//   GET  /v1/kitchen/me/dishes?state=&cursor=&limit=   what the caller cooked, and what is shared with their groups
//   GET  /v1/kitchen/me/dishes/{dsh}               its cook, or a member of its group
//   POST /v1/kitchen/me/dishes/{dsh}/cancel        its cook, while it is not finalized
//   GET  /v1/organizations/{org}/kitchen/dishes    kitchen.pantry.read: the dishes shared with the group
//
// Cooking is one write (see CookDishInput): every ingredient's stock comes
// out of its pantry — the cook's own, or a group's where they hold
// kitchen.item.use (design.md §6) — and in each source group one `use`
// transaction pays every buyer back what their items cost, the cook owing it
// all. What the cook paid for themselves moves no money. Like a use, the write
// is costed from the items as read and applies only at those versions; it is
// planned once more from a fresh read when an item moved on. Cancelling puts
// every ingredient back and reverses every charge, in one write too.

/** The caller's groups; null when membership could not be read. */
export async function myGroups(ctx: RequestContext): Promise<MemberGroup[] | null> {
  const result = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  return result.ok ? result.groups : null;
}

/** The dishes the caller may read: theirs, and those shared with any group they are in. */
export function readable(ctx: RequestContext, groups: readonly MemberGroup[]): KitchenDishScope {
  return { cook: ctx.actor.subjectId, orgIds: groups.map((g) => g.orgId) };
}

/** `{ dish }`, as the caller reads it. */
export function dishResponse(ctx: RequestContext, dish: KitchenDishRecord, status = 200): Response {
  return successResponse<DishResponse>({ dish: toKitchenDish(dish, ctx.actor.subjectId) }, ctx.requestId, status);
}

export async function handleCookDish(ctx: RequestContext, request: Request): Promise<Response> {
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseDish(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const dish = parsed.value;
  const cook = ctx.actor.subjectId;

  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  let shared: MemberGroup | null = null;
  if (dish.orgId) {
    const orgId = dish.orgId;
    // Sharing a dish with a group is cooking for it.
    const denied = await ctx.timings.measure("authz", () =>
      requireOrgAction(ctx.env, ctx.requestId, ctx.actor, orgId, "kitchen.dish.cook"),
    );
    if (denied) return denied;
    shared = groups.find((g) => g.orgId === orgId) ?? null;
    if (!shared) return notFound(ctx.requestId);
  }
  // Where ingredients may come from: the cook's own pantry, and the groups
  // where their role holds kitchen.item.use — each confirmed with policy
  // before anything is written.
  const scope = { ownerSubjectId: cook, orgIds: groups.filter(canUseIn).map((g) => g.orgId) };
  const itemIds = dish.ingredients.map((i) => i.itemId);

  return withKitchenRepo(ctx, async (repo) => {
    // This very request again: answer with the dish it made (its emails are
    // asked for again, and notifications-worker sends none twice).
    const prior = await ctx.timings.measure("db", () => repo.getDishByIdemKey(cook, idem.key));
    if (!prior.ok) return unavailable(ctx.requestId);
    if (prior.value) {
      const dish = prior.value;
      await ctx.defer(() => emailDishPosted(ctx, dish));
      return dishResponse(ctx, dish, 201);
    }

    // Cooked from a recipe (RC-4): one the cook may see (design §5.1), and lines it has.
    if (dish.recipeId) {
      const recipeId = dish.recipeId;
      const recipe = await ctx.timings.measure("db", () => repo.getRecipe(recipeId, cook));
      if (!recipe.ok) return recipe.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
      const visible = await canSee(ctx, recipe.value);
      if (visible === null) return unavailable(ctx.requestId);
      if (!visible) return notFound(ctx.requestId);
      const lineFields = new Fields();
      const count = recipe.value.lines.length;
      dish.ingredients.forEach((i, at) => {
        if (i.recipeLine !== null && i.recipeLine >= count) lineFields.add(`ingredients[${at}].recipeLine`, `The recipe has ${count} lines`);
      });
      dish.newItems.forEach((i, at) => {
        if (i.recipeLine !== null && i.recipeLine >= count) lineFields.add(`newItems[${at}].recipeLine`, `The recipe has ${count} lines`);
      });
      if (!lineFields.ok) return validationError(ctx.requestId, lineFields.errors);
    }

    let sharedWith: { orgId: Uuid; currency: string } | null = null;
    if (shared) {
      const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(shared.orgId));
      if (!settings.ok) return unavailable(ctx.requestId);
      sharedWith = { orgId: shared.orgId, currency: settings.value?.currency ?? DEFAULT_KITCHEN_CURRENCY };
    }

    const dishId = asUuid(crypto.randomUUID());
    const allowed = new Set<string>();
    for (let attempt = 0; ; attempt += 1) {
      const found = await ctx.timings.measure("db", () => repo.findItems(scope, itemIds));
      if (!found.ok) return unavailable(ctx.requestId);
      const items = new Map(found.value.map((item) => [item.id, item]));
      // An item in no pantry the cook may use reads as one that does not exist.
      if (itemIds.some((id) => !items.has(id))) return notFound(ctx.requestId);
      for (const orgId of new Set(found.value.flatMap((item) => (item.orgId ? [item.orgId] : [])))) {
        if (allowed.has(orgId)) continue;
        const denied = await ctx.timings.measure("authz", () =>
          requireOrgAction(ctx.env, ctx.requestId, ctx.actor, orgId as Uuid, "kitchen.item.use"),
        );
        if (denied) return denied;
        allowed.add(orgId);
      }

      // An ingredient given in a measure (SM-13) needs the items' measures: one more statement, only then.
      let measures: MeasureBook = () => [];
      if (dish.ingredients.some((i) => i.measure)) {
        const read = await readMeasures(ctx, repo, found.value);
        if (!read) return unavailable(ctx.requestId);
        measures = read;
      }
      const plan = planDish(ctx, dish, { cook, dishId, idemKey: idem.key, now: ctx.now(), shared: sharedWith, items, measures });
      if (plan instanceof Response) return plan;
      const result = await ctx.timings.measure("db", () => repo.cookDish(plan));
      if (result.ok) {
        // Committed: a dish posted for claims tells the group (CP-18).
        const cooked = result.value.dish;
        await ctx.defer(() => emailDishPosted(ctx, cooked));
        return dishResponse(ctx, cooked, 201);
      }
      if (result.error.kind === "stale" && attempt === 0) continue;
      return dishErrorResponse(ctx.requestId, result.error);
    }
  });
}

interface ListParams {
  fields: Fields;
  state: KitchenDishState | null;
  cursor: KitchenDishesCursor | null;
  limit: number;
}

/** `state`, `cursor` and `limit`, as the dish lists take them. */
function listParams(request: Request): ListParams {
  const url = new URL(request.url);
  const fields = new Fields();
  const state = stateParam(fields, url);
  const cursor = cursorParam(fields, url);
  const limit = limitParam(fields, url, DEFAULT_DISHES_LIMIT, MAX_DISHES_LIMIT);
  return { fields, state, cursor, limit };
}

async function listDishes(
  ctx: RequestContext,
  repo: KitchenRepository,
  scope: KitchenDishScope,
  params: ListParams,
): Promise<Response> {
  const page = await ctx.timings.measure("db", () =>
    repo.listDishes({ ...scope, state: params.state, cursor: params.cursor, limit: params.limit }),
  );
  if (!page.ok) return unavailable(ctx.requestId);
  const nextCursor = page.value.nextCursor ? encodeDishesCursor(page.value.nextCursor) : null;
  return successResponse<DishesPage>(
    { dishes: page.value.dishes.map((dish) => toKitchenDish(dish, ctx.actor.subjectId)), nextCursor },
    ctx.requestId,
    200,
    nextCursor,
  );
}

export async function handleMyDishes(ctx: RequestContext, request: Request): Promise<Response> {
  const params = listParams(request);
  if (!params.fields.ok) return validationError(ctx.requestId, params.fields.errors);
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  return withKitchenRepo(ctx, (repo) => listDishes(ctx, repo, readable(ctx, groups), params));
}

export async function handleGroupDishes(ctx: OrgContext, request: Request): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
  if (denied) return denied;
  const params = listParams(request);
  if (!params.fields.ok) return validationError(ctx.requestId, params.fields.errors);
  return withKitchenRepo(ctx, (repo) => listDishes(ctx, repo, { cook: null, orgIds: [ctx.orgId] }, params));
}

export async function handleGetMyDish(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getDish(dishId, readable(ctx, groups)));
    if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    return dishResponse(ctx, found.value);
  });
}

export async function handleCancelDish(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const actor = ctx.actor.subjectId;

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getDish(dishId, readable(ctx, groups)));
    if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    const dish = found.value;
    if (dish.cook !== actor) {
      return forbidden(ctx.requestId, "Only whoever cooked a dish can cancel it", KITCHEN_ERROR_REASONS.NOT_CREATOR);
    }
    // Cancelled already (this request again, or another): nothing more to put back.
    if (dish.state === "canceled") return dishResponse(ctx, dish);
    if (dish.state === "finalized") return dishErrorResponse(ctx.requestId, { kind: "dish_not_open", state: dish.state });

    const sourceGroups = [...new Set(dish.ingredients.flatMap((i) => (i.orgId ? [i.orgId] : [])))];
    const audits = dishAudits(ctx, {
      type: "kitchen.dish.canceled",
      dishId: dish.id,
      idemKey: idem.key,
      sharedWith: dish.orgId,
      sourceGroups,
      describe(orgId) {
        const here = dish.ingredients.filter((i) => i.orgId === orgId);
        const charged = here.filter((i) => i.useTxnId).reduce((sum, i) => sum + i.costMinor, 0);
        return {
          description:
            `Dish ${toPublicId("dsh", dish.id)} "${dish.name}" canceled by ${actor}` +
            (here.length > 0
              ? `: ${here.map((i) => i.name).join(", ")} back in the group's pantry` +
                (charged > 0 ? `, ${formatMinor(charged, dish.currency)} of charges reversed` : "")
              : ""),
          payload: {
            dishId: toPublicId("dsh", dish.id),
            name: dish.name,
            cook: dish.cook,
            // Only the group it was shared with hears about the dish as a whole.
            shared: orgId === dish.orgId,
            reversedMinor: charged,
            currency: dish.currency,
            itemIds: here.map((i) => toPublicId("itm", i.itemId)),
          },
        };
      },
    });

    const result = await ctx.timings.measure("db", () => repo.cancelDish({ dish, actor, now: ctx.now(), audits }));
    if (result.ok) return dishResponse(ctx, result.value);
    if (result.error.kind === "dish_not_open" && result.error.state === "canceled") {
      // Another cancel won the race: answer with the dish as it now is.
      const now = await ctx.timings.measure("db", () => repo.getDish(dishId, readable(ctx, groups)));
      if (now.ok) return dishResponse(ctx, now.value);
    }
    if (result.error.kind === "conflict") {
      return conflict(ctx.requestId, "The dish changed while it was being canceled; read it again", KITCHEN_ERROR_REASONS.STALE);
    }
    return dishErrorResponse(ctx.requestId, result.error);
  });
}
