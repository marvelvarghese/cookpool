/**
 * Posts in the app (cookpool-community CM-6, design §4, the canvas row
 * "Community": `CommunityFeed`, `PostDetail`), as data:
 *
 * - **The feed**: Following · Discover in `?tab=`, and each one's empty state.
 * - **The post card**: who, when and for whom ("@anucooks · 2 h · Followers"),
 *   the recipe tile, the chosen stats as tiles, Yum, the comments count and
 *   Cook this (your own recipe opens; a saved copy reads "Saved ✓").
 * - **A post's page**: "Steps took Anu 48 min · yours usually 55", the Yum
 *   names, who may remove or report a comment, the ⋯ menu.
 * - **The cache patches** a Yum, a new post, a removed post or comment, and
 *   a mute or block make to every read that shows them.
 *
 * Reports are `community-report.ts`; Share this cook? `community-share.ts`;
 * Activity `community-activity.ts`. Pure (contract types and helpers).
 */

import {
  FEED_TABS,
  type CommunityPost,
  type CommentsResponse,
  type FeedTab,
  type PostAudience,
  type PostComment,
  type PostRecipe,
  type PostStats,
  type PostYums,
} from "@saas/contracts/kitchen";
import type { CachePatch } from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";
import { amountText, firstNameOf, halvesText, minutesText } from "./recipes";
import { recipeTile } from "./cook-hub";
import { dayText, localDayOffset } from "./when";
import { COMMUNITY_HREF, PEOPLE_SEARCH_HREF, atHandle, postHref, profileFirstName, profileHref, profileInitials } from "./community";

// ── The feed ──────────────────────────────────────────────────────

export const DEFAULT_FEED_TAB: FeedTab = "following";

/** The tab `?tab=` asks for: Following unless it says discover. */
export function feedTabFrom(param: string | null | undefined): FeedTab {
  return (FEED_TABS as readonly string[]).includes(param ?? "") ? (param as FeedTab) : DEFAULT_FEED_TAB;
}

/** `/community` (Following), `/community?tab=discover`. */
export function feedHref(tab: FeedTab): string {
  return tab === DEFAULT_FEED_TAB ? COMMUNITY_HREF : `${COMMUNITY_HREF}?tab=${tab}`;
}

export const FEED_TAB_LABELS: Readonly<Record<FeedTab, string>> = { following: "Following", discover: "Everyone" };

/** The heading over each tab's cards (`RvCommunity`). */
export const FEED_HEADINGS: Readonly<Record<FeedTab, string>> = { following: "From people you follow", discover: "Popular today" };

export interface FeedEmpty {
  title: string;
  sub: string;
  /** Following's way out: people search. */
  action: { label: string; href: string } | null;
}

/** An empty feed: Following sends you to search; Discover says what it holds. */
export function feedEmpty(tab: FeedTab): FeedEmpty {
  if (tab === "following") {
    return { title: "Follow cooks to see their cooks here", sub: "Your own posts show here too.", action: { label: "Find cooks", href: PEOPLE_SEARCH_HREF } };
  }
  return { title: "Nothing public this fortnight", sub: "The newest public cooks show here.", action: null };
}

// ── Who, when, for whom ───────────────────────────────────────────

export const AUDIENCE_WORDS: Readonly<Record<PostAudience, string>> = { followers: "Followers", public: "Public", me: "Just me" };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long ago, as a card says it: "now", "5 min", "2 h" (today), "yesterday", "28 Oct". */
export function shortAgo(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const ms = now.getTime() - at.getTime();
  if (ms < MINUTE) return "now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (localDayOffset(at, now) === 0) return `${Math.floor(ms / HOUR)} h`;
  return dayText(iso, now);
}

/** The author line: their name (you: "You"), and "@anucooks · 2 h · Followers". */
export function postAuthorLine(post: Pick<CommunityPost, "author" | "createdAt" | "audience" | "mine">, now: Date): { name: string; meta: string } {
  const name = post.author ? post.author.name : "You";
  const parts = [post.author ? atHandle(post.author.handle) : null, shortAgo(post.createdAt, now), AUDIENCE_WORDS[post.audience]].filter((p): p is string => !!p);
  return { name: post.mine && !post.author ? "You" : name, meta: parts.join(" · ") };
}

