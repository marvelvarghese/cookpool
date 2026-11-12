/**
 * Recipe from a photo (cookpool-ai AI-9, design §4, the canvas's AiImport):
 * where it shows, the refusals, and the AI-4 draft turned into what the
 * screens show — the result's card and its Steps · Ingredients tabs, the
 * recipe form prefilled (RC-5/GC-6's `RecipeForm`) with each check marked on
 * the field it names, and what Save recipe sends (the draft itself, to the
 * create route as today).
 *
 * The draft is the create route's body without `visibility`, so nothing is
 * mapped on the way back: Save posts it as it is; Open in editor fills the
 * form, whose Save is RC-5's.
 *
 * Dependency-free (contract types, the form's pure modules), so unit-testable.
 */

import {
  isRecipeUnit,
  type AiRecipeCheck,
  type AiRecipeDraft,
  type AiRecipeDraftStep,
  type AiStatus,
  type CreateRecipeRequest,
  type KitchenRecipeStep,
} from "@saas/contracts/kitchen";
import { emptyLine, recipeRequest, DEFAULT_SERVES_HALF, type LineDraft, type RecipeForm, type RecipeFormErrors } from "./recipe-form";
import { halvesText } from "./recipes";
import { stepFromRecipe, stepSummary, type StepDraft } from "./step-editor";

/** The long side a recipe photo is sent at (design §4): a page of small print needs more than a receipt's 1200. */
export const RECIPE_PHOTO_LONG_SIDE = 1600;

/** My recipes' "From a photo": New recipe, opening the photo step at once. */
export const RECIPE_PHOTO_HREF = "/recipes/new?photo=1";

/** Whether New recipe was opened to start from a photo (`?photo=1`). */
export function photoRequested(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("photo") === "1";
}

/**
 * Whether Recipe from a photo shows: the new frame, AI available with the
 * server reading recipe photos (`features.import`), and this device's
 * "Recipe from a photo" switch on. Hidden while the status loads or fails.
 */
export function recipePhotoShows(o: { isNewFrame: boolean; status: AiStatus | null | undefined; switchOn: boolean }): boolean {
  return o.isNewFrame && o.switchOn && o.status?.available === true && o.status.features?.import === true;
}

// ── Refusals ──────────────────────────────────────────────────────

export type RecipePhotoErrorKind = "unavailable" | "budget" | "limit" | "failed";

export interface RecipePhotoError {
  kind: RecipePhotoErrorKind;
  /** One line: what happened · what to do. */
  title: string;
}

/**
 * A refusal of the read, by its `details.reason` (design §1, AI-13): no key
 * hides From a photo, and so does the month's budget ("resting until the
 * 1st"); today's limit says tomorrow; anything else — the model, the
 * network, a page with nothing on it — asks for a clearer photo.
 */
export function recipePhotoError(error: { code?: string; reason?: string | undefined; details?: Record<string, unknown> | undefined } | null, status = 0): RecipePhotoError {
  const reason = error?.reason ?? (typeof error?.details?.["reason"] === "string" ? (error.details["reason"] as string) : undefined);
  if (reason === "budget") return { kind: "budget", title: "Cookpool AI is resting until the 1st · type it in" };
  if (reason === "ai_unavailable" || (status === 503 && reason === undefined)) return { kind: "unavailable", title: "AI isn't set up yet · type it in" };
  if (reason === "ai_daily_limit" || error?.code === "rate_limited") return { kind: "limit", title: "You've used today's AI · try tomorrow" };
  return { kind: "failed", title: "Couldn't read this page · try a clearer photo or type it in" };
}

/** A photo that couldn't be decoded or made small enough: back to the pick step with this. */
export const PHOTO_UNUSABLE = "Couldn't use this photo · try another";

/** What Reading says while the page is read, by how long it has been (the server says nothing until it is done). */
export function readingText(elapsedMs: number): string {
  if (elapsedMs < 2500) return "Finding the ingredients…";
  if (elapsedMs < 5000) return "✓ Ingredients · reading the steps…";
  return "✓ Ingredients · ✓ Steps · flames and timings…";
}

// ── The checks, on the form ───────────────────────────────────────

/**
 * The checks as the form marks them: by field, a line by its form key and a
 * step by its form id (so a mark follows its line or step as they move), and
 * the rest (a path that names nothing the form shows) as `other`.
 */
export interface DraftMarks {
  name?: string;
  servesHalf?: string;
  minutes?: string;
  lines?: string;
  steps?: string;
  tools?: string;
  line: Record<string, string>;
  step: Record<string, string>;
  other: string[];
}

export function noMarks(): DraftMarks {
  return { line: {}, step: {}, other: [] };
}

