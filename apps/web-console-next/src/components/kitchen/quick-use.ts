/**
 * Quick use (Cookpool CP-13) as pure view-models: the amount tiles on /use
 * — the item's own measures (SM-14: "1 onion · ≈ 150 g"), then plain amounts
 * per dimension (a glass, weights, pieces, packs), never more than is left,
 * with the person's usual amount first and marked, and Another amount in the
 * measure or the unit — who had it
 * to start with (the people of their last use), the Log button, the request,
 * the cards of the "Recent and usual" strip and of a search's matches, and the
 * + Add sheet's "Do it again" rows. Costs, who owes whom and the request are
 * the item page's (`item-use.ts`): the engine's `costOfUse` and `buildUse`,
 * sent in the item's base unit. Dependency-free (contract types and the
 * engine), so it is unit-testable.
 */

import type {
  KitchenItem,
  KitchenMeasure,
  KitchenUsual,
  ReachableItem,
  UseGroupItemRequest,
  UsePersonalItemRequest,
} from "@saas/contracts/kitchen";
import { inMeasure, measureLabel } from "@saas/contracts/kitchen";
import { dimensionOf, formatQuantity, isUnit, type Dimension } from "@saas/kitchen-engine/units";
import { formatMinor } from "./money";
import { amountCost, amountStep, consumersText, initialAmount, logRequest, orderConsumers, parseAmount, stepAmount } from "./item-use";
import { capitalize, countWords, itemRefOf, leftText, pantryLabel, type ItemRef } from "./pantry";
import { memberLabelInline, type MemberNames } from "./members";
import {
  askable,
  isApprox,
  leftInMeasure,
  maxCount,
  measureAmount,
  measuresOf,
  nearestCount,
  parseCount,
  parseLabel,
  stepCount,
  takeOf,
  usualAmount,
  type UseAmount,
} from "./measures";

// ── How much: the presets ─────────────────────────────────────────

export interface BuiltInAmount {
  /** Thousandths of the dimension's base unit (ml, g, pcs, pack). */
  qtyMilli: number;
  /** Its name inside a sentence ("1 glass", "a splash", "½ kg"); null when the amount says it ("100 g", "2 pcs"). */
  name: string | null;
  /** The name is a kitchen measure, not an amount: its tile also says the amount ("1 glass · 250 ml"). */
  named?: boolean;
}

/**
 * The plain amounts quick use offers, per dimension, in the order offered:
 * a glass (250 ml), half a glass, a splash (50 ml), a spoon (15 ml) — exact
 * for any liquid, so they stay built in; weights (100 g, 250 g, ½ kg) — the
 * guessed cup and spoon of something weighed are gone (SM-14): an item is
 * counted its own way by its measures; one, two, three pieces; half a pack,
 * one pack. An amount is offered only while it is less than what is left;
 * "The rest" always closes the row.
 */
export const KITCHEN_MEASURES: Record<Dimension, readonly BuiltInAmount[]> = {
  volume: [
    { qtyMilli: 250_000, name: "1 glass", named: true },
    { qtyMilli: 125_000, name: "½ glass", named: true },
    { qtyMilli: 50_000, name: "a splash", named: true },
    { qtyMilli: 15_000, name: "a spoon", named: true },
  ],
  mass: [
    { qtyMilli: 100_000, name: null },
    { qtyMilli: 250_000, name: null },
    { qtyMilli: 500_000, name: "½ kg" },
  ],
  count: [
    { qtyMilli: 1_000, name: null },
    { qtyMilli: 2_000, name: null },
    { qtyMilli: 3_000, name: null },
  ],
  pack: [
    { qtyMilli: 500, name: "½ pack" },
    { qtyMilli: 1_000, name: null },
  ],
};

/** How many amount tiles quick use shows (the last is always everything left). */
export const MAX_PRESETS = 4;

/** An amount by the engine, in the friendliest unit: "250 ml", "1 L", "200 g", "2 pcs". */
export function qtyText(qtyMilli: number, dimension: Dimension): string {
  return formatQuantity(qtyMilli, dimension);
}

