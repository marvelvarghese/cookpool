// The spliteco-worker test harness: the real router over a real SQLite engine,
// next to the real membership-worker and kitchen-worker over the SAME database.
//
//   - PLATFORM_DB is a D1 binding over an in-memory `node:sqlite` database
//     with every manifest migration applied (migration 530 included).
//   - MEMBERSHIP_WORKER is membership-worker's own router over that database
//     (OPEN_GROUPS on), so the `?view=spliteco` groups read, group creation
//     with made_in/kind, the direct-groups route, the open-groups cap and the
//     authorization context are the shipped code, not a double. `grant` writes
//     membership rows directly, as a join would.
//   - POLICY_WORKER runs the real policy engine.
//   - IDENTITY_WORKER answers the people lookup from `profile`.
//   - NOTIFICATIONS_WORKER records every enqueue it is sent (`sent`), for
//     the reminders and "paid you" (SE2), and answers as the worker does.
//   - `kitchen` sends a request through kitchen-worker's router over the same
//     database and bindings, so a test can post in Cookpool and read in
//     Spliteco (and back).

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authorize } from "@saas/policy-engine";
import type { AuthorizationRequest, OrganizationRole } from "@saas/contracts/policy";
import type { UsersLookupRequest } from "@saas/contracts/auth";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import { manifest } from "@saas/db";
import { asUuid, type Uuid } from "@saas/db/ids";
import { D1ApiAdapter } from "@saas/db/runner";
import { route } from "@spliteco-worker/router";
import type { Env } from "@spliteco-worker/env";
import type { SplitecoDeps } from "@spliteco-worker/context";
import { route as membershipRoute } from "@membership-worker/router";
import { route as kitchenRoute } from "@kitchen-worker/router";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The dev server (./dev-server.ts) runs bundled elsewhere and says where the migrations are.
const MIGRATIONS_ROOT = process.env.SPLITECO_MIGRATIONS_ROOT ?? resolve(__dirname, "../../..", "packages/db/src/migrations");

export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migration of manifest.migrations) {
    const sql = readFileSync(join(MIGRATIONS_ROOT, migration.path), "utf8");
    for (const statement of D1ApiAdapter.splitStatements(sql)) db.exec(statement);
  }
  return db;
}

export function d1Over(db: DatabaseSync, hooks: { beforeBatch?: () => void } = {}): D1Database {
  return {
    prepare(query: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        run<T>() {
          return { results: db.prepare(query).all(...(bound as never[])) as T[], success: true };
        },
        all<T>() {
          return Promise.resolve(statement.run<T>());
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): unknown }>) {
      hooks.beforeBatch?.();
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.run());
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
}

