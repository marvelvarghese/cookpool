// Posts, Yum, comments, reports and Activity (Cookpool CM-3, migration
// 440_kitchen_posts).
//
// Who may see a post is decided HERE, in SQL, by `visiblePostSql`, and every
// read of a post, a feed, a profile's posts, comments and Yum carries it: the
// author always; otherwise never across a block either way, never a Just me
// post, and either an accepted follower or a public post by a public
// profile. A mute only leaves the Following feed (`followingFeed`).
//
// A post's stats are whatever kitchen-worker computed and chose; the table's
// CHECK refuses any key but size, minutes, ate and steps. The source of those
// stats (`postSource`) reads the dish's portions, shares COUNT, step log and
// recipe — never a price, a ledger row or who the shares are.
//
// Writes that a race could double are ONE statement or ONE batch:
//
//   createPost    the post and its cooked_yours Activity; one live post per
//                 dish is the partial UNIQUE index refusing a second
//   yum           the Yum, its Activity and the claim of the hourly push slot
//                 (yum_pushed_at), each guarded on the Yum being new
//   addComment    the comment (counted against the hour's limit in its own
//                 statement) and its Activity
//   removeComment the soft delete (its author or the post's) and its Activity
//   createReport  the report and its audit event
//
// Kept beside the rest of the kitchen's storage and spread into
// KitchenRepository, as the community's is.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import type { AppendEventWithAuditInput } from "../events/types.js";
import { activityStatement, type KitchenActivityKind, type KitchenActivityWrite } from "./activity-write.js";
import { mapProfile, notBlockedSql, type KitchenProfileRecord } from "./community.js";
import type { KitchenResult } from "./types.js";

export type KitchenPostAudience = "followers" | "public" | "me";

/** A post's stats as stored: only the chosen ones (the table refuses any other key). */
export interface KitchenPostStats {
  size?: { factorMilli: number | null; main: { name: string; qtyMilli: number; unit: string } | null; portionsHalf: number };
  minutes?: number;
  ate?: number;
  steps?: { done: number; total: number };
}

