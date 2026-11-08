import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createKitchenRepository, type KitchenRepository } from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// Posts, Yum, comments, reports and Activity (Cookpool CM-3,
// cookpool-community design §2): 440_kitchen_posts — kitchen_posts,
// kitchen_post_yums, kitchen_post_comments, kitchen_reports and
// kitchen_activity. Checked as text (five tables and their indexes, nothing
// else), against a real SQLite engine (a post's stats hold only the four
// keys, one live post per dish, every CHECK), and through the kitchen
// repository over that engine: who may see a post, the Yum's push slot, the
// comment limit, and Activity never written for oneself or across a block.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "440_kitchen_posts";

const sqlOf = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
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
const at = NOW.toISOString();
const MEERA = "usr_meera";
const KABIR = "usr_kabir";
const ANU = "usr_anu";
const POST = "11111111-1111-4111-8111-111111111111";

describe("440_kitchen_posts (CM-3)", () => {
  it("is registered under kitchen with its checksum, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 440);
    expect(ids.slice(0, before.length)).toEqual(before);
    expect(ids[before.length]).toBe(ID);
  });

  it("adds five tables and their indexes, and changes nothing else", () => {
    const sql = sqlOf(ID);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS \w+/g)).toEqual([
      "CREATE TABLE IF NOT EXISTS kitchen_posts",
      "CREATE TABLE IF NOT EXISTS kitchen_post_yums",
      "CREATE TABLE IF NOT EXISTS kitchen_post_comments",
      "CREATE TABLE IF NOT EXISTS kitchen_reports",
      "CREATE TABLE IF NOT EXISTS kitchen_activity",
    ]);
    expect(sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+\s+ON \w+ \([^)]*\)/g)).toEqual([
      "CREATE UNIQUE INDEX IF NOT EXISTS kitchen_posts_dish_uq\n  ON kitchen_posts (dish_id)",
      "CREATE INDEX IF NOT EXISTS kitchen_posts_author_idx\n  ON kitchen_posts (author_id, created_at)",
      "CREATE INDEX IF NOT EXISTS kitchen_posts_audience_idx\n  ON kitchen_posts (audience, created_at)",
      "CREATE INDEX IF NOT EXISTS kitchen_posts_recipe_idx\n  ON kitchen_posts (recipe_id)",
      "CREATE INDEX IF NOT EXISTS kitchen_post_comments_post_idx\n  ON kitchen_post_comments (post_id, created_at)",
      "CREATE INDEX IF NOT EXISTS kitchen_post_comments_author_idx\n  ON kitchen_post_comments (author_id, created_at)",
      "CREATE INDEX IF NOT EXISTS kitchen_reports_target_idx\n  ON kitchen_reports (target_kind, target_id, state)",
      "CREATE INDEX IF NOT EXISTS kitchen_activity_user_idx\n  ON kitchen_activity (user_id, created_at)",
      "CREATE INDEX IF NOT EXISTS kitchen_activity_unread_idx\n  ON kitchen_activity (user_id, created_at)",
      "CREATE INDEX IF NOT EXISTS kitchen_activity_post_idx\n  ON kitchen_activity (post_id, kind)",
    ]);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT|ALTER)\b/i);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    afterEach(() => db.close());
    const postRow = (id: string, extra: { stats?: string; audience?: string; caption?: string | null; dish?: string | null; deleted?: string | null; title?: string } = {}) =>
      db
        .prepare("INSERT INTO kitchen_posts (id, author_id, dish_id, title, caption, audience, stats, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, MEERA, extra.dish ?? null, extra.title ?? "Chicken curry", extra.caption ?? null, extra.audience ?? "followers", extra.stats ?? "{}", at, extra.deleted ?? null);

    it("holds only size, minutes, ate and steps in a post's stats — never money, a group or people", () => {
      db = migrated();
      postRow("p1", { stats: JSON.stringify({ size: { factorMilli: 1000 }, minutes: 30, ate: 2, steps: { done: 2, total: 3 } }) });
      postRow("p2");
      for (const stats of [{ totalMinor: 400 }, { orgId: "org_1" }, { shares: [] }, { minutes: 3, people: ["usr_a"] }]) {
        expect(() => postRow(`x${Math.random()}`, { stats: JSON.stringify(stats) })).toThrow(/CHECK/);
      }
      for (const stats of ["[]", "3", "not json"]) expect(() => postRow(`y${Math.random()}`, { stats })).toThrow(/CHECK/);
    });

    it("checks the audience, the title and caption lengths, and keeps one live post per dish", () => {
      db = migrated();
      expect(() => postRow("a", { audience: "everyone" })).toThrow(/CHECK/);
      expect(() => postRow("b", { title: "" })).toThrow(/CHECK/);
      expect(() => postRow("c", { title: "x".repeat(61) })).toThrow(/CHECK/);
      expect(() => postRow("d", { caption: "" })).toThrow(/CHECK/);
      expect(() => postRow("e", { caption: "x".repeat(501) })).toThrow(/CHECK/);
      db.exec("PRAGMA foreign_keys = OFF");
      postRow("f", { dish: "dish-1", deleted: at });
      postRow("g", { dish: "dish-1" });
      expect(() => postRow("h", { dish: "dish-1" })).toThrow(/UNIQUE/);
    });

    it("keeps comments, reports and Activity whole", () => {
      db = migrated();
      postRow(POST);
      const comment = db.prepare("INSERT INTO kitchen_post_comments (id, post_id, author_id, body, created_at, deleted_at, deleted_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
      comment.run("c1", POST, KABIR, "Yum", at, null, null);
      expect(() => comment.run("c2", POST, KABIR, "", at, null, null)).toThrow(/CHECK/);
      expect(() => comment.run("c3", POST, KABIR, "x".repeat(501), at, null, null)).toThrow(/CHECK/);
      expect(() => comment.run("c4", POST, KABIR, "Hi", at, at, null)).toThrow(/CHECK/);
      expect(() => comment.run("c5", "no-post", KABIR, "Hi", at, null, null)).toThrow(/FOREIGN KEY/);

      const report = db.prepare("INSERT INTO kitchen_reports (id, reporter_id, target_kind, target_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      report.run("r1", KABIR, "post", POST, "spam", null, at);
      expect(db.prepare("SELECT state FROM kitchen_reports").get()).toEqual({ state: "open" });
      expect(() => report.run("r2", KABIR, "post", POST, "abuse", null, at)).toThrow(/UNIQUE/);
      expect(() => report.run("r3", ANU, "recipe", POST, "spam", null, at)).toThrow(/CHECK/);
      expect(() => report.run("r4", ANU, "post", POST, "boring", null, at)).toThrow(/CHECK/);
      expect(() => report.run("r5", ANU, "post", POST, "spam", "x".repeat(301), at)).toThrow(/CHECK/);

      const activity = db.prepare("INSERT INTO kitchen_activity (id, user_id, kind, actor_id, created_at) VALUES (?, ?, ?, ?, ?)");
      activity.run("a1", MEERA, "followed", KABIR, at);
      expect(() => activity.run("a2", MEERA, "followed", MEERA, at)).toThrow(/CHECK/);
      expect(() => activity.run("a3", MEERA, "liked", KABIR, at)).toThrow(/CHECK/);
    });
  });

  describe("through the kitchen repository", () => {
    let db: DatabaseSync;
    let repo: KitchenRepository;
    beforeEach(() => {
      db = migrated();
      repo = createKitchenRepository(createSqlExecutor(d1Over(db)));
      const profile = db.prepare("INSERT INTO kitchen_profiles (user_id, handle, name, privacy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      profile.run(MEERA, "meeracooks", "Meera K", "public", at, at);
      profile.run(KABIR, "kabir", "Kabir S", "public", at, at);
      profile.run(ANU, "anu", "Anu R", "private", at, at);
    });
    afterEach(() => db.close());
    const post = (id: string, author: string, audience: string) =>
      db.prepare("INSERT INTO kitchen_posts (id, author_id, title, audience, stats, created_at) VALUES (?, ?, 'Dal', ?, '{}', ?)").run(id, author, audience, at);
    const sees = async (id: string, viewer: string) => {
      const found = await repo.getPost(id, viewer);
      if (!found.ok) throw new Error("read failed");
      return found.value !== null;
    };

    it("lets a viewer see a post by the audience rule, a private author's to followers only, nothing across a block", async () => {
      post("pm", MEERA, "me");
      post("pf", MEERA, "followers");
      post("pp", MEERA, "public");
      post("ap", ANU, "public");
      expect([await sees("pm", MEERA), await sees("pm", KABIR)]).toEqual([true, false]);
      expect([await sees("pf", KABIR), await sees("pp", KABIR), await sees("ap", KABIR)]).toEqual([false, true, false]);
      db.prepare("INSERT INTO kitchen_follows (follower_id, followee_id, state, created_at, accepted_at) VALUES (?, ?, 'accepted', ?, ?)").run(KABIR, MEERA, at, at);
      db.prepare("INSERT INTO kitchen_follows (follower_id, followee_id, state, created_at, accepted_at) VALUES (?, ?, 'accepted', ?, ?)").run(KABIR, ANU, at, at);
      expect([await sees("pf", KABIR), await sees("ap", KABIR)]).toEqual([true, true]);
      db.prepare("INSERT INTO kitchen_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(KABIR, MEERA, at);
      expect([await sees("pf", KABIR), await sees("pp", KABIR), await sees("pp", MEERA)]).toEqual([false, false, true]);
    });

    it("claims the Yum push slot once an hour, writes the Activity with the Yum, and none for oneself", async () => {
      post(POST, MEERA, "public");
      const yum = (user: string, now: Date) =>
        repo.yum({
          postId: POST,
          userId: user,
          now,
          pushCutoff: new Date(now.getTime() - 3_600_000),
          activity: { id: `act-${user}-${now.getTime()}`, userId: MEERA, kind: "yum", actorId: user, now },
        });
      expect(await yum(KABIR, NOW)).toEqual({ ok: true, value: { created: true, push: true } });
      expect(await yum(KABIR, new Date(NOW.getTime() + 1000))).toEqual({ ok: true, value: { created: false, push: false } });
      expect(await yum(ANU, new Date(NOW.getTime() + 60_000))).toEqual({ ok: true, value: { created: true, push: false } });
      expect(await yum(MEERA, new Date(NOW.getTime() + 120_000))).toEqual({ ok: true, value: { created: true, push: false } });
      expect(db.prepare("SELECT actor_id FROM kitchen_activity ORDER BY created_at").all()).toEqual([{ actor_id: KABIR }, { actor_id: ANU }]);
      const later = new Date(NOW.getTime() + 3_600_000 + 60_000);
      db.prepare("DELETE FROM kitchen_post_yums WHERE user_id = ?").run(ANU);
      expect(await yum(ANU, later)).toEqual({ ok: true, value: { created: true, push: true } });
    });

    it("refuses a comment past the hour's limit in the insert itself", async () => {
      post(POST, MEERA, "public");
      const add = (i: number) =>
        repo.addComment({
          id: `c${i}`,
          postId: POST,
          authorId: KABIR,
          body: `n${i}`,
          now: new Date(NOW.getTime() + i),
          maxPerHour: 2,
          since: new Date(NOW.getTime() - 3_600_000),
          activity: { id: `a${i}`, userId: MEERA, kind: "comment", actorId: KABIR, now: NOW },
        });
      expect((await add(1)).ok && (await add(2)).ok).toBe(true);
      expect(await add(3)).toEqual({ ok: true, value: { kind: "limited" } });
      expect(db.prepare("SELECT COUNT(*) AS n FROM kitchen_post_comments").get()).toEqual({ n: 2 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM kitchen_activity").get()).toEqual({ n: 2 });
    });
  });
});
