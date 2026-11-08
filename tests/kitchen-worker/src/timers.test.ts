// Timers that find you (Cookpool GC-3, cookpool-guided design §4): the
// caller's own timers through the real router over SQLite (migration 380
// applied). Set one (201), every field checked, ten active at most (422
// `too_many_timers`), list the active ones soonest first, cancel — once,
// idempotently, only your own: anyone else's is the opaque 404.

import type { KitchenTimer, KitchenTimerResponse, KitchenTimersResponse } from "@saas/contracts/kitchen";
import { createHarness, envelope, type Harness } from "./harness.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const DEV = "usr_dev";
const ANU = "usr_anu";
const TIMERS = "/v1/kitchen/me/timers";

const inSeconds = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();

let h: Harness;
let clock: Date;
beforeEach(() => {
  clock = NOW;
  h = createHarness({ deps: { now: () => clock } });
});
afterEach(() => h.close());

async function create(as: string, body: Record<string, unknown>): Promise<KitchenTimer> {
  const res = await h.call("POST", TIMERS, { as, body });
  expect(res.status).toBe(201);
  return (await envelope<KitchenTimerResponse>(res)).data.timer;
}

async function list(as: string): Promise<KitchenTimer[]> {
  const res = await h.call("GET", TIMERS, { as });
  expect(res.status).toBe(200);
  return (await envelope<KitchenTimersResponse>(res)).data.timers;
}

