// Profiles and following (Cookpool, epic cookpool-community: CM-2, design §1).
//
// A person's public face — an @handle, a chosen name, a line about them,
// public or private — and the edges between people: follows (a private
// profile approves each one), blocks and mutes; people search, suggestions,
// and public recipes (a link recipe its owner lists).
//
// Names outside a person's groups come ONLY from their profile's `name`:
// nothing here ever carries an email or the identity display name. Only
// people with a profile appear outside their groups: without one, a person
// can read others' public profiles, but can't follow anyone (403 `forbidden`,
// `no_profile`) and can't be found.
//
// A block either way hides the two people from each other everywhere: their
// profile is the opaque 404, and they are left out of every list, search,
// suggestion and Explore's Public. The blocked person isn't told.
//
// Routes (kitchen-worker, behind api-edge's kitchen facade):
//   GET    /v1/kitchen/me/profile                     self → { profile | null }
//   PUT    /v1/kitchen/me/profile                     self: { handle, name, about?, privacy? } → 201 (made) | 200 { profile }
//          422 `handle_shape` / `handle_reserved`; 409 `handle_taken`;
//          409 `handle_too_soon` with `details.nextChangeAt`
//   GET    /v1/kitchen/handles/{handle}               signed in → { handle, available, reason? }
//   GET    /v1/kitchen/profiles/{handle}              signed in → PersonProfileResponse (404 across a block)
//   GET    /v1/kitchen/profiles/{handle}/recipes      canSee → { recipes, nextCursor } (403 `private` otherwise)
//   GET    /v1/kitchen/profiles/{handle}/followers    canSee → PeoplePage
//   GET    /v1/kitchen/profiles/{handle}/following    canSee → PeoplePage
//   POST   /v1/kitchen/me/follows/{handle}            with a profile → { state } (201 when new)
//   DELETE /v1/kitchen/me/follows/{handle}            → { state: "none" }
//   GET    /v1/kitchen/me/follow-requests?cursor=     → PeoplePage (newest first)
//   POST   /v1/kitchen/me/follow-requests/{usr}/accept   → { state: "accepted" }
//   POST   /v1/kitchen/me/follow-requests/{usr}/decline  → { state: "none" }
//   DELETE /v1/kitchen/me/followers/{usr}             → { removed }
//   POST   /v1/kitchen/me/blocks/{usr}                → { blocked: true } (201 when new)
//   DELETE /v1/kitchen/me/blocks/{usr}                → { blocked: false }
//   GET    /v1/kitchen/me/blocks                      → { blocks }
//   POST   /v1/kitchen/me/mutes/{usr}                 → { muted: true } (201 when new)
//   DELETE /v1/kitchen/me/mutes/{usr}                 → { muted: false }
//   GET    /v1/kitchen/people/search?q=               → { people } (≤ 20)
//   GET    /v1/kitchen/me/people/suggestions          → { fromGroups, fromRecipes, popular }
//   PATCH  /v1/kitchen/me/recipes/{rcp}               gains `listed` (see UpdateRecipeRequest)
//   GET    /v1/kitchen/recipes?source=public          Explore's Public (see EXPLORE_SOURCES)
//
// Limits: FOLLOWS_PER_DAY follows and BLOCKS_PER_DAY blocks a day are 429
// `rate_limited` (`follow_limit`, `block_limit`). Searches are capped by
// api-edge's per-person kitchen bucket, which is tighter than
// SEARCHES_PER_MINUTE.
//
// This module is re-exported from `kitchen.ts`, so `@saas/contracts/kitchen`
// carries it.

import type { RecipeSummary } from "./kitchen-recipes.js";

// ── Handles ─────────────────────────────────────────────────

/** 3–20 of a–z, 0–9, _ and . (and see `handleProblem` for the dots). */
export const HANDLE_RE = /^[a-z0-9_.]{3,20}$/;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/** Words nobody may take as a handle; any handle starting `cookpool` is reserved too. */
export const RESERVED_HANDLES = [
  "cookpool",
  "admin",
  "support",
  "help",
  "about",
  "settings",
  "me",
  "you",
  "explore",
  "search",
  "api",
  "www",
] as const;
export const RESERVED_HANDLE_PREFIX = "cookpool";

/** After its first change (which is free), a handle can change once in this many days. */
export const HANDLE_CHANGE_DAYS = 30;
export const HANDLE_CHANGE_MS = HANDLE_CHANGE_DAYS * 24 * 60 * 60 * 1000;

