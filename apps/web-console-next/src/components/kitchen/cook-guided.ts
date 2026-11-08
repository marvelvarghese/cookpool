/**
 * Guided mode (cookpool-guided GC-5, design §3, §4's console side) as pure
 * changes to the cooking session's draft: making the guide from a recipe's
 * guided steps, the prompt's choice, moving between steps, ticking prep,
 * tools and steps, the timers (start, pause, +1 min, the hand-over to the
 * page just before the end, the ring), whistles, and what the server is to
 * be asked — the timers to set and cancel, and "Use today's times".
 *
 * What each screen shows is `cook-guided-screens.ts`; the draft's shape is
 * `cook-guide-draft.ts`. Dependency-free (contract types and RC-6's pure
 * session), so it is unit-testable, like RC-6's draft.
 */

import {
  KITCHEN_TIMER_BODY_MAX,
  KITCHEN_TIMER_DEFAULT_URL,
  KITCHEN_TIMER_ERROR_REASONS,
  KITCHEN_TIMER_LABEL_MAX,
  KITCHEN_TIMER_MIN_SECONDS,
  MAX_STEP_SECONDS,
  isLongPrep,
  stepTimeAt,
  stepTimeMultiplier,
  wholeStepMinutes,
  type CreateKitchenTimerRequest,
  type KitchenRecipe,
  type KitchenTimerResponse,
  type RecipeLastCook,
  type RecipeMatchResponse,
  type StepTimeAt,
  type UpdateStepTimesRequest,
} from "@saas/contracts/kitchen";
import { sessionFromRecipe, type CookSession, type FinishAnswer } from "./cook-session";
import type { CookGuide, GuideMode, GuideStep, GuideTimer, StepTimes } from "./cook-guide-draft";

// ── The numbers ───────────────────────────────────────────────────

/** The page takes a timer over this long before its end: it cancels the server timer and rings itself. */
export const HAND_OVER_MS = 5_000;
/** A timer shorter than this when it would be set rings only here: the server takes 30 s and more, and the sweep runs once a minute. */
export const PUSH_MIN_MS = (KITCHEN_TIMER_MIN_SECONDS + 5) * 1000;
/** A timer that ended this long ago when the page first saw it does not ring (the push did, while the page was away). */
export const RING_LATE_MS = 30_000;
/** A whistle, for "about N min" when no one has timed it yet. */
export const WHISTLE_GUESS_SECONDS = 240;
/** A step with no time, for "about N min". */
export const UNTIMED_GUESS_SECONDS = 60;

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// ── Making it ─────────────────────────────────────────────────────

/**
 * The guide for a recipe with guided steps (GC-2's `guidedSteps`), at the
 * prompt: nothing chosen, ticked or timed yet. Null for a recipe without
 * steps — it skips the prompt and cooks as RC-6's session. A step's learned
 * range (GC-7) comes along when the read has one.
 */
export function guideFromRecipe(recipe: Pick<KitchenRecipe, "guidedSteps" | "tools">): CookGuide | null {
  const steps = recipe.guidedSteps ?? [];
  if (steps.length === 0) return null;
  return {
    mode: null,
    steps: steps.map((s) => ({ ...s, lines: [...s.lines] })),
    tools: [...(recipe.tools ?? [])],
    screen: "prep",
    current: null,
    shownAt: null,
    cookStartedAt: null,
    finishedAt: null,
    times: {},
    prepDone: [],
    toolsDone: [],
    timers: [],
    cancels: [],
    whistles: {},
    screenOn: true,
    timesSaved: false,
    seq: 1,
  };
}

/** RC-6's session from a recipe, with its guide when it has guided steps (StartFromRecipe). */
export function guidedSessionFromRecipe(
  recipe: KitchenRecipe,
  lastCook: RecipeLastCook | null,
  match: RecipeMatchResponse,
  now: Date,
): CookSession {
  const s = sessionFromRecipe(recipe, lastCook, match, now);
  const guide = guideFromRecipe(recipe);
  return guide ? { ...s, guide } : s;
}

/**
 * Which guided screen the session shows, or null for RC-6's screen: there is
 * no guide, "Just tick what I use" was chosen, or this is today's frame
 * (guided mode is the new frame's, as the session is).
 */
export function guidedScreen(s: CookSession | null, isNewFrame: boolean): "prompt" | "prep" | "step" | "done" | null {
  const g = s?.guide;
  if (!g || !isNewFrame || g.mode === "tick") return null;
  if (g.mode === null) return "prompt";
  if (g.screen === "step" && !cookStep(g, g.current)) return "prep";
  return g.screen;
}

