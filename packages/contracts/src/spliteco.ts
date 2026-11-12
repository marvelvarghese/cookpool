// Spliteco contract types (epic cookpool-spliteco, SE1).
//
// Spliteco is served by `apps/spliteco-worker` behind `api-edge` under
// `/v1/spliteco/…`. It reads and writes the same group ledger Cookpool does
// (`kitchen_txns`, `kitchen_txn_splits`), so every amount is integer minor
// units (paise for INR) in the group's one currency, and a group is a
// membership organization (`org_…`). Money is never summed across currencies:
// every total that spans groups is a list with one entry per currency.

// ── Policy actions ──────────────────────────────────────────

/** Every Spliteco policy action (design §2). Reading is every group role; writing is every role but viewer. */
export const SPLITECO_ACTIONS = ["spliteco.ledger.read", "spliteco.expense.write"] as const;

export type SplitecoAction = (typeof SPLITECO_ACTIONS)[number];

// ── Groups ──────────────────────────────────────────────────

/** Where a group was made: Cookpool kitchens are `cookpool`, groups made in Spliteco `spliteco` (design §0.4). */
export const SPLITECO_MADE_IN = ["cookpool", "spliteco"] as const;
export type SplitecoMadeIn = (typeof SPLITECO_MADE_IN)[number];

/** What kind of group it is. `direct` is the hidden two-person group of friends outside any group (design §0.5). */
export const SPLITECO_GROUP_KINDS = ["kitchen", "trip", "home", "couple", "other", "direct"] as const;
export type SplitecoGroupKind = (typeof SPLITECO_GROUP_KINDS)[number];

/** The kinds a person may pick when they make a group in Spliteco. */
export const SPLITECO_CREATE_KINDS = ["trip", "home", "couple", "other"] as const;
export type SplitecoCreateKind = (typeof SPLITECO_CREATE_KINDS)[number];

// ── Expenses ────────────────────────────────────────────────

/** An expense's category; it colours the row and feeds Insights. */
export const SPLITECO_CATEGORIES = [
  "food",
  "groceries",
  "stay",
  "transport",
  "shopping",
  "entertainment",
  "bills",
  "other",
] as const;
export type SplitecoCategory = (typeof SPLITECO_CATEGORIES)[number];

/** The six ways to split (design §3): equally, exact amounts, percentages, shares, equal plus adjustments, item by item. */
export const SPLITECO_SPLIT_METHODS = ["equal", "exact", "pct", "shares", "adjust", "items"] as const;
export type SplitecoSplitMethod = (typeof SPLITECO_SPLIT_METHODS)[number];

/** How a person's part of one item is measured. */
export const SPLITECO_ITEM_SHARE_MODES = ["portion", "pct", "exact"] as const;
export type SplitecoItemShareMode = (typeof SPLITECO_ITEM_SHARE_MODES)[number];

/** What is added to (tax, service) or taken off (discount) an itemized bill. */
export const SPLITECO_ADJUSTMENT_KINDS = ["tax", "service", "discount"] as const;
export type SplitecoAdjustmentKind = (typeof SPLITECO_ADJUSTMENT_KINDS)[number];

/** A deleted expense can be restored for this many days (design §0.6). */
export const SPLITECO_RESTORE_DAYS = 30;

/** A portion's value is stored ×1000 (½ is 500, 2 is 2000). */
export const SPLITECO_PORTION_SCALE = 1000;

/** A percentage is stored in basis points (25% is 2500, 100% is 10000). */
export const SPLITECO_PCT_SCALE = 10000;

export const SPLITECO_LIMITS = {
  /** People on one expense (payers and sharers together). */
  people: 100,
  /** Items on one itemized bill. */
  items: 200,
  /** Adjustments (tax, service, discount lines) on one bill. */
  adjustments: 10,
  title: 200,
  note: 500,
  itemName: 120,
  comment: 1000,
  groupName: 100,
} as const;

