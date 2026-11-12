import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MyProfile } from "@saas/contracts/kitchen";
import { resetAppConfigForTests } from "@web-console-next/lib/app-config";
import { frameRedirect, newFrame } from "@web-console-next/lib/features";
import { STATIC_PAGES, redirectRules, staticPageFor } from "@web-console-next/lib/static-pages.mjs";
import { backParent } from "@web-console-next/components/kitchen/back";
import { activeKitchenTab, activeNewFrameTab } from "@web-console-next/components/kitchen/nav";
import {
  BLOCKED_HREF,
  COMMUNITY_HREF,
  HANDLE_SETUP_HREF,
  HANDLE_SHAPE_TEXT,
  PEOPLE_SEARCH_HREF,
  PRIVACY_MODES,
  canSaveProfile,
  communityTop,
  countText,
  draftChanged,
  followButton,
  followTarget,
  followToastTitle,
  followedByText,
  handleNote,
  lockText,
  parseHandleParam,
  profileCounts,
  profileDraft,
  profileHref,
  profileInitials,
  profileListFrom,
  profileMenuText,
  profileUrl,
  saveProfileRequest,
  saveRefusalText,
  shouldCheckHandle,
} from "@web-console-next/components/kitchen/community";
import { CommunityEntry, CountsRow, FollowButtonView, LockCard } from "@web-console-next/components/kitchen/community-views";
import { CookHubView } from "@web-console-next/components/kitchen/cook-hub-views";

// cookpool-community CM-5 (design §4, the canvas row "Community"):
// HandleSetup, a cook's profile, and where Community's pages are.

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const NOW = new Date("2026-11-08T10:00:00Z");

const g = globalThis as unknown as { window?: { location: { host: string } } };
function onHost<T>(host: string, run: () => T): T {
  const had = g.window;
  g.window = { location: { host } };
  resetAppConfigForTests();
  try {
    return run();
  } finally {
    if (had === undefined) delete g.window;
    else g.window = had;
    resetAppConfigForTests();
  }
}

function myProfile(patch: Partial<MyProfile> = {}): MyProfile {
  return {
    userId: "usr_meera",
    handle: "meeracooks",
    name: "Meera Iyer",
    about: "South Indian at home",
    privacy: "public",
    handleChangedAt: null,
    nextHandleChangeAt: null,
    createdAt: "2026-11-01T08:00:00.000Z",
    updatedAt: "2026-11-01T08:00:00.000Z",
    ...patch,
  };
}

// ── HandleSetup ───────────────────────────────────────────────────

describe("HandleSetup: the handle's note as you type", () => {
  const note = (typed: string, more: Partial<Parameters<typeof handleNote>[0]> = {}) =>
    handleNote({ typed, current: null, nextChangeAt: null, availability: null, now: NOW, ...more });

  it("asks for a shape until something fair is typed", () => {
    expect(note("")).toEqual({ text: HANDLE_SHAPE_TEXT, tone: "muted" });
    expect(HANDLE_SHAPE_TEXT).toBe("3–20 letters, numbers, _ or .");
    expect(note("ab")).toEqual({ text: HANDLE_SHAPE_TEXT, tone: "bad" });
    expect(note("meera cooks")).toEqual({ text: HANDLE_SHAPE_TEXT, tone: "bad" });
    expect(note(".meera")).toEqual({ text: HANDLE_SHAPE_TEXT, tone: "bad" });
    expect(note("meera..cooks")).toEqual({ text: HANDLE_SHAPE_TEXT, tone: "bad" });
    expect(note("a".repeat(21))).toEqual({ text: HANDLE_SHAPE_TEXT, tone: "bad" });
  });

  it("says reserved words and cookpool… at once, before asking", () => {
    expect(note("admin")).toEqual({ text: "@admin is reserved", tone: "bad" });
    expect(note("CookpoolChef")).toEqual({ text: "@cookpoolchef is reserved", tone: "bad" });
    expect(shouldCheckHandle("admin", null)).toBe(false);
    expect(shouldCheckHandle("ab", null)).toBe(false);
    expect(shouldCheckHandle("@MeeraCooks", null)).toBe(true);
  });

  it("checks with the server, then says taken or yours", () => {
    expect(note("meeracooks")).toEqual({ text: "Checking @meeracooks…", tone: "muted" });
    // An answer for another handle (the last one typed) doesn't count.
    expect(note("meeracooks", { availability: { handle: "meera", available: true } }).tone).toBe("muted");
    expect(note("anucooks", { availability: { handle: "anucooks", available: false, reason: "handle_taken" } })).toEqual({ text: "@anucooks is taken", tone: "bad" });
    expect(note("@MeeraCooks", { availability: { handle: "meeracooks", available: true } })).toEqual({
      text: "@meeracooks is yours · you can change it once a month",
      tone: "ok",
    });
  });

  it("your own handle is yours, and isn't asked about", () => {
    expect(note("meeracooks", { current: "meeracooks" })).toEqual({ text: "@meeracooks is yours", tone: "ok" });
    expect(shouldCheckHandle("meeracooks", "meeracooks")).toBe(false);
  });

  it("too soon to change it: the date it can change again", () => {
    const n = note("meera.k", { current: "meeracooks", nextChangeAt: "2026-12-12T09:00:00Z", availability: { handle: "meera.k", available: true } });
    expect(n).toEqual({ text: "You can change your handle again on 12 Dec", tone: "bad" });
    // Once the date has passed, it can.
    expect(note("meera.k", { current: "meeracooks", nextChangeAt: "2026-11-01T09:00:00Z", availability: { handle: "meera.k", available: true } }).tone).toBe("ok");
  });

  it("words a refused save by its reason", () => {
    expect(saveRefusalText({ reason: "handle_taken", message: "conflict" }, "AnuCooks", NOW)).toBe("@anucooks is taken");
    expect(saveRefusalText({ reason: "handle_reserved", message: "x" }, "admin", NOW)).toBe("@admin is reserved");
    expect(saveRefusalText({ reason: "handle_shape", message: "x" }, "a", NOW)).toBe(HANDLE_SHAPE_TEXT);
    expect(saveRefusalText({ reason: "handle_too_soon", message: "x", details: { nextChangeAt: "2026-12-01T00:00:00Z" } }, "meera.k", NOW)).toBe(
      "You can change your handle again on 1 Dec",
    );
    expect(saveRefusalText({ message: "Something broke" }, "meera", NOW)).toBe("Something broke");
  });
});

