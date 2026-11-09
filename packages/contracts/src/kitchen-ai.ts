// Cookpool AI in the contract (cookpool-ai AI-2, design §1, §2): the AI status
// read, "say what you used", the daily limits and the refusal reasons.
//
// Routes (the caller's own, /v1/kitchen/me/ai…):
//   GET  /v1/kitchen/me/ai        → AiStatus
//        Always answers (no key needed): `available` says whether the server
//        has an Anthropic key; `today` counts the caller's UTC day.
//   POST /v1/kitchen/me/ai/uses   { text } → AiUsesResponse
//        One sentence, typed or transcribed, read into proposed uses of the
//        caller's usable items. Nothing is written: the console logs the
//        confirmed lines through the existing use routes, with one Undo.
//
// Every AI route that calls a model answers:
//   503 `internal_error`, details.reason `ai_unavailable` — no key on the server
//   503 `internal_error`, details.reason `budget` — this month's AI budget is
//                         spent, across everyone (AI-13)
//   429 `rate_limited`,   details.reason `ai_daily_limit` — 50 actions today
//                         (`voice_daily_limit` for transcription: 30 minutes;
//                         `receipt_daily_limit`: 10 receipts, AI-13);
//                         details { limit, used, resetsAt }
//   502 `internal_error`, details.reason `ai_failed` — the model refused, erred,
//                         or its answer failed the checks twice; never shown
//                         as an answer
//
// What is sent to the model (design §1, risks AI-C): item names, amounts and
// units, the item's measures, and the sentence. Never money, balances, group
// or org names, or full names. People are "person 1…n" with only their first
// name — the one exception, needed to read "Anu and I" (design §2).

import type { PantryRef } from "./kitchen.js";
import type { RecipeKind, StepHeat, StepPhase, StepSense, StepTimeRule } from "./kitchen-recipes.js";

/** Pinned codes stay pinned: AI refusals ride on them with one of these as `details.reason`. */
export const KITCHEN_AI_ERROR_REASONS = {
  /** 503 `internal_error`: the server has no Anthropic key (or no transcription binding). */
  AI_UNAVAILABLE: "ai_unavailable",
  /** 502 `internal_error`: the model refused or failed, or its answer failed the checks on both models. */
  AI_FAILED: "ai_failed",
  /** 429 `rate_limited`: the caller used today's AI actions (`details.limit`, `details.used`, `details.resetsAt`). */
  AI_DAILY_LIMIT: "ai_daily_limit",
  /** 429 `rate_limited`: the caller used today's voice minutes (in seconds, as above). */
  VOICE_DAILY_LIMIT: "voice_daily_limit",
  /** 429 `rate_limited`: the caller read today's receipts (AI_DAILY_RECEIPTS; `details.limit`, `used`, `resetsAt`) (AI-13). */
  RECEIPT_DAILY_LIMIT: "receipt_daily_limit",
  /** 503 `internal_error`: this month's AI budget is spent (AI_MONTHLY_BUDGET_USD); AI is off until the 1st, UTC (AI-13). */
  BUDGET: "budget",
} as const;
export type KitchenAiErrorReason = (typeof KITCHEN_AI_ERROR_REASONS)[keyof typeof KITCHEN_AI_ERROR_REASONS];

/** AI actions (text and image features) per person per UTC day. */
export const AI_DAILY_ACTIONS = 50;
/** Voice seconds transcribed per person per UTC day: 30 minutes. */
export const AI_DAILY_VOICE_SECONDS = 30 * 60;
/** Receipts read per person per UTC day (AI-13), on top of — and counted in — AI_DAILY_ACTIONS. */
export const AI_DAILY_RECEIPTS = 10;

// ── Cost (AI-13) ────────────────────────────────────────────
//
// What one model call costs, in USD per million tokens, by model. `input` is
// the uncached input (cache writes are priced as input; images are input
// tokens, as the API's `usage` reports them), `cacheRead` the input read from
// the prompt cache. kitchen_ai_usage.cost_micros holds each action's estimate
// in micro-dollars (USD × 1 000 000): tokens × price per Mtok.

