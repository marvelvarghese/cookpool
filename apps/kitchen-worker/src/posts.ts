// Posts (Cookpool CM-3, cookpool-community design §2): what the post, feed,
// reaction and Activity handlers share — the stats a post may carry, which
// recipe it links and whose recipe it cooked, the public shape of a post and
// a comment, and the cursors.
//
// THE STATS WHITELIST lives in `computeStats`: a post carries only the stats
// its author chose, from four fixed facts of the dish — its size against the
// recipe, the step log's total, how many servings it made (its portions,
// since CM-8), and steps logged of the recipe's cook steps. Nothing else of the dish is read (`postSource`
// selects no price, no ledger row, no group and no person), so nothing else
// can reach a post.

import {
  POST_SHOW_KEYS,
  POST_TITLE_MAX,
  SYSTEM_RECIPE_OWNER,
  lineQuantity,
  scaleLine,
  type CommunityPost,
  type PostComment,
  type PostShow,
  type PostStats,
  type PostStepCompare,
} from "@saas/contracts/kitchen";
import { isUuid } from "@saas/db/ids";
import type { KitchenCommentRecord, KitchenPostRecord, KitchenPostSource, KitchenPostSourceRecipe, KitchenPostStats } from "@saas/db/kitchen";
import { toCommunityProfile } from "./community.js";
import { parsePublicId, toPublicId } from "./ids.js";

// ── What a post shows ──────────────────────────────────────

/** Every choice off, then the ones given (only `true` turns one on). */
export function showOf(given: Partial<PostShow> | undefined, base?: PostShow): PostShow {
  const out: PostShow = base ? { ...base } : { size: false, time: false, ate: false, steps: false };
  for (const key of POST_SHOW_KEYS) {
    if (given && typeof given[key] === "boolean") out[key] = given[key];
  }
  return out;
}

/** The choices a stored post reads as: a stat it carries was chosen. */
export function shownOf(stats: KitchenPostStats): PostShow {
  return { size: stats.size !== undefined, time: stats.minutes !== undefined, ate: stats.ate !== undefined, steps: stats.steps !== undefined };
}

/** The chosen stats of a dish — and ONLY the chosen ones, each only when it can be computed. */
export function computeStats(source: KitchenPostSource, show: PostShow): KitchenPostStats {
  const stats: KitchenPostStats = {};
  if (show.size) {
    const factor = source.recipeFactorMilli;
    const main = source.mainLine && factor
      ? { name: source.mainLine.name, qtyMilli: scaleLine(source.mainLine.qtyMilli, source.mainLine.unit, factor) ?? source.mainLine.qtyMilli, unit: source.mainLine.unit }
      : null;
    stats.size = { factorMilli: source.recipe ? factor : null, main: source.recipe ? main : null, portionsHalf: source.portionsHalf };
  }
  if (show.time && source.stepsLogged > 0) stats.minutes = Math.max(1, Math.round(source.stepSeconds / 60));
  // How many it served: its portions in whole servings (CM-8) — a dish is posted before it is split, or never split.
  if (show.ate) stats.ate = servingsOf(source.portionsHalf);
  if (show.steps && source.stepsLogged > 0 && source.recipeCookSteps > 0) {
    stats.steps = { done: Math.min(source.stepsLogged, source.recipeCookSteps), total: source.recipeCookSteps };
  }
  return stats;
}

/** A dish's portions as whole servings, rounded up, at least 1 (½ portion serves one; 1½ serve two). */
export function servingsOf(portionsHalf: number): number {
  return Math.max(1, Math.ceil(portionsHalf / 2));
}

/**
 * Can a dish be posted: any of the cook's dishes but a canceled one — its
 * own or split with a group, open or finalized (CM-8: posting and splitting
 * are separate actions, in any order).
 */
export function postable(source: KitchenPostSource): boolean {
  return source.state !== "canceled";
}

/** The dish's name as a post's title. */
export function postTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= POST_TITLE_MAX ? trimmed : `${trimmed.slice(0, POST_TITLE_MAX - 1)}…`;
}

