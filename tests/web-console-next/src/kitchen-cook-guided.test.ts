import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { frameRedirect } from "@web-console-next/lib/features";
import { createCookSessionStore, type SessionStorageLike } from "@web-console-next/lib/cook-session-store";
import {
  finishPlan,
  parseSession,
  refreshTakes,
  sessionFromRecipe,
  tickLine,
  type CookSession,
} from "@web-console-next/components/kitchen/cook-session";
import {
  backToSteps,
  chooseMode,
  countWhistle,
  goToStep,
  guideFromRecipe,
  guidedScreen,
  guidedSessionFromRecipe,
  longPrepDone,
  longPrepMarks,
  markStepDone,
  serverTimerIds,
  startAndGoOn,
  startCooking,
  startTimer,
  stepBy,
  tickPrep,
  tickTool,
  timerLabel,
  timerWord,
  todaysStepTimes,
  withLongPrepMemory,
  writtenStepTimes,
} from "@web-console-next/components/kitchen/cook-guided";
import {
  chipLabel,
  doneScreen,
  meanwhile,
  planHref,
  prepScreen,
  promptView,
  speechFor,
  stepScreen,
  timerBanner,
  timerStrip,
  waitScreen,
} from "@web-console-next/components/kitchen/cook-guided-screens";
import { guideStepLog } from "@web-console-next/components/kitchen/cook-guide-draft";
import {
  GuideDoneView,
  GuidePrepView,
  GuidePromptView,
  GuideStepView,
  GuideWaitView,
  type DoneHandlers,
  type PrepHandlers,
  type PromptHandlers,
  type WaitHandlers,
} from "@web-console-next/components/kitchen/cook-guided-ui";
import { FLAT, ME, MEERA } from "./kitchen-pantry-fixtures";
import { CURRY, CURRY_ID, CURRY_MATCH, ITEMS, NOW, RAJMA, RAJMA_MATCH, at, curry, rajma } from "./kitchen-cook-guided-fixtures";

// cookpool-guided GC-5 (design §3, §5's posting): a recipe with steps cooks
// step by step in RC-6's session — the prompt, Before you start, one step at
// a time with its flame, chips, checkpoint and timer, waiting with Meanwhile
// and whistles, Done with each step's time, and the step log posted with the
// dish. "Just tick what I use" is RC-6's screen, unchanged.

const none = () => undefined;

/** A copy of `o` without `keys`. */
function without<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...o };
  for (const k of keys) delete copy[k];
  return copy;
}
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (text: string, needle: string) => text.split(needle).length - 1;

/** The curry, Start step by step pressed and Start cooking at NOW: step 1 is open. */
function cooking(): CookSession {
  return startCooking(chooseMode(curry(), "guided", NOW), NOW);
}

/**
 * A whole cook of the curry, from NOW: each step's Done at its second, the
 * simmer started and gone on from, ticked from the strip after its 20 min,
 * then Finish on the last step at 37 min.
 */
function cookedCurry(): CookSession {
  let s = cooking();
  s = markStepDone(s, "c-oil", at(90));
  s = markStepDone(s, "c-onions", at(750));
  s = markStepDone(s, "c-sear", at(870));
  s = markStepDone(s, "c-yogurt", at(930));
  s = startAndGoOn(s, "c-simmer", at(930));
  s = markStepDone(s, "c-coriander", at(990));
  s = markStepDone(s, "c-check", at(1050));
  s = goToStep(s, "c-simmer", at(2130));
  s = markStepDone(s, "c-simmer", at(2160));
  return markStepDone(s, "c-salt", at(2220));
}

function memoryStorage(): SessionStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

const stepOn = {
  onMinimize: none,
  onReadAloud: none,
  onTickChip: none,
  onStart: none,
  onPause: none,
  onResume: none,
  onPlus: none,
  onBack: none,
  onDone: none,
  onStrip: none,
};
const waitOn: WaitHandlers = { ...stepOn, onCountWhistle: none, onWhistleHelp: none, onScreenOn: none, onMeanwhile: none, onGoOn: none };
const promptOn: PromptHandlers = { onMinimize: none, onGuided: none, onTick: none, onSoak: none, onLongPrepDone: none, onDiscard: none };
const prepOn: PrepHandlers = {
  onMinimize: none,
  onTickLine: none,
  onToggleLine: none,
  onStepLine: none,
  onTickTool: none,
  onTickPrep: none,
  onStartPrep: none,
  onStrip: none,
  onStart: none,
  onDiscard: none,
};
const doneOn: DoneHandlers = { onMinimize: none, onBackToSteps: none, onUseTimes: none, onWhoAte: none, onStrip: none, onDiscard: none };

