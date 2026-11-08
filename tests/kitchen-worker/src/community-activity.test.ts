// Activity and the social pushes (Cookpool CM-3, cookpool-community design
// §2): each Activity row is written in the same batch as its event —
// followed, follow_request and follow_accepted with CM-2's follows, yum and
// comment on your post, cooked_yours when a post links your recipe (or the
// recipe a copy came from), saved_yours when someone copies your public
// recipe — never for yourself or across a block. The read gives the waiting
// requests and the items, a post's Yums as one; unread counts and read marks.
// Five kinds push through notifications-worker's preference path (the
// enqueue), named by profile, and a post's Yum pushes at most once an hour.

import type { ActivityResponse, CommunityPost, UnreadActivityResponse } from "@saas/contracts/kitchen";
import {
  ANU,
  DEV,
  IDENTITY,
  KABIR,
  MEERA,
  SAM,
  communityWorld,
  cook,
  cookAndPost,
  copy,
  del,
  follow,
  guidedCurry,
  makeProfile,
  me,
  post,
  posted,
  publish,
  writeRecipe,
  type CommunityWorld,
} from "./posts-helpers.js";

let w: CommunityWorld;
beforeEach(async () => {
  w = communityWorld();
  await makeProfile(w, MEERA, "meeracooks", "Meera K");
  await makeProfile(w, ANU, "anu", "Anu R", { privacy: "private" });
  await makeProfile(w, KABIR, "kabir", "Kabir S");
  await makeProfile(w, DEV, "devcooks", "Dev P");
});
afterEach(() => w.h.close());

const HOUR = 60 * 60 * 1000;
const activity = async (as: string) => (await w.call<ActivityResponse>("GET", me("activity"), as)).body.data;
const kinds = async (as: string) => (await activity(as)).items.map((i) => [i.kind, i.actor.handle]);
const unread = async (as: string) => (await w.call<UnreadActivityResponse>("GET", me("activity/unread"), as)).body.data.count;
const rows = () => w.h.db.prepare("SELECT user_id, kind, actor_id FROM kitchen_activity ORDER BY created_at").all();
/** The social pushes asked for, as [kind, to, body data]. */
const pushes = () =>
  w.h.notifications
    .filter((n) => n.request.templateKey.startsWith("kitchen.") && ["kitchen.followed", "kitchen.follow_request", "kitchen.commented", "kitchen.yum", "kitchen.cooked_yours"].includes(n.request.templateKey))
    .map((n) => [n.request.templateKey, n.request.recipient.subjectId, n.request.templateData]);

describe("follows", () => {
  it("writes followed for a public profile, follow_request for a private one, and follow_accepted when it is accepted", async () => {
    await follow(w, KABIR, "meeracooks");
    await follow(w, KABIR, "anu");
    expect(await kinds(MEERA)).toEqual([["followed", "kabir"]]);
    // A request isn't an item: it is in `requests` until answered.
    const anu = await activity(ANU);
    expect(anu.items).toEqual([]);
    expect(anu.requests).toEqual({ count: 1, people: [expect.objectContaining({ handle: "kabir", name: "Kabir S" })] });
    expect(await unread(ANU)).toBe(1);
    await post(w, ANU, me(`follow-requests/${KABIR}/accept`));
    expect((await activity(ANU)).requests).toEqual({ count: 0, people: [] });
    expect(await unread(ANU)).toBe(0);
    expect(await kinds(KABIR)).toEqual([["follow_accepted", "anu"]]);
    // A repeat follow writes nothing more.
    await follow(w, KABIR, "meeracooks");
    expect(rows()).toHaveLength(3);
  });

  it("pushes kitchen.followed and kitchen.follow_request to the followee, named by profile", async () => {
    await follow(w, KABIR, "meeracooks");
    await follow(w, KABIR, "anu");
    await post(w, ANU, me(`follow-requests/${KABIR}/accept`));
    expect(pushes()).toEqual([
      ["kitchen.followed", MEERA, expect.objectContaining({ actorName: "Kabir S" })],
      ["kitchen.follow_request", ANU, expect.objectContaining({ actorName: "Kabir S" })],
    ]);
    const sent = w.h.notifications.find((n) => n.request.templateKey === "kitchen.followed")!;
    expect(sent.internalActor).toBe("kitchen-worker");
    expect(sent.request).toMatchObject({
      orgId: "00000000-0000-0000-0000-000000000000",
      category: "product",
      recipient: { channel: "email", subjectKind: "user", subjectId: MEERA, address: IDENTITY[MEERA]!.email },
    });
    expect(JSON.stringify(sent.request.templateData)).not.toContain(IDENTITY[KABIR]!.displayName);
  });
});