/** A built-in amount's name ("1 glass" for 250 ml), or null when it is not one. */
export function measureName(qtyMilli: number, dimension: Dimension): string | null {
  return KITCHEN_MEASURES[dimension].find((m) => m.qtyMilli === qtyMilli)?.name ?? null;
}

/** An amount inside a sentence: its built-in name ("1 glass", "a splash"), else the amount ("200 ml", "2 pcs"). */
export function amountWords(qtyMilli: number, dimension: Dimension): string {
  return measureName(qtyMilli, dimension) ?? qtyText(qtyMilli, dimension);
}

export interface AmountPreset {
  /** The amount in thousandths, or "rest" for everything left. */
  id: string;
  qtyMilli: number;
  /** The tile's title: "1 glass", "A splash", "2 pcs", "The rest". */
  label: string;
  /** The amount the title stands for: "250 ml", "7 pcs", "1 L". */
  amount: string;
  /** The amount inside a sentence (the Log button, the toast): "1 glass", "a splash", "1 L". */
  words: string;
  /** The person's usual amount of this item (marked "Your usual", chosen first). */
  usual: boolean;
  /** Everything that is left. */
  rest: boolean;
}

/** "The rest": everything that is left, whatever is counted. */
export const REST_LABEL = "The rest";

/**
 * The four amount tiles for an item by its dimension alone (Home's one-tap
 * use): the person's usual amount first (when it fits what is left), then
 * the dimension's amounts that are less than what is left, then everything
 * left ("The rest"). A usual of exactly what is left marks "The rest" as the
 * usual; a usual of more than is left is not offered. The Use screen's tiles,
 * which know the item's own measures, are `useTiles`.
 */
export function amountPresets(
  item: Pick<KitchenItem, "dimension" | "qtyLeftMilli">,
  usualQtyMilli: number | null = null,
): AmountPreset[] {
  const left = item.qtyLeftMilli;
  if (left <= 0) return [];
  const dimension = item.dimension;
  const usual = usualQtyMilli !== null && usualQtyMilli > 0 && usualQtyMilli <= left ? usualQtyMilli : null;
  const tile = (qtyMilli: number, isUsual: boolean): AmountPreset => {
    const words = amountWords(qtyMilli, dimension);
    return { id: String(qtyMilli), qtyMilli, label: capitalize(words), amount: qtyText(qtyMilli, dimension), words, usual: isUsual, rest: false };
  };
  const out: AmountPreset[] = [];
  if (usual !== null && usual < left) out.push(tile(usual, true));
  for (const m of KITCHEN_MEASURES[dimension]) {
    if (out.length >= MAX_PRESETS - 1) break;
    if (m.qtyMilli >= left || m.qtyMilli === usual) continue;
    out.push(tile(m.qtyMilli, false));
  }
  const all = qtyText(left, dimension);
  out.push({ id: "rest", qtyMilli: left, label: REST_LABEL, amount: all, words: all, usual: usual === left, rest: true });
  return out;
}

/** The tile chosen to start with: your usual, else the first. */
export function defaultPreset(presets: readonly AmountPreset[]): AmountPreset | null {
  return presets.find((p) => p.usual) ?? presets[0] ?? null;
}

// ── The Use screen's tiles (SM-14) ────────────────────────────────

type TileItem = Pick<KitchenItem, "dimension" | "qtyLeftMilli" | "qtyBoughtMilli" | "priceMinor" | "worthMinor" | "currency" | "displayUnit"> & {
  measures?: readonly KitchenMeasure[] | undefined;
};

export interface UseTile {
  id: string;
  /** What it takes: a count of one of the item's measures, or an amount in its unit. */
  amount: UseAmount;
  /** The tile's title: "1 onion", "100 g", "1 glass", "The rest". */
  label: string;
  /** Inside a sentence (the button, the toast): "1 onion", "100 g", "1 glass", "the rest". */
  words: string;
  /** Under the title: "≈ 150 g · ₹6.00", "₹4.00", "250 ml · ₹17.00", "600 g · ₹24.00". */
  sub: string;
  /** Your usual (marked, and chosen first). */
  usual: boolean;
  /** Everything that is left. */
  rest: boolean;
}

