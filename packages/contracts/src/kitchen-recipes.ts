// Foods and recipes (Cookpool, epic cookpool-recipes: RC-4, design §2, §3,
// §5.1, §5.2, §5.4, §7).
//
// Recipes are templates; cooking is a session that ends in the existing dish
// write (POST /v1/kitchen/me/dishes), which keeps the recipe it was cooked
// from. A recipe never moves money. Everything here is served by
// `apps/kitchen-worker` behind api-edge's kitchen facade, with the usual
// envelopes (`{ data, meta }`; `{ error: { code } }`, 422 `validation_failed`
// with field errors). Who may see a recipe is its visibility (§5.1); anything
// the caller may not see — or that does not exist — is the kitchen's opaque
// 404.
//
//   GET    /v1/kitchen/foods?q=&limit=                 signed in: the food list
//   PUT    /v1/kitchen/me/food-answers                 a pantry member: "Is Kanda onion?"
//   GET    /v1/kitchen/me/always-have                  self
//   PUT    /v1/kitchen/me/always-have                  self
//   GET    /v1/kitchen/me/recipes                      self: yours and your copies, last cooked first
//   POST   /v1/kitchen/me/recipes                      self: write one, or save a dish as one (`fromDishId`)
//   GET    /v1/kitchen/recipes/{rcp}?code=&f=          who may see it, with the caller's last cook (and learned times at f: GC-7)
//   PATCH  /v1/kitchen/me/recipes/{rcp}                its owner
//   DELETE /v1/kitchen/me/recipes/{rcp}                its owner (soft; copies stay)
//   GET    /v1/kitchen/me/recipes/{rcp}/match?f=&code= who may see it: what the caller's pantries have
//   POST   /v1/kitchen/me/recipes/{rcp}/link           its owner: mint or rotate the link
//   DELETE /v1/kitchen/me/recipes/{rcp}/link           its owner: turn the link off
//   GET    /v1/kitchen/recipe-links/{code}?f=          signed in
//   POST   /v1/kitchen/me/recipes/copies               who may see it: save your own copy
//   GET    /v1/kitchen/people/{usr}/recipes            someone you share a group with
//   GET    /v1/kitchen/recipes?source=&q=&kind=        signed in: Explore
//   GET    /v1/kitchen/me/cook-now                     self
//   PATCH  /v1/kitchen/me/recipes/{rcp}/step-times     its owner: "Use today's times" (GC-2)
//
// Types are imported from `kitchen.ts` as types only; this module is
// re-exported from there, so `@saas/contracts/kitchen` carries it all.

import type { PantryRef } from "./kitchen.js";

// ── Foods (design §2) ───────────────────────────────────────

/** What an amount of a food measures. */
export const FOOD_DIMENSIONS = ["mass", "volume", "count"] as const;
export type FoodDimension = (typeof FOOD_DIMENSIONS)[number];

/** One food on the shared list (`kitchen_foods`). */
export interface KitchenFood {
  /** Short ASCII key: `onion`, `toor_dal`. */
  key: string;
  /** Display name: "Onion". */
  name: string;
  dimension: FoodDimension;
  /** One piece in grams (an onion ≈ 150, an egg ≈ 50), so a count meets a weight; null when it is not counted. */
  eachG: number | null;
  /** The pantry category it is filed under: veg, fruit, dairy, grains, protein, spices, other. */
  category: string;
  /**
   * Grams per millilitre (RC-7): a spoon or cup of it meets an item weighed
   * in grams, and a weight meets a bottle (turmeric ≈ 0.6, rice ≈ 0.8, oil ≈
   * 0.92); null when it has none, and then they never meet. Optional in the
   * type so foods typed before RC-7 still check; the server always sends it.
   */
  gPerMl?: number | null;
}

/** A food the search found, with the name of it that matched ("pyaz" for Onion). */
export interface FoodMatch extends KitchenFood {
  matchedName: string;
}

export const FOODS_DEFAULT_LIMIT = 20;
export const FOODS_MAX_LIMIT = 100;

/**
 * GET /v1/kitchen/foods?q=&limit= — any signed-in person. Foods with a name
 * equal to `q` first, then starting with it, then with a word starting with
 * it, then containing it; by name within each. An empty `q` lists them all by
 * name (up to `limit`).
 */
export interface FoodsQuery {
  /** At most 100 characters; folded as names are (`foodNameKey`). */
  q?: string;
  /** 1–FOODS_MAX_LIMIT, default FOODS_DEFAULT_LIMIT. */
  limit?: number;
}

export interface FoodsResponse {
  foods: FoodMatch[];
}

/**
 * A name as the food list keys it: trimmed of spaces, ASCII letters
 * lower-cased — exactly SQLite's lower(trim(name)), which the server matches
 * by. An answer's `nameKey` is the item name in this form.
 */
