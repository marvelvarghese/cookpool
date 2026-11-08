// Stock moves' rows and the statements that put a move back (Cookpool
// CP-11, migrations 230_kitchen_pantry and 240_kitchen_stock_moves).
//
// Shared by the ledger (reversing a transaction that moved stock puts that
// stock back in the same batch) and the stock repository (an undo of a move
// that moved no money). Statement builders only: nothing here touches the
// executor.

import type { SqlStatement } from "../d1/executor.js";
import type { Uuid } from "../ids/index.js";
import type { KitchenStockMoveKind, KitchenStockMoveRecord, KitchenStockMoveVia } from "./types.js";

/**
 * A move's columns (the table aliased `m`), plus the reversal that put it
 * back — the partial unique index on `reverses` makes that a one-row lookup.
 */
export const MOVE_COLUMNS = `m.id, m.item_id, m.kind, m.qty_milli, m.cost_minor, m.actor, m.txn_id, m.dish_id,
  m.consumers, m.unit, m.label, m.reverses, m.idem_key, m.created_at, m.via,
  (SELECT r.id FROM kitchen_stock_moves r WHERE r.reverses = m.id) AS undone_by`;

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function consumersOf(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.map(String) : null;
}

export function mapMove(row: Row): KitchenStockMoveRecord {
  return {
    id: row.id as string,
    itemId: row.item_id as string,
    kind: row.kind as KitchenStockMoveKind,
    qtyMilli: Number(row.qty_milli),
    costMinor: Number(row.cost_minor),
    actor: row.actor as string,
    txnId: nullableString(row.txn_id),
    dishId: nullableString(row.dish_id),
    consumers: consumersOf(row.consumers),
    unit: nullableString(row.unit),
    label: nullableString(row.label),
    reverses: nullableString(row.reverses),
    undoneBy: nullableString(row.undone_by),
    idemKey: nullableString(row.idem_key),
    createdAt: new Date(row.created_at as string),
    via: viaOf(row.via),
  };
}

/** What wrote a move (migration 410): the column's CHECK keeps it to these two, or NULL. */
function viaOf(value: unknown): KitchenStockMoveVia | null {
  return value === "check" || value === "ask" ? value : null;
}

/** A fresh move id. The package targets plain ES2022, so the runtime's Web Crypto is reached through globalThis. */
export function newMoveId(): Uuid {
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID() as Uuid;
}

/** The order an item's moves happened in: by time, and by insertion within the same millisecond. */
export const MOVE_ORDER_DESC = "m.created_at DESC, m.rowid DESC";

/**
 * The item's latest move still in effect: not a reversal, and not put back.
 * Only that one may be undone directly (an undo stack); `$item` is its item.
 */
export function latestLiveMoveSql(item: string): string {
  return `(SELECT l.id FROM kitchen_stock_moves l
           WHERE l.item_id = ${item} AND l.kind <> 'reversal'
             AND NOT EXISTS (SELECT 1 FROM kitchen_stock_moves lr WHERE lr.reverses = l.id)
           ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1)`;
}

/** A reversal move as it is written: the record the API answers with. */
export function reversalRecord(
  move: KitchenStockMoveRecord,
  reversal: { id: string; actor: string; txnId: string | null; idemKey: string | null; now: Date },
): KitchenStockMoveRecord {
  return {
    id: reversal.id,
    itemId: move.itemId,
    kind: "reversal",
    qtyMilli: move.qtyMilli,
    costMinor: move.costMinor,
    actor: reversal.actor,
    txnId: reversal.txnId,
    dishId: null,
    consumers: null,
    unit: move.unit,
    // It puts back what the move took, in the same words ("2 onions").
    label: move.label,
    reverses: move.id,
    undoneBy: null,
    idemKey: reversal.idemKey,
    createdAt: reversal.now,
    // An undo is an undo, whatever wrote the move it puts back.
    via: null,
  };
}

/**
 * Put `original` back: insert its `reversal` and give its item the quantity
 * and the cost back, waking a used-up or wasted item. With
 * `expectedVersion`, the reversal's item_id is read from the item only while
 * it is at that version, so a stale undo fails the NOT NULL constraint and
 * the whole batch with it; without, the item is restored whatever happened to
 * it since (the moves of a transaction are fixed once it posted, and putting
 * stock back never over-draws). The partial unique index on `reverses` puts a
 * move back at most once. The update returns `returning` of the item.
 *
 * What is left never goes above what was bought: a stock check that raised
 * the level (an `adjust`, PN-4) after the move already counted some of what
 * this puts back, so reversing a use from before it (a transaction reversal,
 * a cancelled dish) stops at full rather than failing the stock CHECK — the
 * money still comes back exactly. Without an adjust it can never reach the
 * cap: what is put back was taken.
 */