// ── Error reasons ───────────────────────────────────────────
//
// ERROR_CODES are pinned; Spliteco's outcomes ride on an existing code with
// `details.reason` set to one of these.

export const SPLITECO_ERROR_REASONS = {
  /** 409 `conflict`: Cookpool posted this; it is edited, deleted and moved in Cookpool only. */
  OWNED_BY_COOKPOOL: "owned_by_cookpool",
  /** 409 `conflict`: not everyone on the expense is a member of the group it would move to (`details.subjectIds`). */
  NOT_MEMBERS: "not_members",
  /** 422 `validation_failed`: someone named is not a member of the group (`details.subjectIds`). */
  NOT_IN_GROUP: "not_in_group",
  /** 422 `validation_failed`: the split does not add up to the total (`details.problems`). */
  DOES_NOT_ADD_UP: "does_not_add_up",
  /** 409 `conflict`: this version was edited, deleted or moved since; open the current one (`details.currentId`). */
  NOT_CURRENT: "not_current",
  /** 409 `conflict`: only a deleted expense can be restored. */
  NOT_DELETED: "not_deleted",
  /** 409 `conflict`: it was deleted more than SPLITECO_RESTORE_DAYS days ago. */
  RESTORE_EXPIRED: "restore_expired",
  /** 409 `conflict`: it is already in that group. */
  SAME_GROUP: "same_group",
  /** 409 `conflict`: settlements, uses and dishes are not expenses Spliteco edits. */
  NOT_AN_EXPENSE: "not_an_expense",
  /** 422 `validation_failed`: an amount names a currency other than the group's. */
  CURRENCY_MISMATCH: "currency_mismatch",
  /** 409 `conflict`: the Idempotency-Key already posted something different. */
  IDEMPOTENCY_KEY_REUSED: "idempotency_key_reused",
  /** 404-free refusal, 403 `forbidden`: you share no group with this person, so you cannot split with them outside one. */
  NO_SHARED_GROUP: "no_shared_group",
} as const;

export type SplitecoErrorReason = (typeof SPLITECO_ERROR_REASONS)[keyof typeof SPLITECO_ERROR_REASONS];

// ── Shared shapes ───────────────────────────────────────────

/** An amount in one currency. Lists of these never mix currencies in one entry. */
export interface SplitecoMoney {
  currency: string;
  amountMinor: number;
}

/** A person as Spliteco shows them. `name` is null when identity has none to show. */
export interface SplitecoPerson {
  subjectId: string;
  name: string | null;
}

/**
 * Which balance a row counts toward (design §0.11). Every kitchen group keeps
 * two: `kitchen` (everything Cookpool posts, shown in both apps) and `other`
 * (anything added in Spliteco, shown only in Spliteco). Groups made in
 * Spliteco have only `other`.
 */
export const SPLITECO_BUCKETS = ["kitchen", "other"] as const;
export type SplitecoBucket = (typeof SPLITECO_BUCKETS)[number];

export interface SplitecoGroupSummary {
  /** `org_…`. */
  id: string;
  name: string;
  kind: SplitecoGroupKind;
  madeIn: SplitecoMadeIn;
  /** The caller's role there: owner | admin | builder | viewer. */
  role: string;
  /** The group's ledger currency (INR until its first money write fixes it). */
  currency: string;
  /** Members holding a group role. */
  memberCount: number;
  /** The caller's balance there: positive gets money back. */
  myBalanceMinor: number;
  /**
   * Simplified, from the settle plan: who pays the caller (+) and whom the
   * caller pays (−), largest first.
   */
  myPlan: { subjectId: string; amountMinor: number }[];
  /**
   * For a group made in Cookpool: the caller's balance in each bucket
   * (Σ = myBalanceMinor). Null for groups made in Spliteco, which have one.
   */
  myBuckets: { kitchen: number; other: number } | null;
}

// ── Writing an expense ──────────────────────────────────────

export interface SplitecoPayerInput {
  subjectId: string;
  amountMinor: number;
}