/** A handle as typed, as stored: trimmed, without a leading @, lowercase. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** What is wrong with a normalized handle: its shape, a reserved word, or nothing (null). */
export function handleProblem(handle: string): "handle_shape" | "handle_reserved" | null {
  // Reserved first: "me" is reserved, though too short to be a handle anyway.
  if ((RESERVED_HANDLES as readonly string[]).includes(handle) || handle.startsWith(RESERVED_HANDLE_PREFIX)) return "handle_reserved";
  if (!HANDLE_RE.test(handle) || handle.startsWith(".") || handle.endsWith(".") || handle.includes("..")) return "handle_shape";
  return null;
}

// ── Profiles ────────────────────────────────────────────────

export const PROFILE_PRIVACIES = ["public", "private"] as const;
export type ProfilePrivacy = (typeof PROFILE_PRIVACIES)[number];
export const DEFAULT_PROFILE_PRIVACY: ProfilePrivacy = "public";
export const PROFILE_NAME_MAX = 40;
export const PROFILE_ABOUT_MAX = 160;

/** A profile as anyone signed in reads it. */
export interface CommunityProfile {
  /** `usr_…` */
  userId: string;
  /** Lowercase, without the @. */
  handle: string;
  /** The name they chose: the only name shown outside their groups. */
  name: string;
  about: string | null;
  privacy: ProfilePrivacy;
}

