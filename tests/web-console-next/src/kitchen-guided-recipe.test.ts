import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CreateKitchenTimerRequest } from "@saas/contracts/kitchen";
import { KITCHEN_TIMER_ERROR_REASONS, isKitchenTimerUrl, stepTimeAt } from "@saas/contracts/kitchen";
import { resetAppConfigForTests } from "@web-console-next/lib/app-config";
import { frameRedirect, newFrame } from "@web-console-next/lib/features";
import { pathParam, redirectRules, staticPageFor } from "@web-console-next/lib/static-pages.mjs";
import { backParent } from "@web-console-next/components/kitchen/back";
import {
  factorFromQuery,
  guidedStepsOf,
  hasTimedSteps,
  learnedAt,
  learnedBadge,
  learnedOf,
  meanwhileOf,
  planNote,
  planOf,
  planSizes,
  planTotals,
  rangeText,
  recipeLongPrep,
  recipePlanHref,
  recipeReadQuery,
  stepChips,
  stepRows,
  stepTimeText,
} from "@web-console-next/components/kitchen/guided-steps";
import {
  LONG_PREP_MEMORY_MS,
  longPrepRows,
  longPrepStartLabel,
  longPrepStatus,
  longPrepTimerRequest,
  longPrepVerb,
  markLongPrep,
  parseLongPrepMemory,
  pingTimeText,
  pruneLongPrep,
  startLongPrep,
  type TimerResult,
} from "@web-console-next/components/kitchen/long-prep";
import { GuidedStepItem, LongPrepCardView } from "@web-console-next/components/kitchen/guided-views";
import { StepsSection } from "@web-console-next/components/kitchen/recipe-views";
import { PlanView } from "@web-console-next/components/kitchen/plan-views";
import { sessionHref } from "@web-console-next/components/kitchen/recipes";
import { qk } from "@web-console-next/lib/query-keys";
import { CURRY_LINES, CURRY_STEPS, RAJMA_STEPS, guidedCurry, rajma, step } from "./kitchen-guided-fixtures";
import { recipe } from "./kitchen-recipe-fixtures";

// cookpool-guided GC-6 (design §1, §2, §3.5; the canvas's `GuideTimeline`
// and soak card): the recipe page lists long prep first and each step's
// flame, its range at the page's size (`stepTimeAt`), its checkpoint, Hands
// off and what cooks learned; the plan reads every step at a size, with the
// totals, the rule in words and Meanwhile.

const MIN = 60;
const CURRY = guidedCurry();
const RAJMA = rajma();
// In the viewer's calendar, as the app's `dayText` reads it: noon on 8 Nov.
const NOW = new Date(2026, 10, 8, 12, 0);

