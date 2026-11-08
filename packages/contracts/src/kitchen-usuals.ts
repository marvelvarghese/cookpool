// Usuals by time of day and by food, and the suggestion each row makes
// (Cookpool, epic cookpool-pantry: PN-2, design §2.1–§2.3).
//
//   GET /v1/kitchen/me/usuals?tzOffset=&limit=   self: what the caller often uses
//
// `tzOffset` is the caller's offset in minutes east of UTC (TZ_OFFSET_MIN …
// TZ_OFFSET_MAX, default 0); the console sends `-new Date().getTimezoneOffset()`.
// It decides the current bucket — morning 05:00–10:59, midday 11:00–15:59,
// evening 16:00–20:59, night 21:00–04:59, in local time — and in which bucket
// each past use fell.
//
// A usual is kept per food, not per item: the caller's uses (logged by them
// or naming them as a consumer, not reversed) of any item with the same name
// key (`lower(trim(name))`, as measures use) and dimension in the same
// pantry. A new pack of milk therefore inherits the old one's usual. Every
// usual carries:
//   - the last-use fields (`lastQtyMilli`, `lastLabel`, `consumers`, …) as
//     before, over USUALS_DAYS: the item's own last use, else its food's;
//   - `now`: the most frequent amount in the current bucket over the last
//     USUALS_NOW_DAYS, once there are USUAL_NOW_MIN_USES uses of the food in
//     it (ties go to the most recent);
//   - `strip`: USUAL_STRIP_MIN_USES uses in the bucket — the Now strip offers it.
//
// `suggestUse` and `isRunningLow` are pure: the console and the tests share
// them. The ladder `suggestUse` steps through is the caller's — the console
// passes its `useTiles(item)` (each tile's `amount.qtyMilli`; the rest tile
// is skipped), anyone else a list of amounts — so nothing here knows tiles.
//
// This module imports `kitchen.ts`, which imports only its types back, so
// there is no cycle at run time. It is `@saas/contracts/kitchen-usuals`.

import { USE_SOON_DAYS, type KitchenItem, type KitchenUsual } from "./kitchen.js";

// ── Buckets (design §2.1) ───────────────────────────────────

/** The parts of the day a usual is kept for, in local time. */
export const USUAL_BUCKETS = ["morning", "midday", "evening", "night"] as const;
export type UsualBucket = (typeof USUAL_BUCKETS)[number];

/** How a bucket reads: "Morning usual", "NOW · MORNING". */
export const USUAL_BUCKET_LABELS: Readonly<Record<UsualBucket, string>> = {
  morning: "Morning",
  midday: "Midday",
  evening: "Evening",
  night: "Night",
};

/** The bucket a local hour (0–23) falls in: morning 5–10, midday 11–15, evening 16–20, night 21–4. */
export function usualBucketOfHour(hour: number): UsualBucket {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h <= 10) return "morning";
  if (h >= 11 && h <= 15) return "midday";
  if (h >= 16 && h <= 20) return "evening";
  return "night";
}

function hoursOf(bucket: UsualBucket): number[] {
  return Array.from({ length: 24 }, (_, h) => h).filter((h) => usualBucketOfHour(h) === bucket);
}

/** Every local hour of each bucket, 0–23: what the server matches past uses against. */
export const USUAL_BUCKET_HOURS: Readonly<Record<UsualBucket, readonly number[]>> = {
  morning: hoursOf("morning"),
  midday: hoursOf("midday"),
  evening: hoursOf("evening"),
  night: hoursOf("night"),
};

/** The most westerly offset a caller may send, in minutes east of UTC (UTC−12:00). */
export const TZ_OFFSET_MIN = -720;
/** The most easterly (UTC+14:00). */
export const TZ_OFFSET_MAX = 840;

/** A whole number of minutes from TZ_OFFSET_MIN to TZ_OFFSET_MAX. */
export function isTzOffset(value: number): boolean {
  return Number.isInteger(value) && value >= TZ_OFFSET_MIN && value <= TZ_OFFSET_MAX;
}