export interface SplitecoItemShareInput {
  subjectId: string;
  mode: SplitecoItemShareMode;
  /** portion ×1000, basis points, or paise (see SPLITECO_PORTION_SCALE, SPLITECO_PCT_SCALE). */
  value: number;
}

export interface SplitecoItemInput {
  name: string;
  /** How many were on the bill (1 when left out). */
  qty?: number;
  /** The price of one, when the bill says it. */
  unitMinor?: number | null;
  totalMinor: number;
  shares: SplitecoItemShareInput[];
}

export interface SplitecoAdjustmentInput {
  kind: SplitecoAdjustmentKind;
  /** What the bill calls it ("GST 5%"). */
  label: string;
  /** Always positive; a discount is taken off. */
  amountMinor: number;
}

export type SplitecoSplitInput =
  | { method: "equal"; participants: string[] }
  | { method: "exact"; participants: { subjectId: string; amountMinor: number }[] }
  | { method: "pct"; participants: { subjectId: string; basisPoints: number }[] }
  | { method: "shares"; participants: { subjectId: string; shares: number }[] }
  | { method: "adjust"; participants: { subjectId: string; adjustMinor: number }[] }
  | { method: "items"; items: SplitecoItemInput[]; adjustments: SplitecoAdjustmentInput[] };

/** POST /groups/{org}/expenses and PUT /expenses/{txn}. */
export interface SplitecoExpenseRequest {
  title: string;
  totalMinor: number;
  /** When given, must be the group's currency. */
  currency?: string;
  category?: SplitecoCategory | null;
  /** ISO 8601; now when left out. */
  occurredAt?: string;
  note?: string | null;
  payers: SplitecoPayerInput[];
  split: SplitecoSplitInput;
}

// ── Reading expenses ────────────────────────────────────────

/** What a ledger row is, as Spliteco shows it. */
export type SplitecoTxnKind = "expense" | "use" | "dish" | "waste" | "settlement";

export interface SplitecoExpenseSummary {
  /** `txn_…` of this version. */
  id: string;
  /** `org_…`. */
  groupId: string;
  groupName: string;
  kind: SplitecoTxnKind;
  /** Which app posted it. Cookpool's rows are read-only here. */
  app: "cookpool" | "spliteco";
  /** The balance it counts toward. */
  bucket: SplitecoBucket;
  title: string;
  category: SplitecoCategory | null;
  /** How it was split, when Spliteco posted it. */
  method: SplitecoSplitMethod | null;
  totalMinor: number;
  currency: string;
  occurredAt: string;
  createdAt: string;
  createdBy: string;
  payers: { subjectId: string; paidMinor: number }[];
  /** Everyone on it, as the ledger holds them. */
  splits: { subjectId: string; paidMinor: number; owedMinor: number }[];
  /** The caller's paid − owed on it: positive is lent, negative borrowed. */
  myNetMinor: number;
  /** Edit, delete and move are not offered (Cookpool's rows, settlements). */
  locked: boolean;
  /** The assistant that made it, when one did (SE5). */
  viaDelegation: string | null;
}

export interface SplitecoItemShare {
  subjectId: string;
  mode: SplitecoItemShareMode;
  value: number;
  /** What this works out to, in minor units. */
  amountMinor: number;
}

export interface SplitecoItem {
  position: number;
  name: string;
  qty: number;
  unitMinor: number | null;
  totalMinor: number;
  shares: SplitecoItemShare[];
}

export interface SplitecoAdjustment {
  kind: SplitecoAdjustmentKind;
  label: string;
  amountMinor: number;
}

export interface SplitecoComment {
  /** `cmt_…`. */
  id: string;
  txnId: string;
  subjectId: string;
  body: string;
  createdAt: string;
}

export type SplitecoHistoryAction = "added" | "edited" | "deleted" | "restored" | "moved";

export interface SplitecoHistoryEntry {
  action: SplitecoHistoryAction;
  at: string;
  by: string;
  /** The version this step made (the reversal for a delete). */
  txnId: string;
  groupId: string;
  totalMinor: number;
}

