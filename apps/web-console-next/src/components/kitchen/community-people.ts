/**
 * People in Community (cookpool-community CM-5, the canvas's `PeopleSearch`),
 * as data: the search field's read, the suggestion groups with their `why`, a
 * person's row and its button, and the cache patches a follow, a block or an
 * answered request make at once (SM-5's instant writes).
 *
 * Pure and dependency-free (contract types and helpers), so unit-testable.
 */

import {
  PEOPLE_SEARCH_Q_MAX,
  type BlocksResponse,
  type CommunityPerson,
  type FollowState,
  type PeoplePage,
  type PeopleSearchResponse,
  type PeopleSuggestionsResponse,
  type PersonProfileResponse,
  type SuggestedPerson,
} from "@saas/contracts/kitchen";
import type { CachePatch } from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";
import { atHandle, profileHref, profileInitials } from "./community";

// ── Search ────────────────────────────────────────────────────────

/** How long the search waits after the last key before it asks. */
export const PEOPLE_SEARCH_MS = 250;

export const PEOPLE_SEARCH_PLACEHOLDER = "Name or @handle";
export const NOBODY_TEXT = "Nobody by that name. Private profiles show by @handle only.";

/** What is asked for the typed text: trimmed and capped; "" (just "@" too) asks nothing and shows the suggestions. */
export function peopleSearchQuery(typed: string): string {
  const q = typed.trim().slice(0, PEOPLE_SEARCH_Q_MAX);
  return q.replace(/^@+/, "") ? q : "";
}

export type SuggestionGroupId = "fromGroups" | "fromRecipes" | "popular";

/** The suggestion groups' titles, in order. */
export const SUGGESTION_TITLES: Readonly<Record<SuggestionGroupId, string>> = {
  fromGroups: "From your groups",
  fromRecipes: "From recipes",
  popular: "Popular",
};

export interface PersonRow {
  userId: string;
  handle: string;
  name: string;
  initials: string;
  href: string;
  /** "@kabirbakes · You saved their Besan ladoo", or just the handle. */
  sub: string;
  following: FollowState;
  private: boolean;
}

/** One person in a list: their face, name, "@handle · why", and their follow state. */
export function personRow(p: CommunityPerson & { why?: string | undefined }): PersonRow {
  const why = p.why?.trim();
  return {
    userId: p.userId,
    handle: p.handle,
    name: p.name,
    initials: profileInitials(p),
    href: profileHref(p.handle),
    sub: why ? `${atHandle(p.handle)} · ${why}` : atHandle(p.handle),
    following: p.following,
    private: p.privacy === "private",
  };
}

/** The suggestion groups that have anyone, in order, each person once (the server says nobody twice; this keeps it so). */
export function suggestionGroups(s: PeopleSuggestionsResponse): { id: SuggestionGroupId; title: string; rows: PersonRow[] }[] {
  const seen = new Set<string>();
  const out: { id: SuggestionGroupId; title: string; rows: PersonRow[] }[] = [];
  for (const id of ["fromGroups", "fromRecipes", "popular"] as const) {
    const rows = (s[id] ?? []).filter((p: SuggestedPerson) => !seen.has(p.userId) && (seen.add(p.userId), true)).map(personRow);
    if (rows.length > 0) out.push({ id, title: SUGGESTION_TITLES[id], rows });
  }
  return out;
}

/**
 * What the search page shows: the suggestions (nothing typed), the results,
 * or the empty line — "loading" only before the first answer for a query.
 */
export type PeopleSearchView =
  | { kind: "suggestions" }
  | { kind: "loading" }
  | { kind: "results"; rows: PersonRow[] }
  | { kind: "empty"; text: string };

export function peopleSearchView(q: string, results: PeopleSearchResponse | null): PeopleSearchView {
  if (!q) return { kind: "suggestions" };
  if (!results) return { kind: "loading" };
  if (results.people.length === 0) return { kind: "empty", text: NOBODY_TEXT };
  return { kind: "results", rows: results.people.map(personRow) };
}

/**
 * A row's button: Follow (green; a private profile becomes Requested), then
 * Requested or Following (outlined). The row is narrow, so a private profile
 * says Follow too: the state after the tap says what happened.
 */
export function rowFollowLabel(state: FollowState): { label: string; primary: boolean } {
  if (state === "accepted") return { label: "Following", primary: false };
  if (state === "requested") return { label: "Requested", primary: false };
  return { label: "Follow", primary: true };
}

// ── The cache, at once ────────────────────────────────────────────

type Lists = { people?: CommunityPerson[] } & Partial<Record<SuggestionGroupId, SuggestedPerson[]>>;