describe("the draft (design §3)", () => {
  it("gains a guide from a recipe with guided steps: its steps and tools, nothing chosen, ticked or timed", () => {
    const g = curry().guide!;
    expect(g).toMatchObject({ mode: null, screen: "prep", current: null, cookStartedAt: null, timers: [], cancels: [], prepDone: [], toolsDone: [], screenOn: true, timesSaved: false });
    expect(g.steps.map((s) => s.key)).toEqual(CURRY.guidedSteps!.map((s) => s.key));
    expect(g.tools).toEqual(["Kadai with a lid", "Knife and board"]);
    // GC-7's learned range comes along with its step.
    expect(g.steps.find((s) => s.key === "c-onions")!.learned).toEqual({ lowSeconds: 420, highSeconds: 540, cooks: 23, samples: 40 });
    // RC-6's session is all there, as before.
    const rc6 = without(curry(), "guide");
    expect(rc6).toEqual(refreshTakes(sessionFromRecipe(CURRY, null, CURRY_MATCH, NOW), ITEMS));
  });

  it("has none for a recipe without guided steps: it skips the prompt and cooks as RC-6's session", () => {
    // A recipe read before GC-2 has no guided steps at all.
    const plain: KitchenRecipe = without(CURRY, "guidedSteps", "tools", "longPrep");
    expect(guideFromRecipe(plain)).toBeNull();
    expect(guideFromRecipe({ ...CURRY, guidedSteps: [] })).toBeNull();
    const s = guidedSessionFromRecipe(plain, null, CURRY_MATCH, NOW);
    expect("guide" in s).toBe(false);
    expect(s).toEqual(sessionFromRecipe(plain, null, CURRY_MATCH, NOW));
    expect(guidedScreen(s, true)).toBeNull();
  });

  it("keeps the mode, the step shown, each step's start and tick, the ticks and the running timers", () => {
    let s = cooking();
    expect(s.guide).toMatchObject({ mode: "guided", screen: "step", current: "c-oil", cookStartedAt: NOW.toISOString() });
    expect(s.guide!.times["c-oil"]).toEqual({ startedAt: NOW.toISOString(), doneAt: null });
    s = markStepDone(s, "c-oil", at(90));
    expect(s.guide!.times["c-oil"]).toEqual({ startedAt: NOW.toISOString(), doneAt: at(90).toISOString() });
    expect(s.guide).toMatchObject({ current: "c-onions" });
    s = tickTool(tickPrep(s, "p-chop", at(95)), 1);
    expect(s.guide).toMatchObject({ prepDone: ["p-chop"], toolsDone: [1] });
    s = startTimer(s, "c-onions", at(100));
    expect(s.guide!.timers).toEqual([
      {
        id: "t1",
        stepKey: "c-onions",
        label: "Step 2 done · Chicken curry",
        body: "Next: Add the chicken and sear it",
        endsAt: at(520).toISOString(),
        pausedLeftMs: null,
        totalMs: 420_000,
        serverId: null,
        push: "pending",
        pushNote: null,
        rang: false,
        seen: false,
      },
    ]);
  });

  it("survives a reload: a fresh store reads the same guide back, timers and all", () => {
    const storage = memoryStorage();
    const before = createCookSessionStore({ storage: () => storage, prefix: () => "cookpool.next" });
    const s = startAndGoOn(startTimer(markStepDone(cooking(), "c-oil", at(60)), "c-onions", at(61)), "p-rub", at(62));
    before.write(ME, s);
    const after = createCookSessionStore({ storage: () => storage, prefix: () => "cookpool.next" });
    const back = after.read(ME)!;
    expect(back).toEqual(s);
    expect(guidedScreen(back, true)).toBe("step");
    expect(stepScreen(back, at(120))!.header).toBe("STEP 2 OF 8 · 2 MIN IN");
  });

  it("drops a guide it can't read, and keeps the session's lines; a draft from before guided mode reads as it was", () => {
    const s = curry();
    const bad = parseSession(JSON.stringify({ ...s, guide: { ...s.guide, mode: "sometimes" } }))!;
    expect("guide" in bad).toBe(false);
    expect(bad.lines).toEqual(s.lines);
    expect(parseSession(JSON.stringify({ ...s, guide: { ...s.guide, timers: [{ id: 1 }] } }))!.guide).toBeUndefined();
    const old = without(s, "guide");
    expect(parseSession(JSON.stringify(old))).toEqual(old);
    expect(parseSession(JSON.stringify(s))).toEqual(s);
  });

  it("shows the prompt, then Before you start, a step or Done — only in the new frame", () => {
    expect(guidedScreen(curry(), true)).toBe("prompt");
    expect(guidedScreen(chooseMode(curry(), "guided", NOW), true)).toBe("prep");
    expect(guidedScreen(cooking(), true)).toBe("step");
    expect(guidedScreen(cookedCurry(), true)).toBe("done");
    expect(guidedScreen(cooking(), false)).toBeNull();
    expect(guidedScreen(null, true)).toBeNull();
  });
});

describe("the prompt (GuidePrompt, design §3.1)", () => {
  it("says how it cooks: the steps, about how long and how much hands on, a bar, and what comes before", () => {
    const v = promptView(curry(), NOW)!;
    expect(v).toMatchObject({ title: "Chicken curry", chip: "For about 2 · ×0.45", longPrep: [], dimmed: false, startSub: null });
    expect(v.sub).toBe("Each step, its flame, a timer and when it's done");
    expect(v.stats).toEqual([
      { value: "8", label: "Steps" },
      { value: "about 54", label: "Minutes" },
      { value: "19", label: "Hands on" },
    ]);
    // Prep, then the cook steps, each its time at this size; the rest and the simmer wait.
    expect(v.bar.map((b) => [b.minutes, b.handsOff])).toEqual([
      [3, false],
      [15, true],
      [2, false],
      [8, false],
      [2, false],
      [1, false],
      [20, true],
      [1, false],
      [1, false],
      [1, false],
    ]);
    expect(v.barLabel).toBe("About 54 minutes: 19 hands on, 35 waiting");
    expect(v.before).toEqual([
      "Chop the onions finely · about 3 min",
      "Rub the chicken with turmeric and salt, and let it rest · 15 min hands off, with a timer",
      "Kadai with a lid",
      "Knife and board",
    ]);
  });

  it("offers Start step by step (the main button, on the accent since RV-4) and Just tick what I use", () => {
    const out = html(React.createElement(GuidePromptView, { view: promptView(curry(), NOW)!, lockState: "off", pushHint: false, on: promptOn }));
    expect(out).toContain("Cook it step by step");
    expect(out).toContain(">Start step by step<");
    expect(out).toContain(">Just tick what I use<");
    expect(out).toContain("bg-primary text-primary-foreground");
    expect(out).toContain('data-dimmed="false"');
    expect(out).toContain("BEFORE YOU START");
    expect(out).toContain("Your screen stays on while you cook");
    expect(out).not.toContain("data-long-prep");
  });

  it("puts long prep first, as an amber card with Soak now · ping me and Already done, and dims the guided card until then", () => {
    const s = rajma();
    const v = promptView(s, NOW)!;
    expect(v.longPrep).toEqual([
      {
        key: "r-soak",
        title: "Soak the rajma in plenty of water · 8 h first",
        lines: ["200 g rajma"],
        sub: "Long prep, so it shows before anything else",
        state: "idle",
        startLabel: "Soak now · ping me",
        doneLabel: "Already done",
        timerId: null,
        pushNote: null,
      },
    ]);
    expect(v).toMatchObject({ dimmed: true, sub: "Starts after the long prep", startSub: "After: Soak the rajma in plenty of water" });
    const out = html(React.createElement(GuidePromptView, { view: v, lockState: "off", pushHint: false, on: promptOn }));
    expect(out.indexOf('data-long-prep="idle"')).toBeLessThan(out.indexOf("Cook it step by step"));
    expect(out).toContain("bg-cp-soon-tint");
    expect(out).toContain(">Soak now · ping me<");
    expect(out).toContain(">Already done<");
    expect(out).toContain('data-dimmed="true"');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>.*Start step by step/);
  });

  it("Soak now starts that step's own time, to ping back to this session; Already done wakes the guided card", () => {
    let s = startTimer(rajma(), "r-soak", NOW);
    const t = s.guide!.timers[0]!;
    expect(t).toMatchObject({ stepKey: "r-soak", label: "Soak done · Rajma", body: "Next: start cooking", endsAt: at(28_800).toISOString(), push: "pending" });
    expect(promptView(s, at(60))!.longPrep[0]).toMatchObject({ state: "running", sub: "7 h 59 min left · we'll ping you", doneLabel: "Already done" });
    expect(promptView(s, at(28_800))!.longPrep[0]).toMatchObject({ state: "ended", sub: "Time's up", doneLabel: "Done" });
    expect(promptView(s, at(60))!.dimmed).toBe(true);
    s = longPrepDone(s, "r-soak", at(28_810));
    expect(s.guide!.timers).toEqual([]);
    expect(promptView(s, at(28_810))).toMatchObject({ dimmed: false, startSub: null, longPrep: [{ state: "done", sub: "Done" }] });
    expect(longPrepDone(s, "r-soak", at(28_900))).toBe(s);
  });
});

