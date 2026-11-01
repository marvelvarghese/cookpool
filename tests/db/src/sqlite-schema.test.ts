import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createIdentityRepository } from "@saas/db/identity";
import { createMembershipRepository } from "@saas/db/membership";
import { createProjectsRepository } from "@saas/db/projects";
import { createMeteringRepository } from "@saas/db/metering";
import { createWebhookRepository } from "@saas/db/webhooks";
import { createEventsRepository } from "@saas/db/events";
import { createKitchenRepository, type NewKitchenTxn } from "@saas/db/kitchen";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import { asUuid } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// The runner's own statement splitter — the same one that will feed D1 over
// the REST API — so this suite exercises the production path, not a copy.
const splitStatements = D1ApiAdapter.splitStatements;

// The migrations and the repositories are checked against a REAL SQLite engine
// here, not a mock. Every other repository suite in this package stubs the
// executor and asserts the SQL text — necessary, but blind to whether SQLite
// would accept that text. This suite closes that gap: D1 is SQLite, so a
// statement `node:sqlite` parses and runs is a statement D1 runs.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS_ROOT)
    .filter((d) => existsSync(join(MIGRATIONS_ROOT, d, "up.sql")))
    .sort();
}

/** A D1 binding backed by an in-memory SQLite database. */
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
          const prepared = db.prepare(query);
          const rows = prepared.all(...(bound as never[])) as T[];
          return Promise.resolve({ results: rows, success: true });
        },
      };
      return statement;
    },
    // D1's batch is one implicit transaction: every statement applies or none
    // does. Mirrored with a real SQLite transaction, so the suite proves the
    // rollback rather than assuming it.
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

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const dir of migrationDirs()) {
    const sql = readFileSync(join(MIGRATIONS_ROOT, dir, "up.sql"), "utf8");
    for (const statement of splitStatements(sql)) db.exec(statement);
  }
  return db;
}

describe("migrations against a real SQLite engine", () => {
  it("apply cleanly in manifest order", () => {
    expect(() => migratedDatabase()).not.toThrow();
  });

  it("are idempotent — a second application changes nothing", () => {
    const db = migratedDatabase();
    for (const dir of migrationDirs()) {
      const sql = readFileSync(join(MIGRATIONS_ROOT, dir, "up.sql"), "utf8");
      for (const statement of splitStatements(sql)) {
        try {
          db.exec(statement);
        } catch (err) {
          // SQLite has no `ADD COLUMN IF NOT EXISTS`; the runner's applied
          // ledger is what stops a column add from running twice. Every other
          // statement must be re-runnable on its own.
          expect(String(err)).toMatch(/duplicate column name/i);
        }
      }
    }
    db.close();
  });

  it("create every table the repositories address, with no schema prefixes left", () => {
    const db = migratedDatabase();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);

    expect(tables).toContain("identity_users");
    expect(tables).toContain("membership_organizations");
    expect(tables).toContain("_migrations_applied");
    // A dot in a table name would mean a Postgres schema survived the port.
    for (const name of tables) expect(name).not.toContain(".");
    db.close();
  });

  it("default timestamps to a parseable ISO-8601 instant", () => {
    // Postgres `now()` became a strftime format string; if that format were
    // wrong, `new Date(row.created_at)` in every row mapper would yield
    // Invalid Date — silently, and only at runtime.
    const db = migratedDatabase();
    db.exec(
      `INSERT INTO identity_users (id, email, email_lower) VALUES ('u1', 'a@b.c', 'a@b.c')`,
    );
    const row = db.prepare("SELECT created_at FROM identity_users").get() as {
      created_at: string;
    };
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(new Date(row.created_at).getTime())).toBe(false);
    db.close();
  });
});