describe("HandleSetup: the form and what Save sends", () => {
  it("opens on your profile, or for a first one your groups' name", () => {
    expect(profileDraft(myProfile(), "Meera")).toEqual({ name: "Meera Iyer", handle: "meeracooks", about: "South Indian at home", privacy: "public" });
    expect(profileDraft(null, "  Meera  ")).toEqual({ name: "Meera", handle: "", about: "", privacy: "public" });
    expect(profileDraft(null, null).name).toBe("");
  });

  it("sends the name and about trimmed, an empty about as null, the handle as stored", () => {
    expect(saveProfileRequest({ name: " Meera ", handle: "@MeeraCooks ", about: "  ", privacy: "private" })).toEqual({
      handle: "meeracooks",
      name: "Meera",
      about: null,
      privacy: "private",
    });
  });

  it("saves only with a name and a green handle, and only a change", () => {
    const ok = { text: "", tone: "ok" as const };
    const draft = { name: "Meera", handle: "meeracooks", about: "", privacy: "public" as const };
    expect(canSaveProfile(draft, ok)).toBe(true);
    expect(canSaveProfile({ ...draft, name: " " }, ok)).toBe(false);
    expect(canSaveProfile({ ...draft, about: "x".repeat(161) }, ok)).toBe(false);
    expect(canSaveProfile(draft, { text: "", tone: "muted" })).toBe(false);
    expect(canSaveProfile(draft, { text: "", tone: "bad" })).toBe(false);
    expect(draftChanged(profileDraft(myProfile(), null), myProfile())).toBe(false);
    expect(draftChanged({ ...profileDraft(myProfile(), null), privacy: "private" }, myProfile())).toBe(true);
    expect(draftChanged(profileDraft(null, "Meera"), null)).toBe(true);
  });

  it("who can follow you: Anyone · People I approve, in the canvas's words", () => {
    expect(PRIVACY_MODES.map((m) => [m.id, m.title])).toEqual([
      ["public", "Anyone"],
      ["private", "People I approve"],
    ]);
  });
});

// ── A profile ─────────────────────────────────────────────────────

