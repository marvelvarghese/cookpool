/**
 * Writing and editing a recipe (cookpool-recipes RC-5, design §3.1, §3.5):
 * name, serves (in halves), minutes (optional); lines — a food from the list
 * or free words, an amount and a unit or "To taste", and exactly one main
 * line, chosen with a radio (by default the first line with a weight, never a
 * to-taste one); lines move up and down and come out; steps, up to 20.
 *
 * cookpool-guided GC-6: the recipe's tools (up to 10 short names), and each
 * step a guided one (`StepDraft`, step-editor.ts) — its phase, lines,
 * flame, minutes or whistles, hands off, rule, checkpoint and tip — sent
 * with the key it was read with, so keys survive edits. A step of text
 * only is still sent as its words.
 *
 * The form is data, and every edit is a pure function of it, so what the
 * form sends — and which line is main — is unit-tested. The server checks it
 * all again: its 422 field errors (`lines[2].quantity`, `steps[1].minSeconds`,
 * `tools[0]`) land on the line, step or tool they name (`errorsFromDetails`).
 *
 * Dependency-free (contract types and constants), so unit-testable.
 */

import {
  MAX_RECIPE_LINES,
  MAX_RECIPE_LINE_NAME,
  MAX_RECIPE_MINUTES,
  MAX_RECIPE_NAME,
  MAX_RECIPE_SERVES_HALF,
  MAX_RECIPE_STEP,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_TOOL,
  MAX_RECIPE_TOOLS,
  MAX_RECIPE_UNIT_WORD,
  RECIPE_UNIT_KEYS,
  foodNameKey,
  isRecipeUnit,
  recipeUnitOf,
  type CreateRecipeRequest,
  type FoodDimension,
  type FoodMatch,
  type KitchenRecipe,
  type RecipeLineInput,
  type RecipeStepWrite,
} from "@saas/contracts/kitchen";
import { lineChipText } from "./guided-steps";
import { blankStep, isPlainDraft, stepFromRecipe, stepProblems, stepWrite, type StepDraft, type StepFieldErrors } from "./step-editor";

/** A new recipe serves 4, as a new dish does. */
export const DEFAULT_SERVES_HALF = 8;

/** One line as the form holds it. */
export interface LineDraft {
  /** The form's own id for it (React's key, the main radio's value). */
  key: string;
  /** The food on the list it is linked to, or null for free words. */
  foodKey: string | null;
  /** That food's name, as picked: typing other words unlinks it. */
  foodName: string | null;
  /** A word for one piece of that food ("onion"), offered as a unit; null when it is not counted. */
  countWord: string | null;
  name: string;
  /** As typed: "450", "1.5". */
  quantity: string;
  unit: string;
  toTaste: boolean;
}

export interface RecipeForm {
  name: string;
  servesHalf: number;
  /** As typed; empty for none. */
  minutes: string;
  lines: LineDraft[];
  /** The line marked main; null for the default (the first line with a weight, else the first with an amount). */
  mainKey: string | null;
  /** In order; each a guided step (GC-6), text only by default. */
  steps: StepDraft[];
  /** The tools, in order (GC-6): short names, each once. */
  tools: string[];
}

/** A blank line. */
export function emptyLine(key: string): LineDraft {
  return { key, foodKey: null, foodName: null, countWord: null, name: "", quantity: "", unit: "g", toTaste: false };
}

/** A new recipe: serves 4, one blank line, no steps, no tools. */
export function initialRecipeForm(newKey: () => string): RecipeForm {
  return { name: "", servesHalf: DEFAULT_SERVES_HALF, minutes: "", lines: [emptyLine(newKey())], mainKey: null, steps: [], tools: [] };
}

/** A decimal as the form shows it ("1.5", "450"). */
function quantityText(q: number | null): string {
  return q === null ? "" : String(Number(q.toFixed(3)));
}

/**
 * A recipe as its edit form starts: every line, its main marked, its steps
 * (in full from `guidedSteps`, with their keys and their lines as the form's
 * line keys; as texts when the read has none) and its tools.
 */