export interface AiPrice {
  input: number;
  output: number;
  cacheRead: number;
}

export const AI_PRICES_PER_MTOK = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
} as const satisfies Record<string, AiPrice>;
export type AiPricedModel = keyof typeof AI_PRICES_PER_MTOK;

/**
 * One call's estimated cost in micro-dollars (unrounded). A model missing
 * from the table is priced as the dearest one, never as free.
 */
export function aiCallCostMicros(model: string, tokens: { input: number; cacheRead: number; output: number }): number {
  const prices: Record<string, AiPrice> = AI_PRICES_PER_MTOK;
  const price = prices[model] ?? AI_PRICES_PER_MTOK["claude-sonnet-5-5"];
  return tokens.input * price.input + tokens.cacheRead * price.cacheRead + tokens.output * price.output;
}

/** The monthly budget when AI_MONTHLY_BUDGET_USD is unset or not a number ≥ 0, in USD (AI-13). */
export const AI_MONTHLY_BUDGET_USD_DEFAULT = 5;

/** The longest sentence POST /me/ai/uses reads, in characters (after trimming). */
export const AI_USES_TEXT_MAX = 300;

/** The features, as the status read and the console's switches name them. */
export const AI_FEATURE_KEYS = ["sayIt", "receipt", "import", "voice", "swaps"] as const;
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];

/**
 * GET /v1/kitchen/me/ai. `features` says which features this server offers
 * now (each is false while AI is unavailable, and until its task ships); the
 * switches themselves are device preferences in the console. `today` counts
 * the caller's UTC day, whether or not AI is available.
 */
export interface AiStatus {
  /** False without a key, and while this month's budget is reached (AI-13). */
  available: boolean;
  features: Record<AiFeatureKey, boolean>;
  /**
   * This month's AI budget, across everyone (AI-13): `reached` turns AI off
   * until the 1st, UTC. Always sent since AI-13; optional in the type so
   * payloads built before it still type-check.
   */
  budget?: "ok" | "reached";
  today: {
    actions: number;
    actionsLimit: number;
    voiceSeconds: number;
    voiceSecondsLimit: number;
    /** Receipts read today, and the cap (AI-13; always sent since, optional as `budget` is). */
    receipts?: number;
    receiptsLimit?: number;
  };
}

// ── Say what you used (design §2) ───────────────────────────

/** POST /v1/kitchen/me/ai/uses. `text`: 1–AI_USES_TEXT_MAX characters after trimming. */
export interface AiUsesRequest {
  text: string;
}

/**
 * What the worker changed about a line the model read, for the console to
 * mark it:
 *   the_rest        more was said than is left: the line takes what is left
 *                   (`quantity` in the item's unit)
 *   people_removed  someone named cannot share this item (not in its group,
 *                   or it is the caller's own pantry): they were left out
 */
export const AI_USE_FLAGS = ["the_rest", "people_removed"] as const;
export type AiUseFlag = (typeof AI_USE_FLAGS)[number];

/** The item a proposal uses: the console's item ref. */
export type AiItemRef = { kind: "personal"; itemId: string } | { kind: "group"; orgId: string; itemId: string };

/**
 * One proposed use, ready for the use routes: POST /v1/kitchen/me/items/{itm}/uses
 * for a personal item ({ quantity, unit | measure }), POST
 * /v1/organizations/{org}/kitchen/items/{itm}/uses for a group item
 * ({ quantity, unit | measure, consumers }). Exactly one of `unit` and
 * `measure` is set; a measure's quantity is a count in halves.
 */
export interface AiUseProposal {
  itemRef: AiItemRef;
  name: string;
  pantry: PantryRef;
  quantity: number;
  unit?: string;
  measure?: string;
  /** Who had it (`usr_…`), the caller first when they had some. A personal item's is always just the caller. */
  consumers: string[];
  /** The amount as words: "2 glasses", "250 ml". */
  label: string;
  flags: AiUseFlag[];
}

