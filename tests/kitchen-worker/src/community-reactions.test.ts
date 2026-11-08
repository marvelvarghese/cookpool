// Yum, comments and reports (Cookpool CM-3, cookpool-community design §2):
// Yum needs a profile and a post you can see, counts once per person and
// names up to three people, those you follow first; comments are oldest
// first with a cursor, at most 30 an hour per person, and removed by their
// author or the post's author (anyone else: the opaque 404); a report of a
// post, a comment or a profile you can see is stored once per reporter and
// audited (`kitchen.report.created`) in the same batch.

import type { CommentResponse, CommentsResponse, CommunityPost, ReportResponse, YumResponse } from "@saas/contracts/kitchen";
import {
  ANU,
  DEV,
  KABIR,
  MEERA,
  SAM,
  communityWorld,
  cookAndPost,
  del,
  follow,
  makeProfile,
  me,
  post,
  readPost,
  uuidOf,
  type CommunityWorld,
} from "./posts-helpers.js";

let w: CommunityWorld;
let p: CommunityPost;
beforeEach(async () => {
  w = communityWorld();
  await makeProfile(w, MEERA, "meeracooks", "Meera K");
  await makeProfile(w, ANU, "anu", "Anu R");
  await makeProfile(w, KABIR, "kabir", "Kabir S");
  await makeProfile(w, DEV, "devcooks", "Dev P");
  p = await cookAndPost(w, MEERA, "public");
});
afterEach(() => w.h.close());

const yumPath = () => `/v1/kitchen/posts/${p.id}/yum`;
const commentsPath = () => `/v1/kitchen/posts/${p.id}/comments`;
const say = (as: string, body: unknown) => post(w, as, commentsPath(), { body });

describe("Yum", () => {
  it("counts once per person: 201 when new, 200 a repeat, and taken back", async () => {
    const first = await post(w, KABIR, yumPath());
    expect(first.status).toBe(201);
    expect((first.body.data as unknown as YumResponse).yums).toEqual({ count: 1, mine: true });
    expect((await post(w, KABIR, yumPath())).status).toBe(200);
    expect((await post(w, DEV, yumPath())).body.data).toEqual({ yums: { count: 2, mine: true } });
    expect((await del(w, KABIR, yumPath())).body.data).toEqual({ yums: { count: 1, mine: false } });
    expect((await del(w, KABIR, yumPath())).body.data).toEqual({ yums: { count: 1, mine: false } });
  });

  it("needs a profile (403 no_profile) and a post you can see (404)", async () => {
    const sam = await post(w, SAM, yumPath());
    expect(sam.status).toBe(403);
    expect(sam.body.error.details).toEqual({ reason: "no_profile" });
    const hidden = await cookAndPost(w, MEERA, "me");
    expect((await post(w, KABIR, `/v1/kitchen/posts/${hidden.id}/yum`)).status).toBe(404);
    expect((await post(w, KABIR, "/v1/kitchen/posts/pst_nope/yum")).status).toBe(404);
  });

  it("names up to three, people you follow first, never you; a post read counts and marks yours", async () => {
    await makeProfile(w, SAM, "sam", "Sam T");
    for (const who of [DEV, SAM, ANU, KABIR]) await post(w, who, yumPath());
    // Kabir follows Anu: she comes first for him; then the latest of the rest.
    await follow(w, KABIR, "anu");
    const seen = (await readPost(w, KABIR, p.id)).post!;
    expect(seen.yums).toEqual({ count: 4, mine: true, names: ["Anu R", "Sam T", "Dev P"] });
    expect((await readPost(w, MEERA, p.id)).post!.yums).toEqual({ count: 4, mine: false, names: ["Kabir S", "Anu R", "Sam T"] });
    // A block takes the blocked person out of the count and the names, for the blocker.
    await post(w, MEERA, me(`blocks/${KABIR}`));
    expect((await readPost(w, MEERA, p.id)).post!.yums).toEqual({ count: 3, mine: false, names: ["Anu R", "Sam T", "Dev P"] });
  });
});

