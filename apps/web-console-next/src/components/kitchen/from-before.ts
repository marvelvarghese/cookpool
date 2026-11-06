/**
 * "From before" (cookpool-simpler SM-9, design §3, rule 7) as pure
 * view-models: the type-ahead under the name on Bought and on Cook — what it
 * asks the history and recipes reads (SM-8), what each suggestion says
 * ("Milk · 1 L · Flat 4B · 6× · ₹68"), how the arrow keys move through it,
 * and what picking one fills: the Add-item form from an `ItemHistoryEntry`, the
 * dish from a `Recipe` (each ingredient matched to an item usable now, or "Not
 * in a pantry · add it"). Dependency-free (contract types and the engine), so
 * it is unit-testable; the reads themselves are `from-before-data.ts`.
 */

import type { ItemHistoryEntry, KitchenItem, MyGroupBalance, Pantry, Recipe, RecipeIngredient } from "@saas/contracts/kitchen";
import { formatQuantity, isUnit, type Dimension, type UnitKey } from "@saas/kitchen-engine/units";
import { MAX_MINOR, formatMinor, minorToInput } from "./money";
import { ITEM_CATEGORY_LABELS, PERSONAL_LABEL, PERSONAL_PANTRY, pantryKey, parseItemRef, type ItemRef } from "./pantry";
import { MORE_UNITS, type ItemForm } from "./item-form";
import { JUST_ME, MAX_PORTIONS, cookingGroups, lineInEvenMeasure, portionsText, type DishLine, type NewItemDraft, type NewLine, type PantryLine } from "./dish-maker";

/** How long the type-ahead waits after a keystroke before it asks. */
export const FROM_BEFORE_DEBOUNCE_MS = 120;
/** How many suggestions it lists (rows of 44 px: the list fits above a phone's keyboard). */
export const FROM_BEFORE_LIMIT = 5;
/** How long an answer is reused: retyping a prefix answers from the cache (a write refreshes it). */
export const FROM_BEFORE_STALE_MS = 5 * 60_000;
/** The reads match at most this much of what was typed. */
export const FROM_BEFORE_Q_MAX = 100;

/**
 * What a read asks for: trimmed, inner spaces collapsed, ASCII letters folded
 * (the server's `lower()` folds only those, so "Mi" and "mi" are one answer
 * and one cache entry), at most 100 characters.
 */
export function fromBeforeTerm(typed: string): string {
  return typed
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .slice(0, FROM_BEFORE_Q_MAX);
}

/** "₹68", "₹249.50": the engine's money without a whole number's ".00". */
export function shortMoney(minor: number, currency: string): string {
  return formatMinor(minor, currency).replace(/\.00$/, "");
}

/** "6×" */
export function timesText(times: number): string {
  return `${times}×`;
}

// ── One suggestion, as the list shows it ─────────────────────────

export interface SuggestionView {
  key: string;
  /** "Milk" */
  name: string;
  /** "1 L · Flat 4B · 6×" */
  meta: string;
  /** "₹68", at the end of the row. */
  price: string;
  /** The whole line, as one: "Milk · 1 L · Flat 4B · 6× · ₹68". */
  label: string;
}

function view(key: string, name: string, meta: readonly string[], price: string): SuggestionView {
  const m = meta.join(" · ");
  return { key, name, meta: m, price, label: [name, m, price].filter(Boolean).join(" · ") };
}

/** "Milk · 1 L · Flat 4B · 6× · ₹68": last time's amount, pantry and price, and how often. */
export function historySuggestion(entry: ItemHistoryEntry): SuggestionView {
  return view(
    `h:${entry.name.toLowerCase()}`,
    entry.name,
    [formatQuantity(entry.qtyMilli, entry.dimension, entry.unit), entry.pantry.kind === "personal" ? PERSONAL_LABEL : entry.pantry.name, timesText(entry.times)],
    shortMoney(entry.priceMinor, entry.currency),
  );
}

/** "Egg fried rice · 3× · 5 portions · ₹156": how often, last time's portions and what it cost. */
export function recipeSuggestion(recipe: Recipe): SuggestionView {
  const portions = portionsText(recipe.portionsHalf);
  return view(
    `r:${recipe.name.toLowerCase()}`,
    recipe.name,
    [timesText(recipe.times), `${portions} ${portions === "1" ? "portion" : "portions"}`],
    shortMoney(recipe.totalMinor, recipe.currency),
  );
}

/**
 * What the list shows while someone types: the answer narrowed to names that
 * contain what is typed now — so each keystroke narrows it at once, before the
 * next answer arrives. An answer that is not for this text yet (`fresh`
 * false: a previous one kept while the next loads, or the debounce still
 * waiting) stays as it is when nothing in it matches, so the list never
 * flashes empty between keystrokes.
 */
