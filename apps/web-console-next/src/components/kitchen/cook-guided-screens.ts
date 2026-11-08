/**
 * What guided mode's screens show (cookpool-guided GC-5, design §3, the
 * canvas's `GuidePrompt`, `GuidePrep`, `GuideStep`, `GuideWait` and
 * `GuideDone`), as pure view-models over the session's draft: the prompt and
 * long prep, Before you start, one step (the flame, the scaled chips, the
 * checkpoint, the timer and its learned range), waiting (the ring, whistles,
 * Meanwhile), the timer strip and banner, and Done (how each step went).
 *
 * The changes are `cook-guided.ts`; the drawing `cook-guided-ui.tsx`.
 * Dependency-free, so it is unit-testable.
 */

import { isRecipeUnit, wholeStepMinutes, type StepHeat, type StepSense } from "@saas/contracts/kitchen";
import { formatMinor } from "./money";
import {
  amountText,
  progress,
  scaleChip,
  sessionCurrency,
  sessionLineCost,
  tickable,
  type CookSession,
  type SessionLine,
} from "./cook-session";
import type { CookGuide, GuideStep, GuideTimer } from "./cook-guide-draft";
import {
  clockText,
  cookSteps,
  durationText,
  estimateSeconds,
  factorOf,
  isDone,
  isFinalStep,
  learnedText,
  longPrepSteps,
  prepSteps,
  rangeText,
  realSeconds,
  stepOf,
  timeAtSize,
  timerFraction,
  timerLeftMs,
  timerName,
  timerOfStep,
  timerSecondsOf,
  timerState,
  timerWord,
  todaysStepTimes,
  whistleHelpSeconds,
  type TimerState,
} from "./cook-guided";

// ── Pieces every step screen has ──────────────────────────────────

export const FLAME_WORDS = ["Flame off", "Low flame", "Medium flame", "High flame"] as const;

export interface FlameView {
  /** 0 off, 1–3 flames. */
  level: StepHeat;
  /** "Medium flame". */
  label: string;
  /** "Stay close" on a high flame. */
  hint: string | null;
}

/** The flame card: one to three flames and their words; none when the step says no flame. */
export function flameView(heat: StepHeat | null): FlameView | null {
  if (heat === null || heat < 0 || heat > 3) return null;
  return { level: heat, label: FLAME_WORDS[heat], hint: heat === 3 ? "Stay close" : null };
}

/** The checkpoint's word above it, by its sense ("LOOK FOR"). */
export const SENSE_WORDS: Readonly<Record<StepSense, string>> = {
  look: "LOOK FOR",
  smell: "SMELL FOR",
  sound: "LISTEN FOR",
  feel: "FEEL FOR",
  taste: "TASTE FOR",
};

export interface CheckpointView {
  sense: StepSense | null;
  /** "LOOK FOR"; "WATCH FOR" when no sense is said. */
  word: string;
  /** "Until golden brown". */
  text: string;
}

/** "golden brown" → "Until golden brown" (once: an author's "Until…" stays as it is). */
export function checkpointText(checkpoint: string): string {
  const t = checkpoint.trim();
  return /^until\b/i.test(t) ? t[0]!.toUpperCase() + t.slice(1) : `Until ${t}`;
}

export function checkpointView(step: Pick<GuideStep, "sense" | "checkpoint">): CheckpointView | null {
  if (!step.checkpoint || !step.checkpoint.trim()) return null;
  return { sense: step.sense, word: step.sense ? SENSE_WORDS[step.sense] : "WATCH FOR", text: checkpointText(step.checkpoint) };
}

/** What read aloud says (design §3.7): the step, then its checkpoint. */
export function speechFor(step: Pick<GuideStep, "text" | "sense" | "checkpoint">): string[] {
  const cp = checkpointView(step);
  return [step.text.trim(), cp ? cp.text : null].filter((x): x is string => !!x);
}

