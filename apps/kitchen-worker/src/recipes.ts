// Recipes (Cookpool RC-4, cookpool-recipes design §3, §5.1, §5.2, §5.4):
// what the recipe handlers share — a recipe's public shape, who may see it,
// the bodies that write one, link codes, and the match: what the caller's
// pantries hold of each line, which Explore and Cook now summarise.
//
// Recipes are personal, so — as with a personal item — ownership is checked
// here, not by the policy engine (design §7). Visibility is cumulative and
// read from membership at request time, as the people and roster reads do:
//   only_me  the owner;
//   groups   plus anyone who currently shares a group with the owner;
//   link     plus anyone signed in who has the code.
// Cookpool's own recipes (is_system, owner usr_cookpool) are seen by everyone
// and edited by no one. A refusal is the kitchen's opaque 404.
//
// Guided steps (GC-2, cookpool-guided design §1): a step is its text alone
// or every guided field, checked here; keys are the server's (`resolveSteps`):
// a new step gets one, a PATCH keeps the key a step sends when the recipe
// has it, and a plain-string step keeps the step with the same text — so a
// client that writes texts only (RC-5's form) loses nothing it did not change.

import {
  COOK_NOW_MISSING_NAMES,
  DEFAULT_RECIPE_VISIBILITY,
  DEFAULT_STEP_PHASE,
  DEFAULT_STEP_TIME_RULE,
  MAX_RECIPE_TOOL,
  MAX_RECIPE_TOOLS,
  MAX_STEP_CHECKPOINT,
  MAX_STEP_HEAT,
  MAX_STEP_SECONDS,
  MAX_STEP_TIP,
  MAX_STEP_WHISTLES,
  STEP_PHASES,
  STEP_SENSES,
  STEP_TIME_RULES,
  longPrepOf,
  MAX_RECIPE_LINES,
  MAX_RECIPE_LINE_NAME,
  MAX_RECIPE_MINUTES,
  MAX_RECIPE_NAME,
  MAX_RECIPE_SERVES_HALF,
  MAX_RECIPE_STEP,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_UNIT_WORD,
  RECIPE_KINDS,
  RECIPE_LINK_ALPHABET,
  RECIPE_LINK_CODE_LENGTH,
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_UNIT_KEYS,
  RECIPE_VISIBILITIES,
  SYSTEM_RECIPE_OWNER,
  SYSTEM_RECIPE_OWNER_NAME,
  findMeasure,
  isRecipeUnit,
  lineQuantity,
  recipeUnitOf,
  scaleLine,
  type FoodDimension,
  type KitchenMeasure,
  type KitchenRecipe,
  type KitchenRecipeLine,
  type KitchenRecipeStep,
  type PantryRef,
  type RecipeKind,
  type RecipeLastCook,
  type RecipeLineMatch,
  type RecipeMatchItem,
  type RecipeMatchSummary,
  type RecipeSummary,
  type RecipeVisibility,
  type StepHeat,
  type StepPhase,
  type StepSense,
  type StepTimeRule,
} from "@saas/contracts/kitchen";
import type {
  KitchenFoodRecord,
  KitchenItemRecord,
  KitchenRecipeLastCookRecord,
  KitchenRecipeLineRecord,
  KitchenRecipeStepRecord,
  KitchenRecipeTemplateRecord,
  KitchenRepository,
  NewKitchenRecipeStep,
} from "@saas/db/kitchen";
import { displayQuantity } from "./pantry.js";
import type { RequestContext } from "./context.js";
import { canUseIn, type MemberGroup } from "./groups-client.js";
import type { DisplayName } from "./identity-client.js";
import { orgPublicId, toPublicId } from "./ids.js";
import { readMeasures, type MeasureBook } from "./measures.js";
import { groupPantryRef, personalPantryRef } from "./pantry.js";
import { foodKeyValue } from "./foods.js";
import { Fields, text, type FieldErrors } from "./validate.js";
import { UnitError, isUnit, toMilli as engineToMilli } from "@saas/kitchen-engine/units";

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

/** The most recipes one read considers (Cook now ranks every one it can see, up to this). */
export const MAX_RECIPES_READ = 500;
/** The most My recipes and a person's page list. */
export const MAX_RECIPES_LIST = 200;
/** The most Explore lists. */
export const EXPLORE_LIMIT = 50;
/** The most unlinked items a match offers to ask about. */
export const MAX_UNLINKED = 20;

// ── Public shapes ──────────────────────────────────────────

export function toRecipeLine(line: KitchenRecipeLineRecord): KitchenRecipeLine {
  return {
    position: line.position,
    foodKey: line.foodKey,
    name: line.name,
    qtyMilli: line.qtyMilli,
    quantity: line.qtyMilli !== null && line.unit !== null ? lineQuantity(line.qtyMilli, line.unit) : null,
    unit: line.unit,
    dimension: line.unit !== null ? recipeUnitOf(line.unit).dimension : null,
    toTaste: line.toTaste,
    isMain: line.isMain,
  };
}

/** What a recipe's owner is called: "Cookpool" for its own, else their name (null when unknown). */
export function ownerNameOf(record: Pick<KitchenRecipeTemplateRecord, "ownerId" | "isSystem">, names: ReadonlyMap<string, DisplayName>): string | null {
  if (record.isSystem || record.ownerId === SYSTEM_RECIPE_OWNER) return SYSTEM_RECIPE_OWNER_NAME;
  return names.get(record.ownerId) ?? null;
}

/** The names of these recipes' owners (Cookpool's own need none), one lookup however many. */
export async function ownerNames(
  ctx: RequestContext,
  records: readonly Pick<KitchenRecipeTemplateRecord, "ownerId" | "isSystem">[],
): Promise<Map<string, DisplayName>> {
  const ids = [...new Set(records.filter((r) => !r.isSystem).map((r) => r.ownerId))];
  if (ids.length === 0) return new Map();
  return ctx.timings.measure("identity", () => ctx.people.names(ids));
}