describe("long prep, with the recipe page (GC-6)", () => {
  const key = `${rajma().recipeId}:r-soak`;

  it("is done here when it was Already done there (or its timer ended)", () => {
    const s = withLongPrepMemory(rajma(), { [key]: { state: "done", at: at(-3600).toISOString() } }, NOW);
    expect(s.guide!.prepDone).toEqual(["r-soak"]);
    expect(promptView(s, NOW)!.dimmed).toBe(false);
    const ended = withLongPrepMemory(rajma(), { [key]: { state: "started", at: at(-30_000).toISOString(), endsAt: at(-1_200).toISOString(), timerId: "tmr_page" } }, NOW);
    expect(ended.guide!.prepDone).toEqual(["r-soak"]);
  });

  it("runs here with the same server timer when it was started there: no second soak", () => {
    const memory = { [key]: { state: "started" as const, at: at(-3600).toISOString(), endsAt: at(25_200).toISOString(), timerId: "tmr_page" } };
    const s = withLongPrepMemory(rajma(), memory, NOW);
    expect(s.guide!.timers).toEqual([
      expect.objectContaining({ stepKey: "r-soak", endsAt: at(25_200).toISOString(), totalMs: 28_800_000, serverId: "tmr_page", push: "set" }),
    ]);
    expect(s.guide!.times["r-soak"]!.startedAt).toBe(at(-3600).toISOString());
    expect(promptView(s, NOW)!.longPrep[0]).toMatchObject({ state: "running", sub: "7 h left · we'll ping you" });
    // A session that knows already is left as it is; nothing remembered, nothing changes.
    expect(withLongPrepMemory(s, memory, NOW)).toEqual(s);
    expect(withLongPrepMemory(rajma(), {}, NOW)).toEqual(rajma());
  });

  it("tells the recipe page what this session did: done, or started with its server timer", () => {
    let s = startTimer(rajma(), "r-soak", NOW);
    expect(longPrepMarks(s)).toEqual({});
    s = { ...s, guide: { ...s.guide!, timers: s.guide!.timers.map((t) => ({ ...t, serverId: "tmr_soak", push: "set" as const })) } };
    expect(longPrepMarks(s)).toEqual({ [key]: { state: "started", at: NOW.toISOString(), endsAt: at(28_800).toISOString(), timerId: "tmr_soak" } });
    // Discard and Finish leave the soak pinging; Already done cancels it.
    expect(serverTimerIds(s)).toEqual([]);
    const done = longPrepDone(s, "r-soak", at(60));
    expect(done.guide!.cancels).toEqual(["tmr_soak"]);
    expect(longPrepMarks(done)).toEqual({ [key]: { state: "done", at: at(60).toISOString() } });
  });
});