export interface StepChipView {
  /** The session line it ticks: `r:<position>`. */
  key: string;
  /** "1½ onions", "450 g chicken", "Salt". */
  label: string;
  ticked: boolean;
  tickable: boolean;
  checkLabel: string;
}

/** A line's chip: its amount and name in a few words, as scaled for the session. */
export function chipLabel(line: Pick<SessionLine, "name" | "qtyMilli" | "unit">): string {
  if (line.qtyMilli === null || line.unit === null) return line.name;
  const amount = amountText(line.qtyMilli, line.unit);
  // A count word says what it is ("1½ onions"); a unit needs the name ("450 g chicken").
  return isRecipeUnit(line.unit) ? `${amount} ${line.name.toLowerCase()}` : amount;
}

/** The lines a step uses, as chips that tick the session's own lines (design §1: never written into the text). */
export function stepChips(s: CookSession, step: Pick<GuideStep, "lines">): StepChipView[] {
  const out: StepChipView[] = [];
  for (const position of step.lines) {
    const line = s.lines.find((l) => l.recipeLine === position && l.key === `r:${position}`);
    if (!line) continue;
    out.push({
      key: line.key,
      label: chipLabel(line),
      ticked: line.ticked,
      tickable: tickable(line),
      checkLabel: `${line.ticked ? "Untick" : "Tick"} ${line.name}`,
    });
  }
  return out;
}

export interface TimerCardView {
  /** The step's timer, once started. */
  timerId: string | null;
  state: "idle" | TimerState;
  /** "8:00" before it starts, what is left while it runs, "Done" at the end. */
  clock: string;
  /** How far round the ring is. */
  fraction: number;
  /** "8–10 min at this size", "20 min" (×1). */
  range: string;
  /** "Usually 7–9 min at this size · 23 cooks" (GC-7); null until learned. */
  learned: string | null;
  handsOff: boolean;
  /** "Start", or "Start and go on" for a hands-off step. */
  startLabel: string;
  /** Why it won't reach a locked phone, when it won't. */
  pushNote: string | null;
}

/** Why a timer rings only in the page, in words; null when its push is set or on its way. */
export function pushNoteText(t: GuideTimer | null): string | null {
  if (!t || t.push !== "here") return null;
  if (t.pushNote === "too_many") return "Rings here only: 10 timers are set already";
  if (t.pushNote === "failed") return "Rings here only: it couldn't be set on the server";
  return null;
}

function rangeAtText(range: { minSeconds: number; maxSeconds: number }, factorMilli: number): string {
  return factorMilli === 1000 ? rangeText(range) : `${rangeText(range)} at this size`;
}

/** The timer card for a timed step (not a whistle step, not untimed). */
export function timerCard(s: CookSession, step: GuideStep, now: Date): TimerCardView | null {
  const g = s.guide;
  const f = factorOf(s);
  const at = timeAtSize(step, f);
  const seconds = timerSecondsOf(step, f);
  if (!g || !at || !("minSeconds" in at) || seconds === null) return null;
  const t = timerOfStep(g, step.key);
  const state = t ? timerState(t, now) : "idle";
  return {
    timerId: t?.id ?? null,
    state,
    clock: !t ? clockText(seconds * 1000) : state === "ended" ? "Done" : clockText(timerLeftMs(t, now)),
    fraction: t ? timerFraction(t, now) : 0,
    range: rangeAtText(at, f),
    learned: learnedText(step),
    handsOff: step.handsOff,
    startLabel: step.handsOff ? "Start and go on" : "Start",
    pushNote: pushNoteText(t),
  };
}

export interface WhistleView {
  count: number;
  of: number;
  /** "1 of 3 whistles". */
  label: string;
  /** One per whistle: counted or not. */
  circles: boolean[];
  /** "Can't hear it? Ping me at about 12 min", when cooks' times say when (GC-7). */
  help: { label: string; seconds: number } | null;
  /** That ping's timer, once set. */
  helpTimer: { timerId: string; clock: string; state: TimerState } | null;
}

