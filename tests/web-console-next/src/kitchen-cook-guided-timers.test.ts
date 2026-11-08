import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CreateKitchenTimerRequest, KitchenTimerResponse } from "@saas/contracts/kitchen";
import { createCookSessionStore, type SessionStorageLike } from "@web-console-next/lib/cook-session-store";
import type { CookSession, FinishAnswer } from "@web-console-next/components/kitchen/cook-session";
import {
  CANCEL_RETRY_MS,
  HAND_OVER_MS,
  addMinute,
  chooseMode,
  isTooManyTimers,
  markStepDone,
  pauseTimer,
  resumeTimer,
  runTimerWork,
  serverTimerIds,
  startAndGoOn,
  startCooking,
  startTimer,
  timerState,
  timerWork,
} from "@web-console-next/components/kitchen/cook-guided";
import { stepScreen, timerCard } from "@web-console-next/components/kitchen/cook-guided-screens";
import {
  BEEPS,
  SCREEN_LOCK_REFUSED,
  VIBRATION,
  createScreenLock,
  primeBell,
  readAloud,
  resetBell,
  ringBell,
  stepSwipeGoes,
  stepSwipeRule,
  stopReading,
  type AudioContextLike,
  type ScreenLockEnv,
  type ScreenLockState,
  type WakeLockSentinelLike,
} from "@web-console-next/components/kitchen/cook-guided-device";
import { GuidePromptView, PingAndScreen, TimerCard } from "@web-console-next/components/kitchen/cook-guided-ui";
import { promptView } from "@web-console-next/components/kitchen/cook-guided-screens";
import { ME } from "./kitchen-pantry-fixtures";
import { NOW, at, curry } from "./kitchen-cook-guided-fixtures";

// cookpool-guided GC-5 (design §3.7, §4's console side): every timer the
// session starts sets a server timer (GC-3), which Pause, Done early, a tick
// or Discard cancels; in view, the page takes a timer over just before its
// end and rings it itself, so the phone isn't pinged twice; the eleventh
// timer still runs, here. The phone's parts: screen on, read aloud, the bell
// and swipe — each against a fake of the little of the browser it uses.

