// Web Push subscriptions (Cookpool PW-5, migration 310): one row per device,
// for one person. A repository of its own beside NotificationsRepository, so
// the email path and its test doubles are untouched by it.

import type { SqlExecutor } from "../d1/executor.js";
import { executeBatch } from "../d1/executor.js";
import type { NotificationsResult } from "./types.js";

export interface StoredPushSubscription {
  id: string;
  /** The person (`usr_…`). */
  subjectId: string;
  endpoint: string;
  /** The browser's P-256 public key, base64url. */
  p256dh: string;
  /** The browser's auth secret, base64url. */
  auth: string;
  /** "Chrome on Android"; null when unknown. */
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
}

export interface UpsertPushSubscriptionInput {
  /** Used when the endpoint is new; an existing row keeps its id. */
  id: string;
  subjectId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  now: Date;
  /** Keep at most this many for the person; the least recently subscribed go. */
  maxPerSubject: number;
}

export interface UpsertedPushSubscription {
  subscription: StoredPushSubscription;
  /** How many of the person's other devices were dropped to stay under the cap. */
  dropped: number;
}

export interface PushSubscriptionsRepository {
  /**
   * Subscribe a device for a person, by endpoint: new, renewed (new keys) or
   * moved from whoever had it before. Then drop the person's least recently
   * subscribed devices beyond `maxPerSubject`. Both in one batch.
   */
  upsert(input: UpsertPushSubscriptionInput): Promise<NotificationsResult<UpsertedPushSubscription>>;
  /** The person's devices, most recently subscribed first. */
  listForSubject(subjectId: string): Promise<NotificationsResult<StoredPushSubscription[]>>;
  /** Remove the person's own subscription for this endpoint; false when they have none there. */
  deleteForSubject(subjectId: string, endpoint: string): Promise<NotificationsResult<boolean>>;
  /** The push service said it is gone (404/410): delete that row, whoever has it now. */
  deleteGone(id: string, endpoint: string): Promise<NotificationsResult<boolean>>;
  recordSuccess(id: string, at: Date): Promise<NotificationsResult<void>>;
  recordFailure(id: string, at: Date, reason: string): Promise<NotificationsResult<void>>;
}

function date(value: unknown): Date | null {
  return typeof value === "string" && value ? new Date(value) : null;
}

function mapSubscription(row: Record<string, unknown>): StoredPushSubscription {
  return {
    id: row.id as string,
    subjectId: row.subject_id as string,
    endpoint: row.endpoint as string,
    p256dh: row.p256dh as string,
    auth: row.auth as string,
    userAgent: (row.user_agent as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    lastSuccessAt: date(row.last_success_at),
    lastFailureAt: date(row.last_failure_at),
    lastFailureReason: (row.last_failure_reason as string | null) ?? null,
  };
}

function failed(message: string): NotificationsResult<never> {
  return { ok: false, error: { kind: "internal", message } };
}

export function createPushSubscriptionsRepository(executor: SqlExecutor): PushSubscriptionsRepository {
  return {
    async upsert(input) {
      try {
        const [upserted, dropped] = await executeBatch(executor, [
          {
            // A device that changes hands starts afresh for its new person
            // (created_at, last success); a renewal keeps them. Either way the
            // keys are the ones just given and any failure is forgotten.
            text: `INSERT INTO notifications_push_subscriptions (
                     id, subject_id, endpoint, p256dh, auth, user_agent, created_at, updated_at
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
                   ON CONFLICT (endpoint) DO UPDATE SET
                     created_at = CASE WHEN subject_id = excluded.subject_id THEN created_at ELSE excluded.created_at END,
                     last_success_at = CASE WHEN subject_id = excluded.subject_id THEN last_success_at ELSE NULL END,
                     subject_id = excluded.subject_id,
                     p256dh = excluded.p256dh,
                     auth = excluded.auth,
                     user_agent = excluded.user_agent,
                     updated_at = excluded.updated_at,
                     last_failure_at = NULL,
                     last_failure_reason = NULL
                   RETURNING *`,
            params: [
              input.id,
              input.subjectId,
              input.endpoint,
              input.p256dh,
              input.auth,
              input.userAgent,
              input.now.toISOString(),
            ],
          },
          {
            // The cap: the device just subscribed is always kept, then the
            // most recently subscribed.
            text: `DELETE FROM notifications_push_subscriptions
                    WHERE subject_id = $1
                      AND id NOT IN (
                        SELECT id FROM notifications_push_subscriptions
                         WHERE subject_id = $1
                         ORDER BY (endpoint = $2) DESC, updated_at DESC, id DESC
                         LIMIT $3
                      )
                   RETURNING id`,
            params: [input.subjectId, input.endpoint, input.maxPerSubject],
          },
        ]);
        const row = upserted?.rows[0];
        if (!row) return failed("Failed to upsert push subscription");
        return { ok: true, value: { subscription: mapSubscription(row), dropped: dropped?.rows.length ?? 0 } };
      } catch {
        return failed("Failed to upsert push subscription");
      }
    },

    async listForSubject(subjectId) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT * FROM notifications_push_subscriptions
            WHERE subject_id = $1
            ORDER BY updated_at DESC, id DESC`,
          [subjectId],
        );
        return { ok: true, value: result.rows.map(mapSubscription) };
      } catch {
        return failed("Failed to list push subscriptions");
      }
    },

    async deleteForSubject(subjectId, endpoint) {
      try {
        const result = await executor.execute(
          `DELETE FROM notifications_push_subscriptions
            WHERE subject_id = $1 AND endpoint = $2
           RETURNING id`,
          [subjectId, endpoint],
        );
        return { ok: true, value: result.rows.length > 0 };
      } catch {
        return failed("Failed to delete push subscription");
      }
    },

    async deleteGone(id, endpoint) {
      try {
        const result = await executor.execute(
          `DELETE FROM notifications_push_subscriptions
            WHERE id = $1 AND endpoint = $2
           RETURNING id`,
          [id, endpoint],
        );
        return { ok: true, value: result.rows.length > 0 };
      } catch {
        return failed("Failed to delete push subscription");
      }
    },

    async recordSuccess(id, at) {
      try {
        await executor.execute(
          `UPDATE notifications_push_subscriptions SET last_success_at = $2 WHERE id = $1`,
          [id, at.toISOString()],
        );
        return { ok: true, value: undefined };
      } catch {
        return failed("Failed to record push success");
      }
    },

    async recordFailure(id, at, reason) {
      try {
        await executor.execute(
          `UPDATE notifications_push_subscriptions
              SET last_failure_at = $2, last_failure_reason = $3
            WHERE id = $1`,
          [id, at.toISOString(), reason.slice(0, 160)],
        );
        return { ok: true, value: undefined };
      } catch {
        return failed("Failed to record push failure");
      }
    },
  };
}
