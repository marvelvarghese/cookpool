// Pantries' storage (Cookpool CP-10, migration 230_kitchen_pantry).
//
// An item lives in exactly one pantry: a person's own (owner_subject_id) or a
// group's (org_id). Every read here is scoped to the pantries the caller
// passes — kitchen-worker decides which those are (the person themselves, and
// the groups membership says they are in) — so an item outside the scope
// reads as not found. Group lists bind as ONE JSON parameter (`json_each`), so
// a person in many groups never runs into D1's cap on bound parameters.
//
// Adding a group item is the group's first money-bearing write when the group
// has no settings row yet: like the ledger's first transaction, its batch pins
// the currency first and inserts the item only in that currency.

import { executeBatch, type SqlStatement } from "../d1/executor.js";
import type { SqlExecutor } from "../d1/executor.js";
import { isCheckViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import { pinGroupCurrencyStatement } from "./ledger.js";
import type {
  KitchenDimension,
  KitchenItemRecord,
  KitchenItemState,
  KitchenItemsCursor,
  KitchenPantryOwner,
  KitchenPantryScope,
  KitchenPantryTotals,
  KitchenRepository,
  KitchenResult,
  KitchenWastePolicy,
} from "./types.js";

/** The pantry part of the kitchen repository. */
export type PantryRepository = Pick<
  KitchenRepository,
  | "createItem"
  | "getItem"
  | "updateItem"
  | "removeItem"
  | "listItems"
  | "searchItems"
  | "pantryTotals"
>;

// ── Row mappers ────────────────────────────────────────────

export const ITEM_COLUMNS = `id, owner_kind, owner_subject_id, org_id, name, category, dimension, display_unit,
  qty_bought_milli, qty_left_milli, price_minor, cost_taken_minor, currency, paid_by, bought_on,
  expires_on, waste_policy, source_dish_id, state, version, created_by, idem_key, created_at, updated_at`;

/** ITEM_COLUMNS of the table aliased `alias`, for a join (the row keys stay the bare column names). */
export function itemColumns(alias: string): string {
  return ITEM_COLUMNS.split(",")
    .map((column) => `${alias}.${column.trim()}`)
    .join(", ");
}

/** Where an item without a use-by date sorts: after every real date. */
const NO_EXPIRY_KEY = "9999-12-31";

/** The list order's key, as SQL: soonest use-by, then name, then id. */
const EXPIRES_KEY_SQL = `COALESCE(expires_on, '${NO_EXPIRY_KEY}')`;
const NAME_KEY_SQL = "lower(name)";

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function mapItem(row: Row): KitchenItemRecord {
  return {
    id: row.id as string,
    ownerKind: row.owner_kind as "user" | "group",
    ownerSubjectId: nullableString(row.owner_subject_id),
    orgId: nullableString(row.org_id),
    name: row.name as string,
    category: row.category as string,
    dimension: row.dimension as KitchenDimension,
    displayUnit: row.display_unit as string,
    qtyBoughtMilli: Number(row.qty_bought_milli),
    qtyLeftMilli: Number(row.qty_left_milli),
    priceMinor: Number(row.price_minor),
    costTakenMinor: Number(row.cost_taken_minor),
    currency: row.currency as string,
    paidBy: row.paid_by as string,
    boughtOn: row.bought_on as string,
    expiresOn: nullableString(row.expires_on),
    wastePolicy: nullableString(row.waste_policy) as KitchenWastePolicy | null,
    sourceDishId: nullableString(row.source_dish_id),
    state: row.state as KitchenItemState,
    version: Number(row.version),
    createdBy: row.created_by as string,
    idemKey: row.idem_key as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

const NOT_FOUND: KitchenResult<never> = { ok: false, error: { kind: "not_found" } };

/** Escape LIKE's wildcards so a search for "50%" means the characters. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Appends params and returns their `$n`. Lets a statement be assembled from
 * optional clauses without counting placeholders by hand.
 */
export class Params {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** `owner_subject_id = $n` or `org_id = $n`: the one pantry an owner names. */
export function ownerClause(params: Params, owner: KitchenPantryOwner): string {
  return owner.kind === "user"
    ? `owner_kind = 'user' AND owner_subject_id = ${params.add(owner.subjectId)}`
    : `owner_kind = 'group' AND org_id = ${params.add(owner.orgId)}`;
}

/** Every pantry in the scope: the person's own, and each group. */
export function scopeClause(params: Params, scope: KitchenPantryScope): string {
  const groups = `org_id IN (SELECT value FROM json_each(${params.add(JSON.stringify(scope.orgIds))}))`;
  if (scope.ownerSubjectId === null) return `(${groups})`;
  return `(owner_subject_id = ${params.add(scope.ownerSubjectId)} OR ${groups})`;
}

// ── Repository functions ───────────────────────────────────

export function createPantryRepository(executor: SqlExecutor): PantryRepository {
  async function findItem(owner: KitchenPantryOwner, itemId: string): Promise<KitchenItemRecord | null> {
    const params = new Params();
    const result = await executor.execute(
      `SELECT ${ITEM_COLUMNS} FROM kitchen_items
       WHERE id = ${params.add(itemId)} AND ${ownerClause(params, owner)} AND state <> 'removed'`,
      params.values,
    );
    const row = result.rows[0];
    return row ? mapItem(row) : null;
  }

  async function findByIdemKey(owner: KitchenPantryOwner, idemKey: string): Promise<KitchenItemRecord | null> {
    const params = new Params();
    const result = await executor.execute(
      `SELECT ${ITEM_COLUMNS} FROM kitchen_items
       WHERE ${ownerClause(params, owner)} AND idem_key = ${params.add(idemKey)}`,
      params.values,
    );
    const row = result.rows[0];
    return row ? mapItem(row) : null;
  }

  /** Why a conditional edit matched no row: gone, edited since, or used. */
  async function whyUnchanged(
    owner: KitchenPantryOwner,
    itemId: string,
    expectedVersion: number | undefined,
  ): Promise<KitchenResult<never>> {
    const current = await findItem(owner, itemId);
    if (!current) return NOT_FOUND;
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      return { ok: false, error: { kind: "version_conflict", version: current.version } };
    }
    return { ok: false, error: { kind: "item_used" } };
  }

  return {
    async createItem({ item, audit }) {
      const { owner } = item;
      const params = new Params();
      // A group item takes its currency from the group's settings row — the
      // one the batch has just pinned — and only if it is the currency the
      // caller read. Otherwise the value is NULL, the NOT NULL constraint
      // fails, and D1 rolls the whole batch back: nothing is written.
      const currency =
        owner.kind === "group"
          ? `(SELECT currency FROM kitchen_group_settings WHERE org_id = ${params.add(owner.orgId)} AND currency = ${params.add(item.currency)})`
          : params.add(item.currency);
      const insert: SqlStatement = {
        text: `INSERT INTO kitchen_items (
                 id, owner_kind, owner_subject_id, org_id, name, category, dimension, display_unit,
                 qty_bought_milli, qty_left_milli, price_minor, cost_taken_minor, currency, paid_by,
                 bought_on, expires_on, waste_policy, state, version, created_by, idem_key, created_at, updated_at
               ) VALUES (
                 ${params.add(item.id)}, ${params.add(owner.kind)},
                 ${params.add(owner.kind === "user" ? owner.subjectId : null)},
                 ${params.add(owner.kind === "group" ? owner.orgId : null)},
                 ${params.add(item.name)}, ${params.add(item.category)}, ${params.add(item.dimension)},
                 ${params.add(item.displayUnit)}, ${params.add(item.qtyMilli)}, ${params.add(item.qtyMilli)},
                 ${params.add(item.priceMinor)}, 0, ${currency}, ${params.add(item.paidBy)},
                 ${params.add(item.boughtOn)}, ${params.add(item.expiresOn)}, ${params.add(item.wastePolicy)},
                 'active', 1, ${params.add(item.createdBy)}, ${params.add(item.idemKey)},
                 ${params.add(item.now)}, ${params.add(item.now)}
               )
               RETURNING ${ITEM_COLUMNS}`,
        params: params.values,
      };
      const statements: SqlStatement[] = [];
      if (owner.kind === "group") statements.push(pinGroupCurrencyStatement(owner.orgId, item.currency, item.now));
      const insertAt = statements.length;
      statements.push(insert);
      if (audit) statements.push(...eventWithAuditStatements(audit));

      try {
        const results = await executeBatch(executor, statements);
        const row = results[insertAt]?.rows[0];
        return row ? { ok: true, value: { item: mapItem(row), replayed: false } } : internal("kitchen: item insert returned no row");
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            // The same key again in this pantry: answer with what it added.
            const existing = await findByIdemKey(owner, item.idemKey);
            if (existing) return { ok: true, value: { item: existing, replayed: true } };
            return { ok: false, error: { kind: "conflict", entity: "kitchen_item" } };
          }
          if (isCheckViolation(err)) {
            if (owner.kind === "group") {
              const settings = await executor.execute("SELECT currency FROM kitchen_group_settings WHERE org_id = $1", [
                owner.orgId,
              ]);
              const groupCurrency = settings.rows[0]?.currency;
              if (typeof groupCurrency === "string" && groupCurrency !== item.currency) {
                return { ok: false, error: { kind: "currency_mismatch", currency: groupCurrency } };
              }
            }
            return { ok: false, error: { kind: "invalid", reason: "item_out_of_range" } };
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
    },

    async getItem(owner, itemId) {
      try {
        const item = await findItem(owner, itemId);
        return item ? { ok: true, value: item } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async updateItem({ owner, itemId, changes, expectedVersion, now }) {
      const params = new Params();
      const sets: string[] = [];
      if (changes.name !== undefined) sets.push(`name = ${params.add(changes.name)}`);
      if (changes.category !== undefined) sets.push(`category = ${params.add(changes.category)}`);
      if (changes.expiresOn !== undefined) sets.push(`expires_on = ${params.add(changes.expiresOn)}`);
      if (changes.wastePolicy !== undefined) sets.push(`waste_policy = ${params.add(changes.wastePolicy)}`);
      if (changes.quantity !== undefined) {
        const qty = params.add(changes.quantity.qtyMilli);
        sets.push(
          `dimension = ${params.add(changes.quantity.dimension)}`,
          `display_unit = ${params.add(changes.quantity.displayUnit)}`,
          `qty_bought_milli = ${qty}`,
          `qty_left_milli = ${qty}`,
        );
      }
      if (changes.priceMinor !== undefined) sets.push(`price_minor = ${params.add(changes.priceMinor)}`);
      sets.push("version = version + 1", `updated_at = ${params.add(now)}`);

      let where = `id = ${params.add(itemId)} AND ${ownerClause(params, owner)} AND state <> 'removed'`;
      // What was bought is fixed once any of it has been used or charged.
      if (changes.quantity !== undefined || changes.priceMinor !== undefined) {
        where += " AND state = 'active' AND qty_left_milli = qty_bought_milli AND cost_taken_minor = 0";
      }
      if (expectedVersion !== undefined) where += ` AND version = ${params.add(expectedVersion)}`;

      try {
        const result = await executor.execute(
          `UPDATE kitchen_items SET ${sets.join(", ")} WHERE ${where} RETURNING ${ITEM_COLUMNS}`,
          params.values,
        );
        const row = result.rows[0];
        if (row) return { ok: true, value: mapItem(row) };
        return await whyUnchanged(owner, itemId, expectedVersion);
      } catch (err) {
        if (isCheckViolation(err)) return { ok: false, error: { kind: "invalid", reason: "item_out_of_range" } };
        return internal(err);
      }
    },

    async removeItem(owner, itemId, now) {
      const params = new Params();
      try {
        const result = await executor.execute(
          `UPDATE kitchen_items SET state = 'removed', version = version + 1, updated_at = ${params.add(now)}
           WHERE id = ${params.add(itemId)} AND ${ownerClause(params, owner)}
             AND state = 'active' AND qty_left_milli = qty_bought_milli AND cost_taken_minor = 0
           RETURNING ${ITEM_COLUMNS}`,
          params.values,
        );
        const row = result.rows[0];
        if (row) return { ok: true, value: mapItem(row) };
        return await whyUnchanged(owner, itemId, undefined);
      } catch (err) {
        return internal(err);
      }
    },

    async listItems(query) {
      const params = new Params();
      const where = ["state = 'active'", scopeClause(params, query)];
      if (query.q) where.push(`${NAME_KEY_SQL} LIKE lower(${params.add(`%${likeEscape(query.q)}%`)}) ESCAPE '\\'`);
      if (query.expires && "before" in query.expires) {
        where.push(`expires_on IS NOT NULL AND expires_on < ${params.add(query.expires.before)}`);
      } else if (query.expires) {
        where.push(`expires_on BETWEEN ${params.add(query.expires.from)} AND ${params.add(query.expires.to)}`);
      }
      if (query.cursor) {
        where.push(
          `(${EXPIRES_KEY_SQL}, ${NAME_KEY_SQL}, id) > (${params.add(query.cursor.expiresKey)}, ${params.add(query.cursor.nameKey)}, ${params.add(query.cursor.id)})`,
        );
      }
      try {
        // One extra row says whether there is a next page.
        const result = await executor.execute(
          `SELECT ${ITEM_COLUMNS} FROM kitchen_items
           WHERE ${where.join(" AND ")}
           ORDER BY ${EXPIRES_KEY_SQL}, ${NAME_KEY_SQL}, id
           LIMIT ${params.add(query.limit + 1)}`,
          params.values,
        );
        const items = result.rows.map(mapItem);
        let nextCursor: KitchenItemsCursor | null = null;
        if (items.length > query.limit) {
          items.length = query.limit;
          const last = items[query.limit - 1]!;
          // The same keys the ORDER BY sorts on (SQLite's lower() folds ASCII only).
          nextCursor = { expiresKey: last.expiresOn ?? NO_EXPIRY_KEY, nameKey: asciiLower(last.name), id: last.id };
        }
        return { ok: true, value: { items, nextCursor } };
      } catch (err) {
        return internal(err);
      }
    },

    async searchItems(query) {
      const params = new Params();
      const where = ["state = 'active'", "qty_left_milli > 0", scopeClause(params, query)];
      let rank = "0";
      if (query.q) {
        const q = likeEscape(query.q);
        where.push(`${NAME_KEY_SQL} LIKE lower(${params.add(`%${q}%`)}) ESCAPE '\\'`);
        rank = `CASE
            WHEN ${NAME_KEY_SQL} = lower(${params.add(query.q)}) THEN 0
            WHEN ${NAME_KEY_SQL} LIKE lower(${params.add(`${q}%`)}) ESCAPE '\\' THEN 1
            WHEN ${NAME_KEY_SQL} LIKE lower(${params.add(`% ${q}%`)}) ESCAPE '\\' THEN 2
            ELSE 3
          END`;
      }
      try {
        const result = await executor.execute(
          `SELECT ${ITEM_COLUMNS}, ${rank} AS match_rank FROM kitchen_items
           WHERE ${where.join(" AND ")}
           ORDER BY match_rank, ${EXPIRES_KEY_SQL}, ${NAME_KEY_SQL}, id
           LIMIT ${params.add(query.limit)}`,
          params.values,
        );
        return { ok: true, value: result.rows.map(mapItem) };
      } catch (err) {
        return internal(err);
      }
    },

    async pantryTotals(query) {
      const params = new Params();
      const today = params.add(query.today);
      const soonUntil = params.add(query.soonUntil);
      try {
        const result = await executor.execute(
          `SELECT org_id, currency,
                  COUNT(*) AS item_count,
                  SUM(CASE WHEN expires_on BETWEEN ${today} AND ${soonUntil} THEN 1 ELSE 0 END) AS use_soon_count,
                  SUM(CASE WHEN expires_on < ${today} THEN 1 ELSE 0 END) AS expired_count,
                  SUM(price_minor - cost_taken_minor) AS worth_minor
           FROM kitchen_items
           WHERE state = 'active' AND ${scopeClause(params, query)}
           GROUP BY org_id, currency
           ORDER BY org_id, currency`,
          params.values,
        );
        const totals: KitchenPantryTotals[] = result.rows.map((row) => ({
          orgId: nullableString(row.org_id),
          currency: row.currency as string,
          itemCount: Number(row.item_count),
          useSoonCount: Number(row.use_soon_count),
          expiredCount: Number(row.expired_count),
          worthMinor: Number(row.worth_minor),
        }));
        return { ok: true, value: totals };
      } catch (err) {
        return internal(err);
      }
    },
  };
}

/** SQLite's lower(): ASCII letters only, so a cursor's name key matches the ORDER BY. */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}
