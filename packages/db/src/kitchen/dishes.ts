// Dishes' storage (Cookpool CP-14, migration 250_kitchen_dishes).
//
// Cooking is ONE batch, so D1 applies all of it or none: the cook's `use`
// transaction in each source group (the ledger's own statements), the dish,
// the items the cook just bought, and for every ingredient a `dish` stock move
// and the item's update (the stock statements a use takes, guarded at the
// version the cost was computed from) and the ingredient row, then the audit
// events. A refusal is read back afterwards, as a use's is: an item that moved
// on is `stale` (the worker plans again), a group counting in another
// currency `currency_mismatch`.
//
// Cancelling is ONE batch too: the dish's state goes to `canceled` — or, if
// it is no longer draft or open, to NULL, which the NOT NULL constraint
// refuses, failing everything — then each `use` transaction's reversal and
// every ingredient's quantity and cost back (the ledger's reversal and
// restock statements).

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import { createLedgerRepository, pinGroupCurrencyStatement, splitsProblem, txnRecordOf, txnStatements } from "./ledger.js";
import { MOVE_COLUMNS, mapMove, newMoveId, restockStatements, reversalRecord } from "./moves.js";
import { ITEM_COLUMNS, Params, createPantryRepository, insertItemStatement, mapItem, scopeClause } from "./pantry.js";
import { takeStockStatements } from "./stock.js";
import type { Uuid } from "../ids/index.js";
import type {
  KitchenDishError,
  KitchenDishIngredientRecord,
  KitchenDishRecord,
  KitchenDishScope,
  KitchenDishSplitMode,
  KitchenDishState,
  KitchenDishesCursor,
  KitchenRepository,
  KitchenResult,
  KitchenStockMoveRecord,
  KitchenTxnRecord,
} from "./types.js";

/** The dishes part of the kitchen repository. */
export type DishesRepository = Pick<
  KitchenRepository,
  "findItems" | "cookDish" | "getDish" | "getDishByIdemKey" | "listDishes" | "cancelDish"
>;

// ── Row mappers ────────────────────────────────────────────

const DISH_COLUMNS = `d.id, d.cook, d.org_id, d.name, d.portions_half, d.extras_minor, d.ingredients_minor,
  d.total_minor, d.currency, d.split_mode, d.state, d.txn_id, d.leftover_item_id, d.cooked_at, d.finalized_at,
  d.canceled_at, d.idem_key, d.created_at, d.updated_at`;

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : new Date(value as string);
}

function mapDish(row: Row, ingredients: KitchenDishIngredientRecord[]): KitchenDishRecord {
  return {
    id: row.id as string,
    cook: row.cook as string,
    orgId: nullableString(row.org_id),
    name: row.name as string,
    portionsHalf: Number(row.portions_half),
    extrasMinor: Number(row.extras_minor),
    ingredientsMinor: Number(row.ingredients_minor),
    totalMinor: Number(row.total_minor),
    currency: row.currency as string,
    splitMode: row.split_mode as KitchenDishSplitMode,
    state: row.state as KitchenDishState,
    txnId: nullableString(row.txn_id),
    leftoverItemId: nullableString(row.leftover_item_id),
    cookedAt: new Date(row.cooked_at as string),
    finalizedAt: nullableDate(row.finalized_at),
    canceledAt: nullableDate(row.canceled_at),
    idemKey: row.idem_key as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    ingredients,
  };
}

function mapIngredient(row: Row): KitchenDishIngredientRecord {
  return {
    itemId: row.item_id as string,
    name: row.name as string,
    position: Number(row.position),
    qtyMilli: Number(row.qty_milli),
    unit: row.unit as string,
    costMinor: Number(row.cost_minor),
    orgId: nullableString(row.org_id),
    paidBy: row.paid_by as string,
    useTxnId: nullableString(row.use_txn_id),
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

function fail(error: KitchenDishError): { ok: false; error: KitchenDishError } {
  return { ok: false, error };
}

const NOT_FOUND = fail({ kind: "not_found" }) as KitchenResult<never>;

/** Dishes `cook` cooked (when set), or shared with one of the groups. */
function dishScopeClause(params: Params, scope: KitchenDishScope): string {
  const groups = `d.org_id IN (SELECT value FROM json_each(${params.add(JSON.stringify(scope.orgIds))}))`;
  if (scope.cook === null) return `(${groups})`;
  return `(d.cook = ${params.add(scope.cook)} OR ${groups})`;
}

/**
 * The reversal of a `use` transaction that charged a cook for a dish they
 * cancel: paid and owed swapped. Its source is the dish, so the ledger's
 * reverse route refuses it like the charge it undoes (cancel is the dish's way
 * back; putting the stock back twice would be wrong).
 */
function cancelReversal(original: KitchenTxnRecord, dishId: string, actor: string, now: Date): KitchenTxnRecord {
  return {
    // A fresh UUID (the moves' minting works for any id).
    id: newMoveId(),
    orgId: original.orgId,
    kind: "reversal",
    title: `Reversal: ${original.title}`,
    totalMinor: original.totalMinor,
    currency: original.currency,
    occurredAt: now,
    createdBy: actor,
    sourceKind: "dish",
    sourceId: dishId,
    reverses: original.id,
    reversedBy: null,
    method: null,
    note: "The dish was canceled",
    // One reversal per transaction, so one key per dish and group is enough.
    idemKey: `dish_${dishId}_cancel`,
    createdAt: now,
    splits: original.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })),
  };
}