/** An amount's identity: the same count of the same measure, or the same amount in the unit. */
export function amountKey(a: UseAmount): string {
  return a.kind === "measure" ? `m:${a.measure.one.toLowerCase()}:${a.quantity}` : `u:${a.qtyMilli}`;
}

/** What an amount costs, by the engine, in the item's currency. */
function costText(item: TileItem, qtyMilli: number): string {
  return formatMinor(amountCost(item, qtyMilli), item.currency);
}

/** Under a measure's count: "≈ 150 g · ₹6.00" for a weight or volume, "12 pcs · ₹x" counted, the price alone for slices of a pack. */
export function measureSub(item: TileItem, qtyMilli: number): string {
  const cost = costText(item, qtyMilli);
  if (item.dimension === "pack") return cost;
  const amount = qtyText(qtyMilli, item.dimension);
  return isApprox(item.dimension) ? `≈ ${amount} · ${cost}` : `${amount} · ${cost}`;
}

function measureTile(item: TileItem, a: Extract<UseAmount, { kind: "measure" }>, usual: boolean): UseTile {
  return { id: amountKey(a), amount: a, label: a.label, words: a.label, sub: measureSub(item, a.qtyMilli), usual, rest: false };
}

function unitTile(item: TileItem, qtyMilli: number, usual: boolean): UseTile {
  const built = KITCHEN_MEASURES[item.dimension].find((m) => m.qtyMilli === qtyMilli);
  const words = amountWords(qtyMilli, item.dimension);
  const cost = costText(item, qtyMilli);
  const amount: UseAmount = { kind: "unit", qtyMilli };
  return {
    id: amountKey(amount),
    amount,
    label: capitalize(words),
    words,
    sub: built?.named ? `${qtyText(qtyMilli, item.dimension)} · ${cost}` : cost,
    usual,
    rest: false,
  };
}

/**
 * The Use screen's tiles for an item (a 2×2 grid): your usual first (in its
 * measure when its words still name one: "2 onions"), then 1 and 2 of the
 * item's first measure, then plain amounts in its own unit — weights, the
 * built-in glass and splash, pieces, half a pack — only those under what is
 * left (largest first beside a measure, which covers the small ones), and
 * "The rest", which always takes exactly what is left. An item that could be
 * counted another way and isn't yet keeps a slot for the "Count in onions"
 * tile (`askable`). Every amount is what the server takes
 * (`measureTakeMilli`) and costs what the engine charges.
 */
export function useTiles(item: TileItem, usual: Pick<KitchenUsual, "lastQtyMilli" | "lastLabel"> | null = null): UseTile[] {
  const left = item.qtyLeftMilli;
  if (left <= 0) return [];
  const slots = (askable(item) ? MAX_PRESETS - 1 : MAX_PRESETS) - 1;
  const out: UseTile[] = [];
  const taken = (a: UseAmount) => out.some((t) => amountKey(t.amount) === amountKey(a) || (a.kind === "unit" && t.amount.kind === "unit" && t.amount.qtyMilli === a.qtyMilli));
  const mine = usualAmount(usual, item);
  const usualIsRest = mine !== null && mine.qtyMilli >= left;
  if (mine && !usualIsRest) out.push(mine.kind === "measure" ? measureTile(item, mine, true) : unitTile(item, mine.qtyMilli, true));
  const first = measuresOf(item)[0];
  if (first) {
    for (const quantity of [1, 2]) {
      if (out.length >= slots) break;
      const a = measureAmount(item, first, quantity);
      if (!a || a.qtyMilli >= left || taken(a)) continue;
      out.push(measureTile(item, a, false));
    }
  }
  const plain = KITCHEN_MEASURES[item.dimension].filter((m) => m.qtyMilli < left);
  for (const m of first ? [...plain].reverse() : plain) {
    if (out.length >= slots) break;
    const a: UseAmount = { kind: "unit", qtyMilli: m.qtyMilli };
    if (taken(a)) continue;
    out.push(unitTile(item, m.qtyMilli, false));
  }
  const rest: UseAmount = { kind: "unit", qtyMilli: left };
  out.push({
    id: "rest",
    amount: rest,
    label: REST_LABEL,
    words: "the rest",
    sub: `${qtyText(left, item.dimension)} · ${costText(item, left)}`,
    usual: usualIsRest,
    rest: true,
  });
  return out;
}

