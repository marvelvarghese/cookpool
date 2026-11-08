import {
  KITCHEN_ERROR_REASONS,
  type MovesResponse,
  type StockMoveResponse,
} from "@saas/contracts/kitchen";
import { asUuid, type Uuid } from "@saas/db/ids";
import type {
  KitchenGroupSettings,
  KitchenItemRecord,
  KitchenPantryOwner,
  KitchenRepository,
  KitchenSplit,
  KitchenStockMoveVia,
  StockMoved,
  TakeStockInput,
} from "@saas/db/kitchen";
import { buildUse, buildWaste, type Split } from "@saas/kitchen-engine/ledger";
import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import { formatQuantity } from "@saas/kitchen-engine/units";
import { groupAllows, requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { emailLoggedForYou } from "../emails.js";
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
import { readMeasures, type MeasureBook } from "../measures.js";
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
  useAmount,
} from "../stock.js";
import { Fields } from "../validate.js";
import { askFirstRefusal, itemAskFields, readAskRules } from "../asks.js";
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
//
// An ask-first item (PN-8) refuses the use and waste routes, 403 `ask_first`,
// to anyone who must ask (./asks.ts); its answerer may undo the use an
// approval posted, as its logger may.

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

/**
 * The item as it is now (in this group's pantry, with its measures — `known`
 * when the write read them already, else read here — and, when it asks
 * first, its rule for the caller, PN-8), the move and its transaction. Null
 * on a failed read.
 */
export async function movedData(
  ctx: OrgContext,
  repo: KitchenRepository,
  group: MemberGroup,
  settings: KitchenGroupSettings | null,
  result: StockMoved,
  known: MeasureBook | null = null,
): Promise<StockMoveResponse | null> {
  const [measures, rules] = await Promise.all([
    known ?? readMeasures(ctx, repo, [result.item]),
    readAskRules(ctx, repo, [result.item]),
  ]);
  if (!measures || !rules) return null;
  const ask = itemAskFields(result.item, rules(result.item), ctx.actor.subjectId, group.role);
  return {
    item: toKitchenItem(result.item, groupPantryRef(group), wastePolicyOf(settings), isoDay(ctx.now()), measures(result.item), ask),
    move: toStockMove(result.move, result.item),
    txn: result.txn ? toKitchenTxn(result.txn) : null,
  };
}

/** 201 with movedData: the stock routes', the stock check's (PN-4) and an approval's (PN-8) answer. */
export async function moved(
  ctx: OrgContext,
  repo: KitchenRepository,
  group: MemberGroup,
  settings: KitchenGroupSettings | null,
  result: StockMoved,
  known: MeasureBook | null = null,
): Promise<Response> {
  const data = await movedData(ctx, repo, group, settings, result, known);
  return data ? successResponse<StockMoveResponse>(data, ctx.requestId, 201) : unavailable(ctx.requestId);
}

/** A use to write, from the item as just read: how much, in which unit and words, and who had it. */
export interface GroupUse {
  qtyMilli: number;
  unit: string;
  /** "2 onions" for a use in a measure (SM-13); null for one in a unit. */
  label: string | null;
  consumers: readonly string[];
  /** Absent or null: equal shares. */
  weights?: readonly number[] | null;
  idemKey: string;
  /** `check` when a stock check writes it (PN-4); absent when it is logged directly. */
  via?: KitchenStockMoveVia | null;
}

/** " · stock check" on what a check writes, so the group's Activity says why it was charged (PN-4). */
function viaNote(via: KitchenStockMoveVia | null | undefined): string {
  return via === "check" ? " · stock check" : "";
}

/**
 * The write a use of a group item makes (CP-11): the move, and the `use`
 * transaction paying the buyer back — the consumers owe its cost, equally
 * or by weight — unless it moves no money (every consumer is the buyer).
 * …/uses and the stock check's `me` and `split` (PN-4) write it.
 */