/** One post as a viewer reads it. */
export interface KitchenPostRecord {
  id: string;
  authorId: string;
  /** The author's profile; null when they have none (only their own Just me posts). */
  author: KitchenProfileRecord | null;
  dishId: string | null;
  recipeId: string | null;
  title: string;
  caption: string | null;
  audience: KitchenPostAudience;
  stats: KitchenPostStats;
  /** The linked recipe while it is still public (or Cookpool's) and live; null otherwise. */
  recipe: { id: string; name: string; linkCode: string | null } | null;
  /** Yums from people with no block with the viewer. */
  yumCount: number;
  /** The viewer said Yum. */
  yummed: boolean;
  /** Live comments from people with no block with the viewer. */
  commentCount: number;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

/** A recipe as a post's source reads it: only what linking and the stats need. */
export interface KitchenPostSourceRecipe {
  id: string;
  ownerId: string;
  name: string;
  visibility: string;
  listed: boolean;
  isSystem: boolean;
  deleted: boolean;
  linkCode: string | null;
  sourceRecipeId: string | null;
  sourceOwnerId: string | null;
}

/** What a post is computed from: the dish's own facts, its step log's totals and its recipe — no money, no people. */
export interface KitchenPostSource {
  dishId: string;
  cook: string;
  /** True for a dish shared with a group; the group itself is never read. */
  inGroup: boolean;
  state: "draft" | "open" | "finalized" | "canceled";
  name: string;
  portionsHalf: number;
  recipeFactorMilli: number | null;
  /** How many shares the dish has. Since CM-8 a post's `ate` is the dish's servings (`portionsHalf`), not this. */
  shares: number;
  /** Steps with a logged time, and their seconds. */
  stepsLogged: number;
  stepSeconds: number;
  /** The live post of this dish, when there is one. */
  livePostId: string | null;
  recipe: KitchenPostSourceRecipe | null;
  /** The recipe's cook steps (prep is never logged). */
  recipeCookSteps: number;
  /** The recipe's main line as written. */
  mainLine: { name: string; qtyMilli: number; unit: string } | null;
  /** What the recipe was copied from, when it is a copy. */
  sourceRecipe: KitchenPostSourceRecipe | null;
}

export interface CreatePostInput {
  id: string;
  authorId: string;
  dishId: string;
  recipeId: string | null;
  title: string;
  caption: string | null;
  audience: KitchenPostAudience;
  stats: KitchenPostStats;
  now: Date;
  /** cooked_yours to the recipe's owner (written unless Just me, a block, or oneself). */
  cookedYours: KitchenActivityWrite | null;
}

/** `activity`: the cooked_yours row was written (so its push may go). */
export type CreatePostResult = { kind: "created"; activity: boolean } | { kind: "already_posted" };

export interface UpdatePostInput {
  id: string;
  authorId: string;
  caption?: string | null;
  audience?: KitchenPostAudience;
  stats?: KitchenPostStats;
  now: Date;
  /** cooked_yours, when the post now reaches beyond Just me and none was written yet. */
  cookedYours: KitchenActivityWrite | null;
}

/** Where a page of posts (or Discover's candidates) ends: newest first. */
export interface KitchenPostCursor {
  at: string;
  id: string;
}

export interface KitchenPostsPage {
  posts: KitchenPostRecord[];
  nextCursor: KitchenPostCursor | null;
}

export interface YumInput {
  postId: string;
  userId: string;
  now: Date;
  activity: KitchenActivityWrite;
  /** The author was last pushed before this: the slot is free. */
  pushCutoff: Date;
}

export interface YumResult {
  /** A new Yum (false: they already had). */
  created: boolean;
  /** This Yum took the post's hourly push slot. */
  push: boolean;
}

export interface KitchenCommentRecord {
  id: string;
  postId: string;
  authorId: string;
  author: KitchenProfileRecord | null;
  body: string;
  createdAt: Date;
}

export interface AddCommentInput {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  now: Date;
  /** The hour's limit: refused when this many were written since `since`. */
  maxPerHour: number;
  since: Date;
  activity: KitchenActivityWrite;
}

/** `activity`: the post's author got the comment's Activity row (so its push may go). */
export type AddCommentResult = { kind: "added"; comment: KitchenCommentRecord; activity: boolean } | { kind: "limited" };

export type KitchenReportTargetKind = "post" | "comment" | "profile";
export type KitchenReportReason = "spam" | "abuse" | "unsafe" | "other";

export interface KitchenReportRecord {
  id: string;
  reporterId: string;
  targetKind: KitchenReportTargetKind;
  targetId: string;
  reason: KitchenReportReason;
  note: string | null;
  createdAt: Date;
  state: "open" | "closed";
}

export interface CreateReportInput {
  id: string;
  reporterId: string;
  targetKind: KitchenReportTargetKind;
  targetId: string;
  reason: KitchenReportReason;
  note: string | null;
  now: Date;
  audit: AppendEventWithAuditInput;
}

/** One Activity item: a row, or every Yum on one post (`key` `yum_<post>`). */
export interface KitchenSocialActivityItem {
  key: string;
  kind: Exclude<KitchenActivityKind, "follow_request">;
  at: Date;
  unread: boolean;
  /** The row's actor; for a Yum item, the latest few, newest first. */
  actorIds: string[];
  /** How many did it (a Yum item: every Yum still there). */
  count: number;
  postId: string | null;
  commentId: string | null;
  recipeId: string | null;
}

export interface KitchenSocialActivityCursor {
  at: string;
  key: string;
}

export interface KitchenSocialActivityPage {
  items: KitchenSocialActivityItem[];
  nextCursor: KitchenSocialActivityCursor | null;
}

export interface KitchenCookOfMine {
  profile: KitchenProfileRecord;
  /** The latest of the viewer's recipes they cooked. */
  recipeName: string;
}

export interface PostsRepository {
  /** What posting a dish computes from; null when the dish isn't this cook's. */
  postSource(dishId: string, cook: string): Promise<KitchenResult<KitchenPostSource | null>>;
  createPost(input: CreatePostInput): Promise<KitchenResult<CreatePostResult>>;
  /** The post, when the viewer may see it (and it is live); null otherwise. */
  getPost(postId: string, viewer: string): Promise<KitchenResult<KitchenPostRecord | null>>;
  /** The author's own post, live or deleted; null when it isn't theirs. */
  getOwnPost(postId: string, authorId: string): Promise<KitchenResult<KitchenPostRecord | null>>;
  /** `updated` false when it isn't the author's live post; `activity` when a cooked_yours row was written. */
  updatePost(input: UpdatePostInput): Promise<KitchenResult<{ updated: boolean; activity: boolean }>>;
  /** Soft: true when a live post of the author's was deleted. */
  deletePost(postId: string, authorId: string, now: Date): Promise<KitchenResult<boolean>>;
  /** Puts back a post deleted after `deletedAfter`; `already_posted` when the dish has a live post again. */
  restorePost(postId: string, authorId: string, deletedAfter: Date): Promise<KitchenResult<"restored" | "not_restorable" | "already_posted">>;
  /** Yum names for these posts: up to `limit` each, people the viewer follows first, never the viewer. */
  yumNames(postIds: readonly string[], viewer: string, limit: number): Promise<KitchenResult<Map<string, string[]>>>;
  /** The viewer's own totals (seconds) of earlier cooks of this dish's recipe root at its size, one per dish. */
  stepTotalsLike(dishId: string, viewer: string): Promise<KitchenResult<number[]>>;
  /** Following: the viewer's posts and those of people they follow (accepted) and haven't muted, newest first. */
  followingFeed(viewer: string, cursor: KitchenPostCursor | null, limit: number): Promise<KitchenResult<KitchenPostsPage>>;
  /**
   * Discover's candidates, newest first: public posts since `since` by public
   * profiles the viewer doesn't follow, not theirs, no block, neither the post
   * nor its author with `hideAt` open reports. Ranked by kitchen-worker.
   */
  discoverCandidates(query: { viewer: string; since: Date; before: KitchenPostCursor | null; limit: number; hideAt: number }): Promise<KitchenResult<KitchenPostRecord[]>>;
  /** One author's posts the viewer may see, newest first. */
  authorPosts(authorId: string, viewer: string, cursor: KitchenPostCursor | null, limit: number): Promise<KitchenResult<KitchenPostsPage>>;
  /** The author's live posts as a profile counts them: all of them for themselves, else all but Just me. */
  postCount(authorId: string, viewer: string): Promise<KitchenResult<number>>;
  yum(input: YumInput): Promise<KitchenResult<YumResult>>;
  /** True when there was a Yum to take back (its Activity goes with it). */
  unyum(postId: string, userId: string): Promise<KitchenResult<boolean>>;
  /** The post's Yums as the viewer counts them, and whether they said Yum. */
  yumState(postId: string, viewer: string): Promise<KitchenResult<{ count: number; mine: boolean }>>;
  addComment(input: AddCommentInput): Promise<KitchenResult<AddCommentResult>>;
  /** Live comments on a post, oldest first, without anyone with a block with the viewer. */
  listComments(postId: string, viewer: string, after: KitchenPostCursor | null, limit: number): Promise<KitchenResult<{ comments: KitchenCommentRecord[]; nextCursor: KitchenPostCursor | null }>>;
  /** A live comment and its post's author; null when there is none. */
  getComment(commentId: string): Promise<KitchenResult<(KitchenCommentRecord & { postAuthorId: string }) | null>>;
  /** Removes a live comment by its author or its post's author; false when there is none they may remove. */
  removeComment(commentId: string, by: string, now: Date): Promise<KitchenResult<boolean>>;
  /** The reporter's report of the target, when there is one. */
  getReport(reporterId: string, targetKind: KitchenReportTargetKind, targetId: string): Promise<KitchenResult<KitchenReportRecord | null>>;
  /** The report and its audit; `existing` when this reporter already reported the target. */
  createReport(input: CreateReportInput): Promise<KitchenResult<{ kind: "created" | "existing"; report: KitchenReportRecord }>>;
  activityPage(userId: string, cursor: KitchenSocialActivityCursor | null, limit: number, actorsMax: number): Promise<KitchenResult<KitchenSocialActivityPage>>;
  /** Unread items as Activity shows them (a post's Yums count once), plus waiting requests not yet read. */
  unreadActivity(userId: string): Promise<KitchenResult<number>>;
  /** Marks read everything up to `before`; how many rows. */
  markActivityRead(userId: string, before: Date, now: Date): Promise<KitchenResult<number>>;
  /** Follow requests waiting on the person, with no block. */
  followRequestCount(userId: string): Promise<KitchenResult<number>>;
  /** The titles of these posts the viewer may see. */
  postTitles(postIds: readonly string[], viewer: string): Promise<KitchenResult<Map<string, string>>>;
  /** The bodies of these live comments. */
  commentBodies(commentIds: readonly string[]): Promise<KitchenResult<Map<string, string>>>;
  /** The names of these live recipes. */
  recipeNames(recipeIds: readonly string[]): Promise<KitchenResult<Map<string, string>>>;
  /** People who posted cooks of the viewer's recipes, unfollowed and unblocked, the latest first. */
  cooksOfMine(query: { viewer: string; limit: number }): Promise<KitchenResult<KitchenCookOfMine[]>>;
}

// ── SQL ────────────────────────────────────────────────────

type Row = Record<string, unknown>;


/**
 * The viewer (placeholder `v`) may see post `p`: it is live, and theirs, or —
 * with no block either way — not Just me, and either they follow its author
 * (accepted) or it is public and its author's profile is public.
 */
export function visiblePostSql(v: string, p = "p"): string {
  return `${p}.deleted_at IS NULL AND (${p}.author_id = ${v} OR (
            ${p}.audience <> 'me' AND ${notBlockedSql(v, `${p}.author_id`)}
            AND (EXISTS (SELECT 1 FROM kitchen_follows vf
                         WHERE vf.follower_id = ${v} AND vf.followee_id = ${p}.author_id AND vf.state = 'accepted')
                 OR (${p}.audience = 'public'
                     AND EXISTS (SELECT 1 FROM kitchen_profiles vp WHERE vp.user_id = ${p}.author_id AND vp.privacy = 'public')))))`;
}

/** Open reports of a target from different people (one report per reporter and target). */
function openReportsSql(kind: string, target: string): string {
  return `(SELECT COUNT(*) FROM kitchen_reports kr WHERE kr.target_kind = ${kind} AND kr.target_id = ${target} AND kr.state = 'open')`;
}

const AUTHOR_COLUMNS = ["user_id", "handle", "name", "about", "privacy", "handle_changed_at", "created_at", "updated_at"];

/** Everything a post read maps, for viewer placeholder `v`. */
function postSelect(v: string): string {
  return `SELECT p.id, p.author_id, p.dish_id, p.recipe_id, p.title, p.caption, p.audience, p.stats,
            p.created_at, p.edited_at, p.deleted_at,
            ${AUTHOR_COLUMNS.map((c) => `a.${c} AS a_${c}`).join(", ")},
            lr.id AS link_id, lr.name AS link_name, lr.link_code AS link_code,
            (SELECT COUNT(*) FROM kitchen_post_yums y WHERE y.post_id = p.id AND ${notBlockedSql(v, "y.user_id")}) AS yum_count,
            EXISTS (SELECT 1 FROM kitchen_post_yums y WHERE y.post_id = p.id AND y.user_id = ${v}) AS yummed,
            (SELECT COUNT(*) FROM kitchen_post_comments c
              WHERE c.post_id = p.id AND c.deleted_at IS NULL AND ${notBlockedSql(v, "c.author_id")}) AS comment_count
          FROM kitchen_posts p
          LEFT JOIN kitchen_profiles a ON a.user_id = p.author_id
          LEFT JOIN kitchen_recipes lr ON lr.id = p.recipe_id AND lr.deleted_at IS NULL
                                       AND (lr.is_system = 1 OR (lr.visibility = 'link' AND lr.listed = 1))`;
}

function parseStats(raw: unknown): KitchenPostStats {
  try {
    const parsed = JSON.parse(String(raw ?? "{}")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as KitchenPostStats) : {};
  } catch {
    return {};
  }
}

function mapPost(row: Row): KitchenPostRecord {
  const author: Row = {};
  for (const c of AUTHOR_COLUMNS) author[c] = row[`a_${c}`];
  return {
    id: row.id as string,
    authorId: row.author_id as string,
    author: row.a_user_id ? mapProfile(author) : null,
    dishId: (row.dish_id as string | null) ?? null,
    recipeId: (row.recipe_id as string | null) ?? null,
    title: row.title as string,
    caption: (row.caption as string | null) ?? null,
    audience: row.audience as KitchenPostAudience,
    stats: parseStats(row.stats),
    recipe: row.link_id ? { id: row.link_id as string, name: row.link_name as string, linkCode: (row.link_code as string | null) ?? null } : null,
    yumCount: Number(row.yum_count ?? 0),
    yummed: Number(row.yummed ?? 0) === 1,
    commentCount: Number(row.comment_count ?? 0),
    createdAt: new Date(row.created_at as string),
    editedAt: row.edited_at ? new Date(row.edited_at as string) : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string) : null,
  };
}