export function whistleView(s: CookSession, step: GuideStep, now: Date): WhistleView | null {
  const g = s.guide;
  if (!g || step.whistles === null) return null;
  const count = Math.min(step.whistles, g.whistles[step.key] ?? 0);
  const helpSeconds = whistleHelpSeconds(step);
  const t = timerOfStep(g, step.key);
  return {
    count,
    of: step.whistles,
    label: `${count} of ${step.whistles} ${step.whistles === 1 ? "whistle" : "whistles"}`,
    circles: Array.from({ length: step.whistles }, (_, i) => i < count),
    help: helpSeconds !== null && !t ? { label: `Can't hear it? Ping me at about ${durationText(helpSeconds)}`, seconds: helpSeconds } : null,
    helpTimer: t ? { timerId: t.id, clock: timerState(t, now) === "ended" ? "Done" : clockText(timerLeftMs(t, now)), state: timerState(t, now) } : null,
  };
}

// ── The timer strip and the banner ────────────────────────────────

export interface StripItem {
  /** The timer's id, or `w:<step>` for a cooker counting whistles. */
  id: string;
  stepKey: string;
  phase: "prep" | "cook";
  /** "Simmer · step 6", "Rest · prep", "Pressure cooker · step 2". */
  label: string;
  /** "12:04", "Paused · 4:59", "Ready", "1 of 3 whistles". */
  left: string;
  ended: boolean;
}

function stepNumber(g: CookGuide, key: string): number {
  return cookSteps(g).findIndex((s) => s.key === key) + 1;
}

/**
 * The timer strip (design §3.3): every running timer but the shown step's
 * own, soonest first, and a cooker counting whistles that the cook went on
 * from. Tapping one opens its step.
 */
export function timerStrip(s: CookSession, now: Date, shownStep: string | null): StripItem[] {
  const g = s.guide;
  if (!g) return [];
  const items: (StripItem & { order: number })[] = [];
  for (const t of g.timers) {
    if (t.stepKey === shownStep) continue;
    const step = stepOf(g, t.stepKey);
    if (!step || isDone(g, step.key)) continue;
    const state = timerState(t, now);
    const where = step.phase === "prep" ? "prep" : `step ${stepNumber(g, step.key)}`;
    items.push({
      id: t.id,
      stepKey: step.key,
      phase: step.phase,
      label: `${timerName(g, step)} · ${where}`,
      left: state === "ended" ? "Ready" : state === "paused" ? `Paused · ${clockText(timerLeftMs(t, now))}` : clockText(timerLeftMs(t, now)),
      ended: state === "ended",
      order: state === "paused" ? Number.MAX_SAFE_INTEGER : timerLeftMs(t, now),
    });
  }
  for (const step of cookSteps(g)) {
    if (step.whistles === null || step.key === shownStep || isDone(g, step.key) || !g.times[step.key]?.startedAt) continue;
    if (timerOfStep(g, step.key)) continue;
    const count = Math.min(step.whistles, g.whistles[step.key] ?? 0);
    items.push({
      id: `w:${step.key}`,
      stepKey: step.key,
      phase: "cook",
      label: `Pressure cooker · step ${stepNumber(g, step.key)}`,
      left: `${count} of ${step.whistles} ${step.whistles === 1 ? "whistle" : "whistles"}`,
      ended: false,
      order: Number.MAX_SAFE_INTEGER - 1,
    });
  }
  return items.sort((a, b) => a.order - b.order).map(({ order: _order, ...item }) => item);
}

export interface TimerBanner {
  timerId: string;
  stepKey: string;
  phase: "prep" | "cook";
  /** "Simmer done · Chicken curry". */
  title: string;
  /** "Next: Cut the thickest piece open". */
  body: string;
  /** "Open step 6", "Open Before you start". */
  open: string;
}

/**
 * The banner a timer that ended in the page shows (design §3.7), until it
 * is dismissed or its step ticked: the latest to end first. Not while that
 * step is the one shown — its own card says Done.
 */
