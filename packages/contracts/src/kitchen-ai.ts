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
//   429 `rate_limited`,   details.reason `ai_daily_limit` — 50 actions today
//                         (`voice_daily_limit` for transcription: 30 minutes);
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
} as const;
export type KitchenAiErrorReason = (typeof KITCHEN_AI_ERROR_REASONS)[keyof typeof KITCHEN_AI_ERROR_REASONS];

/** AI actions (text and image features) per person per UTC day. */
export const AI_DAILY_ACTIONS = 50;
/** Voice seconds transcribed per person per UTC day: 30 minutes. */
export const AI_DAILY_VOICE_SECONDS = 30 * 60;

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
  available: boolean;
  features: Record<AiFeatureKey, boolean>;
  today: {
    actions: number;
    actionsLimit: number;
    voiceSeconds: number;
    voiceSecondsLimit: number;
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
