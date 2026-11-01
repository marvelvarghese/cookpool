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
}

/** GET /v1/organizations/{org}/kitchen/items (`kitchen.pantry.read`): one group's pantry. */
export type GroupItemsQuery = Omit<ItemsQuery, "pantry">;

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
}

export interface SearchItemsResponse {
  items: KitchenItem[];
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
