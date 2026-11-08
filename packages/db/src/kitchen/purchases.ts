// Restocking (Cookpool PN-3, cookpool-pantry design §6.4, migration
// 400_kitchen_purchases): what to buy again, and shopping runs.
//
//   restock         ONE statement over the caller's pantries, grouped by name
//                   per pantry: each name's newest purchase, its latest finish
//                   with no newer active item, its running-low item when no
//                   active one is above the line, and the days it was bought
//                   on lately. Like the "from before" read (history.ts) it
//                   walks the owner and group indexes and needs no name index;
//                   the finish time is the item's last move, read through the
//                   moves' (item_id, created_at) index for the few items that
//                   changed in the window. Removed items and dish leftovers
//                   are not purchases, so they are left out, as there.
//   createPurchase  ONE batch: each group's currency pinned before its first
//                   item, every item with its food link, every group item's
//                   audit event. All of it or none of it.
//   purchaseItems   a purchase's items (one creator's), in the order added.
//   undoPurchase    ONE statement: the purchase's items still unused, in the
//                   pantries given, marked removed — the same rule as removing
//                   one item (nothing taken, nothing charged).
//
// Kept apart from KitchenRepository (its own factory, like the timers') so a
// shopping run's storage is one file beside the rest of the kitchen's.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import type { AppendEventWithAuditInput } from "../events/types.js";
import { linkFoodStatement } from "./food-link.js";
import { pinGroupCurrencyStatement } from "./ledger.js";
import { ITEM_COLUMNS, Params, allowedStatements, insertItemStatement, mapItem, ownerClause, scopeClause } from "./pantry.js";
import type { KitchenItemRecord, KitchenItemState, KitchenPantryOwner, KitchenPantryScope, KitchenResult, NewKitchenItem } from "./types.js";

// ── Restock ────────────────────────────────────────────────

export interface KitchenRestockQuery extends KitchenPantryScope {
  /** A finish (an item's last move) at or after this instant counts: 7 days back. */
  finishedSince: Date;
  /** A purchase on or after this day counts towards a usual (YYYY-MM-DD): 120 days back. */
  boughtSince: string;
  /** An active item with less than this percentage of what was bought left is running low. */
  lowPercent: number;
}

/** One name in one pantry, as the restock read finds it. */
export interface KitchenRestockName {
  ownerKind: "user" | "group";
  /** The group; null for the caller's own pantry. */
  orgId: string | null;
  /** lower(trim(name)): SQLite's lower(), ASCII letters only. */
  nameKey: string;
  /** The newest purchase of the name in the pantry (latest bought_on, then the latest added). */
  last: KitchenItemRecord;
  /**
   * The latest of the name's items used up or wasted since `finishedSince`
   * with no active item of the name added after it, and when (its last move);
   * null when none.
   */
  finished: { item: KitchenItemRecord; at: Date } | null;
  /** The newest active item under `lowPercent`, when no active item of the name is at or above it; else null. */
  low: KitchenItemRecord | null;
  /** How many active items of the name are at or above `lowPercent`. */
  aboveLow: number;
  /** The distinct days it was bought on since `boughtSince`, oldest first. */
  boughtDays: string[];
}

// ── Purchases ──────────────────────────────────────────────

export interface CreatePurchaseInput {
  /** The purchase (a UUID): every item's purchaseId is it. */
  purchaseId: string;
  /** In line order. Each carries its own pantry, and a key unique in that pantry. */
  items: NewKitchenItem[];
  /** The group items' audit events, written in the same batch. */
  audits: AppendEventWithAuditInput[];
}

export interface CreatedPurchase {
  purchaseId: string;
  /** In line order. */
  items: KitchenItemRecord[];
  /**
   * True when the first line's key had already added an item: `items` are
   * the purchase it belongs to, as they are now, and nothing was written.
   */
  replayed: boolean;
}

export interface UndoPurchaseInput {
  purchaseId: string;
  /** Only this person's purchase: its creator. */
  createdBy: string;
  /** The pantries whose items may be removed. */
  scope: KitchenPantryScope;
  now: Date;
}

export interface PurchasesRepository {
  /** Every name in the scope that is finished, running low, or bought on at least `minTimes` days lately with nothing above running low. */
  restock(query: KitchenRestockQuery & { minTimes: number }): Promise<KitchenResult<KitchenRestockName[]>>;
  /** The items, by id, that are in the scope and not removed (a line's `fromItemId`). */
  itemsById(scope: KitchenPantryScope, ids: readonly string[]): Promise<KitchenResult<KitchenItemRecord[]>>;
  createPurchase(input: CreatePurchaseInput): Promise<KitchenResult<CreatedPurchase>>;
  /** The purchase's items `createdBy` added, in the scope, in the order they were added; empty when none. */
  purchaseItems(purchaseId: string, createdBy: string, scope: KitchenPantryScope): Promise<KitchenResult<KitchenItemRecord[]>>;
  /** Remove the purchase's unused items in the scope; the ones removed now. */
  undoPurchase(input: UndoPurchaseInput): Promise<KitchenResult<KitchenItemRecord[]>>;
}