export function formFromRecipe(
  recipe: Pick<KitchenRecipe, "name" | "servesHalf" | "minutes" | "lines" | "steps" | "guidedSteps" | "tools">,
  newKey: () => string,
): RecipeForm {
  let mainKey: string | null = null;
  const keyAt = new Map<number, string>();
  const lines = recipe.lines.map((l) => {
    const key = newKey();
    keyAt.set(l.position, key);
    if (l.isMain) mainKey = key;
    const unit = l.unit ?? "g";
    return {
      key,
      foodKey: l.foodKey,
      foodName: l.foodKey ? l.name : null,
      countWord: l.unit && !isRecipeUnit(l.unit) ? l.unit : null,
      name: l.name,
      quantity: quantityText(l.quantity),
      unit,
      toTaste: l.toTaste,
    };
  });
  return {
    name: recipe.name,
    servesHalf: recipe.servesHalf,
    minutes: recipe.minutes === null ? "" : String(recipe.minutes),
    lines: lines.length > 0 ? lines : [emptyLine(newKey())],
    mainKey,
    steps:
      recipe.guidedSteps && recipe.guidedSteps.length === recipe.steps.length
        ? recipe.guidedSteps.map((s) => stepFromRecipe(s, newKey(), (p) => keyAt.get(p)))
        : recipe.steps.map((text) => blankStep(newKey(), text)),
    tools: [...(recipe.tools ?? [])],
  };
}

// ── Amounts and the main line ─────────────────────────────────────

/** A typed amount as the API takes it ("1,5" → "1.5"), or null when it is not a decimal above zero. */
export function parseQuantity(text: string): string | null {
  const t = text.trim().replace(",", ".");
  if (!/^(\d+(\.\d{1,3})?|\.\d{1,3})$/.test(t)) return null;
  return Number(t) > 0 ? (t.startsWith(".") ? `0${t}` : t) : null;
}

/** It has an amount (not to taste, and a decimal above zero). */
export function lineHasAmount(line: Pick<LineDraft, "toTaste" | "quantity">): boolean {
  return !line.toTaste && parseQuantity(line.quantity) !== null;
}

/** It has a weight: an amount in g or kg. */
export function lineHasWeight(line: Pick<LineDraft, "toTaste" | "quantity" | "unit">): boolean {
  return lineHasAmount(line) && recipeUnitOf(line.unit).dimension === "mass";
}

/** A blank line (no words, no amount): left out of what is sent. */
export function isBlankLine(line: Pick<LineDraft, "name" | "quantity" | "toTaste">): boolean {
  return line.name.trim() === "" && line.quantity.trim() === "" && !line.toTaste;
}

/** The main line by default: the first with a weight, else the first with an amount. */
export function defaultMainKey(lines: readonly LineDraft[]): string | null {
  return lines.find(lineHasWeight)?.key ?? lines.find(lineHasAmount)?.key ?? null;
}

/** The main line: the one marked, while it can be (it is there, and not to taste); else the default. */
export function mainKeyOf(form: Pick<RecipeForm, "lines" | "mainKey">): string | null {
  const marked = form.mainKey ? form.lines.find((l) => l.key === form.mainKey) : undefined;
  if (marked && !marked.toTaste) return marked.key;
  return defaultMainKey(form.lines);
}

/** The units a line can be in: the app's own, then the food's word for one piece, then the line's own word. */
export function unitOptions(line: Pick<LineDraft, "unit" | "countWord">): string[] {
  const out: string[] = [...RECIPE_UNIT_KEYS];
  for (const word of [line.countWord, line.unit]) {
    if (word && !out.includes(word)) out.push(word);
  }
  return out;
}

/** A food's name as a word for one piece of it ("Onion" → "onion"), when it is one plain word. */
export function countWordFor(food: Pick<FoodMatch, "name" | "dimension">): string | null {
  if (food.dimension !== "count") return null;
  const word = food.name.trim().toLowerCase();
  return /^[a-z]+$/.test(word) && word.length <= MAX_RECIPE_UNIT_WORD ? word : null;
}

/** The unit a food's line starts in: g for a weight, ml for a volume, its piece word (else pcs) for a count. */
export function defaultUnitFor(dimension: FoodDimension, countWord: string | null): string {
  if (dimension === "mass") return "g";
  if (dimension === "volume") return "ml";
  return countWord ?? "pcs";
}

// ── Edits ─────────────────────────────────────────────────────────

function mapLine(form: RecipeForm, key: string, f: (l: LineDraft) => LineDraft): RecipeForm {
  return { ...form, lines: form.lines.map((l) => (l.key === key ? f(l) : l)) };
}

