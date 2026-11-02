// The kitchen-worker test harness: the real router over a real SQLite engine.
//
//   - PLATFORM_DB is a D1 binding over an in-memory `node:sqlite` database
//     with every migration in the manifest applied, in manifest order, through
//     the runner's own statement splitter. D1 is SQLite, so a statement this
//     engine accepts is one D1 accepts; a repository bug shows up as a failing
//     route, not as a mock that agreed with it.
//   - POLICY_WORKER runs the real policy engine (@saas/policy-engine), so a
//     test exercises the actual kitchen.* grants, not a stubbed allow.
//   - MEMBERSHIP_WORKER answers the authorization-context hop, the group
//     roster (/v1/internal/membership/organizations/:orgId/members) and a
//     person's groups (/v1/internal/membership/subjects/:subjectId/organizations)
//     from a roster the test fills with `grant` — the one thing
//     membership-worker owns. `rosterCalls` and `groupsCalls` count those
//     fetches; `failGroups` makes the groups fetch fail.
//   - IDENTITY_WORKER answers the people lookup
//     (/v1/internal/identity/users/lookup) from profiles the test fills with
//     `profile` (CP-9); `failIdentity` makes it fail.
//   - NOTIFICATIONS_WORKER answers notifications-worker's enqueue route
//     (POST /v1/notifications, CP-18) and records every request in
//     `notifications`: the internal actor it came from, the body, and whether
//     its idempotency key had been seen in that org before (`replayed`) — the
//     uniqueness notifications-worker keeps. `failNotifications` makes it 500.
//   - `beforeNextBatch` runs a write right before the worker's next D1 batch:
//     another request landing between this one's read and its write, which
//     is how a test races two writers deterministically.
//
// Every request goes through `route`, exactly as api-edge's service binding
// delivers it: actor headers set, the edge's path and method unchanged.

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authorize } from "@saas/policy-engine";
import type { AuthorizationRequest, MembershipFact, OrganizationRole } from "@saas/contracts/policy";
import type { RosterResponse, SubjectOrganizationsResponse } from "@saas/contracts/membership";
import type { UsersLookupRequest, UsersLookupResponse } from "@saas/contracts/auth";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import { manifest } from "@saas/db";
import { asUuid, type Uuid } from "@saas/db/ids";
import { D1ApiAdapter } from "@saas/db/runner";
import { route } from "@kitchen-worker/router";
import type { Env } from "@kitchen-worker/env";
import type { KitchenDeps } from "@kitchen-worker/context";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");

/** An in-memory SQLite database with every manifest migration applied. */
export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migration of manifest.migrations) {
    const sql = readFileSync(join(MIGRATIONS_ROOT, migration.path), "utf8");
    for (const statement of D1ApiAdapter.splitStatements(sql)) db.exec(statement);
  }
  return db;
}

/** Seams into the D1 double. */
export interface D1Hooks {
  /** Runs before each batch, outside its transaction (as a concurrent request's write would). */
  beforeBatch?: () => void;
}

/** A D1 binding backed by `db` — the subset the SQL executor uses. */
export function d1Over(db: DatabaseSync, hooks: D1Hooks = {}): D1Database {
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
    // D1's batch is one implicit transaction: all statements apply or none do,
    // and nothing else runs in between — concurrent requests' batches are
    // serialized. So the statements run synchronously here: two requests
    // racing never interleave inside one transaction.
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
  } as unknown as D1Database;
}

