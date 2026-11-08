/**
 * A recipe on screen (cookpool-recipes RC-5, design §3, the canvas's
 * `Recipe`): where its pages are, how its amounts read, and the "How much"
 * card's arithmetic — the main item and the portions, both setting one
 * factor (`factorMilli`), so they stay linked — then each line at that
 * factor, with what your pantries hold for it (the match, §3.3).
 *
 * Every amount is the contracts' own: `scaleLine` rounds a line exactly as
 * the server does, `scalePortions` says "about 2", and `factorForMain` /
 * `factorForPortions` turn a main amount or a portion count into a factor.
 *
 * Pure and dependency-free (contract types and helpers, the engine's unit
 * words), so it is unit-testable.
 */

import {
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_MIN_FACTOR_MILLI,
  SYSTEM_RECIPE_OWNER,
  factorForMain,
  factorForPortions,
  recipeUnitOf,
  scaleLine,
  scalePortions,
  type KitchenRecipe,
  type KitchenRecipeLine,
  type RecipeLineMatch,
  type RecipeLineStatus,
  type RecipeMatchItem,
  type RecipeMatchResponse,
  type RecipeMatchSummary,
  type RecipeSummary,
  type RecipeVisibility,
  type ScaledPortions,
} from "@saas/contracts/kitchen";
import { UNITS, isUnit } from "@saas/kitchen-engine/units";
import { pluralOf } from "./measures";

// ── Where things are ──────────────────────────────────────────────

/** Writing a recipe. */
export const NEW_RECIPE_HREF = "/recipes/new";

/** A recipe's page. */
export function recipeHref(recipeId: string): string {
  return `/recipes/${encodeURIComponent(recipeId)}`;
}

/** Editing it (its owner). */
export function recipeEditHref(recipeId: string): string {
  return `${recipeHref(recipeId)}/edit`;
}

/** A recipe as an address names it (`rcp_…`), else null. */
export function parseRecipeRef(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return /^rcp_[A-Za-z0-9]+$/.test(value) ? value : null;
}

/** A blank cooking session (RC-6's page). */
export const BLANK_SESSION_HREF = "/cook/session";

/** The written factor: × 1. */
export const WRITTEN_FACTOR = 1000;

/** A factor kept in the range a recipe scales over (× 0.01 to × 20), in whole thousandths. */
export function clampFactor(factorMilli: number): number {
  if (!Number.isFinite(factorMilli)) return WRITTEN_FACTOR;
  return Math.min(RECIPE_MAX_FACTOR_MILLI, Math.max(RECIPE_MIN_FACTOR_MILLI, Math.round(factorMilli)));
}

/**
 * Start cooking (design §4.5): a blank session, or one from a recipe at a
 * factor — `/cook/session?recipe=rcp_…&f=450`, `f` in thousandths.
 */
export function sessionHref(recipeId?: string | null, factorMilli: number = WRITTEN_FACTOR): string {
  if (!recipeId) return BLANK_SESSION_HREF;
  return `${BLANK_SESSION_HREF}?recipe=${encodeURIComponent(recipeId)}&f=${clampFactor(factorMilli)}`;
}

// ── Amounts ───────────────────────────────────────────────────────

/** A count in halves: "½", "1", "1½", "2". */
export function halvesText(halves: number): string {
  const h = Math.max(0, Math.round(halves));
  const whole = Math.floor(h / 2);
  const half = h % 2 === 1 ? "½" : "";
  return whole === 0 ? half || "0" : `${whole}${half}`;
}

/** At most `places` decimals, without trailing zeros: 1.05, 1.5, 2. */
function decimals(value: number, places: number): string {
  return String(Number(value.toFixed(places)));
}

/** The first letter in lower case: "Chicken" → "chicken" ("Missing yogurt"). */
export function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** The first letter in capitals. */
export function upperFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * An amount in a line's unit, as the screen says it: "450 g", "1.05 kg"
 * (grams and millilitres from 1000 read in kg and L), "0.75 kg", "1½ tsp",
 * "1 cup", "2 cups", "1 pc", "2 onions". `milli` is thousandths of the
 * unit's base (grams, millilitres, pieces), as a line's `qtyMilli` is.
 */
