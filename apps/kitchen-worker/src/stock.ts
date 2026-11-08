// What every stock handler shares (CP-11): the public shape of a move, the
// request bodies of a use and of waste, a quantity in the item's dimension,
// taking stock with one retry when the item moved on, undoing a move, and how
// a refused stock write becomes a response. The stock check (PN-4,
// ./handlers/stock-check.ts) writes through the same takeStock and undoMove.

import { KITCHEN_ERROR_REASONS, type KitchenStockMove } from "@saas/contracts/kitchen";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import { asUuid, type Uuid } from "@saas/db/ids";
import type {
  AdjustStockInput,
  KitchenItemRecord,
  KitchenPantryOwner,
  KitchenRepository,
  KitchenRepositoryError,
  KitchenStockMoveRecord,
  StockMoved,
  TakeStockInput,
} from "@saas/db/kitchen";
import { UNITS, UnitError, isUnit, toMilli, type UnitKey } from "@saas/kitchen-engine/units";
import type { RequestContext } from "./context.js";
import { conflict, unavailable, unprocessable, validationError } from "./http.js";
import { toPublicId } from "./ids.js";
import { idempotencyKeyReused } from "./ledger.js";
import { MEASURE_QUANTITY_MESSAGE, measureQuantity, measureWord, takeInMeasure, type MeasureBook } from "./measures.js";
import { displayQuantity, itemErrorResponse } from "./pantry.js";
import { Fields, decimals, subjectId, type FieldErrors } from "./validate.js";

/** More people than a group can hold (50) is a malformed request, not a big meal. */
export const MAX_CONSUMERS = 100;

export const DEFAULT_MOVES_LIMIT = 50;
export const MAX_MOVES_LIMIT = 200;
export const DEFAULT_USUALS_LIMIT = 10;
/** Room for a usual on every row of a big pantry (PN-2; it was 50). */
export const MAX_USUALS_LIMIT = 100;

/** The kinds of move an undo can put back directly: everything else is not_reversible. An adjust is a stock check's (PN-4). */
const UNDOABLE: ReadonlySet<string> = new Set(["use", "waste", "adjust"]);

// ── Public shapes ──────────────────────────────────────────

/** The unit a move is shown in: the one it was logged in, else the item's. */
function moveUnit(record: KitchenStockMoveRecord, item: KitchenItemRecord): string {
  return record.unit && isUnit(record.unit) ? record.unit : item.displayUnit;
}

export function toStockMove(record: KitchenStockMoveRecord, item: KitchenItemRecord): KitchenStockMove {
  const unit = moveUnit(record, item);
  return {
    id: toPublicId("mov", record.id),
    itemId: toPublicId("itm", record.itemId),
    kind: record.kind,
    qtyMilli: record.qtyMilli,
    quantity: displayQuantity(record.qtyMilli, unit),
    unit,
    label: record.label,
    costMinor: record.costMinor,
    actor: record.actor,
    consumers: record.consumers,
    txnId: record.txnId ? toPublicId("txn", record.txnId) : null,
    reverses: record.reverses ? toPublicId("mov", record.reverses) : null,
    at: record.createdAt.toISOString(),
    undone: record.undoneBy !== null,
    undoneBy: record.undoneBy ? toPublicId("mov", record.undoneBy) : null,
    // Only on a move a stock check (PN-4) or an approved ask (PN-8) wrote.
    ...(record.via ? { via: record.via } : {}),
  };
}

// ── Request bodies ─────────────────────────────────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

export interface ParsedTake {
  /** Absent: everything left (waste only). */
  quantity: string | number | null;
  /** Absent: the item's own unit. */
  unit: UnitKey | null;
}

export interface ParsedUse extends ParsedTake {
  quantity: string | number;
  /**
   * One of the item's measures instead of a unit (SM-13): its word, and
   * `quantity` read as a count of it (halves allowed). Null: a unit.
   */
  measure: { word: string; quantity: number } | null;
  /** Absent: the caller had it. */
  consumers: string[] | null;
  /** Absent: equal shares. One positive weight per consumer. */
  weights: number[] | null;
}