export function planGroupUse(ctx: OrgContext, item: KitchenItemRecord, use: GroupUse): TakeStockInput {
  const actor = ctx.actor.subjectId;
  const { qtyMilli, unit, label, consumers, idemKey } = use;
  const via = use.via ?? null;
  // A measure only decides how much is taken: what that costs is the
  // engine's proportional cost, as for any use.
  const costMinor = costOfUse(item, qtyMilli);
  const splits = buildUse({
    costMinor,
    buyerId: item.paidBy,
    consumers,
    ...(use.weights ? { weights: use.weights } : {}),
  });
  const moveId = asUuid(crypto.randomUUID());
  const txnId = asUuid(crypto.randomUUID());
  const now = ctx.now();
  // In the words it was given in: "2 onions", else "250 ml".
  const what = label ?? formatQuantity(qtyMilli, item.dimension, unit);
  const posts = movesMoney(splits);
  return {
    owner: owner(ctx),
    itemId: item.id as Uuid,
    expectedVersion: item.version,
    move: { id: moveId, kind: "use", qtyMilli, costMinor, unit, label, consumers, actor, idemKey, now, via },
    txn: posts
      ? {
          txn: {
            id: txnId,
            orgId: ctx.orgId,
            kind: "use",
            title: `${item.name} (${what})${viaNote(via)}`,
            totalMinor: costMinor,
            currency: item.currency,
            occurredAt: now,
            createdBy: actor,
            sourceKind: "item",
            sourceId: item.id,
            idemKey,
            now,
          },
          splits: toSplits(splits),
        }
      : null,
    audit: ledgerAudit(ctx, {
      type: "kitchen.item.used",
      subjectKind: "kitchen_item",
      subjectId: item.id,
      idemKey,
      description:
        `Use ${toPublicId("mov", moveId)} of item ${toPublicId("itm", item.id)} "${item.name}": ${what} ` +
        `for ${consumers.join(", ")}, ${formatMinor(costMinor, item.currency)} back to ${item.paidBy}${viaNote(via)}`,
      payload: {
        itemId: toPublicId("itm", item.id),
        moveId: toPublicId("mov", moveId),
        txnId: posts ? toPublicId("txn", txnId) : null,
        qtyMilli,
        unit,
        label,
        costMinor,
        currency: item.currency,
        paidBy: item.paidBy,
        consumers,
        ...(via ? { via } : {}),
      },
    }),
  };
}

/**
 * Did `actor` approve the ask whose use this is (PN-8)? The use is the
 * asker's, so its answerer may undo it too, as its logger may. False on a
 * failed read.
 */
export async function approvedBy(
  ctx: OrgContext,
  repo: KitchenRepository,
  of: { itemId: string; moveId?: string; txnId?: string; via?: KitchenStockMoveVia | null },
  actor: string,
): Promise<boolean> {
  if (of.via !== undefined && of.via !== "ask") return false;
  const found = await ctx.timings.measure("db", () =>
    repo.findApproval({ itemId: of.itemId, ...(of.moveId ? { moveId: of.moveId } : {}), ...(of.txnId ? { txnId: of.txnId } : {}) }),
  );
  return found.ok && found.value !== null && found.value.answeredBy === actor;
}

/** Waste to write, from the item as just read. */
export interface GroupWaste {
  qtyMilli: number;
  unit: string;
  idemKey: string;
  /** `check` when a stock check writes it (PN-4); absent when it is logged directly. */
  via?: KitchenStockMoveVia | null;
}

/**
 * The write wasting some of a group item makes (CP-11), under its own rule,
 * else the group's: split equally posts a `waste` transaction every current
 * member shares; buyer absorbs records the move only. Nothing (or more than
 * is left) is 409 `insufficient_stock`. …/waste and the stock check's
 * `waste` (PN-4) write it.
 */