describe("comments", () => {
  it("adds one (201, the author by their profile), lists them oldest first and counts them on the post", async () => {
    const made = await say(KABIR, "  Roast the spices first next time  ");
    expect(made.status).toBe(201);
    expect((made.body.data as unknown as CommentResponse).comment).toMatchObject({
      id: expect.stringMatching(/^cmt_[0-9a-f]{32}$/),
      postId: p.id,
      author: { userId: KABIR, handle: "kabir", name: "Kabir S" },
      body: "Roast the spices first next time",
      mine: true,
      canRemove: true,
    });
    await say(DEV, "Yum");
    const list = await w.call<CommentsResponse>("GET", commentsPath(), MEERA);
    expect(list.body.data.comments.map((c) => [c.author.handle, c.body, c.mine, c.canRemove])).toEqual([
      ["kabir", "Roast the spices first next time", false, true],
      ["devcooks", "Yum", false, true],
    ]);
    expect(list.body.data.count).toBe(2);
    expect((await w.call<CommentsResponse>("GET", commentsPath(), ANU)).body.data.comments.map((c) => c.canRemove)).toEqual([false, false]);
    expect((await readPost(w, ANU, p.id)).post!.comments).toEqual({ count: 2 });
  });

  it("pages oldest first, 30 at a time", async () => {
    for (let i = 0; i < 32; i += 1) await say(i % 2 ? KABIR : DEV, `Comment ${i}`);
    const first = await w.call<CommentsResponse>("GET", commentsPath(), ANU);
    expect(first.body.data.comments.map((c) => c.body)).toEqual(Array.from({ length: 30 }, (_, i) => `Comment ${i}`));
    const next = await w.call<CommentsResponse>("GET", `${commentsPath()}?cursor=${encodeURIComponent(first.body.data.nextCursor!)}`, ANU);
    expect(next.body.data.comments.map((c) => c.body)).toEqual(["Comment 30", "Comment 31"]);
    expect(next.body.data.nextCursor).toBeNull();
  });

  it("needs a profile, a body of 1–500 and a post you can see", async () => {
    expect((await say(SAM, "Hi")).body.error.details).toEqual({ reason: "no_profile" });
    for (const body of ["", "   ", "x".repeat(501), 3, null]) expect((await say(KABIR, body)).status).toBe(422);
    const hidden = await cookAndPost(w, MEERA, "followers");
    expect((await post(w, KABIR, `/v1/kitchen/posts/${hidden.id}/comments`, { body: "Hi" })).status).toBe(404);
    expect((await w.call("GET", `/v1/kitchen/posts/${hidden.id}/comments`, KABIR)).status).toBe(404);
  });

  it("allows 30 an hour per person (429 comment_limit), and again once the hour has passed", async () => {
    for (let i = 0; i < 30; i += 1) expect((await say(KABIR, `n${i}`)).status).toBe(201);
    const refused = await say(KABIR, "one more");
    expect(refused.status).toBe(429);
    expect(refused.body.error.details).toMatchObject({ reason: "comment_limit", max: 30 });
    // Someone else isn't limited by him.
    expect((await say(DEV, "me too")).status).toBe(201);
    w.tick(60 * 60_000);
    expect((await say(KABIR, "one more")).status).toBe(201);
  });

  it("is removed by its author or the post's author; anyone else gets the opaque 404", async () => {
    const a = (await say(KABIR, "First")).body.data as unknown as CommentResponse;
    const b = (await say(DEV, "Second")).body.data as unknown as CommentResponse;
    expect((await del(w, ANU, `/v1/kitchen/comments/${a.comment.id}`)).status).toBe(404);
    expect((await del(w, DEV, `/v1/kitchen/comments/${a.comment.id}`)).status).toBe(404);
    expect((await del(w, KABIR, `/v1/kitchen/comments/${a.comment.id}`)).body.data).toEqual({ removed: true });
    expect((await del(w, MEERA, `/v1/kitchen/comments/${b.comment.id}`)).body.data).toEqual({ removed: true });
    expect((await del(w, MEERA, `/v1/kitchen/comments/${b.comment.id}`)).status).toBe(404);
    expect((await w.call<CommentsResponse>("GET", commentsPath(), ANU)).body.data).toMatchObject({ comments: [], count: 0 });
    expect(w.h.db.prepare("SELECT body, deleted_by FROM kitchen_post_comments ORDER BY created_at").all()).toEqual([
      { body: "First", deleted_by: KABIR },
      { body: "Second", deleted_by: MEERA },
    ]);
  });

  it("hides the comments of anyone with a block between you", async () => {
    await say(KABIR, "From Kabir");
    await say(DEV, "From Dev");
    await post(w, DEV, me(`blocks/${KABIR}`));
    const list = await w.call<CommentsResponse>("GET", commentsPath(), DEV);
    expect(list.body.data.comments.map((c) => c.body)).toEqual(["From Dev"]);
    expect(list.body.data.count).toBe(1);
  });
});