/** Change a line's amount, unit or To taste (a to-taste line can't stay main: the default takes over). */
export function setLine(form: RecipeForm, key: string, patch: Partial<Pick<LineDraft, "quantity" | "unit" | "toTaste">>): RecipeForm {
  const next = mapLine(form, key, (l) => ({ ...l, ...patch }));
  return patch.toTaste && form.mainKey === key ? { ...next, mainKey: null } : next;
}

/**
 * Type a line's words: they stay linked to the food while they still name it
 * ("Onions, sliced" keeps Onion; "Garlic" does not).
 */
export function typeLineName(form: RecipeForm, key: string, name: string): RecipeForm {
  return mapLine(form, key, (l) => {
    const food = l.foodName === null ? "" : foodNameKey(l.foodName);
    const linked = food !== "" && foodNameKey(name).includes(food);
    return linked ? { ...l, name } : { ...l, name, foodKey: null, foodName: null, countWord: null };
  });
}

/** Pick a food from the list for a line: its name, its key, and a unit that measures it (kept when it already does). */
export function pickFood(form: RecipeForm, key: string, food: Pick<FoodMatch, "key" | "name" | "dimension">): RecipeForm {
  return mapLine(form, key, (l) => {
    const countWord = countWordFor(food);
    const fits = recipeUnitOf(l.unit).dimension === food.dimension && (food.dimension !== "count" || l.unit === "pcs" || l.unit === countWord);
    return { ...l, name: food.name, foodKey: food.key, foodName: food.name, countWord, unit: fits && l.quantity.trim() !== "" ? l.unit : defaultUnitFor(food.dimension, countWord) };
  });
}

/** Mark a line main (not a to-taste one). */
export function chooseMain(form: RecipeForm, key: string): RecipeForm {
  const line = form.lines.find((l) => l.key === key);
  return line && !line.toTaste ? { ...form, mainKey: key } : form;
}

/** Another blank line at the end (up to MAX_RECIPE_LINES). */
export function addLine(form: RecipeForm, key: string): RecipeForm {
  if (form.lines.length >= MAX_RECIPE_LINES) return form;
  return { ...form, lines: [...form.lines, emptyLine(key)] };
}

/** Take a line out (the last one is emptied instead: a recipe has at least one). */
export function removeLine(form: RecipeForm, key: string, newKey: () => string): RecipeForm {
  const lines = form.lines.filter((l) => l.key !== key);
  return { ...form, lines: lines.length > 0 ? lines : [emptyLine(newKey())], mainKey: form.mainKey === key ? null : form.mainKey };
}

/** Move a line up (−1) or down (+1). */
export function moveLine(form: RecipeForm, key: string, direction: -1 | 1): RecipeForm {
  const i = form.lines.findIndex((l) => l.key === key);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= form.lines.length) return form;
  const lines = [...form.lines];
  [lines[i], lines[j]] = [lines[j]!, lines[i]!];
  return { ...form, lines };
}

/** Serves, by halves, from ½ to 100. */
export function stepServes(form: RecipeForm, direction: -1 | 1): RecipeForm {
  const servesHalf = Math.min(MAX_RECIPE_SERVES_HALF, Math.max(1, form.servesHalf + direction));
  return servesHalf === form.servesHalf ? form : { ...form, servesHalf };
}

/** An id for a new step that no step of the form has (`step_N`). */
export function nextStepId(form: Pick<RecipeForm, "steps">): string {
  let n = form.steps.length;
  const ids = new Set(form.steps.map((s) => s.id));
  while (ids.has(`step_${n + 1}`)) n += 1;
  return `step_${n + 1}`;
}

/** Another step, text only (up to MAX_RECIPE_STEPS); `id` is the form's own for it. */
export function addStep(form: RecipeForm, id: string = nextStepId(form)): RecipeForm {
  return form.steps.length >= MAX_RECIPE_STEPS ? form : { ...form, steps: [...form.steps, blankStep(id)] };
}

/** Type a step's words. */
export function setStep(form: RecipeForm, index: number, text: string): RecipeForm {
  return { ...form, steps: form.steps.map((s, i) => (i === index ? { ...s, text } : s)) };
}

/** Change a step (by the form's id for it) in any other way: step-editor.ts's edits. */
export function updateStep(form: RecipeForm, id: string, change: (d: StepDraft) => StepDraft): RecipeForm {
  return { ...form, steps: form.steps.map((s) => (s.id === id ? change(s) : s)) };
}

