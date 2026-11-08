// Kitchen contract types (Cookpool, epic cookpool-kitchen).
//
// The kitchen bounded context is served by `apps/kitchen-worker` behind
// `api-edge` (`/v1/organizations/{org}/kitchen/…` for one group,
// `/v1/kitchen/me/…` for the caller across every group). Money is integer
// minor units (paise for INR) in the group's one currency.

// ── Policy actions ──────────────────────────────────────────

/** Every kitchen policy action, in the order design.md §6 lists them. */
export const KITCHEN_ACTIONS = [
  "kitchen.pantry.read",
  "kitchen.ledger.read",
  "kitchen.item.create",
  "kitchen.item.use",
  "kitchen.item.edit",
  "kitchen.dish.cook",
  "kitchen.dish.claim",
  "kitchen.dish.finalize",
  "kitchen.expense.create",
  "kitchen.settlement.create",
  "kitchen.txn.flag",
  "kitchen.item.manage",
  "kitchen.dish.finalize_any",
  "kitchen.txn.reverse_any",
  "kitchen.settings.manage",
] as const;

export type KitchenAction = (typeof KITCHEN_ACTIONS)[number];

// ── Error reasons ───────────────────────────────────────────
//
// ERROR_CODES are pinned; kitchen-specific outcomes ride on an existing code
// with `details.reason` set to one of these.

export const KITCHEN_ERROR_REASONS = {
  /** 409 `conflict`: the group's currency is fixed once its settings exist. */
  CURRENCY_LOCKED: "currency_locked",
  /** 422 `validation_failed`: an amount names a currency other than the group's. */
  CURRENCY_MISMATCH: "currency_mismatch",
  /** 422 `validation_failed`: someone named is not an active member of the group (`details.subjectIds`). */
  NOT_IN_GROUP: "not_in_group",
  /** 409 `conflict`: the transaction has been reversed already (`details.reversedBy`). */
  ALREADY_REVERSED: "already_reversed",
  /** 409 `conflict`: the Idempotency-Key already posted something different in this group. */
  IDEMPOTENCY_KEY_REUSED: "idempotency_key_reused",
  /** 403 `forbidden`: only the people a payment is between, or the people a transaction names, may do this. */
  NOT_A_PARTY: "not_a_party",
  /** 403 `forbidden`: only its creator, or an owner or admin, may reverse a transaction. */
  NOT_CREATOR: "not_creator",
  /**
   * 409 `conflict`: some of the item has been used, so what was bought (its
   * quantity and price) is fixed, and it cannot be removed — mark it wasted.
   */
  ITEM_USED: "item_used",
  /** 403 `forbidden`: only a group item's buyer (`paidBy`), or an owner or admin, may change or remove it. */
  NOT_BUYER: "not_buyer",
  /** 409 `conflict`: the item changed since the `version` the edit was based on (`details.version` is the current one). */
  VERSION_CONFLICT: "version_conflict",
  /**
   * 409 `conflict`: not that much of the item is left — an over-draw, or
   * nothing left to waste (`details.qtyLeftMilli`). Nothing was written.
   */
  INSUFFICIENT_STOCK: "insufficient_stock",
  /** 409 `conflict`: the item kept changing while the write was retried; read it again and retry. */
  STALE: "stale",
  /** 409 `conflict`: only the latest move still in effect on an item can be undone (`details.latestMoveId`). */
  NOT_LATEST: "not_latest",
  /**
   * 409 `conflict`: the move posted a ledger transaction (`details.txnId`):
   * reverse that transaction instead, which puts the stock back too.
   */
  HAS_TRANSACTION: "has_transaction",
  /**
   * 409 `conflict`: this cannot be undone — a transfer, an undo, or the
   * reversal of a use or waste (log the use again instead), or a transaction
   * a dish posted (cancel the dish instead: `details.dishId`).
   */
  NOT_REVERSIBLE: "not_reversible",
  /**
   * 409 `conflict`: the dish's state (`details.state`) does not allow this —
   * cancelling, claiming or assigning a finalized or canceled dish, claiming
   * a draft (an assigned dish takes no claims), finalizing a canceled one,
   * correcting one that is not finalized.
   */
  DISH_NOT_OPEN: "dish_not_open",
  /**
   * 409 `conflict`: more half portions would be claimed than were cooked
   * (`details.portionsHalf`); `details.availableHalf` is the most this
   * request could have had. Nothing was written.
   */
  CLAIMS_EXCEED_PORTIONS: "claims_exceed_portions",
  /**
   * 409 `conflict` on POST /v1/organizations/{org}/leave (membership-worker,
   * CP-19): the caller still owes or is owed money in the group — their
   * balance there (`details.balanceMinor`, positive when they are owed, in
   * `details.currency`) is not zero. Settle up, then leave.
   */
  BALANCE_NOT_SETTLED: "balance_not_settled",
} as const;

export type KitchenErrorReason = (typeof KITCHEN_ERROR_REASONS)[keyof typeof KITCHEN_ERROR_REASONS];

// ── Group settings ──────────────────────────────────────────

/** Who pays for food that goes to waste: everyone in the group, or its buyer. */
export const WASTE_POLICIES = ["split_equally", "buyer_absorbs"] as const;
export type WastePolicy = (typeof WASTE_POLICIES)[number];

/** What a group reads as until its settings are first changed. */
export const DEFAULT_KITCHEN_CURRENCY = "INR";
export const DEFAULT_WASTE_POLICY: WastePolicy = "split_equally";

/** ISO 4217 alphabetic code: three uppercase letters. */
export const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/**
 * GET / PATCH /v1/organizations/{org}/kitchen/settings → `data`.
 * `updatedAt` is null while the group still uses the defaults.
 */
export interface KitchenSettings {
  currency: string;
  wastePolicy: WastePolicy;
  updatedAt: string | null;
}

/**
 * PATCH /v1/organizations/{org}/kitchen/settings (owner/admin:
 * `kitchen.settings.manage`). At least one field. `currency` is accepted only
 * while the group has never saved settings, or when it equals the current
 * value; otherwise 409 `conflict` with `details.reason: "currency_locked"`.
 */
export interface UpdateKitchenSettingsRequest {
  wastePolicy?: WastePolicy;
  currency?: string;
}

export type GetKitchenSettingsResponse = KitchenSettings;
export type UpdateKitchenSettingsResponse = KitchenSettings;

// ── The ledger (CP-7) ───────────────────────────────────────
//
// Every group has an append-only ledger. A transaction is one money event; its
// splits say who paid what and who owes what, and Σ paid = Σ owed = total. A
// person's balance is Σ paid − Σ owed over the group's transactions (positive:
// they get money back). Subject ids are people's public ids (`usr_…`); amounts
// are integer minor units of the group's currency.

export const TXN_KINDS = ["expense", "use", "dish", "waste", "settlement", "reversal"] as const;
export type KitchenTxnKind = (typeof TXN_KINDS)[number];

