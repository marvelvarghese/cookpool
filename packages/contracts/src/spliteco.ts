// Spliteco contract types (epic cookpool-spliteco, SE1).
//
// Spliteco is served by `apps/spliteco-worker` behind `api-edge` under
// `/v1/spliteco/…`. It reads and writes the same group ledger Cookpool does
// (`kitchen_txns`, `kitchen_txn_splits`), so every amount is integer minor
// units (paise for INR) in the group's one currency, and a group is a
// membership organization (`org_…`). Money is never summed across currencies:
// every total that spans groups is a list with one entry per currency.

// ── Policy actions ──────────────────────────────────────────

/**
 * Every Spliteco policy action (design §2). Reading is every group role;
 * writing is every role but viewer. SE2's payments, reminders and the
 * simplify switch are gated on `spliteco.expense.write` (the same roles):
 * a separate `spliteco.settlement.write` grant needs the policy engine,
 * which SE-3's contract does not reach (IMPLEMENTATION-STATUS, SE2).
 */
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
  // ── SE2: settle up and reminders ──
  /** 422 `validation_failed`: the payment is more than the payer owes the payee (`details.owed`: per balance). */
  OVER_SETTLED: "over_settled",
  /** 409 `conflict`: the payer owes the payee nothing here (a payment), or they owe you nothing (a reminder). */
  NOTHING_OWED: "nothing_owed",
  /** 422 `validation_failed`: the split across Kitchen and Other does not add up to the amount. */
  SPLIT_MISMATCH: "split_mismatch",
  /** 403 `forbidden`: only the person paid can say a payment was not received. */
  NOT_THE_PAYEE: "not_the_payee",
  /** 409 `conflict`: that row is not a payment. */
  NOT_A_SETTLEMENT: "not_a_settlement",
  /** 409 `conflict`: that payment was already marked not received (or reversed). */
  ALREADY_REVERSED: "already_reversed",
  /** 409 `conflict`: you reminded them in the last 24 hours (`details.lastSentAt`, `details.nextAllowedAt`). */
  REMINDED_RECENTLY: "reminded_recently",
  /** 403 `forbidden`: payments and reminders are made in an app, never by an assistant (design §0.9). */
  NOT_FROM_AN_ASSISTANT: "not_from_an_assistant",
  /** 422 `validation_failed`: a payment needs two different people. */
  SAME_PERSON: "same_person",
  // ── SE4: live split ──
  /** 403 `forbidden`: only the person who opened the live split may do this (lock it, set someone else's claim). */
  NOT_THE_OPENER: "not_the_opener",
  /** 403 `forbidden`: you may claim only for yourself. */
  OWN_CLAIMS_ONLY: "own_claims_only",
  /** 409 `conflict`: some items have nobody on them yet (`details.unclaimed`: their positions). */
  NOT_ALL_CLAIMED: "not_all_claimed",
  /** 409 `conflict`: the live split was locked and posted (`details.expenseId`); claims no longer change. */
  LIVE_LOCKED: "live_locked",
  /** 409 `conflict`: the live split is more than SPLITECO_LIVE_HOURS old. */
  LIVE_EXPIRED: "live_expired",
  /** 422 `validation_failed`: there is no item at that position. */
  NO_SUCH_ITEM: "no_such_item",
  // ── SE5: assistants ──
  /** 403 `forbidden`: an assistant adds, edits and moves only from a draft the person saw (POST /drafts, then …/save). */
  DRAFT_REQUIRED: "draft_required",
  /** 409 `conflict`: the draft is older than SPLITECO_DRAFT_MINUTES; draft it again. */
  DRAFT_EXPIRED: "draft_expired",
  /** 403 `forbidden`: this assistant's access does not allow it (the same reason api-edge gives, DELEGATION_ERROR_REASONS.SCOPE). */
  SCOPE: "scope",
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
  /**
   * POST only (SE3): `kitchen` for a bill added in Cookpool's Money tab — it
   * is Cookpool's row and counts toward the group's Kitchen balance. Only in
   * a group made in Cookpool, never from an assistant. Left out: Other.
   */
  bucket?: SplitecoBucket | null;
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
  /** The assistant that made it, when one did (SE5): its delegation (`dlg_…`). */
  viaDelegation: string | null;
  /** That assistant's name as the person connected it ("Claude"); null when none did. */
  viaAssistant: string | null;
  /** For a payment: how it was paid (null for anything else, or when not said). */
  paymentMethod: SplitecoPaymentMethod | null;
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
  /** SE2: the group's switches. */
  settings: SplitecoGroupSettings;
  /** SE2: each member's UPI ID, when they set one (members share this group, so they may see it). */
  upi: { subjectId: string; upiVpa: string }[];
  /** SE2: when the caller last reminded each person here, if ever. */
  reminded: { subjectId: string; sentAt: string }[];
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
  /** SE2: their UPI ID, when they set one and still share a group with the caller. */
  upiVpa: string | null;
  /** SE2: when the caller last reminded them, if ever. */
  lastRemindedAt: string | null;
  /** SE2: the payments between the two in each group's plan (simplified or not, as each group is set). */
  plans: { groupId: string; groupName: string; currency: string; fromSubjectId: string; toSubjectId: string; amountMinor: number }[];
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
  /** The assistant the change came through (`dlg_…`), and its name ("via Claude"); null when the person made it. */
  viaDelegation: string | null;
  viaAssistant: string | null;
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