/**
 * The lines read, in the order said, and the words that matched nothing (a
 * name that is nobody's, an item the caller has none of), as said.
 */
export interface AiUsesResponse {
  lines: AiUseProposal[];
  unsure: string[];
}

// ── Receipts (AI-3, design §3) ──────────────────────────────
//
//   POST /v1/kitchen/me/ai/receipt   { image } → AiReceiptResponse
//
// One photo of a shop receipt read into lines, each matched to the caller's
// own history and the food list on the server — before any model match — and
// marked `sure` or `check`. Nothing is written and the image is never stored
// or logged: the console opens the shopping run (PN-6) prefilled, and adds
// with POST /v1/kitchen/me/purchases as today. Counts one AI action.

/** The largest receipt photo, decoded: 1.5 MB. The console shrinks it to 1200 px on the long side first. */
export const AI_RECEIPT_MAX_BYTES = 1_572_864;
/** The photo types a receipt may be. */
export const AI_RECEIPT_IMAGE_TYPES = ["image/jpeg", "image/webp"] as const;
export type AiReceiptImageType = (typeof AI_RECEIPT_IMAGE_TYPES)[number];
/** The most lines one receipt returns. */
export const AI_RECEIPT_MAX_LINES = 60;

/**
 * POST /v1/kitchen/me/ai/receipt. `image`: the photo's bytes in base64, a
 * JPEG or WebP of at most AI_RECEIPT_MAX_BYTES decoded (a `data:image/…;base64,`
 * prefix is accepted). The type is read from the bytes, not from the prefix.
 * A bad image is 422 `validation_failed` with field errors on `image`.
 */
export interface AiReceiptRequest {
  image: string;
}

/** Why a line is `check`: `not_food`, `unclear`, or a few words ("not sure what MLK PNR is"). */
export const AI_RECEIPT_NOT_FOOD = "not_food";
/**
 * Why a line is `check` when the read as a whole failed its checks and was
 * not retried (AI-13, AI_ESCALATE off): the lines that passed on their own
 * are returned, every food line `check` with this reason.
 */
export const AI_RECEIPT_UNCLEAR = "unclear";

/**
 * One line of the receipt.
 *
 * - `text`: the line as printed.
 * - `name`: the plain item name — as the caller last bought it when matched
 *   to their history, else as read ("Paneer" for "MLK PNR").
 * - `foodId`: the food-list key (`paneer`) when the name is a food.
 * - `quantity` in `unit` (a unit key: pcs, kg, g, L, ml, pack…): what was
 *   bought on the line, multipliers applied ("2 X 500G" → 1000 g).
 * - `priceMinor`: the line's charged total in minor units (the selling price,
 *   never the MRP).
 * - `pantry`, `fromItemId`: where to add it — the pantry the name was last
 *   bought into (and that purchase, for "like last time"), else the caller's
 *   most-used pantry for the food's kind. Always a pantry the caller can add
 *   to. Not set on non-food lines.
 * - `confidence`: `sure` only when the name and the kind of unit match the
 *   caller's history (or, with no history, exactly a food) and the price is
 *   plausible (within ±50% of last time's, for the same amount). Else `check`
 *   with a `reason`; non-food lines are `check` with reason `not_food`.
 */
export interface AiReceiptLine {
  text: string;
  name?: string;
  foodId?: string;
  quantity?: number;
  unit?: string;
  priceMinor?: number;
  pantry?: PantryRef;
  fromItemId?: string;
  confidence: "sure" | "check";
  reason?: string;
}

/**
 * The receipt read. `store` and `total` when printed; `currency` is the
 * chosen pantries' (the most lines'; INR when none); `sumMinor` is the sum of
 * the food lines' prices; `totalMatches` says whether every line plus the
 * receipt's own adjustments (an added tax, a discount, round-off) comes to
 * `total` — false when it does not, or when no total was printed.
 */
