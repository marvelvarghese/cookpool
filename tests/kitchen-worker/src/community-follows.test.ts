// Following, requests, blocks and mutes (Cookpool CM-2, cookpool-community
// design §1): a public profile is followed at once and a private one is
// asked; requests are accepted or declined and followers removed; you need a
// profile to follow (403 no_profile) and can't follow yourself; blocking
// deletes the follows both ways in one batch and makes each a 404 to the
// other; a mute is recorded; and the day's limits on follows and blocks.

import type { BlocksResponse, PeoplePage, PersonProfileResponse } from "@saas/contracts/kitchen";
import { ANU, DAY, KABIR, MEERA, SAM, communityWorld, follow, followRows, makeProfile, me, type CommunityWorld } from "./community-helpers.js";

let w: CommunityWorld;
beforeEach(async () => {
  w = communityWorld();
  await makeProfile(w, MEERA, "meeracooks", "Meera K");
  await makeProfile(w, KABIR, "kabir", "Kabir S");
  await makeProfile(w, ANU, "anu", "Anu R", { privacy: "private" });
});
afterEach(() => w.h.close());

const post = (as: string, path: string) => {
  w.tick();
  return w.call<Record<string, unknown>>("POST", me(path), as);
};
const del = (as: string, path: string) => {
  w.tick();
  return w.call<Record<string, unknown>>("DELETE", me(path), as);
};

describe("following", () => {
  it("follows a public profile at once (201), and a repeat answers 200 with the same state", async () => {
    expect(await follow(w, KABIR, "MeeraCooks")).toMatchObject({ status: 201, state: "accepted" });
    expect(await follow(w, KABIR, "meeracooks")).toMatchObject({ status: 200, state: "accepted" });
    expect(followRows(w)).toEqual([{ follower_id: KABIR, followee_id: MEERA, state: "accepted" }]);
  });

  it("asks to follow a private profile, which accepts or declines", async () => {
    expect(await follow(w, KABIR, "anu")).toMatchObject({ status: 201, state: "requested" });
    expect(await follow(w, MEERA, "anu")).toMatchObject({ status: 201, state: "requested" });
    const requests = await w.call<PeoplePage>("GET", me("follow-requests"), ANU);
    expect(requests.body.data.people.map((p) => [p.handle, p.name, p.following])).toEqual([["meeracooks", "Meera K", "none"], ["kabir", "Kabir S", "none"]]);
    expect((await w.call<PeoplePage>("GET", me("follow-requests"), KABIR)).body.data.people).toEqual([]);

    expect((await post(ANU, `follow-requests/${KABIR}/accept`)).body.data).toEqual({ state: "accepted" });
    // Accepting again answers the same; declining an accepted follow is not a request.
    expect((await post(ANU, `follow-requests/${KABIR}/accept`)).body.data).toEqual({ state: "accepted" });
    expect((await post(ANU, `follow-requests/${KABIR}/decline`)).status).toBe(404);
    expect((await post(ANU, `follow-requests/${MEERA}/decline`)).body.data).toEqual({ state: "none" });
    expect((await post(ANU, `follow-requests/${MEERA}/accept`)).status).toBe(404);
    expect((await post(ANU, `follow-requests/${SAM}/accept`)).status).toBe(404);
    expect(followRows(w)).toEqual([{ follower_id: KABIR, followee_id: ANU, state: "accepted" }]);
  });

  it("removes a follower, and unfollows (a request too)", async () => {
    await follow(w, KABIR, "meeracooks");
    await follow(w, MEERA, "kabir");
    await follow(w, MEERA, "anu");
    expect((await del(MEERA, `followers/${KABIR}`)).body.data).toEqual({ removed: true });
    expect((await del(MEERA, `followers/${KABIR}`)).body.data).toEqual({ removed: false });
    expect((await del(MEERA, "follows/anu")).body.data).toEqual({ state: "none" });
    expect(followRows(w)).toEqual([{ follower_id: MEERA, followee_id: KABIR, state: "accepted" }]);
    expect((await del(MEERA, "follows/kabir")).body.data).toEqual({ state: "none" });
    expect(followRows(w)).toEqual([]);
    expect((await del(MEERA, "follows/nobody")).status).toBe(404);
  });

  it("needs a profile of your own: 403 no_profile, and nothing written", async () => {
    const res = await follow(w, SAM, "meeracooks");
    expect(res).toMatchObject({ status: 403, reason: "no_profile" });
    expect(followRows(w)).toEqual([]);
  });

  it("refuses following yourself, and a handle nobody has is the opaque 404", async () => {
    expect(await follow(w, MEERA, "meeracooks")).toMatchObject({ status: 422, reason: "self" });
    expect((await follow(w, MEERA, "nobody")).status).toBe(404);
  });

  it("going public accepts every waiting request", async () => {
    await follow(w, KABIR, "anu");
    await makeProfile(w, ANU, "anu", "Anu R", { privacy: "public" });
    expect(followRows(w)).toEqual([{ follower_id: KABIR, followee_id: ANU, state: "accepted" }]);
  });

  it("allows 200 follows a day: the next is 429 follow_limit, and a day later it goes through", async () => {
    const stamp = w.now().toISOString();
    const insert = w.h.db.prepare("INSERT INTO kitchen_follows VALUES (?, ?, 'accepted', ?, ?)");
    for (let i = 0; i < 200; i += 1) insert.run(KABIR, `usr_someone${i}`, stamp, stamp);
    const res = await w.call<unknown>("POST", me("follows/meeracooks"), KABIR);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "rate_limited", details: { reason: "follow_limit", max: 200 } });
    w.tick(DAY);
    expect(await follow(w, KABIR, "meeracooks")).toMatchObject({ status: 201, state: "accepted" });
  });
});

