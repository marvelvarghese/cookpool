// Web Push in the database (Cookpool PW-5), against a real SQLite engine:
//
//   - 310_notification_push_subscriptions: one row per device (unique https
//     endpoint) for one person, not org-scoped; additive.
//   - 320_notification_push_preferences: the preferences table rebuilt so
//     channel may be 'push', with a `kinds` map — every existing row kept as
//     it was, its unique key and the worker-before-it's SQL still working.
//   - The repositories' SQL: subscriptions upserted by endpoint (renewed,
//     moved to a new person), capped per person, removed only by their own
//     person; preference kinds merged key by key with json_patch.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { asUuid } from "@saas/db/ids";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createNotificationsRepository, createPushSubscriptionsRepository } from "@saas/db/notifications";
import { D1ApiAdapter } from "@saas/db/runner";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");

/** Apply one migration, by its manifest id. */
function apply(db: DatabaseSync, id: string): void {
  const migration = manifest.migrations.find((m) => m.id === id);
  if (!migration) throw new Error(`no migration ${id}`);
  const sql = readFileSync(join(MIGRATIONS_ROOT, migration.path), "utf8");
  for (const statement of D1ApiAdapter.splitStatements(sql)) db.exec(statement);
}

/** Every migration up to (not including) `before`, or all of them. */
function migrated(before?: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    if (before && m.id >= before) break;
    apply(db, m.id);
  }
  return db;
}

function d1Over(db: DatabaseSync): D1Binding {
  return {
    prepare(query: string) {
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
    },
    async batch(statements: Array<{ run(): unknown }>) {
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

const sqlOf = (id: string) => readFileSync(join(MIGRATIONS_ROOT, id, "up.sql"), "utf8").replace(/--.*$/gm, "");
const GROUP = asUuid("11111111-1111-4111-8111-111111111111");
const SYSTEM = asUuid("00000000-0000-0000-0000-000000000000");

describe("the push migrations", () => {
  it("are notifications' 310 and 320, right after 300", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const after = ids.indexOf("300_kitchen_measures") + 1;
    // The two right after 300; later epics' migrations (330 onwards) follow them.
    expect(ids.slice(after, after + 2)).toEqual([
      "310_notification_push_subscriptions",
      "320_notification_push_preferences",
    ]);
    for (const id of ids.slice(after, after + 2)) expect(manifest.migrations.find((m) => m.id === id)!.context).toBe("notifications");
  });

  it("310 adds one table: a unique https endpoint per row, for one person, no org", () => {
    const sql = sqlOf("310_notification_push_subscriptions");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS notifications_push_subscriptions \(/);
    expect(sql).toMatch(/endpoint\s+TEXT NOT NULL UNIQUE CHECK \(endpoint LIKE 'https:\/\/%' AND length\(endpoint\) <= 2048\)/);
    for (const column of ["subject_id", "p256dh", "auth", "created_at", "updated_at"]) {
      expect(sql).toMatch(new RegExp(`${column}\\s+TEXT NOT NULL`));
    }
    for (const column of ["user_agent", "last_success_at", "last_failure_at", "last_failure_reason"]) {
      expect(sql).toMatch(new RegExp(`${column}\\s+TEXT[ ,\\n]`));
    }
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS notifications_push_subscriptions_subject_idx\s+ON notifications_push_subscriptions \(subject_id, updated_at\)/);
    expect(sql).not.toMatch(/org_id/);
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE)\b/i);
  });

  it("320 rebuilds the preferences table: every row kept with kinds '{}', push allowed, the unique key kept", () => {
    const db = migrated("320_notification_push_preferences");
    const insert = db.prepare(
      `INSERT INTO notifications_notification_preferences (id, org_id, subject_kind, subject_id, channel, categories, created_at, updated_at)
       VALUES (?, ?, 'user', ?, 'email', ?, '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`,
    );
    insert.run("pref_anu", GROUP, "usr_anu", JSON.stringify({ product: false }));
    insert.run("pref_dev", SYSTEM, "usr_dev", JSON.stringify({}));
    expect(() =>
      db.prepare(`INSERT INTO notifications_notification_preferences (id, org_id, subject_kind, subject_id, channel) VALUES ('x', ?, 'user', 'u', 'push')`).run(GROUP),
    ).toThrow(/CHECK/);

    apply(db, "320_notification_push_preferences");

    expect(db.prepare("SELECT id, org_id, subject_kind, subject_id, channel, categories, kinds, created_at, updated_at FROM notifications_notification_preferences ORDER BY id").all()).toEqual([
      { id: "pref_anu", org_id: GROUP, subject_kind: "user", subject_id: "usr_anu", channel: "email", categories: '{"product":false}', kinds: "{}", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z" },
      { id: "pref_dev", org_id: SYSTEM, subject_kind: "user", subject_id: "usr_dev", channel: "email", categories: "{}", kinds: "{}", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z" },
    ]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).not.toContain("notifications_notification_preferences_next");
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications_notification_preferences'").all() as { name: string }[]).map((i) => i.name);
    expect(indexes).toContain("notification_prefs_org_idx");

    // Push is a channel now; anything else still is not; one row per org, subject and channel.
    db.prepare(`INSERT INTO notifications_notification_preferences (id, org_id, subject_kind, subject_id, channel, kinds) VALUES ('p', ?, 'user', 'usr_dev', 'push', '{"kitchen.portion_set":true}')`).run(SYSTEM);
    expect(() => db.prepare(`INSERT INTO notifications_notification_preferences (id, org_id, subject_kind, subject_id, channel) VALUES ('s', ?, 'user', 'usr_dev', 'sms')`).run(SYSTEM)).toThrow(/CHECK/);
    expect(() => db.prepare(`INSERT INTO notifications_notification_preferences (id, org_id, subject_kind, subject_id, channel) VALUES ('q', ?, 'user', 'usr_dev', 'push')`).run(SYSTEM)).toThrow(/UNIQUE/);

    // The worker from before 320 still upserts with its own SQL (no kinds column named).
    db.prepare(
      `INSERT INTO notifications_notification_preferences (id, org_id, subject_kind, subject_id, channel, categories, created_at, updated_at)
       VALUES ('new', ?, 'user', 'usr_anu', 'email', '{"product":true}', 'now', 'now')
       ON CONFLICT (org_id, subject_kind, subject_id, channel) DO UPDATE SET categories = EXCLUDED.categories, updated_at = EXCLUDED.updated_at`,
    ).run(GROUP);
    expect(db.prepare("SELECT id, categories, kinds FROM notifications_notification_preferences WHERE subject_id = 'usr_anu'").all()).toEqual([
      { id: "pref_anu", categories: '{"product":true}', kinds: "{}" },
    ]);
    db.close();
  });

  it("320's copy is safe to repeat until the old table is dropped", () => {
    const db = migrated("320_notification_push_preferences");
    db.prepare(`INSERT INTO notifications_notification_preferences (id, org_id, subject_kind, subject_id, channel) VALUES ('a', ?, 'user', 'u', 'email')`).run(GROUP);
    const [create, copy] = D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, "320_notification_push_preferences/up.sql"), "utf8"));
    // A run that stopped after the copy, then the whole migration again.
    db.exec(create!);
    db.exec(copy!);
    apply(db, "320_notification_push_preferences");
    expect(db.prepare("SELECT id, kinds FROM notifications_notification_preferences").all()).toEqual([{ id: "a", kinds: "{}" }]);
    db.close();
  });
});