export function foodNameKey(name: string): string {
  return name.replace(/^ +| +$/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The spellings a name is looked up by (matchFood, design §2): the name
 * itself, then — only if that is no food's name — the name without a plural
 * "es" or "s", which link the item when they agree on exactly one food.
 * "Tomatoes" → tomatoes, then tomato / tomatoe; "Eggs" → eggs, then egg.
 */
export function foodLookupKeys(name: string): { nameKey: string; plurals: string[] } {
  const nameKey = foodNameKey(name);
  const plurals: string[] = [];
  if (nameKey.length > 2 && nameKey.endsWith("es")) plurals.push(nameKey.slice(0, -2));
  if (nameKey.length > 1 && nameKey.endsWith("s")) plurals.push(nameKey.slice(0, -1));
  return { nameKey, plurals };
}

/**
 * PUT /v1/kitchen/me/food-answers — "Is Kanda onion?", asked once per name
 * and pantry. `orgId` names a group's pantry (the caller must be able to use
 * its items: members, owners and admins, not viewers — the opaque 404
 * otherwise); absent or null is the caller's own pantry. `foodKey` null
 * answers "none of these". The answer is kept, and every item of that name
 * in that pantry is linked to the food (or unlinked) at once; items of that
 * name added later follow it.
 */
export interface SetFoodAnswerRequest {
  /** The item's name (any case and spacing: it is folded with `foodNameKey`); 1–120 characters. */
  nameKey: string;
  /** A food on the list (422 otherwise), or null for none of them. */
  foodKey: string | null;
  orgId?: string | null;
}

export interface FoodAnswer {
  nameKey: string;
  foodKey: string | null;
  /** The group whose pantry it is for (`org_…`); null for the caller's own. */
  orgId: string | null;
}

/** 200 from PUT /v1/kitchen/me/food-answers. */
export interface SetFoodAnswerResponse {
  answer: FoodAnswer;
  /** How many items of that name in that pantry the answer now links (or unlinked). */
  linkedItems: number;
}

// ── Always have (design §3.4) ───────────────────────────────

/** What a person always has until they save their own list. */
export const DEFAULT_ALWAYS_HAVE: readonly string[] = ["salt", "water"];
/** The most foods on one person's list. */
export const MAX_ALWAYS_HAVE = 50;

/** GET and PUT /v1/kitchen/me/always-have. */
export interface AlwaysHaveResponse {
  /** By name. */
  foods: KitchenFood[];
  /** True while the person has never saved a list: `foods` is DEFAULT_ALWAYS_HAVE. */
  isDefault: boolean;
}

/** PUT /v1/kitchen/me/always-have — replaces the list (0 to MAX_ALWAYS_HAVE foods on the list; each once). */
export interface SetAlwaysHaveRequest {
  foodKeys: string[];
}

// ── Recipes (design §3.1, §5.1, §5.2) ───────────────────────

/**
 * only_me: the owner; groups: plus anyone who currently shares a group with
 * the owner; link: plus anyone signed in with the link code. Cumulative.
 */
export const RECIPE_VISIBILITIES = ["only_me", "groups", "link"] as const;
export type RecipeVisibility = (typeof RECIPE_VISIBILITIES)[number];

/** A recipe you write starts at My groups; a copy you save at Only me (design §5.1). */
export const DEFAULT_RECIPE_VISIBILITY: RecipeVisibility = "groups";
export const DEFAULT_COPY_VISIBILITY: RecipeVisibility = "only_me";

/** Explore's chips (design §5.3), and the kinds Cookpool's own recipes are filed under (RC-7). */
export const RECIPE_KINDS = ["breakfast", "dal_curry", "rice", "roti", "snack", "sweet", "drink", "other"] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];

/** The owner of Cookpool's own recipes: visible to everyone, edited by no one. */
export const SYSTEM_RECIPE_OWNER = "usr_cookpool";
/** What Cookpool's own recipes say they are by. */
export const SYSTEM_RECIPE_OWNER_NAME = "Cookpool";

export const MAX_RECIPE_NAME = 120;
export const MAX_RECIPE_LINES = 40;
export const MAX_RECIPE_LINE_NAME = 120;
export const MAX_RECIPE_STEPS = 20;
export const MAX_RECIPE_STEP = 200;
/** Serves × 2, like a dish's portions. */
export const MAX_RECIPE_SERVES_HALF = 200;
export const MAX_RECIPE_MINUTES = 1440;
/** The longest count word a line's unit may be ("onion", "katori"). */
export const MAX_RECIPE_UNIT_WORD = 24;

/** A link code: 10 random base-58 characters (no 0, O, I or l). */
export const RECIPE_LINK_CODE_LENGTH = 10;
export const RECIPE_LINK_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const RECIPE_LINK_CODE_RE = /^[1-9A-HJ-NP-Za-km-z]{10}$/;

/** Factors are thousandths (450 is × 0.45); a recipe scales from × 0.01 to × 20. */
export const RECIPE_MIN_FACTOR_MILLI = 10;
export const RECIPE_MAX_FACTOR_MILLI = 20_000;

/**
 * The units a line is written in (design §3.1), each a size in its
 * dimension's base unit (grams, millilitres, pieces) — the same sizes as the
 * kitchen engine's. Any other unit is a count word ("onion", "katori"): one
 * piece of the line's food.
 */
export const RECIPE_UNITS = {
  g: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1000 },
  ml: { dimension: "volume", factor: 1 },
  L: { dimension: "volume", factor: 1000 },
  pcs: { dimension: "count", factor: 1 },
  tsp: { dimension: "volume", factor: 5 },
  tbsp: { dimension: "volume", factor: 15 },
  cup: { dimension: "volume", factor: 240 },
} as const satisfies Record<string, { dimension: FoodDimension; factor: number }>;

export type RecipeUnit = keyof typeof RECIPE_UNITS;
export const RECIPE_UNIT_KEYS = Object.keys(RECIPE_UNITS) as RecipeUnit[];

/** Is `unit` one of the app's own units (else it is a count word)? */
export function isRecipeUnit(unit: string): unit is RecipeUnit {
  return Object.prototype.hasOwnProperty.call(RECIPE_UNITS, unit);
}

/** A line's unit: its dimension and size in base units. A count word is one piece. */
export function recipeUnitOf(unit: string): { dimension: FoodDimension; factor: number } {
  return isRecipeUnit(unit) ? RECIPE_UNITS[unit] : { dimension: "count", factor: 1 };
}

/** A line's amount in its own unit, three decimals at most ("1.5" tsp, 450 g). */
export function lineQuantity(qtyMilli: number, unit: string): number {
  return Math.round(qtyMilli / recipeUnitOf(unit).factor) / 1000;
}

