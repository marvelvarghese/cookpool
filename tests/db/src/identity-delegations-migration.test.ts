import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createDelegationsRepository, type CreateDelegationInput, type DelegationsRepository } from "@saas/db/identity";
import { D1ApiAdapter } from "@saas/db/runner";

// Delegated tokens for assistants (cookpool-mcp MC-2): 490_identity_delegations.
// Checked as text (one new table and one index, nothing else), against a real
// SQLite engine with every manifest migration applied, and through the
// delegations repository.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "490_identity_delegations";

const raw = () => readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`), "utf8");
const sqlOf = () => raw().replace(/--.*$/gm, "");

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
  } as unknown as D1Binding;
}

const NOW = new Date("2026-11-09T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = uuid(900);
const OTHER = uuid(901);

function seedUsers(db: DatabaseSync) {
  for (const [id, email] of [
    [USER, "anu@cookpool.test"],
    [OTHER, "meera@cookpool.test"],
  ]) {
    db.prepare("INSERT INTO identity_users (id, email, email_lower) VALUES (?, ?, ?)").run(id!, email!, email!);
  }
}

describe("490_identity_delegations (MC-2)", () => {
  it("is registered under identity, right after 480, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === ID);
    expect(entry).toMatchObject({ context: "identity", path: `${ID}/up.sql` });
    expect(entry!.checksum).toBe(createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`))).digest("hex"));
    expect(ids.indexOf(ID)).toBe(ids.indexOf("480_kitchen_ai_cost") + 1);
  });

  it("adds one table and one index, and changes nothing else", () => {
    const sql = sqlOf();
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual(["CREATE TABLE IF NOT EXISTS identity_delegations"]);
    expect(sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/g)).toEqual(["CREATE INDEX IF NOT EXISTS identity_delegations_user_created_idx"]);
    expect(sql).toMatch(/ON identity_delegations \(user_id, created_at\);/);
    expect(sql).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|INSERT)\b/i);
    // Stored hashed: a token_hash column and nothing that could hold the token.
    expect(sql).toMatch(/token_hash\s+TEXT\s+NOT NULL/);
    expect(sql).not.toMatch(/\btoken\s+TEXT/);
    expect(raw()).toMatch(/^-- table identity_delegations: /m);
    expect(raw()).toMatch(/^-- column identity_delegations\.token_hash: .*Raw token never stored/m);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
      seedUsers(db);
    });
    afterEach(() => db.close());

    const insert = (over: Record<string, string> = {}) => {
      const row = {
        id: uuid(1),
        user_id: USER,
        client_name: "Claude",
        client_id: "cli_abc",
        scopes: '["kitchen.read"]',
        token_hash: "h",
        created_at: NOW.toISOString(),
        expires_at: new Date(NOW.getTime() + 90 * DAY).toISOString(),
        ...over,
      };
      db.prepare(
        `INSERT INTO identity_delegations (id, user_id, client_name, client_id, scopes, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.user_id, row.client_name, row.client_id, row.scopes, row.token_hash, row.created_at, row.expires_at);
    };

    it("takes a well-formed row with last_used_at and revoked_at unset", () => {
      insert();
      expect(db.prepare("SELECT last_used_at, revoked_at FROM identity_delegations").get()).toEqual({
        last_used_at: null,
        revoked_at: null,
      });
    });

    it("refuses an empty or over-long client name, and a client id over 128", () => {
      expect(() => insert({ client_name: "" })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ client_name: "x".repeat(81) })).toThrow(/CHECK constraint failed/);
      insert({ id: uuid(2), client_name: "x".repeat(80) });
      expect(() => insert({ id: uuid(3), client_id: "c".repeat(129) })).toThrow(/CHECK constraint failed/);
    });

    it("refuses scopes that are not a non-empty JSON array", () => {
      expect(() => insert({ scopes: "[]" })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ scopes: '"kitchen.read"' })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ scopes: "kitchen.read" })).toThrow(/CHECK constraint failed/);
    });

    it("refuses a user who does not exist", () => {
      expect(() => insert({ user_id: uuid(999) })).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  describe("through the delegations repository", () => {
    let db: DatabaseSync;
    let repo: DelegationsRepository;
    beforeEach(() => {
      db = migrated();
      seedUsers(db);
      repo = createDelegationsRepository(createSqlExecutor(d1Over(db)));
    });
    afterEach(() => db.close());

    const input = (n: number, over: Partial<CreateDelegationInput> = {}): CreateDelegationInput => ({
      id: uuid(n),
      userId: USER,
      clientName: "Claude",
      clientId: "cli_abc",
      scopes: ["kitchen.read", "timers.write"],
      tokenHash: `hash_${n}`,
      createdAt: new Date(NOW.getTime() + n * 1000),
      expiresAt: new Date(NOW.getTime() + 90 * DAY),
      ...over,
    });

    it("creates, and reads back by id and token hash with its user", async () => {
      const made = await repo.create(input(1));
      expect(made.ok && made.value).toMatchObject({ id: uuid(1), scopes: ["kitchen.read", "timers.write"], lastUsedAt: null });
      const found = await repo.getWithUserByIdAndTokenHash(uuid(1), "hash_1");
      expect(found.ok && found.value.user.email).toBe("anu@cookpool.test");
      expect(found.ok && found.value.delegation.clientName).toBe("Claude");
      expect((await repo.getWithUserByIdAndTokenHash(uuid(1), "wrong")).ok).toBe(false);
      expect((await repo.create(input(1))).ok).toBe(false);
    });

    it("lists a person's live delegations newest first, not revoked, expired or someone else's", async () => {
      await repo.create(input(1));
      await repo.create(input(2));
      await repo.create(input(3, { expiresAt: new Date(NOW.getTime() - 1) }));
      await repo.create(input(4, { userId: OTHER }));
      await repo.create(input(5));
      await repo.revoke(uuid(5), USER, NOW);
      const list = await repo.listLiveForUser(USER, NOW, 100);
      expect(list.ok && list.value.map((d) => d.id)).toEqual([uuid(2), uuid(1)]);
    });

    it("revokes once, answers the same revocation again, and never someone else's", async () => {
      await repo.create(input(1));
      const first = await repo.revoke(uuid(1), USER, NOW);
      const again = await repo.revoke(uuid(1), USER, new Date(NOW.getTime() + 5000));
      expect(first.ok && first.value.revokedAt).toEqual(NOW);
      expect(again.ok && again.value.revokedAt).toEqual(NOW);
      expect(await repo.revoke(uuid(1), OTHER, NOW)).toEqual({ ok: false, error: { kind: "not_found" } });
    });

    it("rotates a live delegation's hash and expiry, and nothing revoked or expired", async () => {
      await repo.create(input(1));
      const later = new Date(NOW.getTime() + 180 * DAY);
      const rotated = await repo.rotate(uuid(1), "hash_new", later, NOW);
      expect(rotated.ok && rotated.value.expiresAt).toEqual(later);
      expect((await repo.getWithUserByIdAndTokenHash(uuid(1), "hash_1")).ok).toBe(false);
      expect((await repo.getWithUserByIdAndTokenHash(uuid(1), "hash_new")).ok).toBe(true);

      await repo.create(input(2, { expiresAt: new Date(NOW.getTime() - 1) }));
      expect((await repo.rotate(uuid(2), "x", later, NOW)).ok).toBe(false);
      await repo.create(input(3));
      await repo.revoke(uuid(3), USER, NOW);
      expect((await repo.rotate(uuid(3), "x", later, NOW)).ok).toBe(false);
    });

    it("touches last_used_at only when it is unset or at or before the cutoff", async () => {
      await repo.create(input(1));
      expect(await repo.touch(uuid(1), NOW, new Date(NOW.getTime() - 3600_000))).toEqual({ ok: true, value: true });
      const soon = new Date(NOW.getTime() + 60_000);
      expect(await repo.touch(uuid(1), soon, new Date(soon.getTime() - 3600_000))).toEqual({ ok: true, value: false });
      const hourLater = new Date(NOW.getTime() + 3600_000);
      expect(await repo.touch(uuid(1), hourLater, new Date(hourLater.getTime() - 3600_000))).toEqual({ ok: true, value: true });
      const row = await repo.getById(uuid(1));
      expect(row.ok && row.value.lastUsedAt).toEqual(hourLater);
    });
  });
});
