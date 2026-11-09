/**
 * The amount with unit chips (cookpool-pantry PN-11, the canvas's
 * AmountPicker) as a pure view-model, shared by the open row, the More…
 * sheet's How much and the item page: `− [ amount unit ] +`, the reason under
 * it ("Morning usual", "Changed", "Typed", "The rest"), and the **unit
 * chips** — the item's own measures first (glass, cup, onion), then the
 * plain units of its dimension (ml, L · g, kg · eggs, dozen · pack) — plus
 * The rest.
 *
 * − and + step evenly in the chosen unit: a measure 1 (with ½ below one for
 * a measure of 100 ml or g or more: ½ glass, ½ onion), ml and g 50, L and kg
 * ¼, a piece 1, a dozen ½, a pack ½. Switching unit converts the amount,
 * rounded to that unit's step (2 glasses → 500 ml → ½ L). A typed amount is
 * taken as typed ("1.5", "1½", "¾"), to the unit's grain. The amount never
 * goes above what is left: there it is The rest, and + stops.
 *
 * What it logs is a `UseAmount`: a count of a measure (sent as `measure`) or
 * an amount in the item's base unit (sent as `quantity` + `unit`), through
 * the item page's `logRequest`; how much a measure takes is the server's own
 * `measureTakeMilli` (`takeOf`). Dependency-free, so it is unit-testable.
 */

import type { KitchenItem, KitchenMeasure, UseGroupItemRequest, UsePersonalItemRequest } from "@saas/contracts/kitchen";
import { inMeasure } from "@saas/contracts/kitchen";
import { UNITS, bestUnit, type UnitKey } from "@saas/kitchen-engine/units";
import { logRequest } from "./item-use";
import { evenCount, isApprox, measureAmount, measuresOf, stepCount, takeOf, wordsForName, type UseAmount } from "./measures";
import { qtyText } from "./quick-use";
import type { SetSuggestion } from "./pantry-set";

/** What the amount reads of an item. */
export type PickItem = Pick<KitchenItem, "dimension" | "qtyLeftMilli" | "qtyBoughtMilli" | "displayUnit" | "name"> & {
  measures?: readonly KitchenMeasure[] | undefined;
};

// ── The unit chips ────────────────────────────────────────────────

export interface AmountUnit {
  /** "m:glass" for one of the item's measures, "u:ml" for a plain unit. */
  id: string;
  kind: "measure" | "unit";
  /** The measure, for a measure's chip. */
  measure: KitchenMeasure | null;
  /** The engine's unit, for a plain unit's chip. */
  unit: UnitKey | null;
  /** The word for one and for more: glass / glasses, ml, egg / eggs. */
  one: string;
  many: string;
  /** What − and + move by, counted in this unit (1, 50, ¼, ½). */
  step: number;
  /** The least − goes down to (½ of a big measure, else one step). */
  min: number;
  /** About how many thousandths of the base unit one of it is (a measure's own rounding aside). */
  perOneMilli: number;
}

/** A measure of at least this much (100 ml or g) steps by ½ below one: ½ glass, ½ onion. */
export const HALF_MEASURE_MILLI = 100_000;

/** The plain units each dimension offers after the item's own measures, with their steps. */
export const PLAIN_UNITS: Readonly<Record<KitchenItem["dimension"], readonly { unit: UnitKey; step: number }[]>> = {
  volume: [
    { unit: "ml", step: 50 },
    { unit: "L", step: 0.25 },
  ],
  mass: [
    { unit: "g", step: 50 },
    { unit: "kg", step: 0.25 },
  ],
  count: [
    { unit: "pcs", step: 1 },
    { unit: "dozen", step: 0.5 },
  ],
  pack: [{ unit: "pack", step: 0.5 }],
};

const BASE: Record<KitchenItem["dimension"], UnitKey> = { volume: "ml", mass: "g", count: "pcs", pack: "pack" };

const measureId = (m: Pick<KitchenMeasure, "one">) => `m:${m.one.toLowerCase()}`;

function measureUnit(item: PickItem, m: KitchenMeasure): AmountUnit {
  const perOneMilli = m.amountMilli / m.count;
  const halves = (item.dimension === "mass" || item.dimension === "volume") && perOneMilli >= HALF_MEASURE_MILLI;
  return { id: measureId(m), kind: "measure", measure: m, unit: null, one: m.one, many: m.many, step: 1, min: halves ? 0.5 : 1, perOneMilli };
}

