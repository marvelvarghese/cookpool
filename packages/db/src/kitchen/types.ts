import type { AsksRepository } from "./asks.js";
import type { CommunityRepository } from "./community.js";
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
  /** Not that much of the item is left (the stock or cost CHECK refused the write): `qtyLeftMilli` is. Nothing was written. */
  | { kind: "insufficient_stock"; qtyLeftMilli: number }
  /** The item changed between the read the write was computed from and the write: read it again. Nothing was written. */
  | { kind: "stale" }
  /** The stock move has been put back already, by `undoneBy`. */
  | { kind: "already_undone"; undoneBy: string }
  /** A reversal that put stock back cannot itself be reversed: that would take the stock again at a fixed price. */
  | { kind: "not_reversible" }
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

/**
 * A reversal of a transaction that moved stock (a group use, split waste)
 * also puts that stock back, in the same batch: see `reverseTxn`.
 */
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

/** An open flag on one of someone's transactions, with what an inbox card shows of the transaction (CP-19). */
export interface KitchenOpenFlagRecord {
  flagId: string;
  txnId: string;
  orgId: string;
  /** Who flagged it (`usr_…`). */
  flaggedBy: string;
  reason: string;
  flaggedAt: Date;
  title: string;
  txnKind: KitchenTxnKind;
  totalMinor: number;
  currency: string;
  sourceKind: string | null;
  sourceId: string | null;
}

