// The group ledger's storage (Cookpool CP-7, migration 220_kitchen_ledger).
//
// Append-only: transactions and their splits are inserted, never updated. A
// correction is a reversal transaction. Every money write is ONE batch — the
// transaction, its splits and its audit event — so D1 applies all of it or
// none. The money maths (splitting, balances, the settle plan) lives in
// kitchen-worker's engine; this module stores what the engine produced and
// refuses rows that do not add up.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import type { AppendEventWithAuditInput } from "../events/types.js";
import type {
  KitchenActivityCursor,
  KitchenFlagRecord,
  KitchenFlagState,
  KitchenLedgerTxn,
  KitchenRepository,
  KitchenResult,
  KitchenSettlementMethod,
  KitchenSplit,
  KitchenTxnKind,
  KitchenTxnRecord,
  PostedTxn,
} from "./types.js";

// ── Row mappers ────────────────────────────────────────────

/** The transaction's columns, plus the id of its reversal (the partial unique index answers it). */
const TXN_COLUMNS = `t.id, t.org_id, t.kind, t.title, t.total_minor, t.currency, t.occurred_at,
  t.created_by, t.source_kind, t.source_id, t.reverses, t.method, t.note, t.idem_key, t.created_at,
  (SELECT r.id FROM kitchen_txns r WHERE r.reverses = t.id) AS reversed_by`;

const FLAG_COLUMNS = "id, txn_id, org_id, subject_id, reason, state, idem_key, created_at, updated_at";

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function mapTxn(row: Row, splits: KitchenSplit[]): KitchenTxnRecord {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    kind: row.kind as KitchenTxnKind,
    title: row.title as string,
    totalMinor: Number(row.total_minor),
    currency: row.currency as string,
    occurredAt: new Date(row.occurred_at as string),
    createdBy: row.created_by as string,
    sourceKind: nullableString(row.source_kind),
    sourceId: nullableString(row.source_id),
    reverses: nullableString(row.reverses),
    reversedBy: nullableString(row.reversed_by),
    method: nullableString(row.method) as KitchenSettlementMethod | null,
    note: nullableString(row.note),
    idemKey: row.idem_key as string,
    createdAt: new Date(row.created_at as string),
    splits,
  };
}

function mapSplit(row: Row, prefix = ""): KitchenSplit {
  return {
    subjectId: row[`${prefix}subject_id`] as string,
    paidMinor: Number(row[`${prefix}paid_minor`]),
    owedMinor: Number(row[`${prefix}owed_minor`]),
  };
}

