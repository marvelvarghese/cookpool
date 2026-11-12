// A live split's storage (cookpool-spliteco SE-5, migration 550_spliteco_live_split).
//
// A session is an itemized draft people at the table claim items on. None of
// it is money: the ledger changes only when the opener locks it, and that
// lock is ONE batch — the expense (splitecoTxnStatements), its audit events
// and `liveLockStatement` — written through SplitecoRepository.write.
//
// Claims and presence are state, not history: they are set, changed and
// cleared. Every claim write is guarded in SQL by the session being open and
// unexpired, so a claim racing the lock (or the 24 hours) writes nothing.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import type { AppendEventWithAuditInput } from "../events/types.js";

export type SplitecoLiveState = "open" | "locked";
export type SplitecoLiveClaimMode = "portion" | "pct" | "exact";

export interface SplitecoLiveSessionRecord {
  id: string;
  orgId: string;
  code: string;
  /** The draft as stored (JSON text); the worker owns its shape. */
  draft: string;
  state: SplitecoLiveState;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  txnId: string | null;
  lockedAt: string | null;
}

export interface SplitecoLiveClaimRecord {
  itemPosition: number;
  subjectId: string;
  mode: SplitecoLiveClaimMode;
  value: number;
  updatedAt: string;
}

export interface SplitecoLivePresenceRecord {
  subjectId: string;
  seenAt: string;
}

export type SplitecoLiveOpenResult = { ok: true } | { ok: false; reason: "code_taken" };

export interface SplitecoLiveRepository {
  /** Insert a session, its first claims and its audit event in one batch; `code_taken` when the code is in use. */
  open(
    session: SplitecoLiveSessionRecord,
    claims: readonly SplitecoLiveClaimRecord[],
    audit: AppendEventWithAuditInput,
  ): Promise<SplitecoLiveOpenResult>;
  byCode(code: string): Promise<SplitecoLiveSessionRecord | null>;
  byId(id: string): Promise<SplitecoLiveSessionRecord | null>;
  claims(sessionId: string): Promise<SplitecoLiveClaimRecord[]>;
  /** People who read the session at or after `since`. */
  presence(sessionId: string, since: string): Promise<SplitecoLivePresenceRecord[]>;
  /** Record that `subjectId` read the session at `at`. */
  touch(sessionId: string, subjectId: string, at: string): Promise<void>;
  /**
   * Set (or, with `claim.value === null`, clear) one person's claim on one
   * item — only while the session is open and `now` is before it expires.
   * False when the guard wrote nothing.
   */
  setClaim(
    sessionId: string,
    claim: Omit<SplitecoLiveClaimRecord, "mode" | "value"> & { mode: SplitecoLiveClaimMode; value: number | null },
    now: string,
  ): Promise<boolean>;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const SESSION_COLUMNS = "id, org_id, code, draft, state, created_by, created_at, expires_at, txn_id, locked_at";

function mapSession(r: Row): SplitecoLiveSessionRecord {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    code: String(r.code),
    draft: String(r.draft),
    state: (String(r.state) === "locked" ? "locked" : "open") as SplitecoLiveState,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    txnId: str(r.txn_id),
    lockedAt: str(r.locked_at),
  };
}