export function shownSuggestions<T extends { name: string }>(answer: readonly T[] | null | undefined, typed: string, fresh: boolean): T[] {
  if (!answer) return [];
  const term = fromBeforeTerm(typed).toLowerCase();
  const narrow = term === "" ? [...answer] : answer.filter((s) => s.name.toLowerCase().includes(term));
  return narrow.length > 0 || fresh ? narrow : [...answer];
}

// ── The keyboard ──────────────────────────────────────────────────

export interface TypeaheadState {
  open: boolean;
  /** The highlighted suggestion, or -1 for none. */
  active: number;
}

export const TYPEAHEAD_CLOSED: TypeaheadState = { open: false, active: -1 };

export interface TypeaheadKeyResult {
  state: TypeaheadState;
  /** The suggestion Enter picked, or null. */
  pick: number | null;
  /** The key was the list's (prevent its default: the caret, a submit). */
  handled: boolean;
}

/**
 * ↓ and ↑ move through the `count` suggestions (round from the last to the
 * first, and opening the list when it is closed), Enter picks the highlighted
 * one, Esc closes. Enter with nothing highlighted, and Esc with the list
 * closed, are left to the page (the form submits; a dialog closes).
 */
export function typeaheadKey(state: TypeaheadState, key: string, count: number): TypeaheadKeyResult {
  const none = { state, pick: null, handled: false };
  switch (key) {
    case "ArrowDown": {
      if (count === 0) return { state: { open: true, active: -1 }, pick: null, handled: true };
      const active = state.open ? (state.active + 1) % count : 0;
      return { state: { open: true, active }, pick: null, handled: true };
    }
    case "ArrowUp": {
      if (count === 0) return { state: { open: true, active: -1 }, pick: null, handled: true };
      const active = state.open && state.active > 0 ? state.active - 1 : count - 1;
      return { state: { open: true, active }, pick: null, handled: true };
    }
    case "Enter":
      if (state.open && state.active >= 0 && state.active < count) return { state: TYPEAHEAD_CLOSED, pick: state.active, handled: true };
      return none;
    case "Escape":
      return state.open ? { state: TYPEAHEAD_CLOSED, pick: null, handled: true } : none;
    default:
      return none;
  }
}

// ── Waiting for the typing to pause ───────────────────────────────

export interface Debounce<T> {
  /** A new value: wait `ms` more (or settle now, when `now` says so). */
  push(value: T): void;
  cancel(): void;
}

/** The clock a debounce waits on (the browser's, or a test's). */
export interface DebounceTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const BROWSER_TIMERS: DebounceTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Settle on a value once it has been still for `ms` — each `push` restarts the
 * wait, so typing "m", "i" quickly asks once, for "mi". `now(value)` settles
 * at once (an emptied field shows the most recent without waiting).
 */
export function createDebounce<T>(
  ms: number,
  settle: (value: T) => void,
  now: (value: T) => boolean = () => false,
  timers: DebounceTimers = BROWSER_TIMERS,
): Debounce<T> {
  let timer: unknown = null;
  const cancel = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  return {
    push(value: T) {
      cancel();
      if (now(value)) {
        settle(value);
        return;
      }
      timer = timers.set(() => {
        timer = null;
        settle(value);
      }, ms);
    },
    cancel,
  };
}

// ── Bought: filling the Add-item form ─────────────────────────────

/** A calendar date `days` later (or earlier): "2026-01-30" + 3 → "2026-02-02". */
export function addDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A price as the input takes it: 6800 → "68", 24950 → "249.50". */
export function priceInput(minor: number): string {
  return minorToInput(minor).replace(/\.00$/, "");
}

