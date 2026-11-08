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
//   GET    /v1/kitchen/recipes/{rcp}?code=             who may see it, with the caller's last cook
//   PATCH  /v1/kitchen/me/recipes/{rcp}                its owner
//   DELETE /v1/kitchen/me/recipes/{rcp}                its owner (soft; copies stay)
//   GET    /v1/kitchen/me/recipes/{rcp}/match?f=&code= who may see it: what the caller's pantries have
//   POST   /v1/kitchen/me/recipes/{rcp}/link           its owner: mint or rotate the link
//   DELETE /v1/kitchen/me/recipes/{rcp}/link           its owner: turn the link off
//   GET    /v1/kitchen/recipe-links/{code}             signed in
//   POST   /v1/kitchen/me/recipes/copies               who may see it: save your own copy
//   GET    /v1/kitchen/people/{usr}/recipes            someone you share a group with
//   GET    /v1/kitchen/recipes?source=&q=&kind=        signed in: Explore
//   GET    /v1/kitchen/me/cook-now                     self
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
  /** Up to MAX_RECIPE_STEPS short texts, in order. */
  steps: string[];
  /** The link code (`/r/<code>`) while visibility is link — only for its owner; null for anyone else. */
  linkCode: string | null;
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
 * both …/link routes.
 */
export interface RecipeResponse {
  recipe: KitchenRecipe;
  /** The caller's last dish of it; null if they never cooked it. */
  lastCook: RecipeLastCook | null;
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
  steps?: string[];
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
  steps?: string[];
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
  steps?: string[];
}

/**
 * POST /v1/kitchen/me/recipes/copies — save your own copy of a recipe you may
 * see (by id), or of the one a link opens (by code): owned by you, Only me,
 * with the same lines and steps and where it came from. 201 `{ recipe }`.
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
  /** What the caller's pantries hold of its food, in the line's base unit (≈ when counts meet weights). */
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
