import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommunityPerson, PeopleSuggestionsResponse, PersonProfileResponse, RecipeResponse, SuggestedPerson } from "@saas/contracts/kitchen";
import { applyPatches, type CacheKey, type CacheLike } from "@web-console-next/lib/optimistic";
import { qk } from "@web-console-next/lib/query-keys";
import {
  NOBODY_TEXT,
  blockPatches,
  blockedRow,
  followPatches,
  followerRemovedPatches,
  mutePatches,
  peopleSearchQuery,
  peopleSearchView,
  personRow,
  requestAnsweredPatches,
  rowFollowLabel,
  suggestionGroups,
  unblockPatches,
} from "@web-console-next/components/kitchen/community-people";
import { PersonRowView } from "@web-console-next/components/kitchen/community-views";
import {
  PUBLIC_OPTION,
  levelAfter,
  levelCall,
  levelToastTitle,
  shareLevelOf,
  shareOptions,
  undoLevelCallFor,
  visibilityCall,
  visibilityPatches,
} from "@web-console-next/components/kitchen/recipe-share";
import { ShareSheetBody } from "@web-console-next/components/kitchen/recipe-share-views";
import { EXPLORE_SOURCES, exploreHref, exploreRows, exploreSourceFrom, exploreSubtitle } from "@web-console-next/components/kitchen/explore";
import { profileRecipeRows } from "@web-console-next/components/kitchen/cook-hub";
import { recipe, summary } from "./kitchen-recipe-fixtures";

// cookpool-community CM-5: people search and suggestions, follows, blocks
// and requests at once, and Public in the recipe share sheet and Explore.

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

function mapCache(entries: [CacheKey, unknown][]): CacheLike {
  const map = new Map(entries.map(([k, v]) => [JSON.stringify(k), v] as const));
  return {
    entries: (prefix) =>
      [...map.entries()].map(([k, v]) => [JSON.parse(k) as CacheKey, v] as const).filter(([k]) => prefix.every((p, i) => JSON.stringify(k[i]) === JSON.stringify(p))),
    get: (key) => map.get(JSON.stringify(key)),
    set: (key, data) => void map.set(JSON.stringify(key), data),
  };
}

function person(id: string, patch: Partial<CommunityPerson> = {}): CommunityPerson {
  return { userId: `usr_${id}`, handle: `${id}cooks`, name: `${id[0]!.toUpperCase()}${id.slice(1)} Rao`, about: null, privacy: "public", following: "none", ...patch };
}
const why = (p: CommunityPerson, w: string): SuggestedPerson => ({ ...p, why: w });

function profileRead(patch: Partial<PersonProfileResponse> = {}): PersonProfileResponse {
  return {
    profile: { userId: "usr_kabir", handle: "kabirbakes", name: "Kabir Shah", about: null, privacy: "public" },
    counts: { posts: 0, recipes: 3, followers: 318, following: 76 },
    relationship: { following: "none", followsYou: false, blocked: false, muted: false, isYou: false },
    followedBy: [],
    canSee: true,
    ...patch,
  };
}

// ── Search and suggestions ────────────────────────────────────────

