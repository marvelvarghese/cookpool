/**
 * Guided steps on screen (cookpool-guided GC-6, design §1, §2, §3.5): the
 * words a step is read in — its flame, its time at a size, its rule, its
 * checkpoint, what cooks learned of it (GC-7) and the chips of the lines it
 * uses — and the plan (`planOf`): one row per step at a size, the totals
 * and the Meanwhile line under a hands-off step.
 *
 * Every time is the contracts' own: `stepTimeAt` scales a step by its rule
 * and rounds it to whole minutes exactly as the step screen (GC-5) does, so
 * the recipe page, the plan and the session read the same numbers.
 *
 * Pure and dependency-free (contract types and helpers, recipes.ts's
 * amounts), so it is unit-testable.
 */

import {
  isLongPrep,
  isRecipeUnit,
  longPrepOf,
  scalePortions,
  stepTimeAt,
  type KitchenRecipe,
  type KitchenRecipeLine,
  type KitchenRecipeStep,
  type LongPrepStep,
  type StepHeat,
  type StepPhase,
  type StepSense,
  type StepTimeAt,
  type StepTimeRule,
  type StepTiming,
} from "@saas/contracts/kitchen";
import { WRITTEN_FACTOR, amountText, clampFactor, lineAmountText, lowerFirst, mainAmountMilli, mainLineOf, minutesText, recipeHref } from "./recipes";

// ── What cooks learned (GC-7) ─────────────────────────────────────

/**
 * The range most cooks took for a step (design §5, GC-7): the 25th–75th
 * percentiles, in seconds, and how many cooks it is from. The recipe read
 * sends it on `guidedSteps[]` once a step has enough times; until GC-7
 * lands it is never there, and nothing is drawn.
 */
export interface LearnedRange {
  lowSeconds: number;
  highSeconds: number;
  cooks: number;
}

/** A guided step as the read gives it, with GC-7's `learned` when there is one. */
export type GuidedStep = KitchenRecipeStep & { learned?: LearnedRange | null };

/** A step's learned range when the read sent a sound one; null otherwise. */
export function learnedOf(step: { learned?: unknown }): LearnedRange | null {
  const l = step.learned as Partial<LearnedRange> | null | undefined;
  if (!l || typeof l !== "object") return null;
  const { lowSeconds, highSeconds, cooks } = l;
  if (typeof lowSeconds !== "number" || typeof highSeconds !== "number" || typeof cooks !== "number") return null;
  if (!Number.isFinite(lowSeconds) || !Number.isFinite(highSeconds) || !Number.isFinite(cooks)) return null;
  if (lowSeconds < 0 || highSeconds < lowSeconds || cooks < 1) return null;
  return { lowSeconds, highSeconds, cooks: Math.round(cooks) };
}

/**
 * A learned range at `factorMilli`. The console reads a recipe without a
 * size, so the range comes at the recipe's own size; it is scaled here by
 * the step's rule — as GC-7 normalises every time to × 1 by that rule and
 * scales the percentiles back — and rounded as `stepTimeAt` rounds.
 */
export function learnedAt(learned: LearnedRange, rule: StepTimeRule | null | undefined, factorMilli: number): LearnedRange {
  const at = stepTimeAt({ minSeconds: learned.lowSeconds, maxSeconds: learned.highSeconds, timeRule: rule ?? "fixed" }, factorMilli);
  if (!at || "whistles" in at) return learned;
  return { lowSeconds: at.minSeconds, highSeconds: at.maxSeconds, cooks: learned.cooks };
}

/** The learned badge: "Usually 7–9 min · 23 cooks". */
export function learnedText(learned: LearnedRange): string {
  return `Usually ${rangeText(learned.lowSeconds, learned.highSeconds)} · ${learned.cooks} ${learned.cooks === 1 ? "cook" : "cooks"}`;
}

/** A step's learned badge at a size, or null when nothing was learned (or the step counts whistles). */
export function learnedBadge(step: GuidedStep, factorMilli: number): string | null {
  const learned = learnedOf(step);
  if (!learned || step.whistles !== null) return null;
  return learnedText(learnedAt(learned, step.timeRule, factorMilli));
}