function takeFields(fields: Fields, body: Record<string, unknown>, quantityRequired: boolean): ParsedTake {
  let quantity: string | number | null = null;
  if (body.quantity === undefined || body.quantity === null) {
    if (quantityRequired) fields.add("quantity", "Required");
  } else if (typeof body.quantity === "string" || typeof body.quantity === "number") {
    quantity = body.quantity;
  } else {
    fields.add("quantity", 'Must be a decimal such as "0.25"');
  }
  let unit: UnitKey | null = null;
  if (body.unit !== undefined && body.unit !== null) {
    if (isUnit(body.unit)) unit = body.unit;
    else fields.add("unit", `Must be one of: ${Object.keys(UNITS).join(", ")}`);
  }
  return { quantity, unit };
}

/**
 * `measure` (SM-13), beside a `quantity` and `unit` already read: the word,
 * and the quantity as a count of it. Not with a unit; `field` names it in the
 * errors (`measure`, `ingredients[2].measure`).
 */
export function measureField(
  fields: Fields,
  field: string,
  raw: { measure: unknown; quantity: string | number | null | undefined; unit: unknown },
  quantityField: string,
): { word: string; quantity: number } | null {
  if (raw.measure === undefined || raw.measure === null) return null;
  const word = measureWord(fields, field, raw.measure);
  if (raw.unit !== undefined && raw.unit !== null) {
    fields.add(field, "Send unit or measure, not both");
    return null;
  }
  if (word === undefined || raw.quantity === null || raw.quantity === undefined) return null;
  const quantity = measureQuantity(raw.quantity);
  if (quantity === null) {
    fields.add(quantityField, MEASURE_QUANTITY_MESSAGE);
    return null;
  }
  return { word, quantity };
}

/** A POST …/uses body: `quantity`, `unit` or `measure`, and for a group item `consumers` and `weights`. */
export function parseUse(body: Record<string, unknown>, options: { group: boolean }): Parsed<ParsedUse> {
  const fields = new Fields();
  const { quantity, unit } = takeFields(fields, body, true);
  const measure = measureField(fields, "measure", { measure: body.measure, quantity, unit: body.unit }, "quantity");
  let consumers: string[] | null = null;
  let weights: number[] | null = null;
  if (options.group && body.consumers !== undefined) {
    if (!Array.isArray(body.consumers) || body.consumers.length === 0 || body.consumers.length > MAX_CONSUMERS) {
      fields.add("consumers", `List who had it: 1 to ${MAX_CONSUMERS} people`);
    } else {
      const named = body.consumers.map((c: unknown, i) => subjectId(fields, `consumers[${i}]`, c));
      if (named.every((c): c is string => c !== undefined)) {
        if (new Set(named).size !== named.length) fields.add("consumers", "Name each person once");
        else consumers = named;
      }
    }
  }
  if (options.group && body.weights !== undefined) {
    const count = Array.isArray(body.consumers) ? body.consumers.length : 1;
    if (!Array.isArray(body.weights) || body.weights.length !== count) {
      fields.add("weights", "Give one weight per person in consumers");
    } else {
      const valid = body.weights.every(
        (w: unknown) => typeof w === "number" && Number.isFinite(w) && w > 0 && w <= 1_000_000 && decimals(w) <= 6,
      );
      if (valid) weights = body.weights as number[];
      else fields.add("weights", "Each weight must be a number above zero");
    }
  }
  if (!fields.ok || quantity === null) return { ok: false, fields: fields.errors };
  return { ok: true, value: { quantity, unit, measure, consumers, weights } };
}

