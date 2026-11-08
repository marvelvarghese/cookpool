import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { asUuid } from "@saas/db/ids";
import { createPurchasesRepository, type NewKitchenItem, type PurchasesRepository } from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// Shopping runs (Cookpool PN-3, cookpool-pantry design §6.4):
// 400_kitchen_purchases — kitchen_items.purchase_id and its index. Checked as
// text (additive, kitchen_items only), against a real SQLite engine (every
// manifest migration applied: the column every older item reads as NULL, the
// index the Undo walks), and through the purchases repository over that
// engine: one batch per run, the replay, the Undo, and the restock read's
// plan — the pantries through their own indexes, never a scan of the table.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "400_kitchen_purchases";

const sqlOf = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

/** A D1 binding over `db` with an atomic batch, recording every statement it is sent. */
function d1Over(db: DatabaseSync, sent: Array<{ sql: string; values: unknown[] }>, counts: { batches: number }): D1Binding {
  return {
    prepare(query: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        run() {
          sent.push({ sql: query, values: bound });
          return { results: db.prepare(query).all(...(bound as never[])), success: true };
        },
        all() {
          return Promise.resolve(statement.run());
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): unknown }>) {
      counts.batches += 1;
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.run());
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
const uuid = (n: number) => asUuid(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const FLAT = asUuid("11111111-1111-4111-8111-111111111111");

describe("400_kitchen_purchases (PN-3)", () => {
  it("is registered under kitchen, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    // 410 is PN-4's, whichever lands first.
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 400);
    expect(ids.slice(0, before.length)).toEqual(before);
    expect(ids[before.length]).toBe(ID);
  });

  it("adds one nullable column and one partial index to kitchen_items, and changes nothing else", () => {
    const sql = sqlOf(ID);
    // Additive: no default, so every item written before reads as NULL.
    expect(sql.match(/ALTER TABLE \w+ ADD COLUMN [^;]+;/g)).toEqual(["ALTER TABLE kitchen_items ADD COLUMN purchase_id TEXT;"]);
    expect(sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/g)).toEqual(["CREATE INDEX IF NOT EXISTS kitchen_items_purchase_idx"]);
    expect(sql).toMatch(/ON kitchen_items \(purchase_id\) WHERE purchase_id IS NOT NULL;/);
    expect(sql).not.toMatch(/\b(CREATE TABLE|DROP|UPDATE|DELETE|INSERT|DEFAULT|REFERENCES)\b/i);
    expect(new Set(sql.match(/\b(?:ON|TABLE) \w+/g))).toEqual(new Set(["TABLE kitchen_items", "ON kitchen_items"]));
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    it("reads an item added without a purchase as in none, and finds a purchase's items through its index", () => {
      db.prepare(
        `INSERT INTO kitchen_items (id, owner_kind, owner_subject_id, name, category, dimension, display_unit,
           qty_bought_milli, qty_left_milli, price_minor, currency, paid_by, bought_on, created_by, idem_key)
         VALUES ('i1', 'user', 'usr_rahul', 'Bread', 'Grains', 'count', 'pcs', 1000, 1000, 4500, 'INR', 'usr_rahul', '2026-11-08', 'usr_rahul', 'k1')`,
      ).run();
      const column = (db.prepare("PRAGMA table_info(kitchen_items)").all() as Array<{ name: string; notnull: number; dflt_value: unknown }>).find(
        (c) => c.name === "purchase_id",
      );
      expect(column).toMatchObject({ notnull: 0, dflt_value: null });
      expect(db.prepare("SELECT purchase_id FROM kitchen_items").get()).toEqual({ purchase_id: null });
      const plan = (db.prepare("EXPLAIN QUERY PLAN SELECT id FROM kitchen_items WHERE purchase_id = 'p1' ORDER BY rowid").all() as Array<{ detail: string }>)
        .map((r) => r.detail)
        .join(" | ");
      expect(plan).toMatch(/kitchen_items_purchase_idx \(purchase_id=\?\)/);
    });
  });

  describe("through the purchases repository", () => {
    let db: DatabaseSync;
    let repo: PurchasesRepository;
    let sent: Array<{ sql: string; values: unknown[] }>;
    let counts: { batches: number };
    beforeEach(() => {
      db = migrated();
      sent = [];
      counts = { batches: 0 };
      repo = createPurchasesRepository(createSqlExecutor(d1Over(db, sent, counts)));
    });
    afterEach(() => db.close());

    const item = (n: number, over: Partial<NewKitchenItem> = {}): NewKitchenItem => ({
      id: uuid(n),
      owner: { kind: "user", subjectId: "usr_rahul" },
      name: `Item ${n}`,
      category: "Grains",
      dimension: "count",
      displayUnit: "pcs",
      qtyMilli: 1000,
      priceMinor: 4500,
      currency: "INR",
      paidBy: "usr_rahul",
      boughtOn: "2026-11-08",
      expiresOn: null,
      wastePolicy: null,
      createdBy: "usr_rahul",
      idemKey: `run·${n - 1}`,
      now: NOW,
      purchaseId: uuid(100),
      ...over,
    });
    const run = () => [item(1), item(2, { owner: { kind: "group", orgId: FLAT } }), item(3, { owner: { kind: "group", orgId: FLAT } })];

    it("writes a run in one batch, pinning the group's currency once, and answers a retry with the same purchase", async () => {
      const made = await repo.createPurchase({ purchaseId: uuid(100), items: run(), audits: [] });
      expect(made.ok && made.value.items.map((i) => [i.id, i.orgId])).toEqual([
        [uuid(1), null],
        [uuid(2), FLAT],
        [uuid(3), FLAT],
      ]);
      expect(counts.batches).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM kitchen_group_settings").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT DISTINCT purchase_id FROM kitchen_items").all()).toEqual([{ purchase_id: uuid(100) }]);

      const again = await repo.createPurchase({
        purchaseId: uuid(200),
        items: run().map((i, n) => ({ ...i, id: uuid(10 + n), purchaseId: uuid(200) })),
        audits: [],
      });
      expect(again).toEqual({ ok: true, value: { purchaseId: uuid(100), items: made.ok ? made.value.items : [], replayed: true } });
      expect(db.prepare("SELECT COUNT(*) AS n FROM kitchen_items").get()).toEqual({ n: 3 });
    });

    it("removes only the purchaser's unused items in the pantries given", async () => {
      await repo.createPurchase({ purchaseId: uuid(100), items: run(), audits: [] });
      db.prepare("UPDATE kitchen_items SET qty_left_milli = 500, cost_taken_minor = 2250 WHERE id = ?").run(uuid(2));
      expect(await repo.undoPurchase({ purchaseId: uuid(100), createdBy: "usr_anu", scope: { ownerSubjectId: "usr_anu", orgIds: [FLAT] }, now: NOW })).toEqual({
        ok: true,
        value: [],
      });
      const undone = await repo.undoPurchase({ purchaseId: uuid(100), createdBy: "usr_rahul", scope: { ownerSubjectId: "usr_rahul", orgIds: [FLAT] }, now: NOW });
      expect(undone.ok && undone.value.map((i) => [i.id, i.state]).sort()).toEqual([
        [uuid(1), "removed"],
        [uuid(3), "removed"],
      ]);
      const left = await repo.purchaseItems(uuid(100), "usr_rahul", { ownerSubjectId: "usr_rahul", orgIds: [FLAT] });
      expect(left.ok && left.value.map((i) => [i.id, i.state])).toEqual([
        [uuid(1), "removed"],
        [uuid(2), "active"],
        [uuid(3), "removed"],
      ]);
    });

    it("reads restock in one statement: the pantries through their own indexes, finishes through the moves' item index", async () => {
      await repo.createPurchase({ purchaseId: uuid(100), items: run(), audits: [] });
      const before = sent.length;
      const found = await repo.restock({
        ownerSubjectId: "usr_rahul",
        orgIds: [FLAT],
        finishedSince: new Date(NOW.getTime() - 7 * 86_400_000),
        boughtSince: "2026-07-11",
        lowPercent: 20,
        minTimes: 3,
      });
      expect(found).toEqual({ ok: true, value: [] });
      expect(sent.length - before).toBe(1);
      const last = sent[sent.length - 1]!;
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${last.sql}`).all(...(last.values as never[])) as Array<{ detail: string }>).map((r) => r.detail);
      expect(plan.join(" | ")).toMatch(/MULTI-INDEX OR/);
      expect(plan.filter((p) => /^(SCAN|SEARCH) i\b/.test(p))).toEqual([
        expect.stringMatching(/^SEARCH i USING INDEX \w+ \(owner_subject_id=\?\)$/),
        expect.stringMatching(/^SEARCH i USING INDEX \w+ \(org_id=\?\)$/),
      ]);
      expect(plan).toContainEqual(expect.stringMatching(/^SEARCH m USING (COVERING )?INDEX kitchen_stock_moves_item_idx \(item_id=\?\)$/));
    });
  });
});
