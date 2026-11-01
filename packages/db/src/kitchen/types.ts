import type { AppendEventWithAuditInput } from "../events/types.js";
import type { Uuid } from "../ids/index.js";

// ── Result type ─────────────────────────────────────────────

export type KitchenRepositoryError =
  | { kind: "not_found" }
  | { kind: "conflict"; entity: string }
  /** The group's currency is fixed once its settings row exists. */
  | { kind: "currency_locked"; currency: string }
  /** The database refused a value its CHECK constraints forbid. */
  | { kind: "invalid"; reason: string }
  /** The transaction already has a reversal (`reversedBy`); it can be reversed once. */
  | { kind: "already_reversed"; reversedBy: string }
  /** The group's ledger counts in `currency`, not the one the write named. */
  | { kind: "currency_mismatch"; currency: string }
  | { kind: "internal"; message: string };

export type KitchenResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: KitchenRepositoryError };

// ── Group settings ──────────────────────────────────────────

export type KitchenWastePolicy = "split_equally" | "buyer_absorbs";

/** What a group without a settings row reads as. */
export const KITCHEN_DEFAULT_CURRENCY = "INR";
export const KITCHEN_DEFAULT_WASTE_POLICY: KitchenWastePolicy = "split_equally";

export interface KitchenGroupSettings {
  orgId: string;
  currency: string;
  wastePolicy: KitchenWastePolicy;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertGroupSettingsInput {
  orgId: Uuid;
  /**
   * ISO 4217 code. Written when the row is created; on an existing row it must
   * equal the stored value, or the upsert changes nothing and returns
   * `currency_locked`. Omit to keep the stored value (or the default on create).
   */
  currency?: string;
  /** Omit to keep the stored value (or the default on create). */
  wastePolicy?: KitchenWastePolicy;
  now: Date;
}

// ── Ledger ──────────────────────────────────────────────────

export type KitchenTxnKind = "expense" | "use" | "dish" | "waste" | "settlement" | "reversal";

/** How a settlement was paid. */
export type KitchenSettlementMethod = "upi" | "cash" | "bank" | "other";

/** One person's line in a transaction: what they paid and what they owe. */
export interface KitchenSplit {
  subjectId: string;
  paidMinor: number;
  owedMinor: number;
}

/** A transaction as stored, with its splits in the order they were posted. */
export interface KitchenTxnRecord {
  id: string;
  orgId: string;
  kind: KitchenTxnKind;
  title: string;
  totalMinor: number;
  currency: string;
  occurredAt: Date;
  createdBy: string;
  sourceKind: string | null;
  sourceId: string | null;
  /** For a reversal: the transaction it undoes. */
  reverses: string | null;
  /** The reversal that undid this one, if any. Read by join, never stored. */
  reversedBy: string | null;
  method: KitchenSettlementMethod | null;
  note: string | null;
  idemKey: string;
  createdAt: Date;
  splits: KitchenSplit[];
}

/** A transaction to post. A reversal goes through `reverseTxn` instead. */
export interface NewKitchenTxn {
  id: Uuid;
  orgId: Uuid;
  kind: Exclude<KitchenTxnKind, "reversal">;
  title: string;
  totalMinor: number;
  currency: string;
  occurredAt: Date;
  /**
   * Who logged it, as the public subject id (`usr_…`) — the same form split
   * rows and membership store. `created_by` is a TEXT column, not a UUID one.
   */
  createdBy: string;
  sourceKind?: string | null;
  sourceId?: string | null;
  method?: KitchenSettlementMethod | null;
  note?: string | null;
  /** The request's Idempotency-Key (or one minted for it); unique per group. */
  idemKey: string;
  /** Written as created_at. */
  now: Date;
}

export interface PostTxnInput {
  txn: NewKitchenTxn;
  /** At least one; Σ paid = Σ owed = total, one row per person. */
  splits: readonly KitchenSplit[];
  /** The audit event, written in the same batch as the transaction. */
  audit?: AppendEventWithAuditInput;
}

export interface ReverseTxnInput {
  /** The transaction being undone, as `getTxn` read it. */
  original: KitchenTxnRecord;
  reversal: {
    id: Uuid;
    title: string;
    occurredAt: Date;
    createdBy: string;
    note?: string | null;
    idemKey: string;
    now: Date;
  };
  /** The original's splits with paid and owed swapped. */
  splits: readonly KitchenSplit[];
  audit?: AppendEventWithAuditInput;
}

export interface PostedTxn {
  txn: KitchenTxnRecord;
  /**
   * True when the idempotency key had already posted a transaction in this
   * group: `txn` is that transaction and nothing was written. The caller
   * decides whether it answers the same request.
   */
  replayed: boolean;
}

/** Keyset position in a group's activity (newest first). */
export interface KitchenActivityCursor {
  occurredAt: string;
  id: string;
}

export interface KitchenActivityPage {
  items: KitchenTxnRecord[];
  nextCursor: KitchenActivityCursor | null;
}

/** A transaction as balances and the settle plan read it. */
export interface KitchenLedgerTxn {
  id: string;
  kind: KitchenTxnKind;
  title: string;
  totalMinor: number;
  occurredAt: Date;
  reverses: string | null;
  splits: KitchenSplit[];
}

export type KitchenFlagState = "open" | "resolved";

export interface KitchenFlagRecord {
  id: string;
  txnId: string;
  orgId: string;
  subjectId: string;
  reason: string;
  state: KitchenFlagState;
  idemKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFlagInput {
  id: Uuid;
  txnId: Uuid;
  orgId: Uuid;
  subjectId: string;
  reason: string;
  idemKey: string;
  now: Date;
  audit?: AppendEventWithAuditInput;
}

export interface CreatedFlag {
  flag: KitchenFlagRecord;
  /** True when the idempotency key had already created a flag in this group (`flag` is it). */
  replayed: boolean;
}

// ── Repository ──────────────────────────────────────────────

export interface KitchenRepository {
  /** The group's settings row, or `null` when it has none (it uses the defaults). */
  getGroupSettings(orgId: Uuid): Promise<KitchenResult<KitchenGroupSettings | null>>;
  /**
   * Create the group's settings row or change it, in one statement. The
   * currency lock is enforced inside that statement, so two racing first
   * writes cannot leave the currency different from what either was told.
   */
  upsertGroupSettings(input: UpsertGroupSettingsInput): Promise<KitchenResult<KitchenGroupSettings>>;

