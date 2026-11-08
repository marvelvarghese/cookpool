import {
  COMMUNITY_PAGE_SIZE,
  DEFAULT_PROFILE_PRIVACY,
  FOLLOWED_BY_MAX,
  HANDLE_CHANGE_MS,
  KITCHEN_COMMUNITY_ERROR_REASONS,
  PROFILE_ABOUT_MAX,
  PROFILE_NAME_MAX,
  PROFILE_PRIVACIES,
  handleProblem,
  normalizeHandle,
  type HandleAvailabilityResponse,
  type MyProfileResponse,
  type PeoplePage,
  type PersonProfileResponse,
  type ProfilePrivacy,
  type ProfileRecipesResponse,
} from "@saas/contracts/kitchen";
import type { KitchenPeoplePage, KitchenRepository } from "@saas/db/kitchen";
import {
  canSeeProfile,
  decodeCursor,
  encodeCursor,
  followStateOf,
  isRecipeKey,
  isSubjectKey,
  peopleCursor,
  peopleOf,
  profileNames,
  toCommunityProfile,
  toMyProfile,
  toPublicRecipeSummary,
  visibleProfile,
} from "../community.js";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { conflict, forbidden, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { Fields, oneOf, text } from "../validate.js";

// Profiles (CM-2, cookpool-community design §1):
//
//   GET  /v1/kitchen/me/profile                   self → { profile | null }
//   PUT  /v1/kitchen/me/profile                   self → 201 (made) | 200 { profile }
//   GET  /v1/kitchen/handles/{handle}             signed in → { handle, available, reason? }
//   GET  /v1/kitchen/profiles/{handle}            signed in → { profile, counts, relationship, followedBy, canSee }
//   GET  /v1/kitchen/profiles/{handle}/recipes    canSee → { recipes, nextCursor }
//   GET  /v1/kitchen/profiles/{handle}/followers  canSee → { people, nextCursor }
//   GET  /v1/kitchen/profiles/{handle}/following  canSee → { people, nextCursor }
//
// A profile is the caller's own, like their personal pantry: checked against
// their subject, never the policy engine. Someone else's profile across a
// block, a handle nobody has, and a malformed one are the opaque 404; a
// private profile the caller doesn't follow answers its lists 403 `private`.
// No read here touches identity: names are profiles' own.

const R = KITCHEN_COMMUNITY_ERROR_REASONS;

interface ParsedProfile {
  handle: string;
  name: string;
  about: string | null;
  privacy: ProfilePrivacy | null;
}

function parseProfile(body: Record<string, unknown>): { ok: true; value: ParsedProfile } | { ok: false; response: (requestId: string) => Response } {
  const fields = new Fields();
  const handle = typeof body.handle === "string" ? normalizeHandle(body.handle) : fields.add("handle", "Required: 3–20 of a–z, 0–9, _ and .");
  const name = text(fields, "name", body.name, PROFILE_NAME_MAX);
  const about = body.about === undefined || body.about === null || (typeof body.about === "string" && body.about.trim() === "")
    ? null
    : text(fields, "about", body.about, PROFILE_ABOUT_MAX);
  const privacy = body.privacy === undefined ? null : oneOf(fields, "privacy", body.privacy, PROFILE_PRIVACIES);
  if (!fields.ok || handle === undefined || name === undefined || about === undefined || privacy === undefined) {
    const errors = fields.errors;
    return { ok: false, response: (requestId) => validationError(requestId, errors) };
  }
  const problem = handleProblem(handle);
  if (problem) {
    const message = problem === "handle_reserved" ? "That handle is reserved" : "A handle is 3–20 of a–z, 0–9, _ and ., with no dot at either end or two in a row";
    return { ok: false, response: (requestId) => unprocessable(requestId, message, problem, { fields: { handle: [message] } }) };
  }
  return { ok: true, value: { handle, name, about, privacy } };
}

export async function handleGetMyProfile(ctx: RequestContext): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getProfile(ctx.actor.subjectId));
    if (!found.ok) return unavailable(ctx.requestId);
    return successResponse<MyProfileResponse>({ profile: found.value ? toMyProfile(found.value, ctx.now()) : null }, ctx.requestId);
  });
}

export async function handleSaveMyProfile(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseProfile(body);
  if (!parsed.ok) return parsed.response(ctx.requestId);
  const input = parsed.value;
  return withKitchenRepo(ctx, async (repo) => {
    const me = ctx.actor.subjectId;
    const now = ctx.now();
    let privacy = input.privacy;
    if (privacy === null) {
      // Left out: the profile keeps its own (public for a new one).
      const current = await ctx.timings.measure("db", () => repo.getProfile(me));
      if (!current.ok) return unavailable(ctx.requestId);
      privacy = current.value?.privacy ?? DEFAULT_PROFILE_PRIVACY;
    }
    const saved = await ctx.timings.measure("db", () =>
      repo.saveProfile({ userId: me, handle: input.handle, name: input.name, about: input.about, privacy, now, handleCooldownMs: HANDLE_CHANGE_MS }),
    );
    if (!saved.ok) {
      return saved.error.kind === "invalid" ? validationError(ctx.requestId, { body: ["A field is out of range"] }) : unavailable(ctx.requestId);
    }
    const result = saved.value;
    if (result.kind === "handle_taken") return conflict(ctx.requestId, "That handle is taken", R.HANDLE_TAKEN);
    if (result.kind === "handle_too_soon") {
      return conflict(ctx.requestId, "Your handle can change once every 30 days", R.HANDLE_TOO_SOON, {
        nextChangeAt: result.nextChangeAt.toISOString(),
      });
    }
    return successResponse<MyProfileResponse>({ profile: toMyProfile(result.profile, now) }, ctx.requestId, result.created ? 201 : 200);
  });
}

