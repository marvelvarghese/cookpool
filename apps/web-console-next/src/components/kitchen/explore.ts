/**
 * Where recipes are found (cookpool-recipes RC-8, design §5.2, §5.3, the
 * canvas's `Explore`, `Profile` and `NewHome`), as data:
 *
 * - **Explore** (`/explore`): Cookpool | Your groups, a search, Only what I
 *   can make, the kind chips, and a row per recipe — its tile, "by Anu ·
 *   Serves 4 · 30 min" and its match, "✓ You have everything" in green or
 *   "Missing yogurt, coriander" in amber — fewest missing first.
 * - **A person's recipes** (`/people/[id]`): each with "Serves 4 · 30 min"
 *   and Save; Recipes and Saved by among the numbers.
 * - **From your groups**: a dish cooked from a recipe you may see says
 *   "Anu's recipe" (or "Cookpool's recipe") with Save.
 *
 * Pure and dependency-free (contract types and helpers), so unit-testable.
 */

import type { ExploreRecipe, ExploreRecipesQuery, ExploreSource, KitchenDish, RecipeKind, RecipeMatchSummary, RecipeSummary } from "@saas/contracts/kitchen";
import { recipeTile } from "./cook-hub";
import { firstNameOf, halvesText, lowerFirst, minutesText, recipeHref } from "./recipes";
import { groupNamesText } from "./recipe-share";

// ── Explore (design §5.3) ─────────────────────────────────────────

export const EXPLORE_HREF = "/explore";

/** Explore with a source shown (`/explore?source=groups`, `?source=public`); Cookpool's own is the bare page. */
export function exploreHref(source: ExploreSource): string {
  return source === "cookpool" ? EXPLORE_HREF : `${EXPLORE_HREF}?source=${source}`;
}

/** The source in the address: Your groups for `groups`, Public for `public` (CM-5), else Cookpool. */
export function exploreSourceFrom(param: string | null | undefined): ExploreSource {
  return param === "groups" || param === "public" ? param : "cookpool";
}

/** The segmented switch: Cookpool · Your groups · Public (cookpool-community CM-5: cooks' listed recipes). */
export const EXPLORE_SOURCES: readonly { id: ExploreSource; label: string }[] = [
  { id: "cookpool", label: "Cookpool" },
  { id: "groups", label: "Your groups" },
  { id: "public", label: "Public" },
];

export type ExploreKind = RecipeKind | "all";

/** The kind chips, RC-4's kinds by their words. */
export const EXPLORE_KINDS: readonly { id: ExploreKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "breakfast", label: "Breakfast" },
  { id: "dal_curry", label: "Dal & curry" },
  { id: "rice", label: "Rice" },
  { id: "roti", label: "Roti" },
  { id: "snack", label: "Snacks" },
  { id: "sweet", label: "Sweet" },
  { id: "drink", label: "Drinks" },
];

/** How long the search waits after the last key before it asks. */
export const EXPLORE_SEARCH_MS = 250;

/** The read for what is chosen: `q` trimmed (none when empty), `kind` none for All. */
export function exploreQuery(source: ExploreSource, q: string, kind: ExploreKind): ExploreRecipesQuery {
  const query: ExploreRecipesQuery = { source };
  const text = q.trim();
  if (text) query.q = text;
  if (kind !== "all") query.kind = kind;
  return query;
}

/**
 * Under the title: "By Cookpool · 42 recipes" (the count once Cookpool's
 * whole list is known), or "Shared in Flat 4B and Lunch club".
 */
export function exploreSubtitle(source: ExploreSource, cookpoolCount: number | null, groupNames: readonly string[]): string {
  if (source === "groups") return groupNames.length > 0 ? `Shared in ${groupNamesText(groupNames)}` : "Shared in your groups";
  if (source === "public") return "Listed by cooks on their profiles";
  if (cookpoolCount === null) return "By Cookpool";
  return `By Cookpool · ${cookpoolCount} ${cookpoolCount === 1 ? "recipe" : "recipes"}`;
}

/**
 * A row's match: "✓ You have everything" (green) when nothing is missing or
 * short; "Missing yogurt, coriander" (amber), "+1" past the names the server
 * gives; "Short of 1" (amber) when everything is there but not enough.
 */