// ── SE2: settle up ──────────────────────────────────────────
//
// A payment is recorded only when the payer confirms it ("I paid"): a UPI
// payment is the app's deep link, then the payer's confirm; cash and bank are
// one tap. It is stored as `kitchen_txns` settlement rows, one per balance it
// pays (a kitchen group's Kitchen first, then Other), and the person paid can
// mark it not received, which reverses it. Never through an assistant.

/** How a payment was made, as Spliteco records it (Cookpool's `other` is not offered here). */
export const SPLITECO_PAYMENT_METHODS = ["upi", "cash", "bank"] as const;
export type SplitecoPaymentMethod = (typeof SPLITECO_PAYMENT_METHODS)[number] | "other";

/** POST /v1/spliteco/groups/{org}/settlements — the caller paid `toSubjectId`. */
export interface SplitecoSettlementRequest {
  toSubjectId: string;
  amountMinor: number;
  method: (typeof SPLITECO_PAYMENT_METHODS)[number];
  /** A reference or a word ("UTR 4123…"), up to SPLITECO_LIMITS.note. */
  note?: string | null;
  /**
   * For a group made in Cookpool: how much pays each balance. Left out, the
   * payment pays Kitchen first, then Other. Each part must be within what is
   * owed there, and the parts add up to `amountMinor`.
   */
  split?: { kitchen?: number; other?: number } | null;
  /**
   * `kitchen` (SE3): a payment made in Cookpool's Money tab. It pays the
   * Kitchen balance only and never more than it (422 `over_settled`), is
   * Cookpool's row, and takes no `split`. Only in a group made in Cookpool.
   */
  bucket?: "kitchen" | null;
}

export interface SplitecoPayment {
  /** `txn_…` of the payment's first row; any of its rows' ids works on not-received. */
  id: string;
  groupId: string;
  fromSubjectId: string;
  toSubjectId: string;
  amountMinor: number;
  currency: string;
  method: SplitecoPaymentMethod | null;
  note: string | null;
  /** The rows it was recorded as, one per balance it pays. */
  parts: { txnId: string; bucket: SplitecoBucket; amountMinor: number }[];
  recordedAt: string;
  recordedBy: string;
  /** `not_received` once the person paid said so (the rows are reversed). */
  state: "recorded" | "not_received";
}

export interface SplitecoSettlementResponse {
  payment: SplitecoPayment;
}

/** The plan a group settles by, balance by balance (SE2). */
export interface SplitecoSettlePlanResponse {
  groupId: string;
  currency: string;
  simplifyDebts: boolean;
  /** Each balance's payments: the fewest when simplified, else pair by pair; `pairs` is how many pairs owe before simplifying. */
  buckets: {
    bucket: SplitecoBucket;
    payments: { fromSubjectId: string; toSubjectId: string; amountMinor: number }[];
    pairs: number;
  }[];
  /** The balances' payments summed per pair. */
  plan: { fromSubjectId: string; toSubjectId: string; amountMinor: number }[];
  /** What the caller owes each person in each balance: what a payment to them may cover. */
  mine: { toSubjectId: string; owed: { kitchen: number; other: number } }[];
}

export interface SplitecoGroupSettings {
  /** On (the default): the plan is the fewest payments. Off: each pair settles what is between them. */
  simplifyDebts: boolean;
}

/** PUT /v1/spliteco/groups/{org}/settings. */
export interface SplitecoGroupSettingsRequest {
  simplifyDebts: boolean;
}