const none = () => undefined;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const escaped = (text: string) => text.replace(/'/g, "&#x27;");

/** The curry at the simmer (steps 1–4 ticked), Start and go on pressed at 240 s: it ends at 1440 s. */
function simmering(): CookSession {
  let s = startCooking(chooseMode(curry(), "guided", NOW), NOW);
  for (const [i, key] of ["c-oil", "c-onions", "c-sear", "c-yogurt"].entries()) s = markStepDone(s, key, at((i + 1) * 60));
  return startAndGoOn(s, "c-simmer", at(240));
}

function memoryStorage(): SessionStorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

type Call = { what: "create"; request: CreateKitchenTimerRequest } | { what: "cancel"; id: string };

/** The draft in a store, GC-3's routes faked (each create a new `tmr_n`), and the bell counted. */
function harness(initial: CookSession) {
  const storage = memoryStorage();
  const store = createCookSessionStore({ storage: () => storage, prefix: () => "test" });
  store.write(ME, initial);
  const calls: Call[] = [];
  const rings: number[] = [];
  let n = 0;
  const created = (request: CreateKitchenTimerRequest): FinishAnswer<KitchenTimerResponse> => ({
    ok: true,
    data: {
      timer: {
        id: `tmr_${++n}`,
        label: request.label,
        body: request.body ?? null,
        url: request.url ?? "/cook/session",
        endsAt: request.endsAt,
        createdAt: NOW.toISOString(),
        sentAt: null,
        canceledAt: null,
      },
    },
  });
  const h = {
    calls,
    rings,
    createAnswer: (request: CreateKitchenTimerRequest): FinishAnswer<KitchenTimerResponse> | Promise<FinishAnswer<KitchenTimerResponse>> => created(request),
    cancelAnswer: (_id: string): FinishAnswer<unknown> => ({ ok: true, data: {} }),
    inFlight: new Set<string>(),
    failedAt: new Map<string, number>(),
    read: () => store.read(ME)!,
    timer: () => store.read(ME)!.guide!.timers[0]!,
    change: (f: (s: CookSession) => CookSession) => store.update(ME, f),
    run: (now: Date, visible = true) =>
      runTimerWork({
        read: () => store.read(ME),
        save: (change) => store.update(ME, change),
        server: {
          create: async (request) => {
            calls.push({ what: "create", request });
            return h.createAnswer(request);
          },
          cancel: async (id) => {
            calls.push({ what: "cancel", id });
            return h.cancelAnswer(id);
          },
        },
        now,
        visible,
        ring: () => rings.push(now.getTime()),
        inFlight: h.inFlight,
        failedAt: h.failedAt,
      }),
  };
  return h;
}

describe("server timers (design §4, GC-3)", () => {
  it("sets one when a timer starts, in the push's words, opening the session", async () => {
    const h = harness(simmering());
    await h.run(at(241));
    expect(h.calls).toEqual([
      {
        what: "create",
        request: { label: "Simmer done · Chicken curry", body: "Next: Chop the coriander", url: "/cook/session", endsAt: at(1440).toISOString() },
      },
    ]);
    expect(h.timer()).toMatchObject({ serverId: "tmr_1", push: "set", pushNote: null });
    // Set once: the next tick asks nothing.
    await h.run(at(242));
    expect(h.calls).toHaveLength(1);
  });

  it("Pause cancels it; Resume sets one for the new end; +1 min moves it", async () => {
    const h = harness(simmering());
    await h.run(at(241));
    h.change((s) => pauseTimer(s, "t1", at(300)));
    expect(h.timer()).toMatchObject({ endsAt: null, pausedLeftMs: 1_140_000, serverId: null });
    await h.run(at(301));
    expect(h.calls.slice(1)).toEqual([{ what: "cancel", id: "tmr_1" }]);
    expect(h.read().guide!.cancels).toEqual([]);
    h.change((s) => resumeTimer(s, "t1", at(400)));
    await h.run(at(401));
    expect(h.calls[2]).toMatchObject({ what: "create", request: { endsAt: at(1540).toISOString() } });
    h.change((s) => addMinute(s, "t1", at(500)));
    expect(h.timer()).toMatchObject({ endsAt: at(1600).toISOString(), totalMs: 1_260_000, push: "pending" });
    await h.run(at(501));
    expect(h.calls.slice(3)).toEqual([
      { what: "create", request: expect.objectContaining({ endsAt: at(1600).toISOString() }) },
      { what: "cancel", id: "tmr_2" },
    ]);
    expect(h.timer()).toMatchObject({ serverId: "tmr_3", push: "set" });
  });

  it("ticking the step (Done, Done early) cancels it; Discard cancels every one the session holds", async () => {
    const h = harness(simmering());
    await h.run(at(241));
    h.change((s) => startTimer(s, "c-coriander", at(242), 120));
    await h.run(at(243));
    expect(serverTimerIds(h.read())).toEqual(["tmr_1", "tmr_2"]);
    h.change((s) => markStepDone(s, "c-simmer", at(600)));
    expect(h.read().guide!.timers.map((t) => t.stepKey)).toEqual(["c-coriander"]);
    expect(h.read().guide!.cancels).toEqual(["tmr_1"]);
    // What Discard and Finish cancel: the timers' and those still to cancel.
    expect(serverTimerIds(h.read())).toEqual(["tmr_2", "tmr_1"]);
    await h.run(at(601));
    expect(h.calls.at(-1)).toEqual({ what: "cancel", id: "tmr_1" });
    expect(h.read().guide!.cancels).toEqual([]);
  });

  it("in view, takes a timer over ~5 s before its end — cancelling the server timer — and rings it itself, once", async () => {
    const h = harness(simmering());
    await h.run(at(241));
    await h.run(new Date(at(1440).getTime() - HAND_OVER_MS - 1000));
    expect(h.calls).toHaveLength(1);
    await h.run(new Date(at(1440).getTime() - HAND_OVER_MS));
    expect(h.calls.at(-1)).toEqual({ what: "cancel", id: "tmr_1" });
    expect(h.timer()).toMatchObject({ serverId: null, push: "here", rang: false });
    expect(h.rings).toEqual([]);
    await h.run(at(1440));
    expect(h.rings).toEqual([at(1440).getTime()]);
    expect(h.timer().rang).toBe(true);
    await h.run(at(1441));
    expect(h.rings).toHaveLength(1);
    expect(h.calls.filter((c) => c.what === "cancel")).toHaveLength(1);
  });

  it("away (hidden), leaves the push to the server, and marks the end later without a sound", async () => {
    const h = harness(simmering());
    await h.run(at(241));
    await h.run(at(1437), false);
    await h.run(at(1440), false);
    expect(h.calls).toHaveLength(1);
    expect(h.timer()).toMatchObject({ serverId: "tmr_1", push: "set", rang: false });
    await h.run(at(1500), true);
    expect(h.rings).toEqual([]);
    expect(h.timer().rang).toBe(true);
    expect(h.calls).toHaveLength(1);
  });

  it("a timer too short for a push rings only here", async () => {
    const h = harness(startTimer(simmering(), "c-coriander", at(300), 20));
    await h.run(at(301));
    expect(h.calls.filter((c) => c.what === "create").map((c) => (c.what === "create" ? c.request.label : ""))).toEqual(["Simmer done · Chicken curry"]);
    expect(h.read().guide!.timers.find((t) => t.stepKey === "c-coriander")).toMatchObject({ push: "here", pushNote: "short" });
    await h.run(at(320));
    expect(h.rings).toEqual([at(320).getTime()]);
  });

  it("cancels at once a server timer answered after its timer moved", async () => {
    const h = harness(simmering());
    let answer: (a: FinishAnswer<KitchenTimerResponse>) => void = none;
    h.createAnswer = () => new Promise((resolve) => (answer = resolve));
    const pass = h.run(at(241));
    // The create is on its way: another tick doesn't ask twice.
    await h.run(at(242));
    expect(h.calls.filter((c) => c.what === "create")).toHaveLength(1);
    h.change((s) => pauseTimer(s, "t1", at(243)));
    answer({ ok: true, data: { timer: { id: "tmr_late", label: "x", body: null, url: "/cook/session", endsAt: at(1440).toISOString(), createdAt: NOW.toISOString(), sentAt: null, canceledAt: null } } });
    await pass;
    expect(h.timer()).toMatchObject({ serverId: null, endsAt: null });
    expect(h.read().guide!.cancels).toEqual(["tmr_late"]);
    await h.run(at(244));
    expect(h.calls.at(-1)).toEqual({ what: "cancel", id: "tmr_late" });
  });

  it("tries a cancel that failed again a little later; one already gone is done", async () => {
    const h = harness(simmering());
    await h.run(at(241));
    h.cancelAnswer = () => ({ ok: false, status: 0, error: { code: "network_error", message: "offline", reason: "offline" } });
    h.change((s) => markStepDone(s, "c-simmer", at(300)));
    await h.run(at(301));
    expect(h.read().guide!.cancels).toEqual(["tmr_1"]);
    await h.run(at(302));
    expect(h.calls.filter((c) => c.what === "cancel")).toHaveLength(1);
    h.cancelAnswer = () => ({ ok: false, status: 404, error: { code: "not_found", message: "gone" } });
    await h.run(new Date(at(301).getTime() + CANCEL_RETRY_MS));
    expect(h.calls.filter((c) => c.what === "cancel")).toHaveLength(2);
    expect(h.read().guide!.cancels).toEqual([]);
  });

  it("works out the same from the draft alone (timerWork): what to set, cancel, hand over and ring", () => {
    const s = simmering();
    expect(timerWork(s, at(241), true)).toMatchObject({ create: [{ timerId: "t1", endsAt: at(1440).toISOString() }], cancel: [], handOver: [], ring: [] });
    const set = { ...s, guide: { ...s.guide!, timers: s.guide!.timers.map((t) => ({ ...t, serverId: "tmr_1", push: "set" as const })) } };
    expect(timerWork(set, at(1436), true).handOver).toEqual(["t1"]);
    expect(timerWork(set, at(1436), false).handOver).toEqual([]);
    expect(timerWork(set, at(1440), true)).toMatchObject({ handOver: ["t1"], ring: ["t1"] });
    expect(timerWork(set, at(1500), true)).toMatchObject({ handOver: [], ring: [], quiet: ["t1"] });
  });
});

describe("too_many_timers (GC-3's limit of 10)", () => {
  const refusal: FinishAnswer<KitchenTimerResponse> = {
    ok: false,
    status: 422,
    error: { code: "validation_failed", message: "Too many timers", reason: "too_many_timers", details: { reason: "too_many_timers", max: 10 } },
  };

  it("keeps the timer running here, says it won't reach a locked phone, and rings it in the page", async () => {
    const h = harness(simmering());
    h.createAnswer = () => refusal;
    await h.run(at(241));
    expect(h.timer()).toMatchObject({ serverId: null, push: "here", pushNote: "too_many" });
    expect(timerState(h.timer(), at(600))).toBe("running");
    await h.run(at(600));
    expect(h.calls).toHaveLength(1);
    const card = timerCard(h.read(), h.read().guide!.steps.find((s) => s.key === "c-simmer")!, at(600))!;
    expect(card).toMatchObject({ state: "running", clock: "14:00", pushNote: "Rings here only: 10 timers are set already" });
    const out = renderToStaticMarkup(React.createElement(TimerCard, { timer: card, pushHint: true, on: { onStart: none, onPause: none, onResume: none, onPlus: none } }));
    expect(out).toContain("Rings here only: 10 timers are set already");
    await h.run(at(1440));
    expect(h.rings).toEqual([at(1440).getTime()]);
    expect(h.calls).toHaveLength(1);
  });

  it("reads the reason from the error, or its details", () => {
    expect(isTooManyTimers(refusal.ok ? {} : refusal.error)).toBe(true);
    expect(isTooManyTimers({ code: "validation_failed", details: { reason: "too_many_timers" } })).toBe(true);
    expect(isTooManyTimers({ code: "validation_failed", reason: "invalid" })).toBe(false);
  });

  it("any other refusal also rings here, in its own words", async () => {
    const h = harness(simmering());
    h.createAnswer = () => ({ ok: false, status: 503, error: { code: "unavailable", message: "Try later" } });
    await h.run(at(241));
    expect(h.timer()).toMatchObject({ push: "here", pushNote: "failed" });
    expect(timerCard(h.read(), h.read().guide!.steps.find((s) => s.key === "c-simmer")!, at(241))!.pushNote).toBe("Rings here only: it couldn't be set on the server");
  });
});

describe("no push on this device", () => {
  it("says how to hear timers with the phone locked, once a timer runs: You → Notifications", () => {
    const s = startTimer(markStepDone(startCooking(chooseMode(curry(), "guided", NOW), NOW), "c-oil", at(10)), "c-onions", at(20));
    const card = stepScreen(s, at(30))!.timer!;
    const on = { onStart: none, onPause: none, onResume: none, onPlus: none };
    const out = renderToStaticMarkup(React.createElement(TimerCard, { timer: card, pushHint: true, on }));
    expect(out).toContain('href="/you/notifications"');
    expect(out).toContain("Turn on notifications to hear timers with the phone locked");
    expect(renderToStaticMarkup(React.createElement(TimerCard, { timer: card, pushHint: false, on }))).not.toContain("/you/notifications");
    const idle = stepScreen(markStepDone(startCooking(chooseMode(curry(), "guided", NOW), NOW), "c-oil", at(10)), at(30))!.timer!;
    expect(renderToStaticMarkup(React.createElement(TimerCard, { timer: idle, pushHint: true, on }))).not.toContain("/you/notifications");
  });
});

describe("screen on (design §3.7)", () => {
  /** navigator.wakeLock and the page's visibility, faked: the browser lets the lock go when the page hides. */
  function fakeLock(opts: { refuse?: boolean; none?: boolean; visible?: boolean } = {}) {
    let visible = opts.visible ?? true;
    const listeners = new Set<() => void>();
    const requests: string[] = [];
    const held: { released: boolean; sentinel: WakeLockSentinelLike }[] = [];
    const env: ScreenLockEnv = {
      wakeLock: opts.none
        ? null
        : {
            request: async (type) => {
              requests.push(type);
              if (opts.refuse) throw new Error("NotAllowedError");
              const onRelease: (() => void)[] = [];
              const entry = {
                released: false,
                sentinel: {
                  release: async () => {
                    entry.released = true;
                    for (const l of onRelease) l();
                  },
                  addEventListener: (_type: "release", l: () => void) => void onRelease.push(l),
                },
              };
              held.push(entry);
              return entry.sentinel;
            },
          },
      visible: () => visible,
      onVisibility: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const setVisible = async (v: boolean) => {
      visible = v;
      if (!v) for (const h of held) if (!h.released) await h.sentinel.release();
      for (const l of [...listeners]) l();
      await flush();
    };
    return { env, requests, held, listeners, setVisible };
  }

  it("holds navigator.wakeLock 'screen' while wanted and visible, and lets it go when switched off", async () => {
    const f = fakeLock();
    const states: ScreenLockState[] = [];
    const lock = createScreenLock(f.env, (s) => states.push(s));
    lock.want(true);
    await flush();
    expect(f.requests).toEqual(["screen"]);
    expect(lock.state()).toBe("on");
    lock.want(false);
    await flush();
    expect(f.held[0]!.released).toBe(true);
    expect(states).toEqual(["on", "off"]);
  });

  it("takes it again on visibilitychange, as the browser drops it when the page hides", async () => {
    const f = fakeLock();
    const lock = createScreenLock(f.env);
    lock.want(true);
    await flush();
    await f.setVisible(false);
    expect(f.requests).toHaveLength(1);
    await f.setVisible(true);
    expect(f.requests).toHaveLength(2);
    expect(lock.state()).toBe("on");
    lock.dispose();
    await flush();
    expect(f.listeners.size).toBe(0);
    expect(f.held[1]!.released).toBe(true);
  });

  it("waits for the page to be visible before asking", async () => {
    const f = fakeLock({ visible: false });
    const lock = createScreenLock(f.env);
    lock.want(true);
    await flush();
    expect(f.requests).toEqual([]);
    await f.setVisible(true);
    expect(f.requests).toEqual(["screen"]);
    lock.dispose();
  });

  it("where it's refused or missing, says Your phone won't keep the screen on", async () => {
    const refused = createScreenLock(fakeLock({ refuse: true }).env);
    refused.want(true);
    await flush();
    expect(refused.state()).toBe("refused");
    const missing = createScreenLock(fakeLock({ none: true }).env);
    missing.want(true);
    await flush();
    expect(missing.state()).toBe("unsupported");
    expect(SCREEN_LOCK_REFUSED).toBe("Your phone won't keep the screen on");
    const card = (lockState: ScreenLockState, screenOn = true) =>
      renderToStaticMarkup(React.createElement(PingAndScreen, { pingLine: "We'll ping you when it's done", screenOn, lockState, onScreenOn: none }));
    expect(card("refused")).toContain(escaped(SCREEN_LOCK_REFUSED));
    expect(card("on")).not.toContain(escaped(SCREEN_LOCK_REFUSED));
    expect(card("refused", false)).toMatch(/role="switch" aria-checked="false"/);
    const prompt = renderToStaticMarkup(
      React.createElement(GuidePromptView, {
        view: promptView(curry(), NOW)!,
        lockState: "unsupported",
        pushHint: false,
        on: { onMinimize: none, onGuided: none, onTick: none, onSoak: none, onLongPrepDone: none, onDiscard: none },
      }),
    );
    expect(prompt).toContain(escaped(SCREEN_LOCK_REFUSED));
  });
});

describe("read aloud (design §3.7)", () => {
  function fakeSpeech(o: { fail?: boolean } = {}) {
    const said: string[] = [];
    class Utterance {
      constructor(readonly text: string) {}
    }
    return {
      said,
      env: {
        synth: {
          cancel: () => void said.push("(stop)"),
          speak: (u: unknown) => {
            if (o.fail) throw new Error("no voices");
            said.push((u as Utterance).text);
          },
        },
        Utterance,
      },
    };
  }

  it("reads the step, then its checkpoint, after stopping what was being read", () => {
    const f = fakeSpeech();
    const view = stepScreen(markStepDone(startCooking(chooseMode(curry(), "guided", NOW), NOW), "c-oil", at(10)), at(10))!;
    expect(readAloud(view.speech, f.env)).toBe(true);
    expect(f.said).toEqual(["(stop)", "Add the onions and a pinch of salt. Stir now and then.", "Until golden brown"]);
    stopReading(f.env);
    expect(f.said.at(-1)).toBe("(stop)");
  });

  it("is quiet where the phone has no speech, or nothing to say", () => {
    expect(readAloud(["Heat the oil"], { synth: null, Utterance: null })).toBe(false);
    expect(readAloud(["  "], fakeSpeech().env)).toBe(false);
    expect(readAloud(["Heat the oil"], fakeSpeech({ fail: true }).env)).toBe(false);
  });
});

describe("the bell (design §3.7)", () => {
  function fakeAudio(state = "running") {
    const started: number[] = [];
    const hz: number[] = [];
    let resumed = 0;
    const ctx: AudioContextLike & { started: number[]; hz: number[]; resumed: () => number } = {
      currentTime: 10,
      destination: {},
      state,
      resume: async () => void resumed++,
      createOscillator: () => {
        const osc = {
          type: "",
          frequency: { value: 0 },
          connect: none,
          start: (t?: number) => {
            started.push(t ?? 0);
            hz.push(osc.frequency.value);
          },
          stop: none,
        };
        return osc;
      },
      createGain: () => ({ gain: { value: 0, setValueAtTime: none, exponentialRampToValueAtTime: none }, connect: none }),
      started,
      hz,
      resumed: () => resumed,
    };
    return ctx;
  }

  beforeEach(() => resetBell());

  it("rings a short beep with Web Audio and vibrates where the phone can", () => {
    const ctx = fakeAudio();
    const vibrations: number[][] = [];
    expect(ringBell({ makeAudio: () => ctx, vibrate: (p) => (vibrations.push(p), true) })).toBe(true);
    expect(ctx.started).toEqual(BEEPS.map((b) => 10 + b.at));
    expect(ctx.hz).toEqual(BEEPS.map((b) => b.hz));
    expect(vibrations).toEqual([[...VIBRATION]]);
  });

  it("gets ready during a tap (iOS sounds only after one), and is quiet where there is neither", () => {
    const ctx = fakeAudio("suspended");
    primeBell({ makeAudio: () => ctx, vibrate: null });
    expect(ctx.resumed()).toBe(1);
    // The context made in the tap is the one that rings later.
    expect(ringBell({ makeAudio: () => fakeAudio(), vibrate: null })).toBe(true);
    expect(ctx.started).toHaveLength(BEEPS.length);
    resetBell();
    expect(ringBell({ makeAudio: null, vibrate: null })).toBe(false);
  });
});

describe("swipe between steps (design §3.3)", () => {
  const flat = () => ({ overflowX: "visible", overflowY: "visible" });
  const surface = { parentElement: null, scrollTop: 0, scrollLeft: 0, scrollHeight: 800, scrollWidth: 390, clientHeight: 800, clientWidth: 390, closest: () => null };
  const target = { ...surface, parentElement: surface };

  it("takes a sideways drag on the step — not from the left edge (swipe back), not on a field", () => {
    const claims = stepSwipeRule({ x: 200, y: 400, t: 0 }, target, surface, flat)!;
    expect(claims(-30, 4)).toBe(true);
    expect(claims(30, 4)).toBe(true);
    expect(claims(4, 30)).toBe(false);
    expect(stepSwipeRule({ x: 12, y: 400, t: 0 }, target, surface, flat)).toBeNull();
    const field = { ...target, closest: (sel: string) => (sel.includes("input") ? {} : null) };
    expect(stepSwipeRule({ x: 200, y: 400, t: 0 }, field, surface, flat)).toBeNull();
    const row = { ...target, scrollWidth: 900 };
    expect(stepSwipeRule({ x: 200, y: 400, t: 0 }, row, surface, () => ({ overflowX: "auto", overflowY: "visible" }))).toBeNull();
  });

  it("moves to the next step on a swipe left, the one before on a swipe right, far enough or flicked", () => {
    expect(stepSwipeGoes(-120, 390, 0)).toBe(1);
    expect(stepSwipeGoes(110, 390, 0)).toBe(-1);
    expect(stepSwipeGoes(-40, 390, 0.1)).toBe(0);
    expect(stepSwipeGoes(-40, 390, -0.8)).toBe(1);
    // A flick back the other way doesn't count.
    expect(stepSwipeGoes(-40, 390, 0.8)).toBe(0);
  });
});