export function amountText(milli: number, unit: string): string {
  const base = milli / 1000;
  switch (unit) {
    case "g":
    case "ml":
      if (base >= 1000) return `${decimals(base / 1000, 2)} ${unit === "g" ? "kg" : "L"}`;
      return `${decimals(base, base < 10 ? 1 : 0)} ${unit}`;
    case "kg":
    case "L":
      return `${decimals(base / 1000, 2)} ${unit}`;
    default: {
      const n = base / recipeUnitOf(unit).factor;
      const text = Number.isInteger(n * 2) ? halvesText(n * 2) : decimals(n, 1);
      const one = n <= 1;
      const word = isUnit(unit) ? (one ? UNITS[unit].singular : UNITS[unit].plural) : one ? unit : pluralOf(unit);
      return `${text} ${word}`;
    }
  }
}

/** A line's amount at a factor ("450 g", "2 onions"), or "To taste". */
export function lineAmountText(line: Pick<KitchenRecipeLine, "qtyMilli" | "unit" | "toTaste">, factorMilli: number): string {
  if (line.toTaste || line.qtyMilli === null || line.unit === null) return "To taste";
  const scaled = scaleLine(line.qtyMilli, line.unit, factorMilli);
  return scaled === null ? "To taste" : amountText(scaled, line.unit);
}

/** "45 min", "1 h", "1 h 15 min". */
export function minutesText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A person's first name ("Anu Thomas" → "Anu"), else the name, else null. */
export function firstNameOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

/** The three ways a recipe can be seen (design §5.1), as You lists them. */
export const VISIBILITY_WORDS: Readonly<Record<RecipeVisibility, string>> = {
  only_me: "Only me",
  groups: "My groups",
  link: "Anyone with the link",
};

/** "from Anu" for a copy (design §5.2), "from Cookpool" for a copy of Cookpool's own; null otherwise. */
export function fromText(recipe: Pick<RecipeSummary, "source">): string | null {
  if (!recipe.source) return null;
  return `from ${firstNameOf(recipe.source.ownerName) ?? "someone"}`;
}

// ── The header ────────────────────────────────────────────────────

/**
 * Who a recipe is from, under its title: "by Cookpool" for Cookpool's own;
 * "from Anu" (with Anu's face) for a copy you saved; "by Anu" (with her face)
 * for someone else's you can see; nothing for one you wrote.
 */
export type RecipeByline =
  | { kind: "cookpool"; text: string }
  | { kind: "person"; text: string; subjectId: string; name: string | null }
  | { kind: "none" };

export function recipeByline(recipe: Pick<RecipeSummary, "isSystem" | "mine" | "source" | "ownerId" | "ownerName">): RecipeByline {
  if (recipe.isSystem) return { kind: "cookpool", text: "by Cookpool" };
  const source = recipe.source;
  if (source) {
    const text = fromText(recipe) ?? "from someone";
    if (!source.ownerId || source.ownerId === SYSTEM_RECIPE_OWNER) return { kind: "cookpool", text };
    return { kind: "person", text, subjectId: source.ownerId, name: source.ownerName };
  }
  if (!recipe.mine) {
    return { kind: "person", text: `by ${firstNameOf(recipe.ownerName) ?? "someone"}`, subjectId: recipe.ownerId, name: recipe.ownerName };
  }
  return { kind: "none" };
}

/** Its owner may change it: theirs, and not Cookpool's own. */
export function canEditRecipe(recipe: Pick<RecipeSummary, "mine" | "isSystem">): boolean {
  return recipe.mine && !recipe.isSystem;
}

// ── How much: the main item and the portions (design §3.2) ────────

/** The line that scales every other (one per recipe, never to taste). */
export function mainLineOf(recipe: Pick<KitchenRecipe, "lines">): (KitchenRecipeLine & { qtyMilli: number; unit: string }) | null {
  const line = recipe.lines.find((l) => l.isMain && !l.toTaste && l.qtyMilli !== null && l.unit !== null);
  return (line as (KitchenRecipeLine & { qtyMilli: number; unit: string }) | undefined) ?? null;
}

/** The main line's amount at a factor, rounded by its unit (`scaleLine`). */
export function mainAmountMilli(line: { qtyMilli: number; unit: string }, factorMilli: number): number {
  return scaleLine(line.qtyMilli, line.unit, factorMilli) ?? line.qtyMilli;
}

/** Thousandths of a gram (or millilitre) in one gram. */
const GRAM = 1000;

/** Grams and millilitres, and kg and L (whose base is grams and millilitres too). */
function isWeightUnit(unit: string): boolean {
  return unit === "g" || unit === "ml" || unit === "kg" || unit === "L";
}

