import {
  DISCOVER_BOOST_MAX_HOURS,
  DISCOVER_DAYS,
  FEED_PAGE_SIZE,
  FEED_TABS,
  KITCHEN_COMMUNITY_ERROR_REASONS,
  KITCHEN_EMAILS,
  KITCHEN_POSTS_ERROR_REASONS,
  POST_AUDIENCES,
  POST_CAPTION_MAX,
  POST_SHOW_KEYS,
  POST_UNDO_MS,
  REPORTS_TO_HIDE,
  YUM_NAMES_MAX,
  discoverBoostMs,
  type DeletePostResponse,
  type FeedResponse,
  type FeedTab,
  type PostAudience,
  type PostResponse,
  type PostShow,
  type ProfilePostsResponse,
} from "@saas/contracts/kitchen";
import type { KitchenActivityWrite, KitchenPostCursor, KitchenPostRecord, KitchenPostSource, KitchenPostStats, KitchenRepository } from "@saas/db/kitchen";
import { canSeeProfile, decodeCursor, encodeCursor, visibleProfile } from "../community.js";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { conflict, forbidden, notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { amountWords, computeStats, isPostKey, linkOf, postParam, postTitle, postable, showOf, shownOf, stepCompareOf, toCommunityPost } from "../posts.js";
import { deferSocialPush } from "../social-push.js";
import { Fields, oneOf } from "../validate.js";

// Posts and the feeds (CM-3, cookpool-community design §2):
//
//   POST   /v1/kitchen/me/posts                 { dishId, caption?, audience, show? } → 201 { post }
//   PATCH  /v1/kitchen/me/posts/{pst}           { caption?, audience?, show? } → { post }
//   DELETE /v1/kitchen/me/posts/{pst}           → { deleted: true, restoreUntil }
//   POST   /v1/kitchen/me/posts/{pst}/restore   → { post } (within POST_UNDO_MS)
//   GET    /v1/kitchen/posts/{pst}              → { post } (with stepCompare)
//   GET    /v1/kitchen/me/feed?tab=&cursor=     → { tab, posts, nextCursor }
//   GET    /v1/kitchen/profiles/{handle}/posts  canSee → { posts, nextCursor }
//
// Only a dish's cook posts it (anyone else's dish is the opaque 404), any
// dish of theirs but a canceled one — before or after it is split with a
// group, open or finalized (CM-8) — and one live post per dish. Beyond
// Just me needs a profile (403 `no_profile`). Who sees a post is storage's
// `visiblePostSql`, in every read here; a post nobody may see is the opaque
// 404. A post's stats are `computeStats`'s — only the chosen ones.

const R = KITCHEN_POSTS_ERROR_REASONS;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface ParsedPostFields {
  caption?: string | null;
  audience?: PostAudience;
  show?: Partial<PostShow>;
}

/** caption, audience and show as either write takes them. */
function parsePostFields(fields: Fields, body: Record<string, unknown>, audienceRequired: boolean): ParsedPostFields {
  const out: ParsedPostFields = {};
  if (body.caption !== undefined) {
    if (body.caption === null || (typeof body.caption === "string" && body.caption.trim() === "")) out.caption = null;
    else if (typeof body.caption !== "string") fields.add("caption", `Text up to ${POST_CAPTION_MAX} characters, or null`);
    else if (body.caption.trim().length > POST_CAPTION_MAX) fields.add("caption", `At most ${POST_CAPTION_MAX} characters`);
    else out.caption = body.caption.trim();
  }
  if (body.audience !== undefined || audienceRequired) {
    const audience = oneOf(fields, "audience", body.audience, POST_AUDIENCES);
    if (audience !== undefined) out.audience = audience;
  }
  if (body.show !== undefined) {
    if (!body.show || typeof body.show !== "object" || Array.isArray(body.show)) fields.add("show", "An object of size, time, ate and steps");
    else {
      const show: Partial<PostShow> = {};
      for (const [key, value] of Object.entries(body.show as Record<string, unknown>)) {
        if (!(POST_SHOW_KEYS as readonly string[]).includes(key)) fields.add(`show.${key}`, "Not a stat a post can show");
        else if (typeof value !== "boolean") fields.add(`show.${key}`, "true or false");
        else show[key as keyof PostShow] = value;
      }
      out.show = show;
    }
  }
  return out;
}

/** The post with its Yum names (and, on its own read, the viewer's usual time), as a response. */
async function postResponse(ctx: RequestContext, repo: KitchenRepository, record: KitchenPostRecord, status = 200, withCompare = false): Promise<Response> {
  const me = ctx.actor.subjectId;
  const [names, totals] = await ctx.timings.measure("db", () =>
    Promise.all([
      repo.yumNames([record.id], me, YUM_NAMES_MAX),
      withCompare && record.dishId ? repo.stepTotalsLike(record.dishId, me) : Promise.resolve({ ok: true as const, value: [] as number[] }),
    ]),
  );
  if (!names.ok || !totals.ok) return unavailable(ctx.requestId);
  const post = toCommunityPost(record, me, names.value.get(record.id) ?? [], stepCompareOf(totals.value));
  return successResponse<PostResponse>({ post }, ctx.requestId, status);
}

/** cooked_yours for a post reaching beyond Just me: the Activity row to write, and its push. */
function cookedYours(ctx: RequestContext, source: KitchenPostSource, postId: string, audience: PostAudience, stats: KitchenPostStats) {
  const { recipe, owner } = linkOf(source);
  if (!recipe || !owner || audience === "me") return null;
  const write: KitchenActivityWrite = {
    id: crypto.randomUUID(),
    userId: owner,
    kind: "cooked_yours",
    actorId: ctx.actor.subjectId,
    postId,
    recipeId: recipe.id,
    now: ctx.now(),
  };
  return { write, recipeName: recipe.name, size: amountWords(stats.size?.main) };
}

async function pushCookedYours(ctx: RequestContext, repo: KitchenRepository, postId: string, owner: string, recipeName: string, size: string | null) {
  const mine = await repo.getProfile(ctx.actor.subjectId);
  if (!mine.ok || !mine.value) return;
  const pst = toPublicId("pst", postId);
  await deferSocialPush(ctx, {
    kind: KITCHEN_EMAILS.COOKED_YOURS,
    to: owner,
    data: { actorName: mine.value.name, recipeName, size },
    path: `/p/${pst}`,
    keyParts: [pst],
  });
}

export async function handleCreatePost(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const dishId = typeof body.dishId === "string" ? parsePublicId("dsh", body.dishId) : null;
  if (!dishId) fields.add("dishId", "Must be one of your dishes' dsh_ id");
  const parsed = parsePostFields(fields, body, true);
  if (!fields.ok || !dishId || !parsed.audience) return validationError(ctx.requestId, fields.errors);
  const audience = parsed.audience;
  const me = ctx.actor.subjectId;

  return withKitchenRepo(ctx, async (repo) => {
    const [profile, found] = await ctx.timings.measure("db", () => Promise.all([repo.getProfile(me), repo.postSource(dishId, me)]));
    if (!profile.ok || !found.ok) return unavailable(ctx.requestId);
    if (!found.value) return notFound(ctx.requestId);
    if (audience !== "me" && !profile.value) {
      return forbidden(ctx.requestId, "Choose a handle and a name to share beyond Just me", KITCHEN_COMMUNITY_ERROR_REASONS.NO_PROFILE);
    }
    const source = found.value;
    if (!postable(source)) return conflict(ctx.requestId, "A canceled dish can't be shared", R.NOT_POSTABLE);
    if (source.livePostId) {
      return conflict(ctx.requestId, "This dish is already shared", R.ALREADY_POSTED, { postId: toPublicId("pst", source.livePostId) });
    }
    const stats = computeStats(source, showOf(parsed.show));
    const id = crypto.randomUUID();
    const cooked = cookedYours(ctx, source, id, audience, stats);
    const created = await ctx.timings.measure("db", () =>
      repo.createPost({
        id,
        authorId: me,
        dishId,
        recipeId: linkOf(source).recipe?.id ?? null,
        title: postTitle(source.name),
        caption: parsed.caption ?? null,
        audience,
        stats,
        now: ctx.now(),
        cookedYours: cooked?.write ?? null,
      }),
    );
    if (!created.ok) return unavailable(ctx.requestId);
    if (created.value.kind === "already_posted") return conflict(ctx.requestId, "This dish is already shared", R.ALREADY_POSTED);
    if (created.value.activity && cooked) await pushCookedYours(ctx, repo, id, cooked.write.userId, cooked.recipeName, cooked.size);
    const read = await ctx.timings.measure("db", () => repo.getOwnPost(id, me));
    if (!read.ok || !read.value) return unavailable(ctx.requestId);
    return postResponse(ctx, repo, read.value, 201);
  });
}

export async function handleUpdatePost(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const postId = postParam(params[0]);
  if (!postId) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const parsed = parsePostFields(fields, body, false);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  const me = ctx.actor.subjectId;

  return withKitchenRepo(ctx, async (repo) => {
    const own = await ctx.timings.measure("db", () => repo.getOwnPost(postId, me));
    if (!own.ok) return unavailable(ctx.requestId);
    if (!own.value || own.value.deletedAt) return notFound(ctx.requestId);
    const post = own.value;
    const audience = parsed.audience ?? post.audience;
    if (parsed.audience && parsed.audience !== "me") {
      const profile = await ctx.timings.measure("db", () => repo.getProfile(me));
      if (!profile.ok) return unavailable(ctx.requestId);
      if (!profile.value) return forbidden(ctx.requestId, "Choose a handle and a name to share beyond Just me", KITCHEN_COMMUNITY_ERROR_REASONS.NO_PROFILE);
    }
    // The dish again, when the stats or the audience change: stats are recomputed, cooked_yours may be due.
    let stats: KitchenPostStats | undefined;
    let cooked: ReturnType<typeof cookedYours> = null;
    if ((parsed.show || parsed.audience) && post.dishId) {
      const dishId = post.dishId;
      const found = await ctx.timings.measure("db", () => repo.postSource(dishId, me));
      if (!found.ok) return unavailable(ctx.requestId);
      if (found.value) {
        if (parsed.show) stats = computeStats(found.value, showOf(parsed.show, shownOf(post.stats)));
        cooked = cookedYours(ctx, found.value, postId, audience, stats ?? post.stats);
      }
    }
    const updated = await ctx.timings.measure("db", () =>
      repo.updatePost({
        id: postId,
        authorId: me,
        ...(parsed.caption !== undefined ? { caption: parsed.caption } : {}),
        ...(parsed.audience ? { audience: parsed.audience } : {}),
        ...(stats ? { stats } : {}),
        now: ctx.now(),
        cookedYours: cooked?.write ?? null,
      }),
    );
    if (!updated.ok) return unavailable(ctx.requestId);
    if (!updated.value.updated) return notFound(ctx.requestId);
    if (updated.value.activity && cooked) await pushCookedYours(ctx, repo, postId, cooked.write.userId, cooked.recipeName, cooked.size);
    const read = await ctx.timings.measure("db", () => repo.getOwnPost(postId, me));
    if (!read.ok || !read.value) return unavailable(ctx.requestId);
    return postResponse(ctx, repo, read.value);
  });
}

export async function handleDeletePost(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const postId = postParam(params[0]);
  if (!postId) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const now = ctx.now();
    const deleted = await ctx.timings.measure("db", () => repo.deletePost(postId, ctx.actor.subjectId, now));
    if (!deleted.ok) return unavailable(ctx.requestId);
    if (!deleted.value) return notFound(ctx.requestId);
    return successResponse<DeletePostResponse>({ deleted: true, restoreUntil: new Date(now.getTime() + POST_UNDO_MS).toISOString() }, ctx.requestId);
  });
}