// ── The stats ─────────────────────────────────────────────────────

export interface StatTile {
  id: "size" | "time" | "ate" | "steps";
  value: string;
  label: string;
}

/** The size as a tile says it: the main line at that size ("450 g"), else the portions ("4"). */
export function sizeValue(size: NonNullable<PostStats["size"]>): { value: string; label: string } {
  if (size.main) return { value: amountText(size.main.qtyMilli, size.main.unit), label: "size" };
  return { value: halvesText(size.portionsHalf), label: size.portionsHalf <= 2 ? "portion" : "portions" };
}

/** The chosen stats, as up to four tiles in the canvas's order: size, time, ate, steps. Only what the post carries. */
export function statTiles(stats: PostStats): StatTile[] {
  const out: StatTile[] = [];
  if (stats.size) out.push({ id: "size", ...sizeValue(stats.size) });
  if (stats.minutes !== undefined) out.push({ id: "time", value: minutesText(stats.minutes), label: "time" });
  if (stats.ate !== undefined) out.push({ id: "ate", value: String(stats.ate), label: "ate" });
  if (stats.steps) out.push({ id: "steps", value: `${stats.steps.done}/${stats.steps.total}`, label: "steps" });
  return out;
}

/**
 * The line under the dish's name on its tile: whose recipe — "Your recipe"
 * when it is one of yours, "With the recipe" when the post links one — and
 * the size it was cooked at ("cooked at 450 g"). Null when there's neither.
 */