/** The tile chosen to start with: your usual, else the first. */
export function defaultTile(tiles: readonly UseTile[]): UseTile | null {
  return tiles.find((t) => t.usual) ?? tiles[0] ?? null;
}

/** What is left, with the item's measure beside it: "600 g left · ≈ 4 onions", "1 pack left · 20 slices". */
export function leftWithMeasure(item: Pick<KitchenItem, "qtyLeftMilli" | "dimension" | "displayUnit"> & { measures?: readonly KitchenMeasure[] | undefined }): string {
  const counted = leftInMeasure(item);
  return counted ? `${leftText(item)} left · ${counted}` : `${leftText(item)} left`;
}

// ── Another amount: a stepper, in the measure or the unit ─────────

export interface OtherAmount {
  /** Counting in the item's first measure, or in its unit (g, ml, pcs, pack). */
  side: "measure" | "unit";
  /** The count, on the measure's side (halves). */
  quantity: number;
  /** Thousandths of the unit, on the unit's side. */
  qtyMilli: number;
}

/** The switch's two sides: [onions | g]; just the unit without a measure. */
export function otherSides(item: TileItem): { measure: KitchenMeasure | null; unit: string } {
  return { measure: measuresOf(item)[0] ?? null, unit: amountStep(item).unit };
}

/** "onions or g", "in g": what Another amount counts in, before it is opened. */
export function otherHint(item: TileItem): string {
  const { measure, unit } = otherSides(item);
  return measure ? `${measure.many} or ${unit}` : `in ${unit}`;
}

/** Another amount opens on the chosen tile's amount, in the measure when the item has one. */
export function otherStart(item: TileItem, from: UseAmount | null): OtherAmount {
  const { measure } = otherSides(item);
  const qtyMilli = from ? Math.min(from.qtyMilli, item.qtyLeftMilli) : initialAmount(item);
  if (measure) {
    const max = maxCount(item, measure);
    if (max > 0) {
      const quantity = from?.kind === "measure" && from.measure.one === measure.one ? from.quantity : nearestCount(qtyMilli, measure, max);
      return { side: "measure", quantity, qtyMilli };
    }
  }
  return { side: "unit", quantity: 0, qtyMilli };
}

/** One step of Another amount: a whole one of the measure (½ below one), or a step of the unit (50 g, 1 pc). */
export function otherStep(item: TileItem, state: OtherAmount, delta: 1 | -1): OtherAmount {
  const { measure } = otherSides(item);
  if (state.side === "measure" && measure) {
    const next = stepCount(state.quantity, delta, maxCount(item, measure));
    return { ...state, quantity: next > 0 ? next : state.quantity };
  }
  return { ...state, qtyMilli: stepAmount(state.qtyMilli, delta, item) };
}

/** The switch, flipped: the same amount, as near as the other side counts it. */
export function otherSwitch(item: TileItem, state: OtherAmount, side: OtherAmount["side"]): OtherAmount {
  const { measure } = otherSides(item);
  if (side === state.side || (side === "measure" && !measure)) return state;
  if (side === "measure" && measure) {
    const max = maxCount(item, measure);
    if (max <= 0) return state;
    return { side, quantity: nearestCount(state.qtyMilli, measure, max), qtyMilli: state.qtyMilli };
  }
  const taken = measure ? (takeOf(item, measure, state.quantity) ?? item.qtyLeftMilli) : state.qtyMilli;
  const { stepMilli } = amountStep(item);
  const snapped = Math.min(Math.max(Math.round(taken / stepMilli) * stepMilli, Math.min(stepMilli, item.qtyLeftMilli)), item.qtyLeftMilli);
  return { side, quantity: state.quantity, qtyMilli: snapped };
}

/** Another amount as an amount to log; null when it doesn't fit. */
export function otherAmount(item: TileItem, state: OtherAmount): UseAmount | null {
  const { measure } = otherSides(item);
  if (state.side === "measure" && measure) return measureAmount(item, measure, state.quantity);
  return state.qtyMilli > 0 && state.qtyMilli <= item.qtyLeftMilli ? { kind: "unit", qtyMilli: state.qtyMilli } : null;
}