export function removeStep(form: RecipeForm, index: number): RecipeForm {
  return { ...form, steps: form.steps.filter((_, i) => i !== index) };
}

// ── Tools (GC-6) ──────────────────────────────────────────────────

/** Why a tool can't be added ("Already on the list"), or null when it can. */
export function toolProblem(tools: readonly string[], name: string): string | null {
  const t = name.trim();
  if (!t) return "Name the tool";
  if (t.length > MAX_RECIPE_TOOL) return `Keep it to ${MAX_RECIPE_TOOL} characters`;
  if (tools.some((x) => x.trim().toLowerCase() === t.toLowerCase())) return "Already on the list";
  if (tools.length >= MAX_RECIPE_TOOLS) return `At most ${MAX_RECIPE_TOOLS} tools`;
  return null;
}

/** Add a tool at the end (trimmed); the same form when it can't be (`toolProblem`). */
export function addTool(form: RecipeForm, name: string): RecipeForm {
  if (toolProblem(form.tools, name)) return form;
  return { ...form, tools: [...form.tools, name.trim()] };
}

export function removeTool(form: RecipeForm, index: number): RecipeForm {
  return { ...form, tools: form.tools.filter((_, i) => i !== index) };
}

// ── The lines a step can name ─────────────────────────────────────

/** A line as a step's chip names it, as written: "3 onions", "2 tbsp ginger-garlic paste", "Salt"; null for a blank line. */
export function lineChip(line: LineDraft): string | null {
  const name = line.name.trim();
  if (!name || isBlankLine(line)) return null;
  const quantity = line.toTaste ? null : parseQuantity(line.quantity);
  if (quantity === null) return name;
  const qtyMilli = Math.round(Number(quantity) * recipeUnitOf(line.unit).factor * 1000);
  return lineChipText({ name, qtyMilli, unit: line.unit, toTaste: false }, 1000);
}

/** The lines a step can name (every line with words), with their chips, in the form's order. */
export function stepLineChoices(form: Pick<RecipeForm, "lines">): { key: string; name: string; chip: string }[] {
  return form.lines.flatMap((l) => {
    const chip = lineChip(l);
    return chip === null ? [] : [{ key: l.key, name: l.name.trim(), chip }];
  });
}

// ── What the form sends ───────────────────────────────────────────

/** What is wrong, by field: the form's own checks, or the server's 422 (`errorsFromDetails`). */
export interface RecipeFormErrors {
  name?: string;
  servesHalf?: string;
  minutes?: string;
  /** About the lines as a whole ("Add an ingredient"). */
  lines?: string;
  steps?: string;
  /** About the tools as a whole ("At most 10 tools"). */
  tools?: string;
  /** By line key. */
  line: Record<string, { name?: string; quantity?: string; unit?: string; main?: string }>;
  /** A step's words, by step index. */
  step: Record<number, string>;
  /** A step's other fields (its flame, time, lines, checkpoint…), by step index (GC-6). */
  stepField: Record<number, Omit<StepFieldErrors, "text">>;
  /** By tool index. */
  tool: Record<number, string>;
  /** Anything the server said that names no field the form shows. */
  other?: string;
}

export function noErrors(): RecipeFormErrors {
  return { line: {}, step: {}, stepField: {}, tool: {} };
}

/** Whether there is anything to show. */
export function hasErrors(e: RecipeFormErrors): boolean {
  return !!(
    e.name || e.servesHalf || e.minutes || e.lines || e.steps || e.tools || e.other ||
    Object.keys(e.line).length > 0 || Object.keys(e.step).length > 0 || Object.keys(e.stepField).length > 0 || Object.keys(e.tool).length > 0
  );
}

/** Whether a step (by index) has anything wrong: it opens, so the error shows. */
export function stepHasErrors(e: RecipeFormErrors, index: number): boolean {
  return e.step[index] !== undefined || Object.keys(e.stepField[index] ?? {}).length > 0;
}

export interface RecipeRequest {
  /** The body for POST (and PATCH: `lines` and `steps` replace the whole list); null while something is wrong. */
  body: CreateRecipeRequest | null;
  errors: RecipeFormErrors;
  /** The form's line key for each line sent, in order (`lines[2]` is `lineKeys[2]`). */
  lineKeys: string[];
  /** The form's step index for each step sent, in order. */
  stepIndexes: number[];
  /** The form's tool index for each tool sent, in order. */
  toolIndexes: number[];
}

