// The stock check (Cookpool, epic cookpool-pantry: PN-4, design §7).
//
// Nobody logs everything. A stock check sets what is really left of an item
// and says where the difference went — and never invents money:
//
//   POST /v1/kitchen/me/items/{itm}/check                    the caller's own item
//   POST /v1/organizations/{org}/kitchen/items/{itm}/check   a group item: anyone who may use it (`kitchen.item.use`)
//
//   { left: { quantity, unit? }, gone?: "me" | "split" | "waste" }  → 201 StockMoveResponse
//
// `left` is the level, in a unit of the item's dimension (the item's own when
// left out; the same units a use takes), 0 for empty. It is read against the
// item as it is when the check writes, so a use that lands first only shrinks
// the difference.
//
//   * Less than is left: `gone` says where the difference went, and the check
//     writes exactly what the use or waste route would have written for that
//     difference — the same move, cost, transaction, audit event and email:
//       - `me`: a use by the caller. A group item posts a `use` transaction
//         charging the caller, or none when the caller bought it.
//       - `split`: a use with every current member of the group as a
//         consumer, in equal shares; the odd paisa goes to the earliest
//         member. Group items only.
//       - `waste`: waste under the item's rule (its own, else the group's):
//         split equally posts a `waste` transaction, buyer absorbs (and every
//         personal item) records the move only.
//     Each is undone as that use or waste is: by reversing its transaction,
//     or with …/moves/{mov}/undo when it posted none.
//   * More than is left: an `adjust` move raising what is left by the
//     difference. No money moves and no transaction is posted; a used-up or
//     wasted item is active again. Later uses cost what any use costs, and
//     `costOfUse` never charges past what is left of the price, so the item
//     still costs at most its price in total. …/moves/{mov}/undo takes the
//     difference back off while that much is still there — even after later
//     uses — and is 409 `insufficient_stock` otherwise; an item it empties
//     is finished again.
//   * Every move a check writes carries `via: "check"` (KitchenStockMove.via).
//
// Refusals, each writing nothing (422 `validation_failed` unless noted):
//   * the same level as is left: `details.reason: "unchanged"` (with
//     `details.qtyLeftMilli`) — the console's "It's right" sends nothing;
//   * more than was bought: `details.reason: "more_than_bought"` (with
//     `details.qtyBoughtMilli`) — the console caps the level at Full;
//   * less, without `gone`: field `gone`;
//   * `split` on a personal item: field `gone`;
//   * a malformed level, or a unit of another dimension: fields `left…`.
//   * a group item outside the caller's reach is the opaque 404; a viewer's
//     check too, as a viewer's use is.
//
// This module is re-exported from `kitchen.ts`, so `@saas/contracts/kitchen`
// carries it.

import type { StockMoveResponse } from "./kitchen.js";

/** What can write a move other than logging it directly (KitchenStockMove.via): a stock check, an approved ask (PN-8). */
export const STOCK_MOVE_VIAS = ["check", "ask"] as const;
/** The same names as `KitchenStockMove.via` (tests/contracts checks they match). */
export type StockMoveVia = (typeof STOCK_MOVE_VIAS)[number];

/** Where the difference went when less is left than Cookpool thought. */
export const STOCK_CHECK_GONE = ["me", "split", "waste"] as const;
export type StockCheckGone = (typeof STOCK_CHECK_GONE)[number];

/** `details.reason` of a refused check (422 `validation_failed`). */
export const KITCHEN_CHECK_ERROR_REASONS = {
  /** The level is what is left already (`details.qtyLeftMilli`): nothing to fix. */
  UNCHANGED: "unchanged",
  /** The level is above what was bought (`details.qtyBoughtMilli`). */
  MORE_THAN_BOUGHT: "more_than_bought",
} as const;

export type KitchenCheckErrorReason = (typeof KITCHEN_CHECK_ERROR_REASONS)[keyof typeof KITCHEN_CHECK_ERROR_REASONS];

/** What is really left: a decimal (0 for empty) in a unit of the item's dimension. */
export interface StockCheckLevel {
  quantity: string | number;
  /** Absent: the item's own unit. */
  unit?: string;
}

/** POST /v1/organizations/{org}/kitchen/items/{itm}/check. `gone` is required when the level is below what is left. */
export interface CheckGroupItemRequest {
  left: StockCheckLevel;
  gone?: StockCheckGone;
}

/** POST /v1/kitchen/me/items/{itm}/check. A personal item is the caller's alone: no `split`. */
export interface CheckPersonalItemRequest {
  left: StockCheckLevel;
  gone?: Exclude<StockCheckGone, "split">;
}

/** 201 from a check: the item as it is now, the move it wrote (`via: "check"`), and the transaction (null when none). */
export type CheckItemResponse = StockMoveResponse;
