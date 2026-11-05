import type { SetMeasuresResponse } from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import type { KitchenItemRecord, KitchenPantryOwner, KitchenRepository } from "@saas/db/kitchen";
import { requireGroupAction } from "../authz.js";
import type { OrgContext, RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { errorResponse, notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { parsePublicId } from "../ids.js";
import { measureKeyOf, parseSetMeasures, toKitchenMeasure } from "../measures.js";
import { itemErrorResponse } from "../pantry.js";

// Your measures (SM-13, design §6): the sizes an item's name is counted in.
//
//   PUT /v1/organizations/{org}/kitchen/items/{itm}/measures   kitchen.item.use (members, owners, admins — not viewers)
//   PUT /v1/kitchen/me/items/{itm}/measures                    the pantry's owner
//
// `{ measures: [{ one, many, count, amountMilli }] }`, 0 to 3, replaces the
// measures of the item's name in its pantry, for its dimension: every item of
// that name there — next week's onions too — reads them, and nothing in
// another pantry or dimension does. Anyone who may use the item may set them,
// as anyone may log a use; an item the caller cannot use is the opaque 404,
// as on every item route. Setting a size moves no money (a use later takes
// count × size and costs what any use costs), so like a portion it writes no
// audit event: the measure row records who set it and when.

/** Read the item through `owner`'s pantry (that is the check), then replace its name's measures. */
async function setMeasures(
  ctx: RequestContext,
  request: Request,
  owner: KitchenPantryOwner,
  itemParam: string,
): Promise<Response> {
  const itemId = parsePublicId("itm", itemParam);
  if (!itemId) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseSetMeasures(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);

  return withKitchenRepo(ctx, async (repo: KitchenRepository) => {
    const found = await ctx.timings.measure("db", () => repo.getItem(owner, itemId));
    if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
    const item: KitchenItemRecord = found.value;
    const replaced = await ctx.timings.measure("db", () =>
      repo.replaceMeasures({
        key: measureKeyOf(item),
        measures: parsed.value.map((m) => ({ id: asUuid(crypto.randomUUID()), ...m })),
        actor: ctx.actor.subjectId,
        now: ctx.now(),
      }),
    );
    if (!replaced.ok) {
      if (replaced.error.kind === "internal") return unavailable(ctx.requestId);
      // Every value is validated first, so a refusal here is a bug, not a bad request.
      return errorResponse("internal_error", "The measures were out of range", 500, ctx.requestId, {
        reason: replaced.error.kind === "invalid" ? replaced.error.reason : replaced.error.kind,
      });
    }
    return successResponse<SetMeasuresResponse>({ measures: replaced.value.map(toKitchenMeasure) }, ctx.requestId);
  });
}

export async function handleSetGroupMeasures(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.item.use");
  if (denied) return denied;
  return setMeasures(ctx, request, { kind: "group", orgId: ctx.orgId }, params[0]!);
}

export async function handleSetMyMeasures(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  // A personal pantry belongs to its owner: anyone else's item reads as not found.
  return setMeasures(ctx, request, { kind: "user", subjectId: ctx.actor.subjectId }, params[0]!);
}
