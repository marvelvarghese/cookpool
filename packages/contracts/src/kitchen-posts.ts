// Posts, the feed, Yum, comments, reports and Activity (Cookpool, epic
// cookpool-community: CM-3, design §2).
//
// A cook shares a dish they cooked: a caption, an audience (followers, public
// or just me) and which stats to show — size, time, how many ate, steps. The
// server computes those stats from the dish and its step log, and a post
// carries ONLY the chosen ones: never money, a group or who ate.
//
// Who sees a post, in every read (the post, both feeds, a profile's posts,
// comments, Yum):
//   me         the author only
//   followers  the author and accepted followers
//   public     anyone signed in — except that a private author's posts reach
//              accepted followers only
// A block either way hides a post (and its comments) from the other person
// entirely, as the opaque 404. A mute only takes the muted person's posts
// out of the muter's Following feed.
//
// Routes (kitchen-worker, behind api-edge's kitchen facade; all signed in):
//   POST   /v1/kitchen/me/posts                 { dishId, caption?, audience, show? } → 201 { post }
//   PATCH  /v1/kitchen/me/posts/{pst}           { caption?, audience?, show? } → { post }
//   DELETE /v1/kitchen/me/posts/{pst}           → { deleted: true, restoreUntil } (soft)
//   POST   /v1/kitchen/me/posts/{pst}/restore   within POST_UNDO_MS → { post }
//   GET    /v1/kitchen/posts/{pst}              → { post } (with stepCompare)
//   GET    /v1/kitchen/me/feed?tab=following|discover&cursor= → { tab, posts, nextCursor }
//   GET    /v1/kitchen/profiles/{handle}/posts?cursor=        → { posts, nextCursor } (403 `private` unless canSee)
//   POST   /v1/kitchen/posts/{pst}/yum          → { yums } (201 when new)
//   DELETE /v1/kitchen/posts/{pst}/yum          → { yums }
//   GET    /v1/kitchen/posts/{pst}/comments?cursor=           → { comments, count, nextCursor } (oldest first)
//   POST   /v1/kitchen/posts/{pst}/comments     { body } → 201 { comment }
//   DELETE /v1/kitchen/comments/{cmt}           its author or the post's author → { removed: true }
//   POST   /v1/kitchen/reports                  { targetKind, targetId, reason, note? } → 201 { report } (200 when a repeat)
//   GET    /v1/kitchen/me/activity?cursor=      → { requests, items, nextCursor }
//   POST   /v1/kitchen/me/activity/read         { before } → { marked }
//   GET    /v1/kitchen/me/activity/unread       → { count }
//
// Saying Yum, commenting and posting beyond Just me need a profile of your
// own (403 `no_profile`); reporting doesn't.
//
// This module is re-exported from `kitchen.ts`, so `@saas/contracts/kitchen`
// carries it.

import type { CommunityPerson, CommunityProfile } from "./kitchen-community.js";

// ── Posts ───────────────────────────────────────────────────

export const POST_AUDIENCES = ["followers", "public", "me"] as const;
export type PostAudience = (typeof POST_AUDIENCES)[number];
/** What Share this cook? picks first. */
export const DEFAULT_POST_AUDIENCE: PostAudience = "followers";

/** A post's title is the dish's name, cut to this. */
export const POST_TITLE_MAX = 60;
export const POST_CAPTION_MAX = 500;

/** How long a deleted post can be put back. */
export const POST_UNDO_MINUTES = 10;
export const POST_UNDO_MS = POST_UNDO_MINUTES * 60 * 1000;

/** Which stats the cook chose to show. A stat left out, or false, is never stored. */
export interface PostShow {
  /** The size cooked against the recipe's own. */
  size: boolean;
  /** The step log's total time. */
  time: boolean;
  /** How many people ate. */
  ate: boolean;
  /** Steps done of the recipe's cook steps. */
  steps: boolean;
}

export const POST_SHOW_KEYS = ["size", "time", "ate", "steps"] as const;

/** The size cooked: the factor against the recipe as written, its main line at that size, and the portions. */
export interface PostSizeStat {
  /** Thousandths: 1000 is the recipe as written; null when the dish named no recipe or no size. */
  factorMilli: number | null;
  /** The recipe's main line at that size ("1 kg chicken"); null when there is none. */
  main: { name: string; qtyMilli: number; unit: string } | null;
  /** The dish's portions × 2. */
  portionsHalf: number;
}

/**
 * The stats a post shows: ONLY the chosen ones, each present only when the
 * server could compute it (time needs a step log, steps a guided recipe).
 * Never money, a group or people.
 */
