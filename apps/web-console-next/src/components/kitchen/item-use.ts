/**
 * The item page (Cookpool CP-12) as pure view-models: the amount stepper for
 * "Use some" (sensible steps per dimension), its live cost — the engine's
 * `costOfUse`, the same maths the server charges with, including the last-use
 * rule — and who owes whom (the engine's `buildUse`, odd paisa to the first
 * person named, so the order shown is the order sent), what marking it wasted
 * would do under the rule in force (`buildWaste`), the history from its stock
 * moves, which of those can still be undone, and the groups a personal item
 * can move to. Dependency-free (contract types and the engine), so it is
 * unit-testable.
 */

import type {
  KitchenItem,
  KitchenMeasure,
  KitchenStockMove,
  Pantry,
  UseGroupItemRequest,
  UsePersonalItemRequest,
} from "@saas/contracts/kitchen";
import { costOfUse } from "@saas/kitchen-engine/money";
import { buildUse, buildWaste } from "@saas/kitchen-engine/ledger";
import { UnitError, formatQuantity, toMilli, type Dimension, type UnitKey } from "@saas/kitchen-engine/units";
import { formatMinor } from "./money";
import { memberLabel, memberLabelInline, type MemberNames } from "./members";
import { relativeWhen } from "./activity";
import { boughtText, capitalize, countWords, dayMonth, joinNames, leftText } from "./pantry";
import { pricePer } from "./item-form";
import type { GroupRole } from "./groups";
import { isPendingId } from "@/lib/optimistic";
import { countDecimal, leftInMeasure } from "./measures";
import { faceOrder, forWhom, eachText } from "./faces";
import { localDayOffset } from "./when";

type StockFields = Pick<KitchenItem, "priceMinor" | "qtyBoughtMilli" | "qtyLeftMilli" | "worthMinor">;

// ── How much ──────────────────────────────────────────────────────

export interface AmountStep {
  /** The unit the stepper counts in (always a base unit: g, ml, pcs, pack). */
  unit: UnitKey;
  /** One step, in thousandths of that unit. */
  stepMilli: number;
}

/** 50 g, 50 ml, 1 piece, 1 pack. */
export const AMOUNT_STEPS: Record<Dimension, AmountStep> = {
  mass: { unit: "g", stepMilli: 50_000 },
  volume: { unit: "ml", stepMilli: 50_000 },
  count: { unit: "pcs", stepMilli: 1_000 },
  pack: { unit: "pack", stepMilli: 1_000 },
};

export function amountStep(item: Pick<KitchenItem, "dimension">): AmountStep {
  return AMOUNT_STEPS[item.dimension];
}

/** Where the stepper starts: one step, or everything left when that is less. */
export function initialAmount(item: Pick<KitchenItem, "dimension" | "qtyLeftMilli">): number {
  return Math.min(amountStep(item).stepMilli, item.qtyLeftMilli);
}

/**
 * One step up or down, onto the step grid (430 g − 50 g → 400 g), never
 * below the smallest amount (one step, or all that is left) nor above what
 * is left.
 */
export function stepAmount(current: number, delta: 1 | -1, item: Pick<KitchenItem, "dimension" | "qtyLeftMilli">): number {
  const { stepMilli } = amountStep(item);
  const left = item.qtyLeftMilli;
  const smallest = Math.min(stepMilli, left);
  let next: number;
  if (delta > 0) next = Math.floor(current / stepMilli) * stepMilli + stepMilli;
  else next = Math.ceil(current / stepMilli) * stepMilli - stepMilli;
  if (next > left) next = left;
  if (next < smallest) next = smallest;
  return next;
}