/** A quantity as the input takes it: 1 → "1", 0.5 → "0.5", 1.25 → "1.25" (three decimals at most). */
export function quantityInput(quantity: number): string {
  return quantity.toFixed(3).replace(/\.?0+$/, "");
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryFillContext {
  /** The person's calendar date. */
  today: string;
  /** The pantries the form can add to (your own, and groups where you add). */
  pantries: readonly Pantry[];
  /** The form's normal default pantry, for when last time's is not one of them. */
  fallbackPantry: string;
  meId: string | null;
}

export interface HistoryFill {
  form: ItemForm;
  /** The unit is a cooking measure: show the units behind "more". */
  moreUnits: boolean;
  /** Last time's pantry is not one you add to any more (you view it, or left it): the default stands. */
  pantryFellBack: boolean;
}

/**
 * Picking a name bought before fills the form from last time: the name as it
 * was spelled, its category, quantity and unit, the price, the pantry, who
 * paid, the waste rule, and a use-by as many days after buying as last time
 * (none when it had none). The day bought stays as the form has it (today).
 *
 * Last time's pantry may be a group you can no longer add to (you only view
 * it, or you left): the form's default pantry takes its place and the rest is
 * kept — except the price, when the pantry it falls back to counts in
 * another currency (a number in dollars is not a price in rupees).
 */
export function historyFill(entry: ItemHistoryEntry, form: ItemForm, ctx: HistoryFillContext): HistoryFill {
  const wanted = entry.pantry.kind === "personal" ? PERSONAL_PANTRY : entry.pantry.orgId;
  const known = ctx.pantries.some((p) => pantryKey(p) === wanted);
  const pantry = known ? wanted : ctx.fallbackPantry;
  const target = ctx.pantries.find((p) => pantryKey(p) === pantry) ?? null;
  const sameCurrency = target === null || target.currency === entry.currency;
  const unitKnown = isUnit(entry.unit);
  const unit = unitKnown ? (entry.unit as UnitKey) : form.unit;
  const from = ISO_DAY_RE.test(form.boughtOn) ? form.boughtOn : ctx.today;
  return {
    form: {
      ...form,
      name: entry.name,
      category: Object.prototype.hasOwnProperty.call(ITEM_CATEGORY_LABELS, entry.category) ? entry.category : form.category,
      quantity: unitKnown ? quantityInput(entry.quantity) : form.quantity,
      unit,
      price: sameCurrency ? priceInput(entry.priceMinor) : "",
      expiresOn: entry.useByDays === null ? "" : addDays(from, Math.max(0, entry.useByDays)),
      pantry,
      paidBy: pantry === PERSONAL_PANTRY ? ctx.meId : entry.paidBy,
      waste: entry.wastePolicy ?? "group",
    },
    moreUnits: MORE_UNITS.includes(unit),
    pantryFellBack: !known,
  };
}

// ── Cook: filling the dish from a recipe ──────────────────────────

/** An ingredient from last time with nothing to take it from now: "Not in a pantry · add it". */
export interface MissingIngredient {
  key: string;
  name: string;
  /** What went in last time (thousandths of the base unit). */
  qtyMilli: number;
  dimension: Dimension;
  /** The unit it was entered in, when the app knows it. */
  unit: UnitKey | null;
}

/** An ingredient matched to an item the usable-items list does not hold (it lists 100): read the item itself. */
export interface PendingIngredient {
  key: string;
  /** Its place in the recipe. */
  index: number;
  ingredient: RecipeIngredient;
  /** The matched item, to read. */
  ref: ItemRef;
}

export interface RecipeFill {
  name: string;
  portionsHalf: number;
  extrasMinor: number;
  /**
   * Who it is for: the group it was shared with, while you still cook in it;
   * just you for a dish last time only its cook ate (no group); null to keep
   * the form's own choice (the group is not one you cook in any more).
   */
  share: string | null;
  /** Matched ingredients, at last time's amount (never more than is left), in the cook's order. */
  lines: PantryLine[];
  pending: PendingIngredient[];
  missing: MissingIngredient[];
}

function missingOf(ingredient: RecipeIngredient, index: number): MissingIngredient {
  return {
    key: `missing:${index}:${ingredient.name.toLowerCase()}`,
    name: ingredient.name,
    qtyMilli: ingredient.qtyMilli,
    dimension: ingredient.dimension,
    unit: isUnit(ingredient.unit) ? (ingredient.unit as UnitKey) : null,
  };
}

/** Last time's amount of an ingredient from `item` (what is left, when less); null when the item can't take it. */
export function ingredientLine(ingredient: Pick<RecipeIngredient, "qtyMilli" | "dimension">, item: KitchenItem): PantryLine | null {
  if (item.state !== "active" || item.qtyLeftMilli <= 0 || item.dimension !== ingredient.dimension) return null;
  return { kind: "pantry", key: item.id, item, qtyMilli: Math.min(Math.max(ingredient.qtyMilli, 1), item.qtyLeftMilli) };
}

/**
 * Picking a dish cooked before fills the dish maker from its newest time:
 * the portions, the extras, who it was for, and each ingredient — one with a
 * `match` comes from that item (looked up in `usable`, the cook page's list,
 * for its price) at last time's amount; a match the list does not hold is
 * `pending` (read it, rather than guess its price); one with no match, or
 * whose item has nothing left now, is `missing` and stays out of the dish
 * until it is added. Two ingredients from the same item go in as one.
 */
export function recipeFill(
  recipe: Recipe,
  ctx: { usable: ReadonlyMap<string, KitchenItem>; groups: readonly MyGroupBalance[] },
): RecipeFill {
  const lines: PantryLine[] = [];
  const pending: PendingIngredient[] = [];
  const missing: MissingIngredient[] = [];
  recipe.ingredients.forEach((ingredient, index) => {
    const match = ingredient.match;
    if (!match) {
      missing.push(missingOf(ingredient, index));
      return;
    }
    const item = ctx.usable.get(match.itemId);
    if (!item) {
      const ref = parseItemRef(match.ref);
      if (ref) pending.push({ key: `pending:${index}:${match.itemId}`, index, ingredient, ref });
      else missing.push(missingOf(ingredient, index));
      return;
    }
    const line = ingredientLine(ingredient, item);
    if (!line) {
      missing.push(missingOf(ingredient, index));
      return;
    }
    const twin = lines.findIndex((l) => l.key === line.key);
    if (twin >= 0) {
      const prev = lines[twin]!;
      lines[twin] = { ...prev, qtyMilli: Math.min(prev.qtyMilli + line.qtyMilli, item.qtyLeftMilli) };
    } else {
      lines.push(line);
    }
  });
  const cooking = cookingGroups(ctx.groups);
  const share = recipe.orgId === null ? JUST_ME : cooking.some((g) => g.orgId === recipe.orgId) ? recipe.orgId : null;
  return {
    name: recipe.name,
    portionsHalf: Math.min(Math.max(recipe.portionsHalf, 1), MAX_PORTIONS * 2),
    extrasMinor: Math.min(Math.max(recipe.extrasMinor, 0), MAX_MINOR),
    share,
    // Amounts arrive in the item's unit: in its measure when they divide evenly to a half (SM-14).
    lines: lines.map(lineInEvenMeasure),
    pending,
    missing,
  };
}

/**
 * Pending ingredients once their items are read: each from the usable-items
 * list or its own read (`read`, by `itm_…`: the item, or null when it can't be
 * read any more) becomes a line at last time's amount, or missing when there
 * is nothing left of it; one still being read stays pending.
 */
export function resolvePending(
  pending: readonly PendingIngredient[],
  ctx: { usable: ReadonlyMap<string, KitchenItem>; read: ReadonlyMap<string, KitchenItem | null> },
): { lines: PantryLine[]; pending: PendingIngredient[]; missing: MissingIngredient[] } {
  const lines: PantryLine[] = [];
  const still: PendingIngredient[] = [];
  const missing: MissingIngredient[] = [];
  for (const p of pending) {
    const item = ctx.usable.get(p.ref.itemId) ?? ctx.read.get(p.ref.itemId);
    if (item === undefined) {
      still.push(p);
      continue;
    }
    const line = item === null ? null : ingredientLine(p.ingredient, item);
    if (line) lines.push(lineInEvenMeasure(line));
    else missing.push(missingOf(p.ingredient, p.index));
  }
  return { lines, pending: still, missing };
}

/**
 * The dish's lines after a pick: the lines the previous pick put in are
 * replaced by this one's; what the cook added by hand stays (an item already
 * in the dish keeps its amount). `keys` are the lines this pick added.
 */
export function mergeRecipeLines(
  current: readonly DishLine[],
  previousKeys: ReadonlySet<string>,
  next: readonly PantryLine[],
): { lines: DishLine[]; keys: Set<string> } {
  const kept = current.filter((l) => !previousKeys.has(l.key));
  const keys = new Set<string>();
  const lines: DishLine[] = [...kept];
  for (const line of next) {
    if (lines.some((l) => l.key === line.key)) continue;
    lines.push(line);
    keys.add(line.key);
  }
  return { lines, keys };
}

const DIMENSION_UNIT: Record<Dimension, UnitKey> = { mass: "g", volume: "ml", count: "pcs", pack: "pack" };

/** The inline "Bought it just now?" form for a missing ingredient: its name, in last time's unit; how much and the price are what you bought now. */
export function missingDraft(missing: MissingIngredient): NewItemDraft {
  return { name: missing.name, quantity: "", unit: missing.unit ?? DIMENSION_UNIT[missing.dimension], price: "" };
}

/** The missing ingredient a just-bought line is for (by name, case aside), or null. */
export function missingFor(line: Pick<NewLine, "name">, missing: readonly MissingIngredient[]): MissingIngredient | null {
  const name = line.name.trim().toLowerCase();
  return missing.find((m) => m.name.trim().toLowerCase() === name) ?? null;
}

/** A just-bought line for a missing ingredient takes last time's amount (not all of it), when it can. */
export function newLineFromMissing(line: NewLine, missing: MissingIngredient): NewLine {
  if (line.dimension !== missing.dimension) return line;
  return { ...line, useMilli: Math.min(Math.max(missing.qtyMilli, 1), line.qtyMilli) };
}
