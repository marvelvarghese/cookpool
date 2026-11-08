/**
 * Guided mode's part of the cooking session's draft (cookpool-guided GC-5,
 * design §3): what the session keeps on the device beside RC-6's lines —
 * the mode, the recipe's guided steps, where the cook is, each step's start
 * and tick, the prep and tool ticks, the running timers (with the server
 * timer each one set) and the whistles counted.
 *
 * A leaf module (contract types only), so `cook-session.ts` can read it back
 * (`parseGuide`) and post its step log (`guideStepLog`) without importing the
 * rest of guided mode, which builds on the session (`cook-guided.ts`).
 */

import { MAX_STEP_LOG, type KitchenRecipeStep, type StepLogEntry } from "@saas/contracts/kitchen";

/** Step by step, or RC-6's screen ("Just tick what I use"). */
export type GuideMode = "guided" | "tick";

/**
 * A step's learned range (GC-7): the middle half of cooks' times, scaled to
 * the caller's size. The recipe read carries it on `guidedSteps[]` once GC-7
 * lands; until then it is absent, and nothing shows.
 */
export interface LearnedRange {
  lowSeconds: number;
  highSeconds: number;
  cooks: number;
}

/** A step as the session keeps it: the recipe's own, with its learned range when the read had one. */
export type GuideStep = KitchenRecipeStep & { learned?: LearnedRange | null };

/** When a step was started and ticked (ISO); null until then. */
export interface StepTimes {
  startedAt: string | null;
  doneAt: string | null;
}

/**
 * Where a timer's push stands: `pending` (a server timer is to be set for
 * its current end), `set` (it is: `serverId`), `here` (it rings only in the
 * page — the page took it over just before its end, the server refused it, or
 * it is too short for a push).
 */
export type TimerPush = "pending" | "set" | "here";

/** Why a timer rings only here, when it is not the page's own doing. */
export type TimerPushNote = "too_many" | "failed" | "short";

/** One running timer: a step's simmer, a prep's rest, a soak. */
export interface GuideTimer {
  /** "t3": the session's own id. */
  id: string;
  /** The step it times. */
  stepKey: string;
  /** The push's title: "Simmer done · Chicken curry". */
  label: string;
  /** The push's text: "Next: Cut the thickest piece open". */
  body: string;
  /** When it ends (ISO) while it runs; null while paused. */
  endsAt: string | null;
  /** What was left when it was paused (ms); null while it runs. */
  pausedLeftMs: number | null;
  /** Its whole length (ms), +1 min included: the ring's 100 %. */
  totalMs: number;
  /** The server timer (`tmr_…`) set for its current end; null while there is none. */
  serverId: string | null;
  push: TimerPush;
  pushNote: TimerPushNote | null;
  /** The page rang it (or saw it end while hidden: the server pushed it). */
  rang: boolean;
  /** Its banner was dismissed. */
  seen: boolean;
}

/** What guided mode shows once the prompt is answered: Before you start, a step, or Done. */
export const GUIDE_SCREENS = ["prep", "step", "done"] as const;
export type GuideScreen = (typeof GUIDE_SCREENS)[number];

export interface CookGuide {
  /** null until the prompt is answered. */
  mode: GuideMode | null;
  /** The recipe's guided steps, prep and cook, in order. */
  steps: GuideStep[];
  /** The recipe's tools. */
  tools: string[];
  screen: GuideScreen;
  /** The cook step shown (its key) while `screen` is "step". */
  current: string | null;
  /** When the screen or the step shown last changed (ISO). */
  shownAt: string | null;
  /** When Start cooking was pressed (ISO): "14 MIN IN" counts from it. */
  cookStartedAt: string | null;
  /** When Finish was pressed on the last step (ISO). */
  finishedAt: string | null;
  /** Per step key. */
  times: Record<string, StepTimes>;
  /** Prep steps ticked (keys), long prep "Already done" among them. */
  prepDone: string[];
  /** Tools ticked (their indexes). */
  toolsDone: number[];
  timers: GuideTimer[];
  /** Server timers to cancel (paused, ticked, taken over): drained as the page can. */
  cancels: string[];
  /** Whistles counted, per step key. */
  whistles: Record<string, number>;
  /** Keep the screen on (the switch; on by default). */
  screenOn: boolean;
  /** "Use today's times next time" is on: today's times were written to the recipe. */
  timesSaved: boolean;
  /** The next timer's number. */
  seq: number;
}

