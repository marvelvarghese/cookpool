/**
 * Writing a guided step (cookpool-guided GC-6, design §1, the canvas's
 * `GuideEditor`): each step of the recipe form is a draft — Prep or Cook,
 * what to do, the lines that go in now, the flame, a time in minutes (a
 * range) or whistles, hands off, how the time grows with more food, what to
 * watch for and a tip — and every edit is a pure function of it.
 *
 * A step keeps the server's `key` it was read with, and sends it back, so
 * its key — what cooks' times and learned ranges hang on (§5) — survives an
 * edit. A step of text only that has no key is sent as its text, as RC-5's
 * form sent every step.
 *
 * Its lines are held by the form's line keys, so they follow the lines as
 * they move; they are turned into positions only when the form is sent.
 *
 * Dependency-free (contract types and constants, guided-steps.ts's words),
 * so unit-testable.
 */

import {
  MAX_STEP_CHECKPOINT,
  MAX_STEP_SECONDS,
  MAX_STEP_TIP,
  MAX_STEP_WHISTLES,
  type KitchenRecipeStep,
  type RecipeStepInput,
  type RecipeStepWrite,
  type StepHeat,
  type StepPhase,
  type StepSense,
  type StepTimeRule,
} from "@saas/contracts/kitchen";
import { checkpointText, flameText, rangeText, whistlesText } from "./guided-steps";
import { halvesText } from "./recipes";

/** How a step is timed: not at all, in minutes (a range), or in a pressure cooker's whistles. */
export type StepTimeKind = "none" | "minutes" | "whistles";

/** One step as the form holds it. */
export interface StepDraft {
  /** The form's own id for it (React's key, its fields' ids). */
  id: string;
  /** The server's key, for a step read from the recipe; null for a new one. Sent back, so it survives the edit. */
  key: string | null;
  text: string;
  phase: StepPhase;
  /** The form's keys of the lines that go in now. */
  lines: string[];
  /** Null when the step says no flame. */
  heat: StepHeat | null;
  timeKind: StepTimeKind;
  /** The range, in seconds, at the recipe's own size; kept while another kind is chosen. */
  minSeconds: number;
  maxSeconds: number;
  whistles: number;
  handsOff: boolean;
  timeRule: StepTimeRule;
  /** Sent only with a checkpoint (the server needs one for a sense). */
  sense: StepSense | null;
  /** As typed. */
  checkpoint: string;
  /** As typed. */
  tip: string;
}

/** A range starts at 8–10 minutes, and whistles at 3, as the canvas's do. */
export const DEFAULT_STEP_RANGE = { minSeconds: 8 * 60, maxSeconds: 10 * 60 } as const;
export const DEFAULT_STEP_WHISTLES = 3;
/** The shortest a minutes step can be set to: one minute. */
export const MIN_STEP_SECONDS = 60;

/** A new step: text only (or with these words), cooked, untimed. */
export function blankStep(id: string, text = ""): StepDraft {
  return {
    id, key: null, text, phase: "cook", lines: [], heat: null, timeKind: "none", ...DEFAULT_STEP_RANGE,
    whistles: DEFAULT_STEP_WHISTLES, handsOff: false, timeRule: "fixed", sense: null, checkpoint: "", tip: "",
  };
}

/**
 * A step as the recipe read gives it, as the form starts it: its key and
 * every field, its lines as the form's keys for them (`lineKeyAt` gives the
 * key of the line at a position; a position it does not know is dropped).
 */
export function stepFromRecipe(step: KitchenRecipeStep, id: string, lineKeyAt: (position: number) => string | undefined): StepDraft {
  const timeKind: StepTimeKind = step.whistles !== null ? "whistles" : step.minSeconds !== null || step.maxSeconds !== null ? "minutes" : "none";
  const lo = step.minSeconds ?? step.maxSeconds;
  const hi = step.maxSeconds ?? step.minSeconds;
  return {
    id,
    key: step.key || null,
    text: step.text,
    phase: step.phase,
    lines: step.lines.map(lineKeyAt).filter((k): k is string => k !== undefined),
    heat: step.heat,
    timeKind,
    minSeconds: lo ?? DEFAULT_STEP_RANGE.minSeconds,
    maxSeconds: hi ?? DEFAULT_STEP_RANGE.maxSeconds,
    whistles: step.whistles ?? DEFAULT_STEP_WHISTLES,
    handsOff: step.handsOff,
    timeRule: step.timeRule,
    sense: step.sense,
    checkpoint: step.checkpoint ?? "",
    tip: step.tip ?? "",
  };
}