describe("Before you start (GuidePrep, design §3.2)", () => {
  const prep = () => chooseMode(curry(), "guided", NOW);

  it("lists Gather (the session's lines, the same ticks), Tools and Prep, and counts what is ready", () => {
    const v = prepScreen(prep(), NOW)!;
    expect(v.header).toBe("CHICKEN CURRY · FOR ABOUT 2 · ×0.45");
    expect(v.tools.map((t) => [t.name, t.ticked])).toEqual([
      ["Kadai with a lid", false],
      ["Knife and board", false],
    ]);
    expect(v.prep).toEqual([
      { key: "p-chop", text: "Chop the onions finely", sub: "2 onions · about 3 min", ticked: false, checkLabel: "Tick Chop the onions finely", timer: null },
      {
        key: "p-rub",
        text: "Rub the chicken with turmeric and salt, and let it rest",
        sub: "450 g chicken · Salt · 15 min · hands off",
        ticked: false,
        checkLabel: "Tick Rub the chicken with turmeric and salt, and let it rest",
        timer: { label: "Start 15 min", state: "idle", timerId: null },
      },
    ]);
    // Five lines can be ticked (the yogurt isn't in your pantries), two tools, two prep.
    expect(v.ready.text).toBe("0 of 9 ready");
    const ticked = tickPrep(tickTool(tickLine(prep(), "r:0"), 0), "p-chop", NOW);
    expect(prepScreen(ticked, NOW)!.ready).toEqual({ done: 3, of: 9, text: "3 of 9 ready" });
    // A Gather tick is the session's own: RC-6's line, ticked.
    expect(ticked.lines[0]!.ticked).toBe(true);
    expect(v).toMatchObject({ startTitle: "Start cooking", startSub: "Step 1 of 8" });
  });

  it("starts a hands-off prep step's timer, which joins the strip", () => {
    const s = startTimer(prep(), "p-rub", NOW);
    expect(prepScreen(s, at(60))!.prep[1]!.timer).toEqual({ label: "14:00", state: "running", timerId: "t1" });
    expect(timerStrip(s, at(60), null)).toEqual([{ id: "t1", stepKey: "p-rub", phase: "prep", label: "Rest · prep", left: "14:00", ended: false }]);
    expect(prepScreen(s, at(900))!.prep[1]!.timer!.label).toBe("Ready");
    // Ticking it stops the timer.
    const ticked = tickPrep(s, "p-rub", at(910));
    expect(ticked.guide!.timers).toEqual([]);
    expect(prepScreen(ticked, at(910))!.prep[1]!.timer).toBeNull();
  });

  it("draws 44 px ticks, Start N min and the main button: Start cooking · Step 1 of N", () => {
    const s = prep();
    const out = html(React.createElement(GuidePrepView, { view: prepScreen(s, NOW)!, gather: [], openKey: null, strip: [], on: prepOn }));
    expect(out).toContain("Before you start");
    expect(out).toContain("0 of 9 ready");
    expect(out).toContain("h-11 w-11");
    expect(out).toContain(">Start 15 min<");
    expect(out).toContain("Start cooking");
    expect(out).toContain("Step 1 of 8");
  });

  it("Start cooking opens the first step not ticked, and the cooking's clock starts", () => {
    const s = startCooking(prep(), at(300));
    expect(s.guide).toMatchObject({ screen: "step", current: "c-oil", cookStartedAt: at(300).toISOString() });
    expect(prepScreen(markStepDone(s, "c-oil", at(400)), at(400))).toMatchObject({ startTitle: "Back to cooking", startSub: "Step 2 of 8" });
  });
});

