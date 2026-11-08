// Profiles and following (Cookpool CM-2, cookpool-community design §1): what
// the community handlers share — the public shapes, who may see a profile,
// the target of a route by @handle or usr_ id, cursors, and names.
//
// Names outside a person's groups come ONLY from kitchen_profiles.name. No
// read here asks identity for anything: no email and no identity display
// name can reach these responses, whatever identity would answer.
//
// A block either way makes a profile the opaque 404, and the storage reads
// leave blocked people out of every list (notBlockedSql), so the handlers
// never filter by hand.

import {
  FOLLOWED_BY_MAX,
  HANDLE_CHANGE_MS,
  SYSTEM_RECIPE_OWNER,
  SYSTEM_RECIPE_OWNER_NAME,
  handleProblem,
  normalizeHandle,
  type CommunityPerson,
  type CommunityProfile,
  type FollowState,
  type MyProfile,
  type RecipeSummary,
} from "@saas/contracts/kitchen";
import { isUuid } from "@saas/db/ids";
import type { KitchenFollowRecord, KitchenPeopleCursor, KitchenProfileRecord, KitchenRecipeTemplateRecord, KitchenRepository } from "@saas/db/kitchen";
import type { RequestContext } from "./context.js";
import { notFound, unavailable } from "./http.js";
import type { DisplayName } from "./identity-client.js";
import { toRecipeSummary } from "./recipes.js";

export { FOLLOWED_BY_MAX };

/** A public subject id as the edge forwards it (`usr_…`). */
const SUBJECT_ID_RE = /^[A-Za-z0-9][\w-]{0,127}$/;

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ── Shapes ─────────────────────────────────────────────────

export function toCommunityProfile(p: KitchenProfileRecord): CommunityProfile {
  return { userId: p.userId, handle: p.handle, name: p.name, about: p.about, privacy: p.privacy };
}

