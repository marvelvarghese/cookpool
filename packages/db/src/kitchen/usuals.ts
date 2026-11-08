// What someone often uses (Cookpool CP-11; by food and by time of day,
// PN-2 — cookpool-pantry design §2.1). No migration: it reads
// kitchen_items and kitchen_stock_moves as they are.
//
// A usual is kept per food, not per item. A food is a pantry, a name key
// (`lower(trim(name))`, as measures use) and a dimension: every pack of milk
// bought into Flat 4B is the same food, so a new pack inherits the old one's
// usual, while milk in another pantry — or milk counted in packs rather
// than litres — is another food.
//
// ONE statement, however many items, pantries and uses:
//   scoped     items in the scope (any state but removed: a finished pack's
//              uses still count), with their food;
//   mine       the person's uses since `since` (logged by them, or naming them
//              as a consumer), not reversed and not written by a stock check
//              (PN-4: a split check names everyone, and fixing the level is
//              not a habit), with the local hour they fell in;
//   ranked     each use's place in its food and in its item, newest first;
//   in_bucket  the uses in the bucket's hours since its own `since`, counted
//              per food and per amount; bucket_pick keeps the most frequent
//              amount (ties: the most recent use of it);
// and one row per active item with something left whose food has any use:
// most used first, then most recently used.
//
// The lookups go by indexes that exist: items by pantry and state
// (`kitchen_items_owner_state_idx`, `kitchen_items_org_state_idx`), moves by
// item and time (`kitchen_stock_moves_item_idx`); grouping by name key is over
// the scope's items, so it needs no index of its own.

import type { SqlExecutor } from "../d1/executor.js";
import { Params, itemColumns, mapItem, scopeClause } from "./pantry.js";
import type { KitchenResult, KitchenUsualBucketRecord, KitchenUsualRecord, KitchenUsualsQuery } from "./types.js";

type Row = Record<string, unknown>;

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

/** SQLite's date modifier for a shift of `minutes`: "+330 minutes", "-300 minutes". */
export function minutesModifier(minutes: number): string {
  const whole = Math.trunc(minutes);
  return `${whole < 0 ? "-" : "+"}${Math.abs(whole)} minutes`;
}

const FOOD = "pantry_key, name_key, dimension";
const NEWEST = "created_at DESC, seq DESC";

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function people(value: unknown): string[] | null {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : null;
  return Array.isArray(parsed) ? parsed.map(String) : null;
}

function bucketOf(row: Row): KitchenUsualBucketRecord | null {
  if (row.bucket_count === null || row.bucket_count === undefined) return null;
  return {
    qtyMilli: Number(row.bucket_qty_milli),
    unit: text(row.bucket_unit),
    label: text(row.bucket_label),
    consumers: people(row.bucket_consumers),
    count: Number(row.bucket_count),
  };
}

function usualOf(row: Row): KitchenUsualRecord {
  // The item's own last use when it has one; else its food's (a new pack).
  const own = row.own_created_at !== null && row.own_created_at !== undefined;
  const last = own ? "own" : "food";
  return {
    item: mapItem(row),
    usedCount: Number(row.food_count),
    lastQtyMilli: Number(row[`${last}_qty_milli`]),
    lastUnit: text(row[`${last}_unit`]),
    lastLabel: text(row[`${last}_label`]),
    lastConsumers: people(row[`${last}_consumers`]),
    lastUsedAt: new Date(row[`${last}_created_at`] as string),
    inherited: !own,
    bucket: bucketOf(row),
  };
}