type Row = Record<string, unknown>;

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

function keyOf(row: Row): string {
  return `${String(row.owner_kind)}|${String(row.pantry_id)}|${String(row.name_key)}`;
}

/** The read's rows (one or more per name), folded into one record per name and pantry, in the read's order. */
function foldRestock(rows: readonly Row[]): KitchenRestockName[] {
  const byKey = new Map<string, { rows: Row[] }>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = byKey.get(key) ?? { rows: [] };
    group.rows.push(row);
    byKey.set(key, group);
  }
  const names: KitchenRestockName[] = [];
  for (const { rows: group } of byKey.values()) {
    const newest = group.find((r) => Number(r.newest) === 1);
    if (!newest) continue; // Every returned name carries its newest row; defensive only.
    let finished: KitchenRestockName["finished"] = null;
    let low: KitchenRestockName["low"] = null;
    let lowRank = Infinity;
    for (const row of group) {
      if (Number(row.is_finished) === 1) {
        const at = new Date(row.finished_at as string);
        if (!finished || at > finished.at) finished = { item: mapItem(row), at };
      }
      if (Number(row.is_low) === 1 && Number(row.newest) < lowRank) {
        low = mapItem(row);
        lowRank = Number(row.newest);
      }
    }
    const days = typeof newest.bought_days === "string" && newest.bought_days !== "" ? newest.bought_days.split(",") : [];
    names.push({
      ownerKind: newest.owner_kind as "user" | "group",
      orgId: newest.org_id === null || newest.org_id === undefined ? null : String(newest.org_id),
      nameKey: String(newest.name_key),
      last: mapItem(newest),
      finished,
      low,
      aboveLow: Number(newest.above_low),
      boughtDays: [...new Set(days)].sort(),
    });
  }
  return names;
}