function fetcher(handle: (request: Request) => Promise<Response>): Fetcher {
  return {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const request = input instanceof Request ? input : new Request(String(input), init);
      return handle(request);
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
}

export interface Group {
  id: Uuid;
  publicId: string;
  name: string;
}

export interface CallOptions {
  as: string | null;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export interface Harness {
  db: DatabaseSync;
  env: Env;
  /** A group (organization) made directly in the database. */
  group(name: string, options?: { madeIn?: "cookpool" | "spliteco"; kind?: string }): Group;
  grant(subjectId: string, group: Group, role: OrganizationRole): void;
  revoke(subjectId: string, group: Group): void;
  profile(subjectId: string, profile: { displayName: string | null; email: string }): void;
  call(method: string, path: string, opts: CallOptions): Promise<Response>;
  kitchen(method: string, path: string, opts: CallOptions): Promise<Response>;
  membership(method: string, path: string, opts: CallOptions): Promise<Response>;
  beforeNextBatch(write: (db: DatabaseSync) => void): void;
  decisions: Array<{ action: string; allow: boolean }>;
  /** Every notification enqueued (by Spliteco or Cookpool), with the worker that asked. */
  sent: Array<{ internalActor: string | null; body: EnqueueNotificationRequest }>;
  close(): void;
}

export interface HarnessOptions {
  deps?: SplitecoDeps;
  env?: Partial<Record<keyof Env, unknown>>;
}

function requestFor(base: string, method: string, path: string, opts: CallOptions): Request {
  const headers = new Headers({ "x-request-id": "req_test", ...(opts.headers ?? {}) });
  if (opts.as !== null) {
    headers.set("x-actor-subject-id", opts.as);
    headers.set("x-actor-subject-type", "user");
  }
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${base}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const db = migratedDatabase();
  const pending: Array<(db: DatabaseSync) => void> = [];
  const d1 = d1Over(db, { beforeBatch: () => pending.shift()?.(db) });
  const decisions: Harness["decisions"] = [];

  const membershipEnv: Record<string, unknown> = { PLATFORM_DB: d1, ENVIRONMENT: "test", OPEN_GROUPS: "true", SOLO_MODE: "false" };
  const membershipWorker = fetcher((request) => membershipRoute(request, membershipEnv as never));

  const policyWorker = fetcher(async (request) => {
    const body = (await request.json()) as AuthorizationRequest;
    const decision = authorize(body);
    decisions.push({ action: body.action, allow: decision.allow });
    return Response.json({ data: decision, meta: { requestId: "req_policy", cursor: null } });
  });

  const profiles = new Map<string, { displayName: string | null; email: string }>();
  const identityWorker = fetcher(async (request) => {
    if (!request.url.endsWith("/v1/internal/identity/users/lookup")) return Response.json({ error: { code: "not_found" } }, { status: 404 });
    const { subjectIds } = (await request.json()) as UsersLookupRequest;
    const users = subjectIds.flatMap((subjectId) => {
      const p = profiles.get(subjectId);
      return p ? [{ subjectId, ...p }] : [];
    });
    return Response.json({ data: { users }, meta: { requestId: "req_identity", cursor: null } });
  });
  const sent: Harness["sent"] = [];
  const notificationsWorker = fetcher(async (request) => {
    sent.push({ internalActor: request.headers.get("x-internal-actor"), body: (await request.json()) as EnqueueNotificationRequest });
    return Response.json({ data: { notification: { id: "ntf_x", status: "sent" } }, meta: { requestId: "r", cursor: null } }, { status: 201 });
  });

  const base: Record<string, unknown> = {
    ENVIRONMENT: "test",
    PLATFORM_DB: d1,
    MEMBERSHIP_WORKER: membershipWorker,
    POLICY_WORKER: policyWorker,
    IDENTITY_WORKER: identityWorker,
    NOTIFICATIONS_WORKER: notificationsWorker,
    APP_URL: "https://spliteco.test",
  };
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  const env = base as unknown as Env;
  const kitchenEnv = {
    ENVIRONMENT: "test",
    APP_URL: "https://cookpool.test",
    PLATFORM_DB: d1,
    MEMBERSHIP_WORKER: membershipWorker,
    POLICY_WORKER: policyWorker,
    IDENTITY_WORKER: identityWorker,
    NOTIFICATIONS_WORKER: notificationsWorker,
  };
  // membership-worker asks kitchen-worker for both balances before a leave (SE3, risk CP-L).
  membershipEnv.KITCHEN_WORKER = fetcher((request) => kitchenRoute(request, kitchenEnv as never, {}));

  const now = () => new Date().toISOString();
  return {
    db,
    env,
    decisions,
    sent,
    group(name, { madeIn = "cookpool", kind = madeIn === "cookpool" ? "kitchen" : "trip" } = {}) {
      const id = asUuid(randomUUID());
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 6)}`;
      db.prepare(
        `INSERT INTO membership_organizations (id, name, slug, slug_lower, created_at, updated_at, made_in, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, name, slug, slug, now(), now(), madeIn, kind);
      return { id, publicId: `org_${id.replace(/-/g, "")}`, name };
    },
    grant(subjectId, group, role) {
      const at = now();
      const existing = db
        .prepare("SELECT id FROM membership_organization_members WHERE org_id = ? AND subject_id = ?")
        .get(group.id, subjectId) as { id: string } | undefined;
      if (existing) {
        db.prepare("UPDATE membership_organization_members SET status = 'active' WHERE id = ?").run(existing.id);
      } else {
        db.prepare(
          `INSERT INTO membership_organization_members (id, org_id, subject_id, subject_type, created_at, updated_at)
           VALUES (?, ?, ?, 'user', ?, ?)`,
        ).run(randomUUID(), group.id, subjectId, at, at);
      }
      db.prepare("UPDATE membership_role_assignments SET revoked_at = ? WHERE org_id = ? AND subject_id = ? AND revoked_at IS NULL").run(
        at,
        group.id,
        subjectId,
      );
      db.prepare(
        `INSERT INTO membership_role_assignments (id, org_id, subject_id, subject_type, role, scope_kind, scope_ref, created_at)
         VALUES (?, ?, ?, 'user', ?, 'organization', NULL, ?)`,
      ).run(randomUUID(), group.id, subjectId, role, at);
    },
    revoke(subjectId, group) {
      const at = now();
      db.prepare("UPDATE membership_organization_members SET status = 'removed', updated_at = ? WHERE org_id = ? AND subject_id = ?").run(
        at,
        group.id,
        subjectId,
      );
      db.prepare("UPDATE membership_role_assignments SET revoked_at = ? WHERE org_id = ? AND subject_id = ? AND revoked_at IS NULL").run(
        at,
        group.id,
        subjectId,
      );
    },
    profile(subjectId, profile) {
      profiles.set(subjectId, profile);
    },
    call(method, path, opts) {
      return route(requestFor("https://spliteco.internal", method, path, opts), env, options.deps ?? {});
    },
    kitchen(method, path, opts) {
      return kitchenRoute(requestFor("https://kitchen.internal", method, path, opts), kitchenEnv as never, {});
    },
    membership(method, path, opts) {
      return membershipRoute(requestFor("http://membership-worker", method, path, opts), membershipEnv as never);
    },
    beforeNextBatch(write) {
      pending.push(write);
    },
    close() {
      db.close();
    },
  };
}

export interface Envelope<T> {
  data: T;
  meta: { requestId: string; cursor: string | null };
  error: { code: string; message: string; details: Record<string, unknown>; requestId: string };
}

export async function envelope<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

/** `usr_` ids as identity mints them. */
export const usr = (n: number): string => `usr_${String(n).padStart(32, "0")}`;
