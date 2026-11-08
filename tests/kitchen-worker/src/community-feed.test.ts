// Who sees a post, and the feeds (Cookpool CM-3, cookpool-community design
// §2): Just me is the author's; followers is the author and accepted
// followers; public is anyone signed in — but a private author's posts reach
// followers only; a block either way hides a post everywhere (the post, both
// feeds, a profile's posts, comments, Yum); a mute only takes it out of
// Following. Following is newest first from people you follow plus your own;
// Discover is public posts by public profiles you don't follow from the last
// 14 days, with a Yum boost of 2 h per log2(yums + 1) up to 24 h, and without
// a post or a profile three people reported.

import { discoverBoostMs, type CommunityPost } from "@saas/contracts/kitchen";
import {
  ANU,
  DAY,
  DEV,
  KABIR,
  MEERA,
  SAM,
  communityWorld,
  cookAndPost,
  del,
  feedIds,
  follow,
  makeProfile,
  me,
  post,
  readPost,
  uuidOf,
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
const status = async (as: string, p: CommunityPost) => (await readPost(w, as, p.id)).status;

describe("who sees a post", () => {
  it("Just me: only its author", async () => {
    await follow(w, KABIR, "meeracooks");
    const p = await cookAndPost(w, MEERA, "me");
    expect(await status(MEERA, p)).toBe(200);
    expect(await status(KABIR, p)).toBe(404);
    expect(await status(SAM, p)).toBe(404);
    expect((await feedIds(w, KABIR, "following")).ids).toEqual([]);
    expect((await feedIds(w, MEERA, "following")).ids).toEqual([p.id]);
  });

  it("followers: the author and accepted followers — not a stranger, and not a request still waiting", async () => {
    await follow(w, KABIR, "meeracooks");
    const p = await cookAndPost(w, MEERA, "followers");
    expect(await status(KABIR, p)).toBe(200);
    expect(await status(DEV, p)).toBe(404);
    expect(await status(SAM, p)).toBe(404);
    // Anu is private: Meera's request waits, and Anu's followers post stays hers until it's accepted.
    const anus = await cookAndPost(w, ANU, "followers");
    await follow(w, MEERA, "anu");
    expect(await status(MEERA, anus)).toBe(404);
    expect((await post(w, ANU, me(`follow-requests/${MEERA}/accept`))).status).toBe(200);
    expect(await status(MEERA, anus)).toBe(200);
  });

  it("public by a public profile: anyone signed in, with or without a profile", async () => {
    const p = await cookAndPost(w, MEERA, "public");
    for (const who of [KABIR, DEV, SAM, ANU]) expect(await status(who, p)).toBe(200);
  });

  it("a private author's public post reaches accepted followers only", async () => {
    const p = await cookAndPost(w, ANU, "public");
    expect(await status(KABIR, p)).toBe(404);
    expect(await status(SAM, p)).toBe(404);
    expect((await feedIds(w, KABIR, "discover")).ids).toEqual([]);
    await follow(w, KABIR, "anu");
    await post(w, ANU, me(`follow-requests/${KABIR}/accept`));
    expect(await status(KABIR, p)).toBe(200);
    expect((await feedIds(w, KABIR, "following")).ids).toEqual([p.id]);
  });

  it("a block either way hides it everywhere: the post, both feeds, the profile, comments and Yum", async () => {
    await follow(w, KABIR, "meeracooks");
    const p = await cookAndPost(w, MEERA, "public");
    const reads = async (as: string) => ({
      post: await status(as, p),
      following: (await feedIds(w, as, "following")).ids,
      discover: (await feedIds(w, as, "discover")).ids,
      profile: (await w.call("GET", "/v1/kitchen/profiles/meeracooks/posts", as)).status,
      comments: (await w.call("GET", `/v1/kitchen/posts/${p.id}/comments`, as)).status,
      comment: (await post(w, as, `/v1/kitchen/posts/${p.id}/comments`, { body: "Looks good" })).status,
      yum: (await post(w, as, `/v1/kitchen/posts/${p.id}/yum`)).status,
    });
    const hidden = { post: 404, following: [], discover: [], profile: 404, comments: 404, comment: 404, yum: 404 };

    // Meera blocks Kabir: hidden from him (the follow ended with the block).
    expect((await post(w, MEERA, me(`blocks/${KABIR}`))).status).toBe(201);
    expect(await reads(KABIR)).toEqual(hidden);
    // Dev blocks Meera: her post is hidden from him too.
    expect((await reads(DEV)).post).toBe(200);
    expect((await post(w, DEV, me(`blocks/${MEERA}`))).status).toBe(201);
    expect(await reads(DEV)).toEqual(hidden);
    // Lifting it shows it again.
    await del(w, DEV, me(`blocks/${MEERA}`));
    expect((await reads(DEV)).post).toBe(200);
  });

  it("a mute only takes their posts out of your Following feed", async () => {
    await follow(w, KABIR, "meeracooks");
    const p = await cookAndPost(w, MEERA, "followers");
    await post(w, KABIR, me(`mutes/${MEERA}`));
    expect((await feedIds(w, KABIR, "following")).ids).toEqual([]);
    expect(await status(KABIR, p)).toBe(200);
    expect((await w.call<{ posts: CommunityPost[] }>("GET", "/v1/kitchen/profiles/meeracooks/posts", KABIR)).body.data.posts.map((x) => x.id)).toEqual([p.id]);
    await del(w, KABIR, me(`mutes/${MEERA}`));
    expect((await feedIds(w, KABIR, "following")).ids).toEqual([p.id]);
  });
});

describe("a profile's posts and counts", () => {
  it("follows canSee: a private profile's posts are 403 private to anyone but accepted followers; counts leave out Just me", async () => {
    const a = await cookAndPost(w, ANU, "followers");
    await cookAndPost(w, ANU, "me");
    const res = await w.call("GET", "/v1/kitchen/profiles/anu/posts", KABIR);
    expect(res.status).toBe(403);
    expect(res.body.error.details).toEqual({ reason: "private" });
    await follow(w, KABIR, "anu");
    await post(w, ANU, me(`follow-requests/${KABIR}/accept`));
    const seen = await w.call<{ posts: CommunityPost[] }>("GET", "/v1/kitchen/profiles/anu/posts", KABIR);
    expect(seen.body.data.posts.map((p) => p.id)).toEqual([a.id]);
    const counts = async (as: string) => (await w.call<{ counts: { posts: number } }>("GET", "/v1/kitchen/profiles/anu", as)).body.data.counts.posts;
    expect(await counts(KABIR)).toBe(1);
    expect(await counts(ANU)).toBe(2);
  });
});

describe("the Following feed", () => {
  it("is newest first: your own posts and those of people you follow, 20 a page", async () => {
    await follow(w, KABIR, "meeracooks");
    await follow(w, KABIR, "devcooks");
    const made: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      made.push((await cookAndPost(w, i % 3 === 0 ? KABIR : i % 3 === 1 ? MEERA : DEV, i % 2 === 0 ? "public" : "followers")).id);
    }
    // Someone he doesn't follow, and a Just me post of Meera's, aren't there.
    await cookAndPost(w, SAM, "me");
    await makeProfile(w, SAM, "sam", "Sam T");
    await cookAndPost(w, SAM, "public");
    await cookAndPost(w, MEERA, "me");
    for (let i = 0; i < 10; i += 1) made.push((await cookAndPost(w, MEERA, "followers")).id);
    const first = await feedIds(w, KABIR, "following");
    const newest = [...made].reverse();
    expect(first.ids).toEqual(newest.slice(0, 20));
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await feedIds(w, KABIR, "following", first.nextCursor!);
    expect(second.ids).toEqual(newest.slice(20));
    expect(second.nextCursor).toBeNull();
    expect((await w.call("GET", me("feed?tab=following&cursor=nope"), KABIR)).status).toBe(422);
    expect((await w.call("GET", me("feed?tab=everyone"), KABIR)).status).toBe(422);
  });
});

