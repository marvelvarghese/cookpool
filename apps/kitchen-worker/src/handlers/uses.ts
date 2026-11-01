import {
  KITCHEN_ERROR_REASONS,
  type MovesResponse,
  type StockMoveResponse,
} from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import type { KitchenGroupSettings, KitchenPantryOwner, KitchenSplit, StockMoved } from "@saas/db/kitchen";
import { buildUse, buildWaste, type Split } from "@saas/kitchen-engine/ledger";
import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import { formatQuantity } from "@saas/kitchen-engine/units";
import { groupAllows, requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import type { MemberGroup } from "../groups-client.js";
import {
  forbidden,
  notFound,
  readJsonObject,
  successResponse,
  unavailable,
  unprocessable,
  validationError,
} from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { ledgerAudit, toKitchenTxn } from "../ledger.js";
import {
  groupPantryRef,
  isoDay,
  itemErrorResponse,
  limitParam,
  toKitchenItem,
  wastePolicyOf,
} from "../pantry.js";
import { notInGroup } from "../roster-client.js";
import {
  DEFAULT_MOVES_LIMIT,
  MAX_MOVES_LIMIT,
  insufficientStock,
  parseUse,
  parseWaste,
  quantityOf,
  takeStock,
  toStockMove,
  undoMove,
} from "../stock.js";
import { Fields } from "../validate.js";
import { thisGroup } from "./group-items.js";

// Using a group's items, /v1/organizations/{org}/kitchen/…
//
//   POST …/items/{itm}/uses     kitchen.item.use      (members, owners, admins — not viewers)
//   POST …/items/{itm}/waste    kitchen.item.use
//   GET  …/items/{itm}/moves    kitchen.pantry.read   (every member)
//   POST …/moves/{mov}/undo     kitchen.item.use, and its logger — or kitchen.txn.reverse_any
//
// A use pays the buyer back: the people who had it owe the cost, equally or
// by weight, in one `use` transaction written in the same batch as the move
// and the item's update. A buyer who had some nets their own share to zero,
// and when every consumer is the buyer nobody owes anyone: the move is
// recorded and no transaction posted. Waste follows the item's own rule, else
// the group's: split equally posts a `waste` transaction in which every
// current member owes an equal share of what the wasted part was worth;
// buyer absorbs records the move only. A move with a transaction is undone by
// reversing it (…/txns/{txn}/reverse puts the stock back); …/moves/{mov}/undo
// puts back a move that moved no money.

function owner(ctx: OrgContext): KitchenPantryOwner {
  return { kind: "group", orgId: ctx.orgId };
}

/** Does anyone in these splits owe or get money back? A buyer's own share nets to zero. */
function movesMoney(splits: readonly Split[]): boolean {
  return splits.some((s) => s.paidMinor !== s.owedMinor);
}

function toSplits(splits: readonly Split[]): KitchenSplit[] {
  return splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor }));
}

/** 201 with the item as it is now (in this group's pantry), the move and its transaction. */
function moved(
  ctx: OrgContext,
  group: MemberGroup,
  settings: KitchenGroupSettings | null,
  result: StockMoved,
): Response {
  return successResponse<StockMoveResponse>(
    {
      item: toKitchenItem(result.item, groupPantryRef(group), wastePolicyOf(settings), isoDay(ctx.now())),
      move: toStockMove(result.move, result.item),
      txn: result.txn ? toKitchenTxn(result.txn) : null,
    },
    ctx.requestId,
    201,
  );
}

