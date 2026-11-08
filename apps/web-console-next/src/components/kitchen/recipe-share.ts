/**
 * Who can see a recipe, and the page its link opens (cookpool-recipes RC-8,
 * design §5.1, §5.2, the canvas's `ShareRecipe`), as data:
 *
 * - **The share sheet**, on your own recipe's page: "Who can see it", three
 *   rows — Only me, My groups ("On your page for Flat 4B and Lunch club"),
 *   Anyone with the link — the chosen one tinted. With the link on, the full
 *   address (`<origin>/r/<code>`) with Copy, New link and Turn off; then
 *   "Saved by N".
 * - **The writes**: a row is a PATCH of `visibility` (to `link` mints a
 *   code; anything else drops it), New link a POST of `…/link`, Turn off a
 *   DELETE of it (back to My groups). Each is described here as a call, run
 *   over whatever sends it, so the request and its Undo are tested.
 * - **`/r/<code>`**: "Anu shared a recipe · From a link", the name, "Serves 2
 *   · 20 min", each line with its dot and amount, "You have 5 of 6 ·
 *   missing paneer", and Save to my recipes.
 *
 * Pure and dependency-free (contract types and helpers), so unit-testable.
 */

import {
  RECIPE_LINK_CODE_RE,
  type CopyRecipeRequest,
  type KitchenRecipe,
  type RecipeLineMatch,
  type RecipeLineStatus,
  type RecipeResponse,
  type RecipeSummary,
  type RecipeVisibility,
  type UpdateRecipeRequest,
} from "@saas/contracts/kitchen";
import type { ApiResult } from "@/lib/api";
import type { CachePatch } from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";
import { firstNameOf, halvesText, lineAmountText, lowerFirst, minutesText } from "./recipes";

// ── The share sheet (design §5.1) ─────────────────────────────────

/** A group list in words: "Flat 4B", "Flat 4B and Lunch club", "Flat 4B and 2 more"; "your groups" for none. */
export function groupNamesText(names: readonly string[]): string {
  const shown = names.map((n) => n.trim()).filter(Boolean);
  if (shown.length === 0) return "your groups";
  if (shown.length === 1) return shown[0]!;
  if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
  return `${shown[0]} and ${shown.length - 1} more`;
}

export interface ShareOption {
  id: RecipeVisibility;
  title: string;
  sub: string;
  icon: "lock" | "groups" | "link";
}

/** The sheet's three rows, in order, the levels cumulative. */
export function shareOptions(groupNames: readonly string[]): ShareOption[] {
  return [
    { id: "only_me", title: "Only me", sub: "In your recipes, nowhere else", icon: "lock" },
    { id: "groups", title: "My groups", sub: `On your page for ${groupNamesText(groupNames)}`, icon: "groups" },
    { id: "link", title: "Anyone with the link", sub: "They can see it and save a copy", icon: "link" },
  ];
}

/** Whether the share sheet is offered: your own recipe (Cookpool's own is everyone's, and nobody shares it). */
export function canShareRecipe(recipe: Pick<RecipeSummary, "mine" | "isSystem">): boolean {
  return recipe.mine && !recipe.isSystem;
}

/** Where a link opens (this app's own page for it). */
export function recipeLinkHref(code: string): string {
  return `/r/${encodeURIComponent(code)}`;
}

