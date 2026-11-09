import {
  RECIPE_LINK_CODE_RE,
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_MIN_FACTOR_MILLI,
  STEP_KEY_RE,
  lineQuantity,
  scaleLine,
  scalePortions,
  stepTimeAt,
} from "@saas/contracts/kitchen";
import type { KitchenRecipeLineRecord, KitchenRecipeStepRecord, KitchenRecipeTemplateRecord } from "@saas/db/kitchen";
import type { Fields } from "../validate.js";

// The recipe as the stove's AI sees it (Cookpool AI, AI-5, design §5, §5a):
// one text block per recipe and size — its name, its lines scaled to the
// factor (the recipe screens' own `scaleLine`), its tools and every step with
// its flame, its time at that size (`stepTimeAt`), whistles, hands off, what
// to check for and the tip — and, apart from it, where the cook is: the step,
// the next one, and the lines used so far.
//
// The block is the same bytes for every call on the recipe at that size, on
// every step and for all three tasks (ask-step, check-step, rescue), so it
// sits behind the shared system prompt as the cached part of the prompt; only
// the "now" part and the person's question, photo or problem change.
//
// Nothing about people is in it: not the owner, not who cooks, no money.

/** Which recipe, size and step a stove request is about. */
export interface StoveRef {
  recipeId: string;
  factorMilli: number;
  stepKey: string;
  code: string | null;
}

/** Read `recipeId`, `factor`, `stepKey` and `code` from a body, into `fields` on error. */
export function readStoveRef(fields: Fields, body: Record<string, unknown>): StoveRef {
  const recipeId = typeof body.recipeId === "string" && /^rcp_[0-9A-Za-z]{1,64}$/.test(body.recipeId) ? body.recipeId : "";
  if (recipeId === "") fields.add("recipeId", "Must be a recipe id (rcp_…)");
  let factorMilli = 1000;
  if (body.factor !== undefined && body.factor !== null) {
    const f = body.factor;
    if (typeof f === "number" && Number.isSafeInteger(f) && f >= RECIPE_MIN_FACTOR_MILLI && f <= RECIPE_MAX_FACTOR_MILLI) factorMilli = f;
    else {
      fields.add(
        "factor",
        `Must be the size in thousandths, a whole number from ${RECIPE_MIN_FACTOR_MILLI} to ${RECIPE_MAX_FACTOR_MILLI} (1500 is × 1.5)`,
      );
    }
  }
  const stepKey = typeof body.stepKey === "string" && STEP_KEY_RE.test(body.stepKey) ? body.stepKey : "";
  if (stepKey === "") fields.add("stepKey", "Must be a step's key");
  let code: string | null = null;
  if (body.code !== undefined && body.code !== null) {
    if (typeof body.code === "string" && RECIPE_LINK_CODE_RE.test(body.code)) code = body.code;
    else fields.add("code", "Must be a recipe link code");
  }
  return { recipeId, factorMilli, stepKey, code };
}

/** What a stove task gets about the recipe and the step. */
export interface StoveContext {
  /** The recipe block: the same for every step at this size. */
  block: string;
  /** Where the cook is, as words for the model. */
  now: string;
  step: KitchenRecipeStepRecord;
  /** Its number, from 1. */
  number: number;
  next: KitchenRecipeStepRecord | null;
  /** The step's own text, checkpoint and tip and the names of the lines used so far: what the safety check reads. */
  scope: string;
}

const HEAT = ["off", "low", "medium", "high"] as const;

/** 480 → "8 min", 5400 → "1 h 30 min". */
function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function amount(line: KitchenRecipeLineRecord, factorMilli: number): string {
  if (line.toTaste || line.qtyMilli === null || line.unit === null) return "to taste";
  const scaled = scaleLine(line.qtyMilli, line.unit, factorMilli);
  return scaled === null ? "to taste" : `${lineQuantity(scaled, line.unit)} ${line.unit}`;
}

