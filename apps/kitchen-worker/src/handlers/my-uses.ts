import {
  DEFAULT_KITCHEN_CURRENCY,
  KITCHEN_ERROR_REASONS,
  USUALS_DAYS,
  type KitchenUsual,
  type MovesResponse,
  type StockMoveResponse,
  type UsualsResponse,
} from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import type { KitchenItemRecord, KitchenPantryOwner, KitchenRepository, StockMoved } from "@saas/db/kitchen";
import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import { formatQuantity, isUnit } from "@saas/kitchen-engine/units";
import { requireOrgAction } from "../authz.js";
import type { OrgContext, RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { canUseIn, type MemberGroup } from "../groups-client.js";
import { notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parseOrgPublicId, parsePublicId, toPublicId } from "../ids.js";
import { idempotencyKeyReused, ledgerAudit } from "../ledger.js";
import { readMeasures, type MeasureBook } from "../measures.js";
import {
  displayQuantity,
  groupPantryRef,
  isoDay,
  itemErrorResponse,
  limitParam,
  personalPantryRef,
  toKitchenItem,
  wastePolicyOf,
} from "../pantry.js";
import {
  DEFAULT_MOVES_LIMIT,
  DEFAULT_USUALS_LIMIT,
  MAX_MOVES_LIMIT,
  MAX_USUALS_LIMIT,
  insufficientStock,
  parseUse,
  parseWaste,
  quantityOf,
  stockErrorResponse,
  takeStock,
  toStockMove,
  undoMove,
  useAmount,
} from "../stock.js";
import { Fields } from "../validate.js";

// Using the caller's own pantry, and moving an item out of it:
//
//   POST /v1/kitchen/me/items/{itm}/uses       use some (a stock move: no ledger)
//   POST /v1/kitchen/me/items/{itm}/waste      waste some, or everything left (a stock move)
//   POST /v1/kitchen/me/items/{itm}/transfer   move it into a group's pantry (kitchen.item.create there)
//   GET  /v1/kitchen/me/items/{itm}/moves      its history, newest first
//   POST /v1/kitchen/me/moves/{mov}/undo       put back the latest use or waste
//   GET  /v1/kitchen/me/usuals                 what the caller often uses, across every pantry they may use
//
// A personal pantry belongs to its owner (design.md §6): every read and write
// is keyed by the caller's subject, so anyone else's item or move is the
// opaque 404, and nothing here asks the policy engine — except a transfer,
// which writes to a group. A personal item's uses still charge its price
// (`cost_taken`), so what is left of it is worth what is left of its price.

function owner(ctx: RequestContext): KitchenPantryOwner {
  return { kind: "user", subjectId: ctx.actor.subjectId };
}

/**
 * 201 with the item as it is now (in the caller's pantry, with its measures —
 * `known` when the write read them already, else read here), and the move.
 */
async function moved(
  ctx: RequestContext,
  repo: KitchenRepository,
  result: StockMoved,
  known: MeasureBook | null = null,
): Promise<Response> {
  const measures = known ?? (await readMeasures(ctx, repo, [result.item]));
  if (!measures) return unavailable(ctx.requestId);
  return successResponse<StockMoveResponse>(
    {
      item: toKitchenItem(result.item, personalPantryRef(), null, isoDay(ctx.now()), measures(result.item)),
      move: toStockMove(result.move, result.item),
      txn: null,
    },
    ctx.requestId,
    201,
  );
}

export async function handleUseMyItem(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseUse(body, { group: false });
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const use = parsed.value;
  const actor = ctx.actor.subjectId;

  return withKitchenRepo(ctx, async (repo) => {
    // A use in a measure (SM-13) reads the item's measures to know how much it takes.
    let measures: MeasureBook | null = null;
    const result = await takeStock(ctx, repo, { owner: owner(ctx), itemId, kind: "use", idemKey: idem.key }, async (item) => {
      const qty = await useAmount(ctx.requestId, item, use, async () => (measures = await readMeasures(ctx, repo, [item])));
      if (qty instanceof Response) return qty;
      return {
        owner: owner(ctx),
        itemId,
        expectedVersion: item.version,
        move: {
          id: asUuid(crypto.randomUUID()),
          kind: "use",
          qtyMilli: qty.qtyMilli,
          // A measure only decides how much is taken; the cost is any use's.
          costMinor: costOfUse(item, qty.qtyMilli),
          unit: qty.unit,
          label: qty.label,
          consumers: [actor],
          actor,
          idemKey: idem.key,
          now: ctx.now(),
        },
      };
    });
    return result instanceof Response ? result : moved(ctx, repo, result, measures);
  });
}

export async function handleWasteMyItem(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request, { optional: true });
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object, or empty"] });
  const parsed = parseWaste(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const waste = parsed.value;

  return withKitchenRepo(ctx, async (repo) => {
    const result = await takeStock(ctx, repo, { owner: owner(ctx), itemId, kind: "waste", idemKey: idem.key }, async (item) => {
      let qtyMilli = item.qtyLeftMilli;
      let unit = item.displayUnit;
      if (waste.quantity !== null) {
        const qty = quantityOf(item, waste.quantity, waste.unit);
        if (!qty.ok) return validationError(ctx.requestId, qty.fields);
        ({ qtyMilli, unit } = qty.value);
      }
      if (qtyMilli === 0 || qtyMilli > item.qtyLeftMilli) return insufficientStock(ctx.requestId, item.qtyLeftMilli);
      // A personal pantry has no ledger: its owner absorbs the loss.
      return {
        owner: owner(ctx),
        itemId,
        expectedVersion: item.version,
        move: {
          id: asUuid(crypto.randomUUID()),
          kind: "waste",
          qtyMilli,
          costMinor: costOfUse(item, qtyMilli),
          unit,
          consumers: null,
          actor: ctx.actor.subjectId,
          idemKey: idem.key,
          now: ctx.now(),
        },
      };
    });
    return result instanceof Response ? result : moved(ctx, repo, result);
  });
}

/** The caller's groups, by name; null when membership could not be read. */
async function myGroups(ctx: RequestContext): Promise<MemberGroup[] | null> {
  const result = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  return result.ok ? result.groups : null;
}

/** Nothing of it taken and nothing charged: what a transfer requires. */
function isUnused(item: KitchenItemRecord): boolean {
  return item.state === "active" && item.qtyLeftMilli === item.qtyBoughtMilli && item.costTakenMinor === 0;
}

export async function handleTransferMyItem(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const orgId = typeof body.orgId === "string" ? parseOrgPublicId(body.orgId) : null;
  if (!orgId) return validationError(ctx.requestId, { orgId: ["Must be a group's org_ id"] });

  // Moving an item into a group adds it to that group's pantry.
  const denied = await ctx.timings.measure("authz", () =>
    requireOrgAction(ctx.env, ctx.requestId, ctx.actor, orgId, "kitchen.item.create"),
  );
  if (denied) return denied;
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const group = groups.find((g) => g.orgId === orgId);
  if (!group) return notFound(ctx.requestId);

  const groupCtx: OrgContext = { ...ctx, orgId };
  const into: KitchenPantryOwner = { kind: "group", orgId };
  const actor = ctx.actor.subjectId;

  return withKitchenRepo(ctx, async (repo) => {
    const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(orgId));
    if (!settings.ok) return unavailable(ctx.requestId);
    const currency = settings.value?.currency ?? DEFAULT_KITCHEN_CURRENCY;
    // In the group, the item reads the group's measures for its name (SM-13).
    const respond = async (result: StockMoved): Promise<Response> => {
      const measures = await readMeasures(ctx, repo, [result.item]);
      if (!measures) return unavailable(ctx.requestId);
      return successResponse<StockMoveResponse>(
        {
          item: toKitchenItem(result.item, groupPantryRef(group), wastePolicyOf(settings.value), isoDay(ctx.now()), measures(result.item)),
          move: toStockMove(result.move, result.item),
          txn: null,
        },
        ctx.requestId,
        201,
      );
    };

    for (let attempt = 0; ; attempt += 1) {
      const found = await ctx.timings.measure("db", () => repo.getItem(owner(ctx), itemId));
      if (!found.ok) {
        if (found.error.kind !== "not_found") return itemErrorResponse(ctx.requestId, found.error);
        // Gone from my pantry: this very request may already have moved it.
        const prior = await ctx.timings.measure("db", () => repo.getMoveByIdemKey(into, itemId, idem.key));
        if (prior.ok && prior.value?.kind === "transfer" && prior.value.actor === actor) {
          const item = await ctx.timings.measure("db", () => repo.getItem(into, itemId));
          if (item.ok) return respond({ item: item.value, move: prior.value, txn: null, replayed: true });
        }
        return notFound(ctx.requestId);
      }
      const item = found.value;
      if (!isUnused(item)) return itemErrorResponse(ctx.requestId, { kind: "item_used" });
      if (item.currency !== currency) {
        return unprocessable(ctx.requestId, `The group counts in ${currency}`, KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH, {
          currency,
        });
      }

      const moveId = asUuid(crypto.randomUUID());
      const what = formatQuantity(item.qtyLeftMilli, item.dimension, item.displayUnit);
      const result = await ctx.timings.measure("db", () =>
        repo.transferItem({
          item,
          orgId,
          currency,
          move: { id: moveId, actor, idemKey: idem.key, now: ctx.now() },
          audit: ledgerAudit(groupCtx, {
            type: "kitchen.item.transferred",
            subjectKind: "kitchen_item",
            subjectId: item.id,
            idemKey: idem.key,
            description:
              `Item ${toPublicId("itm", item.id)} "${item.name}" (${what}, ${formatMinor(item.priceMinor, item.currency)}) ` +
              `moved from ${actor}'s pantry, paid by ${actor}`,
            payload: {
              itemId: toPublicId("itm", item.id),
              moveId: toPublicId("mov", moveId),
              name: item.name,
              qtyMilli: item.qtyLeftMilli,
              displayUnit: item.displayUnit,
              priceMinor: item.priceMinor,
              currency: item.currency,
              paidBy: actor,
            },
          }),
        }),
      );
      if (result.ok) {
        if (result.value.replayed && (result.value.move.kind !== "transfer" || result.value.move.actor !== actor)) {
          return idempotencyKeyReused(ctx.requestId);
        }
        return respond(result.value);
      }
      if (result.error.kind === "stale" && attempt === 0) continue;
      return stockErrorResponse(ctx.requestId, result.error);
    }
  });
}

