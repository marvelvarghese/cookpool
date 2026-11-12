/**
 * The tick row (cookpool-revamp RV-10, the canvas's RvKitchen "Tick to log")
 * as a pure view-model, shared by the Kitchen's rows and (RV-11) the cook
 * session's ingredients. A row is three columns: the name with one line
 * under it, the amount box, and the tick.
 *
 * - **The ghost:** the box's placeholder is the usual amount in grey
 *   (`tickStart`: PN-11's `pickStart` from the row's suggestion, or
 *   `tickStartAt` from a plain amount), shown in the usual unit when the
 *   device remembers one for the food.
 * - **Typing** over it sets the amount (`pickTyped`, to the unit's grain);
 *   anything that isn't an amount leaves the ghost in force.
 * - **The unit** is a small button inside the box; its chips are only the
 *   item's own measures and its dimension's plain units (PN-11's
 *   `amountUnits`). Picking one converts the ghost (`pickUnit`), clears what
 *   was typed, and becomes the usual unit (`tickUnitChoice`).
 * - **The tick** logs the amount the box shows (`tickWrite`).
 *
 * Built on amount-picker.ts, so a tick logs exactly what PN-11's picker
 * would. Dependency-free (contract types only), so it is unit-testable.
 */

import type { KitchenItem, KitchenMeasure, KitchenUsual } from "@saas/contracts/kitchen";
import { amountUnits, amountView, countWords, pickStart, pickTyped, pickUnit, pickWrite, type AmountPick, type AmountUnit, type PickItem } from "./amount-picker";
import type { SetSuggestion } from "./pantry-set";
import { amountWords } from "./quick-use";
import { wordsForName } from "./measures";
import { dayAndTimeText, dayText, localDayOffset } from "./when";

// ── What the box holds ────────────────────────────────────────────

/** The row's own state: what was typed, and the unit chosen (null: the ghost's). */
export interface TickState {
  typed: string;
  unit: string | null;
}

export const TICK_EMPTY: TickState = Object.freeze({ typed: "", unit: null }) as TickState;

/**
 * The ghost to start from: the suggestion's amount (PN-11's `pickStart`), in
 * `usualUnit` when the item offers it (converted, rounded to its step).
 * Null when nothing is left.
 */
export function tickStart(item: PickItem, suggestion: Pick<SetSuggestion, "step"> | null, usualUnit: string | null = null): AmountPick | null {
  const start = pickStart(item, suggestion);
  if (!start || !usualUnit || usualUnit === start.unit) return start;
  return amountUnits(item).some((u) => u.id === usualUnit) ? pickUnit(item, start, usualUnit) : start;
}

/**
 * The ghost for a plain amount, in thousandths of the item's base unit (the
 * cook session's scaled recipe amount, RV-11): in one of the item's measures
 * when it is a whole number of halves of one, else in a plain unit.
 */
export function tickStartAt(item: PickItem, qtyMilli: number, usualUnit: string | null = null): AmountPick | null {
  if (!(qtyMilli > 0)) return tickStart(item, null, usualUnit);
  const step = { key: `u:${qtyMilli}`, amount: { kind: "unit" as const, qtyMilli }, qtyMilli, words: "", rest: false };
  return tickStart(item, { step }, usualUnit);
}

/** Keep only what an amount is typed with: digits, a point or comma, ¼ ½ ¾, a slash and spaces. */
export function cleanTyped(text: string): string {
  return text.replace(/[^0-9.,¼½¾/ ]/g, "").slice(0, 12);
}

/** A unit chip picked: the ghost converts, what was typed is cleared, and the unit is kept (it becomes the usual). */
export function tickUnitChoice(_state: TickState, unitId: string): TickState {
  return { typed: "", unit: unitId };
}

/** What the row shows and would log. */
export interface TickAmount {
  /** The chips: only the item's measures and its dimension's plain units. */
  units: AmountUnit[];
  /** The chosen chip. */
  unit: AmountUnit;
  /** The grey placeholder: the usual amount in the chosen unit ("1", "250", "½"). */
  ghost: string;
  /** The ghost in that unit, as a pick. */
  ghostPick: AmountPick;
  /** What a tick logs: the typed amount when it is one, else the ghost. */
  pick: AmountPick;
  /** Something was typed and it is an amount. */
  typed: boolean;
  /** Something was typed that isn't an amount (the ghost stays in force). */
  invalid: boolean;
  /** The number it logs, as the box shows it: "2", "½", "250". */
  number: string;
  /** The unit's word beside the number, for the amount it logs: "glass", "glasses", "g". */
  word: string;
  /** The amount in a sentence: "2 glasses", "250 ml". */
  words: string;
  qtyMilli: number;
}