export function recipeLine(post: Pick<CommunityPost, "recipe" | "stats">, ownRecipe: boolean): string | null {
  const parts: string[] = [];
  if (post.recipe) parts.push(ownRecipe ? "Your recipe" : "With the recipe");
  const size = post.stats.size;
  if (size?.main) parts.push(`cooked at ${amountText(size.main.qtyMilli, size.main.unit)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The hero: the recipe's tile colours (RC's, by the recipe's id, else the post's), the photo once CM-4 adds it. */
export function postTile(post: Pick<CommunityPost, "id" | "title" | "recipe">): { initial: string; bg: string; fg: string } {
  return recipeTile(post.recipe ? { id: post.recipe.id, name: post.title } : { id: post.id, name: post.title });
}

export interface PostCard {
  id: string;
  href: string;
  author: { name: string; meta: string; href: string | null; userId: string | null; initials: string };
  title: string;
  tile: { initial: string; bg: string; fg: string };
  recipeLine: string | null;
  tiles: StatTile[];
  /** The compact card's second line: who and when ("Anu Mathew · 2 h"). */
  byline: string;
  caption: string | null;
  yum: { on: boolean; label: string; count: number };
  comments: number;
}

/** A post as its card draws it (the canvas's `CommunityFeed`). */
export function postCard(post: CommunityPost, now: Date, ownRecipeIds: ReadonlySet<string>): PostCard {
  const who = postAuthorLine(post, now);
  return {
    id: post.id,
    href: postHref(post.id),
    author: {
      name: who.name,
      meta: who.meta,
      href: post.author ? profileHref(post.author.handle) : null,
      userId: post.author?.userId ?? null,
      initials: post.author ? profileInitials(post.author) : "Y",
    },
    title: post.title,
    tile: postTile(post),
    recipeLine: recipeLine(post, !!post.recipe && ownRecipeIds.has(post.recipe.id)),
    tiles: statTiles(post.stats),
    byline: [who.name, shortAgo(post.createdAt, now)].filter((p) => !!p).join(" · "),
    caption: post.caption?.trim() ? post.caption.trim() : null,
    yum: { on: post.yums.mine, label: yumLabel(post.yums), count: post.yums.count },
    comments: post.comments.count,
  };
}

/**
 * The compact card's numbers line (`RvCommunity`): the size and the time it
 * took, then the likes (a Yum is a like in the card's words, RV-23) and the
 * comments only when there are any — "450 g · 48 min · 12 likes".
 */
export function postNumbers(card: Pick<PostCard, "tiles" | "yum" | "comments">): string {
  const parts: string[] = [];
  for (const t of card.tiles) {
    if (t.id === "size") parts.push(t.label === "size" ? t.value : `${t.value} ${t.label}`);
    else if (t.id === "time") parts.push(t.value);
  }
  parts.push(card.yum.count === 1 ? "1 like" : `${card.yum.count} likes`);
  if (card.comments > 0) parts.push(card.comments === 1 ? "1 comment" : `${card.comments} comments`);
  return parts.join(" · ");
}

// ── Cook this ─────────────────────────────────────────────────────

export type CookThis =
  /** No recipe linked: no button. */
  | { kind: "none" }
  /** Your own recipe: Cook this opens it. */
  | { kind: "open"; recipeId: string; label: string }
  /** You saved a copy before: "Saved ✓", opening it. */
  | { kind: "saved"; recipeId: string; label: string }
  /** Copying it now. */
  | { kind: "saving"; label: string }
  /** Cook this: copy it (RC's copy route), then open the copy. */
  | { kind: "copy"; label: string };

export const COOK_THIS = "Cook this";
export const SAVED_MARK = "Saved ✓";

/** What Cook this does for this post, from your recipes: open yours, open your copy, or copy it. */
export function cookThis(recipe: PostRecipe | null, mine: { ownIds: ReadonlySet<string>; copyId: string | null; saving: boolean }): CookThis {
  if (!recipe) return { kind: "none" };
  if (mine.ownIds.has(recipe.id)) return { kind: "open", recipeId: recipe.id, label: COOK_THIS };
  if (mine.copyId) return { kind: "saved", recipeId: mine.copyId, label: SAVED_MARK };
  if (mine.saving) return { kind: "saving", label: SAVED_MARK };
  return { kind: "copy", label: COOK_THIS };
}

// ── Yum ───────────────────────────────────────────────────────────

/** Yum toggled: the count and yours, at once (the server's answer replaces it). */
export function yumToggled(yums: PostYums, on: boolean): PostYums {
  if (yums.mine === on) return yums;
  return { ...yums, mine: on, count: Math.max(0, yums.count + (on ? 1 : -1)) };
}

/** The Yum button's words: "Yum · 12". */
export function yumLabel(yums: Pick<PostYums, "count">): string {
  return yums.count > 0 ? `Yum · ${yums.count}` : "Yum";
}

/**
 * Who said Yum, on a post's page: "Dev, Meera and 10 others", "You and Dev",
 * "You". Your own name (when the server names you) isn't repeated. Null for
 * nobody.
 */
export function yumNamesText(yums: PostYums, myName: string | null): string | null {
  if (yums.count <= 0) return null;
  const firsts = yums.names.filter((n) => !(yums.mine && myName && n === myName)).map((n) => firstNameOf(n) ?? n);
  const named = yums.mine ? ["You", ...firsts] : firsts;
  const others = Math.max(0, yums.count - named.length);
  if (named.length === 0) return others === 1 ? "1 person" : `${others} people`;
  if (others > 0) return `${named.join(", ")} and ${others} ${others === 1 ? "other" : "others"}`;
  if (named.length === 1) return named[0]!;
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

// ── A post's page ─────────────────────────────────────────────────

/** "Steps took Anu 48 min · yours usually 55 min": someone else's post with a time, when you've cooked it before. */
export function stepCompareText(post: Pick<CommunityPost, "mine" | "author" | "stats" | "stepCompare">): string | null {
  if (post.mine || post.stats.minutes === undefined || !post.stepCompare || !post.author) return null;
  return `Steps took ${profileFirstName(post.author)} ${minutesText(post.stats.minutes)} · yours usually ${minutesText(post.stepCompare.usualMinutes)}`;
}

/** The comments heading: "Comments · 3". */
export function commentsHeading(count: number): string {
  return count > 0 ? `Comments · ${count}` : "Comments";
}

/** The line under the comments: how to report, and who removes (the canvas's). */
export function commentsNote(post: Pick<CommunityPost, "mine" | "author">): string {
  if (post.mine) return "Hold a comment to report it. You can remove any comment on your post.";
  const first = post.author ? profileFirstName(post.author) : "The cook";
  return `Hold a comment to report it. ${first} can remove any comment on their post.`;
}

export interface CommentRights {
  /** Its author, or the post's author. */
  remove: boolean;
  /** Anyone but its author. */
  report: boolean;
}

/** Who may do what to a comment: remove (its author, or the post's), report (anyone else). */
export function commentRights(comment: Pick<PostComment, "mine" | "canRemove">, post: Pick<CommunityPost, "mine">): CommentRights {
  return { remove: comment.mine || comment.canRemove || post.mine, report: !comment.mine };
}

export const COMMENT_PLACEHOLDER = "Add a comment";

/** A comment's body as Send sends it, or null when there's nothing to send (or too much). */
export function commentBody(draft: string, max: number): string | null {
  const body = draft.trim();
  return body && body.length <= max ? body : null;
}

/** A refused comment, in words: the hourly limit, no profile, else the server's. */
export function commentRefusalText(error: { reason?: string | undefined; message: string }): string {
  if (error.reason === "comment_limit") return "That's 30 comments this hour. Try again later.";
  if (error.reason === "no_profile") return "Pick a handle to comment";
  return error.message;
}

export type PostMenuItem = "report" | "mute" | "block" | "audience" | "delete";

/** The post's ⋯: Report · Mute · Block on someone else's; Edit audience · Delete on yours. */
export function postMenuItems(post: Pick<CommunityPost, "mine" | "author">): PostMenuItem[] {
  if (post.mine) return ["audience", "delete"];
  return post.author ? ["report", "mute", "block"] : ["report"];
}

// ── The cache ─────────────────────────────────────────────────────

/** Every read that holds posts: both feeds (pages), a post, and profiles' posts (pages). */
const POST_READS = [
  ["kitchenCommunity", "feed"],
  ["kitchenCommunity", "post"],
  ["kitchenCommunity", "posts"],
] as const;

type Pages<T> = { pages: T[]; pageParams: unknown[] };

function isPages(d: unknown): d is Pages<unknown> {
  return typeof d === "object" && d !== null && Array.isArray((d as { pages?: unknown }).pages);
}

/**
 * `fn` over every post a read holds — `{ post }`, `{ posts }`, or pages of
 * `{ posts }` — returning the same value (`===`) when nothing changed. `fn`
 * returns the post, a new post, or null to drop it.
 */
export function mapPosts(d: unknown, fn: (post: CommunityPost) => CommunityPost | null): unknown {
  if (typeof d !== "object" || d === null) return d;
  if (isPages(d)) {
    let changed = false;
    const pages = d.pages.map((p) => {
      const next = mapPosts(p, fn);
      if (next !== p) changed = true;
      return next;
    });
    return changed ? { ...d, pages } : d;
  }
  const r = d as { post?: CommunityPost; posts?: CommunityPost[] };
  if (r.post) {
    const next = fn(r.post);
    return next === r.post ? d : next === null ? d : { ...r, post: next };
  }
  if (Array.isArray(r.posts)) {
    let changed = false;
    const posts: CommunityPost[] = [];
    for (const p of r.posts) {
      const next = fn(p);
      if (next !== p) changed = true;
      if (next) posts.push(next);
    }
    return changed ? { ...r, posts } : d;
  }
  return d;
}

function eachPostRead(fn: (post: CommunityPost) => CommunityPost | null): CachePatch[] {
  return POST_READS.map((prefix) => ({ prefix, update: (d: unknown) => mapPosts(d, fn) }));
}

/** Yum on or off: the count and yours, wherever the post shows. */
export function yumPatches(postId: string, on: boolean): CachePatch[] {
  return eachPostRead((p) => (p.id !== postId ? p : p.yums.mine === on ? p : { ...p, yums: yumToggled(p.yums, on) }));
}

/** The server's Yum answer, wherever the post shows. */
export function yumAnsweredPatches(postId: string, yums: Pick<PostYums, "count" | "mine">): CachePatch[] {
  return eachPostRead((p) => (p.id !== postId || (p.yums.count === yums.count && p.yums.mine === yums.mine) ? p : { ...p, yums: { ...p.yums, ...yums } }));
}

/** A post as the server has it now (edited, restored): replaced wherever it shows. */
export function postReplacedPatches(post: CommunityPost): CachePatch[] {
  return eachPostRead((p) => {
    if (p.id !== post.id) return p;
    const compare = post.stepCompare ?? p.stepCompare;
    return compare ? { ...post, stepCompare: compare } : post;
  });
}

/** A post deleted: out of the feeds and profiles at once (its own page reads again). */
export function postRemovedPatches(postId: string): CachePatch[] {
  return [
    { prefix: ["kitchenCommunity", "feed"], update: (d: unknown) => mapPosts(d, (p) => (p.id === postId ? null : p)) },
    { prefix: ["kitchenCommunity", "posts"], update: (d: unknown) => mapPosts(d, (p) => (p.id === postId ? null : p)) },
  ];
}

/** A new post of yours: first in Following (when it's loaded) and on your profile's posts. */
export function postAddedPatches(post: CommunityPost, myHandle: string | null): CachePatch[] {
  const prepend = (d: unknown): unknown => {
    if (!isPages(d) || d.pages.length === 0) return d;
    const first = d.pages[0] as { posts?: CommunityPost[] };
    if (!Array.isArray(first.posts) || first.posts.some((p) => p.id === post.id)) return d;
    return { ...d, pages: [{ ...first, posts: [post, ...first.posts] }, ...d.pages.slice(1)] };
  };
  const out: CachePatch[] = [{ prefix: qk.kitchenFeed("following"), update: prepend }];
  if (myHandle) out.push({ prefix: qk.kitchenProfilePosts(myHandle), update: prepend });
  return out;
}

/** Someone muted (out of Following) or blocked (out of every feed and their posts' pages). */
export function authorHiddenPatches(userId: string, how: "mute" | "block"): CachePatch[] {
  const drop = (d: unknown) => mapPosts(d, (p) => (p.author?.userId === userId ? null : p));
  if (how === "mute") return [{ prefix: qk.kitchenFeed("following"), update: drop }];
  return [
    { prefix: ["kitchenCommunity", "feed"], update: drop },
    { prefix: ["kitchenCommunity", "posts"], update: drop },
  ];
}

function mapComments(d: unknown, fn: (list: PostComment[], count: number) => { list: PostComment[]; count: number } | null): unknown {
  if (!isPages(d) || d.pages.length === 0) return d;
  let changed = false;
  const pages = d.pages.map((p, i) => {
    const page = p as CommentsResponse;
    if (!Array.isArray(page.comments)) return p;
    const next = fn(page.comments, page.count);
    if (!next) return p;
    changed = true;
    // Only the last page grows; every page carries the count.
    return { ...page, comments: i === d.pages.length - 1 || next.list.length <= page.comments.length ? next.list : page.comments, count: next.count };
  });
  return changed ? { ...d, pages } : d;
}

function commentCountPatches(postId: string, delta: number): CachePatch[] {
  return eachPostRead((p) => (p.id !== postId ? p : { ...p, comments: { count: Math.max(0, p.comments.count + delta) } }));
}

/** A comment sent: last on the post's comments (when its last page is loaded), and one more on the count. */
export function commentAddedPatches(postId: string, comment: PostComment, lastPageLoaded: boolean): CachePatch[] {
  return [
    {
      prefix: qk.kitchenPostComments(postId),
      update: (d) =>
        mapComments(d, (list, count) => {
          if (list.some((c) => c.id === comment.id)) return null;
          return { list: lastPageLoaded ? [...list, comment] : list, count: count + 1 };
        }),
    },
    ...commentCountPatches(postId, 1),
  ];
}

/** The comment the server made, in place of the one shown while it was on its way. */
export function commentSavedPatches(postId: string, pendingId: string, comment: PostComment): CachePatch[] {
  return [
    {
      prefix: qk.kitchenPostComments(postId),
      update: (d) =>
        mapComments(d, (list, count) => {
          if (!list.some((c) => c.id === pendingId)) return null;
          return { list: list.map((c) => (c.id === pendingId ? comment : c)), count };
        }),
    },
  ];
}

/** A comment removed: off the list, and one fewer on the count. */
export function commentRemovedPatches(postId: string, commentId: string): CachePatch[] {
  return [
    {
      prefix: qk.kitchenPostComments(postId),
      update: (d) =>
        mapComments(d, (list, count) => {
          if (!list.some((c) => c.id === commentId)) return null;
          return { list: list.filter((c) => c.id !== commentId), count: Math.max(0, count - 1) };
        }),
    },
    ...commentCountPatches(postId, -1),
  ];
}

/** Every comment of a post's loaded pages, oldest first. */
export function commentsOf(d: Pages<CommentsResponse> | undefined | null): PostComment[] {
  return d?.pages.flatMap((p) => p.comments) ?? [];
}
