import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createHandoffRepository, type HandoffRepository } from "@saas/db/identity";
import { D1ApiAdapter } from "@saas/db/runner";

// One tap from Cookpool into Spliteco (cookpool-spliteco SE-4):
// 580_identity_handoff_codes. Checked as text (one new table, two indexes,
// nothing else), against a real SQLite engine with every manifest migration
// applied, and through the handoff repository: bound to one origin, 60
// seconds, used once — and two racing exchanges cannot both win.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "580_identity_handoff_codes";

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

const NOW = new Date("2026-11-12T09:00:00.000Z");
const USER = "00000000-0000-4000-8000-000000000900";
const SPLITECO = "https://cookpool-spliteco-web-stage.cookpool.workers.dev";

describe("580_identity_handoff_codes (SE-4)", () => {
  let db: DatabaseSync;
  let repo: HandoffRepository;

  beforeEach(() => {
    db = migrated();
    db.prepare("INSERT INTO identity_users (id, email, email_lower) VALUES (?, ?, ?)").run(USER, "anu@cookpool.test", "anu@cookpool.test");
    repo = createHandoffRepository(createSqlExecutor(d1Over(db)));
  });
  afterEach(() => db.close());

  const make = (hash = "h1", expiresIn = 60_000) =>
    repo.create({ id: `hof_${"a".repeat(31)}${hash.length}`, userId: USER, codeHash: hash, targetOrigin: SPLITECO, createdAt: NOW, expiresAt: new Date(NOW.getTime() + expiresIn) });

  it("is registered under identity, right after 570, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === ID);
    expect(entry).toMatchObject({ context: "identity", path: `${ID}/up.sql` });
    expect(entry!.checksum).toBe(createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`))).digest("hex"));
    expect(ids.indexOf(ID)).toBe(ids.indexOf("570_identity_delegation_access") + 1);
  });

  it("adds one table and its indexes, stores only the code's hash, and changes nothing else", () => {
    const sql = sqlOf();
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual(["CREATE TABLE IF NOT EXISTS identity_handoff_codes"]);
    expect(sql.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)).toEqual([
      "CREATE UNIQUE INDEX IF NOT EXISTS identity_handoff_codes_hash_uq",
      "CREATE INDEX IF NOT EXISTS identity_handoff_codes_user_idx",
    ]);
    expect(sql).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|INSERT)\b/i);
    expect(sql).toMatch(/code_hash\s+TEXT NOT NULL/);
    expect(sql).not.toMatch(/\bcode\s+TEXT/);
    expect(raw()).toMatch(/^-- column identity_handoff_codes\.code_hash: .*Raw value never stored/m);
  });

  it("is taken once, from its own origin, inside its 60 seconds", async () => {
    await make();
    expect(await repo.consume("h1", "https://evil.example", NOW)).toEqual({ ok: false, reason: "wrong_origin" });
    const first = await repo.consume("h1", SPLITECO, new Date(NOW.getTime() + 59_000));
    expect(first.ok && first.code).toMatchObject({ userId: USER, targetOrigin: SPLITECO });
    expect(await repo.consume("h1", SPLITECO, new Date(NOW.getTime() + 59_500))).toEqual({ ok: false, reason: "used" });
    expect(await repo.consume("nope", SPLITECO, NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("is refused at 60 seconds and after", async () => {
    await make("h2");
    expect(await repo.consume("h2", SPLITECO, new Date(NOW.getTime() + 60_000))).toEqual({ ok: false, reason: "expired" });
  });

  it("lets only one of two racing exchanges win", async () => {
    await make("h3");
    const results = await Promise.all([repo.consume("h3", SPLITECO, NOW), repo.consume("h3", SPLITECO, NOW)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("refuses a second code with the same hash, and records the session minted", async () => {
    const code = await make("h4");
    await expect(make("h4")).rejects.toThrow();
    await repo.attachSession(code.id, "ses-1");
    await repo.attachSession(code.id, "ses-2");
    expect(db.prepare("SELECT session_id FROM identity_handoff_codes WHERE id = ?").get(code.id)).toEqual({ session_id: "ses-1" });
  });
});