// ── Reading it ────────────────────────────────────────────────────

/** The steps that are cooked one at a time (prep is listed in Before you start). */
export function cookSteps(g: CookGuide): GuideStep[] {
  return g.steps.filter((s) => s.phase === "cook");
}

/** Prep that is not long prep: Before you start's Prep list. */
export function prepSteps(g: CookGuide): GuideStep[] {
  return g.steps.filter((s) => s.phase === "prep" && !isLongPrep(s));
}

/** Long prep (design §1): a hands-off prep step of an hour or more, shown first. */
export function longPrepSteps(g: CookGuide): GuideStep[] {
  return g.steps.filter((s) => s.phase === "prep" && isLongPrep(s));
}

export function stepOf(g: CookGuide, key: string | null | undefined): GuideStep | null {
  return key ? (g.steps.find((s) => s.key === key) ?? null) : null;
}

function cookStep(g: CookGuide, key: string | null | undefined): GuideStep | null {
  const s = stepOf(g, key);
  return s && s.phase === "cook" ? s : null;
}

/** The session's size, in thousandths (×1 for a blank one). */
export function factorOf(s: Pick<CookSession, "factorMilli">): number {
  return s.factorMilli ?? 1000;
}

/** The step's time at the session's size: a range in whole minutes, or its whistles; null untimed. */
export function timeAtSize(step: GuideStep, factorMilli: number): StepTimeAt | null {
  return stepTimeAt(step, factorMilli);
}

function rangeAt(step: GuideStep, factorMilli: number): { minSeconds: number; maxSeconds: number } | null {
  const at = timeAtSize(step, factorMilli);
  return at && "minSeconds" in at ? at : null;
}

/** To the nearest whole minute, at least one (as `stepTimeAt` rounds, GC-7's `wholeStepMinutes`). */
const toMinute = wholeStepMinutes;

/**
 * How long a step's timer runs: the low end of what cooks usually take at
 * this size (GC-7) when it is known, else the low end of the author's range
 * at this size — the checkpoint says when it is really done. Null for an
 * untimed step or a whistle step.
 */
export function timerSecondsOf(step: GuideStep, factorMilli: number): number | null {
  const range = rangeAt(step, factorMilli);
  if (!range) return null;
  return step.learned ? toMinute(step.learned.lowSeconds) : range.minSeconds;
}

/** "Can't hear it?" pings at the middle of what cooks usually take for the count (GC-7), when that is known. */
export function whistleHelpSeconds(step: GuideStep): number | null {
  if (step.whistles === null || !step.learned) return null;
  return toMinute((step.learned.lowSeconds + step.learned.highSeconds) / 2);
}

/** About how long a step takes at this size, for the prompt's "about N min": the middle of its range. */
export function estimateSeconds(step: GuideStep, factorMilli: number): number {
  if (step.learned) return (step.learned.lowSeconds + step.learned.highSeconds) / 2;
  const at = timeAtSize(step, factorMilli);
  if (!at) return UNTIMED_GUESS_SECONDS;
  if ("whistles" in at) return at.whistles * WHISTLE_GUESS_SECONDS;
  return (at.minSeconds + at.maxSeconds) / 2;
}

/** A step is done once ticked. */
export function isDone(g: CookGuide, key: string): boolean {
  return !!g.times[key]?.doneAt || g.prepDone.includes(key);
}

// ── Words ─────────────────────────────────────────────────────────

/** The waiting a step's timer stands for, as its push and the strip say it ("Simmer done"). */
const TIMER_WORDS = [
  "soak",
  "marinate",
  "rest",
  "simmer",
  "boil",
  "steam",
  "bake",
  "roast",
  "fry",
  "sauté",
  "saute",
  "cook",
  "pressure-cook",
  "chill",
  "proof",
  "rise",
  "brew",
  "cool",
  "grill",
  "toast",
  "knead",
  "blanch",
  "steep",
  "ferment",
  "dry",
] as const;

/**
 * The word a timer goes by, from the step's text: the last of TIMER_WORDS it
 * uses ("Add the water, cover and simmer" → "Simmer"); null when it uses none.
 */