/** Whose transactions, in which groups (see `listOpenFlagsOnTxnsBy`). */
export interface KitchenOpenFlagsQuery {
  /** Whose transactions (`usr_…`): flags they raised themselves are left out. */
  createdBy: string;
  /** Group UUIDs: they bind as one JSON parameter, however many there are. */
  orgIds: readonly string[];
  limit: number;
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
  /** One line about it (RC-3), at most 80 characters; null when it has none. Read by whoever can read the item. */
  note: string | null;
  /**
   * Ask before use (PN-8, migration 420): its buyer asks to be asked first.
   * Every read sets it; optional only so records typed before PN-8 still check.
   */
  askFirst?: boolean;
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
  /** The dish whose leftovers it is (CP-16); absent or null for anything bought. */
  sourceDishId?: string | null;
  /** Its note (RC-3): trimmed, 1–80 characters; absent or null for none. */
  note?: string | null;
  /** The shopping run that adds it (PN-3, migration 400); absent or null for an item added on its own. */
  purchaseId?: string | null;
  /** Ask before use (PN-8, migration 420): a group item whose buyer asks to be asked first; absent or false otherwise. */
  askFirst?: boolean;
  /** …and the members who never need to ask (`usr_…`); absent or empty for none. */
  allowed?: readonly string[];
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
  /** Its note (RC-3): trimmed, 1–80 characters, or null to clear it. Words only: it changes no money and no stock. */
  note?: string | null;
  /** Ask before use (PN-8): group items only. Words only too: it changes no money and no stock. */
  askFirst?: boolean;
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

// ── Stock moves (CP-11) ─────────────────────────────────────

export type KitchenStockMoveKind = "use" | "dish" | "waste" | "transfer" | "adjust" | "reversal";

/**
 * What wrote a move when it was not logged directly (migration 410): `check`
 * — a stock check (PN-4) — or `ask`, the use an approved ask posts (PN-8).
 */
export type KitchenStockMoveVia = "check" | "ask";

/** One change to an item's stock, as stored. */
export interface KitchenStockMoveRecord {
  id: string;
  itemId: string;
  kind: KitchenStockMoveKind;
  /** Always positive: a reversal puts back what the move it reverses took. */
  qtyMilli: number;
  costMinor: number;
  /** Who logged it (`usr_…`). */
  actor: string;
  txnId: string | null;
  dishId: string | null;
  /** For a use: who had it, in the order named. */
  consumers: string[] | null;
  /** The unit it was logged in; null reads as the item's display unit. */
  unit: string | null;
  /**
   * The words it was given in ("2 onions", SM-13, migration 300): a use or a
   * dish's take given in one of the item's measures, and the reversal that
   * puts such a move back. Null when it was given in a unit, and for every
   * move written before.
   */
  label: string | null;
  /** For a reversal: the move it puts back. */
  reverses: string | null;
  /** The reversal that put this move back, if any. Read by join, never stored. */
  undoneBy: string | null;
  idemKey: string | null;
  createdAt: Date;
  /**
   * What wrote it (migration 410): `check` on every use, waste and adjust a
   * stock check wrote (PN-4); null for a move logged directly, every
   * reversal, and every move written before.
   */
  via: KitchenStockMoveVia | null;
}

/** What every move a request writes carries. */
export interface NewStockMove {
  id: Uuid;
  /** Who logged it (`usr_…`). */
  actor: string;
  /** The request's Idempotency-Key (or one minted for it); unique per item. */
  idemKey: string;
  /** Written as the move's created_at and the item's updated_at. */
  now: Date;
}

/**
 * Take some of an item — a use or waste — in ONE batch: the ledger
 * transaction (when it moves money) with its splits, the move, the item's
 * update and the audit event. The write applies only while the item is still
 * at `expectedVersion` (the read its cost was computed from): otherwise
 * `stale`, and nothing is written. Taking more than is left fails the stock
 * CHECK: `insufficient_stock`, and nothing is written. A repeated idempotency
 * key on the item writes nothing and answers the move it made
 * (`replayed: true`).
 */
export interface TakeStockInput {
  owner: KitchenPantryOwner;
  itemId: Uuid;
  expectedVersion: number;
  move: NewStockMove & {
    kind: "use" | "waste";
    qtyMilli: number;
    costMinor: number;
    unit: string;
    consumers: readonly string[] | null;
    /** The words a use in a measure was given in ("2 onions", SM-13); absent or null for a unit. */
    label?: string | null;
    /** What wrote it (`check`: a stock check, PN-4); absent or null when it was logged directly. */
    via?: KitchenStockMoveVia | null;
  };
  /** The transaction the move posts: a group use, or waste split equally. Its id becomes the move's txn_id. */
  txn?: { txn: NewKitchenTxn; splits: readonly KitchenSplit[] } | null;
  audit?: AppendEventWithAuditInput;
}

/** A write that moved stock: the item as it is now, the move, and the transaction it posted. */
export interface StockMoved {
  item: KitchenItemRecord;
  move: KitchenStockMoveRecord;
  txn: KitchenTxnRecord | null;
  /** True when the idempotency key had already made this move: nothing was written. */
  replayed: boolean;
}

/**
 * Move a personal item into a group's pantry in ONE batch: pin the group's
 * currency, the `transfer` move, the item's new owner, the audit event. Only
 * while the item is unused (`item_used`), at `expectedVersion` (`stale`), and
 * in the group's currency (`currency_mismatch`).
 */
export interface TransferItemInput {
  /**
   * The personal item as the caller read it. Its owner becomes its buyer in
   * the group; the write applies only while it is still at this version.
   */
  item: KitchenItemRecord;
  orgId: Uuid;
  /** The group's currency as the caller read it; the item must be in it. */
  currency: string;
  move: NewStockMove;
  audit?: AppendEventWithAuditInput;
}

/**
 * Raise what is left of an item — the stock check's "more than Cookpool
 * thought" (PN-4) — in ONE batch: an `adjust` move of `qtyMilli` (it costs
 * nothing and posts no transaction), the item's update (what is left goes up
 * by it; a used-up or wasted item is active again) and the audit event. Only
 * while the item is still at `expectedVersion` (`stale`); raising it above
 * what was bought fails the stock CHECK (`invalid`, reason
 * `more_than_bought`). Nothing moves money, so `costOfUse` keeps every later
 * use inside the price. A repeated idempotency key on the item writes nothing
 * and answers the move it made (`replayed: true`).
 */
export interface AdjustStockInput {
  owner: KitchenPantryOwner;
  itemId: Uuid;
  expectedVersion: number;
  move: NewStockMove & {
    kind: "adjust";
    qtyMilli: number;
    unit: string;
    via: KitchenStockMoveVia | null;
  };
  audit?: AppendEventWithAuditInput;
}

/**
 * Put back a move that posted no transaction, in ONE batch: a `reversal`
 * move and the item's restore (what was taken, and what it cost, come back;
 * a used-up or wasted item is active again). Only at `expectedVersion` — the
 * version the caller saw the move as the item's latest at (`stale`).
 *
 * An `adjust` (PN-4) is put back the other way: what it added comes off
 * again, which needs that much still there (`insufficient_stock` otherwise),
 * and an item it empties is finished as its last take left it — wasted
 * after a waste, used up otherwise.
 */
export interface UndoMoveInput {
  owner: KitchenPantryOwner;
  /** The move to put back, as `getMove` read it. */
  move: KitchenStockMoveRecord;
  expectedVersion: number;
  reversal: NewStockMove;
  audit?: AppendEventWithAuditInput;
}

/** A move with its item, and the item's latest move still in effect (what an undo may put back). */
export interface KitchenMoveRead {
  move: KitchenStockMoveRecord;
  item: KitchenItemRecord;
  latestMoveId: string | null;
}

/**
 * One item someone often uses, from their uses since `since` of its food
 * (PN-2): every item in the same pantry with the same name key
 * (`lower(trim(name))`) and dimension, this one included.
 */
export interface KitchenUsualRecord {
  item: KitchenItemRecord;
  /** Uses of the food. */
  usedCount: number;
  /** The last use: the item's own latest, else its food's. */
  lastQtyMilli: number;
  lastUnit: string | null;
  /** The words the last use was given in ("2 onions", SM-13); null for a unit. */
  lastLabel: string | null;
  lastConsumers: string[] | null;
  lastUsedAt: Date;
  /** Whether the last use was another item's (a new pack inheriting its food's usual). */
  inherited: boolean;
  /** The food's uses in the query's bucket, or null when none fell in it (or no bucket was asked for). */
  bucket: KitchenUsualBucketRecord | null;
}

/** A food's uses in one part of the day: the most frequent amount (ties: the most recent), as last logged, and how many. */
export interface KitchenUsualBucketRecord {
  qtyMilli: number;
  unit: string | null;
  label: string | null;
  consumers: string[] | null;
  /** Every use of the food in the bucket, whatever its amount. */
  count: number;
}

/**
 * Uses since `since` that `subjectId` logged or was named in (not reversed),
 * of items in the scope, gathered per food; one row per active item with
 * something left whose food has any: most used first, then most recently used.
 */
export interface KitchenUsualsQuery extends KitchenPantryScope {
  subjectId: string;
  since: Date;
  limit: number;
  /**
   * A part of the day to read the food's usual for (PN-2): the uses since
   * `since` (no earlier than the query's) whose local hour — `created_at`
   * shifted by `tzOffsetMinutes` — is one of `hours`.
   */
  bucket?: KitchenUsualsBucketQuery | undefined;
}

export interface KitchenUsualsBucketQuery {
  /** Local hours, 0–23. */
  hours: readonly number[];
  /** Minutes east of UTC. */
  tzOffsetMinutes: number;
  since: Date;
}

// ── Repository ──────────────────────────────────────────────

/**
 * Ask before use (PN-8) is part of the kitchen repository — every use, waste,
 * dish and check of a group item reads its guard — but its storage is its own
 * file: ./asks.ts.
 */
export interface KitchenRepository extends AsksRepository, CommunityRepository {
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
   *
   * When the original moved stock (a group use, waste split equally — its
   * moves carry its id), the same batch puts every one of those moves back:
   * a `reversal` move each, and each item gets the quantity and the cost
   * back (a used-up or wasted item is active again). A reversal that put
   * stock back cannot itself be reversed (`not_reversible`): that would take
   * the stock again at a price fixed before other uses changed what is left.
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
  /**
   * Open flags someone else raised on transactions `createdBy` logged in
   * these groups, while the transaction is not reversed (a correction is a
   * reversal: once there is one, the flag has its answer), oldest first, at
   * most `limit` — in ONE read, however many groups or transactions (CP-19's
   * inbox).
   */
  listOpenFlagsOnTxnsBy(query: KitchenOpenFlagsQuery): Promise<KitchenResult<KitchenOpenFlagRecord[]>>;

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

  // ── Stock moves (CP-11) ──

  /** Use or waste some of an item, with the transaction it posts, in ONE batch (see `TakeStockInput`). */
  takeStock(input: TakeStockInput): Promise<KitchenResult<StockMoved>>;
  /** Raise what is left of an item with an `adjust` move, in ONE batch (see `AdjustStockInput`; PN-4). */
  adjustStock(input: AdjustStockInput): Promise<KitchenResult<StockMoved>>;
  /** Move an unused personal item into a group's pantry, in ONE batch (see `TransferItemInput`). */
  transferItem(input: TransferItemInput): Promise<KitchenResult<StockMoved>>;
  /**
   * Put back a move that posted no transaction (see `UndoMoveInput`). A move
   * is put back once: a second undo is `already_undone`. A repeated
   * idempotency key answers the reversal it wrote (`replayed: true`).
   */
  undoMove(input: UndoMoveInput): Promise<KitchenResult<StockMoved>>;
  /** One move of an item in the pantry, with the item and its latest move still in effect; `not_found` outside it. */
  getMove(owner: KitchenPantryOwner, moveId: Uuid): Promise<KitchenResult<KitchenMoveRead>>;
  /** The move a request with this idempotency key made on the pantry's item, if any. */
  getMoveByIdemKey(owner: KitchenPantryOwner, itemId: Uuid, idemKey: string): Promise<KitchenResult<KitchenStockMoveRecord | null>>;
  /** The pantry item's moves, newest first. */
  listMoves(owner: KitchenPantryOwner, itemId: Uuid, limit: number): Promise<KitchenResult<KitchenStockMoveRecord[]>>;
  /** What someone often uses (see `KitchenUsualsQuery`). */
  usuals(query: KitchenUsualsQuery): Promise<KitchenResult<KitchenUsualRecord[]>>;