function claimStatement(sessionId: string, c: SplitecoLiveClaimRecord): SqlStatement {
  return {
    text: `INSERT INTO ledger_live_claims (session_id, item_position, subject_id, mode, value, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
    params: [sessionId, c.itemPosition, c.subjectId, c.mode, c.value, c.updatedAt],
  };
}

/**
 * The statement a lock adds to the expense's batch: the session becomes
 * locked and names the expense — only if it is still open.
 */
export function liveLockStatement(sessionId: string, txnId: string, at: string): SqlStatement {
  return {
    text: `UPDATE ledger_live_sessions SET state = 'locked', txn_id = $2, locked_at = $3 WHERE id = $1 AND state = 'open'`,
    params: [sessionId, txnId, at],
  };
}

export function createSplitecoLiveRepository(executor: SqlExecutor): SplitecoLiveRepository {
  async function oneSession(where: string, params: unknown[]): Promise<SplitecoLiveSessionRecord | null> {
    const result = await executor.execute(`SELECT ${SESSION_COLUMNS} FROM ledger_live_sessions WHERE ${where}`, params);
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  return {
    async open(session, claims, audit) {
      const statements: SqlStatement[] = [
        {
          text: `INSERT INTO ledger_live_sessions (${SESSION_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          params: [
            session.id,
            session.orgId,
            session.code,
            session.draft,
            session.state,
            session.createdBy,
            session.createdAt,
            session.expiresAt,
            session.txnId,
            session.lockedAt,
          ],
        },
        ...claims.map((c) => claimStatement(session.id, c)),
        ...eventWithAuditStatements(audit),
      ];
      try {
        await executeBatch(executor, statements);
        return { ok: true };
      } catch (err) {
        if (isUniqueViolation(err)) {
          const taken = await oneSession("code = $1", [session.code]);
          if (taken) return { ok: false, reason: "code_taken" };
        }
        throw err;
      }
    },

    byCode(code) {
      return oneSession("code = $1", [code]);
    },

    byId(id) {
      return oneSession("id = $1", [id]);
    },

    async claims(sessionId) {
      const result = await executor.execute(
        `SELECT item_position, subject_id, mode, value, updated_at FROM ledger_live_claims
         WHERE session_id = $1 ORDER BY item_position, updated_at, subject_id`,
        [sessionId],
      );
      return result.rows.map((r) => ({
        itemPosition: Number(r.item_position),
        subjectId: String(r.subject_id),
        mode: r.mode as SplitecoLiveClaimMode,
        value: Number(r.value),
        updatedAt: String(r.updated_at),
      }));
    },

    async presence(sessionId, since) {
      const result = await executor.execute(
        `SELECT subject_id, seen_at FROM ledger_live_presence WHERE session_id = $1 AND seen_at >= $2 ORDER BY seen_at DESC`,
        [sessionId, since],
      );
      return result.rows.map((r) => ({ subjectId: String(r.subject_id), seenAt: String(r.seen_at) }));
    },

    async touch(sessionId, subjectId, at) {
      await executor.execute(
        `INSERT INTO ledger_live_presence (session_id, subject_id, seen_at) VALUES ($1, $2, $3)
         ON CONFLICT (session_id, subject_id) DO UPDATE SET seen_at = excluded.seen_at`,
        [sessionId, subjectId, at],
      );
    },

    async setClaim(sessionId, claim, now) {
      const open = `EXISTS (SELECT 1 FROM ledger_live_sessions WHERE id = $1 AND state = 'open' AND expires_at > $NOW)`;
      if (claim.value === null) {
        const result = await executor.execute(
          `DELETE FROM ledger_live_claims WHERE session_id = $1 AND item_position = $2 AND subject_id = $3
             AND ${open.replace("$NOW", "$4")} RETURNING subject_id`,
          [sessionId, claim.itemPosition, claim.subjectId, now],
        );
        if (result.rows.length > 0) return true;
        // Nothing to clear still answers yes while the session is open.
        return (await oneSession(`id = $1 AND state = 'open' AND expires_at > $2`, [sessionId, now])) !== null;
      }
      const result = await executor.execute(
        `INSERT INTO ledger_live_claims (session_id, item_position, subject_id, mode, value, updated_at)
         SELECT $1, $2, $3, $4, $5, $6 WHERE ${open.replace("$NOW", "$7")}
         ON CONFLICT (session_id, item_position, subject_id) DO UPDATE SET
           mode = excluded.mode, value = excluded.value, updated_at = excluded.updated_at
         RETURNING subject_id`,
        [sessionId, claim.itemPosition, claim.subjectId, claim.mode, claim.value, claim.updatedAt, now],
      );
      return result.rows.length > 0;
    },
  };
}
