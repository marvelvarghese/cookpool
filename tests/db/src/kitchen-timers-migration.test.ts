import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createTimersRepository, type NewKitchenTimer, type TimersRepository } from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// Timers that find you (Cookpool GC-3, cookpool-guided design §4, §6):
// 380_kitchen_timers — a cook's timers, the per-minute sweep's claim and the
// purge. Checked as text (additive, kitchen_* only), against a real SQLite
// engine (every manifest migration applied: the rules the table keeps, and
// which index each of the sweep's, the list's and the purge's queries walk),
// and through the timers repository over that engine.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "380_kitchen_timers";

const sqlOf = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

/** A D1 binding over `db`: the subset the SQL executor uses. */
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
  } as unknown as D1Binding;
}

const NOW = new Date("2026-11-08T12:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("380_kitchen_timers (GC-3)", () => {
  it("is registered under kitchen, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    // 370 is GC-2's, whichever lands first.
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 380);
    expect(ids.slice(0, before.length)).toEqual(before);
    expect(ids[before.length]).toBe(ID);
  });

  it("creates one table and three indexes, IF NOT EXISTS, and changes nothing else", () => {
    const sql = sqlOf(ID);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual(["CREATE TABLE IF NOT EXISTS kitchen_timers"]);
    expect(sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/g)).toEqual([
      "CREATE INDEX IF NOT EXISTS kitchen_timers_due_idx",
      "CREATE INDEX IF NOT EXISTS kitchen_timers_user_idx",
      "CREATE INDEX IF NOT EXISTS kitchen_timers_ends_idx",
    ]);
    expect(sql).toMatch(/ON kitchen_timers \(ends_at\) WHERE sent_at IS NULL AND canceled_at IS NULL;/);
    expect(sql).toMatch(/ON kitchen_timers \(user_id, ends_at\) WHERE sent_at IS NULL AND canceled_at IS NULL;/);
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE|INSERT|REFERENCES)\b/i);
    // Every index is on the new table: nothing outside it is touched.
    expect(new Set(sql.match(/\bON \w+/g))).toEqual(new Set(["ON kitchen_timers"]));
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    const insert = (row: Partial<Record<string, string | null>> = {}) => {
      const r = {
        id: "t1",
        user_id: "usr_dev",
        label: "Simmer · step 7",
        body: null,
        url: "/cook/session",
        ends_at: at(600).toISOString(),
        created_at: NOW.toISOString(),
        ...row,
      };
      db.prepare(
        "INSERT INTO kitchen_timers (id, user_id, label, body, url, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(r.id, r.user_id, r.label, r.body, r.url, r.ends_at, r.created_at);
    };

    it("keeps a timer with every column the design names", () => {
      insert({ body: "The oil shows at the edges" });
      const cols = (db.prepare("PRAGMA table_info(kitchen_timers)").all() as Array<{ name: string; notnull: number }>).map(
        (c) => `${c.name}${c.notnull ? "!" : ""}`,
      );
      expect(cols).toEqual(["id", "user_id!", "label!", "body", "url!", "ends_at!", "sent_at", "canceled_at", "created_at!"]);
      expect(db.prepare("SELECT body, sent_at, canceled_at FROM kitchen_timers").get()).toEqual({
        body: "The oil shows at the edges",
        sent_at: null,
        canceled_at: null,
      });
    });

    it.each([
      ["an empty label", { label: "" }],
      ["a 61-character label", { label: "x".repeat(61) }],
      ["an empty body", { body: "" }],
      ["a 121-character body", { body: "x".repeat(121) }],
      ["a url that is not a path", { url: "https://evil.example/x" }],
      ["a protocol-relative url", { url: "//evil.example/x" }],
      ["a url with a backslash", { url: "/\\evil.example" }],
      ["a 201-character url", { url: `/${"x".repeat(200)}` }],
      ["an end before it was set", { ends_at: at(-1).toISOString() }],
      ["no user", { user_id: "" }],
    ])("refuses %s", (_name, row) => {
      expect(() => insert(row)).toThrow(/constraint failed/);
    });

    it("takes a 60-character label, a 120-character body and a 200-character path", () => {
      insert({ label: "x".repeat(60), body: "y".repeat(120), url: `/${"z".repeat(199)}` });
      expect((db.prepare("SELECT COUNT(*) AS n FROM kitchen_timers").get() as { n: number }).n).toBe(1);
    });

    const plan = (query: string) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(" | ");

    it("walks the due index for the sweep, the person's index for their list, and the ends index for the purge", () => {
      expect(
        plan(`SELECT id FROM kitchen_timers WHERE sent_at IS NULL AND canceled_at IS NULL AND ends_at <= '2026-11-08T12:00:00.000Z' ORDER BY ends_at, id LIMIT 200`),
      ).toMatch(/kitchen_timers_due_idx/);
      expect(
        plan(`SELECT id FROM kitchen_timers WHERE user_id = 'usr_dev' AND sent_at IS NULL AND canceled_at IS NULL ORDER BY ends_at, id`),
      ).toMatch(/kitchen_timers_user_idx/);
      expect(plan(`DELETE FROM kitchen_timers WHERE ends_at < '2026-11-07T12:00:00.000Z'`)).toMatch(/kitchen_timers_ends_idx/);
    });
  });

  describe("through the timers repository", () => {
    let db: DatabaseSync;
    let repo: TimersRepository;
    let n: number;
    beforeEach(() => {
      db = migrated();
      repo = createTimersRepository(createSqlExecutor(d1Over(db)));
      n = 0;
    });
    afterEach(() => db.close());

    const timer = (over: Partial<NewKitchenTimer> = {}): NewKitchenTimer => ({
      id: uuid(++n),
      userId: "usr_dev",
      label: `Timer ${n}`,
      body: null,
      url: "/cook/session",
      endsAt: at(600),
      now: NOW,
      maxActive: 10,
      ...over,
    });
    const create = async (over: Partial<NewKitchenTimer> = {}) => {
      const made = await repo.createTimer(timer(over));
      if (!made.ok) throw new Error(JSON.stringify(made.error));
      return made.value;
    };

    it("creates a timer and reads it back as stored", async () => {
      const made = await create({ label: "Rest the dough", body: "Cover it", url: "/recipes/rcp_1/plan", endsAt: at(90) });
      expect(made).toEqual({
        id: uuid(1),
        userId: "usr_dev",
        label: "Rest the dough",
        body: "Cover it",
        url: "/recipes/rcp_1/plan",
        endsAt: at(90),
        sentAt: null,
        canceledAt: null,
        createdAt: NOW,
      });
    });

    it("refuses the eleventh active timer in the insert itself, and counts only active ones", async () => {
      for (let i = 0; i < 10; i++) await create();
      expect(await repo.createTimer(timer())).toEqual({ ok: true, value: null });
      // Someone else is not counted against.
      expect(await create({ userId: "usr_anu" })).not.toBeNull();
      // One cancelled frees a place.
      await repo.cancelTimer({ id: uuid(1), userId: "usr_dev", now: NOW });
      expect(await create()).not.toBeNull();
      expect(await repo.createTimer(timer())).toEqual({ ok: true, value: null });
    });

    it("answers a CHECK the table keeps as invalid, not as a failure", async () => {
      expect(await repo.createTimer(timer({ label: "x".repeat(61) }))).toEqual({
        ok: false,
        error: { kind: "invalid", reason: "timer_out_of_range" },
      });
    });

    it("lists a person's active timers soonest first, never anyone else's", async () => {
      await create({ endsAt: at(900) });
      await create({ endsAt: at(60) });
      await create({ endsAt: at(300), userId: "usr_anu" });
      const gone = await create({ endsAt: at(120) });
      await repo.cancelTimer({ id: gone!.id, userId: "usr_dev", now: NOW });
      const listed = await repo.listActiveTimers("usr_dev", 50);
      expect(listed.ok && listed.value.map((t) => t.id)).toEqual([uuid(2), uuid(1)]);
    });

    it("cancels a person's own timer once, keeps the first cancel, and finds no one else's", async () => {
      const made = await create();
      const first = await repo.cancelTimer({ id: made!.id, userId: "usr_dev", now: at(10) });
      expect(first.ok && first.value?.canceledAt).toEqual(at(10));
      const again = await repo.cancelTimer({ id: made!.id, userId: "usr_dev", now: at(20) });
      expect(again.ok && again.value?.canceledAt).toEqual(at(10));
      expect(await repo.cancelTimer({ id: made!.id, userId: "usr_anu", now: at(30) })).toEqual({ ok: true, value: null });
      expect(await repo.cancelTimer({ id: uuid(99), userId: "usr_dev", now: at(30) })).toEqual({ ok: true, value: null });
    });

    it("claims each due, active timer once, soonest first, at most `limit` a run", async () => {
      await create({ endsAt: at(120) }); // 1: due second
      await create({ endsAt: at(60) }); // 2: due first
      await create({ endsAt: at(600) }); // 3: not yet due
      const cancelled = await create({ endsAt: at(90) }); // 4: cancelled
      await repo.cancelTimer({ id: cancelled!.id, userId: "usr_dev", now: NOW });
      await create({ endsAt: at(180), userId: "usr_anu" }); // 5: someone else's, due

      const claimAt = at(200);
      const first = await repo.claimDueTimers({ now: claimAt, limit: 2 });
      expect(first.ok && first.value.map((t) => [t.id, t.sentAt])).toEqual([
        [uuid(2), claimAt],
        [uuid(1), claimAt],
      ]);
      // An overlapping run claims only what is left; a third, nothing.
      const second = await repo.claimDueTimers({ now: claimAt, limit: 200 });
      expect(second.ok && second.value.map((t) => t.id)).toEqual([uuid(5)]);
      expect(await repo.claimDueTimers({ now: claimAt, limit: 200 })).toEqual({ ok: true, value: [] });
      // A sent timer is no longer active, and cancelling it changes nothing.
      const listed = await repo.listActiveTimers("usr_dev", 50);
      expect(listed.ok && listed.value.map((t) => t.id)).toEqual([uuid(3)]);
      const late = await repo.cancelTimer({ id: uuid(1), userId: "usr_dev", now: at(300) });
      expect(late.ok && late.value).toMatchObject({ sentAt: claimAt, canceledAt: null });
    });

    it("purges every timer that ended before the cut-off, whatever its state", async () => {
      await create({ endsAt: at(60) });
      await create({ endsAt: at(120) });
      await create({ endsAt: at(3600) });
      await repo.claimDueTimers({ now: at(60), limit: 200 });
      await repo.cancelTimer({ id: uuid(2), userId: "usr_dev", now: NOW });
      expect(await repo.purgeTimers(at(121))).toEqual({ ok: true, value: 2 });
      expect((db.prepare("SELECT id FROM kitchen_timers").all() as Array<{ id: string }>).map((r) => r.id)).toEqual([uuid(3)]);
      expect(await repo.purgeTimers(at(121))).toEqual({ ok: true, value: 0 });
    });
  });
});