/** The full address the sheet shows and copies: `https://stage.cookpool.store/r/7kq2mxAb3Z`. */
export function recipeLinkUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}${recipeLinkHref(code)}`;
}

/** A link code as an address spells it (10 base-58 characters), else null: nothing is asked for a code that can't be one. */
export function parseLinkCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  return RECIPE_LINK_CODE_RE.test(value) ? value : null;
}

/** "Saved by 4". */
export function savedByText(savedBy: number): string {
  return `Saved by ${Math.max(0, Math.round(savedBy))}`;
}

/** What the link box says while the server is minting a code. */
export const LINK_MAKING_TEXT = "Making a link…";

/** How long Copy reads "Copied". */
export const COPIED_MS = 2_500;

/** Something that writes text to the clipboard (the browser's `navigator.clipboard`). */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/** Copy the link: true when it is on the clipboard. Never throws (no clipboard, or permission refused, is false). */
export async function copyLink(url: string, clipboard: ClipboardLike | null | undefined): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== "function") return false;
  try {
    await clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

// ── The writes ────────────────────────────────────────────────────

/**
 * One sharing write: a level (`PATCH /v1/kitchen/me/recipes/{id}` with
 * `{ visibility }`), New link (`POST …/link`, a fresh code: the old one
 * stops at once) or Turn off (`DELETE …/link`: back to My groups).
 */
export type ShareCall = { kind: "visibility"; body: UpdateRecipeRequest & { visibility: RecipeVisibility } } | { kind: "rotate" } | { kind: "off" };

/** Choosing a row. */
export function visibilityCall(to: RecipeVisibility): ShareCall {
  return { kind: "visibility", body: { visibility: to } };
}

/** What the recipe's level is once a call has landed. */
export function visibilityAfter(call: ShareCall, before: RecipeVisibility): RecipeVisibility {
  if (call.kind === "visibility") return call.body.visibility;
  if (call.kind === "off") return "groups";
  return before === "link" ? "link" : before;
}

/**
 * What Undo sends: the level it was before, as a PATCH (`link` again mints a
 * new code: the server can't bring an old one back). New link has none —
 * the old code is gone the moment it is rotated.
 */
export function undoCallFor(call: ShareCall, before: RecipeVisibility): ShareCall | null {
  if (call.kind === "rotate") return null;
  if (visibilityAfter(call, before) === before) return null;
  return visibilityCall(before);
}

/** What sends a sharing write: the SDK's three calls. */
export interface ShareDeps {
  updateRecipe: (recipeId: string, body: UpdateRecipeRequest) => Promise<ApiResult<RecipeResponse>>;
  shareRecipeLink: (recipeId: string) => Promise<ApiResult<RecipeResponse>>;
  stopRecipeLink: (recipeId: string) => Promise<ApiResult<RecipeResponse>>;
}

/** Send one sharing write. */
export function sendShare(recipeId: string, call: ShareCall, deps: ShareDeps): Promise<ApiResult<RecipeResponse>> {
  switch (call.kind) {
    case "visibility":
      return deps.updateRecipe(recipeId, call.body);
    case "rotate":
      return deps.shareRecipeLink(recipeId);
    case "off":
      return deps.stopRecipeLink(recipeId);
  }
}

/** The toast a level shows: "Only you can see it", "Your groups can see it", "Anyone with the link can see it". */
export function sharedToastTitle(visibility: RecipeVisibility): string {
  switch (visibility) {
    case "only_me":
      return "Only you can see it";
    case "groups":
      return "Your groups can see it";
    case "link":
      return "Anyone with the link can see it";
  }
}

/**
 * The recipe as the screen shows it the moment a level is chosen: its level,
 * and its link code — kept while it stays a link, null otherwise (and null
 * while a new one is on its way). `linkCode` undefined keeps what is cached.
 */
export function visibilityPatches(recipeId: string, change: { visibility: RecipeVisibility; linkCode?: string | null }): CachePatch[] {
  const apply = <T extends Pick<KitchenRecipe, "id" | "visibility"> & { linkCode?: string | null }>(r: T): T => {
    if (r.id !== recipeId) return r;
    const linkCode = change.visibility !== "link" ? null : change.linkCode === undefined ? (r.linkCode ?? null) : change.linkCode;
    if (r.visibility === change.visibility && (!("linkCode" in r) || r.linkCode === linkCode)) return r;
    return "linkCode" in r ? { ...r, visibility: change.visibility, linkCode } : { ...r, visibility: change.visibility };
  };
  return [
    {
      prefix: qk.kitchenRecipe(recipeId),
      update: (d) => {
        const res = d as RecipeResponse | undefined;
        if (!res || !res.recipe) return d;
        const next = apply(res.recipe);
        return next === res.recipe ? d : { ...res, recipe: next };
      },
    },
    {
      prefix: qk.kitchenMyRecipes(),
      update: (d) => {
        if (!Array.isArray(d)) return d;
        const list = d as RecipeSummary[];
        let changed = false;
        const next = list.map((r) => {
          const n = apply(r);
          if (n !== r) changed = true;
          return n;
        });
        return changed ? next : d;
      },
    },
  ];
}

// ── /r/<code> (design §5.2) ───────────────────────────────────────

/** "Anu shared a recipe" over "From a link"; your own link: "You shared this recipe". */
export function sharedByText(recipe: Pick<RecipeSummary, "mine" | "isSystem" | "ownerName">): { title: string; sub: string } {
  if (recipe.mine) return { title: "You shared this recipe", sub: "From your link" };
  const who = recipe.isSystem ? "Cookpool" : (firstNameOf(recipe.ownerName) ?? "Someone");
  return { title: `${who} shared a recipe`, sub: "From a link" };
}

/** "Serves 2 · 20 min", or "Serves 2". */
export function servesLine(recipe: Pick<RecipeSummary, "servesHalf" | "minutes">): string {
  const serves = `Serves ${halvesText(recipe.servesHalf)}`;
  return recipe.minutes ? `${serves} · ${minutesText(recipe.minutes)}` : serves;
}

export interface LinkLine {
  position: number;
  name: string;
  /** "200 g", "1 onion", "To taste". */
  amount: string;
  /** have (green, Always have and to taste too), short (amber), missing (red); null until the match answers. */
  tone: "have" | "short" | "missing" | null;
}

/** What the link page reads of a match: each line's status. */
export interface LineStatuses {
  lines: readonly Pick<RecipeLineMatch, "position" | "status">[];
}

const TONE_OF: Record<RecipeLineStatus, LinkLine["tone"]> = { have: "have", always: "have", short: "short", missing: "missing" };

/** The recipe's lines as written, each with a dot from the match (`?code=`). */
export function linkLines(recipe: Pick<KitchenRecipe, "lines">, match: LineStatuses | null): LinkLine[] {
  const byPosition = new Map((match?.lines ?? []).map((l) => [l.position, l.status] as const));
  return recipe.lines.map((l) => {
    const status = byPosition.get(l.position);
    return { position: l.position, name: l.name, amount: lineAmountText(l, 1000), tone: status ? TONE_OF[status] : null };
  });
}

/**
 * Under the lines: "You have 5 of 6 · missing paneer" (amber), "You have 5
 * of 6 · short of rice", or "You have all 6" (green). Always have and to-taste
 * lines count as had.
 */
export function linkHaveText(recipe: Pick<KitchenRecipe, "lines">, match: LineStatuses | null): { text: string; complete: boolean } | null {
  if (!match) return null;
  const names = new Map(recipe.lines.map((l) => [l.position, lowerFirst(l.name)] as const));
  const total = match.lines.length;
  const missing = match.lines.filter((l) => l.status === "missing").map((l) => names.get(l.position) ?? "");
  const short = match.lines.filter((l) => l.status === "short").map((l) => names.get(l.position) ?? "");
  const had = total - missing.length - short.length;
  if (missing.length + short.length === 0) return { text: `You have all ${total}`, complete: true };
  const parts = [`You have ${had} of ${total}`];
  if (missing.length > 0) parts.push(`missing ${missing.filter(Boolean).join(", ")}`);
  if (short.length > 0) parts.push(`short of ${short.filter(Boolean).join(", ")}`);
  return { text: parts.join(" · "), complete: false };
}

/** The line under Save: whose edits won't reach your copy. */
export function linkSaveNote(recipe: Pick<RecipeSummary, "isSystem" | "ownerName">): string {
  const first = recipe.isSystem ? "Cookpool" : firstNameOf(recipe.ownerName);
  return `You get your own copy. ${first ? `${first}'s` : "Their"} edits won't change it.`;
}