export function timerBanner(s: CookSession, now: Date, shownStep: string | null): TimerBanner | null {
  const g = s.guide;
  if (!g) return null;
  const ended = g.timers
    .filter((t) => t.rang && !t.seen && t.stepKey !== shownStep && timerState(t, now) === "ended" && !isDone(g, t.stepKey))
    .sort((a, b) => Date.parse(b.endsAt!) - Date.parse(a.endsAt!));
  const t = ended[0];
  const step = t ? stepOf(g, t.stepKey) : null;
  if (!t || !step) return null;
  return {
    timerId: t.id,
    stepKey: step.key,
    phase: step.phase,
    title: t.label,
    body: t.body,
    open: step.phase === "prep" ? "Open Before you start" : `Open step ${stepNumber(g, step.key)}`,
  };
}

// ── One step (GuideStep) and waiting (GuideWait) ──────────────────

export type SegmentState = "done" | "current" | "running" | "todo";

export interface MeanwhileItem {
  kind: "prep" | "step";
  key: string;
  text: string;
  /** "Prep · about 2 min", "Step 7". */
  sub: string;
  done: boolean;
}

export interface StepScreenView {
  key: string;
  /** 1-based. */
  number: number;
  of: number;
  /** "STEP 3 OF 8 · 14 MIN IN". */
  header: string;
  /** "Step 3 of 8". */
  progressLabel: string;
  segments: SegmentState[];
  text: string;
  flame: FlameView | null;
  chips: StepChipView[];
  checkpoint: CheckpointView | null;
  timer: TimerCardView | null;
  whistles: WhistleView | null;
  tip: string | null;
  /** "Next · Add the ginger-garlic paste", "Next · Who ate?". */
  next: string;
  /** "Done", or "Finish" on the last step (or once every other one is ticked). */
  mainLabel: string;
  /** Ticked already. */
  done: boolean;
  /** It shows as waiting (GuideWait): a hands-off step with its timer set, or a pressure cooker counting whistles. */
  waiting: boolean;
  /** Read aloud's words. */
  speech: string[];
  /** The plan (GC-6's `/recipes/<id>/plan?f=`); null for a blank session. */
  planHref: string | null;
}

/** GC-6's plan, at the session's size. */
export function planHref(s: Pick<CookSession, "recipeId" | "factorMilli">): string | null {
  if (!s.recipeId) return null;
  return `/recipes/${encodeURIComponent(s.recipeId)}/plan?f=${factorOf(s)}`;
}

/** Whole minutes since the cooking started: "14 MIN IN". */
export function minutesIn(g: CookGuide, now: Date): number {
  const t = g.cookStartedAt ? Date.parse(g.cookStartedAt) : Number.NaN;
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now.getTime() - t) / 60_000));
}

/** The step shown (design §3.3); null when the guide is not on a step. */
export function stepScreen(s: CookSession, now: Date): StepScreenView | null {
  const g = s.guide;
  if (!g || g.screen !== "step") return null;
  const cook = cookSteps(g);
  const i = cook.findIndex((st) => st.key === g.current);
  const step = cook[i];
  if (!step) return null;
  const t = timerOfStep(g, step.key);
  const segments = cook.map((st): SegmentState => {
    if (isDone(g, st.key)) return "done";
    if (st.key === step.key) return "current";
    if (timerOfStep(g, st.key) || (st.whistles !== null && g.times[st.key]?.startedAt)) return "running";
    return "todo";
  });
  const next = cook[i + 1];
  const done = isDone(g, step.key);
  return {
    key: step.key,
    number: i + 1,
    of: cook.length,
    header: `STEP ${i + 1} OF ${cook.length} · ${minutesIn(g, now)} MIN IN`,
    progressLabel: `Step ${i + 1} of ${cook.length}`,
    segments,
    text: step.text,
    flame: flameView(step.heat),
    chips: stepChips(s, step),
    checkpoint: checkpointView(step),
    timer: timerCard(s, step, now),
    whistles: whistleView(s, step, now),
    tip: step.tip && step.tip.trim() ? step.tip.trim() : null,
    next: `Next · ${next ? next.text : "Who ate?"}`,
    mainLabel: isFinalStep(g, step.key) ? "Finish" : "Done",
    done,
    waiting: !done && ((step.handsOff && t !== null) || step.whistles !== null),
    speech: speechFor(step),
    planHref: planHref(s),
  };
}

