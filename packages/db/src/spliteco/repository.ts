// Spliteco's storage (cookpool-spliteco SE-2, migration 530_spliteco_ledger).
//
// Spliteco writes the same ledger Cookpool does — kitchen_txns and
// kitchen_txn_splits — through the same rules: a transaction's splits must
// add up (`splitsProblem`), the group's currency is pinned by the first money
// write and every insert is guarded by it (`pinGroupCurrencyStatement`), and a
// money write is ONE batch with its audit event. An edit, delete, restore or
// move is several rows of that one batch (a reversal and a new version), so
// D1 applies all of it or none. Nothing here updates or deletes a row.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isForeignKeyViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import type { AppendEventWithAuditInput } from "../events/types.js";
import { pinGroupCurrencyStatement, splitsProblem } from "../kitchen/ledger.js";
import type { KitchenSplit, KitchenTxnKind } from "../kitchen/types.js";

export type SplitecoApp = "cookpool" | "spliteco";
export type SplitecoBucket = "kitchen" | "other";

/** One ledger row as Spliteco reads it, with what later rows say about it. */
export interface SplitecoTxnRecord {
  id: string;
  /** Insertion order (the row's rowid): breaks ties between rows written in the same millisecond. */
  seq: number;
  orgId: string;
  kind: KitchenTxnKind;
  title: string;
  totalMinor: number;
  currency: string;
  occurredAt: string;
  createdBy: string;
  createdAt: string;
  sourceKind: string | null;
  sourceId: string | null;
  reverses: string | null;
  method: string | null;
  note: string | null;
  app: SplitecoApp;
  /** kitchen (every Cookpool row) | other (added in Spliteco): the balance it counts toward. */
  bucket: SplitecoBucket;
  category: string | null;
  revises: string | null;
  movedFrom: string | null;
  /** On a reversal: set when it is a delete. */
  deletedAt: string | null;
  viaDelegation: string | null;
  splitSpec: string | null;
  /** The reversal of this row, if any, and whether that reversal is a delete. */
  reversedBy: string | null;
  reversalDeletedAt: string | null;
  /** The version that replaced this one (edit or restore), if any. */
  replacedBy: string | null;
  /** The version in another group this one moved to, if any. */
  movedTo: string | null;
  movedToOrg: string | null;
  /** For a version that revises another: that one's total, and whether it had been deleted (a restore). */
  revisedTotalMinor: number | null;
  revisedWasDeleted: boolean;
  /** For a version moved from another: the group it came from. */
  movedFromOrg: string | null;
  /** For a reversal: the version that replaced what it reversed (an edit), or the group that moved there (a move). */
  reversedReplacedBy: string | null;
  reversedMovedToOrg: string | null;
  splits: KitchenSplit[];
}

export interface SplitecoItemRecord {
  txnId: string;
  position: number;
  name: string;
  qty: number;
  unitMinor: number | null;
  totalMinor: number;
}

export interface SplitecoItemShareRecord {
  txnId: string;
  itemPosition: number;
  subjectId: string;
  mode: "portion" | "pct" | "exact";
  value: number;
}

export interface SplitecoAdjustmentRecord {
  txnId: string;
  position: number;
  kind: "tax" | "service" | "discount";
  label: string;
  amountMinor: number;
}

export interface SplitecoCommentRecord {
  id: string;
  txnId: string;
  orgId: string;
  subjectId: string;
  body: string;
  createdAt: string;
}