export interface AiReceiptResponse {
  store?: string;
  total?: number;
  currency: string;
  sumMinor: number;
  totalMatches: boolean;
  lines: AiReceiptLine[];
}

// ── Recipe from a photo (AI-4, design §4) ───────────────────
//
//   POST /v1/kitchen/me/ai/recipe-photo   { image } → AiRecipePhotoResponse
//
// One photo — a cookbook page, a handwritten card, a screenshot — read into a
// recipe draft in the create route's own shape (CreateRecipeRequest with
// GC-2's guided steps), lines matched to the food list on the server, and the
// places to look at again as `checks`. The owner's scope: a photo only, no
// links or pasted text. Nothing is saved and the image is never stored or
// logged: the console opens the recipe form prefilled, the checks marked, and
// Save is POST /v1/kitchen/me/recipes as today. Counts one AI action.

/** The largest recipe photo, decoded: 1.5 MB, as a receipt's. The console resizes it to 1600 px on the long side first. */
export const AI_RECIPE_PHOTO_MAX_BYTES = AI_RECEIPT_MAX_BYTES;
/** The most lines a draft keeps; more are dropped, with a check. */
export const AI_RECIPE_PHOTO_MAX_LINES = 30;
/** The most steps a draft keeps (MAX_RECIPE_STEPS); more are dropped, with a check. */
export const AI_RECIPE_PHOTO_MAX_STEPS = 20;
/** Serves × 2 when the photo says nothing: serves 2, with a check. */
export const AI_RECIPE_PHOTO_DEFAULT_SERVES_HALF = 4;

/**
 * POST /v1/kitchen/me/ai/recipe-photo. `image` as AiReceiptRequest's: base64
 * JPEG or WebP, ≤ AI_RECIPE_PHOTO_MAX_BYTES decoded, the type read from the
 * bytes. A bad image is 422 `validation_failed` with field errors on `image`.
 */
export interface AiRecipePhotoRequest {
  image: string;
}

/**
 * One line of the draft: RecipeLineInput with every field set. `foodKey` is
 * the food-list key when the ingredient is a food; `name` carries any note
 * ("Onions, finely sliced"). `quantity` (a decimal in `unit`) and `unit` are
 * null on a to-taste line — and on a line whose amount could not be read,
 * which carries a check and must be filled before Save. Exactly one line is
 * main when any line has an amount (the create route's rule: the first by
 * weight, else the first with an amount).
 */
export interface AiRecipeDraftLine {
  foodKey: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  toTaste: boolean;
  isMain: boolean;
}

/** One step of the draft: RecipeStepInput (GC-2) with every field but `key` set. `lines` are positions in the draft's lines. */
export interface AiRecipeDraftStep {
  text: string;
  phase: StepPhase;
  lines: number[];
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

/**
 * The draft: a CreateRecipeRequest without `visibility` (the form's default
 * applies). `name` is "" when the photo shows none (with a check);
 * `servesHalf` is AI_RECIPE_PHOTO_DEFAULT_SERVES_HALF when it says nothing.
 */
export interface AiRecipeDraft {
  name: string;
  servesHalf: number;
  minutes: number | null;
  kind: RecipeKind | null;
  lines: AiRecipeDraftLine[];
  steps: AiRecipeDraftStep[];
  tools: string[];
}

/**
 * Something to look at again before Save. `path` is the draft field as the
 * create route names its field errors ("name", "servesHalf",
 * "lines[2].quantity", "steps[3].heat", "steps[0].lines"; "lines" or "steps"
 * for the list); `message` is a few words for the form.
 */
export interface AiRecipeCheck {
  path: string;
  message: string;
}

export interface AiRecipePhotoResponse {
  draft: AiRecipeDraft;
  checks: AiRecipeCheck[];
}
