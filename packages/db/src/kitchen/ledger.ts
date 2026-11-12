// The group ledger's storage (Cookpool CP-7, migration 220_kitchen_ledger).
//
// Append-only: transactions and their splits are inserted, never updated. A
// correction is a reversal transaction. Every money write is ONE batch — the
// transaction, its splits and its audit event (and, for a use or waste, its
// stock moves: see ./stock.ts) — so D1 applies all of it or none. The money
// maths (splitting, balances, the settle plan) lives in the kitchen engine;
// this module stores what the engine produced and refuses rows that do not
// add up.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import type { AppendEventWithAuditInput } from "../events/types.js";
import type {
  KitchenActivityCursor,
  KitchenBucket,
  KitchenFlagRecord,
  KitchenFlagState,
  KitchenLedgerTxn,
  KitchenOpenFlagRecord,
  KitchenRepository,
  KitchenResult,
  KitchenSettlementMethod,
  KitchenSplit,
  KitchenStockMoveRecord,
  KitchenLedgerFilter,
  KitchenTxnItem,
  KitchenTxnKind,
  KitchenTxnRecord,
  NewKitchenTxn,
  PostedTxn,
} from "./types.js";
import { MOVE_COLUMNS, mapMove, newMoveId, restockStatements, reversalRecord } from "./moves.js";
import { askUndoneStatements } from "./ask-undo.js";

// ── Row mappers ────────────────────────────────────────────

/** The transaction's columns, plus the id of its reversal (the partial unique index answers it). */
const TXN_COLUMNS = `t.id, t.org_id, t.kind, t.title, t.total_minor, t.currency, t.occurred_at,
  t.created_by, t.source_kind, t.source_id, t.reverses, t.method, t.note, t.idem_key, t.created_at, t.bucket, t.app,
  (SELECT r.id FROM kitchen_txns r WHERE r.reverses = t.id) AS reversed_by`;

/** A row's balance: `kitchen` unless the row says `other`. */
function bucketOf(value: unknown): KitchenBucket {
  return value === "other" ? "other" : "kitchen";
}

/**
 * The SQL that keeps a ledger read to one balance (SE3): `AND t.bucket = 'kitchen'`,
 * or nothing for both. The value is one of two literals, never input.
 */
export function bucketClause(filter: KitchenLedgerFilter | undefined, alias = "t"): string {
  const bucket = filter?.bucket ?? "all";
  if (bucket === "all") return "";
  return `AND ${alias}.bucket = '${bucket === "other" ? "other" : "kitchen"}'`;
}

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
    bucket: bucketOf(row.bucket),
    app: row.app === "spliteco" ? "spliteco" : "cookpool",
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