export function timerWord(text: string): string | null {
  const lower = text.toLowerCase();
  let best: { word: string; at: number } | null = null;
  for (const word of TIMER_WORDS) {
    const re = new RegExp(`(^|[^a-zà-ÿ-])${word.replace(/-/g, "\\-")}(?=$|[^a-zà-ÿ-])`, "g");
    for (const m of lower.matchAll(re)) {
      const at = (m.index ?? 0) + m[1]!.length;
      if (!best || at > best.at || (at === best.at && word.length > best.word.length)) best = { word, at };
    }
  }
  if (!best) return null;
  return best.word[0]!.toUpperCase() + best.word.slice(1);
}

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "Step 6" for a cook step, "Prep" for prep: what a timer is called when its text names no waiting. */
function stepName(g: CookGuide, step: GuideStep): string {
  if (step.phase === "prep") return "Prep";
  return `Step ${cookSteps(g).findIndex((s) => s.key === step.key) + 1}`;
}

/** What a timer is called: "Simmer", else "Step 6" or "Prep". */
export function timerName(g: CookGuide, step: GuideStep): string {
  return timerWord(step.text) ?? stepName(g, step);
}

/** The push's title: "Simmer done · Chicken curry" (at most KITCHEN_TIMER_LABEL_MAX characters). */
export function timerLabel(g: CookGuide, step: GuideStep, dishName: string): string {
  const head = `${timerName(g, step)} done`;
  const name = dishName.trim();
  if (!name) return clip(head, KITCHEN_TIMER_LABEL_MAX);
  return clip(`${head} · ${clip(name, Math.max(8, KITCHEN_TIMER_LABEL_MAX - head.length - 3))}`, KITCHEN_TIMER_LABEL_MAX);
}

/** What comes after a step: the next cook step's words, "Who ate?" after the last, "start cooking" after prep. */
export function nextText(g: CookGuide, step: GuideStep): string {
  if (step.phase === "prep") return "start cooking";
  const cook = cookSteps(g);
  const i = cook.findIndex((s) => s.key === step.key);
  return cook[i + 1]?.text ?? "Who ate?";
}

/** The push's text: "Next: Cut the thickest piece open" (at most KITCHEN_TIMER_BODY_MAX characters). */
export function timerBody(g: CookGuide, step: GuideStep): string {
  return clip(`Next: ${nextText(g, step)}`, KITCHEN_TIMER_BODY_MAX);
}

/** A length in words: "45 min", "8 h", "1 h 30 min", "40 s". */
export function durationText(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

/** A range in words: "8–10 min", "20 min", "1 h–1 h 30 min". */
export function rangeText(range: { minSeconds: number; maxSeconds: number }): string {
  if (range.minSeconds === range.maxSeconds) return durationText(range.minSeconds);
  if (range.maxSeconds < 3600) return `${Math.round(range.minSeconds / 60)}–${Math.round(range.maxSeconds / 60)} min`;
  return `${durationText(range.minSeconds)}–${durationText(range.maxSeconds)}`;
}

/** A timer's clock: "8:00", "0:42", "1:02:04" (whole seconds, rounded up). */
export function clockText(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / SECOND));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "Usually 7–9 min at this size · 23 cooks" (GC-7); null when nothing has been learned. */
export function learnedText(step: GuideStep): string | null {
  const l = step.learned;
  if (!l || !(l.highSeconds >= l.lowSeconds) || !(l.cooks > 0)) return null;
  const range = rangeText({ minSeconds: toMinute(l.lowSeconds), maxSeconds: toMinute(l.highSeconds) });
  return `Usually ${range} at this size · ${l.cooks} ${l.cooks === 1 ? "cook" : "cooks"}`;
}

// ── Changing it ───────────────────────────────────────────────────

/** The session with its guide changed; the same session when it has none. */
function withGuide(s: CookSession, change: (g: CookGuide) => CookGuide): CookSession {
  if (!s.guide) return s;
  const guide = change(s.guide);
  return guide === s.guide ? s : { ...s, guide };
}

function timesOf(g: CookGuide, key: string): StepTimes {
  return g.times[key] ?? { startedAt: null, doneAt: null };
}

function setTimes(g: CookGuide, key: string, change: (t: StepTimes) => StepTimes): CookGuide {
  return { ...g, times: { ...g.times, [key]: change(timesOf(g, key)) } };
}

/** A step started now, unless it started before. */
function started(g: CookGuide, key: string, now: Date): CookGuide {
  if (timesOf(g, key).startedAt) return g;
  return setTimes(g, key, (t) => ({ ...t, startedAt: now.toISOString() }));
}

