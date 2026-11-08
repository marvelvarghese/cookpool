// Ask before use's storage (Cookpool PN-8, cookpool-pantry design §8.5,
// migration 420_kitchen_asks).
//
//   listAllowed     who may use each of some items without asking: ONE
//                   statement however many items (the guard every use, waste,
//                   dish and check of an ask-first item reads).
//   replaceAllowed  ONE batch: the item's allowed list replaced, only while
//                   the item is still in the group's pantry.
//   createAsk       ONE statement; a retried key on the item answers with the
//                   ask it made.
//   getAsk          the ask and its item, in the group.
//   approveAsk      ONE batch: the ask approved (guarded: still pending and
//                   not past its time, else the batch fails), the use it
//                   posts — exactly what a use of the item writes (the
//                   transaction and splits when it moves money, the move with
//                   via = 'ask', the item's update; stock.ts guards the
//                   version and the stock) — the asker added to the allowed
//                   list when asked, and the audit event. All of it or none.
//   answerAsk       ONE statement each: decline, reopen, cancel, from the
//                   state each moves from (a pending ask still live; a
//                   declined one still inside its 24 hours).
//   listAsks        two statements: the pending asks a person answers, and
//                   their own asks since a time.
//
// Lapsing is read-side: a pending ask past expires_at, or on an item no
// longer active or no longer ask-first, is lapsed — `askIsLive` and
// `liveSql` say so, here and in the worker. Undoing an approval's use is in
// ./ask-undo.ts, in the reversal's own batch.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import type { Uuid } from "../ids/index.js";
import { createLedgerRepository, splitsProblem, txnRecordOf, txnStatements } from "./ledger.js";
import { MOVE_COLUMNS, mapMove } from "./moves.js";
import { Params, itemColumns, mapItem } from "./pantry.js";
import { takeStockStatements } from "./stock.js";
import type {
  KitchenItemRecord,
  KitchenRepositoryError,
  KitchenResult,
  KitchenStockMoveRecord,
  KitchenTxnRecord,
  StockMoved,
  TakeStockInput,
} from "./types.js";

// ── Types ──────────────────────────────────────────────────

export type KitchenAskState = "pending" | "approved" | "declined" | "canceled";
export type KitchenAskSource = "pantry" | "cook";

export interface KitchenAskRecord {
  id: string;
  orgId: string;
  itemId: string;
  askerId: string;
  /** Thousandths of the item's base unit. */
  qtyMilli: number;
  /** The unit it was asked in (the item's own for a measure). */
  unit: string;
  /** The measure's words ("1 pinch"); null for an amount in a unit. */
  label: string | null;
  consumers: string[];
  /** One per consumer; null for equal shares. */
  weights: number[] | null;
  source: KitchenAskSource;
  /** What was decided; lapsing is read-side (askIsLive). */
  state: KitchenAskState;
  createdAt: Date;
  expiresAt: Date;
  answeredAt: Date | null;
  answeredBy: string | null;
  moveId: string | null;
  txnId: string | null;
  /** The approval added the asker to the item's allowed list. */
  granted: boolean;
  idemKey: string;
}

/** An ask with its item as it is now. */
export interface KitchenAskRead {
  ask: KitchenAskRecord;
  item: KitchenItemRecord;
}

export interface NewKitchenAsk {
  id: Uuid;
  orgId: string;
  itemId: string;
  askerId: string;
  qtyMilli: number;
  unit: string;
  label: string | null;
  consumers: readonly string[];
  weights: readonly number[] | null;
  source: KitchenAskSource;
  idemKey: string;
  now: Date;
  /** When it lapses: 24 hours after `now`. */
  expiresAt: Date;
}

export interface CreatedAsk {
  read: KitchenAskRead;
  /** The key had already made an ask on this item: `read` is that one, and nothing was written. */
  replayed: boolean;
}

export interface ApproveAskInput {
  orgId: string;
  askId: string;
  answeredBy: string;
  now: Date;
  /** The use, as the asker would have logged it: via 'ask', the asker as its actor and the transaction's creator. */
  take: TakeStockInput;
  /** Add the asker to the item's allowed list in the same batch ("Always let Dev"). */
  grant: boolean;
}

export interface ApprovedAsk extends StockMoved {
  ask: KitchenAskRecord;
}

/** Why an ask write was refused: what any stock write may be, or the ask is no longer pending (`ask` as it is now). */
export type AskWriteError = KitchenRepositoryError | { kind: "ask_not_pending"; ask: KitchenAskRecord };
export type AskResult<T> = { ok: true; value: T } | { ok: false; error: AskWriteError };

