import {
  BLOCKS_LIST_MAX,
  BLOCKS_PER_DAY,
  COMMUNITY_PAGE_SIZE,
  FOLLOWS_PER_DAY,
  KITCHEN_COMMUNITY_ERROR_REASONS,
  type BlockResponse,
  type BlocksResponse,
  type FollowResponse,
  type MuteResponse,
  type RemoveFollowerResponse,
} from "@saas/contracts/kitchen";
import { decodeCursor, isSubjectKey, peopleCursor, subjectParam, visibleProfile } from "../community.js";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { errorResponse, forbidden, notFound, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { peoplePage } from "./community-profiles.js";

// Following, requests, blocks and mutes (CM-2, cookpool-community design §1):
//
//   POST   /v1/kitchen/me/follows/{handle}                 with a profile → { state } (201 when new)
//   DELETE /v1/kitchen/me/follows/{handle}                 → { state: "none" }
//   GET    /v1/kitchen/me/follow-requests?cursor=          → { people, nextCursor }
//   POST   /v1/kitchen/me/follow-requests/{usr}/accept     → { state: "accepted" }
//   POST   /v1/kitchen/me/follow-requests/{usr}/decline    → { state: "none" }
//   DELETE /v1/kitchen/me/followers/{usr}                  → { removed }
//   POST   /v1/kitchen/me/blocks/{usr}                     → { blocked: true } (201 when new)
//   DELETE /v1/kitchen/me/blocks/{usr}                     → { blocked: false }
//   GET    /v1/kitchen/me/blocks                           → { blocks }
//   POST   /v1/kitchen/me/mutes/{usr}                      → { muted: true } (201 when new)
//   DELETE /v1/kitchen/me/mutes/{usr}                      → { muted: false }
//
// Following needs a profile of your own (403 `no_profile`); following a
// public profile is accepted at once, a private one is requested. Across a
// block the person is the opaque 404. A repeat of a follow, block or mute
// answers 200 with what is there. Limits are counted in storage, in the
// write's own statement: FOLLOWS_PER_DAY and BLOCKS_PER_DAY in the last 24
// hours, 429 `rate_limited` past them.
//
// CM-3 writes the Activity rows (`followed`, `follow_request`,
// `follow_accepted`) in the same writes as these follows.

const R = KITCHEN_COMMUNITY_ERROR_REASONS;

function limited(ctx: RequestContext, message: string, reason: string, max: number): Response {
  const response = errorResponse("rate_limited", message, 429, ctx.requestId, { reason, max, retryAfterSeconds: 3600 });
  response.headers.set("retry-after", "3600");
  return response;
}

function self(ctx: RequestContext, what: string): Response {
  return unprocessable(ctx.requestId, `You can't ${what} yourself`, R.SELF);
}

export async function handleFollow(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const me = ctx.actor.subjectId;
    const mine = await ctx.timings.measure("db", () => repo.getProfile(me));
    if (!mine.ok) return unavailable(ctx.requestId);
    if (!mine.value) return forbidden(ctx.requestId, "Choose a handle and a name first", R.NO_PROFILE);
    const target = await visibleProfile(ctx, repo, params[0]);
    if (target instanceof Response) return target;
    const { profile } = target;
    if (profile.userId === me) return self(ctx, "follow");
    const followed = await ctx.timings.measure("db", () =>
      repo.follow({
        followerId: me,
        followeeId: profile.userId,
        state: profile.privacy === "public" ? "accepted" : "requested",
        now: ctx.now(),
        maxPerDay: FOLLOWS_PER_DAY,
      }),
    );
    if (!followed.ok) return unavailable(ctx.requestId);
    const result = followed.value;
    if (result.kind === "blocked") return notFound(ctx.requestId);
    if (result.kind === "limited") return limited(ctx, `You can follow ${FOLLOWS_PER_DAY} people a day`, R.FOLLOW_LIMIT, FOLLOWS_PER_DAY);
    return successResponse<FollowResponse>({ state: result.follow.state }, ctx.requestId, result.kind === "followed" ? 201 : 200);
  });
}

export async function handleUnfollow(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const target = await visibleProfile(ctx, repo, params[0]);
    if (target instanceof Response) return target;
    const removed = await ctx.timings.measure("db", () => repo.unfollow(ctx.actor.subjectId, target.profile.userId));
    if (!removed.ok) return unavailable(ctx.requestId);
    return successResponse<FollowResponse>({ state: "none" }, ctx.requestId);
  });
}