/**
 * Meanwhile (design §3.4): prep not ticked yet, then the steps after this
 * one up to the next hands-off step, each with Do it.
 */
export function meanwhile(s: CookSession, key: string): MeanwhileItem[] {
  const g = s.guide;
  if (!g) return [];
  const f = factorOf(s);
  const prep: MeanwhileItem[] = prepSteps(g)
    .filter((st) => !isDone(g, st.key))
    .map((st) => ({ kind: "prep", key: st.key, text: st.text, sub: `Prep · about ${durationText(estimateSeconds(st, f))}`, done: false }));
  const cook = cookSteps(g);
  const i = cook.findIndex((st) => st.key === key);
  const after: MeanwhileItem[] = [];
  for (const st of cook.slice(i + 1)) {
    if (st.handsOff) break;
    if (isDone(g, st.key)) continue;
    after.push({ kind: "step", key: st.key, text: st.text, sub: `Step ${cook.indexOf(st) + 1}`, done: false });
  }
  return [...prep, ...after];
}

export interface WaitScreenView {
  /** "STEP 6 OF 8 · HANDS OFF", "STEP 2 OF 7 · PRESSURE COOKER". */
  header: string;
  /** The big ring, for a timed step. */
  ring: { timerId: string; clock: string; sub: string; fraction: number; state: TimerState } | null;
  /** "We'll ping you when it's done". */
  pingLine: string;
  meanwhile: MeanwhileItem[];
  /** "Go on to step 7 · the timer keeps running"; null when no step is left after it. */
  goOn: { key: string; label: string } | null;
}

/** Waiting's own parts (design §3.4), for a step the step view says is waiting. */
export function waitScreen(s: CookSession, view: StepScreenView, now: Date): WaitScreenView | null {
  const g = s.guide;
  const step = g ? stepOf(g, view.key) : null;
  if (!g || !step || !view.waiting) return null;
  const t = step.whistles === null ? timerOfStep(g, step.key) : null;
  const state = t ? timerState(t, now) : null;
  const cook = cookSteps(g);
  const i = cook.findIndex((st) => st.key === step.key);
  const open = cook.slice(i + 1).find((st) => !isDone(g, st.key)) ?? null;
  const keeps = step.whistles !== null ? "the cooker keeps going" : "the timer keeps running";
  return {
    header: `STEP ${view.number} OF ${view.of} · ${step.whistles !== null ? "PRESSURE COOKER" : "HANDS OFF"}`,
    ring:
      t && state
        ? {
            timerId: t.id,
            clock: state === "ended" ? "Done" : clockText(timerLeftMs(t, now)),
            sub: state === "ended" ? (view.checkpoint?.text ?? "Time's up") : state === "paused" ? "Paused" : `of ${clockText(t.totalMs)}`,
            fraction: timerFraction(t, now),
            state,
          }
        : null,
    pingLine: step.whistles !== null ? "Count each whistle as you hear it" : "We'll ping you when it's done",
    meanwhile: meanwhile(s, step.key),
    goOn: open && state !== "ended" ? { key: open.key, label: `Go on to step ${cook.indexOf(open) + 1} · ${keeps}` } : null,
  };
}

// ── The prompt (GuidePrompt) ──────────────────────────────────────

export interface LongPrepView {
  key: string;
  /** "Soak the rajma in water · 8 h first". */
  title: string;
  /** Its lines as chips' words ("1 cup rajma"). */
  lines: string[];
  /** "Long prep, so it shows before anything else", "7 h 59 min left · we'll ping you", "Time's up", "Done". */
  sub: string;
  state: "idle" | "running" | "ended" | "done";
  /** "Soak now · ping me". */
  startLabel: string;
  /** "Already done", or "Done" once its timer is up. */
  doneLabel: string;
  timerId: string | null;
  pushNote: string | null;
}