/** The line under Another amount: the other side and the price — "≈ 450 g · ₹18.00", "≈ 3 onions · ₹18.00", "₹18.00". */
export function otherLine(item: TileItem, amount: UseAmount | null): string {
  if (!amount) return "";
  if (amount.kind === "measure") return measureSub(item, amount.qtyMilli);
  const cost = costText(item, amount.qtyMilli);
  const { measure } = otherSides(item);
  if (!measure) return cost;
  const n = inMeasure(amount.qtyMilli, measure);
  if (n <= 0) return cost;
  return `${isApprox(item.dimension) ? "≈ " : ""}${measureLabel(n, measure)} · ${cost}`;
}

/** What someone typed into Another amount: a count of the measure ("2", "1½") or an amount in the unit, at most what is left. */
export function parseOther(item: TileItem, side: OtherAmount["side"], text: string): { ok: true; state: OtherAmount } | { ok: false; message: string } {
  const { measure } = otherSides(item);
  if (side === "measure" && measure) {
    const n = parseCount(text);
    if (n === null) return { ok: false, message: "Enter a number like 2 or 1.5" };
    if (n > maxCount(item, measure)) return { ok: false, message: `Only ${leftInMeasure(item) ?? leftText(item)} left` };
    return { ok: true, state: { side, quantity: n, qtyMilli: takeOf(item, measure, n) ?? 0 } };
  }
  const parsed = parseAmount(text, item);
  return parsed.ok ? { ok: true, state: { side: "unit", quantity: 0, qtyMilli: parsed.milli } } : parsed;
}

// ── Who had it ────────────────────────────────────────────────────

/** Your usual of an item, if you have one. */
export function usualFor(itemId: string, usuals: readonly KitchenUsual[] | null | undefined): KitchenUsual | null {
  return usuals?.find((u) => u.itemId === itemId) ?? null;
}

/** Your usual amount of an item, ready to log again in one tap. */
export interface RowUsual {
  qtyMilli: number;
  /** "2 onions", "1 glass", "200 g". */
  words: string;
  /** Given in one of the item's measures: logged in it again (`useLogUse({ measure })`). */
  measure: { measure: KitchenMeasure; quantity: number } | null;
}

/**
 * Pantry's one-tap Use (SM-15): your usual in its own words — "2 onions" when
 * its `lastLabel` still names one of the item's measures, sent in that
 * measure and taking what 2 onions take now — else its amount in the unit
 * ("1 glass", "200 g"). Null when there is none, or it is more than is left.
 */
export function rowUsual(
  usual: Pick<KitchenUsual, "lastQtyMilli" | "lastLabel"> | null,
  item: Pick<KitchenItem, "dimension" | "qtyLeftMilli" | "qtyBoughtMilli"> & { measures?: readonly KitchenMeasure[] | undefined },
): RowUsual | null {
  const amount = usualAmount(usual, item);
  if (!amount || amount.qtyMilli <= 0 || amount.qtyMilli > item.qtyLeftMilli) return null;
  return amount.kind === "measure"
    ? { qtyMilli: amount.qtyMilli, words: amount.label, measure: { measure: amount.measure, quantity: amount.quantity } }
    : { qtyMilli: amount.qtyMilli, words: amountWords(amount.qtyMilli, item.dimension), measure: null };
}

/**
 * Who had it, to start with: the people of your last use of the item (your
 * usual people) who are still in the group (`roster`, once known), else just
 * you.
 */
export function defaultConsumers(
  usual: Pick<KitchenUsual, "consumers"> | null,
  roster: readonly string[] | null,
  meId: string | null,
): string[] {
  const people = [...new Set(usual?.consumers ?? [])].filter((id) => roster === null || roster.includes(id));
  if (people.length > 0) return people;
  return meId ? [meId] : [];
}

// ── Log ───────────────────────────────────────────────────────────

/**
 * The sticky button: "Log 1 glass · ₹17.00"; "Pick who had it" when nobody
 * is chosen (a group's item); "Enter how much" while a typed amount is not one.
 */