/** Map every person list a read holds (`people`, and the three suggestion groups); the same value when nothing changed. */
function mapLists(d: unknown, fn: (list: CommunityPerson[]) => CommunityPerson[]): unknown {
  if (!d || typeof d !== "object") return d;
  const src = d as Lists;
  let changed = false;
  const next: Record<string, unknown> = { ...src };
  for (const key of ["people", "fromGroups", "fromRecipes", "popular"] as const) {
    const list = src[key];
    if (!Array.isArray(list)) continue;
    const out = fn(list);
    if (out !== list) {
      next[key] = out;
      changed = true;
    }
  }
  return changed ? next : d;
}

function setFollowing(list: CommunityPerson[], userId: string, state: FollowState): CommunityPerson[] {
  let changed = false;
  const out = list.map((p) => {
    if (p.userId !== userId || p.following === state) return p;
    changed = true;
    return { ...p, following: state };
  });
  return changed ? out : list;
}

function without(list: CommunityPerson[], userId: string): CommunityPerson[] {
  const out = list.filter((p) => p.userId !== userId);
  return out.length === list.length ? list : out;
}

// Every read that lists people: search (every query), suggestions, and every profile's followers and following.
const PEOPLE_READS = [["kitchenCommunity", "search"], qk.kitchenPeopleSuggestions(), ["kitchenCommunity", "people"]] as const;

/**
 * A follow changed (to `state`): their profile's button and follower count
 * (an accepted follow counts; a request doesn't), and their row in every list,
 * search and suggestion.
 */
export function followPatches(handle: string, userId: string, state: FollowState): CachePatch[] {
  return [
    {
      prefix: qk.kitchenPersonProfile(handle),
      update: (d) => {
        const r = d as PersonProfileResponse | undefined;
        if (!r || !r.relationship || r.relationship.following === state) return d;
        const was = r.relationship.following === "accepted" ? 1 : 0;
        const now = state === "accepted" ? 1 : 0;
        return {
          ...r,
          relationship: { ...r.relationship, following: state },
          counts: { ...r.counts, followers: Math.max(0, r.counts.followers + now - was) },
          // A private profile opens once you are in; it closes when you leave.
          canSee: r.profile.privacy === "public" || r.relationship.isYou || state === "accepted",
        };
      },
    },
    ...PEOPLE_READS.map((prefix) => ({ prefix, update: (d: unknown) => mapLists(d, (l) => setFollowing(l, userId, state)) })),
  ];
}

/** Muted or not, on their profile. */
export function mutePatches(handle: string, muted: boolean): CachePatch[] {
  return [
    {
      prefix: qk.kitchenPersonProfile(handle),
      update: (d) => {
        const r = d as PersonProfileResponse | undefined;
        if (!r || !r.relationship || r.relationship.muted === muted) return d;
        return { ...r, relationship: { ...r.relationship, muted } };
      },
    },
  ];
}

/** A request answered (accepted or declined): off your requests. */
export function requestAnsweredPatches(userId: string): CachePatch[] {
  return [{ prefix: qk.kitchenFollowRequests(), update: (d) => mapLists(d, (l) => without(l, userId)) }];
}

/** A follower removed: off every followers list. */
export function followerRemovedPatches(userId: string): CachePatch[] {
  return [{ prefix: ["kitchenCommunity", "people"], update: (d) => mapLists(d, (l) => without(l, userId)) }];
}

/** Someone blocked: out of every list, search and suggestion at once (the server hides them both ways). */
export function blockPatches(userId: string): CachePatch[] {
  return PEOPLE_READS.map((prefix) => ({ prefix, update: (d: unknown) => mapLists(d, (l) => without(l, userId)) }));
}

/** Someone unblocked: off your blocked list. */
export function unblockPatches(userId: string): CachePatch[] {
  return [
    {
      prefix: qk.kitchenBlocks(),
      update: (d) => {
        const r = d as BlocksResponse | undefined;
        if (!r || !Array.isArray(r.blocks)) return d;
        const blocks = r.blocks.filter((b) => b.userId !== userId);
        return blocks.length === r.blocks.length ? d : { ...r, blocks };
      },
    },
  ];
}

/** A blocked person's row: their profile's name and handle, else "Someone" (they have no profile). */
export function blockedRow(b: BlocksResponse["blocks"][number]): { userId: string; name: string; sub: string | null; initials: string } {
  const name = b.name?.trim() || (b.handle ? atHandle(b.handle) : "Someone");
  return {
    userId: b.userId,
    name,
    sub: b.handle && b.name ? atHandle(b.handle) : null,
    initials: b.name || b.handle ? profileInitials({ name: b.name ?? "", handle: b.handle ?? "" }) : "?",
  };
}

/** A page of people's rows. */
export function peopleRows(page: PeoplePage | null): PersonRow[] {
  return (page?.people ?? []).map(personRow);
}