/** Every timer of `key` stopped, its server timer to be cancelled. */
function dropTimers(g: CookGuide, key: string): CookGuide {
  const gone = g.timers.filter((t) => t.stepKey === key);
  if (gone.length === 0) return g;
  return {
    ...g,
    timers: g.timers.filter((t) => t.stepKey !== key),
    cancels: [...g.cancels, ...gone.map((t) => t.serverId).filter((id): id is string => id !== null)],
  };
}

/**
 * The prompt's answer (design §3.1): Start step by step opens Before you
 * start; Just tick what I use is RC-6's screen from then on, and any timer
 * the prompt started (a soak) is stopped, its server timer cancelled.
 */
export function chooseMode(s: CookSession, mode: GuideMode, now: Date): CookSession {
  return withGuide(s, (g) => {
    if (mode === "tick") {
      const cancels = [...g.cancels, ...g.timers.map((t) => t.serverId).filter((id): id is string => id !== null)];
      return { ...g, mode: "tick", timers: [], cancels };
    }
    return { ...g, mode: "guided", screen: "prep", current: null, shownAt: now.toISOString() };
  });
}

/** Show a cook step: `go` starts it (Done, Start cooking, Do it, the strip); `look` only shows it (swipe, Back). */
function show(g: CookGuide, key: string, now: Date, how: "go" | "look"): CookGuide {
  const next: CookGuide = {
    ...g,
    screen: "step",
    current: key,
    shownAt: now.toISOString(),
    cookStartedAt: g.cookStartedAt ?? (how === "go" ? now.toISOString() : null),
  };
  return how === "go" && !isDone(next, key) ? started(next, key, now) : next;
}

function showDone(g: CookGuide, now: Date): CookGuide {
  return { ...g, screen: "done", current: null, shownAt: now.toISOString(), finishedAt: g.finishedAt ?? now.toISOString() };
}

/** The first cook step not ticked after `from` (its index), else the first before it; null when every one is. */
function nextOpen(g: CookGuide, fromIndex: number): GuideStep | null {
  const cook = cookSteps(g);
  return cook.slice(fromIndex + 1).find((s) => !isDone(g, s.key)) ?? cook.slice(0, Math.max(0, fromIndex)).find((s) => !isDone(g, s.key)) ?? null;
}

/** Start cooking (Before you start's main button): the first step not ticked yet, its clock and the cooking's from now. */
export function startCooking(s: CookSession, now: Date): CookSession {
  return withGuide(s, (g) => {
    const first = nextOpen(g, -1);
    const begun = { ...g, cookStartedAt: g.cookStartedAt ?? now.toISOString() };
    return first ? show(begun, first.key, now, "go") : showDone(begun, now);
  });
}

/** Open a step (`go`: Do it, the strip, a banner) or look at it (`look`). */
export function goToStep(s: CookSession, key: string, now: Date, how: "go" | "look" = "go"): CookSession {
  return withGuide(s, (g) => (cookStep(g, key) ? show(g, key, now, how) : g));
}

/** Before you start, again (Back on the first step, a prep timer in the strip). */
export function showPrep(s: CookSession, now: Date): CookSession {
  return withGuide(s, (g) => ({ ...g, screen: "prep", current: null, shownAt: now.toISOString() }));
}

/**
 * Swipe and Back: the step before or after this one, only looked at. Back
 * from the first step is Before you start; past the last there is nothing.
 */
export function stepBy(s: CookSession, delta: 1 | -1, now: Date): CookSession {
  return withGuide(s, (g) => {
    const cook = cookSteps(g);
    const i = cook.findIndex((st) => st.key === g.current);
    if (i < 0) return g;
    const to = i + delta;
    if (to < 0) return { ...g, screen: "prep", current: null, shownAt: now.toISOString() };
    if (to >= cook.length) return g;
    return show(g, cook[to]!.key, now, "look");
  });
}

/** Whether ticking `key` ends the cooking: it is the last step, or every other one is ticked (the button reads Finish). */
export function isFinalStep(g: CookGuide, key: string): boolean {
  const cook = cookSteps(g);
  if (cook[cook.length - 1]?.key === key) return true;
  return cook.every((st) => st.key === key || isDone(g, st.key));
}

/**
 * Done (design §3.3, decision 2: a step ends when you tick it): its tick now,
 * its start when it had none (the moment it was shown), its timers stopped
 * and their server timers cancelled; then the next step not ticked, which
 * starts now — or Done, from the last step (Finish) or once every step is
 * ticked. A step ticked before keeps its times.
 */