describe("people search: the field and what it shows", () => {
  it("asks for the trimmed text; nothing (just @ too) shows the suggestions", () => {
    expect(peopleSearchQuery("  kabir ")).toBe("kabir");
    expect(peopleSearchQuery("@")).toBe("");
    expect(peopleSearchQuery("   ")).toBe("");
    expect(peopleSearchQuery("@kabirbakes")).toBe("@kabirbakes");
    expect(peopleSearchQuery("x".repeat(60))).toHaveLength(40);
  });

  it("suggestions, loading, results, or the line that private profiles show by @handle only", () => {
    expect(peopleSearchView("", null)).toEqual({ kind: "suggestions" });
    expect(peopleSearchView("kab", null)).toEqual({ kind: "loading" });
    expect(peopleSearchView("kab", { people: [] })).toEqual({ kind: "empty", text: NOBODY_TEXT });
    expect(NOBODY_TEXT).toBe("Nobody by that name. Private profiles show by @handle only.");
    const v = peopleSearchView("kab", { people: [person("kabir")] });
    expect(v.kind === "results" && v.rows.map((r) => r.href)).toEqual(["/u/kabircooks"]);
  });

  it("the suggestion groups in order, with their why, empty ones left out, nobody twice", () => {
    const s: PeopleSuggestionsResponse = {
      fromGroups: [why(person("anu"), "In Flat 4B"), why(person("dev"), "In Flat 4B")],
      fromRecipes: [why(person("kabir"), "You saved their Besan ladoo"), why(person("anu"), "You saved their Rajma")],
      popular: [],
    };
    const groups = suggestionGroups(s);
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.sub)])).toEqual([
      ["From your groups", ["@anucooks · In Flat 4B", "@devcooks · In Flat 4B"]],
      ["From recipes", ["@kabircooks · You saved their Besan ladoo"]],
    ]);
    expect(suggestionGroups({ fromGroups: [], fromRecipes: [], popular: [why(person("sam"), "12 new followers")] }).map((g) => g.title)).toEqual(["Popular"]);
  });

  it("a row: face, name, @handle · why, and Follow · Requested · Following", () => {
    expect(personRow(person("kabir", { privacy: "private" }))).toMatchObject({ initials: "KR", sub: "@kabircooks", private: true, href: "/u/kabircooks" });
    expect(rowFollowLabel("none")).toEqual({ label: "Follow", primary: true });
    expect(rowFollowLabel("requested")).toEqual({ label: "Requested", primary: false });
    expect(rowFollowLabel("accepted")).toEqual({ label: "Following", primary: false });
    const out = html(React.createElement("ul", null, React.createElement(PersonRowView, { row: personRow(person("kabir")), onFollow: () => undefined })));
    expect(out).toContain('href="/u/kabircooks"');
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain("Follow<span class=\"sr-only\"> Kabir Rao</span>");
  });

  it("a blocked person's row: their profile's name, else the handle, else Someone", () => {
    expect(blockedRow({ userId: "usr_k", handle: "kabirbakes", name: "Kabir Shah", blockedAt: "" })).toEqual({ userId: "usr_k", name: "Kabir Shah", sub: "@kabirbakes", initials: "KS" });
    expect(blockedRow({ userId: "usr_k", handle: "kabirbakes", name: null, blockedAt: "" }).name).toBe("@kabirbakes");
    expect(blockedRow({ userId: "usr_k", handle: null, name: null, blockedAt: "" })).toEqual({ userId: "usr_k", name: "Someone", sub: null, initials: "?" });
  });
});

// ── At once ───────────────────────────────────────────────────────

