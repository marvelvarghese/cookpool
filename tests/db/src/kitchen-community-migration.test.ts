import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asUuid, manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createKitchenRepository, type KitchenRepository } from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// Profiles and following (Cookpool CM-2, cookpool-community design §1):
// 430_kitchen_community — kitchen_profiles, kitchen_follows, kitchen_blocks,
// kitchen_mutes and kitchen_recipes.listed. Checked as text (four tables, one
// column, their indexes and nothing else), against a real SQLite engine (the
// handle's shape, every CHECK, the defaults, listed only on a link recipe),
// and through the kitchen repository over that engine: a profile saved, its
// handle refused when taken or changed too soon, going public accepting
// requests; a follow and the day's limit; a block and the follows both ways
// in one batch; search, popular and saved-from owners leaving blocked people
// out; and listed recipes read by owner and for Explore's Public.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "430_kitchen_community";

const sqlOf = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");

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
const DAY = 24 * 60 * 60 * 1000;
const COOLDOWN = 30 * DAY;
const MEERA = "usr_meera";
const KABIR = "usr_kabir";
const ANU = "usr_anu";

describe("430_kitchen_community (CM-2)", () => {
  it("is registered under kitchen, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 430);
    expect(ids.slice(0, before.length)).toEqual(before);
    expect(ids[before.length]).toBe(ID);
  });

  it("adds four tables, one column and four indexes, and changes nothing else", () => {
    const sql = sqlOf(ID);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS \w+/g)).toEqual([
      "CREATE TABLE IF NOT EXISTS kitchen_profiles",
      "CREATE TABLE IF NOT EXISTS kitchen_follows",
      "CREATE TABLE IF NOT EXISTS kitchen_blocks",
      "CREATE TABLE IF NOT EXISTS kitchen_mutes",
    ]);
    expect(sql.match(/ALTER TABLE \w+ ADD COLUMN \w+/g)).toEqual(["ALTER TABLE kitchen_recipes ADD COLUMN listed"]);
    expect(sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+\s+ON \w+ \([^)]*\)/g)).toEqual([
      "CREATE INDEX IF NOT EXISTS kitchen_follows_followee_idx\n  ON kitchen_follows (followee_id, state, accepted_at)",
      "CREATE INDEX IF NOT EXISTS kitchen_follows_state_idx\n  ON kitchen_follows (state, accepted_at)",
      "CREATE INDEX IF NOT EXISTS kitchen_blocks_blocked_idx\n  ON kitchen_blocks (blocked_id)",
      "CREATE INDEX IF NOT EXISTS kitchen_recipes_listed_idx\n  ON kitchen_recipes (created_at)",
    ]);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT)\b/i);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    afterEach(() => db.close());
    const at = NOW.toISOString();
    const profile = (user: string, handle: string, extra: { name?: string; about?: string | null; privacy?: string } = {}) =>
      db
        .prepare("INSERT INTO kitchen_profiles (user_id, handle, name, about, privacy, handle_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(user, handle, extra.name ?? "Name", extra.about ?? null, extra.privacy ?? "public", at, at, at);

    it("holds a handle's shape, uniqueness, the name and about lengths, and privacy", () => {
      db = migrated();
      for (const [i, handle] of ["abc", "meera_cooks", "m.e.e.r.a", "a".repeat(20), "123"].entries()) profile(`usr_ok${i}`, handle);
      for (const handle of ["ab", "a".repeat(21), "Meera", "meera-cooks", ".meera", "meera.", "mee..ra", "mé"]) {
        expect(() => profile(`usr_${randomUUID()}`, handle)).toThrow(/CHECK constraint failed/);
      }
      expect(() => profile("usr_dup", "abc")).toThrow(/UNIQUE/);
      expect(() => profile("usr_ok0", "other")).toThrow(/UNIQUE|PRIMARY KEY/);
      expect(() => profile("usr_n1", "noname", { name: "" })).toThrow(/CHECK/);
      expect(() => profile("usr_n2", "longname", { name: "x".repeat(41) })).toThrow(/CHECK/);
      expect(() => profile("usr_n3", "longabout", { about: "x".repeat(161) })).toThrow(/CHECK/);
      expect(() => profile("usr_n4", "emptyabout", { about: "" })).toThrow(/CHECK/);
      expect(() => profile("usr_n5", "friends", { privacy: "friends" })).toThrow(/CHECK/);
      db.prepare("INSERT INTO kitchen_profiles (user_id, handle, name, handle_changed_at, created_at, updated_at) VALUES ('usr_d', 'defaults', 'D', ?, ?, ?)").run(at, at, at);
      expect(db.prepare("SELECT privacy, about FROM kitchen_profiles WHERE user_id = 'usr_d'").get()).toEqual({ privacy: "public", about: null });
      // A profile whose handle never changed has no change time.
      db.prepare("INSERT INTO kitchen_profiles (user_id, handle, name, created_at, updated_at) VALUES ('usr_e', 'neverchanged', 'E', ?, ?)").run(at, at);
      expect(db.prepare("SELECT handle_changed_at FROM kitchen_profiles WHERE user_id = 'usr_e'").get()).toEqual({ handle_changed_at: null });
    });

    it("keeps a follow whole: one per pair, never oneself, accepted exactly with its time", () => {
      db = migrated();
      const followRow = db.prepare("INSERT INTO kitchen_follows (follower_id, followee_id, state, created_at, accepted_at) VALUES (?, ?, ?, ?, ?)");
      followRow.run(KABIR, MEERA, "accepted", at, at);
      followRow.run(ANU, MEERA, "requested", at, null);
      expect(() => followRow.run(KABIR, MEERA, "requested", at, null)).toThrow(/UNIQUE|PRIMARY KEY/);
      expect(() => followRow.run(MEERA, MEERA, "accepted", at, at)).toThrow(/CHECK/);
      expect(() => followRow.run(MEERA, KABIR, "accepted", at, null)).toThrow(/CHECK/);
      expect(() => followRow.run(MEERA, KABIR, "requested", at, at)).toThrow(/CHECK/);
      expect(() => followRow.run(MEERA, KABIR, "pending", at, null)).toThrow(/CHECK/);
    });

    it("keeps a block and a mute one per pair, never oneself", () => {
      db = migrated();
      for (const table of ["kitchen_blocks", "kitchen_mutes"]) {
        const row = db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?)`);
        row.run(MEERA, KABIR, at);
        row.run(KABIR, MEERA, at);
        expect(() => row.run(MEERA, KABIR, at)).toThrow(/UNIQUE|PRIMARY KEY/);
        expect(() => row.run(MEERA, MEERA, at)).toThrow(/CHECK/);
      }
    });

    it("reads every recipe there was as unlisted, and lists only a link recipe", () => {
      db = migrated(ID);
      const id = randomUUID();
      db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility) VALUES (?, ?, 'Rajma', 4, 'groups')").run(id, MEERA);
      apply(db, ID);
      expect(db.prepare("SELECT listed FROM kitchen_recipes WHERE id = ?").get(id)).toEqual({ listed: 0 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM kitchen_recipes WHERE listed <> 0").get()).toEqual({ n: 0 });
      expect(() => db.prepare("UPDATE kitchen_recipes SET listed = 1 WHERE id = ?").run(id)).toThrow(/CHECK/);
      db.prepare("UPDATE kitchen_recipes SET visibility = 'link', link_code = 'abcdefghij', listed = 1 WHERE id = ?").run(id);
      expect(() => db.prepare("UPDATE kitchen_recipes SET listed = 2 WHERE id = ?").run(id)).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE kitchen_recipes SET visibility = 'groups', link_code = NULL WHERE id = ?").run(id)).toThrow(/CHECK/);
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

    const save = (userId: string, handle: string, now = NOW, privacy: "public" | "private" = "public") =>
      repo.saveProfile({ userId, handle, name: `Name of ${handle}`, about: null, privacy, now, handleCooldownMs: COOLDOWN });
    const value = <T>(result: { ok: true; value: T } | { ok: false }): T => {
      if (!result.ok) throw new Error("repository failed");
      return result.value;
    };

    it("saves a profile, refuses a taken handle, makes the first change free and the next wait 30 days", async () => {
      expect(value(await save(MEERA, "meeracoks"))).toMatchObject({ kind: "saved", created: true, profile: { handle: "meeracoks", handleChangedAt: null } });
      expect(value(await save(KABIR, "meeracoks"))).toEqual({ kind: "handle_taken" });
      // The first change — a typo fixed — goes through at once, and starts the 30 days.
      expect(value(await save(MEERA, "meeracooks"))).toMatchObject({ kind: "saved", created: false, profile: { handle: "meeracooks", handleChangedAt: NOW } });
      const later = new Date(NOW.getTime() + DAY);
      expect(value(await save(MEERA, "meera", later))).toEqual({ kind: "handle_too_soon", nextChangeAt: new Date(NOW.getTime() + COOLDOWN) });
      expect(value(await save(MEERA, "meeracooks", later))).toMatchObject({ kind: "saved", created: false, profile: { handleChangedAt: NOW } });
      const month = new Date(NOW.getTime() + COOLDOWN);
      expect(value(await save(MEERA, "meera", month))).toMatchObject({ kind: "saved", profile: { handle: "meera", handleChangedAt: month } });
    });

    it("follows within the day's limit, never across a block, and going public accepts the requests", async () => {
      await save(MEERA, "meera", NOW, "private");
      const input = { followerId: KABIR, followeeId: MEERA, state: "requested" as const, now: NOW, maxPerDay: 2 };
      expect(value(await repo.follow(input))).toMatchObject({ kind: "followed", follow: { state: "requested", acceptedAt: null } });
      expect(value(await repo.follow(input))).toMatchObject({ kind: "existing" });
      expect(value(await repo.follow({ ...input, followeeId: "usr_x", state: "accepted" }))).toMatchObject({ kind: "followed" });
      expect(value(await repo.follow({ ...input, followeeId: "usr_y" }))).toEqual({ kind: "limited" });
      expect(value(await repo.follow({ ...input, followeeId: "usr_y", now: new Date(NOW.getTime() + DAY) }))).toMatchObject({ kind: "followed" });

      await repo.block({ blockerId: "usr_z", blockedId: KABIR, now: NOW, maxPerDay: 50 });
      expect(value(await repo.follow({ ...input, followeeId: "usr_z", maxPerDay: 100 }))).toEqual({ kind: "blocked" });

      await save(MEERA, "meera", new Date(NOW.getTime() + 2 * DAY), "public");
      expect(value(await repo.getFollow(KABIR, MEERA))).toMatchObject({ state: "accepted" });
    });

    it("blocks with the follows both ways in one batch, within the day's limit", async () => {
      const f = { state: "accepted" as const, now: NOW, maxPerDay: 200 };
      await repo.follow({ ...f, followerId: KABIR, followeeId: MEERA });
      await repo.follow({ ...f, followerId: MEERA, followeeId: KABIR });
      await repo.follow({ ...f, followerId: ANU, followeeId: MEERA });
      expect(value(await repo.block({ blockerId: MEERA, blockedId: KABIR, now: NOW, maxPerDay: 1 }))).toEqual({ kind: "blocked" });
      expect(db.prepare("SELECT follower_id, followee_id FROM kitchen_follows").all()).toEqual([{ follower_id: ANU, followee_id: MEERA }]);
      expect(value(await repo.block({ blockerId: MEERA, blockedId: KABIR, now: NOW, maxPerDay: 1 }))).toEqual({ kind: "existing" });
      expect(value(await repo.block({ blockerId: MEERA, blockedId: ANU, now: NOW, maxPerDay: 1 }))).toEqual({ kind: "limited" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM kitchen_follows").get()).toEqual({ n: 1 });
      expect(value(await repo.isBlockedEither(KABIR, MEERA))).toBe(true);
    });

    it("searches, suggests popular people, and reads listed recipes, leaving blocked people out", async () => {
      await save(MEERA, "meeracooks");
      await save(KABIR, "kabir");
      await save(ANU, "anu_secret", NOW, "private");
      const search = async (viewer: string, handle: string, name: string | null) =>
        value(await repo.searchProfiles({ viewer, handle, name, limit: 20 })).map((p) => p.handle);
      expect(await search(KABIR, "meera", "meera")).toEqual(["meeracooks"]);
      expect(await search(KABIR, "anu", "anu")).toEqual([]);
      expect(await search(KABIR, "anu_secret", null)).toEqual(["anu_secret"]);

      const f = { state: "accepted" as const, now: NOW, maxPerDay: 200 };
      await repo.follow({ ...f, followerId: ANU, followeeId: MEERA });
      expect(value(await repo.popularProfiles({ viewer: KABIR, limit: 10, since: new Date(NOW.getTime() - DAY) })).map((p) => [p.profile.handle, p.newFollowers])).toEqual([["meeracooks", 1]]);

      const recipeId = asUuid(randomUUID());
      db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility, link_code, listed) VALUES (?, ?, 'Rajma', 4, 'link', 'abcdefghij', 1)").run(recipeId, MEERA);
      const copy = randomUUID();
      db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility, source_recipe_id, source_owner_id) VALUES (?, ?, 'Rajma', 4, 'only_me', ?, ?)").run(copy, KABIR, recipeId, MEERA);
      expect(value(await repo.recipeOwnersSavedBy({ viewer: KABIR, limit: 10 })).map((o) => [o.profile.handle, o.recipeName])).toEqual([["meeracooks", "Rajma"]]);
      const listed = (q: Parameters<KitchenRepository["listRecipes"]>[0]) => repo.listRecipes(q).then((r) => value(r).map((x) => [x.name, x.listed]));
      expect(await listed({ viewer: KABIR, publicListed: true, q: null, kind: null, limit: 10 })).toEqual([["Rajma", true]]);
      expect(await listed({ viewer: MEERA, publicListed: true, q: null, kind: null, limit: 10 })).toEqual([]);
      expect(await listed({ viewer: KABIR, listedBy: [MEERA], q: null, kind: null, limit: 10 })).toEqual([["Rajma", true]]);

      await repo.block({ blockerId: MEERA, blockedId: KABIR, now: NOW, maxPerDay: 50 });
      expect(await search(KABIR, "meera", "meera")).toEqual([]);
      expect(value(await repo.popularProfiles({ viewer: KABIR, limit: 10, since: new Date(NOW.getTime() - DAY) }))).toEqual([]);
      expect(value(await repo.recipeOwnersSavedBy({ viewer: KABIR, limit: 10 }))).toEqual([]);
      expect(await listed({ viewer: KABIR, publicListed: true, q: null, kind: null, limit: 10 })).toEqual([]);
    });

    it("lists a recipe by making it a link one, and unlists it when the link goes", async () => {
      const id = asUuid(randomUUID());
      db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility) VALUES (?, ?, 'Rajma', 4, 'only_me')").run(id, MEERA);
      const listed = value(await repo.updateRecipe({ recipeId: id, ownerId: MEERA, changes: { listed: true, newLinkCode: "abcdefghij" }, now: NOW }));
      expect(listed).toMatchObject({ visibility: "link", linkCode: "abcdefghij", listed: true });
      const unlinked = value(await repo.setRecipeLink(id, MEERA, null, NOW));
      expect(unlinked).toMatchObject({ visibility: "groups", linkCode: null, listed: false });
      await repo.updateRecipe({ recipeId: id, ownerId: MEERA, changes: { listed: true, newLinkCode: "bcdefghijk" }, now: NOW });
      const groups = value(await repo.updateRecipe({ recipeId: id, ownerId: MEERA, changes: { visibility: "groups" }, now: NOW }));
      expect(groups).toMatchObject({ visibility: "groups", listed: false });
    });
  });
});