export type SplitecoExpenseState = "current" | "replaced" | "deleted" | "reversed";

export interface SplitecoExpenseDetail extends SplitecoExpenseSummary {
  note: string | null;
  state: SplitecoExpenseState;
  /** When state is `deleted`: when, and until when it can be restored. */
  deletedAt: string | null;
  restorableUntil: string | null;
  /** When state is `replaced`: the current version's id. */
  currentId: string | null;
  /** The per-person breakdown: each person's items, adjustments and share. */
  breakdown: { subjectId: string; itemsMinor: number; adjustmentsMinor: number; owedMinor: number; paidMinor: number }[];
  /** The request it was saved from (to prefill an edit); null for Cookpool's rows. */
  input: SplitecoExpenseRequest | null;
  items: SplitecoItem[];
  adjustments: SplitecoAdjustment[];
}

export interface SplitecoExpenseResponse {
  expense: SplitecoExpenseDetail;
  comments: SplitecoComment[];
  history: SplitecoHistoryEntry[];
  people: SplitecoPerson[];
  /** Can the caller edit, delete, move and restore it? */
  canWrite: boolean;
}

/** The answer to a create, edit, delete, restore or move: the version now in effect (the reversal for a delete). */
export interface SplitecoWriteResponse {
  expense: SplitecoExpenseSummary;
}

export interface SplitecoMoveRequest {
  /** `org_…` of the group it goes to. */
  toGroupId: string;
}

export interface SplitecoCommentRequest {
  body: string;
}

export interface SplitecoCommentResponse {
  comment: SplitecoComment;
}

// ── Home, groups, friends ───────────────────────────────────

export interface SplitecoFriendBalance extends SplitecoPerson {
  /** Positive: they owe the caller. One entry per currency they share money in. */
  balances: SplitecoMoney[];
  /** Names of the groups shared with them (not the hidden direct one). */
  groupNames: string[];
  /** They share an expense outside any group with the caller. */
  outsideGroups: boolean;
}

export interface SplitecoHomeResponse {
  me: SplitecoPerson;
  /** Per currency: owed to the caller, the caller owes, and the net. */
  totals: { currency: string; owedToYouMinor: number; youOweMinor: number; netMinor: number }[];
  /** Everyone the caller has money with, largest first. */
  people: SplitecoFriendBalance[];
}

export interface SplitecoGroupsResponse {
  /** Every group the caller is in, kitchens included; never the hidden direct ones. */
  groups: SplitecoGroupSummary[];
  /** Everyone the caller shares a group with. */
  friends: SplitecoFriendBalance[];
}

export interface SplitecoCreateGroupRequest {
  name: string;
  kind: SplitecoCreateKind;
}

export interface SplitecoCreateGroupResponse {
  group: SplitecoGroupSummary;
}

export interface SplitecoGroupResponse {
  group: SplitecoGroupSummary;
  members: (SplitecoPerson & { role: string })[];
  /** Everyone's balance (members and anyone else still on the ledger), largest first. */
  balances: { subjectId: string; balanceMinor: number }[];
  /** The fewest payments that settle the group (within each bucket, summed, for a Cookpool-made group). */
  plan: { fromSubjectId: string; toSubjectId: string; amountMinor: number }[];
  /**
   * For a group made in Cookpool: each bucket's balances and plan, worked out
   * on its own rows with the same engine functions. `kitchen` equals what
   * Cookpool shows for the group's kitchen money. Null for Spliteco's groups.
   */
  buckets: {
    bucket: SplitecoBucket;
    balances: { subjectId: string; balanceMinor: number }[];
    plan: { fromSubjectId: string; toSubjectId: string; amountMinor: number }[];
    myBalanceMinor: number;
  }[] | null;
  /** Σ of the current expenses (not settlements). */
  totalSpentMinor: number;
  /** Current rows, newest first. */
  expenses: SplitecoExpenseSummary[];
  /** People named on the rows who are not members any more. */
  people: SplitecoPerson[];
  canWrite: boolean;
}