/** A row to insert: a new version, or the reversal of one. */
export interface NewSplitecoTxn {
  id: string;
  orgId: string;
  kind: KitchenTxnKind;
  title: string;
  totalMinor: number;
  currency: string;
  occurredAt: string;
  createdBy: string;
  createdAt: string;
  note: string | null;
  idemKey: string;
  app: SplitecoApp;
  bucket: SplitecoBucket;
  category: string | null;
  reverses?: string | null;
  revises?: string | null;
  movedFrom?: string | null;
  deletedAt?: string | null;
  viaDelegation?: string | null;
  splitSpec?: string | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  method?: string | null;
  splits: readonly KitchenSplit[];
  items?: readonly Omit<SplitecoItemRecord, "txnId">[];
  shares?: readonly Omit<SplitecoItemShareRecord, "txnId">[];
  adjustments?: readonly Omit<SplitecoAdjustmentRecord, "txnId">[];
}

export type SplitecoWriteError =
  | { kind: "invalid"; reason: string }
  /** The group counts in another currency. */
  | { kind: "currency_mismatch"; currency: string | null }
  /** A unique index refused it: the version was replaced, reversed or moved meanwhile, or the key posted before. */
  | { kind: "conflict" }
  | { kind: "internal"; message: string };

export type SplitecoWriteResult =
  | { ok: true; replayed: false }
  /** The first txn's (org, key) had already posted: `existing` is what it posted. */
  | { ok: true; replayed: true; existing: SplitecoTxnRecord }
  | { ok: false; error: SplitecoWriteError };