/** Thousandths of a base unit as a plain decimal in that unit: 100000 → "100", 433333 → "433.333". */
export function milliToDecimal(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = milli % 1000;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

/** The stepper's value as it shows in its field ("100", "1.5"): its unit is a base unit, so this is exact. */
export function amountInput(milli: number): string {
  return milliToDecimal(milli);
}

export type AmountParse = { ok: true; milli: number } | { ok: false; message: string };

/** What someone typed into the stepper, in its unit, by the engine; at most what is left. */
export function parseAmount(input: string, item: Pick<KitchenItem, "dimension" | "qtyLeftMilli" | "displayUnit">): AmountParse {
  const step = amountStep(item);
  let text = input.trim();
  if (text.startsWith(".")) text = `0${text}`;
  if (text.endsWith(".")) text = text.slice(0, -1);
  if (text === "") return { ok: false, message: "Enter how much" };
  if (!/^\d+(?:\.\d+)?$/.test(text)) return { ok: false, message: "Enter a number like 100 or 1.5" };
  let milli: number;
  try {
    milli = toMilli(text, step.unit);
  } catch (err) {
    if (err instanceof UnitError) return { ok: false, message: "Enter more than zero" };
    throw err;
  }
  if (milli > item.qtyLeftMilli) {
    return { ok: false, message: `Only ${formatQuantity(item.qtyLeftMilli, item.dimension, step.unit)} left` };
  }
  return { ok: true, milli };
}

/** "100 g", "2 pcs", in the stepper's unit. */
export function amountText(milli: number, item: Pick<KitchenItem, "dimension">): string {
  return formatQuantity(milli, item.dimension, amountStep(item).unit);
}

/** What the item has cost so far: its price less what is left of it. */
export function costTakenMinor(item: StockFields): number {
  return Math.max(0, item.priceMinor - item.worthMinor);
}

/** What using `qtyMilli` costs, by the engine (the last of it costs what is left of the price). */
export function amountCost(item: StockFields, qtyMilli: number): number {
  return costOfUse(
    {
      priceMinor: item.priceMinor,
      qtyBoughtMilli: item.qtyBoughtMilli,
      qtyLeftMilli: item.qtyLeftMilli,
      costTakenMinor: costTakenMinor(item),
    },
    qtyMilli,
  );
}

/** Cost per 100 g, 100 ml or one piece / pack, proportional to what was paid (the engine's `pricePerUnit`): "₹4.00 per 100 g". */
export function costPerText(item: Pick<KitchenItem, "priceMinor" | "qtyBoughtMilli" | "dimension" | "currency">): string {
  const per: Record<Dimension, { unit: UnitKey; count: number; label: string }> = {
    mass: { unit: "g", count: 100, label: "per 100 g" },
    volume: { unit: "ml", count: 100, label: "per 100 ml" },
    count: { unit: "pcs", count: 1, label: "per piece" },
    pack: { unit: "pack", count: 1, label: "per pack" },
  };
  const { unit, count, label } = per[item.dimension];
  return `${formatMinor(pricePer(item.priceMinor, item.qtyBoughtMilli, unit, count), item.currency)} ${label}`;
}

// ── Who had it, and who owes whom ─────────────────────────────────

/** Who had it, in the order sent: you first, then the group's order (the odd paisa goes to the first named). */
export function orderConsumers(chosen: Iterable<string>, roster: readonly string[], meId: string | null): string[] {
  const set = new Set(chosen);
  const out: string[] = [];
  if (meId && set.has(meId)) out.push(meId);
  for (const id of roster) if (set.has(id) && id !== meId) out.push(id);
  for (const id of set) if (!out.includes(id)) out.push(id);
  return out;
}

export interface ShareLine {
  subjectId: string;
  /** "You owe Anu", "Dev owes you", "Anu's own share". */
  text: string;
  amountMinor: number;
  /** owe: you pay; owed: you get it; own: a buyer's own share (nets to zero); other: between two others. */
  tone: "owe" | "owed" | "own" | "other";
}

export interface ShareBreakdown {
  costMinor: number;
  lines: ShareLine[];
  /** True when the use moves money (someone other than the buyer had some). */
  posts: boolean;
}

/** "Anu's own share", "Your own share". */
function ownShare(subjectId: string, meId: string | null, names?: MemberNames | null): string {
  return subjectId === meId ? "Your own share" : `${memberLabel(subjectId, meId, names)}'s own share`;
}

/**
 * The cost of the use split equally between the people who had it, by the
 * engine's `buildUse`, as lines: "You owe Anu ₹2.00", "Anu's own share
 * ₹2.00" — in the order the people are named, which is the order sent.
 */
export function shareBreakdown(input: {
  item: StockFields & Pick<KitchenItem, "paidBy">;
  qtyMilli: number;
  consumers: readonly string[];
  meId: string | null;
  names?: MemberNames | null;
}): ShareBreakdown {
  const { item, consumers, meId, names } = input;
  const costMinor = amountCost(item, input.qtyMilli);
  if (consumers.length === 0) return { costMinor, lines: [], posts: false };
  const splits = buildUse({ costMinor, buyerId: item.paidBy, consumers });
  const owed = new Map(splits.map((s) => [s.subjectId, s.owedMinor] as const));
  const buyer = item.paidBy;
  const lines: ShareLine[] = consumers.map((c) => {
    const amountMinor = owed.get(c) ?? 0;
    if (c === buyer) return { subjectId: c, text: ownShare(c, meId, names), amountMinor, tone: "own" };
    if (c === meId) return { subjectId: c, text: `You owe ${memberLabel(buyer, meId, names)}`, amountMinor, tone: "owe" };
    if (buyer === meId) return { subjectId: c, text: `${memberLabel(c, meId, names)} owes you`, amountMinor, tone: "owed" };
    return { subjectId: c, text: `${memberLabel(c, meId, names)} owes ${memberLabel(buyer, meId, names)}`, amountMinor, tone: "other" };
  });
  return { costMinor, lines, posts: splits.some((s) => s.paidMinor !== s.owedMinor) };
}

/** Who had it, in a sentence: "you and Dev", "you, Anu and 2 others". */
export function consumersText(consumers: readonly string[], meId: string | null, names?: MemberNames | null): string {
  return joinNames(consumers.map((c) => memberLabelInline(c, meId, names)));
}

/** The Log button: "Log 100 g for you and Dev", "Log 2 pcs" (your own pantry), "Pick who had it". */
export function logButtonLabel(input: {
  qtyMilli: number;
  item: Pick<KitchenItem, "dimension">;
  consumers: readonly string[] | null;
  meId: string | null;
  names?: MemberNames | null;
}): string {
  const qty = amountText(input.qtyMilli, input.item);
  if (input.consumers === null) return `Log ${qty}`;
  if (input.consumers.length === 0) return "Pick who had it";
  return `Log ${qty} for ${consumersText(input.consumers, input.meId, input.names)}`;
}

/**
 * The request for a use (and, for a group item, who had it): `qtyMilli` in
 * the stepper's base unit — `{ quantity: "250", unit: "ml" }` — or, given in
 * one of the item's measures, its count and word — `{ quantity: "2",
 * measure: "onion" }` (SM-14): the server then takes what `measureTakeMilli`
 * says and keeps the words.
 */
export function logRequest(
  item: Pick<KitchenItem, "dimension" | "pantry">,
  qtyMilli: number,
  consumers: readonly string[],
  counted: { measure: Pick<KitchenMeasure, "one">; quantity: number } | null = null,
): UseGroupItemRequest | UsePersonalItemRequest {
  const amount = counted
    ? { quantity: countDecimal(counted.quantity), measure: counted.measure.one }
    : { quantity: milliToDecimal(qtyMilli), unit: amountStep(item).unit };
  if (item.pantry.kind === "personal") return amount;
  return { ...amount, consumers: [...consumers] };
}

// ── Mark wasted ───────────────────────────────────────────────────

export interface WastePreview {
  /** "Throw away the 400 g left (₹16.00)?" */
  question: string;
  /** Who pays, in a sentence. */
  explain: string;
  /** Each member's share under "split equally" (empty otherwise). */
  lines: ShareLine[];
  /** Who pays, in a few words, when there are no `lines` to say it (SM-15): "Anu absorbs it". */
  short: string | null;
  /** True when a waste transaction would post. */
  posts: boolean;
}

/**
 * What marking everything left as wasted does, under the rule in force (the
 * item's own, else its group's): split equally across every current member
 * (`buildWaste`, in the roster's order), absorbed by the buyer, or — for your
 * own item — nothing to split.
 */
export function wastePreview(input: {
  item: Pick<KitchenItem, "worthMinor" | "currency" | "paidBy" | "wastePolicy" | "wastePolicyOverride" | "pantry" | "qtyLeftMilli" | "dimension" | "displayUnit">;
  /** Every current member, in the group's order. */
  members: readonly string[];
  meId: string | null;
  names?: MemberNames | null;
}): WastePreview {
  const { item, meId, names } = input;
  const left = leftText(item);
  const worth = formatMinor(item.worthMinor, item.currency);
  const question = `Throw away the ${left} left (${worth})?`;
  if (item.pantry.kind === "personal") {
    return { question, explain: "It's your own, so nothing is split. The pantry just stops counting it.", lines: [], short: "Nothing to split", posts: false };
  }
  const group = item.pantry.name;
  const buyer = memberLabel(item.paidBy, meId, names);
  const own = item.wastePolicyOverride !== null;
  if (item.worthMinor === 0) {
    return { question, explain: "What's left cost nothing, so nobody is charged.", lines: [], short: "Nobody is charged", posts: false };
  }
  if (item.wastePolicy === "buyer_absorbs" || input.members.length === 0) {
    const rule = own ? "This item's rule" : `${group}'s rule`;
    const who = item.paidBy === meId ? "You paid, so you absorb it" : `${buyer} paid and absorbs it`;
    const short = item.paidBy === meId ? "You absorb it" : `${buyer} absorbs it`;
    return { question, explain: `${rule}: the buyer absorbs waste. ${who}; nobody else is charged.`, lines: [], short, posts: false };
  }
  const splits = buildWaste({ unusedMinor: item.worthMinor, buyerId: item.paidBy, members: input.members });
  const owed = new Map(splits.map((s) => [s.subjectId, s.owedMinor] as const));
  const lines: ShareLine[] = input.members.map((m) => {
    const amountMinor = owed.get(m) ?? 0;
    if (m === item.paidBy) return { subjectId: m, text: ownShare(m, meId, names), amountMinor, tone: "own" };
    if (m === meId) return { subjectId: m, text: `You owe ${buyer}`, amountMinor, tone: "owe" };
    if (item.paidBy === meId) return { subjectId: m, text: `${memberLabel(m, meId, names)} owes you`, amountMinor, tone: "owed" };
    return { subjectId: m, text: `${memberLabel(m, meId, names)} owes ${buyer}`, amountMinor, tone: "other" };
  });
  const others = input.members.filter((m) => m !== item.paidBy);
  const rule = own ? "This item's rule splits waste equally." : `${group} splits waste equally.`;
  const payer = capitalize(memberLabelInline(item.paidBy, meId, names));
  const payerRef = item.paidBy === meId ? "you" : buyer;
  const amounts = new Set(others.map((m) => owed.get(m) ?? 0));
  const even = amounts.size === 1 ? formatMinor([...amounts][0]!, item.currency) : null;
  let explain: string;
  if (others.length === 0) {
    explain = `${rule} ${payer} paid and ${item.paidBy === meId ? "are" : "is"} the only member, so nobody else is charged.`;
  } else if (others.length === 1) {
    const other = others[0]!;
    explain = `${rule} ${payer} paid, so ${memberLabelInline(other, meId, names)} ${other === meId ? "owe" : "owes"} ${payerRef} ${formatMinor(owed.get(other) ?? 0, item.currency)}.`;
  } else {
    const who =
      others.length <= 4
        ? joinNames(others.map((m) => memberLabelInline(m, meId, names)), others.length)
        : `the other ${others.length} members`;
    explain = even
      ? `${rule} ${payer} paid, so ${who} each owe ${payerRef} ${even}.`
      : `${rule} ${payer} paid, so ${who} share it, a paisa apart.`;
  }
  return { question, explain, lines, short: others.length === 0 ? "Nobody else is charged" : null, posts: others.length > 0 };
}

// ── History ───────────────────────────────────────────────────────

export interface HistoryRow {
  id: string;
  kind: KitchenStockMove["kind"] | "added";
  /** "You and Dev · 100 g", "Anu · 2 onions", "Anu marked 400 g wasted", "Anu added 1 kg". */
  what: string;
  /** "2 h ago", "30 Oct"; "300 g · 2 h ago" under words given in a measure. */
  when: string;
  /** "₹4.00", or null when no money is involved. */
  amount: string | null;
  /** A later undo put it back: shown struck through, "Undone". */
  undone: boolean;
}

/**
 * The item's history, newest first, from its stock moves — with, last, the
 * purchase itself ("Anu added 1 kg · ₹40.00").
 */
export function historyRows(
  moves: readonly KitchenStockMove[],
  ctx: {
    item: Pick<KitchenItem, "createdBy" | "paidBy" | "priceMinor" | "currency" | "boughtOn" | "createdAt" | "qtyBoughtMilli" | "dimension" | "displayUnit" | "pantry">;
    meId: string | null;
    names?: MemberNames | null;
    now: Date;
    /**
     * The new frame (cookpool-pantry PN-7): a stock check's moves read as
     * one ("Stock check · 250 ml split with Flat 4B", `checkMoveText`), with
     * who checked on the line under. Off, every row reads as it always has.
     */
    stockChecks?: boolean;
  },
): HistoryRow[] {
  const { item, meId, names, now } = ctx;
  const who = (id: string) => memberLabel(id, meId, names);
  const byId = new Map(moves.map((m) => [m.id, m] as const));
  const rows: HistoryRow[] = moves.map((m) => {
    const qty = formatQuantity(m.qtyMilli, item.dimension, m.unit);
    // Given in a measure (SM-14): its words lead ("2 onions"), and the amount it took goes under them.
    const said = m.label ?? null;
    const words = said ?? qty;
    const amount = m.costMinor > 0 ? formatMinor(m.costMinor, item.currency) : null;
    const check = ctx.stockChecks ? checkMoveText(m, { item, meId, names: names ?? null, byId }) : null;
    if (check) {
      const when = relativeWhen(m.at, now);
      return { id: m.id, kind: m.kind, what: check.what, when: check.by ? `${check.by} · ${when}` : when, amount, undone: m.undone };
    }
    let what: string;
    switch (m.kind) {
      case "use": {
        const consumers = m.consumers && m.consumers.length > 0 ? m.consumers : [m.actor];
        const had = capitalize(joinNames(consumers.map((c) => memberLabelInline(c, meId, names))));
        const logged = consumers.includes(m.actor) ? "" : ` · logged by ${memberLabelInline(m.actor, meId, names)}`;
        what = `${had} · ${words}${logged}`;
        break;
      }
      case "dish":
        what = `${who(m.actor)} cooked with ${words}`;
        break;
      case "waste":
        what = `${who(m.actor)} marked ${qty} wasted`;
        break;
      case "transfer":
        what = m.actor === meId ? "You moved it here from your pantry" : `${who(m.actor)} moved it here from their pantry`;
        break;
      case "reversal": {
        const original = m.reverses ? byId.get(m.reverses) : undefined;
        const kind = original?.kind === "waste" ? "waste" : original?.kind === "dish" ? "dish" : "use";
        what = `${who(m.actor)} undid a ${kind}: ${words} back`;
        break;
      }
      default:
        what = `${who(m.actor)} adjusted it by ${qty}`;
    }
    const when = relativeWhen(m.at, now);
    return { id: m.id, kind: m.kind, what, when: said ? `${qty} · ${when}` : when, amount, undone: m.undone };
  });
  const paid = item.paidBy === item.createdBy ? "" : ` · ${memberLabelInline(item.paidBy, meId, names)} paid`;
  const addedWhen = item.boughtOn ? (item.boughtOn === item.createdAt.slice(0, 10) ? relativeWhen(item.createdAt, now) : dayMonth(item.boughtOn)) : "";
  rows.push({
    id: `added_${item.createdAt}`,
    kind: "added",
    what: `${who(item.createdBy)} added ${boughtText(item)}${paid}`,
    when: addedWhen,
    amount: formatMinor(item.priceMinor, item.currency),
    undone: false,
  });
  return rows;
}

/**
 * A stock check's move in words (cookpool-pantry PN-7, design §7), or null
 * for any other move:
 *  - its use of the difference: "Stock check · 250 ml split with Flat 4B"
 *    when the group had it, else "Stock check · 250 ml used by Anu";
 *  - its waste: "Stock check · 250 ml went bad";
 *  - its raise: "Stock check · 250 ml more than thought";
 *  - the undo of one: "Anu undid a stock check: 250 ml back".
 * `by` names who checked when the words don't ("Anu"), for the line under.
 */
export function checkMoveText(
  m: KitchenStockMove,
  ctx: {
    item: Pick<KitchenItem, "dimension" | "displayUnit" | "pantry">;
    meId: string | null;
    names?: MemberNames | null;
    byId?: ReadonlyMap<string, KitchenStockMove>;
  },
): { what: string; by: string | null } | null {
  const { item, meId, names } = ctx;
  // In the item's own unit ("1.75 L"): a check sends its level in the base unit.
  const qty = formatQuantity(m.qtyMilli, item.dimension, item.displayUnit);
  const by = memberLabel(m.actor, meId, names);
  if (m.kind === "reversal") {
    const original = m.reverses ? ctx.byId?.get(m.reverses) : undefined;
    if (original?.via !== "check") return null;
    // Undoing a raise takes it back off; undoing a check's use or waste puts it back.
    return { what: `${by} undid a stock check: ${qty} ${original.kind === "adjust" ? "off" : "back"}`, by: null };
  }
  if (m.via !== "check") return null;
  switch (m.kind) {
    case "use": {
      const people = m.consumers && m.consumers.length > 0 ? m.consumers : [m.actor];
      const own = people.length === 1 && people[0] === m.actor;
      if (item.pantry.kind === "group" && !own) return { what: `Stock check · ${qty} split with ${item.pantry.name}`, by };
      return { what: `Stock check · ${qty} used by ${joinNames(people.map((c) => memberLabelInline(c, meId, names)))}`, by: own ? null : by };
    }
    case "waste":
      return { what: `Stock check · ${qty} went bad`, by };
    case "adjust":
      return { what: `Stock check · ${qty} more than thought`, by };
    default:
      return null;
  }
}

/**
 * Whether a move can be undone from the item page: a use or waste still in
 * effect. One that posted a transaction is undone by reversing it (its
 * logger, or an owner or admin); one that moved no money only while it is the
 * item's latest move still in effect (its logger or an owner or admin in a
 * group; always for your own item). A viewer undoes nothing.
 *
 * With `adjusts` (the new frame, cookpool-pantry PN-7), a stock check's raise
 * (`adjust`) can be undone too, by its checker or an owner or admin, whatever
 * came after it: it moved no money, and the server takes it back off while
 * that much is still there (`insufficient_stock` once it isn't).
 */
export function canUndoMove(
  move: KitchenStockMove,
  moves: readonly KitchenStockMove[],
  ctx: { meId: string | null; personal: boolean; role: GroupRole | null; canWrite: boolean; adjusts?: boolean },
): boolean {
  if (!ctx.canWrite) return false;
  // Not on the server yet (SM-5): its toast undoes it.
  if (isPendingId(move.id)) return false;
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const mine = ctx.meId !== null && move.actor === ctx.meId;
  if (ctx.adjusts && move.kind === "adjust") return !move.undone && (ctx.personal || mine || manager);
  if (move.undone || (move.kind !== "use" && move.kind !== "waste")) return false;
  if (move.txnId) return !ctx.personal && (mine || manager);
  const latest = moves.find((m) => m.kind !== "reversal" && !m.undone);
  if (!latest || latest.id !== move.id) return false;
  return ctx.personal || mine || manager;
}

/**
 * Swiping a history row left undoes it (PW-8): the rows whose Undo shows
 * today (`canUndoMove`, a use or a waste), and only the ones you logged —
 * an owner's or admin's undo of someone else's keeps its button alone.
 */
export function canSwipeUndoMove(
  move: KitchenStockMove,
  moves: readonly KitchenStockMove[],
  ctx: { meId: string | null; personal: boolean; role: GroupRole | null; canWrite: boolean; adjusts?: boolean },
): boolean {
  return ctx.meId !== null && move.actor === ctx.meId && canUndoMove(move, moves, ctx);
}

// ── Move a personal item to a group ───────────────────────────────

/** Nothing used yet: all of it left and nothing charged (what transfer, edits and removal need). */
export function isUnused(item: Pick<KitchenItem, "qtyLeftMilli" | "qtyBoughtMilli" | "worthMinor" | "priceMinor" | "state">): boolean {
  return item.state === "active" && item.qtyLeftMilli === item.qtyBoughtMilli && item.worthMinor === item.priceMinor;
}

export interface TransferTarget {
  orgId: string;
  slug: string;
  name: string;
  /** Why it can't take the item ("Counts in USD"), or null. */
  disabledReason: string | null;
}

/**
 * The groups a personal item can move into: those where you add items (not
 * a viewer's), recent first; a group counting in another currency is shown
 * but cannot take it.
 */
export function transferTargets(
  pantries: readonly Pantry[],
  item: Pick<KitchenItem, "currency">,
  roles: ReadonlyMap<string, GroupRole>,
): TransferTarget[] {
  const out: TransferTarget[] = [];
  for (const p of pantries) {
    if (p.kind !== "group") continue;
    if (roles.get(p.orgId) === "viewer") continue;
    out.push({
      orgId: p.orgId,
      slug: p.slug,
      name: p.name,
      disabledReason: p.currency !== item.currency ? `Counts in ${p.currency}` : null,
    });
  }
  return out;
}

/** "Moving 1 kg of Tomatoes into Flat 4B makes it the group's, paid by you." */
export function transferNote(item: Pick<KitchenItem, "name" | "qtyLeftMilli" | "dimension" | "displayUnit">, groupName: string): string {
  return `${leftText(item)} becomes ${groupName}'s, paid by you · can't be undone`;
}

/**
 * An amount never breaks between its number and its word — "300 g", "2
 * onions", "½ onion" — however narrow the row (SM-15: the audit found "You
 * and Dev Patel used 300 / g" with the unit on a line of its own).
 */
export function keepAmountsTogether(text: string): string {
  return text.replace(/(\d[\d.,]*½?|½) (?=[^\s\d·])/g, "$1\u00a0");
}

// ── The item page's facts (SM-15) ─────────────────────────────────

export interface ItemFacts {
  /** The big number: "600 g". */
  left: string;
  /** Beside it: "left of 1 kg · ≈ 4 onions". */
  of: string;
  /**
   * Everything else in one line (the audit's six-cell grid): what it is worth
   * now, its price once, and who paid — "Worth ₹24.00 · ₹4.00 per 100 g ·
   * Meera paid". Your own item has no "paid": nobody else is in it.
   */
  line: string;
}

export function itemFacts(
  item: Pick<KitchenItem, "qtyLeftMilli" | "qtyBoughtMilli" | "dimension" | "displayUnit" | "worthMinor" | "priceMinor" | "currency" | "paidBy" | "pantry"> & {
    measures?: readonly KitchenMeasure[] | undefined;
  },
  ctx: { meId: string | null; names?: MemberNames | null },
): ItemFacts {
  const counted = leftInMeasure(item);
  const parts = [
    item.qtyLeftMilli > 0 ? `Worth ${formatMinor(item.worthMinor, item.currency)}` : null,
    costPerText(item),
    item.pantry.kind === "group" ? `${memberLabel(item.paidBy, ctx.meId, ctx.names)} paid` : null,
  ];
  return {
    left: leftText(item),
    of: [`left of ${boughtText(item)}`, counted].filter(Boolean).join(" · "),
    line: parts.filter(Boolean).join(" · "),
  };
}

/** "3 people", for a member count. */
export function peopleCount(n: number): string {
  return countWords(n, "person", "people");
}

// ── Logging a use: what it says (CP-13, one line since SM-14) ─────

/**
 * The toast after a use, in one line (the seven rules): what was logged and
 * what it cost — "Logged 2 onions · ₹12.00" — or, logged for someone else
 * or for several people, who, what and what each owes: "Anu · 1 glass ·
 * ₹17.00", "You + Anu · 1 glass · ₹8.50 each" ("≈ … each" when the paisa do
 * not divide). `what` is the amount in words — the measure's when it was
 * given in one ("2 onions"). Each share is the engine's split (`buildUse`),
 * as the server posts it; the same words on Use, the item page, Home and
 * Pantry.
 */
export function loggedText(input: {
  item: Pick<KitchenItem, "pantry" | "paidBy" | "currency">;
  /** The amount in words: "2 onions", "1 glass", "100 g". */
  what: string;
  consumers: readonly string[];
  meId: string | null;
  names?: MemberNames | null;
  /** What the use cost (the move's cost). */
  costMinor: number;
}): string {
  const { item, what, meId, names, costMinor } = input;
  const cost = formatMinor(costMinor, item.currency);
  const people = item.pantry.kind === "personal" ? [] : [...new Set(input.consumers)];
  if (people.length === 0 || (people.length === 1 && people[0] === meId)) return `Logged ${what} · ${cost}`;
  const ordered = faceOrder(people, meId, names);
  if (people.length === 1) return `${forWhom(ordered, meId, names)} · ${what} · ${cost}`;
  const owed = new Map(buildUse({ costMinor, buyerId: item.paidBy, consumers: people }).map((x) => [x.subjectId, x.owedMinor] as const));
  const each = eachText(ordered.map((id) => owed.get(id) ?? 0), item.currency);
  return `${forWhom(ordered, meId, names)} · ${what} · ${each ?? cost}`;
}

/**
 * What to say when a use is refused, and who to take off it: not that much
 * left any more ("Only 50 g left now — someone used some meanwhile."), the
 * item changed under the write (`stale`), someone named has left the group
 * (`not_in_group`: they come off the use), the item is gone, or the server's
 * own message.
 */
export function logRefusal(
  error: { reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined },
  ctx: { item: Pick<KitchenItem, "dimension" | "qtyLeftMilli">; meId: string | null; names?: MemberNames | null },
): { message: string; gone: string[] } {
  const details = error.details ?? {};
  switch (error.reason) {
    case "insufficient_stock": {
      const left = typeof details["qtyLeftMilli"] === "number" ? (details["qtyLeftMilli"] as number) : ctx.item.qtyLeftMilli;
      return {
        message:
          left > 0
            ? `Only ${amountText(left, ctx.item)} left now — someone used some meanwhile.`
            : "None left now — someone used the last of it.",
        gone: [],
      };
    }
    case "stale":
      return { message: "It changed while you were logging. Check the amount and try again.", gone: [] };
    case "not_in_group": {
      const gone = Array.isArray(details["subjectIds"])
        ? (details["subjectIds"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const who = gone.map((id) => memberLabel(id, ctx.meId, ctx.names)).join(", ") || "Someone";
      return { message: `${who} left the group, so they're off this use. Check and log again.`, gone };
    }
    default:
      return { message: error.message, gone: [] };
  }
}

// ── At this rate (cookpool-pantry PN-7, design §5) ────────────────

/** An estimate needs at least this many uses in effect… */
export const RUN_OUT_MIN_USES = 2;
/** …and at least this many days since it was bought. */
export const RUN_OUT_MIN_DAYS = 2;
/** Within this many days the estimate names a day ("Tue"); after, weeks. */
export const RUN_OUT_WEEKDAYS = 7;

const DAY_MS = 86_400_000;

export interface RunOutEstimate {
  /** When it runs out at this rate. */
  at: Date;
  /** How many days from now (fractional). */
  days: number;
  /** "today", "tomorrow", "Tue", "in about a week", "in about 3 weeks". */
  when: string;
  /** "At this rate it runs out Tue". */
  line: string;
  /** "About 250 ml a day" ("About 5 g a week" when a day's is too small to say). */
  rate: string;
}

/** The moves that take stock and still stand: uses (a stock check's included) and dishes. */
function takesInEffect(moves: readonly KitchenStockMove[]): KitchenStockMove[] {
  return moves.filter((m) => !m.undone && (m.kind === "use" || m.kind === "dish"));
}

/** Two significant figures of an amount, in thousandths (233 ml → 230 ml, 1.234 L → 1.2 L). */
function roundAmount(milli: number): number {
  const base = milli / 1000;
  if (base <= 0) return 0;
  const step = Math.pow(10, Math.floor(Math.log10(base)) - 1);
  return Math.round(Math.round(base / step) * step * 1000);
}

/** The smallest daily amount worth saying: 1 g or 1 ml, a tenth of a piece or a pack. */
function smallestDaily(dimension: Dimension): number {
  return dimension === "mass" || dimension === "volume" ? 1000 : 100;
}

/**
 * When an item runs out at the rate it's being used (design §5): what was
 * used since it was bought (its uses and dishes in effect, less what a stock
 * check found was still there), over the days since it was bought. It needs
 * RUN_OUT_MIN_USES uses and RUN_OUT_MIN_DAYS days, something left, and no
 * use-by inside the estimate (it goes off first, and its use-by chip says
 * so). It names the day within a week — "today", "tomorrow", "Tue" — and
 * "in about N weeks" after that. Null when there's no estimate. Days are the
 * viewer's own (`localDayOffset`); bought-on and use-by are UTC days, as the
 * server counts them.
 */
export function runOutEstimate(
  moves: readonly KitchenStockMove[],
  item: Pick<KitchenItem, "qtyLeftMilli" | "dimension" | "displayUnit" | "boughtOn" | "expiresOn" | "state">,
  now: Date,
): RunOutEstimate | null {
  if (item.state !== "active" || item.qtyLeftMilli <= 0) return null;
  const takes = takesInEffect(moves);
  if (takes.length < RUN_OUT_MIN_USES) return null;
  const bought = Date.parse(`${item.boughtOn}T00:00:00Z`);
  if (Number.isNaN(bought)) return null;
  const sinceDays = (now.getTime() - bought) / DAY_MS;
  if (sinceDays < RUN_OUT_MIN_DAYS) return null;
  const raised = moves.filter((m) => !m.undone && m.kind === "adjust").reduce((s, m) => s + m.qtyMilli, 0);
  const used = takes.reduce((s, m) => s + m.qtyMilli, 0) - raised;
  if (used <= 0) return null;
  const perDay = used / sinceDays;
  const days = item.qtyLeftMilli / perDay;
  const at = new Date(now.getTime() + days * DAY_MS);
  if (item.expiresOn) {
    const useByEnd = Date.parse(`${item.expiresOn}T00:00:00Z`) + DAY_MS;
    if (!Number.isNaN(useByEnd) && useByEnd < at.getTime()) return null;
  }
  const offset = localDayOffset(at, now);
  let when: string;
  if (offset <= 0) when = "today";
  else if (offset === 1) when = "tomorrow";
  else if (offset < RUN_OUT_WEEKDAYS) when = at.toLocaleDateString("en-GB", { weekday: "short" });
  else {
    const weeks = Math.max(1, Math.round(days / 7));
    when = weeks === 1 ? "in about a week" : `in about ${weeks} weeks`;
  }
  const daily = roundAmount(perDay);
  const rate =
    daily >= smallestDaily(item.dimension)
      ? `About ${formatQuantity(daily, item.dimension, item.displayUnit)} a day`
      : `About ${formatQuantity(roundAmount(perDay * 7), item.dimension, item.displayUnit)} a week`;
  return { at, days, when, line: `At this rate it runs out ${when}`, rate };
}

// ── Who had it (cookpool-pantry PN-7, design §5) ──────────────────

export interface WhoHadItRow {
  subjectId: string;
  /** "You", "Anu". */
  name: string;
  /** Their part of what was used, 0–1. */
  share: number;
  /** "½", "⅓", "45%", "All". */
  shareText: string;
  /** What they had, in thousandths (their equal part of each use). */
  qtyMilli: number;
  /** "500 ml". */
  qtyText: string;
  /** What they were charged for it (the engine's split, odd paisa to the earliest named). */
  costMinor: number;
}

const FRACTIONS: readonly [number, number, string][] = [
  [1, 2, "½"], [1, 3, "⅓"], [2, 3, "⅔"], [1, 4, "¼"], [3, 4, "¾"],
  [1, 5, "⅕"], [2, 5, "⅖"], [3, 5, "⅗"], [4, 5, "⅘"], [1, 6, "⅙"], [5, 6, "⅚"],
  [1, 8, "⅛"], [3, 8, "⅜"], [5, 8, "⅝"], [7, 8, "⅞"],
];

/** A share as the canvas says it: "All", a simple fraction when it is one ("½", "⅓"), else a percentage ("45%"). */
export function shareText(share: number): string {
  if (share >= 0.995) return "All";
  for (const [n, d, glyph] of FRACTIONS) if (Math.abs(share - n / d) < 0.005) return glyph;
  return `${Math.max(1, Math.round(share * 100))}%`;
}

/**
 * Who had this item and their part of what was used (design §5): every use
 * in effect — logged, or a stock check's — shared equally between the
 * people who had it (the logger when nobody is named), largest part first,
 * you first among equals. Its cost is the engine's split of each use, as the
 * server posted it. Dishes and waste aren't anyone's share. Empty when
 * nothing was used.
 */
export function whoHadIt(
  moves: readonly KitchenStockMove[],
  item: Pick<KitchenItem, "dimension" | "displayUnit" | "paidBy">,
  ctx: { meId: string | null; names?: MemberNames | null },
): WhoHadItRow[] {
  const qty = new Map<string, number>();
  const cost = new Map<string, number>();
  let total = 0;
  for (const m of moves) {
    if (m.undone || m.kind !== "use" || m.qtyMilli <= 0) continue;
    const people = m.consumers && m.consumers.length > 0 ? [...m.consumers] : [m.actor];
    total += m.qtyMilli;
    for (const p of people) qty.set(p, (qty.get(p) ?? 0) + m.qtyMilli / people.length);
    if (m.costMinor > 0) {
      for (const s of buildUse({ costMinor: m.costMinor, buyerId: item.paidBy, consumers: people })) {
        if (s.owedMinor > 0 || people.includes(s.subjectId)) cost.set(s.subjectId, (cost.get(s.subjectId) ?? 0) + s.owedMinor);
      }
    }
  }
  if (total <= 0) return [];
  const rows = [...qty.entries()].map(([subjectId, q]): WhoHadItRow => {
    const share = q / total;
    const qtyMilli = Math.round(q);
    return {
      subjectId,
      name: memberLabel(subjectId, ctx.meId, ctx.names),
      share,
      shareText: shareText(share),
      qtyMilli,
      qtyText: formatQuantity(qtyMilli, item.dimension, item.displayUnit),
      costMinor: cost.get(subjectId) ?? 0,
    };
  });
  return rows.sort((a, b) => b.share - a.share || (a.subjectId === ctx.meId ? -1 : b.subjectId === ctx.meId ? 1 : a.name.localeCompare(b.name)));
}

/** "Anu ½ · You ⅓ · Dev ⅙". */
export function whoHadItLine(rows: readonly Pick<WhoHadItRow, "name" | "shareText">[]): string {
  return rows.map((r) => `${r.name} ${r.shareText}`).join(" · ");
}