  // ── Dishes (CP-14) ──

  /** These items, wherever they are in the scope's pantries (removed ones excluded), in any order. */
  findItems(scope: KitchenPantryScope, itemIds: readonly string[]): Promise<KitchenResult<KitchenItemRecord[]>>;
  /** Cook a dish: every write it makes, in ONE batch (see `CookDishInput`). */
  cookDish(input: CookDishInput): Promise<KitchenDishResult<CookedDish>>;
  /** One dish the scope can see, with its ingredients; `not_found` otherwise. */
  getDish(dishId: Uuid, scope: KitchenDishScope): Promise<KitchenResult<KitchenDishRecord>>;
  /** The dish a cook's request with this idempotency key made, if any. */
  getDishByIdemKey(cook: string, idemKey: string): Promise<KitchenResult<KitchenDishRecord | null>>;
  /** The dishes the scope can see, newest first (see `KitchenDishesQuery`). */
  listDishes(query: KitchenDishesQuery): Promise<KitchenResult<KitchenDishesPage>>;
  /** Cancel a dish that is not finalized, in ONE batch (see `CancelDishInput`). */
  cancelDish(input: CancelDishInput): Promise<KitchenDishResult<KitchenDishRecord>>;

  // ── Splitting dishes (CP-16) ──

  /** Claim half portions of an open dish, or take a claim back (see `ClaimDishInput`). */
  claimDish(input: ClaimDishInput): Promise<KitchenDishResult<KitchenDishRecord>>;
  /** Replace every share of a draft or open dish (see `SetDishSharesInput`). */
  setDishShares(input: SetDishSharesInput): Promise<KitchenDishResult<KitchenDishRecord>>;
  /** Finalize a dish: its dish transaction, its leftovers and its state, in ONE batch (see `FinalizeDishInput`). */
  finalizeDish(input: FinalizeDishInput): Promise<KitchenDishResult<SplitDish>>;
  /** Correct a finalized dish: a reversal and a new dish transaction, in ONE batch (see `CorrectDishInput`). */
  correctDish(input: CorrectDishInput): Promise<KitchenDishResult<SplitDish>>;

  // ── The daily sweep (CP-18) ──

  /**
   * Active items with something left whose use-by date is in the window, in
   * every pantry — personal and group alike — soonest first, then by name.
   * One indexed read (`kitchen_items_expires_idx`), however many pantries.
   */
  listUseSoonItems(query: KitchenUseSoonQuery): Promise<KitchenResult<KitchenItemRecord[]>>;
  /** Record a run of the sweep: one row per day swept; a re-run of the day replaces its counts. */
  recordSweep(input: RecordSweepInput): Promise<KitchenResult<KitchenSweepRecord>>;
  /** The latest day swept, or null when the sweep has never run. */
  lastSweep(): Promise<KitchenResult<KitchenSweepRecord | null>>;

  // ── From before (SM-8) ──

  /** Names bought before in the scope's pantries, each with its newest record (see `KitchenItemHistoryQuery`). ONE read. */
  itemHistory(query: KitchenItemHistoryQuery): Promise<KitchenResult<KitchenItemHistoryRecord[]>>;
  /** Dish names cooked before, each with its newest dish's ingredients matched to usable items (see `KitchenRecipesQuery`). ONE read. */
  recipes(query: KitchenRecipesQuery): Promise<KitchenResult<KitchenRecipeRecord[]>>;

  // ── Your measures (SM-13) ──

  /**
   * The measures of each key — one list per key, in the keys' order, each in
   * `position` order (empty when a name has none) — in ONE statement however
   * many keys: they bind as one JSON parameter. No keys, no query.
   */
  listMeasures(keys: readonly KitchenMeasureKey[]): Promise<KitchenResult<KitchenMeasureRecord[][]>>;
  /**
   * Replace a name's measures in ONE batch (see `ReplaceMeasuresInput`): the
   * ones whose word is not in `measures` are deleted, the rest written in
   * their new order. Answers the name's measures as they now are.
   */
  replaceMeasures(input: ReplaceMeasuresInput): Promise<KitchenResult<KitchenMeasureRecord[]>>;

  // ── Foods (RC-4) ──

  /**
   * Foods whose names match `q` (already folded), each once by its best
   * name: equal, then starting with it, then a word starting with it, then
   * containing it; by name within each. Null or empty `q`: every food by name.
   */
  searchFoods(q: string | null, limit: number): Promise<KitchenResult<KitchenFoodSearchRecord[]>>;
  /** These foods (unknown keys are left out), by name. No keys, no query. */
  getFoods(keys: readonly string[]): Promise<KitchenResult<KitchenFoodRecord[]>>;
  /**
   * matchFood (design §2): the one food `name` names — folded as SQLite folds
   * it, then looked up as itself, else without a plural "es" or "s" when
   * those agree on one food. Null when nothing (or more than one) matches.
   */
  matchFood(name: string): Promise<KitchenResult<KitchenFoodRecord | null>>;
  /**
   * Keep a pantry's answer for a name and, in the same batch, link every item
   * of that name in that pantry to it (or unlink them, for a null food).
   */
  setFoodAnswer(input: SetFoodAnswerInput): Promise<KitchenResult<SetFoodAnswerResult>>;
  /** A person's Always have list; the default (salt and water) until they first save one. */
  getAlwaysHave(userId: string): Promise<KitchenResult<KitchenAlwaysHave>>;
  /** Replace a person's Always have list (keys are checked by the caller; an unknown one is `invalid`). */
  setAlwaysHave(userId: string, foodKeys: readonly string[], now: Date): Promise<KitchenResult<KitchenAlwaysHave>>;
  /** Active items with something left, in the scope's pantries, linked to any of these foods. ONE read. */
  listFoodItems(scope: KitchenPantryScope, foodKeys: readonly string[]): Promise<KitchenResult<KitchenFoodItemRecord[]>>;
  /**
   * Active items with something left in the scope's pantries that link to no
   * food and whose name the pantry never answered for: one per name and
   * pantry (the newest), newest first.
   */
  listUnlinkedItems(scope: KitchenPantryScope, limit: number): Promise<KitchenResult<KitchenItemRecord[]>>;
  /** The food each of these items links to (null when unlinked; unknown ids are left out). ONE read. */
  itemFoods(itemIds: readonly string[]): Promise<KitchenResult<Map<string, string | null>>>;

