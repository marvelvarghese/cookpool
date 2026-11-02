// Stock moves' storage (Cookpool CP-11, migrations 230_kitchen_pantry and
// 240_kitchen_stock_moves).
//
// Every change to what is left of an item is a move, written in ONE batch
// with the item's update — and, when it moves money, with its ledger
// transaction and splits — so D1 applies all of it or none.
//
// Taking stock is optimistic: the caller computes the cost from the item it
// read (the last use costs exactly what is left of the price, so the cost
// depends on that read), and the write applies only while the item is still
// at that version. A batch cannot branch on a row count, so the guard is a
// constraint: the move's item_id is read from the item only at the expected
// version, and anything else is NULL, which the NOT NULL constraint refuses —
// failing the whole batch. The item update then subtracts the quantity, and
// an over-draw fails the item's stock CHECK (0 ≤ qty_left ≤ qty_bought; cost
// taken ≤ price), again failing everything. Which of the two happened is read
// back afterwards: a moved version is `stale` (the caller retries), the same
// version is `insufficient_stock`.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import { createLedgerRepository, pinGroupCurrencyStatement, splitsProblem, txnRecordOf, txnStatements } from "./ledger.js";
import { MOVE_COLUMNS, MOVE_ORDER_DESC, latestLiveMoveSql, mapMove, restockStatements, reversalRecord } from "./moves.js";
import { ITEM_COLUMNS, Params, createPantryRepository, itemColumns, mapItem, ownerClause, scopeClause } from "./pantry.js";
import type { Uuid } from "../ids/index.js";
import type {
  KitchenItemRecord,
  KitchenPantryOwner,
  KitchenRepository,
  KitchenResult,
  KitchenStockMoveRecord,
  KitchenUsualRecord,
  StockMoved,
} from "./types.js";

/** The stock part of the kitchen repository. */
export type StockRepository = Pick<
  KitchenRepository,
  "takeStock" | "transferItem" | "undoMove" | "getMove" | "getMoveByIdemKey" | "listMoves" | "usuals"
>;

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

function fail(error: Exclude<KitchenResult<never>, { ok: true }>["error"]): KitchenResult<never> {
  return { ok: false, error };
}

const NOT_FOUND = fail({ kind: "not_found" });

/** Unused: nothing taken and nothing charged (the same rule edits and removal follow). */
function isUnused(item: KitchenItemRecord): boolean {
  return item.state === "active" && item.qtyLeftMilli === item.qtyBoughtMilli && item.costTakenMinor === 0;
}

/**
 * Take `move` out of its item, as two statements of a batch: the move —
 * its item_id read from the item only while it is at `expectedVersion`,
 * active and in `owner`'s pantry, else NULL, which the NOT NULL constraint
 * refuses (failing the batch) — then the item's update, which subtracts the
 * quantity and adds the cost (an over-draw fails the stock CHECK) and marks an
 * emptied item wasted (waste) or used up (a use, a dish). The update returns
 * the item's columns. Used by a use or waste and by every ingredient of a dish
 * (CP-14).
 */
export function takeStockStatements(
  owner: KitchenPantryOwner,
  expectedVersion: number,
  move: KitchenStockMoveRecord,
): SqlStatement[] {
  const m = new Params();
  const insert: SqlStatement = {
    text: `INSERT INTO kitchen_stock_moves (
             id, item_id, kind, qty_milli, cost_minor, actor, txn_id, dish_id, consumers, unit, idem_key, created_at
           ) VALUES (
             ${m.add(move.id)},
             (SELECT id FROM kitchen_items
              WHERE id = ${m.add(move.itemId)} AND version = ${m.add(expectedVersion)} AND state = 'active'
                AND ${ownerClause(m, owner)}),
             ${m.add(move.kind)}, ${m.add(move.qtyMilli)}, ${m.add(move.costMinor)}, ${m.add(move.actor)},
             ${m.add(move.txnId)}, ${m.add(move.dishId)}, ${m.add(move.consumers ? JSON.stringify(move.consumers) : null)},
             ${m.add(move.unit)}, ${m.add(move.idemKey)}, ${m.add(move.createdAt)}
           )`,
    params: m.values,
  };
  const u = new Params();
  const qty = u.add(move.qtyMilli);
  const update: SqlStatement = {
    text: `UPDATE kitchen_items SET
             qty_left_milli = qty_left_milli - ${qty},
             cost_taken_minor = cost_taken_minor + ${u.add(move.costMinor)},
             state = CASE WHEN qty_left_milli = ${qty} THEN ${u.add(move.kind === "waste" ? "wasted" : "used_up")} ELSE state END,
             version = version + 1,
             updated_at = ${u.add(move.createdAt)}
           WHERE id = ${u.add(move.itemId)} AND version = ${u.add(expectedVersion)}
           RETURNING ${ITEM_COLUMNS}`,
    params: u.values,
  };
  return [insert, update];
}