export interface SplitecoFriendResponse {
  friend: SplitecoPerson;
  /** Positive: they owe the caller. One entry per currency. */
  balances: SplitecoMoney[];
  /** The balance group by group (the hidden direct group reads as "Outside groups"). */
  byGroup: { groupId: string; groupName: string; kind: SplitecoGroupKind; currency: string; amountMinor: number }[];
  /** `org_…` of the two-person group outside any group, once it exists. */
  directGroupId: string | null;
  /** Current rows that name both, newest first. */
  expenses: SplitecoExpenseSummary[];
}

export interface SplitecoDirectGroupResponse {
  group: SplitecoGroupSummary;
}

// ── Activity ────────────────────────────────────────────────

export type SplitecoActivityAction =
  | "added"
  | "edited"
  | "deleted"
  | "restored"
  | "moved_in"
  | "moved_out"
  | "reversed"
  | "settled"
  | "cookpool";

export interface SplitecoActivityEntry {
  /** The ledger row it is about (`txn_…`). */
  txnId: string;
  /** The expense it changed, as it reads now (the current version, or the last one when deleted). */
  expenseId: string;
  action: SplitecoActivityAction;
  at: string;
  actorId: string;
  groupId: string;
  groupName: string;
  title: string;
  totalMinor: number;
  currency: string;
  /** For an edit: the total before. */
  previousTotalMinor: number | null;
  /** For a move: the other group (`org_…`) and its name, when the caller can see it. */
  otherGroupId: string | null;
  otherGroupName: string | null;
  /** What it did to the caller's balance: positive gets money back. */
  myEffectMinor: number;
  viaDelegation: string | null;
}

export interface SplitecoActivityResponse {
  entries: SplitecoActivityEntry[];
  people: SplitecoPerson[];
}

// ── Insights ────────────────────────────────────────────────

export interface SplitecoInsightsQuery {
  /** `org_…`; every group when left out. */
  groupId?: string;
  /** YYYY-MM (UTC); this month when left out. */
  month?: string;
  /** Which currency to count in when the caller's groups use several. */
  currency?: string;
}

export interface SplitecoInsightsResponse {
  groupId: string | null;
  month: string;
  currency: string;
  /** Every currency the caller has money in, so the app can switch. */
  currencies: string[];
  /** The caller's share by category ("cookpool" for Cookpool's uses and dishes). */
  byCategory: { category: SplitecoCategory | "cookpool"; amountMinor: number }[];
  /** Who paid, out of pocket, for the month's expenses. */
  byPayer: { subjectId: string; amountMinor: number }[];
  /** The caller's share, the six months ending at `month`. */
  byMonth: { month: string; amountMinor: number }[];
  myShareMinor: number;
  myPaidMinor: number;
  expenseCount: number;
  previousMonthShareMinor: number;
  biggest: { expense: SplitecoExpenseSummary; myShareMinor: number }[];
  people: SplitecoPerson[];
}

// ── Export ──────────────────────────────────────────────────

export interface SplitecoExport {
  exportedAt: string;
  group: { id: string; name: string; kind: SplitecoGroupKind; madeIn: SplitecoMadeIn; currency: string };
  members: SplitecoPerson[];
  balances: { subjectId: string; balanceMinor: number }[];
  expenses: (SplitecoExpenseSummary & {
    note: string | null;
    items: SplitecoItem[];
    adjustments: SplitecoAdjustment[];
  })[];
}

// ── Helpers ─────────────────────────────────────────────────

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A month as YYYY-MM. */
export function isSplitecoMonth(value: string): boolean {
  return PERIOD_RE.test(value);
}

/** The deadline to restore an expense deleted at `deletedAt` (ISO 8601). */
export function splitecoRestorableUntil(deletedAt: string): string {
  return new Date(new Date(deletedAt).getTime() + SPLITECO_RESTORE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