export function restockStatements(
  original: KitchenStockMoveRecord,
  reversal: KitchenStockMoveRecord,
  returning: string,
  expectedVersion?: number,
): SqlStatement[] {
  const guarded = expectedVersion !== undefined;
  const itemId = guarded ? "(SELECT id FROM kitchen_items WHERE id = $2 AND version = $12)" : "$2";
  return [
    {
      text: `INSERT INTO kitchen_stock_moves (
               id, item_id, kind, qty_milli, cost_minor, actor, txn_id, consumers, unit, label, reverses, idem_key, created_at
             ) VALUES ($1, ${itemId}, 'reversal', $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11)`,
      params: [
        reversal.id,
        original.itemId,
        reversal.qtyMilli,
        reversal.costMinor,
        reversal.actor,
        reversal.txnId,
        reversal.unit,
        reversal.label,
        original.id,
        reversal.idemKey,
        reversal.createdAt,
        ...(guarded ? [expectedVersion] : []),
      ],
    },
    {
      text: `UPDATE kitchen_items SET
               qty_left_milli = MIN(qty_bought_milli, qty_left_milli + $1),
               cost_taken_minor = cost_taken_minor - $2,
               state = CASE WHEN state IN ('used_up', 'wasted') THEN 'active' ELSE state END,
               version = version + 1,
               updated_at = $3
             WHERE id = $4${guarded ? " AND version = $5" : ""}
             RETURNING ${returning}`,
      params: [original.qtyMilli, original.costMinor, reversal.createdAt, original.itemId, ...(guarded ? [expectedVersion] : [])],
    },
  ];
}

/**
 * The state an item is finished in when it has nothing left, by the latest
 * take of it still in effect: wasted after a waste, used up after a use or a
 * dish (and when there is none). `$item` is the item's id.
 */
function finishedStateSql(item: string): string {
  return `COALESCE((SELECT CASE f.kind WHEN 'waste' THEN 'wasted' ELSE 'used_up' END
                    FROM kitchen_stock_moves f
                    WHERE f.item_id = ${item} AND f.kind IN ('use', 'dish', 'waste')
                      AND NOT EXISTS (SELECT 1 FROM kitchen_stock_moves fr WHERE fr.reverses = f.id)
                    ORDER BY f.created_at DESC, f.rowid DESC LIMIT 1), 'used_up')`;
}

/**
 * Put an `adjust` (a stock check that raised the level, PN-4) back: insert
 * its `reversal` — its item_id read from the item only while it is at
 * `expectedVersion`, else NULL, failing the NOT NULL constraint and the whole
 * batch — and take what it added off the item again. Less left than it added
 * fails the stock CHECK (0 ≤ qty_left), again failing everything. An adjust
 * cost nothing, so the cost taken stays as it is. An item it empties is
 * finished as its latest take left it. The update returns `returning` of the
 * item.
 */
export function unadjustStatements(
  original: KitchenStockMoveRecord,
  reversal: KitchenStockMoveRecord,
  returning: string,
  expectedVersion: number,
): SqlStatement[] {
  return [
    {
      text: `INSERT INTO kitchen_stock_moves (
               id, item_id, kind, qty_milli, cost_minor, actor, txn_id, consumers, unit, label, reverses, idem_key, created_at
             ) VALUES (
               $1, (SELECT id FROM kitchen_items WHERE id = $2 AND version = $9),
               'reversal', $3, 0, $4, NULL, NULL, $5, NULL, $6, $7, $8
             )`,
      params: [
        reversal.id,
        original.itemId,
        reversal.qtyMilli,
        reversal.actor,
        reversal.unit,
        original.id,
        reversal.idemKey,
        reversal.createdAt,
        expectedVersion,
      ],
    },
    {
      text: `UPDATE kitchen_items SET
               qty_left_milli = qty_left_milli - $1,
               state = CASE WHEN qty_left_milli = $1 THEN ${finishedStateSql("$2")} ELSE state END,
               version = version + 1,
               updated_at = $3
             WHERE id = $2 AND version = $4
             RETURNING ${returning}`,
      params: [original.qtyMilli, original.itemId, reversal.createdAt, expectedVersion],
    },
  ];
}