/** A step of text only and no key: sent as its words alone. */
export function isPlainDraft(d: StepDraft): boolean {
  return (
    d.key === null && d.phase === "cook" && d.lines.length === 0 && d.heat === null && d.timeKind === "none" && !d.handsOff &&
    d.timeRule === "fixed" && d.checkpoint.trim() === "" && d.tip.trim() === ""
  );
}

/**
 * The step as a write takes it: its text alone for a plain step, else every
 * field — the key it was read with, its lines as positions in the lines
 * sent (`positionOf`; a line not sent is dropped), seconds or whistles for
 * its kind and nothing for the other, a sense only with a checkpoint.
 */
export function stepWrite(d: StepDraft, positionOf: (lineKey: string) => number | undefined): RecipeStepWrite {
  const text = d.text.trim();
  if (isPlainDraft(d)) return text;
  const checkpoint = d.checkpoint.trim();
  const tip = d.tip.trim();
  const lines = [...new Set(d.lines.map(positionOf).filter((p): p is number => p !== undefined))].sort((a, b) => a - b);
  const step: RecipeStepInput = {
    text,
    phase: d.phase,
    lines,
    heat: d.heat,
    minSeconds: d.timeKind === "minutes" ? d.minSeconds : null,
    maxSeconds: d.timeKind === "minutes" ? d.maxSeconds : null,
    whistles: d.timeKind === "whistles" ? d.whistles : null,
    handsOff: d.handsOff,
    timeRule: d.timeRule,
    sense: checkpoint ? d.sense : null,
    checkpoint: checkpoint || null,
    tip: tip || null,
  };
  return d.key ? { key: d.key, ...step } : step;
}

/** What is wrong with a step before it is sent, by part; empty when nothing is. */
export interface StepFieldErrors {
  text?: string;
  lines?: string;
  heat?: string;
  time?: string;
  phase?: string;
  handsOff?: string;
  timeRule?: string;
  checkpoint?: string;
  tip?: string;
}

/** The form's own checks on a step that will be sent (a blank plain step is left out before this). */
export function stepProblems(d: StepDraft, maxText: number): StepFieldErrors {
  const e: StepFieldErrors = {};
  const text = d.text.trim();
  if (!text) e.text = "Say what to do";
  else if (text.length > maxText) e.text = `Keep it to ${maxText} characters`;
  if (d.checkpoint.trim().length > MAX_STEP_CHECKPOINT) e.checkpoint = `Keep it to ${MAX_STEP_CHECKPOINT} characters`;
  if (d.tip.trim().length > MAX_STEP_TIP) e.tip = `Keep it to ${MAX_STEP_TIP} characters`;
  return e;
}

// ── Edits ─────────────────────────────────────────────────────────

/** Toggle a line in or out of the step. */
export function toggleStepLine(d: StepDraft, lineKey: string): StepDraft {
  return { ...d, lines: d.lines.includes(lineKey) ? d.lines.filter((k) => k !== lineKey) : [...d.lines, lineKey] };
}

/** Pick a flame; picking the one chosen again takes the flame off the step (it says none). */
export function pickHeat(d: StepDraft, heat: StepHeat): StepDraft {
  return { ...d, heat: d.heat === heat ? null : heat };
}

/** Pick a sense; picking the one chosen again leaves the checkpoint without one ("Until golden brown"). */
export function pickSense(d: StepDraft, sense: StepSense): StepDraft {
  return { ...d, sense: d.sense === sense ? null : sense };
}

/** Time it in minutes, in whistles, or not at all; the other kind's numbers are kept for coming back. */
export function pickTimeKind(d: StepDraft, timeKind: StepTimeKind): StepDraft {
  return { ...d, timeKind };
}

/**
 * How far − and + move a time from `seconds`: a minute under 10 min, 5 min
 * under an hour, 15 min under 3 h, then an hour (a soak of 8 h is a few
 * taps, not 480).
 */