/** One line as a request writes it. */
export interface RecipeLineInput {
  /** A food on the list (422 otherwise), or null/absent for a free-text line. */
  foodKey?: string | null;
  /** Its words ("Onions, sliced"); 1–MAX_RECIPE_LINE_NAME characters. */
  name: string;
  /** How much, a decimal in `unit` ("450", "1.5"); absent or null for a to-taste line. */
  quantity?: string | number | null;
  /** One of RECIPE_UNIT_KEYS, or a count word of letters (1–MAX_RECIPE_UNIT_WORD); absent or null to taste. */
  unit?: string | null;
  /** No amount: it never scales and always counts as there. */
  toTaste?: boolean;
  /**
   * The line that scales every other: exactly one, never to taste. When no
   * line says so, the first line with a weight is main, else the first with
   * an amount.
   */
  isMain?: boolean;
}

/** One line as a recipe reads it, in order. */
export interface KitchenRecipeLine {
  /** Its place, 0-based: what a dish ingredient's `recipeLine` points at. */
  position: number;
  foodKey: string | null;
  name: string;
  /** Thousandths of the unit's base (grams, millilitres, pieces), as an item's quantity; null to taste. */
  qtyMilli: number | null;
  /** The same in `unit` (three decimals at most); null to taste. */
  quantity: number | null;
  unit: string | null;
  /** What the unit measures; null to taste. */
  dimension: FoodDimension | null;
  toTaste: boolean;
  isMain: boolean;
}

// ── Guided steps (cookpool-guided GC-2, design §1, §2) ─────
//
// A step says everything a cook needs: its phase, the lines it uses (shown
// as chips with scaled amounts — the text stays plain words), a flame, a
// time range at the recipe's own size or a whistle count, whether it runs
// hands off, how its time grows with the size, a checkpoint and a tip. All
// optional: a step of text only is still a step. Every step has a stable
// `key`, minted by the server, kept across edits and copies; the times cooks
// record (`stepLog`) and learned ranges (GC-7) hang on it.

/** prep steps are listed in Before you start; cook steps are the cooking. */
export const STEP_PHASES = ["prep", "cook"] as const;
export type StepPhase = (typeof STEP_PHASES)[number];
export const DEFAULT_STEP_PHASE: StepPhase = "cook";

/** How a step's time grows with the size factor f: × 1, × f^0.5, × f ("Same time", "A bit longer", "Longer"). */
export const STEP_TIME_RULES = ["fixed", "partly", "linear"] as const;
export type StepTimeRule = (typeof STEP_TIME_RULES)[number];
export const DEFAULT_STEP_TIME_RULE: StepTimeRule = "fixed";

/** The sense a checkpoint is watched for with: "Until it looks golden brown". */
export const STEP_SENSES = ["look", "smell", "sound", "feel", "taste"] as const;
export type StepSense = (typeof STEP_SENSES)[number];

/** The flame: 0 off, 1 low, 2 medium, 3 high. */
export type StepHeat = 0 | 1 | 2 | 3;
export const MAX_STEP_HEAT = 3;

/** A step's time, in seconds, is 0 to a day; a pressure cooker counts 1 to 10 whistles instead. */
export const MAX_STEP_SECONDS = 86_400;
export const MAX_STEP_WHISTLES = 10;
export const MAX_STEP_CHECKPOINT = 80;
export const MAX_STEP_TIP = 160;
/** A step key: 1–64 letters, digits, `_` or `-` (the server mints 32 hex characters). */
export const STEP_KEY_RE = /^[0-9A-Za-z_-]{1,64}$/;

/** A recipe's tools: at most 10 short names ("Kadai with a lid", "Pressure cooker"). */
export const MAX_RECIPE_TOOLS = 10;
export const MAX_RECIPE_TOOL = 40;

/** A hands-off prep step at least this long (its shortest time) is long prep: soaking, marinating overnight. */
export const LONG_PREP_SECONDS = 3_600;

/** One step as a recipe reads it, in order. */
export interface KitchenRecipeStep {
  /** Its place, 0-based. */
  position: number;
  /** Stable across edits and copies: what step times and learned ranges hang on. */
  key: string;
  /** Plain words, 1–MAX_RECIPE_STEP characters. */
  text: string;
  phase: StepPhase;
  /** The recipe lines it uses (their positions), as the author attached them; [] for none. */
  lines: number[];
  /** Null when it says no flame. */
  heat: StepHeat | null;
  /**
   * Its time range at the recipe's own size, in seconds ("8–10 min"): both
   * or neither, min ≤ max; equal for one time. Null for an untimed step and
   * for a whistle step. `stepTimeAt` gives it at another size.
   */
  minSeconds: number | null;
  maxSeconds: number | null;
  /** A pressure cooker's whistles (1–MAX_STEP_WHISTLES), instead of seconds; never scaled. */
  whistles: number | null;
  /** The cook can go on to other steps while it runs. */
  handsOff: boolean;
  timeRule: StepTimeRule;
  /** The checkpoint's sense; null when none is said. */
  sense: StepSense | null;
  /** What to watch for ("golden brown"), at most MAX_STEP_CHECKPOINT characters; null for none. */
  checkpoint: string | null;
  /** One line under the step, at most MAX_STEP_TIP characters; null for none. */
  tip: string | null;
  /**
   * What cooks really took (GC-7, design §5), at the size the read asked for
   * (`?f=`, default the recipe as written): present only once the step's key
   * has LEARNED_MIN_SAMPLES times from LEARNED_MIN_COOKS people, across the
   * recipe root and its copies. Absent otherwise — and on every write's
   * answer that has not learned it. Counts and a range only: never who.
   */
  learned?: LearnedStepRange;
}

/**
 * One step as a create or PATCH writes it. A plain string is a step of text
 * only. Everything but `text` is optional, with the defaults a step of text
 * only reads with (cook, no lines, no flame, untimed, not hands off, fixed).
 *
 * Keys are the server's: a new step gets one. On a PATCH, a step that sends
 * the key of one of the recipe's steps keeps it (its fields are replaced by
 * what is sent); an unknown key, or a key sent twice, is a new step. A plain
 * string keeps the key and guided fields of the recipe's step with exactly
 * that text, when there is one — so a client that writes steps as strings
 * (RC-5's form) loses nothing it did not change.
 */
