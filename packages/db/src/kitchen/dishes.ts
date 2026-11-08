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
//
// Splitting a dish (CP-16, migration 260_kitchen_dish_shares) uses the same
// guard. A claim, the cook's assignment, finalizing and a correction each
// update the dish row in their batch, bumping its version; the update sets
// the state NULL — failing the batch — when the dish is in the wrong state,
// when a claim would exceed the portions, or (finalize, correct) when the
// dish has moved on from the version the write was planned at. Finalizing
// posts the `dish` transaction and the leftovers item in the same batch; a
// correction posts the reversal of the dish transaction and a new one, and
// replaces the shares, in one batch too.
//
// Every share write records who made it in `set_by` (SM-6, migration
// 290_kitchen_dish_share_setter): a claim its claimer — the eater, or another
// member setting it for them — and an assignment or a correction its caller.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import { createLedgerRepository, pinGroupCurrencyStatement, splitsProblem, txnRecordOf, txnStatements } from "./ledger.js";
import { MOVE_COLUMNS, mapMove, newMoveId, restockStatements, reversalRecord } from "./moves.js";
import { ITEM_COLUMNS, Params, createPantryRepository, insertItemStatement, mapItem, scopeClause } from "./pantry.js";
import { takeStockStatements } from "./stock.js";
import { linkFoodStatement } from "./food-link.js";
import type { Uuid } from "../ids/index.js";
import type {
  KitchenDishError,
  KitchenDishIngredientRecord,
  KitchenDishRecord,
  KitchenDishShareRecord,
  KitchenDishShareSource,
  NewDishShare,
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
  | "findItems"
  | "cookDish"
  | "getDish"
  | "getDishByIdemKey"
  | "listDishes"
  | "cancelDish"
  | "claimDish"
  | "setDishShares"
  | "finalizeDish"
  | "correctDish"
>;

// ── Row mappers ────────────────────────────────────────────

export const DISH_COLUMNS = `d.id, d.cook, d.org_id, d.name, d.portions_half, d.extras_minor, d.ingredients_minor,
  d.total_minor, d.currency, d.split_mode, d.state, d.txn_id, d.leftover_item_id, d.cooked_at, d.finalized_at,
  d.canceled_at, d.idem_key, d.created_at, d.updated_at, d.version, d.recipe_id, d.recipe_factor_milli, d.split_at`;

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : new Date(value as string);
}

function mapDish(row: Row, ingredients: KitchenDishIngredientRecord[], shares: KitchenDishShareRecord[]): KitchenDishRecord {
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
    version: Number(row.version),
    recipeId: nullableString(row.recipe_id),
    recipeFactorMilli: row.recipe_factor_milli === null || row.recipe_factor_milli === undefined ? null : Number(row.recipe_factor_milli),
    splitAt: nullableDate(row.split_at),
    ingredients,
    shares,
  };
}