function mapSourceRecipe(row: Row, p: string): KitchenPostSourceRecipe | null {
  if (!row[`${p}_id`]) return null;
  return {
    id: row[`${p}_id`] as string,
    ownerId: row[`${p}_owner_id`] as string,
    name: row[`${p}_name`] as string,
    visibility: row[`${p}_visibility`] as string,
    listed: Number(row[`${p}_listed`]) === 1,
    isSystem: Number(row[`${p}_is_system`]) === 1,
    deleted: row[`${p}_deleted_at`] !== null && row[`${p}_deleted_at`] !== undefined,
    linkCode: (row[`${p}_link_code`] as string | null) ?? null,
    sourceRecipeId: (row[`${p}_source_recipe_id`] as string | null) ?? null,
    sourceOwnerId: (row[`${p}_source_owner_id`] as string | null) ?? null,
  };
}

const RECIPE_FIELDS = ["id", "owner_id", "name", "visibility", "listed", "is_system", "deleted_at", "link_code", "source_recipe_id", "source_owner_id"];
const recipeColumns = (alias: string) => RECIPE_FIELDS.map((c) => `${alias}.${c} AS ${alias}_${c}`).join(", ");

function mapComment(row: Row): KitchenCommentRecord {
  const author: Row = {};
  for (const c of AUTHOR_COLUMNS) author[c] = row[`a_${c}`];
  return {
    id: row.id as string,
    postId: row.post_id as string,
    authorId: row.author_id as string,
    author: row.a_user_id ? mapProfile(author) : null,
    body: row.body as string,
    createdAt: new Date(row.created_at as string),
  };
}