export function toRecipeSummary(record: KitchenRecipeTemplateRecord, viewer: string, names: ReadonlyMap<string, DisplayName>): RecipeSummary {
  const main = record.lines.find((l) => l.isMain) ?? null;
  const mainLine = main ? toRecipeLine(main) : null;
  return {
    id: toPublicId("rcp", record.id),
    ownerId: record.ownerId,
    ownerName: ownerNameOf(record, names),
    name: record.name,
    servesHalf: record.servesHalf,
    serves: record.servesHalf / 2,
    minutes: record.minutes,
    kind: (RECIPE_KINDS as readonly string[]).includes(record.kind ?? "") ? (record.kind as RecipeKind) : null,
    visibility: record.visibility,
    isSystem: record.isSystem,
    mine: !record.isSystem && record.ownerId === viewer,
    source: record.sourceRecipeId
      ? { recipeId: toPublicId("rcp", record.sourceRecipeId), ownerId: record.sourceOwnerId, ownerName: record.sourceOwnerName }
      : null,
    savedBy: record.savedBy,
    lineCount: record.lines.length,
    main: mainLine
      ? { position: mainLine.position, foodKey: mainLine.foodKey, name: mainLine.name, qtyMilli: mainLine.qtyMilli, quantity: mainLine.quantity, unit: mainLine.unit }
      : null,
    lastCookedAt: record.lastCookedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toRecipeStep(step: KitchenRecipeStepRecord): KitchenRecipeStep {
  return {
    position: step.position,
    key: step.key,
    text: step.text,
    phase: step.phase,
    lines: [...step.lineRefs],
    heat: step.heat as StepHeat | null,
    minSeconds: step.minSeconds,
    maxSeconds: step.maxSeconds,
    whistles: step.whistles,
    handsOff: step.handsOff,
    timeRule: step.timeRule,
    sense: step.sense,
    checkpoint: step.checkpoint,
    tip: step.tip,
  };
}

export function toKitchenRecipe(record: KitchenRecipeTemplateRecord, viewer: string, names: ReadonlyMap<string, DisplayName>): KitchenRecipe {
  const summary = toRecipeSummary(record, viewer, names);
  const guidedSteps = record.guidedSteps.map(toRecipeStep);
  return {
    ...summary,
    lines: record.lines.map(toRecipeLine),
    steps: guidedSteps.map((s) => s.text),
    // The code is the owner's to share; nobody else learns it from a read.
    linkCode: summary.mine ? record.linkCode : null,
    guidedSteps,
    tools: [...record.tools],
    longPrep: longPrepOf(guidedSteps),
  };
}

export function toLastCook(record: KitchenRecipeLastCookRecord): RecipeLastCook {
  return {
    dishId: toPublicId("dsh", record.dishId),
    cookedAt: record.cookedAt.toISOString(),
    recipeFactorMilli: record.recipeFactorMilli,
    portionsHalf: record.portionsHalf,
    lines: record.ingredients.map((i) => ({
      recipeLine: i.recipeLine ?? 0,
      itemId: toPublicId("itm", i.itemId),
      name: i.name,
      qtyMilli: i.qtyMilli,
      quantity: isUnit(i.unit) ? displayQuantity(i.qtyMilli, i.unit) : i.qtyMilli / 1000,
      unit: i.unit,
      label: i.label,
    })),
  };
}

// ── Who may see a recipe (design §5.1) ─────────────────────

/** The caller's groups; null when membership could not be read. */
export async function callerGroups(ctx: RequestContext): Promise<MemberGroup[] | null> {
  const result = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  return result.ok ? result.groups : null;
}

/** Does the caller share a group with `subjectId` right now? Null when membership could not be read. */
export async function sharesGroup(ctx: RequestContext, subjectId: string): Promise<boolean | null> {
  const [mine, theirs] = await ctx.timings.measure("groups", () =>
    Promise.all([ctx.groups.of(ctx.actor.subjectId), ctx.groups.of(subjectId)]),
  );
  if (!mine.ok || !theirs.ok) return null;
  const ours = new Set(mine.groups.map((g) => g.orgId));
  return theirs.groups.some((g) => ours.has(g.orgId));
}

/**
 * Everyone the caller shares a group with now, themselves left out: whose
 * groups-or-link recipes Explore's "Your groups" and Cook now read. Null
 * when membership could not be read.
 */
export async function coMembers(ctx: RequestContext, groups: readonly MemberGroup[]): Promise<string[] | null> {
  const rosters = await ctx.timings.measure("roster", () => Promise.all(groups.map((g) => ctx.roster.members(g.orgId))));
  const ids = new Set<string>();
  for (const roster of rosters) {
    if (!roster.ok) return null;
    for (const m of roster.members) if (m.subjectId !== ctx.actor.subjectId) ids.add(m.subjectId);
  }
  return [...ids];
}

/**
 * May the caller see `recipe`? Cookpool's own and their own always; only_me
 * nobody else; a link recipe anyone with its code; groups and link anyone who
 * shares a group with its owner now. Null when membership could not be read.
 */
export async function canSee(ctx: RequestContext, recipe: KitchenRecipeTemplateRecord, code: string | null = null): Promise<boolean | null> {
  if (recipe.deletedAt) return false;
  if (recipe.isSystem) return true;
  if (recipe.ownerId === ctx.actor.subjectId) return true;
  if (recipe.visibility === "only_me") return false;
  if (recipe.visibility === "link" && code !== null && recipe.linkCode === code) return true;
  return sharesGroup(ctx, recipe.ownerId);
}

/** May the caller change `recipe`? Its owner, while it is live and not Cookpool's. */
export function canEdit(ctx: RequestContext, recipe: KitchenRecipeTemplateRecord): boolean {
  return !recipe.deletedAt && !recipe.isSystem && recipe.ownerId === ctx.actor.subjectId;
}

// ── Link codes ─────────────────────────────────────────────

/** 10 random base-58 characters, each drawn evenly (bytes past the alphabet's last multiple are drawn again). */
export function mintLinkCode(): string {
  const alphabet = RECIPE_LINK_ALPHABET;
  const limit = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < RECIPE_LINK_CODE_LENGTH) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit && code.length < RECIPE_LINK_CODE_LENGTH) code += alphabet[byte % alphabet.length];
    }
  }
  return code;
}

