/**
 * Profiles and following in the app (cookpool-community CM-5, design §4, the
 * canvas row "Community": `HandleSetup`, `PersonProfile`, `PeopleSearch`), as
 * data:
 *
 * - **Where things are**: the Community shell (`/community`), people search
 *   (`/community/search`), Activity (`/community/activity`), a profile
 *   (`/u/<handle>`, its list in `?list=`), a post (`/p/<id>`), HandleSetup
 *   (`/you/profile`) and blocked people (`/you/blocked`).
 * - **HandleSetup**: the handle's note as you type — its shape, reserved,
 *   taken, too soon (with the date), yours — and what Save sends.
 * - **A profile**: the follow button for a relationship, the lock, the
 *   counts, "Followed by …", the ⋯ menu's words.
 *
 * People search and the cache patches are `community-people.ts`. Pure and
 * dependency-free (contract types and helpers), so unit-testable.
 */

import {
  HANDLE_MAX,
  PROFILE_ABOUT_MAX,
  PROFILE_NAME_MAX,
  handleProblem,
  normalizeHandle,
  type FollowState,
  type HandleAvailabilityResponse,
  type MyProfile,
  type ProfileCounts,
  type ProfileName,
  type ProfilePrivacy,
  type ProfileRelationship,
  type SaveMyProfileRequest,
} from "@saas/contracts/kitchen";
import { nameInitials } from "./members";
import { firstNameOf } from "./recipes";
import { dayText } from "./when";

// ── Where things are ──────────────────────────────────────────────

export const COMMUNITY_HREF = "/community";
export const PEOPLE_SEARCH_HREF = "/community/search";
export const ACTIVITY_HREF = "/community/activity";
export const HANDLE_SETUP_HREF = "/you/profile";
export const BLOCKED_HREF = "/you/blocked";

/** A profile's lists: Cooks and Recipes are its tabs; Followers and Following open from its counts. */
export const PROFILE_LISTS = ["cooks", "recipes", "followers", "following"] as const;
export type ProfileListId = (typeof PROFILE_LISTS)[number];

/** The tab a profile opens on: Cooks, their posts (CM-6; Recipes until posts arrived). */
export const PROFILE_DEFAULT_LIST: ProfileListId = "cooks";

export function profileListFrom(param: string | null | undefined): ProfileListId {
  return (PROFILE_LISTS as readonly string[]).includes(param ?? "") ? (param as ProfileListId) : PROFILE_DEFAULT_LIST;
}

/** `/u/meeracooks`, `/u/meeracooks?list=followers`; the default list is the bare page. */
export function profileHref(handle: string, list: ProfileListId = PROFILE_DEFAULT_LIST): string {
  const base = `/u/${encodeURIComponent(handle)}`;
  return list === PROFILE_DEFAULT_LIST ? base : `${base}?list=${list}`;
}

/** The full address Share copies: `https://stage.cookpool.store/u/meeracooks`. */
export function profileUrl(origin: string, handle: string): string {
  return `${origin.replace(/\/+$/, "")}${profileHref(handle)}`;
}

/** A post's page. */
export function postHref(postId: string): string {
  return `/p/${encodeURIComponent(postId)}`;
}

/**
 * A handle as the address spells it (`/u/MeeraCooks`, `/u/%40meeracooks`),
 * normalized, or null when it can't be one: nothing is asked for it. A
 * reserved word is still asked (the server answers 404).
 */
export function parseHandleParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value: string;
  try {
    value = normalizeHandle(decodeURIComponent(raw));
  } catch {
    return null;
  }
  const problem = handleProblem(value);
  return problem === "handle_shape" ? null : value;
}

/** "@meeracooks". */
export function atHandle(handle: string): string {
  return `@${handle}`;
}

/** A face's letters from a profile's chosen name ("Kabir Shah" → "KS"); the handle's first letter when the name has none. */
export function profileInitials(profile: { name: string; handle: string }): string {
  return profile.name.trim() ? nameInitials(profile.name) : profile.handle.charAt(0).toUpperCase() || "?";
}

/** The name in a sentence: the first word of the chosen name, else the @handle. */
export function profileFirstName(profile: { name: string; handle: string }): string {
  return firstNameOf(profile.name) ?? atHandle(profile.handle);
}

// ── HandleSetup ───────────────────────────────────────────────────

/** How long the handle check waits after the last key before it asks. */
export const HANDLE_CHECK_MS = 350;

export const HANDLE_SETUP_TITLE = "Your public profile";
export const HANDLE_SETUP_SUB = "This is what people outside your groups see. Your email never shows.";
export const HANDLE_SHAPE_TEXT = "3–20 letters, numbers, _ or .";

/** Who can follow you: the two rows, as the canvas words them. */
export const PRIVACY_MODES: readonly { id: ProfilePrivacy; title: string; sub: string }[] = [
  { id: "public", title: "Anyone", sub: "They follow at once. Each post still picks its own audience." },
  { id: "private", title: "People I approve", sub: "Follows wait for you; only followers see your cooks and recipes." },
];

