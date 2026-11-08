// Ask before use (Cookpool, epic cookpool-pantry: PN-8, design §8).
//
// The buyer of a group item can guard it ("Ask me first": saffron, the good
// olive oil). Anyone else in the group then asks for an amount, for the
// people who will have it; nothing comes off the stock and no money moves
// until the buyer approves. The buyer can let named people skip asking.
//
// Who is who, for one ask-first item:
//   * the answerer — its buyer (`paidBy`) while they are in the group; once
//     they have left, the group's owners and admins. Only the answerer sets
//     `askFirst` and `allowed` (PATCH …/items/{itm}, or on Add item for an
//     item the caller pays for), and answers asks.
//   * who must ask — every other member not in `allowed`. For them the use
//     and waste routes, a dish taking the item, and the stock check's `me` and
//     `split` are 403 `forbidden` with `details.reason: "ask_first"` (and
//     `details.answerer`, `details.itemId`). Owners and admins may always
//     check an ask-first item (its `waste` and raising it stay open to anyone
//     who may use it).
//   * a personal item never asks.
//
// The item reads (a group's items, one item, every pantry, search, and the
// answers of every write that returns an item) carry `askFirst` on every
// group item, and on an ask-first one `allowed`, `mustAsk` (for the caller)
// and `answerer` (KitchenItem).
//
// Routes (a group's, /v1/organizations/{org}/kitchen/…, and one cross-group read):
//   POST …/items/{itm}/asks     anyone who may use the item and must ask (`kitchen.item.use`)
//        { quantity, unit | measure, consumers?, weights?, source? } → 201 { ask }
//        Nothing comes off the stock. 409 `no_need` when the caller needn't
//        ask (the console then uses it directly); the amount is checked as a
//        use's (409 `insufficient_stock`, 422 on a bad unit or measure);
//        consumers must be in the group (422 `not_in_group`).
//   POST …/asks/{ask}/approve   the answerer: { alwaysAllow?, takeWhatsLeft? } → 201 { ask, item, move, txn }
//        Posts the use exactly as the asker would have, at this moment's
//        price and stock: the asker is the move's actor and the
//        transaction's creator, the move says `via: "ask"`, and the ask is
//        approved in the same write. `alwaysAllow` adds the asker to
//        `allowed` too. Less left than was asked is 409 `insufficient_stock`
//        (`details.qtyLeftMilli`) unless `takeWhatsLeft`, which approves
//        what is left. Undo is the use's own: reverse its transaction, or
//        …/moves/{mov}/undo when it posted none — the answerer may do either.
//        That puts the ask back to pending (cancelled, when the asker undoes
//        it) and takes back an `alwaysAllow`.
//   POST …/asks/{ask}/decline   the answerer → 200 { ask }
//   POST …/asks/{ask}/reopen    the answerer: a declined ask still inside its 24 hours (Undo after Decline) → 200 { ask }
//   POST …/asks/{ask}/cancel    the asker → 200 { ask }
//   GET  /v1/kitchen/me/asks    → { toAnswer, mine }: the pending asks the
//        caller answers (oldest first), and their own asks from the last
//        24 hours in any state (newest first).
//
// An ask that is not pending refuses every answer with 409 `not_pending`
// (`details.state`); one that has lapsed with 409 `lapsed`. Answering when the
// caller isn't the answerer is 403 `not_buyer`; cancelling someone else's ask
// 403 `not_creator`. A repeat of an answer already given by the same person
// answers the same. Every POST takes an Idempotency-Key.
//
// Lapsing is read-side: a pending ask lapses ASK_LAPSE_HOURS after it was
// made, when its item is finished, or when its item stops asking first.
//
// Pushes (through notifications-worker's push to a subject, kind
// KITCHEN_ASK_PUSH_KIND): to the answerer on a new ask — "Dev asks for 1
// pinch of your saffron", "For Dev and Anu · ₹12 to you", opening
// /home?ask=<id> — and to the asker on an answer — "Meera said yes · 1 pinch
// of saffron logged", "Meera said no to the saffron". A push that fails never
// fails the write.
//
// Home's inbox carries the asks the caller answers in `InboxResponse.asks`
// (AskInboxItem), for the top of To do.
//
// This module is re-exported from `kitchen.ts`, so `@saas/contracts/kitchen`
// carries it.

import type { PantryRef, StockMoveResponse } from "./kitchen.js";

/** What an ask can be: decided (pending, approved, declined, canceled), or lapsed — read-side only. */
export const ASK_STATES = ["pending", "approved", "declined", "canceled", "lapsed"] as const;
export type AskState = (typeof ASK_STATES)[number];

/** Where it was asked from: the Pantry or item page, or a cook session's ingredient line (design §8.4). */
export const ASK_SOURCES = ["pantry", "cook"] as const;
export type AskSource = (typeof ASK_SOURCES)[number];

/** A pending ask lapses this long after it was made. */
export const ASK_LAPSE_HOURS = 24;
export const ASK_LAPSE_MS = ASK_LAPSE_HOURS * 60 * 60 * 1000;
/** `mine` covers the caller's asks from this far back. */
export const ASK_MINE_HOURS = 24;
/** At most this many asks in each of `toAnswer` and `mine`. */
export const ASKS_LIST_MAX = 50;
/** At most this many people in an item's `allowed`. */
export const ASK_ALLOWED_MAX = 100;

