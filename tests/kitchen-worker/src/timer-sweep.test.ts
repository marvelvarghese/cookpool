// The per-minute timer sweep (Cookpool GC-3, cookpool-guided design §4):
// runTimerSweep over SQLite (migration 380 applied) with a fixed clock and a
// fake notifications-worker that records every push-to-subject call. A due
// timer is pushed once, in its own words; one not yet due is not; a
// cancelled one never is; an overlapping run never pushes one twice; a
// failed push is tried once and never looped on; old timers are purged; and
// scheduled() runs this sweep on "* * * * *" and the daily one on
// "30 2 * * *".

import type { KitchenTimer, KitchenTimerResponse } from "@saas/contracts/kitchen";
import type { PushToSubjectRequest } from "@saas/contracts/notifications";
import worker from "@kitchen-worker/index";
import { TIMER_SWEEP_CRON, TIMER_SWEEP_MAX, runTimerSweep, timerSweepLine } from "@kitchen-worker/timer-sweep";
import type { Env } from "@kitchen-worker/env";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHarness, envelope, type Harness } from "./harness.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const DEV = "usr_dev";
const ANU = "usr_anu";
const TIMERS = "/v1/kitchen/me/timers";
const after = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

/** One push-to-subject call the sweep made. */
interface RecordedPush {
  path: string;
  method: string;
  headers: Record<string, string>;
  request: PushToSubjectRequest;
}

/**
 * notifications-worker's push-to-subject route, faked: answers each person's
 * device count (`devices`, default 1 each, all sent), or as `fail` says. A
 * `hold` makes the next call wait until it is released — an invocation still
 * pushing while the next minute's starts.
 */
