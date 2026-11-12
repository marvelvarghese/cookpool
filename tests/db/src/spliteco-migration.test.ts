import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createSplitecoRepository, type NewSplitecoTxn } from "@saas/db/spliteco";
import { D1ApiAdapter } from "@saas/db/runner";

// cookpool-spliteco SE-2: 530_spliteco_ledger — made_in and kind on groups;
// app, bucket, category, revises, moved_from, deleted_at, via_delegation and
// split_spec on the ledger; the item, share, adjustment and comment tables;
// and the repository that writes a version and its reversal in one batch.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "530_spliteco_ledger";
const sqlOf = () => readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`), "utf8").replace(/--.*$/gm, "");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

function d1Over(db: DatabaseSync): D1Binding {
  const prepare = (query: string) => {
    let bound: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        bound = values;
        return statement;
      },
      run() {
        return { results: db.prepare(query).all(...(bound as never[])), success: true };
      },
      all() {
        return Promise.resolve(statement.run());
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements: Array<{ run(): unknown }>) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => s.run());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Binding;
}

const ORG = "00000000-0000-4000-8000-000000000001";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function txn(n: number, extra: Partial<NewSplitecoTxn> = {}): NewSplitecoTxn {
  return {
    id: uuid(n),
    orgId: ORG,
    kind: "expense",
    title: "Dinner",
    totalMinor: 1000,
    currency: "INR",
    occurredAt: "2026-11-10T10:00:00.000Z",
    createdBy: "usr_a",
    createdAt: "2026-11-10T10:00:00.000Z",
    note: null,
    idemKey: `k${n}`,
    app: "spliteco",
    bucket: "other",
    category: "food",
    splits: [
      { subjectId: "usr_a", paidMinor: 1000, owedMinor: 500 },
      { subjectId: "usr_b", paidMinor: 0, owedMinor: 500 },
    ],
    ...extra,
  };
}

describe("530_spliteco_ledger (SE-2)", () => {
  it("is registered under kitchen, right after 520, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === ID)!;
    expect(entry).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    expect(entry.checksum).toBe(createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`))).digest("hex"));
    expect(ids.indexOf(ID)).toBe(ids.indexOf("520_identity_passkeys_id_check") + 1);
  });

  it("is additive: columns with defaults and new tables, nothing dropped, updated or deleted", () => {
    const sql = sqlOf();
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT)\b/i);
    expect(sql.match(/ALTER TABLE \w+ ADD COLUMN \w+/g)).toEqual([
      "ALTER TABLE membership_organizations ADD COLUMN made_in",
      "ALTER TABLE membership_organizations ADD COLUMN kind",
      "ALTER TABLE kitchen_txns ADD COLUMN app",
      "ALTER TABLE kitchen_txns ADD COLUMN bucket",
      "ALTER TABLE kitchen_txns ADD COLUMN category",
      "ALTER TABLE kitchen_txns ADD COLUMN revises",
      "ALTER TABLE kitchen_txns ADD COLUMN moved_from",
      "ALTER TABLE kitchen_txns ADD COLUMN deleted_at",
      "ALTER TABLE kitchen_txns ADD COLUMN via_delegation",
      "ALTER TABLE kitchen_txns ADD COLUMN split_spec",
    ]);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual([
      "CREATE TABLE IF NOT EXISTS ledger_txn_items",
      "CREATE TABLE IF NOT EXISTS ledger_txn_item_shares",
      "CREATE TABLE IF NOT EXISTS ledger_txn_adjustments",
      "CREATE TABLE IF NOT EXISTS ledger_comments",
    ]);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    it("reads every existing row as Cookpool's, in the kitchen bucket", () => {
      db.prepare(
        "INSERT INTO membership_organizations (id, name, slug, slug_lower, created_at, updated_at) VALUES (?, 'Flat', 'flat', 'flat', 'x', 'x')",
      ).run(ORG);
      expect(db.prepare("SELECT made_in, kind FROM membership_organizations").get()).toEqual({ made_in: "cookpool", kind: "kitchen" });
      db.prepare("INSERT INTO kitchen_group_settings (org_id, currency, created_at, updated_at) VALUES (?, 'INR', 'x', 'x')").run(ORG);
      db.prepare(
        "INSERT INTO kitchen_txns (id, org_id, kind, title, total_minor, currency, occurred_at, created_by, idem_key) VALUES (?, ?, 'expense', 't', 1, 'INR', 'x', 'usr_a', 'k')",
      ).run(uuid(1), ORG);
      expect(db.prepare("SELECT app, bucket, category, revises FROM kitchen_txns").get()).toEqual({ app: "cookpool", bucket: "kitchen", category: null, revises: null });
      expect(() => db.prepare("UPDATE kitchen_txns SET bucket = 'rent'").run()).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE membership_organizations SET kind = 'club'").run()).toThrow(/CHECK/);
    });

    it("writes a version with its items, reverses it, replaces it once and reads the chain back", async () => {
      const repo = createSplitecoRepository(createSqlExecutor(d1Over(db)));
      const first = txn(1, {
        items: [{ position: 0, name: "Thali", qty: 2, unitMinor: 500, totalMinor: 1000 }],
        shares: [
          { itemPosition: 0, subjectId: "usr_a", mode: "portion", value: 1000 },
          { itemPosition: 0, subjectId: "usr_b", mode: "portion", value: 1000 },
        ],
        adjustments: [],
      });
      expect(await repo.write([first])).toEqual({ ok: true, replayed: false });
      const reversal = txn(2, { kind: "reversal", reverses: first.id, idemKey: "k2:rev", splits: first.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })) });
      const next = txn(3, { revises: first.id, totalMinor: 1000 });
      expect(await repo.write([next, reversal])).toEqual({ ok: true, replayed: false });

      const read = (await repo.getTxn(first.id))!;
      expect(read).toMatchObject({ reversedBy: uuid(2), replacedBy: uuid(3), bucket: "other", app: "spliteco" });
      expect((await repo.getTxn(uuid(3)))!).toMatchObject({ revises: first.id, revisedTotalMinor: 1000, revisedWasDeleted: false });
      expect((await repo.getTxn(uuid(2)))!).toMatchObject({ reversedReplacedBy: uuid(3) });
      const details = await repo.items([first.id]);
      expect(details.items).toHaveLength(1);
      expect(details.shares).toHaveLength(2);

      // A second replacement of the same version is refused by the unique index.
      const again = await repo.write([txn(4, { revises: first.id, idemKey: "k4" })]);
      expect(again).toEqual({ ok: false, error: { kind: "conflict" } });
      // The same key again answers what it posted.
      const replay = await repo.write([txn(5, { idemKey: "k3" })]);
      expect(replay).toMatchObject({ ok: true, replayed: true, existing: { id: uuid(3) } });
      // Splits that do not add up never reach the database.
      expect(await repo.write([txn(6, { totalMinor: 999 })])).toEqual({ ok: false, error: { kind: "invalid", reason: "unbalanced" } });
    });

    it("refuses another currency than the group's", async () => {
      const repo = createSplitecoRepository(createSqlExecutor(d1Over(db)));
      await repo.write([txn(1)]);
      const usd = await repo.write([txn(2, { currency: "USD" })]);
      expect(usd).toEqual({ ok: false, error: { kind: "currency_mismatch", currency: "INR" } });
    });
  });
});
