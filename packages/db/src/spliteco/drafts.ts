// An assistant's expense drafts (cookpool-spliteco SE-6, migration 560_spliteco_assistants).
//
// A draft is not money: it is what an add, edit or move WOULD save, kept for
// SPLITECO_DRAFT_MINUTES so the person can see it first. Saving runs the
// ordinary expense write with the draft's id as its idempotency key (the
// ledger's own guard against posting twice); `markSaved` then stamps which
// row it became. Drafts are read by id and belong to the person and the
// delegation that made them — the worker checks both.

import type { SqlExecutor } from "../d1/executor.js";

export type SplitecoDraftAction = "add" | "edit" | "move";

export interface SplitecoDraftRecord {
  /** `drf_` and 32 hex. */
  id: string;
  subjectId: string;
  delegationId: string | null;
  action: SplitecoDraftAction;
  /** The group it saves in: added or edited there, or moved to it. */
  orgId: string;
  /** The expense edited or moved (null for an add). */
  txnId: string | null;
  /** JSON: the expense request (add, edit), or `{ toGroupId }` (move). */
  body: string;
  createdAt: string;
  expiresAt: string;
  savedTxnId: string | null;
  savedAt: string | null;
}

export interface SplitecoDraftsRepository {
  create(draft: SplitecoDraftRecord): Promise<void>;
  byId(id: string): Promise<SplitecoDraftRecord | null>;
  /** Stamp the row the save posted (first save wins; later ones change nothing). */
  markSaved(id: string, txnId: string, at: string): Promise<void>;
  /** Drop drafts that ended before `before` (best-effort housekeeping). */
  prune(before: string): Promise<void>;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const COLUMNS = "id, subject_id, delegation_id, action, org_id, txn_id, body, created_at, expires_at, saved_txn_id, saved_at";

function mapDraft(r: Row): SplitecoDraftRecord {
  return {
    id: String(r.id),
    subjectId: String(r.subject_id),
    delegationId: str(r.delegation_id),
    action: String(r.action) as SplitecoDraftAction,
    orgId: String(r.org_id),
    txnId: str(r.txn_id),
    body: String(r.body),
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    savedTxnId: str(r.saved_txn_id),
    savedAt: str(r.saved_at),
  };
}

export function createSplitecoDraftsRepository(executor: SqlExecutor): SplitecoDraftsRepository {
  return {
    async create(d) {
      await executor.execute(
        `INSERT INTO ledger_drafts (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL)`,
        [d.id, d.subjectId, d.delegationId, d.action, d.orgId, d.txnId, d.body, d.createdAt, d.expiresAt],
      );
    },

    async byId(id) {
      const result = await executor.execute<Row>(`SELECT ${COLUMNS} FROM ledger_drafts WHERE id = $1`, [id]);
      const row = result.rows[0];
      return row ? mapDraft(row) : null;
    },

    async markSaved(id, txnId, at) {
      await executor.execute(
        `UPDATE ledger_drafts SET saved_txn_id = $2, saved_at = $3 WHERE id = $1 AND saved_txn_id IS NULL`,
        [id, txnId, at],
      );
    },

    async prune(before) {
      await executor.execute(`DELETE FROM ledger_drafts WHERE expires_at < $1`, [before]);
    },
  };
}
