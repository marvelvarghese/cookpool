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

import {
  COOK_NOW_MISSING_NAMES,
  DEFAULT_RECIPE_VISIBILITY,
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
  type PantryRef,
  type RecipeKind,
  type RecipeLastCook,
  type RecipeLineMatch,
  type RecipeMatchItem,
  type RecipeMatchSummary,
  type RecipeSummary,
  type RecipeVisibility,
} from "@saas/contracts/kitchen";
import type {
  KitchenFoodRecord,
  KitchenItemRecord,
  KitchenRecipeLastCookRecord,
  KitchenRecipeLineRecord,
  KitchenRecipeTemplateRecord,
  KitchenRepository,
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

export function toKitchenRecipe(record: KitchenRecipeTemplateRecord, viewer: string, names: ReadonlyMap<string, DisplayName>): KitchenRecipe {
  const summary = toRecipeSummary(record, viewer, names);
  return {
    ...summary,
    lines: record.lines.map(toRecipeLine),
    steps: [...record.steps],
    // The code is the owner's to share; nobody else learns it from a read.
    linkCode: summary.mine ? record.linkCode : null,
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
    if (hasAmount) fields.add(`${at}.quantity`, "A to-taste line has no amount: leave quantity and unit out");
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

/** `steps`: 0 to MAX_RECIPE_STEPS texts of 1 to MAX_RECIPE_STEP characters (trimmed). */
export function parseSteps(fields: Fields, value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fields.add("steps", `Must be a list of at most ${MAX_RECIPE_STEPS} steps`);
  if (value.length > MAX_RECIPE_STEPS) return fields.add("steps", `At most ${MAX_RECIPE_STEPS} steps`);
  const steps: string[] = [];
  value.forEach((raw: unknown, i) => {
    const step = text(fields, `steps[${i}]`, raw, MAX_RECIPE_STEP);
    if (step !== undefined) steps.push(step);
  });
  return steps.length === value.length ? steps : undefined;
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
  steps: string[];
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
  if (
    !fields.ok || name === undefined || servesHalf === undefined || minutes === undefined || kind === undefined ||
    visibility === undefined || lines === undefined || steps === undefined
  ) {
    return { ok: false, fields: fields.errors };
  }
  return { ok: true, value: { name, servesHalf, minutes, kind, visibility, lines, steps } };
}

export interface ParsedFromDish {
  dishId: string;
  name: string | null;
  minutes: number | null;
  kind: RecipeKind | null;
  visibility: RecipeVisibility;
  steps: string[];
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
  if (body.lines !== undefined) fields.add("lines", "A recipe saved from a dish takes its lines from the dish: leave lines out");
  if (!fields.ok || dishId === undefined || name === undefined || minutes === undefined || kind === undefined || visibility === undefined || steps === undefined) {
    return { ok: false, fields: fields.errors };
  }
  return { ok: true, value: { dishId, name, minutes, kind, visibility, steps } };
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
  for (const key of ["name", "servesHalf", "minutes", "kind", "visibility", "lines", "steps"]) if (body[key] !== undefined) asked += 1;
  if (body.name !== undefined) set("name", text(fields, "name", body.name, MAX_RECIPE_NAME));
  if (body.servesHalf !== undefined) set("servesHalf", servesValue(fields, body.servesHalf));
  if (body.minutes !== undefined) set("minutes", minutesValue(fields, body.minutes));
  if (body.kind !== undefined) set("kind", kindValue(fields, body.kind));
  if (body.visibility !== undefined) set("visibility", visibilityValue(fields, body.visibility));
  if (body.lines !== undefined) set("lines", parseLines(fields, body.lines));
  if (body.steps !== undefined) set("steps", parseSteps(fields, body.steps));
  if (asked === 0) fields.add("body", "Change at least one of: name, servesHalf, minutes, kind, visibility, lines, steps");
  return fields.ok ? { ok: true, value: edit } : { ok: false, fields: fields.errors };
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
 * measures, the foods' piece weights and the caller's Always have. Four
 * reads, however many recipes; null when one failed.
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
 * How many of an item's base thousandths make one of a line's (a gram, a
 * millilitre, a piece) — or null when they do not meet. The same dimension:
 * 1. A count line meets any item through its measure (the one the line's
 * unit names, else its first: "1 onion ≈ 150 g"), else a mass item through
 * the food's piece weight; a mass line meets a count item through the piece
 * weight. Nothing else converts (no densities: a spoon of a powder bought by
 * weight does not meet it).
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
    if (item.dimension === "mass" && food?.eachG) return food.eachG;
    return null;
  }
  if (lineDimension === "mass" && item.dimension === "count" && food?.eachG) return 1 / food.eachG;
  return null;
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
      const available = Math.floor(item.record.qtyLeftMilli / perLine);
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