export function markStepDone(s: CookSession, key: string, now: Date): CookSession {
  return withGuide(s, (g) => {
    const step = cookStep(g, key);
    if (!step) return g;
    let next = dropTimers(g, key);
    if (!isDone(next, key)) {
      const shown = g.current === key && g.shownAt ? g.shownAt : now.toISOString();
      next = setTimes(next, key, (t) => ({ startedAt: t.startedAt ?? shown, doneAt: now.toISOString() }));
    }
    if (isFinalStep(g, key)) return showDone(next, now);
    const open = nextOpen(next, cookSteps(next).findIndex((st) => st.key === key));
    return open ? show(next, open.key, now, "go") : showDone(next, now);
  });
}

/** Back from Done to the steps: the last one, looked at. */
export function backToSteps(s: CookSession, now: Date): CookSession {
  return withGuide(s, (g) => {
    const cook = cookSteps(g);
    const last = cook[cook.length - 1];
    return last ? show({ ...g, finishedAt: null }, last.key, now, "look") : { ...g, screen: "prep", current: null, finishedAt: null };
  });
}

/** Tick a prep step in Before you start (or Meanwhile), or untick it; a tick stops its timer. */
export function tickPrep(s: CookSession, key: string, now: Date): CookSession {
  return withGuide(s, (g) => {
    const step = stepOf(g, key);
    if (!step || step.phase !== "prep") return g;
    if (g.prepDone.includes(key)) {
      return setTimes({ ...g, prepDone: g.prepDone.filter((k) => k !== key) }, key, (t) => ({ ...t, doneAt: null }));
    }
    const ticked = dropTimers({ ...g, prepDone: [...g.prepDone, key] }, key);
    return setTimes(ticked, key, (t) => ({ startedAt: t.startedAt ?? now.toISOString(), doneAt: now.toISOString() }));
  });
}

/** Tick a tool (by its place in the recipe's list), or untick it. */
export function tickTool(s: CookSession, index: number): CookSession {
  return withGuide(s, (g) => {
    if (index < 0 || index >= g.tools.length) return g;
    const toolsDone = g.toolsDone.includes(index) ? g.toolsDone.filter((i) => i !== index) : [...g.toolsDone, index].sort((a, b) => a - b);
    return { ...g, toolsDone };
  });
}

/** Long prep's Already done: ticked, and the guided card wakes up. */
export function longPrepDone(s: CookSession, key: string, now: Date): CookSession {
  const g = s.guide;
  if (!g || g.prepDone.includes(key)) return s;
  return tickPrep(s, key, now);
}

/** The Keep the screen on switch. */
export function setScreenOn(s: CookSession, on: boolean): CookSession {
  return withGuide(s, (g) => (g.screenOn === on ? g : { ...g, screenOn: on }));
}

/** Use today's times next time, written (true) or put back (false). */
export function setTimesSaved(s: CookSession, on: boolean): CookSession {
  return withGuide(s, (g) => (g.timesSaved === on ? g : { ...g, timesSaved: on }));
}

// ── Timers ────────────────────────────────────────────────────────

/** A step's timer, if it has one. */
export function timerOfStep(g: CookGuide, key: string): GuideTimer | null {
  return g.timers.find((t) => t.stepKey === key) ?? null;
}

/** What is left of a timer (ms): what was left when paused, else to its end; never below 0. */
export function timerLeftMs(t: GuideTimer, now: Date): number {
  if (t.endsAt === null) return Math.max(0, t.pausedLeftMs ?? 0);
  const end = Date.parse(t.endsAt);
  return Number.isNaN(end) ? 0 : Math.max(0, end - now.getTime());
}

export type TimerState = "running" | "paused" | "ended";

export function timerState(t: GuideTimer, now: Date): TimerState {
  if (t.endsAt === null) return "paused";
  return timerLeftMs(t, now) > 0 ? "running" : "ended";
}

/** How far round its ring is: 0 at the start, 1 at the end. */
export function timerFraction(t: GuideTimer, now: Date): number {
  if (!(t.totalMs > 0)) return 1;
  return Math.max(0, Math.min(1, 1 - timerLeftMs(t, now) / t.totalMs));
}

function changeTimer(s: CookSession, id: string, change: (t: GuideTimer, g: CookGuide) => { timer: GuideTimer; cancel?: string | null } | null): CookSession {
  return withGuide(s, (g) => {
    const t = g.timers.find((x) => x.id === id);
    if (!t) return g;
    const out = change(t, g);
    if (!out) return g;
    return {
      ...g,
      timers: g.timers.map((x) => (x.id === id ? out.timer : x)),
      cancels: out.cancel ? [...g.cancels, out.cancel] : g.cancels,
    };
  });
}

