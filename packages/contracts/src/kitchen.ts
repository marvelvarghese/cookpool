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
  /** 409 `conflict`: the dish is finalized (`details.state`), so it can no longer be canceled. */
  DISH_NOT_OPEN: "dish_not_open",
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
  /** The unit it was logged in (the item's display unit for a transfer). */
  unit: string;
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
  consumers?: string[];
  weights?: number[];
}

/** POST /v1/kitchen/me/items/{itm}/uses — a stock move only: a personal pantry has no ledger. */
export interface UsePersonalItemRequest {
  quantity: string | number;
  unit?: string;
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
// eaters (claims, shares, finalize) arrives with CP-16.

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
  /** The same quantity in `unit`, the unit it was entered in. */
  quantity: number;
  unit: string;
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