describe("a follow shows at once, everywhere the person is", () => {
  it("their profile's button and follower count; a request doesn't count; a private profile opens once in", () => {
    const cache = mapCache([[qk.kitchenPersonProfile("kabirbakes"), profileRead()]]);
    applyPatches(cache, followPatches("kabirbakes", "usr_kabir", "accepted"));
    const r = cache.get(qk.kitchenPersonProfile("kabirbakes")) as PersonProfileResponse;
    expect([r.relationship.following, r.counts.followers]).toEqual(["accepted", 319]);
    applyPatches(cache, followPatches("kabirbakes", "usr_kabir", "none"));
    expect((cache.get(qk.kitchenPersonProfile("kabirbakes")) as PersonProfileResponse).counts.followers).toBe(318);

    const priv = mapCache([[qk.kitchenPersonProfile("kabirbakes"), profileRead({ profile: { ...profileRead().profile, privacy: "private" }, canSee: false })]]);
    applyPatches(priv, followPatches("kabirbakes", "usr_kabir", "requested"));
    const p = priv.get(qk.kitchenPersonProfile("kabirbakes")) as PersonProfileResponse;
    expect([p.relationship.following, p.counts.followers, p.canSee]).toEqual(["requested", 318, false]);
  });

  it("their row in search, suggestions and lists; anyone else's left alone", () => {
    const search = { people: [person("kabir"), person("anu")] };
    const sugg = { fromGroups: [], fromRecipes: [why(person("kabir"), "x")], popular: [] };
    const list = { people: [person("kabir")], nextCursor: null };
    const cache = mapCache([
      [qk.kitchenPeopleSearch("kab"), search],
      [qk.kitchenPeopleSuggestions(), sugg],
      [qk.kitchenProfilePeople("anucooks", "following"), list],
    ]);
    const changed = applyPatches(cache, followPatches("kabircooks", "usr_kabir", "requested"));
    expect(changed).toHaveLength(3);
    const s = cache.get(qk.kitchenPeopleSearch("kab")) as { people: CommunityPerson[] };
    expect(s.people.map((x) => x.following)).toEqual(["requested", "none"]);
    expect(s.people[1]).toBe(search.people[1]);
    expect((cache.get(qk.kitchenPeopleSuggestions()) as PeopleSuggestionsResponse).fromRecipes[0]!.following).toBe("requested");
  });

  it("block takes them out of every list; an answered request leaves your requests; mute marks the profile", () => {
    const cache = mapCache([
      [qk.kitchenPeopleSearch("k"), { people: [person("kabir"), person("anu")] }],
      [qk.kitchenFollowRequests(), { people: [person("kabir")], nextCursor: null }],
      [qk.kitchenPersonProfile("kabirbakes"), profileRead()],
      [qk.kitchenBlocks(), { blocks: [{ userId: "usr_kabir", handle: "kabirbakes", name: "Kabir", blockedAt: "" }] }],
      [qk.kitchenProfilePeople("meeracooks", "followers"), { people: [person("kabir")], nextCursor: null }],
    ]);
    applyPatches(cache, blockPatches("usr_kabir"));
    expect((cache.get(qk.kitchenPeopleSearch("k")) as { people: CommunityPerson[] }).people.map((p) => p.userId)).toEqual(["usr_anu"]);
    applyPatches(cache, requestAnsweredPatches("usr_kabir"));
    expect((cache.get(qk.kitchenFollowRequests()) as { people: unknown[] }).people).toEqual([]);
    applyPatches(cache, mutePatches("kabirbakes", true));
    expect((cache.get(qk.kitchenPersonProfile("kabirbakes")) as PersonProfileResponse).relationship.muted).toBe(true);
    applyPatches(cache, unblockPatches("usr_kabir"));
    expect((cache.get(qk.kitchenBlocks()) as { blocks: unknown[] }).blocks).toEqual([]);
    // (The followers list already lost them to the block.)
    expect(applyPatches(cache, followerRemovedPatches("usr_kabir"))).toEqual([]);
  });
});

// ── The recipe share sheet: Public ────────────────────────────────

