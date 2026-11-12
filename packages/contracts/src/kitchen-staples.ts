// Always have per pantry, and the shopping list (Cookpool, epic
// cookpool-revamp RV-21, the boards RvKitchenB and RvShopping; migration
// 600_kitchen_staples).
//
// Every pantry has its own Always have: yours ("Mine") and each group's. A
// staple is a name (linked to the food list when one matches) with a status
// — ok, running low, out — and what it last cost. Low and out put it on that
// pantry's shopping list, beside the lines people add by hand.
//
// Bought:
//   * a group's staple is bought for the group: ONE plain expense (kind
//     `expense`, the Kitchen balance) for the price, paid by the caller and
//     split equally — largest remainder, so the parts add up — among the
//     group's current members, and the staple back to ok, in one batch;
//   * your own is not split: the price is recorded and it is back to ok.
//
// Your personal staples that link to a food are what Cook now counts as
// there (Always have, RC-8): `GET/PUT /v1/kitchen/me/always-have` read and
// write the same rows. Until you first change the list you read the default
// (salt and water).
//
// Routes (kitchen-worker, behind api-edge's kitchen facade; all signed in):
//   GET    /v1/kitchen/me/staples                         → StaplesResponse (yours, then each group's by name)
//   POST   /v1/kitchen/me/staples                         AddStapleRequest → 201 { staple }
//   PATCH  /v1/kitchen/me/staples/{stp}                   UpdateStapleRequest → { staple }
//   DELETE /v1/kitchen/me/staples/{stp}                   → { staple } (as it was: Undo adds it again)
//   POST   /v1/kitchen/me/staples/{stp}/bought            StapleBoughtRequest → { staple, txn: null }
//   POST   /v1/kitchen/me/shopping                        AddShoppingItemRequest → 201 { item }
//   PATCH  /v1/kitchen/me/shopping/{shp}                  UpdateShoppingItemRequest → { item }
//   DELETE /v1/kitchen/me/shopping/{shp}                  → { item }
//   POST   /v1/kitchen/me/shopping/clear                  ClearShoppingRequest → ClearShoppingResponse
//   GET    /v1/organizations/{org}/kitchen/staples        → StaplePantry (kitchen.pantry.read)
//   POST   /v1/organizations/{org}/kitchen/staples        (kitchen.item.create) → 201 { staple }
//   PATCH  /v1/organizations/{org}/kitchen/staples/{stp}  (kitchen.item.create) → { staple }
//   DELETE /v1/organizations/{org}/kitchen/staples/{stp}  (kitchen.item.create) → { staple }
//   POST   /v1/organizations/{org}/kitchen/staples/{stp}/bought  (kitchen.expense.create; Idempotency-Key)
//                                                         → 201 { staple, txn }
//   POST   /v1/organizations/{org}/kitchen/shopping       (kitchen.item.create) → 201 { item }
//   PATCH  /v1/organizations/{org}/kitchen/shopping/{shp} (kitchen.item.create) → { item }
//   DELETE /v1/organizations/{org}/kitchen/shopping/{shp} (kitchen.item.create) → { item }
//   POST   /v1/organizations/{org}/kitchen/shopping/clear (kitchen.item.create) ClearShoppingRequest → ClearShoppingResponse
//
// Clear is for when a shopping run is saved: the run records what was paid
// (each line into its pantry, as a purchase), so the lines it bought leave
// the list — hand-added ones are deleted, staples set back to ok with no
// split — in one batch. Ids that aren't in that pantry are skipped.
//
// Refusals (pinned codes): 404 `not_found` for a group the caller isn't in
// or may not write to (opaque, as every kitchen denial) and for a staple or
// line that isn't there; 409 `conflict` with `details.reason`
// `already_listed` for a name the pantry already has; 422
// `validation_failed` with field errors, or `currency_mismatch`.
//
// This module is re-exported from `kitchen.ts`, so `@saas/contracts/kitchen`
// carries it.

import type { KitchenTxn } from "./kitchen.js";

export const STAPLE_STATUSES = ["ok", "low", "out"] as const;
export type StapleStatus = (typeof STAPLE_STATUSES)[number];

/** A staple's or a list line's name: 1–60 characters, trimmed. */
export const STAPLE_NAME_MAX = 60;
/** At most this many staples in one pantry. */
export const MAX_STAPLES = 40;
/** At most this many hand-added lines on one pantry's list. */
export const MAX_SHOPPING_ITEMS = 100;
/** A unit word as shown ("g", "packet"): 1–24 characters. */
export const SHOPPING_UNIT_MAX = 24;

/** `details.reason` of the 409 for a name the pantry already has. */
export const STAPLE_ERROR_REASONS = {
  ALREADY_LISTED: "already_listed",
} as const;

/** Whose pantry: yours, or a group's (`org_…`). */
export type StapleOwner = { kind: "personal" } | { kind: "group"; orgId: string; slug: string; name: string };

