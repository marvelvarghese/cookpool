// Restocking (Cookpool, epic cookpool-pantry: PN-3, design §6.1–§6.4).
//
// What to buy again, and a shopping run that buys it in one go:
//
//   GET    /v1/kitchen/me/restock               self: { finished, runningLow, usual } across every pantry the caller can reach
//   POST   /v1/kitchen/me/purchases             self: 1–30 lines, paid by the caller, one write → 201 { purchaseId, items }
//   DELETE /v1/kitchen/me/purchases/{pur}       self: the Undo → 200 { purchaseId, removed, kept }
//
// Served by `apps/kitchen-worker` behind api-edge's kitchen facade, with the
// kitchen's envelopes (`{ data, meta }`; 422 `validation_failed` with field
// errors). This module is re-exported from `kitchen.ts`, so
// `@saas/contracts/kitchen` carries it too.

import type { KitchenItem, PantryRef, WastePolicy } from "./kitchen.js";

/** Finished this week: an item used up or wasted within this many days. */
export const RESTOCK_FINISHED_DAYS = 7;
/** You usually buy: purchases within this many days count. */
export const RESTOCK_USUAL_DAYS = 120;
/** You usually buy: bought on at least this many different days within RESTOCK_USUAL_DAYS. */
export const RESTOCK_USUAL_MIN_TIMES = 3;
/**
 * Running low: an active item with less than this percentage of what was
 * bought left. (The full `isRunningLow` also counts "under one usual
 * amount", which is per caller and per time of day: the restock read uses
 * the percentage alone.)
 */
export const RESTOCK_LOW_PERCENT = 20;
/** The most lines each restock group returns. */
export const RESTOCK_MAX_LINES = 50;
/** A shopping run has 1 to this many lines. */
export const PURCHASE_MAX_LINES = 30;

export const RESTOCK_REASONS = ["finished", "running_low", "usual"] as const;
export type RestockReason = (typeof RESTOCK_REASONS)[number];

/**
 * The latest purchase of a name in a pantry: what Bought again and the
 * shopping run fill a line with ("like last time").
 */
export interface RestockLast {
  /** `itm_…`: send it back as a line's `fromItemId`. */
  itemId: string;
  /** What was bought, in thousandths of the unit's dimension base (as `qtyBoughtMilli`). */
  quantityMilli: number;
  /** The unit it was entered in. */
  unit: string;
  priceMinor: number;
  currency: string;
  /** The item's own waste rule; null when it follows its group's (always null for a personal item). */
  wastePolicy: WastePolicy | null;
  /** Its use-by minus the day it was bought, in days; null when it had no use-by. */
  expiresAfterDays: number | null;
  /** Who paid (`usr_…`). */
  paidBy: string;
}

interface RestockLineBase {
  /** As the latest purchase spelled it. */
  name: string;
  /** lower(trim(name)): one line per name key and pantry. */
  nameKey: string;
  category: string;
  pantry: PantryRef;
  /**
   * May the caller add to this pantry (their own, or a group where their
   * role holds `kitchen.item.create`)? A viewer still sees what their
   * group finished or is running low on, but Bought again would be refused.
   * Usual lines are always addable.
   */
  canAdd: boolean;
  last: RestockLast;
}

/** Used up or wasted in the last RESTOCK_FINISHED_DAYS, with no newer active item of the name in the pantry. */
export interface FinishedRestockLine extends RestockLineBase {
  reason: "finished";
  why: {
    /** When it finished: its last move. */
    finishedAt: string;
    /** used_up, or wasted. */
    how: "used_up" | "wasted";
    /** `itm_…`: the item that finished (the latest, when several did). */
    itemId: string;
  };
}

/** An active item under RESTOCK_LOW_PERCENT, with no active item of the name in the pantry above it. */
export interface RunningLowRestockLine extends RestockLineBase {
  reason: "running_low";
  why: {
    leftQtyMilli: number;
    boughtQtyMilli: number;
    /** `itm_…`: the item running low (the newest, when several are). */
    itemId: string;
  };
}

/**
 * Bought on at least RESTOCK_USUAL_MIN_TIMES different days in the last
 * RESTOCK_USUAL_DAYS, in a pantry the caller can add to, with at least the
 * median gap between those days passed since the last, and no active item
 * of the name above running low.
 */
export interface UsualRestockLine extends RestockLineBase {
  reason: "usual";
  why: {
    /** The median gap between purchase days, rounded to whole days (at least 1). */
    everyDays: number;
    /** The day it was last bought (YYYY-MM-DD). */
    lastBoughtAt: string;
    /** On how many different days it was bought in the window. */
    times: number;
  };
}

export type RestockLine = FinishedRestockLine | RunningLowRestockLine | UsualRestockLine;

/**
 * GET /v1/kitchen/me/restock. Each name and pantry appears at most once, in
 * the first group it qualifies for (finished, then running low, then
 * usual). `finished` runs latest finish first; `runningLow` least left
 * first; `usual` most overdue first. Removed items and dish leftovers are
 * never purchases. Dates are UTC days, as everywhere in the kitchen.
 */
export interface RestockResponse {
  finished: FinishedRestockLine[];
  runningLow: RunningLowRestockLine[];
  usual: UsualRestockLine[];
}

/**
 * One line of a shopping run: an item added to `pantry`, paid by the caller.
 *
 * - `pantry`: `"personal"`, or a group's `org_…` id the caller can add to.
 * - `quantity` is a decimal in `unit`, as on Add item.
 * - `currency`: a group line is in its group's currency (a different one is
 *   422 `currency_mismatch` with `details.currency` and `details.line`); a
 *   personal line's defaults to INR, as on Add item.
 * - `wastePolicy`: group lines only; null follows the group. Left out, it is
 *   copied from `fromItemId` when that item is in the same group.
 * - `fromItemId`: the item this line buys again (Bought again, a restock
 *   line's `last.itemId`), in any pantry the caller can reach. Its settings
 *   are copied only into its own pantry.
 */
export interface PurchaseLine {
  pantry: string;
  name: string;
  category: string;
  quantity: string | number;
  unit: string;
  priceMinor: number;
  currency?: string;
  expiresOn?: string | null;
  wastePolicy?: WastePolicy | null;
  note?: string | null;
  fromItemId?: string | null;
}

/**
 * POST /v1/kitchen/me/purchases. One write: every item or none. The caller
 * must be able to add to every line's pantry, or nothing is added (422
 * `validation_failed`, with `lines[i].pantry` named for each one out of
 * reach). Takes an `Idempotency-Key`: the same key again answers with the
 * purchase it made (one another person made with it is 409
 * `idempotency_key_reused`).
 */
export interface CreatePurchaseRequest {
  lines: PurchaseLine[];
}

/** 201: the purchase (`pur_…`) and its items, in line order. */
export interface PurchaseResponse {
  purchaseId: string;
  items: KitchenItem[];
}

/**
 * DELETE /v1/kitchen/me/purchases/{pur}: the Undo, by the purchaser alone
 * (anyone else, or an unknown id, is the opaque 404). It removes every item
 * of the purchase that is still unused; `kept` lists those used since (or
 * in a group where the caller may no longer change items), which stay. A
 * repeat answers the same.
 */
export interface UndoPurchaseResponse {
  purchaseId: string;
  /** The purchase's items now removed. */
  removed: KitchenItem[];
  /** The purchase's items that stay. */
  kept: KitchenItem[];
}