/** "You can change your handle again on 12 Dec". */
export function tooSoonText(nextChangeAt: string, now: Date): string {
  const day = dayText(nextChangeAt, now);
  return day ? `You can change your handle again on ${day}` : "You can change your handle once a month";
}

export interface HandleNote {
  text: string;
  /** ok: green; bad: red, Save waits; muted: grey (nothing typed, or still checking). */
  tone: "ok" | "bad" | "muted";
}

/**
 * The line under the handle as you type. In order: nothing typed; its shape;
 * reserved; your own handle; too soon to change it (with the date); still
 * checking; taken; free. Free reads "is yours" — the canvas's words — with
 * the monthly rule beside it.
 */
export function handleNote(input: {
  typed: string;
  /** Your profile's handle, when you have one. */
  current: string | null;
  /** When a different handle is next accepted (`MyProfile.nextHandleChangeAt`), null when now. */
  nextChangeAt: string | null;
  /** The server's answer for this handle (null: not asked yet, or still on its way). */
  availability: Pick<HandleAvailabilityResponse, "handle" | "available" | "reason"> | null;
  now: Date;
}): HandleNote {
  const handle = normalizeHandle(input.typed);
  if (!handle) return { text: HANDLE_SHAPE_TEXT, tone: "muted" };
  const problem = handleProblem(handle);
  if (problem === "handle_reserved") return { text: `${atHandle(handle)} is reserved`, tone: "bad" };
  if (problem === "handle_shape") return { text: HANDLE_SHAPE_TEXT, tone: "bad" };
  if (input.current && handle === input.current) return { text: `${atHandle(handle)} is yours`, tone: "ok" };
  if (input.current && input.nextChangeAt && Date.parse(input.nextChangeAt) > input.now.getTime()) {
    return { text: tooSoonText(input.nextChangeAt, input.now), tone: "bad" };
  }
  const a = input.availability;
  if (!a || a.handle !== handle) return { text: `Checking ${atHandle(handle)}…`, tone: "muted" };
  if (!a.available) {
    if (a.reason === "handle_reserved") return { text: `${atHandle(handle)} is reserved`, tone: "bad" };
    if (a.reason === "handle_shape") return { text: HANDLE_SHAPE_TEXT, tone: "bad" };
    return { text: `${atHandle(handle)} is taken`, tone: "bad" };
  }
  return { text: `${atHandle(handle)} is yours · you can change it once a month`, tone: "ok" };
}

/** Whether a typed handle should be asked about: a fair shape, not reserved, and not the one you have. */
export function shouldCheckHandle(typed: string, current: string | null): boolean {
  const handle = normalizeHandle(typed);
  return !!handle && handleProblem(handle) === null && handle !== current;
}

export interface ProfileDraft {
  name: string;
  handle: string;
  about: string;
  privacy: ProfilePrivacy;
}

/** The form as it opens: your profile, or for a first one your groups' name (yours to change) and nothing else. */
export function profileDraft(profile: MyProfile | null, groupName: string | null): ProfileDraft {
  if (profile) return { name: profile.name, handle: profile.handle, about: profile.about ?? "", privacy: profile.privacy };
  return { name: (groupName ?? "").trim().slice(0, PROFILE_NAME_MAX), handle: "", about: "", privacy: "public" };
}

/** What Save sends: the name and about trimmed (an empty about clears it), the handle as stored. */
export function saveProfileRequest(draft: ProfileDraft): SaveMyProfileRequest {
  const about = draft.about.trim();
  return { handle: normalizeHandle(draft.handle), name: draft.name.trim(), about: about ? about : null, privacy: draft.privacy };
}

/** The name's own problem, in words (null: fine). */
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return "Your name is needed";
  if (n.length > PROFILE_NAME_MAX) return `Up to ${PROFILE_NAME_MAX} characters`;
  return null;
}

/** Whether Save can go: a name, an about that fits, and a handle whose note isn't red or still checking. */
export function canSaveProfile(draft: ProfileDraft, note: HandleNote): boolean {
  if (nameProblem(draft.name) !== null) return false;
  if (draft.about.trim().length > PROFILE_ABOUT_MAX) return false;
  if (normalizeHandle(draft.handle).length > HANDLE_MAX) return false;
  return note.tone === "ok";
}

/** Whether the form differs from the saved profile (a first profile always does). */
export function draftChanged(draft: ProfileDraft, profile: MyProfile | null): boolean {
  if (!profile) return true;
  const sent = saveProfileRequest(draft);
  return sent.handle !== profile.handle || sent.name !== profile.name || (sent.about ?? null) !== (profile.about ?? null) || sent.privacy !== profile.privacy;
}

/**
 * A refused save, in words, by its `details.reason`: taken, reserved, shape,
 * too soon (with the date). Anything else is the server's own message.
 */
export function saveRefusalText(
  error: { reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined },
  handle: string,
  now: Date,
): string {
  const at = atHandle(normalizeHandle(handle));
  switch (error.reason) {
    case "handle_taken":
      return `${at} is taken`;
    case "handle_reserved":
      return `${at} is reserved`;
    case "handle_shape":
      return HANDLE_SHAPE_TEXT;
    case "handle_too_soon": {
      const next = error.details?.nextChangeAt;
      return typeof next === "string" ? tooSoonText(next, now) : "You can change your handle once a month";
    }
    default:
      return error.message;
  }
}