/**
 * What − and + on the main item step by, from `current` in the direction
 * asked: 50 g (or ml; kg and L too, as 0.05) — 10 g under 100 g, so a small
 * main item can still be set — and ½ of the unit for pieces, spoons, cups and
 * count words.
 */
export function mainStepMilli(unit: string, current: number, direction: 1 | -1): number {
  if (isWeightUnit(unit)) {
    const small = direction > 0 ? current < 100 * GRAM : current <= 100 * GRAM;
    return (small ? 10 : 50) * GRAM;
  }
  return recipeUnitOf(unit).factor * 500;
}

/**
 * The factor after one step of the main item: its amount moves to the next
 * step on its grid (450 g → 500 g, 437 g → 450 g; down: 500 g → 450 g), and
 * the factor follows (`factorForMain`). Never below one step; within the
 * factor's range. The same factor back when it cannot move.
 */
export function stepMain(recipe: Pick<KitchenRecipe, "lines">, factorMilli: number, direction: 1 | -1): number {
  const main = mainLineOf(recipe);
  if (!main) return factorMilli;
  const current = mainAmountMilli(main, factorMilli);
  const step = mainStepMilli(main.unit, current, direction);
  const next = direction > 0 ? (Math.floor(current / step) + 1) * step : (Math.ceil(current / step) - 1) * step;
  if (next < step) return factorMilli;
  const f = clampFactor(factorForMain(main.qtyMilli, next));
  return mainAmountMilli(main, f) === current ? factorMilli : f;
}

/** Exact portions at a factor, in halves (a float). */
function exactHalves(servesHalf: number, factorMilli: number): number {
  return (servesHalf * factorMilli) / 1000;
}

/**
 * The factor after one step of the portions: to the next whole portion up or
 * down ("about 2.3" → 3 or 2), down to ½ at the least (`factorForPortions`).
 * The same factor back when it cannot move.
 */
export function stepPortions(recipe: Pick<RecipeSummary, "servesHalf">, factorMilli: number, direction: 1 | -1): number {
  const halves = exactHalves(recipe.servesHalf, factorMilli);
  const EPS = 1e-9;
  let nextHalves: number;
  if (direction > 0) {
    nextHalves = (Math.floor(halves / 2 + EPS) + 1) * 2;
  } else {
    if (halves <= 1 + EPS) return factorMilli;
    const whole = Math.ceil(halves / 2 - EPS) - 1;
    nextHalves = whole >= 1 ? whole * 2 : 1;
  }
  const f = clampFactor(factorForPortions(recipe.servesHalf, nextHalves));
  return f === factorMilli ? factorMilli : f;
}

/** The factor chip: "As written · serves 4", or "×0.45 · every line follows" (dark). */
export function factorChip(factorMilli: number, servesHalf: number): { text: string; written: boolean } {
  if (factorMilli === WRITTEN_FACTOR) return { text: `As written · serves ${halvesText(servesHalf)}`, written: true };
  return { text: `×${decimals(factorMilli / 1000, 2)} · every line follows`, written: false };
}

/** The portions at a factor ("2", "2½", "about 2"). */
export function portionsAt(recipe: Pick<RecipeSummary, "servesHalf">, factorMilli: number): ScaledPortions {
  return scalePortions(recipe.servesHalf, factorMilli);
}

/**
 * The largest amount on a line's grid (`scaleLine`'s: 5 g under 100 g, 10 g
 * under 1000 g, then 50 g; 0.01 kg or L; ½ a piece or spoon) that is no more
 * than `milli`.
 */
export function floorToGrid(milli: number, unit: string): number {
  let step: number;
  if (unit === "g" || unit === "ml") {
    const grams = milli / GRAM;
    step = (grams < 100 ? 5 : grams < 1000 ? 10 : 50) * GRAM;
  } else if (unit === "kg" || unit === "L") {
    step = 10 * GRAM;
  } else {
    step = recipeUnitOf(unit).factor * 500;
  }
  return Math.floor(milli / step) * step;
}

/** "Use all 450 g you have": the factor that sets the main item to its stock, and the button's words. */
export interface UseAll {
  factorMilli: number;
  amountMilli: number;
  text: string;
}

/**
 * "Use all 450 g you have" (design §3.2): the main line set to what the
 * match found of it — the most on its grid that the stock covers, so the line
 * reads have, not short. Null when there is none of it, or when the main
 * item already is that amount.
 */