/** What is left of a long wait, in words: "7 h 59 min", or the clock under an hour. */
function leftText(ms: number): string {
  if (ms >= 3_600_000) return durationText(Math.ceil(ms / 60_000) * 60);
  return clockText(ms);
}

export function longPrepView(s: CookSession, step: GuideStep, now: Date): LongPrepView {
  const g = s.guide!;
  const f = factorOf(s);
  const seconds = timerSecondsOf(step, f) ?? step.minSeconds ?? 0;
  const t = timerOfStep(g, step.key);
  const state = isDone(g, step.key) ? "done" : !t ? "idle" : timerState(t, now) === "ended" ? "ended" : "running";
  const sub =
    state === "done"
      ? "Done"
      : state === "ended"
        ? "Time's up"
        : state === "running"
          ? `${timerState(t!, now) === "paused" ? "Paused" : leftText(timerLeftMs(t!, now))} left · we'll ping you`
          : "Long prep, so it shows before anything else";
  return {
    key: step.key,
    title: `${step.text.trim()} · ${durationText(seconds)} first`,
    lines: stepChips(s, step).map((c) => c.label),
    sub,
    state,
    startLabel: `${timerWord(step.text) ?? "Start"} now · ping me`,
    doneLabel: state === "ended" ? "Done" : "Already done",
    timerId: t?.id ?? null,
    pushNote: pushNoteText(t),
  };
}

export interface PromptView {
  title: string;
  /** "For about 2 · ×0.45". */
  chip: string | null;
  longPrep: LongPrepView[];
  /** The guided card waits for long prep. */
  dimmed: boolean;
  /** Under "Cook it step by step". */
  sub: string;
  /** Steps · about N minutes · N hands on. */
  stats: { value: string; label: string }[];
  /** The bar: each step's share, hands on or waiting. */
  bar: { minutes: number; handsOff: boolean }[];
  barLabel: string;
  /** Before you start: the prep, the tools, the timers that start then. */
  before: string[];
  /** Under Start step by step while it waits ("After: Soak the rajma"). */
  startSub: string | null;
}

/** The prompt (design §3.1). */
export function promptView(s: CookSession, now: Date): PromptView | null {
  const g = s.guide;
  if (!g) return null;
  const f = factorOf(s);
  const long = longPrepSteps(g).map((st) => longPrepView(s, st, now));
  const waiting = long.filter((l) => l.state !== "done");
  const timed = [...prepSteps(g), ...cookSteps(g)];
  const bar = timed.map((st) => ({ minutes: Math.max(1, Math.round(estimateSeconds(st, f) / 60)), handsOff: st.handsOff }));
  const total = bar.reduce((a, b) => a + b.minutes, 0);
  const hands = bar.filter((b) => !b.handsOff).reduce((a, b) => a + b.minutes, 0);
  const before = [
    ...prepSteps(g).map((st) => {
      const secs = timerSecondsOf(st, f);
      if (secs === null) return st.text;
      return st.handsOff ? `${st.text} · ${durationText(secs)} hands off, with a timer` : `${st.text} · about ${durationText(estimateSeconds(st, f))}`;
    }),
    ...g.tools,
  ];
  return {
    title: s.name,
    chip: scaleChip(s)?.label ?? null,
    longPrep: long,
    dimmed: waiting.length > 0,
    sub: waiting.length > 0 ? "Starts after the long prep" : "Each step, its flame, a timer and when it's done",
    stats: [
      { value: String(cookSteps(g).length), label: cookSteps(g).length === 1 ? "Step" : "Steps" },
      { value: `about ${total}`, label: "Minutes" },
      { value: String(hands), label: "Hands on" },
    ],
    bar,
    barLabel: `About ${total} minutes: ${hands} hands on, ${total - hands} waiting`,
    before,
    startSub: waiting[0] ? `After: ${longPrepSteps(g).find((st) => st.key === waiting[0]!.key)!.text.trim()}` : null,
  };
}