describe("repositories against a real SQLite engine", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;

  beforeEach(() => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
  });

  afterEach(() => {
    db.close();
  });

  it("round-trips a user through create and read", async () => {
    const repo = createIdentityRepository(executor);
    const created = await repo.createUser({
      id: "11111111-1111-4111-8111-111111111111",
      email: "Ada@Example.com",
      emailLower: "ada@example.com",
      displayName: "Ada",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.email).toBe("Ada@Example.com");
    expect(created.value.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    const found = await repo.getUserByEmail("ada@example.com");
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("maps a real unique-constraint failure to a conflict result", async () => {
    // The dialect's own error, raised by the engine — not a hand-written
    // fixture. This is what makes isUniqueViolation's pattern trustworthy.
    const repo = createIdentityRepository(executor);
    const input = {
      id: "22222222-2222-4222-8222-222222222222",
      email: "dup@example.com",
      emailLower: "dup@example.com",
      displayName: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect((await repo.createUser(input)).ok).toBe(true);

    const again = await repo.createUser({
      ...input,
      id: "33333333-3333-4333-8333-333333333333",
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe("conflict");
  });

  it("round-trips an organization and its slug lookup", async () => {
    const repo = createMembershipRepository(executor);
    const created = await repo.createOrganization({
      id: "44444444-4444-4444-8444-444444444444",
      name: "Acme",
      slug: "acme",
      slugLower: "acme",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(created.ok).toBe(true);

    const bySlug = await repo.getOrganizationBySlug("acme");
    expect(bySlug.ok).toBe(true);
    if (bySlug.ok) expect(bySlug.value.name).toBe("Acme");
  });

  it("counts through the un-cast COUNT(*) the port left behind", async () => {
    // `COUNT(*)::bigint` was a Postgres cast; SQLite rejects it. This asserts
    // the replacement still returns a usable number through the mapper — the
    // value quota enforcement reads before allowing another project.
    const orgId = asUuid("55555555-5555-4555-8555-555555555555");
    const projects = createProjectsRepository(executor);

    const empty = await projects.countActiveProjects(orgId);
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value).toBe(0);

    const created = await projects.createProject({
      id: asUuid("66666666-6666-4666-8666-666666666666"),
      orgId,
      name: "First",
      slug: "first",
      slugLower: "first",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(created.ok).toBe(true);

    const counted = await projects.countActiveProjects(orgId);
    expect(counted.ok).toBe(true);
    if (counted.ok) expect(counted.value).toBe(1);
  });
});

// The three queries the port rewrote most, run for real. Each replaced a
// Postgres construct SQLite does not have (date_trunc, md5, INTERVAL, a
// timestamptz cast), and each is a place where a mock executor would happily
// assert the text of SQL that the engine rejects.
describe("the rewritten queries, against a real SQLite engine", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;

  beforeEach(() => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
  });

  afterEach(() => {
    db.close();
  });

  it("materializes usage rollups: strftime buckets, a key-derived id, and an upsert", async () => {
    const repo = createMeteringRepository(executor);
    const orgId = "org-roll";

    // Two records in the same hour, one in the next: the aggregation must fold
    // the first two together and keep the third separate.
    const at = async (iso: string, key: string, quantity: number) => {
      const r = await repo.recordUsage({
        id: `usage-${key}`,
        orgId,
        metric: "api_requests",
        quantity,
        idempotencyKey: key,
        recordedAt: new Date(iso),
      });
      expect(r.ok).toBe(true);
    };
    await at("2026-03-15T11:10:00.000Z", "a", 3);
    await at("2026-03-15T11:50:00.000Z", "b", 4);
    await at("2026-03-15T12:05:00.000Z", "c", 5);

    const first = await repo.materializeUsageRollups({
      bucketType: "hour",
      start: new Date("2026-03-15T11:00:00.000Z"),
      end: new Date("2026-03-15T13:00:00.000Z"),
    });
    expect(first.ok).toBe(true);

    const rows = db
      .prepare(
        "SELECT bucket_start, quantity, record_count FROM metering_usage_rollups ORDER BY bucket_start",
      )
      .all() as { bucket_start: string; quantity: number; record_count: number }[];
    expect(rows).toEqual([
      { bucket_start: "2026-03-15T11:00:00.000Z", quantity: 7, record_count: 2 },
      { bucket_start: "2026-03-15T12:00:00.000Z", quantity: 5, record_count: 1 },
    ]);

    // Re-materializing the same window must UPDATE, never duplicate — the
    // ON CONFLICT target has to match the unique index expression for expression.
    const again = await repo.materializeUsageRollups({
      bucketType: "hour",
      start: new Date("2026-03-15T11:00:00.000Z"),
      end: new Date("2026-03-15T13:00:00.000Z"),
    });
    expect(again.ok).toBe(true);
    const count = db.prepare("SELECT COUNT(*) AS n FROM metering_usage_rollups").get() as {
      n: number;
    };
    expect(count.n).toBe(2);
  });

  it("rotates a webhook secret with a grace window computed by strftime", async () => {
    const repo = createWebhookRepository(executor);
    const orgId = asUuid("77777777-7777-4777-8777-777777777777");
    const endpointId = "wep_rotate";

    const created = await repo.createEndpoint({
      id: endpointId,
      orgId,
      url: "https://example.test/hook",
      secretCiphertext: "envelope-v1",
    });
    expect(created.ok).toBe(true);

    const rotated = await repo.rotateEndpointSecret(orgId, endpointId, {
      secretCiphertext: "envelope-v2",
      gracePeriodSeconds: 3600,
    });
    expect(rotated.ok).toBe(true);

    const row = db
      .prepare(
        `SELECT previous_secret_ciphertext, previous_secret_version, previous_secret_expires_at
         FROM webhooks_webhook_endpoints WHERE id = ?`,
      )
      .get(endpointId) as {
      previous_secret_ciphertext: string;
      previous_secret_version: number;
      previous_secret_expires_at: string;
    };
    expect(row.previous_secret_ciphertext).toBe("envelope-v1");
    expect(row.previous_secret_version).toBe(1);
    // The INTERVAL literal became a strftime modifier; if the modifier were
    // malformed SQLite returns NULL rather than failing, so assert the shape.
    expect(row.previous_secret_expires_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(new Date(row.previous_secret_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("counts a delivery failure streak past the epoch fallback", async () => {
    // The fallback used a `'1970-01-01'::timestamptz` cast; with no prior
    // success the whole count depends on it comparing sanely against the
    // ISO-8601 text the rest of the schema stores.
    const repo = createWebhookRepository(executor);
    const orgId = asUuid("88888888-8888-4888-8888-888888888888");
    const streak = await repo.countConsecutiveEndpointFailures(orgId, "wep_none");
    expect(streak.ok).toBe(true);
    if (streak.ok) expect(streak.value).toBe(0);
  });
});

// The three writes a first sign-in and a first invite make. Each was ported
// from Postgres as one statement built on data-modifying CTEs (`WITH x AS
// (INSERT … RETURNING *)`) and `row_to_json`, neither of which SQLite has, so
// on D1 every one of them failed: onboarding answered "Failed to create
// organization" for every product built from this baseline. The stubbed-
// executor suites asserted the SQL text and could not see it.
describe("the writes onboarding makes, against a real SQLite engine", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  const at = new Date("2026-01-01T00:00:00.000Z");
  const orgId = asUuid("55555555-5555-4555-8555-555555555555");

  beforeEach(() => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
  });

  afterEach(() => {
    db.close();
  });

  function bootstrapInput(id: string, slug: string, memberId: string, roleId: string) {
    const org = asUuid(id);
    return {
      org: { id: org, name: slug, slug, slugLower: slug, createdAt: at },
      member: { id: memberId, orgId: org, subjectId: "usr_owner", subjectType: "user", createdAt: at },
      roleAssignment: {
        id: roleId, orgId: org, subjectId: "usr_owner", subjectType: "user",
        role: "owner", scopeKind: "organization", scopeRef: null, createdAt: at,
      },
    };
  }

  function count(table: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }

  it("bootstraps an organization with its owner member and role", async () => {
    const repo = createMembershipRepository(executor);
    const result = await repo.bootstrapOrganization(
      bootstrapInput(orgId, "acme", "66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.org.slug).toBe("acme");
    expect(result.value.org.createdAt.toISOString()).toBe(at.toISOString());
    expect(result.value.member.subjectId).toBe("usr_owner");
    expect(result.value.roleAssignment.role).toBe("owner");
    expect(count("membership_organization_members")).toBe(1);
    expect(count("membership_role_assignments")).toBe(1);
  });

  it("answers a taken slug with a conflict and leaves no orphan member or role", async () => {
    const repo = createMembershipRepository(executor);
    const first = await repo.bootstrapOrganization(
      bootstrapInput(orgId, "acme", "66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"),
    );
    expect(first.ok).toBe(true);

    const again = await repo.bootstrapOrganization(
      bootstrapInput("88888888-8888-4888-8888-888888888888", "acme", "99999999-9999-4999-8999-999999999999", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe("conflict");
    expect(count("membership_organizations")).toBe(1);
    expect(count("membership_organization_members")).toBe(1);
    expect(count("membership_role_assignments")).toBe(1);
  });

  it("appends an event and its audit entry together", async () => {
    const repo = createEventsRepository(executor);
    const result = await repo.appendEventWithAudit({
      event: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "organization.created", version: 1, source: "membership-worker", occurredAt: at,
        actorType: "user", actorId: "usr_owner", orgId,
        subjectKind: "organization", subjectId: orgId, subjectName: "acme",
        requestId: "req_test", payload: { name: "acme" },
      },
      audit: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", category: "membership", description: "Organization created" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event.type).toBe("organization.created");
    expect(result.value.event.payload).toEqual({ name: "acme" });
    expect(result.value.audit.eventId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(result.value.audit.category).toBe("membership");
    expect(count("events_event_log")).toBe(1);
    expect(count("events_audit_entries")).toBe(1);

    const replay = await repo.appendEventWithAudit({
      event: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "organization.created", version: 1, source: "membership-worker", occurredAt: at,
        actorType: "user", actorId: "usr_owner", orgId,
        subjectKind: "organization", subjectId: orgId, requestId: "req_test", payload: {},
      },
      audit: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.kind).toBe("conflict");
    expect(count("events_audit_entries")).toBe(1);
  });

  it("accepts an invitation into a member and its role, once", async () => {
    const repo = createMembershipRepository(executor);
    expect((await repo.bootstrapOrganization(
      bootstrapInput(orgId, "acme", "66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"),
    )).ok).toBe(true);
    const invited = await repo.createInvitation({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", orgId, email: "Bo@Example.com", emailLower: "bo@example.com",
      role: "builder", tokenHash: "hash-1", invitedBy: "usr_owner",
      expiresAt: new Date("2026-02-01T00:00:00.000Z"), createdAt: at,
    });
    expect(invited.ok).toBe(true);

    const input = {
      tokenHash: "hash-1", orgId, emailLower: "bo@example.com",
      memberId: "ffffffff-ffff-4fff-8fff-ffffffffffff", roleAssignmentId: "12121212-1212-4212-8212-121212121212",
      subjectId: "usr_bo", subjectType: "user", acceptedAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const accepted = await repo.acceptInvitation(input);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.invitation.status).toBe("accepted");
    expect(accepted.value.member.subjectId).toBe("usr_bo");
    expect(accepted.value.roleAssignment.role).toBe("builder");
    expect(count("membership_organization_members")).toBe(2);

    const twice = await repo.acceptInvitation({
      ...input, memberId: "13131313-1313-4313-8313-131313131313", roleAssignmentId: "14141414-1414-4414-8414-141414141414",
    });
    expect(twice.ok).toBe(false);
    expect(count("membership_organization_members")).toBe(2);
    expect(count("membership_role_assignments")).toBe(2);
  });
});

// Join links (Cookpool CP-3, migration 200): a code per organization, a join
// that writes the member and its role in one batch, and a leave that removes
// the member and revokes their roles in one batch — run on the real engine,
// because the upsert, the dependent INSERT … SELECT and the last-owner guard
// are exactly the SQL a stubbed executor cannot vouch for.
describe("join links, against a real SQLite engine", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  const at = new Date("2026-01-01T00:00:00.000Z");
  const orgId = asUuid("21212121-2121-4121-8121-212121212121");
  const otherOrgId = asUuid("31313131-3131-4131-8131-313131313131");

  beforeEach(() => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
  });

  afterEach(() => {
    db.close();
  });

  function count(sql: string, ...params: string[]): number {
    return (db.prepare(sql).get(...params) as { n: number }).n;
  }

  async function bootstrap(id: string, slug: string, owner = "usr_owner") {
    const repo = createMembershipRepository(executor);
    const org = asUuid(id);
    const result = await repo.bootstrapOrganization({
      org: { id: org, name: slug, slug, slugLower: slug, createdAt: at },
      member: { id: randomUUID(), orgId: org, subjectId: owner, subjectType: "user", createdAt: at },
      roleAssignment: {
        id: randomUUID(), orgId: org, subjectId: owner, subjectType: "user",
        role: "owner", scopeKind: "organization", scopeRef: null, createdAt: at,
      },
    });
    expect(result.ok).toBe(true);
    return repo;
  }

  function joinInput(subjectId: string, joinedAt: Date, org = orgId) {
    return {
      orgId: org, memberId: randomUUID(), roleAssignmentId: randomUUID(),
      subjectId, subjectType: "user", role: "builder", joinedAt,
    };
  }

  it("adds a nullable join_code whose partial unique index lets many orgs have none", async () => {
    await bootstrap(orgId, "flat-4b");
    await bootstrap(otherOrgId, "lunch-club");
    const columns = (db.prepare("PRAGMA table_info(membership_organizations)").all() as { name: string }[])
      .map((c) => c.name);
    expect(columns).toContain("join_code");
    expect(count("SELECT COUNT(*) AS n FROM membership_organizations WHERE join_code IS NULL")).toBe(2);

    db.prepare("UPDATE membership_organizations SET join_code = 'ABCDEFGH' WHERE id = ?").run(orgId);
    expect(() =>
      db.prepare("UPDATE membership_organizations SET join_code = 'ABCDEFGH' WHERE id = ?").run(otherOrgId),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("sets, finds and rotates a join code; a taken code is a conflict", async () => {
    const repo = await bootstrap(orgId, "flat-4b");
    await bootstrap(otherOrgId, "lunch-club");

    const fresh = await repo.getOrganizationById(orgId);
    expect(fresh.ok && fresh.value.joinCode).toBe(null);

    const set = await repo.setOrganizationJoinCode(orgId, "KTCH2345", at);
    expect(set.ok).toBe(true);
    if (set.ok) expect(set.value.joinCode).toBe("KTCH2345");

    const found = await repo.getOrganizationByJoinCode("KTCH2345");
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value.id).toBe(orgId);
    expect((await repo.getOrganizationByJoinCode("NOPE2345")).ok).toBe(false);

    // The lazy first mint never overwrites a code someone already minted.
    const lazy = await repo.setOrganizationJoinCode(orgId, "OTHER234", at, { onlyIfUnset: true });
    expect(lazy.ok).toBe(true);
    if (lazy.ok) expect(lazy.value.joinCode).toBe("KTCH2345");

    // Another org cannot take the code.
    const taken = await repo.setOrganizationJoinCode(otherOrgId, "KTCH2345", at);
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.error.kind).toBe("conflict");

    // Rotating replaces it, and the old code stops resolving.
    const rotated = await repo.setOrganizationJoinCode(orgId, "NEWC2345", new Date("2026-01-02T00:00:00.000Z"));
    expect(rotated.ok && rotated.value.joinCode).toBe("NEWC2345");
    expect((await repo.getOrganizationByJoinCode("KTCH2345")).ok).toBe(false);

    const missing = await repo.setOrganizationJoinCode(asUuid("41414141-4141-4141-8141-414141414141"), "MISS2345", at, { onlyIfUnset: true });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("not_found");
  });

  it("joins as a member with one builder role, once", async () => {
    const repo = await bootstrap(orgId, "flat-4b");
    const joinedAt = new Date("2026-01-03T00:00:00.000Z");

    const joined = await repo.joinOrganization(joinInput("usr_anu", joinedAt));
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.member.status).toBe("active");
    expect(joined.value.member.subjectId).toBe("usr_anu");
    expect(joined.value.roleAssignment.role).toBe("builder");
    expect(joined.value.roleAssignment.scopeKind).toBe("organization");

    const active = await repo.getActiveMemberBySubject(orgId, "usr_anu");
    expect(active.ok && active.value.id).toBe(joined.value.member.id);
    const members = await repo.countActiveMembers(orgId);
    expect(members.ok && members.value).toBe(2);

    // Already a member: a conflict, and nothing new is written.
    const again = await repo.joinOrganization(joinInput("usr_anu", new Date("2026-01-04T00:00:00.000Z")));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe("conflict");
    expect(count("SELECT COUNT(*) AS n FROM membership_organization_members WHERE org_id = ?", orgId)).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM membership_role_assignments WHERE org_id = ? AND subject_id = 'usr_anu'", orgId)).toBe(1);

    // The owner joining their own group by link is also just a conflict.
    const owner = await repo.joinOrganization(joinInput("usr_owner", new Date("2026-01-05T00:00:00.000Z")));
    expect(owner.ok).toBe(false);
    expect(count("SELECT COUNT(*) AS n FROM membership_role_assignments WHERE org_id = ? AND subject_id = 'usr_owner'", orgId)).toBe(1);
  });

  it("leaves in one batch, and a later join re-activates the same member row", async () => {
    const repo = await bootstrap(orgId, "flat-4b");
    const joined = await repo.joinOrganization(joinInput("usr_dev", new Date("2026-01-03T00:00:00.000Z")));
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const left = await repo.leaveOrganization({ orgId, subjectId: "usr_dev", at: new Date("2026-01-04T00:00:00.000Z") });
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    expect(left.value.member.status).toBe("removed");
    expect(left.value.revokedRoles.map((r) => r.role)).toEqual(["builder"]);
    expect((await repo.getActiveMemberBySubject(orgId, "usr_dev")).ok).toBe(false);
    expect(count("SELECT COUNT(*) AS n FROM membership_role_assignments WHERE org_id = ? AND subject_id = 'usr_dev' AND revoked_at IS NULL", orgId)).toBe(0);
    const members = await repo.countActiveMembers(orgId);
    expect(members.ok && members.value).toBe(1);

    // Leaving twice: not a member any more.
    const twice = await repo.leaveOrganization({ orgId, subjectId: "usr_dev", at: new Date("2026-01-05T00:00:00.000Z") });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.kind).toBe("not_found");

    // Coming back: the old row is re-activated with a fresh builder role.
    const back = await repo.joinOrganization(joinInput("usr_dev", new Date("2026-01-06T00:00:00.000Z")));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.member.id).toBe(joined.value.member.id);
    expect(back.value.member.status).toBe("active");
    expect(count("SELECT COUNT(*) AS n FROM membership_organization_members WHERE org_id = ? AND subject_id = 'usr_dev'", orgId)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM membership_role_assignments WHERE org_id = ? AND subject_id = 'usr_dev' AND revoked_at IS NULL", orgId)).toBe(1);
  });

  it("keeps the last owner while others remain, and lets them go once alone", async () => {
    const repo = await bootstrap(orgId, "flat-4b");
    expect((await repo.joinOrganization(joinInput("usr_anu", new Date("2026-01-03T00:00:00.000Z")))).ok).toBe(true);

    const blocked = await repo.leaveOrganization({ orgId, subjectId: "usr_owner", at: new Date("2026-01-04T00:00:00.000Z") });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toEqual({ kind: "conflict", entity: "last_owner" });
    expect((await repo.getActiveMemberBySubject(orgId, "usr_owner")).ok).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM membership_role_assignments WHERE org_id = ? AND subject_id = 'usr_owner' AND revoked_at IS NULL", orgId)).toBe(1);

    // The member leaves; the owner is now alone and may leave too.
    expect((await repo.leaveOrganization({ orgId, subjectId: "usr_anu", at: new Date("2026-01-05T00:00:00.000Z") })).ok).toBe(true);
    const alone = await repo.leaveOrganization({ orgId, subjectId: "usr_owner", at: new Date("2026-01-06T00:00:00.000Z") });
    expect(alone.ok).toBe(true);
    if (alone.ok) expect(alone.value.revokedRoles.map((r) => r.role)).toEqual(["owner"]);
  });

  it("lets one of two owners leave", async () => {
    const repo = await bootstrap(orgId, "flat-4b");
    expect((await repo.joinOrganization({ ...joinInput("usr_meera", new Date("2026-01-03T00:00:00.000Z")), role: "owner" })).ok).toBe(true);
    expect((await repo.joinOrganization(joinInput("usr_anu", new Date("2026-01-03T00:00:01.000Z")))).ok).toBe(true);

    const left = await repo.leaveOrganization({ orgId, subjectId: "usr_owner", at: new Date("2026-01-04T00:00:00.000Z") });
    expect(left.ok).toBe(true);
    const owners = await repo.countActiveOwners(orgId);
    expect(owners.ok && owners.value).toBe(1);

    // Meera is now the last owner, with Anu still in the group.
    const blocked = await repo.leaveOrganization({ orgId, subjectId: "usr_meera", at: new Date("2026-01-05T00:00:00.000Z") });
    expect(blocked.ok).toBe(false);
  });
});

// The kitchen's group settings (Cookpool CP-4, migration 210): one row per
// group, absent until first changed, with a currency fixed once the row exists.
// The lock lives inside the upsert's DO UPDATE … WHERE, so it is exactly the
// SQL a stubbed executor cannot vouch for.
describe("kitchen group settings, against a real SQLite engine", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  const orgId = asUuid("51515151-5151-4151-8151-515151515151");
  const otherOrgId = asUuid("61616161-6161-4161-8161-616161616161");
  const t0 = new Date("2026-11-01T00:00:00.000Z");
  const t1 = new Date("2026-11-02T00:00:00.000Z");

  beforeEach(() => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
  });

  afterEach(() => {
    db.close();
  });

  it("has no row for a group that never changed its settings", async () => {
    const got = await createKitchenRepository(executor).getGroupSettings(orgId);
    expect(got).toEqual({ ok: true, value: null });
  });

  it("creates the row with the defaults for whatever the first write leaves out", async () => {
    const repo = createKitchenRepository(executor);
    const created = await repo.upsertGroupSettings({ orgId, wastePolicy: "buyer_absorbs", now: t0 });
    expect(created).toEqual({
      ok: true,
      value: { orgId, currency: "INR", wastePolicy: "buyer_absorbs", createdAt: t0, updatedAt: t0 },
    });
    const other = await repo.upsertGroupSettings({ orgId: otherOrgId, currency: "USD", now: t0 });
    expect(other.ok && other.value).toMatchObject({ currency: "USD", wastePolicy: "split_equally" });
  });

  it("updates the waste rule, keeps created_at, and accepts the same currency", async () => {
    const repo = createKitchenRepository(executor);
    await repo.upsertGroupSettings({ orgId, currency: "EUR", now: t0 });
    const changed = await repo.upsertGroupSettings({ orgId, currency: "EUR", wastePolicy: "buyer_absorbs", now: t1 });
    expect(changed).toEqual({
      ok: true,
      value: { orgId, currency: "EUR", wastePolicy: "buyer_absorbs", createdAt: t0, updatedAt: t1 },
    });
    const kept = await repo.upsertGroupSettings({ orgId, now: t1 });
    expect(kept.ok && kept.value.wastePolicy).toBe("buyer_absorbs");
  });

  it("refuses a different currency once the row exists, and changes nothing", async () => {
    const repo = createKitchenRepository(executor);
    await repo.upsertGroupSettings({ orgId, now: t0 });
    const locked = await repo.upsertGroupSettings({ orgId, currency: "USD", wastePolicy: "buyer_absorbs", now: t1 });
    expect(locked).toEqual({ ok: false, error: { kind: "currency_locked", currency: "INR" } });
    const stored = await repo.getGroupSettings(orgId);
    expect(stored.ok && stored.value).toEqual({
      orgId, currency: "INR", wastePolicy: "split_equally", createdAt: t0, updatedAt: t0,
    });
  });

  it("checks the currency and the waste rule in the table itself", async () => {
    const insert = (currency: string, wastePolicy: string) => () =>
      db.prepare("INSERT INTO kitchen_group_settings (org_id, currency, waste_policy) VALUES (?, ?, ?)")
        .run(randomUUID(), currency, wastePolicy);
    expect(insert("INR", "split_equally")).not.toThrow();
    expect(insert("inr", "split_equally")).toThrow(/CHECK constraint failed/);
    expect(insert("RUPE", "split_equally")).toThrow(/CHECK constraint failed/);
    expect(insert("IN", "split_equally")).toThrow(/CHECK constraint failed/);
    expect(insert("INR", "nobody_pays")).toThrow(/CHECK constraint failed/);

    const refused = await createKitchenRepository(executor).upsertGroupSettings({ orgId, currency: "us$", now: t0 });
    expect(refused).toEqual({ ok: false, error: { kind: "invalid", reason: "settings_out_of_range" } });
  });

  it("defaults the timestamps to a parseable instant when a row is written without them", () => {
    db.prepare("INSERT INTO kitchen_group_settings (org_id) VALUES (?)").run(orgId);
    const row = db.prepare("SELECT currency, waste_policy, created_at FROM kitchen_group_settings").get() as {
      currency: string; waste_policy: string; created_at: string;
    };
    expect(row.currency).toBe("INR");
    expect(row.waste_policy).toBe("split_equally");
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

// The kitchen ledger (Cookpool CP-7, migration 220): append-only transactions
// and their splits, every money write one batch with its audit event, a
// unique idempotency key per group, and a transaction reversed at most once.
// Each rule lives in the SQL — a partial unique index, a conditional insert,
// a foreign key that fails the batch — so it is proved here, on SQLite.
describe("kitchen ledger, against a real SQLite engine", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  const orgId = asUuid("71717171-7171-4171-8171-717171717171");
  const otherOrgId = asUuid("81818181-8181-4181-8181-818181818181");
  const now = new Date("2026-11-02T09:00:00.000Z");
  let seq = 0;

  beforeEach(() => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
  });

  afterEach(() => {
    db.close();
  });

  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  function newTxn(overrides: Partial<NewKitchenTxn> = {}): NewKitchenTxn {
    seq += 1;
    return {
      id: asUuid(randomUUID()),
      orgId,
      kind: "expense",
      title: "Dinner",
      totalMinor: 900,
      currency: "INR",
      occurredAt: new Date(now.getTime() + seq * 1000),
      createdBy: "usr_rahul",
      idemKey: `key-${seq}`,
      now,
      ...overrides,
    };
  }

  const dinnerSplits = [
    { subjectId: "usr_rahul", paidMinor: 900, owedMinor: 300 },
    { subjectId: "usr_anu", paidMinor: 0, owedMinor: 300 },
    { subjectId: "usr_dev", paidMinor: 0, owedMinor: 300 },
  ];

  function audit(txnId: string, eventId = randomUUID().replace(/-/g, "")): AppendEventWithAuditInput {
    return {
      event: {
        id: eventId,
        type: "kitchen.expense.added",
        version: 1,
        source: "kitchen-worker",
        occurredAt: now,
        actorType: "user",
        actorId: "usr_rahul",
        orgId,
        subjectKind: "kitchen_txn",
        subjectId: txnId,
        requestId: "req_ledger",
        payload: {},
      },
      audit: { id: randomUUID().replace(/-/g, ""), category: "kitchen", description: "Expense" },
    };
  }

  it("posts the transaction, its splits in order and its audit event in one batch", async () => {
    const repo = createKitchenRepository(executor);
    const txn = newTxn({ note: "Thali" });
    const posted = await repo.postTxn({ txn, splits: dinnerSplits, audit: audit(txn.id) });
    expect(posted.ok && posted.value.replayed).toBe(false);
    expect(count("kitchen_txns")).toBe(1);
    expect(count("kitchen_txn_splits")).toBe(3);
    expect(count("events_event_log")).toBe(1);
    expect(count("events_audit_entries")).toBe(1);

    const got = await repo.getTxn(orgId, txn.id);
    expect(got.ok && got.value).toMatchObject({
      id: txn.id, orgId, kind: "expense", totalMinor: 900, currency: "INR", note: "Thali",
      reverses: null, reversedBy: null, method: null, idemKey: txn.idemKey, splits: dinnerSplits,
    });
    expect(await repo.getTxn(otherOrgId, txn.id)).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("writes nothing when a later statement of the batch fails", async () => {
    const repo = createKitchenRepository(executor);
    const first = newTxn();
    const eventId = randomUUID().replace(/-/g, "");
    await repo.postTxn({ txn: first, splits: dinnerSplits, audit: audit(first.id, eventId) });

    // The second post's event id collides, so its LAST statements fail after
    // its transaction and splits were inserted: the batch must roll them back.
    const second = newTxn();
    const failed = await repo.postTxn({ txn: second, splits: dinnerSplits, audit: audit(second.id, eventId) });
    expect(failed.ok).toBe(false);
    expect(count("kitchen_txns")).toBe(1);
    expect(count("kitchen_txn_splits")).toBe(3);
    expect(count("events_event_log")).toBe(1);
  });

  it("answers a repeated idempotency key with the transaction it posted, writing nothing", async () => {
    const repo = createKitchenRepository(executor);
    const txn = newTxn();
    await repo.postTxn({ txn, splits: dinnerSplits, audit: audit(txn.id) });
    const again = await repo.postTxn({
      txn: { ...newTxn(), idemKey: txn.idemKey, totalMinor: 100 },
      splits: [{ subjectId: "usr_anu", paidMinor: 100, owedMinor: 100 }],
      audit: audit("ignored"),
    });
    expect(again.ok && again.value.replayed).toBe(true);
    expect(again.ok && again.value.txn.id).toBe(txn.id);
    expect(count("kitchen_txns")).toBe(1);
    expect(count("events_event_log")).toBe(1);

    // The same key in another group is another request.
    const elsewhere = await repo.postTxn({ txn: { ...newTxn(), orgId: otherOrgId, idemKey: txn.idemKey }, splits: dinnerSplits });
    expect(elsewhere.ok && elsewhere.value.replayed).toBe(false);
  });

  it("pins the group's currency with its first transaction and refuses another", async () => {
    const repo = createKitchenRepository(executor);
    expect(await repo.getGroupSettings(orgId)).toEqual({ ok: true, value: null });
    await repo.postTxn({ txn: newTxn(), splits: dinnerSplits });
    const settings = await repo.getGroupSettings(orgId);
    expect(settings.ok && settings.value).toMatchObject({ currency: "INR", wastePolicy: "split_equally" });

    const usd = newTxn({ currency: "USD" });
    const refused = await repo.postTxn({ txn: usd, splits: dinnerSplits, audit: audit(usd.id) });
    expect(refused).toEqual({ ok: false, error: { kind: "currency_mismatch", currency: "INR" } });
    expect(count("kitchen_txns")).toBe(1);
    expect(count("events_event_log")).toBe(0);
    // And the settings currency stays locked.
    const locked = await repo.upsertGroupSettings({ orgId, currency: "USD", now });
    expect(locked.ok).toBe(false);
  });

  it("posts in a currency the group saved before its first transaction", async () => {
    const repo = createKitchenRepository(executor);
    await repo.upsertGroupSettings({ orgId, currency: "EUR", now });
    expect((await repo.postTxn({ txn: newTxn({ currency: "EUR" }), splits: dinnerSplits })).ok).toBe(true);
    const inr = await repo.postTxn({ txn: newTxn(), splits: dinnerSplits });
    expect(inr).toEqual({ ok: false, error: { kind: "currency_mismatch", currency: "EUR" } });
  });

  it.each([
    ["unbalanced", [{ subjectId: "usr_a", paidMinor: 900, owedMinor: 899 }]],
    ["duplicate_subject", [{ subjectId: "usr_a", paidMinor: 900, owedMinor: 0 }, { subjectId: "usr_a", paidMinor: 0, owedMinor: 900 }]],
    ["split_out_of_range", [{ subjectId: "usr_a", paidMinor: 1000, owedMinor: 900 }, { subjectId: "usr_b", paidMinor: -100, owedMinor: 0 }]],
    ["no_splits", []],
  ])("refuses splits that break the invariant (%s) before writing", async (reason, splits) => {
    const result = await createKitchenRepository(executor).postTxn({ txn: newTxn(), splits });
    expect(result).toEqual({ ok: false, error: { kind: "invalid", reason } });
    expect(count("kitchen_txns")).toBe(0);
  });

  it("reverses a transaction once, swapping paid and owed", async () => {
    const repo = createKitchenRepository(executor);
    const txn = newTxn();
    await repo.postTxn({ txn, splits: dinnerSplits });
    const original = await repo.getTxn(orgId, txn.id);
    if (!original.ok) throw new Error("not posted");

    const swapped = dinnerSplits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor }));
    const reversal = { id: asUuid(randomUUID()), title: "Reversal: Dinner", occurredAt: now, createdBy: "usr_rahul", idemKey: "undo-1", now };
    const first = await repo.reverseTxn({ original: original.value, reversal, splits: swapped });
    expect(first.ok && first.value.txn).toMatchObject({ kind: "reversal", reverses: txn.id, totalMinor: 900, currency: "INR" });

    const reread = await repo.getTxn(orgId, txn.id);
    expect(reread.ok && reread.value.reversedBy).toBe(reversal.id);

    const second = await repo.reverseTxn({
      original: original.value,
      reversal: { ...reversal, id: asUuid(randomUUID()), idemKey: "undo-2" },
      splits: swapped,
    });
    expect(second).toEqual({ ok: false, error: { kind: "already_reversed", reversedBy: reversal.id } });

    const replay = await repo.reverseTxn({
      original: original.value,
      reversal: { ...reversal, id: asUuid(randomUUID()) },
      splits: swapped,
    });
    expect(replay.ok && replay.value).toMatchObject({ replayed: true, txn: { id: reversal.id } });
    expect(count("kitchen_txns")).toBe(2);
  });

  it("lists activity newest first with splits, paging by cursor", async () => {
    const repo = createKitchenRepository(executor);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const txn = newTxn({ title: `Meal ${i}` });
      ids.push(txn.id);
      await repo.postTxn({ txn, splits: dinnerSplits });
    }
    await repo.postTxn({ txn: newTxn({ orgId: otherOrgId }), splits: dinnerSplits });

    const first = await repo.listActivity(orgId, { cursor: null, limit: 3 });
    if (!first.ok) throw new Error("list failed");
    expect(first.value.items.map((t) => t.id)).toEqual([ids[4], ids[3], ids[2]]);
    expect(first.value.items.every((t) => t.splits.length === 3)).toBe(true);
    expect(first.value.nextCursor).not.toBeNull();

    const rest = await repo.listActivity(orgId, { cursor: first.value.nextCursor, limit: 3 });
    expect(rest.ok && rest.value.items.map((t) => t.id)).toEqual([ids[1], ids[0]]);
    expect(rest.ok && rest.value.nextCursor).toBeNull();
  });

  it("loads the whole ledger, oldest first, for balances", async () => {
    const repo = createKitchenRepository(executor);
    const a = newTxn();
    const b = newTxn({ kind: "settlement", title: "Payment", totalMinor: 300, method: "upi" });
    await repo.postTxn({ txn: a, splits: dinnerSplits });
    await repo.postTxn({
      txn: b,
      splits: [
        { subjectId: "usr_anu", paidMinor: 300, owedMinor: 0 },
        { subjectId: "usr_rahul", paidMinor: 0, owedMinor: 300 },
      ],
    });
    const ledger = await repo.listSplitsForGroup(orgId);
    expect(ledger.ok && ledger.value.map((t) => [t.id, t.kind, t.splits.length])).toEqual([
      [a.id, "expense", 3],
      [b.id, "settlement", 2],
    ]);
    expect(await repo.listSplitsForGroup(otherOrgId)).toEqual({ ok: true, value: [] });
  });

  it("flags a transaction once per idempotency key, and lists its flags", async () => {
    const repo = createKitchenRepository(executor);
    const txn = newTxn();
    await repo.postTxn({ txn, splits: dinnerSplits });
    const input = { id: asUuid(randomUUID()), txnId: txn.id, orgId, subjectId: "usr_anu", reason: "I wasn't there", idemKey: "flag-1", now };
    const created = await repo.createFlag(input);
    expect(created.ok && created.value).toMatchObject({ replayed: false, flag: { state: "open", reason: "I wasn't there" } });
    const again = await repo.createFlag({ ...input, id: asUuid(randomUUID()) });
    expect(again.ok && again.value).toMatchObject({ replayed: true, flag: { id: input.id } });
    const flags = await repo.listFlags(orgId, txn.id);
    expect(flags.ok && flags.value.map((f) => f.id)).toEqual([input.id]);
    expect(await repo.listFlags(otherOrgId, txn.id)).toEqual({ ok: true, value: [] });

    const missing = await repo.createFlag({ ...input, id: asUuid(randomUUID()), txnId: asUuid(randomUUID()), idemKey: "flag-2" });
    expect(missing).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("checks kinds, amounts, reversals and settlement methods in the tables themselves", () => {
    const insertTxn = (values: { kind?: string; total?: number; reverses?: string | null; method?: string | null }) => () =>
      db.prepare(
        `INSERT INTO kitchen_txns (id, org_id, kind, title, total_minor, currency, occurred_at, created_by, reverses, method, idem_key)
         VALUES (?, ?, ?, 'x', ?, 'INR', '2026-11-02T00:00:00.000Z', 'usr_a', ?, ?, ?)`,
      ).run(randomUUID(), orgId, values.kind ?? "expense", values.total ?? 0, values.reverses ?? null, values.method ?? null, randomUUID());
    expect(insertTxn({})).not.toThrow();
    expect(insertTxn({ kind: "gift" })).toThrow(/CHECK constraint failed/);
    expect(insertTxn({ total: -1 })).toThrow(/CHECK constraint failed/);
    expect(insertTxn({ kind: "reversal" })).toThrow(/CHECK constraint failed/);
    expect(insertTxn({ method: "upi" })).toThrow(/CHECK constraint failed/);
    expect(insertTxn({ kind: "settlement", method: "upi" })).not.toThrow();
    expect(insertTxn({ kind: "settlement", method: "cheque" })).toThrow(/CHECK constraint failed/);
    expect(insertTxn({ kind: "reversal", reverses: randomUUID() })).toThrow(/FOREIGN KEY constraint failed/);

    const txnId = randomUUID();
    db.prepare(
      `INSERT INTO kitchen_txns (id, org_id, kind, title, total_minor, currency, occurred_at, created_by, idem_key)
       VALUES (?, ?, 'expense', 'x', 5, 'INR', '2026-11-02T00:00:00.000Z', 'usr_a', 'k')`,
    ).run(txnId, orgId);
    const split = (subject: string, paid: number, owed: number) => () =>
      db.prepare("INSERT INTO kitchen_txn_splits (txn_id, subject_id, position, paid_minor, owed_minor) VALUES (?, ?, 0, ?, ?)")
        .run(txnId, subject, paid, owed);
    expect(split("usr_a", 5, 0)).not.toThrow();
    expect(split("usr_a", 0, 5)).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
    expect(split("usr_b", -1, 0)).toThrow(/CHECK constraint failed/);
    expect(split("usr_c", 0, -1)).toThrow(/CHECK constraint failed/);
    // The same idempotency key twice in one group.
    expect(() =>
      db.prepare(
        `INSERT INTO kitchen_txns (id, org_id, kind, title, total_minor, currency, occurred_at, created_by, idem_key)
         VALUES (?, ?, 'expense', 'x', 5, 'INR', '2026-11-02T00:00:00.000Z', 'usr_a', 'k')`,
      ).run(randomUUID(), orgId),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