/**
 * The form as the API takes it, or why not. Blank lines, blank steps of
 * text only and blank tools are left out. Exactly one line says it is main
 * (`mainKeyOf`); to-taste lines send no amount. A step names its lines by
 * their positions in the lines sent; it is its words alone when it is text
 * only and new, else every field with its key (`stepWrite`).
 */
export function recipeRequest(form: RecipeForm): RecipeRequest {
  const errors = noErrors();
  const name = form.name.trim();
  if (!name) errors.name = "Name it";
  else if (name.length > MAX_RECIPE_NAME) errors.name = `Keep it to ${MAX_RECIPE_NAME} characters`;
  if (form.servesHalf < 1 || form.servesHalf > MAX_RECIPE_SERVES_HALF) errors.servesHalf = "Serves ½ to 100";

  let minutes: number | null = null;
  const m = form.minutes.trim();
  if (m) {
    if (!/^\d+$/.test(m) || Number(m) < 1 || Number(m) > MAX_RECIPE_MINUTES) errors.minutes = `Minutes, 1 to ${MAX_RECIPE_MINUTES}`;
    else minutes = Number(m);
  }

  const sent = form.lines.filter((l) => !isBlankLine(l));
  const mainKey = mainKeyOf({ lines: sent, mainKey: form.mainKey });
  const lines: RecipeLineInput[] = [];
  for (const l of sent) {
    const e: RecipeFormErrors["line"][string] = {};
    const lineName = l.name.trim();
    if (!lineName) e.name = "Name it";
    else if (lineName.length > MAX_RECIPE_LINE_NAME) e.name = `Keep it to ${MAX_RECIPE_LINE_NAME} characters`;
    const input: RecipeLineInput = { foodKey: l.foodKey, name: lineName, toTaste: l.toTaste, isMain: l.key === mainKey };
    if (!l.toTaste) {
      const quantity = parseQuantity(l.quantity);
      if (quantity === null) e.quantity = l.quantity.trim() ? "An amount above 0" : "How much? Or To taste";
      input.quantity = quantity ?? l.quantity.trim();
      input.unit = l.unit;
    }
    if (Object.keys(e).length > 0) errors.line[l.key] = e;
    lines.push(input);
  }
  if (sent.length === 0) errors.lines = "Add an ingredient";
  else if (sent.length > MAX_RECIPE_LINES) errors.lines = `At most ${MAX_RECIPE_LINES} ingredients`;
  else if (!mainKey) errors.lines = "One ingredient needs an amount: it scales the rest";

  const lineKeys = sent.map((l) => l.key);
  const positionOf = new Map(lineKeys.map((k, i) => [k, i] as const));
  const steps: RecipeStepWrite[] = [];
  const stepIndexes: number[] = [];
  form.steps.forEach((s, i) => {
    if (!s.text.trim() && isPlainDraft(s)) return;
    const { text: textError, ...fieldErrors } = stepProblems(s, MAX_RECIPE_STEP);
    if (textError) errors.step[i] = textError;
    if (Object.keys(fieldErrors).length > 0) errors.stepField[i] = fieldErrors;
    steps.push(stepWrite(s, (k) => positionOf.get(k)));
    stepIndexes.push(i);
  });
  if (steps.length > MAX_RECIPE_STEPS) errors.steps = `At most ${MAX_RECIPE_STEPS} steps`;

  const tools: string[] = [];
  const toolIndexes: number[] = [];
  form.tools.forEach((t, i) => {
    const tool = t.trim();
    if (!tool) return;
    if (tool.length > MAX_RECIPE_TOOL) errors.tool[i] = `Keep it to ${MAX_RECIPE_TOOL} characters`;
    else if (tools.some((x) => x.toLowerCase() === tool.toLowerCase())) errors.tool[i] = "Already on the list";
    tools.push(tool);
    toolIndexes.push(i);
  });
  if (tools.length > MAX_RECIPE_TOOLS) errors.tools = `At most ${MAX_RECIPE_TOOLS} tools`;

  if (hasErrors(errors)) return { body: null, errors, lineKeys, stepIndexes, toolIndexes };
  return { body: { name, servesHalf: form.servesHalf, minutes, lines, steps, tools }, errors, lineKeys, stepIndexes, toolIndexes };
}

