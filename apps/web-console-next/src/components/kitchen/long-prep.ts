/**
 * Long prep first (cookpool-guided GC-6, design §1, the canvas's
 * `GuidePrompt` soak card): a hands-off prep step of an hour or more —
 * soaking rajma, marinating overnight — shows at the top of the recipe page
 * in an amber card, with **Soak now · ping me** (a server timer, GC-3, whose
 * push opens the recipe again) and **Already done**.
 *
 * What this device remembers of it is one small record per recipe step
 * (`LongPrepMemory`): done (kept for a day), or started with its timer
 * (counted as done once the timer has ended, for a day more). It lives in
 * localStorage (lib/long-prep-store.ts) and is forgotten on sign-out.
 *
 * Pure (contract types and constants), so unit-testable.
 */

import {
  KITCHEN_TIMERS_MAX_ACTIVE,
  KITCHEN_TIMER_BODY_MAX,
  KITCHEN_TIMER_ERROR_REASONS,
  KITCHEN_TIMER_LABEL_MAX,
  KITCHEN_TIMER_MAX_SECONDS,
  KITCHEN_TIMER_MIN_SECONDS,
  type CreateKitchenTimerRequest,
  type KitchenTimerResponse,
  type LongPrepStep,
} from "@saas/contracts/kitchen";
import { minutesText, recipeHref } from "./recipes";
import { dayAndTimeText, localDayOffset, timeText } from "./when";

/** How long "Already done" (and an ended timer) is remembered on this device. */
export const LONG_PREP_MEMORY_MS = 24 * 60 * 60 * 1000;

/** What this device remembers of one long prep step. */
export type LongPrepMark = { state: "done"; at: string } | { state: "started"; at: string; endsAt: string; timerId: string };

/** Every remembered step, by `longPrepKey`. */
export type LongPrepMemory = Readonly<Record<string, LongPrepMark>>;

/** Where a step's record is kept: the recipe and the step's key. */
export function longPrepKey(recipeId: string, stepKey: string): string {
  return `${recipeId}:${stepKey}`;
}