/** The box for `state`, from the ghost `start`; null when there is nothing to log (no start, no units). */
export function tickAmount(item: PickItem, start: AmountPick | null, state: TickState): TickAmount | null {
  if (!start) return null;
  const units = amountUnits(item);
  if (units.length === 0) return null;
  const ghostPick = state.unit && state.unit !== start.unit && units.some((u) => u.id === state.unit) ? pickUnit(item, start, state.unit) : start;
  const ghostView = amountView(item, ghostPick, null, null);
  const text = state.typed.trim();
  const typedPick = text ? pickTyped(item, ghostPick, text) : null;
  const pick = typedPick ?? ghostPick;
  const view = typedPick ? amountView(item, typedPick, null, null) : ghostView;
  return {
    units,
    unit: ghostView.unit,
    ghost: ghostView.number,
    ghostPick,
    pick,
    typed: typedPick !== null,
    invalid: text !== "" && typedPick === null,
    number: view.number,
    word: view.word,
    words: view.words,
    qtyMilli: view.qtyMilli,
  };
}

/** The amount as `useLogUse` takes it: a count of a measure, else an amount in the base unit (PN-11's `pickWrite`). */
export function tickWrite(item: PickItem, amount: Pick<TickAmount, "pick">): { qtyMilli: number; what: string; measure: { measure: KitchenMeasure; quantity: number } | null } {
  return pickWrite(item, amount.pick);
}

// ── The line under the name ───────────────────────────────────────

export type TickTone = "muted" | "soon" | "expired";

export interface TickMeta {
  /** "1 glass · yesterday, 8:10 pm", "Expired · 100 g left", "50 g · 3 Nov · use by tomorrow". */
  text: string;
  /** Amber for use soon, red once expired. */
  tone: TickTone;
}

/**
 * The last use, when the food has one ("1 glass · yesterday, 8:10 pm"; with
 * the time today and yesterday, the day before that), else null. From the
 * caller's usual for it (its `lastLabel`, else the amount, and `lastUsedAt`).
 */
export function lastUseText(
  usual: Pick<KitchenUsual, "lastQtyMilli" | "lastLabel" | "lastUsedAt"> | null | undefined,
  item: Pick<KitchenItem, "dimension" | "name">,
  now: Date,
): string | null {
  if (!usual || !(usual.lastQtyMilli > 0)) return null;
  const amount = usual.lastLabel ?? countedWords(usual.lastQtyMilli, item) ?? amountWords(usual.lastQtyMilli, item.dimension);
  const at = new Date(usual.lastUsedAt);
  if (Number.isNaN(at.getTime())) return amount;
  const near = localDayOffset(at, now) >= -1;
  const when = near ? dayAndTimeText(usual.lastUsedAt, now) : dayText(usual.lastUsedAt, now);
  return when ? `${amount} · ${when}` : amount;
}

/** Pieces in the item's own word, when its name is a plain plural: "2 eggs", "1 egg". */
function countedWords(qtyMilli: number, item: Pick<KitchenItem, "dimension" | "name">): string | null {
  if (item.dimension !== "count") return null;
  const w = wordsForName(item.name);
  if (!w.sure) return null;
  const n = qtyMilli / 1000;
  return `${countWords(n)} ${n <= 1 ? w.one : w.many}`;
}

/**
 * The row's line: expired says so first, with what is left; use soon adds
 * its day to the last use; otherwise the last use, or what is left when it
 * has never been used.
 */
export function tickMeta(input: {
  last: string | null;
  /** What is left, as the row says it ("1 L of 2 L"). */
  left: string;
  expired: boolean;
  soon: boolean;
  /** "today", "tomorrow", "Tue". */
  useBy: string | null;
}): TickMeta {
  if (input.expired) return { text: `Expired · ${input.left}`, tone: "expired" };
  if (input.soon) return { text: [input.last ?? input.left, input.useBy ? `use by ${input.useBy}` : null].filter(Boolean).join(" · "), tone: "soon" };
  return { text: input.last ?? input.left, tone: "muted" };
}

// ── The usual unit, kept per food ─────────────────────────────────

/** The key a food's usual unit is kept under: its pantry, its name (case-insensitive) and its dimension, as measures are. */
export function usualUnitKey(item: Pick<KitchenItem, "pantry" | "name" | "dimension">): string {
  const pantry = item.pantry.kind === "group" ? item.pantry.orgId : "me";
  return `${pantry}:${item.name.trim().toLowerCase()}:${item.dimension}`;
}

/** The kept units, when the stored text is them: `{ key: unitId }`, unit ids only ("m:glass", "u:ml"). */
export function parseUsualUnits(raw: string | null): Readonly<Record<string, string>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string" && /^[mu]:/.test(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** The most foods whose usual unit is kept; the oldest go first. */
export const USUAL_UNITS_MAX = 200;

/** `units` with `key`'s unit set (moved to the end, the newest), at most USUAL_UNITS_MAX. Never mutates `units`. */
export function putUsualUnit(units: Readonly<Record<string, string>>, key: string, unitId: string): Record<string, string> {
  const entries = Object.entries(units).filter(([k]) => k !== key);
  entries.push([key, unitId]);
  return Object.fromEntries(entries.slice(-USUAL_UNITS_MAX));
}

// ── The section's count ───────────────────────────────────────────

/** The heading's right side: "2 logged"; empty while none is. */
export function tickLoggedText(n: number): string {
  return n > 0 ? `${n} logged` : "";
}