export interface SplitecoRepository {
  /** Every row of these groups with its splits, oldest first (`limit`: only the newest `limit`, still oldest first). */
  listTxns(orgIds: readonly string[], options?: { limit?: number }): Promise<SplitecoTxnRecord[]>;
  getTxn(id: string): Promise<SplitecoTxnRecord | null>;
  findByIdemKey(orgId: string, idemKey: string): Promise<SplitecoTxnRecord | null>;
  items(txnIds: readonly string[]): Promise<{
    items: SplitecoItemRecord[];
    shares: SplitecoItemShareRecord[];
    adjustments: SplitecoAdjustmentRecord[];
  }>;
  comments(txnIds: readonly string[]): Promise<SplitecoCommentRecord[]>;
  /** The currency each group's ledger is pinned to (absent: none yet). */
  currencies(orgIds: readonly string[]): Promise<Map<string, string>>;
  /** Insert `txns` (in order) and `audit`, all in one batch. */
  write(txns: readonly NewSplitecoTxn[], audit?: AppendEventWithAuditInput): Promise<SplitecoWriteResult>;
  addComment(comment: SplitecoCommentRecord): Promise<SplitecoCommentRecord>;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const TXN_COLUMNS = `t.id, t.rowid AS seq, t.org_id, t.kind, t.title, t.total_minor, t.currency, t.occurred_at, t.created_by,
  t.created_at, t.source_kind, t.source_id, t.reverses, t.method, t.note, t.app, t.bucket, t.category, t.revises,
  t.moved_from, t.deleted_at, t.via_delegation, t.split_spec,
  (SELECT r.id FROM kitchen_txns r WHERE r.reverses = t.id) AS reversed_by,
  (SELECT r.deleted_at FROM kitchen_txns r WHERE r.reverses = t.id) AS reversal_deleted_at,
  (SELECT n.id FROM kitchen_txns n WHERE n.revises = t.id) AS replaced_by,
  (SELECT n.id FROM kitchen_txns n WHERE n.moved_from = t.id) AS moved_to,
  (SELECT n.org_id FROM kitchen_txns n WHERE n.moved_from = t.id) AS moved_to_org,
  (SELECT p.total_minor FROM kitchen_txns p WHERE p.id = t.revises) AS revised_total,
  (SELECT r.deleted_at FROM kitchen_txns r WHERE r.reverses = t.revises) AS revised_deleted_at,
  (SELECT p.org_id FROM kitchen_txns p WHERE p.id = t.moved_from) AS moved_from_org,
  (SELECT n.id FROM kitchen_txns n WHERE n.revises = t.reverses) AS reversed_replaced_by,
  (SELECT n.org_id FROM kitchen_txns n WHERE n.moved_from = t.reverses) AS reversed_moved_to_org`;

function mapTxn(row: Row): SplitecoTxnRecord {
  return {
    id: String(row.id),
    seq: Number(row.seq ?? 0),
    orgId: String(row.org_id),
    kind: row.kind as KitchenTxnKind,
    title: String(row.title),
    totalMinor: Number(row.total_minor),
    currency: String(row.currency),
    occurredAt: new Date(String(row.occurred_at)).toISOString(),
    createdBy: String(row.created_by),
    createdAt: new Date(String(row.created_at)).toISOString(),
    sourceKind: str(row.source_kind),
    sourceId: str(row.source_id),
    reverses: str(row.reverses),
    method: str(row.method),
    note: str(row.note),
    app: (str(row.app) ?? "cookpool") as SplitecoApp,
    bucket: (str(row.bucket) ?? "kitchen") as SplitecoBucket,
    category: str(row.category),
    revises: str(row.revises),
    movedFrom: str(row.moved_from),
    deletedAt: str(row.deleted_at),
    viaDelegation: str(row.via_delegation),
    splitSpec: str(row.split_spec),
    reversedBy: str(row.reversed_by),
    reversalDeletedAt: str(row.reversal_deleted_at),
    replacedBy: str(row.replaced_by),
    movedTo: str(row.moved_to),
    movedToOrg: str(row.moved_to_org),
    revisedTotalMinor: num(row.revised_total),
    revisedWasDeleted: row.revised_deleted_at !== null && row.revised_deleted_at !== undefined,
    movedFromOrg: str(row.moved_from_org),
    reversedReplacedBy: str(row.reversed_replaced_by),
    reversedMovedToOrg: str(row.reversed_moved_to_org),
    splits: [],
  };
}

/** Rows of the page query, each followed by its splits (`s_` columns), folded into records. */
function fold(rows: readonly Row[]): SplitecoTxnRecord[] {
  const out: SplitecoTxnRecord[] = [];
  for (const row of rows) {
    let current = out[out.length - 1];
    if (!current || current.id !== row.id) {
      current = mapTxn(row);
      out.push(current);
    }
    if (row.s_subject_id !== null && row.s_subject_id !== undefined) {
      current.splits.push({
        subjectId: String(row.s_subject_id),
        paidMinor: Number(row.s_paid_minor),
        owedMinor: Number(row.s_owed_minor),
      });
    }
  }
  return out;
}

/** The statements that insert one row, its splits and its item rows, guarded by the group's currency. */
export function splitecoTxnStatements(txn: NewSplitecoTxn): SqlStatement[] {
  const statements: SqlStatement[] = [
    pinGroupCurrencyStatement(txn.orgId, txn.currency, new Date(txn.createdAt)),
    {
      text: `INSERT INTO kitchen_txns (
               id, org_id, kind, title, total_minor, currency, occurred_at, created_by,
               source_kind, source_id, reverses, method, note, idem_key, created_at,
               app, category, revises, moved_from, deleted_at, via_delegation, split_spec, bucket
             )
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    $16, $17, $18, $19, $20, $21, $22, $23
             WHERE EXISTS (SELECT 1 FROM kitchen_group_settings WHERE org_id = $2 AND currency = $6)
             RETURNING id`,
      params: [
        txn.id,
        txn.orgId,
        txn.kind,
        txn.title,
        txn.totalMinor,
        txn.currency,
        txn.occurredAt,
        txn.createdBy,
        txn.sourceKind ?? null,
        txn.sourceId ?? null,
        txn.reverses ?? null,
        txn.method ?? null,
        txn.note,
        txn.idemKey,
        txn.createdAt,
        txn.app,
        txn.category,
        txn.revises ?? null,
        txn.movedFrom ?? null,
        txn.deletedAt ?? null,
        txn.viaDelegation ?? null,
        txn.splitSpec ?? null,
        txn.bucket,
      ],
    },
    ...txn.splits.map((split, position) => ({
      text: `INSERT INTO kitchen_txn_splits (txn_id, subject_id, position, paid_minor, owed_minor)
             VALUES ($1, $2, $3, $4, $5)`,
      params: [txn.id, split.subjectId, position, split.paidMinor, split.owedMinor],
    })),
    ...(txn.items ?? []).map((item) => ({
      text: `INSERT INTO ledger_txn_items (txn_id, position, name, qty, unit_minor, total_minor)
             VALUES ($1, $2, $3, $4, $5, $6)`,
      params: [txn.id, item.position, item.name, item.qty, item.unitMinor, item.totalMinor],
    })),
    ...(txn.shares ?? []).map((share) => ({
      text: `INSERT INTO ledger_txn_item_shares (txn_id, item_position, subject_id, mode, value)
             VALUES ($1, $2, $3, $4, $5)`,
      params: [txn.id, share.itemPosition, share.subjectId, share.mode, share.value],
    })),
    ...(txn.adjustments ?? []).map((adj) => ({
      text: `INSERT INTO ledger_txn_adjustments (txn_id, position, kind, label, amount_minor)
             VALUES ($1, $2, $3, $4, $5)`,
      params: [txn.id, adj.position, adj.kind, adj.label, adj.amountMinor],
    })),
  ];
  return statements;
}

export function createSplitecoRepository(executor: SqlExecutor): SplitecoRepository {
  async function one(where: string, params: unknown[]): Promise<SplitecoTxnRecord | null> {
    const result = await executor.execute(
      `WITH page AS (SELECT ${TXN_COLUMNS} FROM kitchen_txns t WHERE ${where})
       SELECT page.*, s.subject_id AS s_subject_id, s.paid_minor AS s_paid_minor, s.owed_minor AS s_owed_minor
       FROM page LEFT JOIN kitchen_txn_splits s ON s.txn_id = page.id
       ORDER BY s.position`,
      params,
    );
    return fold(result.rows)[0] ?? null;
  }

  return {
    async listTxns(orgIds, options = {}) {
      if (orgIds.length === 0) return [];
      const limit = options.limit ? `ORDER BY t.created_at DESC, t.rowid DESC LIMIT ${Math.max(1, Math.floor(options.limit))}` : "";
      const result = await executor.execute(
        `WITH page AS (
           SELECT ${TXN_COLUMNS} FROM kitchen_txns t
           WHERE t.org_id IN (SELECT value FROM json_each($1))
           ${limit}
         )
         SELECT page.*, s.subject_id AS s_subject_id, s.paid_minor AS s_paid_minor, s.owed_minor AS s_owed_minor
         FROM page LEFT JOIN kitchen_txn_splits s ON s.txn_id = page.id
         ORDER BY page.occurred_at, page.created_at, page.seq, s.position`,
        [JSON.stringify(orgIds)],
      );
      return fold(result.rows);
    },

    getTxn(id) {
      return one("t.id = $1", [id]);
    },

    findByIdemKey(orgId, idemKey) {
      return one("t.org_id = $1 AND t.idem_key = $2", [orgId, idemKey]);
    },

    async items(txnIds) {
      if (txnIds.length === 0) return { items: [], shares: [], adjustments: [] };
      const ids = JSON.stringify(txnIds);
      const [items, shares, adjustments] = await Promise.all([
        executor.execute(
          `SELECT txn_id, position, name, qty, unit_minor, total_minor FROM ledger_txn_items
           WHERE txn_id IN (SELECT value FROM json_each($1)) ORDER BY txn_id, position`,
          [ids],
        ),
        executor.execute(
          `SELECT s.txn_id, s.item_position, s.subject_id, s.mode, s.value FROM ledger_txn_item_shares s
           WHERE s.txn_id IN (SELECT value FROM json_each($1)) ORDER BY s.txn_id, s.item_position, s.rowid`,
          [ids],
        ),
        executor.execute(
          `SELECT txn_id, position, kind, label, amount_minor FROM ledger_txn_adjustments
           WHERE txn_id IN (SELECT value FROM json_each($1)) ORDER BY txn_id, position`,
          [ids],
        ),
      ]);
      return {
        items: items.rows.map((r) => ({
          txnId: String(r.txn_id),
          position: Number(r.position),
          name: String(r.name),
          qty: Number(r.qty),
          unitMinor: num(r.unit_minor),
          totalMinor: Number(r.total_minor),
        })),
        shares: shares.rows.map((r) => ({
          txnId: String(r.txn_id),
          itemPosition: Number(r.item_position),
          subjectId: String(r.subject_id),
          mode: r.mode as SplitecoItemShareRecord["mode"],
          value: Number(r.value),
        })),
        adjustments: adjustments.rows.map((r) => ({
          txnId: String(r.txn_id),
          position: Number(r.position),
          kind: r.kind as SplitecoAdjustmentRecord["kind"],
          label: String(r.label),
          amountMinor: Number(r.amount_minor),
        })),
      };
    },

    async comments(txnIds) {
      if (txnIds.length === 0) return [];
      const result = await executor.execute(
        `SELECT id, txn_id, org_id, subject_id, body, created_at FROM ledger_comments
         WHERE txn_id IN (SELECT value FROM json_each($1)) ORDER BY created_at, id`,
        [JSON.stringify(txnIds)],
      );
      return result.rows.map((r) => ({
        id: String(r.id),
        txnId: String(r.txn_id),
        orgId: String(r.org_id),
        subjectId: String(r.subject_id),
        body: String(r.body),
        createdAt: new Date(String(r.created_at)).toISOString(),
      }));
    },

    async currencies(orgIds) {
      const out = new Map<string, string>();
      if (orgIds.length === 0) return out;
      const result = await executor.execute(
        `SELECT org_id, currency FROM kitchen_group_settings WHERE org_id IN (SELECT value FROM json_each($1))`,
        [JSON.stringify(orgIds)],
      );
      for (const r of result.rows) out.set(String(r.org_id), String(r.currency));
      return out;
    },

    async write(txns, audit) {
      for (const txn of txns) {
        const problem = splitsProblem(txn.totalMinor, txn.splits);
        if (problem) return { ok: false, error: { kind: "invalid", reason: problem } };
      }
      const statements = txns.flatMap(splitecoTxnStatements);
      if (audit) statements.push(...eventWithAuditStatements(audit));
      try {
        await executeBatch(executor, statements);
        return { ok: true, replayed: false };
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            const first = txns[0];
            const existing = first ? await one("t.org_id = $1 AND t.idem_key = $2", [first.orgId, first.idemKey]) : null;
            if (existing) return { ok: true, replayed: true, existing };
            return { ok: false, error: { kind: "conflict" } };
          }
          if (isForeignKeyViolation(err)) {
            // The guarded insert wrote nothing (another currency), so the splits' foreign key failed.
            const orgIds = [...new Set(txns.map((t) => t.orgId))];
            const result = await executor.execute(
              `SELECT org_id, currency FROM kitchen_group_settings WHERE org_id IN (SELECT value FROM json_each($1))`,
              [JSON.stringify(orgIds)],
            );
            const wrong = result.rows.find((r) => txns.some((t) => t.orgId === r.org_id && t.currency !== r.currency));
            return { ok: false, error: { kind: "currency_mismatch", currency: wrong ? String(wrong.currency) : null } };
          }
        } catch (followUp) {
          return { ok: false, error: { kind: "internal", message: String(followUp) } };
        }
        return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
      }
    },

    async addComment(comment) {
      await executor.execute(
        `INSERT INTO ledger_comments (id, txn_id, org_id, subject_id, body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [comment.id, comment.txnId, comment.orgId, comment.subjectId, comment.body, comment.createdAt],
      );
      return comment;
    },
  };
}
