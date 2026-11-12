/**
 * The lists of recipes (cookpool-recipes RC-5, design §5.4, the canvas's
 * `CookTab`, `NewHome` and `Profile`), as data:
 *
 * - **The Cook hub** (`/cook` in the new frame): Start cooking; Cook now — a
 *   segmented "Can make N" (nothing missing) | "Missing 1 · N", each row
 *   "Have all 5 · for 3" or "Missing yogurt · for 2" with Start; My recipes,
 *   last cooked first, each card "Serves 4 · from Anu · Cooked today".
 * - **Home's Cook now strip**: up to three cards, "Have all · for 3" or
 *   "Missing 1 · yogurt".
 * - **You**: Recipes and Saved by, and each recipe with who can see it.
 *
 * Pure and dependency-free (contract types and helpers), so unit-testable.
 */

import { factorForPortions, type CookNowEntry, type KitchenRecipe, type RecipeSummary } from "@saas/contracts/kitchen";
import type { CachePatch } from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";
import { dayText } from "./when";
import {
  PUBLIC_WORD,
  VISIBILITY_WORDS,
  WRITTEN_FACTOR,
  clampFactor,
  fromText,
  halvesText,
  lowerFirst,
  recipeHref,
  sessionHref,
  upperFirst,
} from "./recipes";

// ── /cook: which screen ───────────────────────────────────────────

/**
 * What `/cook` shows (design §8): the Cook hub in the new frame; today's
 * dish maker in prod — and in the new frame too for Cook with it
 * (`/cook?item=…`, from an item's page), which starts a dish from that item.
 */
export function cookPageShows(isNewFrame: boolean, itemParam: string | null | undefined): "hub" | "dish-maker" {
  return isNewFrame && !itemParam ? "hub" : "dish-maker";
}

// ── A recipe's tile ───────────────────────────────────────────────

/**
 * Tile colours: the board's seven tint pairs (`RvCook`), as the `cp-*`
 * tokens (CSS colour values, so the light and dark values follow the
 * theme): orange, green, purple, amber, blue, pink and teal, a dark ink on
 * each tint. There is no pink token, so pink is the face colour on a
 * tenth of itself. In dark, the tiles paint the line colour with ink
 * (each view's own dark rule).
 */
export const RECIPE_TILE_COLORS: readonly { bg: string; fg: string }[] = [
  { bg: "hsl(var(--cp-owe-tint))", fg: "hsl(var(--cp-owe))" },
  { bg: "hsl(var(--cp-accent-tint))", fg: "hsl(var(--cp-accent-text))" },
  { bg: "hsl(var(--cp-purple-tint))", fg: "hsl(var(--cp-purple))" },
  { bg: "hsl(var(--cp-soon-tint))", fg: "hsl(var(--cp-soon))" },
  { bg: "hsl(var(--cp-owed-tint))", fg: "hsl(var(--cp-owed))" },
  { bg: "hsl(var(--cp-face-2) / 0.12)", fg: "hsl(var(--cp-face-2))" },
  { bg: "hsl(var(--cp-teal-tint))", fg: "hsl(var(--cp-teal))" },
];