/** A POST …/waste body: an optional `quantity` (default: everything left) and `unit`. */
export function parseWaste(body: Record<string, unknown>): Parsed<ParsedTake> {
  const fields = new Fields();
  const take = takeFields(fields, body, false);
  if (take.quantity === null && take.unit !== null) fields.add("unit", "Send unit with quantity");
  return fields.ok ? { ok: true, value: take } : { ok: false, fields: fields.errors };
}

/** The units that measure what `item` measures. */
function unitsOf(item: KitchenItemRecord): string[] {
  return Object.entries(UNITS)
    .filter(([, def]) => def.dimension === item.dimension)
    .map(([key]) => key);
}

/**
 * A quantity of `item` in thousandths of its base unit: `unit` (the item's own
 * when null) must measure what the item measures — there is no conversion
 * across dimensions.
 */
export function quantityOf(
  item: KitchenItemRecord,
  quantity: string | number,
  unit: UnitKey | null,
): Parsed<{ qtyMilli: number; unit: string }> {
  const chosen = unit ?? item.displayUnit;
  if (!isUnit(chosen) || UNITS[chosen].dimension !== item.dimension) {
    return { ok: false, fields: { unit: [`Must measure what the item does (${item.dimension}): one of ${unitsOf(item).join(", ")}`] } };
  }
  try {
    return { ok: true, value: { qtyMilli: toMilli(quantity, chosen), unit: chosen } };
  } catch (err) {
    if (err instanceof UnitError) return { ok: false, fields: { quantity: ['Must be a quantity above zero, such as "0.25"'] } };
    throw err;
  }
}

// ── Outcomes ───────────────────────────────────────────────

/** 409: not that much is left. Nothing was written. */
export function insufficientStock(requestId: string, qtyLeftMilli: number): Response {
  return conflict(requestId, "Not that much of this item is left", KITCHEN_ERROR_REASONS.INSUFFICIENT_STOCK, { qtyLeftMilli });
}

/** What a use takes, in the item's base unit: the unit it is shown in, and its words when it was given in a measure. */
export interface UseAmount {
  qtyMilli: number;
  unit: string;
  /** "2 onions" for a use in a measure (SM-13); null for one in a unit. */
  label: string | null;
}

/**
 * What a use takes from `item`, or the refusal: a unit that does not measure
 * what the item does or a measure its name does not have (422), more than is
 * left (409 `insufficient_stock`). A use in a measure reads the item's
 * measures (`measures`, called only then) and is shown in the item's own
 * unit, with its words beside it.
 */
export async function useAmount(
  requestId: string,
  item: KitchenItemRecord,
  use: Pick<ParsedUse, "quantity" | "unit" | "measure">,
  measures: () => Promise<MeasureBook | null>,
): Promise<UseAmount | Response> {
  if (use.measure) {
    const book = await measures();
    if (!book) return unavailable(requestId);
    const taken = takeInMeasure(item, book(item), use.measure);
    if (taken.kind === "unknown") return validationError(requestId, taken.fields);
    if (taken.kind === "short") return insufficientStock(requestId, item.qtyLeftMilli);
    return { qtyMilli: taken.qtyMilli, unit: item.displayUnit, label: taken.label };
  }
  const qty = quantityOf(item, use.quantity, use.unit);
  if (!qty.ok) return validationError(requestId, qty.fields);
  if (qty.value.qtyMilli > item.qtyLeftMilli) return insufficientStock(requestId, item.qtyLeftMilli);
  return { ...qty.value, label: null };
}

/** The response to a refused stock write. */
export function stockErrorResponse(requestId: string, error: KitchenRepositoryError): Response {
  switch (error.kind) {
    case "insufficient_stock":
      return insufficientStock(requestId, error.qtyLeftMilli);
    case "stale":
      return conflict(
        requestId,
        "This item kept changing while the change was written; read it again and retry",
        KITCHEN_ERROR_REASONS.STALE,
      );
    case "already_undone":
      return conflict(requestId, "This has already been undone", KITCHEN_ERROR_REASONS.ALREADY_REVERSED, {
        undoneBy: toPublicId("mov", error.undoneBy),
      });
    case "not_reversible":
      return conflict(requestId, "This cannot be undone", KITCHEN_ERROR_REASONS.NOT_REVERSIBLE);
    case "conflict":
      return idempotencyKeyReused(requestId);
    case "currency_mismatch":
      return unprocessable(requestId, `The group counts in ${error.currency}`, KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH, {
        currency: error.currency,
      });
    default:
      return itemErrorResponse(requestId, error);
  }
}