describe("a profile: the relationship decides the button", () => {
  const rel = (following: "none" | "requested" | "accepted", more = {}) => ({ following, followsYou: false, isYou: false, ...more });

  it("Follow, Ask to follow, Requested, Following, Follow back, Edit profile", () => {
    expect(followButton(rel("none"), "public")).toEqual({ kind: "follow", label: "Follow", primary: true });
    expect(followButton(rel("none"), "private")).toEqual({ kind: "ask", label: "Ask to follow", primary: true });
    expect(followButton(rel("requested"), "private")).toEqual({ kind: "requested", label: "Requested", primary: false });
    expect(followButton(rel("accepted"), "private")).toEqual({ kind: "following", label: "Following", primary: false });
    expect(followButton(rel("none", { followsYou: true }), "public").label).toBe("Follow back");
    expect(followButton(rel("none", { isYou: true }), "public")).toEqual({ kind: "edit", label: "Edit profile", primary: false });
  });

  it("a tap follows (requested for a private profile), or unfollows and takes a request back", () => {
    expect(followTarget("none", "public")).toBe("accepted");
    expect(followTarget("none", "private")).toBe("requested");
    expect(followTarget("accepted", "public")).toBe("none");
    expect(followTarget("requested", "private")).toBe("none");
    expect(followToastTitle("none", "accepted", "Kabir")).toBe("Following Kabir");
    expect(followToastTitle("none", "requested", "Kabir")).toBe("Asked to follow Kabir");
    expect(followToastTitle("accepted", "none", "Kabir")).toBe("Unfollowed Kabir");
    expect(followToastTitle("requested", "none", "Kabir")).toBe("Request taken back");
  });

  it("the private lock: what it says, and the counts don't open lists", () => {
    expect(lockText({ name: "Kabir Shah", handle: "kabirbakes" })).toEqual({
      title: "This profile is private",
      sub: "Follow Kabir to see their cooks and recipes. Kabir approves each follower.",
    });
    const cells = profileCounts("kabirbakes", { posts: 0, recipes: 3, followers: 318, following: 76 }, false);
    expect(cells.map((c) => [c.label, c.value, c.href])).toEqual([
      ["Posts", "0", null],
      ["Recipes", "3", null],
      ["Followers", "318", null],
      ["Following", "76", null],
    ]);
    expect(profileCounts("kabirbakes", { posts: 0, recipes: 3, followers: 318, following: 76 }, true).map((c) => c.href)).toEqual([
      null,
      null,
      "/u/kabirbakes?list=followers",
      "/u/kabirbakes?list=following",
    ]);
    const lock = html(React.createElement(LockCard, lockText({ name: "Kabir", handle: "kabirbakes" })));
    expect(lock).toContain("This profile is private");
    expect(lock).toContain("lucide-lock");
  });

  it("draws counts as numbers, linking only when they open", () => {
    const out = html(React.createElement(CountsRow, { cells: profileCounts("kabirbakes", { posts: 0, recipes: 3, followers: 12_480, following: 76 }, true) }));
    expect(out).toContain(">12.4k<");
    expect(out).toContain('href="/u/kabirbakes?list=followers"');
    expect(out.match(/<a /g)).toHaveLength(2);
    expect(countText(999)).toBe("999");
    expect(countText(10_000)).toBe("10k");
    expect(countText(1_250_000)).toBe("1.2m");
  });

  it("the main button: green to follow, outlined once you do, a link on your own", () => {
    const green = html(React.createElement(FollowButtonView, { button: followButton(rel("none"), "private"), onClick: () => undefined }));
    expect(green).toContain(">Ask to follow<");
    expect(green).toContain("bg-primary");
    expect(green).toContain('aria-pressed="false"');
    const following = html(React.createElement(FollowButtonView, { button: followButton(rel("accepted"), "public"), onClick: () => undefined }));
    expect(following).toContain('aria-pressed="true"');
    expect(following).toContain("border-border");
    const edit = html(React.createElement(FollowButtonView, { button: followButton(rel("none", { isYou: true }), "public"), href: HANDLE_SETUP_HREF }));
    expect(edit).toContain('href="/you/profile"');
  });

  it("Followed by …, the face, the ⋯ menu's words", () => {
    expect(followedByText([])).toBeNull();
    expect(followedByText([{ handle: "anucooks", name: "Anu Mathew" }])).toBe("Followed by Anu");
    expect(followedByText([{ handle: "anucooks", name: "Anu Mathew" }, { handle: "dev", name: "Dev Rao" }, { handle: "sam", name: "Sam" }])).toBe(
      "Followed by Anu, Dev and Sam",
    );
    expect(profileInitials({ name: "Kabir Shah", handle: "kabirbakes" })).toBe("KS");
    expect(profileInitials({ name: " ", handle: "kabirbakes" })).toBe("K");
    expect(profileMenuText({ name: "Kabir Shah", handle: "kabirbakes" }, false)).toEqual({
      mute: "Mute Kabir's posts",
      block: "Block @kabirbakes",
      blockNote: "Blocking hides you from each other everywhere. Kabir isn't told.",
    });
    expect(profileMenuText({ name: "Kabir Shah", handle: "kabirbakes" }, true).mute).toBe("Unmute Kabir's posts");
  });

  it("its address: the handle normalized, the list in ?list= (Recipes until posts arrive)", () => {
    expect(parseHandleParam("MeeraCooks")).toBe("meeracooks");
    expect(parseHandleParam("%40meeracooks")).toBe("meeracooks");
    expect(parseHandleParam("_")).toBeNull();
    expect(parseHandleParam("%E0%A4")).toBeNull();
    expect(parseHandleParam(null)).toBeNull();
    expect(profileHref("meeracooks")).toBe("/u/meeracooks");
    // CM-6 flips the default to Cooks: the bare page is Cooks, Recipes is in the address.
    expect(profileHref("meeracooks", "cooks")).toBe("/u/meeracooks");
    expect(profileHref("meeracooks", "recipes")).toBe("/u/meeracooks?list=recipes");
    expect(profileListFrom(null)).toBe("cooks");
    expect(profileListFrom("following")).toBe("following");
    expect(profileListFrom("posts")).toBe("cooks");
    expect(profileUrl("https://stage.cookpool.store/", "meeracooks")).toBe("https://stage.cookpool.store/u/meeracooks");
  });
});