export interface SplitecoGroupSettingsResponse {
  settings: SplitecoGroupSettings;
}

// ── SE2: reminders ──────────────────────────────────────────

/** A person can be reminded by the same person at most once per this many hours. */
export const SPLITECO_REMINDER_HOURS = 24;

/** POST /v1/spliteco/reminders. */
export interface SplitecoReminderRequest {
  /** Who owes the caller (`usr_…`). */
  to: string;
  /** The group it is about (`org_…`); left out, the group they owe the caller most in. */
  groupId?: string | null;
}

export interface SplitecoReminder {
  /** `rmd_…`. */
  id: string;
  groupId: string;
  toSubjectId: string;
  amountMinor: number;
  currency: string;
  sentAt: string;
  /** SPLITECO_REMINDER_HOURS after sentAt. */
  nextAllowedAt: string;
}

export interface SplitecoReminderResponse {
  reminder: SplitecoReminder;
  /** Whether notifications-worker took it (email, and push when they turned it on). */
  delivered: boolean;
}

// ── SE2: your profile ───────────────────────────────────────

/** A UPI ID (VPA): a handle, "@", and the bank's handle — "devk@okaxis", "98100.12345@ybl". */
export const UPI_VPA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}@[A-Za-z][A-Za-z0-9]{1,31}$/;

export function isUpiVpa(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 && UPI_VPA_RE.test(value);
}

export interface SplitecoProfile {
  /** Your UPI ID: people who share a group with you pay you with it. */
  upiVpa: string | null;
  /** The currency groups you make start in. */
  defaultCurrency: string;
}

export interface SplitecoProfileResponse {
  profile: SplitecoProfile;
}

/** PUT /v1/spliteco/me/profile — `upiVpa: null` removes it. */
export interface SplitecoProfileRequest {
  upiVpa: string | null;
  defaultCurrency?: string;
}

// ── SE2: what Spliteco sends ────────────────────────────────
//
// Through notifications-worker's enqueue (email, plus Web Push for a person
// who turned the kind on), with amounts formatted and links absolute.

export const SPLITECO_EMAILS = {
  /** Someone you owe nudged you (POST /v1/spliteco/reminders). */
  REMINDER: "spliteco.reminder",
  /** Someone recorded a payment to you in Spliteco. */
  PAID_YOU: "spliteco.paid_you",
  /** SE5: an expense you're on was added, edited, deleted, restored or moved — by a person, or through their assistant. */
  EXPENSE_FOR_YOU: "spliteco.expense_for_you",
} as const;

export type SplitecoEmail = (typeof SPLITECO_EMAILS)[keyof typeof SPLITECO_EMAILS];

/** `spliteco.reminder`: "Anu sent a friendly nudge: ₹620.00 for Goa Trip". Keyed `spliteco.reminder:<rmd>:<usr>`. */
export interface SplitecoReminderEmail {
  [key: string]: string | number | boolean | null;
  fromName: string | null;
  amount: string;
  groupName: string;
  /** Where to pay: the Settle up screen in Spliteco. */
  payUrl: string;
}

/** `spliteco.paid_you`: "Dev paid you ₹400.00 · UPI". Keyed `spliteco.paid_you:<txn>:<usr>`. */
export interface SplitecoPaidYouEmail {
  [key: string]: string | number | boolean | null;
  payerName: string | null;
  amount: string;
  method: string | null;
  groupName: string;
  /** The payer's page in Spliteco, where "Not received" is. */
  personUrl: string;
}

/** What happened to the expense, as `spliteco.expense_for_you` says it. */
export type SplitecoExpenseChange = "added" | "edited" | "deleted" | "restored" | "moved";

/**
 * `spliteco.expense_for_you` (SE5): "Anu via Claude added “Sunset cruise”
 * ₹3,200.00 · Goa Trip", to everyone on the expense but whoever changed it.
 * Keyed `spliteco.expense_for_you:<txn>:<usr>` (the row the change wrote).
 */
export interface SplitecoExpenseForYouEmail {
  [key: string]: string | number | boolean | null;
  /** Who did it: "Anu", or "Anu via Claude" when their assistant did. */
  actorName: string | null;
  change: SplitecoExpenseChange;
  title: string;
  /** The expense's total, formatted. */
  amount: string;
  /** Where it is now (for a move: the group it went to). */
  groupName: string;
  /** For a move: the group it left. */
  fromGroupName: string | null;
  /** The recipient's share now, formatted; null when they are no longer on it (or it was deleted). */
  yourShare: string | null;
  /** The expense in Spliteco. */
  expenseUrl: string;
}