// ── Request bodies ─────────────────────────────────────────

/** One line, validated: thousandths of its unit's base, as stored. */
export type ParsedLine = Omit<KitchenRecipeLineRecord, "position">;

/** A count word: letters (and spaces between), 1 to MAX_RECIPE_UNIT_WORD. */
const UNIT_WORD_RE = new RegExp(`^[a-z](?:[a-z ]{0,${MAX_RECIPE_UNIT_WORD - 2}}[a-z])?$`);

/** A line's unit: one of the app's (any case: "KG", "l"), else a count word, lower-cased. */
function unitValue(fields: Fields, at: string, value: unknown): string | undefined {
  if (typeof value === "string") {
    const raw = value.trim();
    const known = RECIPE_UNIT_KEYS.find((u) => u.toLowerCase() === raw.toLowerCase());
    if (known) return known;
    const word = raw.toLowerCase().replace(/\s+/g, " ");
    if (UNIT_WORD_RE.test(word)) return word;
  }
  return fields.add(at, `Must be one of ${RECIPE_UNIT_KEYS.join(", ")}, or a word for one piece (such as "onion")`);
}

/** A decimal in `unit` as thousandths of the unit's base (the engine's own rounding; a count word is a piece). */
function amountValue(fields: Fields, at: string, value: unknown, unit: string): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return fields.add(at, 'Must be a decimal such as "450" or "1.5"');
  try {
    const milli = toMilliIn(value, unit);
    if (milli > 1_000_000_000_000) return fields.add(at, "Must be a smaller amount");
    return milli;
  } catch (err) {
    if (err instanceof UnitError) return fields.add(at, 'Must be an amount above zero, such as "450" or "1.5"');
    throw err;
  }
}

/** The engine's toMilli for the app's units; a count word counts as pieces. */
function toMilliIn(value: string | number, unit: string): number {
  return engineToMilli(value, isRecipeUnit(unit) ? unit : "pcs");
}

function booleanValue(fields: Fields, at: string, value: unknown): boolean | undefined {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  return fields.add(at, "Must be true or false");
}

function parseLine(fields: Fields, at: string, value: unknown): (ParsedLine & { mainSaid: boolean }) | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fields.add(at, "Must be an object");
  const raw = value as Record<string, unknown>;
  const name = text(fields, `${at}.name`, raw.name, MAX_RECIPE_LINE_NAME);
  const foodKey = raw.foodKey === undefined || raw.foodKey === null ? null : foodKeyValue(fields, `${at}.foodKey`, raw.foodKey);
  const toTaste = booleanValue(fields, `${at}.toTaste`, raw.toTaste);
  const isMain = booleanValue(fields, `${at}.isMain`, raw.isMain);
  let qtyMilli: number | null = null;
  let unit: string | null = null;
  const hasAmount = (raw.quantity !== undefined && raw.quantity !== null) || (raw.unit !== undefined && raw.unit !== null);
  if (toTaste) {
    if (hasAmount) return fields.add(`${at}.quantity`, "A to-taste line has no amount: leave quantity and unit out");
  } else {
    const u = raw.unit === undefined || raw.unit === null ? fields.add(`${at}.unit`, "Required, or say toTaste") : unitValue(fields, `${at}.unit`, raw.unit);
    if (raw.quantity === undefined || raw.quantity === null) fields.add(`${at}.quantity`, "Required, or say toTaste");
    else if (u !== undefined) {
      const q = amountValue(fields, `${at}.quantity`, raw.quantity, u);
      if (q !== undefined) qtyMilli = q;
    }
    if (u !== undefined) unit = u;
  }
  if (name === undefined || foodKey === undefined || toTaste === undefined || isMain === undefined) return undefined;
  if (!toTaste && (qtyMilli === null || unit === null)) return undefined;
  return { foodKey, name, qtyMilli, unit, toTaste, isMain, mainSaid: isMain };
}

/**
 * `lines`: 1 to MAX_RECIPE_LINES, exactly one main — never to taste. When
 * none says it is main, the first line with a weight is, else the first with
 * an amount.
 */
export function parseLines(fields: Fields, value: unknown): ParsedLine[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return fields.add("lines", `Must be a list of 1 to ${MAX_RECIPE_LINES} lines`);
  if (value.length > MAX_RECIPE_LINES) return fields.add("lines", `At most ${MAX_RECIPE_LINES} lines`);
  const lines: (ParsedLine & { mainSaid: boolean })[] = [];
  let bad = false;
  value.forEach((raw: unknown, i) => {
    const line = parseLine(fields, `lines[${i}]`, raw);
    if (line) lines.push(line);
    else bad = true;
  });
  if (bad) return undefined;
  const said = lines.filter((l) => l.mainSaid);
  if (said.length > 1) return fields.add("lines", "Mark one line as main: it scales every other");
  if (said.length === 1 && said[0]!.toTaste) {
    return fields.add(`lines[${lines.indexOf(said[0]!)}].isMain`, "The main line needs an amount: it cannot be to taste");
  }
  let main = said[0];
  if (!main) {
    main = lines.find((l) => !l.toTaste && l.unit !== null && recipeUnitOf(l.unit).dimension === "mass") ?? lines.find((l) => !l.toTaste);
    if (!main) return fields.add("lines", "At least one line needs an amount: the main line scales every other");
  }
  return lines.map((l) => ({
    foodKey: l.foodKey, name: l.name, qtyMilli: l.qtyMilli, unit: l.unit, toTaste: l.toTaste, isMain: l === main,
  }));
}