export function minuteStep(seconds: number, direction: 1 | -1): number {
  const minutes = seconds / 60;
  const small = (limit: number) => (direction > 0 ? minutes < limit : minutes <= limit);
  if (small(10)) return 1;
  if (small(60)) return 5;
  if (small(180)) return 15;
  return 60;
}

/** A time one step up or down, onto the step's grid, within one minute and a day. */
export function stepSeconds(seconds: number, direction: 1 | -1): number {
  const step = minuteStep(seconds, direction);
  const minutes = seconds / 60;
  const next = direction > 0 ? (Math.floor(minutes / step) + 1) * step : (Math.ceil(minutes / step) - 1) * step;
  return Math.min(MAX_STEP_SECONDS, Math.max(MIN_STEP_SECONDS, next * 60));
}

/**
 * Move one end of the range (`end`), the other following so the shortest is
 * never past the longest: pushing the shortest up past the longest takes
 * both; pulling the longest down under the shortest takes both.
 */
export function stepRange(d: StepDraft, end: "min" | "max", direction: 1 | -1): StepDraft {
  if (end === "min") {
    const minSeconds = stepSeconds(d.minSeconds, direction);
    return { ...d, timeKind: "minutes", minSeconds, maxSeconds: Math.max(minSeconds, d.maxSeconds) };
  }
  const maxSeconds = stepSeconds(d.maxSeconds, direction);
  return { ...d, timeKind: "minutes", maxSeconds, minSeconds: Math.min(maxSeconds, d.minSeconds) };
}

/** One whistle more or fewer, 1 to MAX_STEP_WHISTLES. */
export function stepWhistles(d: StepDraft, direction: 1 | -1): StepDraft {
  return { ...d, timeKind: "whistles", whistles: Math.min(MAX_STEP_WHISTLES, Math.max(1, d.whistles + direction)) };
}

// ── What the cook sees (the live preview) ─────────────────────────

/** A step's time in words, as written: "8–10 min", "3 whistles"; null untimed. */
export function draftTimeText(d: Pick<StepDraft, "timeKind" | "minSeconds" | "maxSeconds" | "whistles">): string | null {
  if (d.timeKind === "minutes") return rangeText(d.minSeconds, d.maxSeconds);
  if (d.timeKind === "whistles") return whistlesText(d.whistles);
  return null;
}

/** The preview's top line: "Medium flame · 8–10 min · Hands off" (each part when it is set); null for none. */
export function previewHeading(d: StepDraft): string | null {
  const parts = [flameText(d.heat), draftTimeText(d), d.handsOff ? "Hands off" : null].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The live preview (design §3.3 at the recipe's own size): what the cook will see on this step. */
export interface StepPreview {
  /** "The cook sees · serves 4". */
  label: string;
  heading: string | null;
  text: string;
  /** The lines that go in now, with their amounts as written ("3 onions", "Salt"). */
  chips: string[];
  /** "Until it looks golden brown". */
  checkpoint: string | null;
  tip: string | null;
  /** "Prep" for a prep step (it shows in Before you start); null for cooking. */
  phase: string | null;
}

/**
 * The preview at the recipe's own size: the flame and time in words, the
 * text and its chips (`chipOf` gives a line's chip by the form's key; a line
 * that is blank or gone gives none), and the checkpoint.
 */
export function stepPreview(d: StepDraft, servesHalf: number, chipOf: (lineKey: string) => string | null): StepPreview {
  const tip = d.tip.trim();
  return {
    label: `The cook sees · serves ${halvesText(servesHalf)}`,
    heading: previewHeading(d),
    text: d.text.trim() || "Say what to do",
    chips: d.lines.map(chipOf).filter((c): c is string => c !== null),
    checkpoint: checkpointText(d.sense, d.checkpoint),
    tip: tip || null,
    phase: d.phase === "prep" ? "Prep" : null,
  };
}

/** Under a folded step: "Prep · Medium flame · 8–10 min · Hands off · Until golden brown"; null when it is text only. */
export function stepSummary(d: StepDraft): string | null {
  const parts = [d.phase === "prep" ? "Prep" : null, previewHeading(d), checkpointText(d.sense, d.checkpoint)].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : null;
}
