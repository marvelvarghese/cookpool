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
import { countDecimal } from "./measures";
import { faceOrder, forWhom, eachText } from "./faces";

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
    return { question, explain: "It's your own, so nothing is split. The pantry just stops counting it.", lines: [], posts: false };
  }
  const group = item.pantry.name;
  const buyer = memberLabel(item.paidBy, meId, names);
  const own = item.wastePolicyOverride !== null;
  if (item.worthMinor === 0) {
    return { question, explain: "What's left cost nothing, so nobody is charged.", lines: [], posts: false };
  }
  if (item.wastePolicy === "buyer_absorbs" || input.members.length === 0) {
    const rule = own ? "This item's rule" : `${group}'s rule`;
    const who = item.paidBy === meId ? "You paid, so you absorb it" : `${buyer} paid and absorbs it`;
    return { question, explain: `${rule}: the buyer absorbs waste. ${who}; nobody else is charged.`, lines: [], posts: false };
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
  return { question, explain, lines, posts: others.length > 0 };
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
 * Whether a move can be undone from the item page: a use or waste still in
 * effect. One that posted a transaction is undone by reversing it (its
 * logger, or an owner or admin); one that moved no money only while it is the
 * item's latest move still in effect (its logger or an owner or admin in a
 * group; always for your own item). A viewer undoes nothing.
 */
export function canUndoMove(
  move: KitchenStockMove,
  moves: readonly KitchenStockMove[],
  ctx: { meId: string | null; personal: boolean; role: GroupRole | null; canWrite: boolean },
): boolean {
  if (!ctx.canWrite) return false;
  // Not on the server yet (SM-5): its toast undoes it.
  if (isPendingId(move.id)) return false;
  if (move.undone || (move.kind !== "use" && move.kind !== "waste")) return false;
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const mine = ctx.meId !== null && move.actor === ctx.meId;
  if (move.txnId) return !ctx.personal && (mine || manager);
  const latest = moves.find((m) => m.kind !== "reversal" && !m.undone);
  if (!latest || latest.id !== move.id) return false;
  return ctx.personal || mine || manager;
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
  return `${leftText(item)} of ${item.name} becomes ${groupName}'s, paid by you. Nobody is charged until they use some. This can't be undone.`;
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