// ── Community: the shell, the hub, the first time ─────────────────

describe("Community opens HandleSetup the first time, without a profile", () => {
  it("setup once, then a card; nothing with a profile", () => {
    expect(communityTop(undefined, false)).toBe("loading");
    expect(communityTop(null, false)).toBe("setup");
    expect(communityTop(null, true)).toBe("card");
    expect(communityTop(myProfile(), false)).toBe("none");
  });

  it("the Cook hub gains a Community entry, above My recipes", () => {
    const out = html(React.createElement(CookHubView, { cookNow: [], cards: [], recipesLoading: false, recipesFailed: false, community: React.createElement(CommunityEntry, { href: COMMUNITY_HREF }) }));
    expect(out).toContain('href="/community"');
    expect(out.indexOf('href="/community"')).toBeLessThan(out.indexOf("My recipes"));
    // Without it, the hub is as it was.
    expect(html(React.createElement(CookHubView, { cookNow: [], cards: [], recipesLoading: false, recipesFailed: false }))).not.toContain("/community");
  });
});

describe("Community's pages: Cook's, files, new frame only", () => {
  const COOK = ["/community", "/community/search", "/community/activity", "/u/:handle", "/p/:postId"];
  const YOU = ["/you/profile", "/you/blocked"];

  it("are static pages; a profile and a post are one file each", () => {
    for (const p of [...COOK, ...YOU]) expect(STATIC_PAGES).toContain(p);
    expect(staticPageFor("/u/meeracooks")).toBe("/u/:handle");
    expect(staticPageFor("/p/pst_1")).toBe("/p/:postId");
    expect(staticPageFor("/community/search")).toBe("/community/search");
    expect(redirectRules()).toEqual(expect.arrayContaining(["/u/:handle /u/_ 200", "/p/:postId /p/_ 200"]));
  });

  it("count as the Cook tab (and HandleSetup as You), never a sibling prefix", () => {
    for (const path of ["/community", "/community?tab=discover", "/community/search", "/community/activity", "/u/meeracooks", "/p/pst_1"]) {
      expect([path, activeNewFrameTab(path.split("?")[0])]).toEqual([path, "cook"]);
    }
    expect(activeNewFrameTab("/you/profile")).toBe("you");
    expect(activeNewFrameTab("/you/blocked")).toBe("you");
    expect(activeNewFrameTab("/use")).toBe("home");
    expect(activeNewFrameTab("/pantry")).toBe("pantry");
    expect(activeNewFrameTab("/communityx")).toBeNull();
    expect(activeNewFrameTab("/ux")).toBeNull();
    // Today's frame has no Community: its tabs are as they were.
    expect(activeKitchenTab("/community")).toBeNull();
    expect(activeKitchenTab("/u/meeracooks")).toBeNull();
  });

  it("go back: search, Activity, a profile and a post to Community; Community to Cook", () => {
    expect(backParent("/community", {}, { newFrame: true })).toBe("/cook");
    expect(backParent("/community/search", {}, { newFrame: true })).toBe(COMMUNITY_HREF);
    expect(backParent("/u/meeracooks", {}, { newFrame: true })).toBe(COMMUNITY_HREF);
    expect(backParent("/p/pst_1", {}, { newFrame: true })).toBe(COMMUNITY_HREF);
    expect(backParent("/you/profile", {}, { newFrame: true })).toBe("/you");
    expect(backParent(BLOCKED_HREF, {}, { newFrame: true })).toBe(HANDLE_SETUP_HREF);
    expect(PEOPLE_SEARCH_HREF).toBe("/community/search");
  });

  it("with newFrame false nothing changes: each sends today's visitor away", () => {
    for (const p of COOK) expect([p, frameRedirect(p, false)]).toEqual([p, "/home"]);
    for (const p of YOU) expect([p, frameRedirect(p, false)]).toEqual([p, "/you"]);
    expect(onHost("cookpool.store", () => frameRedirect("/u/:handle", newFrame()))).toBe("/home");
    expect(onHost("stage.cookpool.store", () => frameRedirect("/u/:handle", newFrame()))).toBeNull();
    expect(onHost("stage.cookpool.store", () => frameRedirect("/community", newFrame()))).toBeNull();
  });
});