/** The bucket `at` falls in for someone `tzOffset` minutes east of UTC. */
export function usualBucketAt(at: Date, tzOffset: number): UsualBucket {
  return usualBucketOfHour(new Date(at.getTime() + tzOffset * 60_000).getUTCHours());
}

/** How far back a bucket usual (`now`, `strip`) looks. The last-use fields keep USUALS_DAYS (90). */
export const USUALS_NOW_DAYS = 60;
/** Uses of a food in the current bucket that make it a bucket usual (`now`). */
export const USUAL_NOW_MIN_USES = 2;
/** …and that put it in the Now strip (`strip`). */
export const USUAL_STRIP_MIN_USES = 3;

/** The caller's usual for the current bucket (`KitchenUsual.now`). */
export interface UsualNow {
  bucket: UsualBucket;
  /** The most frequent amount (ties: the most recent), in thousandths of the item's base unit. */
  qtyMilli: number;
  /** The same amount in `unit` (three decimals at most). */
  quantity: number;
  /** The unit the latest use of that amount was logged in. */
  unit: string;
  /** Its words when it was given in a measure ("1 glass", SM-13); null for a unit. */
  label: string | null;
  /** Who had it, the latest time that amount was used. */
  consumerIds: string[];
  /** The caller's uses of the food in this bucket in the last USUALS_NOW_DAYS days, every amount counted. */
  count: number;
}

// ── The suggestion (design §2.2) ────────────────────────────

/** Why a row suggests its amount; the first that fits wins, in this order. */
export const USE_SUGGESTION_REASONS = ["rest", "usual_now", "usual", "use_soon", "first"] as const;
export type UseSuggestionReason = (typeof USE_SUGGESTION_REASONS)[number];

/** What's left at most this many times the usual amount (5/4) is "the rest". */
export const REST_OF_USUAL = { num: 5, den: 4 } as const;

/**
 * One step of the item's ladder: an amount, or anything that carries one —
 * the console's `UseTile` (`amount.qtyMilli`, and `rest` on The rest, which
 * is skipped: the rest is always offered on its own).
 */
export type UseLadderStep = number | { amount: { qtyMilli: number }; rest?: boolean | undefined };

/** The usual fields a suggestion reads: a `KitchenUsual`, or as much of one. */
export type SuggestUsual = Pick<KitchenUsual, "lastQtyMilli" | "consumers"> & {
  lastUnit?: string | undefined;
  lastLabel?: string | null | undefined;
  now?: UsualNow | null | undefined;
};

export interface SuggestUseInput {
  item: Pick<KitchenItem, "qtyLeftMilli" | "dimension" | "daysToUseBy">;
  /** The caller's usual of the item; null or absent without one. */
  usual?: SuggestUsual | null | undefined;
  /** The bucket usual; absent, `usual.now`. */
  now?: UsualNow | null | undefined;
  /**
   * The amounts the row steps through, in order (`useTiles` order without
   * Other). Only the steps under what is left count; with none, only the rest fits.
   */
  ladder: readonly UseLadderStep[];
}

export interface UseSuggestion {
  reason: UseSuggestionReason;
  /** What to log: never more than what is left. */
  qtyMilli: number;
  /** The unit and words the usual was logged in, to log it the same way; null when the amount is not a usual. */
  unit: string | null;
  label: string | null;
  /** Who had it: the bucket usual's people for `usual_now`, else the last use's; null without a usual. */
  consumerIds: string[] | null;
  /** What the row says under the amount: "The rest", "Morning usual", "Your usual", "Use soon"; null for `first`. */
  why: string | null;
}

function stepAmount(step: UseLadderStep): number | null {
  if (typeof step === "number") return step;
  return step.rest ? null : step.amount.qtyMilli;
}

/** The ladder's amounts under what is left, in order. */
function stepsUnder(ladder: readonly UseLadderStep[], left: number): number[] {
  return ladder.map(stepAmount).filter((q): q is number => q !== null && Number.isInteger(q) && q > 0 && q < left);
}

/** "The rest", or "The rest · only 2 left" for a whole count of pieces. */
export function restWhy(item: Pick<KitchenItem, "qtyLeftMilli" | "dimension">): string {
  if (item.dimension === "count" && item.qtyLeftMilli > 0 && item.qtyLeftMilli % 1000 === 0) {
    return `The rest · only ${item.qtyLeftMilli / 1000} left`;
  }
  return "The rest";
}

