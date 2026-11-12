import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createDelegationsRepository } from "@saas/db/identity";
import { createSplitecoDraftsRepository, createSplitecoRepository, type NewSplitecoTxn, type SplitecoDraftRecord } from "@saas/db/spliteco";
import { D1ApiAdapter } from "@saas/db/runner";

// cookpool-spliteco SE-6: 560_spliteco_assistants (kitchen_txns.via_client and
// ledger_drafts — an assistant's draft, saved only on the person's yes) and
// 570_identity_delegation_access (identity_delegations.granted_scopes — the
// ceiling Look only / Add & edit change within).

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const KITCHEN_ID = "560_spliteco_assistants";
const IDENTITY_ID = "570_identity_delegation_access";
const sqlOf = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");
const checksum = (id: string) => createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`))).digest("hex");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

function d1Over(db: DatabaseSync): D1Binding {
  const prepare = (query: string) => {
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
  };
  return {
    prepare,
    async batch(statements: Array<{ run(): unknown }>) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => s.run());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Binding;
}

const ORG = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-11-12T20:00:00.000Z";
const LATER = "2026-11-12T20:10:00.000Z";
const TOKEN = `drf_${"a".repeat(32)}`;

const draft = (over: Partial<SplitecoDraftRecord> = {}): SplitecoDraftRecord => ({
  id: TOKEN,
  subjectId: "usr_a",
  delegationId: "dlg_1",
  action: "add",
  orgId: ORG,
  txnId: null,
  body: JSON.stringify({ title: "Cruise" }),
  createdAt: NOW,
  expiresAt: LATER,
  savedTxnId: null,
  savedAt: null,
  ...over,
});

const txn = (over: Partial<NewSplitecoTxn> = {}): NewSplitecoTxn => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  orgId: ORG,
  kind: "expense",
  title: "Cruise",
  totalMinor: 1000,
  currency: "INR",
  occurredAt: NOW,
  createdBy: "usr_a",
  createdAt: NOW,
  note: null,
  idemKey: "k1",
  app: "spliteco",
  bucket: "other",
  category: null,
  splits: [
    { subjectId: "usr_a", paidMinor: 1000, owedMinor: 500 },
    { subjectId: "usr_b", paidMinor: 0, owedMinor: 500 },
  ],
  ...over,
});

describe("560_spliteco_assistants (SE-6)", () => {
  it("is registered under kitchen, right after 550, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === KITCHEN_ID)!;
    expect(entry).toMatchObject({ context: "kitchen", path: `${KITCHEN_ID}/up.sql` });
    expect(entry.checksum).toBe(checksum(KITCHEN_ID));
    expect(ids.indexOf(KITCHEN_ID)).toBe(ids.indexOf("550_spliteco_live_split") + 1);
  });

  it("is additive: one nullable column on kitchen_txns and ledger_drafts, nothing dropped or written", () => {
    const sql = sqlOf(KITCHEN_ID);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT)\b/i);
    expect(sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)).toEqual(["ALTER TABLE kitchen_txns ADD COLUMN via_client"]);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual(["CREATE TABLE IF NOT EXISTS ledger_drafts"]);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    it("keeps a draft, and refuses a bad id, action, body or an add naming an expense", async () => {
      const drafts = createSplitecoDraftsRepository(createSqlExecutor(d1Over(db)));
      await drafts.create(draft());
      expect(await drafts.byId(TOKEN)).toEqual(draft());
      await expect(drafts.create(draft({ id: "drf_short" }))).rejects.toThrow();
      await expect(drafts.create(draft({ id: `drf_${"b".repeat(32)}`, action: "pay" as never }))).rejects.toThrow();
      await expect(drafts.create(draft({ id: `drf_${"c".repeat(32)}`, body: "not json" }))).rejects.toThrow();
      await expect(drafts.create(draft({ id: `drf_${"d".repeat(32)}`, txnId: "x" }))).rejects.toThrow();
      await expect(drafts.create(draft({ id: `drf_${"e".repeat(32)}`, action: "edit" }))).rejects.toThrow();
    });

    it("stamps the first save only, and prunes drafts that ended", async () => {
      const drafts = createSplitecoDraftsRepository(createSqlExecutor(d1Over(db)));
      await drafts.create(draft());
      await drafts.markSaved(TOKEN, "txn_1", LATER);
      await drafts.markSaved(TOKEN, "txn_2", LATER);
      expect(await drafts.byId(TOKEN)).toMatchObject({ savedTxnId: "txn_1", savedAt: LATER });
      await drafts.prune("2026-11-13T00:00:00.000Z");
      expect(await drafts.byId(TOKEN)).toBeNull();
    });

    it("writes the assistant's name beside its delegation, and never without one", async () => {
      const repo = createSplitecoRepository(createSqlExecutor(d1Over(db)));
      db.prepare("INSERT INTO kitchen_group_settings (org_id, currency, updated_at) VALUES (?, 'INR', ?)").run(ORG, NOW);
      expect((await repo.write([txn({ viaDelegation: "dlg_1", viaClient: "Claude" })])).ok).toBe(true);
      expect(
        (await repo.write([txn({ id: "00000000-0000-4000-8000-0000000000a2", idemKey: "k2", viaDelegation: null, viaClient: "Claude" })])).ok,
      ).toBe(true);
      const a = await repo.getTxn("00000000-0000-4000-8000-0000000000a1");
      const b = await repo.getTxn("00000000-0000-4000-8000-0000000000a2");
      expect([a?.viaDelegation, a?.viaClient]).toEqual(["dlg_1", "Claude"]);
      expect([b?.viaDelegation, b?.viaClient]).toEqual([null, null]);
      expect(() => db.prepare("UPDATE kitchen_txns SET via_client = ? WHERE idem_key = 'k1'").run("x".repeat(81))).toThrow(/CHECK constraint failed/);
    });
  });
});

describe("570_identity_delegation_access (SE-6)", () => {
  it("is registered under identity, right after 560, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === IDENTITY_ID)!;
    expect(entry).toMatchObject({ context: "identity", path: `${IDENTITY_ID}/up.sql` });
    expect(entry.checksum).toBe(checksum(IDENTITY_ID));
    expect(ids.indexOf(IDENTITY_ID)).toBe(ids.indexOf(KITCHEN_ID) + 1);
  });

  it("is additive: one nullable column, nothing else", () => {
    const sql = sqlOf(IDENTITY_ID);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT|CREATE)\b/i);
    expect(sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)).toEqual(["ALTER TABLE identity_delegations ADD COLUMN granted_scopes"]);
  });

  describe("through the delegations repository", () => {
    const USER = "00000000-0000-4000-8000-000000000900";
    const OTHER = "00000000-0000-4000-8000-000000000901";
    const ID = "00000000-0000-4000-8000-000000000001";
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
      for (const [id, email] of [
        [USER, "anu@cookpool.test"],
        [OTHER, "meera@cookpool.test"],
      ]) {
        db.prepare("INSERT INTO identity_users (id, email, email_lower) VALUES (?, ?, ?)").run(id!, email!, email!);
      }
    });
    afterEach(() => db.close());

    it("stores what was allowed at connect, and changes scopes within it, only for its own live user", async () => {
      const repo = createDelegationsRepository(createSqlExecutor(d1Over(db)));
      const now = new Date(NOW);
      const made = await repo.create({
        id: ID,
        userId: USER,
        clientName: "Claude",
        clientId: "cli",
        scopes: ["money.read", "money.write"],
        tokenHash: "h",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
      });
      expect(made.ok && made.value.grantedScopes).toEqual(["money.read", "money.write"]);
      const narrowed = await repo.updateScopes(ID, USER, ["money.read"], now);
      expect(narrowed.ok && [narrowed.value.scopes, narrowed.value.grantedScopes]).toEqual([["money.read"], ["money.read", "money.write"]]);
      expect((await repo.updateScopes(ID, OTHER, ["money.read"], now)).ok).toBe(false);
      expect((await repo.updateScopes(ID, USER, ["money.read"], new Date(now.getTime() + 2 * 86_400_000))).ok).toBe(false);
    });

    it("reads a row from before 570 (granted_scopes NULL) as allowing what it has", async () => {
      db.prepare(
        `INSERT INTO identity_delegations (id, user_id, client_name, client_id, scopes, token_hash, created_at, expires_at)
         VALUES (?, ?, 'Claude', 'cli', '["money.read"]', 'h', ?, ?)`,
      ).run(ID, USER, NOW, LATER);
      const repo = createDelegationsRepository(createSqlExecutor(d1Over(db)));
      const found = await repo.getById(ID);
      expect(found.ok && found.value.grantedScopes).toEqual(["money.read"]);
      const updated = await repo.updateScopes(ID, USER, ["money.read"], new Date(NOW));
      // The first change pins the ceiling to what it had.
      expect(updated.ok && updated.value.grantedScopes).toEqual(["money.read"]);
      expect(() => db.prepare("UPDATE identity_delegations SET granted_scopes = 'x'").run()).toThrow(/CHECK constraint failed/);
    });
  });
});
