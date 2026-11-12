import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import {
  createSplitecoLiveRepository,
  createSplitecoRepository,
  liveLockStatement,
  type NewSplitecoTxn,
  type SplitecoLiveSessionRecord,
} from "@saas/db/spliteco";
import { D1ApiAdapter } from "@saas/db/runner";

// cookpool-spliteco SE-5: 550_spliteco_live_split — ledger_live_sessions (an
// itemized draft with a join code), ledger_live_claims (who had which item)
// and ledger_live_presence (who last read it); claims are guarded by the
// session being open and unexpired, and the lock is one batch with the
// expense it posts.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "550_spliteco_live_split";
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
const NOW = "2026-11-12T20:00:00.000Z";
const LATER = "2026-11-13T20:00:00.000Z";
const audit = (n: number, type = "spliteco.live.opened") => ({
  event: {
    id: `evt${n}`,
    type,
    version: 1,
    source: "spliteco-worker",
    occurredAt: new Date(NOW),
    actorType: "user",
    actorId: "usr_a",
    orgId: ORG,
    subjectKind: "ledger_live_session",
    subjectId: "lvs_1",
    requestId: "req_1",
    payload: {},
  },
  audit: { id: `aud${n}`, category: "spliteco", description: "Live split" },
});
const session = (over: Partial<SplitecoLiveSessionRecord> = {}): SplitecoLiveSessionRecord => ({
  id: `lvs_${"1".padStart(32, "0")}`,
  orgId: ORG,
  code: "KTCH2345",
  draft: JSON.stringify({ title: "Dinner", payers: [], items: [{ name: "Naan", totalMinor: 300 }], adjustments: [] }),
  state: "open",
  createdBy: "usr_a",
  createdAt: NOW,
  expiresAt: LATER,
  txnId: null,
  lockedAt: null,
  ...over,
});