// ── Before you start (GuidePrep) ──────────────────────────────────

export interface PrepRowView {
  key: string;
  text: string;
  /** "1½ onions · about 7 min", "15 min · hands off". */
  sub: string;
  ticked: boolean;
  checkLabel: string;
  /** A hands-off prep step's timer: Start N min, then what is left. */
  timer: { label: string; state: "idle" | TimerState; timerId: string | null } | null;
}

export interface PrepScreenView {
  /** "CHICKEN CURRY · FOR ABOUT 2 · ×0.45". */
  header: string;
  tools: { index: number; name: string; ticked: boolean; checkLabel: string }[];
  prep: PrepRowView[];
  /** "6 of 10 ready". */
  ready: { done: number; of: number; text: string };
  /** "Start cooking", or "Back to cooking" once it has started. */
  startTitle: string;
  /** "Step 1 of 8". */
  startSub: string;
}

export function prepScreen(s: CookSession, now: Date): PrepScreenView | null {
  const g = s.guide;
  if (!g) return null;
  const f = factorOf(s);
  const prepList = [...longPrepSteps(g), ...prepSteps(g)].sort((a, b) => a.position - b.position);
  const prep = prepList.map((st): PrepRowView => {
    const secs = timerSecondsOf(st, f);
    const t = timerOfStep(g, st.key);
    const state = t ? timerState(t, now) : "idle";
    const time = secs === null ? null : st.handsOff ? `${durationText(secs)} · hands off` : `about ${durationText(estimateSeconds(st, f))}`;
    const ticked = isDone(g, st.key);
    return {
      key: st.key,
      text: st.text,
      sub: [...stepChips(s, st).map((c) => c.label), time].filter((x): x is string => !!x).join(" · "),
      ticked,
      checkLabel: `${ticked ? "Untick" : "Tick"} ${st.text}`,
      timer:
        st.handsOff && secs !== null && !ticked
          ? {
              label: !t ? `Start ${durationText(secs)}` : state === "ended" ? "Ready" : state === "paused" ? "Paused" : clockText(timerLeftMs(t, now)),
              state,
              timerId: t?.id ?? null,
            }
          : null,
    };
  });
  const tools = g.tools.map((name, index) => {
    const ticked = g.toolsDone.includes(index);
    return { index, name, ticked, checkLabel: `${ticked ? "Untick" : "Tick"} ${name}` };
  });
  const lines = progress(s);
  const done = lines.ticked + tools.filter((t) => t.ticked).length + prep.filter((p) => p.ticked).length;
  const of = lines.of + tools.length + prep.length;
  const cook = cookSteps(g);
  const firstOpen = cook.findIndex((st) => !isDone(g, st.key));
  const chip = scaleChip(s)?.label;
  return {
    header: [s.name.trim(), chip].filter((x): x is string => !!x).join(" · ").toUpperCase(),
    tools,
    prep,
    ready: { done, of, text: `${done} of ${of} ready` },
    startTitle: g.cookStartedAt ? "Back to cooking" : "Start cooking",
    startSub: cook.length === 0 || firstOpen < 0 ? "Who ate?" : `Step ${firstOpen + 1} of ${cook.length}`,
  };
}

// ── Done (GuideDone) ──────────────────────────────────────────────

export interface DoneRowView {
  key: string;
  name: string;
  /** "11 min", "40 s", "Not ticked". */
  time: string;
  /** "Usually 7–9 min at this size", "8–10 min as written", "3 whistles"; null when there is nothing to go by. */
  usual: string | null;
  /** Today took longer than the usual range. */
  slow: boolean;
  /** The bar: the usual range and today's mark, in % of the longest row; null without a time. */
  bar: { lowPct: number; highPct: number; markPct: number } | null;
}