describe("Yums", () => {
  let p: CommunityPost;
  beforeEach(async () => {
    p = await cookAndPost(w, MEERA, "public");
  });

  it("group on one post: the latest three named, the rest counted, and a Yum taken back goes", async () => {
    await makeProfile(w, SAM, "sam", "Sam T");
    for (const who of [KABIR, DEV, SAM, ANU]) await post(w, who, `/v1/kitchen/posts/${p.id}/yum`);
    const items = (await activity(MEERA)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: `yum_${p.id.slice(4)}`,
      kind: "yum",
      unread: true,
      actor: { handle: "anu" },
      others: 1,
      post: { id: p.id, title: "Chicken curry" },
    });
    expect(items[0]!.actors.map((a) => a.handle)).toEqual(["anu", "sam", "devcooks"]);
    expect(await unread(MEERA)).toBe(1);
    await del(w, ANU, `/v1/kitchen/posts/${p.id}/yum`);
    expect((await activity(MEERA)).items[0]!.actors.map((a) => a.handle)).toEqual(["sam", "devcooks", "kabir"]);
    expect((await activity(MEERA)).items[0]!.others).toBe(0);
  });

  it("writes nothing for your own Yum, and pushes at most once an hour per post", async () => {
    await post(w, MEERA, `/v1/kitchen/posts/${p.id}/yum`);
    expect(rows()).toEqual([]);
    await post(w, KABIR, `/v1/kitchen/posts/${p.id}/yum`);
    await post(w, DEV, `/v1/kitchen/posts/${p.id}/yum`);
    // Taking it back and saying it again inside the hour doesn't push either.
    await del(w, KABIR, `/v1/kitchen/posts/${p.id}/yum`);
    await post(w, KABIR, `/v1/kitchen/posts/${p.id}/yum`);
    expect(pushes()).toEqual([["kitchen.yum", MEERA, expect.objectContaining({ actorName: "Kabir S", postTitle: "Chicken curry" })]]);
    w.tick(HOUR);
    await makeProfile(w, SAM, "sam", "Sam T");
    await post(w, SAM, `/v1/kitchen/posts/${p.id}/yum`);
    expect(pushes().map((x) => [x[0], (x[2] as Record<string, unknown>).actorName])).toEqual([["kitchen.yum", "Kabir S"], ["kitchen.yum", "Sam T"]]);
    // Another post has its own hour.
    const q = await cookAndPost(w, MEERA, "public");
    await post(w, DEV, `/v1/kitchen/posts/${q.id}/yum`);
    expect(pushes()).toHaveLength(3);
  });

  it("a push that fails never fails the Yum", async () => {
    w.h.failNotifications = true;
    expect((await post(w, KABIR, `/v1/kitchen/posts/${p.id}/yum`)).status).toBe(201);
    expect(await kinds(MEERA)).toEqual([["yum", "kabir"]]);
  });
});

