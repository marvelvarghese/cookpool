import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createPasskeysRepository } from "@saas/db/identity";
import { D1ApiAdapter } from "@saas/db/runner";
import type { PasskeyRegisterVerifyResponse } from "@saas/contracts/passkeys";
import { parseUserPublicId } from "../../../apps/identity-worker/src/ids";
import { call, dataOf, passkeyLogin, signIn, signedIn, softAuthenticator, UA_IPHONE, world, type PasskeyWorld } from "./helpers/passkey-world";

// Saving a passkey answered 500 on stage (Cookpool PK-7). The other passkey
// suites use an in-memory fake store; this one runs register and sign-in on
// the real passkeys repository over SQLite with every migration applied and
// D1's rules: foreign keys on, and LIKE/GLOB patterns limited to 50 bytes
// (510's id CHECK was a 132-character GLOB, so every insert failed on D1).
// node:sqlite applies that limit where it supports `limits` (Node 25); the
// schema check in tests/db covers older versions.

interface Sqlite {
  exec(sql: string): void;
  prepare(sql: string): { all(...values: unknown[]): unknown[]; run(...values: unknown[]): unknown };
  close(): void;
}

const MIGRATIONS_ROOT = resolve(process.cwd(), "../..", "packages/db/src/migrations");

async function d1Database(): Promise<Sqlite> {
  const sqlite = "node:sqlite";
  const { DatabaseSync } = (await import(sqlite)) as { DatabaseSync: new (path: string, options?: unknown) => Sqlite };
  const db = new DatabaseSync(":memory:", { limits: { likePatternLength: 50 } });
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

function d1Over(db: Sqlite): D1Binding {
  return {
    prepare(query: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        all<T>() {
          return Promise.resolve({ results: db.prepare(query).all(...bound) as T[], success: true });
        },
      };
      return statement;
    },
  } as unknown as D1Binding;
}

describe("passkeys on a D1-shaped store (PK-7)", () => {
  let db: Sqlite;
  let w: PasskeyWorld;
  let token: string;

  beforeEach(async () => {
    db = await d1Database();
    const base = world();
    const passkeys = createPasskeysRepository(createSqlExecutor(d1Over(db))) as unknown as PasskeyWorld["passkeys"];
    w = { ...base, passkeys, pdeps: { ...base.pdeps, passkeys } };
    const who = await signIn(w);
    token = who.token;
    // The person exists in identity_users under the internal UUID, as on
    // stage: the foreign keys on passkeys and challenges hold.
    db.prepare("INSERT INTO identity_users (id, email, email_lower) VALUES (?, ?, ?)").run(parseUserPublicId(who.userId), "anu@cookpool.test", "anu@cookpool.test");
  });
  afterEach(() => db.close());

  it("saves what iPhone Safari sends, then signs in with it", async () => {
    // iCloud Keychain: attestation none, AAGUID zeros, backed up (BE and BS)
    // with UV, transports hybrid and internal, a platform authenticator, and
    // clientExtensionResults with credProps or empty.
    for (const credProps of [true, false]) {
      const device = await softAuthenticator({ transports: ["hybrid", "internal"] });
      const options = (await dataOf<{ options: { challenge: string; rp: { id?: string }; user: { id: string } } }>(await call.registerOptions(w, token))).options;
      const response = await device.create(options);
      if (!credProps) response.clientExtensionResults = {};
      const res = await call.registerVerify(w, token, { response }, { "user-agent": UA_IPHONE });
      const { passkey } = await dataOf<PasskeyRegisterVerifyResponse>(res, 201);
      expect(passkey).toMatchObject({ deviceName: "iPhone", backedUp: true, lastUsedAt: null });
      expect(db.prepare("SELECT transports, aaguid, backed_up FROM identity_passkeys WHERE id = ?").all(passkey.id)).toEqual([
        { transports: '["hybrid","internal"]', aaguid: "00000000-0000-0000-0000-000000000000", backed_up: 1 },
      ]);
      await signedIn(await passkeyLogin(w, device));
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("answers a store that fails with the step's generic message, never the credential", async () => {
    const device = await softAuthenticator();
    const options = (await dataOf<{ options: { challenge: string; rp: { id?: string }; user: { id: string } } }>(await call.registerOptions(w, token))).options;
    const response = await device.create(options);
    db.exec("DROP TABLE identity_passkeys");
    const res = await call.registerVerify(w, token, { response });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({ code: "internal_error", message: "Failed to store passkey" });
    expect(JSON.stringify(body)).not.toContain(device.credentialId);
  });
});