// ── A profile ─────────────────────────────────────────────────────

export type FollowButtonKind = "follow" | "ask" | "requested" | "following" | "edit";

export interface FollowButton {
  kind: FollowButtonKind;
  label: string;
  /** Green (Follow, Ask to follow); the rest are outlined. */
  primary: boolean;
}

/**
 * The profile's main button for your relationship: Edit profile on your own;
 * Following (outlined) once you follow; Requested while a private profile
 * hasn't answered; else Ask to follow (private) or Follow — "Follow back"
 * when they follow you.
 */
export function followButton(rel: Pick<ProfileRelationship, "following" | "followsYou" | "isYou">, privacy: ProfilePrivacy): FollowButton {
  if (rel.isYou) return { kind: "edit", label: "Edit profile", primary: false };
  if (rel.following === "accepted") return { kind: "following", label: "Following", primary: false };
  if (rel.following === "requested") return { kind: "requested", label: "Requested", primary: false };
  if (privacy === "private") return { kind: "ask", label: "Ask to follow", primary: true };
  return { kind: "follow", label: rel.followsYou ? "Follow back" : "Follow", primary: true };
}

/** What a tap on the button asks for: follow (accepted or requested, by their privacy), or none — unfollow or take the request back. */
export function followTarget(current: FollowState, privacy: ProfilePrivacy): FollowState {
  if (current !== "none") return "none";
  return privacy === "private" ? "requested" : "accepted";
}

/** The toast a follow change shows: "Following Kabir", "Asked to follow Kabir", "Unfollowed Kabir", "Request taken back". */
export function followToastTitle(from: FollowState, to: FollowState, first: string): string {
  if (to === "accepted") return `Following ${first}`;
  if (to === "requested") return `Asked to follow ${first}`;
  return from === "requested" ? "Request taken back" : `Unfollowed ${first}`;
}

/** The lock, when `canSee` is false. */
export function lockText(profile: { name: string; handle: string }): { title: string; sub: string } {
  const first = profileFirstName(profile);
  return {
    title: "This profile is private",
    sub: `Follow ${first} to see their cooks and recipes. ${first} approves each follower.`,
  };
}

/** A count as the profile shows it: 318, 1204, then 12.4k and 1.2m. */
export function countText(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 10_000) return String(v);
  if (v < 1_000_000) return `${(Math.floor(v / 100) / 10).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(Math.floor(v / 100_000) / 10).toFixed(1).replace(/\.0$/, "")}m`;
}

export interface CountCell {
  id: "posts" | "recipes" | "followers" | "following";
  label: string;
  value: string;
  /** Followers and Following open their list, when you may see it. */
  href: string | null;
}

/** Posts · Recipes · Followers · Following; the last two open their lists when `canSee`. */
export function profileCounts(handle: string, counts: ProfileCounts, canSee: boolean): CountCell[] {
  return [
    { id: "posts", label: "Posts", value: countText(counts.posts), href: null },
    { id: "recipes", label: "Recipes", value: countText(counts.recipes), href: null },
    { id: "followers", label: "Followers", value: countText(counts.followers), href: canSee ? profileHref(handle, "followers") : null },
    { id: "following", label: "Following", value: countText(counts.following), href: canSee ? profileHref(handle, "following") : null },
  ];
}

/** "Followed by Anu", "Followed by Anu and Dev", "Followed by Anu, Dev and Sam"; null for nobody. */
export function followedByText(people: readonly Pick<ProfileName, "name" | "handle">[]): string | null {
  const names = people.map((p) => profileFirstName(p));
  if (names.length === 0) return null;
  if (names.length === 1) return `Followed by ${names[0]}`;
  return `Followed by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The ⋯ menu's words. */
export function profileMenuText(profile: { name: string; handle: string }, muted: boolean): { mute: string; block: string; blockNote: string } {
  const first = profileFirstName(profile);
  return {
    mute: muted ? `Unmute ${first}'s posts` : `Mute ${first}'s posts`,
    block: `Block ${atHandle(profile.handle)}`,
    blockNote: `Blocking hides you from each other everywhere. ${first} isn't told.`,
  };
}

/** An empty Cooks tab. */
export const NO_COOKS_TEXT = "No cooks shared yet";
/** A profile with no public recipes. */
export const NO_PUBLIC_RECIPES_TEXT = "No public recipes yet";

// ── Community, the first time ─────────────────────────────────────

/** Where the browser remembers that HandleSetup was offered on Community (once: after that, a card links to it). */
export const SETUP_OFFERED_KEY = "cookpool.community.setupOffered";

/**
 * What Community shows above its feed: HandleSetup the first time it opens
 * without a profile; after that, without one, a card that links to it;
 * with one, nothing. Undefined while your profile is still being read.
 */
export function communityTop(profile: MyProfile | null | undefined, offeredBefore: boolean): "loading" | "setup" | "card" | "none" {
  if (profile === undefined) return "loading";
  if (profile) return "none";
  return offeredBefore ? "card" : "setup";
}