/** A use-by date from today to USE_SOON_DAYS ahead, as the Pantry's Soon reads it. */
function isUseSoon(item: Pick<KitchenItem, "daysToUseBy">): boolean {
  return item.daysToUseBy !== null && item.daysToUseBy >= 0 && item.daysToUseBy <= USE_SOON_DAYS;
}

/** The usual amount: the bucket's, else the last one; null without a usual. */
export function usualAmount(usual: SuggestUsual | null | undefined, now?: UsualNow | null): number | null {
  const bucket = now === undefined ? (usual?.now ?? null) : now;
  const qty = bucket?.qtyMilli ?? usual?.lastQtyMilli ?? null;
  return qty !== null && qty > 0 ? qty : null;
}

/**
 * The amount a row suggests and why (design §2.2). The first rule that fits wins:
 *   1. `rest`: what's left is at most 5/4 of the usual amount (the bucket's,
 *      else the last one), or at most the smallest ladder step — all of it;
 *   2. `usual_now`: a bucket usual — "Morning usual";
 *   3. `usual`: a last usual — "Your usual";
 *   4. `use_soon`: a use-by within USE_SOON_DAYS — the first ladder step, "Use soon";
 *   5. `first`: the first ladder step, with no reason shown.
 * Null when nothing is left. The amount is never more than what is left.
 */
export function suggestUse(input: SuggestUseInput): UseSuggestion | null {
  const { item } = input;
  const left = item.qtyLeftMilli;
  if (!(left > 0)) return null;
  const usual = input.usual ?? null;
  const now = input.now === undefined ? (usual?.now ?? null) : input.now;
  const amount = usualAmount(usual, now);
  const steps = stepsUnder(input.ladder, left);
  const lastPeople = usual ? [...usual.consumers] : null;

  if ((amount !== null && left * REST_OF_USUAL.den <= amount * REST_OF_USUAL.num) || steps.length === 0) {
    return { reason: "rest", qtyMilli: left, unit: null, label: null, consumerIds: lastPeople, why: restWhy(item) };
  }
  if (now && now.qtyMilli > 0) {
    return {
      reason: "usual_now",
      qtyMilli: Math.min(now.qtyMilli, left),
      unit: now.unit,
      label: now.label,
      consumerIds: [...now.consumerIds],
      why: `${USUAL_BUCKET_LABELS[now.bucket]} usual`,
    };
  }
  if (usual && usual.lastQtyMilli > 0) {
    return {
      reason: "usual",
      qtyMilli: Math.min(usual.lastQtyMilli, left),
      unit: usual.lastUnit ?? null,
      label: usual.lastLabel ?? null,
      consumerIds: lastPeople,
      why: "Your usual",
    };
  }
  const first = steps[0]!;
  return isUseSoon(item)
    ? { reason: "use_soon", qtyMilli: first, unit: null, label: null, consumerIds: null, why: "Use soon" }
    : { reason: "first", qtyMilli: first, unit: null, label: null, consumerIds: null, why: null };
}

// ── Running low (design §2.3) ───────────────────────────────

/** Under this share of what was bought is running low. */
export const RUNNING_LOW_PERCENT = 20;

export interface RunningLowInput {
  item: Pick<KitchenItem, "qtyLeftMilli" | "qtyBoughtMilli">;
  usual?: SuggestUsual | null | undefined;
  /** The bucket usual; absent, `usual.now`. */
  now?: UsualNow | null | undefined;
}

/**
 * Under RUNNING_LOW_PERCENT of what was bought, or under one usual amount
 * (the bucket's, else the last one — the amount `suggestUse` reads). A caller
 * without a bucket (the server's restock) passes the usual alone.
 */
export function isRunningLow(input: RunningLowInput): boolean {
  const { qtyLeftMilli: left, qtyBoughtMilli: bought } = input.item;
  if (left * 100 < bought * RUNNING_LOW_PERCENT) return true;
  const amount = usualAmount(input.usual, input.now);
  return amount !== null && left < amount;
}