describe("reports", () => {
  const report = (as: string, body: Record<string, unknown>) => post(w, as, "/v1/kitchen/reports", body);
  const stored = () => w.h.db.prepare("SELECT reporter_id, target_kind, target_id, reason, note, state FROM kitchen_reports ORDER BY created_at").all();
  const audits = () =>
    w.h.db.prepare("SELECT type, actor_id, subject_kind, payload FROM events_event_log WHERE type = 'kitchen.report.created' ORDER BY occurred_at").all() as Array<Record<string, string>>;

  it("stores a report of a post, a comment or a profile, and audits it in the same batch", async () => {
    const c = ((await say(DEV, "Buy my pills")).body.data as unknown as CommentResponse).comment;
    const one = await report(KABIR, { targetKind: "post", targetId: p.id, reason: "spam", note: "  Not a cook  " });
    expect(one.status).toBe(201);
    expect((one.body.data as unknown as ReportResponse).report).toEqual({
      id: expect.stringMatching(/^rpt_[0-9a-f]{32}$/),
      targetKind: "post",
      targetId: p.id,
      reason: "spam",
      createdAt: w.now().toISOString(),
    });
    expect((await report(KABIR, { targetKind: "comment", targetId: c.id, reason: "abuse" })).status).toBe(201);
    // Reporting needs no profile of your own.
    expect((await report(SAM, { targetKind: "profile", targetId: DEV, reason: "unsafe" })).status).toBe(201);
    expect(stored()).toEqual([
      { reporter_id: KABIR, target_kind: "post", target_id: uuidOf(p.id), reason: "spam", note: "Not a cook", state: "open" },
      { reporter_id: KABIR, target_kind: "comment", target_id: uuidOf(c.id), reason: "abuse", note: null, state: "open" },
      { reporter_id: SAM, target_kind: "profile", target_id: DEV, reason: "unsafe", note: null, state: "open" },
    ]);
    const events = audits();
    expect(events.map((e) => [e.actor_id, e.subject_kind])).toEqual([[KABIR, "kitchen_report"], [KABIR, "kitchen_report"], [SAM, "kitchen_report"]]);
    expect(JSON.parse(events[0]!.payload!)).toMatchObject({ targetKind: "post", targetId: p.id, reason: "spam" });
  });

  it("answers a repeat with the first report (200), writing nothing more", async () => {
    const first = await report(KABIR, { targetKind: "post", targetId: p.id, reason: "spam" });
    const again = await report(KABIR, { targetKind: "post", targetId: p.id, reason: "abuse" });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual(first.body.data);
    expect(stored()).toHaveLength(1);
    expect(audits()).toHaveLength(1);
  });

  it("only takes a target you can see: 404 otherwise, 422 for yourself or a body it can't read", async () => {
    const hidden = await cookAndPost(w, MEERA, "me");
    expect((await report(KABIR, { targetKind: "post", targetId: hidden.id, reason: "spam" })).status).toBe(404);
    expect((await report(KABIR, { targetKind: "comment", targetId: "cmt_00000000000000000000000000000000", reason: "spam" })).status).toBe(404);
    expect((await report(KABIR, { targetKind: "profile", targetId: SAM, reason: "spam" })).status).toBe(404);
    await post(w, DEV, me(`blocks/${KABIR}`));
    expect((await report(KABIR, { targetKind: "profile", targetId: DEV, reason: "spam" })).status).toBe(404);
    expect((await report(KABIR, { targetKind: "profile", targetId: KABIR, reason: "spam" })).body.error.details).toMatchObject({ reason: "self" });
    for (const body of [
      { targetKind: "recipe", targetId: p.id, reason: "spam" },
      { targetKind: "post", targetId: p.id, reason: "boring" },
      { targetKind: "post", reason: "spam" },
      { targetKind: "post", targetId: p.id, reason: "spam", note: "x".repeat(301) },
    ]) {
      expect((await report(KABIR, body)).status).toBe(422);
    }
    expect(stored()).toEqual([]);
    expect(audits()).toEqual([]);
  });
});