const LINE_FIELD = /^lines\[(\d+)\]\.(\w+)$/;
const STEP_FIELD = /^steps\[(\d+)\](?:\.(\w+))?$/;
const TOOL_FIELD = /^tools\[(\d+)\]$/;

/** The part of the step editor a server field names (`steps[1].minSeconds` → time); null for the step's words. */
const STEP_PART: Readonly<Record<string, keyof Omit<StepFieldErrors, "text"> | null>> = {
  text: null,
  key: null,
  phase: "phase",
  lines: "lines",
  heat: "heat",
  minSeconds: "time",
  maxSeconds: "time",
  whistles: "time",
  handsOff: "handsOff",
  timeRule: "timeRule",
  sense: "checkpoint",
  checkpoint: "checkpoint",
  tip: "tip",
};

/**
 * The server's 422 (`details.fields`: `{ "lines[2].quantity": ["…"] }`) on
 * the form: each message on the line, step (and the step's part: its time
 * for `steps[1].minSeconds`) or tool it names, by the order the request
 * sent them in (`lineKeys`, `stepIndexes`, `toolIndexes`).
 */
export function errorsFromDetails(
  details: Record<string, unknown> | undefined,
  sent: Pick<RecipeRequest, "lineKeys" | "stepIndexes"> & Partial<Pick<RecipeRequest, "toolIndexes">>,
  fallback: string,
): RecipeFormErrors {
  const errors = noErrors();
  const fields = details?.["fields"];
  if (!fields || typeof fields !== "object") {
    errors.other = fallback;
    return errors;
  }
  for (const [field, raw] of Object.entries(fields as Record<string, unknown>)) {
    const message = Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : typeof raw === "string" ? raw : fallback;
    const line = LINE_FIELD.exec(field);
    const step = STEP_FIELD.exec(field);
    const tool = TOOL_FIELD.exec(field);
    if (line) {
      const key = sent.lineKeys[Number(line[1])];
      const part = line[2] === "quantity" || line[2] === "unit" || line[2] === "name" ? line[2] : line[2] === "isMain" ? "main" : "name";
      if (key) errors.line[key] = { ...errors.line[key], [part]: message };
      else errors.lines = message;
    } else if (step) {
      const index = sent.stepIndexes[Number(step[1])];
      const part = step[2] === undefined ? null : (STEP_PART[step[2]] ?? null);
      if (index === undefined) errors.steps = message;
      else if (part) errors.stepField[index] = { ...errors.stepField[index], [part]: message };
      else errors.step[index] = message;
    } else if (tool) {
      const index = sent.toolIndexes?.[Number(tool[1])];
      if (index !== undefined) errors.tool[index] = message;
      else errors.tools = message;
    } else if (field === "name" || field === "servesHalf" || field === "minutes" || field === "lines" || field === "steps" || field === "tools") {
      errors[field] = message;
    } else {
      errors.other = message;
    }
  }
  if (!hasErrors(errors)) errors.other = fallback;
  return errors;
}

// ── The food list under a line's name ─────────────────────────────

/** A food the search found, as the suggestion list shows it: "Onion · pyaz" (the name it matched, when another). */
export interface FoodSuggestion {
  key: string;
  name: string;
  meta: string;
  price: string;
  label: string;
}

export function foodSuggestionViews(foods: readonly FoodMatch[]): FoodSuggestion[] {
  return foods.map((f) => {
    const other = f.matchedName && foodNameKey(f.matchedName) !== foodNameKey(f.name) ? f.matchedName : "";
    return { key: f.key, name: f.name, meta: other, price: "", label: other ? `${f.name} · ${other}` : f.name };
  });
}

/**
 * Under a named line: linked to a food (so it can match a pantry) — "✓ On
 * the food list", or "✓ Onion" when the words say more ("Onions, sliced") —
 * or the person's own words.
 */
export function lineLinkText(line: Pick<LineDraft, "name" | "foodKey" | "foodName">): { text: string; linked: boolean } | null {
  if (!line.name.trim()) return null;
  if (line.foodKey) {
    const same = !line.foodName || foodNameKey(line.foodName) === foodNameKey(line.name);
    return { text: same ? "✓ On the food list" : `✓ ${line.foodName}`, linked: true };
  }
  return { text: "Not on the food list · won't match a pantry", linked: false };
}
