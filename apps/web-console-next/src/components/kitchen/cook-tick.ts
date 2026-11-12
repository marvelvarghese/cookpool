/**
 * The cook session's ingredients as tick rows (cookpool-revamp RV-11, the
 * canvas's RvCookLines "Cooking, tick what went in"): RV-10's shared tick row
 * over a session line. Pure, so it is unit-testable.
 *
 * - **The item** the row's amount reads is the line's first read item (its
 *   measures, what is left across all the line's items), the thing just
 *   bought, or — for a line with no item (Always have, not in your kitchen,
 *   items not read yet) — a stand-in of the line's own dimension.
 * - **The grey amount** is the recipe's amount scaled to the session: what
 *   the line's items were matched for (`tickStartAt`). A line counted in a
 *   spoon, a cup or its own word ("2 onions", "1 tbsp") gets that word as a
 *   chip of its own, first, so the grey amount reads as the recipe says.
 * - **A typed amount, or a unit picked,** sets the line's amount (its takes
 *   follow in proportion); clearing it puts the recipe's amount back.
 * - **The tick** is the line's ticked state (`tickLine`): went in. Nothing is
 *   written to the server until Finish, which charges only ticked lines.
 */

import type { KitchenItem, KitchenMeasure } from "@saas/contracts/kitchen";
import { lineQuantity, recipeUnitOf } from "@saas/contracts/kitchen";
import { amountUnits, amountView, type PickItem } from "./amount-picker";
import { AMOUNT_STEPS } from "./item-use";
import { memberLabelInline, type MemberNames } from "./members";
import { shortMoney } from "./from-before";
import { tickAmount, tickStartAt, TICK_EMPTY, type TickAmount, type TickMeta, type TickState } from "./tick-row";
import {
  amountText,
  lineShort,
  lineTakes,
  pluralWord,
  progress,
  sessionCurrency,
  setLineAmount,
  soFarMinor,
  type CookSession,
  type SessionLine,
} from "./cook-session";

/** The most a stand-in item holds: a line with no item is never capped by it. */
const STAND_IN_LEFT = 100_000_000;

/** The recipe-unit chip's measure id (never a server's `msr_…`). */
export const LINE_MEASURE_ID = "msr_recipe_line";

/** The units a stand-in or an item already counts in itself; any other unit (tsp, tbsp, cup, a count word) gets a chip of its own. */
const PLAIN = new Set(["g", "kg", "ml", "L", "pcs"]);

/** What a line's row reads its amount from. */
export interface CookTickItem {
  /** The item the box and its chips read (measures, what is left). */
  item: PickItem;
  /** The recipe's amount scaled to the session, in thousandths of the item's base unit: the grey amount. */
  matchMilli: number;
  /** The line's amount that `matchMilli` is (in the line's own unit's base): typing scales from it. */
  lineBase: number;
  /** The line's own unit as a chip ("m:tbsp"), when it has one; null when it reads in the item's units. */
  lineUnit: string | null;
  /** The real item, for the usual unit kept on the device; null for a stand-in or something just bought. */
  real: KitchenItem | null;
}

function words(unit: string): { one: string; many: string } {
  if (unit === "tsp" || unit === "tbsp") return { one: unit, many: unit };
  if (unit === "cup") return { one: "cup", many: "cups" };
  return { one: unit, many: pluralWord(unit) };
}

/**
 * The line's unit as a measure of the item, when the line is counted in a
 * whole number of halves of it and the item has no chip of that word: so
 * many halves make `matchMilli` exactly.
 */
function lineMeasure(item: PickItem, unit: string, lineBase: number, matchMilli: number): KitchenMeasure | null {
  if (PLAIN.has(unit) || !(matchMilli > 0)) return null;
  const q = lineQuantity(lineBase, unit);
  const halves = Math.round(q * 2);
  if (!(q > 0) || Math.abs(q * 2 - halves) > 1e-9) return null;
  const w = words(unit);
  if (amountUnits(item).some((u) => u.one.toLowerCase() === w.one.toLowerCase())) return null;
  return { id: LINE_MEASURE_ID, one: w.one, many: w.many, count: halves, amountMilli: matchMilli * 2 };
}