export interface RecipeStepInput {
  key?: string | null;
  text: string;
  /** Default DEFAULT_STEP_PHASE. */
  phase?: StepPhase;
  /** Positions of the recipe's lines (as written in the same request, or as stored when it sends no lines); each once. */
  lines?: number[];
  heat?: StepHeat | null;
  /** 0–MAX_STEP_SECONDS; maxSeconds needs minSeconds, and defaults to it. Not with whistles. */
  minSeconds?: number | null;
  maxSeconds?: number | null;
  /** 1–MAX_STEP_WHISTLES; not with seconds. */
  whistles?: number | null;
  handsOff?: boolean;
  /** Default DEFAULT_STEP_TIME_RULE. */
  timeRule?: StepTimeRule;
  /** Needs a checkpoint. */
  sense?: StepSense | null;
  /** Trimmed; empty is none. */
  checkpoint?: string | null;
  /** Trimmed; empty is none. */
  tip?: string | null;
}

/** A step as a write takes it: its text alone, or every field. */
export type RecipeStepWrite = string | RecipeStepInput;

/** A long prep step (design §1): what the recipe page and the session's prompt show first. */
export interface LongPrepStep {
  position: number;
  key: string;
  /** Its shortest time, at least LONG_PREP_SECONDS. */
  seconds: number;
  text: string;
}

/** Is this step long prep: a hands-off prep step whose shortest time is at least LONG_PREP_SECONDS? */
export function isLongPrep(step: Pick<KitchenRecipeStep, "phase" | "handsOff" | "minSeconds">): boolean {
  return step.phase === "prep" && step.handsOff && step.minSeconds !== null && step.minSeconds >= LONG_PREP_SECONDS;
}

/** A recipe's long prep, in step order. */
export function longPrepOf(steps: readonly KitchenRecipeStep[]): LongPrepStep[] {
  return steps.filter(isLongPrep).map((s) => ({ position: s.position, key: s.key, seconds: s.minSeconds!, text: s.text }));
}

/** A step's time at a size: a range in whole minutes, or its whistles. */
export type StepTimeAt = { minSeconds: number; maxSeconds: number } | { whistles: number };

/** What `stepTimeAt` reads of a step. */
export type StepTiming = Partial<Pick<KitchenRecipeStep, "minSeconds" | "maxSeconds" | "whistles">> & {
  timeRule?: StepTimeRule | null;
};

/** The time multiplier of `rule` at factor `factorMilli` (thousandths): 1, f^0.5 or f. */
export function stepTimeMultiplier(rule: StepTimeRule | null | undefined, factorMilli: number): number {
  const f = Number.isFinite(factorMilli) && factorMilli > 0 ? factorMilli / 1000 : 1;
  if (rule === "linear") return f;
  if (rule === "partly") return Math.sqrt(f);
  return 1;
}

/**
 * A step's time at size `factorMilli` (design §2): its range × 1 (fixed),
 * × f^0.5 (partly) or × f (linear), each end rounded to whole minutes and
 * never under one minute, so min ≤ max still holds. Whistles come back as
 * they are — they never scale. Null for an untimed step.
 */
export function stepTimeAt(step: StepTiming, factorMilli: number): StepTimeAt | null {
  if (step.whistles !== undefined && step.whistles !== null) return { whistles: step.whistles };
  const lo = step.minSeconds ?? step.maxSeconds;
  const hi = step.maxSeconds ?? step.minSeconds;
  if (lo === undefined || lo === null || hi === undefined || hi === null) return null;
  const m = stepTimeMultiplier(step.timeRule, factorMilli);
  const minutes = (seconds: number) => wholeStepMinutes(seconds * m);
  const minSeconds = minutes(Math.min(lo, hi));
  return { minSeconds, maxSeconds: Math.max(minSeconds, minutes(Math.max(lo, hi))) };
}

/** A time as a step shows it: to the nearest whole minute (halves up), never under one minute. */
export function wholeStepMinutes(seconds: number): number {
  return Math.max(60, Math.round(seconds / 60) * 60);
}

// ── Learned ranges (cookpool-guided GC-7, design §5) ───────
//
// Every guided cook keeps each step's real time with the size it was cooked
// at (GC-2's `stepLog`), under the recipe root and the step's key, so the
// root and all its copies share one pool. A read turns a step's pool into
// "usually 7–9 min at this size · 23 cooks":
//   1. drop the times that say nothing: a canceled dish's, a step ticked in
//      under LEARNED_MIN_SECONDS (skipped, not timed), one over
//      LEARNED_ABANDONED_TIMES × the author's longest time at the size it was
//      cooked at (or over LEARNED_UNTIMED_MAX_SECONDS for a step with no
//      time: left open, abandoned), and one whose size is not known;
//   2. normalise each to the recipe as written (f = 1) by the step's rule:
//      seconds ÷ stepTimeMultiplier(rule, f);
//   3. with at least LEARNED_MIN_SAMPLES times from LEARNED_MIN_COOKS people,
//      take the 25th and 75th percentiles (linear interpolation) — not the
//      mean, so one odd cook moves nothing much (risks GC-C);
//   4. scale both back to the size asked for by the same rule, in whole
//      minutes, at least one.
// The storage read does the first step's dish-side drops (canceled, skipped,
// no size) in SQL; `learnedStepTime` applies every rule again, so it is the
// whole definition on its own.

/** A step's time from cooks, at one size. */
export interface LearnedStepRange {
  /** The 25th percentile of cooks' times at this size, in whole minutes (at least 60 s). */
  lowSeconds: number;
  /** The 75th percentile, the same way; never under `lowSeconds`. */
  highSeconds: number;
  /** How many different people the times came from: at least LEARNED_MIN_COOKS. */
  cooks: number;
  /** How many times it was learned from: at least LEARNED_MIN_SAMPLES. */
  samples: number;
}