describe("push subscriptions in SQLite", () => {
  const T = (s: number) => new Date(Date.parse("2026-11-07T10:00:00.000Z") + s * 1000);
  const device = (n: number | string) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    p256dh: `p256dh-${n}`,
    auth: `auth-${n}`,
  });
  let id = 0;
  const sub = (subjectId: string, n: number | string, at: number, extra: Partial<{ p256dh: string; userAgent: string | null }> = {}) => ({
    id: `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    subjectId,
    ...device(n),
    userAgent: "Chrome on Android",
    now: T(at),
    maxPerSubject: 10,
    ...extra,
  });

  function repos() {
    const db = migrated();
    const executor = createSqlExecutor(d1Over(db));
    return { db, push: createPushSubscriptionsRepository(executor), prefs: createNotificationsRepository(executor) };
  }

  it("upserts by endpoint: renewed keeps when it began and forgets a failure; moved starts afresh for its new person", async () => {
    const { push, db } = repos();
    const first = await push.upsert(sub("usr_dev", 1, 0));
    expect(first).toMatchObject({ ok: true, value: { dropped: 0, subscription: { subjectId: "usr_dev", createdAt: T(0), lastSuccessAt: null } } });
    const subId = first.ok ? first.value.subscription.id : "";
    await push.recordSuccess(subId, T(5));
    await push.recordFailure(subId, T(6), "push_service_429");

    const renewed = await push.upsert(sub("usr_dev", 1, 10, { p256dh: "p256dh-renewed" }));
    expect(renewed.ok && renewed.value.subscription).toMatchObject({
      id: subId, subjectId: "usr_dev", p256dh: "p256dh-renewed", createdAt: T(0), updatedAt: T(10),
      lastSuccessAt: T(5), lastFailureAt: null, lastFailureReason: null,
    });

    const moved = await push.upsert(sub("usr_anu", 1, 20, { userAgent: null }));
    expect(moved.ok && moved.value.subscription).toMatchObject({
      id: subId, subjectId: "usr_anu", createdAt: T(20), lastSuccessAt: null, userAgent: null,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications_push_subscriptions").get()).toEqual({ n: 1 });
    expect(await push.listForSubject("usr_dev")).toEqual({ ok: true, value: [] });
  });

  it("keeps ten a person: the eleventh drops the least recently subscribed, never the one just subscribed", async () => {
    const { push } = repos();
    for (let n = 0; n < 10; n++) expect((await push.upsert(sub("usr_dev", n, n))).ok).toBe(true);
    await push.upsert(sub("usr_anu", "anu", 0));
    const eleventh = await push.upsert(sub("usr_dev", 10, 100));
    expect(eleventh.ok && eleventh.value.dropped).toBe(1);
    const mine = await push.listForSubject("usr_dev");
    const endpoints = mine.ok ? mine.value.map((s) => s.endpoint) : [];
    expect(endpoints).toHaveLength(10);
    expect(endpoints[0]).toBe(device(10).endpoint);
    expect(endpoints).not.toContain(device(0).endpoint);
    // Re-subscribing at the same moment as another still keeps the one just subscribed.
    const tie = await push.upsert(sub("usr_dev", 11, 100));
    expect(tie.ok && tie.value.dropped).toBe(1);
    const after = await push.listForSubject("usr_dev");
    expect(after.ok && after.value.map((s) => s.endpoint)).toContain(device(11).endpoint);
    // Anu's device was never counted against Dev's.
    expect((await push.listForSubject("usr_anu")).ok).toBe(true);
    const anus = await push.listForSubject("usr_anu");
    expect(anus.ok && anus.value).toHaveLength(1);
  });

  it("removes a device only for its own person; a gone one by its row", async () => {
    const { push } = repos();
    const dev = await push.upsert(sub("usr_dev", 1, 0));
    await push.upsert(sub("usr_anu", 2, 0));
    expect(await push.deleteForSubject("usr_dev", device(2).endpoint)).toEqual({ ok: true, value: false });
    expect(await push.deleteForSubject("usr_anu", device(2).endpoint)).toEqual({ ok: true, value: true });
    const devId = dev.ok ? dev.value.subscription.id : "";
    expect(await push.deleteGone(devId, device(9).endpoint)).toEqual({ ok: true, value: false });
    expect(await push.deleteGone(devId, device(1).endpoint)).toEqual({ ok: true, value: true });
    expect(await push.listForSubject("usr_dev")).toEqual({ ok: true, value: [] });
  });

  it("refuses what the table never holds: an http endpoint, a long label", async () => {
    const { db } = repos();
    const insert = (endpoint: string, ua: string | null) =>
      db.prepare(
        `INSERT INTO notifications_push_subscriptions (id, subject_id, endpoint, p256dh, auth, user_agent, created_at, updated_at) VALUES (?, 'u', ?, 'k', 'a', ?, 'now', 'now')`,
      ).run(`id-${endpoint}-${ua}`, endpoint, ua);
    expect(() => insert("http://fcm.googleapis.com/x", null)).toThrow(/CHECK/);
    expect(() => insert("https://fcm.googleapis.com/x", "x".repeat(65))).toThrow(/CHECK/);
    insert("https://fcm.googleapis.com/x", null);
    expect(() => insert("https://fcm.googleapis.com/x", "dup")).toThrow(/UNIQUE/);
  });
});

describe("preference kinds in SQLite", () => {
  it("merge key by key on push (null clears one); an email write without kinds leaves them", async () => {
    const db = migrated();
    const prefs = createNotificationsRepository(createSqlExecutor(d1Over(db)));
    const at = new Date("2026-11-07T10:00:00.000Z");
    const put = (channel: string, kinds: Record<string, boolean | null> | undefined, categories: Record<string, boolean | null> = {}) =>
      prefs.upsertPreference({
        id: crypto.randomUUID(),
        orgId: channel === "push" ? SYSTEM : GROUP,
        subjectKind: "user",
        subjectId: "usr_dev",
        channel,
        categories,
        ...(kinds ? { kinds } : {}),
        updatedAt: at,
      });

    expect(await put("push", { "kitchen.portion_set": true })).toMatchObject({ ok: true, value: { channel: "push", kinds: { "kitchen.portion_set": true } } });
    await put("push", { "kitchen.paid_you": true });
    const cleared = await put("push", { "kitchen.portion_set": null, "kitchen.dish_posted": false });
    expect(cleared.ok && cleared.value.kinds).toEqual({ "kitchen.paid_you": true, "kitchen.dish_posted": false });

    await put("email", { "kitchen.portion_set": false }, { product: true });
    const email = await put("email", undefined, { product: false });
    expect(email.ok && email.value).toMatchObject({ categories: { product: false }, kinds: { "kitchen.portion_set": false } });

    const push = await prefs.listPreferences(SYSTEM, "user", "usr_dev", "push");
    expect(push.ok && push.value.map((p) => [p.orgId, p.channel, p.kinds])).toEqual([
      [SYSTEM, "push", { "kitchen.paid_you": true, "kitchen.dish_posted": false }],
    ]);
    const group = await prefs.listPreferences(GROUP, "user", "usr_dev", null);
    expect(group.ok && group.value.map((p) => p.channel)).toEqual(["email"]);
    db.close();
  });
});