export async function handleHandleAvailable(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  let raw: string;
  try {
    raw = decodeURIComponent(params[0] ?? "");
  } catch {
    raw = "";
  }
  const handle = normalizeHandle(raw);
  const problem = handleProblem(handle);
  if (problem) return successResponse<HandleAvailabilityResponse>({ handle, available: false, reason: problem }, ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getProfileByHandle(handle));
    if (!found.ok) return unavailable(ctx.requestId);
    const taken = found.value !== null && found.value.userId !== ctx.actor.subjectId;
    return successResponse<HandleAvailabilityResponse>(
      taken ? { handle, available: false, reason: R.HANDLE_TAKEN } : { handle, available: true },
      ctx.requestId,
    );
  });
}

export async function handleGetProfile(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const target = await visibleProfile(ctx, repo, params[0]);
    if (target instanceof Response) return target;
    const { profile, follow } = target;
    const me = ctx.actor.subjectId;
    const isYou = profile.userId === me;
    const [counts, back, muted, followedBy] = await ctx.timings.measure("db", () =>
      Promise.all([
        repo.profileCounts(profile.userId),
        isYou ? Promise.resolve({ ok: true as const, value: null }) : repo.getFollow(profile.userId, me),
        isYou ? Promise.resolve({ ok: true as const, value: false }) : repo.isMuted(me, profile.userId),
        isYou ? Promise.resolve({ ok: true as const, value: [] }) : repo.followedBy(me, profile.userId, FOLLOWED_BY_MAX),
      ]),
    );
    if (!counts.ok || !back.ok || !muted.ok || !followedBy.ok) return unavailable(ctx.requestId);
    return successResponse<PersonProfileResponse>(
      {
        profile: toCommunityProfile(profile),
        // Posts arrive with CM-3 (kitchen_posts, migration 440): it counts them here.
        counts: { posts: 0, ...counts.value },
        relationship: {
          following: followStateOf(follow),
          followsYou: back.value?.state === "accepted",
          blocked: false,
          muted: muted.value,
          isYou,
        },
        followedBy: followedBy.value.map((p) => ({ handle: p.handle, name: p.name })),
        canSee: canSeeProfile(me, profile, follow),
      },
      ctx.requestId,
    );
  });
}

/** The profile a list route reads, when the caller may see its lists: the profile, or the Response (404, 403 `private`, 503). */
async function listable(ctx: RequestContext, repo: KitchenRepository, raw: string | undefined) {
  const target = await visibleProfile(ctx, repo, raw);
  if (target instanceof Response) return target;
  if (!canSeeProfile(ctx.actor.subjectId, target.profile, target.follow)) {
    return forbidden(ctx.requestId, "This profile is private: follow them to see it", R.PRIVATE);
  }
  return target.profile;
}

export async function handleProfileRecipes(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const cursor = decodeCursor(new URL(request.url), isRecipeKey);
  if (cursor === null) return validationError(ctx.requestId, { cursor: ["Must be a nextCursor this route returned"] });
  return withKitchenRepo(ctx, async (repo) => {
    const profile = await listable(ctx, repo, params[0]);
    if (profile instanceof Response) return profile;
    const me = ctx.actor.subjectId;
    const found = await ctx.timings.measure("db", () =>
      repo.listRecipes({
        viewer: me,
        listedBy: [profile.userId],
        q: null,
        kind: null,
        limit: COMMUNITY_PAGE_SIZE + 1,
        before: cursor ? { createdAt: cursor.at, id: cursor.key } : null,
      }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    const recipes = found.value.slice(0, COMMUNITY_PAGE_SIZE);
    const names = await profileNames(ctx, repo, recipes);
    if (!names) return unavailable(ctx.requestId);
    const last = recipes[recipes.length - 1];
    const nextCursor = found.value.length > COMMUNITY_PAGE_SIZE && last ? encodeCursor({ at: last.createdAt.toISOString(), key: last.id }) : null;
    return successResponse<ProfileRecipesResponse>(
      { recipes: recipes.map((r) => toPublicRecipeSummary(r, me, names)), nextCursor },
      ctx.requestId,
      200,
      nextCursor,
    );
  });
}

async function peoplePage(ctx: RequestContext, repo: KitchenRepository, page: KitchenPeoplePage): Promise<Response> {
  const people = await peopleOf(ctx, repo, page.people.map((p) => p.profile));
  if (!people) return unavailable(ctx.requestId);
  const nextCursor = page.nextCursor ? encodeCursor({ at: page.nextCursor.at, key: page.nextCursor.userId }) : null;
  return successResponse<PeoplePage>({ people, nextCursor }, ctx.requestId, 200, nextCursor);
}

function handleEdges(side: "followers" | "following") {
  return async (ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> => {
    const cursor = decodeCursor(new URL(request.url), isSubjectKey);
    if (cursor === null) return validationError(ctx.requestId, { cursor: ["Must be a nextCursor this route returned"] });
    return withKitchenRepo(ctx, async (repo) => {
      const profile = await listable(ctx, repo, params[0]);
      if (profile instanceof Response) return profile;
      const query = { viewer: ctx.actor.subjectId, cursor: peopleCursor(cursor), limit: COMMUNITY_PAGE_SIZE };
      const page = await ctx.timings.measure("db", () =>
        side === "followers" ? repo.listFollowers(profile.userId, query) : repo.listFollowing(profile.userId, query),
      );
      if (!page.ok) return unavailable(ctx.requestId);
      return peoplePage(ctx, repo, page.value);
    });
  };
}

export const handleProfileFollowers = handleEdges("followers");
export const handleProfileFollowing = handleEdges("following");

export { peoplePage };