export async function handleRestorePost(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const postId = postParam(params[0]);
  if (!postId) return notFound(ctx.requestId);
  const me = ctx.actor.subjectId;
  return withKitchenRepo(ctx, async (repo) => {
    const own = await ctx.timings.measure("db", () => repo.getOwnPost(postId, me));
    if (!own.ok) return unavailable(ctx.requestId);
    if (!own.value) return notFound(ctx.requestId);
    const restored = await ctx.timings.measure("db", () => repo.restorePost(postId, me, new Date(ctx.now().getTime() - POST_UNDO_MS)));
    if (!restored.ok) return unavailable(ctx.requestId);
    if (restored.value === "already_posted") return conflict(ctx.requestId, "This dish was shared again since", R.ALREADY_POSTED);
    if (restored.value === "not_restorable") return conflict(ctx.requestId, "This post can't be put back any more", R.NOT_RESTORABLE);
    const read = await ctx.timings.measure("db", () => repo.getOwnPost(postId, me));
    if (!read.ok || !read.value) return unavailable(ctx.requestId);
    return postResponse(ctx, repo, read.value);
  });
}

export async function handleGetPost(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const postId = postParam(params[0]);
  if (!postId) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getPost(postId, ctx.actor.subjectId));
    if (!found.ok) return unavailable(ctx.requestId);
    if (!found.value) return notFound(ctx.requestId);
    return postResponse(ctx, repo, found.value, 200, true);
  });
}