  /**
   * Post a transaction: its row, every split row and its audit event in ONE
   * batch. The same batch pins the group's settings row (with the currency
   * posted in) when the group has none, so a ledger never changes currency
   * under existing money; a currency other than the group's is
   * `currency_mismatch` and writes nothing. A repeated idempotency key writes
   * nothing and returns the transaction it posted (`replayed: true`).
   */
  postTxn(input: PostTxnInput): Promise<KitchenResult<PostedTxn>>;
  /**
   * Post the reversal of `original` (kind `reversal`, `reverses` = its id) the
   * way `postTxn` posts. A transaction is reversed at most once: a second
   * reversal under another key is `already_reversed`.
   */
  reverseTxn(input: ReverseTxnInput): Promise<KitchenResult<PostedTxn>>;
  /** One transaction of the group, with its splits; `not_found` outside it. */
  getTxn(orgId: Uuid, txnId: Uuid): Promise<KitchenResult<KitchenTxnRecord>>;
  /** The group's transactions with their splits, newest first (occurred_at, then id). */
  listActivity(
    orgId: Uuid,
    page: { cursor: KitchenActivityCursor | null; limit: number },
  ): Promise<KitchenResult<KitchenActivityPage>>;
  /**
   * Every transaction of the group that moved money, with its splits, oldest
   * first: what balances and the settle plan are computed from. Loads the
   * whole ledger (see risks CP-O).
   */
  listSplitsForGroup(orgId: Uuid): Promise<KitchenResult<KitchenLedgerTxn[]>>;
  /** Flag a transaction, with its audit event in the same batch; idempotent per key like `postTxn`. */
  createFlag(input: CreateFlagInput): Promise<KitchenResult<CreatedFlag>>;
  /** The flags on one of the group's transactions, oldest first. */
  listFlags(orgId: Uuid, txnId: Uuid): Promise<KitchenResult<KitchenFlagRecord[]>>;
}
