import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { boughtStatement, createKitchenRepository, defaultStapleId, type KitchenRepository } from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";
import { likePatternsOver } from "./d1-sqlite.js";

// Always have per pantry and the shopping list (Cookpool RV-21):
// 600_kitchen_staples — kitchen_staples and kitchen_shopping_items, and every
// saved personal Always have list copied in. Checked as text (additive: two
// tables, two indexes, one copy), against a real SQLite engine (the copy, a
// rerun that adds nothing twice, the CHECKs), and through the kitchen
// repository over it: the default list written out under fixed ids, Always
// have read from and written to staples, a Bought's update in a money batch.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "600_kitchen_staples";

const raw = () => readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`), "utf8");
const sqlOf = () => raw().replace(/--.*$/gm, "");
const statements = (sql: string) => D1ApiAdapter.splitStatements(sql);

function migratedUpTo(stop: string | null): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    if (m.id === stop) break;
    for (const s of statements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(s);
  }
  return db;
}

function apply(db: DatabaseSync): void {
  for (const s of statements(raw())) db.exec(s);
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
    async batch(list: Array<{ all(): Promise<unknown> }>) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const s of list) results.push(await s.all());
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Binding;
}

const repoOver = (db: DatabaseSync): KitchenRepository => createKitchenRepository(createSqlExecutor(d1Over(db)));
const NOW = new Date("2026-11-13T08:00:00.000Z");
const RAHUL = "usr_rahul";
const ANU = "usr_anu";
const FLAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("600_kitchen_staples (RV-21)", () => {
  it("is registered under kitchen with its checksum, after 590", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    expect(ids.indexOf(ID)).toBe(ids.indexOf("590_kitchen_no_starter_recipes") + 1);
  });

  it("is additive: two tables, two unique indexes and one copy, nothing altered or dropped, no LIKE or GLOB", () => {
    const sql = sqlOf();
    expect(sql.match(/CREATE TABLE IF NOT EXISTS \w+/g)).toEqual(["CREATE TABLE IF NOT EXISTS kitchen_staples", "CREATE TABLE IF NOT EXISTS kitchen_shopping_items"]);
    expect(sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS \w+/g)).toHaveLength(2);
    expect(sql.match(/INSERT OR IGNORE INTO \w+/g)).toEqual(["INSERT OR IGNORE INTO kitchen_staples"]);
    expect(sql).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE)\b/);
    expect(sql).not.toMatch(/\b(LIKE|GLOB)\b/);
    expect(raw()).toMatch(/^-- column kitchen_staples\.status: /m);
    const db = migratedUpTo(null);
    expect(likePatternsOver(db)).toEqual([]);
  });

  it("copies every saved personal list as staples (the food's name, ok), and a rerun adds nothing twice", () => {
    const db = migratedUpTo(ID);
    db.exec(`INSERT INTO kitchen_always_have_lists (user_id, updated_at) VALUES ('${RAHUL}', '2026-11-01T00:00:00.000Z'), ('${ANU}', '2026-11-01T00:00:00.000Z')`);
    db.exec(`INSERT INTO kitchen_always_have (user_id, food_key, created_at) VALUES ('${RAHUL}', 'salt', '2026-11-01T00:00:00.000Z'), ('${RAHUL}', 'sugar', '2026-11-02T00:00:00.000Z')`);
    apply(db);
    const rows = () =>
      db.prepare("SELECT id, owner_kind, owner_id, name, name_key, food_key, status, created_at FROM kitchen_staples ORDER BY name_key").all() as Array<Record<string, string>>;
    const first = rows();
    expect(first.map((r) => [r.owner_kind, r.owner_id, r.name, r.name_key, r.food_key, r.status, r.created_at])).toEqual([
      ["user", RAHUL, "Salt", "salt", "salt", "ok", "2026-11-01T00:00:00.000Z"],
      ["user", RAHUL, "Sugar", "sugar", "sugar", "ok", "2026-11-02T00:00:00.000Z"],
    ]);
    for (const r of first) expect(r.id).toMatch(UUID_RE);
    apply(db);
    expect(rows()).toEqual(first);
    // Anu saved an empty list: still empty, and the old tables are untouched.
    expect((db.prepare("SELECT count(*) AS n FROM kitchen_always_have").get() as { n: number }).n).toBe(2);
  });

  it("holds one name per pantry and refuses a status, amount or owner kind out of range", () => {
    const db = migratedUpTo(null);
    const ins = (over: Partial<Record<string, unknown>> = {}) =>
      db
        .prepare(
          `INSERT INTO kitchen_staples (id, owner_kind, owner_id, name, name_key, status, want_qty_milli, created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'u', 'now', 'u', 'now')`,
        )
        .run(randomUUID(), (over.kind as string) ?? "group", FLAT, "Tea", (over.key as string) ?? "tea", (over.status as string) ?? "ok", (over.want as number | null) ?? null);
    ins();
    expect(() => ins()).toThrow(/UNIQUE/);
    expect(() => ins({ key: "tea2", status: "gone" })).toThrow(/CHECK/);
    expect(() => ins({ key: "tea3", want: 0 })).toThrow(/CHECK/);
    expect(() => ins({ key: "tea4", kind: "org" })).toThrow(/CHECK/);
    ins({ kind: "user", key: "tea" });
  });

  it("through the repository: the default list written out under fixed ids, Always have kept in staples", async () => {
    const db = migratedUpTo(null);
    const repo = repoOver(db);
    expect(await repo.getAlwaysHave(RAHUL)).toEqual({ ok: true, value: { foodKeys: ["salt", "water"], isSet: false } });
    expect(await repo.personalListSet(RAHUL)).toEqual({ ok: true, value: false });
    await repo.seedPersonal(RAHUL, NOW);
    await repo.seedPersonal(RAHUL, NOW);
    const staples = await repo.listStaples([{ kind: "user", id: RAHUL }]);
    expect(staples.ok && staples.value.map((s) => [s.id, s.name, s.foodKey])).toEqual([
      [await defaultStapleId(RAHUL, "salt"), "Salt", "salt"],
      [await defaultStapleId(RAHUL, "water"), "Water", "water"],
    ]);
    expect(await defaultStapleId(RAHUL, "salt")).toMatch(UUID_RE);
    expect(await defaultStapleId(RAHUL, "salt")).not.toBe(await defaultStapleId(ANU, "salt"));
    // A free name, then the PUT: only food-linked staples are the list; a same-named free one takes the food.
    await repo.addStaple({ owner: { kind: "user", id: RAHUL }, id: randomUUID(), name: "Sugar", foodKey: null, actor: RAHUL, now: NOW });
    await repo.addStaple({ owner: { kind: "user", id: RAHUL }, id: randomUUID(), name: "Dish soap", foodKey: null, actor: RAHUL, now: NOW });
    expect(await repo.setAlwaysHave(RAHUL, ["salt", "sugar"], NOW)).toEqual({ ok: true, value: { foodKeys: ["salt", "sugar"], isSet: true } });
    const after = await repo.listStaples([{ kind: "user", id: RAHUL }]);
    expect(after.ok && after.value.map((s) => [s.name, s.foodKey])).toEqual([
      ["Dish soap", null],
      ["Salt", "salt"],
      ["Sugar", "sugar"],
    ]);
  });

  it("a Bought's update rides in the money batch: back to ok with the price, amount and expense", async () => {
    const db = migratedUpTo(null);
    const repo = repoOver(db);
    const owner = { kind: "group" as const, id: FLAT };
    const id = randomUUID();
    await repo.addStaple({ owner, id, name: "Tea", foodKey: null, actor: ANU, now: NOW });
    await repo.updateStaple({ owner, id, patch: { status: "out", want: { qtyMilli: 500_000, unit: "g" } }, actor: ANU, now: NOW });
    const txnId = randomUUID();
    const s = boughtStatement({ owner, id, bought: { priceMinor: 18000, currency: "INR", qtyMilli: 250_000, unit: "g", txnId }, actor: RAHUL, now: NOW });
    db.prepare(s.text.replace(/\$(\d+)/g, "?$1")).all(...((s.params ?? []).map((p) => (p instanceof Date ? p.toISOString() : p)) as never[]));
    const got = await repo.getStaple(owner, id);
    expect(got.ok && got.value).toMatchObject({ status: "ok", lastPriceMinor: 18000, currency: "INR", lastQtyMilli: 250_000, lastUnit: "g", wantQtyMilli: null, lastTxnId: txnId, updatedBy: RAHUL });
  });

  it("before 600 has run (a worker serving first), Always have reads and writes the old list", async () => {
    const db = migratedUpTo(ID);
    const repo = repoOver(db);
    expect(await repo.getAlwaysHave(RAHUL)).toEqual({ ok: true, value: { foodKeys: ["salt", "water"], isSet: false } });
    expect(await repo.setAlwaysHave(RAHUL, ["sugar", "salt"], NOW)).toEqual({ ok: true, value: { foodKeys: ["salt", "sugar"], isSet: true } });
    expect(await repo.getAlwaysHave(RAHUL)).toEqual({ ok: true, value: { foodKeys: ["salt", "sugar"], isSet: true } });
    expect(await repo.setAlwaysHave(RAHUL, ["saffron_threads"], NOW)).toEqual({ ok: false, error: { kind: "invalid", reason: "unknown_food" } });
    // The staple reads are a plain failure (the routes answer 503), never a crash.
    expect((await repo.listStaples([{ kind: "user", id: RAHUL }])).ok).toBe(false);
    expect((await repo.seedPersonal(RAHUL, NOW)).ok).toBe(false);
    // Then 600 runs: the saved list is copied in and read from staples.
    apply(db);
    expect(await repo.getAlwaysHave(RAHUL)).toEqual({ ok: true, value: { foodKeys: ["salt", "sugar"], isSet: true } });
  });
});
