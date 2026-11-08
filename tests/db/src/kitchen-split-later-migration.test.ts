import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asUuid, manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import { createKitchenRepository, type KitchenDishRecord, type KitchenRepository } from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// Cooked, then split later (Cookpool CM-8, cookpool-community design §2a):
// 460_kitchen_split_later — kitchen_dishes.split_at and split_dismissed_at.
// Checked as text (two additive columns, nothing else), against a real
// SQLite engine (split_at only on a dish with a group), and through the
// kitchen repository over that engine: the split write (one batch, guarded —
// refusals write nothing), the unsplit dishes Home reminds about, the group
// last cooked for, and dismissing a reminder.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "460_kitchen_split_later";

const sqlOf = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
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
const RAHUL = "usr_rahul";
const FLAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LUNCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A dish row: Rahul's own, a draft of 4 portions, unless told otherwise. */
function insertDish(db: DatabaseSync, over: Partial<{ id: string; cook: string; orgId: string | null; state: string; portionsHalf: number; cookedAt: string; currency: string }> = {}): string {
  const id = over.id ?? randomUUID();
  const state = over.state ?? "draft";
  const at = over.cookedAt ?? NOW.toISOString();
  db.prepare(
    `INSERT INTO kitchen_dishes (id, cook, org_id, name, portions_half, extras_minor, ingredients_minor, total_minor, currency,
       split_mode, state, cooked_at, finalized_at, canceled_at, idem_key, created_at, updated_at)
     VALUES (?, ?, ?, 'Dal', ?, 0, 4000, 4000, ?, 'assign', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, over.cook ?? RAHUL, over.orgId ?? null, over.portionsHalf ?? 8, over.currency ?? "INR", state, at,
    state === "finalized" ? at : null, state === "canceled" ? at : null, `cook-${id}`, at, at,
  );
  return id;
}

function audit(orgId: string, dishId: string): AppendEventWithAuditInput {
  return {
    event: {
      id: randomUUID().replace(/-/g, ""), type: "kitchen.dish.split", version: 1, source: "kitchen-worker", occurredAt: NOW,
      actorType: "user", actorId: RAHUL, orgId, subjectKind: "kitchen_dish", subjectId: dishId, requestId: "req_test",
      idempotencyKey: "split-1", payload: {},
    },
    audit: { id: randomUUID().replace(/-/g, ""), category: "kitchen", description: "split" },
  };
}

describe("460_kitchen_split_later (CM-8)", () => {
  it("is registered under kitchen with its checksum, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 460);
    expect(ids.slice(0, before.length)).toEqual(before);
    expect(ids[before.length]).toBe(ID);
  });

  it("adds two nullable columns to kitchen_dishes, and changes nothing else", () => {
    const sql = sqlOf(ID);
    expect(sql.match(/ALTER TABLE \w+ ADD COLUMN \w+/g)).toEqual([
      "ALTER TABLE kitchen_dishes ADD COLUMN split_at",
      "ALTER TABLE kitchen_dishes ADD COLUMN split_dismissed_at",
    ]);
    expect(sql).toMatch(/ADD COLUMN split_at TEXT CHECK \(split_at IS NULL OR org_id IS NOT NULL\);/);
    expect(sql).toMatch(/ADD COLUMN split_dismissed_at TEXT;/);
    expect(sql).not.toMatch(/\b(CREATE|DROP|UPDATE|DELETE|INSERT|REFERENCES|DEFAULT)\b/i);
  });

  it("keeps split_at only on a dish with a group", () => {
    const db = migrated();
    const own = insertDish(db);
    expect(() => db.prepare("UPDATE kitchen_dishes SET split_at = ? WHERE id = ?").run(NOW.toISOString(), own)).toThrow(/CHECK constraint failed/);
    db.prepare("UPDATE kitchen_dishes SET org_id = ?, split_at = ? WHERE id = ?").run(FLAT, NOW.toISOString(), own);
    expect(db.prepare("SELECT split_at, split_dismissed_at FROM kitchen_dishes").get()).toEqual({ split_at: NOW.toISOString(), split_dismissed_at: null });
  });

  describe("through the kitchen repository", () => {
    let db: DatabaseSync;
    let repo: KitchenRepository;
    beforeEach(() => {
      db = migrated();
      repo = createKitchenRepository(createSqlExecutor(d1Over(db)));
    });

    async function read(id: string): Promise<KitchenDishRecord> {
      const found = await repo.getDish(asUuid(id), { cook: RAHUL, orgIds: [] });
      if (!found.ok) throw new Error("no dish");
      return found.value;
    }
    const events = () => (db.prepare("SELECT COUNT(*) AS n FROM events_event_log").get() as { n: number }).n;

    it("splits the cook's own dish in one batch: the group's currency pinned, the dish open, split_at set, the event written", async () => {
      const id = insertDish(db, { state: "finalized" });
      const later = new Date(NOW.getTime() + 3_600_000);
      const res = await repo.splitDishLater({ dish: await read(id), orgId: FLAT, splitMode: "claims", now: later, audit: audit(FLAT, id) });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value).toMatchObject({
        orgId: FLAT, splitMode: "claims", state: "open", finalizedAt: null, splitAt: later, version: 2, totalMinor: 4000, cookedAt: NOW,
      });
      expect(db.prepare("SELECT currency FROM kitchen_group_settings WHERE org_id = ?").get(FLAT)).toEqual({ currency: "INR" });
      expect(events()).toBe(1);
    });

    it("refuses — writing nothing — a dish in a group, canceled, changed since read, someone else's, or in another currency", async () => {
      const inGroup = await read(insertDish(db, { orgId: FLAT }));
      const canceled = await read(insertDish(db, { state: "canceled" }));
      const moved = await read(insertDish(db));
      db.prepare("UPDATE kitchen_dishes SET version = 2 WHERE id = ?").run(moved.id);
      const dollars = await read(insertDish(db, { currency: "USD" }));
      db.prepare("INSERT INTO kitchen_group_settings (org_id, currency, created_at, updated_at) VALUES (?, 'INR', ?, ?)").run(LUNCH, NOW.toISOString(), NOW.toISOString());
      const theirs = { ...(await read(insertDish(db))), cook: "usr_anu" };

      const cases: Array<[KitchenDishRecord, string, unknown]> = [
        [inGroup, LUNCH, { kind: "conflict", entity: "kitchen_dish_split" }],
        [canceled, FLAT, { kind: "dish_not_open", state: "canceled" }],
        [moved, FLAT, { kind: "stale" }],
        [dollars, LUNCH, { kind: "currency_mismatch", currency: "INR" }],
        [theirs, FLAT, { kind: "not_found" }],
      ];
      const settings = () => db.prepare("SELECT org_id FROM kitchen_group_settings ORDER BY org_id").all();
      const before = { dishes: db.prepare("SELECT * FROM kitchen_dishes ORDER BY id").all(), settings: settings() };
      for (const [dish, orgId, error] of cases) {
        const res = await repo.splitDishLater({ dish, orgId, splitMode: "claims", now: NOW, audit: audit(orgId, dish.id) });
        expect(res).toEqual({ ok: false, error });
      }
      expect({ dishes: db.prepare("SELECT * FROM kitchen_dishes ORDER BY id").all(), settings: settings() }).toEqual(before);
      expect(events()).toBe(0);
    });

    it("lists the cook's own unsplit, live, undismissed recent dishes that took group items or made two servings, newest first", async () => {
      const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
      const big = insertDish(db, { cookedAt: at(1) });
      const small = insertDish(db, { portionsHalf: 3, cookedAt: at(2) });
      const smallFromGroup = insertDish(db, { portionsHalf: 1, cookedAt: at(3) });
      db.prepare(
        `INSERT INTO kitchen_items (id, owner_kind, org_id, name, category, dimension, display_unit, qty_bought_milli, qty_left_milli,
           price_minor, currency, paid_by, bought_on, state, idem_key, created_by)
         VALUES ('i1', 'group', ?, 'Milk', 'Dairy', 'volume', 'L', 1000, 1000, 6000, 'INR', 'usr_anu', '2026-11-08', 'active', 'k1', 'usr_anu')`,
      ).run(FLAT);
      db.prepare(
        `INSERT INTO kitchen_dish_ingredients (dish_id, item_id, position, qty_milli, unit, cost_minor, org_id, paid_by)
         VALUES (?, 'i1', 0, 100, 'L', 600, ?, 'usr_anu')`,
      ).run(smallFromGroup, FLAT);
      const finalized = insertDish(db, { state: "finalized", cookedAt: at(4) });
      insertDish(db, { state: "canceled", cookedAt: at(5) });
      insertDish(db, { orgId: FLAT, cookedAt: at(6) });
      insertDish(db, { cook: "usr_anu", cookedAt: at(7) });
      insertDish(db, { cookedAt: new Date(NOW.getTime() - 8 * 86_400_000).toISOString() });
      const dismissed = insertDish(db, { cookedAt: at(8) });
      expect(await repo.setSplitReminderDismissed(RAHUL, dismissed, NOW)).toEqual({ ok: true, value: { dismissedAt: NOW } });

      const res = await repo.listUnsplitDishes({ cook: RAHUL, since: new Date(NOW.getTime() - 7 * 86_400_000), minPortionsHalf: 4, limit: 10 });
      // Not 1½ portions of the cook's own things, a canceled dish, a group's, Anu's, last week's or a dismissed one.
      expect(res.ok && res.value.map((d) => d.id)).toEqual([finalized, smallFromGroup, big]);
      expect(res.ok && res.value.map((d) => d.id)).not.toContain(small);

      // Undo brings it back; anyone else's dish is not found.
      expect(await repo.setSplitReminderDismissed(RAHUL, dismissed, null)).toEqual({ ok: true, value: { dismissedAt: null } });
      expect(await repo.setSplitReminderDismissed("usr_anu", dismissed, NOW)).toEqual({ ok: false, error: { kind: "not_found" } });
      const back = await repo.listUnsplitDishes({ cook: RAHUL, since: new Date(NOW.getTime() - 7 * 86_400_000), minPortionsHalf: 4, limit: 2 });
      expect(back.ok && back.value.map((d) => d.id)).toEqual([dismissed, finalized]);
    });

    it("finds the group the cook last cooked a dish for, among the groups asked about, never a canceled one", async () => {
      expect(await repo.latestGroupDishOrg(RAHUL, [FLAT, LUNCH])).toEqual({ ok: true, value: null });
      insertDish(db, { orgId: FLAT, cookedAt: "2026-11-01T00:00:00.000Z" });
      insertDish(db, { orgId: LUNCH, cookedAt: "2026-11-02T00:00:00.000Z" });
      insertDish(db, { orgId: FLAT, state: "canceled", cookedAt: "2026-11-03T00:00:00.000Z" });
      expect(await repo.latestGroupDishOrg(RAHUL, [FLAT, LUNCH])).toEqual({ ok: true, value: LUNCH });
      expect(await repo.latestGroupDishOrg(RAHUL, [FLAT])).toEqual({ ok: true, value: FLAT });
      expect(await repo.latestGroupDishOrg(RAHUL, [])).toEqual({ ok: true, value: null });
      expect(await repo.latestGroupDishOrg("usr_anu", [FLAT, LUNCH])).toEqual({ ok: true, value: null });
    });
  });
});