export interface KitchenStaple {
  /** `stp_…` */
  id: string;
  name: string;
  /** The food it links to (Cook now counts your own linked ones as there); null when none. */
  foodKey: string | null;
  status: StapleStatus;
  /** What it last cost, in minor units of `currency`; null before it was first bought. */
  lastPriceMinor: number | null;
  currency: string | null;
  /** What it was last bought in: thousandths of the base unit, and the unit shown. */
  lastQtyMilli: number | null;
  lastUnit: string | null;
  /** What the shopping list asks for; null: `lastQtyMilli` / `lastUnit`. */
  wantQtyMilli: number | null;
  wantUnit: string | null;
  /** When it was last bought; null before. */
  boughtAt: string | null;
  updatedBy: string;
  updatedAt: string;
}

/** A line added to a pantry's shopping list by hand. */
export interface ShoppingItem {
  /** `shp_…` */
  id: string;
  name: string;
  qtyMilli: number | null;
  unit: string | null;
  /** Who added it (`usr_…`). */
  addedBy: string;
  createdAt: string;
}

/** One pantry's Always have and its hand-added list lines. */
export interface StaplePantry {
  owner: StapleOwner;
  /** The currency its money is in (a group's ledger currency; INR for yours). */
  currency: string;
  /** Who a group's Bought is split among: its current members (`usr_…`), oldest first. Empty for yours. */
  splitAmong: string[];
  staples: KitchenStaple[];
  /** False while you have never changed your own list: `staples` is the default (salt and water). Always true for a group. */
  isSet: boolean;
  items: ShoppingItem[];
}

/** GET /v1/kitchen/me/staples: your pantry, then each group's by name. */
export interface StaplesResponse {
  pantries: StaplePantry[];
}

export interface AddStapleRequest {
  name: string;
  /** A food on the food list; without one the name is matched the way items are. */
  foodKey?: string | null;
}

export interface UpdateStapleRequest {
  status?: StapleStatus;
  /** What the shopping list asks for (both, or both null to go back to the last amount). */
  wantQtyMilli?: number | null;
  wantUnit?: string | null;
}

export interface StapleBoughtRequest {
  /** What was paid, minor units; > 0 for a group's (it posts that bill), ≥ 0 for yours. */
  priceMinor: number;
  /** The group's currency when given; another is `currency_mismatch`. */
  currency?: string;
  /** What was bought (optional): thousandths of the base unit and the unit shown. */
  qtyMilli?: number | null;
  unit?: string | null;
  /**
   * A group's only (RV-22, the shopping run's Paid by): who paid, a current
   * member (422 `not_in_group` otherwise); left out, the caller. Yours
   * refuses it on `paidBy`.
   */
  paidBy?: string;
}

export interface StapleResponse {
  staple: KitchenStaple;
}

export interface StapleBoughtResponse {
  staple: KitchenStaple;
  /** The group's expense, split equally; null for your own. */
  txn: KitchenTxn | null;
}

export interface AddShoppingItemRequest {
  name: string;
  qtyMilli?: number | null;
  unit?: string | null;
}

export interface UpdateShoppingItemRequest {
  qtyMilli: number | null;
  unit: string | null;
}

export interface ShoppingItemResponse {
  item: ShoppingItem;
}

export interface ClearShoppingRequest {
  /** `shp_…` lines to delete. */
  itemIds?: string[];
  /** `stp_…` staples to set back to ok. */
  stapleIds?: string[];
}

export interface ClearShoppingResponse {
  /** The lines deleted, as they were (Undo adds them again). */
  items: ShoppingItem[];
  /** The staples set back to ok. */
  staples: KitchenStaple[];
}

/** At most this many ids in one clear. */
export const MAX_SHOPPING_CLEAR = 200;

/** One line of a pantry's shopping list, from either source: a staple running low or out, or added by hand. */
export type ShoppingLine =
  | { source: "staple"; staple: KitchenStaple; qtyMilli: number | null; unit: string | null }
  | { source: "hand"; item: ShoppingItem; qtyMilli: number | null; unit: string | null };

/** A pantry's shopping list: its staples running low or out (asking for their wanted, else last, amount), then the hand-added lines. */
export function shoppingLines(pantry: Pick<StaplePantry, "staples" | "items">): ShoppingLine[] {
  return [
    ...pantry.staples.filter(stapleListed).map((staple) => ({
      source: "staple" as const,
      staple,
      qtyMilli: staple.wantQtyMilli ?? staple.lastQtyMilli,
      unit: staple.wantQtyMilli !== null ? staple.wantUnit : staple.lastUnit,
    })),
    ...pantry.items.map((item) => ({ source: "hand" as const, item, qtyMilli: item.qtyMilli, unit: item.unit })),
  ];
}

/** A staple is on the shopping list while it is running low or out. */
export function stapleListed(staple: Pick<KitchenStaple, "status">): boolean {
  return staple.status !== "ok";
}