// ── Lists ──────────────────────────────────────────────────

/** Posts with their Yum names, as a list response's `posts`. Null when a read failed. */
async function listed(ctx: RequestContext, repo: KitchenRepository, records: readonly KitchenPostRecord[]) {
  const me = ctx.actor.subjectId;
  const names = await ctx.timings.measure("db", () => repo.yumNames(records.map((r) => r.id), me, YUM_NAMES_MAX));
  if (!names.ok) return null;
  return records.map((r) => toCommunityPost(r, me, names.value.get(r.id) ?? []));
}

const cursorOf = (c: KitchenPostCursor | null) => (c ? encodeCursor({ at: c.at, key: c.id }) : null);

/** How many candidates Discover reads at a time, and how many times at most. */
const DISCOVER_BATCH = 100;
const DISCOVER_ROUNDS = 5;

/**
 * Discover's page: candidates newest first, ranked by created_at plus the Yum
 * boost (`discoverBoostMs`, at most DISCOVER_BOOST_MAX_HOURS). A post not yet
 * read is older than the last read, so it ranks below last + the most boost:
 * reading stops once a page ranks above that.
 */
async function discoverPage(ctx: RequestContext, repo: KitchenRepository, cursor: { at: string; key: string } | undefined) {
  const me = ctx.actor.subjectId;
  const since = new Date(ctx.now().getTime() - DISCOVER_DAYS * DAY_MS);
  const after = cursor ? { score: new Date(cursor.at).getTime(), id: cursor.key } : null;
  const below = (s: { score: number; id: string }) => !after || s.score < after.score || (s.score === after.score && s.id < after.id);
  const pool: Array<{ record: KitchenPostRecord; score: number; id: string }> = [];
  // Nothing ranked below the cursor was made after it.
  let before: KitchenPostCursor | null = cursor ? { at: cursor.at, id: "~" } : null;
  let exhausted = false;
  let safeAbove = -Infinity;
  for (let round = 0; round < DISCOVER_ROUNDS; round += 1) {
    const batch = await ctx.timings.measure("db", () =>
      repo.discoverCandidates({ viewer: me, since, before, limit: DISCOVER_BATCH, hideAt: REPORTS_TO_HIDE }),
    );
    if (!batch.ok) return null;
    for (const record of batch.value) pool.push({ record, score: record.createdAt.getTime() + discoverBoostMs(record.yumCount), id: record.id });
    const last = batch.value[batch.value.length - 1];
    if (batch.value.length < DISCOVER_BATCH || !last) {
      exhausted = true;
      break;
    }
    safeAbove = last.createdAt.getTime() + DISCOVER_BOOST_MAX_HOURS * HOUR_MS;
    if (pool.filter((p) => p.score > safeAbove && below(p)).length > FEED_PAGE_SIZE) break;
    before = { at: last.createdAt.toISOString(), id: last.id };
  }
  // Read to the end, or as far as the ranking is sure of (everything, if even that is nothing).
  const sure = exhausted || !pool.some((p) => p.score > safeAbove && below(p));
  const ranked = pool
    .filter((p) => below(p) && (sure || p.score > safeAbove))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const page = ranked.slice(0, FEED_PAGE_SIZE);
  const last = page[page.length - 1];
  const more = ranked.length > FEED_PAGE_SIZE || (!exhausted && page.length > 0);
  return {
    records: page.map((p) => p.record),
    nextCursor: more && last ? encodeCursor({ at: new Date(last.score).toISOString(), key: last.id }) : null,
  };
}