function mapFlag(row: Row): KitchenFlagRecord {
  return {
    id: row.id as string,
    txnId: row.txn_id as string,
    orgId: row.org_id as string,
    subjectId: row.subject_id as string,
    reason: row.reason as string,
    state: row.state as KitchenFlagState,
    idemKey: row.idem_key as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

function invalid(reason: string): KitchenResult<never> {
  return { ok: false, error: { kind: "invalid", reason } };
}

/**
 * The last line of defence for the ledger's invariant: at least one split, one
 * per person, every amount a non-negative whole number, Σ paid = Σ owed =
 * total. The engine builds splits that hold it; this refuses any that do not
 * before a row is written. `null` when they hold.
 */
function splitsProblem(totalMinor: number, splits: readonly KitchenSplit[]): string | null {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) return "total_out_of_range";
  if (splits.length === 0) return "no_splits";
  const seen = new Set<string>();
  let paid = 0;
  let owed = 0;
  for (const s of splits) {
    if (seen.has(s.subjectId)) return "duplicate_subject";
    seen.add(s.subjectId);
    for (const v of [s.paidMinor, s.owedMinor]) {
      if (!Number.isSafeInteger(v) || v < 0) return "split_out_of_range";
    }
    paid += s.paidMinor;
    owed += s.owedMinor;
  }
  return paid === totalMinor && owed === totalMinor ? null : "unbalanced";
}

// ── Repository functions ───────────────────────────────────

/** The ledger half of the kitchen repository (the other half is group settings). */
export type LedgerRepository = Omit<KitchenRepository, "getGroupSettings" | "upsertGroupSettings">;

/** Everything one insert of a transaction needs, reversal or not. */
interface TxnWrite {
  record: KitchenTxnRecord;
  audit: AppendEventWithAuditInput | undefined;
}

export function createLedgerRepository(executor: SqlExecutor): LedgerRepository {
  async function splitsFor(txnId: string): Promise<KitchenSplit[]> {
    const result = await executor.execute(
      `SELECT subject_id, paid_minor, owed_minor FROM kitchen_txn_splits
       WHERE txn_id = $1 ORDER BY position`,
      [txnId],
    );
    return result.rows.map((row) => mapSplit(row));
  }

  async function findTxn(where: string, params: unknown[]): Promise<KitchenTxnRecord | null> {
    const result = await executor.execute(`SELECT ${TXN_COLUMNS} FROM kitchen_txns t WHERE ${where}`, params);
    const row = result.rows[0];
    return row ? mapTxn(row, await splitsFor(row.id as string)) : null;
  }

  /**
   * The batch for one transaction:
   *   1. pin the group's settings row (its currency) if the group has none;
   *   2. the transaction, inserted only if the group's currency is the one it
   *      names — otherwise nothing is inserted and step 3's foreign key fails
   *      the whole batch;
   *   3. one statement per split (D1 caps bound parameters per statement, so
   *      a multi-row VALUES list would not scale to a full group);
   *   4. the audit event and its audit entry.
   */
  function txnStatements({ record, audit }: TxnWrite): SqlStatement[] {
    const statements: SqlStatement[] = [
      {
        text: `INSERT INTO kitchen_group_settings (org_id, currency, created_at, updated_at)
               VALUES ($1, $2, $3, $3)
               ON CONFLICT (org_id) DO NOTHING`,
        params: [record.orgId, record.currency, record.createdAt],
      },
      {
        text: `INSERT INTO kitchen_txns (
                 id, org_id, kind, title, total_minor, currency, occurred_at, created_by,
                 source_kind, source_id, reverses, method, note, idem_key, created_at
               )
               SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
               WHERE EXISTS (SELECT 1 FROM kitchen_group_settings WHERE org_id = $2 AND currency = $6)
               RETURNING id`,
        params: [
          record.id,
          record.orgId,
          record.kind,
          record.title,
          record.totalMinor,
          record.currency,
          record.occurredAt,
          record.createdBy,
          record.sourceKind,
          record.sourceId,
          record.reverses,
          record.method,
          record.note,
          record.idemKey,
          record.createdAt,
        ],
      },
      ...record.splits.map((split, position) => ({
        text: `INSERT INTO kitchen_txn_splits (txn_id, subject_id, position, paid_minor, owed_minor)
               VALUES ($1, $2, $3, $4, $5)`,
        params: [record.id, split.subjectId, position, split.paidMinor, split.owedMinor],
      })),
    ];
    if (audit) statements.push(...eventWithAuditStatements(audit));
    return statements;
  }

  async function writeTxn(write: TxnWrite): Promise<KitchenResult<PostedTxn>> {
    const { record } = write;
    const problem = splitsProblem(record.totalMinor, record.splits);
    if (problem) return invalid(problem);

    try {
      const results = await executeBatch(executor, txnStatements(write));
      // Belt and braces: with foreign keys enforced the batch has already
      // failed if the transaction row was not inserted.
      if (results[1]?.rowCount !== 1) return await currencyMismatch(record.orgId);
      return { ok: true, value: { txn: record, replayed: false } };
    } catch (err) {
      try {
        if (isUniqueViolation(err)) {
          // The same key again: answer with what it posted.
          const existing = await findTxn("t.org_id = $1 AND t.idem_key = $2", [record.orgId, record.idemKey]);
          if (existing) return { ok: true, value: { txn: existing, replayed: true } };
          if (record.reverses) {
            const reversal = await findTxn("t.reverses = $1", [record.reverses]);
            if (reversal) return { ok: false, error: { kind: "already_reversed", reversedBy: reversal.id } };
          }
          return { ok: false, error: { kind: "conflict", entity: "kitchen_txn" } };
        }
        if (isForeignKeyViolation(err)) return await currencyMismatch(record.orgId);
        if (isCheckViolation(err)) return invalid("out_of_range");
      } catch (followUp) {
        return internal(followUp);
      }
      return internal(err);
    }
  }

  /** The transaction was refused because the group counts in another currency. */
  async function currencyMismatch(orgId: string): Promise<KitchenResult<never>> {
    const result = await executor.execute("SELECT currency FROM kitchen_group_settings WHERE org_id = $1", [orgId]);
    const currency = result.rows[0]?.currency;
    return typeof currency === "string"
      ? { ok: false, error: { kind: "currency_mismatch", currency } }
      : internal("kitchen: transaction not inserted and the group has no settings row");
  }

  return {
    postTxn({ txn, splits, audit }) {
      return writeTxn({
        record: {
          id: txn.id,
          orgId: txn.orgId,
          kind: txn.kind,
          title: txn.title,
          totalMinor: txn.totalMinor,
          currency: txn.currency,
          occurredAt: txn.occurredAt,
          createdBy: txn.createdBy,
          sourceKind: txn.sourceKind ?? null,
          sourceId: txn.sourceId ?? null,
          reverses: null,
          reversedBy: null,
          method: txn.method ?? null,
          note: txn.note ?? null,
          idemKey: txn.idemKey,
          createdAt: txn.now,
          splits: splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor })),
        },
        audit,
      });
    },

    reverseTxn({ original, reversal, splits, audit }) {
      return writeTxn({
        record: {
          id: reversal.id,
          orgId: original.orgId,
          kind: "reversal",
          title: reversal.title,
          totalMinor: original.totalMinor,
          currency: original.currency,
          occurredAt: reversal.occurredAt,
          createdBy: reversal.createdBy,
          sourceKind: null,
          sourceId: null,
          reverses: original.id,
          reversedBy: null,
          method: null,
          note: reversal.note ?? null,
          idemKey: reversal.idemKey,
          createdAt: reversal.now,
          splits: splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor })),
        },
        audit,
      });
    },

    async getTxn(orgId, txnId) {
      try {
        const txn = await findTxn("t.org_id = $1 AND t.id = $2", [orgId, txnId]);
        return txn ? { ok: true, value: txn } : { ok: false, error: { kind: "not_found" } };
      } catch (err) {
        return internal(err);
      }
    },

    async listActivity(orgId, { cursor, limit }) {
      try {
        // One round trip: the page of transactions (one extra row says whether
        // there is a next page), each joined to its splits in posted order.
        const after = cursor ? "AND (t.occurred_at, t.id) < ($3, $4)" : "";
        const params: unknown[] = [orgId, limit + 1];
        if (cursor) params.push(cursor.occurredAt, cursor.id);
        const result = await executor.execute(
          `WITH page AS (
             SELECT ${TXN_COLUMNS} FROM kitchen_txns t
             WHERE t.org_id = $1 ${after}
             ORDER BY t.occurred_at DESC, t.id DESC
             LIMIT $2
           )
           SELECT page.*, s.subject_id AS s_subject_id, s.paid_minor AS s_paid_minor, s.owed_minor AS s_owed_minor
           FROM page LEFT JOIN kitchen_txn_splits s ON s.txn_id = page.id
           ORDER BY page.occurred_at DESC, page.id DESC, s.position`,
          params,
        );

        const items: KitchenTxnRecord[] = [];
        for (const row of result.rows) {
          let current = items[items.length - 1];
          if (!current || current.id !== row.id) {
            current = mapTxn(row, []);
            items.push(current);
          }
          if (row.s_subject_id !== null && row.s_subject_id !== undefined) current.splits.push(mapSplit(row, "s_"));
        }

        let nextCursor: KitchenActivityCursor | null = null;
        if (items.length > limit) {
          items.length = limit;
          const last = items[limit - 1]!;
          nextCursor = { occurredAt: last.occurredAt.toISOString(), id: last.id };
        }
        return { ok: true, value: { items, nextCursor } };
      } catch (err) {
        return internal(err);
      }
    },

    async listSplitsForGroup(orgId) {
      try {
        const result = await executor.execute(
          `SELECT t.id, t.kind, t.title, t.total_minor, t.occurred_at, t.reverses,
                  s.subject_id, s.paid_minor, s.owed_minor
           FROM kitchen_txns t JOIN kitchen_txn_splits s ON s.txn_id = t.id
           WHERE t.org_id = $1
           ORDER BY t.occurred_at, t.id, s.position`,
          [orgId],
        );
        const txns: KitchenLedgerTxn[] = [];
        for (const row of result.rows) {
          let current = txns[txns.length - 1];
          if (!current || current.id !== row.id) {
            current = {
              id: row.id as string,
              kind: row.kind as KitchenTxnKind,
              title: row.title as string,
              totalMinor: Number(row.total_minor),
              occurredAt: new Date(row.occurred_at as string),
              reverses: nullableString(row.reverses),
              splits: [],
            };
            txns.push(current);
          }
          current.splits.push(mapSplit(row));
        }
        return { ok: true, value: txns };
      } catch (err) {
        return internal(err);
      }
    },

    async createFlag(input) {
      const statements: SqlStatement[] = [
        {
          text: `INSERT INTO kitchen_flags (id, txn_id, org_id, subject_id, reason, state, idem_key, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $7)
                 RETURNING ${FLAG_COLUMNS}`,
          params: [input.id, input.txnId, input.orgId, input.subjectId, input.reason, input.idemKey, input.now],
        },
      ];
      if (input.audit) statements.push(...eventWithAuditStatements(input.audit));
      try {
        const [inserted] = await executeBatch(executor, statements);
        const row = inserted?.rows[0];
        return row ? { ok: true, value: { flag: mapFlag(row), replayed: false } } : internal("kitchen: flag insert returned no row");
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            const existing = await executor.execute(
              `SELECT ${FLAG_COLUMNS} FROM kitchen_flags WHERE org_id = $1 AND idem_key = $2`,
              [input.orgId, input.idemKey],
            );
            const row = existing.rows[0];
            if (row) return { ok: true, value: { flag: mapFlag(row), replayed: true } };
            return { ok: false, error: { kind: "conflict", entity: "kitchen_flag" } };
          }
          if (isForeignKeyViolation(err)) return { ok: false, error: { kind: "not_found" } };
          if (isCheckViolation(err)) return invalid("out_of_range");
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
    },

    async listFlags(orgId, txnId) {
      try {
        const result = await executor.execute(
          `SELECT ${FLAG_COLUMNS} FROM kitchen_flags WHERE org_id = $1 AND txn_id = $2 ORDER BY created_at, id`,
          [orgId, txnId],
        );
        return { ok: true, value: result.rows.map(mapFlag) };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
