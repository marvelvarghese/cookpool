import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createPasskeysRepository, type CreatePasskeyInput } from "@saas/db/identity";
import { D1ApiAdapter } from "@saas/db/runner";
import { enforcesD1PatternLimit, likePatternsOver, openD1Sqlite } from "./d1-sqlite.js";

// 520_identity_passkeys_id_check (Cookpool PK-7). Saving a passkey answered
// 500 on stage: 510's id CHECK was one 132-character GLOB, and D1 refuses any
// LIKE or GLOB pattern over 50 bytes, so every insert into identity_passkeys
// failed there. 520 rebuilds the table with the same rule in short pieces.
// These run on a database with D1's limits (./d1-sqlite.ts).

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "520_identity_passkeys_id_check";
const raw = () => readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`), "utf8");
const sqlOf = () => raw().replace(/--.*$/gm, "");

function apply(db: DatabaseSync, path: string) {
  for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, path), "utf8"))) db.exec(statement);
}

/** Every migration up to and including `lastId`. */
function migratedThrough(lastId: string): DatabaseSync {
  const db = openD1Sqlite();
  for (const m of manifest.migrations) {
    apply(db, m.path);
    if (m.id === lastId) break;
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

const USER = "usr_2b8bc036b19545a4b8b8c47fcf28754c";
const NOW = new Date("2026-11-12T12:00:00.000Z");

// What iPhone Safari's iCloud Keychain sends, as identity-worker stores it.
const iphone = (over: Partial<CreatePasskeyInput> = {}): CreatePasskeyInput => ({
  id: "pky_a10d8306813ffc60",
  userId: USER,
  credentialId: "q83vEjRWeJA0Vni6EjRWeJA0Vng",
  publicKey: "pQECAyYgASFYIJ0",
  signCount: 0,
  transports: ["hybrid", "internal"],
  aaguid: "00000000-0000-0000-0000-000000000000",
  deviceName: "iPhone",
  backedUp: true,
  createdAt: NOW,
  limit: 10,
  ...over,
});

function seedUser(db: DatabaseSync) {
  db.prepare("INSERT INTO identity_users (id, email, email_lower) VALUES (?, ?, ?)").run(USER, "anu@cookpool.test", "anu@cookpool.test");
}

describe("520_identity_passkeys_id_check (PK-7)", () => {
  it("is registered under identity, right after 510, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === ID);
    expect(entry).toMatchObject({ context: "identity", path: `${ID}/up.sql` });
    expect(entry!.checksum).toBe(createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`))).digest("hex"));
    expect(ids.indexOf(ID)).toBe(ids.indexOf("510_identity_passkeys") + 1);
  });

  it("rebuilds identity_passkeys only: create the next table, copy, drop, rename, re-index", () => {
    const sql = sqlOf();
    expect(sql.match(/\b(CREATE TABLE IF NOT EXISTS \w+|INSERT OR IGNORE INTO \w+|DROP TABLE \w+|ALTER TABLE \w+ RENAME TO \w+|CREATE INDEX IF NOT EXISTS \w+)/g)).toEqual([
      "CREATE TABLE IF NOT EXISTS identity_passkeys_next",
      "INSERT OR IGNORE INTO identity_passkeys_next",
      "DROP TABLE identity_passkeys",
      "ALTER TABLE identity_passkeys_next RENAME TO identity_passkeys",
      "CREATE INDEX IF NOT EXISTS identity_passkeys_user_idx",
    ]);
    expect(sql).not.toMatch(/identity_passkey_challenges|private|secret/i);
  });

  it("leaves no LIKE or GLOB pattern over D1's 50 bytes on identity_passkeys (510 had one of 132)", () => {
    const before = migratedThrough("510_identity_passkeys");
    expect(likePatternsOver(before).map((p) => [p.name, p.pattern.length])).toEqual([["identity_passkeys", 132]]);
    before.close();
    const after = migratedThrough(ID);
    expect(likePatternsOver(after)).toEqual([]);
    after.close();
  });

  describe("on a database with D1's limits", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migratedThrough(ID);
      seedUser(db);
    });
    afterEach(() => db.close());

    it("stores the passkey an iPhone saves, through the repository (500 on D1 before 520)", async () => {
      const repo = createPasskeysRepository(createSqlExecutor(d1Over(db)));
      const made = await repo.create(iphone());
      expect(made).toEqual({
        ok: true,
        value: expect.objectContaining({ id: "pky_a10d8306813ffc60", transports: ["hybrid", "internal"], backedUp: true, signCount: 0 }),
      });
      expect((await repo.listForUser(USER)).ok).toBe(true);
    });

    it("keeps 510's id rule: pky_ and 16 lowercase hex, nothing else", () => {
      const insert = (id: string, cred = `cred_${id}`) =>
        db
          .prepare(
            `INSERT INTO identity_passkeys (id, user_id, credential_id, public_key, transports, aaguid, device_name, created_at)
             VALUES (?, ?, ?, 'pk', '[]', '', 'iPhone', ?)`,
          )
          .run(id, USER, cred, NOW.toISOString());
      for (const bad of ["pky_123", "pky_ABCDEF0123456789", "pkx_0123456789abcdef", "pky_0123456789abcdeg", "pky_0123456789abcdef0", "pky_0123456789abcde-", "pky_0123456789abcd%f"]) {
        expect(() => insert(bad)).toThrow(/CHECK constraint failed/);
      }
      insert("pky_0123456789abcdef");
      expect(() => insert("pky_0123456789abcdef", "other")).toThrow(/UNIQUE constraint failed: identity_passkeys.id/);
    });

    it("keeps the other constraints, the foreign key and the user index", () => {
      const repo = createPasskeysRepository(createSqlExecutor(d1Over(db)));
      const row = (over: Record<string, unknown>) => ({ ...iphone(), ...over }) as CreatePasskeyInput;
      return (async () => {
        expect((await repo.create(row({ userId: "usr_00000000000000000000000000000000" }))).ok).toBe(false);
        expect((await repo.create(row({ deviceName: "" }))).ok).toBe(false);
        expect((await repo.create(row({ signCount: -1 }))).ok).toBe(false);
        expect((await repo.create(row({})))).toMatchObject({ ok: true });
        expect(await repo.create(row({ id: "pky_00000000000000ff" }))).toEqual({ ok: false, error: { kind: "conflict", entity: "passkey" } });
        const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'identity_passkeys' AND sql IS NOT NULL").all();
        expect(indexes).toEqual([{ name: "identity_passkeys_user_idx" }]);
      })();
    });
  });

  it("copies every row a 510 table holds", () => {
    // Stage and prod hold none (no insert could succeed on D1), but a database
    // migrated on plain SQLite (no pattern limit) may.
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of manifest.migrations) {
      if (m.id === ID) break;
      apply(db, m.path);
    }
    seedUser(db);
    db.prepare(
      `INSERT INTO identity_passkeys (id, user_id, credential_id, public_key, sign_count, transports, aaguid, device_name, backed_up, created_at, last_used_at)
       VALUES ('pky_00000000000000aa', ?, 'cred', 'pk', 3, '["internal"]', 'aa', 'Mac', 1, ?, ?)`,
    ).run(USER, NOW.toISOString(), NOW.toISOString());
    apply(db, `${ID}/up.sql`);
    expect(db.prepare("SELECT id, sign_count, transports, device_name, backed_up, last_used_at FROM identity_passkeys").all()).toEqual([
      { id: "pky_00000000000000aa", sign_count: 3, transports: '["internal"]', device_name: "Mac", backed_up: 1, last_used_at: NOW.toISOString() },
    ]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'identity_passkeys_next'").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("is what D1 would refuse, where node:sqlite enforces D1's limit", async () => {
    const db = migratedThrough("510_identity_passkeys");
    if (!enforcesD1PatternLimit(db)) {
      // Older node:sqlite ignores `limits`; the schema check above covers it.
      db.close();
      return;
    }
    seedUser(db);
    const repo = createPasskeysRepository(createSqlExecutor(d1Over(db)));
    expect(await repo.create(iphone())).toEqual({ ok: false, error: { kind: "internal", message: "Failed to create passkey" } });
    db.close();
  });
});