function fakeNotifications() {
  const pushes: RecordedPush[] = [];
  const state = {
    devices: new Map<string, number>(),
    fail: null as null | "500" | "network" | "garbage",
    hold: null as null | Promise<void>,
  };
  const binding = {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
      const request = JSON.parse(String(init?.body)) as PushToSubjectRequest;
      pushes.push({ path: url.pathname, method: init?.method ?? "GET", headers, request });
      if (state.hold) await state.hold;
      if (state.fail === "network") throw new TypeError("fetch failed");
      if (state.fail === "500") return Response.json({ error: { code: "internal_error" } }, { status: 500 });
      if (state.fail === "garbage") return new Response("<html>", { status: 200 });
      const devices = state.devices.get(request.subjectId) ?? 1;
      return Response.json({
        data: { devices, sent: devices, gone: 0, failed: 0, ...(devices === 0 ? { skipped: "no_devices" } : {}) },
        meta: { requestId: "req_notifications", cursor: null },
      });
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { binding, pushes, state };
}

let h: Harness;
let notifications: ReturnType<typeof fakeNotifications>;
let warnings: string[];
const realWarn = console.warn;

beforeEach(() => {
  notifications = fakeNotifications();
  h = createHarness({ deps: { now: () => NOW }, env: { NOTIFICATIONS_WORKER: notifications.binding } });
  warnings = [];
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
});

afterEach(() => {
  console.warn = realWarn;
  h.close();
});

async function setTimer(as: string, body: Record<string, unknown>): Promise<KitchenTimer> {
  const res = await h.call("POST", TIMERS, { as, body });
  expect(res.status).toBe(201);
  return (await envelope<KitchenTimerResponse>(res)).data.timer;
}

const sweepAt = (at: Date, limit?: number) => runTimerSweep(h.env, { now: () => at, requestId: "req_sweep", ...(limit ? { limit } : {}) });
const pushedTags = () => notifications.pushes.map((p) => p.request.message.tag);
const sentAt = (id: string) =>
  (h.db.prepare("SELECT sent_at FROM kitchen_timers WHERE id = ?").get(uuidOf(id)) as { sent_at: string | null } | undefined)?.sent_at;
/** `tmr_<32 hex>` → the stored UUID. */
function uuidOf(publicId: string): string {
  const hex = publicId.slice(4);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe("runTimerSweep", () => {
  it("pushes a due timer once, to its person, as kitchen-worker, in its own words — and marks it sent", async () => {
    const simmer = await setTimer(DEV, {
      label: "Simmer · step 7",
      body: "The oil shows at the edges",
      url: "/recipes/rcp_1/plan",
      endsAt: after(600).toISOString(),
    });

    const outcome = await sweepAt(after(601));
    expect(outcome).toEqual({ due: 1, pushed: 1, devices: 1, sent: 1, unheard: 0, failed: 0, purged: 0 });
    expect(notifications.pushes).toEqual([
      {
        path: "/v1/notifications/push-to-subject",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_sweep",
          "x-internal-actor": "kitchen-worker",
          "x-actor-subject-type": "system",
          "x-actor-subject-id": "kitchen-worker",
        },
        request: {
          subjectId: DEV,
          message: {
            kind: "kitchen.timer",
            title: "Simmer · step 7",
            body: "The oil shows at the edges",
            url: "/recipes/rcp_1/plan",
            tag: simmer.id,
          },
        },
      },
    ]);
    expect(sentAt(simmer.id)).toBe(after(601).toISOString());

    // The next minute, and the one after: nothing more.
    expect(await sweepAt(after(661))).toMatchObject({ due: 0, pushed: 0 });
    expect(await sweepAt(after(721))).toMatchObject({ due: 0, pushed: 0 });
    expect(pushedTags()).toEqual([simmer.id]);
    // Pushed is no longer active.
    expect((await envelope<{ timers: KitchenTimer[] }>(await h.call("GET", TIMERS, { as: DEV }))).data.timers).toEqual([]);
  });

  it("says time's up and opens the cooking session for a timer that names neither", async () => {
    const rest = await setTimer(DEV, { label: "Rest the dough", endsAt: after(60).toISOString() });
    await sweepAt(after(60));
    expect(notifications.pushes[0]!.request.message).toEqual({
      kind: "kitchen.timer",
      title: "Rest the dough",
      body: "Time's up",
      url: "/cook/session",
      tag: rest.id,
    });
  });

  it("does not push a timer before its end, and pushes it on the minute it ends", async () => {
    const timer = await setTimer(DEV, { label: "Simmer", endsAt: after(600).toISOString() });
    expect(await sweepAt(after(300))).toMatchObject({ due: 0, pushed: 0 });
    expect(await sweepAt(after(599))).toMatchObject({ due: 0, pushed: 0 });
    expect(notifications.pushes).toEqual([]);
    expect(sentAt(timer.id)).toBeNull();
    // ends_at ≤ now: due at the very instant.
    expect(await sweepAt(after(600))).toMatchObject({ due: 1, pushed: 1 });
    expect(pushedTags()).toEqual([timer.id]);
  });

  it("never pushes a cancelled timer, however long after its end it runs", async () => {
    const cancelled = await setTimer(DEV, { label: "Cancelled", endsAt: after(120).toISOString() });
    const kept = await setTimer(DEV, { label: "Kept", endsAt: after(120).toISOString() });
    expect((await h.call("DELETE", `${TIMERS}/${cancelled.id}`, { as: DEV })).status).toBe(200);
    for (const at of [after(120), after(180), after(3600), after(23 * 3600)]) await sweepAt(at);
    expect(pushedTags()).toEqual([kept.id]);
    expect(sentAt(cancelled.id)).toBeNull();
  });

  it("pushes every due timer of every person, soonest first, and counts the devices", async () => {
    notifications.state.devices.set(ANU, 3);
    notifications.state.devices.set("usr_meera", 0);
    const devs = await setTimer(DEV, { label: "Dev's", endsAt: after(120).toISOString() });
    const anus = await setTimer(ANU, { label: "Anu's", endsAt: after(60).toISOString() });
    const meeras = await setTimer("usr_meera", { label: "Meera's", endsAt: after(90).toISOString() });
    await setTimer(DEV, { label: "Later", endsAt: after(900).toISOString() });

    const outcome = await sweepAt(after(150));
    expect(outcome).toEqual({ due: 3, pushed: 3, devices: 4, sent: 4, unheard: 1, failed: 0, purged: 0 });
    expect(notifications.pushes.map((p) => [p.request.subjectId, p.request.message.tag])).toEqual([
      [ANU, anus.id],
      ["usr_meera", meeras.id],
      [DEV, devs.id],
    ]);
    expect(timerSweepLine(outcome!)).toBe("[scheduled] timer sweep: due=3 pushed=3 devices=4 sent=4 unheard=1 failed=0 purged=0");
  });

  it("never pushes one timer twice when a run starts while the last one is still pushing", async () => {
    const first = await setTimer(DEV, { label: "First", endsAt: after(60).toISOString() });
    let release!: () => void;
    notifications.state.hold = new Promise<void>((resolve) => (release = resolve));
    const slow = sweepAt(after(60));
    // The slow run has claimed its timer and is waiting on notifications-worker.
    await new Promise((resolve) => setImmediate(resolve));
    expect(pushedTags()).toEqual([first.id]);
    notifications.state.hold = null;

    // The next minute's run overlaps it: the first timer is already claimed.
    const second = await setTimer(DEV, { label: "Second", endsAt: after(90).toISOString() });
    const overlapping = await sweepAt(after(120));
    expect(overlapping).toMatchObject({ due: 1, pushed: 1 });
    release();
    expect(await slow).toMatchObject({ due: 1, pushed: 1 });
    expect(pushedTags()).toEqual([first.id, second.id]);
  });

  it("two runs at the same moment claim each timer once between them", async () => {
    for (let i = 0; i < 8; i++) await setTimer(i % 2 ? DEV : ANU, { label: `T${i}`, endsAt: after(60 + i).toISOString() });
    const [a, b] = await Promise.all([sweepAt(after(120)), sweepAt(after(120))]);
    expect(a!.due + b!.due).toBe(8);
    expect(new Set(pushedTags()).size).toBe(8);
    expect(pushedTags()).toHaveLength(8);
  });

  it.each([
    ["answers 500", "500", "non_2xx 500"],
    ["cannot be reached", "network", "network_error"],
    ["answers something that is not the push summary", "garbage", "bad_response 200"],
  ] as const)("logs a push notifications-worker %s, marks the timer tried, and never loops on it", async (_why, fail, logged) => {
    const timer = await setTimer(DEV, { label: "Simmer", endsAt: after(60).toISOString() });
    notifications.state.fail = fail;
    const outcome = await sweepAt(after(60));
    expect(outcome).toEqual({ due: 1, pushed: 0, devices: 0, sent: 0, unheard: 0, failed: 1, purged: 0 });
    expect(warnings).toEqual([`[kitchen-worker] push-to-subject ${timer.id}: ${logged}`]);
    expect(sentAt(timer.id)).toBe(after(60).toISOString());
    // notifications-worker is back: the tried timer is not tried again.
    notifications.state.fail = null;
    expect(await sweepAt(after(120))).toMatchObject({ due: 0 });
    expect(notifications.pushes).toHaveLength(1);
  });

  it("counts every due timer as failed, and still marks them tried, with no notifications binding", async () => {
    const env: Env = { ...h.env };
    delete env.NOTIFICATIONS_WORKER;
    const timer = await setTimer(DEV, { label: "Simmer", endsAt: after(60).toISOString() });
    expect(await runTimerSweep(env, { now: () => after(60) })).toMatchObject({ due: 1, pushed: 0, failed: 1 });
    expect(warnings).toEqual([`[kitchen-worker] push-to-subject ${timer.id}: no_binding`]);
    expect(sentAt(timer.id)).not.toBeNull();
  });

  it(`claims at most ${TIMER_SWEEP_MAX} a run, soonest first; the rest go the next minute`, async () => {
    const insert = h.db.prepare(
      "INSERT INTO kitchen_timers (id, user_id, label, body, url, ends_at, created_at) VALUES (?, ?, 'T', NULL, '/cook/session', ?, ?)",
    );
    for (let i = 0; i <= TIMER_SWEEP_MAX; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      insert.run(id, `usr_${i}`, after(60 + i).toISOString(), NOW.toISOString());
    }
    expect(await sweepAt(after(3600))).toMatchObject({ due: TIMER_SWEEP_MAX, pushed: TIMER_SWEEP_MAX });
    expect(notifications.pushes.at(-1)!.request.subjectId).toBe(`usr_${TIMER_SWEEP_MAX - 1}`);
    expect(await sweepAt(after(3660))).toMatchObject({ due: 1, pushed: 1 });
    expect(notifications.pushes.at(-1)!.request.subjectId).toBe(`usr_${TIMER_SWEEP_MAX}`);
  });

  it("purges every timer that ended more than a day ago — sent, cancelled or never reached — and keeps the rest", async () => {
    const sent = await setTimer(DEV, { label: "Sent", endsAt: after(60).toISOString() });
    const cancelled = await setTimer(DEV, { label: "Cancelled", endsAt: after(60).toISOString() });
    await h.call("DELETE", `${TIMERS}/${cancelled.id}`, { as: DEV });
    await sweepAt(after(60));
    expect(pushedTags()).toEqual([sent.id]);
    const day = 24 * 3600;
    // A day after they ended, to the millisecond: kept.
    expect(await sweepAt(after(60 + day))).toMatchObject({ due: 0, purged: 0 });

    // One the sweep never reached (its trigger was down for a day), and one set to end later.
    h.db
      .prepare("INSERT INTO kitchen_timers (id, user_id, label, url, ends_at, created_at) VALUES (?, ?, 'Missed', '/cook/session', ?, ?)")
      .run("00000000-0000-4000-8000-00000000abcd", DEV, after(30).toISOString(), NOW.toISOString());
    const recent = await setTimer(DEV, { label: "Recent", endsAt: after(23 * 3600).toISOString() });

    const outcome = await sweepAt(after(61 + day));
    expect(outcome).toMatchObject({ purged: 3 });
    // The missed one is purged before the claim: dropped, never pushed a day late.
    expect(pushedTags()).toEqual([sent.id, recent.id]);
    const left = h.db.prepare("SELECT label FROM kitchen_timers").all() as Array<{ label: string }>;
    expect(left.map((r) => r.label)).toEqual(["Recent"]);
  });

  it("returns null — the run failed — when there is no database to read", async () => {
    const env: Env = { ...h.env };
    delete env.PLATFORM_DB;
    expect(await runTimerSweep(env)).toBeNull();
  });
});

describe("scheduled()", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const controller = (cron: string, at = Date.now()) =>
    ({ scheduledTime: at, cron, noRetry() {} }) as unknown as ScheduledController;
  /** A timer that ended a second ago by the real clock: scheduled() sweeps at the time it runs. */
  function dueNow(): string {
    const id = "00000000-0000-4000-8000-0000000000aa";
    h.db
      .prepare("INSERT INTO kitchen_timers (id, user_id, label, url, ends_at, created_at) VALUES (?, ?, 'Simmer', '/cook/session', ?, ?)")
      .run(id, DEV, new Date(Date.now() - 1000).toISOString(), new Date(Date.now() - 60_000).toISOString());
    return "tmr_000000000000400080000000000000aa";
  }
  const dailyRuns = () => (h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_sweeps").get() as { n: number }).n;

  it(`runs the timer sweep on "${TIMER_SWEEP_CRON}" and logs its one line — not the daily sweep`, async () => {
    const tag = dueNow();
    await worker.scheduled!(controller(TIMER_SWEEP_CRON), h.env, ctx);
    expect(pushedTags()).toEqual([tag]);
    expect(notifications.pushes.every((p) => p.path === "/v1/notifications/push-to-subject")).toBe(true);
    expect(warnings).toEqual(["[scheduled] timer sweep: due=1 pushed=1 devices=1 sent=1 unheard=0 failed=0 purged=0"]);
    expect(dailyRuns()).toBe(0);
  });

  it('runs the daily use-soon sweep on "30 2 * * *" — and pushes no timer', async () => {
    dueNow();
    await worker.scheduled!(controller("30 2 * * *", Date.parse("2026-11-08T02:30:00.000Z")), h.env, ctx);
    expect(dailyRuns()).toBe(1);
    expect(notifications.pushes).toEqual([]);
    expect(h.db.prepare("SELECT sent_at FROM kitchen_timers").get()).toEqual({ sent_at: null });
    expect(warnings).toEqual(["[scheduled] kitchen sweep 2026-11-08: items=0 people=0 sent=0 failed=0"]);
  });

  it("fails the timer sweep's invocation, loudly, when there is no database to read", async () => {
    const env: Env = { ...h.env };
    delete env.PLATFORM_DB;
    await expect(worker.scheduled!(controller(TIMER_SWEEP_CRON), env, ctx)).rejects.toThrow(/timer sweep/);
  });

  it("has both triggers in the worker's wrangler template", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const template = readFileSync(resolve(here, "../../../apps/kitchen-worker/wrangler.template.jsonc"), "utf8");
    const crons = /"crons":\s*\[([^\]]*)\]/.exec(template)![1]!.match(/"[^"]+"/g)!.map((c) => JSON.parse(c) as string);
    expect(crons).toEqual(["30 2 * * *", TIMER_SWEEP_CRON]);
    expect(TIMER_SWEEP_CRON).toBe("* * * * *");
  });
});