describe("a step (GuideStep, design §3.3)", () => {
  const onions = () => markStepDone(cooking(), "c-oil", at(90));

  it("heads it STEP k OF N · M MIN IN, one segment per step, with the plan at this size", () => {
    const v = stepScreen(onions(), at(200))!;
    expect(v).toMatchObject({ number: 2, of: 8, header: "STEP 2 OF 8 · 3 MIN IN", progressLabel: "Step 2 of 8" });
    expect(v.segments).toEqual(["done", "current", "todo", "todo", "todo", "todo", "todo", "todo"]);
    expect(v.planHref).toBe(`/recipes/${CURRY_ID}/plan?f=450`);
    expect(planHref({ recipeId: null, factorMilli: null })).toBeNull();
  });

  it("shows the flame, the step's lines as scaled chips, the checkpoint, the timer at this size with its learned range, and the tip", () => {
    const v = stepScreen(onions(), at(200))!;
    expect(v.flame).toEqual({ level: 2, label: "Medium flame", hint: null });
    expect(v.text).toBe("Add the onions and a pinch of salt. Stir now and then.");
    expect(v.chips).toEqual([
      { key: "r:1", label: "2 onions", ticked: false, tickable: true, checkLabel: "Tick Onions" },
      { key: "r:4", label: "Salt", ticked: false, tickable: true, checkLabel: "Tick Salt" },
    ]);
    expect(v.checkpoint).toEqual({ sense: "look", word: "LOOK FOR", text: "Until golden brown" });
    expect(v.timer).toEqual({
      timerId: null,
      state: "idle",
      // The timer starts at the low end of what cooks usually take (GC-7).
      clock: "7:00",
      fraction: 0,
      // 8–10 min as written, × 0.45^0.5.
      range: "5–7 min at this size",
      learned: "Usually 7–9 min at this size · 23 cooks",
      handsOff: false,
      startLabel: "Start",
      pushNote: null,
    });
    expect(v.tip).toBe("Do not rush them: browner onions, deeper curry.");
    expect(v.next).toBe("Next · Add the chicken and sear it");
    expect(v.mainLabel).toBe("Done");
    expect(v.speech).toEqual(["Add the onions and a pinch of salt. Stir now and then.", "Until golden brown"]);
  });

  // RV-4 (the canvas's `RvCookStep`): the dish's name, a thin bar and "2 of 8", one heat and time chip,
  // the step in big type, what to watch for in one line, the timer chip, the lines as chips, Add amounts quiet.
  it("draws it: the bar, one heat chip, big type, the check line, the timer chip, 44 px chips, Done on the accent", () => {
    const out = html(React.createElement(GuideStepView, { view: stepScreen(onions(), at(200))!, strip: [], pushHint: false, on: { ...stepOn, onAddAmounts: () => undefined } }));
    expect(out).toContain('data-heat="2"');
    expect(out).toContain("Medium flame · 5–7 min");
    expect(out).toContain("text-[30px]");
    expect(out).toMatch(/role="progressbar"[^>]*aria-valuenow="2"/);
    expect(out).toContain(">2 of 8<");
    expect(out).toContain(">Chicken curry<");
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain("min-h-11");
    expect(out).toContain("Look for: ");
    expect(out).toContain("Until golden brown");
    expect(out).toContain("Usually 7–9 min at this size · 23 cooks");
    expect(out).toContain(">Start<");
    expect(out).toContain(">Add amounts<");
    expect(out).toContain("Tip: Do not rush them");
    expect(out).toContain("bg-primary text-primary-foreground");
    expect(out).not.toContain("font-extrabold");
    expect(out).toContain('aria-label="Read this step aloud"');
    expect(out).toContain(`href="/recipes/${CURRY_ID}/plan?f=450"`);
    expect(out).toContain('aria-label="Previous step"');
  });

  it("shows no learned line where nothing has been learned, and only what a step has", () => {
    const first = stepScreen(cooking(), NOW)!;
    expect(first.timer).toMatchObject({ learned: null, range: "1–2 min at this size", clock: "1:00" });
    expect(html(React.createElement(GuideStepView, { view: first, strip: [], pushHint: false, on: stepOn }))).not.toContain("Usually");
    const coriander = stepScreen(goToStep(cooking(), "c-coriander", NOW), NOW)!;
    expect(coriander).toMatchObject({ flame: null, checkpoint: null, timer: null, whistles: null, tip: null, chips: [] });
    const out = html(React.createElement(GuideStepView, { view: coriander, strip: [], pushHint: false, on: stepOn }));
    expect(out).not.toContain("flame");
    expect(out).not.toContain('role="timer"');
  });

  it("says each flame and sense in words, the checkpoint once", () => {
    const sear = stepScreen(goToStep(cooking(), "c-sear", NOW), NOW)!;
    expect(sear.flame).toEqual({ level: 3, label: "High flame", hint: "Stay close" });
    expect(sear.chips.map((c) => c.label)).toEqual(["450 g chicken"]);
    expect(sear.timer!.range).toBe("2 min at this size");
    const yogurt = stepScreen(goToStep(cooking(), "c-yogurt", NOW), NOW)!;
    expect(yogurt.checkpoint).toEqual({ sense: "smell", word: "SMELL FOR", text: "Until the raw smell goes" });
    // The yogurt isn't in your pantries: its chip can't be ticked.
    expect(yogurt.chips).toEqual([
      { key: "r:2", label: "90 g yogurt", ticked: false, tickable: false, checkLabel: "Tick Yogurt" },
      { key: "r:3", label: "½ tsp garam masala", ticked: false, tickable: true, checkLabel: "Tick Garam masala" },
    ]);
    const salt = stepScreen(goToStep(cooking(), "c-salt", NOW), NOW)!;
    expect(salt.flame).toEqual({ level: 0, label: "Flame off", hint: null });
    expect(salt.checkpoint).toEqual({ sense: "taste", word: "TASTE FOR", text: "Until the salt is right" });
    expect(speechFor({ text: "Stir", sense: null, checkpoint: "Until thick" })).toEqual(["Stir", "Until thick"]);
    expect(chipLabel({ name: "Cooking oil", qtyMilli: 15_000, unit: "tbsp" })).toBe("1 tbsp cooking oil");
  });

  it("ticks the session's own lines from its chips", () => {
    const s = tickLine(onions(), "r:1");
    expect(stepScreen(s, at(200))!.chips[0]).toMatchObject({ ticked: true, checkLabel: "Untick Onions" });
    expect(s.lines.find((l) => l.key === "r:1")!.ticked).toBe(true);
  });

  it("Done ticks it and opens the next; the last step reads Finish and opens Done", () => {
    let s = onions();
    expect(s.guide!.times["c-onions"]!.startedAt).toBe(at(90).toISOString());
    s = markStepDone(s, "c-onions", at(700));
    expect(s.guide).toMatchObject({ current: "c-sear" });
    expect(s.guide!.times["c-onions"]).toEqual({ startedAt: at(90).toISOString(), doneAt: at(700).toISOString() });
    const last = goToStep(s, "c-salt", at(800));
    expect(stepScreen(last, at(800))!).toMatchObject({ mainLabel: "Finish", next: "Next · Finish" });
    const done = markStepDone(last, "c-salt", at(900));
    expect(done.guide).toMatchObject({ screen: "done", finishedAt: at(900).toISOString() });
    // Back to the steps, and Done again, keeps what was ticked.
    const back = backToSteps(done, at(950));
    expect(back.guide).toMatchObject({ screen: "step", current: "c-salt", finishedAt: null });
    expect(back.guide!.times["c-salt"]!.doneAt).toBe(at(900).toISOString());
  });

  it("swiping (and Back) only looks: a step looked at hasn't started; Back from the first is Before you start", () => {
    let s = stepBy(cooking(), 1, at(30));
    expect(s.guide).toMatchObject({ current: "c-onions" });
    expect(s.guide!.times["c-onions"]).toBeUndefined();
    s = stepBy(stepBy(s, -1, at(40)), -1, at(41));
    expect(s.guide).toMatchObject({ screen: "prep", current: null });
    const end = goToStep(cooking(), "c-salt", NOW, "look");
    expect(stepBy(end, 1, NOW)).toBe(end);
    // A step ticked that was only looked at started when it was shown.
    const looked = markStepDone(stepBy(cooking(), 1, at(30)), "c-onions", at(400));
    expect(looked.guide!.times["c-onions"]).toEqual({ startedAt: at(30).toISOString(), doneAt: at(400).toISOString() });
  });
});

