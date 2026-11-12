import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createPasskeysRepository, type CreatePasskeyInput, type PasskeysRepository } from "@saas/db/identity";
import { D1ApiAdapter } from "@saas/db/runner";

// Passkeys (cookpool-passkeys PK-2): 510_identity_passkeys. Checked as text
// (two new tables and two indexes, nothing else), against a real SQLite engine
// with every manifest migration applied, and through the passkeys repository:
// the limit counted in the insert, a challenge used once and only in time,
// and a sign count moved only from the value it was read at.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "510_identity_passkeys";

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

const NOW = new Date("2026-11-12T12:00:00.000Z");
const MIN = 60 * 1000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pky = (n: number) => `pky_${n.toString(16).padStart(16, "0")}`;
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

describe("510_identity_passkeys (PK-2)", () => {
  it("is registered under identity, right after 490, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === ID);
    expect(entry).toMatchObject({ context: "identity", path: `${ID}/up.sql` });
    expect(entry!.checksum).toBe(createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`))).digest("hex"));
    expect(ids.indexOf(ID)).toBe(ids.indexOf("490_identity_delegations") + 1);
  });

  it("adds two tables and two indexes, and changes nothing else", () => {
    const sql = sqlOf();
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual([
      "CREATE TABLE IF NOT EXISTS identity_passkeys",
      "CREATE TABLE IF NOT EXISTS identity_passkey_challenges",
    ]);
    expect(sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/g)).toEqual([
      "CREATE INDEX IF NOT EXISTS identity_passkeys_user_idx",
      "CREATE INDEX IF NOT EXISTS identity_passkey_challenges_expires_idx",
    ]);
    expect(sql).toMatch(/ON identity_passkeys \(user_id\);/);
    expect(sql).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|INSERT)\b/i);
    // Public keys only: nothing that could hold a private key.
    expect(sql).not.toMatch(/private|secret/i);
    expect(raw()).toMatch(/^-- table identity_passkeys: .*Public keys only/m);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
      seedUsers(db);
    });
    afterEach(() => db.close());

    const insert = (over: Record<string, string | number> = {}) => {
      const row = {
        id: pky(1),
        user_id: USER,
        credential_id: "cred1",
        public_key: "pk",
        transports: '["internal"]',
        aaguid: "00000000-0000-0000-0000-000000000000",
        device_name: "iPhone",
        backed_up: 1,
        created_at: NOW.toISOString(),
        ...over,
      };
      db.prepare(
        `INSERT INTO identity_passkeys (id, user_id, credential_id, public_key, transports, aaguid, device_name, backed_up, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.user_id, row.credential_id, row.public_key, row.transports, row.aaguid, row.device_name, row.backed_up, row.created_at);
    };

    it("takes a well-formed passkey with sign_count 0 and last_used_at unset", () => {
      insert();
      expect(db.prepare("SELECT sign_count, last_used_at FROM identity_passkeys").get()).toEqual({ sign_count: 0, last_used_at: null });
    });

    it("refuses a bad id, device name, transports, backed_up, a duplicate credential and an unknown user", () => {
      expect(() => insert({ id: "pky_123" })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ id: "pky_ABCDEF0123456789" })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ device_name: "" })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ device_name: "x".repeat(61) })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ transports: '"internal"' })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ backed_up: 2 })).toThrow(/CHECK constraint failed/);
      expect(() => insert({ user_id: uuid(999) })).toThrow(/FOREIGN KEY constraint failed/);
      insert({ device_name: "x".repeat(60) });
      expect(() => insert({ id: pky(2) })).toThrow(/UNIQUE constraint failed: identity_passkeys.credential_id/);
    });

    it("holds a register challenge to its person and a login challenge to nobody", () => {
      const add = (id: string, kind: string, userId: string | null, challenge: string) =>
        db
          .prepare(
            "INSERT INTO identity_passkey_challenges (id, kind, user_id, challenge, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(id, kind, userId, challenge, NOW.toISOString(), new Date(NOW.getTime() + 5 * MIN).toISOString());
      add("c1", "register", USER, "a");
      add("c2", "login", null, "b");
      expect(() => add("c3", "register", null, "c")).toThrow(/CHECK constraint failed/);
      expect(() => add("c4", "login", USER, "d")).toThrow(/CHECK constraint failed/);
      expect(() => add("c5", "signup", USER, "e")).toThrow(/CHECK constraint failed/);
      expect(() => add("c6", "login", null, "a")).toThrow(/UNIQUE constraint failed/);
    });
  });

  describe("through the passkeys repository", () => {
    let db: DatabaseSync;
    let repo: PasskeysRepository;
    beforeEach(() => {
      db = migrated();
      seedUsers(db);
      repo = createPasskeysRepository(createSqlExecutor(d1Over(db)));
    });
    afterEach(() => db.close());

    const input = (n: number, over: Partial<CreatePasskeyInput> = {}): CreatePasskeyInput => ({
      id: pky(n),
      userId: USER,
      credentialId: `cred_${n}`,
      publicKey: `pk_${n}`,
      signCount: 0,
      transports: ["internal", "hybrid"],
      aaguid: "00000000-0000-0000-0000-000000000000",
      deviceName: "iPhone",
      backedUp: true,
      createdAt: new Date(NOW.getTime() + n * 1000),
      limit: 10,
      ...over,
    });

    it("creates and reads back by credential id, transports and flags intact", async () => {
      const made = await repo.create(input(1));
      expect(made.ok && made.value).toMatchObject({ id: pky(1), transports: ["internal", "hybrid"], backedUp: true, lastUsedAt: null });
      const found = await repo.getByCredentialId("cred_1");
      expect(found.ok && found.value.publicKey).toBe("pk_1");
      expect((await repo.getByCredentialId("nope")).ok).toBe(false);
    });

    it("refuses a duplicate credential as `passkey` and the 11th as `passkey_limit`", async () => {
      await repo.create(input(1));
      expect(await repo.create(input(2, { credentialId: "cred_1" }))).toEqual({ ok: false, error: { kind: "conflict", entity: "passkey" } });
      for (let n = 2; n <= 10; n++) expect((await repo.create(input(n))).ok).toBe(true);
      expect(await repo.create(input(11))).toEqual({ ok: false, error: { kind: "conflict", entity: "passkey_limit" } });
      // Someone else's count is their own.
      expect((await repo.create(input(12, { userId: OTHER }))).ok).toBe(true);
      expect((await repo.countForUser(USER)).ok && (await repo.countForUser(USER))).toEqual({ ok: true, value: 10 });
    });

    it("lists a person's passkeys newest first, and removes only their own", async () => {
      await repo.create(input(1));
      await repo.create(input(2));
      await repo.create(input(3, { userId: OTHER }));
      const list = await repo.listForUser(USER);
      expect(list.ok && list.value.map((p) => p.id)).toEqual([pky(2), pky(1)]);
      expect(await repo.remove(pky(1), OTHER)).toEqual({ ok: false, error: { kind: "not_found" } });
      expect((await repo.remove(pky(1), USER)).ok).toBe(true);
      expect((await repo.remove(pky(1), USER)).ok).toBe(false);
    });

    it("moves the sign count only from the value it was read at", async () => {
      await repo.create(input(1));
      const used = await repo.recordUse(pky(1), 0, 4, false, NOW);
      expect(used.ok && used.value).toMatchObject({ signCount: 4, backedUp: false, lastUsedAt: NOW });
      // A second sign-in that read 0 too loses.
      expect(await repo.recordUse(pky(1), 0, 5, true, NOW)).toEqual({ ok: false, error: { kind: "not_found" } });
    });

    it("uses a challenge once, only before it expires, only for its kind and person", async () => {
      const make = (challenge: string, kind: "register" | "login", userId: string | null, at = NOW) =>
        repo.createChallenge({
          id: challenge,
          kind,
          userId,
          challenge,
          createdAt: at,
          expiresAt: new Date(at.getTime() + 5 * MIN),
          pruneBefore: new Date(at.getTime() - 24 * 60 * MIN),
        });
      await make("login1", "login", null);
      await make("reg1", "register", USER);

      expect((await repo.consumeChallenge("login1", "register", USER, NOW)).ok).toBe(false);
      expect((await repo.consumeChallenge("login1", "login", null, NOW)).ok).toBe(true);
      expect((await repo.consumeChallenge("login1", "login", null, NOW)).ok).toBe(false);

      expect((await repo.consumeChallenge("reg1", "register", OTHER, NOW)).ok).toBe(false);
      expect((await repo.consumeChallenge("reg1", "login", null, NOW)).ok).toBe(false);
      expect((await repo.consumeChallenge("reg1", "register", USER, new Date(NOW.getTime() + 5 * MIN))).ok).toBe(false);
      expect((await repo.consumeChallenge("reg1", "register", USER, new Date(NOW.getTime() + 5 * MIN - 1))).ok).toBe(true);
    });

    it("prunes challenges that expired before the cut-off when it makes a new one", async () => {
      const old = new Date(NOW.getTime() - 2 * 24 * 60 * MIN);
      await repo.createChallenge({
        id: "old",
        kind: "login",
        userId: null,
        challenge: "old",
        createdAt: old,
        expiresAt: new Date(old.getTime() + 5 * MIN),
        pruneBefore: new Date(old.getTime() - 24 * 60 * MIN),
      });
      await repo.createChallenge({
        id: "new",
        kind: "login",
        userId: null,
        challenge: "new",
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 5 * MIN),
        pruneBefore: new Date(NOW.getTime() - 24 * 60 * MIN),
      });
      expect(db.prepare("SELECT id FROM identity_passkey_challenges").all()).toEqual([{ id: "new" }]);
    });
  });
});