describe("the recipe share sheet offers Public", () => {
  it("a fourth row, last, in its words; three without it, as before", () => {
    expect(shareOptions(["Flat 4B"]).map((o) => o.id)).toEqual(["only_me", "groups", "link"]);
    expect(shareOptions(["Flat 4B"], { public: true }).map((o) => o.id)).toEqual(["only_me", "groups", "link", "public"]);
    expect(PUBLIC_OPTION).toEqual({ id: "public", title: "Public", sub: "Listed on your profile and in Discover", icon: "public" });
  });

  it("Public is a listed link recipe", () => {
    expect(shareLevelOf({ visibility: "link", listed: true })).toBe("public");
    expect(shareLevelOf({ visibility: "link", listed: false })).toBe("link");
    expect(shareLevelOf({ visibility: "link" })).toBe("link");
    expect(shareLevelOf({ visibility: "groups", listed: false })).toBe("groups");
  });

  it("maps each row to its PATCH: Public lists it; the link from Public unlists it; the rest are their visibility", () => {
    expect(levelCall("public", "groups")).toEqual({ kind: "visibility", body: { visibility: "link", listed: true } });
    expect(levelCall("link", "public")).toEqual({ kind: "visibility", body: { visibility: "link", listed: false } });
    expect(levelCall("link", "groups")).toEqual(visibilityCall("link"));
    expect(levelCall("only_me", "public")).toEqual(visibilityCall("only_me"));
    expect(levelAfter(levelCall("public", "only_me"), "only_me")).toBe("public");
    expect(levelAfter({ kind: "off" }, "public")).toBe("groups");
    expect(levelAfter({ kind: "rotate" }, "public")).toBe("public");
  });

  it("Undo sends the level before; a toast says where it is", () => {
    expect(undoLevelCallFor(levelCall("public", "link"), "link")).toEqual({ kind: "visibility", body: { visibility: "link", listed: false } });
    expect(undoLevelCallFor(levelCall("groups", "public"), "public")).toEqual({ kind: "visibility", body: { visibility: "link", listed: true } });
    expect(undoLevelCallFor({ kind: "rotate" }, "public")).toBeNull();
    expect(levelToastTitle("public")).toBe("Public · on your profile and in Discover");
    expect(levelToastTitle("link")).toBe("Anyone with the link can see it");
  });

  it("shows at once: listed on the page and My recipes, kept with the link; any other level unlists", () => {
    const cache = mapCache([
      [qk.kitchenRecipe("rcp_curry"), { recipe: recipe({ visibility: "link", linkCode: "7kq2mxAb3Z", listed: false }), lastCook: null }],
      [qk.kitchenMyRecipes(), [summary({ visibility: "link", listed: false })]],
    ]);
    applyPatches(cache, visibilityPatches("rcp_curry", { visibility: "link", linkCode: "7kq2mxAb3Z", listed: true }));
    expect((cache.get(qk.kitchenRecipe("rcp_curry")) as RecipeResponse).recipe).toMatchObject({ visibility: "link", linkCode: "7kq2mxAb3Z", listed: true });
    expect((cache.get(qk.kitchenMyRecipes()) as { listed?: boolean }[])[0]!.listed).toBe(true);
    applyPatches(cache, visibilityPatches("rcp_curry", { visibility: "groups" }));
    expect((cache.get(qk.kitchenRecipe("rcp_curry")) as RecipeResponse).recipe).toMatchObject({ visibility: "groups", linkCode: null, listed: false });
  });

  it("draws Public chosen with the link box, and You's row says Public", () => {
    const out = html(
      React.createElement(ShareSheetBody, {
        options: shareOptions(["Flat 4B"], { public: true }),
        visibility: "public",
        linkUrl: "https://stage.cookpool.store/r/7kq2mxAb3Z",
        copied: false,
        savedBy: 2,
        onPick: () => undefined,
        onCopy: () => undefined,
        onRotate: () => undefined,
        onTurnOff: () => undefined,
        onDone: () => undefined,
      }),
    );
    expect(out.match(/role="radio"/g)).toHaveLength(4);
    expect(out).toMatch(/aria-checked="true"[^>]*>.*?Public<\/span><span[^>]*>Listed on your profile and in Discover/);
    expect(out).toContain("lucide-globe");
    expect(out).toContain(">Copy<");
    expect(profileRecipeRows([summary({ visibility: "link", listed: true, savedBy: 0 })])[0]!.meta).toBe("Public");
    expect(profileRecipeRows([summary({ visibility: "link", listed: false, savedBy: 0 })])[0]!.meta).toBe("Anyone with the link");
  });
});

describe("Explore gains Public", () => {
  it("a third source in the address, with its subtitle and who made each", () => {
    expect(EXPLORE_SOURCES.map((s) => s.label)).toEqual(["Cookpool", "Your groups", "Public"]);
    expect(exploreHref("public")).toBe("/explore?source=public");
    expect(exploreSourceFrom("public")).toBe("public");
    expect(exploreSourceFrom("groups")).toBe("groups");
    expect(exploreSubtitle("public", null, [])).toBe("Listed by cooks on their profiles");
    const match = { have: 6, total: 6, missing: 0, short: 0, missingNames: [], always: 0 } as unknown as Parameters<typeof exploreRows>[0][number]["match"];
    const rows = exploreRows([{ ...summary({ mine: false, ownerName: "Kabir Shah", ownerId: "usr_kabir" }), match }], { source: "public", onlyCanMake: false });
    expect(rows[0]!.meta.startsWith("by Kabir")).toBe(true);
  });
});