export function useAllFor(recipe: Pick<KitchenRecipe, "lines">, factorMilli: number, match: Pick<RecipeMatchResponse, "lines"> | null): UseAll | null {
  const main = mainLineOf(recipe);
  if (!main || !match) return null;
  const found = match.lines.find((l) => l.position === main.position);
  if (!found || found.availableMilli <= 0) return null;
  const target = floorToGrid(found.availableMilli, main.unit);
  if (target <= 0) return null;
  let f = clampFactor(factorForMain(main.qtyMilli, target));
  // Rounding by the unit must not take it past the stock.
  for (let i = 0; i < 50 && f > RECIPE_MIN_FACTOR_MILLI && mainAmountMilli(main, f) > found.availableMilli; i++) f -= 1;
  const amount = mainAmountMilli(main, f);
  if (amount > found.availableMilli || amount === mainAmountMilli(main, factorMilli)) return null;
  return { factorMilli: f, amountMilli: amount, text: `Use all ${amountText(amount, main.unit)} you have` };
}

/** The main button's second line: "For about 2 · chicken 450 g". */
export function startLine(recipe: Pick<KitchenRecipe, "lines" | "servesHalf">, factorMilli: number): string {
  const portions = scalePortions(recipe.servesHalf, factorMilli).label;
  const main = mainLineOf(recipe);
  if (!main) return `For ${portions}`;
  return `For ${portions} · ${lowerFirst(main.name)} ${amountText(mainAmountMilli(main, factorMilli), main.unit)}`;
}

// ── Ingredients and what you have (design §3.3) ───────────────────

/** A line on screen, at the factor: its amount, and what your pantries hold for it once the match has answered. */
export interface IngredientRow {
  position: number;
  name: string;
  isMain: boolean;
  /** "450 g", "2 onions", "To taste". */
  amount: string;
  /** have, short, missing, always; null until the match answers. */
  status: RecipeLineStatus | null;
  /** "✓ Flat 4B · 600 g", "Short · you have 450 g", "Missing", "Always have"; null until the match answers. */
  statusText: string | null;
}

/** The pantries a line would take from: "Flat 4B", "Your pantry +1". */
function pantriesText(items: readonly Pick<RecipeMatchItem, "pantry">[]): string | null {
  const names: string[] = [];
  for (const item of items) {
    const name = item.pantry.kind === "group" ? item.pantry.name : "Your pantry";
    if (!names.includes(name)) names.push(name);
  }
  if (names.length === 0) return null;
  return names.length === 1 ? names[0]! : `${names[0]} +${names.length - 1}`;
}

/** What a line's status says: "✓ Flat 4B · 600 g", "Short · you have 450 g", "Missing", "Always have". */
export function lineStatusText(line: Pick<KitchenRecipeLine, "unit">, match: Pick<RecipeLineMatch, "status" | "availableMilli" | "items">): string {
  const unit = line.unit;
  const have = unit ? amountText(match.availableMilli, unit) : null;
  switch (match.status) {
    case "have": {
      const where = pantriesText(match.items);
      return `✓ ${[where, have].filter(Boolean).join(" · ")}`.trim();
    }
    case "short":
      return have ? `Short · you have ${have}` : "Short";
    case "missing":
      return "Missing";
    case "always":
      return "Always have";
  }
}

/** Every line at a factor, in order, each with its status from `match` (null while it is on its way). */
export function ingredientRows(
  recipe: Pick<KitchenRecipe, "lines">,
  factorMilli: number,
  match: Pick<RecipeMatchResponse, "lines"> | null,
): IngredientRow[] {
  const byPosition = new Map((match?.lines ?? []).map((l) => [l.position, l] as const));
  return recipe.lines.map((line) => {
    const m = byPosition.get(line.position) ?? null;
    return {
      position: line.position,
      name: line.name,
      isMain: line.isMain,
      amount: lineAmountText(line, factorMilli),
      status: m?.status ?? null,
      statusText: m ? lineStatusText(line, m) : null,
    };
  });
}

/** Beside the Ingredients heading: "Have 6 of 8 · 1 to get", or "Have all 8"; to-get lines are short or missing. */
export function haveLine(summary: Pick<RecipeMatchSummary, "lines" | "have" | "always" | "short" | "missing">): { text: string; complete: boolean } {
  const toGet = summary.short + summary.missing;
  if (toGet === 0) return { text: `Have all ${summary.lines}`, complete: true };
  return { text: `Have ${summary.have + summary.always} of ${summary.lines} · ${toGet} to get`, complete: false };
}