describe("comments", () => {
  it("writes comment for the post's author with the comment, pushes it, and takes the item away with the comment", async () => {
    const p = await cookAndPost(w, MEERA, "public");
    const made = await post(w, KABIR, `/v1/kitchen/posts/${p.id}/comments`, { body: "Roast the spices first, then add the onions" });
    const commentId = (made.body.data as { comment: { id: string } }).comment.id;
    const items = (await activity(MEERA)).items;
    expect(items).toEqual([
      expect.objectContaining({ kind: "comment", actor: expect.objectContaining({ handle: "kabir" }), comment: { id: commentId, body: "Roast the spices first, then add the onions" }, post: { id: p.id, title: "Chicken curry" } }),
    ]);
    expect(pushes()).toEqual([["kitchen.commented", MEERA, expect.objectContaining({ actorName: "Kabir S", excerpt: "Roast the spices first, then add the onions" })]]);
    // Her own comment writes nothing.
    await post(w, MEERA, `/v1/kitchen/posts/${p.id}/comments`, { body: "Thanks!" });
    expect(rows()).toHaveLength(1);
    await del(w, MEERA, `/v1/kitchen/comments/${commentId}`);
    expect((await activity(MEERA)).items).toEqual([]);
  });
});

describe("cooked_yours and saved_yours", () => {
  it("copying a public recipe tells its owner (saved_yours); cooking the copy and posting it does too (cooked_yours), with the push", async () => {
    const r = await writeRecipe(w, MEERA, guidedCurry);
    await publish(w, MEERA, r.id);
    const mine = await copy(w, DEV, r.id);
    const dishId = await cook(w, DEV, { recipeId: mine.id, factorMilli: 1000 });
    await posted(w, DEV, dishId, "followers", { show: { size: true } });
    const items = (await activity(MEERA)).items;
    expect(items.map((i) => [i.kind, i.actor.handle, i.recipe])).toEqual([
      ["cooked_yours", "devcooks", { id: r.id, name: "Chicken curry" }],
      ["saved_yours", "devcooks", { id: r.id, name: "Chicken curry" }],
    ]);
    // Meera doesn't follow Dev: she hears of the cook but can't open his followers post.
    expect(items[0]!.post).toBeNull();
    expect(pushes()).toEqual([["kitchen.cooked_yours", MEERA, expect.objectContaining({ actorName: "Dev P", recipeName: "Chicken curry", size: "1 kg" })]]);
  });

  it("cooking someone's public recipe directly is cooked_yours too; Cookpool's own and your own are not", async () => {
    const r = await writeRecipe(w, MEERA, guidedCurry);
    await publish(w, MEERA, r.id);
    await posted(w, KABIR, await cook(w, KABIR, { recipeId: r.id }), "public");
    await posted(w, MEERA, await cook(w, MEERA, { recipeId: r.id }), "public");
    expect(await kinds(MEERA)).toEqual([["cooked_yours", "kabir"]]);
    expect(rows()).toHaveLength(1);
  });

  it("isn't written for a Just me post — until it is shared wider, once", async () => {
    const r = await writeRecipe(w, MEERA, guidedCurry);
    await publish(w, MEERA, r.id);
    const p = await posted(w, KABIR, await cook(w, KABIR, { recipeId: r.id }), "me");
    expect(rows()).toEqual([]);
    w.tick();
    await w.call("PATCH", me(`posts/${p.id}`), KABIR, { audience: "followers" });
    w.tick();
    await w.call("PATCH", me(`posts/${p.id}`), KABIR, { audience: "public" });
    expect(await kinds(MEERA)).toEqual([["cooked_yours", "kabir"]]);
    expect(pushes()).toHaveLength(1);
  });

  it("copies of a link-only recipe, or by someone with no profile, write no saved_yours", async () => {
    const r = await writeRecipe(w, MEERA, { ...guidedCurry, visibility: "link" });
    w.tick();
    expect((await w.call("POST", me("recipes/copies"), KABIR, { linkCode: r.linkCode })).status).toBe(201);
    await publish(w, MEERA, r.id);
    await copy(w, SAM, r.id);
    expect(rows()).toEqual([]);
  });

  it("nothing is written or pushed across a block, and earlier rows from them are hidden", async () => {
    const r = await writeRecipe(w, MEERA, guidedCurry);
    await publish(w, MEERA, r.id);
    const p = await cookAndPost(w, MEERA, "public");
    await post(w, KABIR, `/v1/kitchen/posts/${p.id}/yum`);
    const dishId = await cook(w, DEV, { recipeId: r.id });
    // Meera blocks both: Kabir's Yum leaves her Activity; Dev's post of her recipe tells her nothing.
    await post(w, MEERA, me(`blocks/${KABIR}`));
    await post(w, MEERA, me(`blocks/${DEV}`));
    await posted(w, DEV, dishId, "public");
    expect((await activity(MEERA)).items).toEqual([]);
    expect(await unread(MEERA)).toBe(0);
    expect(pushes().map((x) => x[0])).toEqual(["kitchen.yum"]);
    expect(w.h.db.prepare("SELECT kind FROM kitchen_activity WHERE kind = 'cooked_yours'").all()).toEqual([]);
  });
});