export async function handleFeed(ctx: RequestContext, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawTab = url.searchParams.get("tab") ?? "following";
  if (!(FEED_TABS as readonly string[]).includes(rawTab)) return validationError(ctx.requestId, { tab: [`One of: ${FEED_TABS.join(", ")}`] });
  const tab = rawTab as FeedTab;
  const cursor = decodeCursor(url, isPostKey);
  if (cursor === null) return validationError(ctx.requestId, { cursor: ["Must be a nextCursor this route returned"] });
  return withKitchenRepo(ctx, async (repo) => {
    let records: KitchenPostRecord[];
    let nextCursor: string | null;
    if (tab === "following") {
      const page = await ctx.timings.measure("db", () =>
        repo.followingFeed(ctx.actor.subjectId, cursor ? { at: cursor.at, id: cursor.key } : null, FEED_PAGE_SIZE),
      );
      if (!page.ok) return unavailable(ctx.requestId);
      records = page.value.posts;
      nextCursor = cursorOf(page.value.nextCursor);
    } else {
      const page = await discoverPage(ctx, repo, cursor);
      if (!page) return unavailable(ctx.requestId);
      records = page.records;
      nextCursor = page.nextCursor;
    }
    const posts = await listed(ctx, repo, records);
    if (!posts) return unavailable(ctx.requestId);
    return successResponse<FeedResponse>({ tab, posts, nextCursor }, ctx.requestId, 200, nextCursor);
  });
}

export async function handleProfilePosts(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const cursor = decodeCursor(new URL(request.url), isPostKey);
  if (cursor === null) return validationError(ctx.requestId, { cursor: ["Must be a nextCursor this route returned"] });
  return withKitchenRepo(ctx, async (repo) => {
    const target = await visibleProfile(ctx, repo, params[0]);
    if (target instanceof Response) return target;
    const me = ctx.actor.subjectId;
    if (!canSeeProfile(me, target.profile, target.follow)) {
      return forbidden(ctx.requestId, "This profile is private: follow them to see it", KITCHEN_COMMUNITY_ERROR_REASONS.PRIVATE);
    }
    const page = await ctx.timings.measure("db", () =>
      repo.authorPosts(target.profile.userId, me, cursor ? { at: cursor.at, id: cursor.key } : null, FEED_PAGE_SIZE),
    );
    if (!page.ok) return unavailable(ctx.requestId);
    const posts = await listed(ctx, repo, page.value.posts);
    if (!posts) return unavailable(ctx.requestId);
    const nextCursor = cursorOf(page.value.nextCursor);
    return successResponse<ProfilePostsResponse>({ posts, nextCursor }, ctx.requestId, 200, nextCursor);
  });
}