// ── Repository functions ───────────────────────────────────

export function createDishesRepository(executor: SqlExecutor): DishesRepository {
  const pantry = createPantryRepository(executor);
  const ledger = createLedgerRepository(executor);

  /** The ingredients of these dishes, each dish's in the cook's order. */
  async function ingredientsOf(dishIds: readonly string[]): Promise<Map<string, KitchenDishIngredientRecord[]>> {
    const byDish = new Map<string, KitchenDishIngredientRecord[]>();
    if (dishIds.length === 0) return byDish;
    const result = await executor.execute(
      `SELECT di.dish_id, di.item_id, i.name, di.position, di.qty_milli, di.unit, di.cost_minor, di.org_id,
              di.paid_by, di.use_txn_id
       FROM kitchen_dish_ingredients di JOIN kitchen_items i ON i.id = di.item_id
       WHERE di.dish_id IN (SELECT value FROM json_each($1))
       ORDER BY di.dish_id, di.position`,
      [JSON.stringify(dishIds)],
    );
    for (const row of result.rows) {
      const dishId = row.dish_id as string;
      const list = byDish.get(dishId) ?? [];
      list.push(mapIngredient(row));
      byDish.set(dishId, list);
    }
    return byDish;
  }

  async function findDish(where: string, params: unknown[]): Promise<KitchenDishRecord | null> {
    const result = await executor.execute(`SELECT ${DISH_COLUMNS} FROM kitchen_dishes d WHERE ${where}`, params);
    const row = result.rows[0];
    if (!row) return null;
    const ingredients = await ingredientsOf([row.id as string]);
    return mapDish(row, ingredients.get(row.id as string) ?? []);
  }

  async function groupCurrency(orgId: string): Promise<string | null> {
    const result = await executor.execute("SELECT currency FROM kitchen_group_settings WHERE org_id = $1", [orgId]);
    const currency = result.rows[0]?.currency;
    return typeof currency === "string" ? currency : null;
  }

  return {
    async findItems(scope, itemIds) {
      if (itemIds.length === 0) return { ok: true, value: [] };
      const params = new Params();
      try {
        const result = await executor.execute(
          `SELECT ${ITEM_COLUMNS} FROM kitchen_items
           WHERE id IN (SELECT value FROM json_each(${params.add(JSON.stringify(itemIds))}))
             AND state <> 'removed' AND ${scopeClause(params, scope)}`,
          params.values,
        );
        return { ok: true, value: result.rows.map(mapItem) };
      } catch (err) {
        return internal(err);
      }
    },

    async cookDish({ dish, newItems, ingredients, txns, audits }) {
      const txnRecords = txns.map((t) => txnRecordOf(t.txn, t.splits));
      for (const record of txnRecords) {
        const problem = splitsProblem(record.totalMinor, record.splits);
        if (problem) return fail({ kind: "invalid", reason: problem });
      }
      const charged = new Set(txnRecords.map((t) => t.id));
      if (ingredients.some((i) => i.useTxnId !== null && !charged.has(i.useTxnId))) {
        return fail({ kind: "invalid", reason: "unknown_use_txn" });
      }
      const ingredientsMinor = ingredients.reduce((sum, i) => sum + i.costMinor, 0);

      const statements: SqlStatement[] = [];
      // The shared group counts in the dish's currency from now on, as its
      // first money write would fix it; the dish goes in only in that currency.
      if (dish.orgId) statements.push(pinGroupCurrencyStatement(dish.orgId, dish.currency, dish.now));
      // Each use transaction and its splits before the moves and ingredient rows that reference it.
      for (const record of txnRecords) statements.push(...txnStatements({ record, audit: undefined }));

      const d = new Params();
      const currency = dish.orgId
        ? `(SELECT currency FROM kitchen_group_settings WHERE org_id = ${d.add(dish.orgId)} AND currency = ${d.add(dish.currency)})`
        : d.add(dish.currency);
      statements.push({
        text: `INSERT INTO kitchen_dishes (
                 id, cook, org_id, name, portions_half, extras_minor, ingredients_minor, total_minor, currency,
                 split_mode, state, cooked_at, idem_key, created_at, updated_at
               ) VALUES (
                 ${d.add(dish.id)}, ${d.add(dish.cook)}, ${d.add(dish.orgId)}, ${d.add(dish.name)},
                 ${d.add(dish.portionsHalf)}, ${d.add(dish.extrasMinor)}, ${d.add(ingredientsMinor)},
                 ${d.add(ingredientsMinor + dish.extrasMinor)}, ${currency}, ${d.add(dish.splitMode)},
                 ${d.add(dish.state)}, ${d.add(dish.now)}, ${d.add(dish.idemKey)}, ${d.add(dish.now)}, ${d.add(dish.now)}
               )`,
        params: d.values,
      });

      // What the cook just bought is in their pantry before any of it is taken.
      for (const item of newItems) statements.push(insertItemStatement(item));

      ingredients.forEach((ingredient, position) => {
        const move: KitchenStockMoveRecord = {
          id: ingredient.moveId,
          itemId: ingredient.itemId,
          kind: "dish",
          qtyMilli: ingredient.qtyMilli,
          costMinor: ingredient.costMinor,
          actor: dish.cook,
          txnId: ingredient.useTxnId,
          dishId: dish.id,
          consumers: null,
          unit: ingredient.unit,
          reverses: null,
          undoneBy: null,
          // The dish's own key (unique per cook) covers its moves.
          idemKey: null,
          createdAt: dish.now,
        };
        statements.push(...takeStockStatements(ingredient.owner, ingredient.expectedVersion, move));
        statements.push({
          text: `INSERT INTO kitchen_dish_ingredients (
                   dish_id, item_id, position, qty_milli, unit, cost_minor, org_id, paid_by, use_txn_id
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          params: [
            dish.id,
            ingredient.itemId,
            position,
            ingredient.qtyMilli,
            ingredient.unit,
            ingredient.costMinor,
            ingredient.owner.kind === "group" ? ingredient.owner.orgId : null,
            ingredient.paidBy,
            ingredient.useTxnId,
          ],
        });
      });
      for (const audit of audits) statements.push(...eventWithAuditStatements(audit));

      try {
        await executeBatch(executor, statements);
        const cooked = await findDish("d.id = $1", [dish.id]);
        return cooked ? { ok: true, value: { dish: cooked, replayed: false } } : internal("kitchen: cooked dish not found");
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            // The same key again from this cook: answer with the dish it made.
            const existing = await findDish("d.cook = $1 AND d.idem_key = $2", [dish.cook, dish.idemKey]);
            if (existing) return { ok: true, value: { dish: existing, replayed: true } };
            return fail({ kind: "conflict", entity: "kitchen_dish" });
          }
          if (isForeignKeyViolation(err)) {
            // A use transaction was not inserted: its group counts in another currency.
            for (const record of txnRecords) {
              const counts = await groupCurrency(record.orgId);
              if (counts && counts !== record.currency) return fail({ kind: "currency_mismatch", currency: counts });
            }
            return internal(err);
          }
          if (isCheckViolation(err)) {
            // An ingredient moved on since it was read, or has not that much left …
            const fresh = new Set(newItems.map((i) => i.id as string));
            for (const ingredient of ingredients) {
              if (fresh.has(ingredient.itemId)) continue;
              const current = await pantry.getItem(ingredient.owner, ingredient.itemId);
              if (!current.ok) return current.error.kind === "not_found" ? fail({ kind: "stale" }) : current;
              const item = current.value;
              if (item.version !== ingredient.expectedVersion || item.state !== "active") return fail({ kind: "stale" });
              if (ingredient.qtyMilli > item.qtyLeftMilli) {
                return fail({ kind: "ingredient_short", itemId: ingredient.itemId, qtyLeftMilli: item.qtyLeftMilli });
              }
            }
            // … or the dish's group counts in another currency.
            if (dish.orgId) {
              const counts = await groupCurrency(dish.orgId);
              if (counts && counts !== dish.currency) return fail({ kind: "currency_mismatch", currency: counts });
            }
            return fail({ kind: "invalid", reason: "dish_out_of_range" });
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
    },

    async getDish(dishId, scope) {
      try {
        const params = new Params();
        const where = `d.id = ${params.add(dishId)} AND ${dishScopeClause(params, scope)}`;
        const dish = await findDish(where, params.values);
        return dish ? { ok: true, value: dish } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async getDishByIdemKey(cook, idemKey) {
      try {
        return { ok: true, value: await findDish("d.cook = $1 AND d.idem_key = $2", [cook, idemKey]) };
      } catch (err) {
        return internal(err);
      }
    },

    async listDishes(query) {
      const params = new Params();
      const where = [dishScopeClause(params, query)];
      if (query.state) where.push(`d.state = ${params.add(query.state)}`);
      if (query.cursor) {
        where.push(`(d.cooked_at, d.id) < (${params.add(query.cursor.cookedAt)}, ${params.add(query.cursor.id)})`);
      }
      try {
        // One extra row says whether there is a next page.
        const result = await executor.execute(
          `SELECT ${DISH_COLUMNS} FROM kitchen_dishes d
           WHERE ${where.join(" AND ")}
           ORDER BY d.cooked_at DESC, d.id DESC
           LIMIT ${params.add(query.limit + 1)}`,
          params.values,
        );
        const rows = result.rows.slice(0, query.limit);
        const ingredients = await ingredientsOf(rows.map((r) => r.id as string));
        const dishes = rows.map((row) => mapDish(row, ingredients.get(row.id as string) ?? []));
        let nextCursor: KitchenDishesCursor | null = null;
        if (result.rows.length > query.limit) {
          const last = dishes[dishes.length - 1]!;
          nextCursor = { cookedAt: last.cookedAt.toISOString(), id: last.id };
        }
        return { ok: true, value: { dishes, nextCursor } };
      } catch (err) {
        return internal(err);
      }
    },

    async cancelDish({ dish, actor, now, audits }) {
      // Cooking's moves still in effect, and the use transactions that
      // charged the cook (and have not been reversed). Both are fixed once
      // the dish is cooked: they were written in its own batch.
      let moves: KitchenStockMoveRecord[];
      const originals: KitchenTxnRecord[] = [];
      try {
        const read = await executor.execute(
          `SELECT ${MOVE_COLUMNS} FROM kitchen_stock_moves m
           WHERE m.dish_id = $1 AND m.kind = 'dish'
           ORDER BY m.created_at, m.rowid`,
          [dish.id],
        );
        moves = read.rows.map(mapMove).filter((m) => m.undoneBy === null);
        const charged = new Map<string, string>();
        for (const i of dish.ingredients) if (i.useTxnId && i.orgId) charged.set(i.useTxnId, i.orgId);
        for (const [txnId, orgId] of charged) {
          const found = await ledger.getTxn(orgId as Uuid, txnId as Uuid);
          if (!found.ok) return found;
          if (found.value.reversedBy === null) originals.push(found.value);
        }
      } catch (err) {
        return internal(err);
      }

      const statements: SqlStatement[] = [
        {
          // The guard: only a draft or open dish is canceled. Anything else
          // sets NULL, which the NOT NULL constraint refuses — the whole
          // batch with it. A dish is never deleted and its cook never
          // changes, so the row the caller read is still there.
          text: `UPDATE kitchen_dishes SET
                   state = CASE WHEN state IN ('draft', 'open') THEN 'canceled' END,
                   canceled_at = $1,
                   updated_at = $1
                 WHERE id = $2 AND cook = $3`,
          params: [now, dish.id, dish.cook],
        },
      ];
      const restock = (move: KitchenStockMoveRecord, txnId: string | null) =>
        restockStatements(move, reversalRecord(move, { id: newMoveId(), actor, txnId, idemKey: null, now }), "id");
      // Each charge is reversed, and the stock it paid for comes back with it …
      for (const original of originals) {
        const reversal = cancelReversal(original, dish.id, actor, now);
        const itsMoves = moves.filter((m) => m.txnId === original.id);
        statements.push(
          ...txnStatements({ record: reversal, audit: undefined, extra: itsMoves.flatMap((m) => restock(m, reversal.id)) }),
        );
      }
      // … and what nobody else paid for (the cook's own, free items) comes back on its own.
      for (const move of moves) if (move.txnId === null) statements.push(...restock(move, null));
      for (const audit of audits) statements.push(...eventWithAuditStatements(audit));

      try {
        await executeBatch(executor, statements);
      } catch (err) {
        try {
          if (isCheckViolation(err) || isUniqueViolation(err)) {
            // Finalized or canceled since it was read: say which.
            const current = await findDish("d.id = $1", [dish.id]);
            if (!current) return NOT_FOUND;
            if (current.state === "canceled" || current.state === "finalized") {
              return fail({ kind: "dish_not_open", state: current.state });
            }
            if (isUniqueViolation(err)) return fail({ kind: "conflict", entity: "kitchen_txn" });
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
      try {
        const canceled = await findDish("d.id = $1", [dish.id]);
        return canceled ? { ok: true, value: canceled } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },
  };
}