/** How an expense is shared between its participants. */
export const SPLIT_MODES = ["equal", "exact", "percent", "shares"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export const SETTLEMENT_METHODS = ["upi", "cash", "bank", "other"] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

/** One person's line in a transaction. */
export interface KitchenSplit {
  subjectId: string;
  paidMinor: number;
  owedMinor: number;
}

export interface KitchenTxn {
  /** `txn_…` */
  id: string;
  /** `org_…`: the group whose ledger it is in. */
  orgId: string;
  kind: KitchenTxnKind;
  title: string;
  totalMinor: number;
  currency: string;
  occurredAt: string;
  /** Who logged it (`usr_…`). */
  createdBy: string;
  createdAt: string;
  /** What it came from (`item`, `dish`, `expense`), when it came from one. */
  sourceKind: string | null;
  sourceId: string | null;
  /** For a reversal: the `txn_…` it undoes. */
  reverses: string | null;
  /** True once a reversal has undone it. */
  reversed: boolean;
  /** That reversal's `txn_…`. */
  reversedBy: string | null;
  /** For a settlement: how it was paid. */
  method: SettlementMethod | null;
  note: string | null;
  /** In the order the people were listed: payers, then participants. */
  splits: KitchenSplit[];
}

/**
 * POST /v1/organizations/{org}/kitchen/expenses (`kitchen.expense.create`).
 * `payers` add up to `totalMinor`. Each participant's `value` is ignored for
 * `equal`, an amount in minor units for `exact` (they add up to the total), a
 * percentage for `percent` (they add up to 100, two decimals allowed) and a
 * weight for `shares`. Everyone named is an active member (422 `not_in_group`);
 * `currency`, when given, is the group's (422 `currency_mismatch`).
 */
export interface CreateExpenseRequest {
  title: string;
  totalMinor: number;
  currency?: string;
  payers: { subjectId: string; amountMinor: number }[];
  mode: SplitMode;
  participants: { subjectId: string; value?: number }[];
  /** ISO 8601; defaults to now. */
  occurredAt?: string;
  note?: string;
}

/**
 * POST /v1/organizations/{org}/kitchen/settlements (`kitchen.settlement.create`):
 * `fromSubjectId` paid `toSubjectId`. Recorded by either of the two, or by an
 * owner or admin (403 `not_a_party` otherwise).
 */
export interface CreateSettlementRequest {
  fromSubjectId: string;
  toSubjectId: string;
  amountMinor: number;
  method?: SettlementMethod;
  note?: string;
}

/**
 * POST /v1/organizations/{org}/kitchen/txns/{txn}/reverse — its creator, or an
 * owner or admin (`kitchen.txn.reverse_any`). Posts a `reversal` that swaps
 * every split's paid and owed; a transaction is reversed once (409
 * `already_reversed`).
 */
export interface ReverseTxnRequest {
  note?: string;
}

/** 201 from expenses, settlements and reverse: the transaction posted. */
export interface KitchenTxnResponse {
  txn: KitchenTxn;
}

export type CreateExpenseResponse = KitchenTxnResponse;
export type CreateSettlementResponse = KitchenTxnResponse;
export type ReverseTxnResponse = KitchenTxnResponse;

export const FLAG_STATES = ["open", "resolved"] as const;
export type KitchenFlagState = (typeof FLAG_STATES)[number];

export interface KitchenFlag {
  /** `flg_…` */
  id: string;
  /** `txn_…` */
  txnId: string;
  orgId: string;
  /** Who flagged it. */
  subjectId: string;
  reason: string;
  state: KitchenFlagState;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST /v1/organizations/{org}/kitchen/txns/{txn}/flags (`kitchen.txn.flag`):
 * someone the transaction names says it looks wrong (403 `not_a_party` for
 * anyone else). A correction is a reversal.
 */
export interface FlagTxnRequest {
  reason: string;
}

export interface FlagTxnResponse {
  flag: KitchenFlag;
}

/** GET /v1/organizations/{org}/kitchen/activity?cursor=&limit= (`kitchen.ledger.read`): newest first. */
export interface ActivityQuery {
  cursor?: string;
  /** 1–100, default 25. */
  limit?: number;
}

export interface ActivityPage {
  items: KitchenTxn[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

export interface Balance {
  subjectId: string;
  /** Σ paid − Σ owed: positive gets money back, negative owes. */
  balanceMinor: number;
}

/**
 * GET /v1/organizations/{org}/kitchen/balances (`kitchen.ledger.read`): every
 * member (zero included) and anyone who left with money still owed either way,
 * largest first. They add up to zero.
 */
export interface BalancesResponse {
  currency: string;
  balances: Balance[];
}

export interface SettlePayment {
  fromSubjectId: string;
  toSubjectId: string;
  amountMinor: number;
}

/**
 * GET /v1/organizations/{org}/kitchen/settle-plan (`kitchen.ledger.read`): the
 * fewest payments that bring every balance to zero, and the working — the
 * pairwise debts the transactions created, the pairs left once opposite debts
 * cancel, and the payments in the plan.
 */
export interface SettlePlan {
  currency: string;
  payments: SettlePayment[];
  working: { debts: number; pairs: number; payments: number };
}

// ── Pantries and items (CP-10) ──────────────────────────────
//
// Every person has a personal pantry, which only they can see, and every group
// has a pantry its members share. An item is something bought: what it is,
// how much (a decimal in a display unit, stored as integer thousandths of the
// dimension's base unit — pieces, grams, millilitres, packs), what was paid
// and by whom, and when to use it by. Buying splits nothing: money moves when
// a group item is used or wasted (CP-11). Units are the engine's
// (`UNIT_KEYS` in `@saas/kitchen-engine/units`): pcs, dozen, g, kg, ml, L,
// tsp, tbsp, cup, pack.

export const ITEM_STATES = ["active", "used_up", "wasted", "removed"] as const;
export type KitchenItemState = (typeof ITEM_STATES)[number];

/** What a quantity measures. Display units convert only inside one. */
export const DIMENSIONS = ["count", "mass", "volume", "pack"] as const;
export type KitchenDimension = (typeof DIMENSIONS)[number];

/** `soon`: a use-by date from today to USE_SOON_DAYS ahead; `expired`: before today. */
export const ITEM_FILTERS = ["all", "soon", "expired"] as const;
export type ItemFilter = (typeof ITEM_FILTERS)[number];

/** How many days ahead "use soon" looks (today included). */
export const USE_SOON_DAYS = 3;

/** Which pantry an item is in. */
export type PantryRef =
  | { kind: "personal"; name: string }
  | { kind: "group"; orgId: string; slug: string; name: string };

/** What a pantry holds right now: its active items, counted and valued. */
export interface PantryTotals {
  itemCount: number;
  /** Items to use within USE_SOON_DAYS (and not yet past their date). */
  useSoonCount: number;
  /** Items past their use-by date. */
  expiredCount: number;
  /** What is left of the items' prices, in `currency`. */
  worthMinor: number;
  currency: string;
}

export interface PersonalPantry extends PantryTotals {
  kind: "personal";
  name: string;
}

export interface GroupPantry extends PantryTotals {
  kind: "group";
  /** `org_…` */
  orgId: string;
  slug: string;
  name: string;
  /** The group's waste rule (what an item without its own follows). */
  wastePolicy: WastePolicy;
}

export type Pantry = PersonalPantry | GroupPantry;

/** GET /v1/kitchen/me/pantries: the caller's own pantry first, then every group's by name. */
export interface PantriesResponse {
  pantries: Pantry[];
}

/** The longest item note (RC-3), in characters. */
export const ITEM_NOTE_MAX = 80;

/**
 * An item's note as it is stored (RC-3): trimmed, and null when nothing is
 * left of it — so a note is never blank. `null` and `undefined` are none.
 */
export function normalizeItemNote(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A note's length as the database counts it (SQLite's `length()`):
 * characters, not UTF-16 units, so "é" and "🍛" are one each.
 */
export function itemNoteLength(note: string): number {
  return Array.from(note).length;
}

export interface KitchenItem {
  /** `itm_…` */
  id: string;
  pantry: PantryRef;
  name: string;
  category: string;
  dimension: KitchenDimension;
  /** The unit it was entered in; `qtyBought`, `qtyLeft` and `unitPriceMinor` are in it. */
  displayUnit: string;
  qtyBought: number;
  qtyLeft: number;
  /** Exact quantities: thousandths of the dimension's base unit. */
  qtyBoughtMilli: number;
  qtyLeftMilli: number;
  /** What was paid. */
  priceMinor: number;
  currency: string;
  /** Price per one `displayUnit`. */
  unitPriceMinor: number;
  /** What is left of the price: what using (or wasting) the rest would cost. */
  worthMinor: number;
  /** The buyer (`usr_…`). */
  paidBy: string;
  /** ISO date. */
  boughtOn: string;
  /** ISO date, if it has one. */
  expiresOn: string | null;
  /** Days from today to the use-by date (negative once past); null without one. */
  daysToUseBy: number | null;
  /** Who pays if it is wasted: the item's own rule, else its group's. Null for a personal item. */
  wastePolicy: WastePolicy | null;
  /** The item's own rule; null when it follows the group. */
  wastePolicyOverride: WastePolicy | null;
  state: KitchenItemState;
  /** Counts edits; send it back as `version` to refuse an edit on a stale read. */
  version: number;
  /** Who added it (`usr_…`); may differ from the buyer. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The sizes it can be counted in (SM-13): its name's measures in its
   * pantry, for its dimension, in their order; empty when it has none. Every
   * answer that carries an item carries them; the field is optional here only
   * so items typed before SM-13 still check.
   */
  measures?: KitchenMeasure[];
  /**
   * One line about it (RC-3): "For Sunday's curry", at most ITEM_NOTE_MAX
   * characters; null when it has none. Whoever can read the item reads its
   * note — only you in your own pantry, everyone in the group in a group's.
   * Every answer that carries an item carries it; the field is optional here
   * only so items typed before RC-3 still check.
   */
  note?: string | null;
}

/**
 * GET /v1/kitchen/me/items — every pantry the caller can read: `pantry` is
 * `all` (default), `personal`, or a group's `org_…` id. Soonest use-by first
 * (items without one last), then by name.
 */
export interface ItemsQuery {
  pantry?: string;
  /** Name contains, case-insensitively. */
  q?: string;
  filter?: ItemFilter;
  cursor?: string;
  /** 1–100, default 50. */
  limit?: number;
  /**
   * Only items the caller may use (`usable=1`): their own, and those of
   * groups where their role holds `kitchen.item.use` — not a viewer's.
   */
  usable?: boolean;
}

/** GET /v1/organizations/{org}/kitchen/items (`kitchen.pantry.read`): one group's pantry. */
export type GroupItemsQuery = Omit<ItemsQuery, "pantry" | "usable">;

export interface ItemsPage {
  items: KitchenItem[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/**
 * GET /v1/kitchen/me/search?q=&limit= — active items with something left,
 * across every pantry the caller can read: names equal to `q` first, then
 * starting with it, then with a word starting with it, then containing it;
 * soonest use-by first within each.
 */
export interface SearchItemsQuery {
  q?: string;
  /** 1–50, default 20. */
  limit?: number;
  /** Only items the caller may use, as on `ItemsQuery`. */
  usable?: boolean;
}

/**
 * An item as the cross-pantry reads (`/v1/kitchen/me/items`, `…/search`)
 * answer it: with whether the caller may use it. A viewer reads a group's
 * pantry but may not use from it, so quick use and the dish maker offer only
 * `canUse` items (or ask with `usable=1`).
 */
export interface ReachableItem extends KitchenItem {
  canUse: boolean;
}

/** GET /v1/kitchen/me/items. */
export interface ReachableItemsPage {
  items: ReachableItem[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

export interface SearchItemsResponse {
  items: ReachableItem[];
}

/**
 * POST /v1/kitchen/me/items — add to the caller's personal pantry.
 * `quantity` is a decimal in `unit` ("1.25" kg); `currency` defaults to INR.
 */
export interface CreatePersonalItemRequest {
  name: string;
  category: string;
  quantity: string | number;
  unit: string;
  priceMinor: number;
  currency?: string;
  /** ISO date; defaults to today. */
  boughtOn?: string;
  expiresOn?: string | null;
  /**
   * One line about it (RC-3), trimmed; empty or null is none. More than
   * ITEM_NOTE_MAX characters is 422 `validation_failed` on `note`. Words
   * only: it moves no money.
   */
  note?: string | null;
}

/**
 * POST /v1/organizations/{org}/kitchen/items (`kitchen.item.create`). In the
 * group's currency (`currency`, when given, must be it: 422
 * `currency_mismatch`). `paidBy` defaults to the caller and must be in the
 * group (422 `not_in_group`). `wastePolicy` overrides the group's rule for
 * this item; null (the default) follows it.
 */
export interface CreateGroupItemRequest extends CreatePersonalItemRequest {
  paidBy?: string;
  wastePolicy?: WastePolicy | null;
}

/**
 * PATCH /v1/kitchen/me/items/{itm} — at least one field. `quantity` (with
 * `unit`, default the item's) and `priceMinor` change only while nothing of
 * the item has been used (409 `item_used`). With `version`, the edit applies
 * only to that version (409 `version_conflict`).
 */
export interface UpdatePersonalItemRequest {
  name?: string;
  category?: string;
  expiresOn?: string | null;
  quantity?: string | number;
  unit?: string;
  priceMinor?: number;
  /**
   * The note (RC-3): trimmed; empty or null clears it. Changes at any time,
   * however much is used, and writes nothing to the ledger.
   */
  note?: string | null;
  version?: number;
}

/**
 * PATCH /v1/organizations/{org}/kitchen/items/{itm} — its buyer, or an owner
 * or admin (`kitchen.item.manage`; 403 `not_buyer` otherwise).
 */
export interface UpdateGroupItemRequest extends UpdatePersonalItemRequest {
  wastePolicy?: WastePolicy | null;
}

/**
 * One item: 201 from POST, 200 from GET, PATCH and DELETE. DELETE marks it
 * `removed` (added by mistake), only while nothing has been used (409
 * `item_used`: mark it wasted instead).
 */
export interface KitchenItemResponse {
  item: KitchenItem;
}

// ── People: balances across groups, and the "why" (CP-9) ────
//
// A person's money is still settled inside each group; these reads add it up
// across the caller's groups and explain it. Every amount is in its group's
// currency, and nothing is added across currencies: totals are per currency.
// `displayName` is the name a person set on their profile, else the start of
// their email (before the @); null when it could not be read.

/** The roles that make someone part of a group's kitchen (`builder` is "member" in the app). */
export const KITCHEN_GROUP_ROLES = ["owner", "admin", "builder", "viewer"] as const;
export type KitchenGroupRole = (typeof KITCHEN_GROUP_ROLES)[number];

/** One of the caller's groups, as GET /v1/kitchen/me/balances reads it. */
export interface MyGroupBalance {
  /** `org_…` */
  orgId: string;
  slug: string;
  name: string;
  currency: string;
  /** The caller's balance in it: Σ paid − Σ owed (positive: they get money back). */
  balanceMinor: number;
  /** The caller's role in it. A `viewer` reads but writes nothing. */
  role: KitchenGroupRole;
  /** People in the group with a group role, the caller included. */
  memberCount: number;
}

/** What one group's settle plan says between the caller and one person. */
export interface PersonGroupNet {
  orgId: string;
  slug: string;
  name: string;
  currency: string;
  /** Positive: they pay you; negative: you pay them; zero: nothing between you in the plan. */
  netMinor: number;
}

export interface PersonBalance {
  /** `usr_…` */
  subjectId: string;
  displayName: string | null;
  /** Every group you share, and any group whose plan still has a payment between you, by name. */
  groups: PersonGroupNet[];
}

/** The caller's money in one currency, across every group that counts in it. */
export interface CurrencyTotal {
  currency: string;
  /** What the plans say others pay you. */
  owedToYouMinor: number;
  /** What the plans say you pay others. */
  youOweMinor: number;
  /** owedToYouMinor − youOweMinor: the sum of your balances in those groups. */
  netMinor: number;
}

/**
 * GET /v1/kitchen/me/balances — the caller's groups (by name) with their
 * balance, role and member count; everyone they share a group with (largest
 * amount first, then by name), with what each group's settle plan says
 * between them — the same numbers Settle up shows; and the totals per
 * currency, in the order the groups first use them.
 */
export interface MyBalancesResponse {
  groups: MyGroupBalance[];
  people: PersonBalance[];
  totals: CurrencyTotal[];
}

/** One transaction line between the caller and the person, from the caller's side. */
export interface PersonLine {
  /** `txn_…` */
  txnId: string;
  kind: KitchenTxnKind;
  title: string;
  occurredAt: string;
  /** Positive: it left them owing you; negative: it left you owing them. */
  signedMinor: number;
  /** A later reversal undid it (that reversal is a line too). */
  reversed: boolean;
  /** For a reversal: the `txn_…` it undoes. */
  reverses: string | null;
}

/**
 * The group shortcut in one step: `from` owes `via` and `via` owes `to`, so
 * the plan has `from` pay `to` directly. `amountMinor` is what `from` owes
 * `via` (their pairwise net in the group).
 */
export interface ShortcutVia {
  fromSubjectId: string;
  viaSubjectId: string;
  toSubjectId: string;
  amountMinor: number;
  /** The display name of whichever of the three is neither you nor the person. */
  thirdDisplayName: string | null;
}

/** "Why · {group}": every amount between the caller and the person in one group. */
export interface PersonGroupView {
  orgId: string;
  slug: string;
  name: string;
  currency: string;
  /** The caller's role in the group (a `viewer` cannot record a payment). */
  role: KitchenGroupRole;
  /** Every line between you two since the group began, newest first. */
  lines: PersonLine[];
  /** Σ lines — what you two owe each other directly. Positive: they owe you. */
  pairwiseMinor: number;
  /** What the group's settle plan asks of you two. Positive: they pay you. */
  planMinor: number;
  /** planMinor − pairwiseMinor: what the group's fewest-payments plan routes through you two. */
  shortcutMinor: number;
  /** One three-person step that explains the shortcut; null when it is zero or no single person explains it. */
  shortcutVia: ShortcutVia | null;
}

/**
 * GET /v1/kitchen/me/people/{usr} — every group the caller shares with the
 * person (or where money is still open between them), by name; 404 when there
 * is none. `totals` adds up `planMinor` per currency.
 */
export interface PersonViewResponse {
  subjectId: string;
  displayName: string | null;
  groups: PersonGroupView[];
  totals: { currency: string; netMinor: number }[];
}

/** One member of a group, as every member sees them. */
export interface KitchenMember {
  /** `usr_…` */
  subjectId: string;
  displayName: string | null;
  role: KitchenGroupRole;
  /** `mem_…`: what `memberships.updateMemberRole` takes. Null until membership-worker reports it. */
  memberId: string | null;
  /** When they joined; null until membership-worker reports it. */
  joinedAt: string | null;
}

/**
 * GET /v1/organizations/{org}/kitchen/members (`kitchen.pantry.read`, so every
 * member, viewers too): who is in the group, oldest first, with names and roles.
 */
export interface GroupMembersResponse {
  members: KitchenMember[];
}

// ── Using things (CP-11) ────────────────────────────────────
//
// Using some of an item, wasting it, moving a personal item into a group, and
// undoing any of that. Every change to what is left of an item is a stock
// move; a move that moves money also posts one ledger transaction, in the
// same write. Using a group item pays its buyer back: the people who had it
// owe the cost (`costOfUse`: proportional to what was paid, and the use that
// takes the last of an item costs exactly what is left of its price, so a
// used-up item has cost exactly its price). Quantities are decimals in a unit
// of the item's dimension; `unit` defaults to the item's own.

/** What a stock move did to an item. `dish` and `adjust` arrive with later tasks. */
export const STOCK_MOVE_KINDS = ["use", "dish", "waste", "transfer", "adjust", "reversal"] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

export interface KitchenStockMove {
  /** `mov_…` */
  id: string;
  /** `itm_…` */
  itemId: string;
  kind: StockMoveKind;
  /** How much moved, in thousandths of the dimension's base unit (always positive). */
  qtyMilli: number;
  /** The same quantity in `unit`. */
  quantity: number;
  /** The unit it was logged in (the item's display unit for a transfer, and for a use given in a measure). */
  unit: string;
  /**
   * The words it was given in, when it was given in one of the item's
   * measures (SM-13): "2 onions", "½ onion" — and on the reversal that puts
   * it back. Null when it was given in a unit, and for moves written before.
   * `quantity` and `unit` are what it took, in the item's own unit. Every
   * answer carries it; optional here only so moves typed before SM-13 check.
   */
  label?: string | null;
  /** What it cost: charged to whoever had it (a group use), shared (split waste), or absorbed. 0 for a transfer. */
  costMinor: number;
  /** Who logged it (`usr_…`). */
  actor: string;
  /** For a use: who had it (`usr_…`), in the order they were named. Null for every other kind. */
  consumers: string[] | null;
  /** The ledger transaction it belongs to (`txn_…`), when it moved money. */
  txnId: string | null;
  /** For a reversal: the `mov_…` it put back. */
  reverses: string | null;
  at: string;
  /** True once a reversal has put it back. */
  undone: boolean;
  /** That reversal's `mov_…`. */
  undoneBy: string | null;
}

/**
 * POST /v1/organizations/{org}/kitchen/items/{itm}/uses (`kitchen.item.use`).
 * `consumers` (default: the caller) are who had it — the caller may log for
 * others — and must be members (422 `not_in_group`). They owe the cost
 * equally, or by `weights` (positive numbers, one per consumer); the odd paisa
 * goes to the earliest named. The buyer is paid back, so a buyer who had some
 * nets their own share to zero; when every consumer is the buyer, the move is
 * recorded and no transaction posted. More than is left is 409
 * `insufficient_stock`, and nothing is written.
 */
export interface UseGroupItemRequest {
  quantity: string | number;
  unit?: string;
  /**
   * Instead of `unit` (both: 422): one of the item's measures, by its `one`
   * (case-insensitive) — `quantity` is then a count of it, halves allowed
   * (see `measureTakeMilli`; SM-13). A word the item's name does not have is
   * 422 `validation_failed` (field `measure`).
   */
  measure?: string;
  consumers?: string[];
  weights?: number[];
}

/** POST /v1/kitchen/me/items/{itm}/uses — a stock move only: a personal pantry has no ledger. */
export interface UsePersonalItemRequest {
  quantity: string | number;
  unit?: string;
  /** Instead of `unit`: one of the item's measures, as on `UseGroupItemRequest`. */
  measure?: string;
}

/**
 * POST /v1/organizations/{org}/kitchen/items/{itm}/waste (`kitchen.item.use`)
 * and POST /v1/kitchen/me/items/{itm}/waste. Without `quantity`, everything
 * left. A group item follows its own waste rule, else the group's:
 * `split_equally` posts a `waste` transaction — the buyer is paid back what
 * the wasted part was worth and every current member owes an equal share —
 * and `buyer_absorbs` (like any personal item) records the move only. Nothing
 * left makes the item `wasted`.
 */
export interface WasteItemRequest {
  quantity?: string | number;
  unit?: string;
}

/**
 * POST /v1/kitchen/me/items/{itm}/transfer — move a personal item into a
 * group's pantry, where the caller holds `kitchen.item.create` (the opaque 404
 * otherwise). Only while nothing of it has been used (409 `item_used`), and
 * only into a group that counts in the item's currency (422
 * `currency_mismatch`). It becomes a group item paid for by the caller,
 * following the group's waste rule; a `transfer` move records it.
 */
export interface TransferItemRequest {
  /** `org_…` */
  orgId: string;
}

/**
 * 201 from every write that moves stock — uses, waste, a transfer and an
 * undo: the item as it is now, the move, and the transaction it posted (null
 * when it moved no money).
 */
export interface StockMoveResponse {
  item: KitchenItem;
  move: KitchenStockMove;
  txn: KitchenTxn | null;
}

export type UseItemResponse = StockMoveResponse;
export type WasteItemResponse = StockMoveResponse;
export type TransferItemResponse = StockMoveResponse;
export type UndoMoveResponse = StockMoveResponse;

/**
 * GET /v1/organizations/{org}/kitchen/items/{itm}/moves (`kitchen.pantry.read`)
 * and GET /v1/kitchen/me/items/{itm}/moves: the item's history, newest first.
 */
export interface MovesQuery {
  /** 1–200, default 50. */
  limit?: number;
}

export interface MovesResponse {
  moves: KitchenStockMove[];
}

/*
 * Undoing a move:
 *   - a move that posted a transaction (a group use, split waste) is undone by
 *     reversing that transaction (POST …/txns/{txn}/reverse): the reversal puts
 *     the stock back in the same write, and the reversal of such a reversal is
 *     409 `not_reversible`;
 *   - POST /v1/kitchen/me/moves/{mov}/undo undoes a personal use or waste;
 *   - POST /v1/organizations/{org}/kitchen/moves/{mov}/undo undoes a group move
 *     that moved no money (a buyer's own use, waste the buyer absorbed): its
 *     logger, or an owner or admin (`kitchen.txn.reverse_any`; 403 `not_creator`).
 * Only the latest move still in effect on the item can be undone (409
 * `not_latest`), and once (409 `already_reversed`); a move with a transaction
 * is 409 `has_transaction`. The answer is the `reversal` move.
 */

/** How far back GET /v1/kitchen/me/usuals looks. */
export const USUALS_DAYS = 90;

/**
 * One item the caller often uses: presets for quick use and "Do it again".
 * Only items with something left that the caller may still use.
 */
export interface KitchenUsual {
  /** `itm_…` */
  itemId: string;
  name: string;
  pantry: PantryRef;
  /** The last use, as it was logged. */
  lastQtyMilli: number;
  lastQuantity: number;
  lastUnit: string;
  /**
   * The words the last use was given in ("2 onions", SM-13); null when it was
   * given in a unit. Every answer carries it; optional here only so usuals
   * typed before SM-13 still check.
   */
  lastLabel?: string | null;
  /** The item's measures, as `KitchenItem.measures` (SM-13). Every answer carries them. */
  measures?: KitchenMeasure[];
  /** Who had it the last time. */
  consumers: string[];
  /** Uses in the last USUALS_DAYS days that the caller logged or was named in. */
  usedCount: number;
  lastUsedAt: string;
  /** What is left now, so "Do it again" can tell whether there is enough. */
  qtyLeftMilli: number;
}

/** GET /v1/kitchen/me/usuals?limit= — most used first, then most recently used. */
export interface UsualsQuery {
  /** 1–50, default 10. */
  limit?: number;
}

export interface UsualsResponse {
  usuals: KitchenUsual[];
}

// ── Your measures (SM-13) ───────────────────────────────────
//
// An item keeps its one stock in the unit it was bought in, and money is
// worked out from that stock as before. A measure is a size in the stock's
// unit — "1 onion ≈ 150 g", "20 slices in a pack" — stored exactly as `count`
// of it making `amountMilli` of the stock (1 onion = 150 000 milli-g; 20
// slices = 1 000 milli-pack). Measures belong to a name (case-insensitive) in
// one pantry, for one dimension: every purchase of Onions in Flat 4B counts
// in the same onions, a personal pantry's Onions in their own. At most
// MAX_MEASURES per name. Anyone who can use an item sets its name's measures
// (`kitchen.item.use` in a group; the owner of a personal pantry):
//
//   PUT /v1/organizations/{org}/kitchen/items/{itm}/measures
//   PUT /v1/kitchen/me/items/{itm}/measures
//
// A use or a dish ingredient may then be given as a count of a measure
// (`measure` instead of `unit`): it takes `measureTakeMilli` of the stock, its
// cost is the engine's proportional cost of that, as for any use, and it keeps
// its words (`label`, "2 onions") on the move and on the dish.

/** The most measures one name has in one pantry and dimension. */
export const MAX_MEASURES = 3;
/** The longest word for a measure (`one`, `many`). */
export const MAX_MEASURE_WORD = 24;
/** The most of a measure one use or ingredient asks for (a count; halves allowed). */
export const MAX_MEASURE_QUANTITY = 10_000;

export interface KitchenMeasure {
  /** `msr_…` */
  id: string;
  /** The word for one ("onion", "slice"). */
  one: string;
  /** The word for more than one ("onions", "slices"). */
  many: string;
  /** How many of it make `amountMilli` (20 slices in a pack: 20). */
  count: number;
  /** What `count` of it amount to, in thousandths of the dimension's base unit (a pack: 1 000). */
  amountMilli: number;
}

/** One measure as a request sets it. */
export interface KitchenMeasureInput {
  /** 1–MAX_MEASURE_WORD characters, trimmed; each `one` once per request (case-insensitive). */
  one: string;
  /** 1–MAX_MEASURE_WORD characters, trimmed. */
  many: string;
  /** A whole number above zero. */
  count: number;
  /** A whole number of thousandths, at least `count` (a measure is at least a thousandth of the unit). */
  amountMilli: number;
}

/**
 * PUT …/items/{itm}/measures (both pantries): replaces the measures of the
 * item's name in its pantry, for its dimension — every item of that name
 * there reads them. 0 to MAX_MEASURES, in the order the app offers them; an
 * empty list removes them. A word kept keeps its `id`. Invalid: 422
 * `validation_failed` with field errors (`measures`, `measures[1].one` …).
 * An item the caller cannot use (a viewer, another group, someone else's own
 * pantry) is the opaque 404.
 */
export interface SetMeasuresRequest {
  measures: KitchenMeasureInput[];
}

/** 200: the name's measures as they now are, in order. */
export interface SetMeasuresResponse {
  measures: KitchenMeasure[];
}

/** Whose item: the caller's own pantry, or a group's (an item's `pantry`, or the app's item ref, fits). */
export type ItemScope = { kind: "personal" } | { kind: "group"; orgId: string };

/** The measure `word` names among `measures` (its `one`, case-insensitively), if any. */
export function findMeasure<M extends Pick<KitchenMeasure, "one">>(measures: readonly M[], word: string): M | undefined {
  const wanted = word.trim().toLowerCase();
  return measures.find((m) => m.one.toLowerCase() === wanted);
}

/** "½", "1", "1½", "2": a count in halves as the words read it. */
function halvesText(halves: number): string {
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1 ? "½" : "";
  return whole === 0 ? half : `${whole}${half}`;
}

/**
 * What a use given in a measure says: "½ onion", "1 onion", "1½ onions",
 * "2 onions" — the word for one up to 1, for many above. `quantity` is a
 * count of the measure, a positive multiple of ½.
 */
export function measureLabel(quantity: number, measure: Pick<KitchenMeasure, "one" | "many">): string {
  const halves = Math.round(quantity * 2);
  return `${halvesText(halves)} ${halves <= 2 ? measure.one : measure.many}`;
}

/** round(n / d), halves up, for non-negative integers. */
function roundDiv(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/**
 * How much of an item a use of `quantity` of `measure` takes, in thousandths
 * of its base unit — or null when that is more than is left (409
 * `insufficient_stock`). `quantity` is a count of the measure, a positive
 * multiple of ½.
 *
 * It takes round(quantity × amountMilli / count), halves up. Rounding each
 * use would leave an item's uses in one measure a few thousandths off what
 * was bought (16 slices of a 1 000 milli-pack take 63 each), so the use that
 * comes within that drift of what is left takes exactly what is left: then
 * the engine's last-use rule charges exactly what is left of the price, and a
 * pack eaten slice by slice costs exactly what was paid. The drift allowed is
 * ½ a thousandth per half-measure the item holds, and never more than a
 * quarter of the measure, so it only ever absorbs rounding — asking for more
 * than is left by more than that is refused.
 */
export function measureTakeMilli(
  quantity: number,
  measure: Pick<KitchenMeasure, "count" | "amountMilli">,
  item: { qtyBoughtMilli: number; qtyLeftMilli: number },
): number | null {
  const halves = BigInt(Math.round(quantity * 2));
  const count = BigInt(measure.count);
  const amount = BigInt(measure.amountMilli);
  const left = BigInt(item.qtyLeftMilli);
  const take = roundDiv(halves * amount, 2n * count);
  // Half-measures the item held × ½ thousandth, rounded up; at most a quarter measure.
  const drift = (BigInt(item.qtyBoughtMilli) * count + amount - 1n) / amount;
  const cap = amount / (4n * count);
  const slack = drift < cap ? drift : cap;
  const gap = take > left ? take - left : left - take;
  if (left > 0n && gap <= slack) return Number(left);
  return take > left ? null : Number(take);
}

/** `qtyMilli` counted in `measure`, to the nearest ½ (halves up): "about 3½ onions left". */
export function inMeasure(qtyMilli: number, measure: Pick<KitchenMeasure, "count" | "amountMilli">): number {
  const halves = roundDiv(BigInt(qtyMilli) * 2n * BigInt(measure.count), BigInt(measure.amountMilli));
  return Number(halves) / 2;
}

// ── From before (SM-8) ──────────────────────────────────────
//
// What the caller bought and cooked before, for the type-ahead on Bought and
// Cook (cookpool-simpler design §3): picking a suggestion fills the form from
// last time. Each read is one database query, so the app can run it as
// someone types.
//
//   GET /v1/kitchen/me/items/history?q=&limit=   names bought before, with last time's details
//   GET /v1/kitchen/me/dishes/recipes?q=&limit=  dishes cooked before, ingredients matched to items usable now
//
// Both group by name case-insensitively (ASCII letters fold; "Milk" and
// "milk" are one name), and the newest record of a name fills its fields.
// Names starting with `q` come first, then names with a word starting with
// it, then names containing it — newest first within each; an empty `q`
// lists the most recent. Only the caller's own pantry and the groups they
// are in are read: nothing from a group they cannot see ever shows.

/** How many suggestions a "from before" read returns by default. */
export const FROM_BEFORE_DEFAULT_LIMIT = 8;
/** The most it returns (`limit`, 1–20). */
export const FROM_BEFORE_MAX_LIMIT = 20;

/** `?q=&limit=` of both reads. */
export interface FromBeforeQuery {
  /** Matched against the name (at most 100 characters; trimmed). */
  q?: string;
  /** 1–FROM_BEFORE_MAX_LIMIT, default FROM_BEFORE_DEFAULT_LIMIT. */
  limit?: number;
}

/** Where something was last time: the caller's own pantry (no `orgId`), or one of their groups (its `org_…`). */
export type FromBeforePantry =
  | { kind: "personal"; orgId: null; name: string }
  | { kind: "group"; orgId: string; name: string };

/**
 * One name bought before, with what the newest record of it said. Every
 * record counts — still there, used up or wasted — except items removed as a
 * mistake and a dish's leftovers (cooked, not bought).
 */
export interface ItemHistoryEntry {
  /** As the newest record spells it. */
  name: string;
  category: string;
  dimension: KitchenDimension;
  /** The unit it was bought in; `quantity` is in it. */
  unit: string;
  /** What was bought last time, in `unit` (three decimals at most). */
  quantity: number;
  /** The same, exactly: thousandths of the dimension's base unit. */
  qtyMilli: number;
  /** What was paid last time. */
  priceMinor: number;
  currency: string;
  /** The pantry it was put in last time. */
  pantry: FromBeforePantry;
  /** Who paid last time (`usr_…`). */
  paidBy: string;
  /** Last time's own waste rule; null when it followed its group (always null for a personal item). */
  wastePolicy: WastePolicy | null;
  /** Days from buying to its use-by date last time (0 or more); null when it had none. */
  useByDays: number | null;
  /** How many times it was bought: the records of this name. */
  times: number;
  /** ISO date it was last bought. */
  lastBoughtOn: string;
}

/** The query of GET /v1/kitchen/me/items/history. */
export type ItemHistoryQuery = FromBeforeQuery;

export interface ItemHistoryResponse {
  items: ItemHistoryEntry[];
}

/**
 * The item an ingredient would come from now: active, with something left,
 * the same name (case-insensitively) and dimension, in the caller's own
 * pantry or a group where they may use items. The one in the pantry it came
 * from last time is preferred, then the one with most left.
 */
export interface RecipeMatch {
  /** `itm_…` */
  itemId: string;
  /** The item page's ref: `me:itm_…` for the caller's own, `org:org_…:itm_…` for a group's. */
  ref: string;
  /** The pantry it is in now. */
  pantry: PantryRef;
  /** What is left of it: compare with the ingredient's `qtyMilli`. */
  qtyLeftMilli: number;
  /** Always true here: only items the caller may use are matched. */
  canUse: boolean;
}

/** One ingredient of the newest dish of a name, in the cook's order. */
export interface RecipeIngredient {
  /** The item's name (as it is now). */
  name: string;
  /** What went in last time: thousandths of the dimension's base unit. */
  qtyMilli: number;
  /** The same, in `unit` (three decimals at most). */
  quantity: number;
  /** The unit it was entered in. */
  unit: string;
  dimension: KitchenDimension;
  /**
   * Where it came from last time, as the caller sees it: their own pantry (a
   * dish they cooked from it), or a group they are in. Null when it came from
   * a pantry they cannot see — another cook's own, or a group they are not in.
   */
  pantry: FromBeforePantry | null;
  /** An item to take it from now; null when there is none ("Not in a pantry · add it"). */
  match: RecipeMatch | null;
}

/**
 * One dish name cooked before: the dishes the caller cooked and those shared
 * with their groups, except canceled ones. The newest dish of the name fills
 * the fields and the ingredients.
 */
export interface Recipe {
  /** As the newest dish spells it. */
  name: string;
  /** How many times it was cooked: the dishes of this name. */
  times: number;
  /** When it was last cooked (ISO instant). */
  lastCookedAt: string;
  /** Portions × 2, last time. */
  portionsHalf: number;
  /** Gas, spices and the like, last time. */
  extrasMinor: number;
  /** What it cost in all last time (ingredients and extras). */
  totalMinor: number;
  /** The currency of `extrasMinor` and `totalMinor`. */
  currency: string;
  /** The group it was last shared with (`org_…`); null for just its cook, or a group the caller is no longer in. */
  orgId: string | null;
  ingredients: RecipeIngredient[];
}

/** The query of GET /v1/kitchen/me/dishes/recipes. */
export type RecipesQuery = FromBeforeQuery;

export interface RecipesResponse {
  recipes: Recipe[];
}

// ── Dishes (CP-14) ──────────────────────────────────────────
//
// A cook makes one dish from their own pantry and any group pantry where they
// hold `kitchen.item.use`, adding what they just bought inline. Cooking takes
// every ingredient's quantity out of its pantry (a `dish` stock move) and, in
// each source group, posts one `use` transaction in which every buyer is paid
// back what their items cost and the cook owes it all — all in one write.
// Ingredients the cook paid for themselves (their own pantry, their own
// purchases in a group) move no money. Every ingredient — and the shared
// group, if any — must count in one currency. Sharing the dish out among its
// eaters (claims, shares, finalize, corrections) is CP-16, below.

/**
 * draft: assign mode, the cook alone decides the shares; open: claims mode,
 * the group's members claim portions; finalized: the dish transaction posted;
 * canceled: every ingredient put back and its charges reversed.
 */
export const DISH_STATES = ["draft", "open", "finalized", "canceled"] as const;
export type KitchenDishState = (typeof DISH_STATES)[number];

/** assign: the cook sets each eater's share; claims: the group's members claim portions (needs a group). */
export const DISH_SPLIT_MODES = ["assign", "claims"] as const;
export type DishSplitMode = (typeof DISH_SPLIT_MODES)[number];

/** The most ingredients one dish takes (existing items and just-bought ones together): one write holds them all. */
export const MAX_DISH_INGREDIENTS = 30;

/** An item from a pantry the cook can use: `quantity` in `unit` (default: the item's own), which must measure what it does. */
export interface CookIngredientRequest {
  /** `itm_…` */
  itemId: string;
  quantity: string | number;
  unit?: string;
  /** Instead of `unit` (both: 422): one of the item's measures, as on a use (SM-13). The ingredient keeps its words (`label`). */
  measure?: string;
}

/**
 * Just bought it: added to the cook's own pantry, paid by them, in the dish's
 * currency, and `useQuantity` of it (in `useUnit`, default `unit`; default all
 * of it) goes into the dish — in the same write.
 */
export interface CookNewItemRequest {
  name: string;
  /** Default "Other". */
  category?: string;
  quantity: string | number;
  unit: string;
  priceMinor: number;
  expiresOn?: string | null;
  useQuantity?: string | number;
  useUnit?: string;
}

/**
 * POST /v1/kitchen/me/dishes — cook. `orgId` (the group it is shared with;
 * null or absent for just the cook) needs `kitchen.dish.cook` there (the
 * opaque 404 otherwise); `claims` needs a group. Every ingredient must be in
 * the cook's own pantry or a group where they hold `kitchen.item.use` (404
 * otherwise), with that much left (409 `insufficient_stock`, `details.itemId`
 * and `qtyLeftMilli`), all in one currency — the shared group's, when there
 * is one (422 `currency_mismatch`, `details.currency` and `itemIds`). At least
 * one ingredient or new item, at most MAX_DISH_INGREDIENTS together. A refusal
 * writes nothing.
 */
export interface CookDishRequest {
  name: string;
  /** `org_…`, or null for just the cook. */
  orgId?: string | null;
  /** Portions × 2 (half portions are allowed); above zero. */
  portionsHalf: number;
  /** Gas, spices and the like, paid by the cook. Default 0. */
  extrasMinor?: number;
  splitMode: DishSplitMode;
  ingredients?: CookIngredientRequest[];
  newItems?: CookNewItemRequest[];
}

export interface KitchenDishIngredient {
  /** `itm_…` */
  itemId: string;
  /** The item's name now. */
  name: string;
  /** The group pantry it came from (`org_…`); null for the cook's own pantry. */
  orgId: string | null;
  /** Who bought it (`usr_…`). */
  paidBy: string;
  qtyMilli: number;
  /** The same quantity in `unit`, the unit it was entered in (the item's own when it was given in a measure). */
  quantity: number;
  unit: string;
  /**
   * The words it was given in, in one of the item's measures ("2 onions",
   * SM-13); null when it was given in a unit. Every answer carries it;
   * optional here only so ingredients typed before SM-13 still check.
   */
  label?: string | null;
  /** What it cost: proportional to its price, the last of an item taking what is left of the price. */
  costMinor: number;
  /** The `use` transaction (`txn_…`) that charged the cook for it; null when nobody else paid for it. */
  useTxnId: string | null;
}

/** What the cook owes one buyer in one group for the ingredients they took. */
export interface DishOwed {
  /** `org_…` */
  orgId: string;
  /** `usr_…` */
  buyerId: string;
  amountMinor: number;
}

export interface KitchenDish {
  /** `dsh_…` */
  id: string;
  /** `usr_…` */
  cook: string;
  /** The group it is shared with (`org_…`); null for just the cook. */
  orgId: string | null;
  name: string;
  portionsHalf: number;
  /** portionsHalf / 2. */
  portions: number;
  extrasMinor: number;
  /** Σ the ingredients' costs. */
  ingredientsMinor: number;
  /** ingredientsMinor + extrasMinor. */
  totalMinor: number;
  currency: string;
  splitMode: DishSplitMode;
  state: KitchenDishState;
  /** The dish transaction once finalized (`txn_…`). */
  txnId: string | null;
  /** The leftovers, as an item (`itm_…`). */
  leftoverItemId: string | null;
  cookedAt: string;
  finalizedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** In the order the cook listed them (existing items, then the ones just bought). */
  ingredients: KitchenDishIngredient[];
  /** What the cook paid for themselves: their own pantry, and their own purchases in a group. */
  fromMineMinor: number;
  /** What the cook owes, per group and buyer, in the order the ingredients name them. fromMineMinor + Σ owes = ingredientsMinor. */
  owes: DishOwed[];
  // ── Splitting it (CP-16) ──
  /** Every eater's share, the cook's first, then in the order they were listed or claimed in. Empty for just the cook. */
  shares: KitchenDishShare[];
  /** The half portions the caller has claimed (or been assigned); 0 when none, or when theirs is an exact amount. */
  myClaimHalf: number;
  /** Σ the shares' half portions. */
  claimedHalf: number;
  /** portionsHalf − claimedHalf: what falls to the cook, and becomes leftovers when finalized. */
  unclaimedHalf: number;
  /** What the unclaimed portions are worth: the part of the cook's share they make up, and the leftovers' price. */
  unclaimedMinor: number;
  /**
   * What each person owes for the dish, the cook's first: the dish
   * transaction's owed side (a preview from the shares until it is
   * finalized; empty once canceled). Σ owedMinor = totalMinor.
   */
  amounts: DishAmount[];
  /**
   * In the group it is shared with: for everyone the dish moves money with
   * (its eaters, and the buyers of what the cook took from that group's
   * pantry), what they owe the cook for the dish minus what the cook owes
   * them for those ingredients. Empty for just the cook, and once canceled.
   */
  netting: DishNet[];
}

/**
 * Which route wrote a share: self, a claim (the eater's own, or since SM-6
 * another member's for them — `setBy` says who); cook, the cook's assignment
 * or a correction.
 */
export const DISH_SHARE_SOURCES = ["cook", "self"] as const;
export type DishShareSource = (typeof DISH_SHARE_SOURCES)[number];

/** One eater's share: half portions or an exact amount, never both. */
export interface KitchenDishShare {
  /** `dsr_…` */
  id: string;
  /** `usr_…` */
  subjectId: string;
  /** Half portions (1 = ½); null for an exact amount. */
  portionsHalf: number | null;
  /** A fixed amount in minor units, taken off the top of the total; null for portions. */
  exactMinor: number | null;
  source: DishShareSource;
  /**
   * Who set it last (`usr_…`, SM-6): the eater, another member setting it
   * for them, or whoever assigned or corrected the shares; null for a share
   * written before SM-6. Every answer carries it; it is optional here only so
   * shares typed before SM-6 still check.
   */
  setBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One person's line in a dish's split. */
export interface DishAmount {
  /** `usr_…` */
  subjectId: string;
  /** Their half portions (the cook's own claim, without the unclaimed ones); null for an exact amount. */
  portionsHalf: number | null;
  exactMinor: number | null;
  /** What they owe for the dish. The cook's includes the unclaimed portions (`unclaimedMinor`). */
  owedMinor: number;
}

/** One person, netted with the cook inside the dish's group. */
export interface DishNet {
  /** `usr_…`, never the cook. */
  subjectId: string;
  /** What they owe the cook for the dish. */
  owesCookMinor: number;
  /** What the cook owes them for their ingredients from the group's pantry. */
  cookOwesMinor: number;
  /** owesCookMinor − cookOwesMinor: positive, they owe the cook; negative, the cook owes them. */
  netMinor: number;
}

/** 201 from POST /v1/kitchen/me/dishes; 200 from GET …/dishes/{dsh} and POST …/dishes/{dsh}/cancel. */
export interface DishResponse {
  dish: KitchenDish;
}

export type CookDishResponse = DishResponse;
export type CancelDishResponse = DishResponse;

/**
 * GET /v1/kitchen/me/dishes (dishes the caller cooked, or shared with a group
 * they are in) and GET /v1/organizations/{org}/kitchen/dishes
 * (`kitchen.pantry.read`: the dishes shared with the group). Newest first.
 */
export interface DishesQuery {
  state?: KitchenDishState;
  cursor?: string;
  /** 1–100, default 25. */
  limit?: number;
}

export interface DishesPage {
  dishes: KitchenDish[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/*
 * GET  /v1/kitchen/me/dishes/{dsh}          its cook, or a member of its group (the opaque 404 otherwise)
 * POST /v1/kitchen/me/dishes/{dsh}/cancel   its cook (403 `not_creator` for a member), while not finalized
 *   (409 `dish_not_open`): every `use` transaction it posted is reversed and every
 *   ingredient's quantity and cost come back, in one write; the dish reads
 *   `canceled`. Cancelling a canceled dish answers it as it is.
 */

// ── Splitting dishes (CP-16) ────────────────────────────────
//
// A dish shared with a group is split among the people who ate it: members
// claim half portions while it is open (claims mode), or the cook assigns
// each eater portions or an exact amount. Finalizing posts ONE `dish`
// transaction in the group: the cook paid the total; each eater owes their
// share — exact amounts off the top, the rest by portions with largest
// remainder rounding, ties going to the cook's own share first and then in
// the order shares were listed or claimed — and the portions nobody had fall
// to the cook (after the eaters, when the cook claimed none), becoming a
// "Leftovers: {dish}" item in the cook's own pantry priced at what they are
// worth. A correction never edits that transaction: it posts its reversal
// and a new dish transaction, in one write, and adjusts the leftovers while
// the cook has not touched them.

/** The most eaters one dish is split between (a group's member cap). */
export const MAX_DISH_SHARES = 50;

/** What leftovers are filed under in the cook's pantry. */
export const LEFTOVERS_CATEGORY = "Leftovers";

/**
 * PUT /v1/organizations/{org}/kitchen/dishes/{dsh}/claims/me
 * (`kitchen.dish.claim`: members, owners and admins — the opaque 404 for a
 * viewer, or a dish not shared with the group). Only while the dish is
 * `open` (409 `dish_not_open`, `details.state`); the claims may not exceed
 * its portions (409 `claims_exceed_portions`). 0 takes the claim back.
 * Answers 200 `{ dish }`.
 */
export interface ClaimDishRequest {
  /** Half portions, 0 … the dish's portionsHalf. */
  portionsHalf: number;
}

/** One eater, for the cook's assignment or a correction: half portions or an exact amount. */
export type DishShareRequest =
  | { subjectId: string; portionsHalf: number; exactMinor?: undefined }
  | { subjectId: string; exactMinor: number; portionsHalf?: undefined };

/**
 * PUT /v1/organizations/{org}/kitchen/dishes/{dsh}/shares — the cook (or
 * `kitchen.dish.finalize_any`: an owner or admin; 403 `not_creator` for
 * another member). Replaces every share, claims included, while the dish is
 * a draft or open (409 `dish_not_open`); the dish's state does not change.
 * Everyone named must be in the group (422 `not_in_group`), once each; the
 * portions must fit (409 `claims_exceed_portions`), the exact amounts the
 * total (422). Answers 200 `{ dish }`.
 */
export interface SetDishSharesRequest {
  shares: DishShareRequest[];
}

/**
 * POST /v1/organizations/{org}/kitchen/dishes/{dsh}/finalize — the cook
 * (`kitchen.dish.finalize`), or `kitchen.dish.finalize_any` for a stuck dish
 * (403 `not_creator` for another member). A draft or open dish, in one write:
 * the dish transaction, the leftovers item when portions went unclaimed, the
 * dish `finalized`. Finalizing a finalized dish answers it as it is; a
 * canceled one is 409 `dish_not_open`. Answers 200 `{ dish }`.
 *
 * POST /v1/kitchen/me/dishes/{dsh}/finalize — the same, on the cook's own
 * route (403 `not_creator` for anyone else who can read the dish): a dish
 * just for its cook is only marked finalized — no transaction, no leftovers;
 * a shared one is finalized as above (`kitchen.dish.finalize` in its group).
 */
export type FinalizeDishResponse = DishResponse;

/**
 * POST /v1/organizations/{org}/kitchen/dishes/{dsh}/correct — the cook or
 * `kitchen.dish.finalize_any`, on a finalized dish (409 `dish_not_open`
 * otherwise). Replaces the shares as `…/shares` does and, in one write,
 * reverses the dish transaction and posts a new one; the leftovers follow
 * while the cook has not touched them. Answers 200 `{ dish }`.
 */
export interface CorrectDishRequest {
  shares: DishShareRequest[];
  /** Why, for the reversal's note. */
  note?: string | null;
}

export type ClaimDishResponse = DishResponse;
export type SetDishSharesResponse = DishResponse;
export type CorrectDishResponse = DishResponse;

// ── Anyone's portion (SM-6) ─────────────────────────────────
//
// Any member of a dish's group sets any member's portion of an open dish,
// under the same guard as a claim: never more than the portions. The row
// records who set it (`KitchenDishShare.setBy`), the latest write wins, and
// the person whose portion someone else set is emailed once per dish
// (`kitchen.portion_set`).

/**
 * PUT /v1/organizations/{org}/kitchen/dishes/{dsh}/claims/{subjectId}
 * (`kitchen.dish.claim`: members, owners and admins — the opaque 404 for a
 * viewer, or a dish not shared with the group). `subjectId` is a `usr_…`
 * id, or `me` (the caller: `…/claims/me` is the same route). Only while the
 * dish is `open` (409 `dish_not_open`, `details.state`); everyone's portions
 * may not exceed the dish's (409 `claims_exceed_portions`, with
 * `details.availableHalf`: what the others leave free for this person);
 * the person must be a current member of the group, viewers included (422
 * `not_in_group`, `details.subjectIds`). 0 takes their portion back.
 * Answers 200 `{ dish }`; `myClaimHalf` is still the caller's.
 */
export type SetPortionRequest = ClaimDishRequest;
export type SetPortionResponse = DishResponse;

// ── Emails (CP-18) ──────────────────────────────────────────
//
// kitchen-worker asks notifications-worker to send Cookpool's emails — three
// from CP-18, the portion someone else set for you from SM-6, and a payment
// to you from PW-5 —
// (POST /v1/notifications over its NOTIFICATIONS_WORKER binding, through
// `@saas/notifications-client`), always after the write that causes them has
// committed and never failing the request; notifications-worker's template
// registry renders them. Each is sent to one person, tagged with their
// subject id, under the `product` category: opting out of product email for
// a group stops that group's dish, logged-for-you, portion and payment emails, and opting out
// under the system organization stops the daily digest. Every enqueue
// carries an idempotency key that names what it is about (the day, the dish,
// the transaction) and the recipient, so a re-run or a retried request
// sends nothing twice. Three of them — the portion, the dish to claim and the
// payment — also go out as Web Push (PW-5) to each device of a person who
// turned that kind on (`@saas/contracts/notifications` NOTIFICATION_KINDS):
// notifications-worker sends it with the email's enqueue, under its key.
//
// templateData is a flat map of strings, numbers and null: amounts arrive
// already formatted ("₹240.00"), links absolute, and the digest's items as
// numbered keys (`item1Name`, `item1Pantry`, `item1UseBy`, …).

export const KITCHEN_EMAILS = {
  /** The daily digest: what you can use that is close to its use-by date. */
  USE_SOON: "kitchen.use_soon",
  /** A dish shared with your group for claims. */
  DISH_POSTED: "kitchen.dish_posted",
  /** Someone else logged a use or an expense that names you. */
  LOGGED_FOR_YOU: "kitchen.logged_for_you",
  /** Someone else said you had a portion of a dish (SM-6). */
  PORTION_SET: "kitchen.portion_set",
  /** Someone recorded a payment to you (PW-5). */
  PAID_YOU: "kitchen.paid_you",
} as const;

export type KitchenEmail = (typeof KITCHEN_EMAILS)[keyof typeof KITCHEN_EMAILS];

/** The notifications category every kitchen email is sent under. */
export const KITCHEN_EMAIL_CATEGORY = "product";

/**
 * The digest lists the items whose use-by date is today through this many
 * days ahead (design.md §8: "within two days of use-by"). The app's own
 * "use soon" filter looks USE_SOON_DAYS ahead.
 */
export const USE_SOON_EMAIL_DAYS = 2;

/** At most this many items are listed in one digest, soonest first; the rest are counted. */
export const USE_SOON_EMAIL_MAX_ITEMS = 10;

export type KitchenEmailData = Record<string, string | number | boolean | null>;

/** One item in the digest. */
export interface UseSoonEmailItem {
  name: string;
  /** "My pantry", or the group's name. */
  pantry: string;
  /** The use-by date (YYYY-MM-DD). */
  useBy: string;
}

/** `kitchen.use_soon`: one person's digest for one day. */
export interface UseSoonEmail {
  /** The person's name; null when they have none to show. */
  recipientName: string | null;
  /** The UTC day the digest is for (YYYY-MM-DD): "today" in the email. */
  date: string;
  /** How many items are in the window, listed or not. */
  count: number;
  /** At most USE_SOON_EMAIL_MAX_ITEMS of them, soonest first. */
  items: UseSoonEmailItem[];
  /** The app's Home, where they can use them. */
  homeUrl: string;
}

/** The digest as templateData: the items become numbered keys, 1-based. */
export function useSoonEmailData(email: UseSoonEmail): KitchenEmailData {
  const data: KitchenEmailData = {
    recipientName: email.recipientName,
    date: email.date,
    count: email.count,
    listed: Math.min(email.items.length, USE_SOON_EMAIL_MAX_ITEMS),
    homeUrl: email.homeUrl,
  };
  email.items.slice(0, USE_SOON_EMAIL_MAX_ITEMS).forEach((item, i) => {
    data[`item${i + 1}Name`] = item.name;
    data[`item${i + 1}Pantry`] = item.pantry;
    data[`item${i + 1}UseBy`] = item.useBy;
  });
  return data;
}

/** The digest back from templateData; missing or malformed fields read as empty. */
export function readUseSoonEmail(data: KitchenEmailData): UseSoonEmail {
  const text = (key: string): string => {
    const v = data[key];
    return v === null || v === undefined ? "" : String(v);
  };
  const whole = (key: string): number => {
    const n = Number(data[key]);
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const listed = Math.min(whole("listed"), USE_SOON_EMAIL_MAX_ITEMS);
  const items: UseSoonEmailItem[] = [];
  for (let i = 1; i <= listed; i++) {
    const name = text(`item${i}Name`);
    if (name) items.push({ name, pantry: text(`item${i}Pantry`), useBy: text(`item${i}UseBy`) });
  }
  const name = text("recipientName").trim();
  return {
    recipientName: name || null,
    date: text("date"),
    count: Math.max(whole("count"), items.length),
    items,
    homeUrl: text("homeUrl"),
  };
}

/** `kitchen.dish_posted`: a dish someone in your group cooked, open for claims. */
export interface DishPostedEmail extends KitchenEmailData {
  /** The cook's name; null when they have none to show. */
  cookName: string | null;
  dishName: string;
  groupName: string;
  /** Portions, half portions as "½" ("4", "2½"). */
  portions: string;
  /** What the dish cost in all, formatted ("₹240.00"). */
  total: string;
  /** The dish in the app, where they claim. */
  dishUrl: string;
}

/** `kitchen.logged_for_you`: a use or an expense someone else logged that names you. */
export interface LoggedForYouEmail extends KitchenEmailData {
  kind: "use" | "expense";
  /** Who logged it; null when they have none to show. */
  actorName: string | null;
  /** "250 ml of Milk" for a use; the expense's title. */
  what: string;
  groupName: string;
  /** The transaction's total, formatted. */
  total: string;
  /** What the recipient owes in it, formatted; null when nothing. */
  yourShare: string | null;
  /** What it says the recipient paid, formatted; null when nothing. */
  youPaid: string | null;
  /** The group in the app, where its activity is. */
  groupUrl: string;
}

/**
 * `kitchen.portion_set` (SM-6): another member set your portion of an open
 * dish — "Anu said you had 1 portion of Egg fried rice". Once per dish and
 * person (`kitchen.portion_set:<dsh>:<usr>`), however often it changes after.
 */
export interface PortionSetEmail extends KitchenEmailData {
  /** Who set it; null when they have none to show. */
  actorName: string | null;
  dishName: string;
  groupName: string;
  /** Your portions, half portions as "½" ("1", "1½"). */
  portions: string;
  /** What those portions cost you at the dish's price, formatted; null when nothing. */
  yourShare: string | null;
  /** The dish in the app, where you can change it. */
  dishUrl: string;
}

/**
 * `kitchen.paid_you` (PW-5): someone recorded a payment to you —
 * "Dev paid you ₹400.00 · UPI". Sent to the person paid, once per payment
 * (`kitchen.paid_you:<txn>:<usr>`), after it is recorded; never when the
 * person paid recorded it themselves.
 */
export interface PaidYouEmail extends KitchenEmailData {
  /** Who paid; null when they have none to show. */
  payerName: string | null;
  /** The amount, formatted ("₹400.00"). */
  amount: string;
  /** How it was paid, as people say it ("UPI", "Cash", "Bank transfer"); null when not said. */
  method: string | null;
  groupName: string;
  /** The payer's page in the app, where what is between you two is. */
  personUrl: string;
}

// ── The Home inbox (CP-19) ──────────────────────────────────
//
// GET /v1/kitchen/me/inbox — everything that needs the caller, in one read,
// each item carrying what the app needs to draw its card and run its one-tap
// action without another read:
//
//   claim_dish     a dish open for claims in a group where the caller's role
//                  may claim (`kitchen.dish.claim`), that they did not cook,
//                  have no share of yet, and that still has portions free —
//                  PUT …/dishes/{dsh}/claims/me
//   finalize_dish  the caller's own dish, open (claims) or a draft (assigned),
//                  in no group or in a group where their role may finalize
//                  (`kitchen.dish.finalize`) — POST /v1/kitchen/me/dishes/{dsh}/finalize
//   use_soon       an item the caller may use (their own pantry, or a group
//                  whose role holds `kitchen.item.use`) with something left and
//                  a use-by date from INBOX_EXPIRED_DAYS ago to
//                  INBOX_USE_SOON_DAYS ahead; at most INBOX_USE_SOON_MAX,
//                  soonest first — POST …/items/{itm}/uses with `usual`
//   payment_due    a payment the caller owes in a group's settle plan —
//                  POST …/settlements (when `canRecord`)
//   flag           an open flag someone else raised on a transaction the
//                  caller logged, while it is not reversed — POST …/txns/{txn}/reverse
//                  (or cancel the dish, `dishId`, for a dish's charge)
//
// Only groups membership says the caller is in are read, so nothing from a
// group they cannot see is ever listed.
//
// Order: most urgent first, then by time —
//   1. use_soon whose use-by is today or past (soonest first, then by name)
//   2. claim_dish (oldest cooked first: it has waited longest)
//   3. finalize_dish (oldest cooked first)
//   4. use_soon in the days ahead (soonest first, then by name)
//   5. payment_due (largest first, then by group name)
//   6. flag (oldest first)

export const INBOX_KINDS = ["claim_dish", "finalize_dish", "use_soon", "payment_due", "flag"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** use_soon looks this many days past today: the daily digest's window ("within two days of use-by"). */
export const INBOX_USE_SOON_DAYS = USE_SOON_EMAIL_DAYS;
/** …and this many days back: something just past its date is still worth a look. */
export const INBOX_EXPIRED_DAYS = 2;
/** At most this many use_soon items, soonest first. */
export const INBOX_USE_SOON_MAX = 10;

/** A dish as an inbox card shows it: a claim_dish or a finalize_dish. */
export interface InboxDish {
  /** `dsh_…` */
  id: string;
  /** The group it is shared with (`org_…`); null for a dish just for its cook. */
  orgId: string | null;
  groupName: string | null;
  groupSlug: string | null;
  name: string;
  /** `usr_…` */
  cook: string;
  /** The cook's name; null when they have none to show. */
  cookName: string | null;
  /** open: claims mode; draft: assigned, waiting for its cook's shares. */
  state: Extract<KitchenDishState, "draft" | "open">;
  splitMode: DishSplitMode;
  /** Portions × 2. */
  portionsHalf: number;
  /** Half portions claimed (or assigned) so far. */
  claimedHalf: number;
  /** Half portions nobody has yet. */
  unclaimedHalf: number;
  /** What one whole portion costs at the dish's price (the engine's largest-remainder share of the total). */
  perPortionMinor: number;
  totalMinor: number;
  currency: string;
  cookedAt: string;
}

export interface ClaimDishInboxItem {
  kind: "claim_dish";
  dish: InboxDish;
}

export interface FinalizeDishInboxItem {
  kind: "finalize_dish";
  dish: InboxDish;
}

/** An item close to its use-by date, as a use_soon card shows it. */
export interface InboxItemSummary {
  /** `itm_…` */
  id: string;
  /** The item page's ref: `me:itm_…` for the caller's own, `org:org_…:itm_…` for a group's. */
  ref: string;
  name: string;
  pantry: PantryRef;
  /** The group whose pantry it is in; null for the caller's own. */
  orgId: string | null;
  qtyLeftMilli: number;
  /** What is left, in `unit` (three decimals at most). */
  quantity: number;
  /** The item's display unit. */
  unit: string;
  /** YYYY-MM-DD. */
  expiresOn: string;
  /** Days from today (UTC) to the use-by date: negative once it has passed. */
  daysToUseBy: number;
  /** Always true here: only items the caller may use are listed. */
  canUse: boolean;
}

/** How much the caller used last time (their usuals, CP-11), for a one-tap "use the usual". */
export interface InboxUsual {
  /** In `unit`. */
  quantity: number;
  unit: string;
  /** The same amount in thousandths of the item's base unit: compare with `qtyLeftMilli` to see if it still fits. */
  qtyMilli: number;
}

export interface UseSoonInboxItem {
  kind: "use_soon";
  item: InboxItemSummary;
  /** Null when the caller has not used it in the last USUALS_DAYS. */
  usual: InboxUsual | null;
}

export interface PaymentDueInboxItem {
  kind: "payment_due";
  orgId: string;
  groupName: string;
  groupSlug: string;
  /** `usr_…` the plan has the caller pay. */
  toSubjectId: string;
  toName: string | null;
  amountMinor: number;
  currency: string;
  /** May the caller record the payment (`kitchen.settlement.create`)? Viewers may not. */
  canRecord: boolean;
}

export interface FlagInboxItem {
  kind: "flag";
  /** `flg_…` */
  flagId: string;
  /** `txn_…`: the caller's transaction. */
  txnId: string;
  orgId: string;
  groupName: string;
  groupSlug: string;
  /** The transaction's title. */
  title: string;
  txnKind: KitchenTxnKind;
  totalMinor: number;
  currency: string;
  /** For a dish's charge, the dish (`dsh_…`): it is undone by cancelling or correcting the dish, not by a reversal. */
  dishId: string | null;
  /** `usr_…` who flagged it. */
  flaggedBy: string;
  flaggedByName: string | null;
  /** What they said (the flag's reason). */
  reason: string;
  flaggedAt: string;
}

export type InboxItem =
  | ClaimDishInboxItem
  | FinalizeDishInboxItem
  | UseSoonInboxItem
  | PaymentDueInboxItem
  | FlagInboxItem;

/** How many of each kind `items` lists, and all of them. */
export type InboxCounts = { total: number } & Record<InboxKind, number>;

export interface InboxResponse {
  items: InboxItem[];
  counts: InboxCounts;
}

// ── A person's balance, service-internal (CP-19) ────────────
//
// GET /v1/internal/kitchen/organizations/{org}/subjects/{usr}/balance — for
// membership-worker only, over its KITCHEN_WORKER service binding: leaving a
// group is refused while this is not zero (`balance_not_settled`). The caller
// names itself in KITCHEN_INTERNAL_ACTOR_HEADER; anyone else gets the plain
// "route not found". api-edge does not route /v1/internal/…, and
// kitchen-worker has no public URL. `{org}` is the `org_…` id (or the UUID).

export const KITCHEN_INTERNAL_ACTOR_HEADER = "x-internal-actor";
/** The workers that may call kitchen-worker's internal routes. */
export const KITCHEN_INTERNAL_ACTORS = ["membership-worker"] as const;
export type KitchenInternalActor = (typeof KITCHEN_INTERNAL_ACTORS)[number];

export interface SubjectBalanceResponse {
  /** Σ paid − Σ owed over the group's whole ledger: positive, they are owed; negative, they owe; 0 for no money at all. */
  balanceMinor: number;
  /** The group's currency (INR until its settings are first saved). */
  currency: string;
}
