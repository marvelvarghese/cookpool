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