/** A recipe's tile: its initial on its colour, the same everywhere (by its id). */
export function recipeTile(recipe: Pick<RecipeSummary, "id" | "name">): { initial: string; bg: string; fg: string } {
  let h = 0;
  for (const ch of recipe.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const color = RECIPE_TILE_COLORS[h % RECIPE_TILE_COLORS.length]!;
  const initial = (recipe.name.trim().charAt(0) || "?").toUpperCase();
  return { initial, ...color };
}

// ── Cook now (design §5.4) ────────────────────────────────────────

export type CookNowFilter = "can" | "one";

/** How many recipes each segment holds: nothing missing, and one missing. */
export function cookNowCounts(entries: readonly CookNowEntry[]): Record<CookNowFilter, number> {
  let can = 0;
  let one = 0;
  for (const e of entries) {
    if (e.match.missing === 0) can += 1;
    else if (e.match.missing === 1) one += 1;
  }
  return { can, one };
}

/** The segments' words: "Can make 3", "Missing 1 · 2". */
export function cookNowFilterLabel(filter: CookNowFilter, counts: Record<CookNowFilter, number>): string {
  return filter === "can" ? `Can make ${counts.can}` : `Missing 1 · ${counts.one}`;
}

/** The segment shown first: Can make when there is any, else Missing 1. */
export function defaultCookNowFilter(entries: readonly CookNowEntry[]): CookNowFilter {
  return cookNowCounts(entries).can > 0 ? "can" : "one";
}

/** The section shows only when one of its segments holds something. */
export function showsCookNow(entries: readonly CookNowEntry[]): boolean {
  const c = cookNowCounts(entries);
  return c.can + c.one > 0;
}

/**
 * The portions Cook now says it is "for": what the stock allows
 * (`forPortionsHalf`), or — when something is missing and the server gives
 * none — what the recipe serves as written.
 */
export function cookNowPortionsHalf(entry: CookNowEntry): number {
  return entry.forPortionsHalf ?? entry.recipe.servesHalf;
}

/**
 * The factor Start begins a session at: the most the stock allows, as the
 * row says it ("for 3": f = 3 ÷ serves), else the recipe as written.
 */
export function cookNowStartFactor(entry: CookNowEntry): number {
  if (entry.forPortionsHalf === null || entry.forPortionsHalf <= 0) return WRITTEN_FACTOR;
  return clampFactor(factorForPortions(entry.recipe.servesHalf, entry.forPortionsHalf));
}

export interface CookNowRow {
  id: string;
  name: string;
  tile: { initial: string; bg: string; fg: string };
  /** "Have all 5 · for 3" (green), "Missing yogurt · for 2" (muted). */
  meta: string;
  tone: "have" | "muted";
  href: string;
  startHref: string;
}

/** One segment's rows, in the server's order (fewest missing, then the most you can make, then the most recently cooked). */
export function cookNowRows(entries: readonly CookNowEntry[], filter: CookNowFilter): CookNowRow[] {
  return entries
    .filter((e) => (filter === "can" ? e.match.missing === 0 : e.match.missing === 1))
    .map((e) => {
      const forText = `for ${halvesText(cookNowPortionsHalf(e))}`;
      const meta =
        filter === "can"
          ? `Have all ${e.match.lines} · ${forText}`
          : `Missing ${lowerFirst(e.match.missingNames[0] ?? "1")} · ${forText}`;
      return {
        id: e.recipe.id,
        name: e.recipe.name,
        tile: recipeTile(e.recipe),
        meta,
        tone: filter === "can" ? "have" : "muted",
        href: recipeHref(e.recipe.id),
        startHref: sessionHref(e.recipe.id, cookNowStartFactor(e)),
      };
    });
}

/** Home's strip holds this many. */
export const HOME_COOK_NOW = 3;

export interface CookNowCard {
  id: string;
  name: string;
  tile: { initial: string; bg: string; fg: string };
  /** "Have all · for 3" (green) or "Missing 1 · yogurt" (muted). */
  text: string;
  tone: "have" | "muted";
  href: string;
}

/** Home's Cook now: the first three, each opening its recipe. None when Cook now has nothing. */
export function homeCookNowCards(entries: readonly CookNowEntry[]): CookNowCard[] {
  return entries.slice(0, HOME_COOK_NOW).map((e) => {
    const missing = e.match.missing;
    const text =
      missing === 0
        ? `Have all · for ${halvesText(cookNowPortionsHalf(e))}`
        : `Missing ${missing}${e.match.missingNames[0] ? ` · ${lowerFirst(e.match.missingNames[0])}` : ""}`;
    return { id: e.recipe.id, name: e.recipe.name, tile: recipeTile(e.recipe), text, tone: missing === 0 ? "have" : "muted", href: recipeHref(e.recipe.id) };
  });
}

// ── My recipes ────────────────────────────────────────────────────

/** Yours and your copies, last cooked first (never cooked last), then the newest. */
export function sortMyRecipes<T extends Pick<RecipeSummary, "lastCookedAt" | "createdAt" | "id">>(recipes: readonly T[]): T[] {
  return [...recipes].sort((a, b) => {
    if (a.lastCookedAt !== b.lastCookedAt) {
      if (!a.lastCookedAt) return 1;
      if (!b.lastCookedAt) return -1;
      return b.lastCookedAt.localeCompare(a.lastCookedAt);
    }
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

/** Its ingredients on one line: "Chicken, onions, tomatoes, yogurt". */
export function ingredientNames(recipe: Pick<KitchenRecipe, "lines">): string {
  return recipe.lines.map((l, i) => (i === 0 ? upperFirst(l.name) : lowerFirst(l.name))).join(", ");
}

/** Until the whole recipe is read: its main item and how many more ("Chicken + 7 more"). */
export function ingredientsTeaser(recipe: Pick<RecipeSummary, "main" | "lineCount">): string {
  const more = recipe.lineCount - (recipe.main ? 1 : 0);
  if (!recipe.main) return `${recipe.lineCount} ${recipe.lineCount === 1 ? "item" : "items"}`;
  return more > 0 ? `${upperFirst(recipe.main.name)} + ${more} more` : upperFirst(recipe.main.name);
}

export interface MyRecipeCard {
  id: string;
  name: string;
  href: string;
  /** Every ingredient's name, or the main item and a count until the recipe is read. */
  items: string;
  /** "Serves 4", "from Anu" or "Saved by 3", "Cooked today". */
  meta: string[];
  startHref: string;
}

/** My recipes' cards, in order; `full` holds the recipes read in full so far (for their ingredients). */
export function myRecipeCards(
  recipes: readonly RecipeSummary[],
  full: ReadonlyMap<string, Pick<KitchenRecipe, "lines">>,
  now: Date,
): MyRecipeCard[] {
  return sortMyRecipes(recipes).map((r) => {
    const lines = full.get(r.id);
    const who = fromText(r) ?? (r.savedBy > 0 ? `Saved by ${r.savedBy}` : null);
    const seen = r.lastCookedAt ? `Cooked ${dayText(r.lastCookedAt, now)}` : null;
    return {
      id: r.id,
      name: r.name,
      href: recipeHref(r.id),
      items: lines && lines.lines.length > 0 ? ingredientNames(lines) : ingredientsTeaser(r),
      meta: [`Serves ${halvesText(r.servesHalf)}`, who, seen].filter((m): m is string => !!m),
      startHref: sessionHref(r.id, WRITTEN_FACTOR),
    };
  });
}

/** Your copy of a recipe, if you saved one (design §5.2). */
export function savedCopyOf(recipeId: string, mine: readonly Pick<RecipeSummary, "id" | "source">[] | null): string | null {
  return mine?.find((r) => r.source?.recipeId === recipeId)?.id ?? null;
}

// ── The Cook tab, revamped (RV-4, the canvas's `RvCook`) ──────────

/** A row on the Cook tab: its tile, its name and one tag. */
export interface HubRow {
  id: string;
  name: string;
  tile: { initial: string; bg: string; fg: string };
  /** "Have all", "Need yogurt", "From Anu", "Cooked Sat", "Serves 4". */
  tag: string;
  /** The tag's colour: the accent's tint, money-you-owe's, or plain. */
  tone: "have" | "need" | "plain";
  href: string;
}

/** Each list shows this many, then "See all N". */
export const HUB_FIRST = 3;

/** The recipe at the size the stock allows ("for 3"), or as written. */
function cookNowHref(entry: CookNowEntry): string {
  const f = cookNowStartFactor(entry);
  return f === WRITTEN_FACTOR ? recipeHref(entry.recipe.id) : `${recipeHref(entry.recipe.id)}?f=${f}`;
}

/** Cook now: what you have everything for, "Have all", each opening its recipe at the size the stock allows. */
export function cookNowHubRows(entries: readonly CookNowEntry[]): HubRow[] {
  return entries
    .filter((e) => e.match.missing === 0)
    .map((e) => ({ id: e.recipe.id, name: e.recipe.name, tile: recipeTile(e.recipe), tag: "Have all", tone: "have" as const, href: cookNowHref(e) }));
}

/**
 * Saved recipes: yours and your copies not already in Cook now, last cooked
 * first, each with one tag — "Need yogurt" when one thing is missing, else
 * "From Anu", else "Cooked Sat", else "Serves 4".
 */
export function savedHubRows(recipes: readonly RecipeSummary[], cookNow: readonly CookNowEntry[] | null, now: Date): HubRow[] {
  const byId = new Map((cookNow ?? []).map((e) => [e.recipe.id, e]));
  return sortMyRecipes(recipes)
    .filter((r) => byId.get(r.id)?.match.missing !== 0)
    .map((r) => {
      const e = byId.get(r.id);
      const need = e && e.match.missing === 1 ? e.match.missingNames[0] : undefined;
      const from = fromText(r);
      const [tag, tone]: [string, HubRow["tone"]] = need
        ? [`Need ${lowerFirst(need)}`, "need"]
        : from
          ? [upperFirst(from), "plain"]
          : r.lastCookedAt
            ? [`Cooked ${dayText(r.lastCookedAt, now)}`, "plain"]
            : [`Serves ${halvesText(r.servesHalf)}`, "plain"];
      return { id: r.id, name: r.name, tile: recipeTile(r), tag, tone, href: recipeHref(r.id) };
    });
}

/** The search: a row stays when its name holds what was typed (any case). */
export function hubMatches(row: Pick<HubRow, "name">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || row.name.toLowerCase().includes(q);
}

// ── You (design §1.4) ─────────────────────────────────────────────

/** You's numbers: how many recipes you have, and how many copies people saved of them. */
export function recipeStats(recipes: readonly Pick<RecipeSummary, "savedBy">[]): { recipes: number; savedBy: number } {
  return { recipes: recipes.length, savedBy: recipes.reduce((n, r) => n + r.savedBy, 0) };
}

/** You's two lists. */
export type ProfileList = "recipes" | "cooks";

/** The list in the address (`?list=cooks`); Recipes otherwise. */
export function profileListFrom(param: string | null | undefined): ProfileList {
  return param === "cooks" ? "cooks" : "recipes";
}

/** Your page with a list chosen. */
export function profileHref(list: ProfileList): string {
  return list === "cooks" ? "/you?list=cooks" : "/you";
}

export interface ProfileRecipeRow {
  id: string;
  name: string;
  href: string;
  /** "My groups · saved by 4", "Only me · from Anu", "Anyone with the link". */
  meta: string;
}

/** Your recipes on your page, last cooked first, each with who can see it. */
export function profileRecipeRows(recipes: readonly RecipeSummary[]): ProfileRecipeRow[] {
  return sortMyRecipes(recipes).map((r) => {
    const extra = fromText(r) ?? (r.savedBy > 0 ? `saved by ${r.savedBy}` : null);
    return { id: r.id, name: r.name, href: recipeHref(r.id), meta: [r.listed && r.visibility === "link" ? PUBLIC_WORD : VISIBILITY_WORDS[r.visibility], extra].filter(Boolean).join(" · ") };
  });
}

// ── Writes that show at once (SM-5) ───────────────────────────────

const isArray = (d: unknown): d is unknown[] => Array.isArray(d);

/** A recipe off My recipes and Cook now the moment it is deleted (Undo puts them back). */
export function recipeRemovedPatches(recipeId: string): CachePatch[] {
  return [
    {
      prefix: qk.kitchenMyRecipes(),
      update: (d) => (isArray(d) && (d as RecipeSummary[]).some((r) => r.id === recipeId) ? (d as RecipeSummary[]).filter((r) => r.id !== recipeId) : d),
    },
    {
      prefix: qk.kitchenCookNow(),
      update: (d) =>
        isArray(d) && (d as CookNowEntry[]).some((e) => e.recipe.id === recipeId) ? (d as CookNowEntry[]).filter((e) => e.recipe.id !== recipeId) : d,
    },
  ];
}

/** A recipe at the top of My recipes once the server has written it (a copy, a dish saved as one), until My recipes is read again. */
export function recipeAddedPatches(recipe: RecipeSummary): CachePatch[] {
  return [
    {
      prefix: qk.kitchenMyRecipes(),
      update: (d) => (isArray(d) && !(d as RecipeSummary[]).some((r) => r.id === recipe.id) ? [recipe, ...(d as RecipeSummary[])] : d),
    },
  ];
}
