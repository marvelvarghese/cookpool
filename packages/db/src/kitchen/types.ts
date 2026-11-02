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
  /** The dish whose leftovers it is (CP-16); absent or null for anything bought. */
  sourceDishId?: string | null;
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

// ── Stock moves (CP-11) ─────────────────────────────────────

export type KitchenStockMoveKind = "use" | "dish" | "waste" | "transfer" | "adjust" | "reversal";

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
  /** For a reversal: the move it puts back. */
  reverses: string | null;
  /** The reversal that put this move back, if any. Read by join, never stored. */
  undoneBy: string | null;
  idemKey: string | null;
  createdAt: Date;
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
 * Put back a move that posted no transaction, in ONE batch: a `reversal`
 * move and the item's restore (what was taken, and what it cost, come back;
 * a used-up or wasted item is active again). Only at `expectedVersion` — the
 * version the caller saw the move as the item's latest at (`stale`).
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

/** One item someone often uses, from their uses since `since`. */
export interface KitchenUsualRecord {
  item: KitchenItemRecord;
  usedCount: number;
  lastQtyMilli: number;
  lastUnit: string | null;
  lastConsumers: string[] | null;
  lastUsedAt: Date;
}

/**
 * Uses since `since` that `subjectId` logged or was named in, of active items
 * with something left in the scope, one row per item: most used first, then
 * most recently used.
 */
export interface KitchenUsualsQuery extends KitchenPantryScope {
  subjectId: string;
  since: Date;
  limit: number;
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
  costMinor: number;
  /** The group pantry it came from; null for the cook's own. */
  orgId: string | null;
  /** Who bought the item (`usr_…`). */
  paidBy: string;
  /** The `use` transaction that charged the cook for it; null when nobody else paid for it. */
  useTxnId: string | null;
}

/** Who set a share: the eater, claiming it; or the cook, assigning it. */
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
  costMinor: number;
  /** Who bought it (`usr_…`). */
  paidBy: string;
  /** The transaction (one of `CookDishInput.txns`) that charges the cook for it; null when none does. */
  useTxnId: Uuid | null;
  /** The id of the `dish` stock move that takes it. */
  moveId: Uuid;
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
  };
  /** Bought just now: added to the cook's own pantry before any of it is taken (each is also an ingredient, at version 1). */
  newItems: readonly NewKitchenItem[];
  /** Every ingredient, in the cook's order. */
  ingredients: readonly CookIngredient[];
  /** One `use` transaction per source group whose buyers are owed something. */
  txns: readonly { txn: NewKitchenTxn; splits: readonly KitchenSplit[] }[];
  /** The audit events, one per group the dish touches. */
  audits: readonly AppendEventWithAuditInput[];
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
 * upsert of their own share, `source` self), or take the claim back with 0 —
 * in ONE batch with the dish's version bump. The dish's state is the guard:
 * a dish that is not open, or claims that would exceed its portions, sets
 * the state NULL, which the NOT NULL constraint refuses, and nothing is
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
  now: Date;
  audits: readonly AppendEventWithAuditInput[];
}

export interface SplitDish {
  dish: KitchenDishRecord;
  /** True when nothing was written: the dish was already finalized (or this correction already made). */
  replayed: boolean;
}
