// The daily use-soon sweep's storage (Cookpool CP-18, migration 270_kitchen_sweeps).
//
// kitchen-worker's scheduled() reads every pantry's items close to their
// use-by date in ONE query — the sweep crosses every person and group, so it
// must not read per person (risks CP-T: D1 counts queries per invocation) —
// and records each run, one row per UTC day, for /health.

import type { SqlExecutor } from "../d1/executor.js";
import { ITEM_COLUMNS, mapItem } from "./pantry.js";
import type { KitchenRepository, KitchenResult, KitchenSweepRecord } from "./types.js";

/** The sweep part of the kitchen repository. */
export type SweepRepository = Pick<KitchenRepository, "listUseSoonItems" | "recordSweep" | "lastSweep">;

const SWEEP_COLUMNS = "sweep_date, started_at, finished_at, items, people, sent, failed, runs";

function mapSweep(row: Record<string, unknown>): KitchenSweepRecord {
  return {
    date: row.sweep_date as string,
    startedAt: new Date(row.started_at as string),
    finishedAt: new Date(row.finished_at as string),
    items: Number(row.items),
    people: Number(row.people),
    sent: Number(row.sent),
    failed: Number(row.failed),
    runs: Number(row.runs),
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

export function createSweepRepository(executor: SqlExecutor): SweepRepository {
  return {
    async listUseSoonItems(query) {
      try {
        // `state = 'active'` matches the partial index's predicate, so the
        // range on expires_on is an index range scan.
        const result = await executor.execute(
          `SELECT ${ITEM_COLUMNS} FROM kitchen_items
           WHERE state = 'active' AND qty_left_milli > 0
             AND expires_on IS NOT NULL AND expires_on BETWEEN $1 AND $2
           ORDER BY expires_on, lower(name), id
           LIMIT $3`,
          [query.from, query.through, query.limit],
        );
        return { ok: true, value: result.rows.map(mapItem) };
      } catch (err) {
        return internal(err);
      }
    },

    async recordSweep(input) {
      try {
        const result = await executor.execute(
          `INSERT INTO kitchen_sweeps (sweep_date, started_at, finished_at, items, people, sent, failed, runs)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
           ON CONFLICT (sweep_date) DO UPDATE SET
             started_at = excluded.started_at,
             finished_at = excluded.finished_at,
             items = excluded.items,
             people = excluded.people,
             sent = excluded.sent,
             failed = excluded.failed,
             runs = kitchen_sweeps.runs + 1
           RETURNING ${SWEEP_COLUMNS}`,
          [
            input.date,
            input.startedAt.toISOString(),
            input.finishedAt.toISOString(),
            input.items,
            input.people,
            input.sent,
            input.failed,
          ],
        );
        const row = result.rows[0];
        return row ? { ok: true, value: mapSweep(row) } : internal("kitchen: sweep upsert returned no row");
      } catch (err) {
        return internal(err);
      }
    },

    async lastSweep() {
      try {
        const result = await executor.execute(
          `SELECT ${SWEEP_COLUMNS} FROM kitchen_sweeps ORDER BY sweep_date DESC LIMIT 1`,
          [],
        );
        const row = result.rows[0];
        return { ok: true, value: row ? mapSweep(row) : null };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