function mapOpenFlag(row: Row): KitchenOpenFlagRecord {
  return {
    flagId: row.flag_id as string,
    txnId: row.txn_id as string,
    orgId: row.org_id as string,
    flaggedBy: row.subject_id as string,
    reason: row.reason as string,
    flaggedAt: new Date(row.created_at as string),
    title: row.title as string,
    txnKind: row.kind as KitchenTxnKind,
    totalMinor: Number(row.total_minor),
    currency: row.currency as string,
    sourceKind: nullableString(row.source_kind),
    sourceId: nullableString(row.source_id),
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
export function splitsProblem(totalMinor: number, splits: readonly KitchenSplit[]): string | null {
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

/** The ledger part of the kitchen repository (the rest is group settings and pantries). */
export type LedgerRepository = Pick<
  KitchenRepository,
  | "postTxn"
  | "reverseTxn"
  | "getTxn"
  | "listActivity"
  | "listSplitsForGroup"
  | "createFlag"
  | "listFlags"
  | "listOpenFlagsOnTxnsBy"
>;

/**
 * Pin the group's currency: write its settings row with `currency` (and the
 * default waste rule) when it has none. The first money-bearing write of a
 * group — its first transaction, or its first pantry item — puts this first
 * in its batch, then inserts only if the group's currency is the one it
 * names, so a group can never change currency under existing money.
 */
export function pinGroupCurrencyStatement(orgId: string, currency: string, at: Date): SqlStatement {
  return {
    text: `INSERT INTO kitchen_group_settings (org_id, currency, created_at, updated_at)
           VALUES ($1, $2, $3, $3)
           ON CONFLICT (org_id) DO NOTHING`,
    params: [orgId, currency, at],
  };
}

/** Everything one insert of a transaction needs, reversal or not. */
export interface TxnWrite {
  record: KitchenTxnRecord;
  audit: AppendEventWithAuditInput | undefined;
  /**
   * Statements that belong to the same money event, written after the
   * transaction and its splits and before the audit event — the stock moves
   * and item updates of a use, waste or reversal.
   */
  extra?: readonly SqlStatement[];
}

/** The record `postTxn` writes for a new transaction. */
export function txnRecordOf(txn: NewKitchenTxn, splits: readonly KitchenSplit[]): KitchenTxnRecord {
  return {
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
    bucket: "kitchen",
    ...(txn.items ? { items: txn.items } : {}),
  };
}

/** The kinds Cookpool posts from the pantry and the stove: each gets item rows (SE3). */
const ITEMIZED_KINDS: ReadonlySet<KitchenTxnKind> = new Set(["use", "dish", "waste"]);

/** `ledger_txn_items.name` holds 1–120 characters. */
const ITEM_NAME_MAX = 120;

function itemName(name: string): string {
  const trimmed = name.trim() || "Item";
  return trimmed.length > ITEM_NAME_MAX ? `${trimmed.slice(0, ITEM_NAME_MAX - 1)}…` : trimmed;
}

/**
 * The item rows a transaction is written with (SE3): the ones it was given,
 * else — for a use, dish or waste — one item, its title, each person bearing
 * exactly what they owe on it. Nothing for an expense, a settlement or a
 * reversal (a reversal's rows are its original's). Items whose shares do not
 * add up to their total are dropped: they are an explanation, never money.
 */
export function itemRowsOf(record: KitchenTxnRecord): KitchenTxnItem[] {
  if (record.kind === "reversal" || record.reverses) return [];
  const given = record.items;
  const items: readonly KitchenTxnItem[] =
    given && given.length > 0
      ? given
      : ITEMIZED_KINDS.has(record.kind)
        ? [
            {
              name: record.title,
              qty: 1,
              unitMinor: null,
              totalMinor: record.totalMinor,
              shares: record.splits.filter((s) => s.owedMinor > 0).map((s) => ({ subjectId: s.subjectId, amountMinor: s.owedMinor })),
            },
          ]
        : [];
  return items.filter((item) => {
    if (!Number.isSafeInteger(item.totalMinor) || item.totalMinor < 0 || !(item.qty > 0)) return false;
    const seen = new Set<string>();
    let sum = 0;
    for (const share of item.shares) {
      if (seen.has(share.subjectId) || !Number.isSafeInteger(share.amountMinor) || share.amountMinor < 0) return false;
      seen.add(share.subjectId);
      sum += share.amountMinor;
    }
    return sum === item.totalMinor;
  });
}

/** The statements that write a transaction's item rows (`ledger_txn_items`, `ledger_txn_item_shares`, mode exact). */
export function itemStatements(record: KitchenTxnRecord): SqlStatement[] {
  return itemRowsOf(record).flatMap((item, position) => [
    {
      text: `INSERT INTO ledger_txn_items (txn_id, position, name, qty, unit_minor, total_minor)
             VALUES ($1, $2, $3, $4, $5, $6)`,
      params: [record.id, position, itemName(item.name), item.qty, item.unitMinor, item.totalMinor],
    },
    ...item.shares
      .filter((share) => share.amountMinor > 0)
      .map((share) => ({
        text: `INSERT INTO ledger_txn_item_shares (txn_id, item_position, subject_id, mode, value)
               VALUES ($1, $2, $3, 'exact', $4)`,
        params: [record.id, position, share.subjectId, share.amountMinor],
      })),
  ]);
}

/**
 * The batch for one transaction:
 *   1. pin the group's settings row (its currency) if the group has none;
 *   2. the transaction, inserted only if the group's currency is the one it
 *      names — otherwise nothing is inserted and step 3's foreign key fails
 *      the whole batch;
 *   3. one statement per split (D1 caps bound parameters per statement, so
 *      a multi-row VALUES list would not scale to a full group);
 *   4. the `extra` statements, if any;
 *   5. the audit event and its audit entry.
 * The transaction insert is always statement 1 and returns its id.
 */
export function txnStatements({ record, audit, extra }: TxnWrite): SqlStatement[] {
  const statements: SqlStatement[] = [
    pinGroupCurrencyStatement(record.orgId, record.currency, record.createdAt),
    {
      text: `INSERT INTO kitchen_txns (
               id, org_id, kind, title, total_minor, currency, occurred_at, created_by,
               source_kind, source_id, reverses, method, note, idem_key, created_at, bucket
             )
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
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
        record.bucket ?? "kitchen",
      ],
    },
    ...record.splits.map((split, position) => ({
      text: `INSERT INTO kitchen_txn_splits (txn_id, subject_id, position, paid_minor, owed_minor)
             VALUES ($1, $2, $3, $4, $5)`,
      params: [record.id, split.subjectId, position, split.paidMinor, split.owedMinor],
    })),
    ...itemStatements(record),
    ...(extra ?? []),
  ];
  if (audit) statements.push(...eventWithAuditStatements(audit));
  return statements;
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
    postTxn({ txn, splits, audit, extra }) {
      return writeTxn({ record: txnRecordOf(txn, splits), audit, ...(extra ? { extra } : {}) });
    },

    async reverseTxn({ original, reversal, splits, audit }) {
      // The stock the original took comes back with its reversal. Its moves
      // are fixed once it posted (they are written in its own batch), so the
      // read here cannot miss one.
      let moves: KitchenStockMoveRecord[];
      try {
        const result = await executor.execute(
          `SELECT ${MOVE_COLUMNS} FROM kitchen_stock_moves m WHERE m.txn_id = $1 ORDER BY m.created_at, m.rowid`,
          [original.id],
        );
        moves = result.rows.map(mapMove);
      } catch (err) {
        return internal(err);
      }
      // A reversal that put stock back would have to take it again, at a cost
      // fixed before later uses changed what is left: refused. Log it again.
      if (original.kind === "reversal" && moves.length > 0) return { ok: false, error: { kind: "not_reversible" } };

      const restock = moves.flatMap((move) => [
        ...restockStatements(
          move,
          reversalRecord(move, { id: newMoveId(), actor: reversal.createdBy, txnId: reversal.id, idemKey: null, now: reversal.now }),
          "id",
        ),
        // An approved ask's use (PN-8): its answer is undone with it.
        ...askUndoneStatements(move, reversal.createdBy, reversal.now),
      ]);
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
          // A reversal counts toward its original's balance.
          bucket: original.bucket ?? "kitchen",
        },
        audit,
        extra: restock,
      });
    },

    async getTxn(orgId, txnId, filter) {
      try {
        const txn = await findTxn(`t.org_id = $1 AND t.id = $2 ${bucketClause(filter)}`, [orgId, txnId]);
        return txn ? { ok: true, value: txn } : { ok: false, error: { kind: "not_found" } };
      } catch (err) {
        return internal(err);
      }
    },

    async listActivity(orgId, { cursor, limit }, filter) {
      try {
        // One round trip: the page of transactions (one extra row says whether
        // there is a next page), each joined to its splits in posted order.
        const after = cursor ? "AND (t.occurred_at, t.id) < ($3, $4)" : "";
        const params: unknown[] = [orgId, limit + 1];
        if (cursor) params.push(cursor.occurredAt, cursor.id);
        const result = await executor.execute(
          `WITH page AS (
             SELECT ${TXN_COLUMNS} FROM kitchen_txns t
             WHERE t.org_id = $1 ${after} ${bucketClause(filter)}
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

    async listSplitsForGroup(orgId, filter) {
      try {
        const result = await executor.execute(
          `SELECT t.id, t.kind, t.title, t.total_minor, t.occurred_at, t.reverses, t.bucket, t.idem_key,
                  s.subject_id, s.paid_minor, s.owed_minor
           FROM kitchen_txns t JOIN kitchen_txn_splits s ON s.txn_id = t.id
           WHERE t.org_id = $1 ${bucketClause(filter)}
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
              bucket: bucketOf(row.bucket),
              idemKey: row.idem_key as string,
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

    async listOpenFlagsOnTxnsBy(query) {
      if (query.orgIds.length === 0) return { ok: true, value: [] };
      try {
        // Driven from kitchen_flags (few rows; `org_id` leads its unique
        // index), each joined to its transaction by primary key, and the
        // reversal check through `kitchen_txns_reverses_uq`.
        const result = await executor.execute(
          `SELECT f.id AS flag_id, f.txn_id, f.org_id, f.subject_id, f.reason, f.created_at,
                  t.title, t.kind, t.total_minor, t.currency, t.source_kind, t.source_id
           FROM kitchen_flags f
           JOIN kitchen_txns t ON t.id = f.txn_id AND t.org_id = f.org_id
           WHERE f.org_id IN (SELECT value FROM json_each($1))
             AND f.state = 'open'
             AND t.created_by = $2
             AND f.subject_id <> $2
             AND NOT EXISTS (SELECT 1 FROM kitchen_txns r WHERE r.reverses = t.id)
           ORDER BY f.created_at, f.id
           LIMIT $3`,
          [JSON.stringify(query.orgIds), query.createdBy, query.limit],
        );
        return { ok: true, value: result.rows.map(mapOpenFlag) };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