// ── SE4: live split ─────────────────────────────────────────
//
//   POST /v1/spliteco/groups/{org}/live          open one from an itemized draft → SplitecoLiveResponse (201)
//   GET  /v1/spliteco/live/{code}                the session, its claims and who is here (and marks the caller here)
//   POST /v1/spliteco/live/{code}/claims         set or clear one claim → SplitecoLiveResponse
//   POST /v1/spliteco/live/{code}/lock           the opener posts it as ONE itemized expense → SplitecoLiveResponse
//
// Only members of the group see a session: a code of a group you are not in
// is the opaque 404, as an unknown code is. Nothing is money until the lock,
// which posts through the expense path with `spliteco.live.locked`. Refreshed
// by polling (risk SE-E): the app reads every SPLITECO_LIVE_POLL_MS while it
// is open and visible.

/** The app polls a live split this often while it is open and visible. */
export const SPLITECO_LIVE_POLL_MS = 2000;
/** Someone is "here" when they read the session within this many seconds. */
export const SPLITECO_LIVE_PRESENCE_SECONDS = 10;
/** A live split can be claimed on and locked for this many hours after it opens. */
export const SPLITECO_LIVE_HOURS = 24;
/** Live codes use membership's join-code alphabet (no 0/O, 1/I/L), 8 characters. */
export const SPLITECO_LIVE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const SPLITECO_LIVE_CODE_LENGTH = 8;
const LIVE_CODE_RE = new RegExp(`^[${SPLITECO_LIVE_CODE_ALPHABET}]{${SPLITECO_LIVE_CODE_LENGTH}}$`);

/** A code as a person might type it (" ktch-2345" → "KTCH2345"); null when it cannot be one. */
export function normalizeLiveCode(raw: string): string | null {
  const code = raw.replace(/[\s-]+/g, "").toUpperCase();
  return LIVE_CODE_RE.test(code) ? code : null;
}

/** "KTCH2345" → "KTCH-2345", as the app shows it. */
export function formatLiveCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** One item of a live split's draft: what the bill says, without who had it. */
export interface SplitecoLiveItem {
  name: string;
  qty?: number;
  unitMinor?: number | null;
  totalMinor: number;
}

/** What a live split posts once everyone has claimed: an itemized expense without its shares. */
export interface SplitecoLiveDraft {
  title: string;
  category?: SplitecoCategory | null;
  note?: string | null;
  occurredAt?: string;
  /** Who paid, adding up to the items plus tax and service, less discount. */
  payers: SplitecoPayerInput[];
  items: SplitecoLiveItem[];
  adjustments: SplitecoAdjustmentInput[];
}

/** One person on one item, as an item share. */
export interface SplitecoLiveClaim {
  itemPosition: number;
  subjectId: string;
  mode: SplitecoItemShareMode;
  value: number;
  updatedAt: string;
}

/** POST /v1/spliteco/groups/{org}/live — `claims`: shares already set on the Itemized screen, carried over. */
export interface SplitecoLiveOpenRequest extends SplitecoLiveDraft {
  claims?: { itemPosition: number; subjectId: string; mode: SplitecoItemShareMode; value: number }[];
}

/**
 * POST /v1/spliteco/live/{code}/claims. `subjectId` defaults to the caller;
 * only the opener may name someone else. `clear: true` takes them off the
 * item; otherwise `mode`/`value` default to one portion ("I had this").
 */
export interface SplitecoLiveClaimRequest {
  itemPosition: number;
  subjectId?: string;
  mode?: SplitecoItemShareMode;
  value?: number;
  clear?: boolean;
}

export type SplitecoLiveState = "open" | "locked" | "expired";

export interface SplitecoLiveSession {
  /** `lvs_…`. */
  id: string;
  /** 8 characters; show it with formatLiveCode. */
  code: string;
  groupId: string;
  groupName: string;
  currency: string;
  state: SplitecoLiveState;
  /** Who opened it: they lock it and may set anyone's claim. */
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  draft: SplitecoLiveDraft;
  /** The items plus tax and service, less discount. */
  totalMinor: number;
  /** Σ the items' totals, and Σ of those with someone on them (the "claimed" bar). */
  itemsMinor: number;
  claimedMinor: number;
  claims: SplitecoLiveClaim[];
  /** Read within SPLITECO_LIVE_PRESENCE_SECONDS, newest first (the caller included). */
  here: { subjectId: string; seenAt: string }[];
  /** The group's members (who can join), with names. */
  members: SplitecoPerson[];
  /** Set once locked: the expense it posted (`txn_…`). */
  expenseId: string | null;
}