export async function planGroupWaste(
  ctx: OrgContext,
  item: KitchenItemRecord,
  waste: GroupWaste,
  settings: KitchenGroupSettings | null,
): Promise<TakeStockInput | Response> {
  const actor = ctx.actor.subjectId;
  const { qtyMilli, unit, idemKey } = waste;
  const via = waste.via ?? null;
  if (qtyMilli === 0 || qtyMilli > item.qtyLeftMilli) return insufficientStock(ctx.requestId, item.qtyLeftMilli);

  // What the wasted part was worth: the buyer absorbs it, or every
  // current member shares it equally.
  const costMinor = costOfUse(item, qtyMilli);
  const policy = item.wastePolicy ?? wastePolicyOf(settings);
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
    itemId: item.id as Uuid,
    expectedVersion: item.version,
    move: { id: moveId, kind: "waste", qtyMilli, costMinor, unit, consumers: null, actor, idemKey, now, via },
    txn: posts
      ? {
          txn: {
            id: txnId,
            orgId: ctx.orgId,
            kind: "waste",
            title: `Wasted: ${item.name} (${what})${viaNote(via)}`,
            totalMinor: costMinor,
            currency: item.currency,
            occurredAt: now,
            createdBy: actor,
            sourceKind: "item",
            sourceId: item.id,
            idemKey,
            now,
          },
          splits: toSplits(splits),
        }
      : null,
    audit: ledgerAudit(ctx, {
      type: "kitchen.item.wasted",
      subjectKind: "kitchen_item",
      subjectId: item.id,
      idemKey,
      description:
        `Waste ${toPublicId("mov", moveId)} of item ${toPublicId("itm", item.id)} "${item.name}": ${what} worth ` +
        `${formatMinor(costMinor, item.currency)}, ${posts ? "split equally" : `absorbed by ${item.paidBy}`}${viaNote(via)}`,
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
        ...(via ? { via } : {}),
      },
    }),
  };
}

/**
 * Committed: tell the people a use was logged for (CP-18). A use that moved
 * no money (everyone who had it bought it) has no transaction and no email,
 * and neither has waste.
 */
export async function emailUse(ctx: OrgContext, result: StockMoved, group: MemberGroup): Promise<void> {
  const txn = result.txn;
  if (!txn || result.move.kind !== "use") return;
  await ctx.defer(() => emailLoggedForYou(ctx, { kind: "use", txn, item: result.item, move: result.move }, group));
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

    // A use in a measure (SM-13) reads the item's measures to know how much it
    // takes; the answer then shows the same ones.
    let measures: MeasureBook | null = null;
    const result = await takeStock(ctx, repo, { owner: owner(ctx), itemId, kind: "use", idemKey: idem.key }, async (item) => {
      // Someone who must ask first (PN-8) asks instead.
      const refused = await askFirstRefusal(ctx, repo, item);
      if (refused) return refused;
      const qty = await useAmount(ctx.requestId, item, use, async () => (measures = await readMeasures(ctx, repo, [item])));
      if (qty instanceof Response) return qty;
      return planGroupUse(ctx, item, { ...qty, consumers, weights: use.weights, idemKey: idem.key });
    });
    if (result instanceof Response) return result;
    await emailUse(ctx, result, here.group);
    return moved(ctx, repo, here.group, settings.value, result, measures);
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

    const result = await takeStock(ctx, repo, { owner: owner(ctx), itemId, kind: "waste", idemKey: idem.key }, async (item) => {
      const refused = await askFirstRefusal(ctx, repo, item);
      if (refused) return refused;
      let qtyMilli = item.qtyLeftMilli;
      let unit = item.displayUnit;
      if (waste.quantity !== null) {
        const qty = quantityOf(item, waste.quantity, waste.unit);
        if (!qty.ok) return validationError(ctx.requestId, qty.fields);
        ({ qtyMilli, unit } = qty.value);
      }
      return planGroupWaste(ctx, item, { qtyMilli, unit, idemKey: idem.key }, settings.value);
    });
    if (result instanceof Response) return result;
    return moved(ctx, repo, here.group, settings.value, result);
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
        if (move.actor === actor || (await approvedBy(ctx, repo, { itemId: move.itemId, moveId: move.id, via: move.via }, actor)) || (await groupAllows(ctx, "kitchen.txn.reverse_any"))) return null;
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
    return moved(ctx, repo, here.group, settings.value, result);
  });
}