const lineRef = (position: number) => `L${position + 1}`;
const stepRef = (index: number) => `S${index + 1}`;

function stepLine(step: KitchenRecipeStepRecord, index: number, factorMilli: number): string {
  const parts = [`${stepRef(index)}${step.phase === "prep" ? " (prep)" : ""} ${step.text}`];
  if (step.lineRefs.length > 0) parts.push(`uses ${step.lineRefs.map(lineRef).join(", ")}`);
  if (step.heat !== null) parts.push(`flame ${HEAT[step.heat] ?? "medium"}`);
  const time = stepTimeAt(step, factorMilli);
  if (time && "whistles" in time) parts.push(`${time.whistles} whistle${time.whistles === 1 ? "" : "s"}`);
  else if (time) {
    parts.push(time.minSeconds === time.maxSeconds ? duration(time.minSeconds) : `${duration(time.minSeconds)} to ${duration(time.maxSeconds)}`);
  }
  if (step.handsOff) parts.push("hands off");
  if (step.checkpoint) parts.push(`check${step.sense ? ` by ${step.sense}` : ""}: ${step.checkpoint}`);
  if (step.tip) parts.push(`tip: ${step.tip}`);
  return parts.join(" | ");
}

/** The recipe block for `recipe` at `factorMilli`: deterministic, so the prompt cache can reuse it. */
export function recipeBlock(recipe: KitchenRecipeTemplateRecord, factorMilli: number): string {
  const serves = scalePortions(recipe.servesHalf, factorMilli).label;
  const rows = [
    `Recipe: ${recipe.name}`,
    `Size: × ${factorMilli / 1000} of the recipe as written, serves ${serves}`,
    ...(recipe.tools.length > 0 ? [`Tools: ${recipe.tools.join(", ")}`] : []),
    "Lines (amounts already at this size):",
    ...recipe.lines.map((l) => `${lineRef(l.position)} ${l.name}: ${amount(l, factorMilli)}`),
    "Steps:",
    ...recipe.guidedSteps.map((s, i) => stepLine(s, i, factorMilli)),
  ];
  return `<recipe>\n${rows.join("\n")}\n</recipe>`;
}

/** The context for the step with `stepKey`; null when the recipe has no such step. */
export function stoveContext(recipe: KitchenRecipeTemplateRecord, factorMilli: number, stepKey: string): StoveContext | null {
  const index = recipe.guidedSteps.findIndex((s) => s.key === stepKey);
  if (index < 0) return null;
  const step = recipe.guidedSteps[index]!;
  const next = recipe.guidedSteps[index + 1] ?? null;
  // The lines used so far: those the steps up to this one attach; every line when no step attaches any.
  const attached = recipe.guidedSteps.some((s) => s.lineRefs.length > 0);
  const soFar = attached
    ? [...new Set(recipe.guidedSteps.slice(0, index + 1).flatMap((s) => s.lineRefs))].sort((a, b) => a - b)
    : recipe.lines.map((l) => l.position);
  const byPosition = new Map(recipe.lines.map((l) => [l.position, l]));
  const usedNames = soFar.flatMap((p) => (byPosition.has(p) ? [byPosition.get(p)!.name] : []));
  const now = [
    `The cook is on ${stepRef(index)} of ${recipe.guidedSteps.length}: ${step.text}`,
    next ? `Next: ${stepRef(index + 1)} ${next.text}` : `${stepRef(index)} is the last step.`,
    `Lines used so far: ${soFar.length > 0 ? soFar.map(lineRef).join(", ") : "none"}`,
  ].join("\n");
  return {
    block: recipeBlock(recipe, factorMilli),
    now: `<now>\n${now}\n</now>`,
    step,
    number: index + 1,
    next,
    scope: [step.text, step.checkpoint ?? "", step.tip ?? "", ...usedNames].join("\n"),
  };
}
