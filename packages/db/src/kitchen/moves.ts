// Stock moves' rows and the statements that put a move back (Cookpool
// CP-11, migrations 230_kitchen_pantry and 240_kitchen_stock_moves).
//
// Shared by the ledger (reversing a transaction that moved stock puts that
// stock back in the same batch) and the stock repository (an undo of a move
// that moved no money). Statement builders only: nothing here touches the
// executor.

import type { SqlStatement } from "../d1/executor.js";
import type { Uuid } from "../ids/index.js";
import type { KitchenStockMoveKind, KitchenStockMoveRecord } from "./types.js";

/**
 * A move's columns (the table aliased `m`), plus the reversal that put it
 * back — the partial unique index on `reverses` makes that a one-row lookup.
 */
export const MOVE_COLUMNS = `m.id, m.item_id, m.kind, m.qty_milli, m.cost_minor, m.actor, m.txn_id, m.dish_id,
  m.consumers, m.unit, m.reverses, m.idem_key, m.created_at,
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
    reverses: nullableString(row.reverses),
    undoneBy: nullableString(row.undone_by),
    idemKey: nullableString(row.idem_key),
    createdAt: new Date(row.created_at as string),
  };
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
    reverses: move.id,
    undoneBy: null,
    idemKey: reversal.idemKey,
    createdAt: reversal.now,
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
 */
export function restockStatements(
  original: KitchenStockMoveRecord,
  reversal: KitchenStockMoveRecord,
  returning: string,
  expectedVersion?: number,
): SqlStatement[] {
  const guarded = expectedVersion !== undefined;
  const itemId = guarded ? "(SELECT id FROM kitchen_items WHERE id = $2 AND version = $11)" : "$2";
  return [
    {
      text: `INSERT INTO kitchen_stock_moves (
               id, item_id, kind, qty_milli, cost_minor, actor, txn_id, consumers, unit, reverses, idem_key, created_at
             ) VALUES ($1, ${itemId}, 'reversal', $3, $4, $5, $6, NULL, $7, $8, $9, $10)`,
      params: [
        reversal.id,
        original.itemId,
        reversal.qtyMilli,
        reversal.costMinor,
        reversal.actor,
        reversal.txnId,
        reversal.unit,
        original.id,
        reversal.idemKey,
        reversal.createdAt,
        ...(guarded ? [expectedVersion] : []),
      ],
    },
    {
      text: `UPDATE kitchen_items SET
               qty_left_milli = qty_left_milli + $1,
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