describe("the Discover feed", () => {
  it("is public posts by public profiles you don't follow, from the last 14 days, never your own", async () => {
    const old = await cookAndPost(w, DEV, "public");
    w.tick(15 * DAY);
    const recent = await cookAndPost(w, DEV, "public");
    await cookAndPost(w, DEV, "followers");
    const followed = await cookAndPost(w, MEERA, "public");
    await cookAndPost(w, ANU, "public"); // private profile
    await cookAndPost(w, KABIR, "public"); // his own
    await follow(w, KABIR, "meeracooks");
    const seen = await feedIds(w, KABIR, "discover");
    expect(seen.ids).toEqual([recent.id]);
    expect(seen.ids).not.toContain(old.id);
    expect(seen.ids).not.toContain(followed.id);
  });

  it("ranks by time plus 2 h per log2(yums + 1), up to 24 h", async () => {
    expect(discoverBoostMs(0)).toBe(0);
    expect(discoverBoostMs(1)).toBe(2 * HOUR);
    expect(discoverBoostMs(3)).toBe(4 * HOUR);
    expect(discoverBoostMs(4095)).toBe(24 * HOUR);
    expect(discoverBoostMs(100_000)).toBe(24 * HOUR);

    const yummed = await cookAndPost(w, DEV, "public");
    w.tick(3 * HOUR);
    const newer = await cookAndPost(w, DEV, "public");
    expect((await feedIds(w, KABIR, "discover")).ids).toEqual([newer.id, yummed.id]);
    // Three Yums: a 4 h boost on a post 3 h older — it now ranks first.
    const yum = w.h.db.prepare("INSERT INTO kitchen_post_yums (post_id, user_id, created_at) VALUES (?, ?, ?)");
    for (const who of ["usr_a", "usr_b", "usr_c"]) yum.run(uuidOf(yummed.id), who, w.now().toISOString());
    expect((await feedIds(w, KABIR, "discover")).ids).toEqual([yummed.id, newer.id]);

    // The boost stops at 24 h: with 10 003 Yums (26.6 h uncapped) it ranks below a post made 25 h after it.
    w.tick(22 * HOUR);
    const later = await cookAndPost(w, DEV, "public");
    const many = w.h.db.prepare("INSERT INTO kitchen_post_yums (post_id, user_id, created_at) VALUES (?, ?, ?)");
    for (let i = 0; i < 10_000; i += 1) many.run(uuidOf(yummed.id), `usr_y${i}`, w.now().toISOString());
    expect((await feedIds(w, KABIR, "discover")).ids).toEqual([later.id, yummed.id, newer.id]);
  });

  it("pages by rank: 20, then the rest, each post once", async () => {
    const made: string[] = [];
    for (let i = 0; i < 23; i += 1) made.push((await cookAndPost(w, i % 2 ? DEV : MEERA, "public")).id);
    const first = await feedIds(w, KABIR, "discover");
    expect(first.ids).toEqual([...made].reverse().slice(0, 20));
    const second = await feedIds(w, KABIR, "discover", first.nextCursor!);
    expect(second.ids).toEqual([...made].reverse().slice(20));
    expect(second.nextCursor).toBeNull();
  });

  it("reads past its first hundred candidates when an older post's boost could still rank it first", async () => {
    // 150 public posts of Dev's, a minute apart; the oldest has 7 Yums (a 6 h boost).
    const insert = w.h.db.prepare(
      "INSERT INTO kitchen_posts (id, author_id, title, audience, stats, created_at) VALUES (?, ?, 'Dal', 'public', '{}', ?)",
    );
    const ids: string[] = [];
    const base = w.now().getTime();
    for (let i = 0; i < 150; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      insert.run(id, DEV, new Date(base + i * 60_000).toISOString());
      ids.push(`pst_${id.replace(/-/g, "")}`);
    }
    const yum = w.h.db.prepare("INSERT INTO kitchen_post_yums (post_id, user_id, created_at) VALUES (?, ?, ?)");
    for (let i = 0; i < 7; i += 1) yum.run(uuidOf(ids[0]!), `usr_y${i}`, new Date(base).toISOString());
    w.tick(200 * 60_000);
    const first = await feedIds(w, KABIR, "discover");
    expect(first.ids).toEqual([ids[0], ...[...ids].reverse().slice(0, 19)]);
    const second = await feedIds(w, KABIR, "discover", first.nextCursor!);
    expect(second.ids).toEqual([...ids].reverse().slice(19, 39));
  });

  it("leaves out a post, or a profile's posts, once three different people reported it", async () => {
    const p = await cookAndPost(w, DEV, "public");
    const q = await cookAndPost(w, MEERA, "public");
    const report = (as: string, targetKind: string, targetId: string) => post(w, as, "/v1/kitchen/reports", { targetKind, targetId, reason: "spam" });
    await report(KABIR, "post", p.id);
    await report(KABIR, "post", p.id); // the same person twice counts once
    await report(SAM, "post", p.id);
    expect((await feedIds(w, ANU, "discover")).ids).toEqual([q.id, p.id]);
    await report(MEERA, "post", p.id);
    expect((await feedIds(w, ANU, "discover")).ids).toEqual([q.id]);
    // Still there for anyone who can see it otherwise.
    expect(await status(ANU, p)).toBe(200);

    for (const who of [KABIR, SAM, DEV]) await report(who, "profile", MEERA);
    expect((await feedIds(w, ANU, "discover")).ids).toEqual([]);
  });
});