export async function handleUseGroupItem(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.item.use");
  if (denied) return denied;
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseUse(body, { group: true });
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const use = parsed.value;

  // Anyone may log for others (design.md §3), but only for people in the group.
  const actor = ctx.actor.subjectId;
  const consumers = use.consumers ?? [actor];
  if (consumers.some((c) => c !== actor)) {
    const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
    if (!roster.ok) return unavailable(ctx.requestId);
    const outsiders = notInGroup(roster.members, consumers);
    if (outsiders.length > 0) {
      return unprocessable(ctx.requestId, "Everyone who had it must be in the group", KITCHEN_ERROR_REASONS.NOT_IN_GROUP, {
        subjectIds: outsiders,
      });
    }
  }
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(ctx.orgId));
    if (!settings.ok) return unavailable(ctx.requestId);

    const result = await takeStock(ctx, repo, { owner: owner(ctx), itemId, kind: "use", idemKey: idem.key }, async (item) => {
      const qty = quantityOf(item, use.quantity, use.unit);
      if (!qty.ok) return validationError(ctx.requestId, qty.fields);
      if (qty.value.qtyMilli > item.qtyLeftMilli) return insufficientStock(ctx.requestId, item.qtyLeftMilli);

      const costMinor = costOfUse(item, qty.value.qtyMilli);
      const splits = buildUse({
        costMinor,
        buyerId: item.paidBy,
        consumers,
        ...(use.weights ? { weights: use.weights } : {}),
      });
      const moveId = asUuid(crypto.randomUUID());
      const txnId = asUuid(crypto.randomUUID());
      const now = ctx.now();
      const what = formatQuantity(qty.value.qtyMilli, item.dimension, qty.value.unit);
      const posts = movesMoney(splits);
      return {
        owner: owner(ctx),
        itemId,
        expectedVersion: item.version,
        move: {
          id: moveId,
          kind: "use",
          qtyMilli: qty.value.qtyMilli,
          costMinor,
          unit: qty.value.unit,
          consumers,
          actor,
          idemKey: idem.key,
          now,
        },
        txn: posts
          ? {
              txn: {
                id: txnId,
                orgId: ctx.orgId,
                kind: "use",
                title: `${item.name} (${what})`,
                totalMinor: costMinor,
                currency: item.currency,
                occurredAt: now,
                createdBy: actor,
                sourceKind: "item",
                sourceId: item.id,
                idemKey: idem.key,
                now,
              },
              splits: toSplits(splits),
            }
          : null,
        audit: ledgerAudit(ctx, {
          type: "kitchen.item.used",
          subjectKind: "kitchen_item",
          subjectId: item.id,
          idemKey: idem.key,
          description:
            `Use ${toPublicId("mov", moveId)} of item ${toPublicId("itm", item.id)} "${item.name}": ${what} ` +
            `for ${consumers.join(", ")}, ${formatMinor(costMinor, item.currency)} back to ${item.paidBy}`,
          payload: {
            itemId: toPublicId("itm", item.id),
            moveId: toPublicId("mov", moveId),
            txnId: posts ? toPublicId("txn", txnId) : null,
            qtyMilli: qty.value.qtyMilli,
            unit: qty.value.unit,
            costMinor,
            currency: item.currency,
            paidBy: item.paidBy,
            consumers,
          },
        }),
      };
    });
    if (result instanceof Response) return result;
    return moved(ctx, here.group, settings.value, result);
  });
}