/** One step as a request wrote it, checked (GC-2). `plain`: it was sent as a string. `key`: the key it sent, if any. */
export interface ParsedStep {
  plain: boolean;
  key: string | null;
  text: string;
  phase: StepPhase;
  lineRefs: number[];
  heat: StepHeat | null;
  minSeconds: number | null;
  maxSeconds: number | null;
  whistles: number | null;
  handsOff: boolean;
  timeRule: StepTimeRule;
  sense: StepSense | null;
  checkpoint: string | null;
  tip: string | null;
}

/** A whole number in [min, max], or null/absent for none. */
function wholeOrNull(fields: Fields, at: string, value: unknown, min: number, max: number, what: string): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) return value;
  return fields.add(at, `Must be ${what}, a whole number from ${min} to ${max}, or null`);
}

/** Trimmed text of at most `max` characters; absent, null, empty or spaces are none. */
function optionalText(fields: Fields, at: string, value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return fields.add(at, "Must be text, or null");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return fields.add(at, `Must be at most ${max} characters`);
  return trimmed;
}

/** `lines` of a step: positions 0 to MAX_RECIPE_LINES − 1, each once (checked against the recipe's lines by `checkStepLines`). */
function lineRefsValue(fields: Fields, at: string, value: unknown): number[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fields.add(at, "Must be a list of the recipe's line positions");
  const refs: number[] = [];
  for (const ref of value as unknown[]) {
    if (typeof ref !== "number" || !Number.isSafeInteger(ref) || ref < 0 || ref >= MAX_RECIPE_LINES) {
      return fields.add(at, `Must be a list of line positions, whole numbers from 0 to ${MAX_RECIPE_LINES - 1}`);
    }
    refs.push(ref);
  }
  if (new Set(refs).size !== refs.length) return fields.add(at, "Name each line once");
  return refs;
}

function choice<T extends string>(fields: Fields, at: string, value: unknown, allowed: readonly T[], fallback: T | null): T | null | undefined {
  if (value === undefined || (value === null && fallback === null)) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  return fields.add(at, `Must be one of: ${allowed.join(", ")}${fallback === null ? ", or null" : ""}`);
}

