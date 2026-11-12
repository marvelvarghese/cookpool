// Always have per pantry and the shopping list's own lines (Cookpool RV-21,
// migration 600_kitchen_staples).
//
// A staple belongs to a pantry: a person's ('user', their usr_…) or a group's
// ('group', its UUID). A person's staples that link to a food are their
// Always have list, which Cook now counts as there (foods.ts reads and
// replaces them). Until a person first changes their list they read the
// default — salt and water — as staples with ids derived from them and the
// food, so a write to one of those finds the same id: every personal write
// first runs `seedPersonal`, which (only while they have no list) writes the
// default rows under those ids and marks the list saved. It is idempotent and
// moves no money, so it is its own batch.
//
// A group's Bought is a money write: its staple update is `boughtStatement`,
// passed to `postTxn` as an extra statement of the expense's batch.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isUniqueViolation } from "../d1/errors.js";
import type { KitchenResult } from "./types.js";

export type StapleOwnerKind = "user" | "group";
export type KitchenStapleStatus = "ok" | "low" | "out";

/** A pantry, as staples and list lines key one. */
export interface StapleOwnerKey {
  kind: StapleOwnerKind;
  /** usr_… for a person, the group's UUID. */
  id: string;
}

export interface KitchenStapleRecord {
  id: string;
  ownerKind: StapleOwnerKind;
  ownerId: string;
  name: string;
  nameKey: string;
  foodKey: string | null;
  status: KitchenStapleStatus;
  lastPriceMinor: number | null;
  currency: string | null;
  lastQtyMilli: number | null;
  lastUnit: string | null;
  wantQtyMilli: number | null;
  wantUnit: string | null;
  lastTxnId: string | null;
  boughtAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
}

export interface KitchenShoppingItemRecord {
  id: string;
  ownerKind: StapleOwnerKind;
  ownerId: string;
  name: string;
  nameKey: string;
  qtyMilli: number | null;
  unit: string | null;
  addedBy: string;
  createdAt: Date;
}

export interface StaplePatch {
  status?: KitchenStapleStatus;
  /** Both together; null clears the list's own amount. */
  want?: { qtyMilli: number | null; unit: string | null };
}

export interface StapleBought {
  priceMinor: number;
  currency: string;
  qtyMilli: number | null;
  unit: string | null;
  txnId: string | null;
}

export type StapleResult<T> = KitchenResult<T> | { ok: false; error: { kind: "not_found" } } | { ok: false; error: { kind: "already_listed" } };

export interface StaplesRepository {
  /** The staples of these pantries, each pantry's by name. ONE read. */
  listStaples(owners: readonly StapleOwnerKey[]): Promise<KitchenResult<KitchenStapleRecord[]>>;
  /** The hand-added list lines of these pantries, oldest first. ONE read. */
  listShoppingItems(owners: readonly StapleOwnerKey[]): Promise<KitchenResult<KitchenShoppingItemRecord[]>>;
  /** Whether the person has a saved Always have list (until then they read the default). */
  personalListSet(userId: string): Promise<KitchenResult<boolean>>;
  addStaple(input: { owner: StapleOwnerKey; id: string; name: string; foodKey: string | null; actor: string; now: Date}): Promise<StapleResult<KitchenStapleRecord>>;
  updateStaple(input: { owner: StapleOwnerKey; id: string; patch: StaplePatch; actor: string; now: Date}): Promise<StapleResult<KitchenStapleRecord>>;
  /** Delete it; the row as it was. */
  removeStaple(input: { owner: StapleOwnerKey; id: string}): Promise<StapleResult<KitchenStapleRecord>>;
  /** A personal Bought: the price (and amount) recorded, status ok, the list's own amount cleared. */
  recordBought(input: { owner: StapleOwnerKey; id: string; bought: StapleBought; actor: string; now: Date}): Promise<StapleResult<KitchenStapleRecord>>;
  /** While the person has no saved list: write their default staples and mark it saved (`seedStatements`). Idempotent. */
  seedPersonal(userId: string, now: Date): Promise<KitchenResult<void>>;
  getStaple(owner: StapleOwnerKey, id: string): Promise<StapleResult<KitchenStapleRecord>>;
  addShoppingItem(input: { owner: StapleOwnerKey; id: string; name: string; qtyMilli: number | null; unit: string | null; actor: string; now: Date }): Promise<StapleResult<KitchenShoppingItemRecord>>;
  updateShoppingItem(input: { owner: StapleOwnerKey; id: string; qtyMilli: number | null; unit: string | null }): Promise<StapleResult<KitchenShoppingItemRecord>>;
  removeShoppingItem(input: { owner: StapleOwnerKey; id: string }): Promise<StapleResult<KitchenShoppingItemRecord>>;
  /**
   * A shopping run was saved: these hand-added lines are deleted and these
   * staples set back to ok (nothing split: the run recorded what was paid),
   * in ONE batch. Ids not in the pantry are skipped; what changed is returned.
   */
  clearShopping(input: { owner: StapleOwnerKey; itemIds: readonly string[]; stapleIds: readonly string[]; actor: string; now: Date }): Promise<
    KitchenResult<{ items: KitchenShoppingItemRecord[]; staples: KitchenStapleRecord[] }>
  >;
}