export async function handleFollowRequests(ctx: RequestContext, request: Request): Promise<Response> {
  const cursor = decodeCursor(new URL(request.url), isSubjectKey);
  if (cursor === null) return validationError(ctx.requestId, { cursor: ["Must be a nextCursor this route returned"] });
  return withKitchenRepo(ctx, async (repo) => {
    const page = await ctx.timings.measure("db", () =>
      repo.followRequests({ viewer: ctx.actor.subjectId, cursor: peopleCursor(cursor), limit: COMMUNITY_PAGE_SIZE }),
    );
    if (!page.ok) return unavailable(ctx.requestId);
    return peoplePage(ctx, repo, page.value);
  });
}

export async function handleAcceptFollow(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const follower = subjectParam(params[0]);
  if (!follower) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const accepted = await ctx.timings.measure("db", () => repo.acceptFollow(ctx.actor.subjectId, follower, ctx.now()));
    if (!accepted.ok) return unavailable(ctx.requestId);
    if (!accepted.value) return notFound(ctx.requestId);
    return successResponse<FollowResponse>({ state: "accepted" }, ctx.requestId);
  });
}

export async function handleDeclineFollow(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const follower = subjectParam(params[0]);
  if (!follower) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const declined = await ctx.timings.measure("db", () => repo.declineFollow(ctx.actor.subjectId, follower));
    if (!declined.ok) return unavailable(ctx.requestId);
    if (!declined.value) return notFound(ctx.requestId);
    return successResponse<FollowResponse>({ state: "none" }, ctx.requestId);
  });
}

export async function handleRemoveFollower(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const follower = subjectParam(params[0]);
  if (!follower) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const removed = await ctx.timings.measure("db", () => repo.removeFollower(ctx.actor.subjectId, follower));
    if (!removed.ok) return unavailable(ctx.requestId);
    return successResponse<RemoveFollowerResponse>({ removed: removed.value }, ctx.requestId);
  });
}

// ── Blocks and mutes ───────────────────────────────────────

export async function handleBlock(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const other = subjectParam(params[0]);
  if (!other) return notFound(ctx.requestId);
  if (other === ctx.actor.subjectId) return self(ctx, "block");
  return withKitchenRepo(ctx, async (repo) => {
    const blocked = await ctx.timings.measure("db", () =>
      repo.block({ blockerId: ctx.actor.subjectId, blockedId: other, now: ctx.now(), maxPerDay: BLOCKS_PER_DAY }),
    );
    if (!blocked.ok) return unavailable(ctx.requestId);
    if (blocked.value.kind === "limited") return limited(ctx, `You can block ${BLOCKS_PER_DAY} people a day`, R.BLOCK_LIMIT, BLOCKS_PER_DAY);
    return successResponse<BlockResponse>({ blocked: true }, ctx.requestId, blocked.value.kind === "blocked" ? 201 : 200);
  });
}

export async function handleUnblock(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const other = subjectParam(params[0]);
  if (!other) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const lifted = await ctx.timings.measure("db", () => repo.unblock(ctx.actor.subjectId, other));
    if (!lifted.ok) return unavailable(ctx.requestId);
    return successResponse<BlockResponse>({ blocked: false }, ctx.requestId);
  });
}

export async function handleListBlocks(ctx: RequestContext): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.listBlocks(ctx.actor.subjectId, BLOCKS_LIST_MAX));
    if (!found.ok) return unavailable(ctx.requestId);
    return successResponse<BlocksResponse>(
      {
        blocks: found.value.map((b) => ({
          userId: b.blockedId,
          handle: b.profile?.handle ?? null,
          name: b.profile?.name ?? null,
          blockedAt: b.createdAt.toISOString(),
        })),
      },
      ctx.requestId,
    );
  });
}

export async function handleMute(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const other = subjectParam(params[0]);
  if (!other) return notFound(ctx.requestId);
  if (other === ctx.actor.subjectId) return self(ctx, "mute");
  return withKitchenRepo(ctx, async (repo) => {
    const muted = await ctx.timings.measure("db", () => repo.mute(ctx.actor.subjectId, other, ctx.now()));
    if (!muted.ok) return unavailable(ctx.requestId);
    return successResponse<MuteResponse>({ muted: true }, ctx.requestId, muted.value ? 201 : 200);
  });
}

export async function handleUnmute(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const other = subjectParam(params[0]);
  if (!other) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const lifted = await ctx.timings.measure("db", () => repo.unmute(ctx.actor.subjectId, other));
    if (!lifted.ok) return unavailable(ctx.requestId);
    return successResponse<MuteResponse>({ muted: false }, ctx.requestId);
  });
}