// ── A recipe's steps ──────────────────────────────────────────────

/**
 * A recipe's steps in full: `guidedSteps` when the read has them (GC-2's
 * server always sends them), else its texts as steps of text only — a
 * recipe cached before GC-2, or a fixture.
 */
export function guidedStepsOf(recipe: Pick<KitchenRecipe, "steps" | "guidedSteps">): GuidedStep[] {
  const guided = recipe.guidedSteps;
  if (guided && guided.length === recipe.steps.length) return guided as GuidedStep[];
  return recipe.steps.map((text, position) => plainStep(position, text));
}

/** A step of text only, as the server reads one back. */
export function plainStep(position: number, text: string, key = ""): GuidedStep {
  return {
    position, key, text, phase: "cook", lines: [], heat: null, minSeconds: null, maxSeconds: null, whistles: null,
    handsOff: false, timeRule: "fixed", sense: null, checkpoint: null, tip: null,
  };
}

/** Its long prep (design §1): what the read lists, else what its steps say. */
export function recipeLongPrep(recipe: Pick<KitchenRecipe, "steps" | "guidedSteps" | "longPrep">): LongPrepStep[] {
  return recipe.longPrep ?? longPrepOf(guidedStepsOf(recipe));
}

/** Whether any step has a time (minutes or whistles): only then has the recipe a plan worth opening. */
export function hasTimedSteps(recipe: Pick<KitchenRecipe, "steps" | "guidedSteps">): boolean {
  return guidedStepsOf(recipe).some((s) => s.minSeconds !== null || s.whistles !== null);
}

// ── The words ─────────────────────────────────────────────────────

/** The flame, as the editor's buttons name it: 0 off, 1 low, 2 medium, 3 high. */
export const HEAT_LABELS: readonly string[] = ["Off", "Low", "Medium", "High"];

/** "Flame off", "Low flame", "Medium flame", "High flame"; null when the step says no flame. */
export function flameText(heat: StepHeat | null | undefined): string | null {
  if (heat === null || heat === undefined) return null;
  if (heat === 0) return "Flame off";
  return `${HEAT_LABELS[heat]} flame`;
}

/** "1 whistle", "3 whistles". */
export function whistlesText(whistles: number): string {
  return `${whistles} ${whistles === 1 ? "whistle" : "whistles"}`;
}

/** Whole minutes, at least one. */
function wholeMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * A range in words: "8–10 min", "8 min" (one time), "1–2 h" (whole hours),
 * "45 min – 1 h 15 min". Each end in whole minutes, at least one.
 */
export function rangeText(minSeconds: number, maxSeconds: number): string {
  const lo = wholeMinutes(Math.min(minSeconds, maxSeconds));
  const hi = Math.max(lo, wholeMinutes(Math.max(minSeconds, maxSeconds)));
  if (lo === hi) return minutesText(lo);
  if (hi < 60) return `${lo}–${hi} min`;
  if (lo % 60 === 0 && hi % 60 === 0) return `${lo / 60}–${hi / 60} h`;
  return `${minutesText(lo)} – ${minutesText(hi)}`;
}

/** A step's time at a size in words ("8–10 min", "3 whistles"), or null when it is untimed. */
export function timeAtText(at: StepTimeAt | null): string | null {
  if (!at) return null;
  if ("whistles" in at) return whistlesText(at.whistles);
  return rangeText(at.minSeconds, at.maxSeconds);
}

/** A step's time at `factorMilli` (`stepTimeAt`), in words; null when untimed. */
export function stepTimeText(step: StepTiming, factorMilli: number): string | null {
  return timeAtText(stepTimeAt(step, factorMilli));
}

/** How a step's time grows with the size, as the editor's buttons say it. */
export const RULE_LABELS: Readonly<Record<StepTimeRule, string>> = {
  fixed: "Same time",
  partly: "A bit longer",
  linear: "Longer",
};

/** The same rule, as the plan says it under a step. */
export const RULE_WORDS: Readonly<Record<StepTimeRule, string>> = {
  fixed: "Same at any size",
  partly: "Partly follows the amount",
  linear: "Follows the amount",
};