export interface PostStats {
  size?: PostSizeStat;
  /** The step log's total, in whole minutes (at least 1). */
  minutes?: number;
  /** How many people the dish was shared between (1 for a Just me dish). */
  ate?: number;
  /** Logged steps of the recipe's cook steps. */
  steps?: { done: number; total: number };
}

/** The recipe a post links: public (or Cookpool's), else the post shows its name with no link. */
export interface PostRecipe {
  /** `rcp_…` */
  id: string;
  name: string;
  /** Its link code, when it has one. */
  linkCode: string | null;
}

/** At most this many names in `yums.names`. */
export const YUM_NAMES_MAX = 3;

export interface PostYums {
  count: number;
  /** The caller said Yum. */
  mine: boolean;
  /** Up to YUM_NAMES_MAX profile names, people the caller follows first. */
  names: string[];
}

/** The caller's own usual time for this recipe at this size, from their earlier cooks' step logs. */
export interface PostStepCompare {
  /** The median of their totals, in whole minutes. */
  usualMinutes: number;
  /** How many of their cooks it is from. */
  cooks: number;
}

export interface CommunityPost {
  /** `pst_…` */
  id: string;
  /** Null only on your own Just me post made before you had a profile. */
  author: CommunityProfile | null;
  title: string;
  caption: string | null;
  audience: PostAudience;
  /** The author's choices; the stats themselves are in `stats`. */
  show: PostShow;
  stats: PostStats;
  recipe: PostRecipe | null;
  yums: PostYums;
  comments: { count: number };
  /** Only on the post read, and only when the caller has cooked this recipe at this size before. */
  stepCompare?: PostStepCompare;
  /** The caller wrote it. */
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
}

export interface CreatePostRequest {
  /** `dsh_…`: a dish the caller cooked, finalized (or Just me), not canceled, with no live post. */
  dishId: string;
  caption?: string | null;
  audience: PostAudience;
  /** Missing keys are false. */
  show?: Partial<PostShow>;
}

export interface UpdatePostRequest {
  /** null or "" clears it. */
  caption?: string | null;
  audience?: PostAudience;
  /** Merged into the current choices. */
  show?: Partial<PostShow>;
}

export interface PostResponse {
  post: CommunityPost;
}

export interface DeletePostResponse {
  deleted: true;
  /** Until when POST …/restore puts it back. */
  restoreUntil: string;
}

// ── Feeds ───────────────────────────────────────────────────

export const FEED_TABS = ["following", "discover"] as const;
export type FeedTab = (typeof FEED_TABS)[number];
export const FEED_PAGE_SIZE = 20;

/** Discover reads public posts from the last this many days. */
export const DISCOVER_DAYS = 14;
/** Discover's boost: this many hours per doubling of Yums (log2(yums + 1)), at most DISCOVER_BOOST_MAX_HOURS. */
export const DISCOVER_BOOST_HOURS = 2;
export const DISCOVER_BOOST_MAX_HOURS = 24;

/** How far ahead of its time Discover ranks a post with `yums` Yums, in ms. */
export function discoverBoostMs(yums: number): number {
  const n = Number.isFinite(yums) && yums > 0 ? yums : 0;
  const hours = Math.min(DISCOVER_BOOST_MAX_HOURS, DISCOVER_BOOST_HOURS * Math.log2(n + 1));
  return Math.round(hours * 60 * 60 * 1000);
}

/** Open reports from this many different people hide a post or a profile's posts from Discover. */
export const REPORTS_TO_HIDE = 3;

export interface FeedQuery {
  tab?: FeedTab;
  cursor?: string;
}

export interface FeedResponse {
  tab: FeedTab;
  posts: CommunityPost[];
  nextCursor: string | null;
}

export interface ProfilePostsResponse {
  posts: CommunityPost[];
  nextCursor: string | null;
}

// ── Yum and comments ────────────────────────────────────────

export interface YumResponse {
  yums: Pick<PostYums, "count" | "mine">;
}

export const COMMENT_BODY_MAX = 500;
/** At most this many comments an hour per person (429 `comment_limit`). */
export const COMMENTS_PER_HOUR = 30;
export const COMMENTS_PAGE_SIZE = 30;

export interface PostComment {
  /** `cmt_…` */
  id: string;
  /** `pst_…` */
  postId: string;
  author: CommunityProfile;
  body: string;
  createdAt: string;
  /** The caller wrote it. */
  mine: boolean;
  /** The caller may remove it: theirs, or on their post. */
  canRemove: boolean;
}

