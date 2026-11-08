import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActivityItem, CommunityPost, KitchenDish, MyProfile, PostComment } from "@saas/contracts/kitchen";
import { applyPatches, type CacheLike } from "@web-console-next/lib/optimistic";
import { qk } from "@web-console-next/lib/query-keys";
import { pushRows } from "@web-console-next/lib/push";
import { PULL_PAGES, pullsToRefresh } from "@web-console-next/components/kitchen/gestures";
import {
  AUDIENCE_WORDS,
  authorHiddenPatches,
  commentAddedPatches,
  commentBody,
  commentRefusalText,
  commentRemovedPatches,
  commentRights,
  commentSavedPatches,
  commentsOf,
  cookThis,
  feedEmpty,
  feedHref,
  feedTabFrom,
  postAddedPatches,
  postCard,
  postMenuItems,
  postRemovedPatches,
  shortAgo,
  statTiles,
  stepCompareText,
  yumLabel,
  yumNamesText,
  yumPatches,
  yumToggled,
} from "@web-console-next/components/kitchen/community-posts";
import {
  afterFinishHref,
  audienceOptions,
  composerRecipeLine,
  createPostRequest,
  dishPostable,
  offersShare,
  parseSharedPosts,
  parseStepSeed,
  postButtonLabel,
  postRefusal,
  postedToast,
  previewOf,
  shareDefaults,
  shareTopLine,
  showRows,
  stepSeedOf,
  withSharedPost,
} from "@web-console-next/components/kitchen/community-share";
import {
  REPORT_REASON_ROWS,
  activityGroups,
  activityLine,
  activityWho,
  bellLabel,
  markReadBefore,
  moreRequestsText,
  reportRequest,
  reportTitle,
  unreadBadge,
} from "@web-console-next/components/kitchen/community-activity";
import { CommunityHeader } from "@web-console-next/components/kitchen/community-views";
import { PostCardView, StatTiles } from "@web-console-next/components/kitchen/community-post-views";
import type { CookGuide } from "@web-console-next/components/kitchen/cook-guide-draft";

// cookpool-community CM-6 (design §4, the canvas row "Community": CommunityFeed,
// ShareCook, PostDetail, CommunityActivity): the feed, the post card, a post's
// page, Share this cook?, reports and Activity, as pure rules.

const NOW = new Date("2026-11-08T12:00:00");
const ANU = { userId: "usr_anu", handle: "anucooks", name: "Anu Mathew", about: null, privacy: "public" as const };
const DEV = { userId: "usr_dev", handle: "devmakesdal", name: "Dev Rao", about: null, privacy: "public" as const };

function post(over: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: "pst_1",
    author: ANU,
    title: "Chicken curry",
    caption: "Halved it for the three of us.",
    audience: "followers",
    show: { size: true, time: true, ate: true, steps: true },
    stats: { size: { factorMilli: 500, main: { name: "chicken", qtyMilli: 450_000, unit: "g" }, portionsHalf: 6 }, minutes: 48, ate: 3, steps: { done: 9, total: 9 } },
    recipe: { id: "rcp_curry", name: "Chicken curry", linkCode: "abc123" },
    yums: { count: 12, mine: false, names: ["Dev Rao", "Meera Iyer"] },
    comments: { count: 3 },
    mine: false,
    createdAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString(),
    editedAt: null,
    ...over,
  };
}

function dish(over: Partial<KitchenDish> = {}): KitchenDish {
  return {
    id: "dsh_1",
    cook: "usr_me",
    orgId: null,
    name: "Chicken curry",
    portionsHalf: 6,
    portions: 3,
    state: "finalized",
    shares: [],
    recipeId: "rcp_curry",
    recipeFactorMilli: 500,
    ...over,
  } as KitchenDish;
}

function myProfile(over: Partial<MyProfile> = {}): MyProfile {
  return { ...ANU, userId: "usr_me", handle: "me_cooks", name: "Rahul", handleChangedAt: null, nextHandleChangeAt: null, createdAt: "", updatedAt: "", ...over };
}

function cache(entries: Record<string, unknown>): CacheLike & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(entries));
  return {
    data,
    entries: (prefix) => [...data].filter(([k]) => JSON.parse(k).slice(0, prefix.length).every((v: unknown, i: number) => v === prefix[i])).map(([k, v]) => [JSON.parse(k), v] as const),
    get: (key) => data.get(JSON.stringify(key)),
    set: (key, value) => void data.set(JSON.stringify(key), value),
  };
}
const k = (key: readonly unknown[]) => JSON.stringify(key);