/**
 * Start a step's timer (Start, Start N min, Soak now · ping me, Can't hear
 * it?): `seconds`, else the step's own (`timerSecondsOf`). A timer the step
 * had is replaced, its server timer cancelled. The step starts now if it had
 * not; the server timer is asked for next (`timerWork`).
 */
export function startTimer(s: CookSession, key: string, now: Date, seconds?: number): CookSession {
  return withGuide(s, (g) => {
    const step = stepOf(g, key);
    if (!step) return g;
    const secs = seconds ?? timerSecondsOf(step, factorOf(s));
    if (secs === null || !(secs > 0)) return g;
    const base = dropTimers(g, key);
    const ms = Math.round(secs * SECOND);
    const timer: GuideTimer = {
      id: `t${base.seq}`,
      stepKey: key,
      label: timerLabel(base, step, s.name),
      body: timerBody(base, step),
      endsAt: new Date(now.getTime() + ms).toISOString(),
      pausedLeftMs: null,
      totalMs: ms,
      serverId: null,
      push: "pending",
      pushNote: null,
      rang: false,
      seen: false,
    };
    return started({ ...base, timers: [...base.timers, timer], seq: base.seq + 1 }, key, now);
  });
}

/** A hands-off step's Start and go on: its timer starts, and the next step not ticked opens (the timer runs on in the strip). */
export function startAndGoOn(s: CookSession, key: string, now: Date): CookSession {
  const timed = startTimer(s, key, now);
  if (timed === s) return s;
  return withGuide(timed, (g) => {
    const cook = cookSteps(g);
    const i = cook.findIndex((st) => st.key === key);
    const open = cook.slice(i + 1).find((st) => !isDone(g, st.key));
    return open ? show(g, open.key, now, "go") : g;
  });
}

/** Pause: what is left is kept, and the server timer is cancelled (Resume sets a new one). */
export function pauseTimer(s: CookSession, id: string, now: Date): CookSession {
  return changeTimer(s, id, (t) => {
    if (timerState(t, now) !== "running") return null;
    return {
      timer: { ...t, endsAt: null, pausedLeftMs: timerLeftMs(t, now), serverId: null, push: "pending", pushNote: null },
      cancel: t.serverId,
    };
  });
}

/** Resume: it ends what was left from now. */
export function resumeTimer(s: CookSession, id: string, now: Date): CookSession {
  return changeTimer(s, id, (t) => {
    if (t.endsAt !== null) return null;
    const left = Math.max(0, t.pausedLeftMs ?? 0);
    return { timer: { ...t, endsAt: new Date(now.getTime() + left).toISOString(), pausedLeftMs: null, push: "pending", pushNote: null, rang: false, seen: false } };
  });
}

/** +1 min: a running timer ends a minute later (a new server timer for the new end); a paused one has a minute more; an ended one runs a minute again. */
export function addMinute(s: CookSession, id: string, now: Date): CookSession {
  return changeTimer(s, id, (t) => {
    const state = timerState(t, now);
    if (state === "paused") return { timer: { ...t, pausedLeftMs: (t.pausedLeftMs ?? 0) + MINUTE, totalMs: t.totalMs + MINUTE } };
    const fresh = { serverId: null, push: "pending" as const, pushNote: null, rang: false, seen: false };
    if (state === "ended") {
      return { timer: { ...t, ...fresh, endsAt: new Date(now.getTime() + MINUTE).toISOString(), totalMs: MINUTE }, cancel: t.serverId };
    }
    const end = Date.parse(t.endsAt!) + MINUTE;
    return { timer: { ...t, ...fresh, endsAt: new Date(end).toISOString(), totalMs: t.totalMs + MINUTE }, cancel: t.serverId };
  });
}

/** The banner's dismiss: the timer stays (its step still to tick), its banner goes. */
export function seeTimer(s: CookSession, id: string): CookSession {
  return changeTimer(s, id, (t) => (t.seen ? null : { timer: { ...t, seen: true } }));
}

/**
 * Count a whistle (design §3.4): at the step's count it is ticked done, the
 * next step opens, and its timer starts when it is timed (the cooker is
 * already off the heat or on low by then).
 */