/** One step: a string (its text), or an object with every guided field (design §1). */
function parseStep(fields: Fields, at: string, value: unknown): ParsedStep | undefined {
  if (typeof value === "string" || value === null || value === undefined) {
    const stepText = text(fields, at, value, MAX_RECIPE_STEP);
    if (stepText === undefined) return undefined;
    return {
      plain: true, key: null, text: stepText, phase: DEFAULT_STEP_PHASE, lineRefs: [], heat: null, minSeconds: null, maxSeconds: null,
      whistles: null, handsOff: false, timeRule: DEFAULT_STEP_TIME_RULE, sense: null, checkpoint: null, tip: null,
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) return fields.add(at, "Must be the step's text, or an object with its text");
  const raw = value as Record<string, unknown>;
  const errors = Object.keys(fields.errors).length;
  let key: string | null = null;
  if (raw.key !== undefined && raw.key !== null) {
    if (typeof raw.key === "string") key = raw.key;
    else fields.add(`${at}.key`, "Must be the step's key, or left out for a new step");
  }
  const stepText = text(fields, `${at}.text`, raw.text, MAX_RECIPE_STEP);
  const phase = choice(fields, `${at}.phase`, raw.phase, STEP_PHASES, DEFAULT_STEP_PHASE);
  const lineRefs = lineRefsValue(fields, `${at}.lines`, raw.lines);
  const heat = wholeOrNull(fields, `${at}.heat`, raw.heat, 0, MAX_STEP_HEAT, "the flame (0 off, 1 low, 2 medium, 3 high)");
  const minSeconds = wholeOrNull(fields, `${at}.minSeconds`, raw.minSeconds, 0, MAX_STEP_SECONDS, "seconds");
  let maxSeconds = wholeOrNull(fields, `${at}.maxSeconds`, raw.maxSeconds, 0, MAX_STEP_SECONDS, "seconds");
  const whistles = wholeOrNull(fields, `${at}.whistles`, raw.whistles, 1, MAX_STEP_WHISTLES, "whistles");
  const handsOff = booleanValue(fields, `${at}.handsOff`, raw.handsOff);
  const timeRule = choice(fields, `${at}.timeRule`, raw.timeRule, STEP_TIME_RULES, DEFAULT_STEP_TIME_RULE);
  const sense = choice(fields, `${at}.sense`, raw.sense, STEP_SENSES, null);
  const checkpoint = optionalText(fields, `${at}.checkpoint`, raw.checkpoint, MAX_STEP_CHECKPOINT);
  const tip = optionalText(fields, `${at}.tip`, raw.tip, MAX_STEP_TIP);
  // The rules between fields: a range is min alone (one time) or min ≤ max; whistles instead of seconds; a sense for a checkpoint.
  if (minSeconds === null && typeof maxSeconds === "number") fields.add(`${at}.maxSeconds`, "Send minSeconds with it (equal for one time)");
  if (typeof minSeconds === "number") {
    if (maxSeconds === null) maxSeconds = minSeconds;
    else if (typeof maxSeconds === "number" && maxSeconds < minSeconds) fields.add(`${at}.maxSeconds`, "Must be at least minSeconds");
  }
  if (typeof whistles === "number" && (typeof minSeconds === "number" || typeof maxSeconds === "number")) {
    fields.add(`${at}.whistles`, "A step counts whistles or takes a time, not both");
  }
  if (typeof sense === "string" && checkpoint === null) fields.add(`${at}.sense`, "Say the checkpoint it is the sense of");
  if (
    Object.keys(fields.errors).length > errors || stepText === undefined || phase === undefined || phase === null || lineRefs === undefined ||
    heat === undefined || minSeconds === undefined || maxSeconds === undefined || whistles === undefined || handsOff === undefined ||
    timeRule === undefined || timeRule === null || sense === undefined || checkpoint === undefined || tip === undefined
  ) {
    return undefined;
  }
  return {
    plain: false, key, text: stepText, phase, lineRefs, heat: heat as StepHeat | null, minSeconds, maxSeconds, whistles, handsOff,
    timeRule, sense, checkpoint, tip,
  };
}

/** `steps`: 0 to MAX_RECIPE_STEPS, each its text (1 to MAX_RECIPE_STEP characters, trimmed) or a guided step. */
export function parseSteps(fields: Fields, value: unknown): ParsedStep[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fields.add("steps", `Must be a list of at most ${MAX_RECIPE_STEPS} steps`);
  if (value.length > MAX_RECIPE_STEPS) return fields.add("steps", `At most ${MAX_RECIPE_STEPS} steps`);
  const steps: ParsedStep[] = [];
  value.forEach((raw: unknown, i) => {
    const step = parseStep(fields, `steps[${i}]`, raw);
    if (step !== undefined) steps.push(step);
  });
  return steps.length === value.length ? steps : undefined;
}

/** Every line a step names must be one the recipe has (`lineCount` lines): field errors on `fields`. */
export function checkStepLines(fields: Fields, steps: readonly ParsedStep[], lineCount: number): void {
  steps.forEach((step, i) => {
    if (step.lineRefs.some((ref) => ref >= lineCount)) {
      fields.add(`steps[${i}].lines`, `The recipe has ${lineCount} line${lineCount === 1 ? "" : "s"}: positions 0 to ${lineCount - 1}`);
    }
  });
}

/** `tools`: 0 to MAX_RECIPE_TOOLS names of 1 to MAX_RECIPE_TOOL characters (trimmed), each once; null is none. */
export function parseTools(fields: Fields, value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fields.add("tools", `Must be a list of at most ${MAX_RECIPE_TOOLS} names`);
  if (value.length > MAX_RECIPE_TOOLS) return fields.add("tools", `At most ${MAX_RECIPE_TOOLS} tools`);
  const tools: string[] = [];
  value.forEach((raw: unknown, i) => {
    const tool = text(fields, `tools[${i}]`, raw, MAX_RECIPE_TOOL);
    if (tool !== undefined) tools.push(tool);
  });
  if (tools.length !== value.length) return undefined;
  if (new Set(tools.map((t) => t.toLowerCase())).size !== tools.length) return fields.add("tools", "Name each tool once");
  return tools;
}

/** A new step key: 32 hex characters, the form migration 370's backfill gave the steps before. */
export function mintStepKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** A stored step as a write gives it again: the same key and every field, its lines past `lineCount` dropped. */
export function keptStep({ position: _position, ...step }: KitchenRecipeStepRecord, lineCount = Infinity): NewKitchenRecipeStep {
  return { ...step, lineRefs: step.lineRefs.filter((ref) => ref < lineCount) };
}

/**
 * The steps to write, with their keys (design §1, §5). With no `existing`
 * (a new recipe), every step gets a new key. On an edit of `existing`:
 *   1. a step that sends the key of an existing step keeps it, with the fields
 *      it sends — the first to send it, if two do;
 *   2. a plain-string step keeps the first existing step left with exactly its
 *      text — key and guided fields (its lines within `lineCount`);
 *   3. any other step is new, with a new key.
 */
export function resolveSteps(
  steps: readonly ParsedStep[],
  existing: readonly KitchenRecipeStepRecord[] | null,
  lineCount: number,
): NewKitchenRecipeStep[] {
  const byKey = new Map((existing ?? []).map((s) => [s.key, s]));
  const claimed = new Set<string>();
  const keys: Array<string | null> = steps.map((step) => {
    if (step.plain || step.key === null || !byKey.has(step.key) || claimed.has(step.key)) return null;
    claimed.add(step.key);
    return step.key;
  });
  return steps.map(({ plain, key: _sent, ...fields }, i) => {
    const kept = keys[i];
    if (kept) return { ...fields, key: kept };
    if (plain) {
      const same = (existing ?? []).find((s) => s.text === fields.text && !claimed.has(s.key));
      if (same) {
        claimed.add(same.key);
        return keptStep(same, lineCount);
      }
    }
    return { ...fields, key: mintStepKey() };
  });
}

function servesValue(fields: Fields, value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_RECIPE_SERVES_HALF) return value;
  return fields.add("servesHalf", `Must be serves × 2, a whole number from 1 to ${MAX_RECIPE_SERVES_HALF}`);
}

function minutesValue(fields: Fields, value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_RECIPE_MINUTES) return value;
  return fields.add("minutes", `Must be whole minutes from 1 to ${MAX_RECIPE_MINUTES}, or null`);
}

function kindValue(fields: Fields, value: unknown): RecipeKind | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && (RECIPE_KINDS as readonly string[]).includes(value)) return value as RecipeKind;
  return fields.add("kind", `Must be one of: ${RECIPE_KINDS.join(", ")}, or null`);
}

function visibilityValue(fields: Fields, value: unknown): RecipeVisibility | undefined {
  if (typeof value === "string" && (RECIPE_VISIBILITIES as readonly string[]).includes(value)) return value as RecipeVisibility;
  return fields.add("visibility", `Must be one of: ${RECIPE_VISIBILITIES.join(", ")}`);
}

export interface ParsedRecipe {
  name: string;
  servesHalf: number;
  minutes: number | null;
  kind: RecipeKind | null;
  visibility: RecipeVisibility;
  lines: ParsedLine[];
  steps: ParsedStep[];
  tools: string[];
}