export async function handleMyItemMoves(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const fields = new Fields();
  const limit = limitParam(fields, new URL(request.url), DEFAULT_MOVES_LIMIT, MAX_MOVES_LIMIT);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getItem(owner(ctx), itemId));
    if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
    const moves = await ctx.timings.measure("db", () => repo.listMoves(owner(ctx), itemId, limit));
    if (!moves.ok) return unavailable(ctx.requestId);
    return successResponse<MovesResponse>({ moves: moves.value.map((m) => toStockMove(m, found.value)) }, ctx.requestId);
  });
}

export async function handleUndoMyMove(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const moveId = parsePublicId("mov", params[0]!);
  if (!moveId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;

  return withKitchenRepo(ctx, async (repo) => {
    // The move is read through the caller's own pantry: that is the check.
    const result = await undoMove(ctx, repo, {
      owner: owner(ctx),
      moveId,
      idemKey: idem.key,
      authorize: () => Promise.resolve(null),
    });
    return result instanceof Response ? result : moved(ctx, repo, result);
  });
}

const DAY_MS = 86_400_000;

export async function handleUsuals(ctx: RequestContext, request: Request): Promise<Response> {
  const fields = new Fields();
  const limit = limitParam(fields, new URL(request.url), DEFAULT_USUALS_LIMIT, MAX_USUALS_LIMIT);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  // Only what the caller may still use: their own pantry, and groups where
  // their role holds kitchen.item.use.
  const usable = new Map(groups.filter(canUseIn).map((g) => [g.orgId as string, g]));

  return withKitchenRepo(ctx, async (repo: KitchenRepository) => {
    const actor = ctx.actor.subjectId;
    const found = await ctx.timings.measure("db", () =>
      repo.usuals({
        subjectId: actor,
        ownerSubjectId: actor,
        orgIds: [...usable.keys()],
        since: new Date(ctx.now().getTime() - USUALS_DAYS * DAY_MS),
        limit,
      }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    // Every usual's measures (SM-13), in one more statement.
    const measures = await readMeasures(ctx, repo, found.value.map((u) => u.item));
    if (!measures) return unavailable(ctx.requestId);
    const usuals: KitchenUsual[] = [];
    for (const usual of found.value) {
      const { item } = usual;
      const group = item.orgId ? usable.get(item.orgId) : undefined;
      if (item.orgId && !group) continue; // Not reachable: the scope only reads usable groups.
      const lastUnit = usual.lastUnit && isUnit(usual.lastUnit) ? usual.lastUnit : item.displayUnit;
      usuals.push({
        itemId: toPublicId("itm", item.id),
        name: item.name,
        pantry: group ? groupPantryRef(group) : personalPantryRef(),
        lastQtyMilli: usual.lastQtyMilli,
        lastQuantity: displayQuantity(usual.lastQtyMilli, lastUnit),
        lastUnit,
        lastLabel: usual.lastLabel,
        consumers: usual.lastConsumers ?? [actor],
        usedCount: usual.usedCount,
        lastUsedAt: usual.lastUsedAt.toISOString(),
        qtyLeftMilli: item.qtyLeftMilli,
        measures: measures(item),
      });
    }
    return successResponse<UsualsResponse>({ usuals }, ctx.requestId);
  });
}