describe("blocking", () => {
  it("deletes the follows both ways in the same batch, and each is then the opaque 404 to the other", async () => {
    await follow(w, KABIR, "meeracooks");
    await follow(w, MEERA, "kabir");
    await follow(w, ANU, "meeracooks");
    expect((await post(MEERA, `blocks/${KABIR}`))).toMatchObject({ status: 201, body: { data: { blocked: true } } });
    expect(followRows(w)).toEqual([{ follower_id: ANU, followee_id: MEERA, state: "accepted" }]);

    expect((await w.call("GET", "/v1/kitchen/profiles/meeracooks", KABIR)).status).toBe(404);
    expect((await w.call("GET", "/v1/kitchen/profiles/kabir", MEERA)).status).toBe(404);
    // Neither can follow the other: the blocked person isn't told why.
    expect((await follow(w, KABIR, "meeracooks")).status).toBe(404);
    expect((await follow(w, MEERA, "kabir")).status).toBe(404);
    expect(followRows(w)).toHaveLength(1);
  });

  it("rolls the follows' delete back with the block when the batch fails", async () => {
    await follow(w, KABIR, "meeracooks");
    w.h.beforeNextBatch((db) => db.exec("CREATE TRIGGER no_blocks BEFORE INSERT ON kitchen_blocks BEGIN SELECT RAISE(ABORT, 'no'); END"));
    expect((await post(MEERA, `blocks/${KABIR}`)).status).toBe(503);
    expect(followRows(w)).toHaveLength(1);
  });

  it("repeats answer 200, unblock lifts it without restoring follows, and the list reads profile names only", async () => {
    await follow(w, KABIR, "meeracooks");
    expect((await post(MEERA, `blocks/${KABIR}`)).status).toBe(201);
    expect((await post(MEERA, `blocks/${KABIR}`)).status).toBe(200);
    expect((await post(MEERA, `blocks/${SAM}`)).status).toBe(201);
    const blocks = await w.call<BlocksResponse>("GET", me("blocks"), MEERA);
    expect(blocks.body.data.blocks.map(({ blockedAt: _at, ...b }) => b)).toEqual([
      { userId: SAM, handle: null, name: null },
      { userId: KABIR, handle: "kabir", name: "Kabir S" },
    ]);
    expect((await del(MEERA, `blocks/${KABIR}`)).body.data).toEqual({ blocked: false });
    expect((await w.call("GET", "/v1/kitchen/profiles/meeracooks", KABIR)).status).toBe(200);
    expect(followRows(w)).toEqual([]);
    expect((await post(MEERA, `blocks/${MEERA}`)).body.error).toMatchObject({ code: "validation_failed", details: { reason: "self" } });
    expect((await post(MEERA, "blocks/not%20an%20id")).status).toBe(404);
  });

  it("allows 50 blocks a day: the next is 429 block_limit", async () => {
    const insert = w.h.db.prepare("INSERT INTO kitchen_blocks VALUES (?, ?, ?)");
    for (let i = 0; i < 50; i += 1) insert.run(MEERA, `usr_pest${i}`, w.now().toISOString());
    const res = await post(MEERA, `blocks/${KABIR}`);
    expect(res.status).toBe(429);
    expect(res.body.error.details).toMatchObject({ reason: "block_limit", max: 50 });
    w.tick(DAY);
    expect((await post(MEERA, `blocks/${KABIR}`)).status).toBe(201);
  });
});

describe("muting", () => {
  it("is recorded, shows on the profile, and touches nothing else", async () => {
    await follow(w, MEERA, "kabir");
    expect((await post(MEERA, `mutes/${KABIR}`))).toMatchObject({ status: 201, body: { data: { muted: true } } });
    expect((await post(MEERA, `mutes/${KABIR}`)).status).toBe(200);
    expect(w.h.db.prepare("SELECT muter_id, muted_id FROM kitchen_mutes").all()).toEqual([{ muter_id: MEERA, muted_id: KABIR }]);
    const seen = await w.call<PersonProfileResponse>("GET", "/v1/kitchen/profiles/kabir", MEERA);
    expect(seen.body.data.relationship).toMatchObject({ muted: true, following: "accepted" });
    expect(followRows(w)).toHaveLength(1);
    expect((await del(MEERA, `mutes/${KABIR}`)).body.data).toEqual({ muted: false });
    expect(w.h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_mutes").get()).toEqual({ n: 0 });
    expect((await post(MEERA, `mutes/${MEERA}`)).status).toBe(422);
  });
});
