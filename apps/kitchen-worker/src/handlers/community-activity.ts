import {
  ACTIVITY_ACTORS_MAX,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_REQUESTS_MAX,
  type ActivityActor,
  type ActivityItem,
  type ActivityResponse,
  type MarkActivityReadResponse,
  type UnreadActivityResponse,
} from "@saas/contracts/kitchen";
import { uuidToHex } from "@saas/db/ids";
import type { KitchenProfileRecord } from "@saas/db/kitchen";
import { decodeCursor, encodeCursor, peopleOf } from "../community.js";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { toPublicId } from "../ids.js";
import { isActivityKey } from "../posts.js";
import { Fields, instant } from "../validate.js";

// Activity (CM-3, cookpool-community design §2):
//
//   GET  /v1/kitchen/me/activity?cursor=   → { requests, items, nextCursor }
//   POST /v1/kitchen/me/activity/read      { before } → { marked }
//   GET  /v1/kitchen/me/activity/unread    → { count }
//
// What happened to the caller, newest first: follows, accepted requests,
// Yums (one item per post, its latest few people named), comments, cooks of
// their recipes and copies of their public ones. Follow requests are not
// items but `requests`: how many wait, and the newest few. Rows from anyone
// with a block either way, and about a post that was deleted, are left out
// in storage. Names are profiles' own; an actor with no profile is left out.

const actorOf = (p: KitchenProfileRecord): ActivityActor => ({ userId: p.userId, handle: p.handle, name: p.name });

export async function handleActivityFeed(ctx: RequestContext, request: Request): Promise<Response> {
  const cursor = decodeCursor(new URL(request.url), isActivityKey);
  if (cursor === null) return validationError(ctx.requestId, { cursor: ["Must be a nextCursor this route returned"] });
  return withKitchenRepo(ctx, async (repo) => {
    const me = ctx.actor.subjectId;
    const [page, requestCount, requests] = await ctx.timings.measure("db", () =>
      Promise.all([
        repo.activityPage(me, cursor ? { at: cursor.at, key: cursor.key } : null, ACTIVITY_PAGE_SIZE, ACTIVITY_ACTORS_MAX),
        repo.followRequestCount(me),
        repo.followRequests({ viewer: me, cursor: null, limit: ACTIVITY_REQUESTS_MAX }),
      ]),
    );
    if (!page.ok || !requestCount.ok || !requests.ok) return unavailable(ctx.requestId);
    const items = page.value.items;
    const actorIds = [...new Set(items.flatMap((i) => i.actorIds))];
    const [profiles, titles, bodies, recipes] = await ctx.timings.measure("db", () =>
      Promise.all([
        repo.profilesFor({ userIds: actorIds, viewer: me, unfollowedOnly: false, limit: Math.max(1, actorIds.length) }),
        repo.postTitles(items.flatMap((i) => (i.postId ? [i.postId] : [])), me),
        repo.commentBodies(items.flatMap((i) => (i.commentId ? [i.commentId] : []))),
        repo.recipeNames(items.flatMap((i) => (i.recipeId ? [i.recipeId] : []))),
      ]),
    );
    if (!profiles.ok || !titles.ok || !bodies.ok || !recipes.ok) return unavailable(ctx.requestId);
    const people = await peopleOf(ctx, repo, requests.value.people.map((p) => p.profile));
    if (!people) return unavailable(ctx.requestId);

    const byId = new Map(profiles.value.map((p) => [p.userId, p] as const));
    const out: ActivityItem[] = [];
    for (const item of items) {
      const actors = item.actorIds.flatMap((id) => {
        const p = byId.get(id);
        return p ? [actorOf(p)] : [];
      });
      const actor = actors[0];
      if (!actor) continue;
      const title = item.postId ? titles.value.get(item.postId) : undefined;
      const body = item.commentId ? bodies.value.get(item.commentId) : undefined;
      const recipeName = item.recipeId ? recipes.value.get(item.recipeId) : undefined;
      out.push({
        id: item.kind === "yum" && item.postId ? `yum_${uuidToHex(item.postId)}` : toPublicId("act", item.key),
        kind: item.kind,
        at: item.at.toISOString(),
        unread: item.unread,
        actor,
        actors,
        others: Math.max(0, item.count - actors.length),
        post: item.postId && title !== undefined ? { id: toPublicId("pst", item.postId), title } : null,
        comment: item.commentId && body !== undefined ? { id: toPublicId("cmt", item.commentId), body } : null,
        recipe: item.recipeId && recipeName !== undefined ? { id: toPublicId("rcp", item.recipeId), name: recipeName } : null,
      });
    }
    const next = page.value.nextCursor;
    const nextCursor = next ? encodeCursor({ at: next.at, key: next.key }) : null;
    return successResponse<ActivityResponse>(
      { requests: { count: requestCount.value, people }, items: out, nextCursor },
      ctx.requestId,
      200,
      nextCursor,
    );
  });
}

export async function handleMarkActivityRead(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const before = instant(fields, "before", body.before);
  if (!fields.ok || !before) return validationError(ctx.requestId, fields.errors);
  return withKitchenRepo(ctx, async (repo) => {
    const marked = await ctx.timings.measure("db", () => repo.markActivityRead(ctx.actor.subjectId, before, ctx.now()));
    if (!marked.ok) return unavailable(ctx.requestId);
    return successResponse<MarkActivityReadResponse>({ marked: marked.value }, ctx.requestId);
  });
}

export async function handleUnreadActivity(ctx: RequestContext): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const unread = await ctx.timings.measure("db", () => repo.unreadActivity(ctx.actor.subjectId));
    if (!unread.ok) return unavailable(ctx.requestId);
    return successResponse<UnreadActivityResponse>({ count: unread.value }, ctx.requestId);
  });
}