function mapReport(row: Row): KitchenReportRecord {
  return {
    id: row.id as string,
    reporterId: row.reporter_id as string,
    targetKind: row.target_kind as KitchenReportTargetKind,
    targetId: row.target_id as string,
    reason: row.reason as KitchenReportReason,
    note: (row.note as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    state: row.state as "open" | "closed",
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

/** A page from posts read one more than `limit`, newest first. */
function postsPage(rows: readonly Row[], limit: number): KitchenPostsPage {
  const posts = rows.slice(0, limit).map(mapPost);
  const last = posts[posts.length - 1];
  return { posts, nextCursor: rows.length > limit && last ? { at: last.createdAt.toISOString(), id: last.id } : null };
}

/** Live comments are counted for the viewer; a cooked_yours row is written once per post. */
function cookedYoursStatement(write: KitchenActivityWrite | null): SqlStatement[] {
  if (!write) return [];
  // Once per post, and only while the post reaches beyond Just me.
  return [
    activityStatement(
      write,
      `NOT EXISTS (SELECT 1 FROM kitchen_activity x WHERE x.post_id = $5 AND x.kind = 'cooked_yours')
       AND EXISTS (SELECT 1 FROM kitchen_posts xp WHERE xp.id = $5 AND xp.deleted_at IS NULL AND xp.audience <> 'me')`,
    ),
  ];
}

/** The Activity items of one person (see `activityPage`), as a CTE named `items`. */
function activityItemsCte(): string {
  const live = `(a.post_id IS NULL OR EXISTS (SELECT 1 FROM kitchen_posts lp WHERE lp.id = a.post_id AND lp.deleted_at IS NULL))`;
  return `WITH items AS (
            SELECT 'yum_' || a.post_id AS item_key, 'yum' AS kind, MAX(a.created_at) AS at, a.post_id AS post_id,
                   NULL AS comment_id, NULL AS recipe_id, COUNT(*) AS n, MAX(a.read_at IS NULL) AS unread, NULL AS actor_id
            FROM kitchen_activity a
            WHERE a.user_id = $1 AND a.kind = 'yum' AND ${notBlockedSql("$1", "a.actor_id")} AND ${live}
            GROUP BY a.post_id
            UNION ALL
            SELECT a.id, a.kind, a.created_at, a.post_id, a.comment_id, a.recipe_id, 1, a.read_at IS NULL, a.actor_id
            FROM kitchen_activity a
            WHERE a.user_id = $1 AND a.kind NOT IN ('yum', 'follow_request') AND ${notBlockedSql("$1", "a.actor_id")} AND ${live}
          )`;
}

// ── Repository ─────────────────────────────────────────────

export function createPostsRepository(executor: SqlExecutor): PostsRepository {
  async function rows(text: string, params: unknown[]): Promise<KitchenResult<Row[]>> {
    try {
      return { ok: true, value: (await executor.execute(text, params)).rows };
    } catch (err) {
      return internal(err);
    }
  }

  async function count(text: string, params: unknown[]): Promise<KitchenResult<number>> {
    const found = await rows(text, params);
    return found.ok ? { ok: true, value: Number(found.value[0]?.n ?? 0) } : found;
  }

  /** id → text for these ids, from a query whose rows are `{ id, text }`. */
  async function lookup(ids: readonly string[], text: string, extra: unknown[] = []): Promise<KitchenResult<Map<string, string>>> {
    if (ids.length === 0) return { ok: true, value: new Map() };
    const found = await rows(text, [JSON.stringify([...new Set(ids)]), ...extra]);
    return found.ok ? { ok: true, value: new Map(found.value.map((r) => [r.id as string, r.text as string])) } : found;
  }

  const getPost = async (postId: string, viewer: string): Promise<KitchenResult<KitchenPostRecord | null>> => {
    const found = await rows(`${postSelect("$2")} WHERE p.id = $1 AND ${visiblePostSql("$2")}`, [postId, viewer]);
    return found.ok ? { ok: true, value: found.value[0] ? mapPost(found.value[0]) : null } : found;
  };

  return {
    getPost,

    async postSource(dishId, cook) {
      const found = await rows(
        `SELECT d.id, d.cook, d.org_id IS NOT NULL AS in_group, d.state, d.name, d.portions_half, d.recipe_factor_milli,
                (SELECT COUNT(*) FROM kitchen_dish_shares s WHERE s.dish_id = d.id) AS shares,
                (SELECT COUNT(*) FROM kitchen_dish_step_times t WHERE t.dish_id = d.id) AS steps_logged,
                (SELECT COALESCE(SUM(t.seconds), 0) FROM kitchen_dish_step_times t WHERE t.dish_id = d.id) AS step_seconds,
                (SELECT lp.id FROM kitchen_posts lp WHERE lp.dish_id = d.id AND lp.deleted_at IS NULL) AS live_post_id,
                (SELECT COUNT(*) FROM kitchen_recipe_steps st WHERE st.recipe_id = d.recipe_id AND st.phase = 'cook') AS cook_steps,
                ml.name AS main_name, ml.qty_milli AS main_qty, ml.unit AS main_unit,
                ${recipeColumns("r")}, ${recipeColumns("sr")}
         FROM kitchen_dishes d
         LEFT JOIN kitchen_recipes r ON r.id = d.recipe_id
         LEFT JOIN kitchen_recipe_lines ml ON ml.recipe_id = r.id AND ml.is_main = 1 AND ml.to_taste = 0
         LEFT JOIN kitchen_recipes sr ON sr.id = r.source_recipe_id
         WHERE d.id = $1 AND d.cook = $2`,
        [dishId, cook],
      );
      if (!found.ok) return found;
      const row = found.value[0];
      if (!row) return { ok: true, value: null };
      return {
        ok: true,
        value: {
          dishId: row.id as string,
          cook: row.cook as string,
          inGroup: Number(row.in_group) === 1,
          state: row.state as KitchenPostSource["state"],
          name: row.name as string,
          portionsHalf: Number(row.portions_half),
          recipeFactorMilli: row.recipe_factor_milli === null || row.recipe_factor_milli === undefined ? null : Number(row.recipe_factor_milli),
          shares: Number(row.shares ?? 0),
          stepsLogged: Number(row.steps_logged ?? 0),
          stepSeconds: Number(row.step_seconds ?? 0),
          livePostId: (row.live_post_id as string | null) ?? null,
          recipe: mapSourceRecipe(row, "r"),
          recipeCookSteps: Number(row.cook_steps ?? 0),
          mainLine:
            row.main_name && row.main_qty !== null && row.main_unit
              ? { name: row.main_name as string, qtyMilli: Number(row.main_qty), unit: row.main_unit as string }
              : null,
          sourceRecipe: mapSourceRecipe(row, "sr"),
        },
      };
    },

    async createPost(input) {
      try {
        const [, cooked] = await executeBatch(executor, [
          {
            text: `INSERT INTO kitchen_posts (id, author_id, dish_id, recipe_id, title, caption, audience, stats, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            params: [input.id, input.authorId, input.dishId, input.recipeId, input.title, input.caption, input.audience, JSON.stringify(input.stats), input.now],
          },
          ...cookedYoursStatement(input.cookedYours),
        ]);
        return { ok: true, value: { kind: "created", activity: (cooked?.rows.length ?? 0) > 0 } };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: true, value: { kind: "already_posted" } };
        return internal(err);
      }
    },

    async getOwnPost(postId, authorId) {
      const found = await rows(`${postSelect("$2")} WHERE p.id = $1 AND p.author_id = $2`, [postId, authorId]);
      return found.ok ? { ok: true, value: found.value[0] ? mapPost(found.value[0]) : null } : found;
    },

    async updatePost(input) {
      const sets = ["edited_at = $3"];
      const params: unknown[] = [input.id, input.authorId, input.now];
      if (input.caption !== undefined) {
        params.push(input.caption);
        sets.push(`caption = $${params.length}`);
      }
      if (input.audience !== undefined) {
        params.push(input.audience);
        sets.push(`audience = $${params.length}`);
      }
      if (input.stats !== undefined) {
        params.push(JSON.stringify(input.stats));
        sets.push(`stats = $${params.length}`);
      }
      try {
        const [updated, cooked] = await executeBatch(executor, [
          {
            text: `UPDATE kitchen_posts SET ${sets.join(", ")} WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL RETURNING id`,
            params,
          },
          ...cookedYoursStatement(input.cookedYours),
        ]);
        return { ok: true, value: { updated: (updated?.rows.length ?? 0) > 0, activity: (cooked?.rows.length ?? 0) > 0 } };
      } catch (err) {
        return internal(err);
      }
    },

    async deletePost(postId, authorId, now) {
      const found = await rows(
        `UPDATE kitchen_posts SET deleted_at = $3 WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL RETURNING id`,
        [postId, authorId, now],
      );
      return found.ok ? { ok: true, value: found.value.length > 0 } : found;
    },

    async restorePost(postId, authorId, deletedAfter) {
      try {
        const found = await executor.execute(
          `UPDATE kitchen_posts SET deleted_at = NULL WHERE id = $1 AND author_id = $2 AND deleted_at IS NOT NULL AND deleted_at > $3 RETURNING id`,
          [postId, authorId, deletedAfter],
        );
        return { ok: true, value: found.rows.length > 0 ? "restored" : "not_restorable" };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: true, value: "already_posted" };
        return internal(err);
      }
    },

    async yumNames(postIds, viewer, limit) {
      if (postIds.length === 0) return { ok: true, value: new Map() };
      const found = await rows(
        `SELECT post_id, name FROM (
           SELECT y.post_id, pr.name,
                  ROW_NUMBER() OVER (PARTITION BY y.post_id ORDER BY (f.follower_id IS NOT NULL) DESC, y.created_at DESC, y.user_id) AS rn
           FROM kitchen_post_yums y
           JOIN kitchen_profiles pr ON pr.user_id = y.user_id
           LEFT JOIN kitchen_follows f ON f.follower_id = $2 AND f.followee_id = y.user_id AND f.state = 'accepted'
           WHERE y.post_id IN (SELECT value FROM json_each($1)) AND y.user_id <> $2 AND ${notBlockedSql("$2", "y.user_id")}
         ) WHERE rn <= $3
         ORDER BY post_id, rn`,
        [JSON.stringify([...new Set(postIds)]), viewer, limit],
      );
      if (!found.ok) return found;
      const out = new Map<string, string[]>();
      for (const row of found.value) {
        const list = out.get(row.post_id as string) ?? [];
        list.push(row.name as string);
        out.set(row.post_id as string, list);
      }
      return { ok: true, value: out };
    },

    async stepTotalsLike(dishId, viewer) {
      // The root and the size come from the post's own dish's step log (its rows carry the root).
      const found = await rows(
        `WITH here AS (
           SELECT t.recipe_root_id AS root, COALESCE(t.factor_milli, d.recipe_factor_milli) AS factor
           FROM kitchen_dish_step_times t JOIN kitchen_dishes d ON d.id = t.dish_id
           WHERE t.dish_id = $1 LIMIT 1
         )
         SELECT t.dish_id, SUM(t.seconds) AS seconds
         FROM kitchen_dish_step_times t JOIN kitchen_dishes d ON d.id = t.dish_id
         WHERE t.recipe_root_id = (SELECT root FROM here) AND t.cook_id = $2 AND t.dish_id <> $1 AND d.state <> 'canceled'
           AND COALESCE(t.factor_milli, d.recipe_factor_milli) = (SELECT factor FROM here)
         GROUP BY t.dish_id`,
        [dishId, viewer],
      );
      return found.ok ? { ok: true, value: found.value.map((r) => Number(r.seconds)) } : found;
    },

    async followingFeed(viewer, cursor, limit) {
      const params: unknown[] = [viewer, limit + 1];
      let after = "";
      if (cursor) {
        params.push(cursor.at, cursor.id);
        after = "AND (p.created_at < $3 OR (p.created_at = $3 AND p.id < $4))";
      }
      const found = await rows(
        `${postSelect("$1")}
         WHERE p.deleted_at IS NULL ${after}
           AND (p.author_id = $1 OR (
                 p.audience <> 'me' AND ${notBlockedSql("$1", "p.author_id")}
                 AND EXISTS (SELECT 1 FROM kitchen_follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id AND f.state = 'accepted')
                 AND NOT EXISTS (SELECT 1 FROM kitchen_mutes m WHERE m.muter_id = $1 AND m.muted_id = p.author_id)))
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT $2`,
        params,
      );
      return found.ok ? { ok: true, value: postsPage(found.value, limit) } : found;
    },

    async discoverCandidates({ viewer, since, before, limit, hideAt }) {
      const params: unknown[] = [viewer, since, limit, hideAt];
      let after = "";
      if (before) {
        params.push(before.at, before.id);
        after = "AND (p.created_at < $5 OR (p.created_at = $5 AND p.id < $6))";
      }
      const found = await rows(
        `${postSelect("$1")}
         WHERE p.deleted_at IS NULL AND p.audience = 'public' AND p.created_at >= $2 AND p.author_id <> $1 ${after}
           AND a.privacy = 'public'
           AND ${notBlockedSql("$1", "p.author_id")}
           AND NOT EXISTS (SELECT 1 FROM kitchen_follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id AND f.state = 'accepted')
           AND ${openReportsSql("'post'", "p.id")} < $4
           AND ${openReportsSql("'profile'", "p.author_id")} < $4
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT $3`,
        params,
      );
      return found.ok ? { ok: true, value: found.value.map(mapPost) } : found;
    },

    async authorPosts(authorId, viewer, cursor, limit) {
      const params: unknown[] = [authorId, viewer, limit + 1];
      let after = "";
      if (cursor) {
        params.push(cursor.at, cursor.id);
        after = "AND (p.created_at < $4 OR (p.created_at = $4 AND p.id < $5))";
      }
      const found = await rows(
        `${postSelect("$2")}
         WHERE p.author_id = $1 AND ${visiblePostSql("$2")} ${after}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT $3`,
        params,
      );
      return found.ok ? { ok: true, value: postsPage(found.value, limit) } : found;
    },

    postCount: (authorId, viewer) =>
      count(
        `SELECT COUNT(*) AS n FROM kitchen_posts WHERE author_id = $1 AND deleted_at IS NULL AND ($1 = $2 OR audience <> 'me')`,
        [authorId, viewer],
      ),

    async yum({ postId, userId, now, activity, pushCutoff }) {
      // Each of the three after the insert holds only when THIS batch wrote the Yum (its time is now).
      const isNew = `EXISTS (SELECT 1 FROM kitchen_post_yums ny WHERE ny.post_id = $5 AND ny.user_id = $4 AND ny.created_at = $8)`;
      try {
        const [made, , pushed] = await executeBatch(executor, [
          {
            text: `INSERT INTO kitchen_post_yums (post_id, user_id, created_at) VALUES ($1, $2, $3)
                   ON CONFLICT (post_id, user_id) DO NOTHING RETURNING post_id`,
            params: [postId, userId, now],
          },
          activityStatement({ ...activity, postId, actorId: userId, kind: "yum", now }, isNew),
          {
            // The author's hourly push slot: claimed by a new Yum from someone else, with no block, when it is free.
            text: `UPDATE kitchen_posts SET yum_pushed_at = $3
                   WHERE id = $1 AND author_id <> $2 AND (yum_pushed_at IS NULL OR yum_pushed_at <= $4)
                     AND EXISTS (SELECT 1 FROM kitchen_post_yums ny WHERE ny.post_id = $1 AND ny.user_id = $2 AND ny.created_at = $3)
                     AND ${notBlockedSql("$2", "author_id")}
                   RETURNING id`,
            params: [postId, userId, now, pushCutoff],
          },
        ]);
        return { ok: true, value: { created: (made?.rows.length ?? 0) > 0, push: (pushed?.rows.length ?? 0) > 0 } };
      } catch (err) {
        return internal(err);
      }
    },

    async unyum(postId, userId) {
      try {
        const [removed] = await executeBatch(executor, [
          { text: `DELETE FROM kitchen_post_yums WHERE post_id = $1 AND user_id = $2 RETURNING post_id`, params: [postId, userId] },
          { text: `DELETE FROM kitchen_activity WHERE post_id = $1 AND kind = 'yum' AND actor_id = $2`, params: [postId, userId] },
        ]);
        return { ok: true, value: (removed?.rows.length ?? 0) > 0 };
      } catch (err) {
        return internal(err);
      }
    },

    async yumState(postId, viewer) {
      const found = await rows(
        `SELECT (SELECT COUNT(*) FROM kitchen_post_yums y WHERE y.post_id = $1 AND ${notBlockedSql("$2", "y.user_id")}) AS n,
                EXISTS (SELECT 1 FROM kitchen_post_yums y WHERE y.post_id = $1 AND y.user_id = $2) AS mine`,
        [postId, viewer],
      );
      if (!found.ok) return found;
      const row = found.value[0] ?? {};
      return { ok: true, value: { count: Number(row.n ?? 0), mine: Number(row.mine ?? 0) === 1 } };
    },

    async addComment(input) {
      try {
        const [made, noted] = await executeBatch(executor, [
          {
            text: `INSERT INTO kitchen_post_comments (id, post_id, author_id, body, created_at)
                   SELECT $1, $2, $3, $4, $5
                   WHERE (SELECT COUNT(*) FROM kitchen_post_comments WHERE author_id = $3 AND created_at > $6) < $7
                   RETURNING id`,
            params: [input.id, input.postId, input.authorId, input.body, input.now, input.since, input.maxPerHour],
          },
          activityStatement(
            { ...input.activity, postId: input.postId, commentId: input.id, actorId: input.authorId, kind: "comment", now: input.now },
            `EXISTS (SELECT 1 FROM kitchen_post_comments nc WHERE nc.id = $6)`,
          ),
        ]);
        if ((made?.rows.length ?? 0) === 0) return { ok: true, value: { kind: "limited" } };
        return {
          ok: true,
          value: {
            kind: "added",
            comment: { id: input.id, postId: input.postId, authorId: input.authorId, author: null, body: input.body, createdAt: input.now },
            activity: (noted?.rows.length ?? 0) > 0,
          },
        };
      } catch (err) {
        return internal(err);
      }
    },

    async listComments(postId, viewer, after, limit) {
      const params: unknown[] = [postId, viewer, limit + 1];
      let page = "";
      if (after) {
        params.push(after.at, after.id);
        page = "AND (c.created_at > $4 OR (c.created_at = $4 AND c.id > $5))";
      }
      const found = await rows(
        `SELECT c.id, c.post_id, c.author_id, c.body, c.created_at, ${AUTHOR_COLUMNS.map((x) => `a.${x} AS a_${x}`).join(", ")}
         FROM kitchen_post_comments c LEFT JOIN kitchen_profiles a ON a.user_id = c.author_id
         WHERE c.post_id = $1 AND c.deleted_at IS NULL AND ${notBlockedSql("$2", "c.author_id")} ${page}
         ORDER BY c.created_at, c.id
         LIMIT $3`,
        params,
      );
      if (!found.ok) return found;
      const comments = found.value.slice(0, limit).map(mapComment);
      const last = comments[comments.length - 1];
      return {
        ok: true,
        value: { comments, nextCursor: found.value.length > limit && last ? { at: last.createdAt.toISOString(), id: last.id } : null },
      };
    },

    async getComment(commentId) {
      const found = await rows(
        `SELECT c.id, c.post_id, c.author_id, c.body, c.created_at, p.author_id AS post_author_id
         FROM kitchen_post_comments c JOIN kitchen_posts p ON p.id = c.post_id
         WHERE c.id = $1 AND c.deleted_at IS NULL`,
        [commentId],
      );
      if (!found.ok) return found;
      const row = found.value[0];
      return { ok: true, value: row ? { ...mapComment(row), postAuthorId: row.post_author_id as string } : null };
    },

    async removeComment(commentId, by, now) {
      try {
        const [removed] = await executeBatch(executor, [
          {
            text: `UPDATE kitchen_post_comments SET deleted_at = $3, deleted_by = $2
                   WHERE id = $1 AND deleted_at IS NULL
                     AND (author_id = $2 OR EXISTS (SELECT 1 FROM kitchen_posts p WHERE p.id = post_id AND p.author_id = $2))
                   RETURNING id`,
            params: [commentId, by, now],
          },
          {
            text: `DELETE FROM kitchen_activity
                   WHERE comment_id = $1 AND EXISTS (SELECT 1 FROM kitchen_post_comments c WHERE c.id = $1 AND c.deleted_at IS NOT NULL)`,
            params: [commentId],
          },
        ]);
        return { ok: true, value: (removed?.rows.length ?? 0) > 0 };
      } catch (err) {
        return internal(err);
      }
    },

    async getReport(reporterId, targetKind, targetId) {
      const found = await rows(
        `SELECT id, reporter_id, target_kind, target_id, reason, note, created_at, state FROM kitchen_reports
         WHERE reporter_id = $1 AND target_kind = $2 AND target_id = $3`,
        [reporterId, targetKind, targetId],
      );
      return found.ok ? { ok: true, value: found.value[0] ? mapReport(found.value[0]) : null } : found;
    },

    async createReport(input) {
      const existing = async () => {
        const found = await rows(
          `SELECT id, reporter_id, target_kind, target_id, reason, note, created_at, state FROM kitchen_reports
           WHERE reporter_id = $1 AND target_kind = $2 AND target_id = $3`,
          [input.reporterId, input.targetKind, input.targetId],
        );
        return found;
      };
      try {
        const [made] = await executeBatch(executor, [
          {
            text: `INSERT INTO kitchen_reports (id, reporter_id, target_kind, target_id, reason, note, created_at, state)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
                   RETURNING id, reporter_id, target_kind, target_id, reason, note, created_at, state`,
            params: [input.id, input.reporterId, input.targetKind, input.targetId, input.reason, input.note, input.now],
          },
          // The audit lands with the report or not at all: a repeat is the UNIQUE refusing the whole batch.
          ...eventWithAuditStatements(input.audit),
        ]);
        const row = made?.rows[0];
        if (!row) return internal("kitchen: report insert returned no row");
        return { ok: true, value: { kind: "created", report: mapReport(row) } };
      } catch (err) {
        if (!isUniqueViolation(err)) return internal(err);
        const found = await existing();
        if (!found.ok) return found;
        const row = found.value[0];
        return row ? { ok: true, value: { kind: "existing", report: mapReport(row) } } : internal(err);
      }
    },

    async activityPage(userId, cursor, limit, actorsMax) {
      const params: unknown[] = [userId, limit + 1];
      let after = "";
      if (cursor) {
        params.push(cursor.at, cursor.key);
        after = "WHERE (at < $3 OR (at = $3 AND item_key < $4))";
      }
      const found = await rows(`${activityItemsCte()} SELECT * FROM items ${after} ORDER BY at DESC, item_key DESC LIMIT $2`, params);
      if (!found.ok) return found;
      const page = found.value.slice(0, limit);
      // The latest few who said Yum, per post on this page.
      const yumPosts = page.filter((r) => r.kind === "yum").map((r) => r.post_id as string);
      const actors = new Map<string, string[]>();
      if (yumPosts.length > 0) {
        const latest = await rows(
          `SELECT post_id, actor_id FROM (
             SELECT a.post_id, a.actor_id, ROW_NUMBER() OVER (PARTITION BY a.post_id ORDER BY a.created_at DESC, a.actor_id) AS rn
             FROM kitchen_activity a
             WHERE a.user_id = $1 AND a.kind = 'yum' AND a.post_id IN (SELECT value FROM json_each($2)) AND ${notBlockedSql("$1", "a.actor_id")}
           ) WHERE rn <= $3 ORDER BY post_id, rn`,
          [userId, JSON.stringify(yumPosts), actorsMax],
        );
        if (!latest.ok) return latest;
        for (const row of latest.value) {
          const list = actors.get(row.post_id as string) ?? [];
          list.push(row.actor_id as string);
          actors.set(row.post_id as string, list);
        }
      }
      const items: KitchenSocialActivityItem[] = page.map((r) => ({
        key: r.item_key as string,
        kind: r.kind as KitchenSocialActivityItem["kind"],
        at: new Date(r.at as string),
        unread: Number(r.unread) === 1,
        actorIds: r.kind === "yum" ? (actors.get(r.post_id as string) ?? []) : [r.actor_id as string],
        count: Number(r.n),
        postId: (r.post_id as string | null) ?? null,
        commentId: (r.comment_id as string | null) ?? null,
        recipeId: (r.recipe_id as string | null) ?? null,
      }));
      const last = items[items.length - 1];
      return {
        ok: true,
        value: { items, nextCursor: found.value.length > limit && last ? { at: last.at.toISOString(), key: last.key } : null },
      };
    },

    unreadActivity: (userId) =>
      count(
        `${activityItemsCte()}
         SELECT (SELECT COUNT(*) FROM items WHERE unread = 1)
              + (SELECT COUNT(*) FROM kitchen_activity a
                 WHERE a.user_id = $1 AND a.kind = 'follow_request' AND a.read_at IS NULL
                   AND EXISTS (SELECT 1 FROM kitchen_follows f WHERE f.follower_id = a.actor_id AND f.followee_id = $1 AND f.state = 'requested')) AS n`,
        [userId],
      ),

    async markActivityRead(userId, before, now) {
      const found = await rows(
        `UPDATE kitchen_activity SET read_at = $3 WHERE user_id = $1 AND read_at IS NULL AND created_at <= $2 RETURNING id`,
        [userId, before, now],
      );
      return found.ok ? { ok: true, value: found.value.length } : found;
    },

    followRequestCount: (userId) =>
      count(
        `SELECT COUNT(*) AS n FROM kitchen_follows f
         WHERE f.followee_id = $1 AND f.state = 'requested' AND ${notBlockedSql("$1", "f.follower_id")}
           AND EXISTS (SELECT 1 FROM kitchen_profiles p WHERE p.user_id = f.follower_id)`,
        [userId],
      ),

    postTitles: (postIds, viewer) =>
      lookup(postIds, `SELECT p.id, p.title AS text FROM kitchen_posts p WHERE p.id IN (SELECT value FROM json_each($1)) AND ${visiblePostSql("$2")}`, [viewer]),

    commentBodies: (commentIds) =>
      lookup(commentIds, `SELECT id, body AS text FROM kitchen_post_comments WHERE id IN (SELECT value FROM json_each($1)) AND deleted_at IS NULL`),

    recipeNames: (recipeIds) =>
      lookup(recipeIds, `SELECT id, name AS text FROM kitchen_recipes WHERE id IN (SELECT value FROM json_each($1)) AND deleted_at IS NULL`),

    async cooksOfMine({ viewer, limit }) {
      const found = await rows(
        `SELECT ${AUTHOR_COLUMNS.map((c) => `pr.${c}`).join(", ")}, r.name AS recipe_name, MAX(a.created_at) AS cooked_at
         FROM kitchen_activity a
         JOIN kitchen_profiles pr ON pr.user_id = a.actor_id
         JOIN kitchen_recipes r ON r.id = a.recipe_id
         WHERE a.user_id = $1 AND a.kind = 'cooked_yours' AND a.actor_id <> $1
           AND ${notBlockedSql("$1", "pr.user_id")}
           AND NOT EXISTS (SELECT 1 FROM kitchen_follows kf WHERE kf.follower_id = $1 AND kf.followee_id = pr.user_id)
         GROUP BY a.actor_id
         ORDER BY cooked_at DESC, pr.user_id
         LIMIT $2`,
        [viewer, limit],
      );
      return found.ok ? { ok: true, value: found.value.map((row) => ({ profile: mapProfile(row), recipeName: row.recipe_name as string })) } : found;
    },
  };
}