describe("the recipe page's Steps: each step's flame, range at the page's size, checkpoint", () => {
  it("reads every step at the page's size by stepTimeAt", () => {
    for (const f of [450, 1000, 2000]) {
      const rows = stepRows(CURRY, f);
      rows.forEach((row, i) => {
        const at = stepTimeAt(CURRY_STEPS[i]!, f);
        expect(row.time).toBe(at === null ? null : "whistles" in at ? `${at.whistles} whistles` : rangeText(at.minSeconds, at.maxSeconds));
      });
    }
    expect(stepRows(CURRY, 1000).map((r) => r.time)).toEqual(["2 min", "10–12 min", "1 min", "6–8 min", "5–7 min", "20 min", "2 min", null]);
    // At 450 g, "a bit longer" steps shrink by √0.45; fixed ones stay.
    expect(stepRows(CURRY, 450).map((r) => r.time)).toEqual(["2 min", "7–8 min", "1 min", "4–5 min", "3–5 min", "20 min", "2 min", null]);
    expect(stepTimeText(RAJMA_STEPS[2]!, 2000)).toBe("3 whistles");
  });

  it("says the flame, the checkpoint by its sense, Hands off and Prep", () => {
    const rows = stepRows(CURRY, 1000);
    expect(rows.map((r) => r.flame)).toEqual(["Medium flame", "Medium flame", "Low flame", "Medium flame", "High flame", "Low flame", null, "Flame off"]);
    expect(rows.map((r) => r.checkpoint)).toEqual([
      "Until it shimmers",
      "Until it looks golden brown",
      "Until the raw smell goes",
      "Until the oil shows at the edges",
      null,
      null,
      null,
      "Until it tastes salty enough",
    ]);
    expect(rows.map((r) => r.handsOff)).toEqual([false, false, false, false, false, true, false, false]);
    expect(rows[6]!.phase).toBe("prep");
    expect(stepRows(RAJMA, 1000)[0]!.longPrep).toBe(true);
  });

  it("shows what cooks learned when the read has it, at the page's size by the step's rule — and nothing otherwise", () => {
    expect(stepRows(CURRY, 1000).map((r) => r.learned)).toEqual([null, "Usually 10–13 min · 23 cooks", null, null, null, null, null, null]);
    expect(stepRows(CURRY, 450)[1]!.learned).toBe("Usually 7–9 min · 23 cooks");
    // A read at 450 (the plan's) has them at 450 already: shown as they came, or scaled back to another size.
    const at450 = guidedCurry({ guidedSteps: CURRY_STEPS.map((s) => (s.learned ? { ...s, learned: { ...s.learned, lowSeconds: 7 * MIN, highSeconds: 9 * MIN } } : s)) });
    expect(stepRows(at450, 450, 450)[1]!.learned).toBe("Usually 7–9 min · 23 cooks");
    expect(stepRows(at450, 1000, 450)[1]!.learned).toBe("Usually 10–13 min · 23 cooks");
    expect(learnedAt({ lowSeconds: 7 * MIN, highSeconds: 9 * MIN, cooks: 3, samples: 5 }, "partly", 450, 450)).toEqual({ lowSeconds: 7 * MIN, highSeconds: 9 * MIN, cooks: 3, samples: 5 });
    // Before GC-7, no step has one.
    const before = guidedCurry({ guidedSteps: CURRY_STEPS.map(({ learned: _l, ...s }) => s) });
    expect(stepRows(before, 1000).every((r) => r.learned === null)).toBe(true);
    expect(learnedOf({ learned: null })).toBeNull();
    expect(learnedOf({ learned: { lowSeconds: 600, highSeconds: 500, cooks: 5, samples: 5 } })).toBeNull();
    expect(learnedOf({ learned: { lowSeconds: "600", highSeconds: 700, cooks: 5, samples: 5 } })).toBeNull();
    const ten = { lowSeconds: 600, highSeconds: 600, cooks: 5, samples: 7 };
    expect(learnedAt(ten, "linear", 2000)).toEqual({ lowSeconds: 1200, highSeconds: 1200, cooks: 5, samples: 7 });
    expect(learnedAt(ten, "fixed", 2000)).toEqual(ten);
    // A whistle step learns the time its count takes (GC-7), and shows it.
    expect(learnedBadge(step(0, "Cook", { whistles: 3, learned: { lowSeconds: 600, highSeconds: 720, cooks: 9, samples: 12 } }), 2000)).toBe("Usually 10–12 min · 9 cooks");
  });

  it("reads a recipe without guidedSteps as its texts", () => {
    const plain = recipe();
    expect(guidedStepsOf(plain).map((s) => s.text)).toEqual(plain.steps);
    expect(stepRows(plain, 1000).every((r) => r.flame === null && r.time === null && r.checkpoint === null)).toBe(true);
    expect(hasTimedSteps(plain)).toBe(false);
    expect(hasTimedSteps(CURRY)).toBe(true);
  });

  it("gives a step's lines as chips at the size", () => {
    expect(stepChips(CURRY_STEPS[1]!, CURRY_LINES, 450)).toEqual(["1½ onions", "Salt"]);
    expect(stepChips(CURRY_STEPS[3]!, CURRY_LINES, 1000)).toEqual(["2 tomatoes", "1 tsp garam masala"]);
  });

  it("draws each step with its parts, and The plan beside Steps", () => {
    const rows = stepRows(CURRY, 450);
    const html = renderToStaticMarkup(React.createElement(StepsSection, { steps: CURRY.steps, rows, planHref: recipePlanHref("rcp_curry", 450), initiallyOpen: true }));
    expect(html).toContain("Steps · 8");
    expect(html).toContain('href="/recipes/rcp_curry/plan?f=450"');
    expect(html).toContain("The plan");
    expect(html).toContain("Medium flame");
    expect(html).toContain("7–8 min");
    expect(html).toContain("Until it looks golden brown");
    expect(html).toContain("Hands off");
    expect(html).toContain("Usually 7–9 min · 23 cooks");
    expect(html).toContain("Don&#x27;t rush them");
    const folded = renderToStaticMarkup(React.createElement(StepsSection, { steps: CURRY.steps, rows, planHref: null }));
    expect(folded).not.toContain("The plan");
    expect(folded).not.toContain("Heat the oil");
  });

  it("draws a text-only step as its words alone", () => {
    const html = renderToStaticMarkup(React.createElement(GuidedStepItem, { row: stepRows(recipe(), 1000)[0]! }));
    expect(html).toContain("Brown the onions in the oil, about 8 min.");
    expect(html).not.toContain("flame");
    expect(html).not.toContain("Usually");
  });
});