export type KitchenAskAnswer = "decline" | "reopen" | "cancel";

export interface AnswerAskInput {
  orgId: string;
  askId: string;
  answer: KitchenAskAnswer;
  /** Who answers: the answerer (decline, reopen) or the asker (cancel). */
  actor: string;
  now: Date;
}

export interface KitchenAsksQuery {
  /** The groups the reader is in: nothing else is read. */
  orgIds: readonly string[];
  now: Date;
  /** Live pending asks to answer: on items `paidBy` bought, and on every item in `adminOrgIds` (the caller keeps those whose buyer has left). */
  answer: { paidBy: string; adminOrgIds: readonly string[] };
  /** The reader's own asks made at or after `since`, in any state. */
  mine: { askerId: string; since: Date };
  /** At most this many of each. */
  limit: number;
}

export interface KitchenAsksPage {
  /** Oldest first. */
  toAnswer: KitchenAskRead[];
  /** Newest first. */
  mine: KitchenAskRead[];
}

export interface ReplaceAllowedInput {
  orgId: string;
  itemId: string;
  members: readonly string[];
  now: Date;
}

export interface AsksRepository {
  /** The allowed rows of these items, by item then member. */
  listAllowed(itemIds: readonly string[]): Promise<KitchenResult<Array<{ itemId: string; memberId: string }>>>;
  /** Replace the item's allowed list; nothing when it is no longer in the group's pantry. */
  replaceAllowed(input: ReplaceAllowedInput): Promise<KitchenResult<void>>;
  createAsk(input: NewKitchenAsk): Promise<KitchenResult<CreatedAsk>>;
  getAsk(orgId: string, askId: string): Promise<KitchenResult<KitchenAskRead>>;
  approveAsk(input: ApproveAskInput): Promise<AskResult<ApprovedAsk>>;
  /** Null when the ask was not in the state the answer moves it from (or no longer live). */
  answerAsk(input: AnswerAskInput): Promise<KitchenResult<KitchenAskRead | null>>;
  listAsks(query: KitchenAsksQuery): Promise<KitchenResult<KitchenAsksPage>>;
}

// ── Rows ───────────────────────────────────────────────────

/** An ask's columns (the table aliased `a`), each prefixed `ask_` so they sit beside an item's in one row. */
const ASK_COLUMNS = [
  "id",
  "org_id",
  "item_id",
  "asker_id",
  "qty_milli",
  "unit",
  "label",
  "consumers",
  "weights",
  "source",
  "state",
  "created_at",
  "expires_at",
  "answered_at",
  "answered_by",
  "move_id",
  "txn_id",
  "granted",
  "idem_key",
]
  .map((c) => `a.${c} AS ask_${c}`)
  .join(", ");

const ASK_AND_ITEM = `${ASK_COLUMNS}, ${itemColumns("i")}`;

/**
 * A pending ask that has not lapsed (the asks aliased `a`, their items `i`):
 * before its time, on an item still active and still ask-first.
 */
export function liveSql(now: string): string {
  return `a.state = 'pending' AND a.expires_at > ${now} AND i.state = 'active' AND i.ask_first = 1`;
}

/** The same rule over records: is this pending ask still answerable at `now`? */
export function askIsLive(ask: KitchenAskRecord, item: KitchenItemRecord, now: Date): boolean {
  return ask.state === "pending" && ask.expiresAt.getTime() > now.getTime() && item.state === "active" && item.askFirst === true;
}

type Row = Record<string, unknown>;

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function json<T>(value: unknown): T | null {
  return typeof value === "string" ? (JSON.parse(value) as T) : null;
}

export function mapAsk(row: Row): KitchenAskRecord {
  const at = (column: string) => new Date(row[`ask_${column}`] as string);
  const answeredAt = nullable(row.ask_answered_at);
  return {
    id: row.ask_id as string,
    orgId: row.ask_org_id as string,
    itemId: row.ask_item_id as string,
    askerId: row.ask_asker_id as string,
    qtyMilli: Number(row.ask_qty_milli),
    unit: row.ask_unit as string,
    label: nullable(row.ask_label),
    consumers: (json<unknown[]>(row.ask_consumers) ?? []).map(String),
    weights: json<number[]>(row.ask_weights),
    source: row.ask_source as KitchenAskSource,
    state: row.ask_state as KitchenAskState,
    createdAt: at("created_at"),
    expiresAt: at("expires_at"),
    answeredAt: answeredAt ? new Date(answeredAt) : null,
    answeredBy: nullable(row.ask_answered_by),
    moveId: nullable(row.ask_move_id),
    txnId: nullable(row.ask_txn_id),
    granted: Number(row.ask_granted) === 1,
    idemKey: row.ask_idem_key as string,
  };
}