/** A step is learned from at least this many times… */
export const LEARNED_MIN_SAMPLES = 5;
/** …from at least this many different people. */
export const LEARNED_MIN_COOKS = 3;
/** A step ticked in less than this (seconds) was skipped, not timed. */
export const LEARNED_MIN_SECONDS = 10;
/** A time over this many × the author's longest (at the size cooked) was abandoned: the app left open. */
export const LEARNED_ABANDONED_TIMES = 4;
/** …and for a step with no time written, a time over 4 h was. */
export const LEARNED_UNTIMED_MAX_SECONDS = 4 * 3_600;
/** The range is these percentiles of the times. */
export const LEARNED_LOW_PERCENTILE = 0.25;
export const LEARNED_HIGH_PERCENTILE = 0.75;

/** One time a cook took over a step, as the pool keeps it. */
export interface StepTimeSample {
  /** From the step's start to its tick, in seconds, at the size it was cooked at. */
  seconds: number;
  /** That size, in thousandths; null (or not a positive number) when it is not known — such a time is left out. */
  factorMilli: number | null;
  /** Who cooked it, as any token that tells people apart: counted, never returned. */
  cook: string | number;
}

/** `seconds` at size `factorMilli`, normalised to the recipe as written (f = 1) by the step's rule. */
export function normalizeStepSeconds(seconds: number, rule: StepTimeRule | null | undefined, factorMilli: number): number {
  return seconds / stepTimeMultiplier(rule, factorMilli);
}

/** `seconds` at the recipe as written (f = 1), at size `factorMilli` by the step's rule: `normalizeStepSeconds` undone. */
export function scaleStepSeconds(seconds: number, rule: StepTimeRule | null | undefined, factorMilli: number): number {
  return seconds * stepTimeMultiplier(rule, factorMilli);
}

/**
 * The `p`-th quantile (0–1) of `values`, by linear interpolation between the
 * two nearest ranks (Hyndman–Fan type 7, as spreadsheets and NumPy compute
 * it): rank h = (n − 1) · p, then x[⌊h⌋] + (h − ⌊h⌋) · (x[⌊h⌋ + 1] − x[⌊h⌋]).
 * `values` need not be sorted (a sorted copy is used). NaN for no values or a
 * `p` that is not a number; `p` outside 0–1 is clamped.
 */
export function percentile(values: readonly number[], p: number): number {
  return percentileOfSorted([...values].sort((a, b) => a - b), p);
}

function percentileOfSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0 || Number.isNaN(p)) return Number.NaN;
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const below = Math.floor(h);
  const lo = sorted[below]!;
  const hi = sorted[Math.min(sorted.length - 1, below + 1)]!;
  return lo + (h - below) * (hi - lo);
}

/**
 * The longest a cook can plausibly have taken over `step` at size
 * `factorMilli`: LEARNED_ABANDONED_TIMES × the author's longest time (its
 * max, else its min) at that size; LEARNED_UNTIMED_MAX_SECONDS for a step
 * with no time — or a time of 0 s — written.
 */
export function abandonedAfterSeconds(step: StepTiming, factorMilli: number): number {
  const longest = step.maxSeconds ?? step.minSeconds ?? null;
  if (longest === null || !(longest > 0)) return LEARNED_UNTIMED_MAX_SECONDS;
  return LEARNED_ABANDONED_TIMES * scaleStepSeconds(longest, step.timeRule, factorMilli);
}

/** Does this time count towards `step`'s learned range: its size known, not skipped, not abandoned? */
export function keepsStepTime(step: StepTiming, sample: StepTimeSample): boolean {
  const f = sample.factorMilli;
  if (f === null || !Number.isFinite(f) || f <= 0) return false;
  if (!Number.isFinite(sample.seconds) || sample.seconds < LEARNED_MIN_SECONDS) return false;
  return sample.seconds <= abandonedAfterSeconds(step, f);
}

/**
 * A step's learned range at size `factorMilli` from its pool (see above):
 * null until the times that count number LEARNED_MIN_SAMPLES from
 * LEARNED_MIN_COOKS people.
 */
export function learnedStepTime(step: StepTiming, samples: readonly StepTimeSample[], factorMilli: number): LearnedStepRange | null {
  const normalised: number[] = [];
  const cooks = new Set<string | number>();
  for (const sample of samples) {
    if (!keepsStepTime(step, sample)) continue;
    normalised.push(normalizeStepSeconds(sample.seconds, step.timeRule, sample.factorMilli!));
    cooks.add(sample.cook);
  }
  if (normalised.length < LEARNED_MIN_SAMPLES || cooks.size < LEARNED_MIN_COOKS) return null;
  normalised.sort((a, b) => a - b);
  const at = (p: number) => wholeStepMinutes(scaleStepSeconds(percentileOfSorted(normalised, p), step.timeRule, factorMilli));
  return { lowSeconds: at(LEARNED_LOW_PERCENTILE), highSeconds: at(LEARNED_HIGH_PERCENTILE), cooks: cooks.size, samples: normalised.length };
}

/**
 * One step's start and tick in a guided session, sent with the dish
 * (`CookDishRequest.stepLog`): ISO 8601 times. The server keeps one per step
 * key of the recipe cooked, with the dish's factor and the recipe root.
 */
export interface StepLogEntry {
  key: string;
  startedAt: string;
  doneAt: string;
}

/** A dish's step log holds at most one entry per step. */
export const MAX_STEP_LOG = MAX_RECIPE_STEPS;
/** A logged step longer than this (a day) is ignored, as is one ticked before it started. */
export const MAX_STEP_LOG_SECONDS = MAX_STEP_SECONDS;

/**
 * PATCH /v1/kitchen/me/recipes/{rcp}/step-times — "Use today's times" (design
 * §3.6, §5): its owner (anyone else, and Cookpool's own: the opaque 404).
 * Sets these steps' ranges, written at the recipe's own size (today's time ÷
 * the size rule, done by the client). Each key once, a step of the recipe
 * that counts time, not whistles; only those steps change. 200 `{ recipe,
 * lastCook }`.
 */