export interface SplitecoLiveResponse {
  session: SplitecoLiveSession;
}

/** The total a live draft adds up to: items + tax + service − discount. */
export function liveDraftTotal(draft: Pick<SplitecoLiveDraft, "items" | "adjustments">): number {
  const items = draft.items.reduce((s, it) => s + it.totalMinor, 0);
  return draft.adjustments.reduce((s, a) => s + (a.kind === "discount" ? -a.amountMinor : a.amountMinor), items);
}

// ── SE5: assistants (drafts and search) ─────────────────────
//
// An assistant connected over MCP (scope `money.write`) never writes an
// expense straight away: it drafts, shows the person the draft, and saves it
// only when they say yes (design §0.9, risk SE-F).
//
//   POST /v1/spliteco/drafts                 SplitecoDraftRequest → SplitecoDraftResponse (201); saves nothing
//   POST /v1/spliteco/drafts/{drf}/save      → SplitecoWriteResponse: the add, edit or move, exactly as drafted
//   GET  /v1/spliteco/me/search?q=&groupId=&limit=   → SplitecoSearchResponse (money.read)
//
// A draft is the caller's and the assistant's that made it: anyone else's
// token reads the opaque 404. It lasts SPLITECO_DRAFT_MINUTES; saving it twice
// answers the same expense (the draft's token is the write's idempotency key).
// The save checks everything again — membership, the split, Cookpool's rows,
// the current version — so a draft of something that changed meanwhile is
// refused as the write would be. Delete and restore need no draft: a delete
// is soft and restorable for SPLITECO_RESTORE_DAYS days.
//
// Settling up is never an assistant's (design §0.9): payments, "not
// received", UPI IDs, group creation and settings, members and live split
// answer 403 to every delegated token, at api-edge and again here.

/** A draft can be saved for this many minutes after it is made. */
export const SPLITECO_DRAFT_MINUTES = 10;
/** Draft tokens: `drf_` and 32 hex. */
export const SPLITECO_DRAFT_TOKEN_RE = /^drf_[0-9a-f]{32}$/;

export type SplitecoDraftAction = "add" | "edit" | "move";

export type SplitecoDraftRequest =
  | { action: "add"; groupId: string; expense: SplitecoExpenseRequest }
  | { action: "edit"; expenseId: string; expense: SplitecoExpenseRequest }
  | { action: "move"; expenseId: string; toGroupId: string };

/** One person on a draft: what they paid and their share. */
export interface SplitecoDraftShare {
  subjectId: string;
  name: string | null;
  paidMinor: number;
  owedMinor: number;
}

export interface SplitecoDraft {
  /** `drf_…`: pass it to …/save, and only once the person has said yes. */
  token: string;
  action: SplitecoDraftAction;
  expiresAt: string;
  /** Where it saves: the group it is added or edited in, or moved to. */
  groupId: string;
  groupName: string;
  /** For an edit or a move: the expense (`txn_…`) it changes. */
  expenseId: string | null;
  title: string;
  totalMinor: number;
  currency: string;
  category: SplitecoCategory | null;
  method: SplitecoSplitMethod | null;
  /** Everyone on it, as it would save. Σ paid = Σ owed = totalMinor. */
  shares: SplitecoDraftShare[];
  itemCount: number;
  /** For an edit or a move: the expense as it is now. */
  before: { groupId: string; groupName: string; title: string; totalMinor: number; shares: SplitecoDraftShare[] } | null;
}

export interface SplitecoDraftResponse {
  draft: SplitecoDraft;
}

export interface SplitecoSearchQuery {
  /** Words in the title or note (case-insensitive); every current expense when left out. */
  q?: string;
  /** `org_…`: only this group. */
  groupId?: string;
  /** At most this many (default 20, at most 50). */
  limit?: number;
}

export interface SplitecoSearchResponse {
  /** Current expenses and payments, newest first. */
  expenses: SplitecoExpenseSummary[];
  people: SplitecoPerson[];
  /** More matched than `limit`. */
  more: boolean;
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