export async function handleWasteGroupItem(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.item.use");
  if (denied) return denied;
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request, { optional: true });
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object, or empty"] });
  const parsed = parseWaste(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const waste = parsed.value;
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(ctx.orgId));
    if (!settings.ok) return unavailable(ctx.requestId);
    const actor = ctx.actor.subjectId;

    const result = await takeStock(ctx, repo, { owner: owner(ctx), itemId, kind: "waste", idemKey: idem.key }, async (item) => {
      let qtyMilli = item.qtyLeftMilli;
      let unit = item.displayUnit;
      if (waste.quantity !== null) {
        const qty = quantityOf(item, waste.quantity, waste.unit);
        if (!qty.ok) return validationError(ctx.requestId, qty.fields);
        ({ qtyMilli, unit } = qty.value);
      }
      if (qtyMilli === 0 || qtyMilli > item.qtyLeftMilli) return insufficientStock(ctx.requestId, item.qtyLeftMilli);

      // What the wasted part was worth: the buyer absorbs it, or every
      // current member shares it equally.
      const costMinor = costOfUse(item, qtyMilli);
      const policy = item.wastePolicy ?? wastePolicyOf(settings.value);
      let splits: Split[] = [];
      if (policy === "split_equally" && costMinor > 0) {
        const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
        if (!roster.ok) return unavailable(ctx.requestId);
        splits = buildWaste({ unusedMinor: costMinor, buyerId: item.paidBy, members: roster.members.map((m) => m.subjectId) });
      }
      const moveId = asUuid(crypto.randomUUID());
      const txnId = asUuid(crypto.randomUUID());
      const now = ctx.now();
      const what = formatQuantity(qtyMilli, item.dimension, unit);
      const posts = movesMoney(splits);
      return {
        owner: owner(ctx),
        itemId,
        expectedVersion: item.version,
        move: { id: moveId, kind: "waste", qtyMilli, costMinor, unit, consumers: null, actor, idemKey: idem.key, now },
        txn: posts
          ? {
              txn: {
                id: txnId,
                orgId: ctx.orgId,
                kind: "waste",
                title: `Wasted: ${item.name} (${what})`,
                totalMinor: costMinor,
                currency: item.currency,
                occurredAt: now,
                createdBy: actor,
                sourceKind: "item",
                sourceId: item.id,
                idemKey: idem.key,
                now,
              },
              splits: toSplits(splits),
            }
          : null,
        audit: ledgerAudit(ctx, {
          type: "kitchen.item.wasted",
          subjectKind: "kitchen_item",
          subjectId: item.id,
          idemKey: idem.key,
          description:
            `Waste ${toPublicId("mov", moveId)} of item ${toPublicId("itm", item.id)} "${item.name}": ${what} worth ` +
            `${formatMinor(costMinor, item.currency)}, ${posts ? "split equally" : `absorbed by ${item.paidBy}`}`,
          payload: {
            itemId: toPublicId("itm", item.id),
            moveId: toPublicId("mov", moveId),
            txnId: posts ? toPublicId("txn", txnId) : null,
            qtyMilli,
            unit,
            costMinor,
            currency: item.currency,
            paidBy: item.paidBy,
            wastePolicy: policy,
          },
        }),
      };
    });
    if (result instanceof Response) return result;
    return moved(ctx, here.group, settings.value, result);
  });
}

export async function handleGroupItemMoves(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
  if (denied) return denied;
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

export async function handleUndoGroupMove(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.item.use");
  if (denied) return denied;
  const moveId = parsePublicId("mov", params[0]!);
  if (!moveId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(ctx.orgId));
    if (!settings.ok) return unavailable(ctx.requestId);
    const actor = ctx.actor.subjectId;

    const result = await undoMove(ctx, repo, {
      owner: owner(ctx),
      moveId,
      idemKey: idem.key,
      async authorize(move) {
        if (move.actor === actor || (await groupAllows(ctx, "kitchen.txn.reverse_any"))) return null;
        return forbidden(
          ctx.requestId,
          "Only whoever logged it, or an owner or admin, can undo it",
          KITCHEN_ERROR_REASONS.NOT_CREATOR,
        );
      },
      audit: (move, item, reversalId) =>
        ledgerAudit(ctx, {
          type: "kitchen.move.undone",
          subjectKind: "kitchen_item",
          subjectId: item.id,
          idemKey: idem.key,
          description: `Undo ${toPublicId("mov", reversalId)} of ${move.kind} ${toPublicId("mov", move.id)} on item ${toPublicId("itm", item.id)} "${item.name}"`,
          payload: {
            itemId: toPublicId("itm", item.id),
            moveId: toPublicId("mov", reversalId),
            reverses: toPublicId("mov", move.id),
            kind: move.kind,
            qtyMilli: move.qtyMilli,
            costMinor: move.costMinor,
          },
        }),
    });
    if (result instanceof Response) return result;
    return moved(ctx, here.group, settings.value, result);
  });
}