export function quickLogLabel(input: {
  words: string | null;
  costMinor: number | null;
  currency: string;
  /** Who had it; null for your own pantry's item. */
  consumers: readonly string[] | null;
}): string {
  if (input.consumers !== null && input.consumers.length === 0) return "Pick who had it";
  if (input.words === null) return "Enter how much";
  return input.costMinor === null ? `Log ${input.words}` : `Log ${input.words} · ${formatMinor(input.costMinor, input.currency)}`;
}

/**
 * The request for a quick use: the item page's (`logRequest`) with who had
 * it in the order sent — you first, then the group's order — so the
 * preview's odd paisa lands where the server's does. An amount in one of the
 * item's measures goes as `{ quantity, measure }` ("2" onions), any other in
 * the item's base unit (`{ quantity, unit }`). Your own pantry's item names
 * nobody.
 */
export function quickUseRequest(
  item: Pick<KitchenItem, "dimension" | "pantry">,
  amount: UseAmount | number,
  chosen: Iterable<string>,
  roster: readonly string[],
  meId: string | null,
): UseGroupItemRequest | UsePersonalItemRequest {
  const a: UseAmount = typeof amount === "number" ? { kind: "unit", qtyMilli: amount } : amount;
  const consumers = item.pantry.kind === "personal" ? [] : orderConsumers(chosen, roster, meId);
  return logRequest(item, a.qtyMilli, consumers, a.kind === "measure" ? { measure: a.measure, quantity: a.quantity } : null);
}

// ── Picking the item: the strip and search ────────────────────────

/** The item a usual names. */
export function usualRef(usual: Pick<KitchenUsual, "itemId" | "pantry">): ItemRef {
  return itemRefOf({ id: usual.itemId, pantry: usual.pantry });
}

/** "1 L left · Meera paid", "450 g left · you paid". */
export function leftAndPayer(
  item: Pick<KitchenItem, "qtyLeftMilli" | "dimension" | "displayUnit" | "paidBy">,
  meId: string | null,
  names?: MemberNames | null,
): string {
  return `${leftText(item)} left · ${memberLabelInline(item.paidBy, meId, names)} paid`;
}

export interface PickCard {
  /** The item's `itm_…`. */
  key: string;
  ref: ItemRef;
  name: string;
  /** "Flat 4B", "Personal". */
  pantry: string;
  /** "Usually 1 glass" (a usual), "1 L left · Meera paid" (a match). */
  sub: string;
  /** "750 ml left" (a usual), or null. */
  meta: string | null;
  /** A match carries the item, so picking it shows the card at once. */
  item: KitchenItem | null;
}

/** A usual in the "Recent and usual" strip: "Milk · Flat 4B · Usually 1 glass · 750 ml left". */
export function usualCard(usual: KitchenUsual): PickCard | null {
  if (!isUnit(usual.lastUnit)) return null;
  const dimension = dimensionOf(usual.lastUnit);
  return {
    key: usual.itemId,
    ref: usualRef(usual),
    name: usual.name,
    pantry: pantryLabel(usual.pantry),
    sub: `Usually ${usual.lastLabel ?? amountWords(usual.lastQtyMilli, dimension)}`,
    meta: `${qtyText(usual.qtyLeftMilli, dimension)} left`,
    item: null,
  };
}

/** An item in the strip: a search match, or one of your pantries' (before you have usuals). */
export function matchCard(item: ReachableItem | KitchenItem, ctx: { meId: string | null; names?: MemberNames | null }): PickCard {
  return {
    key: item.id,
    ref: itemRefOf(item),
    name: item.name,
    pantry: pantryLabel(item.pantry),
    sub: leftAndPayer(item, ctx.meId, ctx.names),
    meta: null,
    item,
  };
}

/** Only what the caller may use, with something left (the server asks `usable=1`; this keeps a stale read honest). */
export function usableMatches<T extends ReachableItem>(items: readonly T[]): T[] {
  return items.filter((i) => i.canUse && i.state === "active" && i.qtyLeftMilli > 0);
}

/** "3 matches across your pantries", "1 match across your pantries". */
export function matchesHeading(n: number): string {
  return `${countWords(n, "match", "matches")} across your pantries`;
}

// ── The + Add sheet: Do it again ──────────────────────────────────

/** How many "Do it again" rows the + Add sheet shows. */
export const DO_IT_AGAIN_ROWS = 4;