/** A POST /v1/kitchen/me/recipes body that writes a recipe. Unknown fields are ignored. */
export function parseNewRecipe(body: Record<string, unknown>): Parsed<ParsedRecipe> {
  const fields = new Fields();
  const name = text(fields, "name", body.name, MAX_RECIPE_NAME);
  const servesHalf = servesValue(fields, body.servesHalf);
  const minutes = body.minutes === undefined ? null : minutesValue(fields, body.minutes);
  const kind = body.kind === undefined ? null : kindValue(fields, body.kind);
  const visibility = body.visibility === undefined ? DEFAULT_RECIPE_VISIBILITY : visibilityValue(fields, body.visibility);
  const lines = parseLines(fields, body.lines);
  const steps = parseSteps(fields, body.steps);
  const tools = parseTools(fields, body.tools);
  if (lines !== undefined && steps !== undefined) checkStepLines(fields, steps, lines.length);
  if (
    !fields.ok || name === undefined || servesHalf === undefined || minutes === undefined || kind === undefined ||
    visibility === undefined || lines === undefined || steps === undefined || tools === undefined
  ) {
    return { ok: false, fields: fields.errors };
  }
  return { ok: true, value: { name, servesHalf, minutes, kind, visibility, lines, steps, tools } };
}

export interface ParsedFromDish {
  dishId: string;
  name: string | null;
  minutes: number | null;
  kind: RecipeKind | null;
  visibility: RecipeVisibility;
  /** Their lines are checked against the dish's ingredients once it is read. */
  steps: ParsedStep[];
  tools: string[];
}

/** A POST /v1/kitchen/me/recipes body with `fromDishId`: save a dish as a recipe. */
export function parseFromDish(body: Record<string, unknown>): Parsed<ParsedFromDish> {
  const fields = new Fields();
  const dishId = typeof body.fromDishId === "string" && /^dsh_[0-9a-f]{32}$/i.test(body.fromDishId) ? body.fromDishId : fields.add("fromDishId", "Must be a dish's dsh_ id");
  const name = body.name === undefined || body.name === null ? null : text(fields, "name", body.name, MAX_RECIPE_NAME);
  const minutes = body.minutes === undefined ? null : minutesValue(fields, body.minutes);
  const kind = body.kind === undefined ? null : kindValue(fields, body.kind);
  const visibility = body.visibility === undefined ? DEFAULT_RECIPE_VISIBILITY : visibilityValue(fields, body.visibility);
  const steps = parseSteps(fields, body.steps);
  const tools = parseTools(fields, body.tools);
  if (body.lines !== undefined) fields.add("lines", "A recipe saved from a dish takes its lines from the dish: leave lines out");
  if (
    !fields.ok || dishId === undefined || name === undefined || minutes === undefined || kind === undefined || visibility === undefined ||
    steps === undefined || tools === undefined
  ) {
    return { ok: false, fields: fields.errors };
  }
  return { ok: true, value: { dishId, name, minutes, kind, visibility, steps, tools } };
}

export type ParsedRecipeEdit = Partial<ParsedRecipe>;

/** A PATCH /v1/kitchen/me/recipes/{rcp} body: at least one field. */
export function parseRecipeEdit(body: Record<string, unknown>): Parsed<ParsedRecipeEdit> {
  const fields = new Fields();
  const edit: ParsedRecipeEdit = {};
  const set = <K extends keyof ParsedRecipe>(key: K, value: ParsedRecipe[K] | undefined) => {
    if (value !== undefined) edit[key] = value;
  };
  let asked = 0;
  for (const key of ["name", "servesHalf", "minutes", "kind", "visibility", "lines", "steps", "tools"]) if (body[key] !== undefined) asked += 1;
  if (body.name !== undefined) set("name", text(fields, "name", body.name, MAX_RECIPE_NAME));
  if (body.servesHalf !== undefined) set("servesHalf", servesValue(fields, body.servesHalf));
  if (body.minutes !== undefined) set("minutes", minutesValue(fields, body.minutes));
  if (body.kind !== undefined) set("kind", kindValue(fields, body.kind));
  if (body.visibility !== undefined) set("visibility", visibilityValue(fields, body.visibility));
  if (body.lines !== undefined) set("lines", parseLines(fields, body.lines));
  if (body.steps !== undefined) set("steps", parseSteps(fields, body.steps));
  if (body.tools !== undefined) set("tools", parseTools(fields, body.tools));
  if (asked === 0) fields.add("body", "Change at least one of: name, servesHalf, minutes, kind, visibility, lines, steps, tools");
  return fields.ok ? { ok: true, value: edit } : { ok: false, fields: fields.errors };
}

/** One step's range for "Use today's times" (GC-2). */
export interface ParsedStepTimes {
  key: string;
  minSeconds: number;
  maxSeconds: number;
}

/**
 * A PATCH /v1/kitchen/me/recipes/{rcp}/step-times body: `steps`, 1 to
 * MAX_RECIPE_STEPS of `{ key, minSeconds, maxSeconds }` (0 to MAX_STEP_SECONDS,
 * min ≤ max), each key once. Checked against the recipe by `checkStepTimes`.
 */