describe("unread and read", () => {
  it("counts unread items (a post's Yums once), and marks read everything up to `before`", async () => {
    const p = await cookAndPost(w, MEERA, "public");
    await follow(w, KABIR, "meeracooks");
    await post(w, KABIR, `/v1/kitchen/posts/${p.id}/yum`);
    await post(w, DEV, `/v1/kitchen/posts/${p.id}/yum`);
    expect(await unread(MEERA)).toBe(2);
    const read = await post(w, MEERA, me("activity/read"), { before: w.now().toISOString() });
    expect(read.body.data).toEqual({ marked: 3 });
    expect(await unread(MEERA)).toBe(0);
    expect((await activity(MEERA)).items.every((i) => !i.unread)).toBe(true);
    await post(w, ANU, `/v1/kitchen/posts/${p.id}/yum`);
    expect(await unread(MEERA)).toBe(1);
    expect((await activity(MEERA)).items[0]).toMatchObject({ kind: "yum", unread: true });
    expect((await post(w, MEERA, me("activity/read"), { before: "yesterday" })).status).toBe(422);
    // Someone else's read marks nothing of hers.
    await post(w, KABIR, me("activity/read"), { before: w.now().toISOString() });
    expect(await unread(MEERA)).toBe(1);
  });

  it("pages newest first with a cursor", async () => {
    await makeProfile(w, SAM, "sam", "Sam T");
    for (let i = 0; i < 31; i += 1) {
      const q = await cookAndPost(w, MEERA, "public");
      await post(w, i % 2 ? KABIR : SAM, `/v1/kitchen/posts/${q.id}/comments`, { body: `c${i}` });
    }
    const first = await w.call<ActivityResponse>("GET", me("activity"), MEERA);
    expect(first.body.data.items.map((i) => i.comment?.body)).toEqual(Array.from({ length: 30 }, (_, i) => `c${30 - i}`));
    const next = await w.call<ActivityResponse>("GET", me(`activity?cursor=${encodeURIComponent(first.body.data.nextCursor!)}`), MEERA);
    expect(next.body.data.items.map((i) => i.comment?.body)).toEqual(["c0"]);
    expect(next.body.data.nextCursor).toBeNull();
  });
});

describe("suggestions and counts (CM-2's seams)", () => {
  it("suggests people who cooked your recipe, and counts posts on a profile", async () => {
    await makeProfile(w, SAM, "sam", "Sam T");
    const r = await writeRecipe(w, MEERA, guidedCurry);
    await publish(w, MEERA, r.id);
    await posted(w, SAM, await cook(w, SAM, { recipeId: r.id }), "public");
    const suggestions = await w.call<{ fromRecipes: Array<{ handle: string; why: string }> }>("GET", me("people/suggestions"), MEERA);
    expect(suggestions.body.data.fromRecipes).toEqual([expect.objectContaining({ handle: "sam", why: "Cooked your Chicken curry" })]);
    const profile = await w.call<{ counts: { posts: number } }>("GET", "/v1/kitchen/profiles/sam", MEERA);
    expect(profile.body.data.counts.posts).toBe(1);
  });
});
