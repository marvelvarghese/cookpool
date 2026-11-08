// Timers that find you (Cookpool GC-3, migration 380_kitchen_timers).
//
// A cook's timers, and the per-minute sweep's two writes. Every write that a
// race could double is ONE statement, so it holds without a transaction
// (D1 has none):
//
//   createTimer      the insert counts the person's active timers in the same
//                    statement, so two creates at once cannot both pass the
//                    limit
//   cancelTimer      sets canceled_at once (a repeat keeps the first), only on
//                    the caller's own row, only while it is unsent
//   claimDueTimers   finds the due timers and sets their sent_at in one
//                    UPDATE … RETURNING: a run pushes exactly the rows it
//                    claimed, so two overlapping runs never push one twice
//   purgeTimers      deletes the rows that ended before a cut-off
//
// Kept apart from KitchenRepository (its own factory) so the timers' storage
// is one file beside the rest of the kitchen's.

import type { SqlExecutor } from "../d1/executor.js";
import { isCheckViolation } from "../d1/errors.js";
import type { KitchenResult } from "./types.js";

/** One timer, as stored. */
export interface KitchenTimerRecord {
  /** The stored UUID (`tmr_…` in the API). */
  id: string;
  /** Who set it (`usr_…`). */
  userId: string;
  label: string;
  /** null: the push's default line. */
  body: string | null;
  /** The app path the push opens. */
  url: string;
  endsAt: Date;
  /** When the sweep claimed it and asked for its push; null until then. */
  sentAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
}

export interface NewKitchenTimer {
  id: string;
  userId: string;
  label: string;
  body: string | null;
  url: string;
  endsAt: Date;
  now: Date;
  /** The most active timers the person may have; this one is refused at the limit. */
  maxActive: number;
}

export interface CancelKitchenTimerInput {
  id: string;
  userId: string;
  now: Date;
}

export interface ClaimDueTimersInput {
  /** Timers whose ends_at is at or before this are due. */
  now: Date;
  /** The most one run claims. */
  limit: number;
}

export interface TimersRepository {
  /** The timer, or null when the person already has `maxActive` active timers. */
  createTimer(input: NewKitchenTimer): Promise<KitchenResult<KitchenTimerRecord | null>>;
  /** The person's active timers (unsent, not cancelled), soonest first. */
  listActiveTimers(userId: string, limit: number): Promise<KitchenResult<KitchenTimerRecord[]>>;
  /** The timer after the cancel, or null when the person has no timer with this id. */
  cancelTimer(input: CancelKitchenTimerInput): Promise<KitchenResult<KitchenTimerRecord | null>>;
  /** Claim (mark sent) the due timers, soonest first: these, and only these, are this run's to push. */
  claimDueTimers(input: ClaimDueTimersInput): Promise<KitchenResult<KitchenTimerRecord[]>>;
  /** Delete every timer that ended before `before`, whatever its state; how many went. */
  purgeTimers(before: Date): Promise<KitchenResult<number>>;
}

const TIMER_COLUMNS = "id, user_id, label, body, url, ends_at, sent_at, canceled_at, created_at";
const ACTIVE = "sent_at IS NULL AND canceled_at IS NULL";

const dateOrNull = (value: unknown): Date | null => (value === null || value === undefined ? null : new Date(value as string));

function mapTimer(row: Record<string, unknown>): KitchenTimerRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    label: row.label as string,
    body: (row.body as string | null) ?? null,
    url: row.url as string,
    endsAt: new Date(row.ends_at as string),
    sentAt: dateOrNull(row.sent_at),
    canceledAt: dateOrNull(row.canceled_at),
    createdAt: new Date(row.created_at as string),
  };
}

/** Soonest first, then by id: RETURNING promises no order. */
function bySoonest(a: KitchenTimerRecord, b: KitchenTimerRecord): number {
  return a.endsAt.getTime() - b.endsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

export function createTimersRepository(executor: SqlExecutor): TimersRepository {
  return {
    async createTimer(input) {
      try {
        const result = await executor.execute(
          `INSERT INTO kitchen_timers (id, user_id, label, body, url, ends_at, sent_at, canceled_at, created_at)
           SELECT $1, $2, $3, $4, $5, $6, NULL, NULL, $7
           WHERE (SELECT COUNT(*) FROM kitchen_timers WHERE user_id = $2 AND ${ACTIVE}) < $8
           RETURNING ${TIMER_COLUMNS}`,
          [
            input.id,
            input.userId,
            input.label,
            input.body,
            input.url,
            input.endsAt.toISOString(),
            input.now.toISOString(),
            input.maxActive,
          ],
        );
        const row = result.rows[0];
        return { ok: true, value: row ? mapTimer(row) : null };
      } catch (err) {
        if (isCheckViolation(err)) return { ok: false, error: { kind: "invalid", reason: "timer_out_of_range" } };
        return internal(err);
      }
    },

    async listActiveTimers(userId, limit) {
      try {
        const result = await executor.execute(
          `SELECT ${TIMER_COLUMNS} FROM kitchen_timers
           WHERE user_id = $1 AND ${ACTIVE}
           ORDER BY ends_at, id
           LIMIT $2`,
          [userId, limit],
        );
        return { ok: true, value: result.rows.map(mapTimer) };
      } catch (err) {
        return internal(err);
      }
    },

    async cancelTimer(input) {
      try {
        // Matches the caller's own row in any state, so a repeat — or a cancel
        // that lost the race to the sweep — still reads it back; canceled_at
        // is only ever set on an unsent timer, and only once.
        const result = await executor.execute(
          `UPDATE kitchen_timers
           SET canceled_at = COALESCE(canceled_at, CASE WHEN sent_at IS NULL THEN $3 END)
           WHERE id = $1 AND user_id = $2
           RETURNING ${TIMER_COLUMNS}`,
          [input.id, input.userId, input.now.toISOString()],
        );
        const row = result.rows[0];
        return { ok: true, value: row ? mapTimer(row) : null };
      } catch (err) {
        return internal(err);
      }
    },

    async claimDueTimers(input) {
      try {
        // One statement finds and claims: the subquery walks the due index
        // (active rows by ends_at), and the outer WHERE repeats the predicate
        // so a row is only ever claimed while it is still active.
        const result = await executor.execute(
          `UPDATE kitchen_timers SET sent_at = $1
           WHERE id IN (
             SELECT id FROM kitchen_timers
             WHERE ${ACTIVE} AND ends_at <= $1
             ORDER BY ends_at, id
             LIMIT $2
           )
             AND ${ACTIVE}
           RETURNING ${TIMER_COLUMNS}`,
          [input.now.toISOString(), input.limit],
        );
        return { ok: true, value: result.rows.map(mapTimer).sort(bySoonest) };
      } catch (err) {
        return internal(err);
      }
    },

    async purgeTimers(before) {
      try {
        const result = await executor.execute(`DELETE FROM kitchen_timers WHERE ends_at < $1 RETURNING id`, [
          before.toISOString(),
        ]);
        return { ok: true, value: result.rowCount };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