function plainUnit(item: PickItem, unit: UnitKey, step: number): AmountUnit {
  const def = UNITS[unit];
  let one: string = def.singular;
  let many: string = def.plural;
  if (unit === "pcs") {
    // Things you count are counted in their own word ("eggs"), when the name is a plain plural.
    const w = wordsForName(item.name);
    if (w.sure) ({ one, many } = w);
  }
  return { id: `u:${unit}`, kind: "unit", measure: null, unit, one, many, step, min: step, perOneMilli: def.factor * 1000 };
}

/** The bigger plain units (L, kg, dozen) are offered for an item bought in them or at least one of them, while one step of them fits what is left. */
function offersBig(item: PickItem, unit: UnitKey, step: number): boolean {
  const one = UNITS[unit].factor * 1000;
  const fits = step * one <= item.qtyLeftMilli;
  return fits && (item.displayUnit === unit || item.qtyBoughtMilli >= one);
}

/**
 * The unit chips, in order: the item's own measures that at least their
 * least amount of fits what is left, then the plain units of its dimension —
 * the base one always (ml, g, its count word, pack), the bigger ones (L, kg,
 * dozen) for an item bought in them or by at least one of them. A plain unit
 * with a measure's word ("egg") is left out.
 */
export function amountUnits(item: PickItem): AmountUnit[] {
  const out: AmountUnit[] = [];
  for (const m of measuresOf(item)) {
    const u = measureUnit(item, m);
    if (takeOf(item, m, u.min) !== null) out.push(u);
  }
  for (const { unit, step } of PLAIN_UNITS[item.dimension]) {
    if (unit !== BASE[item.dimension] && !offersBig(item, unit, step)) continue;
    const u = plainUnit(item, unit, step);
    if (out.some((x) => x.one.toLowerCase() === u.one.toLowerCase())) continue;
    out.push(u);
  }
  return out;
}

// ── The amount picked ─────────────────────────────────────────────

/** How it got where it is: the suggestion, − or + or a unit switch, typing, or The rest. */
export type PickHow = "suggested" | "changed" | "typed" | "rest";

/** The amount as it stands: so many of a unit, or all that is left. */
export interface AmountPick {
  /** The chip's id ("m:glass", "u:ml"). */
  unit: string;
  /** How many of it (ignored while `rest`). */
  count: number;
  /** All that is left. */
  rest: boolean;
  how: PickHow;
}

function unitOf(units: readonly AmountUnit[], id: string): AmountUnit | null {
  return units.find((u) => u.id === id) ?? null;
}

/** What `count` of `u` takes, in thousandths of the base unit; null when a measure would take more than is left. */
function milliOf(item: PickItem, u: AmountUnit, count: number): number | null {
  if (u.measure) return takeOf(item, u.measure, count);
  return Math.round(count * u.perOneMilli);
}

function atRest(item: PickItem, u: AmountUnit, count: number): boolean {
  const q = milliOf(item, u, count);
  return q === null || q >= item.qtyLeftMilli;
}

/** `count` of `u`, made The rest when it reaches what is left. */
function settle(item: PickItem, u: AmountUnit, count: number, how: PickHow): AmountPick {
  if (atRest(item, u, count)) return { unit: u.id, count: 0, rest: true, how: how === "changed" || how === "typed" ? "rest" : how };
  return { unit: u.id, count, rest: false, how };
}

const roundTo = (n: number, grain: number) => Math.round(n / grain) * grain;
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/** One step up or down from `count`, on the unit's grid (430 g − 50 g → 400 g; ½ ↔ 1 of a big measure). */
function stepIn(u: AmountUnit, count: number, delta: 1 | -1): number {
  if (u.kind === "measure" && u.min < 1) return stepCount(count, delta, Number.MAX_SAFE_INTEGER);
  const k = count / u.step;
  const next = delta > 0 ? Math.floor(clean(k)) + 1 : Math.ceil(clean(k)) - 1;
  return clean(next * u.step);
}

/** The most of `u` on its grid that is still under what is left (− from The rest); 0 when none is. */
function belowRest(item: PickItem, u: AmountUnit): number {
  const raw = item.qtyLeftMilli / u.perOneMilli;
  let n = u.kind === "measure" && u.min < 1 && raw < 1 ? (raw >= 0.5 ? 0.5 : 0) : clean(Math.floor(clean(raw / u.step)) * u.step);
  while (n >= u.min && atRest(item, u, n)) n = stepIn(u, n, -1);
  return n >= u.min ? n : 0;
}

/** `qtyMilli` in `u`, rounded to its step (at least its least amount). */
function convert(u: AmountUnit, qtyMilli: number): number {
  const raw = qtyMilli / u.perOneMilli;
  if (u.kind === "measure" && u.min < 1 && raw < 1) return Math.max(0.5, roundTo(raw, 0.5));
  return Math.max(u.min, clean(roundTo(raw, u.step)));
}