function standIn(line: SessionLine, unit: string): PickItem {
  const dimension = recipeUnitOf(unit).dimension;
  return { name: line.name, dimension, qtyLeftMilli: STAND_IN_LEFT, qtyBoughtMilli: 0, displayUnit: AMOUNT_STEPS[dimension].unit, measures: [] };
}

/** What the line's row reads; null for a line to taste (no amount to show). */
export function cookTickItem(line: SessionLine): CookTickItem | null {
  if (line.qtyMilli === null || line.unit === null) return null;
  const lineBase = line.baseMilli !== null && line.baseMilli > 0 ? line.baseMilli : line.qtyMilli;
  if (!(lineBase > 0)) return null;
  let item: PickItem;
  let matchMilli = lineBase;
  let real: KitchenItem | null = null;
  if (line.bought) {
    const b = line.bought;
    item = { name: b.name, dimension: b.dimension, qtyLeftMilli: b.qtyMilli, qtyBoughtMilli: b.qtyMilli, displayUnit: b.unit, measures: [] };
  } else {
    const read = line.takes.find((t) => t.item && !t.gone) ?? line.takes.find((t) => t.item);
    if (read?.item) {
      real = read.item;
      const same = line.takes.filter((t) => t.dimension === read.dimension);
      const left = same.reduce((a, t) => a + (t.gone ? 0 : t.item ? Math.max(0, t.item.qtyLeftMilli) : STAND_IN_LEFT), 0);
      matchMilli = same.reduce((a, t) => a + t.matchMilli, 0);
      item = { ...real, qtyLeftMilli: Math.min(left, STAND_IN_LEFT) };
    } else {
      item = standIn(line, line.unit);
    }
  }
  if (!(matchMilli > 0)) return null;
  const m = lineMeasure(item, line.unit, lineBase, matchMilli);
  if (m) item = { ...item, measures: [m, ...(item.measures ?? [])] };
  return { item, matchMilli, lineBase, lineUnit: m ? `m:${m.one.toLowerCase()}` : null, real };
}

/**
 * The box's state: what the screen holds for the line, else — when the
 * line's amount was changed before (another visit, guided mode's ±) — that
 * amount as typed, so the box shows it over the grey.
 */
export function cookTickState(line: SessionLine, t: CookTickItem, held: TickState | undefined): TickState {
  if (held) return held;
  if (line.qtyMilli === null || line.qtyMilli === t.lineBase) return TICK_EMPTY;
  const nowMilli = Math.round((t.matchMilli * line.qtyMilli) / t.lineBase);
  const seed = tickStartAt(t.item, nowMilli);
  if (!seed) return TICK_EMPTY;
  const number = amountView(t.item, seed, null, null).number.replace(/^≈\s*/, "");
  return { typed: number, unit: seed.unit };
}

/** The box for the line: the grey amount from the recipe (in the line's own unit, else the usual one), and what was typed. */
export function cookTickAmount(t: CookTickItem, state: TickState, usualUnit: string | null = null): TickAmount | null {
  let start = tickStartAt(t.item, t.matchMilli, t.lineUnit ?? usualUnit);
  // In a plain unit picked, the recipe's amount exactly (15 ml), not rounded to the unit's step (50 ml).
  const u = start && state.unit && state.unit !== start.unit ? amountUnits(t.item).find((x) => x.id === state.unit && x.kind === "unit") : undefined;
  if (start && u) {
    const count = Math.round((t.matchMilli / u.perOneMilli) * 1000) / 1000;
    if (count > 0) start = { unit: u.id, count, rest: false, how: "suggested" };
  }
  return tickAmount(t.item, start, state);
}

