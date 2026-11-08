import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asUuid, manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createKitchenRepository, type KitchenRepository, type NewKitchenItem } from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// What wrote a stock move (Cookpool PN-4, cookpool-pantry design §7):
// 410_kitchen_moves_via — kitchen_stock_moves.via, 'check' on what a stock
// check writes and 'ask' kept for PN-8. Checked as text (one additive column,
// nothing else), against a real SQLite engine (the CHECK, and a move written
// before reading NULL), and through the kitchen repository over that engine:
// `via` written and read back, the check's `adjust` raising what is left
// (never above what was bought) and its undo taking it back off.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "410_kitchen_moves_via";

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
const me = { kind: "user", subjectId: "usr_rahul" } as const;

function newItem(overrides: Partial<NewKitchenItem> = {}): NewKitchenItem {
  return {
    id: asUuid(randomUUID()),
    owner: me,
    name: "Milk",
    category: "Dairy",
    dimension: "volume",
    displayUnit: "L",
    qtyMilli: 1_000_000,
    priceMinor: 6000,
    currency: "INR",
    paidBy: "usr_rahul",
    boughtOn: "2026-11-08",
    expiresOn: null,
    wastePolicy: null,
    createdBy: "usr_rahul",
    idemKey: `add-${randomUUID()}`,
    now: NOW,
    ...overrides,
  };
}