function time(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Until when a record means anything: a day after "done", a day after the timer's end. */
function expiresAt(mark: LongPrepMark): number | null {
  const from = mark.state === "done" ? time(mark.at) : time(mark.endsAt);
  return from === null ? null : from + LONG_PREP_MEMORY_MS;
}

/** The stored text as memory: anything that is not a sound record is dropped. */
export function parseLongPrepMemory(raw: string | null | undefined): LongPrepMemory {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, LongPrepMark> = {};
  for (const [key, m] of Object.entries(value as Record<string, unknown>)) {
    if (!m || typeof m !== "object") continue;
    const mark = m as Record<string, unknown>;
    if (mark.state === "done" && time(mark.at) !== null) out[key] = { state: "done", at: mark.at as string };
    else if (mark.state === "started" && time(mark.at) !== null && time(mark.endsAt) !== null && typeof mark.timerId === "string") {
      out[key] = { state: "started", at: mark.at as string, endsAt: mark.endsAt as string, timerId: mark.timerId };
    }
  }
  return out;
}

/** The memory without the records past their day. */
export function pruneLongPrep(memory: LongPrepMemory, now: Date): LongPrepMemory {
  const out: Record<string, LongPrepMark> = {};
  for (const [key, mark] of Object.entries(memory)) {
    const until = expiresAt(mark);
    if (until !== null && until > now.getTime()) out[key] = mark;
  }
  return out;
}

/** One record set (or replaced). */
export function markLongPrep(memory: LongPrepMemory, recipeId: string, stepKey: string, mark: LongPrepMark): LongPrepMemory {
  return { ...memory, [longPrepKey(recipeId, stepKey)]: mark };
}

/** Where a long prep step stands on this device. */
export type LongPrepStatus = { state: "todo" } | { state: "started"; endsAt: string } | { state: "done" };

/** To do; started (its timer still running); or done — marked, or its timer ended — within the day. */
export function longPrepStatus(memory: LongPrepMemory, recipeId: string, stepKey: string, now: Date): LongPrepStatus {
  const mark = memory[longPrepKey(recipeId, stepKey)];
  if (!mark) return { state: "todo" };
  const until = expiresAt(mark);
  if (until === null || until <= now.getTime()) return { state: "todo" };
  if (mark.state === "done") return { state: "done" };
  return (time(mark.endsAt) ?? 0) > now.getTime() ? { state: "started", endsAt: mark.endsAt } : { state: "done" };
}

/** The long-prep verbs a button can say ("Soak now · ping me"); anything else reads "Start now". */
const VERBS = ["soak", "marinate", "rest", "rise", "proof", "chill", "ferment", "brine", "steep", "thaw", "defrost", "set"];

/** The button's verb, from the step's first word: "Soak", "Marinate"; "Start" when it is none of the long-prep verbs. */
export function longPrepVerb(text: string): string {
  const first = (text.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return VERBS.includes(first) ? first.charAt(0).toUpperCase() + first.slice(1) : "Start";
}

/** The main button: "Soak now · ping me". */
export function longPrepStartLabel(text: string): string {
  return `${longPrepVerb(text)} now · ping me`;
}

/** How long it takes, in words: "8 h", "1 h 30 min". */
export function longPrepDuration(step: Pick<LongPrepStep, "seconds">): string {
  return minutesText(Math.max(1, Math.round(step.seconds / 60)));
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The server timer for a long prep step (GC-3's `POST /v1/kitchen/me/timers`):
 * the recipe's name as the push's title, "Time's up: Soak 1 cup rajma…" as
 * its text, the recipe's page as where it opens (with the link code, for a
 * recipe opened by its link), ending its shortest time from now.
 */
export function longPrepTimerRequest(
  recipe: { id: string; name: string },
  step: Pick<LongPrepStep, "seconds" | "text">,
  now: Date,
  code?: string | null,
): CreateKitchenTimerRequest {
  const seconds = Math.min(KITCHEN_TIMER_MAX_SECONDS, Math.max(KITCHEN_TIMER_MIN_SECONDS, Math.round(step.seconds)));
  const url = code ? `${recipeHref(recipe.id)}?code=${encodeURIComponent(code)}` : recipeHref(recipe.id);
  return {
    label: clip(recipe.name, KITCHEN_TIMER_LABEL_MAX),
    body: clip(`Time's up: ${step.text}`, KITCHEN_TIMER_BODY_MAX),
    url,
    endsAt: new Date(now.getTime() + seconds * 1000).toISOString(),
  };
}

/** A write's answer, as the console's API wrapper gives it (lib/api.ts's `ApiResult`). */
export type TimerResult =
  | { ok: true; data: KitchenTimerResponse }
  | { ok: false; status: number; error: { code: string; message: string; reason?: string | undefined } };

/**
 * Soak now · ping me: sets the timer and, once the server has it, the record
 * to remember (started, with its id and end). A refusal says why — ten
 * timers already running, or the server's words; offline says nothing (the
 * write was held back, and the banner says so).
 */
export async function startLongPrep(
  createTimer: (body: CreateKitchenTimerRequest) => Promise<TimerResult>,
  recipe: { id: string; name: string },
  step: Pick<LongPrepStep, "seconds" | "text">,
  now: Date,
  code?: string | null,
): Promise<{ ok: true; mark: LongPrepMark } | { ok: false; message: string | null }> {
  const r = await createTimer(longPrepTimerRequest(recipe, step, now, code));
  if (r.ok) return { ok: true, mark: { state: "started", at: now.toISOString(), endsAt: r.data.timer.endsAt, timerId: r.data.timer.id } };
  if (r.error.reason === "offline") return { ok: false, message: null };
  if (r.error.reason === KITCHEN_TIMER_ERROR_REASONS.TOO_MANY_TIMERS) {
    return { ok: false, message: `You have ${KITCHEN_TIMERS_MAX_ACTIVE} timers running. Cancel one to set this.` };
  }
  return { ok: false, message: `Couldn't set the timer. ${r.error.message}`.trim() };
}

/** When a started step's timer ends, as "we'll ping you at …" says it: "6:30 pm" today, else "tomorrow, 6:30 am". */
export function pingTimeText(endsAt: string, now: Date): string {
  const at = new Date(endsAt);
  if (Number.isNaN(at.getTime())) return "";
  return localDayOffset(at, now) === 0 ? timeText(endsAt) : dayAndTimeText(endsAt, now);
}

/** One long prep step as the card draws it. */
export interface LongPrepRow {
  key: string;
  /** "Soak 1 cup rajma overnight". */
  text: string;
  /** "8 h". */
  duration: string;
  /** "Soak now · ping me". */
  startLabel: string;
  status: LongPrepStatus;
}

/** The card's rows: every long prep step not done on this device, in step order. */
export function longPrepRows(recipeId: string, steps: readonly LongPrepStep[], memory: LongPrepMemory, now: Date): LongPrepRow[] {
  return steps.flatMap((s) => {
    const status = longPrepStatus(memory, recipeId, s.key, now);
    if (status.state === "done") return [];
    return [{ key: s.key, text: s.text, duration: longPrepDuration(s), startLabel: longPrepStartLabel(s.text), status }];
  });
}