  // ── Recipes (RC-4) ──

  /** One live recipe (not deleted), as `viewer` reads it (their last cook of it). */
  getRecipe(recipeId: Uuid, viewer: string): Promise<KitchenResult<KitchenRecipeTemplateRecord>>;
  /** The live recipe a link code opens (only a link recipe has one). */
  getRecipeByLinkCode(code: string, viewer: string): Promise<KitchenResult<KitchenRecipeTemplateRecord>>;
  /** Live recipes in the scope (see `KitchenRecipesScope`), newest first, with their lines and steps: three reads. */
  listRecipes(query: KitchenListRecipesQuery): Promise<KitchenResult<KitchenRecipeTemplateRecord[]>>;
  /** Write a recipe, its lines and its steps in ONE batch. A taken link code is `conflict` (mint another). */
  createRecipe(input: NewKitchenRecipe): Promise<KitchenResult<KitchenRecipeTemplateRecord>>;
  /**
   * Change a recipe its owner may edit (theirs, live, not Cookpool's) in ONE
   * batch: the fields given; the lines and steps, when given, replaced as a
   * whole. Anyone else's, or a deleted one, is `not_found`.
   */
  updateRecipe(input: UpdateKitchenRecipeInput): Promise<KitchenResult<KitchenRecipeTemplateRecord>>;
  /** Soft-delete a recipe its owner may edit; its copies stay. Answers it as it was. */
  deleteRecipe(recipeId: Uuid, ownerId: string, now: Date): Promise<KitchenResult<KitchenRecipeTemplateRecord>>;
  /** Mint or rotate (a code: visibility link) or turn off (null: visibility groups) a recipe's link. */
  setRecipeLink(recipeId: Uuid, ownerId: string, code: string | null, now: Date): Promise<KitchenResult<KitchenRecipeTemplateRecord>>;
  /** The viewer's last dish of a recipe (not canceled), with its ingredients that named a line; null if none. */
  lastCook(viewer: string, recipeId: Uuid): Promise<KitchenResult<KitchenRecipeLastCookRecord | null>>;
  /**
   * Set some steps' time ranges on a recipe its owner may edit (GC-2, "Use
   * today's times"), by step key, in ONE batch; other steps, and whistle
   * steps, are left as they are. Anyone else's is `not_found`.
   */
  setRecipeStepTimes(input: SetRecipeStepTimesInput): Promise<KitchenResult<KitchenRecipeTemplateRecord>>;
  /**
   * A recipe's root (GC-2): the first recipe its copies came from, found by
   * walking source_recipe_id — deleted recipes included — at most
   * MAX_RECIPE_ROOT_HOPS links; the recipe itself when it is no copy. Null
   * when there is no such recipe. ONE read.
   */
  recipeRootId(recipeId: Uuid): Promise<KitchenResult<Uuid | null>>;
  /**
   * The times cooks kept for these step keys (GC-7), pooled under the
   * recipe's root — found as `recipeRootId` finds it — so the root's own
   * dishes and every copy's count alike. ONE read, through
   * kitchen_dish_step_times_root_idx and the dishes' primary key. Left out in
   * SQL: a canceled dish's times, any under `minSeconds` (a skipped step), and
   * any whose size is not known (the time's factor, else its dish's). Kept
   * raw otherwise: the worker leaves out abandoned times and normalises by
   * each step's rule. Who cooked is a number that tells cooks apart within
   * this read only, never their id. No keys reads nothing.
   */
  pooledStepTimes(query: PooledStepTimesQuery): Promise<KitchenResult<KitchenPooledStepTime[]>>;
}

// ── Your measures (SM-13) ───────────────────────────────────

/**
 * Which measures: a name in one pantry, for one dimension. The name is
 * matched as `lower(trim(name))` in SQL — the same expression the measures
 * are written with, so the two always agree (ASCII letters fold).
 */
export interface KitchenMeasureKey {
  owner: KitchenPantryOwner;
  /** The item's name, as stored. */
  name: string;
  dimension: KitchenDimension;
}

/** A measure as stored (migration 300): `count` of it make `amountMilli` of the stock, in thousandths of the dimension's base unit. */
export interface KitchenMeasureRecord {
  id: string;
  ownerKind: "user" | "group";
  /** The pantry: the person (`usr_…`) for a personal pantry, the group's UUID for a group's. */
  ownerId: string;
  /** lower(trim(name)). */
  nameKey: string;
  dimension: KitchenDimension;
  /** The word for one ("onion"). */
  one: string;
  /** The word for more than one ("onions"). */
  many: string;
  count: number;
  amountMilli: number;
  /** 0, 1 or 2. */
  position: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One measure of a name's new set. */
export interface NewKitchenMeasure {
  /** Used when the word is new to the name; a word it already has keeps its id. */
  id: Uuid;
  one: string;
  many: string;
  count: number;
  amountMilli: number;
}

/**
 * Replace a name's measures (at most three, each word once — the caller
 * validates both). A word the name already has keeps its id and who first set
 * it; every measure written records `actor` as who set it last.
 */
export interface ReplaceMeasuresInput {
  key: KitchenMeasureKey;
  /** In order: each one's position is its index. Empty clears the name's measures. */
  measures: readonly NewKitchenMeasure[];
  /** Who set them (`usr_…`). */
  actor: string;
  now: Date;
}

// ── Dishes (CP-14) ──────────────────────────────────────────

/**
 * draft: assign mode, the cook alone decides the shares; open: claims mode,
 * the group's members claim portions; finalized: the dish transaction posted
 * (CP-16); canceled: every ingredient put back and its charges reversed.
 */
export type KitchenDishState = "draft" | "open" | "finalized" | "canceled";
export type KitchenDishSplitMode = "assign" | "claims";

/** A dish write refused: the kitchen's refusals, and a dish's own. */
export type KitchenDishError =
  | KitchenRepositoryError
  /** An ingredient (`itemId`) has not that much left (`qtyLeftMilli`). Nothing was written. */
  | { kind: "ingredient_short"; itemId: string; qtyLeftMilli: number }
  /**
   * The dish's state (`state`) does not allow the write: cancelling, claiming
   * or assigning a finalized or canceled dish, claiming a draft, correcting
   * a dish that is not finalized. Nothing was written.
   */
  | { kind: "dish_not_open"; state: KitchenDishState }
  /**
   * More half portions would be claimed than were cooked (`portionsHalf`):
   * the write could have claimed at most `availableHalf` — what the other
   * eaters leave free for a claim, all of them for the cook's assignment.
   * Nothing was written.
   */
  | { kind: "claims_exceed_portions"; portionsHalf: number; availableHalf: number };

export type KitchenDishResult<T> = { ok: true; value: T } | { ok: false; error: KitchenDishError };

/** One item taken for a dish, as stored, with the item's name as it is now. */
export interface KitchenDishIngredientRecord {
  itemId: string;
  name: string;
  /** The order the cook listed it in. */
  position: number;
  qtyMilli: number;
  /** The unit it was entered in. */
  unit: string;
  /** The words it was given in ("2 onions", SM-13, migration 300); null for a unit, and for every ingredient written before. */
  label: string | null;
  costMinor: number;
  /** The group pantry it came from; null for the cook's own. */
  orgId: string | null;
  /** Who bought the item (`usr_…`). */
  paidBy: string;
  /** The `use` transaction that charged the cook for it; null when nobody else paid for it. */
  useTxnId: string | null;
  /** The recipe line it was for (its position, RC-4, migration 350); null when it named none. */
  recipeLine: number | null;
}

/**
 * Which route wrote a share: self, a claim (the eater's own, or since SM-6
 * another member's for them — `setBy` says who); cook, the cook's assignment
 * or a correction.
 */
export type KitchenDishShareSource = "cook" | "self";

/** One eater's share of a dish, as stored: half portions or an exact amount. */
export interface KitchenDishShareRecord {
  id: string;
  /** Who had it (`usr_…`). */
  subjectId: string;
  /** The order they were listed in (assigned) or claimed in. */
  position: number;
  /** Half portions; null for an exact amount. */
  portionsHalf: number | null;
  /** A fixed amount, in minor units; null for portions. */
  exactMinor: number | null;
  source: KitchenDishShareSource;
  /** Who wrote it last (`usr_…`, SM-6, migration 290); null for a share written before. */
  setBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A dish as stored, with its ingredients in the cook's order. */
export interface KitchenDishRecord {
  id: string;
  /** Who cooked it (`usr_…`). */
  cook: string;
  /** The group it is shared with; null for just the cook. */
  orgId: string | null;
  name: string;
  /** Portions × 2. */
  portionsHalf: number;
  extrasMinor: number;
  ingredientsMinor: number;
  /** ingredientsMinor + extrasMinor. */
  totalMinor: number;
  currency: string;
  splitMode: KitchenDishSplitMode;
  state: KitchenDishState;
  /** The dish transaction once finalized (CP-16). */
  txnId: string | null;
  leftoverItemId: string | null;
  cookedAt: Date;
  finalizedAt: Date | null;
  canceledAt: Date | null;
  idemKey: string;
  createdAt: Date;
  updatedAt: Date;
  /** Bumped by every claim, assignment, finalize and correction (CP-16). */
  version: number;
  /** The recipe it was cooked from and the factor it was scaled by (RC-4, migration 350); null when it named none. */
  recipeId: string | null;
  recipeFactorMilli: number | null;
  ingredients: KitchenDishIngredientRecord[];
  /** Its shares, in the order they were listed or claimed (`position`). */
  shares: KitchenDishShareRecord[];
}

/** One item to take for a dish, as the cook read it: how much, and what it costs. */
export interface CookIngredient {
  /** Its pantry: the cook's own, or a group's. */
  owner: KitchenPantryOwner;
  itemId: Uuid;
  /** The version its cost was computed from: the take applies only at it (`stale` otherwise). */
  expectedVersion: number;
  qtyMilli: number;
  /** The unit it was entered in. */
  unit: string;
  /** The words it was given in, in one of the item's measures ("2 onions", SM-13); absent or null for a unit. */
  label?: string | null;
  costMinor: number;
  /** Who bought it (`usr_…`). */
  paidBy: string;
  /** The transaction (one of `CookDishInput.txns`) that charges the cook for it; null when none does. */
  useTxnId: Uuid | null;
  /** The id of the `dish` stock move that takes it. */
  moveId: Uuid;
  /** The recipe line it is for (RC-4); absent or null for none. */
  recipeLine?: number | null;
}

/**
 * Cook a dish in ONE batch: pin the shared group's currency (when it has no
 * settings row), one `use` transaction per source group with its splits, the
 * dish (in the shared group's currency only), the "just bought it" items, then
 * for every ingredient its `dish` stock move (guarded at `expectedVersion`),
 * the item's update and the ingredient row, then the audit events. The dish's
 * `ingredientsMinor` is Σ the ingredients' costs and its total that plus the
 * extras. Refusals write nothing: an ingredient that moved on is `stale` (plan
 * again), one without that much left `ingredient_short`, a group counting in
 * another currency `currency_mismatch`. A repeated idempotency key for the
 * cook writes nothing and answers the dish it made (`replayed: true`).
 */
export interface CookDishInput {
  dish: {
    id: Uuid;
    cook: string;
    orgId: Uuid | null;
    name: string;
    portionsHalf: number;
    extrasMinor: number;
    currency: string;
    splitMode: KitchenDishSplitMode;
    state: Extract<KitchenDishState, "draft" | "open">;
    /** The request's Idempotency-Key (or one minted for it); unique per cook. */
    idemKey: string;
    /** Written as cooked_at, created_at and updated_at, and on every move. */
    now: Date;
    /** The recipe it is cooked from (RC-4), and the factor; absent or null for none. */
    recipeId?: Uuid | null;
    recipeFactorMilli?: number | null;
  };
  /** Bought just now: added to the cook's own pantry before any of it is taken (each is also an ingredient, at version 1). */
  newItems: readonly NewKitchenItem[];
  /** Every ingredient, in the cook's order. */
  ingredients: readonly CookIngredient[];
  /** One `use` transaction per source group whose buyers are owed something. */
  txns: readonly { txn: NewKitchenTxn; splits: readonly KitchenSplit[] }[];
  /** The audit events, one per group the dish touches. */
  audits: readonly AppendEventWithAuditInput[];
  /**
   * How long each step took (GC-2, migration 370): one row per step key in
   * kitchen_dish_step_times, in the same batch as the dish. Absent, null or
   * with no steps, nothing is written.
   */
  stepTimes?: CookDishStepTimes | null;
}

/** A dish's step times, as the worker checked them: each key once, 0 to 86 400 seconds. */
export interface CookDishStepTimes {
  /** The first recipe the dish's recipe was copied from (itself when it is no copy). */
  recipeRootId: Uuid;
  /** The dish's factor; null when it said none. */
  factorMilli: number | null;
  steps: readonly { key: string; seconds: number }[];
}

export interface CookedDish {
  dish: KitchenDishRecord;
  /** True when the cook's idempotency key had already made this dish: nothing was written. */
  replayed: boolean;
}

/** Which dishes a read covers: those `cook` cooked (when set), and those shared with these groups. */
export interface KitchenDishScope {
  cook: string | null;
  /** Group UUIDs. Any number: they bind as one JSON parameter. */
  orgIds: readonly string[];
}

/** Keyset position in a list of dishes (newest first). */
export interface KitchenDishesCursor {
  cookedAt: string;
  id: string;
}

export interface KitchenDishesQuery extends KitchenDishScope {
  state: KitchenDishState | null;
  cursor: KitchenDishesCursor | null;
  limit: number;
}

export interface KitchenDishesPage {
  dishes: KitchenDishRecord[];
  nextCursor: KitchenDishesCursor | null;
}

/**
 * Cancel a dish that is not finalized, in ONE batch: the dish becomes
 * `canceled` (a dish finalized or canceled in the meantime is
 * `dish_not_open`, and nothing is written); each `use` transaction that
 * charged the cook gets its reversal, and every ingredient its quantity and
 * cost back (a `reversal` stock move each, carrying the reversal's id when it
 * had a transaction); then the audit events.
 */
export interface CancelDishInput {
  /** The dish as the caller read it. */
  dish: KitchenDishRecord;
  /** Who cancels it (`usr_…`): its cook. */
  actor: string;
  now: Date;
  audits: readonly AppendEventWithAuditInput[];
}

// ── Splitting dishes (CP-16) ────────────────────────────────

/** A share to write: half portions or an exact amount (exactly one of them). */
export interface NewDishShare {
  id: Uuid;
  subjectId: string;
  portionsHalf: number | null;
  exactMinor: number | null;
}

/**
 * Claim `portionsHalf` half portions of an open dish for `subjectId` (an
 * upsert of their share, `source` self, `set_by` whoever claims — the eater,
 * or since SM-6 another member setting it for them), or take the claim back
 * with 0 — in ONE batch with the dish's version bump. The dish's state is the
 * guard: a dish that is not open, or claims that would exceed its portions,
 * sets the state NULL, which the NOT NULL constraint refuses, and nothing is
 * written (`dish_not_open`, `claims_exceed_portions`). Re-claiming the same
 * amount writes the same row.
 */
export interface ClaimDishInput {
  dishId: Uuid;
  subjectId: string;
  /** 0 removes the claim. */
  portionsHalf: number;
  /** The id a new share row gets (an existing row keeps its own). */
  shareId: Uuid;
  /** Who is setting it (`usr_…`): recorded as the row's `set_by` (SM-6). */
  setBy: string;
  now: Date;
}

/**
 * Replace every share of a draft or open dish with `shares` (each `source`
 * cook, in the order given), in ONE batch with the dish's version bump. A
 * dish finalized or canceled since it was read is `dish_not_open`, and
 * nothing is written.
 */
export interface SetDishSharesInput {
  /** The dish as the caller read it. */
  dish: KitchenDishRecord;
  shares: readonly NewDishShare[];
  /** Who assigns them (`usr_…`: the cook, or an owner or admin): every row's `set_by` (SM-6). */
  setBy: string;
  now: Date;
}

/**
 * Finalize a draft or open dish in ONE batch: its `dish` transaction with
 * its splits (when there is one — a dish for just the cook, or one that cost
 * nothing, has none), its leftovers item in the cook's pantry (when portions
 * went unclaimed), then the dish itself — `finalized`, with both ids — and
 * the audit events. The dish's update applies only at the version the plan
 * read (`stale` otherwise, and nothing is written); a dish finalized in the
 * meantime answers as it is (`replayed: true`); a canceled one is
 * `dish_not_open`.
 */
export interface FinalizeDishInput {
  /** The dish as the caller read it: its version is the guard. */
  dish: KitchenDishRecord;
  txn: { txn: NewKitchenTxn; splits: readonly KitchenSplit[] } | null;
  leftover: NewKitchenItem | null;
  now: Date;
  audits: readonly AppendEventWithAuditInput[];
}

/** What a correction does to a dish's leftovers item. */
export type DishLeftoverChange =
  /** Nothing: there are none and none are wanted, or the cook has touched them. */
  | { kind: "keep" }
  /** New leftovers in the cook's pantry; the dish points at them. */
  | { kind: "create"; item: NewKitchenItem }
  /** The untouched leftovers get a new quantity (all of it left) and price, at `expectedVersion`. */
  | { kind: "update"; itemId: string; expectedVersion: number; qtyMilli: number; priceMinor: number }
  /** The untouched leftovers are removed (nothing went unclaimed), at `expectedVersion`; the dish points at none. */
  | { kind: "remove"; itemId: string; expectedVersion: number };

/**
 * Correct a finalized dish in ONE batch — history is never rewritten: the
 * reversal of its dish transaction (when it had one), its new dish
 * transaction (when there is one), the leftovers change, the dish (its new
 * transaction and leftovers, the version bump) and its shares replaced,
 * then the audit events. Applies only at the version the plan read and, for
 * an update or removal, the leftovers' version (`stale` otherwise); a dish
 * that is not finalized is `dish_not_open`. A repeated request — its new
 * transaction's idempotency key already posted — writes nothing and answers
 * the dish as it is (`replayed: true`).
 */
export interface CorrectDishInput {
  /** The dish as the caller read it: its version is the guard. */
  dish: KitchenDishRecord;
  /** The reversal of the dish's current transaction: paid and owed swapped (the engine's `reverseSplits`). */
  reversal: {
    original: KitchenTxnRecord;
    id: Uuid;
    title: string;
    /** Who corrects the dish (`usr_…`). */
    createdBy: string;
    note: string | null;
    idemKey: string;
    splits: readonly KitchenSplit[];
  } | null;
  txn: { txn: NewKitchenTxn; splits: readonly KitchenSplit[] } | null;
  leftover: DishLeftoverChange;
  shares: readonly NewDishShare[];
  /** Who corrects it (`usr_…`): every new share row's `set_by` (SM-6). */
  setBy: string;
  now: Date;
  audits: readonly AppendEventWithAuditInput[];
}

export interface SplitDish {
  dish: KitchenDishRecord;
  /** True when nothing was written: the dish was already finalized (or this correction already made). */
  replayed: boolean;
}

// ── The daily sweep (CP-18) ─────────────────────────────────

/** The items the daily sweep reads: every pantry's, by use-by date. */
export interface KitchenUseSoonQuery {
  /** The first use-by date in the window (YYYY-MM-DD, inclusive): today. */
  from: string;
  /** The last (inclusive). */
  through: string;
  /** At most this many items, soonest first (a bound on one run, not a page). */
  limit: number;
}

/** One run of the sweep, as recorded (migration 270_kitchen_sweeps). */
export interface RecordSweepInput {
  /** The UTC day swept (YYYY-MM-DD). */
  date: string;
  startedAt: Date;
  finishedAt: Date;
  /** Items in the window. */
  items: number;
  /** People with at least one of them to use. */
  people: number;
  /** Digests notifications-worker accepted. */
  sent: number;
  /** Digests that could not be enqueued. */
  failed: number;
}

/** The latest run of one day's sweep. */
export interface KitchenSweepRecord extends RecordSweepInput {
  /** How many times this day was swept. */
  runs: number;
}

// ── From before (SM-8) ──────────────────────────────────────

/**
 * Past items in the scope's pantries, one row per name (case-insensitively,
 * SQLite's ASCII `lower()`): every record that was bought — active, used up
 * or wasted; not one removed as a mistake, nor a dish's leftovers — counts.
 * Names starting with `q` come first, then names with a word starting with
 * it, then names containing it; newest first within each (the newest
 * record's bought_on, then created_at). Empty `q` matches every name.
 */
export interface KitchenItemHistoryQuery extends KitchenPantryScope {
  q: string;
  limit: number;
}

/** One name bought before: its newest record, and how many records share the name. */
export interface KitchenItemHistoryRecord {
  /** The newest record (latest bought_on, then created_at, then id): what fills the form. */
  item: KitchenItemRecord;
  times: number;
}

/**
 * Past dishes, one row per name (case-insensitively), with the ingredients
 * of the newest one, each matched to an item the caller may use now — in ONE
 * read. Dishes are the caller's own and those shared with `orgIds`, except
 * canceled ones; names match `q` as on `KitchenItemHistoryQuery`, newest
 * first within each tier (cooked_at, then id).
 */
export interface KitchenRecipesQuery {
  /** The caller (`usr_…`): the dishes they cooked, and their own pantry for matches. */
  subjectId: string;
  /** Groups whose shared dishes are read (every group the caller is in). */
  orgIds: readonly string[];
  /** Groups whose items may be matched (the caller's role holds kitchen.item.use there). */
  usableOrgIds: readonly string[];
  q: string;
  limit: number;
}

/**
 * The item an ingredient would come from now: active, something left, the same
 * name (case-insensitively) and dimension, in the caller's own pantry or a
 * usable group — the one in the pantry it came from last time first (the
 * same group; the caller's own pantry for their own dish's own items), then
 * the one with most left, then the soonest use-by, then by id.
 */
export interface KitchenRecipeMatchRecord {
  itemId: string;
  /** Its group; null for the caller's own pantry. */
  orgId: string | null;
  qtyLeftMilli: number;
}

/** One ingredient of the newest dish of a name, in the cook's order. */
export interface KitchenRecipeIngredientRecord {
  /** The item it was taken from. */
  itemId: string;
  /** That item's name now. */
  name: string;
  dimension: KitchenDimension;
  position: number;
  qtyMilli: number;
  /** The unit it was entered in. */
  unit: string;
  /** The group pantry it came from; null for the cook's own. */
  orgId: string | null;
  match: KitchenRecipeMatchRecord | null;
}

/** One dish name cooked before: its newest dish, and how many dishes share the name. */
export interface KitchenRecipeRecord {
  /** The newest dish of the name. */
  dishId: string;
  cook: string;
  /** The group the newest dish was shared with; null for just its cook. */
  orgId: string | null;
  name: string;
  portionsHalf: number;
  extrasMinor: number;
  totalMinor: number;
  currency: string;
  cookedAt: Date;
  times: number;
  ingredients: KitchenRecipeIngredientRecord[];
}

// ── Foods (RC-4, migration 340_kitchen_foods) ───────────────

/** What an amount of a food measures. */
export type KitchenFoodDimension = "mass" | "volume" | "count";

/** One food on the shared list. */
export interface KitchenFoodRecord {
  key: string;
  name: string;
  dimension: KitchenFoodDimension;
  /** One piece in whole grams; null when it is not counted. */
  eachG: number | null;
  category: string;
  /** Grams per millilitre (RC-7), so a spoon of it meets a weight; null when it has none. */
  gPerMl: number | null;
}

/** A food a search found, with its name that matched best. */
export interface KitchenFoodSearchRecord extends KitchenFoodRecord {
  matchedName: string;
}

/** A pantry's answer for a name, as stored. */
export interface KitchenFoodAnswerRecord {
  ownerKind: "user" | "group";
  /** The person (`usr_…`) for a personal pantry, the group's UUID for a group's. */
  ownerId: string;
  /** lower(trim(name)). */
  nameKey: string;
  /** Null: "none of these". */
  foodKey: string | null;
  answeredBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SetFoodAnswerInput {
  owner: KitchenPantryOwner;
  /** The item name it answers for: folded (lower(trim())) by the statement. */
  name: string;
  /** A food on the list (the caller checks it), or null for none. */
  foodKey: string | null;
  /** Who answers (`usr_…`). */
  actor: string;
  now: Date;
}

export interface SetFoodAnswerResult {
  answer: KitchenFoodAnswerRecord;
  /** The items of that name in that pantry the answer now links (or unlinked). */
  linkedItems: number;
}

/** A person's Always have list. */
export interface KitchenAlwaysHave {
  /** By key. */
  foodKeys: string[];
  /** False while they have never saved one: `foodKeys` is the default. */
  isSet: boolean;
}

/** An item and the food it links to. */
export interface KitchenFoodItemRecord {
  item: KitchenItemRecord;
  foodKey: string;
}

// ── Recipes (RC-4, migration 350_kitchen_recipes) ───────────
//
// A recipe is a template (the epic's own word), so its record is
// KitchenRecipeTemplateRecord: SM-8's KitchenRecipeRecord is something else,
// a dish name cooked before ("from before").

export type KitchenRecipeVisibility = "only_me" | "groups" | "link";

/** One line of a recipe, as stored. */
export interface KitchenRecipeLineRecord {
  position: number;
  foodKey: string | null;
  name: string;
  /** Thousandths of the unit's base (g, ml, pieces); null to taste. */
  qtyMilli: number | null;
  /** Null to taste. */
  unit: string | null;
  toTaste: boolean;
  isMain: boolean;
}

export type KitchenRecipeStepPhase = "prep" | "cook";
export type KitchenRecipeStepTimeRule = "fixed" | "partly" | "linear";
export type KitchenRecipeStepSense = "look" | "smell" | "sound" | "feel" | "taste";

/** One step of a recipe, as stored (RC-4; its guided fields GC-2, migration 370). */
export interface KitchenRecipeStepRecord {
  position: number;
  /** Stable across edits and copies; unique per recipe. */
  key: string;
  text: string;
  phase: KitchenRecipeStepPhase;
  /** The recipe lines it uses, by position. */
  lineRefs: number[];
  /** 0 off, 1 low, 2 medium, 3 high; null for none. */
  heat: number | null;
  /** Both or neither; min ≤ max. */
  minSeconds: number | null;
  maxSeconds: number | null;
  /** Never with seconds. */
  whistles: number | null;
  handsOff: boolean;
  timeRule: KitchenRecipeStepTimeRule;
  /** Only with a checkpoint. */
  sense: KitchenRecipeStepSense | null;
  checkpoint: string | null;
  tip: string | null;
}

/**
 * One step as a write gives it: its text alone (a cook step of text only),
 * or every field, the guided ones defaulting as a step of text only reads.
 * A step with no key is given a random one (32 hex characters).
 */
export type NewKitchenRecipeStep =
  | string
  | (Pick<KitchenRecipeStepRecord, "text"> & Partial<Omit<KitchenRecipeStepRecord, "position" | "text" | "key">> & { key?: string | null });

/** The most source links a recipe's root is looked for through. */
export const MAX_RECIPE_ROOT_HOPS = 8;

export interface SetRecipeStepTimesInput {
  recipeId: Uuid;
  /** Only its owner's: anyone else's reads as not found. */
  ownerId: string;
  /** Each key once; min ≤ max, 0 to 86 400. */
  steps: readonly { key: string; minSeconds: number; maxSeconds: number }[];
  now: Date;
}

/** A recipe as stored, with its lines and steps in order. */
export interface KitchenRecipeTemplateRecord {
  id: string;
  /** `usr_…`; `usr_cookpool` for Cookpool's own. */
  ownerId: string;
  name: string;
  servesHalf: number;
  minutes: number | null;
  visibility: KitchenRecipeVisibility;
  linkCode: string | null;
  sourceRecipeId: string | null;
  sourceOwnerId: string | null;
  sourceOwnerName: string | null;
  isSystem: boolean;
  kind: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  lines: KitchenRecipeLineRecord[];
  /** Each step's text, in order (`guidedSteps[i].text`). */
  steps: string[];
  /** The steps in full, in order (GC-2). */
  guidedSteps: KitchenRecipeStepRecord[];
  /** Its tools, in order (GC-2); [] for none. */
  tools: string[];
  /** Live copies saved of it. */
  savedBy: number;
  /** When the viewer last cooked it (a dish with it, not canceled); null if never. */
  lastCookedAt: Date | null;
  /** Listed by its owner (CM-2): with visibility link, a public recipe. */
  listed: boolean;
}

/**
 * Which recipes a list reads — any of these, never a deleted one: the
 * owner's own (any visibility), Cookpool's, and others' shown to their groups
 * or by link (visibility groups or link) by these owners.
 */
export interface KitchenRecipesScope {
  ownerId?: string | null;
  system?: boolean;
  sharedBy?: readonly string[];
  /** These owners' public recipes (listed link recipes, CM-2): a profile's. */
  listedBy?: readonly string[];
  /**
   * Explore's Public (CM-2): every public recipe whose owner has a public
   * profile, without the viewer's own or anyone with a block between them
   * and the viewer.
   */
  publicListed?: boolean;
}

export interface KitchenListRecipesQuery extends KitchenRecipesScope {
  /** Whose last cook `lastCookedAt` is (`usr_…`). */
  viewer: string;
  /** The name contains it, case-insensitively (ASCII). */
  q: string | null;
  kind: string | null;
  limit: number;
  /** Keyset: only recipes created before this one (newest-first paging, CM-2). */
  before?: { createdAt: string; id: string } | null;
}

export interface NewKitchenRecipe {
  id: Uuid;
  ownerId: string;
  name: string;
  servesHalf: number;
  minutes: number | null;
  kind: string | null;
  visibility: KitchenRecipeVisibility;
  /** Exactly when visibility is link. */
  linkCode: string | null;
  /** For a copy: where it came from. */
  source: { recipeId: string; ownerId: string; ownerName: string | null } | null;
  /** In order: each one's position is its index. */
  lines: readonly Omit<KitchenRecipeLineRecord, "position">[];
  /** In order: each one's position is its index. */
  steps: readonly NewKitchenRecipeStep[];
  /** Default none. */
  tools?: readonly string[];
  now: Date;
}

export interface UpdateKitchenRecipeInput {
  recipeId: Uuid;
  /** Only its owner's: anyone else's reads as not found. */
  ownerId: string;
  changes: {
    name?: string;
    servesHalf?: number;
    minutes?: number | null;
    kind?: string | null;
    /** With `link`, the recipe keeps its code, or takes `newLinkCode` when it has none; anything else drops it. */
    visibility?: KitchenRecipeVisibility;
    newLinkCode?: string;
    /**
     * Listed (CM-2). True makes it a link recipe (keeping its code, or taking
     * `newLinkCode`) and lists it; false unlists it. A visibility other than
     * link always unlists.
     */
    listed?: boolean;
    /** Replaces the list (GC-2). */
    tools?: readonly string[];
  };
  lines?: readonly Omit<KitchenRecipeLineRecord, "position">[];
  steps?: readonly NewKitchenRecipeStep[];
  now: Date;
}

/** What `pooledStepTimes` reads (GC-7). */
export interface PooledStepTimesQuery {
  /** The recipe being read: its root's pool is read. */
  recipeId: Uuid;
  /** Its steps' keys (at most a recipe's 20). */
  stepKeys: readonly string[];
  /** A time under this many seconds was a step skipped, not timed. */
  minSeconds: number;
}

/** One time from a recipe root's pool (GC-7). */
export interface KitchenPooledStepTime {
  stepKey: string;
  /** From the step's start to its tick, at the size it was cooked at. */
  seconds: number;
  /** That size, in thousandths: the time's own, else its dish's (never null: a time of no size is left out). */
  factorMilli: number;
  /** Who cooked it: 1, 2, 3… in the order this read met them — the same number for the same cook within one read, and nothing more. */
  cook: number;
}

/** The viewer's last dish of a recipe. */
export interface KitchenRecipeLastCookRecord {
  dishId: string;
  cookedAt: Date;
  recipeFactorMilli: number | null;
  portionsHalf: number;
  /** Its ingredients that named a recipe line, in the cook's order. */
  ingredients: KitchenDishIngredientRecord[];
}