const LINE_PATH = /^lines\[(\d+)\]/;
const STEP_PATH = /^steps\[(\d+)\]/;
const FIELD_PATHS = ["name", "servesHalf", "minutes", "lines", "steps", "tools"] as const;

function join(cur: string | undefined, message: string): string {
  return cur ? `${cur} · ${message}` : message;
}

/**
 * Each check on the field its `path` names (`lines[2].quantity` on the
 * draft's third line, `steps[3].heat` on its fourth step), two on one place
 * joined with " · ". `lineKeys` and `stepIds` are the form's, in the draft's order.
 */
export function marksFromChecks(checks: readonly AiRecipeCheck[], lineKeys: readonly string[], stepIds: readonly string[]): DraftMarks {
  const marks = noMarks();
  for (const c of checks) {
    const line = LINE_PATH.exec(c.path);
    const step = STEP_PATH.exec(c.path);
    const lineKey = line ? lineKeys[Number(line[1])] : undefined;
    const stepId = step ? stepIds[Number(step[1])] : undefined;
    const field = FIELD_PATHS.find((f) => f === c.path);
    if (lineKey) marks.line[lineKey] = join(marks.line[lineKey], c.message);
    else if (stepId) marks.step[stepId] = join(marks.step[stepId], c.message);
    else if (field) marks[field] = join(marks[field], c.message);
    else if (line) marks.lines = join(marks.lines, c.message);
    else if (step) marks.steps = join(marks.steps, c.message);
    else marks.other.push(c.message);
  }
  return marks;
}

/** How many places are marked. */
export function markCount(m: DraftMarks): number {
  return FIELD_PATHS.filter((f) => !!m[f]).length + Object.keys(m.line).length + Object.keys(m.step).length + m.other.length;
}

/**
 * The marks once the form has changed: a mark goes when its field, line or
 * step is edited (or taken out); the others stay until Save.
 */
export function settleMarks(m: DraftMarks, prev: RecipeForm, next: RecipeForm): DraftMarks {
  if (prev === next) return m;
  const out: DraftMarks = { line: {}, step: {}, other: m.other };
  if (m.name && prev.name === next.name) out.name = m.name;
  if (m.servesHalf && prev.servesHalf === next.servesHalf) out.servesHalf = m.servesHalf;
  if (m.minutes && prev.minutes === next.minutes) out.minutes = m.minutes;
  if (m.lines && prev.lines.length === next.lines.length) out.lines = m.lines;
  if (m.steps && prev.steps.length === next.steps.length) out.steps = m.steps;
  if (m.tools && prev.tools === next.tools) out.tools = m.tools;
  const prevLine = new Map(prev.lines.map((l) => [l.key, l] as const));
  for (const l of next.lines) if (m.line[l.key] && prevLine.get(l.key) === l) out.line[l.key] = m.line[l.key]!;
  const prevStep = new Map(prev.steps.map((s) => [s.id, s] as const));
  for (const s of next.steps) if (m.step[s.id] && prevStep.get(s.id) === s) out.step[s.id] = m.step[s.id]!;
  return out;
}

/** The step marks by the form's step index, as the steps editor draws them. */
export function stepMarksByIndex(m: DraftMarks, steps: readonly Pick<StepDraft, "id">[]): Record<number, string> {
  const out: Record<number, string> = {};
  steps.forEach((s, i) => {
    const mark = m.step[s.id];
    if (mark) out[i] = mark;
  });
  return out;
}

// ── The draft, as the form starts ─────────────────────────────────

function quantityText(q: number | null): string {
  return q === null ? "" : String(Number(q.toFixed(3)));
}

/** A draft step as the recipe read gives one (no key yet: the create route mints it). */
export function draftStepAsRead(step: AiRecipeDraftStep, position: number): KitchenRecipeStep {
  return { position, key: "", ...step };
}

export interface DraftForm {
  form: RecipeForm;
  marks: DraftMarks;
  /** The form's line key for each draft line, in order. */
  lineKeys: string[];
  /** The form's step id for each draft step, in order. */
  stepIds: string[];
}

/**
 * The recipe form prefilled from the draft: every line (its food link, amount
 * and unit — a count word kept as its unit — or To taste, the main marked),
 * every guided step (its lines as the form's keys), the tools, and each
 * check marked where it applies.
 */