describe("hands off: Start and go on, and the timer strip (design §3.3, §3.4)", () => {
  /** At the simmer, steps 1–4 ticked. */
  const atSimmer = () =>
    ["c-oil", "c-onions", "c-sear", "c-yogurt"].reduce((s, key, i) => markStepDone(s, key, at((i + 1) * 60)), cooking());

  it("reads Start and go on; it starts the timer and opens the next step", () => {
    const v = stepScreen(atSimmer(), at(240))!;
    expect(v.timer).toMatchObject({ startLabel: "Start and go on", handsOff: true, range: "20 min at this size", clock: "20:00" });
    expect(v.waiting).toBe(false);
    const s = startAndGoOn(atSimmer(), "c-simmer", at(240));
    expect(s.guide).toMatchObject({ current: "c-coriander" });
    expect(s.guide!.timers[0]).toMatchObject({ stepKey: "c-simmer", label: "Simmer done · Chicken curry", body: "Next: Chop the coriander", endsAt: at(1440).toISOString() });
    expect(s.guide!.times["c-simmer"]!.doneAt).toBeNull();
  });

  it("keeps it running in the strip while later steps are open; tapping it opens its step, waiting", () => {
    let s = startAndGoOn(atSimmer(), "c-simmer", at(240));
    const later = markStepDone(s, "c-coriander", at(300));
    expect(later.guide).toMatchObject({ current: "c-check" });
    expect(stepScreen(later, at(480))!.segments).toEqual(["done", "done", "done", "done", "running", "done", "current", "todo"]);
    const strip = timerStrip(later, at(480), "c-check");
    expect(strip).toEqual([{ id: "t1", stepKey: "c-simmer", phase: "cook", label: "Simmer · step 5", left: "16:00", ended: false }]);
    const out = html(React.createElement(GuideStepView, { view: stepScreen(later, at(480))!, strip, pushHint: false, on: stepOn }));
    expect(out).toContain("Simmer · step 5");
    // RV-4: other steps' timers are card pills.
    expect(out).toMatch(/aria-label="Simmer · step 5: 16:00. Open it" class="[^"]*rounded-full[^"]*bg-card/);
    // The strip never shows the step's own timer.
    expect(timerStrip(later, at(480), "c-simmer")).toEqual([]);
    s = goToStep(later, "c-simmer", at(480));
    const v = stepScreen(s, at(480))!;
    expect(v.waiting).toBe(true);
    const wait = waitScreen(s, v, at(480))!;
    expect(wait.ring!.fraction).toBeCloseTo(0.2, 9);
    expect(wait).toMatchObject({
      header: "STEP 5 OF 8 · HANDS OFF",
      ring: { timerId: "t1", clock: "16:00", sub: "of 20:00", state: "running" },
      pingLine: "We'll ping you when it's done",
      goOn: { key: "c-check", label: "Go on to step 7 · the timer keeps running" },
    });
  });

  it("waits with a big ring, +1 min, Pause and Done early, the ping line, Keep the screen on, and Meanwhile", () => {
    const s = goToStep(startAndGoOn(atSimmer(), "c-simmer", at(240)), "c-simmer", at(300));
    const v = stepScreen(s, at(300))!;
    const out = html(
      React.createElement(GuideWaitView, { view: v, wait: waitScreen(s, v, at(300))!, strip: [], screenOn: true, lockState: "on", pushHint: false, on: waitOn }),
    );
    expect(out).toContain('data-guide="wait"');
    expect(out).toContain("19:00");
    expect(out).toContain("of 20:00");
    expect(out).toContain(">+1 min<");
    expect(out).toContain(">Pause<");
    expect(out).toContain(">Done early<");
    expect(out).toContain("ping you when it");
    expect(out).toMatch(/role="switch" aria-checked="true"[^>]*>.*Keep the screen on/);
    expect(out).toContain("Meanwhile");
    expect(out).toContain("Go on to step 6 · the timer keeps running");
  });

  it("rings in a banner when it ends away from its step, until dismissed or its step ticked", () => {
    let s = startAndGoOn(atSimmer(), "c-simmer", at(240));
    s = { ...s, guide: { ...s.guide!, timers: s.guide!.timers.map((t) => ({ ...t, rang: true })) } };
    expect(timerBanner(s, at(1000), "c-coriander")).toBeNull();
    expect(timerBanner(s, at(1440), "c-coriander")).toEqual({
      timerId: "t1",
      stepKey: "c-simmer",
      phase: "cook",
      title: "Simmer done · Chicken curry",
      body: "Next: Chop the coriander",
      open: "Open step 5",
    });
    expect(timerBanner(s, at(1440), "c-simmer")).toBeNull();
    expect(timerBanner(markStepDone(goToStep(s, "c-simmer", at(1450)), "c-simmer", at(1460)), at(1460), null)).toBeNull();
    expect(timerStrip(s, at(1440), "c-coriander")[0]).toMatchObject({ left: "Ready", ended: true });
  });
});

describe("Meanwhile (design §3.4)", () => {
  it("offers prep not ticked yet, then the steps after this one up to the next hands-off step, each with Do it", () => {
    const s = goToStep(cooking(), "c-onions", NOW);
    expect(meanwhile(s, "c-oil").map((m) => [m.kind, m.key, m.sub])).toEqual([
      ["prep", "p-chop", "Prep · about 3 min"],
      ["prep", "p-rub", "Prep · about 15 min"],
      ["step", "c-onions", "Step 2"],
      ["step", "c-sear", "Step 3"],
      ["step", "c-yogurt", "Step 4"],
    ]);
    const ticked = markStepDone(tickPrep(s, "p-chop", NOW), "c-onions", at(10));
    expect(meanwhile(ticked, "c-simmer").map((m) => m.key)).toEqual(["p-rub", "c-coriander", "c-check", "c-salt"]);
    const out = html(React.createElement(GuideWaitView, {
      view: stepScreen(goToStep(startTimer(ticked, "c-simmer", at(20)), "c-simmer", at(20)), at(20))!,
      wait: waitScreen(goToStep(startTimer(ticked, "c-simmer", at(20)), "c-simmer", at(20)), stepScreen(goToStep(startTimer(ticked, "c-simmer", at(20)), "c-simmer", at(20)), at(20))!, at(20))!,
      strip: [],
      screenOn: true,
      lockState: "on",
      pushHint: false,
      on: waitOn,
    }));
    expect(count(out, ">Do it<")).toBe(4);
  });

  it("Do it on a step opens it, started now", () => {
    const s = goToStep(startTimer(cooking(), "c-oil", NOW), "c-sear", at(30));
    expect(s.guide).toMatchObject({ current: "c-sear" });
    expect(s.guide!.times["c-sear"]!.startedAt).toBe(at(30).toISOString());
  });
});

describe("whistles (design §3.4)", () => {
  const cooker = () => startCooking(longPrepDone(chooseMode(rajma(), "guided", NOW), "r-soak", NOW), at(10));

  it("counts a pressure cooker's whistles: '1 of 3 whistles', with Can't hear it? when cooks' times say when", () => {
    const s = cooker();
    const v = stepScreen(s, at(20))!;
    expect(v).toMatchObject({ waiting: true, timer: null, flame: { level: 3, label: "High flame" } });
    expect(v.whistles).toEqual({
      count: 0,
      of: 3,
      label: "0 of 3 whistles",
      circles: [false, false, false],
      help: { label: "Can't hear it? Ping me at about 13 min", seconds: 780 },
      helpTimer: null,
    });
    expect(waitScreen(s, v, at(20))).toMatchObject({
      header: "STEP 1 OF 3 · PRESSURE COOKER",
      ring: null,
      pingLine: "Count each whistle as you hear it",
      goOn: { key: "r-drop", label: "Go on to step 2 · the cooker keeps going" },
    });
    const one = countWhistle(s, "r-cooker", at(400));
    expect(stepScreen(one, at(400))!.whistles).toMatchObject({ count: 1, label: "1 of 3 whistles", circles: [true, false, false] });
    const out = html(React.createElement(GuideWaitView, { view: stepScreen(one, at(400))!, wait: waitScreen(one, stepScreen(one, at(400))!, at(400))!, strip: [], screenOn: true, lockState: "on", pushHint: false, on: waitOn }));
    expect(out).toContain("1 of 3 whistles");
    expect(out).toContain(">Count a whistle<");
    expect(count(out, 'data-whistle="counted"')).toBe(1);
    expect(out).toContain("Can&#x27;t hear it? Ping me at about 13 min");
  });

  it("Can't hear it? sets a timer for the usual time; the count goes on", () => {
    const s = startTimer(cooker(), "r-cooker", at(20), 780);
    expect(s.guide!.timers[0]).toMatchObject({ stepKey: "r-cooker", totalMs: 780_000, label: "Pressure-cook done · Rajma" });
    expect(stepScreen(s, at(80))!.whistles).toMatchObject({ help: null, helpTimer: { timerId: "t1", clock: "12:00", state: "running" } });
  });

  it("shows in the strip while the cook goes on", () => {
    const s = goToStep(countWhistle(cooker(), "r-cooker", at(400)), "r-drop", at(410));
    expect(timerStrip(s, at(410), "r-drop")).toEqual([
      { id: "w:r-cooker", stepKey: "r-cooker", phase: "cook", label: "Pressure cooker · step 1", left: "1 of 3 whistles", ended: false },
    ]);
  });

  it("at the count, ticks the step done and opens the next, whose timer starts", () => {
    let s = startTimer(cooker(), "r-cooker", at(20), 780);
    s = countWhistle(countWhistle(countWhistle(s, "r-cooker", at(300)), "r-cooker", at(500)), "r-cooker", at(700));
    expect(s.guide!.times["r-cooker"]).toEqual({ startedAt: at(10).toISOString(), doneAt: at(700).toISOString() });
    expect(s.guide).toMatchObject({ current: "r-drop" });
    expect(s.guide!.timers.map((t) => [t.stepKey, t.endsAt])).toEqual([["r-drop", at(1300).toISOString()]]);
    expect(stepScreen(s, at(700))!.waiting).toBe(true);
  });
});

describe("Done (GuideDone, design §3.6)", () => {
  it("says the time in all, hands on, steps and cost, and how each step went against the usual at this size", () => {
    const s = cookedCurry();
    const v = doneScreen(s, at(3000))!;
    expect(v.title).toBe("Chicken curry is done");
    expect(v.total).toBe("37:00");
    expect(v.stats.map((t) => [t.label, t.value])).toEqual([
      ["Hands on", "37 min"],
      ["Steps", "8 of 8"],
      ["Cost", "₹140.78"],
    ]);
    expect(v.rows.map((r) => [r.name, r.time, r.usual, r.slow])).toEqual([
      ["Heat the oil", "2 min", "1–2 min at this size", false],
      ["Add the onions and a pinch of salt. Stir now and then.", "11 min", "Usually 7–9 min at this size · slower today", true],
      ["Add the chicken and sear it", "2 min", "2 min at this size", false],
      ["Stir in the yogurt and garam masala", "1 min", null, false],
      ["Add the water, cover and simmer", "21 min", "20 min at this size", false],
      ["Chop the coriander", "1 min", null, false],
      ["Cut the thickest piece open", "1 min", null, false],
      ["Turn off the flame and taste for salt", "20 min", null, false],
    ]);
    // The bar: the usual range and today's mark, against the longest row.
    expect(v.rows[1]!.bar!.markPct).toBeGreaterThan(v.rows[1]!.bar!.highPct);
    expect(v.rows[0]!.bar!.markPct).toBeLessThanOrEqual(v.rows[0]!.bar!.highPct);
  });

  it("offers Use today's times next time on your own recipe: today's times back at the recipe's size, by each step's rule", () => {
    const s = cookedCurry();
    expect(todaysStepTimes(s)).toEqual({
      steps: [
        // Heat the oil: fixed, 90 s → 2 min.
        { key: "c-oil", minSeconds: 120, maxSeconds: 120 },
        // The onions: 11 min ÷ 0.45^0.5 → 16 min as written.
        { key: "c-onions", minSeconds: 960, maxSeconds: 960 },
        // The sear: 2 min ÷ 0.45 → 4 min.
        { key: "c-sear", minSeconds: 240, maxSeconds: 240 },
        // The simmer: fixed, 20½ min → 21 min. Untimed steps keep having no time.
        { key: "c-simmer", minSeconds: 1260, maxSeconds: 1260 },
      ],
    });
    expect(writtenStepTimes(s, ["c-oil", "c-onions", "c-sear", "c-simmer"])).toEqual({
      steps: [
        { key: "c-oil", minSeconds: 60, maxSeconds: 120 },
        { key: "c-onions", minSeconds: 480, maxSeconds: 600 },
        { key: "c-sear", minSeconds: 240, maxSeconds: 300 },
        { key: "c-simmer", minSeconds: 1200, maxSeconds: 1200 },
      ],
    });
    expect(doneScreen(s, at(3000))!.useTimes).toEqual({ on: false, steps: 4, sub: "4 timed steps, written back at the recipe's own size" });
    // Not yours (Cookpool's, or someone's you cook from): not offered.
    const theirs = { ...s, mine: false };
    expect(todaysStepTimes(theirs)).toBeNull();
    expect(doneScreen(theirs, at(3000))!.useTimes).toBeNull();
  });

  it("draws the time, the rows, the switch, and Who ate? as the main button", () => {
    const out = html(React.createElement(GuideDoneView, { view: doneScreen(cookedCurry(), at(3000))!, whoAteSub: "₹140.78 · post to Flat 4B", strip: [], savingTimes: false, alert: null, on: doneOn }));
    expect(out).toContain("Chicken curry is done");
    expect(out).toContain("37:00");
    expect(out).toContain("How each step went");
    expect(out).toContain("slower today");
    expect(out).toMatch(/role="switch" aria-checked="false"[^>]*>.*Use today&#x27;s times next time/);
    expect(out).toContain("Who ate?");
    expect(out).toContain("₹140.78 · post to Flat 4B");
    expect(out).toContain("bg-primary text-primary-foreground");
  });
});

describe("Finish posts the step log (design §5)", () => {
  const choices = { unticked: "all" as const, postTo: FLAT.orgId, halves: { [ME]: 2, [MEERA]: 2 }, roster: [MEERA, ME], meId: ME, save: false };
  const groups = [{ ...FLAT, currency: "INR", balanceMinor: 0, role: "builder" as const, memberCount: 2 }];

  it("sends each cook step's start and tick with the dish, in step order — not prep", () => {
    const s = tickPrep(cookedCurry(), "p-chop", at(5));
    const r = finishPlan(s, choices, { groups });
    if (!r.ok) throw new Error(r.problem.message);
    expect(r.plan.request.stepLog).toEqual([
      { key: "c-oil", startedAt: at(0).toISOString(), doneAt: at(90).toISOString() },
      { key: "c-onions", startedAt: at(90).toISOString(), doneAt: at(750).toISOString() },
      { key: "c-sear", startedAt: at(750).toISOString(), doneAt: at(870).toISOString() },
      { key: "c-yogurt", startedAt: at(870).toISOString(), doneAt: at(930).toISOString() },
      { key: "c-simmer", startedAt: at(930).toISOString(), doneAt: at(2160).toISOString() },
      { key: "c-coriander", startedAt: at(930).toISOString(), doneAt: at(990).toISOString() },
      { key: "c-check", startedAt: at(990).toISOString(), doneAt: at(1050).toISOString() },
      { key: "c-salt", startedAt: at(1050).toISOString(), doneAt: at(2220).toISOString() },
    ]);
    expect(r.plan.request).toMatchObject({ recipeId: CURRY_ID, recipeFactorMilli: 450, splitMode: "claims" });
  });

  it("leaves out steps not ticked, and sends none from Just tick", () => {
    const part = markStepDone(cooking(), "c-oil", at(90));
    expect(guideStepLog(part.guide)).toEqual([{ key: "c-oil", startedAt: NOW.toISOString(), doneAt: at(90).toISOString() }]);
    const tick = chooseMode(curry(), "tick", NOW);
    const r = finishPlan(tick, choices, { groups });
    if (!r.ok) throw new Error(r.problem.message);
    expect("stepLog" in r.plan.request).toBe(false);
  });
});

describe("Just tick what I use (RC-6, unchanged)", () => {
  it("is RC-6's screen: the same lines, the same Finish, nothing guided", () => {
    const tick = chooseMode(curry(), "tick", NOW);
    expect(guidedScreen(tick, true)).toBeNull();
    expect(tick.lines).toEqual(curry().lines);
    expect(tick.steps).toEqual(CURRY.steps.map((text) => ({ text, done: false })));
    const choices = { unticked: "all" as const, postTo: FLAT.orgId, halves: { [ME]: 2 }, roster: [ME], meId: ME, save: false };
    const groups = [{ ...FLAT, currency: "INR", balanceMinor: 0, role: "builder" as const, memberCount: 1 }];
    const plain = refreshTakes(sessionFromRecipe(CURRY, null, CURRY_MATCH, NOW), ITEMS);
    const a = finishPlan(tick, choices, { groups });
    const b = finishPlan(plain, choices, { groups });
    expect(a).toEqual(b);
  });

  it("takes the timers out of the session: a soak keeps pinging (the recipe page has it too), any other is cancelled", () => {
    let s = startTimer(startTimer(rajma(), "r-soak", NOW), "r-masala", NOW);
    s = { ...s, guide: { ...s.guide!, timers: s.guide!.timers.map((t, i) => ({ ...t, serverId: i === 0 ? "tmr_soak" : "tmr_masala", push: "set" as const })) } };
    const tick = chooseMode(s, "tick", at(5));
    expect(tick.guide).toMatchObject({ mode: "tick", timers: [], cancels: ["tmr_masala"] });
  });
});

describe("prod", () => {
  it("sends a prod visitor Home, as the session does; guided mode is the new frame's", () => {
    expect(frameRedirect("/cook/session", false)).toBe("/home");
    expect(frameRedirect("/cook/session", true)).toBeNull();
    expect(guidedScreen(curry(), false)).toBeNull();
    expect(guidedScreen(cooking(), false)).toBeNull();
  });
});

describe("words", () => {
  it("names a timer by the waiting its step's text says, else by the step", () => {
    expect(timerWord("Add the water, cover and simmer")).toBe("Simmer");
    expect(timerWord("Pressure-cook the rajma with 3 cups of water")).toBe("Pressure-cook");
    expect(timerWord("Let it rest, then fry")).toBe("Fry");
    expect(timerWord("Rub the chicken with salt")).toBeNull();
    const g = curry().guide!;
    expect(timerLabel(g, g.steps.find((s) => s.key === "c-oil")!, "Chicken curry")).toBe("Step 1 done · Chicken curry");
    expect(timerLabel(g, g.steps[6]!, "A very long dish name that goes on and on past the push's limit")).toHaveLength(60);
    expect(RAJMA.longPrep).toHaveLength(1);
    expect(RAJMA_MATCH.factorMilli).toBe(1000);
  });
});