function mapShare(row: Row): KitchenDishShareRecord {
  return {
    id: row.id as string,
    subjectId: row.subject_id as string,
    position: Number(row.position),
    portionsHalf: row.portions_half === null || row.portions_half === undefined ? null : Number(row.portions_half),
    exactMinor: row.exact_minor === null || row.exact_minor === undefined ? null : Number(row.exact_minor),
    source: row.source as KitchenDishShareSource,
    setBy: nullableString(row.set_by),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/** An ingredient row (with the item's name as `name`), as stored. */
export function mapDishIngredient(row: Row): KitchenDishIngredientRecord {
  return {
    itemId: row.item_id as string,
    name: row.name as string,
    position: Number(row.position),
    qtyMilli: Number(row.qty_milli),
    unit: row.unit as string,
    label: nullableString(row.label),
    costMinor: Number(row.cost_minor),
    orgId: nullableString(row.org_id),
    paidBy: row.paid_by as string,
    useTxnId: nullableString(row.use_txn_id),
    recipeLine: row.recipe_line === null || row.recipe_line === undefined ? null : Number(row.recipe_line),
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

/** A share row's insert, listed at `position`, written through `source` by `setBy`. */
function insertShareStatement(
  dishId: string,
  share: NewDishShare,
  position: number,
  source: KitchenDishShareSource,
  setBy: string,
  now: Date,
): SqlStatement {
  return {
    text: `INSERT INTO kitchen_dish_shares (
             id, dish_id, subject_id, position, portions_half, exact_minor, source, set_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    params: [share.id, dishId, share.subjectId, position, share.portionsHalf, share.exactMinor, source, setBy, now],
  };
}

/**
 * What the database cannot see across rows, checked before a set of shares
 * is written: one share per person, each portions or an amount (a whole
 * number, portions above zero), portions within what was cooked, amounts
 * within the dish's total. `null` when they hold.
 */
function sharesProblem(dish: KitchenDishRecord, shares: readonly NewDishShare[]): KitchenDishError | null {
  const seen = new Set<string>();
  let portions = 0;
  let exact = 0;
  for (const share of shares) {
    if (seen.has(share.subjectId)) return { kind: "invalid", reason: "duplicate_subject" };
    seen.add(share.subjectId);
    if ((share.portionsHalf === null) === (share.exactMinor === null)) return { kind: "invalid", reason: "share_out_of_range" };
    if (share.portionsHalf !== null && (!Number.isSafeInteger(share.portionsHalf) || share.portionsHalf < 1)) {
      return { kind: "invalid", reason: "share_out_of_range" };
    }
    if (share.exactMinor !== null && (!Number.isSafeInteger(share.exactMinor) || share.exactMinor < 0)) {
      return { kind: "invalid", reason: "share_out_of_range" };
    }
    portions += share.portionsHalf ?? 0;
    exact += share.exactMinor ?? 0;
  }
  if (portions > dish.portionsHalf) {
    return { kind: "claims_exceed_portions", portionsHalf: dish.portionsHalf, availableHalf: dish.portionsHalf };
  }
  if (exact > dish.totalMinor) return { kind: "invalid", reason: "exact_exceeds_total" };
  return null;
}

/** Every new transaction's splits must add up before anything is written. */
function txnsProblem(records: readonly KitchenTxnRecord[]): KitchenDishError | null {
  for (const record of records) {
    const problem = splitsProblem(record.totalMinor, record.splits);
    if (problem) return { kind: "invalid", reason: problem };
  }
  return null;
}

// ── Repository functions ───────────────────────────────────

/** The ingredients of these dishes, each dish's in the cook's order. */
async function ingredientsOf(executor: SqlExecutor, dishIds: readonly string[]): Promise<Map<string, KitchenDishIngredientRecord[]>> {
  const byDish = new Map<string, KitchenDishIngredientRecord[]>();
  if (dishIds.length === 0) return byDish;
  const result = await executor.execute(
    `SELECT di.dish_id, di.item_id, i.name, di.position, di.qty_milli, di.unit, di.label, di.cost_minor, di.org_id,
            di.paid_by, di.use_txn_id, di.recipe_line
     FROM kitchen_dish_ingredients di JOIN kitchen_items i ON i.id = di.item_id
     WHERE di.dish_id IN (SELECT value FROM json_each($1))
     ORDER BY di.dish_id, di.position`,
    [JSON.stringify(dishIds)],
  );
  for (const row of result.rows) {
    const dishId = row.dish_id as string;
    const list = byDish.get(dishId) ?? [];
    list.push(mapDishIngredient(row));
    byDish.set(dishId, list);
  }
  return byDish;
}

/** The shares of these dishes, each dish's in the order they were listed or claimed. */
async function sharesOf(executor: SqlExecutor, dishIds: readonly string[]): Promise<Map<string, KitchenDishShareRecord[]>> {
  const byDish = new Map<string, KitchenDishShareRecord[]>();
  if (dishIds.length === 0) return byDish;
  const result = await executor.execute(
    `SELECT dish_id, id, subject_id, position, portions_half, exact_minor, source, set_by, created_at, updated_at
     FROM kitchen_dish_shares
     WHERE dish_id IN (SELECT value FROM json_each($1))
     ORDER BY dish_id, position, id`,
    [JSON.stringify(dishIds)],
  );
  for (const row of result.rows) {
    const dishId = row.dish_id as string;
    const list = byDish.get(dishId) ?? [];
    list.push(mapShare(row));
    byDish.set(dishId, list);
  }
  return byDish;
}

/** These dish rows (selected with DISH_COLUMNS), each with its ingredients and shares (two reads, however many dishes). */
export async function dishesWithParts(executor: SqlExecutor, rows: readonly Row[]): Promise<KitchenDishRecord[]> {
  const ids = rows.map((r) => r.id as string);
  const ingredients = await ingredientsOf(executor, ids);
  const shares = await sharesOf(executor, ids);
  return rows.map((row) => mapDish(row, ingredients.get(row.id as string) ?? [], shares.get(row.id as string) ?? []));
}

export function createDishesRepository(executor: SqlExecutor): DishesRepository {
  const pantry = createPantryRepository(executor);
  const ledger = createLedgerRepository(executor);

  const withParts = (rows: readonly Row[]) => dishesWithParts(executor, rows);

  async function findDish(where: string, params: unknown[]): Promise<KitchenDishRecord | null> {
    const result = await executor.execute(`SELECT ${DISH_COLUMNS} FROM kitchen_dishes d WHERE ${where}`, params);
    const row = result.rows[0];
    if (!row) return null;
    const [dish] = await withParts([row]);
    return dish ?? null;
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

    async cookDish({ dish, newItems, ingredients, txns, audits, stepTimes }) {
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
                 split_mode, state, cooked_at, idem_key, created_at, updated_at, recipe_id, recipe_factor_milli
               ) VALUES (
                 ${d.add(dish.id)}, ${d.add(dish.cook)}, ${d.add(dish.orgId)}, ${d.add(dish.name)},
                 ${d.add(dish.portionsHalf)}, ${d.add(dish.extrasMinor)}, ${d.add(ingredientsMinor)},
                 ${d.add(ingredientsMinor + dish.extrasMinor)}, ${currency}, ${d.add(dish.splitMode)},
                 ${d.add(dish.state)}, ${d.add(dish.now)}, ${d.add(dish.idemKey)}, ${d.add(dish.now)}, ${d.add(dish.now)},
                 ${d.add(dish.recipeId ?? null)}, ${d.add(dish.recipeFactorMilli ?? null)}
               )`,
        params: d.values,
      });

      // How long each step took (GC-2): one row per step key, beside the dish.
      if (stepTimes && stepTimes.steps.length > 0) {
        statements.push({
          text: `INSERT INTO kitchen_dish_step_times (dish_id, step_key, recipe_root_id, seconds, factor_milli, cook_id, created_at)
                 SELECT $1, json_extract(value, '$.k'), $2, json_extract(value, '$.s'), $3, $4, $5 FROM json_each($6)`,
          params: [
            dish.id, stepTimes.recipeRootId, stepTimes.factorMilli, dish.cook, dish.now,
            JSON.stringify(stepTimes.steps.map((t) => ({ k: t.key, s: t.seconds }))),
          ],
        });
      }

      // What the cook just bought is in their pantry before any of it is taken,
      // linked to its food as any item added is (RC-4).
      for (const item of newItems) statements.push(insertItemStatement(item), linkFoodStatement(item.id));

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
          label: ingredient.label ?? null,
          reverses: null,
          undoneBy: null,
          // The dish's own key (unique per cook) covers its moves.
          idemKey: null,
          createdAt: dish.now,
          via: null,
        };
        statements.push(...takeStockStatements(ingredient.owner, ingredient.expectedVersion, move));
        statements.push({
          text: `INSERT INTO kitchen_dish_ingredients (
                   dish_id, item_id, position, qty_milli, unit, label, cost_minor, org_id, paid_by, use_txn_id, recipe_line
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          params: [
            dish.id,
            ingredient.itemId,
            position,
            ingredient.qtyMilli,
            ingredient.unit,
            ingredient.label ?? null,
            ingredient.costMinor,
            ingredient.owner.kind === "group" ? ingredient.owner.orgId : null,
            ingredient.paidBy,
            ingredient.useTxnId,
            ingredient.recipeLine ?? null,
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
        const dishes = await withParts(result.rows.slice(0, query.limit));
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

    async claimDish({ dishId, subjectId, portionsHalf, shareId, setBy, now }) {
      if (!Number.isSafeInteger(portionsHalf) || portionsHalf < 0) return fail({ kind: "invalid", reason: "share_out_of_range" });
      const statements: SqlStatement[] = [
        {
          // The guard: only an open dish takes claims, and only while this
          // claim and every other eater's portions fit in what was cooked.
          // Anything else sets NULL, which the NOT NULL constraint refuses —
          // the whole batch with it. Two racing claims are serialized by D1,
          // so the second sees the first's row.
          text: `UPDATE kitchen_dishes SET
                   state = CASE
                     WHEN state = 'open'
                      AND $3 + (SELECT COALESCE(SUM(s.portions_half), 0) FROM kitchen_dish_shares s
                                WHERE s.dish_id = kitchen_dishes.id AND s.subject_id <> $2) <= portions_half
                     THEN state
                   END,
                   version = version + 1,
                   updated_at = $4
                 WHERE id = $1`,
          params: [dishId, subjectId, portionsHalf, now],
        },
        portionsHalf === 0
          ? { text: "DELETE FROM kitchen_dish_shares WHERE dish_id = $1 AND subject_id = $2", params: [dishId, subjectId] }
          : {
              // The eater's row: new ones are listed after every share so
              // far; a claim again keeps its place, and replaces an amount
              // the cook had assigned. Whoever set it last is its `set_by`.
              text: `INSERT INTO kitchen_dish_shares (
                       id, dish_id, subject_id, position, portions_half, exact_minor, source, set_by, created_at, updated_at
                     ) VALUES (
                       $1, $2, $3,
                       (SELECT COALESCE(MAX(position) + 1, 0) FROM kitchen_dish_shares WHERE dish_id = $2),
                       $4, NULL, 'self', $6, $5, $5
                     )
                     ON CONFLICT (dish_id, subject_id) DO UPDATE SET
                       portions_half = excluded.portions_half,
                       exact_minor = NULL,
                       source = 'self',
                       set_by = excluded.set_by,
                       updated_at = excluded.updated_at`,
              params: [shareId, dishId, subjectId, portionsHalf, now, setBy],
            },
      ];
      try {
        await executeBatch(executor, statements);
      } catch (err) {
        try {
          if (isForeignKeyViolation(err)) return NOT_FOUND;
          if (isCheckViolation(err)) {
            // Not open any more, or the portions are taken: say which.
            const current = await findDish("d.id = $1", [dishId]);
            if (!current) return NOT_FOUND;
            if (current.state !== "open") return fail({ kind: "dish_not_open", state: current.state });
            const others = current.shares
              .filter((share) => share.subjectId !== subjectId)
              .reduce((sum, share) => sum + (share.portionsHalf ?? 0), 0);
            return fail({
              kind: "claims_exceed_portions",
              portionsHalf: current.portionsHalf,
              availableHalf: Math.max(0, current.portionsHalf - others),
            });
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
      try {
        const claimed = await findDish("d.id = $1", [dishId]);
        return claimed ? { ok: true, value: claimed } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async setDishShares({ dish, shares, setBy, now }) {
      const problem = sharesProblem(dish, shares);
      if (problem) return fail(problem);
      const statements: SqlStatement[] = [
        {
          // The guard: only a draft or open dish takes new shares.
          text: `UPDATE kitchen_dishes SET
                   state = CASE WHEN state IN ('draft', 'open') THEN state END,
                   version = version + 1,
                   updated_at = $2
                 WHERE id = $1`,
          params: [dish.id, now],
        },
        { text: "DELETE FROM kitchen_dish_shares WHERE dish_id = $1", params: [dish.id] },
        ...shares.map((share, position) => insertShareStatement(dish.id, share, position, "cook", setBy, now)),
      ];
      try {
        await executeBatch(executor, statements);
      } catch (err) {
        try {
          if (isCheckViolation(err)) {
            const current = await findDish("d.id = $1", [dish.id]);
            if (!current) return NOT_FOUND;
            if (current.state !== "draft" && current.state !== "open") return fail({ kind: "dish_not_open", state: current.state });
            return fail({ kind: "invalid", reason: "share_out_of_range" });
          }
          if (isUniqueViolation(err)) return fail({ kind: "conflict", entity: "kitchen_dish_share" });
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
      try {
        const assigned = await findDish("d.id = $1", [dish.id]);
        return assigned ? { ok: true, value: assigned } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async finalizeDish({ dish, txn, leftover, now, audits }) {
      const record = txn ? txnRecordOf(txn.txn, txn.splits) : null;
      const problem = txnsProblem(record ? [record] : []);
      if (problem) return fail(problem);

      const statements: SqlStatement[] = [];
      // The dish transaction and the leftovers go in before the dish row that points at them.
      if (record) statements.push(...txnStatements({ record, audit: undefined }));
      if (leftover) statements.push(insertItemStatement(leftover));
      statements.push({
        // The guard: only a draft or open dish, still at the version the
        // split was planned from — no claim or assignment since — is
        // finalized. Anything else sets NULL and fails the batch.
        text: `UPDATE kitchen_dishes SET
                 state = CASE WHEN state IN ('draft', 'open') AND version = $2 THEN 'finalized' END,
                 finalized_at = $3,
                 txn_id = $4,
                 leftover_item_id = $5,
                 version = version + 1,
                 updated_at = $3
               WHERE id = $1`,
        params: [dish.id, dish.version, now, record?.id ?? null, leftover?.id ?? null],
      });
      for (const audit of audits) statements.push(...eventWithAuditStatements(audit));

      try {
        await executeBatch(executor, statements);
      } catch (err) {
        try {
          if (isCheckViolation(err) || isUniqueViolation(err)) {
            const current = await findDish("d.id = $1", [dish.id]);
            if (!current) return NOT_FOUND;
            // Finalized in the meantime (this request again, or another): as it is.
            if (current.state === "finalized") return { ok: true, value: { dish: current, replayed: true } };
            if (current.state === "canceled") return fail({ kind: "dish_not_open", state: current.state });
            if (current.version !== dish.version) return fail({ kind: "stale" });
            if (isUniqueViolation(err)) return fail({ kind: "conflict", entity: "kitchen_txn" });
            return fail({ kind: "invalid", reason: "dish_out_of_range" });
          }
          if (isForeignKeyViolation(err) && dish.orgId) {
            // The dish transaction was not inserted: the group counts in another currency.
            const counts = await groupCurrency(dish.orgId);
            if (counts && counts !== dish.currency) return fail({ kind: "currency_mismatch", currency: counts });
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
      try {
        const finalized = await findDish("d.id = $1", [dish.id]);
        return finalized ? { ok: true, value: { dish: finalized, replayed: false } } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async correctDish({ dish, reversal, txn, leftover, shares, setBy, now, audits }) {
      const shareProblem = sharesProblem(dish, shares);
      if (shareProblem) return fail(shareProblem);
      // A correction reverses the dish's current transaction, nothing else.
      if ((reversal?.original.id ?? null) !== dish.txnId) return fail({ kind: "stale" });
      const reversalRecord: KitchenTxnRecord | null = reversal
        ? {
            id: reversal.id,
            orgId: reversal.original.orgId,
            kind: "reversal",
            title: reversal.title,
            totalMinor: reversal.original.totalMinor,
            currency: reversal.original.currency,
            occurredAt: now,
            createdBy: reversal.createdBy,
            // Its source is the dish, so the ledger's reverse route refuses it like the charge it undoes.
            sourceKind: "dish",
            sourceId: dish.id,
            reverses: reversal.original.id,
            reversedBy: null,
            method: null,
            note: reversal.note,
            idemKey: reversal.idemKey,
            createdAt: now,
            splits: reversal.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor })),
          }
        : null;
      const record = txn ? txnRecordOf(txn.txn, txn.splits) : null;
      const problem = txnsProblem([...(reversalRecord ? [reversalRecord] : []), ...(record ? [record] : [])]);
      if (problem) return fail(problem);

      const statements: SqlStatement[] = [];
      // Undo the dish transaction, then post the new one: history is never rewritten.
      if (reversalRecord) statements.push(...txnStatements({ record: reversalRecord, audit: undefined }));
      if (record) statements.push(...txnStatements({ record, audit: undefined }));
      if (leftover.kind === "create") statements.push(insertItemStatement(leftover.item));

      const d = new Params();
      const touched = leftover.kind === "update" || leftover.kind === "remove";
      // The leftovers are changed only if nobody has touched them since the plan read them.
      const leftoverGuard = touched
        ? ` AND EXISTS (SELECT 1 FROM kitchen_items WHERE id = ${d.add(leftover.itemId)} AND version = ${d.add(leftover.expectedVersion)})`
        : "";
      const leftoverItemId =
        leftover.kind === "create" ? leftover.item.id : leftover.kind === "remove" ? null : dish.leftoverItemId;
      statements.push({
        // The guard: only a finalized dish, still at the version the
        // correction was planned from, is corrected.
        text: `UPDATE kitchen_dishes SET
                 state = CASE WHEN state = 'finalized' AND version = ${d.add(dish.version)}${leftoverGuard} THEN 'finalized' END,
                 txn_id = ${d.add(record?.id ?? null)},
                 leftover_item_id = ${d.add(leftoverItemId)},
                 version = version + 1,
                 updated_at = ${d.add(now)}
               WHERE id = ${d.add(dish.id)}`,
        params: d.values,
      });
      if (leftover.kind === "update") {
        statements.push({
          text: `UPDATE kitchen_items SET
                   qty_bought_milli = $1, qty_left_milli = $1, price_minor = $2, version = version + 1, updated_at = $3
                 WHERE id = $4 AND version = $5`,
          params: [leftover.qtyMilli, leftover.priceMinor, now, leftover.itemId, leftover.expectedVersion],
        });
      } else if (leftover.kind === "remove") {
        statements.push({
          text: `UPDATE kitchen_items SET state = 'removed', version = version + 1, updated_at = $1
                 WHERE id = $2 AND version = $3`,
          params: [now, leftover.itemId, leftover.expectedVersion],
        });
      }
      statements.push({ text: "DELETE FROM kitchen_dish_shares WHERE dish_id = $1", params: [dish.id] });
      shares.forEach((share, position) => statements.push(insertShareStatement(dish.id, share, position, "cook", setBy, now)));
      for (const audit of audits) statements.push(...eventWithAuditStatements(audit));

      try {
        await executeBatch(executor, statements);
      } catch (err) {
        try {
          if (isUniqueViolation(err) && record) {
            // This very correction again: its new transaction is already posted.
            const made = await executor.execute(
              "SELECT id FROM kitchen_txns WHERE org_id = $1 AND idem_key = $2 AND source_id = $3",
              [record.orgId, record.idemKey, dish.id],
            );
            if (made.rows[0]) {
              const current = await findDish("d.id = $1", [dish.id]);
              return current ? { ok: true, value: { dish: current, replayed: true } } : NOT_FOUND;
            }
          }
          if (isCheckViolation(err) || isUniqueViolation(err)) {
            // Corrected (or reversed) by another request since the plan read it, or not finalized.
            const current = await findDish("d.id = $1", [dish.id]);
            if (!current) return NOT_FOUND;
            if (current.state !== "finalized") return fail({ kind: "dish_not_open", state: current.state });
            return fail({ kind: "stale" });
          }
          if (isForeignKeyViolation(err) && dish.orgId) {
            const counts = await groupCurrency(dish.orgId);
            if (counts && counts !== dish.currency) return fail({ kind: "currency_mismatch", currency: counts });
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
      try {
        const corrected = await findDish("d.id = $1", [dish.id]);
        return corrected ? { ok: true, value: { dish: corrected, replayed: false } } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },
  };
}