export function exploreMatchText(match: Pick<RecipeMatchSummary, "missing" | "short" | "missingNames">): { text: string; tone: "have" | "short" } {
  if (match.missing > 0) {
    const names = match.missingNames.map(lowerFirst);
    const more = match.missing - names.length;
    const listed = names.length > 0 ? names.join(", ") : `${match.missing}`;
    return { text: `Missing ${listed}${names.length > 0 && more > 0 ? ` +${more}` : ""}`, tone: "short" };
  }
  if (match.short > 0) return { text: `Short of ${match.short}`, tone: "short" };
  return { text: "✓ You have everything", tone: "have" };
}

/** "by Anu · Serves 4 · 30 min" (someone's, in Your groups), "Serves 4 · 30 min". */
export function recipeMetaLine(recipe: Pick<RecipeSummary, "servesHalf" | "minutes" | "isSystem" | "mine" | "ownerName">, withBy: boolean): string {
  const parts: string[] = [];
  if (withBy && !recipe.isSystem && !recipe.mine) parts.push(`by ${firstNameOf(recipe.ownerName) ?? "someone"}`);
  parts.push(`Serves ${halvesText(recipe.servesHalf)}`);
  if (recipe.minutes) parts.push(minutesText(recipe.minutes));
  return parts.join(" · ");
}

export interface ExploreRow {
  id: string;
  name: string;
  href: string;
  tile: { initial: string; bg: string; fg: string };
  meta: string;
  match: string;
  tone: "have" | "short";
}

/**
 * Explore's rows: fewest missing first (then fewest short, then the server's
 * order, newest first); with Only what I can make, just those with nothing
 * missing.
 */
export function exploreRows(recipes: readonly ExploreRecipe[], opts: { source: ExploreSource; onlyCanMake: boolean }): ExploreRow[] {
  return recipes
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !opts.onlyCanMake || r.match.missing === 0)
    .sort((a, b) => a.r.match.missing - b.r.match.missing || a.r.match.short - b.r.match.short || a.i - b.i)
    .map(({ r }) => {
      const m = exploreMatchText(r.match);
      return {
        id: r.id,
        name: r.name,
        href: recipeHref(r.id),
        tile: recipeTile(r),
        meta: recipeMetaLine(r, opts.source !== "cookpool"),
        match: m.text,
        tone: m.tone,
      };
    });
}

/** Explore's empty list. */
export const EXPLORE_EMPTY_TEXT = "Nothing here yet";

// ── A person's recipes (design §1.4) ──────────────────────────────

export interface PersonRecipeRow {
  id: string;
  name: string;
  href: string;
  /** "Serves 4 · 30 min". */
  meta: string;
}

/** Their recipes you may see, as the server gives them (newest first). */
export function personRecipeRows(recipes: readonly RecipeSummary[]): PersonRecipeRow[] {
  return recipes.map((r) => ({ id: r.id, name: r.name, href: recipeHref(r.id), meta: recipeMetaLine(r, false) }));
}

/** A person's two lists, as You's (`?list=cooks`), Recipes first. */
export type PersonList = "recipes" | "cooks";

export function personListFrom(param: string | null | undefined): PersonList {
  return param === "cooks" ? "cooks" : "recipes";
}

/** A person's page with a list chosen. */
export function personHref(subjectId: string, list: PersonList): string {
  const base = `/people/${encodeURIComponent(subjectId)}`;
  return list === "cooks" ? `${base}?list=cooks` : base;
}

// ── From your groups: the recipe a dish was cooked from ───────────

/** Each feed card's recipe, by dish: the dishes cooked from one. */
export function feedRecipeIds(dishes: readonly Pick<KitchenDish, "id" | "recipeId">[], dishIds: readonly string[]): Map<string, string> {
  const wanted = new Set(dishIds);
  const out = new Map<string, string>();
  for (const d of dishes) if (wanted.has(d.id) && d.recipeId) out.set(d.id, d.recipeId);
  return out;
}

/**
 * The recipe a card shows: the one its dish was cooked from, once its read
 * has succeeded — a recipe you may not see answers 404 and is never in
 * `loaded`, so the card leaves it out.
 */
export function feedRecipeFor<R>(dishId: string, recipeOf: ReadonlyMap<string, string>, loaded: ReadonlyMap<string, R>): R | null {
  const id = recipeOf.get(dishId);
  return id ? (loaded.get(id) ?? null) : null;
}

/** "Anu's recipe", "Cookpool's recipe", "Your recipe": whose it is, as the read says. */
export function feedRecipeText(recipe: Pick<RecipeSummary, "isSystem" | "mine" | "ownerName">, cookLabel: string): string {
  if (recipe.isSystem) return "Cookpool's recipe";
  if (recipe.mine) return "Your recipe";
  return `${firstNameOf(recipe.ownerName) ?? cookLabel}'s recipe`;
}