export function createStockRepository(executor: SqlExecutor): StockRepository {
  const pantry = createPantryRepository(executor);
  const ledger = createLedgerRepository(executor);

  /** The pantry's item, or null when it is not in it (or removed). Throws on a read failure. */
  async function findItem(owner: KitchenPantryOwner, itemId: string): Promise<KitchenItemRecord | null> {
    const found = await pantry.getItem(owner, itemId as Uuid);
    if (found.ok) return found.value;
    if (found.error.kind === "not_found") return null;
    throw new Error(found.error.kind === "internal" ? found.error.message : found.error.kind);
  }

  async function findMoveByIdem(
    owner: KitchenPantryOwner,
    itemId: string,
    idemKey: string,
  ): Promise<KitchenStockMoveRecord | null> {
    const params = new Params();
    const result = await executor.execute(
      `SELECT ${MOVE_COLUMNS} FROM kitchen_stock_moves m JOIN kitchen_items i ON i.id = m.item_id
       WHERE m.item_id = ${params.add(itemId)} AND m.idem_key = ${params.add(idemKey)} AND ${ownerClause(params, owner)}`,
      params.values,
    );
    const row = result.rows[0];
    return row ? mapMove(row) : null;
  }

  /** A repeated key: answer with the move it made, the item as it is now, and the move's transaction. */
  async function replay(owner: KitchenPantryOwner, move: KitchenStockMoveRecord): Promise<KitchenResult<StockMoved>> {
    const item = await findItem(owner, move.itemId);
    if (!item) return NOT_FOUND;
    let txn = null;
    if (move.txnId && owner.kind === "group") {
      const found = await ledger.getTxn(owner.orgId, move.txnId as Uuid);
      if (!found.ok) return found;
      txn = found.value;
    }
    return { ok: true, value: { item, move, txn, replayed: true } };
  }

  async function groupCurrency(orgId: string): Promise<string | null> {
    const result = await executor.execute("SELECT currency FROM kitchen_group_settings WHERE org_id = $1", [orgId]);
    const currency = result.rows[0]?.currency;
    return typeof currency === "string" ? currency : null;
  }

  /** The batch failed a stock guard: the item moved on (`stale`), or there was not that much left. */
  async function whyNotTaken(
    owner: KitchenPantryOwner,
    itemId: string,
    expectedVersion: number,
  ): Promise<KitchenResult<never>> {
    const current = await findItem(owner, itemId);
    if (!current) return NOT_FOUND;
    if (current.version !== expectedVersion || current.state !== "active") return fail({ kind: "stale" });
    return fail({ kind: "insufficient_stock", qtyLeftMilli: current.qtyLeftMilli });
  }

  return {
    async takeStock({ owner, itemId, expectedVersion, move, txn, audit }) {
      const txnRecord = txn ? txnRecordOf(txn.txn, txn.splits) : null;
      if (txnRecord) {
        const problem = splitsProblem(txnRecord.totalMinor, txnRecord.splits);
        if (problem) return fail({ kind: "invalid", reason: problem });
      }
      const record: KitchenStockMoveRecord = {
        id: move.id,
        itemId,
        kind: move.kind,
        qtyMilli: move.qtyMilli,
        costMinor: move.costMinor,
        actor: move.actor,
        txnId: txnRecord?.id ?? null,
        dishId: null,
        consumers: move.consumers ? [...move.consumers] : null,
        unit: move.unit,
        reverses: null,
        undoneBy: null,
        idemKey: move.idemKey,
        createdAt: move.now,
      };

      // The transaction and its splits first: the move's txn_id references it.
      const statements: SqlStatement[] = txnRecord ? txnStatements({ record: txnRecord, audit: undefined }) : [];
      const updateAt = statements.length + 1;
      statements.push(...takeStockStatements(owner, expectedVersion, record));
      if (audit) statements.push(...eventWithAuditStatements(audit));

      try {
        const results = await executeBatch(executor, statements);
        // The move's guard read the item at this version inside the same
        // batch, so the update has matched it.
        const row = results[updateAt]?.rows[0];
        if (!row) return internal("kitchen: stock update returned no row");
        return { ok: true, value: { item: mapItem(row), move: record, txn: txnRecord, replayed: false } };
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            // The same key again on this item: answer with the move it made.
            // A key another request already used in the group's ledger is
            // a conflict.
            const existing = await findMoveByIdem(owner, itemId, move.idemKey);
            if (existing) return await replay(owner, existing);
            return fail({ kind: "conflict", entity: "kitchen_stock_move" });
          }
          if (isForeignKeyViolation(err) && txnRecord) {
            // The transaction was not inserted: the group counts in another currency.
            const currency = await groupCurrency(txnRecord.orgId);
            return currency ? fail({ kind: "currency_mismatch", currency }) : internal(err);
          }
          if (isCheckViolation(err)) return await whyNotTaken(owner, itemId, expectedVersion);
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
    },

    async transferItem({ item, orgId, currency, move, audit }) {
      const buyer = item.ownerSubjectId;
      if (item.ownerKind !== "user" || !buyer) return NOT_FOUND;
      const from: KitchenPantryOwner = { kind: "user", subjectId: buyer };
      const to: KitchenPantryOwner = { kind: "group", orgId };
      const record: KitchenStockMoveRecord = {
        id: move.id,
        itemId: item.id,
        kind: "transfer",
        qtyMilli: item.qtyLeftMilli,
        costMinor: 0,
        actor: move.actor,
        txnId: null,
        dishId: null,
        consumers: null,
        unit: item.displayUnit,
        reverses: null,
        undoneBy: null,
        idemKey: move.idemKey,
        createdAt: move.now,
      };

      const m = new Params();
      const u = new Params();
      const statements: SqlStatement[] = [
        // A group without a settings row counts in the currency it is read as.
        pinGroupCurrencyStatement(orgId, currency, move.now),
        {
          // Only the unused item, at the version read, still in its owner's
          // pantry, and only into a group counting in its currency.
          text: `INSERT INTO kitchen_stock_moves (
                   id, item_id, kind, qty_milli, cost_minor, actor, txn_id, consumers, unit, idem_key, created_at
                 ) VALUES (
                   ${m.add(record.id)},
                   (SELECT id FROM kitchen_items
                    WHERE id = ${m.add(item.id)} AND version = ${m.add(item.version)}
                      AND owner_kind = 'user' AND owner_subject_id = ${m.add(buyer)}
                      AND state = 'active' AND qty_left_milli = qty_bought_milli AND cost_taken_minor = 0
                      AND currency = (SELECT currency FROM kitchen_group_settings WHERE org_id = ${m.add(orgId)})),
                   'transfer', ${m.add(record.qtyMilli)}, 0, ${m.add(record.actor)}, NULL, NULL,
                   ${m.add(record.unit)}, ${m.add(record.idemKey)}, ${m.add(record.createdAt)}
                 )`,
          params: m.values,
        },
        {
          // The item's own key is per pantry; a fresh one derived from the
          // move can never collide with an item already in the group.
          text: `UPDATE kitchen_items SET
                   owner_kind = 'group', owner_subject_id = NULL, org_id = ${u.add(orgId)},
                   paid_by = ${u.add(buyer)}, idem_key = ${u.add(`transfer_${record.id}`)},
                   version = version + 1, updated_at = ${u.add(record.createdAt)}
                 WHERE id = ${u.add(item.id)} AND version = ${u.add(item.version)}
                 RETURNING ${ITEM_COLUMNS}`,
          params: u.values,
        },
      ];
      if (audit) statements.push(...eventWithAuditStatements(audit));

      try {
        const results = await executeBatch(executor, statements);
        const row = results[2]?.rows[0];
        if (!row) return internal("kitchen: transfer update returned no row");
        return { ok: true, value: { item: mapItem(row), move: record, txn: null, replayed: false } };
      } catch (err) {
        try {
          if (isUniqueViolation(err) || isCheckViolation(err)) {
            // A retry of a transfer that already happened: answer with it.
            const existing = await findMoveByIdem(to, item.id, move.idemKey);
            if (existing && existing.kind === "transfer") return await replay(to, existing);
            if (isUniqueViolation(err)) return fail({ kind: "conflict", entity: "kitchen_stock_move" });

            const current = await findItem(from, item.id);
            if (!current) return NOT_FOUND;
            if (current.version !== item.version) return fail({ kind: "stale" });
            if (!isUnused(current)) return fail({ kind: "item_used" });
            const counts = await groupCurrency(orgId);
            if (counts && counts !== current.currency) return fail({ kind: "currency_mismatch", currency: counts });
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
    },

    async undoMove({ owner, move, expectedVersion, reversal, audit }) {
      const record = reversalRecord(move, {
        id: reversal.id,
        actor: reversal.actor,
        txnId: null,
        idemKey: reversal.idemKey,
        now: reversal.now,
      });
      const statements = restockStatements(move, record, ITEM_COLUMNS, expectedVersion);
      if (audit) statements.push(...eventWithAuditStatements(audit));

      try {
        const results = await executeBatch(executor, statements);
        const row = results[1]?.rows[0];
        if (!row) return internal("kitchen: restock update returned no row");
        return { ok: true, value: { item: mapItem(row), move: record, txn: null, replayed: false } };
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            const existing = await findMoveByIdem(owner, move.itemId, reversal.idemKey);
            if (existing && existing.reverses === move.id) return await replay(owner, existing);
            const undone = await executor.execute("SELECT id FROM kitchen_stock_moves WHERE reverses = $1", [move.id]);
            const undoneBy = undone.rows[0]?.id;
            if (typeof undoneBy === "string") return fail({ kind: "already_undone", undoneBy });
            return fail({ kind: "conflict", entity: "kitchen_stock_move" });
          }
          if (isCheckViolation(err)) {
            const current = await findItem(owner, move.itemId);
            if (!current) return NOT_FOUND;
            if (current.version !== expectedVersion) return fail({ kind: "stale" });
            return fail({ kind: "invalid", reason: "restock_out_of_range" });
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
    },

    async getMove(owner, moveId) {
      try {
        const params = new Params();
        const result = await executor.execute(
          `SELECT ${MOVE_COLUMNS}, ${latestLiveMoveSql("m.item_id")} AS latest_move_id
           FROM kitchen_stock_moves m JOIN kitchen_items i ON i.id = m.item_id
           WHERE m.id = ${params.add(moveId)} AND ${ownerClause(params, owner)} AND i.state <> 'removed'`,
          params.values,
        );
        const row = result.rows[0];
        if (!row) return NOT_FOUND;
        const move = mapMove(row);
        const item = await findItem(owner, move.itemId);
        if (!item) return NOT_FOUND;
        const latest = row.latest_move_id;
        return { ok: true, value: { move, item, latestMoveId: typeof latest === "string" ? latest : null } };
      } catch (err) {
        return internal(err);
      }
    },

    async getMoveByIdemKey(owner, itemId, idemKey) {
      try {
        return { ok: true, value: await findMoveByIdem(owner, itemId, idemKey) };
      } catch (err) {
        return internal(err);
      }
    },

    async listMoves(owner, itemId, limit) {
      try {
        const params = new Params();
        const result = await executor.execute(
          `SELECT ${MOVE_COLUMNS} FROM kitchen_stock_moves m JOIN kitchen_items i ON i.id = m.item_id
           WHERE m.item_id = ${params.add(itemId)} AND ${ownerClause(params, owner)} AND i.state <> 'removed'
           ORDER BY ${MOVE_ORDER_DESC}
           LIMIT ${params.add(limit)}`,
          params.values,
        );
        return { ok: true, value: result.rows.map(mapMove) };
      } catch (err) {
        return internal(err);
      }
    },

    async usuals(query) {
      const params = new Params();
      const me = params.add(query.subjectId);
      try {
        // The caller's uses still in effect (logged by them, or naming them)
        // of items in the scope with something left, counted per item; the
        // newest one per item says how it was used last.
        const result = await executor.execute(
          `WITH mine AS (
             SELECT m.item_id, m.qty_milli, m.unit, m.consumers, m.created_at,
                    COUNT(*) OVER (PARTITION BY m.item_id) AS used_count,
                    ROW_NUMBER() OVER (PARTITION BY m.item_id ORDER BY m.created_at DESC, m.rowid DESC) AS rn
             FROM kitchen_stock_moves m JOIN kitchen_items i ON i.id = m.item_id
             WHERE m.kind = 'use' AND m.created_at >= ${params.add(query.since)}
               AND (m.actor = ${me} OR EXISTS (SELECT 1 FROM json_each(m.consumers) c WHERE c.value = ${me}))
               AND NOT EXISTS (SELECT 1 FROM kitchen_stock_moves r WHERE r.reverses = m.id)
               AND i.state = 'active' AND i.qty_left_milli > 0 AND ${scopeClause(params, query)}
           )
           SELECT ${itemColumns("i")}, mine.used_count, mine.qty_milli AS last_qty_milli, mine.unit AS last_unit,
                  mine.consumers AS last_consumers, mine.created_at AS last_used_at
           FROM mine JOIN kitchen_items i ON i.id = mine.item_id
           WHERE mine.rn = 1
           ORDER BY mine.used_count DESC, mine.created_at DESC, i.id
           LIMIT ${params.add(query.limit)}`,
          params.values,
        );
        const usuals: KitchenUsualRecord[] = result.rows.map((row) => {
          const consumers: unknown = typeof row.last_consumers === "string" ? JSON.parse(row.last_consumers) : null;
          return {
            item: mapItem(row),
            usedCount: Number(row.used_count),
            lastQtyMilli: Number(row.last_qty_milli),
            lastUnit: typeof row.last_unit === "string" ? row.last_unit : null,
            lastConsumers: Array.isArray(consumers) ? consumers.map(String) : null,
            lastUsedAt: new Date(row.last_used_at as string),
          };
        });
        return { ok: true, value: usuals };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