describe("POST /v1/kitchen/me/timers", () => {
  it("sets a timer for the caller and returns it with a tmr_ id", async () => {
    const res = await h.call("POST", TIMERS, {
      as: DEV,
      body: { label: "Simmer · step 7", body: "The oil shows at the edges", url: "/recipes/rcp_1/plan?f=1500", endsAt: inSeconds(600) },
    });
    expect(res.status).toBe(201);
    const { data } = await envelope<KitchenTimerResponse>(res);
    expect(data.timer).toEqual({
      id: expect.stringMatching(/^tmr_[0-9a-f]{32}$/),
      label: "Simmer · step 7",
      body: "The oil shows at the edges",
      url: "/recipes/rcp_1/plan?f=1500",
      endsAt: inSeconds(600),
      createdAt: NOW.toISOString(),
      sentAt: null,
      canceledAt: null,
    });
    const row = h.db.prepare("SELECT user_id, ends_at FROM kitchen_timers").get() as { user_id: string; ends_at: string };
    expect(row).toEqual({ user_id: DEV, ends_at: inSeconds(600) });
  });

  it("opens the cooking session and leaves the body to the push's default when neither is given; a blank body is none", async () => {
    const timer = await create(DEV, { label: "Rest", endsAt: inSeconds(30), body: "   " });
    expect(timer).toMatchObject({ body: null, url: "/cook/session" });
    // Trimmed, like every kitchen text.
    expect((await create(DEV, { label: "  Rest  ", body: " Cover it ", url: null, endsAt: inSeconds(60) })).label).toBe("Rest");
  });

  it("takes an end exactly 30 s and exactly 24 h ahead, in any ISO offset", async () => {
    await create(DEV, { label: "Soonest", endsAt: inSeconds(30) });
    await create(DEV, { label: "Latest", endsAt: inSeconds(24 * 60 * 60) });
    const offset = await create(DEV, { label: "IST", endsAt: "2026-11-08T17:40:00+05:30" });
    expect(offset.endsAt).toBe(inSeconds(600));
  });

  it.each([
    ["no label", { endsAt: inSeconds(600) }, "label"],
    ["a 61-character label", { label: "x".repeat(61), endsAt: inSeconds(600) }, "label"],
    ["a label that is not text", { label: 7, endsAt: inSeconds(600) }, "label"],
    ["a 121-character body", { label: "Simmer", body: "x".repeat(121), endsAt: inSeconds(600) }, "body"],
    ["another host's url", { label: "Simmer", url: "https://evil.example/", endsAt: inSeconds(600) }, "url"],
    ["a protocol-relative url", { label: "Simmer", url: "//evil.example/", endsAt: inSeconds(600) }, "url"],
    ["a relative url", { label: "Simmer", url: "cook/session", endsAt: inSeconds(600) }, "url"],
    ["no end", { label: "Simmer" }, "endsAt"],
    ["an end that is not a time", { label: "Simmer", endsAt: "soon" }, "endsAt"],
    ["an end 29 s ahead", { label: "Simmer", endsAt: inSeconds(29) }, "endsAt"],
    ["an end in the past", { label: "Simmer", endsAt: inSeconds(-60) }, "endsAt"],
    ["an end a second past 24 h", { label: "Simmer", endsAt: inSeconds(24 * 60 * 60 + 1) }, "endsAt"],
  ])("refuses %s with 422 naming the field", async (_why, body, field) => {
    const res = await h.call("POST", TIMERS, { as: DEV, body });
    expect(res.status).toBe(422);
    const { error } = await envelope(res);
    expect(error.code).toBe("validation_failed");
    expect(Object.keys((error.details as { fields: Record<string, string[]> }).fields)).toEqual([field]);
    expect((h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_timers").get() as { n: number }).n).toBe(0);
  });

  it("refuses a body that is not a JSON object, and a caller with no actor", async () => {
    expect((await h.call("POST", TIMERS, { as: DEV, rawBody: "[1]" })).status).toBe(422);
    expect((await h.call("POST", TIMERS, { as: null, body: { label: "Simmer", endsAt: inSeconds(600) } })).status).toBe(401);
  });

  it("allows ten active timers a person and refuses the eleventh with 422 too_many_timers, until one ends or is cancelled", async () => {
    const mine: KitchenTimer[] = [];
    for (let i = 1; i <= 10; i++) mine.push(await create(DEV, { label: `Timer ${i}`, endsAt: inSeconds(60 * i) }));
    const res = await h.call("POST", TIMERS, { as: DEV, body: { label: "One more", endsAt: inSeconds(600) } });
    expect(res.status).toBe(422);
    const { error } = await envelope(res);
    expect(error).toMatchObject({ code: "validation_failed", details: { reason: "too_many_timers", max: 10 } });
    // Someone else's limit is their own.
    await create(ANU, { label: "Anu's", endsAt: inSeconds(600) });
    // A cancel frees a place …
    expect((await h.call("DELETE", `${TIMERS}/${mine[0]!.id}`, { as: DEV })).status).toBe(200);
    await create(DEV, { label: "In its place", endsAt: inSeconds(600) });
    // … and so does one the sweep has pushed.
    h.db.prepare("UPDATE kitchen_timers SET sent_at = ? WHERE label = 'Timer 2'").run(NOW.toISOString());
    await create(DEV, { label: "And another", endsAt: inSeconds(600) });
    expect((await h.call("POST", TIMERS, { as: DEV, body: { label: "Too many", endsAt: inSeconds(600) } })).status).toBe(422);
  });
});

describe("GET /v1/kitchen/me/timers", () => {
  it("lists the caller's active timers soonest first — not sent, not cancelled, never anyone else's", async () => {
    const later = await create(DEV, { label: "Later", endsAt: inSeconds(900) });
    const soon = await create(DEV, { label: "Soon", endsAt: inSeconds(60) });
    const cancelled = await create(DEV, { label: "Cancelled", endsAt: inSeconds(120) });
    await create(DEV, { label: "Sent", endsAt: inSeconds(30) });
    await create(ANU, { label: "Anu's", endsAt: inSeconds(90) });
    await h.call("DELETE", `${TIMERS}/${cancelled.id}`, { as: DEV });
    h.db.prepare("UPDATE kitchen_timers SET sent_at = ? WHERE label = 'Sent'").run(NOW.toISOString());

    expect((await list(DEV)).map((t) => t.id)).toEqual([soon.id, later.id]);
    expect((await list(ANU)).map((t) => t.label)).toEqual(["Anu's"]);
    expect(await list("usr_nobody")).toEqual([]);
  });

  it("keeps a timer listed after its end until the sweep pushes it", async () => {
    const timer = await create(DEV, { label: "Simmer", endsAt: inSeconds(60) });
    clock = new Date(NOW.getTime() + 120_000);
    expect((await list(DEV)).map((t) => t.id)).toEqual([timer.id]);
  });

  it("answers 405 for a method it does not take, and 401 without an actor", async () => {
    expect((await h.call("PUT", TIMERS, { as: DEV, body: {} })).status).toBe(405);
    expect((await h.call("GET", TIMERS, { as: null })).status).toBe(401);
  });
});

describe("DELETE /v1/kitchen/me/timers/{id}", () => {
  it("cancels the caller's timer, so it is no longer active", async () => {
    const timer = await create(DEV, { label: "Simmer", endsAt: inSeconds(600) });
    clock = new Date(NOW.getTime() + 5_000);
    const res = await h.call("DELETE", `${TIMERS}/${timer.id}`, { as: DEV });
    expect(res.status).toBe(200);
    expect((await envelope<KitchenTimerResponse>(res)).data.timer).toEqual({ ...timer, canceledAt: inSeconds(5) });
    expect(await list(DEV)).toEqual([]);
  });

  it("is idempotent: a repeat answers the same timer, cancelled when it was first", async () => {
    const timer = await create(DEV, { label: "Simmer", endsAt: inSeconds(600) });
    clock = new Date(NOW.getTime() + 5_000);
    const first = await envelope<KitchenTimerResponse>(await h.call("DELETE", `${TIMERS}/${timer.id}`, { as: DEV }));
    clock = new Date(NOW.getTime() + 50_000);
    const again = await h.call("DELETE", `${TIMERS}/${timer.id}`, { as: DEV });
    expect(again.status).toBe(200);
    expect((await envelope<KitchenTimerResponse>(again)).data.timer).toEqual(first.data.timer);
  });

  it("answers a timer the sweep already pushed as it is: sent, and not cancelled", async () => {
    const timer = await create(DEV, { label: "Simmer", endsAt: inSeconds(60) });
    h.db.prepare("UPDATE kitchen_timers SET sent_at = ?").run(inSeconds(60));
    const res = await h.call("DELETE", `${TIMERS}/${timer.id}`, { as: DEV });
    expect(res.status).toBe(200);
    expect((await envelope<KitchenTimerResponse>(res)).data.timer).toMatchObject({ sentAt: inSeconds(60), canceledAt: null });
  });

  it("answers someone else's timer with the opaque 404 — the same as none at all — and leaves it running", async () => {
    const anus = await create(ANU, { label: "Anu's", endsAt: inSeconds(600) });
    const theirs = await h.call("DELETE", `${TIMERS}/${anus.id}`, { as: DEV });
    expect(theirs.status).toBe(404);
    const none = await h.call("DELETE", `${TIMERS}/tmr_${"0".repeat(31)}1`, { as: DEV });
    expect(none.status).toBe(404);
    expect((await envelope(theirs)).error).toEqual((await envelope(none)).error);
    expect((await list(ANU)).map((t) => t.id)).toEqual([anus.id]);
  });

  it.each([["a malformed id", "nope"], ["another resource's id", `itm_${"a".repeat(32)}`], ["a bare UUID", "00000000-0000-4000-8000-000000000001"]])(
    "answers %s with the opaque 404",
    async (_why, id) => {
      expect((await h.call("DELETE", `${TIMERS}/${id}`, { as: DEV })).status).toBe(404);
    },
  );

  it("answers 405 for a method it does not take", async () => {
    const timer = await create(DEV, { label: "Simmer", endsAt: inSeconds(600) });
    expect((await h.call("GET", `${TIMERS}/${timer.id}`, { as: DEV })).status).toBe(405);
  });
});