/** Your own profile, with when the handle may next change. */
export interface MyProfile extends CommunityProfile {
  /** When the handle last changed; null until the first change, which is free (a typo fixed after HandleSetup). */
  handleChangedAt: string | null;
  /** When a different handle is next accepted; null when it already is. */
  nextHandleChangeAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /v1/kitchen/me/profile — null until the caller makes one (HandleSetup). */
export interface MyProfileResponse {
  profile: MyProfile | null;
}

/**
 * PUT /v1/kitchen/me/profile — make or edit yours. `handle` is normalized
 * (`normalizeHandle`); `about` null or left out clears it; `privacy` left out
 * keeps it (public for a new profile). Turning a private profile public
 * accepts every waiting request.
 */
export interface SaveMyProfileRequest {
  handle: string;
  name: string;
  about?: string | null;
  privacy?: ProfilePrivacy;
}

/** GET /v1/kitchen/handles/{handle}: the caller's own handle is available to them. */
export interface HandleAvailabilityResponse {
  /** As normalized. */
  handle: string;
  available: boolean;
  reason?: "handle_taken" | "handle_reserved" | "handle_shape";
}

/** The caller's follow of someone: none, asked (a private profile), or in. */
export const FOLLOW_STATES = ["none", "requested", "accepted"] as const;
export type FollowState = (typeof FOLLOW_STATES)[number];

export interface ProfileCounts {
  /** Their posts: 0 until posts arrive (CM-3). */
  posts: number;
  /** Their public recipes. */
  recipes: number;
  /** Accepted followers. */
  followers: number;
  /** Accepted follows. */
  following: number;
}

export interface ProfileRelationship {
  /** The caller's follow of them. */
  following: FollowState;
  /** They follow the caller (accepted). */
  followsYou: boolean;
  /** Always false: across a block the profile is the opaque 404. */
  blocked: false;
  /** The caller muted them. */
  muted: boolean;
  /** It is the caller's own profile. */
  isYou: boolean;
}

/** One person in a short list ("Followed by …"). */
export interface ProfileName {
  handle: string;
  name: string;
}

/** At most this many in `followedBy`. */
export const FOLLOWED_BY_MAX = 3;

/** GET /v1/kitchen/profiles/{handle}. */
export interface PersonProfileResponse {
  profile: CommunityProfile;
  counts: ProfileCounts;
  relationship: ProfileRelationship;
  /** Up to FOLLOWED_BY_MAX people the caller follows who follow them. */
  followedBy: ProfileName[];
  /**
   * May the caller see their recipes, posts and follower lists? Their own,
   * a public profile, or an accepted follower of a private one. False: the
   * lists are 403 `private`, and the page shows the lock.
   */
  canSee: boolean;
}

/** A person in a list, a search or a suggestion. */
export interface CommunityPerson extends CommunityProfile {
  /** The caller's follow of them. */
  following: FollowState;
}

/** A page of people: followers, following, requests. */
export interface PeoplePage {
  people: CommunityPerson[];
  /** Pass back as `?cursor=` for the next page; null on the last one. */
  nextCursor: string | null;
}

/** Each page of people, or of a profile's recipes, holds at most this many. */
export const COMMUNITY_PAGE_SIZE = 30;

export interface PeoplePageQuery {
  cursor?: string;
}

/**
 * GET /v1/kitchen/profiles/{handle}/recipes?cursor= — their public recipes
 * (listed link recipes), newest first. Each `ownerName` is their profile's
 * name, and a copy's `source.ownerName` its source owner's profile name (null
 * when they have none): never an identity name.
 */
export interface ProfileRecipesResponse {
  recipes: RecipeSummary[];
  nextCursor: string | null;
}

// ── Following ───────────────────────────────────────────────

/** POST /v1/kitchen/me/follows/{handle}: accepted at once for a public profile, requested for a private one. */
export interface FollowResponse {
  state: FollowState;
}

/** DELETE /v1/kitchen/me/followers/{usr}. */
export interface RemoveFollowerResponse {
  removed: boolean;
}

// ── Blocks and mutes ────────────────────────────────────────

export interface BlockResponse {
  blocked: boolean;
}

export interface MuteResponse {
  muted: boolean;
}

/** One person the caller blocked: their profile's handle and name when they have one, else null. */
export interface BlockedPerson {
  userId: string;
  handle: string | null;
  name: string | null;
  blockedAt: string;
}

/** GET /v1/kitchen/me/blocks — newest first, at most BLOCKS_LIST_MAX. */
export interface BlocksResponse {
  blocks: BlockedPerson[];
}
export const BLOCKS_LIST_MAX = 500;

// ── Finding people ──────────────────────────────────────────

/** At most this many search results. */
export const PEOPLE_SEARCH_MAX = 20;
/** The longest `q`. */
export const PEOPLE_SEARCH_Q_MAX = 40;

/**
 * GET /v1/kitchen/people/search?q= — public profiles whose handle starts
 * with `q` or whose name contains it, and any profile whose handle is exactly
 * `q` (a private one only that way); a leading @ matches handles only. Exact
 * handle first, then handle prefixes, then names; without the caller and
 * anyone with a block between them.
 */
export interface PeopleSearchResponse {
  people: CommunityPerson[];
}

/** A suggested person and why ("In Flat 4B", "You saved their Chicken curry", "12 new followers"). */
export interface SuggestedPerson extends CommunityPerson {
  why: string;
}

/** Each suggestion list holds at most this many. */
export const SUGGESTIONS_MAX = 10;
/** Popular counts new followers over this many days. */
export const POPULAR_DAYS = 14;

/**
 * GET /v1/kitchen/me/people/suggestions — people the caller doesn't follow
 * (or ask to) and has no block with: co-members with a profile; owners of
 * recipes they saved; public profiles with the most new followers.
 */
export interface PeopleSuggestionsResponse {
  fromGroups: SuggestedPerson[];
  fromRecipes: SuggestedPerson[];
  popular: SuggestedPerson[];
}

// ── Limits ──────────────────────────────────────────────────

export const FOLLOWS_PER_DAY = 200;
export const BLOCKS_PER_DAY = 50;
/** Enforced at api-edge by the kitchen family's per-person bucket (60 a minute), which is tighter. */
export const SEARCHES_PER_MINUTE = 100;

// ── Refusals ────────────────────────────────────────────────

/** `details.reason` of the community routes' refusals (the error codes are the pinned ones). */
export const KITCHEN_COMMUNITY_ERROR_REASONS = {
  /** 422 `validation_failed`: not 3–20 of a–z, 0–9, _ and ., or a leading, trailing or doubled dot. */
  HANDLE_SHAPE: "handle_shape",
  /** 422 `validation_failed`: a reserved word, or starting `cookpool`. */
  HANDLE_RESERVED: "handle_reserved",
  /** 409 `conflict`: someone else has it (case-insensitively). */
  HANDLE_TAKEN: "handle_taken",
  /** 409 `conflict`: the handle already changed less than 30 days ago (`details.nextChangeAt`); the first change is free. */
  HANDLE_TOO_SOON: "handle_too_soon",
  /** 403 `forbidden`: the caller has no profile yet — make one first (HandleSetup). */
  NO_PROFILE: "no_profile",
  /** 403 `forbidden`: a private profile the caller doesn't follow (`canSee` false). */
  PRIVATE: "private",
  /** 422 `validation_failed`: following, blocking or muting yourself. */
  SELF: "self",
  /** 429 `rate_limited`: FOLLOWS_PER_DAY follows in the last day. */
  FOLLOW_LIMIT: "follow_limit",
  /** 429 `rate_limited`: BLOCKS_PER_DAY blocks in the last day. */
  BLOCK_LIMIT: "block_limit",
} as const;
export type KitchenCommunityErrorReason = (typeof KITCHEN_COMMUNITY_ERROR_REASONS)[keyof typeof KITCHEN_COMMUNITY_ERROR_REASONS];
