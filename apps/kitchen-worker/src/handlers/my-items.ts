import { DEFAULT_KITCHEN_CURRENCY } from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import type { KitchenItemRecord, KitchenPantryOwner, KitchenRepository } from "@saas/db/kitchen";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId } from "../ids.js";
import { readMeasures } from "../measures.js";
import {
  expectedVersion,
  isoDay,
  itemChanges,
  itemErrorResponse,
  parseItemEdit,
  parseNewItem,
  personalPantryRef,
  resolveQuantity,
  toKitchenItem,
  type ParsedQuantity,
} from "../pantry.js";

// The caller's personal pantry, /v1/kitchen/me/items…
//
//   POST   /v1/kitchen/me/items          add to it
//   GET    /v1/kitchen/me/items/{itm}    one of its items
//   PATCH  /v1/kitchen/me/items/{itm}    name, category, use-by, note; quantity and price while unused
//   DELETE /v1/kitchen/me/items/{itm}    added by mistake (refused once used)
//
// Only its owner can see or change it: every read and write is keyed by the
// caller's subject, so anyone else's item is the opaque 404. No policy engine:
// a personal pantry belongs to a person, not a group (design.md §6). Its items
// move no money and carry no audit event — audit is a group's log, and a
// personal pantry is in no group. So an item's note (RC-3) here is read by
// its owner alone.
//
// (GET /v1/kitchen/me/items, the list across every pantry, is in ./pantries.ts.)

function owner(ctx: RequestContext): KitchenPantryOwner {
  return { kind: "user", subjectId: ctx.actor.subjectId };
}

/** `{ item }`, with its name's measures (SM-13). */
async function itemResponse(ctx: RequestContext, repo: KitchenRepository, record: KitchenItemRecord, status = 200): Promise<Response> {
  const measures = await readMeasures(ctx, repo, [record]);
  if (!measures) return unavailable(ctx.requestId);
  return successResponse(
    { item: toKitchenItem(record, personalPantryRef(), null, isoDay(ctx.now()), measures(record)) },
    ctx.requestId,
    status,
  );
}

export async function handleCreateMyItem(ctx: RequestContext, request: Request): Promise<Response> {
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseNewItem(body, { group: false });
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const input = parsed.value;

  return withKitchenRepo(ctx, async (repo) => {
    const now = ctx.now();
    const actor = ctx.actor.subjectId;
    const result = await ctx.timings.measure("db", () =>
      repo.createItem({
        item: {
          id: asUuid(crypto.randomUUID()),
          owner: owner(ctx),
          name: input.name,
          category: input.category,
          dimension: input.dimension,
          displayUnit: input.displayUnit,
          qtyMilli: input.qtyMilli,
          priceMinor: input.priceMinor,
          currency: input.currency ?? DEFAULT_KITCHEN_CURRENCY,
          paidBy: actor,
          boughtOn: input.boughtOn ?? isoDay(now),
          expiresOn: input.expiresOn,
          wastePolicy: null,
          createdBy: actor,
          idemKey: idem.key,
          now,
          note: input.note,
        },
      }),
    );
    if (!result.ok) return itemErrorResponse(ctx.requestId, result.error);
    // The key is unique per pantry and this pantry is the caller's alone, so a
    // replay answers with the item their first request added.
    return itemResponse(ctx, repo, result.value.item, 201);
  });
}

export async function handleGetMyItem(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getItem(owner(ctx), itemId));
    if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
    return itemResponse(ctx, repo, found.value);
  });
}

export async function handleUpdateMyItem(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseItemEdit(body, { group: false });
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const edit = parsed.value;

  return withKitchenRepo(ctx, async (repo) => {
    let quantity: ParsedQuantity | undefined;
    if (edit.quantity) {
      // A quantity without a unit is in the item's own unit.
      const found = await ctx.timings.measure("db", () => repo.getItem(owner(ctx), itemId));
      if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
      const resolved = resolveQuantity(edit, found.value);
      if (!resolved.ok) return validationError(ctx.requestId, resolved.fields);
      quantity = resolved.value;
    }
    const updated = await ctx.timings.measure("db", () =>
      repo.updateItem({
        owner: owner(ctx),
        itemId,
        changes: itemChanges(edit, quantity),
        ...expectedVersion(edit),
        now: ctx.now(),
      }),
    );
    if (!updated.ok) return itemErrorResponse(ctx.requestId, updated.error);
    return itemResponse(ctx, repo, updated.value);
  });
}

export async function handleRemoveMyItem(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const removed = await ctx.timings.measure("db", () => repo.removeItem(owner(ctx), itemId, ctx.now()));
    if (!removed.ok) return itemErrorResponse(ctx.requestId, removed.error);
    return itemResponse(ctx, repo, removed.value);
  });
}
