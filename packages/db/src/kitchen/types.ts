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
  /** Some of the item has been used (or charged): its quantity and price are fixed, and it cannot be removed. */
  | { kind: "item_used" }
  /** The item was edited since the caller read it: it is now at `version`. */
  | { kind: "version_conflict"; version: number }
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

// ── Pantries (CP-10) ────────────────────────────────────────

export type KitchenItemState = "active" | "used_up" | "wasted" | "removed";

/** What a quantity measures; display units convert only inside one. */
export type KitchenDimension = "count" | "mass" | "volume" | "pack";

/** Whose pantry: a person's own (keyed by their `usr_…`), or a group's. */
export type KitchenPantryOwner = { kind: "user"; subjectId: string } | { kind: "group"; orgId: Uuid };

/** An item as stored. Quantities are thousandths of the dimension's base unit. */
export interface KitchenItemRecord {
  id: string;
  ownerKind: "user" | "group";
  /** Set for a personal item. */
  ownerSubjectId: string | null;
  /** Set for a group item. */
  orgId: string | null;
  name: string;
  category: string;
  dimension: KitchenDimension;
  displayUnit: string;
  qtyBoughtMilli: number;
  qtyLeftMilli: number;
  priceMinor: number;
  costTakenMinor: number;
  currency: string;
  paidBy: string;
  /** ISO date (YYYY-MM-DD). */
  boughtOn: string;
  expiresOn: string | null;
  /** The item's own waste rule; null follows the group (always null for a personal item). */
  wastePolicy: KitchenWastePolicy | null;
  sourceDishId: string | null;
  state: KitchenItemState;
  version: number;
  createdBy: string;
  idemKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewKitchenItem {
  id: Uuid;
  owner: KitchenPantryOwner;
  name: string;
  category: string;
  dimension: KitchenDimension;
  displayUnit: string;
  /** What was bought; the item starts with all of it left. */
  qtyMilli: number;
  priceMinor: number;
  /**
   * ISO 4217. For a group item, the group's currency as the caller read it:
   * the item is inserted only if the group still counts in it.
   */
  currency: string;
  paidBy: string;
  boughtOn: string;
  expiresOn: string | null;
  wastePolicy: KitchenWastePolicy | null;
  /** Who added it (`usr_…`). */
  createdBy: string;
  /** The request's Idempotency-Key (or one minted for it); unique per pantry. */
  idemKey: string;
  /** Written as created_at and updated_at. */
  now: Date;
}

export interface CreateItemInput {
  item: NewKitchenItem;
  /** The audit event, written in the same batch as the item (group items: personal pantries have no org to audit under). */
  audit?: AppendEventWithAuditInput;
}

export interface CreatedItem {
  item: KitchenItemRecord;
  /**
   * True when the idempotency key had already added an item to this pantry:
   * `item` is that item and nothing was written.
   */
  replayed: boolean;
}

/** An edit. Quantity and price change only while nothing of the item has been used. */
export interface KitchenItemChanges {
  name?: string;
  category?: string;
  expiresOn?: string | null;
  /** A new quantity (bought and left alike), in its unit. */
  quantity?: { dimension: KitchenDimension; displayUnit: string; qtyMilli: number };
  priceMinor?: number;
  /** Group items only. */
  wastePolicy?: KitchenWastePolicy | null;
}

export interface UpdateItemInput {
  owner: KitchenPantryOwner;
  itemId: Uuid;
  changes: KitchenItemChanges;
  /** When set, the edit applies only if the item is still at this version. */
  expectedVersion?: number;
  now: Date;
}

/** Keyset position in a list of items (soonest use-by first, then name). */
export interface KitchenItemsCursor {
  /** The use-by date, or "9999-12-31" for an item without one (they sort last). */
  expiresKey: string;
  /** The name, lower-cased. */
  nameKey: string;
  id: string;
}

/** Which pantries a read covers: the person's own (when `ownerSubjectId` is set) and these groups. */
export interface KitchenPantryScope {
  ownerSubjectId: string | null;
  /** Group UUIDs. Any number: they bind as one JSON parameter. */
  orgIds: readonly string[];
}

export interface KitchenItemsQuery extends KitchenPantryScope {
  /** Name contains, case-insensitively. */
  q: string | null;
  /** Only items whose use-by is within [from, to] (ISO dates, inclusive), or before `before`. */
  expires: { from: string; to: string } | { before: string } | null;
  cursor: KitchenItemsCursor | null;
  limit: number;
}

export interface KitchenItemsPage {
  items: KitchenItemRecord[];
  nextCursor: KitchenItemsCursor | null;
}

export interface KitchenItemSearch extends KitchenPantryScope {
  /** Matched against the name: exactly, then as its start, then a word's start, then anywhere. Empty matches all. */
  q: string;
  limit: number;
}

/** One pantry's active items in one currency, summed. A pantry with items in two currencies has two rows. */
export interface KitchenPantryTotals {
  /** Null for the person's own pantry. */
  orgId: string | null;
  currency: string;
  itemCount: number;
  /** Use-by from `today` to `soonUntil`, inclusive. */
  useSoonCount: number;
  /** Use-by before `today`. */
  expiredCount: number;
  /** What is left of their prices (price − cost taken). */
  worthMinor: number;
}

export interface KitchenPantryTotalsQuery extends KitchenPantryScope {
  today: string;
  soonUntil: string;
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

  // ── Pantries (CP-10) ──

  /** The settings rows of these groups (a group without one is absent: it uses the defaults). */
  listGroupSettings(orgIds: readonly string[]): Promise<KitchenResult<KitchenGroupSettings[]>>;
  /**
   * Add an item, with its audit event, in ONE batch. A group item pins the
   * group's settings row (its currency) when the group has none, as the
   * ledger's first transaction does, and is inserted only in the group's
   * currency: another is `currency_mismatch` and writes nothing. A repeated
   * idempotency key in the same pantry writes nothing and returns the item it
   * added (`replayed: true`).
   */
  createItem(input: CreateItemInput): Promise<KitchenResult<CreatedItem>>;
  /** One item of the pantry; `not_found` for another pantry's item and for a removed one. */
  getItem(owner: KitchenPantryOwner, itemId: Uuid): Promise<KitchenResult<KitchenItemRecord>>;
  /**
   * Edit an item in one conditional statement: a quantity or price change
   * applies only while nothing has been used (`item_used` otherwise), and an
   * `expectedVersion` only while the item is still at it (`version_conflict`).
   * Bumps the version.
   */
  updateItem(input: UpdateItemInput): Promise<KitchenResult<KitchenItemRecord>>;
  /** Mark an item `removed` (added by mistake). Only while nothing has been used: `item_used` otherwise. */
  removeItem(owner: KitchenPantryOwner, itemId: Uuid, now: Date): Promise<KitchenResult<KitchenItemRecord>>;
  /** Active items across the scope's pantries, soonest use-by first (none last), then name, then id. */
  listItems(query: KitchenItemsQuery): Promise<KitchenResult<KitchenItemsPage>>;
  /** Active items with something left whose name matches, best match first, then soonest use-by. */
  searchItems(query: KitchenItemSearch): Promise<KitchenResult<KitchenItemRecord[]>>;
  /** Counts and worth of the scope's pantries, one row per pantry and currency. */
  pantryTotals(query: KitchenPantryTotalsQuery): Promise<KitchenResult<KitchenPantryTotals[]>>;
}