describe("long prep first", () => {
  const [soak] = recipeLongPrep(RAJMA);

  it("is a hands-off prep step of an hour or more, as the read lists it", () => {
    expect(recipeLongPrep(RAJMA)).toEqual([{ position: 0, key: "key0", seconds: 8 * 60 * MIN, text: "Soak the rajma overnight" }]);
    expect(recipeLongPrep(CURRY)).toEqual([]);
    // Without `longPrep` on the read, its steps say.
    expect(recipeLongPrep({ steps: RAJMA.steps, guidedSteps: RAJMA_STEPS })).toEqual(recipeLongPrep(RAJMA));
  });

  it("says Soak now · ping me (or the step's own verb) and how long", () => {
    expect(longPrepStartLabel("Soak the rajma overnight")).toBe("Soak now · ping me");
    expect(longPrepVerb("Marinate the chicken in yogurt")).toBe("Marinate");
    expect(longPrepVerb("Leave the dough")).toBe("Start");
    expect(longPrepRows("rcp_rajma", recipeLongPrep(RAJMA), {}, NOW)).toEqual([
      { key: "key0", text: "Soak the rajma overnight", duration: "8 h", startLabel: "Soak now · ping me", status: { state: "todo" } },
    ]);
  });

  it("asks the server for a timer that ends after the soak and opens the recipe again", () => {
    const body = longPrepTimerRequest(RAJMA, soak!, NOW);
    expect(body).toEqual({
      label: "Rajma",
      body: "Time's up: Soak the rajma overnight",
      url: "/recipes/rcp_rajma",
      endsAt: new Date(NOW.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    });
    expect(isKitchenTimerUrl(body.url)).toBe(true);
    const linked = longPrepTimerRequest(RAJMA, soak!, NOW, "Ab3");
    expect(linked.url).toBe("/recipes/rcp_rajma?code=Ab3");
    expect(isKitchenTimerUrl(linked.url)).toBe(true);
    expect(longPrepTimerRequest({ id: "rcp_x", name: "x".repeat(70) }, { seconds: 3600, text: "y".repeat(200) }, NOW)).toMatchObject({
      label: `${"x".repeat(59)}…`,
      body: expect.stringMatching(/^Time's up: y+…$/),
    });
  });

  it("calls createTimer once, and remembers the timer it set", async () => {
    const calls: CreateKitchenTimerRequest[] = [];
    const createTimer = async (b: CreateKitchenTimerRequest): Promise<TimerResult> => {
      calls.push(b);
      return { ok: true, data: { timer: { id: "tmr_1", label: b.label, body: b.body ?? null, url: b.url ?? "/cook/session", endsAt: b.endsAt, createdAt: NOW.toISOString(), sentAt: null, canceledAt: null } } };
    };
    const r = await startLongPrep(createTimer, RAJMA, soak!, NOW);
    expect(calls).toEqual([longPrepTimerRequest(RAJMA, soak!, NOW)]);
    expect(r).toEqual({ ok: true, mark: { state: "started", at: NOW.toISOString(), endsAt: calls[0]!.endsAt, timerId: "tmr_1" } });
  });

  it("says why a timer was refused: ten running, the server's words, nothing offline", async () => {
    const refuse = (reason: string | undefined, message = "Nope") => async (): Promise<TimerResult> => ({ ok: false, status: 422, error: { code: "validation_failed", message, reason } });
    expect(await startLongPrep(refuse(KITCHEN_TIMER_ERROR_REASONS.TOO_MANY_TIMERS), RAJMA, soak!, NOW)).toEqual({
      ok: false,
      message: "You have 10 timers running. Cancel one to set this.",
    });
    expect(await startLongPrep(refuse(undefined, "Down"), RAJMA, soak!, NOW)).toEqual({ ok: false, message: "Couldn't set the timer. Down" });
    expect(await startLongPrep(refuse("offline"), RAJMA, soak!, NOW)).toEqual({ ok: false, message: null });
  });

  it("remembers Already done on this device for a day, and a started soak until its timer ends", () => {
    const done = markLongPrep({}, "rcp_rajma", "key0", { state: "done", at: NOW.toISOString() });
    expect(longPrepStatus(done, "rcp_rajma", "key0", NOW)).toEqual({ state: "done" });
    expect(longPrepRows("rcp_rajma", [soak!], done, NOW)).toEqual([]);
    expect(longPrepStatus(done, "rcp_rajma", "key0", new Date(NOW.getTime() + LONG_PREP_MEMORY_MS - 1))).toEqual({ state: "done" });
    expect(longPrepStatus(done, "rcp_rajma", "key0", new Date(NOW.getTime() + LONG_PREP_MEMORY_MS))).toEqual({ state: "todo" });
    // Another recipe's step, or another step, is still to do.
    expect(longPrepStatus(done, "rcp_other", "key0", NOW)).toEqual({ state: "todo" });

    const endsAt = new Date(NOW.getTime() + 8 * 3600_000).toISOString();
    const started = markLongPrep({}, "rcp_rajma", "key0", { state: "started", at: NOW.toISOString(), endsAt, timerId: "tmr_1" });
    expect(longPrepStatus(started, "rcp_rajma", "key0", NOW)).toEqual({ state: "started", endsAt });
    expect(longPrepStatus(started, "rcp_rajma", "key0", new Date(Date.parse(endsAt) + 1))).toEqual({ state: "done" });
    expect(longPrepStatus(started, "rcp_rajma", "key0", new Date(Date.parse(endsAt) + LONG_PREP_MEMORY_MS))).toEqual({ state: "todo" });
  });

  it("keeps only sound records, and drops them past their day", () => {
    const raw = JSON.stringify({
      "rcp_a:k": { state: "done", at: NOW.toISOString() },
      "rcp_b:k": { state: "started", at: NOW.toISOString(), endsAt: NOW.toISOString() },
      "rcp_c:k": { state: "done", at: "never" },
      "rcp_d:k": "done",
    });
    expect(Object.keys(parseLongPrepMemory(raw))).toEqual(["rcp_a:k"]);
    expect(parseLongPrepMemory("{nope")).toEqual({});
    expect(parseLongPrepMemory(null)).toEqual({});
    const old = { "rcp_a:k": { state: "done" as const, at: new Date(NOW.getTime() - LONG_PREP_MEMORY_MS).toISOString() } };
    expect(pruneLongPrep(old, NOW)).toEqual({});
  });

  it("draws the amber card: the step, how long, Soak now · ping me and Already done; once started, when we'll ping", () => {
    const rows = longPrepRows("rcp_rajma", [soak!], {}, NOW);
    const html = renderToStaticMarkup(React.createElement(LongPrepCardView, { rows, busyKey: null, error: null, endsText: (iso: string) => pingTimeText(iso, NOW), onStart: () => undefined, onDone: () => undefined }));
    expect(html).toContain("LONG PREP FIRST");
    expect(html).toContain("Soak the rajma overnight");
    expect(html).toContain("· 8 h");
    expect(html).toContain("Soak now · ping me");
    expect(html).toContain("Already done");
    expect(html).toContain("bg-[#FDF1D6]");
    const endsAt = new Date(2026, 10, 8, 20, 0).toISOString();
    const started = longPrepRows("rcp_rajma", [soak!], markLongPrep({}, "rcp_rajma", "key0", { state: "started", at: NOW.toISOString(), endsAt, timerId: "tmr_1" }), NOW);
    const startedHtml = renderToStaticMarkup(React.createElement(LongPrepCardView, { rows: started, busyKey: null, error: null, endsText: (iso: string) => pingTimeText(iso, NOW), onStart: () => undefined, onDone: () => undefined }));
    expect(startedHtml).toContain("Started · we&#x27;ll ping you at 8:00 pm");
    expect(startedHtml).not.toContain("Soak now");
    expect(startedHtml).toContain("Already done");
    expect(pingTimeText(new Date(2026, 10, 9, 6, 30).toISOString(), NOW)).toBe("tomorrow, 6:30 am");
    expect(renderToStaticMarkup(React.createElement(LongPrepCardView, { rows: [], busyKey: null, error: null, endsText: () => "", onStart: () => undefined, onDone: () => undefined }))).toBe("");
  });
});

describe("the plan: totals, each step at the size, the rule in words, Meanwhile", () => {
  it("lives at /recipes/<id>/plan, with the size when it is not the recipe's own (the seam with GC-5)", () => {
    expect(recipePlanHref("rcp_curry", 450)).toBe("/recipes/rcp_curry/plan?f=450");
    expect(recipePlanHref("rcp_curry", 1000)).toBe("/recipes/rcp_curry/plan");
    expect(recipePlanHref("rcp_curry")).toBe("/recipes/rcp_curry/plan");
    expect(recipePlanHref("rcp_curry", 450, "Ab3")).toBe("/recipes/rcp_curry/plan?f=450&code=Ab3");
    expect(factorFromQuery("450")).toBe(450);
    expect(factorFromQuery("99999")).toBe(20_000);
    expect([factorFromQuery(null), factorFromQuery(""), factorFromQuery("x"), factorFromQuery("-5")]).toEqual([null, null, null, null]);
  });

  it("switches between the size it was opened at and the recipe's own", () => {
    expect(planSizes(CURRY, 450)).toEqual([
      { factorMilli: 450, label: "450 g · about 2" },
      { factorMilli: 1000, label: "1 kg · 4" },
    ]);
    expect(planSizes(CURRY, null)).toEqual([{ factorMilli: 1000, label: "1 kg · 4" }]);
    expect(planSizes(CURRY, 1000)).toHaveLength(1);
  });

  it("totals every timed step's middle at the size: in all, hands on, waiting", () => {
    expect(planTotals(planOf(CURRY, 1000).totals)).toEqual([
      { label: "In all", value: "49 min" },
      { label: "Hands on", value: "29 min" },
      { label: "Waiting", value: "20 min" },
    ]);
    expect(planTotals(planOf(CURRY, 450).totals)).toEqual([
      { label: "In all", value: "41 min" },
      { label: "Hands on", value: "21 min" },
      { label: "Waiting", value: "20 min" },
    ]);
    // The same sums from stepTimeAt itself, at any size.
    for (const f of [250, 450, 1000, 1500, 3000]) {
      const mids = CURRY_STEPS.map((s) => {
        const at = stepTimeAt(s, f);
        return at && !("whistles" in at) ? (at.minSeconds + at.maxSeconds) / 2 : 0;
      });
      const all = Math.round(mids.reduce((a, b) => a + b, 0) / 60);
      const handsOn = Math.round(mids.filter((_, i) => !CURRY_STEPS[i]!.handsOff).reduce((a, b) => a + b, 0) / 60);
      expect(planOf(CURRY, f).totals).toEqual({ allSeconds: all * 60, handsOnSeconds: handsOn * 60, waitingSeconds: (all - handsOn) * 60 });
    }
  });

  it("reads each row's range at the size, its learned badge and its rule in words", () => {
    const rows = planOf(CURRY, 450).rows;
    expect(rows.map((r) => r.time)).toEqual(stepRows(CURRY, 450).map((r) => r.time));
    expect(rows.map((r) => r.rule)).toEqual([
      "Same at any size",
      "Partly follows the amount",
      "Same at any size",
      "Partly follows the amount",
      "Partly follows the amount",
      "Same at any size",
      "Same at any size",
      null,
    ]);
    expect(planOf(guidedCurry({ guidedSteps: [step(0, "Boil the rice", { minSeconds: 600, maxSeconds: 600, timeRule: "linear" })] }), 2000).rows[0]).toMatchObject({
      time: "20 min",
      rule: "Follows the amount",
    });
    expect(rows[1]!.learned).toBe("Usually 7–9 min · 23 cooks");
    expect(rows.filter((r) => r.learned !== null)).toHaveLength(1);
    // The bar against the longest step (the simmer), never under 4%; none without minutes.
    expect(rows[5]!.bar).toBe(100);
    expect(rows[2]!.bar).toBe(5);
    expect(rows[7]!.bar).toBe(0);
  });

  it("names the next steps under a hands-off step, up to the next wait", () => {
    const rows = planOf(CURRY, 1000).rows;
    expect(rows[5]!.meanwhile).toBe("Meanwhile: Chop the coriander · Flame off, coriander, taste");
    expect(rows.filter((r) => r.meanwhile !== null)).toHaveLength(1);
    const r = planOf(RAJMA, 1000).rows;
    // The whistles: until the simmer, the next wait. Long prep has no Meanwhile, nor does the last wait.
    expect(r.map((x) => x.meanwhile)).toEqual([null, null, "Meanwhile: Fry the onion", null, null]);
    const many = ["Wait", "One.", "Two", "Three", "Four", "Five"].map((text, i) => step(i, text, { handsOff: i === 0, minSeconds: 600 }));
    expect(meanwhileOf(many, 0)).toBe("Meanwhile: One · Two · Three · +2 more");
  });

  it("keeps long prep and whistles out of the totals, and says so", () => {
    const plan = planOf(RAJMA, 1000);
    expect(plan.totals).toEqual({ allSeconds: 28 * MIN, handsOnSeconds: 11 * MIN, waitingSeconds: 17 * MIN });
    expect(plan.rows[0]).toMatchObject({ longPrep: true, time: "8–10 h" });
    expect(plan.rows[2]).toMatchObject({ time: "3 whistles", rule: "Same at any size", bar: 0 });
    // Bars are against the cooking's longest step (the simmer), not the soak.
    expect(plan.rows.map((r) => r.bar)).toEqual([0, 20, 0, 40, 100]);
    expect(planNote(plan)).toBe("Long prep (8 h) comes first and isn't counted. Whistle steps aren't counted: their time is the cooker's.");
    expect(planNote(planOf(CURRY, 1000))).toBeNull();
  });

  it("draws the switch, the totals, the rows and Start step by step at the size", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanView, { name: CURRY.name, plan: planOf(CURRY, 450), sizes: planSizes(CURRY, 450), onSize: () => undefined, startHref: sessionHref("rcp_curry", 450) }),
    );
    expect(html).toContain("The plan");
    expect(html).toContain("Chicken curry");
    expect(html).toMatch(/aria-pressed="true"[^>]*>450 g · about 2/);
    expect(html).toContain("1 kg · 4");
    for (const words of ["In all", "41 min", "Hands on", "21 min", "Waiting", "20 min", "7–8 min", "Partly follows the amount", "Usually 7–9 min · 23 cooks", "20 min · hands off"]) {
      expect(html).toContain(words);
    }
    expect(html).toContain("Meanwhile: Chop the coriander · Flame off, coriander, taste");
    expect(html).toContain('href="/cook/session?recipe=rcp_curry&amp;f=450"');
    expect(html).toContain("Start step by step");
    // A hands-off step's number is tinted.
    expect(html).toMatch(/bg-cp-herb-tint text-\[#165C3A\][^>]*>6</);
  });

  it("reads the recipe at its size (GC-7's ?f=), under the recipe's own key so writes reach it", () => {
    expect(recipeReadQuery(null, 450)).toEqual({ f: 450 });
    expect(recipeReadQuery("Ab3", 1000)).toEqual({ code: "Ab3", f: 1000 });
    expect(recipeReadQuery("Ab3")).toEqual({ code: "Ab3" });
    expect(recipeReadQuery()).toEqual({});
    expect(recipeReadQuery(null, 99_999)).toEqual({ f: 20_000 });
    const own = qk.kitchenRecipe("rcp_curry");
    expect(qk.kitchenRecipeAt("rcp_curry", 450).slice(0, own.length)).toEqual([...own]);
    expect(qk.kitchenRecipeAt("rcp_curry", 450)).not.toEqual(qk.kitchenRecipeAt("rcp_curry", 1000));
  });

  it("starts the session at the size on screen", () => {
    expect(sessionHref("rcp_curry", 450)).toBe("/cook/session?recipe=rcp_curry&f=450");
    expect(sessionHref("rcp_curry", 1000)).toBe("/cook/session?recipe=rcp_curry&f=1000");
  });
});

describe("the plan exists only in the new frame", () => {
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

  it("sends a prod visitor Home, and shows on stage", () => {
    expect(frameRedirect("/recipes/:recipeId/plan", false)).toBe("/home");
    expect(frameRedirect("/recipes/:recipeId/plan", true)).toBeNull();
    expect(onHost("cookpool.store", () => frameRedirect("/recipes/:recipeId/plan", newFrame()))).toBe("/home");
    expect(onHost("stage.cookpool.store", () => frameRedirect("/recipes/:recipeId/plan", newFrame()))).toBeNull();
  });

  it("is the recipe's static shell, and goes back to its recipe", () => {
    expect(staticPageFor("/recipes/rcp_1/plan")).toBe("/recipes/:recipeId/plan");
    expect(pathParam("/recipes/:recipeId", "recipeId", "/recipes/rcp_1/plan")).toBe("rcp_1");
    expect(redirectRules()).toContain("/recipes/:recipeId/plan /recipes/_/plan 200");
    expect(backParent("/recipes/rcp_1/plan", {}, { newFrame: true })).toBe("/recipes/rcp_1");
  });
});