/** How much the pick takes, in thousandths of the item's base unit. */
export function pickQty(item: PickItem, pick: AmountPick): number {
  if (pick.rest) return item.qtyLeftMilli;
  const u = unitOf(amountUnits(item), pick.unit);
  const q = u ? milliOf(item, u, pick.count) : null;
  return q === null ? item.qtyLeftMilli : Math.min(q, item.qtyLeftMilli);
}

/** The unit The rest is shown in to start with: a measure it divides evenly into, else the friendliest plain unit (1.5 L, 300 ml). */
function restUnit(item: PickItem, units: readonly AmountUnit[]): AmountUnit {
  const even = evenCount(item, item.qtyLeftMilli);
  const byMeasure = even ? unitOf(units, measureId(even.measure)) : null;
  if (byMeasure) return byMeasure;
  const best = bestUnit(item.qtyLeftMilli, item.dimension, item.displayUnit);
  return unitOf(units, `u:${best}`) ?? unitOf(units, `u:${BASE[item.dimension]}`) ?? units[0]!;
}

/** An amount in the base unit in a plain unit: L or kg for a whole number of quarters from 1 up, else ml, g, pieces, packs. */
function plainFor(units: readonly AmountUnit[], item: PickItem, qtyMilli: number): { u: AmountUnit; count: number } {
  for (const u of units) {
    if (u.kind !== "unit" || u.unit === BASE[item.dimension] || u.unit === "dozen") continue;
    const n = qtyMilli / u.perOneMilli;
    if (n >= 1 && Number.isInteger(clean(n / u.step))) return { u, count: clean(n) };
  }
  const base = unitOf(units, `u:${BASE[item.dimension]}`)!;
  return { u: base, count: clean(qtyMilli / base.perOneMilli) };
}

/**
 * Where the amount starts: the suggestion (contracts' `suggestUse`, through
 * the set row's ladder) in its own measure when it was given in one — or
 * when it is a whole number of halves of one of the item's measures — else
 * in a plain unit; The rest as The rest; with no suggestion, the first
 * chip's least amount. Null when nothing is left.
 */
export function pickStart(item: PickItem, suggestion: Pick<SetSuggestion, "step"> | null): AmountPick | null {
  const units = amountUnits(item);
  if (item.qtyLeftMilli <= 0 || units.length === 0) return null;
  const step = suggestion?.step ?? null;
  if (!step) return settle(item, units[0]!, units[0]!.min, "suggested");
  if (step.rest) return { unit: restUnit(item, units).id, count: 0, rest: true, how: "suggested" };
  const a = step.amount;
  const counted = a.kind === "measure" ? { measure: a.measure, quantity: a.quantity } : evenCount(item, a.qtyMilli);
  const byMeasure = counted ? unitOf(units, measureId(counted.measure)) : null;
  if (byMeasure && counted) return settle(item, byMeasure, counted.quantity, "suggested");
  const { u, count } = plainFor(units, item, step.qtyMilli);
  return settle(item, u, count, "suggested");
}

/** − (−1) or + (+1): one step in the chosen unit, never under its least amount; reaching what is left is The rest. */
export function pickStep(item: PickItem, pick: AmountPick, delta: 1 | -1): AmountPick {
  const u = unitOf(amountUnits(item), pick.unit);
  if (!u) return pick;
  if (pick.rest) {
    if (delta > 0) return pick;
    const n = belowRest(item, u);
    return n > 0 ? { unit: u.id, count: n, rest: false, how: "changed" } : pick;
  }
  const next = stepIn(u, pick.count, delta);
  if (delta < 0 && next < u.min) return pick;
  return settle(item, u, next, "changed");
}

/** Whether − (−1) or + (+1) moves: + stops at The rest, − at the unit's least amount. */
export function canPickStep(item: PickItem, pick: AmountPick, delta: 1 | -1): boolean {
  if (delta > 0) return !pick.rest;
  const u = unitOf(amountUnits(item), pick.unit);
  if (!u) return false;
  return pick.rest ? belowRest(item, u) > 0 : stepIn(u, pick.count, -1) >= u.min;
}

/** A unit chip: the same amount in that unit, rounded to its step (2 glasses → 500 ml → ½ L); The rest stays The rest. */
export function pickUnit(item: PickItem, pick: AmountPick, unitId: string): AmountPick {
  const u = unitOf(amountUnits(item), unitId);
  if (!u || unitId === pick.unit) return pick;
  if (pick.rest) return { ...pick, unit: u.id };
  const before = pickQty(item, pick);
  const next = settle(item, u, convert(u, before), pick.how);
  if (next.rest) return { ...next, how: pick.how === "suggested" ? "changed" : next.how };
  return pickQty(item, next) === before ? next : { ...next, how: "changed" };
}

