import type { AlwaysHaveResponse, FoodsResponse, SetFoodAnswerResponse } from "@saas/contracts/kitchen";
import type { KitchenPantryOwner, KitchenRepository } from "@saas/db/kitchen";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { parseAlwaysHave, parseFoodAnswer, parseFoodsQuery, toKitchenFood, unknownFoods } from "../foods.js";
import { readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { orgPublicId } from "../ids.js";

// The food list (RC-4, cookpool-recipes design §2, §3.4):
//
//   GET /v1/kitchen/foods?q=&limit=     any signed-in person: the shared list, best match first
//   PUT /v1/kitchen/me/food-answers     "Is Kanda onion?" — the caller's own pantry, or a group's
//                                       where they hold kitchen.item.use (the opaque 404 otherwise)
//   GET /v1/kitchen/me/always-have      the caller's list (salt and water until they save one)
//   PUT /v1/kitchen/me/always-have      replace it
//
// An answer is kept per name and pantry, and every item of that name there
// follows it at once (one batch); items of that name added later follow it
// too. Like a measure, it moves no money and writes no audit event: the row
// records who answered and when.

export async function handleFoods(ctx: RequestContext, request: Request): Promise<Response> {
  const parsed = parseFoodsQuery(new URL(request.url));
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.searchFoods(parsed.value.q, parsed.value.limit));
    if (!found.ok) return unavailable(ctx.requestId);
    return successResponse<FoodsResponse>(
      { foods: found.value.map((f) => ({ ...toKitchenFood(f), matchedName: f.matchedName })) },
      ctx.requestId,
    );
  });
}

export async function handleSetFoodAnswer(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseFoodAnswer(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const { nameKey, foodKey, orgId } = parsed.value;

  let owner: KitchenPantryOwner = { kind: "user", subjectId: ctx.actor.subjectId };
  if (orgId) {
    // Saying what a group's item is, is using its pantry: as a measure is (SM-13).
    const denied = await ctx.timings.measure("authz", () =>
      requireOrgAction(ctx.env, ctx.requestId, ctx.actor, orgId, "kitchen.item.use"),
    );
    if (denied) return denied;
    owner = { kind: "group", orgId };
  }

  return withKitchenRepo(ctx, async (repo) => {
    if (foodKey) {
      const known = await unknownFoods(ctx, repo, new Map([["foodKey", foodKey]]));
      if (!known) return unavailable(ctx.requestId);
      if (Object.keys(known.errors).length > 0) return validationError(ctx.requestId, known.errors);
    }
    const answered = await ctx.timings.measure("db", () =>
      repo.setFoodAnswer({ owner, name: nameKey, foodKey, actor: ctx.actor.subjectId, now: ctx.now() }),
    );
    if (!answered.ok) {
      if (answered.error.kind === "invalid") return validationError(ctx.requestId, { foodKey: ["No such food on the food list"] });
      return unavailable(ctx.requestId);
    }
    return successResponse<SetFoodAnswerResponse>(
      {
        answer: { nameKey: answered.value.answer.nameKey, foodKey: answered.value.answer.foodKey, orgId: orgId ? orgPublicId(orgId) : null },
        linkedItems: answered.value.linkedItems,
      },
      ctx.requestId,
    );
  });
}

/** `{ foods, isDefault }` for a list of keys. */
async function alwaysHaveResponse(
  ctx: RequestContext,
  repo: KitchenRepository,
  list: { foodKeys: string[]; isSet: boolean },
): Promise<Response> {
  const foods = await ctx.timings.measure("db", () => repo.getFoods(list.foodKeys));
  if (!foods.ok) return unavailable(ctx.requestId);
  return successResponse<AlwaysHaveResponse>({ foods: foods.value.map(toKitchenFood), isDefault: !list.isSet }, ctx.requestId);
}

export async function handleGetAlwaysHave(ctx: RequestContext): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const list = await ctx.timings.measure("db", () => repo.getAlwaysHave(ctx.actor.subjectId));
    if (!list.ok) return unavailable(ctx.requestId);
    return alwaysHaveResponse(ctx, repo, list.value);
  });
}

export async function handleSetAlwaysHave(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseAlwaysHave(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const keys = parsed.value;

  return withKitchenRepo(ctx, async (repo) => {
    const known = await unknownFoods(ctx, repo, new Map(keys.map((key, i) => [`foodKeys[${i}]`, key])));
    if (!known) return unavailable(ctx.requestId);
    if (Object.keys(known.errors).length > 0) return validationError(ctx.requestId, known.errors);
    const saved = await ctx.timings.measure("db", () => repo.setAlwaysHave(ctx.actor.subjectId, keys, ctx.now()));
    if (!saved.ok) {
      if (saved.error.kind === "invalid") return validationError(ctx.requestId, { foodKeys: ["Every food must be on the food list"] });
      return unavailable(ctx.requestId);
    }
    return alwaysHaveResponse(ctx, repo, saved.value);
  });
}