export async function readUsuals(executor: SqlExecutor, query: KitchenUsualsQuery): Promise<KitchenResult<KitchenUsualRecord[]>> {
  const params = new Params();
  const me = params.add(query.subjectId);
  const bucket = query.bucket;
  const shift = params.add(minutesModifier(bucket?.tzOffsetMinutes ?? 0));
  const since = params.add(query.since);
  const scope = scopeClause(params, query);
  const hours = params.add(JSON.stringify(bucket ? [...bucket.hours] : []));
  const bucketSince = params.add(bucket?.since ?? query.since);
  try {
    const result = await executor.execute(
      `WITH scoped AS (
         SELECT id, owner_kind || ':' || COALESCE(org_id, owner_subject_id) AS pantry_key,
                lower(trim(name)) AS name_key, dimension
         FROM kitchen_items
         WHERE state <> 'removed' AND ${scope}
       ),
       mine AS (
         SELECT m.item_id, s.pantry_key, s.name_key, s.dimension, m.qty_milli, m.unit, m.label, m.consumers,
                m.created_at, m.rowid AS seq, CAST(strftime('%H', m.created_at, ${shift}) AS INTEGER) AS local_hour
         FROM kitchen_stock_moves m JOIN scoped s ON s.id = m.item_id
         WHERE m.kind = 'use' AND m.created_at >= ${since}
           AND (m.actor = ${me} OR EXISTS (SELECT 1 FROM json_each(m.consumers) c WHERE c.value = ${me}))
           AND NOT EXISTS (SELECT 1 FROM kitchen_stock_moves r WHERE r.reverses = m.id)
           AND (m.via IS NULL OR m.via <> 'check')
       ),
       ranked AS (
         SELECT mine.*,
                COUNT(*) OVER (PARTITION BY ${FOOD}) AS food_count,
                ROW_NUMBER() OVER (PARTITION BY ${FOOD} ORDER BY ${NEWEST}) AS food_rn,
                ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY ${NEWEST}) AS item_rn
         FROM mine
       ),
       in_bucket AS (
         SELECT mine.*,
                COUNT(*) OVER (PARTITION BY ${FOOD}) AS bucket_count,
                COUNT(*) OVER (PARTITION BY ${FOOD}, qty_milli) AS amount_count,
                ROW_NUMBER() OVER (PARTITION BY ${FOOD}, qty_milli ORDER BY ${NEWEST}) AS amount_rn
         FROM mine
         WHERE created_at >= ${bucketSince} AND local_hour IN (SELECT value FROM json_each(${hours}))
       ),
       bucket_pick AS (
         SELECT in_bucket.*, ROW_NUMBER() OVER (PARTITION BY ${FOOD} ORDER BY amount_count DESC, ${NEWEST}) AS pick
         FROM in_bucket WHERE amount_rn = 1
       )
       SELECT ${itemColumns("i")}, food.food_count,
              food.qty_milli AS food_qty_milli, food.unit AS food_unit, food.label AS food_label,
              food.consumers AS food_consumers, food.created_at AS food_created_at,
              own.qty_milli AS own_qty_milli, own.unit AS own_unit, own.label AS own_label,
              own.consumers AS own_consumers, own.created_at AS own_created_at,
              b.bucket_count, b.qty_milli AS bucket_qty_milli, b.unit AS bucket_unit, b.label AS bucket_label,
              b.consumers AS bucket_consumers
       FROM scoped s
       JOIN kitchen_items i ON i.id = s.id
       JOIN ranked food ON food.food_rn = 1
         AND food.pantry_key = s.pantry_key AND food.name_key = s.name_key AND food.dimension = s.dimension
       LEFT JOIN ranked own ON own.item_id = i.id AND own.item_rn = 1
       LEFT JOIN bucket_pick b ON b.pick = 1
         AND b.pantry_key = s.pantry_key AND b.name_key = s.name_key AND b.dimension = s.dimension
       WHERE i.state = 'active' AND i.qty_left_milli > 0
       ORDER BY food.food_count DESC, COALESCE(own.created_at, food.created_at) DESC, i.id
       LIMIT ${params.add(query.limit)}`,
      params.values,
    );
    return { ok: true, value: result.rows.map(usualOf) };
  } catch (err) {
    return internal(err);
  }
}