// ── Which recipe it links, and whose ───────────────────────

function isPublicRecipe(r: KitchenPostSourceRecipe | null): boolean {
  return r !== null && !r.deleted && (r.isSystem || (r.visibility === "link" && r.listed));
}

/**
 * The recipe a post links — the dish's recipe when it is public (or
 * Cookpool's), else the public recipe the cook's own copy came from — and
 * whose it is: the person `cooked_yours` goes to (the linked recipe's owner,
 * or, for the cook's own recipe, whom it was copied from), never the cook
 * and never Cookpool.
 */
export function linkOf(source: KitchenPostSource): { recipe: KitchenPostSourceRecipe | null; owner: string | null } {
  const r = source.recipe;
  let linked: KitchenPostSourceRecipe | null = null;
  if (r && isPublicRecipe(r)) linked = r;
  else if (r && !r.deleted && r.ownerId === source.cook && isPublicRecipe(source.sourceRecipe)) linked = source.sourceRecipe;
  if (!linked) return { recipe: null, owner: null };
  const cook = source.cook;
  let owner: string | null = null;
  if (!linked.isSystem && linked.ownerId !== cook) owner = linked.ownerId;
  else if (linked.sourceOwnerId && linked.sourceOwnerId !== cook && linked.sourceOwnerId !== SYSTEM_RECIPE_OWNER) owner = linked.sourceOwnerId;
  return { recipe: linked, owner };
}

/** "1 kg", "500 g", "2 onion": a main line's amount in its own unit, for a push. */
export function amountWords(main: { qtyMilli: number; unit: string } | null | undefined): string | null {
  if (!main) return null;
  const value = lineQuantity(main.qtyMilli, main.unit);
  return `${Math.round(value * 100) / 100} ${main.unit}`;
}

// ── Shapes ─────────────────────────────────────────────────

export function toCommunityPost(r: KitchenPostRecord, viewer: string, names: readonly string[], stepCompare?: PostStepCompare | null): CommunityPost {
  const post: CommunityPost = {
    id: toPublicId("pst", r.id),
    author: r.author ? toCommunityProfile(r.author) : null,
    title: r.title,
    caption: r.caption,
    audience: r.audience,
    show: shownOf(r.stats),
    stats: r.stats as PostStats,
    recipe: r.recipe ? { id: toPublicId("rcp", r.recipe.id), name: r.recipe.name, linkCode: r.recipe.linkCode } : null,
    yums: { count: r.yumCount, mine: r.yummed, names: [...names] },
    comments: { count: r.commentCount },
    mine: r.authorId === viewer,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
  };
  if (stepCompare) post.stepCompare = stepCompare;
  return post;
}

export function toPostComment(c: KitchenCommentRecord, viewer: string, postAuthorId: string): PostComment {
  return {
    id: toPublicId("cmt", c.id),
    postId: toPublicId("pst", c.postId),
    author: c.author ? toCommunityProfile(c.author) : { userId: c.authorId, handle: "", name: "", about: null, privacy: "public" },
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    mine: c.authorId === viewer,
    canRemove: c.authorId === viewer || postAuthorId === viewer,
  };
}

/** The median of the viewer's earlier totals, in whole minutes; null with none. */
export function stepCompareOf(totals: readonly number[]): PostStepCompare | null {
  if (totals.length === 0) return null;
  const sorted = [...totals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { usualMinutes: Math.max(1, Math.round(median / 60)), cooks: sorted.length };
}

// ── Ids and cursors ────────────────────────────────────────

/** A path's `{pst}` as the stored UUID, or null. */
export function postParam(raw: string | undefined): string | null {
  return raw ? parsePublicId("pst", raw) : null;
}

export function commentParam(raw: string | undefined): string | null {
  return raw ? parsePublicId("cmt", raw) : null;
}

export const isPostKey = (key: string): boolean => isUuid(key);

/** An Activity cursor's key: a row's UUID, or `yum_<post UUID>`. */
export const isActivityKey = (key: string): boolean => isUuid(key) || (key.startsWith("yum_") && isUuid(key.slice(4)));