function fetcher(handle: (url: string, init: RequestInit) => Promise<Response>): Fetcher {
  return {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return handle(url, init ?? {});
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
}

/** A group: its stored UUID, the `org_…` id the API uses, and its name and slug. */
export interface Group {
  id: Uuid;
  publicId: string;
  name: string;
  slug: string;
}

export function newGroup(name = "Flat 4B"): Group {
  const id = asUuid(randomUUID());
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 4)}`;
  return { id, publicId: `org_${id.replace(/-/g, "")}`, name, slug };
}

export interface CallOptions {
  /** The actor's subject id (`usr_…`); `null` sends no actor headers. */
  as: string | null;
  /** JSON-encoded as the body. */
  body?: unknown;
  /** Sent as is (for malformed bodies); wins over `body`. */
  rawBody?: string;
  headers?: Record<string, string>;
}

export interface Harness {
  db: DatabaseSync;
  env: Env;
  /** Give `subjectId` `role` in `group` (replacing any role it had there). */
  grant(subjectId: string, group: Group, role: OrganizationRole): void;
  /** Take `subjectId` out of `group` (they left, or were removed). */
  revoke(subjectId: string, group: Group): void;
  /** How many times the worker fetched a group's roster. */
  readonly rosterCalls: number;
  /** How many times the worker fetched a person's groups. */
  readonly groupsCalls: number;
  /** While true, the person's-groups fetch answers 500. */
  failGroups: boolean;
  /** Every authorization decision the policy engine made, in order. */
  decisions: Array<{ request: AuthorizationRequest; allow: boolean }>;
  /**
   * Run `write` right before the worker's next D1 batch — after the request
   * has read what it computes from, before it writes. Queue several to land
   * one before each of the next batches.
   */
  beforeNextBatch(write: (db: DatabaseSync) => void): void;
  /** Send one request through the worker's router. */
  call(method: string, path: string, opts: CallOptions): Promise<Response>;
  close(): void;
  /** Give `subjectId` a profile in identity (CP-9): what the people lookup answers. */
  profile(subjectId: string, profile: { displayName: string | null; email: string }): void;
  /** How many times the worker asked identity for names. */
  readonly identityCalls: number;
  /** While true, the identity lookup answers 500. */
  failIdentity: boolean;
  /** Every enqueue the worker asked notifications-worker for, in order (CP-18). */
  notifications: RecordedNotification[];
  /** While true, the enqueue route answers 500. */
  failNotifications: boolean;
}

/** One enqueue the worker sent to notifications-worker. */
export interface RecordedNotification {
  /** `x-internal-actor`: who called. */
  internalActor: string | null;
  request: EnqueueNotificationRequest;
  /** The key had already been used in this org: notifications-worker would send nothing more. */
  replayed: boolean;
}

export interface HarnessOptions {
  deps?: KitchenDeps;
  /** Bindings to replace; `undefined` removes one. */
  env?: Partial<Record<keyof Env, unknown>>;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const db = migratedDatabase();
  let closed = false;
  const roster = new Map<string, Map<string, OrganizationRole>>();
  const known = new Map<string, Group>();
  const decisions: Harness["decisions"] = [];
  const pendingWrites: Array<(db: DatabaseSync) => void> = [];

  let rosterCalls = 0;
  let groupsCalls = 0;
  const state = { failGroups: false };
  const membershipWorker = fetcher(async (url, init) => {
    const groupsMatch = new URL(url).pathname.match(/^\/v1\/internal\/membership\/subjects\/([^/]+)\/organizations$/);
    if (groupsMatch && (init.method ?? "GET") === "GET") {
      groupsCalls += 1;
      if (state.failGroups) return Response.json({ error: { code: "internal_error" } }, { status: 500 });
      const organizations: SubjectOrganizationsResponse["organizations"] = [];
      for (const [orgId, role] of roster.get(decodeURIComponent(groupsMatch[1]!)) ?? []) {
        const group = known.get(orgId)!;
        organizations.push({ orgId: group.publicId, slug: group.slug, name: group.name, role });
      }
      organizations.sort((a, b) => a.name.localeCompare(b.name));
      return Response.json({
        data: { organizations } satisfies SubjectOrganizationsResponse,
        meta: { requestId: "req_membership", cursor: null },
      });
    }
    const rosterMatch = new URL(url).pathname.match(/^\/v1\/internal\/membership\/organizations\/([^/]+)\/members$/);
    if (rosterMatch && (init.method ?? "GET") === "GET") {
      rosterCalls += 1;
      const members: RosterResponse["members"] = [];
      for (const [subjectId, roles] of roster) {
        const role = roles.get(rosterMatch[1]!);
        if (role) members.push({ subjectId, subjectType: "user", role, memberId: `mem_${subjectId}`, joinedAt: "2026-11-01T00:00:00.000Z" });
      }
      return Response.json({ data: { members } satisfies RosterResponse, meta: { requestId: "req_membership", cursor: null } });
    }
    if (!url.endsWith("/v1/internal/membership/authorization-context")) {
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    const body = JSON.parse(String(init.body)) as { subject: { id: string }; orgId: string };
    const role = roster.get(body.subject.id)?.get(body.orgId);
    const memberships: MembershipFact[] = role
      ? [{ kind: "role_assignment", role, scope: { kind: "organization", orgId: body.orgId } }]
      : [];
    return Response.json({ data: { memberships }, meta: { requestId: "req_membership", cursor: null } });
  });

  const policyWorker = fetcher(async (url, init) => {
    if (!url.endsWith("/v1/internal/policy/authorize")) {
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    const request = JSON.parse(String(init.body)) as AuthorizationRequest;
    const decision = authorize(request);
    decisions.push({ request, allow: decision.allow });
    return Response.json({ data: decision, meta: { requestId: "req_policy", cursor: null } });
  });

  // identity-worker's people lookup (CP-9), from profiles the test fills with `profile`.
  const profiles = new Map<string, { displayName: string | null; email: string }>();
  const identityState = { calls: 0, fail: false };
  const identityWorker = fetcher(async (url, init) => {
    if (!url.endsWith("/v1/internal/identity/users/lookup") || init.method !== "POST") {
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    identityState.calls += 1;
    if (identityState.fail) return Response.json({ error: { code: "internal_error" } }, { status: 500 });
    const { subjectIds } = JSON.parse(String(init.body)) as UsersLookupRequest;
    const users = subjectIds.flatMap((subjectId) => {
      const p = profiles.get(subjectId);
      return p ? [{ subjectId, ...p }] : [];
    });
    return Response.json({ data: { users } satisfies UsersLookupResponse, meta: { requestId: "req_identity", cursor: null } });
  });

  // notifications-worker's enqueue route (CP-18): idempotency keys are unique per org.
  const notifications: RecordedNotification[] = [];
  const notificationsState = { fail: false };
  const notificationKeys = new Map<string, string>();
  const notificationsWorker = fetcher(async (url, init) => {
    if (new URL(url).pathname !== "/v1/notifications" || init.method !== "POST") {
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    if (notificationsState.fail) return Response.json({ error: { code: "internal_error" } }, { status: 500 });
    const headers = new Headers(init.headers);
    const request = JSON.parse(String(init.body)) as EnqueueNotificationRequest;
    const key = request.idempotencyKey ? `${request.orgId}|${request.idempotencyKey}` : null;
    const prior = key ? notificationKeys.get(key) : undefined;
    const id = prior ?? `ntf_${randomUUID().replace(/-/g, "")}`;
    if (key && !prior) notificationKeys.set(key, id);
    notifications.push({ internalActor: headers.get("x-internal-actor"), request, replayed: prior !== undefined });
    return Response.json(
      { data: { notification: { id, status: "sent" } }, meta: { requestId: "req_notifications", cursor: null } },
      { status: prior ? 200 : 201 },
    );
  });

  const base: Record<string, unknown> = {
    ENVIRONMENT: "test",
    APP_URL: "https://cookpool.test",
    PLATFORM_DB: d1Over(db, { beforeBatch: () => pendingWrites.shift()?.(db) }),
    MEMBERSHIP_WORKER: membershipWorker,
    POLICY_WORKER: policyWorker,
    NOTIFICATIONS_WORKER: notificationsWorker,
    IDENTITY_WORKER: identityWorker,
  };
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  const env = base as unknown as Env;

  return {
    db,
    env,
    decisions,
    get rosterCalls() {
      return rosterCalls;
    },
    get groupsCalls() {
      return groupsCalls;
    },
    get failGroups() {
      return state.failGroups;
    },
    set failGroups(value: boolean) {
      state.failGroups = value;
    },
    beforeNextBatch(write) {
      pendingWrites.push(write);
    },
    grant(subjectId, group, role) {
      known.set(group.id, group);
      const roles = roster.get(subjectId) ?? new Map<string, OrganizationRole>();
      roles.set(group.id, role);
      roster.set(subjectId, roles);
    },
    revoke(subjectId, group) {
      roster.get(subjectId)?.delete(group.id);
    },
    call(method, path, opts) {
      const headers = new Headers({ "x-request-id": "req_test", ...(opts.headers ?? {}) });
      if (opts.as !== null) {
        headers.set("x-actor-subject-id", opts.as);
        headers.set("x-actor-subject-type", "user");
      }
      let body: string | undefined;
      if (opts.rawBody !== undefined) body = opts.rawBody;
      else if (opts.body !== undefined) body = JSON.stringify(opts.body);
      if (body !== undefined) headers.set("content-type", "application/json");
      const request = new Request(`https://kitchen.internal${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
      });
      return route(request, env, options.deps ?? {});
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
    profile(subjectId, profile) {
      profiles.set(subjectId, profile);
    },
    get identityCalls() {
      return identityState.calls;
    },
    get failIdentity() {
      return identityState.fail;
    },
    set failIdentity(value: boolean) {
      identityState.fail = value;
    },
    notifications,
    get failNotifications() {
      return notificationsState.fail;
    },
    set failNotifications(value: boolean) {
      notificationsState.fail = value;
    },
  };
}

/** The `{ data, meta }` or `{ error }` envelope of a response. */
export interface Envelope<T> {
  data: T;
  meta: { requestId: string; cursor: string | null };
  error: { code: string; message: string; details: Record<string, unknown>; requestId: string };
}

export async function envelope<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}