export function countWhistle(s: CookSession, key: string, now: Date): CookSession {
  const g = s.guide;
  const step = g ? cookStep(g, key) : null;
  if (!g || !step || step.whistles === null) return s;
  const count = Math.min(step.whistles, (g.whistles[key] ?? 0) + 1);
  let next = withGuide(s, (x) => started({ ...x, whistles: { ...x.whistles, [key]: count } }, key, now));
  if (count < step.whistles) return next;
  next = markStepDone(next, key, now);
  const ng = next.guide;
  const cur = ng && ng.screen === "step" ? cookStep(ng, ng.current) : null;
  if (ng && cur && cur.key !== key && !timerOfStep(ng, cur.key) && timerSecondsOf(cur, factorOf(next)) !== null) {
    next = startTimer(next, cur.key, now);
  }
  return next;
}

// ── The server's timers ───────────────────────────────────────────

/** A server timer to set for a session timer's current end. */
export interface TimerCreate {
  timerId: string;
  /** The end it is for: a timer moved since (+1 min, paused) makes this one stale. */
  endsAt: string;
  request: CreateKitchenTimerRequest;
}

/** What the page is to do about its timers now. */
export interface TimerWork {
  /** Server timers to set. */
  create: TimerCreate[];
  /** Server timers to cancel (paused, ticked, replaced, taken over). */
  cancel: string[];
  /** Timers the page takes over just before their end: their server timer is cancelled, and the page rings them. */
  handOver: string[];
  /** Timers too short for a push: they ring only here. */
  short: string[];
  /** Timers that end now, while the page is visible: ring them. */
  ring: string[];
  /** Timers that ended while the page was away (their push went out): marked, without a sound. */
  quiet: string[];
}

/**
 * The timers' work at `now` (design §4): a running timer without a server
 * timer gets one (unless it is too short for a push); the server timers of
 * timers paused or gone are cancelled; while the page is visible, a timer
 * within HAND_OVER_MS of its end is taken over — its server timer cancelled,
 * so the phone does not ping twice — and rung at its end. One that ended
 * while the page was away, and whose push went out, is only marked.
 */
export function timerWork(s: CookSession, now: Date, visible: boolean): TimerWork {
  const work: TimerWork = { create: [], cancel: [...(s.guide?.cancels ?? [])], handOver: [], short: [], ring: [], quiet: [] };
  const g = s.guide;
  if (!g) return work;
  for (const t of g.timers) {
    if (t.endsAt === null) continue;
    const left = timerLeftMs(t, now);
    const late = now.getTime() - Date.parse(t.endsAt);
    let push = t.push;
    if (push === "pending" && left > 0) {
      if (left >= PUSH_MIN_MS) {
        work.create.push({ timerId: t.id, endsAt: t.endsAt, request: { label: t.label, body: t.body, url: KITCHEN_TIMER_DEFAULT_URL, endsAt: t.endsAt } });
      } else {
        work.short.push(t.id);
        push = "here";
      }
    }
    if (visible && push === "set" && left <= HAND_OVER_MS && late < RING_LATE_MS) {
      work.handOver.push(t.id);
      push = "here";
    }
    if (left > 0 || t.rang || !visible) continue;
    if (push !== "set" || late < RING_LATE_MS) work.ring.push(t.id);
    else work.quiet.push(t.id);
  }
  return work;
}

/** Timers taken over by the page: their server timers are to be cancelled, and they ring here. */
export function handOver(s: CookSession, ids: readonly string[]): CookSession {
  if (ids.length === 0) return s;
  return withGuide(s, (g) => {
    const cancels = [...g.cancels];
    const timers = g.timers.map((t) => {
      if (!ids.includes(t.id) || t.push !== "set") return t;
      if (t.serverId) cancels.push(t.serverId);
      return { ...t, serverId: null, push: "here" as const, pushNote: null };
    });
    return { ...g, timers, cancels };
  });
}

/** Timers too short for a push: they ring only here. */
export function markShort(s: CookSession, ids: readonly string[]): CookSession {
  if (ids.length === 0) return s;
  return withGuide(s, (g) => ({
    ...g,
    timers: g.timers.map((t) => (ids.includes(t.id) && t.push === "pending" ? { ...t, push: "here" as const, pushNote: "short" as const } : t)),
  }));
}

/** Timers rung (or seen to have ended while the page was away). */
export function markRang(s: CookSession, ids: readonly string[]): CookSession {
  if (ids.length === 0) return s;
  return withGuide(s, (g) => ({ ...g, timers: g.timers.map((t) => (ids.includes(t.id) && !t.rang ? { ...t, rang: true } : t)) }));
}

