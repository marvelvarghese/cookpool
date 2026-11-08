import {
  PEOPLE_SEARCH_MAX,
  PEOPLE_SEARCH_Q_MAX,
  POPULAR_DAYS,
  SUGGESTIONS_MAX,
  normalizeHandle,
  type PeopleSearchResponse,
  type PeopleSuggestionsResponse,
  type SuggestedPerson,
} from "@saas/contracts/kitchen";
import type { KitchenProfileRecord } from "@saas/db/kitchen";
import { peopleOf, toCommunityProfile } from "../community.js";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { successResponse, unavailable, validationError } from "../http.js";
import { callerGroups } from "../recipes.js";

// Finding people (CM-2, cookpool-community design §1):
//
//   GET /v1/kitchen/people/search?q=           → { people } (≤ 20)
//   GET /v1/kitchen/me/people/suggestions      → { fromGroups, fromRecipes, popular }
//
// Search: public profiles by handle prefix or a name containing `q`; any
// profile by its exact handle (the only way a private one is found); a
// leading @ matches handles only. Never the caller, never anyone with a
// block between them (storage leaves them out). Anyone signed in may search,
// with or without a profile of their own; without one, nobody finds them.
// The 100-a-minute cap is api-edge's: its kitchen bucket allows 60 a minute
// per person, which is tighter.
//
// Suggestions: people the caller neither follows nor asked to, and has no
// block with, each list at most SUGGESTIONS_MAX with a `why`, nobody twice
// (groups first, then recipes, then popular).

const DAY_MS = 24 * 60 * 60 * 1000;

export async function handleSearchPeople(ctx: RequestContext, request: Request): Promise<Response> {
  const raw = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const handle = normalizeHandle(raw);
  if (handle === "") return validationError(ctx.requestId, { q: ["Type a name or @handle"] });
  if (raw.length > PEOPLE_SEARCH_Q_MAX) return validationError(ctx.requestId, { q: [`Must be at most ${PEOPLE_SEARCH_Q_MAX} characters`] });
  const name = raw.startsWith("@") ? null : raw;
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () =>
      repo.searchProfiles({ viewer: ctx.actor.subjectId, handle, name, limit: PEOPLE_SEARCH_MAX }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    const people = await peopleOf(ctx, repo, found.value);
    if (!people) return unavailable(ctx.requestId);
    return successResponse<PeopleSearchResponse>({ people }, ctx.requestId);
  });
}

/** Who the caller shares a group with, each with the first of their groups' names (by name). Null when membership could not be read. */
async function coMemberGroups(ctx: RequestContext): Promise<Map<string, string> | null> {
  const groups = await callerGroups(ctx);
  if (!groups) return null;
  const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name));
  const rosters = await ctx.timings.measure("roster", () => Promise.all(sorted.map((g) => ctx.roster.members(g.orgId))));
  const where = new Map<string, string>();
  for (const [i, roster] of rosters.entries()) {
    if (!roster.ok) return null;
    for (const m of roster.members) {
      if (m.subjectId !== ctx.actor.subjectId && !where.has(m.subjectId)) where.set(m.subjectId, sorted[i]!.name);
    }
  }
  return where;
}

function suggested(profile: KitchenProfileRecord, why: string): SuggestedPerson {
  // Everyone suggested is someone the caller doesn't follow yet (storage leaves the rest out).
  return { ...toCommunityProfile(profile), following: "none", why };
}

export async function handlePeopleSuggestions(ctx: RequestContext): Promise<Response> {
  const groupOf = await coMemberGroups(ctx);
  if (!groupOf) return unavailable(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const viewer = ctx.actor.subjectId;
    const since = new Date(ctx.now().getTime() - POPULAR_DAYS * DAY_MS);
    // A few more than shown, so taking out people already in an earlier list still leaves a full one.
    const reach = SUGGESTIONS_MAX * 3;
    const [members, owners, cooks, popular] = await ctx.timings.measure("db", () =>
      Promise.all([
        repo.profilesFor({ userIds: [...groupOf.keys()], viewer, unfollowedOnly: true, limit: reach }),
        // Owners of recipes the caller saved, then people who posted cooks of the caller's recipes (CM-3).
        repo.recipeOwnersSavedBy({ viewer, limit: reach }),
        repo.cooksOfMine({ viewer, limit: reach }),
        repo.popularProfiles({ viewer, since, limit: reach }),
      ]),
    );
    if (!members.ok || !owners.ok || !cooks.ok || !popular.ok) return unavailable(ctx.requestId);

    const seen = new Set<string>([viewer]);
    const take = <T>(rows: readonly T[], profileOf: (row: T) => KitchenProfileRecord, why: (row: T) => string, max = SUGGESTIONS_MAX): SuggestedPerson[] => {
      const out: SuggestedPerson[] = [];
      for (const row of rows) {
        const profile = profileOf(row);
        if (out.length >= max || seen.has(profile.userId)) continue;
        seen.add(profile.userId);
        out.push(suggested(profile, why(row)));
      }
      return out;
    };
    const fromGroups = take(members.value, (p) => p, (p) => `In ${groupOf.get(p.userId) ?? "your group"}`);
    const saved = take(owners.value, (o) => o.profile, (o) => `You saved their ${o.recipeName}`);
    const fromRecipes = [...saved, ...take(cooks.value, (c) => c.profile, (c) => `Cooked your ${c.recipeName}`, SUGGESTIONS_MAX - saved.length)];
    const popularPeople = take(
      popular.value,
      (p) => p.profile,
      (p) => `${p.newFollowers} new follower${p.newFollowers === 1 ? "" : "s"}`,
    );
    return successResponse<PeopleSuggestionsResponse>({ fromGroups, fromRecipes, popular: popularPeople }, ctx.requestId);
  });
}