describe("550_spliteco_live_split (SE-5)", () => {
  it("is registered under kitchen, right after 540, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === ID)!;
    expect(entry).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    expect(entry.checksum).toBe(createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`))).digest("hex"));
    expect(ids.indexOf(ID)).toBe(ids.indexOf("540_spliteco_settle_up") + 1);
  });

  it("is additive: three new tables, nothing altered, dropped or written", () => {
    const sql = sqlOf();
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT|ALTER)\b/i);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual([
      "CREATE TABLE IF NOT EXISTS ledger_live_sessions",
      "CREATE TABLE IF NOT EXISTS ledger_live_claims",
      "CREATE TABLE IF NOT EXISTS ledger_live_presence",
    ]);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    it("keeps sessions and claims well formed", () => {
      const insert = (id: string, code: string, draft = "{}", state = "open") =>
        db.prepare("INSERT INTO ledger_live_sessions (id, org_id, code, draft, state, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'usr_a', 'x', 'y')").run(id, ORG, code, draft, state);
      expect(() => insert("x", "KTCH2345")).toThrow(/CHECK/);
      expect(() => insert("lvs_1", "KTCH")).toThrow(/CHECK/);
      expect(() => insert("lvs_1", "KTCH2345", "not json")).toThrow(/CHECK/);
      expect(() => insert("lvs_1", "KTCH2345", "{}", "done")).toThrow(/CHECK/);
      insert("lvs_1", "KTCH2345");
      expect(() => insert("lvs_2", "KTCH2345")).toThrow(/UNIQUE/);
      const claim = (mode: string, value: number, session = "lvs_1") =>
        db.prepare("INSERT INTO ledger_live_claims VALUES (?, 0, 'usr_a', ?, ?, 'x')").run(session, mode, value);
      expect(() => claim("half", 1)).toThrow(/CHECK/);
      expect(() => claim("portion", -1)).toThrow(/CHECK/);
      expect(() => claim("portion", 1000, "lvs_9")).toThrow(/FOREIGN KEY/);
      claim("portion", 1000);
      expect(() => claim("pct", 5000)).toThrow(/UNIQUE|PRIMARY/);
    });

    it("opens a session with its claims and audit in one batch, and refuses a code in use", async () => {
      const live = createSplitecoLiveRepository(createSqlExecutor(d1Over(db)));
      const first = [{ itemPosition: 0, subjectId: "usr_a", mode: "portion" as const, value: 1000, updatedAt: NOW }];
      expect(await live.open(session(), first, audit(1))).toEqual({ ok: true });
      expect(await live.open(session({ id: `lvs_${"2".padStart(32, "0")}` }), [], audit(2))).toEqual({ ok: false, reason: "code_taken" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM events_event_log WHERE type = 'spliteco.live.opened'").get()).toEqual({ n: 1 });
      expect(await live.byCode("KTCH2345")).toMatchObject({ state: "open", createdBy: "usr_a", txnId: null });
      expect(await live.claims(session().id)).toEqual(first);
    });

    it("sets, changes and clears claims only while open and unexpired", async () => {
      const live = createSplitecoLiveRepository(createSqlExecutor(d1Over(db)));
      const id = session().id;
      await live.open(session(), [], audit(1));
      const set = (value: number | null, now = NOW) => live.setClaim(id, { itemPosition: 0, subjectId: "usr_b", mode: "portion", value, updatedAt: now }, now);
      expect(await set(1000)).toBe(true);
      expect(await set(2000)).toBe(true);
      expect((await live.claims(id)).map((c) => c.value)).toEqual([2000]);
      expect(await set(null)).toBe(true);
      expect(await live.claims(id)).toEqual([]);
      // Past its 24 hours nothing changes it.
      expect(await set(1000, LATER)).toBe(false);
      expect(await live.claims(id)).toEqual([]);
    });

    it("locks in the expense's own batch; a claim after the lock writes nothing", async () => {
      const exec = createSqlExecutor(d1Over(db));
      const live = createSplitecoLiveRepository(exec);
      const ledger = createSplitecoRepository(exec);
      const id = session().id;
      await live.open(session(), [], audit(1));
      const txn: NewSplitecoTxn = {
        id: "00000000-0000-4000-8000-000000000009",
        orgId: ORG,
        kind: "expense",
        title: "Dinner",
        totalMinor: 300,
        currency: "INR",
        occurredAt: NOW,
        createdBy: "usr_a",
        createdAt: NOW,
        note: null,
        idemKey: `live_${id}`,
        app: "spliteco",
        bucket: "other",
        category: null,
        splits: [{ subjectId: "usr_a", paidMinor: 300, owedMinor: 300 }],
      };
      expect(await ledger.write([txn], audit(2, "spliteco.expense.added"), { audits: [audit(3, "spliteco.live.locked")], statements: [liveLockStatement(id, txn.id, NOW)] })).toEqual({ ok: true, replayed: false });
      expect(await live.byId(id)).toMatchObject({ state: "locked", txnId: txn.id, lockedAt: NOW });
      expect(db.prepare("SELECT type FROM events_event_log ORDER BY rowid").all()).toEqual([
        { type: "spliteco.live.opened" },
        { type: "spliteco.expense.added" },
        { type: "spliteco.live.locked" },
      ]);
      expect(await live.setClaim(id, { itemPosition: 0, subjectId: "usr_b", mode: "portion", value: 1000, updatedAt: NOW }, NOW)).toBe(false);
      // A second lock with the same key replays; it posts nothing more.
      const again = await ledger.write([{ ...txn, id: "00000000-0000-4000-8000-000000000010" }], undefined, { statements: [liveLockStatement(id, "other", NOW)] });
      expect(again).toMatchObject({ ok: true, replayed: true, existing: { id: txn.id } });
      expect(await live.byId(id)).toMatchObject({ txnId: txn.id });
    });

    it("keeps one presence row per person, the newest read", async () => {
      const live = createSplitecoLiveRepository(createSqlExecutor(d1Over(db)));
      const id = session().id;
      await live.open(session(), [], audit(1));
      await live.touch(id, "usr_a", "2026-11-12T20:00:00.000Z");
      await live.touch(id, "usr_b", "2026-11-12T20:00:05.000Z");
      await live.touch(id, "usr_a", "2026-11-12T20:00:08.000Z");
      expect(await live.presence(id, "2026-11-12T20:00:00.000Z")).toEqual([
        { subjectId: "usr_a", seenAt: "2026-11-12T20:00:08.000Z" },
        { subjectId: "usr_b", seenAt: "2026-11-12T20:00:05.000Z" },
      ]);
      expect((await live.presence(id, "2026-11-12T20:00:06.000Z")).map((p) => p.subjectId)).toEqual(["usr_a"]);
    });
  });
});