/** The dashed chip: all that is left, in the unit chosen. */
export function pickRest(pick: AmountPick): AmountPick {
  return { unit: pick.unit, count: 0, rest: true, how: "rest" };
}

const GLYPHS: Readonly<Record<string, number>> = { "¼": 0.25, "½": 0.5, "¾": 0.75 };

/** A typed amount: "2", "1.5", "1,5", ".5", "½", "1½", "1 ½", "¾", "1/2", "1 1/2" → a number above zero; null for anything else. */
export function parseTyped(text: string): number | null {
  const t = text.trim().replace(",", ".");
  let n: number;
  const frac = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const d = Number(frac[3]);
    if (d === 0) return null;
    n = (frac[1] ? Number(frac[1]) : 0) + Number(frac[2]) / d;
  } else {
    const m = /^(\d*(?:\.\d*)?)\s*([¼½¾])?$/.exec(t);
    if (!m || !/\d/.test(m[1] ?? "") && !m[2]) return null;
    if (m[2] && (m[1] ?? "").includes(".")) return null;
    n = (m[1] && /\d/.test(m[1]) ? Number(m[1]) : 0) + (m[2] ? GLYPHS[m[2]]! : 0);
  }
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** How finely a typed amount is kept: halves of a measure, whole ml / g / pieces, a ml or g of L or kg, a hundredth of a pack, half a dozen. */
function typedGrain(u: AmountUnit): number {
  if (u.kind === "measure") return 0.5;
  switch (u.unit) {
    case "L":
    case "kg":
      return 0.001;
    case "pack":
      return 0.01;
    case "dozen":
      return 0.5;
    default:
      return 1;
  }
}

/** What was typed in the box, in the chosen unit; null when it is not an amount (the box keeps the last one). */
export function pickTyped(item: PickItem, pick: AmountPick, text: string): AmountPick | null {
  const n = parseTyped(text);
  const u = unitOf(amountUnits(item), pick.unit);
  if (n === null || !u) return null;
  const grain = typedGrain(u);
  const count = Math.max(grain, clean(roundTo(n, grain)));
  return settle(item, u, count, "typed");
}

// ── What the box says ─────────────────────────────────────────────

const FRACTIONS: Readonly<Record<number, string>> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

/** A count as the box shows it: "2", "½", "1¾" for quarters, else up to two decimals ("0.3", "433.33"). */
export function countWords(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  const whole = Math.floor(r);
  const frac = Math.round((r - whole) * 1000) / 1000;
  if (frac === 0) return String(whole);
  const glyph = FRACTIONS[frac];
  if (glyph) return whole === 0 ? glyph : `${whole}${glyph}`;
  return String(Math.round(r * 100) / 100);
}

export interface AmountView {
  units: AmountUnit[];
  /** The chosen chip (its `id` is the pick's). */
  unit: AmountUnit;
  /** The number in the box: "2", "½", "1.2"; "≈ 6" for The rest in a measure it doesn't divide into. */
  number: string;
  /** Beside it: "glasses", "L", "eggs". */
  word: string;
  /** Inside a sentence (the button, the toast): "2 glasses", "½ L", "500 ml"; The rest says what is left ("1.5 L"). */
  words: string;
  /** Under the amount: the suggestion's reason, "Changed", "Typed", "The rest"; null for none. */
  reason: string | null;
  /** Under the chips: "Step 1 glass · = 500 ml", "Step 50 ml". */
  hint: string;
  qtyMilli: number;
  rest: boolean;
  canLess: boolean;
  canMore: boolean;
}

function same(a: AmountPick, b: AmountPick | null): boolean {
  return !!b && a.unit === b.unit && a.rest === b.rest && (a.rest || a.count === b.count);
}

/** The reason under the amount: the suggestion's while it is where it started, then "Changed", "Typed" or "The rest". */
export function pickReason(pick: AmountPick, start: AmountPick | null, why: string | null): string | null {
  if (same(pick, start)) return why ?? (pick.rest ? "The rest" : null);
  if (pick.rest) return "The rest";
  if (pick.how === "typed") return "Typed";
  return pick.how === "suggested" ? why : "Changed";
}