export interface DoneScreenView {
  /** "Chicken curry is done". */
  title: string;
  /** "47:12". */
  total: string;
  /** Hands on · Steps · Cost. */
  stats: { value: string; label: string }[];
  rows: DoneRowView[];
  /** Use today's times next time (your own recipe or copy, with timed steps ticked); null otherwise. */
  useTimes: { on: boolean; sub: string; steps: number } | null;
}

/** Today's time in words: "11 min", or seconds under a minute. */
function realText(seconds: number): string {
  return seconds < 60 ? `${Math.round(seconds)} s` : durationText(seconds);
}

/** What the session's lines come to (every line that is in, as Finish's Took them all counts them). */
export function sessionCostMinor(s: CookSession): number {
  return s.lines.filter((l) => !l.missing).reduce((a, l) => a + (sessionLineCost(l) ?? 0), 0);
}

/** Done (design §3.6): the time in all, hands on, steps and cost, and how each step went against the usual at this size. */
export function doneScreen(s: CookSession, now: Date): DoneScreenView | null {
  const g = s.guide;
  if (!g) return null;
  const f = factorOf(s);
  const cook = cookSteps(g);
  const start = g.cookStartedAt ? Date.parse(g.cookStartedAt) : Number.NaN;
  const end = g.finishedAt ? Date.parse(g.finishedAt) : now.getTime();
  const totalMs = Number.isNaN(start) ? 0 : Math.max(0, end - start);
  const facts = cook.map((st) => {
    const real = realSeconds(g.times[st.key]);
    const at = timeAtSize(st, f);
    let usual: { low: number; high: number; text: string } | null = null;
    if (st.learned && st.learned.highSeconds >= st.learned.lowSeconds) {
      const range = { minSeconds: wholeStepMinutes(st.learned.lowSeconds), maxSeconds: wholeStepMinutes(st.learned.highSeconds) };
      usual = { low: range.minSeconds, high: range.maxSeconds, text: `Usually ${rangeText(range)} at this size` };
    } else if (at && "minSeconds" in at) {
      usual = { low: at.minSeconds, high: at.maxSeconds, text: f === 1000 ? `${rangeText(at)} as written` : `${rangeText(at)} at this size` };
    }
    const whistles = at && "whistles" in at ? `${at.whistles} ${at.whistles === 1 ? "whistle" : "whistles"}` : null;
    return { st, real, usual, whistles };
  });
  const longest = Math.max(1, ...facts.map((x) => Math.max(x.real ?? 0, x.usual?.high ?? 0))) * 1.1;
  const pct = (sec: number) => Math.round(Math.min(100, (sec / longest) * 100) * 10) / 10;
  const rows = facts.map(({ st, real, usual, whistles }): DoneRowView => {
    const slow = real !== null && usual !== null && real > usual.high + 30;
    return {
      key: st.key,
      name: st.text,
      time: real === null ? "Not ticked" : realText(real),
      usual: usual ? `${usual.text}${slow ? " · slower today" : ""}` : whistles,
      slow,
      bar: real === null ? null : { lowPct: usual ? pct(usual.low) : 0, highPct: usual ? pct(usual.high) : 0, markPct: pct(real) },
    };
  });
  const handsOn = facts.filter((x) => !x.st.handsOff && x.real !== null).reduce((a, x) => a + x.real!, 0);
  const doneCount = cook.filter((st) => isDone(g, st.key)).length;
  const times = todaysStepTimes(s);
  return {
    title: `${s.name.trim() || "Your dish"} is done`,
    total: clockText(totalMs),
    stats: [
      { value: handsOn > 0 ? realText(handsOn) : "—", label: "Hands on" },
      { value: `${doneCount} of ${cook.length}`, label: "Steps" },
      { value: formatMinor(sessionCostMinor(s), sessionCurrency(s)), label: "Cost" },
    ],
    rows,
    useTimes: times
      ? {
          on: g.timesSaved,
          steps: times.steps.length,
          sub: g.timesSaved
            ? "Your recipe now reads today's times, at its own size"
            : `${times.steps.length} timed ${times.steps.length === 1 ? "step" : "steps"}, written back at the recipe's own size`,
        }
      : null,
  };
}