export function toMyProfile(p: KitchenProfileRecord, now: Date): MyProfile {
  // The first change is free: until it happens there is no wait.
  const next = p.handleChangedAt ? p.handleChangedAt.getTime() + HANDLE_CHANGE_MS : 0;
  return {
    ...toCommunityProfile(p),
    handleChangedAt: p.handleChangedAt?.toISOString() ?? null,
    nextHandleChangeAt: next > now.getTime() ? new Date(next).toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function followStateOf(follow: KitchenFollowRecord | null | undefined): FollowState {
  return follow ? follow.state : "none";
}

/** These profiles with the caller's follow of each: one read, however many. Null when it failed. */
export async function peopleOf(
  ctx: RequestContext,
  repo: KitchenRepository,
  profiles: readonly KitchenProfileRecord[],
): Promise<CommunityPerson[] | null> {
  const ids = profiles.map((p) => p.userId).filter((id) => id !== ctx.actor.subjectId);
  const follows = await ctx.timings.measure("db", () => repo.followsFrom(ctx.actor.subjectId, ids));
  if (!follows.ok) return null;
  const byId = new Map(follows.value.map((f) => [f.followeeId, f.state] as const));
  return profiles.map((p) => ({ ...toCommunityProfile(p), following: byId.get(p.userId) ?? "none" }));
}

/** May the viewer see a profile's recipes, posts and lists: theirs, a public one, or an accepted follower of a private one. */
export function canSeeProfile(viewer: string, profile: KitchenProfileRecord, follow: KitchenFollowRecord | null): boolean {
  return profile.userId === viewer || profile.privacy === "public" || follow?.state === "accepted";
}

// ── Targets ────────────────────────────────────────────────

/** A path's `{usr}`: decoded and well formed, or null. */
export function subjectParam(raw: string | undefined): string | null {
  let id: string;
  try {
    id = decodeURIComponent(raw ?? "");
  } catch {
    return null;
  }
  return SUBJECT_ID_RE.test(id) ? id : null;
}

/** A path's `{handle}`, normalized; null when it can't be one (any handle with a problem but a reserved word). */
export function handleParam(raw: string | undefined): string | null {
  let text: string;
  try {
    text = decodeURIComponent(raw ?? "");
  } catch {
    return null;
  }
  const handle = normalizeHandle(text);
  return handleProblem(handle) === "handle_shape" ? null : handle;
}

/** The profile a `{handle}` names and the caller's follow of it — or the opaque 404 (none, malformed, a block either way), or a 503. */
export async function visibleProfile(
  ctx: RequestContext,
  repo: KitchenRepository,
  raw: string | undefined,
): Promise<{ profile: KitchenProfileRecord; follow: KitchenFollowRecord | null } | Response> {
  const handle = handleParam(raw);
  if (!handle) return notFound(ctx.requestId);
  const found = await ctx.timings.measure("db", () => repo.getProfileByHandle(handle));
  if (!found.ok) return unavailable(ctx.requestId);
  if (!found.value) return notFound(ctx.requestId);
  const profile = found.value;
  const me = ctx.actor.subjectId;
  if (profile.userId === me) return { profile, follow: null };
  const [blocked, follow] = await ctx.timings.measure("db", () =>
    Promise.all([repo.isBlockedEither(me, profile.userId), repo.getFollow(me, profile.userId)]),
  );
  if (!blocked.ok || !follow.ok) return unavailable(ctx.requestId);
  if (blocked.value) return notFound(ctx.requestId);
  return { profile, follow: follow.value };
}

// ── Cursors ────────────────────────────────────────────────

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

/** `?cursor=` of a page of people or recipes: `{ at, key }`, opaque to the client. */
export function encodeCursor(cursor: { at: string; key: string }): string {
  return toBase64Url(`${cursor.at}|${cursor.key}`);
}

/** Undefined when there is no `?cursor=`; null when it isn't one this route returned. */
export function decodeCursor(url: URL, isKey: (key: string) => boolean): { at: string; key: string } | null | undefined {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw === "") return undefined;
  if (raw.length > 300) return null;
  const decoded = fromBase64Url(raw);
  if (!decoded) return null;
  const [at, key, extra] = decoded.split("|");
  if (extra !== undefined || !at || !key || !ISO_INSTANT_RE.test(at) || !isKey(key)) return null;
  return { at, key };
}

export const isSubjectKey = (key: string): boolean => SUBJECT_ID_RE.test(key);
export const isRecipeKey = (key: string): boolean => isUuid(key);

export function peopleCursor(cursor: { at: string; key: string } | undefined): KitchenPeopleCursor | null {
  return cursor ? { at: cursor.at, userId: cursor.key } : null;
}

// ── Public recipes' names ──────────────────────────────────

/**
 * The profile names of these recipes' owners and their copies' source
 * owners — the names a public read shows. Someone without a profile has no
 * entry (null in the summary). Null when the read failed.
 */
export async function profileNames(
  ctx: RequestContext,
  repo: KitchenRepository,
  records: readonly Pick<KitchenRecipeTemplateRecord, "ownerId" | "sourceOwnerId" | "isSystem">[],
): Promise<Map<string, DisplayName> | null> {
  const ids = new Set<string>();
  for (const r of records) {
    if (!r.isSystem) ids.add(r.ownerId);
    if (r.sourceOwnerId && r.sourceOwnerId !== SYSTEM_RECIPE_OWNER) ids.add(r.sourceOwnerId);
  }
  if (ids.size === 0) return new Map();
  const found = await ctx.timings.measure("db", () =>
    repo.profilesFor({ userIds: [...ids], viewer: ctx.actor.subjectId, unfollowedOnly: false, limit: ids.size }),
  );
  if (!found.ok) return null;
  return new Map(found.value.map((p) => [p.userId, p.name]));
}

/** A copy's source as a public read names it: its owner's profile name, "Cookpool" for Cookpool's, else null — never the name saved from identity. */
export function publicSource<T extends Pick<RecipeSummary, "source">>(
  summary: T,
  record: Pick<KitchenRecipeTemplateRecord, "sourceOwnerId">,
  names: ReadonlyMap<string, DisplayName>,
): T {
  if (!summary.source) return summary;
  const ownerName = record.sourceOwnerId === SYSTEM_RECIPE_OWNER ? SYSTEM_RECIPE_OWNER_NAME : (names.get(record.sourceOwnerId ?? "") ?? null);
  return { ...summary, source: { ...summary.source, ownerName } };
}

/** A recipe summary for a public read: owner and source named by their profiles. */
export function toPublicRecipeSummary(record: KitchenRecipeTemplateRecord, viewer: string, names: ReadonlyMap<string, DisplayName>): RecipeSummary {
  return publicSource(toRecipeSummary(record, viewer, names), record, names);
}