/**
 * A unit chip picked: the grey amount in that unit when it comes to the same
 * amount, else the same amount typed in it, exactly (1 tbsp → "15" ml, not
 * the 50 ml a step of ml would round it to), so the line keeps its amount.
 */
export function cookUnitChoice(t: CookTickItem, current: TickAmount | null, unitId: string, usualUnit: string | null = null): TickState {
  const grey: TickState = { typed: "", unit: unitId };
  if (!current) return grey;
  const ghost = cookTickAmount(t, grey, usualUnit);
  const u = ghost?.units.find((x) => x.id === unitId);
  if (!ghost || !u || ghost.qtyMilli === current.qtyMilli) return grey;
  const n = Math.round((current.qtyMilli / u.perOneMilli) * 1000) / 1000;
  return n > 0 ? { typed: String(n), unit: unitId } : grey;
}

/**
 * The line at the box's amount: typed, or the grey one in the unit picked.
 * Its takes follow in proportion. The same session when there is nothing to set.
 */
export function setLineFromTick(s: CookSession, key: string, t: CookTickItem, amount: TickAmount | null): CookSession {
  if (!amount || !(amount.qtyMilli > 0)) return s;
  const line = s.lines.find((l) => l.key === key);
  if (!line || line.qtyMilli === null) return s;
  const next = Math.max(1, Math.round((t.lineBase * amount.qtyMilli) / t.matchMilli));
  return next === line.qtyMilli ? s : setLineAmount(s, key, next);
}

/**
 * Where a line comes from, under its name: "Flat 4B · Dev paid", "Mine",
 * "Flat 4B + Mine", "Just got", "Always have", "None left now", and "Not
 * in your kitchen" in the money-you-owe tone; "· short" when its items have
 * less than it wants.
 */
export function cookLineMeta(line: SessionLine, meId: string | null, names?: MemberNames | null): TickMeta {
  if (line.missing) return { text: "Not in your kitchen", tone: "owe" };
  if (line.bought) return { text: "Just got", tone: "muted" };
  if (line.takes.length === 0) return { text: "Always have", tone: "muted" };
  const live = lineTakes(line).filter((t) => t.milli > 0);
  if (live.length === 0) return { text: "None left now", tone: "muted" };
  let text: string;
  const only = live.length === 1 ? live[0]!.take : null;
  if (only?.pantryName && only.item) text = `${only.pantryName} · ${memberLabelInline(only.item.paidBy, meId, names)} paid`;
  else text = [...new Set(live.map((t) => t.take.pantryName ?? "Mine"))].join(" + ");
  return { text: lineShort(line) ? `${text} · short` : text, tone: "muted" };
}

/** A line's amount in words, where there is no box: "To taste", "90 g". */
export function cookLineFixed(line: SessionLine): string {
  return line.qtyMilli !== null && line.unit !== null ? amountText(line.qtyMilli, line.unit) : "To taste";
}

/** The progress bar's width: the share of the lines that can go in that are in, 0–100. */
export function cookTickPercent(s: CookSession): number {
  const p = progress(s);
  return p.of > 0 ? Math.round((p.ticked / p.of) * 100) : 0;
}

/** Under Finish: "₹223 so far · 3 in", or "₹0 · nothing taken from the kitchen" while nothing is in. Only ticked lines count. */
export function cookFinishText(s: CookSession): string {
  const currency = sessionCurrency(s);
  const n = progress(s).ticked;
  if (n === 0) return `${shortMoney(0, currency)} · nothing taken from the kitchen`;
  return `${shortMoney(soFarMinor(s), currency)} so far · ${n} in`;
}

/** The tick's name: "Tick Onions, 2 onions"; once in, "Onions went in, 2 onions, untick". */
export function cookTickLabel(name: string, words: string, done: boolean): string {
  const amount = words.trim();
  if (done) return amount ? `${name} went in, ${amount}, untick` : `${name} went in, untick`;
  return amount ? `Tick ${name}, ${amount}` : `Tick ${name}`;
}