/** The kind an ask's push carries (`PushMessage.kind`); notifications-worker's PUSH_TO_SUBJECT_KINDS has it. */
export const KITCHEN_ASK_PUSH_KIND = "kitchen.ask";

/** The path an answerer's push opens: Home, with the card scrolled to and highlighted. */
export function askPushUrl(askId: string): string {
  return `/home?ask=${encodeURIComponent(askId)}`;
}

/**
 * `details.reason` of an ask's refusals (the error codes are the usual ones).
 * Answering as someone else is `not_buyer`, cancelling someone else's ask
 * `not_creator`, and less left than asked `insufficient_stock`
 * (KITCHEN_ERROR_REASONS).
 */
export const KITCHEN_ASK_ERROR_REASONS = {
  /** 403 `forbidden`: the caller must ask before using this item (`details.answerer`, `details.itemId`). */
  ASK_FIRST: "ask_first",
  /** 409 `conflict`: the caller needn't ask — use the item directly. */
  NO_NEED: "no_need",
  /** 409 `conflict`: the ask is past its time, or its item is finished or no longer asks first. */
  LAPSED: "lapsed",
  /** 409 `conflict`: the ask is not in a state this answer moves from (`details.state`). */
  NOT_PENDING: "not_pending",
} as const;
export type KitchenAskErrorReason = (typeof KITCHEN_ASK_ERROR_REASONS)[keyof typeof KITCHEN_ASK_ERROR_REASONS];

/** The item an ask is for, as its card shows it. */
export interface AskItem {
  /** `itm_…` */
  id: string;
  /** The item page's ref: `org:org_…:itm_…`. */
  ref: string;
  name: string;
  pantry: PantryRef;
  displayUnit: string;
  /** What is left now, exactly and in `displayUnit`. */
  qtyLeftMilli: number;
  qtyLeft: number;
  state: "active" | "used_up" | "wasted" | "removed";
}

/** One ask, with everything its card needs. */
export interface KitchenAsk {
  /** `ask_…` */
  id: string;
  /** The group (`org_…`). */
  orgId: string;
  item: AskItem;
  /** Who asked (`usr_…`), and their name (null when they have none to show). */
  asker: string;
  askerName: string | null;
  /** How much, exactly (thousandths of the item's base unit) and in `unit`. */
  qtyMilli: number;
  quantity: number;
  unit: string;
  /** The measure's words when it was asked in one ("1 pinch"); null for an amount in a unit. */
  label: string | null;
  /** How it reads: `label`, else the quantity in its unit ("250 ml"). */
  amount: string;
  /** Who will have it, in order, with their names. */
  consumers: string[];
  consumerNames: Array<string | null>;
  /** One per consumer; null for equal shares. */
  weights: number[] | null;
  source: AskSource;
  state: AskState;
  createdAt: string;
  /** When it lapses (if still pending). */
  expiresAt: string;
  /** When it was approved, declined or canceled, and by whom (the asker for a cancel); null while pending. */
  answeredAt: string | null;
  answeredBy: string | null;
  /** Who answers it: the buyer while they are in the group; null once they have left (an owner or admin answers). */
  answerer: string | null;
  answererName: string | null;
  /** The item's buyer: whom the use pays back. */
  paidBy: string;
  /** What the use costs: at this moment's price while it waits; what it cost once approved. */
  costMinor: number;
  /** Of that, what comes back to the buyer: the cost less the buyer's own share when they are a consumer. */
  backMinor: number;
  currency: string;
  /** Is what was asked still all there? When not, the answerer may approve what is left (`takeWhatsLeft`). */
  enough: boolean;
  /** Once approved: the use move and its transaction (null when it moved no money). */
  moveId: string | null;
  txnId: string | null;
}

/** POST …/items/{itm}/asks — an amount as a use takes it (a unit or one of the item's measures), and who will have it. */
export interface AskToUseRequest {
  quantity: string | number;
  unit?: string;
  /** Instead of `unit`: one of the item's measures (UseGroupItemRequest.measure). */
  measure?: string;
  /** Default: the caller. Everyone must be in the group. */
  consumers?: string[];
  /** One positive weight per consumer; default equal shares. */
  weights?: number[];
  /** Default `pantry`. */
  source?: AskSource;
}

export interface AskResponse {
  ask: KitchenAsk;
}

/** POST …/asks/{ask}/approve. */
export interface ApproveAskRequest {
  /** Also let the asker use it without asking from now on ("Always let Dev use saffron"). */
  alwaysAllow?: boolean;
  /** When less is left than was asked, approve what is left. */
  takeWhatsLeft?: boolean;
}

/** The approved ask, and the use it posted: undo it as that use is undone. */
export interface ApproveAskResponse extends StockMoveResponse {
  ask: KitchenAsk;
}

/** GET /v1/kitchen/me/asks. */
export interface AsksResponse {
  /** Pending asks the caller answers, oldest first. */
  toAnswer: KitchenAsk[];
  /** The caller's own asks from the last ASK_MINE_HOURS, in any state, newest first. */
  mine: KitchenAsk[];
}

/** One of Home's ask rows (InboxResponse.asks): a pending ask the caller answers, for the top of To do. */
export interface AskInboxItem {
  kind: "ask";
  ask: KitchenAsk;
}