function mapRead(row: Row): KitchenAskRead {
  return { ask: mapAsk(row), item: mapItem(row) };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

const NOT_FOUND: KitchenResult<never> = { ok: false, error: { kind: "not_found" } };

// ── Repository ─────────────────────────────────────────────

export function createAsksRepository(executor: SqlExecutor): AsksRepository {
  const ledger = createLedgerRepository(executor);

  async function findAsk(orgId: string, askId: string): Promise<KitchenAskRead | null> {
    const result = await executor.execute(
      `SELECT ${ASK_AND_ITEM} FROM kitchen_asks a JOIN kitchen_items i ON i.id = a.item_id
       WHERE a.id = $1 AND a.org_id = $2 AND i.owner_kind = 'group' AND i.org_id = $2`,
      [askId, orgId],
    );
    const row = result.rows[0];
    return row ? mapRead(row) : null;
  }

  async function findMoveByIdem(itemId: string, idemKey: string): Promise<KitchenStockMoveRecord | null> {
    const result = await executor.execute(
      `SELECT ${MOVE_COLUMNS} FROM kitchen_stock_moves m WHERE m.item_id = $1 AND m.idem_key = $2`,
      [itemId, idemKey],
    );
    const row = result.rows[0];
    return row ? mapMove(row) : null;
  }

  /** The approval this move is: the ask, its item and the move's transaction as they are now. */
  async function replayApproval(orgId: string, move: KitchenStockMoveRecord): Promise<AskResult<ApprovedAsk>> {
    const result = await executor.execute(
      `SELECT ${ASK_AND_ITEM} FROM kitchen_asks a JOIN kitchen_items i ON i.id = a.item_id
       WHERE a.item_id = $1 AND a.state = 'approved' AND a.move_id = $2 AND a.org_id = $3`,
      [move.itemId, move.id, orgId],
    );
    const row = result.rows[0];
    if (!row) return { ok: false, error: { kind: "conflict", entity: "kitchen_stock_move" } };
    const read = mapRead(row);
    let txn: KitchenTxnRecord | null = null;
    if (move.txnId) {
      const found = await ledger.getTxn(orgId as Uuid, move.txnId as Uuid);
      if (!found.ok) return found;
      txn = found.value;
    }
    return { ok: true, value: { ask: read.ask, item: read.item, move, txn, replayed: true } };
  }

  return {
    async listAllowed(itemIds) {
      if (itemIds.length === 0) return { ok: true, value: [] };
      try {
        // The items bind as ONE JSON parameter, however many there are.
        const result = await executor.execute(
          `SELECT item_id, member_id FROM kitchen_item_allowed
           WHERE item_id IN (SELECT value FROM json_each($1))
           ORDER BY item_id, created_at, member_id`,
          [JSON.stringify([...new Set(itemIds)])],
        );
        return { ok: true, value: result.rows.map((r) => ({ itemId: String(r.item_id), memberId: String(r.member_id) })) };
      } catch (err) {
        return internal(err);
      }
    },

    async replaceAllowed({ orgId, itemId, members, now }) {
      // Only while the item is still in the group's pantry: a removed item keeps the list it had.
      const inPantry = `EXISTS (SELECT 1 FROM kitchen_items WHERE id = $1 AND owner_kind = 'group' AND org_id = $2 AND state <> 'removed')`;
      const statements: SqlStatement[] = [
        { text: `DELETE FROM kitchen_item_allowed WHERE item_id = $1 AND ${inPantry}`, params: [itemId, orgId] },
        ...[...new Set(members)].map((memberId) => ({
          text: `INSERT INTO kitchen_item_allowed (item_id, member_id, created_at) SELECT $1, $3, $4 WHERE ${inPantry}`,
          params: [itemId, orgId, memberId, now],
        })),
      ];
      try {
        await executeBatch(executor, statements);
        return { ok: true, value: undefined };
      } catch (err) {
        return internal(err);
      }
    },

    async createAsk(input) {
      try {
        await executor.execute(
          `INSERT INTO kitchen_asks (
             id, org_id, item_id, asker_id, qty_milli, unit, label, consumers, weights, source,
             state, created_at, expires_at, idem_key
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13)`,
          [
            input.id,
            input.orgId,
            input.itemId,
            input.askerId,
            input.qtyMilli,
            input.unit,
            input.label,
            JSON.stringify(input.consumers),
            input.weights ? JSON.stringify(input.weights) : null,
            input.source,
            input.now,
            input.expiresAt,
            input.idemKey,
          ],
        );
        const made = await findAsk(input.orgId, input.id);
        return made ? { ok: true, value: { read: made, replayed: false } } : internal("kitchen: ask insert read back nothing");
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            // The same key again on this item: answer with the ask it made.
            const params = new Params();
            const found = await executor.execute(
              `SELECT ${ASK_AND_ITEM} FROM kitchen_asks a JOIN kitchen_items i ON i.id = a.item_id
               WHERE a.item_id = ${params.add(input.itemId)} AND a.idem_key = ${params.add(input.idemKey)}`,
              params.values,
            );
            const row = found.rows[0];
            if (row) return { ok: true, value: { read: mapRead(row), replayed: true } };
            return { ok: false, error: { kind: "conflict", entity: "kitchen_ask" } };
          }
          if (isCheckViolation(err)) return { ok: false, error: { kind: "invalid", reason: "ask_out_of_range" } };
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
    },

    async getAsk(orgId, askId) {
      try {
        const read = await findAsk(orgId, askId);
        return read ? { ok: true, value: read } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async approveAsk({ orgId, askId, answeredBy, now, take, grant }) {
      const { owner, itemId, expectedVersion, move, txn, audit } = take;
      const txnRecord = txn ? txnRecordOf(txn.txn, txn.splits) : null;
      if (txnRecord) {
        const problem = splitsProblem(txnRecord.totalMinor, txnRecord.splits);
        if (problem) return { ok: false, error: { kind: "invalid", reason: problem } };
      }
      const record: KitchenStockMoveRecord = {
        id: move.id,
        itemId,
        kind: move.kind,
        qtyMilli: move.qtyMilli,
        costMinor: move.costMinor,
        actor: move.actor,
        txnId: txnRecord?.id ?? null,
        dishId: null,
        consumers: move.consumers ? [...move.consumers] : null,
        unit: move.unit,
        label: move.label ?? null,
        reverses: null,
        undoneBy: null,
        idemKey: move.idemKey,
        createdAt: move.now,
        via: "ask",
      };

      // 1. The ask, approved — only while it is pending and before its time:
      //    otherwise its state reads 'stale', which the CHECK refuses, and the
      //    whole batch fails. `granted` is decided before the allowed insert.
      const statements: SqlStatement[] = [
        {
          text: `UPDATE kitchen_asks SET
                   state = CASE WHEN state = 'pending' AND expires_at > $4 THEN 'approved' ELSE 'stale' END,
                   answered_at = $4, answered_by = $5, move_id = $6, txn_id = $7,
                   granted = CASE WHEN $8 = 1 AND NOT EXISTS (
                               SELECT 1 FROM kitchen_item_allowed l
                               WHERE l.item_id = kitchen_asks.item_id AND l.member_id = kitchen_asks.asker_id
                             ) THEN 1 ELSE 0 END
                 WHERE id = $1 AND org_id = $2 AND item_id = $3
                 RETURNING id`,
          params: [askId, orgId, itemId, now, answeredBy, record.id, record.txnId, grant ? 1 : 0],
        },
      ];
      // 2. The use, as a use of the item writes it: its transaction first (the move's txn_id references it).
      if (txnRecord) statements.push(...txnStatements({ record: txnRecord, audit: undefined }));
      const updateAt = statements.length + 1;
      statements.push(...takeStockStatements(owner, expectedVersion, record));
      // 3. Always let them, when asked.
      if (grant) {
        statements.push({
          text: `INSERT OR IGNORE INTO kitchen_item_allowed (item_id, member_id, created_at)
                 SELECT item_id, asker_id, $2 FROM kitchen_asks WHERE id = $1`,
          params: [askId, now],
        });
      }
      if (audit) statements.push(...eventWithAuditStatements(audit));

      try {
        const results = await executeBatch(executor, statements);
        const row = results[updateAt]?.rows[0];
        if (!row || !results[0]?.rows[0]) return internal("kitchen: ask approval wrote no row");
        const read = await findAsk(orgId, askId);
        if (!read) return internal("kitchen: approved ask read back nothing");
        return { ok: true, value: { ask: read.ask, item: mapItem(row), move: record, txn: txnRecord, replayed: false } };
      } catch (err) {
        try {
          if (isUniqueViolation(err)) {
            // The same key again on this item: the approval it made, or a key used for something else.
            const existing = await findMoveByIdem(itemId, move.idemKey);
            if (existing) return await replayApproval(orgId, existing);
            return { ok: false, error: { kind: "conflict", entity: "kitchen_stock_move" } };
          }
          if (isForeignKeyViolation(err) && txnRecord) {
            const settings = await executor.execute("SELECT currency FROM kitchen_group_settings WHERE org_id = $1", [orgId]);
            const currency = settings.rows[0]?.currency;
            return typeof currency === "string" ? { ok: false, error: { kind: "currency_mismatch", currency } } : internal(err);
          }
          if (isCheckViolation(err)) {
            // The ask moved on (answered, cancelled, past its time), or the item did.
            const current = await findAsk(orgId, askId);
            if (!current) return NOT_FOUND;
            if (current.ask.state !== "pending" || current.ask.expiresAt.getTime() <= now.getTime()) {
              return { ok: false, error: { kind: "ask_not_pending", ask: current.ask } };
            }
            if (current.item.version !== expectedVersion || current.item.state !== "active") return { ok: false, error: { kind: "stale" } };
            return { ok: false, error: { kind: "insufficient_stock", qtyLeftMilli: current.item.qtyLeftMilli } };
          }
        } catch (followUp) {
          return internal(followUp);
        }
        return internal(err);
      }
    },

    async answerAsk({ orgId, askId, answer, actor, now }) {
      // Each answer moves from one state, and only while the ask is still live there.
      const set =
        answer === "reopen"
          ? { from: "declined", to: "pending", answeredAt: null, answeredBy: null }
          : { from: "pending", to: answer === "decline" ? "declined" : "canceled", answeredAt: now, answeredBy: actor };
      const p = new Params();
      const sets = `state = ${p.add(set.to)}, answered_at = ${p.add(set.answeredAt)}, answered_by = ${p.add(set.answeredBy)}`;
      const where = [
        `id = ${p.add(askId)}`,
        `org_id = ${p.add(orgId)}`,
        `state = ${p.add(set.from)}`,
        `expires_at > ${p.add(now)}`,
        "EXISTS (SELECT 1 FROM kitchen_items i WHERE i.id = kitchen_asks.item_id AND i.state = 'active' AND i.ask_first = 1)",
      ];
      // Only its asker cancels it.
      if (answer === "cancel") where.push(`asker_id = ${p.add(actor)}`);
      try {
        const result = await executor.execute(`UPDATE kitchen_asks SET ${sets} WHERE ${where.join(" AND ")} RETURNING id`, p.values);
        if (!result.rows[0]) return { ok: true, value: null };
        const read = await findAsk(orgId, askId);
        return read ? { ok: true, value: read } : NOT_FOUND;
      } catch (err) {
        return internal(err);
      }
    },

    async listAsks({ orgIds, now, answer, mine, limit }) {
      if (orgIds.length === 0) return { ok: true, value: { toAnswer: [], mine: [] } };
      try {
        const groups = JSON.stringify([...new Set(orgIds)]);
        const [toAnswer, own] = await Promise.all([
          executor.execute(
            `SELECT ${ASK_AND_ITEM} FROM kitchen_items i JOIN kitchen_asks a ON a.item_id = i.id
             WHERE i.owner_kind = 'group' AND i.org_id IN (SELECT value FROM json_each($1)) AND i.state = 'active'
               AND i.ask_first = 1 AND (i.paid_by = $2 OR i.org_id IN (SELECT value FROM json_each($3)))
               AND ${liveSql("$4")} AND a.asker_id <> $2
             ORDER BY a.created_at, a.id
             LIMIT $5`,
            [groups, answer.paidBy, JSON.stringify([...new Set(answer.adminOrgIds)]), now, limit],
          ),
          executor.execute(
            `SELECT ${ASK_AND_ITEM} FROM kitchen_asks a JOIN kitchen_items i ON i.id = a.item_id
             WHERE a.asker_id = $1 AND a.created_at >= $2 AND a.org_id IN (SELECT value FROM json_each($3))
             ORDER BY a.created_at DESC, a.id DESC
             LIMIT $4`,
            [mine.askerId, mine.since, groups, limit],
          ),
        ]);
        return { ok: true, value: { toAnswer: toAnswer.rows.map(mapRead), mine: own.rows.map(mapRead) } };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