/** Usuals whose usual amount still fits what is left (as the usuals read says), most used first. */
export function usualsThatFit(usuals: readonly KitchenUsual[]): KitchenUsual[] {
  return usuals.filter((u) => isUnit(u.lastUnit) && u.lastQtyMilli > 0 && u.lastQtyMilli <= u.qtyLeftMilli);
}

export interface DoItAgainRow {
  /** The item's `itm_…`. */
  key: string;
  ref: ItemRef;
  /** "Milk · 1 glass" */
  title: string;
  /** "Flat 4B · you and Anu", "Personal". */
  meta: string;
  /** What it costs now ("₹17.00"); null while the item is read. */
  cost: string | null;
  /** The whole row for a screen reader: "Log 1 glass of Milk for you and Anu in Flat 4B, ₹17.00". */
  label: string;
  qtyMilli: number;
  /** The amount in words, for the toast: "1 glass", "2 onions". */
  words: string;
  /** Given in one of the item's measures (its words name it): logged in it again. */
  measure: { measure: KitchenMeasure; quantity: number } | null;
  /** Who had it, in the order sent (empty for your own pantry). */
  consumers: string[];
  /** The item as read now; the row logs only once it is known. */
  item: KitchenItem | null;
}

/**
 * The + Add sheet's "Do it again": your top usuals, each logged again in one
 * tap — the same amount for the same people — with what it costs now (the
 * engine's `costOfUse` on the item as read now). `items` holds each item as
 * read: missing while it loads (the row shows without a cost and waits),
 * null when it cannot be read (the row is left out). A usual whose amount no
 * longer fits what is left, or whose item is used up, is left out, and the
 * next one takes its place.
 */
export function doItAgainRows(
  usuals: readonly KitchenUsual[],
  items: ReadonlyMap<string, KitchenItem | null>,
  ctx: { meId: string | null; names?: MemberNames | null; limit?: number },
): DoItAgainRow[] {
  const limit = ctx.limit ?? DO_IT_AGAIN_ROWS;
  const out: DoItAgainRow[] = [];
  for (const usual of usuals) {
    if (out.length >= limit) break;
    if (!isUnit(usual.lastUnit) || usual.lastQtyMilli <= 0) continue;
    const item = items.get(usual.itemId);
    if (item === null) continue;
    if (item && (item.state !== "active" || item.pantry.kind !== usual.pantry.kind)) continue;
    const left = item ? item.qtyLeftMilli : usual.qtyLeftMilli;
    // Given in a measure last time ("2 onions"): again in it, taking what it takes now.
    const said = parseLabel(usual.lastLabel, measuresOf(item ?? usual));
    const counted = said && item ? measureAmount(item, said.measure, said.quantity) : null;
    if (said && item && !counted) continue;
    const qtyMilli = counted ? counted.qtyMilli : usual.lastQtyMilli;
    if (qtyMilli > left) continue;
    const dimension = item?.dimension ?? dimensionOf(usual.lastUnit);
    const words = said ? measureLabel(said.quantity, said.measure) : amountWords(usual.lastQtyMilli, dimension);
    const personal = usual.pantry.kind === "personal";
    const pantry = pantryLabel(usual.pantry);
    const people = usual.consumers.length > 0 ? usual.consumers : ctx.meId ? [ctx.meId] : [];
    const consumers = personal ? [] : orderConsumers(people, [], ctx.meId);
    const who = personal ? null : consumersText(consumers, ctx.meId, ctx.names);
    const cost = item ? formatMinor(amountCost(item, qtyMilli), item.currency) : null;
    const name = item?.name ?? usual.name;
    const sentence = personal ? `Log ${words} of ${name} from your pantry` : `Log ${words} of ${name} for ${who} in ${pantry}`;
    out.push({
      key: usual.itemId,
      ref: usualRef(usual),
      title: `${name} · ${words}`,
      meta: [pantry, who].filter(Boolean).join(" · "),
      cost,
      label: cost ? `${sentence}, ${cost}` : sentence,
      qtyMilli,
      words,
      measure: counted ? { measure: counted.measure, quantity: counted.quantity } : null,
      consumers,
      item: item ?? null,
    });
  }
  return out;
}