const STAPLE_COLUMNS =
  "id, owner_kind, owner_id, name, name_key, food_key, status, last_price_minor, currency, last_qty_milli, last_unit, want_qty_milli, want_unit, last_txn_id, bought_at, created_by, created_at, updated_by, updated_at";
const ITEM_COLUMNS = "id, owner_kind, owner_id, name, name_key, qty_milli, unit, added_by, created_at";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function mapStaple(row: Row): KitchenStapleRecord {
  return {
    id: row.id as string,
    ownerKind: row.owner_kind as StapleOwnerKind,
    ownerId: row.owner_id as string,
    name: row.name as string,
    nameKey: row.name_key as string,
    foodKey: str(row.food_key),
    status: row.status as KitchenStapleStatus,
    lastPriceMinor: num(row.last_price_minor),
    currency: str(row.currency),
    lastQtyMilli: num(row.last_qty_milli),
    lastUnit: str(row.last_unit),
    wantQtyMilli: num(row.want_qty_milli),
    wantUnit: str(row.want_unit),
    lastTxnId: str(row.last_txn_id),
    boughtAt: row.bought_at ? new Date(row.bought_at as string) : null,
    createdBy: row.created_by as string,
    createdAt: new Date(row.created_at as string),
    updatedBy: row.updated_by as string,
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapShoppingItem(row: Row): KitchenShoppingItemRecord {
  return {
    id: row.id as string,
    ownerKind: row.owner_kind as StapleOwnerKind,
    ownerId: row.owner_id as string,
    name: row.name as string,
    nameKey: row.name_key as string,
    qtyMilli: num(row.qty_milli),
    unit: str(row.unit),
    addedBy: row.added_by as string,
    createdAt: new Date(row.created_at as string),
  };
}

/** lower(trim(name)), as every kitchen name is keyed. */
export function stapleNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function ownerKeys(owners: readonly StapleOwnerKey[]): string {
  return JSON.stringify(owners.map((o) => `${o.kind}:${o.id}`));
}

function internal(err: unknown): { ok: false; error: { kind: "internal"; message: string } } {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

/** What a person always has until they change their list (foods.ts's KITCHEN_DEFAULT_ALWAYS_HAVE). */
export const DEFAULT_STAPLE_FOODS: readonly string[] = ["salt", "water"];

/** The id of a person's default staple for a food: a UUID from SHA-256 of both, the same every time. */
export async function defaultStapleId(userId: string, foodKey: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kitchen-staple:${userId}:${foodKey}`))).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The statements that, while `userId` has no saved list, write their default
 * staples (salt and water, under `defaultStapleId`) and mark the list saved.
 * Nothing once they have one. First in every personal write's batch.
 */
export async function seedStatements(userId: string, now: Date): Promise<SqlStatement[]> {
  const unsaved = "NOT EXISTS (SELECT 1 FROM kitchen_always_have_lists WHERE user_id = $2)";
  const rows = await Promise.all(
    DEFAULT_STAPLE_FOODS.map(async (key) => ({
      text: `INSERT OR IGNORE INTO kitchen_staples (id, owner_kind, owner_id, name, name_key, food_key, status, created_by, created_at, updated_by, updated_at)
             SELECT $1, 'user', $2, f.name, lower(trim(f.name)), f.key, 'ok', $2, $4, $2, $4 FROM kitchen_foods f
             WHERE f.key = $3 AND ${unsaved}`,
      params: [await defaultStapleId(userId, key), userId, key, now],
    })),
  );
  return [
    ...rows,
    { text: "INSERT OR IGNORE INTO kitchen_always_have_lists (user_id, updated_at) VALUES ($1, $2)", params: [userId, now] },
  ];
}

export function createStaplesRepository(executor: SqlExecutor): StaplesRepository {
  async function findStaple(owner: StapleOwnerKey, id: string): Promise<KitchenStapleRecord | null> {
    const r = await executor.execute(`SELECT ${STAPLE_COLUMNS} FROM kitchen_staples WHERE id = $1 AND owner_kind = $2 AND owner_id = $3`, [id, owner.kind, owner.id]);
    return r.rows[0] ? mapStaple(r.rows[0]) : null;
  }
  async function findItem(owner: StapleOwnerKey, id: string): Promise<KitchenShoppingItemRecord | null> {
    const r = await executor.execute(`SELECT ${ITEM_COLUMNS} FROM kitchen_shopping_items WHERE id = $1 AND owner_kind = $2 AND owner_id = $3`, [id, owner.kind, owner.id]);
    return r.rows[0] ? mapShoppingItem(r.rows[0]) : null;
  }
  /** Run `write` (it returns the id it touched); the staple read back after, or not_found when it touched none. */
  async function writeStaple(owner: StapleOwnerKey, id: string, write: SqlStatement): Promise<StapleResult<KitchenStapleRecord>> {
    try {
      const result = await executor.execute(write.text, write.params ?? []);
      if (result.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
      const staple = await findStaple(owner, id);
      return staple ? { ok: true, value: staple } : { ok: false, error: { kind: "not_found" } };
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, error: { kind: "already_listed" } };
      return internal(err);
    }
  }
  const where = "WHERE id = $1 AND owner_kind = $2 AND owner_id = $3";

  return {
    async listStaples(owners) {
      if (owners.length === 0) return { ok: true, value: [] };
      try {
        const r = await executor.execute(
          `SELECT ${STAPLE_COLUMNS} FROM kitchen_staples
           WHERE (owner_kind || ':' || owner_id) IN (SELECT value FROM json_each($1))
           ORDER BY owner_kind, owner_id, name_key, id`,
          [ownerKeys(owners)],
        );
        return { ok: true, value: r.rows.map(mapStaple) };
      } catch (err) {
        return internal(err);
      }
    },

    async listShoppingItems(owners) {
      if (owners.length === 0) return { ok: true, value: [] };
      try {
        const r = await executor.execute(
          `SELECT ${ITEM_COLUMNS} FROM kitchen_shopping_items
           WHERE (owner_kind || ':' || owner_id) IN (SELECT value FROM json_each($1))
           ORDER BY created_at, id`,
          [ownerKeys(owners)],
        );
        return { ok: true, value: r.rows.map(mapShoppingItem) };
      } catch (err) {
        return internal(err);
      }
    },

    async personalListSet(userId) {
      try {
        const r = await executor.execute("SELECT 1 AS one FROM kitchen_always_have_lists WHERE user_id = $1", [userId]);
        return { ok: true, value: r.rows.length > 0 };
      } catch (err) {
        return internal(err);
      }
    },

    addStaple({ owner, id, name, foodKey, actor, now }) {
      return writeStaple(owner, id, {
        text: `INSERT INTO kitchen_staples (id, owner_kind, owner_id, name, name_key, food_key, status, created_by, created_at, updated_by, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'ok', $7, $8, $7, $8) RETURNING id`,
        params: [id, owner.kind, owner.id, name.trim(), stapleNameKey(name), foodKey, actor, now],
      });
    },

    updateStaple({ owner, id, patch, actor, now }) {
      const sets = ["updated_by = $4", "updated_at = $5"];
      const params: unknown[] = [id, owner.kind, owner.id, actor, now];
      if (patch.status) {
        params.push(patch.status);
        sets.push(`status = $${params.length}`);
      }
      if (patch.want) {
        params.push(patch.want.qtyMilli, patch.want.unit);
        sets.push(`want_qty_milli = $${params.length - 1}`, `want_unit = $${params.length}`);
      }
      return writeStaple(owner, id, { text: `UPDATE kitchen_staples SET ${sets.join(", ")} ${where} RETURNING id`, params });
    },

    async removeStaple({ owner, id }) {
      try {
        const r = await executor.execute(`DELETE FROM kitchen_staples ${where} RETURNING ${STAPLE_COLUMNS}`, [id, owner.kind, owner.id]);
        return r.rows[0] ? { ok: true, value: mapStaple(r.rows[0]) } : { ok: false, error: { kind: "not_found" } };
      } catch (err) {
        return internal(err);
      }
    },

    async clearShopping({ owner, itemIds, stapleIds, actor, now }) {
      try {
        const [items, staples] = await executeBatch(executor, [
          {
            text: `DELETE FROM kitchen_shopping_items WHERE owner_kind = $1 AND owner_id = $2 AND id IN (SELECT value FROM json_each($3)) RETURNING ${ITEM_COLUMNS}`,
            params: [owner.kind, owner.id, JSON.stringify(itemIds)],
          },
          {
            text: `UPDATE kitchen_staples SET status = 'ok', want_qty_milli = NULL, want_unit = NULL, updated_by = $4, updated_at = $5
                   WHERE owner_kind = $1 AND owner_id = $2 AND id IN (SELECT value FROM json_each($3)) RETURNING ${STAPLE_COLUMNS}`,
            params: [owner.kind, owner.id, JSON.stringify(stapleIds), actor, now],
          },
        ]);
        return { ok: true, value: { items: (items?.rows ?? []).map(mapShoppingItem), staples: (staples?.rows ?? []).map(mapStaple) } };
      } catch (err) {
        return internal(err);
      }
    },

    async seedPersonal(userId, now) {
      try {
        await executeBatch(executor, await seedStatements(userId, now));
        return { ok: true, value: undefined };
      } catch (err) {
        return internal(err);
      }
    },

    recordBought({ owner, id, bought, actor, now }) {
      return writeStaple(owner, id, boughtStatement({ owner, id, bought, actor, now }));
    },

    async getStaple(owner, id) {
      try {
        const s = await findStaple(owner, id);
        return s ? { ok: true, value: s } : { ok: false, error: { kind: "not_found" } };
      } catch (err) {
        return internal(err);
      }
    },

    async addShoppingItem({ owner, id, name, qtyMilli, unit, actor, now }) {
      try {
        await executor.execute(
          `INSERT INTO kitchen_shopping_items (id, owner_kind, owner_id, name, name_key, qty_milli, unit, added_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, owner.kind, owner.id, name.trim(), stapleNameKey(name), qtyMilli, unit, actor, now],
        );
        const item = await findItem(owner, id);
        return item ? { ok: true, value: item } : internal("kitchen: shopping item not read back");
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, error: { kind: "already_listed" } };
        return internal(err);
      }
    },

    async updateShoppingItem({ owner, id, qtyMilli, unit }) {
      try {
        const r = await executor.execute(`UPDATE kitchen_shopping_items SET qty_milli = $4, unit = $5 ${where} RETURNING id`, [id, owner.kind, owner.id, qtyMilli, unit]);
        if (r.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        const item = await findItem(owner, id);
        return item ? { ok: true, value: item } : { ok: false, error: { kind: "not_found" } };
      } catch (err) {
        return internal(err);
      }
    },

    async removeShoppingItem({ owner, id }) {
      try {
        const r = await executor.execute(`DELETE FROM kitchen_shopping_items ${where} RETURNING ${ITEM_COLUMNS}`, [id, owner.kind, owner.id]);
        return r.rows[0] ? { ok: true, value: mapShoppingItem(r.rows[0]) } : { ok: false, error: { kind: "not_found" } };
      } catch (err) {
        return internal(err);
      }
    },
  };
}

/** The update a Bought makes: back to ok, the price, amount and expense recorded, the list's own amount cleared. */
export function boughtStatement(input: { owner: StapleOwnerKey; id: string; bought: StapleBought; actor: string; now: Date }): SqlStatement {
  const { owner, id, bought, actor, now } = input;
  return {
    text: `UPDATE kitchen_staples SET status = 'ok', last_price_minor = $4, currency = $5,
             last_qty_milli = COALESCE($6, last_qty_milli), last_unit = CASE WHEN $6 IS NULL THEN last_unit ELSE $7 END,
             want_qty_milli = NULL, want_unit = NULL, last_txn_id = $8, bought_at = $9, updated_by = $10, updated_at = $9
           WHERE id = $1 AND owner_kind = $2 AND owner_id = $3 RETURNING id`,
    params: [id, owner.kind, owner.id, bought.priceMinor, bought.currency, bought.qtyMilli, bought.unit, bought.txnId, now, actor],
  };
}