// ── Reading it back ───────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isString = (v: unknown): v is string => typeof v === "string";
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isNumberOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));

function isStep(v: unknown): v is GuideStep {
  return (
    isObject(v) &&
    isString(v["key"]) &&
    isString(v["text"]) &&
    (v["phase"] === "prep" || v["phase"] === "cook") &&
    Array.isArray(v["lines"]) &&
    isNumberOrNull(v["minSeconds"]) &&
    isNumberOrNull(v["maxSeconds"]) &&
    isNumberOrNull(v["whistles"]) &&
    typeof v["handsOff"] === "boolean"
  );
}

function isTimer(v: unknown): v is GuideTimer {
  return (
    isObject(v) &&
    isString(v["id"]) &&
    isString(v["stepKey"]) &&
    isString(v["label"]) &&
    isString(v["body"]) &&
    isStringOrNull(v["endsAt"]) &&
    isNumberOrNull(v["pausedLeftMs"]) &&
    typeof v["totalMs"] === "number" &&
    isStringOrNull(v["serverId"]) &&
    (v["push"] === "pending" || v["push"] === "set" || v["push"] === "here")
  );
}

/**
 * A stored guide, as read back: the guide when it is one this version wrote,
 * else null — and the session then reads as RC-6's (`cook-session.ts`'s
 * `parseSession` drops it), so a bad guide never loses the lines.
 */
export function parseGuide(v: unknown): CookGuide | null {
  if (!isObject(v)) return null;
  if (v["mode"] !== null && v["mode"] !== "guided" && v["mode"] !== "tick") return null;
  if (!Array.isArray(v["steps"]) || !v["steps"].every(isStep)) return null;
  if (!Array.isArray(v["tools"]) || !v["tools"].every(isString)) return null;
  if (!GUIDE_SCREENS.includes(v["screen"] as GuideScreen)) return null;
  if (!isStringOrNull(v["current"]) || !isStringOrNull(v["shownAt"]) || !isStringOrNull(v["cookStartedAt"]) || !isStringOrNull(v["finishedAt"])) return null;
  if (!isObject(v["times"]) || !isObject(v["whistles"])) return null;
  if (!Array.isArray(v["prepDone"]) || !v["prepDone"].every(isString)) return null;
  if (!Array.isArray(v["toolsDone"]) || !v["toolsDone"].every((n) => typeof n === "number")) return null;
  if (!Array.isArray(v["timers"]) || !v["timers"].every(isTimer)) return null;
  if (!Array.isArray(v["cancels"]) || !v["cancels"].every(isString)) return null;
  if (typeof v["screenOn"] !== "boolean" || typeof v["timesSaved"] !== "boolean" || typeof v["seq"] !== "number") return null;
  return v as unknown as CookGuide;
}

// ── What Finish posts ─────────────────────────────────────────────

/**
 * The step log the dish write takes (design §5): one entry per cook step
 * that has both a start and a tick, ticked no earlier than it started, in
 * step order — prep is not timed into the pool.
 */
export function guideStepLog(guide: CookGuide | null | undefined): StepLogEntry[] {
  if (!guide || guide.mode !== "guided") return [];
  const out: StepLogEntry[] = [];
  for (const step of guide.steps) {
    if (step.phase !== "cook") continue;
    const t = guide.times[step.key];
    if (!t?.startedAt || !t.doneAt) continue;
    const start = Date.parse(t.startedAt);
    const done = Date.parse(t.doneAt);
    if (Number.isNaN(start) || Number.isNaN(done) || done < start) continue;
    out.push({ key: step.key, startedAt: t.startedAt, doneAt: t.doneAt });
  }
  return out.slice(0, MAX_STEP_LOG);
}