/** A refusal is the 422 for a person's eleventh active timer. */
export function isTooManyTimers(error: { code?: string; reason?: string | undefined; details?: Record<string, unknown> | undefined }): boolean {
  const reason = error.reason ?? (typeof error.details?.["reason"] === "string" ? error.details["reason"] : undefined);
  return reason === KITCHEN_TIMER_ERROR_REASONS.TOO_MANY_TIMERS;
}

/**
 * The server's answer to a create: the timer keeps the server timer's id —
 * unless it moved meanwhile (paused, +1 min, ticked), when the new one is to
 * be cancelled at once. A refusal leaves the timer ringing only here:
 * `too_many_timers` (ten are set already) or any other failure.
 */
export function afterCreate(s: CookSession, create: TimerCreate, answer: FinishAnswer<KitchenTimerResponse>): CookSession {
  return withGuide(s, (g) => {
    const t = g.timers.find((x) => x.id === create.timerId);
    const current = !!t && t.endsAt === create.endsAt && t.push === "pending";
    if (answer.ok) {
      const serverId = answer.data.timer.id;
      if (!current) return { ...g, cancels: [...g.cancels, serverId] };
      return { ...g, timers: g.timers.map((x) => (x.id === t!.id ? { ...x, serverId, push: "set" as const, pushNote: null } : x)) };
    }
    if (!current) return g;
    const pushNote = isTooManyTimers(answer.error) ? ("too_many" as const) : ("failed" as const);
    return { ...g, timers: g.timers.map((x) => (x.id === t!.id ? { ...x, push: "here" as const, pushNote } : x)) };
  });
}

/** The server's answer to a cancel: done (or gone already) leaves the list; anything else is tried again later. */
export function afterCancel(s: CookSession, serverId: string, answer: FinishAnswer<unknown>): CookSession {
  const settled = answer.ok || answer.status === 404;
  if (!settled) return s;
  return withGuide(s, (g) => (g.cancels.includes(serverId) ? { ...g, cancels: g.cancels.filter((id) => id !== serverId) } : g));
}

/** Every server timer the session holds or still has to cancel: Discard and Finish cancel them all. */
export function serverTimerIds(s: CookSession | null): string[] {
  const g = s?.guide;
  if (!g) return [];
  return [...new Set([...g.timers.map((t) => t.serverId).filter((id): id is string => id !== null), ...g.cancels])];
}

// ── Today's times ─────────────────────────────────────────────────

/** How long a step really took (seconds), from its start to its tick; null without both. */
export function realSeconds(t: StepTimes | undefined | null): number | null {
  if (!t?.startedAt || !t.doneAt) return null;
  const s = Date.parse(t.startedAt);
  const d = Date.parse(t.doneAt);
  if (Number.isNaN(s) || Number.isNaN(d) || d < s) return null;
  return (d - s) / SECOND;
}

/**
 * Use today's times next time (design §3.6, your own recipe or copy): each
 * timed cook step ticked today, at today's time brought back to the recipe's
 * own size (÷ its rule's multiplier, `stepTimeMultiplier`), in whole minutes —
 * one time, min = max. Whistle steps and untimed steps are left as they are.
 * Null when there is nothing to write, or the recipe isn't yours.
 */
export function todaysStepTimes(s: CookSession): UpdateStepTimesRequest | null {
  const g = s.guide;
  if (!g || !s.recipeId || !s.mine) return null;
  const f = factorOf(s);
  const steps = cookSteps(g).flatMap((st) => {
    if (st.whistles !== null || st.minSeconds === null) return [];
    const real = realSeconds(g.times[st.key]);
    if (real === null) return [];
    const back = Math.min(MAX_STEP_SECONDS, toMinute(real / stepTimeMultiplier(st.timeRule, f)));
    return [{ key: st.key, minSeconds: back, maxSeconds: back }];
  });
  return steps.length > 0 ? { steps } : null;
}

/** The same steps as the recipe wrote them (turning Use today's times off again). */
export function writtenStepTimes(s: CookSession, keys: readonly string[]): UpdateStepTimesRequest | null {
  const g = s.guide;
  if (!g) return null;
  const steps = g.steps
    .filter((st) => keys.includes(st.key) && st.minSeconds !== null)
    .map((st) => ({ key: st.key, minSeconds: st.minSeconds!, maxSeconds: st.maxSeconds ?? st.minSeconds! }));
  return steps.length > 0 ? { steps } : null;
}