export function formFromDraft(draft: AiRecipeDraft, checks: readonly AiRecipeCheck[], newKey: () => string): DraftForm {
  let mainKey: string | null = null;
  const lines: LineDraft[] = draft.lines.map((l) => {
    const key = newKey();
    if (l.isMain) mainKey = key;
    return {
      key,
      foodKey: l.foodKey,
      foodName: l.foodKey ? l.name : null,
      countWord: l.unit && !isRecipeUnit(l.unit) ? l.unit : null,
      name: l.name,
      quantity: quantityText(l.quantity),
      unit: l.unit ?? "g",
      toTaste: l.toTaste,
    };
  });
  const lineKeys = lines.map((l) => l.key);
  const steps = draft.steps.map((s, i) => stepFromRecipe(draftStepAsRead(s, i), newKey(), (p) => lineKeys[p]));
  const stepIds = steps.map((s) => s.id);
  const form: RecipeForm = {
    name: draft.name,
    servesHalf: draft.servesHalf >= 1 ? draft.servesHalf : DEFAULT_SERVES_HALF,
    minutes: draft.minutes === null ? "" : String(draft.minutes),
    lines: lines.length > 0 ? lines : [emptyLine(newKey())],
    mainKey,
    steps,
    tools: [...draft.tools],
  };
  return { form, marks: marksFromChecks(checks, lineKeys, stepIds), lineKeys, stepIds };
}

// ── Save recipe ───────────────────────────────────────────────────

/** The create route's body for Save recipe: the draft, exactly. */
export function photoSaveBody(draft: AiRecipeDraft): CreateRecipeRequest {
  return draft;
}

/**
 * What Save recipe does: post the draft when the form would send it, else
 * open the editor with what the form says is missing (a line with no amount,
 * no name) — the server would refuse it the same way.
 */
export function photoSavePlan(draft: AiRecipeDraft, form: RecipeForm): { kind: "post"; body: CreateRecipeRequest } | { kind: "editor"; errors: RecipeFormErrors } {
  const r = recipeRequest(form);
  return r.body ? { kind: "post", body: photoSaveBody(draft) } : { kind: "editor", errors: r.errors };
}

// ── The result's card and tabs ────────────────────────────────────

export interface PhotoStepRow {
  n: number;
  text: string;
  /** "Prep · Medium flame · 8–10 min · Until golden"; null for a step of words alone. */
  meta: string | null;
  /** The check on this step, when one applies (the amber outline). */
  check: string | null;
}

export interface PhotoLineRow {
  key: string;
  name: string;
  /** "450 g", "3 onions", "To taste", "—" when the amount couldn't be read. */
  amount: string;
  /** The check on this line, when one applies (the amber dot). */
  check: string | null;
}

export interface PhotoCard {
  title: string;
  meta: string;
  stepsTab: string;
  linesTab: string;
  steps: PhotoStepRow[];
  lines: PhotoLineRow[];
  /** "2 things to check · the photo is already deleted". */
  footer: string;
  /** Checks that name the recipe as a whole (its name, serves, the lists), for the card. */
  general: string[];
}

function amountText(l: LineDraft): string {
  if (l.toTaste) return "To taste";
  if (!l.quantity) return "—";
  return `${l.quantity} ${l.unit}`;
}

/** "Nothing to check", "1 thing to check", "2 things to check" · the photo is already deleted. */
export function checksFooter(count: number): string {
  const head = count === 0 ? "Nothing to check" : `${count} ${count === 1 ? "thing" : "things"} to check`;
  return `${head} · the photo is already deleted`;
}

/** The result as the canvas draws it, from the prefilled form (so the card and the editor say the same). */
export function photoCard(draft: AiRecipeDraft, checks: readonly AiRecipeCheck[], start: DraftForm): PhotoCard {
  const { form, marks } = start;
  const sentLines = draft.lines.length;
  const parts = [`Serves ${halvesText(form.servesHalf)}`];
  if (draft.minutes !== null) parts.push(`${draft.minutes} min`);
  parts.push(`${sentLines} ${sentLines === 1 ? "ingredient" : "ingredients"}`, `${draft.steps.length} ${draft.steps.length === 1 ? "step" : "steps"}`);
  const general = [marks.name, marks.servesHalf, marks.minutes, marks.lines, marks.steps, marks.tools, ...marks.other].filter((m): m is string => !!m);
  return {
    title: draft.name.trim() || "A recipe with no name",
    meta: parts.join(" · "),
    stepsTab: `Steps · ${draft.steps.length}`,
    linesTab: `Ingredients · ${sentLines}`,
    steps: form.steps.map((s, i) => ({ n: i + 1, text: s.text.trim(), meta: stepSummary(s), check: marks.step[s.id] ?? null })),
    lines: start.lineKeys.map((key) => {
      const l = form.lines.find((x) => x.key === key)!;
      return { key, name: l.name, amount: amountText(l), check: marks.line[key] ?? null };
    }),
    footer: checksFooter(checks.length),
    general,
  };
}