export interface UpdateStepTimesRequest {
  /** 1–MAX_RECIPE_STEPS. */
  steps: StepTimesInput[];
}

export interface StepTimesInput {
  key: string;
  /** 0–MAX_STEP_SECONDS, min ≤ max. */
  minSeconds: number;
  maxSeconds: number;
}

/** Where a copy came from: "from Anu". */
export interface RecipeSource {
  /** The recipe it was saved from (`rcp_…`); it may since have been changed or deleted. */
  recipeId: string | null;
  /** Whose that was (`usr_…`). */
  ownerId: string | null;
  /** Their name when it was saved. */
  ownerName: string | null;
}

/** What every recipe read says about one recipe, lines and steps aside. */
export interface RecipeSummary {
  /** `rcp_…` */
  id: string;
  /** `usr_…`; `usr_cookpool` for Cookpool's own. */
  ownerId: string;
  /** The owner's name ("Cookpool" for its own); null when there is none to show. */
  ownerName: string | null;
  name: string;
  /** Serves × 2. */
  servesHalf: number;
  /** servesHalf / 2. */
  serves: number;
  minutes: number | null;
  kind: RecipeKind | null;
  visibility: RecipeVisibility;
  /** Cookpool's own: everyone sees it, nobody edits it. */
  isSystem: boolean;
  /** The caller owns it (they may edit, delete and share it). */
  mine: boolean;
  /** For a copy, where it came from; null otherwise. */
  source: RecipeSource | null;
  /** How many copies of it people have saved ("saved by N"). */
  savedBy: number;
  lineCount: number;
  /** The main line (what scales it), as on `KitchenRecipeLine`. */
  main: Pick<KitchenRecipeLine, "position" | "foodKey" | "name" | "qtyMilli" | "quantity" | "unit"> | null;
  /** When the caller last cooked it (a dish with this recipe, not canceled); null if never. */
  lastCookedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One recipe in full. */
export interface KitchenRecipe extends RecipeSummary {
  lines: KitchenRecipeLine[];
  /** Up to MAX_RECIPE_STEPS short texts, in order: each step's `text` (`guidedSteps` has the rest). */
  steps: string[];
  /** The link code (`/r/<code>`) while visibility is link — only for its owner; null for anyone else. */
  linkCode: string | null;
  /**
   * The same steps in full (GC-2): key, phase, lines, flame, time, whistles,
   * hands off, rule, checkpoint and tip; `guidedSteps[i].text` is `steps[i]`.
   * Optional in the type, as `tools` and `longPrep` are, so recipes typed
   * before GC-2 still check; the server always sends all three.
   */
  guidedSteps?: KitchenRecipeStep[];
  /** Up to MAX_RECIPE_TOOLS names, in order; [] for none. */
  tools?: string[];
  /** Its long prep (`isLongPrep`), in step order; [] for none. */
  longPrep?: LongPrepStep[];
}

/** One ingredient of the caller's last dish of a recipe, for the line it was for. */
export interface RecipeLastCookLine {
  /** The line's position. */
  recipeLine: number;
  /** The item it was taken from (`itm_…`) and that item's name now. */
  itemId: string;
  name: string;
  /** How much, in the item's base unit, and in `unit` (the unit it was entered in). */
  qtyMilli: number;
  quantity: number;
  unit: string;
  /** The words it was given in ("2 onions", SM-13); null for a unit. */
  label: string | null;
}

/** The caller's last dish cooked from a recipe (not canceled): "last time". */
export interface RecipeLastCook {
  /** `dsh_…` */
  dishId: string;
  cookedAt: string;
  /** The factor it was cooked at; null when the dish did not say. */
  recipeFactorMilli: number | null;
  portionsHalf: number;
  /** Its ingredients that named a line, in the cook's order. */
  lines: RecipeLastCookLine[];
}

/**
 * 200 from GET /v1/kitchen/recipes/{rcp} and GET /v1/kitchen/recipe-links/{code};
 * 201 from POST /v1/kitchen/me/recipes and …/copies; 200 from PATCH, DELETE and
 * both …/link routes (and from PATCH …/step-times). Each guided step carries
 * `learned` once cooks have taught it (GC-7): at `?f=` on the two reads, and
 * at the recipe as written on every other answer.
 */
export interface RecipeResponse {
  recipe: KitchenRecipe;
  /** The caller's last dish of it; null if they never cooked it. */
  lastCook: RecipeLastCook | null;
}

/**
 * GET /v1/kitchen/recipes/{rcp}?code=&f= and GET /v1/kitchen/recipe-links/{code}?f=
 * (GC-7). `f` is the size the steps' `learned` ranges are at, in thousandths
 * — the match's bounds, RECIPE_MIN_FACTOR_MILLI–RECIPE_MAX_FACTOR_MILLI, a
 * whole number (422 `f` otherwise) — default 1000, the recipe as written. It
 * changes nothing else in the read: lines and steps are as written.
 */
export interface RecipeQuery {
  /** Lets a link holder in (by id only). */
  code?: string;
  f?: number;
}

/**
 * POST /v1/kitchen/me/recipes — write a recipe. Visibility defaults to
 * DEFAULT_RECIPE_VISIBILITY; `link` mints a code. 1–MAX_RECIPE_LINES lines,
 * exactly one main (never to taste), 0–MAX_RECIPE_STEPS steps.
 */
export interface CreateRecipeRequest {
  name: string;
  /** Serves × 2, 1–MAX_RECIPE_SERVES_HALF. */
  servesHalf: number;
  minutes?: number | null;
  kind?: RecipeKind | null;
  visibility?: RecipeVisibility;
  lines: RecipeLineInput[];
  /** 0–MAX_RECIPE_STEPS: each its text alone, or a guided step (GC-2). */
  steps?: RecipeStepWrite[];
  /** 0–MAX_RECIPE_TOOLS names of 1–MAX_RECIPE_TOOL characters, each once (GC-2). */
  tools?: string[];
}

/**
 * POST /v1/kitchen/me/recipes with `fromDishId` — save a dish the caller can
 * read (their own, or one shared with their group; not canceled) as a recipe:
 * every ingredient becomes a line at the amount used, linked to its item's
 * food; serves is the dish's portions; the heaviest ingredient is the main
 * line. `name` defaults to the dish's.
 */
export interface SaveDishAsRecipeRequest {
  /** `dsh_…` */
  fromDishId: string;
  name?: string;
  minutes?: number | null;
  kind?: RecipeKind | null;
  visibility?: RecipeVisibility;
  /** As on CreateRecipeRequest; a step's `lines` point at the dish's ingredients, in order. */
  steps?: RecipeStepWrite[];
  tools?: string[];
}

export type CreateRecipeBody = CreateRecipeRequest | SaveDishAsRecipeRequest;

/**
 * PATCH /v1/kitchen/me/recipes/{rcp} — its owner (anyone else, and
 * Cookpool's own: the opaque 404). At least one field; `lines` and `steps`
 * replace the whole list. Copies of it never change. Setting visibility to
 * `link` mints a code when it has none; anything else turns the link off.
 */
export interface UpdateRecipeRequest {
  name?: string;
  servesHalf?: number;
  minutes?: number | null;
  kind?: RecipeKind | null;
  visibility?: RecipeVisibility;
  lines?: RecipeLineInput[];
  /**
   * Replaces every step (see RecipeStepInput for how keys are kept). Lines
   * sent without steps keep the steps; a step's lines that are past the new
   * last line are dropped from it.
   */
  steps?: RecipeStepWrite[];
  tools?: string[];
}

/**
 * POST /v1/kitchen/me/recipes/copies — save your own copy of a recipe you may
 * see (by id), or of the one a link opens (by code): owned by you, Only me,
 * with the same lines, steps (their keys too: GC-2) and tools, and where it
 * came from. 201 `{ recipe }`.
 */
export type CopyRecipeRequest =
  | { recipeId: string; linkCode?: undefined }
  | { linkCode: string; recipeId?: undefined };

/** GET /v1/kitchen/me/recipes: the caller's recipes and copies, last cooked first, then newest. */
export interface MyRecipesResponse {
  recipes: RecipeSummary[];
}

/**
 * GET /v1/kitchen/people/{usr}/recipes — someone the caller shares a group
 * with now (the opaque 404 otherwise, and for the caller themselves): their
 * recipes at My groups or Anyone with the link, newest first.
 */
export interface PersonRecipesResponse {
  subjectId: string;
  displayName: string | null;
  recipes: RecipeSummary[];
}

// ── What you have: the match (design §3.3) ──────────────────

/**
 * have: enough, from one or more items; short: some, not enough; missing:
 * none; always: the line is to taste, or its food is on the caller's Always
 * have list.
 */
export const RECIPE_LINE_STATUSES = ["have", "short", "missing", "always"] as const;
export type RecipeLineStatus = (typeof RECIPE_LINE_STATUSES)[number];

/** An item a line would take from, and how much. */
export interface RecipeMatchItem {
  /** `itm_…` */
  itemId: string;
  /** The item page's ref: `me:itm_…` for the caller's own, `org:org_…:itm_…` for a group's. */
  ref: string;
  /** The group whose pantry it is in (`org_…`); null for the caller's own. */
  orgId: string | null;
  pantry: PantryRef;
  name: string;
  /** What is left of it, in its own base unit. */
  qtyLeftMilli: number;
  /** What the line would take from it, in the item's base unit (its `displayUnit`'s dimension). */
  takeMilli: number;
  /** The item's unit. */
  unit: string;
  expiresOn: string | null;
}

/** One line of the recipe, matched at the factor asked for. */
export interface RecipeLineMatch {
  position: number;
  status: RecipeLineStatus;
  /** What the line needs at this factor, rounded by its unit (`scaleLine`), in the line's base unit; null to taste. */
  needMilli: number | null;
  /** The same in the line's unit; null to taste. */
  needQuantity: number | null;
  unit: string | null;
  /** What the caller's pantries hold of its food, in the line's base unit (≈ when counts meet weights, or volumes meet weights through the food's density). */
  availableMilli: number;
  /**
   * The items it would take from — soonest use-by first, then the caller's
   * own pantry, then the most left — until the need is met.
   */
  items: RecipeMatchItem[];
}

/** A match in a few numbers: Explore's rows, Cook now's cards. */
export interface RecipeMatchSummary {
  lines: number;
  have: number;
  short: number;
  missing: number;
  always: number;
  /** Up to COOK_NOW_MISSING_NAMES of the missing lines' words, in order ("Missing yogurt"). */
  missingNames: string[];
  /**
   * The largest factor the stock allows: the smallest available ÷ written
   * over the lines that are not "always", at most RECIPE_MAX_FACTOR_MILLI
   * (and that when no line limits it); null when anything is missing.
   */
  maxFactorMilli: number | null;
}

/** An item the caller can use that links to no food: what the "Is Kanda onion?" ask offers. */
export interface UnlinkedItem {
  itemId: string;
  /** The group whose pantry it is in (`org_…`); null for the caller's own. */
  orgId: string | null;
  name: string;
  /** Its name as an answer keys it (`foodNameKey`). */
  nameKey: string;
}

/**
 * GET /v1/kitchen/me/recipes/{rcp}/match?f=&code= — who may see the recipe
 * (`code` lets a link holder in). `f` is the factor in thousandths (default
 * 1000; RECIPE_MIN_FACTOR_MILLI–RECIPE_MAX_FACTOR_MILLI). Every active item
 * with something left that the caller may use — their own pantry and each
 * group where they hold `kitchen.item.use` — counts when it links to the
 * line's food. A read: it reserves nothing.
 */
export interface RecipeMatchQuery {
  f?: number;
  code?: string;
}

export interface RecipeMatchResponse {
  /** `rcp_…` */
  recipeId: string;
  factorMilli: number;
  /** The portions at this factor. */
  portions: ScaledPortions;
  lines: RecipeLineMatch[];
  summary: RecipeMatchSummary;
  /** Up to 20 of the caller's usable items whose names link to no food and were never answered. */
  unlinked: UnlinkedItem[];
}

// ── Explore (design §5.3) and Cook now (§5.4) ───────────────

export const EXPLORE_SOURCES = ["cookpool", "groups"] as const;
export type ExploreSource = (typeof EXPLORE_SOURCES)[number];

/**
 * GET /v1/kitchen/recipes?source=&q=&kind= — any signed-in person. cookpool
 * (the default): Cookpool's own; groups: everyone else's recipes the caller
 * sees through their groups now (My groups or Anyone with the link). Newest
 * first, at most 50; `q` matches the name (case-insensitively), `kind` the chip.
 */
export interface ExploreRecipesQuery {
  source?: ExploreSource;
  q?: string;
  kind?: RecipeKind;
}

/** One Explore row: the recipe and its match at its own size ("✓ You have everything", "Missing yogurt"). */
export interface ExploreRecipe extends RecipeSummary {
  match: RecipeMatchSummary;
}

export interface ExploreRecipesResponse {
  recipes: ExploreRecipe[];
}

/** Cook now returns at most this many. */
export const COOK_NOW_LIMIT = 20;
/** …each naming at most this many missing lines. */
export const COOK_NOW_MISSING_NAMES = 3;

/** One recipe Cook now suggests. */
export interface CookNowEntry {
  recipe: RecipeSummary;
  match: RecipeMatchSummary;
  /**
   * "For N": serves × maxFactor, in half portions rounded down (at least ½),
   * capped at serves × 2; null when something is missing.
   */
  forPortionsHalf: number | null;
}

/**
 * GET /v1/kitchen/me/cook-now — every recipe the caller can see (theirs and
 * their copies, Cookpool's, their groups'), fewest missing first, then the
 * largest maxFactorMilli, then the most recently cooked; the first
 * COOK_NOW_LIMIT.
 */
export interface CookNowResponse {
  recipes: CookNowEntry[];
}

// ── Scaling (design §3.2) ───────────────────────────────────
//
// A recipe scales by a factor f in thousandths: every line is written × f,
// rounded by its unit, so the screen and the server round the same way.
// To-taste lines never scale.

/** round(n / d), halves up, for non-negative integers. */
function roundDiv(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/**
 * The grid a line's scaled amount is rounded to, in thousandths of its base
 * unit, for an exact amount of `raw` thousandths × 1000:
 *   pcs, a count word, tsp, tbsp, cup: ½ of the unit;
 *   g and ml: 5 below 100, 10 below 1000, then 50;
 *   kg and L: 0.01 of the unit.
 */
function stepMilli(unit: string, raw: bigint): bigint {
  switch (unit) {
    case "g":
    case "ml": {
      const grams = raw / 1_000_000n;
      if (grams < 100n) return 5_000n;
      if (grams < 1000n) return 10_000n;
      return 50_000n;
    }
    case "kg":
    case "L":
      return 10_000n;
    default:
      // pcs, tsp, tbsp, cup and count words: half of one.
      return BigInt(recipeUnitOf(unit).factor) * 500n;
  }
}

/**
 * A line's amount at factor `factorMilli`: `qtyMilli` (thousandths of the
 * unit's base) × f, rounded to its unit's grid — never below one step of it.
 * Null in, null out: a to-taste line never scales.
 */
export function scaleLine(qtyMilli: number | null, unit: string | null, factorMilli: number): number | null {
  if (qtyMilli === null || unit === null) return null;
  const raw = BigInt(Math.round(qtyMilli)) * BigInt(Math.round(factorMilli));
  const step = stepMilli(unit, raw);
  let steps = roundDiv(raw, step * 1000n);
  if (steps < 1n) steps = 1n;
  return Number(steps * step);
}

/** Portions at a factor: half portions, and whether that is "about". */
export interface ScaledPortions {
  /** Serves × f, in half portions: exact when `about` is false, else to the nearest half (at least ½). */
  portionsHalf: number;
  /** True when serves × f is not a whole or half number. */
  about: boolean;
  /** "2", "2½", "about 2". */
  label: string;
}

/** "½", "1", "1½", "2": a count in halves. */
function halvesLabel(halves: number): string {
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1 ? "½" : "";
  return whole === 0 ? half : `${whole}${half}`;
}

/** What a recipe serving `servesHalf` half portions serves at factor `factorMilli`. */
export function scalePortions(servesHalf: number, factorMilli: number): ScaledPortions {
  const raw = BigInt(Math.round(servesHalf)) * BigInt(Math.round(factorMilli));
  const exact = raw % 1000n === 0n && raw > 0n;
  let halves = exact ? raw / 1000n : roundDiv(raw, 1000n);
  if (halves < 1n) halves = 1n;
  const portionsHalf = Number(halves);
  const about = !exact;
  return { portionsHalf, about, label: `${about ? "about " : ""}${halvesLabel(portionsHalf)}` };
}

/** Setting the main line to `qtyMilli` sets f = new ÷ written (thousandths, to the nearest). */
export function factorForMain(writtenMilli: number, qtyMilli: number): number {
  return Number(roundDiv(BigInt(Math.round(qtyMilli)) * 1000n, BigInt(Math.round(writtenMilli))));
}

/** Setting the portions sets f = portions ÷ serves (thousandths, to the nearest). */
export function factorForPortions(servesHalf: number, portionsHalf: number): number {
  return Number(roundDiv(BigInt(Math.round(portionsHalf)) * 1000n, BigInt(Math.round(servesHalf))));
}