export function parseStepTimes(body: Record<string, unknown>): Parsed<ParsedStepTimes[]> {
  const fields = new Fields();
  const value = body.steps;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPE_STEPS) {
    fields.add("steps", `Must be a list of 1 to ${MAX_RECIPE_STEPS} steps, each { key, minSeconds, maxSeconds }`);
    return { ok: false, fields: fields.errors };
  }
  const steps: ParsedStepTimes[] = [];
  const seen = new Set<string>();
  value.forEach((raw: unknown, i) => {
    const at = `steps[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      fields.add(at, "Must be an object: { key, minSeconds, maxSeconds }");
      return;
    }
    const step = raw as Record<string, unknown>;
    const key = typeof step.key === "string" && step.key.length > 0 ? step.key : fields.add(`${at}.key`, "Must be the step's key");
    if (key !== undefined && seen.has(key)) fields.add(`${at}.key`, "Name each step once");
    if (key !== undefined) seen.add(key);
    const seconds = (name: "minSeconds" | "maxSeconds") =>
      step[name] === undefined || step[name] === null
        ? fields.add(`${at}.${name}`, "Required")
        : wholeOrNull(fields, `${at}.${name}`, step[name], 0, MAX_STEP_SECONDS, "seconds");
    const min = seconds("minSeconds");
    const max = seconds("maxSeconds");
    if (typeof min === "number" && typeof max === "number" && max < min) fields.add(`${at}.maxSeconds`, "Must be at least minSeconds");
    if (key !== undefined && typeof min === "number" && typeof max === "number") steps.push({ key, minSeconds: min, maxSeconds: max });
  });
  return fields.ok ? { ok: true, value: steps } : { ok: false, fields: fields.errors };
}

/** Every step named must be one of `recipe`'s that takes a time: the field errors, or none. */
export function checkStepTimes(steps: readonly ParsedStepTimes[], recipe: KitchenRecipeTemplateRecord): FieldErrors | null {
  const fields = new Fields();
  const byKey = new Map(recipe.guidedSteps.map((s) => [s.key, s]));
  steps.forEach((step, i) => {
    const found = byKey.get(step.key);
    if (!found) fields.add(`steps[${i}].key`, "Not a step of this recipe");
    else if (found.whistles !== null) fields.add(`steps[${i}].key`, "This step counts whistles: it has no time to set");
  });
  return fields.ok ? null : fields.errors;
}

/** The food keys some lines name, by field (`lines[2].foodKey`), for `unknownFoods`. */
export function lineFoods(lines: readonly ParsedLine[]): Map<string, string> {
  const wanted = new Map<string, string>();
  lines.forEach((line, i) => {
    if (line.foodKey) wanted.set(`lines[${i}].foodKey`, line.foodKey);
  });
  return wanted;
}

// ── What you have: the match (design §3.3) ─────────────────

/** An item a line may take from: usable by the caller, linked to a food the recipe asks for. */
export interface StockItem {
  record: KitchenItemRecord;
  foodKey: string;
  /** The group it is in (its `org_…`); null for the caller's own pantry. */
  orgId: string | null;
  pantry: PantryRef;
}

/** What the caller's pantries hold for some recipes: read once, matched against every line. */
export interface Stock {
  items: readonly StockItem[];
  alwaysHave: ReadonlySet<string>;
  foods: ReadonlyMap<string, KitchenFoodRecord>;
  measures: MeasureBook;
}

/**
 * Everything the match reads, for the foods `foodKeys`: the active items with
 * something left that link to them, in the caller's own pantry and every
 * group where they hold kitchen.item.use (the role decides here, as on every
 * cross-pantry read; cooking still asks the policy engine), those items'
 * measures, the foods' piece weights and densities, and the caller's Always
 * have. Four reads, however many recipes; null when one failed.
 */
export async function readStock(
  ctx: RequestContext,
  repo: KitchenRepository,
  groups: readonly MemberGroup[],
  foodKeys: readonly string[],
): Promise<Stock | null> {
  const usable = groups.filter(canUseIn);
  const byId = new Map(usable.map((g) => [g.orgId as string, g]));
  const scope = { ownerSubjectId: ctx.actor.subjectId, orgIds: usable.map((g) => g.orgId) };
  const [items, foods, always] = await ctx.timings.measure("db", () =>
    Promise.all([repo.listFoodItems(scope, foodKeys), repo.getFoods(foodKeys), repo.getAlwaysHave(ctx.actor.subjectId)]),
  );
  if (!items.ok || !foods.ok || !always.ok) return null;
  const measures = await readMeasures(ctx, repo, items.value.map((i) => i.item));
  if (!measures) return null;
  const stock: StockItem[] = [];
  for (const { item, foodKey } of items.value) {
    const group = item.orgId ? byId.get(item.orgId) : undefined;
    if (item.orgId && !group) continue;
    stock.push({
      record: item,
      foodKey,
      orgId: group ? group.publicId : null,
      pantry: group ? groupPantryRef(group) : personalPantryRef(),
    });
  }
  return { items: stock, alwaysHave: new Set(always.value.foodKeys), foods: new Map(foods.value.map((f) => [f.key, f])), measures };
}

/**
 * Grams in one base unit of `dimension` of `food` (a gram, a millilitre, a
 * piece): 1 for mass, the food's density for volume (RC-7), its piece weight
 * for count; null when the food has none — and for packs, which only a
 * measure converts.
 */
function gramsPerBase(dimension: string, food: KitchenFoodRecord | undefined): number | null {
  if (dimension === "mass") return 1;
  if (dimension === "volume") return food?.gPerMl ?? null;
  if (dimension === "count") return food?.eachG ?? null;
  return null;
}

/**
 * How many of an item's base thousandths make one of a line's (a gram, a
 * millilitre, a piece) — or null when they do not meet. The same dimension:
 * 1. A count line meets any item through its measure (the one the line's
 * unit names, else its first: "1 onion ≈ 150 g"). Otherwise both sides go
 * through grams: a piece is the food's piece weight (each_g), a millilitre
 * its density (g_per_ml, RC-7) — so "1 tsp turmeric" meets a 100 g pack,
 * "50 g ghee" a 500 ml jar, and "2 onions" a kilo of them. A food without
 * the figure it needs does not meet: a cup of paneer never meets 200 g of it.
 */
export function itemPerLine(
  lineDimension: FoodDimension,
  lineUnit: string,
  item: KitchenItemRecord,
  food: KitchenFoodRecord | undefined,
  measures: readonly KitchenMeasure[],
): number | null {
  if (item.dimension === lineDimension) return 1;
  if (lineDimension === "count") {
    const measure = findMeasure(measures, lineUnit) ?? measures[0];
    if (measure) return measure.amountMilli / measure.count / 1000;
  }
  const lineGrams = gramsPerBase(lineDimension, food);
  const itemGrams = gramsPerBase(item.dimension, food);
  if (lineGrams === null || itemGrams === null) return null;
  return lineGrams / itemGrams;
}

/** Soonest use-by first (none last), then the caller's own pantry, then the most left, then by id. */
function preferred(a: { item: StockItem; available: number }, b: { item: StockItem; available: number }): number {
  const ea = a.item.record.expiresOn ?? "9999-12-31";
  const eb = b.item.record.expiresOn ?? "9999-12-31";
  if (ea !== eb) return ea < eb ? -1 : 1;
  const oa = a.item.orgId === null ? 0 : 1;
  const ob = b.item.orgId === null ? 0 : 1;
  if (oa !== ob) return oa - ob;
  if (a.available !== b.available) return b.available - a.available;
  return a.item.record.id < b.item.record.id ? -1 : a.item.record.id > b.item.record.id ? 1 : 0;
}

/** One line matched at `factorMilli`. */
export function matchLine(line: KitchenRecipeLineRecord, factorMilli: number, stock: Stock): RecipeLineMatch {
  const needMilli = scaleLine(line.qtyMilli, line.unit, factorMilli);
  const candidates: Array<{ item: StockItem; available: number; perLine: number }> = [];
  if (line.foodKey && line.unit !== null) {
    const dimension = recipeUnitOf(line.unit).dimension;
    const food = stock.foods.get(line.foodKey);
    for (const item of stock.items) {
      if (item.foodKey !== line.foodKey) continue;
      const perLine = itemPerLine(dimension, line.unit, item.record, food, stock.measures(item.record));
      if (perLine === null) continue;
      // A millionth of a thousandth of slack, so a ratio such as 1 ÷ 0.9 never
      // loses the last thousandth to binary rounding (500 ml of ghee is 450 g).
      const available = Math.floor(item.record.qtyLeftMilli / perLine + 1e-6);
      if (available > 0) candidates.push({ item, available, perLine });
    }
  }
  candidates.sort(preferred);
  const availableMilli = candidates.reduce((sum, c) => sum + c.available, 0);

  // Take from the preferred items until the need is met.
  const items: RecipeMatchItem[] = [];
  let remaining = needMilli ?? 0;
  for (const c of candidates) {
    if (remaining <= 0) break;
    const takeLine = Math.min(c.available, remaining);
    remaining -= takeLine;
    const r = c.item.record;
    const id = toPublicId("itm", r.id);
    items.push({
      itemId: id,
      ref: c.item.orgId ? `org:${c.item.orgId}:${id}` : `me:${id}`,
      orgId: c.item.orgId,
      pantry: c.item.pantry,
      name: r.name,
      qtyLeftMilli: r.qtyLeftMilli,
      takeMilli: Math.min(r.qtyLeftMilli, Math.max(1, Math.round(takeLine * c.perLine))),
      unit: r.displayUnit,
      expiresOn: r.expiresOn,
    });
  }

  let status: RecipeLineMatch["status"];
  if (line.toTaste || (line.foodKey !== null && stock.alwaysHave.has(line.foodKey))) status = "always";
  else if (needMilli !== null && availableMilli >= needMilli) status = "have";
  else if (availableMilli > 0) status = "short";
  else status = "missing";

  return {
    position: line.position,
    status,
    needMilli,
    needQuantity: needMilli !== null && line.unit !== null ? lineQuantity(needMilli, line.unit) : null,
    unit: line.unit,
    availableMilli,
    items,
  };
}

/** The match in a few numbers; `maxFactorMilli` from the lines as written (see RecipeMatchSummary). */
export function summarize(recipe: KitchenRecipeTemplateRecord, lines: readonly RecipeLineMatch[]): RecipeMatchSummary {
  const count = (status: RecipeLineMatch["status"]) => lines.filter((l) => l.status === status).length;
  const missing = lines.filter((l) => l.status === "missing");
  let maxFactorMilli: number | null = RECIPE_MAX_FACTOR_MILLI;
  if (missing.length > 0) maxFactorMilli = null;
  else {
    for (const match of lines) {
      if (match.status === "always") continue;
      const written = recipe.lines.find((l) => l.position === match.position)?.qtyMilli;
      if (!written) continue;
      maxFactorMilli = Math.min(maxFactorMilli, Math.floor((match.availableMilli * 1000) / written));
    }
  }
  return {
    lines: lines.length,
    have: count("have"),
    short: count("short"),
    missing: missing.length,
    always: count("always"),
    missingNames: missing.slice(0, COOK_NOW_MISSING_NAMES).map((m) => recipe.lines.find((l) => l.position === m.position)!.name),
    maxFactorMilli,
  };
}

/** Every line of `recipe` matched at `factorMilli`, and the summary. */
export function matchRecipe(
  recipe: KitchenRecipeTemplateRecord,
  factorMilli: number,
  stock: Stock,
): { lines: RecipeLineMatch[]; summary: RecipeMatchSummary } {
  const lines = recipe.lines.map((line) => matchLine(line, factorMilli, stock));
  return { lines, summary: summarize(recipe, lines) };
}

/** The foods some recipes' lines ask for, each once. */
export function foodsOf(recipes: readonly KitchenRecipeTemplateRecord[]): string[] {
  return [...new Set(recipes.flatMap((r) => r.lines.flatMap((l) => (l.foodKey ? [l.foodKey] : []))))];
}

/**
 * "For N" (design §5.4): serves × maxFactor in half portions, rounded down
 * (at least ½), capped at serves × 2; null when something is missing.
 */
export function forPortionsHalf(recipe: Pick<KitchenRecipeTemplateRecord, "servesHalf">, summary: RecipeMatchSummary): number | null {
  if (summary.maxFactorMilli === null) return null;
  const halves = Math.floor((recipe.servesHalf * summary.maxFactorMilli) / 1000);
  return Math.min(recipe.servesHalf * 2, Math.max(1, halves));
}

/** The group refs a recipe read names, by `org_…`: so the API never shows a stored UUID. */
export function orgIdOf(uuid: string | null): string | null {
  return uuid ? orgPublicId(uuid) : null;
}