/**
 * What a stock write is: a use or waste logged directly, or a stock check
 * (PN-4), whose move may be a use, waste or adjust but always says `via: check`.
 */
export type StockRequestKind = "use" | "waste" | "check";

/** A replayed move answers the same request only if it is the same kind of move by the same person. */
function sameRequest(move: KitchenStockMoveRecord, kind: StockRequestKind, actor: string): boolean {
  if (move.actor !== actor) return false;
  return kind === "check" ? move.via === "check" : move.kind === kind && move.via === null;
}

/** A write `takeStock` plans: take some (a use or waste), or raise what is left (a check's adjust). */
export type StockWrite = TakeStockInput | AdjustStockInput;

function isAdjust(input: StockWrite): input is AdjustStockInput {
  return input.move.kind === "adjust";
}

/** The move a key already made on the item, with the item and its transaction as they are now. */
async function replayed(
  ctx: RequestContext,
  repo: KitchenRepository,
  owner: KitchenPantryOwner,
  move: KitchenStockMoveRecord,
): Promise<StockMoved | Response> {
  const item = await ctx.timings.measure("db", () => repo.getItem(owner, move.itemId as Uuid));
  if (!item.ok) return itemErrorResponse(ctx.requestId, item.error);
  let txn = null;
  if (move.txnId && owner.kind === "group") {
    const found = await ctx.timings.measure("db", () => repo.getTxn(owner.orgId, move.txnId as Uuid));
    if (!found.ok) return stockErrorResponse(ctx.requestId, found.error);
    txn = found.value;
  }
  return { item: item.value, move, txn, replayed: true };
}

/**
 * Use or waste some of an item — or check it (PN-4), which uses, wastes or
 * raises it. `plan` computes the write from the item as just read — what it
 * costs depends on what is left — or answers a refusal. A write that lost a
 * race (`stale`) is planned again from a fresh read, once; a second loss is
 * 409 `stale`. A key that already made a move on this item answers with that
 * move.
 */
export async function takeStock(
  ctx: RequestContext,
  repo: KitchenRepository,
  request: { owner: KitchenPantryOwner; itemId: Uuid; kind: StockRequestKind; idemKey: string },
  plan: (item: KitchenItemRecord) => Promise<StockWrite | Response>,
): Promise<StockMoved | Response> {
  const { owner, itemId, kind, idemKey } = request;
  const prior = await ctx.timings.measure("db", () => repo.getMoveByIdemKey(owner, itemId, idemKey));
  if (!prior.ok) return stockErrorResponse(ctx.requestId, prior.error);
  if (prior.value) {
    if (!sameRequest(prior.value, kind, ctx.actor.subjectId)) return idempotencyKeyReused(ctx.requestId);
    return replayed(ctx, repo, owner, prior.value);
  }

  for (let attempt = 0; ; attempt += 1) {
    const found = await ctx.timings.measure("db", () => repo.getItem(owner, itemId));
    if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
    const input = await plan(found.value);
    if (input instanceof Response) return input;
    const result = await ctx.timings.measure("db", () => (isAdjust(input) ? repo.adjustStock(input) : repo.takeStock(input)));
    if (result.ok) {
      if (result.value.replayed && !sameRequest(result.value.move, kind, ctx.actor.subjectId)) {
        return idempotencyKeyReused(ctx.requestId);
      }
      return result.value;
    }
    if (result.error.kind === "stale" && attempt === 0) continue;
    return stockErrorResponse(ctx.requestId, result.error);
  }
}