/** Once saved: "Your copy · from Anu", opening it. */
export function linkSavedNote(recipe: Pick<RecipeSummary, "isSystem" | "ownerName">): string {
  const who = recipe.isSystem ? "Cookpool" : (firstNameOf(recipe.ownerName) ?? "them");
  return `Open your copy · from ${who}`;
}

/**
 * The link page's main button: Save to my recipes; "Saved · Undo" once
 * saved here (Undo deletes the copy); a copy you saved before opens it; and
 * your own recipe opens itself.
 */
export type LinkSave =
  | { kind: "save" }
  | { kind: "saved"; copyId: string | null }
  | { kind: "had"; copyId: string }
  | { kind: "own"; recipeId: string };

export function linkSaveState(input: {
  recipe: Pick<RecipeSummary, "id" | "mine">;
  /** Your copy of it, from My recipes (`savedCopyOf`). */
  existingCopyId: string | null;
  /** Saved on this page: the copy's id once the server has written it (null while on its way). */
  savedHere: { copyId: string | null } | null;
}): LinkSave {
  if (input.recipe.mine) return { kind: "own", recipeId: input.recipe.id };
  if (input.savedHere) return { kind: "saved", copyId: input.savedHere.copyId ?? input.existingCopyId };
  if (input.existingCopyId) return { kind: "had", copyId: input.existingCopyId };
  return { kind: "save" };
}

/** What saves and unsaves a copy: the SDK's two calls. */
export interface CopyDeps {
  copyRecipe: (body: CopyRecipeRequest) => Promise<ApiResult<RecipeResponse>>;
  deleteRecipe: (recipeId: string) => Promise<ApiResult<RecipeResponse>>;
}

/** Save to my recipes from a link: `POST /v1/kitchen/me/recipes/copies` with `{ linkCode }`. */
export function saveFromLink(code: string, deps: Pick<CopyDeps, "copyRecipe">): Promise<ApiResult<RecipeResponse>> {
  return deps.copyRecipe({ linkCode: code });
}

/**
 * Undo a save ("Saved · Undo"): once the save has landed, delete that copy
 * (`DELETE /v1/kitchen/me/recipes/{copy}`). Null when there was nothing to
 * delete (the save was refused).
 */
export async function undoSave(sent: Promise<ApiResult<RecipeResponse>>, deps: Pick<CopyDeps, "deleteRecipe">): Promise<ApiResult<RecipeResponse> | null> {
  const r = await sent;
  if (!r.ok) return null;
  return deps.deleteRecipe(r.data.recipe.id);
}

/** Why a link opens nothing: gone (404: turned off, rotated, deleted, or never a code) or a read that failed. */
export function linkFailure(error: { code: string } | null): "gone" | "error" | null {
  if (!error) return null;
  return error.code === "not_found" ? "gone" : "error";
}

/** The dead link's words. */
export const LINK_GONE_TEXT = "This link no longer works";