/** A checkpoint's sense, as the editor's buttons name it. */
export const SENSE_LABELS: Readonly<Record<StepSense, string>> = {
  look: "Look",
  smell: "Smell",
  sound: "Sound",
  feel: "Feel",
  taste: "Taste",
};

const SENSE_VERBS: Readonly<Record<StepSense, string>> = {
  look: "looks",
  smell: "smells",
  sound: "sounds",
  feel: "feels",
  taste: "tastes",
};

/** A checkpoint that is already a sentence ("the raw smell goes", "it sizzles") takes no "it looks". */
const SENTENCE_START = /^(the|a|an|it|it's|its|they|their|there|this|that|these|those|no|all|each|every|some|you|your)\b/i;

/**
 * What the cook watches for (design §1): "Until it looks golden brown" with
 * its sense, "Until golden brown" without one, and "Until the raw smell
 * goes" when the words are a sentence of their own. A leading "until" the
 * author typed is not said twice. Null when there is no checkpoint.
 */
export function checkpointText(sense: StepSense | null | undefined, checkpoint: string | null | undefined): string | null {
  const words = (checkpoint ?? "").trim().replace(/^until\s+/i, "").trim();
  if (!words) return null;
  if (!sense || SENTENCE_START.test(words)) return `Until ${words}`;
  return `Until it ${SENSE_VERBS[sense]} ${words}`;
}

/**
 * A line as a step's chip, at a size (design §1, item 8): "1½ onions" for a
 * count word, "1 tbsp ginger-garlic paste" for a unit, and the name alone
 * for a line to taste ("Salt").
 */
export function lineChipText(line: Pick<KitchenRecipeLine, "name" | "qtyMilli" | "unit" | "toTaste">, factorMilli: number): string {
  if (line.toTaste || line.qtyMilli === null || line.unit === null) return line.name;
  const amount = lineAmountText(line, factorMilli);
  return isRecipeUnit(line.unit) ? `${amount} ${lowerFirst(line.name)}` : amount;
}

/** A step's chips at a size: the lines it names that the recipe has, in the recipe's order. */
export function stepChips(step: Pick<KitchenRecipeStep, "lines">, lines: readonly KitchenRecipeLine[], factorMilli: number): string[] {
  const wanted = new Set(step.lines);
  return lines.filter((l) => wanted.has(l.position)).map((l) => lineChipText(l, factorMilli));
}

// ── The recipe page's Steps list ──────────────────────────────────

/** One step in the recipe page's Steps list, at the page's size. */
export interface StepRow {
  position: number;
  /** 1-based. */
  number: number;
  text: string;
  phase: StepPhase;
  heat: StepHeat | null;
  /** "Medium flame"; null for none. */
  flame: string | null;
  /** "8–10 min", "3 whistles" at the page's size (`stepTimeAt`); null when untimed. */
  time: string | null;
  sense: StepSense | null;
  /** "Until it looks golden brown"; null for none. */
  checkpoint: string | null;
  handsOff: boolean;
  /** "Usually 7–9 min · 23 cooks" at the page's size; null until enough cooks (GC-7). */
  learned: string | null;
  tip: string | null;
  /** Long prep (design §1): it also shows first, in its own card. */
  longPrep: boolean;
}

/** Every step at `factorMilli`, as the recipe page lists them. */
export function stepRows(recipe: Pick<KitchenRecipe, "steps" | "guidedSteps">, factorMilli: number): StepRow[] {
  return guidedStepsOf(recipe).map((s, i) => ({
    position: s.position,
    number: i + 1,
    text: s.text,
    phase: s.phase,
    heat: s.heat,
    flame: flameText(s.heat),
    time: stepTimeText(s, factorMilli),
    sense: s.sense,
    checkpoint: checkpointText(s.sense, s.checkpoint),
    handsOff: s.handsOff,
    learned: learnedBadge(s, factorMilli),
    tip: s.tip,
    longPrep: isLongPrep(s),
  }));
}

// ── The plan (design §3.5, the canvas's `GuideTimeline`) ──────────

/** The plan's page: `/recipes/<id>/plan`, `?f=` when it is not the recipe's own size (and `?code=` for a link holder). */
export function recipePlanHref(recipeId: string, factorMilli: number = WRITTEN_FACTOR, code?: string | null): string {
  const f = clampFactor(factorMilli);
  const query = [f !== WRITTEN_FACTOR ? `f=${f}` : null, code ? `code=${encodeURIComponent(code)}` : null].filter(Boolean);
  return `${recipeHref(recipeId)}/plan${query.length > 0 ? `?${query.join("&")}` : ""}`;
}

/** A size the plan can be read at: the factor and its label ("450 g · about 2", "1 kg · 4"). */
export interface PlanSize {
  factorMilli: number;
  label: string;
}

/** A size's label: the main item's amount and the portions ("450 g · about 2"), or the portions alone ("For 4"). */
export function planSizeLabel(recipe: Pick<KitchenRecipe, "lines" | "servesHalf">, factorMilli: number): string {
  const portions = scalePortions(recipe.servesHalf, factorMilli).label;
  const main = mainLineOf(recipe);
  if (!main) return `For ${portions}`;
  return `${amountText(mainAmountMilli(main, factorMilli), main.unit)} · ${portions}`;
}

/**
 * The size switch (design §3.5): the size the plan was opened at (`?f=`, the
 * recipe page's or the session's) and the recipe's own. One size when they
 * are the same.
 */
export function planSizes(recipe: Pick<KitchenRecipe, "lines" | "servesHalf">, givenFactorMilli: number | null): PlanSize[] {
  const own: PlanSize = { factorMilli: WRITTEN_FACTOR, label: planSizeLabel(recipe, WRITTEN_FACTOR) };
  if (givenFactorMilli === null) return [own];
  const f = clampFactor(givenFactorMilli);
  if (f === WRITTEN_FACTOR) return [own];
  return [{ factorMilli: f, label: planSizeLabel(recipe, f) }, own];
}

/** The size `?f=` asks for, as the recipe page reads it; null when it names none. */
export function factorFromQuery(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const f = Number(raw);
  return Number.isFinite(f) && f > 0 ? clampFactor(f) : null;
}

/** One row of the plan. */
export interface PlanRow {
  position: number;
  /** 1-based. */
  number: number;
  text: string;
  phase: StepPhase;
  handsOff: boolean;
  longPrep: boolean;
  /** "8–10 min", "3 whistles"; null when untimed. */
  time: string | null;
  /** The middle of its range at this size, in seconds; 0 for untimed and whistle steps. */
  seconds: number;
  /** "Usually 7–9 min · 23 cooks"; null when nothing was learned. */
  learned: string | null;
  /** "Same at any size", "Partly follows the amount", "Follows the amount"; null when untimed. */
  rule: string | null;
  /** The bar's length against the longest step, 4–100; 0 when it has no time in minutes. */
  bar: number;
  /** "Meanwhile: Chop the coriander · Check the thickest piece" under a hands-off step; null otherwise. */
  meanwhile: string | null;
}

/** The three totals, in seconds: in all, hands on, waiting (hands off). Long prep is not in them (`Plan.longPrep`). */
export interface PlanTotals {
  allSeconds: number;
  handsOnSeconds: number;
  waitingSeconds: number;
}

export interface Plan {
  factorMilli: number;
  rows: PlanRow[];
  totals: PlanTotals;
  /** Long prep steps: planned up front, so outside the totals. */
  longPrep: { text: string; seconds: number }[];
  /** Steps that count whistles: their time depends on the cooker, so it is not in the totals. */
  whistleSteps: number;
}

/** At most this many steps are named on a Meanwhile line. */
export const MEANWHILE_NAMES = 3;

/** A step's words without the full stop that ends them. */
function shortText(text: string): string {
  return text.trim().replace(/[.。]+$/, "");
}

/**
 * What the cook can do while a hands-off step runs (design §3.4, §3.5): the
 * steps after it, up to the next hands-off one — "Meanwhile: Chop the
 * coriander · Check the thickest piece", "· +2 more" past three. Null for a
 * step that is not hands off, for long prep (planned before anything else)
 * and when nothing follows it before the next wait.
 */
export function meanwhileOf(steps: readonly Pick<KitchenRecipeStep, "text" | "handsOff" | "phase" | "minSeconds">[], index: number): string | null {
  const step = steps[index];
  if (!step || !step.handsOff || isLongPrep(step)) return null;
  const next: string[] = [];
  for (let j = index + 1; j < steps.length && !steps[j]!.handsOff; j++) next.push(shortText(steps[j]!.text));
  if (next.length === 0) return null;
  const named = next.slice(0, MEANWHILE_NAMES);
  const more = next.length - named.length;
  return `Meanwhile: ${named.join(" · ")}${more > 0 ? ` · +${more} more` : ""}`;
}

/**
 * The plan at `factorMilli` (design §3.5): every step's range at this size
 * (`stepTimeAt`), its learned badge, its rule in words and a bar; the totals
 * — every timed step's middle, then the hands-on part and the waiting
 * (hands-off) part — with long prep and whistle steps outside them.
 */
export function planOf(recipe: Pick<KitchenRecipe, "steps" | "guidedSteps">, factorMilli: number): Plan {
  const f = clampFactor(factorMilli);
  const steps = guidedStepsOf(recipe);
  const timed = steps.map((s) => {
    const at = stepTimeAt(s, f);
    return at && !("whistles" in at) ? (at.minSeconds + at.maxSeconds) / 2 : 0;
  });
  const longest = Math.max(0, ...timed);
  let all = 0;
  let handsOn = 0;
  const longPrep: Plan["longPrep"] = [];
  const rows = steps.map((s, i): PlanRow => {
    const at = stepTimeAt(s, f);
    const long = isLongPrep(s);
    const seconds = timed[i]!;
    if (long) longPrep.push({ text: s.text, seconds: s.minSeconds ?? 0 });
    else {
      all += seconds;
      if (!s.handsOff) handsOn += seconds;
    }
    return {
      position: s.position,
      number: i + 1,
      text: s.text,
      phase: s.phase,
      handsOff: s.handsOff,
      longPrep: long,
      time: timeAtText(at),
      seconds,
      learned: learnedBadge(s, f),
      rule: at ? RULE_WORDS["whistles" in at ? "fixed" : s.timeRule] : null,
      bar: seconds > 0 && longest > 0 ? Math.max(4, Math.round((seconds / longest) * 100)) : 0,
      meanwhile: meanwhileOf(steps, i),
    };
  });
  const allMinutes = Math.round(all / 60);
  const handsOnMinutes = Math.min(allMinutes, Math.round(handsOn / 60));
  return {
    factorMilli: f,
    rows,
    totals: { allSeconds: allMinutes * 60, handsOnSeconds: handsOnMinutes * 60, waitingSeconds: (allMinutes - handsOnMinutes) * 60 },
    longPrep,
    whistleSteps: steps.filter((s) => s.whistles !== null).length,
  };
}

/** A total in words: "45 min", "1 h 5 min", "0 min". */
export function totalText(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return minutes === 0 ? "0 min" : minutesText(minutes);
}

/** The plan's three tiles, in order: In all · Hands on · Waiting. */
export function planTotals(totals: PlanTotals): { label: string; value: string }[] {
  return [
    { label: "In all", value: totalText(totals.allSeconds) },
    { label: "Hands on", value: totalText(totals.handsOnSeconds) },
    { label: "Waiting", value: totalText(totals.waitingSeconds) },
  ];
}

/**
 * Under the totals, what they leave out: "Long prep (8 h) comes first and
 * isn't counted." and "Whistle steps aren't counted: their time is the
 * cooker's."; null when they leave nothing out.
 */
export function planNote(plan: Pick<Plan, "longPrep" | "whistleSteps">): string | null {
  const parts: string[] = [];
  if (plan.longPrep.length > 0) {
    const times = plan.longPrep.map((l) => minutesText(wholeMinutes(l.seconds))).join(" and ");
    parts.push(`Long prep (${times}) comes first and isn't counted.`);
  }
  if (plan.whistleSteps > 0) parts.push("Whistle steps aren't counted: their time is the cooker's.");
  return parts.length > 0 ? parts.join(" ") : null;
}