export interface CommentsResponse {
  /** Oldest first. */
  comments: PostComment[];
  /** Every comment the caller can see on the post. */
  count: number;
  nextCursor: string | null;
}

export interface AddCommentRequest {
  body: string;
}

export interface CommentResponse {
  comment: PostComment;
}

export interface DeleteCommentResponse {
  removed: true;
}

// ── Reports ─────────────────────────────────────────────────

export const REPORT_TARGET_KINDS = ["post", "comment", "profile"] as const;
export type ReportTargetKind = (typeof REPORT_TARGET_KINDS)[number];
export const REPORT_REASONS = ["spam", "abuse", "unsafe", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_NOTE_MAX = 300;

export interface CreateReportRequest {
  targetKind: ReportTargetKind;
  /** `pst_…`, `cmt_…`, or the profile's `usr_…`. */
  targetId: string;
  reason: ReportReason;
  note?: string | null;
}

export interface KitchenReport {
  /** `rpt_…` */
  id: string;
  targetKind: ReportTargetKind;
  targetId: string;
  reason: ReportReason;
  createdAt: string;
}

export interface ReportResponse {
  report: KitchenReport;
}

/** The audit event a report writes, in the same batch. */
export const KITCHEN_REPORT_EVENT = "kitchen.report.created";

// ── Activity ────────────────────────────────────────────────

export const ACTIVITY_KINDS = ["followed", "follow_request", "follow_accepted", "yum", "comment", "cooked_yours", "saved_yours"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_PAGE_SIZE = 30;
/** A Yum item names at most this many people ("Meera, Dev and 10 others"). */
export const ACTIVITY_ACTORS_MAX = 3;
/** `requests.people` holds at most this many, newest first. */
export const ACTIVITY_REQUESTS_MAX = 3;

export interface ActivityActor {
  userId: string;
  handle: string;
  name: string;
}

/**
 * One thing that happened to the caller. Yums on one post are ONE item:
 * `actors` the latest few, `others` how many more. Follow requests are not
 * items: they are `requests`.
 */
export interface ActivityItem {
  /** `act_…`, or `yum_<pst hex>` for a post's Yums. */
  id: string;
  kind: Exclude<ActivityKind, "follow_request">;
  /** When it happened (a Yum item: the latest Yum). */
  at: string;
  unread: boolean;
  /** Who did it (a Yum item: the latest). */
  actor: ActivityActor;
  /** A Yum item: the latest ACTIVITY_ACTORS_MAX; otherwise just `actor`. */
  actors: ActivityActor[];
  /** How many more did it than `actors` names. */
  others: number;
  /** yum, comment, cooked_yours: the post, when the caller can see it. */
  post: { id: string; title: string } | null;
  /** comment: the comment, while it is shown. */
  comment: { id: string; body: string } | null;
  /** cooked_yours: the recipe cooked; saved_yours: the recipe saved. */
  recipe: { id: string; name: string } | null;
}

export interface ActivityResponse {
  /** Follow requests waiting on the caller: how many, and the newest few. */
  requests: { count: number; people: CommunityPerson[] };
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface MarkActivityReadRequest {
  /** An ISO instant: everything up to it is read. */
  before: string;
}

export interface MarkActivityReadResponse {
  marked: number;
}

export interface UnreadActivityResponse {
  count: number;
}

// ── Pushes ──────────────────────────────────────────────────

/** A Yum push goes to the author at most once per post in this long. */
export const YUM_PUSH_EVERY_MS = 60 * 60 * 1000;

// ── Refusals ────────────────────────────────────────────────

/** `details.reason` of the posts routes' refusals (the error codes are the pinned ones). */
export const KITCHEN_POSTS_ERROR_REASONS = {
  /** 409 `conflict`: the dish isn't finalized (a group dish) or was canceled. */
  NOT_POSTABLE: "not_postable",
  /** 409 `conflict`: the dish already has a live post (`details.postId`). */
  ALREADY_POSTED: "already_posted",
  /** 409 `conflict`: the post was deleted too long ago to restore, or was never deleted. */
  NOT_RESTORABLE: "not_restorable",
  /** 429 `rate_limited`: COMMENTS_PER_HOUR comments in the last hour. */
  COMMENT_LIMIT: "comment_limit",
} as const;
export type KitchenPostsErrorReason = (typeof KITCHEN_POSTS_ERROR_REASONS)[keyof typeof KITCHEN_POSTS_ERROR_REASONS];