/** The box, the chips and the hint for a pick; `start` and `why` are where it started and the suggestion's reason. */
export function amountView(item: PickItem, pick: AmountPick, start: AmountPick | null, why: string | null): AmountView {
  const units = amountUnits(item);
  const unit = unitOf(units, pick.unit) ?? units[0]!;
  const qtyMilli = pickQty(item, pick);
  let n = pick.rest ? qtyMilli / unit.perOneMilli : pick.count;
  let approx = false;
  if (pick.rest && unit.measure) {
    const counted = Math.max(0.5, inMeasure(qtyMilli, unit.measure));
    approx = takeOf(item, unit.measure, counted) !== qtyMilli;
    n = counted;
  }
  const number = `${approx ? "≈ " : ""}${countWords(n)}`;
  const word = n <= 1 ? unit.one : unit.many;
  const words = pick.rest && unit.measure ? qtyText(qtyMilli, item.dimension) : `${countWords(n)} ${word}`;
  const stepText = `Step ${countWords(unit.step)} ${unit.step <= 1 ? unit.one : unit.many}`;
  const base = unit.kind === "unit" && unit.unit === BASE[item.dimension];
  // What it comes to in the base unit, in the item's count word for things counted ("= 6 eggs").
  const pieces = item.dimension === "count" ? unitOf(units, "u:pcs") : null;
  const baseText = pieces ? `${countWords(qtyMilli / 1000)} ${qtyMilli <= 1000 ? pieces.one : pieces.many}` : qtyText(qtyMilli, item.dimension);
  const equals = base ? null : `${unit.measure && isApprox(item.dimension) ? "≈" : "="} ${baseText}`;
  return {
    units,
    unit,
    number,
    word,
    words,
    reason: pickReason(pick, start, why),
    hint: [stepText, equals].filter(Boolean).join(" · "),
    qtyMilli,
    rest: pick.rest,
    canLess: canPickStep(item, pick, -1),
    canMore: canPickStep(item, pick, 1),
  };
}

// ── What is logged ────────────────────────────────────────────────

/** The pick as an amount to log: a count of the measure chosen, else (The rest included) an amount in the base unit. */
export function pickAmount(item: PickItem, pick: AmountPick): UseAmount {
  const qtyMilli = pickQty(item, pick);
  if (!pick.rest) {
    const u = unitOf(amountUnits(item), pick.unit);
    if (u?.measure) {
      const a = measureAmount(item, u.measure, pick.count);
      if (a) return a;
    }
  }
  return { kind: "unit", qtyMilli };
}

/** The pick's amount as `useLogUse` and `useAskToUse` take it. */
export function pickWrite(item: PickItem, pick: AmountPick): { qtyMilli: number; what: string; measure: { measure: KitchenMeasure; quantity: number } | null } {
  const a = pickAmount(item, pick);
  const view = amountView(item, pick, null, null);
  return { qtyMilli: a.qtyMilli, what: a.kind === "measure" ? a.label : view.words, measure: a.kind === "measure" ? { measure: a.measure, quantity: a.quantity } : null };
}

/** The request body the pick logs (the routes' own: `{ quantity, measure }` in a measure, else `{ quantity, unit }` in the base unit). */
export function pickRequest(
  item: PickItem & Pick<KitchenItem, "pantry">,
  pick: AmountPick,
  consumers: readonly string[],
): UseGroupItemRequest | UsePersonalItemRequest {
  const w = pickWrite(item, pick);
  return logRequest(item, w.qtyMilli, consumers, w.measure);
}

// ── Kept on the device (the set row's draft) ──────────────────────

/** A pick as the device keeps it. */
export interface DraftPick {
  unit: string;
  count: number;
  rest: boolean;
  how: PickHow;
}

const HOWS: readonly PickHow[] = ["suggested", "changed", "typed", "rest"];

/** A stored pick, when it is one. */
export function isDraftPick(v: unknown): v is DraftPick {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return typeof d["unit"] === "string" && typeof d["count"] === "number" && Number.isFinite(d["count"]) && typeof d["rest"] === "boolean" && HOWS.includes(d["how"] as PickHow);
}

/** A kept pick, as it applies to the item now: its unit still offered, at most what is left (else The rest); null when its unit is gone. */
export function draftPick(item: PickItem, kept: DraftPick | null | undefined): AmountPick | null {
  if (!kept || item.qtyLeftMilli <= 0) return null;
  const u = unitOf(amountUnits(item), kept.unit);
  if (!u) return null;
  if (kept.rest) return { unit: u.id, count: 0, rest: true, how: kept.how };
  if (kept.count < u.min && kept.how !== "typed") return null;
  if (kept.count <= 0) return null;
  return settle(item, u, kept.count, kept.how);
}