export interface UndoOptions {
  owner: KitchenPantryOwner;
  moveId: Uuid;
  idemKey: string;
  /** May the caller undo this move? null when they may; otherwise the response. */
  authorize(move: KitchenStockMoveRecord): Promise<Response | null>;
  /** The audit event the undo writes, if any (group moves). */
  audit?(move: KitchenStockMoveRecord, item: KitchenItemRecord, reversalId: Uuid): AppendEventWithAuditInput;
}

/**
 * Put back a move that moved no money: only a use or waste, only the latest
 * move still in effect on its item, and once. A move with a transaction is
 * undone by reversing the transaction. One retry when the item moved on.
 *
 * A stock check's adjust (PN-4) is taken back off rather than put back. It
 * cost nothing, so later uses never depend on it: it may be undone whenever
 * what it added is still all there, latest or not — 409
 * `insufficient_stock` once it is not.
 */
export async function undoMove(
  ctx: RequestContext,
  repo: KitchenRepository,
  options: UndoOptions,
): Promise<StockMoved | Response> {
  const { owner, moveId, idemKey } = options;
  for (let attempt = 0; ; attempt += 1) {
    const read = await ctx.timings.measure("db", () => repo.getMove(owner, moveId));
    if (!read.ok) return stockErrorResponse(ctx.requestId, read.error);
    const { move, item, latestMoveId } = read.value;

    if (attempt === 0) {
      const denied = await options.authorize(move);
      if (denied) return denied;
    }
    if (move.undoneBy) {
      // This very request again: answer with the reversal it wrote.
      const prior = await ctx.timings.measure("db", () => repo.getMoveByIdemKey(owner, item.id as Uuid, idemKey));
      if (prior.ok && prior.value && prior.value.reverses === move.id && prior.value.actor === ctx.actor.subjectId) {
        return { item, move: prior.value, txn: null, replayed: true };
      }
      return stockErrorResponse(ctx.requestId, { kind: "already_undone", undoneBy: move.undoneBy });
    }
    if (!UNDOABLE.has(move.kind)) return stockErrorResponse(ctx.requestId, { kind: "not_reversible" });
    if (move.txnId) {
      return conflict(
        ctx.requestId,
        "This moved money: reverse its transaction, which puts the stock back too",
        KITCHEN_ERROR_REASONS.HAS_TRANSACTION,
        { txnId: toPublicId("txn", move.txnId) },
      );
    }
    if (move.kind === "adjust") {
      if (item.qtyLeftMilli < move.qtyMilli) {
        return conflict(
          ctx.requestId,
          "What the stock check added has been used since: check it again instead",
          KITCHEN_ERROR_REASONS.INSUFFICIENT_STOCK,
          { qtyLeftMilli: item.qtyLeftMilli },
        );
      }
    } else if (latestMoveId !== move.id) {
      return conflict(ctx.requestId, "Only the latest change to an item can be undone", KITCHEN_ERROR_REASONS.NOT_LATEST, {
        latestMoveId: latestMoveId ? toPublicId("mov", latestMoveId) : null,
      });
    }

    const reversalId = asUuid(crypto.randomUUID());
    const audit = options.audit?.(move, item, reversalId);
    const result = await ctx.timings.measure("db", () =>
      repo.undoMove({
        owner,
        move,
        expectedVersion: item.version,
        reversal: { id: reversalId, actor: ctx.actor.subjectId, idemKey, now: ctx.now() },
        ...(audit ? { audit } : {}),
      }),
    );
    if (result.ok) {
      if (result.value.replayed && result.value.move.actor !== ctx.actor.subjectId) return idempotencyKeyReused(ctx.requestId);
      return result.value;
    }
    if (result.error.kind === "stale" && attempt === 0) continue;
    return stockErrorResponse(ctx.requestId, result.error);
  }
}