// ── The feed and the card ─────────────────────────────────────────

describe("the feed", () => {
  it("is Following unless ?tab=discover, and each tab has its empty state", () => {
    expect(feedTabFrom(null)).toBe("following");
    expect(feedTabFrom("discover")).toBe("discover");
    expect(feedTabFrom("nope")).toBe("following");
    expect(feedHref("following")).toBe("/community");
    expect(feedHref("discover")).toBe("/community?tab=discover");
    expect(feedEmpty("following")).toEqual({ title: "Follow cooks to see their cooks here", sub: "Your own posts show here too.", action: { label: "Find cooks", href: "/community/search" } });
    expect(feedEmpty("discover").action).toBeNull();
  });

  it("pulls to refresh on the feed and Activity, not on a post (its comment box) or a profile", () => {
    expect(PULL_PAGES).toEqual(expect.arrayContaining(["/community", "/community/activity"]));
    expect(pullsToRefresh("/community")).toBe(true);
    expect(pullsToRefresh("/p/pst_1")).toBe(false);
    expect(pullsToRefresh("/u/anucooks")).toBe(false);
  });
});

describe("the post card", () => {
  it("says who, when and for whom, and the audiences in words", () => {
    const c = postCard(post(), NOW, new Set());
    expect(c.author).toMatchObject({ name: "Anu Mathew", meta: "@anucooks · 2 h · Followers", href: "/u/anucooks", initials: "AM" });
    expect(AUDIENCE_WORDS).toEqual({ followers: "Followers", public: "Public", me: "Just me" });
    expect(postCard(post({ audience: "public" }), NOW, new Set()).author.meta).toBe("@anucooks · 2 h · Public");
    expect(postCard(post({ author: null, mine: true, audience: "me" }), NOW, new Set()).author).toMatchObject({ name: "You", meta: "2 h · Just me", href: null });
    expect(shortAgo(new Date(NOW.getTime() - 30_000).toISOString(), NOW)).toBe("now");
    expect(shortAgo(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe("5 min");
    expect(shortAgo("2026-11-07T09:00:00", NOW)).toBe("yesterday");
  });

  it("shows the chosen stats as up to four tiles, and only those the post carries", () => {
    expect(statTiles(post().stats)).toEqual([
      { id: "size", value: "450 g", label: "size" },
      { id: "time", value: "48 min", label: "time" },
      { id: "ate", value: "3", label: "ate" },
      { id: "steps", value: "9/9", label: "steps" },
    ]);
    expect(statTiles({ size: { factorMilli: null, main: null, portionsHalf: 8 }, ate: 4 })).toEqual([
      { id: "size", value: "4", label: "portions" },
      { id: "ate", value: "4", label: "ate" },
    ]);
    expect(statTiles({})).toEqual([]);
    const out = renderToStaticMarkup(React.createElement(StatTiles, { tiles: statTiles({ minutes: 75 }) }));
    expect(out).toContain("1 h 15 min");
  });

  it("carries the recipe line, the RC tile colours and the caption", () => {
    const c = postCard(post(), NOW, new Set());
    expect(c.recipeLine).toBe("With the recipe · cooked at 450 g");
    expect(postCard(post(), NOW, new Set(["rcp_curry"])).recipeLine).toBe("Your recipe · cooked at 450 g");
    expect(postCard(post({ recipe: null, stats: {} }), NOW, new Set()).recipeLine).toBeNull();
    expect(c.tile.initial).toBe("C");
    expect(c.tile.bg).toMatch(/^#/);
    expect(postCard(post({ caption: "  " }), NOW, new Set()).caption).toBeNull();
    expect(c.yum).toEqual({ on: false, label: "Yum · 12", count: 12 });
  });

  it("Cook this: none without a recipe, opens your own, reads Saved ✓ for your copy, else copies", () => {
    const r = post().recipe;
    expect(cookThis(null, { ownIds: new Set(), copyId: null, saving: false })).toEqual({ kind: "none" });
    expect(cookThis(r, { ownIds: new Set(["rcp_curry"]), copyId: null, saving: false })).toEqual({ kind: "open", recipeId: "rcp_curry", label: "Cook this" });
    expect(cookThis(r, { ownIds: new Set(), copyId: "rcp_copy", saving: false })).toEqual({ kind: "saved", recipeId: "rcp_copy", label: "Saved ✓" });
    expect(cookThis(r, { ownIds: new Set(), copyId: null, saving: true })).toEqual({ kind: "saving", label: "Saved ✓" });
    expect(cookThis(r, { ownIds: new Set(), copyId: null, saving: false })).toEqual({ kind: "copy", label: "Cook this" });
  });

  it("draws the card: author link, hero link to the post, Yum pressed state, comments and Cook this", () => {
    const out = renderToStaticMarkup(
      React.createElement(PostCardView, { card: postCard(post({ yums: { count: 1, mine: true, names: [] } }), NOW, new Set()), meId: "usr_me", onYum: () => undefined, onMore: () => undefined, cookThis: React.createElement("span", null, "COOK") }),
    );
    expect(out).toContain('href="/u/anucooks"');
    expect(out).toContain('href="/p/pst_1"');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain("Yum · 1");
    expect(out).toContain("COOK");
    expect(out).toContain("Halved it for the three of us.");
  });
});

// ── Yum, comments, the post's page ────────────────────────────────

describe("Yum", () => {
  it("toggles the count and yours, and its label", () => {
    expect(yumToggled({ count: 12, mine: false, names: [] }, true)).toEqual({ count: 13, mine: true, names: [] });
    expect(yumToggled({ count: 1, mine: true, names: [] }, false)).toEqual({ count: 0, mine: false, names: [] });
    const same = { count: 3, mine: true, names: [] };
    expect(yumToggled(same, true)).toBe(same);
    expect(yumLabel({ count: 0 })).toBe("Yum");
    expect(yumLabel({ count: 12 })).toBe("Yum · 12");
  });

  it("patches every read that shows the post: the feed's pages, the post, a profile's posts", () => {
    const c = cache({
      [k(qk.kitchenFeed("following"))]: { pages: [{ tab: "following", posts: [post(), post({ id: "pst_2" })], nextCursor: null }], pageParams: [null] },
      [k(qk.kitchenPost("pst_1"))]: { post: post() },
      [k(qk.kitchenProfilePosts("anucooks"))]: { pages: [{ posts: [post()], nextCursor: null }], pageParams: [null] },
    });
    const otherBefore = (c.get(qk.kitchenFeed("following")) as { pages: { posts: CommunityPost[] }[] }).pages[0]!.posts[1];
    applyPatches(c, yumPatches("pst_1", true));
    const feed = c.get(qk.kitchenFeed("following")) as { pages: { posts: CommunityPost[] }[] };
    expect(feed.pages[0]!.posts[0]!.yums).toMatchObject({ count: 13, mine: true });
    expect(feed.pages[0]!.posts[1]).toBe(otherBefore);
    expect((c.get(qk.kitchenPost("pst_1")) as { post: CommunityPost }).post.yums.count).toBe(13);
    expect((c.get(qk.kitchenProfilePosts("anucooks")) as { pages: { posts: CommunityPost[] }[] }).pages[0]!.posts[0]!.yums.mine).toBe(true);
  });

  it("names who said it, you first, without repeating you", () => {
    expect(yumNamesText({ count: 12, mine: false, names: ["Dev Rao", "Meera Iyer"] }, null)).toBe("Dev, Meera and 10 others");
    expect(yumNamesText({ count: 2, mine: true, names: ["Rahul", "Dev Rao"] }, "Rahul")).toBe("You and Dev");
    expect(yumNamesText({ count: 1, mine: true, names: [] }, "Rahul")).toBe("You");
    expect(yumNamesText({ count: 3, mine: false, names: [] }, null)).toBe("3 people");
    expect(yumNamesText({ count: 0, mine: false, names: [] }, null)).toBeNull();
  });
});

describe("a post's page", () => {
  it("compares the steps' time with yours, on someone else's post", () => {
    expect(stepCompareText(post({ stepCompare: { usualMinutes: 55, cooks: 3 } }))).toBe("Steps took Anu 48 min · yours usually 55 min");
    expect(stepCompareText(post())).toBeNull();
    expect(stepCompareText(post({ mine: true, stepCompare: { usualMinutes: 55, cooks: 3 } }))).toBeNull();
  });

  it("lets a comment's author or the post's author remove it, and anyone else report it", () => {
    const theirs = { mine: false, canRemove: false };
    const mine = { mine: true, canRemove: true };
    expect(commentRights(theirs, { mine: false })).toEqual({ remove: false, report: true });
    expect(commentRights(theirs, { mine: true })).toEqual({ remove: true, report: true });
    expect(commentRights(mine, { mine: false })).toEqual({ remove: true, report: false });
    expect(commentRights({ mine: false, canRemove: true }, { mine: false }).remove).toBe(true);
  });

  it("sends a trimmed comment, and says the hourly limit in words", () => {
    expect(commentBody("  Lovely  ", 500)).toBe("Lovely");
    expect(commentBody("   ", 500)).toBeNull();
    expect(commentBody("x".repeat(501), 500)).toBeNull();
    expect(commentRefusalText({ reason: "comment_limit", message: "x" })).toBe("That's 30 comments this hour. Try again later.");
    expect(commentRefusalText({ reason: "no_profile", message: "x" })).toBe("Pick a handle to comment");
    expect(commentRefusalText({ message: "Nope" })).toBe("Nope");
  });

  it("adds, saves and removes comments in the cache, and the count with them", () => {
    const c1: PostComment = { id: "cmt_1", postId: "pst_1", author: DEV, body: "Kadai?", createdAt: "", mine: false, canRemove: true };
    const pending: PostComment = { ...c1, id: "pending_cmt_x", author: ANU, body: "Yes", mine: true };
    const c = cache({
      [k(qk.kitchenPostComments("pst_1"))]: { pages: [{ comments: [c1], count: 1, nextCursor: null }], pageParams: [null] },
      [k(qk.kitchenPost("pst_1"))]: { post: post({ comments: { count: 1 } }) },
    });
    applyPatches(c, commentAddedPatches("pst_1", pending, true));
    let pages = c.get(qk.kitchenPostComments("pst_1")) as { pages: { comments: PostComment[]; count: number; nextCursor: string | null }[]; pageParams: unknown[] };
    expect(commentsOf(pages).map((x) => x.id)).toEqual(["cmt_1", "pending_cmt_x"]);
    expect(pages.pages[0]!.count).toBe(2);
    expect((c.get(qk.kitchenPost("pst_1")) as { post: CommunityPost }).post.comments.count).toBe(2);
    applyPatches(c, commentSavedPatches("pst_1", "pending_cmt_x", { ...pending, id: "cmt_2" }));
    pages = c.get(qk.kitchenPostComments("pst_1")) as typeof pages;
    expect(commentsOf(pages).map((x) => x.id)).toEqual(["cmt_1", "cmt_2"]);
    applyPatches(c, commentRemovedPatches("pst_1", "cmt_1"));
    pages = c.get(qk.kitchenPostComments("pst_1")) as typeof pages;
    expect(commentsOf(pages).map((x) => x.id)).toEqual(["cmt_2"]);
    expect(pages.pages[0]!.count).toBe(1);
    expect((c.get(qk.kitchenPost("pst_1")) as { post: CommunityPost }).post.comments.count).toBe(1);
  });

  it("puts a new post first in Following and on your profile, and takes a deleted or blocked one out", () => {
    const feed = () => ({ pages: [{ tab: "following", posts: [post({ id: "pst_old", author: DEV })], nextCursor: null }], pageParams: [null] });
    const c = cache({ [k(qk.kitchenFeed("following"))]: feed(), [k(qk.kitchenFeed("discover"))]: feed(), [k(qk.kitchenProfilePosts("me_cooks"))]: { pages: [{ posts: [], nextCursor: null }], pageParams: [null] } });
    applyPatches(c, postAddedPatches(post({ id: "pst_new", mine: true }), "me_cooks"));
    const ids = (key: readonly unknown[]) => (c.get(key) as { pages: { posts: CommunityPost[] }[] }).pages[0]!.posts.map((p) => p.id);
    expect(ids(qk.kitchenFeed("following"))).toEqual(["pst_new", "pst_old"]);
    expect(ids(qk.kitchenFeed("discover"))).toEqual(["pst_old"]);
    expect(ids(qk.kitchenProfilePosts("me_cooks"))).toEqual(["pst_new"]);
    applyPatches(c, postRemovedPatches("pst_new"));
    expect(ids(qk.kitchenFeed("following"))).toEqual(["pst_old"]);
    applyPatches(c, authorHiddenPatches("usr_dev", "mute"));
    expect(ids(qk.kitchenFeed("following"))).toEqual([]);
    expect(ids(qk.kitchenFeed("discover"))).toEqual(["pst_old"]);
    applyPatches(c, authorHiddenPatches("usr_dev", "block"));
    expect(ids(qk.kitchenFeed("discover"))).toEqual([]);
  });

  it("⋯: report, mute and block on someone else's post; who sees it and delete on yours", () => {
    expect(postMenuItems(post())).toEqual(["report", "mute", "block"]);
    expect(postMenuItems(post({ mine: true }))).toEqual(["audience", "delete"]);
  });
});

// ── Share this cook? ──────────────────────────────────────────────

describe("Share this cook?", () => {
  it("is offered for your own postable dish in the new frame only; Finish lands on it", () => {
    expect(dishPostable(dish())).toBe(true);
    expect(dishPostable(dish({ orgId: "org_1", state: "open" }))).toBe(false);
    expect(dishPostable(dish({ state: "canceled" }))).toBe(false);
    expect(dishPostable(dish({ orgId: null, state: "open" }))).toBe(true);
    expect(offersShare(true, dish(), "usr_me")).toBe(true);
    expect(offersShare(true, dish(), "usr_other")).toBe(false);
    expect(offersShare(false, dish(), "usr_me")).toBe(false);
    expect(afterFinishHref(dish(), true)).toBe("/dishes/dsh_1?share=1");
    expect(afterFinishHref(dish({ orgId: "org_1", state: "open" }), true)).toBe("/dishes/dsh_1");
    expect(afterFinishHref(dish(), false)).toBe("/dishes/dsh_1");
  });

  it("opens with size and how many ate on, time when there is one, steps off, and Followers", () => {
    const p = previewOf(dish(), { main: { qtyMilli: 450_000, unit: "g" }, ownRecipe: true, steps: { minutes: 48, steps: { done: 9, total: 9 } } });
    expect(shareDefaults(p, true)).toEqual({ caption: "", show: { size: true, time: true, ate: true, steps: false }, audience: "followers" });
    expect(shareDefaults({ ...p, steps: { minutes: null, steps: null } }, true).show.time).toBe(false);
    expect(shareDefaults(p, false).audience).toBe("me");
    expect(composerRecipeLine(p)).toBe("Your recipe · cooked at 450 g");
    expect(composerRecipeLine(previewOf(dish({ recipeId: null }), { main: null, ownRecipe: false, steps: { minutes: null, steps: null } }))).toBe("3 portions");
    expect(showRows(p).map((r) => [r.label, r.value])).toEqual([
      ["Size", "450 g"],
      ["Time", "48 min"],
      ["How many ate", "1"],
      ["Steps done", "9 of 9"],
    ]);
    expect(showRows({ ...p, steps: { minutes: null, steps: null } })[1]).toMatchObject({ value: null, unknown: true });
    expect(shareTopLine(dish({ orgId: "org_1", shares: [{}, {}, {}, {}] as KitchenDish["shares"] }), "Flat 4B")).toBe("✓ Posted to Flat 4B · 4 ate");
    expect(shareTopLine(dish(), null)).toBe("✓ Cooked · just you");
  });

  it("offers Followers, Public and Just me; a private profile's Public reaches followers only; no profile, only Just me", () => {
    expect(audienceOptions(myProfile(), 12)).toEqual({
      options: [
        { id: "followers", label: "Followers", sub: "12 people" },
        { id: "public", label: "Public", sub: "anyone" },
        { id: "me", label: "Just me", sub: "your profile" },
      ],
      needsHandle: false,
    });
    expect(audienceOptions(myProfile({ privacy: "private" }), 1).options[1]).toEqual({ id: "public", label: "Public", sub: "Followers only — your profile is private" });
    expect(audienceOptions(myProfile({ privacy: "private" }), 1).options[0]!.sub).toBe("1 person");
    expect(audienceOptions(null, null)).toEqual({ options: [{ id: "me", label: "Just me", sub: "your profile" }], needsHandle: true });
  });

  it("sends the dish, the caption, the audience and only the show flags", () => {
    const body = createPostRequest("dsh_1", { caption: "  Good one  ", show: { size: true, time: false, ate: true, steps: false }, audience: "public" });
    expect(body).toEqual({ dishId: "dsh_1", caption: "Good one", audience: "public", show: { size: true, time: false, ate: true, steps: false } });
    expect(Object.keys(body.show!).sort()).toEqual(["ate", "size", "steps", "time"]);
    expect(Object.values(body.show!).every((v) => typeof v === "boolean")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/minutes|qtyMilli|portions|price|org_/);
    expect(createPostRequest("dsh_1", { caption: "   ", show: { size: false, time: false, ate: false, steps: false }, audience: "me" })).toEqual({
      dishId: "dsh_1",
      audience: "me",
      show: { size: false, time: false, ate: false, steps: false },
    });
  });

  it("says who sees it after Post, and opens a post that's there already", () => {
    expect(postButtonLabel("me")).toBe("Save to profile");
    expect(postButtonLabel("followers")).toBe("Post");
    expect(postedToast("followers", 12, false)).toEqual({ title: "Posted", description: "your 12 followers see it" });
    expect(postedToast("public", 12, false)).toEqual({ title: "Posted", description: "Anyone can see it" });
    expect(postedToast("public", 12, true)).toEqual({ title: "Posted", description: "your 12 followers see it" });
    expect(postedToast("me", 12, false)).toEqual({ title: "On your profile", description: "Only you see it" });
    expect(postRefusal({ reason: "already_posted", message: "x", details: { postId: "pst_9" } })).toEqual({ kind: "open", postId: "pst_9" });
    expect(postRefusal({ reason: "not_postable", message: "x" })).toEqual({ kind: "say", text: "Finalize it first: everyone's portion needs to be set" });
    expect(postRefusal({ message: "Nope" })).toEqual({ kind: "say", text: "Nope" });
  });

  it("takes the step times from the session's guide, and keeps them for the dish page", () => {
    const guide = {
      mode: "guided",
      steps: [
        { key: "a", phase: "prep" },
        { key: "b", phase: "cook" },
        { key: "c", phase: "cook" },
      ],
      times: { b: { startedAt: "2026-11-08T10:00:00Z", doneAt: "2026-11-08T10:30:00Z" }, c: { startedAt: "2026-11-08T10:30:00Z", doneAt: "2026-11-08T10:48:00Z" } },
    } as unknown as CookGuide;
    expect(stepSeedOf(guide)).toEqual({ minutes: 48, steps: { done: 2, total: 2 } });
    expect(stepSeedOf({ ...guide, mode: "tick" } as CookGuide)).toEqual({ minutes: null, steps: null });
    expect(stepSeedOf(undefined)).toEqual({ minutes: null, steps: null });
    expect(parseStepSeed(JSON.stringify({ minutes: 48, steps: { done: 2, total: 2 } }))).toEqual({ minutes: 48, steps: { done: 2, total: 2 } });
    expect(parseStepSeed("nope")).toEqual({ minutes: null, steps: null });
    const shared = withSharedPost(parseSharedPosts(null), "dsh_1", "pst_1");
    expect(parseSharedPosts(JSON.stringify(shared))).toEqual({ dsh_1: "pst_1" });
    expect(withSharedPost(shared, "dsh_1", null)).toEqual({});
  });
});

// ── Reports and Activity ──────────────────────────────────────────

describe("reports", () => {
  it("offer the four reasons and send the target, the reason and a trimmed note", () => {
    expect(REPORT_REASON_ROWS.map((r) => r.id)).toEqual(["spam", "abuse", "unsafe", "other"]);
    expect(reportTitle("post")).toBe("Report this post");
    expect(reportTitle("comment")).toBe("Report this comment");
    expect(reportTitle("profile", "kabirbakes")).toBe("Report @kabirbakes");
    expect(reportRequest("comment", "cmt_1", "abuse", "  rude  ")).toEqual({ targetKind: "comment", targetId: "cmt_1", reason: "abuse", note: "rude" });
    expect(reportRequest("profile", "usr_x", "spam", " ")).toEqual({ targetKind: "profile", targetId: "usr_x", reason: "spam" });
  });
});

function item(over: Partial<ActivityItem>): ActivityItem {
  const actor = { userId: "usr_dev", handle: "devmakesdal", name: "Dev Rao" };
  return { id: "act_1", kind: "followed", at: NOW.toISOString(), unread: true, actor, actors: [actor], others: 0, post: null, comment: null, recipe: null, ...over };
}

describe("Activity", () => {
  it("says each kind in words and opens its post, person or recipe", () => {
    const meera = { userId: "usr_m", handle: "meera", name: "Meera Iyer" };
    const yum = item({ id: "yum_1", kind: "yum", actor: meera, actors: [meera], others: 11, post: { id: "pst_1", title: "Chicken curry" } });
    expect(activityLine(yum, NOW)).toMatchObject({ who: "Meera and 11 others", what: "said Yum to your Chicken curry", href: "/p/pst_1", icon: "yum" });
    expect(activityLine(item({ kind: "cooked_yours", post: { id: "pst_2", title: "Curry" }, recipe: { id: "rcp_1", name: "Chicken curry" } }), NOW)).toMatchObject({ who: "Dev", what: "cooked your Chicken curry", href: "/p/pst_2" });
    expect(activityLine(item({ kind: "comment", post: { id: "pst_1", title: "C" }, comment: { id: "cmt_1", body: "Roast the spices first next time, it really makes the difference" } }), NOW).what).toBe(
      "commented: “Roast the spices first next time, it re…”",
    );
    expect(activityLine(item({}), NOW)).toMatchObject({ what: "started following you", href: "/u/devmakesdal" });
    expect(activityLine(item({ kind: "follow_accepted" }), NOW).what).toBe("accepted your follow request");
    expect(activityLine(item({ kind: "saved_yours", recipe: { id: "rcp_chai", name: "Masala chai" } }), NOW)).toMatchObject({ what: "saved your Masala chai", href: "/recipes/rcp_chai" });
    const two = item({ actors: [meera, { userId: "usr_dev", handle: "dev", name: "Dev Rao" }] });
    expect(activityWho(two)).toBe("Meera and Dev");
  });

  it("groups by day: Today, This week, Earlier", () => {
    const groups = activityGroups(
      [item({ id: "a", at: "2026-11-08T09:00:00" }), item({ id: "b", at: "2026-11-05T09:00:00" }), item({ id: "c", at: "2026-10-20T09:00:00" }), item({ id: "d", at: "2026-11-02T09:00:00" })],
      NOW,
    );
    expect(groups.map((g) => [g.title, g.lines.map((l) => l.id)])).toEqual([
      ["Today", ["a"]],
      ["This week", ["b", "d"]],
      ["Earlier", ["c"]],
    ]);
    expect(activityGroups([], NOW)).toEqual([]);
    expect(markReadBefore([item({ at: "2026-11-08T13:00:00Z" })], new Date("2026-11-08T12:00:00Z"))).toBe("2026-11-08T13:00:00.000Z");
    expect(markReadBefore([], new Date("2026-11-08T12:00:00Z"))).toBe("2026-11-08T12:00:00.000Z");
    expect(moreRequestsText(5, 3)).toBe("and 2 more");
    expect(moreRequestsText(3, 3)).toBeNull();
  });

  it("puts the unread count on the bell", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(null)).toBeNull();
    expect(unreadBadge(3)).toBe("3");
    expect(unreadBadge(12)).toBe("9+");
    expect(bellLabel(3)).toBe("Activity, 3 new");
    expect(bellLabel(0)).toBe("Activity");
    const out = renderToStaticMarkup(React.createElement(CommunityHeader, { unread: 3 }));
    expect(out).toContain('aria-label="Activity, 3 new"');
    expect(out).toContain(">3</span>");
    expect(renderToStaticMarkup(React.createElement(CommunityHeader))).toContain('aria-label="Activity"');
  });
});

// ── Notifications, and today's frame ──────────────────────────────

describe("with newFrame false nothing changes", () => {
  it("lists today's three push kinds, and Community's five only in the new frame", () => {
    expect(pushRows(false).map((r) => r.kind)).toEqual(["kitchen.portion_set", "kitchen.dish_posted", "kitchen.paid_you"]);
    expect(pushRows(true).slice(3).map((r) => r.title)).toEqual(["New followers", "Follow requests", "Comments", "Yums", "Cooked your recipe"]);
  });

  it("finishes to the dish as before, and offers no Share", () => {
    expect(afterFinishHref(dish(), false)).toBe("/dishes/dsh_1");
    expect(offersShare(false, dish(), "usr_me")).toBe(false);
  });
});
