import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { PAYMENT_SOURCE_KIND, createSplitecoRepository, type NewSplitecoTxn } from "@saas/db/spliteco";
import { D1ApiAdapter } from "@saas/db/runner";

// cookpool-spliteco SE-3: 540_spliteco_settle_up — ledger_reminders (at most one
// per pair per 24 hours), spliteco_profiles (UPI IDs) and spliteco_group_settings
// (simplify debts), and the repository reads and writes over them; payments stay
// kitchen_txns settlements, one row per bucket, read back by their payment id.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "540_spliteco_settle_up";
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
const audit = (n: number) => ({
  event: {
    id: `evt${n}`,
    type: "spliteco.reminder.sent",
    version: 1,
    source: "spliteco-worker",
    occurredAt: new Date("2026-11-12T09:00:00.000Z"),
    actorType: "user",
    actorId: "usr_a",
    orgId: ORG,
    subjectKind: "ledger_reminder",
    subjectId: `rmd_${n}`,
    requestId: "req_1",
    payload: {},
  },
  audit: { id: `aud${n}`, category: "spliteco", description: "Reminder" },
});
const reminder = (n: number, sentAt: string) => ({
  id: `rmd_${String(n).padStart(32, "0")}`,
  orgId: ORG,
  fromSubject: "usr_a",
  toSubject: "usr_b",
  amountMinor: 62000,
  currency: "INR",
  sentAt,
});

describe("540_spliteco_settle_up (SE-3)", () => {
  it("is registered under kitchen, right after 530, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === ID)!;
    expect(entry).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    expect(entry.checksum).toBe(createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`))).digest("hex"));
    expect(ids.indexOf(ID)).toBe(ids.indexOf("530_spliteco_ledger") + 1);
  });

  it("is additive: three new tables, nothing altered, dropped or written", () => {
    const sql = sqlOf();
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT|ALTER)\b/i);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual([
      "CREATE TABLE IF NOT EXISTS ledger_reminders",
      "CREATE TABLE IF NOT EXISTS spliteco_profiles",
      "CREATE TABLE IF NOT EXISTS spliteco_group_settings",
    ]);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    it("keeps reminders, profiles and switches well formed", () => {
      expect(() => db.prepare("INSERT INTO ledger_reminders VALUES ('x', ?, 'usr_a', 'usr_b', 1, 'INR', 'x')").run(ORG)).toThrow(/CHECK/);
      expect(() => db.prepare("INSERT INTO ledger_reminders VALUES ('rmd_1', ?, 'usr_a', 'usr_a', 1, 'INR', 'x')").run(ORG)).toThrow(/CHECK/);
      expect(() => db.prepare("INSERT INTO ledger_reminders VALUES ('rmd_1', ?, 'usr_a', 'usr_b', 0, 'INR', 'x')").run(ORG)).toThrow(/CHECK/);
      expect(() => db.prepare("INSERT INTO spliteco_profiles (subject_id, upi_vpa, updated_at) VALUES ('usr_a', 'nobank', 'x')").run()).toThrow(/CHECK/);
      expect(() => db.prepare("INSERT INTO spliteco_group_settings (org_id, simplify_debts, updated_by, updated_at) VALUES (?, 2, 'usr_a', 'x')").run(ORG)).toThrow(/CHECK/);
      db.prepare("INSERT INTO spliteco_profiles (subject_id, upi_vpa, updated_at) VALUES ('usr_a', 'anu@okaxis', 'x')").run();
      expect(db.prepare("SELECT default_currency FROM spliteco_profiles").get()).toEqual({ default_currency: "INR" });
    });

    it("reads and writes profiles and a group's switches, defaults first", async () => {
      const repo = createSplitecoRepository(createSqlExecutor(d1Over(db)));
      expect((await repo.groupSettings([ORG])).get(ORG)).toEqual({ orgId: ORG, simplifyDebts: true });
      await repo.setGroupSettings({ orgId: ORG, simplifyDebts: false }, "usr_a", "2026-11-12T09:00:00.000Z");
      expect((await repo.groupSettings([ORG])).get(ORG)).toEqual({ orgId: ORG, simplifyDebts: false });
      // Switching it never pins the group's currency.
      expect(db.prepare("SELECT COUNT(*) AS n FROM kitchen_group_settings").get()).toEqual({ n: 0 });

      expect((await repo.profiles(["usr_a"])).size).toBe(0);
      await repo.setProfile({ subjectId: "usr_a", upiVpa: "anu@okaxis", defaultCurrency: "INR", updatedAt: "x" });
      await repo.setProfile({ subjectId: "usr_a", upiVpa: "anu@ybl", defaultCurrency: "INR", updatedAt: "y" });
      expect((await repo.profiles(["usr_a", "usr_b"])).get("usr_a")).toMatchObject({ upiVpa: "anu@ybl", updatedAt: "y" });
    });

    it("records a reminder with its audit event, at most once per pair in the window", async () => {
      const repo = createSplitecoRepository(createSqlExecutor(d1Over(db)));
      expect(await repo.addReminder(reminder(1, "2026-11-12T09:00:00.000Z"), "2026-11-11T09:00:00.000Z", audit(1))).toEqual({ ok: true });
      const refused = await repo.addReminder(reminder(2, "2026-11-13T08:00:00.000Z"), "2026-11-12T08:00:00.000Z", audit(2));
      expect(refused).toMatchObject({ ok: false, last: { id: reminder(1, "").id, sentAt: "2026-11-12T09:00:00.000Z" } });
      expect(db.prepare("SELECT COUNT(*) AS n FROM events_event_log WHERE type = 'spliteco.reminder.sent'").get()).toEqual({ n: 1 });
      expect(await repo.addReminder(reminder(3, "2026-11-13T09:00:01.000Z"), "2026-11-12T09:00:01.000Z", audit(3))).toEqual({ ok: true });
      expect((await repo.lastReminders("usr_a", ["usr_b", "usr_c"])).get("usr_b")).toMatchObject({ id: reminder(3, "").id });
      expect((await repo.lastReminders("usr_b", ["usr_a"])).size).toBe(0);
    });

    it("reads a payment's rows back by its id", async () => {
      const repo = createSplitecoRepository(createSqlExecutor(d1Over(db)));
      const part = (n: number, bucket: "kitchen" | "other", amount: number): NewSplitecoTxn => ({
        id: uuid(n),
        orgId: ORG,
        kind: "settlement",
        title: "Payment",
        totalMinor: amount,
        currency: "INR",
        occurredAt: "2026-11-12T09:00:00.000Z",
        createdBy: "usr_b",
        createdAt: "2026-11-12T09:00:00.000Z",
        note: null,
        idemKey: `k${n}`,
        app: "spliteco",
        bucket,
        category: null,
        method: "upi",
        sourceKind: PAYMENT_SOURCE_KIND,
        sourceId: uuid(1),
        splits: [
          { subjectId: "usr_b", paidMinor: amount, owedMinor: 0 },
          { subjectId: "usr_a", paidMinor: 0, owedMinor: amount },
        ],
      });
      expect(await repo.write([part(1, "kitchen", 300), part(2, "other", 200)])).toEqual({ ok: true, replayed: false });
      const rows = await repo.paymentRows(ORG, uuid(1));
      expect(rows.map((r) => [r.bucket, r.totalMinor, r.method])).toEqual([
        ["kitchen", 300, "upi"],
        ["other", 200, "upi"],
      ]);
    });
  });
});
