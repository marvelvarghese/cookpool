import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asUuid, manifest, type Uuid } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import {
  createKitchenRepository,
  type KitchenAskRecord,
  type KitchenItemRecord,
  type KitchenRepository,
  type NewKitchenItem,
  type TakeStockInput,
} from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// Ask before use (Cookpool PN-8, cookpool-pantry design §8.5):
// 420_kitchen_asks — kitchen_items.ask_first, kitchen_item_allowed and
// kitchen_asks. Checked as text (one additive column, two new tables and
// their indexes, nothing else), against a real SQLite engine (the defaults
// and every CHECK), and through the kitchen repository over that engine: an
// ask made and replayed; an approval and the use it posts in one batch, with
// the allowed row it grants; an approval refused once the ask moved on,
// writing nothing; the answers; the reads by item and state and by asker on
// their indexes; and an approval's undo — a transaction's reversal or a
// move's undo — putting the ask back and taking the grant back off, in the
// same batch.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "420_kitchen_asks";

const sqlOf = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");

/** Every manifest migration up to (and not including) `stopAt`, or all of them. */
function migrated(stopAt?: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    if (m.id === stopAt) break;
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

function apply(db: DatabaseSync, id: string): void {
  for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8"))) db.exec(statement);
}

/** A D1 binding over `db`, batches in one transaction as D1's are. */
function d1Over(db: DatabaseSync): D1Binding {
  return {
    prepare(query: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        all<T>() {
          return Promise.resolve({ results: db.prepare(query).all(...(bound as never[])) as T[], success: true });
        },
      };
      return statement;
    },
    async batch(statements: Array<{ all(): Promise<unknown> }>) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Binding;
}

const NOW = new Date("2026-11-08T08:00:00.000Z");
const LATER = new Date("2026-11-08T08:05:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ORG = asUuid(randomUUID());
const flat = { kind: "group", orgId: ORG } as const;
const MEERA = "usr_meera";
const DEV = "usr_dev";
const ANU = "usr_anu";

function saffron(overrides: Partial<NewKitchenItem> = {}): NewKitchenItem {
  return {
    id: asUuid(randomUUID()),
    owner: flat,
    name: "Saffron",
    category: "Spices",
    dimension: "mass",
    displayUnit: "g",
    qtyMilli: 2_000,
    priceMinor: 24_000,
    currency: "INR",
    paidBy: MEERA,
    boughtOn: "2026-11-08",
    expiresOn: null,
    wastePolicy: null,
    createdBy: MEERA,
    idemKey: `add-${randomUUID()}`,
    now: NOW,
    askFirst: true,
    ...overrides,
  };
}

describe("420_kitchen_asks (PN-8)", () => {
  it("is registered under kitchen, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 420);
    expect(ids.slice(0, before.length)).toEqual(before);
    expect(ids[before.length]).toBe(ID);
  });

  it("adds one column with its default and CHECK, two tables and three indexes, and changes nothing else", () => {
    const sql = sqlOf(ID);
    expect(sql.match(/ALTER TABLE \w+ ADD COLUMN \w+/g)).toEqual(["ALTER TABLE kitchen_items ADD COLUMN ask_first"]);
    expect(sql).toMatch(/ADD COLUMN ask_first INTEGER NOT NULL DEFAULT 0\s+CHECK \(ask_first IN \(0, 1\)\);/);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS \w+/g)).toEqual([
      "CREATE TABLE IF NOT EXISTS kitchen_item_allowed",
      "CREATE TABLE IF NOT EXISTS kitchen_asks",
    ]);
    expect(sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+\s+ON \w+ \([^)]*\)/g)).toEqual([
      "CREATE INDEX IF NOT EXISTS kitchen_asks_item_state_idx\n  ON kitchen_asks (item_id, state)",
      "CREATE INDEX IF NOT EXISTS kitchen_asks_asker_idx\n  ON kitchen_asks (asker_id, created_at)",
      "CREATE UNIQUE INDEX IF NOT EXISTS kitchen_asks_item_idem_uq\n  ON kitchen_asks (item_id, idem_key)",
    ]);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT)\b/i);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    afterEach(() => db.close());

    const insertItem = (id: string) =>
      db
        .prepare(
          `INSERT INTO kitchen_items (id, owner_kind, org_id, name, category, dimension, display_unit, qty_bought_milli,
             qty_left_milli, price_minor, currency, paid_by, bought_on, created_by, idem_key)
           VALUES (?, 'group', ?, 'Saffron', 'Spices', 'mass', 'g', 2000, 2000, 24000, 'INR', 'usr_meera', '2026-11-01', 'usr_meera', ?)`,
        )
        .run(id, ORG, `k-${id}`);

    it("reads every item there was as not asking first, and keeps ask_first to 0 or 1", () => {
      db = migrated(ID);
      const id = randomUUID();
      insertItem(id);
      apply(db, ID);
      expect(db.prepare("SELECT ask_first FROM kitchen_items WHERE id = ?").get(id)).toEqual({ ask_first: 0 });
      expect(() => db.prepare("UPDATE kitchen_items SET ask_first = 2 WHERE id = ?").run(id)).toThrow(/CHECK constraint failed/);
      db.prepare("UPDATE kitchen_items SET ask_first = 1 WHERE id = ?").run(id);
    });

    it("keeps one allowed row per item and member, for a real item", () => {
      db = migrated();
      const id = randomUUID();
      insertItem(id);
      const allow = db.prepare("INSERT INTO kitchen_item_allowed (item_id, member_id, created_at) VALUES (?, ?, ?)");
      allow.run(id, ANU, NOW.toISOString());
      expect(() => allow.run(id, ANU, NOW.toISOString())).toThrow(/UNIQUE|PRIMARY KEY/);
      expect(() => allow.run(randomUUID(), ANU, NOW.toISOString())).toThrow(/FOREIGN KEY/);
    });

    it("keeps an ask whole: its state, its times, an answer exactly when decided and a move exactly when approved", () => {
      db = migrated();
      const item = randomUUID();
      insertItem(item);
      const ask = (overrides: Record<string, unknown> = {}) => {
        const row = {
          id: randomUUID(), state: "pending", consumers: JSON.stringify([DEV, ANU]), weights: null, source: "pantry",
          created_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + DAY).toISOString(),
          answered_at: null, answered_by: null, move_id: null, txn_id: null, ...overrides,
        };
        db.prepare(
          `INSERT INTO kitchen_asks (id, org_id, item_id, asker_id, qty_milli, unit, consumers, weights, source, state,
             created_at, expires_at, answered_at, answered_by, move_id, txn_id, idem_key)
           VALUES (?, ?, ?, 'usr_dev', 100, 'g', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(row.id, ORG, item, row.consumers, row.weights, row.source, row.state, row.created_at, row.expires_at,
          row.answered_at, row.answered_by, row.move_id, row.txn_id, randomUUID());
      };
      ask();
      const answered = { answered_at: LATER.toISOString(), answered_by: MEERA };
      ask({ state: "declined", ...answered });
      ask({ state: "approved", ...answered, move_id: randomUUID() });
      ask({ weights: "[1,2]" });
      for (const bad of [
        { state: "lapsed" },
        { source: "fridge" },
        { consumers: "[]" },
        { consumers: "dev" },
        { weights: "[1]" },
        { expires_at: NOW.toISOString() },
        { state: "approved", ...answered },
        { move_id: randomUUID() },
        { state: "declined" },
        { answered_by: MEERA },
        { state: "declined", ...answered, txn_id: randomUUID() },
      ]) {
        expect(() => ask(bad)).toThrow(/CHECK constraint failed/);
      }
    });
  });

  describe("through the kitchen repository", () => {
    let db: DatabaseSync;
    let repo: KitchenRepository;
    beforeEach(() => {
      db = migrated();
      repo = createKitchenRepository(createSqlExecutor(d1Over(db)));
    });
    afterEach(() => db.close());

    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

    async function added(item = saffron({ allowed: [ANU] })): Promise<KitchenItemRecord> {
      const made = await repo.createItem({ item });
      if (!made.ok) throw new Error(made.error.kind);
      return made.value.item;
    }

    async function asked(item: KitchenItemRecord, idemKey = `ask-${randomUUID()}`, now = NOW): Promise<KitchenAskRecord> {
      const made = await repo.createAsk({
        id: asUuid(randomUUID()), orgId: ORG, itemId: item.id, askerId: DEV, qtyMilli: 100, unit: "g", label: "1 pinch",
        consumers: [DEV, ANU], weights: null, source: "pantry", idemKey, now, expiresAt: new Date(now.getTime() + DAY),
      });
      if (!made.ok) throw new Error(made.error.kind);
      return made.value.read.ask;
    }

    /** The use Dev would log: 1 pinch for him and Anu, ₹12 back to Meera. */
    function use(item: KitchenItemRecord, idemKey: string, consumers = [DEV, ANU]): TakeStockInput {
      const posts = consumers.some((c) => c !== MEERA);
      return {
        owner: flat,
        itemId: item.id as Uuid,
        expectedVersion: item.version,
        move: { id: asUuid(randomUUID()), kind: "use", qtyMilli: 100, costMinor: 1200, unit: "g", label: "1 pinch", consumers, actor: DEV, idemKey, now: LATER, via: "ask" },
        txn: posts
          ? {
              txn: { id: asUuid(randomUUID()), orgId: ORG, kind: "use", title: "Saffron (1 pinch)", totalMinor: 1200, currency: "INR", occurredAt: LATER, createdBy: DEV, sourceKind: "item", sourceId: item.id, idemKey, now: LATER },
              splits: [
                { subjectId: MEERA, paidMinor: 1200, owedMinor: 0 },
                { subjectId: DEV, paidMinor: 0, owedMinor: 600 },
                { subjectId: ANU, paidMinor: 0, owedMinor: 600 },
              ],
            }
          : null,
      };
    }

    it("stores an item's ask_first and allowed list, replaces the list, and reads it in one statement", async () => {
      const item = await added();
      expect(item.askFirst).toBe(true);
      const plain = await added(saffron({ askFirst: false, allowed: [] }));
      expect(plain.askFirst).toBe(false);
      expect(await repo.listAllowed([item.id, plain.id])).toEqual({ ok: true, value: [{ itemId: item.id, memberId: ANU }] });
      expect(await repo.replaceAllowed({ orgId: ORG, itemId: item.id, members: [DEV, ANU], now: LATER })).toEqual({ ok: true, value: undefined });
      const list = await repo.listAllowed([item.id]);
      expect(list.ok && list.value.map((r) => r.memberId).sort()).toEqual([ANU, DEV]);
      // Another group's pantry is never written.
      expect(await repo.replaceAllowed({ orgId: asUuid(randomUUID()), itemId: item.id, members: [], now: LATER })).toEqual({ ok: true, value: undefined });
      expect(count("kitchen_item_allowed")).toBe(2);
      const off = await repo.updateItem({ owner: flat, itemId: item.id as Uuid, changes: { askFirst: false }, now: LATER });
      expect(off.ok && off.value.askFirst).toBe(false);
    });

    it("makes an ask once per key, and answers a retry with it", async () => {
      const item = await added();
      const first = await asked(item, "k1");
      expect(first).toMatchObject({ state: "pending", askerId: DEV, consumers: [DEV, ANU], weights: null, label: "1 pinch", moveId: null, moveCostMinor: null });
      const again = await repo.createAsk({
        id: asUuid(randomUUID()), orgId: ORG, itemId: item.id, askerId: DEV, qtyMilli: 999, unit: "g", label: null,
        consumers: [DEV], weights: null, source: "cook", idemKey: "k1", now: LATER, expiresAt: new Date(LATER.getTime() + DAY),
      });
      expect(again.ok && again.value.replayed && again.value.read.ask.id).toBe(first.id);
      expect(count("kitchen_asks")).toBe(1);
    });

    it("approves an ask and posts its use in one batch, granting Always let; the same key replays it", async () => {
      const item = await added(saffron());
      const ask = await asked(item);
      const approved = await repo.approveAsk({ orgId: ORG, askId: ask.id, answeredBy: MEERA, now: LATER, take: use(item, "ok-1"), grant: true });
      if (!approved.ok) throw new Error(approved.error.kind);
      expect(approved.value.ask).toMatchObject({ state: "approved", answeredBy: MEERA, answeredAt: LATER, granted: true, moveCostMinor: 1200 });
      expect(approved.value.ask.moveId).toBe(approved.value.move.id);
      expect(approved.value.ask.txnId).toBe(approved.value.txn!.id);
      expect(approved.value.move).toMatchObject({ via: "ask", actor: DEV, qtyMilli: 100 });
      expect(approved.value.item).toMatchObject({ qtyLeftMilli: 1900, costTakenMinor: 1200 });
      expect(await repo.listAllowed([item.id])).toEqual({ ok: true, value: [{ itemId: item.id, memberId: DEV }] });

      const fresh = await repo.getItem(flat, item.id as Uuid);
      if (!fresh.ok) throw new Error("read");
      const replay = await repo.approveAsk({ orgId: ORG, askId: ask.id, answeredBy: MEERA, now: LATER, take: use(fresh.value, "ok-1"), grant: true });
      expect(replay.ok && replay.value.replayed && replay.value.move.id).toBe(approved.value.move.id);
      expect(count("kitchen_stock_moves")).toBe(1);
      expect(count("kitchen_txns")).toBe(1);
    });

    it("writes nothing when the ask moved on or lapsed, or the item did", async () => {
      const item = await added(saffron());
      const ask = await asked(item);
      expect((await repo.answerAsk({ orgId: ORG, askId: ask.id, answer: "decline", actor: MEERA, now: LATER }))).toMatchObject({ ok: true, value: { ask: { state: "declined" } } });
      const refused = await repo.approveAsk({ orgId: ORG, askId: ask.id, answeredBy: MEERA, now: LATER, take: use(item, "no-1"), grant: true });
      expect(refused.ok === false && refused.error.kind).toBe("ask_not_pending");

      const late = await asked(item);
      const after = new Date(NOW.getTime() + DAY + 1);
      const lapsed = await repo.approveAsk({ orgId: ORG, askId: late.id, answeredBy: MEERA, now: after, take: use(item, "no-2"), grant: false });
      expect(lapsed.ok === false && lapsed.error.kind).toBe("ask_not_pending");

      const live = await asked(item);
      const stale = await repo.approveAsk({ orgId: ORG, askId: live.id, answeredBy: MEERA, now: LATER, take: { ...use(item, "no-3"), expectedVersion: item.version + 5 }, grant: true });
      expect(stale).toEqual({ ok: false, error: { kind: "stale" } });
      expect([count("kitchen_stock_moves"), count("kitchen_txns"), count("kitchen_item_allowed")]).toEqual([0, 0, 0]);
      const still = await repo.getAsk(ORG, live.id);
      expect(still.ok && still.value.ask.state).toBe("pending");
    });

    it("declines, reopens and cancels only from the state each moves from, and only while live", async () => {
      const item = await added(saffron());
      const ask = await asked(item);
      const answerAs = (answer: "decline" | "reopen" | "cancel", actor: string, now = LATER) => repo.answerAsk({ orgId: ORG, askId: ask.id, answer, actor, now });
      expect(await answerAs("reopen", MEERA)).toEqual({ ok: true, value: null });
      expect(await answerAs("cancel", ANU)).toEqual({ ok: true, value: null });
      expect(await answerAs("decline", MEERA)).toMatchObject({ ok: true, value: { ask: { state: "declined", answeredBy: MEERA } } });
      expect(await answerAs("reopen", MEERA, new Date(NOW.getTime() + DAY))).toEqual({ ok: true, value: null });
      expect(await answerAs("reopen", MEERA)).toMatchObject({ ok: true, value: { ask: { state: "pending", answeredBy: null, answeredAt: null } } });
      expect(await answerAs("cancel", DEV)).toMatchObject({ ok: true, value: { ask: { state: "canceled", answeredBy: DEV } } });
      expect(await answerAs("decline", MEERA)).toEqual({ ok: true, value: null });
    });

    it("lists what a buyer answers and what the asker asked, through the item and asker indexes", async () => {
      const item = await added(saffron());
      const pending = await asked(item);
      const other = await asked(item);
      await repo.answerAsk({ orgId: ORG, askId: other.id, answer: "cancel", actor: DEV, now: LATER });
      const page = await repo.listAsks({ orgIds: [ORG], now: LATER, answer: { paidBy: MEERA, adminOrgIds: [] }, mine: { askerId: DEV, since: NOW }, limit: 50 });
      expect(page.ok && page.value.toAnswer.map((r) => r.ask.id)).toEqual([pending.id]);
      expect(page.ok && page.value.mine.map((r) => r.ask.id).sort()).toEqual([pending.id, other.id].sort());
      const none = await repo.listAsks({ orgIds: [ORG], now: LATER, answer: { paidBy: ANU, adminOrgIds: [] }, limit: 50 });
      expect(none).toEqual({ ok: true, value: { toAnswer: [], mine: [] } });
      const admin = await repo.listAsks({ orgIds: [ORG], now: LATER, answer: { paidBy: ANU, adminOrgIds: [ORG] }, limit: 50 });
      expect(admin.ok && admin.value.toAnswer.map((r) => r.ask.id)).toEqual([pending.id]);

      const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(" | ");
      expect(plan("SELECT * FROM kitchen_asks a WHERE a.item_id = 'x' AND a.state = 'pending'")).toMatch(/kitchen_asks_item_state_idx/);
      expect(plan("SELECT * FROM kitchen_asks a WHERE a.asker_id = 'x' AND a.created_at >= '2026'")).toMatch(/kitchen_asks_asker_idx/);
    });

    it("puts the ask back with the reversal of its use's transaction, taking back the grant, in the same batch", async () => {
      const item = await added(saffron());
      const ask = await asked(item);
      const approved = await repo.approveAsk({ orgId: ORG, askId: ask.id, answeredBy: MEERA, now: LATER, take: use(item, "ok-1"), grant: true });
      if (!approved.ok) throw new Error(approved.error.kind);
      const found = await repo.findApproval({ itemId: item.id, txnId: approved.value.txn!.id });
      expect(found.ok && found.value?.id).toBe(ask.id);
      const txn = approved.value.txn!;
      const reversed = await repo.reverseTxn({
        original: txn,
        reversal: { id: asUuid(randomUUID()), title: `Reversal: ${txn.title}`, occurredAt: LATER, createdBy: MEERA, note: null, idemKey: "rev-1", now: LATER },
        splits: txn.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })),
      });
      expect(reversed.ok).toBe(true);
      const back = await repo.getAsk(ORG, ask.id);
      expect(back.ok && back.value.ask).toMatchObject({ state: "pending", answeredBy: null, moveId: null, txnId: null, granted: false });
      expect(back.ok && back.value.item.qtyLeftMilli).toBe(2_000);
      expect(count("kitchen_item_allowed")).toBe(0);
      expect(await repo.findApproval({ itemId: item.id, txnId: txn.id })).toEqual({ ok: true, value: null });
    });

    it("puts the ask back with a move's undo (a use for the buyer moves no money), and cancels it when the asker undoes it", async () => {
      const item = await added(saffron());
      const ask = await asked(item);
      const approved = await repo.approveAsk({ orgId: ORG, askId: ask.id, answeredBy: MEERA, now: LATER, take: use(item, "ok-1", [MEERA]), grant: false });
      if (!approved.ok) throw new Error(approved.error.kind);
      expect(approved.value.txn).toBeNull();
      const undo = (move: typeof approved.value.move, version: number, actor: string, idemKey: string) =>
        repo.undoMove({ owner: flat, move, expectedVersion: version, reversal: { id: asUuid(randomUUID()), actor, idemKey, now: LATER } });
      expect((await undo(approved.value.move, approved.value.item.version, MEERA, "u-1")).ok).toBe(true);
      const back = await repo.getAsk(ORG, ask.id);
      expect(back.ok && back.value.ask.state).toBe("pending");

      const fresh = await repo.getItem(flat, item.id as Uuid);
      if (!fresh.ok) throw new Error("read");
      const second = await repo.approveAsk({ orgId: ORG, askId: ask.id, answeredBy: MEERA, now: LATER, take: use(fresh.value, "ok-2", [MEERA]), grant: false });
      if (!second.ok) throw new Error(second.error.kind);
      expect((await undo(second.value.move, second.value.item.version, DEV, "u-2")).ok).toBe(true);
      const canceled = await repo.getAsk(ORG, ask.id);
      expect(canceled.ok && canceled.value.ask).toMatchObject({ state: "canceled", answeredBy: DEV, moveId: null });
    });
  });
});