describe("410_kitchen_moves_via (PN-4)", () => {
  it("is registered under kitchen, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    // 400 is PN-3's, whichever lands first.
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 410);
    expect(ids.slice(0, before.length)).toEqual(before);
    expect(ids[before.length]).toBe(ID);
  });

  it("adds one nullable column with its CHECK, and changes nothing else", () => {
    const sql = sqlOf(ID);
    expect(sql.match(/ALTER TABLE \w+ ADD COLUMN \w+/g)).toEqual(["ALTER TABLE kitchen_stock_moves ADD COLUMN via"]);
    expect(sql).toMatch(/ADD COLUMN via TEXT\s+CHECK \(via IS NULL OR via IN \('check', 'ask'\)\);/);
    expect(sql).not.toMatch(/\b(CREATE|DROP|UPDATE|DELETE|INSERT|REFERENCES|NOT NULL|DEFAULT)\b/i);
  });

  describe("against a real SQLite engine", () => {
    const insertMove = (db: DatabaseSync, itemId: string, via: string | null) =>
      db.prepare(
        "INSERT INTO kitchen_stock_moves (id, item_id, kind, qty_milli, cost_minor, actor, via) VALUES (?, ?, 'use', 100, 1, 'usr_rahul', ?)",
      ).run(randomUUID(), itemId, via);

    it("keeps check, ask or nothing, and refuses anything else", async () => {
      const db = migrated();
      const item = newItem();
      await createKitchenRepository(createSqlExecutor(d1Over(db))).createItem({ item });
      for (const via of [null, "check", "ask"]) expect(() => insertMove(db, item.id, via)).not.toThrow();
      for (const via of ["", "Check", "checked", "use"]) expect(() => insertMove(db, item.id, via)).toThrow(/CHECK constraint failed/);
      const column = (db.prepare("PRAGMA table_info(kitchen_stock_moves)").all() as Array<{ name: string; notnull: number; dflt_value: unknown }>)
        .find((c) => c.name === "via");
      expect(column).toMatchObject({ notnull: 0, dflt_value: null });
      db.close();
    });

    it("reads every move written before it as logged directly", async () => {
      const db = migrated(ID);
      const item = newItem();
      await createKitchenRepository(createSqlExecutor(d1Over(db))).createItem({ item });
      db.prepare("INSERT INTO kitchen_stock_moves (id, item_id, kind, qty_milli, cost_minor, actor) VALUES (?, ?, 'use', 100, 6, 'usr_rahul')")
        .run(randomUUID(), item.id);
      apply(db, ID);
      const moves = await createKitchenRepository(createSqlExecutor(d1Over(db))).listMoves(me, item.id as never, 10);
      expect(moves.ok && moves.value.map((m) => m.via)).toEqual([null]);
      db.close();
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

    const read = async (id: string) => {
      const found = await repo.getItem(me, id as never);
      if (!found.ok) throw new Error(found.error.kind);
      return found.value;
    };
    const take = (item: NewKitchenItem, version: number, qtyMilli: number, via: "check" | null, idemKey: string, costMinor = (qtyMilli * 6) / 1000) =>
      repo.takeStock({
        owner: me,
        itemId: item.id,
        expectedVersion: version,
        move: { id: asUuid(randomUUID()), kind: "use", qtyMilli, costMinor, unit: "ml", consumers: ["usr_rahul"], actor: "usr_rahul", idemKey, now: NOW, via },
      });
    const adjust = (item: NewKitchenItem, version: number, qtyMilli: number, idemKey: string) =>
      repo.adjustStock({
        owner: me,
        itemId: item.id,
        expectedVersion: version,
        move: { id: asUuid(randomUUID()), kind: "adjust", qtyMilli, unit: "ml", via: "check", actor: "usr_rahul", idemKey, now: NOW },
      });

    it("writes via on a use and reads it back", async () => {
      const item = newItem();
      await repo.createItem({ item });
      const used = await take(item, 1, 250_000, "check", "c1");
      expect(used.ok && used.value.move.via).toBe("check");
      const moves = await repo.listMoves(me, item.id, 10);
      expect(moves.ok && moves.value.map((m) => [m.kind, m.via])).toEqual([["use", "check"]]);
    });

    it("raises what is left with an adjust that costs nothing, never above what was bought", async () => {
      const item = newItem();
      await repo.createItem({ item });
      await take(item, 1, 400_000, null, "u1");
      const raised = await adjust(item, 2, 300_000, "a1");
      expect(raised.ok && raised.value.move).toMatchObject({ kind: "adjust", qtyMilli: 300_000, costMinor: 0, txnId: null, via: "check" });
      expect(await read(item.id)).toMatchObject({ qtyLeftMilli: 900_000, costTakenMinor: 2400, state: "active", version: 3 });

      // Above what was bought: the stock CHECK fails the batch, and nothing is written.
      const over = await adjust(item, 3, 100_001, "a2");
      expect(over).toEqual({ ok: false, error: { kind: "invalid", reason: "more_than_bought" } });
      // At a version the item has moved on from: stale.
      expect(await adjust(item, 2, 1_000, "a3")).toEqual({ ok: false, error: { kind: "stale" } });
      // The same key again: the move it made.
      const again = await adjust(item, 3, 50_000, "a1");
      expect(again.ok && again.value.replayed && again.value.move.qtyMilli).toBe(300_000);
      expect((db.prepare("SELECT COUNT(*) AS n FROM kitchen_stock_moves").get() as { n: number }).n).toBe(2);
    });

    it("takes an adjust back off with its undo, and refuses once that much is not there", async () => {
      const item = newItem();
      await repo.createItem({ item });
      await take(item, 1, 1_000_000, null, "u1");
      expect(await read(item.id)).toMatchObject({ qtyLeftMilli: 0, state: "used_up" });
      const raised = await adjust(item, 2, 200_000, "a1");
      if (!raised.ok) throw new Error("adjust failed");
      expect(raised.value.item).toMatchObject({ qtyLeftMilli: 200_000, state: "active" });

      // The item has cost its whole price already: what the check found is free.
      const free = await take(item, 3, 150_000, null, "u2", 0);
      expect(free.ok).toBe(true);
      const short = await repo.undoMove({ owner: me, move: raised.value.move, expectedVersion: 4, reversal: { id: asUuid(randomUUID()), actor: "usr_rahul", idemKey: "undo-1", now: NOW } });
      expect(short).toEqual({ ok: false, error: { kind: "insufficient_stock", qtyLeftMilli: 50_000 } });

      const second = newItem();
      await repo.createItem({ item: second });
      await take(second, 1, 1_000_000, null, "u1");
      const more = await adjust(second, 2, 200_000, "a1");
      if (!more.ok) throw new Error("adjust failed");
      const undone = await repo.undoMove({ owner: me, move: more.value.move, expectedVersion: 3, reversal: { id: asUuid(randomUUID()), actor: "usr_rahul", idemKey: "undo-2", now: NOW } });
      expect(undone.ok && undone.value.move).toMatchObject({ kind: "reversal", reverses: more.value.move.id, qtyMilli: 200_000, costMinor: 0, via: null });
      // Emptied again: finished as its last take left it.
      expect(await read(second.id)).toMatchObject({ qtyLeftMilli: 0, costTakenMinor: 6000, state: "used_up", version: 4 });
    });
  });
});