export function createPurchasesRepository(executor: SqlExecutor): PurchasesRepository {
  async function findPurchaseOf(owner: KitchenPantryOwner, idemKey: string): Promise<{ purchaseId: string | null } | null> {
    const params = new Params();
    const result = await executor.execute(
      `SELECT purchase_id FROM kitchen_items WHERE ${ownerClause(params, owner)} AND idem_key = ${params.add(idemKey)}`,
      params.values,
    );
    const row = result.rows[0];
    if (!row) return null;
    return { purchaseId: typeof row.purchase_id === "string" ? row.purchase_id : null };
  }

  async function allOf(purchaseId: string): Promise<KitchenItemRecord[]> {
    const result = await executor.execute(
      `SELECT ${ITEM_COLUMNS} FROM kitchen_items WHERE purchase_id = $1 ORDER BY rowid`,
      [purchaseId],
    );
    return result.rows.map(mapItem);
  }

  return {
    async restock(query) {
      const params = new Params();
      const since = params.add(query.finishedSince);
      const boughtSince = params.add(query.boughtSince);
      const pct = params.add(query.lowPercent);
      const scope = scopeClause(params, query);
      const minTimes = params.add(query.minTimes);
      try {
        const result = await executor.execute(
          `WITH scoped AS MATERIALIZED (
             SELECT ${ITEM_COLUMNS},
                    lower(trim(name)) AS name_key,
                    COALESCE(owner_subject_id, org_id) AS pantry_id,
                    CASE WHEN state IN ('used_up', 'wasted') AND updated_at >= ${since}
                         THEN (SELECT MAX(m.created_at) FROM kitchen_stock_moves m WHERE m.item_id = i.id)
                    END AS finished_at
             FROM kitchen_items i
             WHERE state <> 'removed' AND source_dish_id IS NULL AND ${scope}
           ),
           names AS MATERIALIZED (
             SELECT owner_kind, pantry_id, name_key,
                    COUNT(DISTINCT CASE WHEN bought_on >= ${boughtSince} THEN bought_on END) AS times,
                    group_concat(DISTINCT CASE WHEN bought_on >= ${boughtSince} THEN bought_on END) AS bought_days,
                    MAX(CASE WHEN state = 'active' THEN created_at END) AS newest_active_at,
                    SUM(CASE WHEN state = 'active' AND qty_left_milli * 100 >= qty_bought_milli * ${pct} THEN 1 ELSE 0 END) AS above_low
             FROM scoped
             GROUP BY owner_kind, pantry_id, name_key
           ),
           flagged AS (
             SELECT s.*, n.times, n.bought_days, n.above_low,
                    CASE WHEN s.finished_at >= ${since}
                              AND (n.newest_active_at IS NULL OR s.created_at > n.newest_active_at)
                         THEN 1 ELSE 0 END AS is_finished,
                    CASE WHEN s.state = 'active' AND s.qty_left_milli * 100 < s.qty_bought_milli * ${pct} AND n.above_low = 0
                         THEN 1 ELSE 0 END AS is_low,
                    ROW_NUMBER() OVER (
                      PARTITION BY s.owner_kind, s.pantry_id, s.name_key
                      ORDER BY s.bought_on DESC, s.created_at DESC, s.id DESC
                    ) AS newest
             FROM scoped s
             JOIN names n ON n.owner_kind = s.owner_kind AND n.pantry_id = s.pantry_id AND n.name_key = s.name_key
           ),
           marked AS (
             SELECT f.*, MAX(f.is_finished) OVER w AS any_finished, MAX(f.is_low) OVER w AS any_low
             FROM flagged f
             WINDOW w AS (PARTITION BY f.owner_kind, f.pantry_id, f.name_key)
           )
           SELECT ${ITEM_COLUMNS}, name_key, pantry_id, finished_at, times, bought_days, above_low, is_finished, is_low, newest
           FROM marked
           WHERE is_finished = 1 OR is_low = 1
              OR (newest = 1 AND (any_finished = 1 OR any_low = 1 OR (times >= ${minTimes} AND above_low = 0)))
           ORDER BY owner_kind, pantry_id, name_key, newest`,
          params.values,
        );
        return { ok: true, value: foldRestock(result.rows) };
      } catch (err) {
        return internal(err);
      }
    },

    async itemsById(scope, ids) {
      if (ids.length === 0) return { ok: true, value: [] };
      const params = new Params();
      try {
        const result = await executor.execute(
          `SELECT ${ITEM_COLUMNS} FROM kitchen_items
           WHERE id IN (SELECT value FROM json_each(${params.add(JSON.stringify(ids))}))
             AND state <> 'removed' AND ${scopeClause(params, scope)}`,
          params.values,
        );
        return { ok: true, value: result.rows.map(mapItem) };
      } catch (err) {
        return internal(err);
      }
    },

    async createPurchase({ purchaseId, items, audits }) {
      if (items.length === 0) return { ok: false, error: { kind: "invalid", reason: "purchase_empty" } };
      const statements: SqlStatement[] = [];
      const pinned = new Set<string>();
      const insertAt: number[] = [];
      for (const item of items) {
        if (item.purchaseId !== purchaseId) return { ok: false, error: { kind: "invalid", reason: "purchase_mismatch" } };
        // A group without a settings row counts in the currency it was read as: pinned before its first item.
        if (item.owner.kind === "group" && !pinned.has(item.owner.orgId)) {
          pinned.add(item.owner.orgId);
          statements.push(pinGroupCurrencyStatement(item.owner.orgId, item.currency, item.now));
        }
        insertAt.push(statements.length);
        // A line from an ask-first item keeps who may use it without asking (PN-8).
        statements.push(insertItemStatement(item), linkFoodStatement(item.id), ...allowedStatements(item));
      }
      for (const audit of audits) statements.push(...eventWithAuditStatements(audit));

      try {
        const results = await executeBatch(executor, statements);
        const created = insertAt.map((at) => results[at]?.rows[0]);
        if (created.some((row) => !row)) return internal("kitchen: purchase insert returned no row");
        return { ok: true, value: { purchaseId, items: created.map((row) => mapItem(row!)), replayed: false } };
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            // The first line's key again in its pantry: answer with the purchase it made.
            const first = items[0]!;
            const found = await findPurchaseOf(first.owner, first.idemKey);
            if (found?.purchaseId) {
              return { ok: true, value: { purchaseId: found.purchaseId, items: await allOf(found.purchaseId), replayed: true } };
            }
            return { ok: false, error: { kind: "conflict", entity: "kitchen_purchase" } };
          }
          if (isCheckViolation(err)) {
            // A group pinned to another currency between the read and the write.
            for (const orgId of pinned) {
              const settings = await executor.execute("SELECT currency FROM kitchen_group_settings WHERE org_id = $1", [orgId]);
              const currency = settings.rows[0]?.currency;
              const wanted = items.find((i) => i.owner.kind === "group" && i.owner.orgId === orgId)?.currency;
              if (typeof currency === "string" && currency !== wanted) {
                return { ok: false, error: { kind: "currency_mismatch", currency } };
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

    async purchaseItems(purchaseId, createdBy, scope) {
      const params = new Params();
      try {
        const result = await executor.execute(
          `SELECT ${ITEM_COLUMNS} FROM kitchen_items
           WHERE purchase_id = ${params.add(purchaseId)} AND created_by = ${params.add(createdBy)}
             AND ${scopeClause(params, scope)}
           ORDER BY rowid`,
          params.values,
        );
        return { ok: true, value: result.rows.map(mapItem) };
      } catch (err) {
        return internal(err);
      }
    },

    async undoPurchase({ purchaseId, createdBy, scope, now }) {
      const params = new Params();
      const removed: KitchenItemState = "removed";
      try {
        // One statement: an item used between the caller's read and this
        // write no longer matches, and stays.
        const result = await executor.execute(
          `UPDATE kitchen_items SET state = ${params.add(removed)}, version = version + 1, updated_at = ${params.add(now)}
           WHERE purchase_id = ${params.add(purchaseId)} AND created_by = ${params.add(createdBy)}
             AND ${scopeClause(params, scope)}
             AND state = 'active' AND qty_left_milli = qty_bought_milli AND cost_taken_minor = 0
           RETURNING ${ITEM_COLUMNS}`,
          params.values,
        );
        return { ok: true, value: result.rows.map(mapItem) };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
