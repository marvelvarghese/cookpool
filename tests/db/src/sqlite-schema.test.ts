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
import { createKitchenRepository, type NewKitchenItem, type NewKitchenTxn } from "@saas/db/kitchen";
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

  // A person's groups (Cookpool CP-10): every active role they hold, in every
  // organization, in one read — what membership-worker answers kitchen-worker's
  // "which pantries can I reach" with.
  it("lists one subject's active roles across every organization", async () => {
    const repo = await bootstrap(orgId, "flat-4b", "usr_anu");
    await bootstrap(otherOrgId, "lunch-club");
    expect((await repo.joinOrganization(joinInput("usr_anu", new Date("2026-01-03T00:00:00.000Z"), otherOrgId))).ok).toBe(true);

    const roles = await repo.listRoleAssignmentsForSubjectAcrossOrgs!("usr_anu");
    expect(roles.ok && roles.value.map((r) => [r.orgId, r.role]).sort()).toEqual(
      [[orgId, "owner"], [otherOrgId, "builder"]].sort(),
    );

    // Leaving revokes the role: it is no longer listed.
    expect((await repo.leaveOrganization({ orgId: otherOrgId, subjectId: "usr_anu", at: new Date("2026-01-04T00:00:00.000Z") })).ok).toBe(true);
    const after = await repo.listRoleAssignmentsForSubjectAcrossOrgs!("usr_anu");
    expect(after.ok && after.value.map((r) => r.orgId)).toEqual([orgId]);
    expect(await repo.listRoleAssignmentsForSubjectAcrossOrgs!("usr_nobody")).toEqual({ ok: true, value: [] });
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

  // CP-19's inbox: every open flag on someone's transactions across their
  // groups, in one read.
  it("lists the open flags others raised on someone's transactions, oldest first, in one read", async () => {
    const repo = createKitchenRepository(executor);
    const post = async (overrides: Partial<NewKitchenTxn> = {}) => {
      const txn = newTxn(overrides);
      const posted = await repo.postTxn({ txn, splits: dinnerSplits });
      if (!posted.ok) throw new Error("not posted");
      return txn;
    };
    let flagSeq = 0;
    const flag = async (txn: NewKitchenTxn, subjectId: string, reason = "Not me") => {
      flagSeq += 1;
      const id = asUuid(randomUUID());
      const created = await repo.createFlag({
        id, txnId: txn.id, orgId: txn.orgId, subjectId, reason, idemKey: `flag-${flagSeq}`,
        now: new Date(now.getTime() + flagSeq * 1000),
      });
      if (!created.ok) throw new Error("not flagged");
      return id;
    };

    const dinner = await post({ title: "Dinner" });
    const groceries = await post({ title: "Groceries", totalMinor: 900 });
    const own = await post({ title: "Own entry" });
    const undone = await post({ title: "Undone" });
    const anus = await post({ title: "Anu's", createdBy: "usr_anu" });
    const elsewhere = await post({ title: "Elsewhere", orgId: otherOrgId });

    const anuOnDinner = await flag(dinner, "usr_anu", "I wasn't there");
    const devOnGroceries = await flag(groceries, "usr_dev");
    const devOnDinner = await flag(dinner, "usr_dev");
    await flag(own, "usr_rahul"); // raised on his own entry
    await flag(undone, "usr_anu"); // the transaction is reversed below
    await flag(anus, "usr_dev"); // someone else's transaction
    const otherGroup = await flag(elsewhere, "usr_anu");
    const resolved = await flag(groceries, "usr_anu");
    db.prepare("UPDATE kitchen_flags SET state = 'resolved' WHERE id = ?").run(resolved);

    const original = await repo.getTxn(orgId, undone.id);
    if (!original.ok) throw new Error("not posted");
    const swapped = dinnerSplits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor }));
    const reversed = await repo.reverseTxn({
      original: original.value,
      reversal: { id: asUuid(randomUUID()), title: "Reversal: Undone", occurredAt: now, createdBy: "usr_rahul", idemKey: "undo-flagged", now },
      splits: swapped,
    });
    expect(reversed.ok).toBe(true);

    const mine = await repo.listOpenFlagsOnTxnsBy({ createdBy: "usr_rahul", orgIds: [orgId], limit: 50 });
    if (!mine.ok) throw new Error("read failed");
    expect(mine.value.map((f) => f.flagId)).toEqual([anuOnDinner, devOnGroceries, devOnDinner]);
    expect(mine.value[0]).toEqual({
      flagId: anuOnDinner,
      txnId: dinner.id,
      orgId,
      flaggedBy: "usr_anu",
      reason: "I wasn't there",
      flaggedAt: new Date(now.getTime() + 1000),
      title: "Dinner",
      txnKind: "expense",
      totalMinor: 900,
      currency: "INR",
      sourceKind: null,
      sourceId: null,
    });

    // Every group asked for, in one read; none asked for, nothing read.
    const both = await repo.listOpenFlagsOnTxnsBy({ createdBy: "usr_rahul", orgIds: [orgId, otherOrgId], limit: 50 });
    expect(both.ok && both.value.map((f) => f.flagId)).toEqual([anuOnDinner, devOnGroceries, devOnDinner, otherGroup]);
    expect(await repo.listOpenFlagsOnTxnsBy({ createdBy: "usr_rahul", orgIds: [], limit: 50 })).toEqual({ ok: true, value: [] });

    // At most `limit`, the oldest kept.
    const capped = await repo.listOpenFlagsOnTxnsBy({ createdBy: "usr_rahul", orgIds: [orgId, otherOrgId], limit: 2 });
    expect(capped.ok && capped.value.map((f) => f.flagId)).toEqual([anuOnDinner, devOnGroceries]);

    // Anu's own transaction, flagged by Dev, is hers to see.
    const hers = await repo.listOpenFlagsOnTxnsBy({ createdBy: "usr_anu", orgIds: [orgId, otherOrgId], limit: 50 });
    expect(hers.ok && hers.value.map((f) => [f.title, f.flaggedBy])).toEqual([["Anu's", "usr_dev"]]);
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

// Pantries (Cookpool CP-10, migration 230): an item belongs to exactly one
// pantry — a person's or a group's — and its stock never goes below zero or
// above what was bought. A group item is in the group's currency, pinned by
// the same batch that adds it; edits to what was bought stop once anything is
// used. Every rule is SQL (CHECKs, a NOT NULL that fails the batch, conditional
// UPDATEs, json_each scopes), so it is proved here, on SQLite.
describe("kitchen pantries, against a real SQLite engine", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  const orgId = asUuid("91919191-9191-4191-8191-919191919191");
  const otherOrgId = asUuid("a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1");
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

  function newItem(overrides: Partial<NewKitchenItem> = {}): NewKitchenItem {
    seq += 1;
    return {
      id: asUuid(randomUUID()),
      owner: { kind: "user", subjectId: "usr_rahul" },
      name: `Item ${seq}`,
      category: "Veg",
      dimension: "mass",
      displayUnit: "kg",
      qtyMilli: 1_000_000,
      priceMinor: 4000,
      currency: "INR",
      paidBy: "usr_rahul",
      boughtOn: "2026-11-01",
      expiresOn: null,
      wastePolicy: null,
      createdBy: "usr_rahul",
      idemKey: `add-${seq}`,
      now,
      ...overrides,
    };
  }

  const group = { kind: "group", orgId } as const;
  const me = { kind: "user", subjectId: "usr_rahul" } as const;

  it("adds a personal item and a group item; the group's first item pins its currency", async () => {
    const repo = createKitchenRepository(executor);
    const personal = await repo.createItem({ item: newItem({ currency: "USD" }) });
    expect(personal.ok && personal.value.item).toMatchObject({
      ownerKind: "user", ownerSubjectId: "usr_rahul", orgId: null, currency: "USD",
      qtyBoughtMilli: 1_000_000, qtyLeftMilli: 1_000_000, costTakenMinor: 0, state: "active", version: 1,
    });
    expect(await repo.getGroupSettings(orgId)).toEqual({ ok: true, value: null });

    const added = await repo.createItem({ item: newItem({ owner: group }) });
    expect(added.ok && added.value.item).toMatchObject({ ownerKind: "group", ownerSubjectId: null, orgId, currency: "INR" });
    const settings = await repo.getGroupSettings(orgId);
    expect(settings.ok && settings.value).toMatchObject({ currency: "INR", wastePolicy: "split_equally" });

    // Another currency now writes nothing.
    const usd = await repo.createItem({ item: newItem({ owner: group, currency: "USD" }) });
    expect(usd).toEqual({ ok: false, error: { kind: "currency_mismatch", currency: "INR" } });
    expect(count("kitchen_items")).toBe(2);
  });

  it("answers a repeated key in the same pantry with the item it added", async () => {
    const repo = createKitchenRepository(executor);
    const first = await repo.createItem({ item: newItem({ owner: group, idemKey: "same" }) });
    const again = await repo.createItem({ item: newItem({ owner: group, idemKey: "same" }) });
    expect(again.ok && again.value).toMatchObject({ replayed: true, item: { id: first.ok && first.value.item.id } });
    // The same key in another pantry is another request.
    expect((await repo.createItem({ item: newItem({ owner: { kind: "group", orgId: otherOrgId }, idemKey: "same" }) })).ok).toBe(true);
    expect((await repo.createItem({ item: newItem({ idemKey: "same" }) })).ok).toBe(true);
    expect(count("kitchen_items")).toBe(3);
  });

  it("reads an item only in its own pantry, and never once removed", async () => {
    const repo = createKitchenRepository(executor);
    const item = newItem();
    await repo.createItem({ item });
    expect((await repo.getItem(me, item.id)).ok).toBe(true);
    expect(await repo.getItem({ kind: "user", subjectId: "usr_anu" }, item.id)).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(await repo.getItem(group, item.id)).toEqual({ ok: false, error: { kind: "not_found" } });
    const removed = await repo.removeItem(me, item.id, now);
    expect(removed.ok && removed.value).toMatchObject({ state: "removed", version: 2 });
    expect(await repo.getItem(me, item.id)).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("edits what was bought only while nothing is used, and only at the expected version", async () => {
    const repo = createKitchenRepository(executor);
    const item = newItem();
    await repo.createItem({ item });
    const edited = await repo.updateItem({
      owner: me, itemId: item.id, now,
      changes: { name: "Tomatoes", quantity: { dimension: "count", displayUnit: "pcs", qtyMilli: 6000 }, priceMinor: 3000 },
    });
    expect(edited.ok && edited.value).toMatchObject({
      name: "Tomatoes", dimension: "count", displayUnit: "pcs", qtyBoughtMilli: 6000, qtyLeftMilli: 6000, priceMinor: 3000, version: 2,
    });
    const stale = await repo.updateItem({ owner: me, itemId: item.id, changes: { name: "x" }, expectedVersion: 1, now });
    expect(stale).toEqual({ ok: false, error: { kind: "version_conflict", version: 2 } });

    db.prepare("UPDATE kitchen_items SET qty_left_milli = 4000, cost_taken_minor = 1000 WHERE id = ?").run(item.id);
    const refused = await repo.updateItem({ owner: me, itemId: item.id, changes: { priceMinor: 1 }, now });
    expect(refused).toEqual({ ok: false, error: { kind: "item_used" } });
    expect(await repo.removeItem(me, item.id, now)).toEqual({ ok: false, error: { kind: "item_used" } });
    const renamed = await repo.updateItem({ owner: me, itemId: item.id, changes: { name: "Cherry tomatoes" }, expectedVersion: 2, now });
    expect(renamed.ok && renamed.value).toMatchObject({ name: "Cherry tomatoes", priceMinor: 3000, version: 3 });
  });

  it("lists and totals across a scope bound as one JSON parameter, however many groups", async () => {
    const repo = createKitchenRepository(executor);
    await repo.createItem({ item: newItem({ name: "Milk", expiresOn: "2026-11-03" }) });
    await repo.createItem({ item: newItem({ name: "Curd", expiresOn: "2026-10-30", priceMinor: 500 }) });
    await repo.createItem({ item: newItem({ owner: group, name: "Eggs", expiresOn: "2026-11-02" }) });
    await repo.createItem({ item: newItem({ owner: { kind: "group", orgId: otherOrgId }, name: "Onions" }) });
    await repo.createItem({ item: newItem({ owner: { kind: "user", subjectId: "usr_anu" }, name: "Anu's" }) });

    // 150 groups: more than D1 lets one statement bind, as one parameter.
    const orgIds = [orgId, ...Array.from({ length: 149 }, () => randomUUID())];
    const page = await repo.listItems({ ownerSubjectId: "usr_rahul", orgIds, q: null, expires: null, cursor: null, limit: 10 });
    expect(page.ok && page.value.items.map((i) => i.name)).toEqual(["Curd", "Eggs", "Milk"]);

    const soon = await repo.listItems({
      ownerSubjectId: "usr_rahul", orgIds, q: null, expires: { from: "2026-11-02", to: "2026-11-05" }, cursor: null, limit: 10,
    });
    expect(soon.ok && soon.value.items.map((i) => i.name)).toEqual(["Eggs", "Milk"]);

    const totals = await repo.pantryTotals({ ownerSubjectId: "usr_rahul", orgIds, today: "2026-11-02", soonUntil: "2026-11-05" });
    expect(totals.ok && totals.value).toEqual([
      { orgId: null, currency: "INR", itemCount: 2, useSoonCount: 1, expiredCount: 1, worthMinor: 4500 },
      { orgId, currency: "INR", itemCount: 1, useSoonCount: 1, expiredCount: 0, worthMinor: 4000 },
    ]);
    const settings = await repo.listGroupSettings(orgIds);
    expect(settings.ok && settings.value.map((s) => s.orgId)).toEqual([orgId]);
    expect(await repo.listGroupSettings([])).toEqual({ ok: true, value: [] });
  });

  it("checks the owner, stock, money and state rules in the table itself", () => {
    const insert = (values: Record<string, unknown>) => () => {
      const row = {
        id: randomUUID(), owner_kind: "user", owner_subject_id: "usr_a", org_id: null, qty_bought_milli: 1000,
        qty_left_milli: 1000, price_minor: 100, cost_taken_minor: 0, waste_policy: null, state: "active", dimension: "mass",
        currency: "INR", ...values,
      };
      db.prepare(
        `INSERT INTO kitchen_items (id, owner_kind, owner_subject_id, org_id, name, category, dimension, display_unit,
           qty_bought_milli, qty_left_milli, price_minor, cost_taken_minor, currency, paid_by, bought_on, waste_policy,
           state, created_by, idem_key)
         VALUES (?, ?, ?, ?, 'x', 'y', ?, 'g', ?, ?, ?, ?, ?, 'usr_a', '2026-11-02', ?, ?, 'usr_a', ?)`,
      ).run(
        row.id as string, row.owner_kind as string, row.owner_subject_id as string | null, row.org_id as string | null,
        row.dimension as string, row.qty_bought_milli as number, row.qty_left_milli as number, row.price_minor as number,
        row.cost_taken_minor as number, row.currency as string, row.waste_policy as string | null, row.state as string, randomUUID(),
      );
    };
    expect(insert({})).not.toThrow();
    expect(insert({ owner_kind: "group", owner_subject_id: null, org_id: orgId, waste_policy: "buyer_absorbs" })).not.toThrow();
    expect(insert({ org_id: orgId })).toThrow(/CHECK constraint failed/);
    expect(insert({ owner_kind: "group", org_id: orgId })).toThrow(/CHECK constraint failed/);
    expect(insert({ owner_subject_id: null })).toThrow(/CHECK constraint failed/);
    expect(insert({ waste_policy: "buyer_absorbs" })).toThrow(/CHECK constraint failed/);
    expect(insert({ qty_left_milli: 1001 })).toThrow(/CHECK constraint failed/);
    expect(insert({ qty_left_milli: -1 })).toThrow(/CHECK constraint failed/);
    expect(insert({ qty_bought_milli: 0, qty_left_milli: 0 })).toThrow(/CHECK constraint failed/);
    expect(insert({ price_minor: -1 })).toThrow(/CHECK constraint failed/);
    expect(insert({ cost_taken_minor: 101 })).toThrow(/CHECK constraint failed/);
    expect(insert({ state: "eaten" })).toThrow(/CHECK constraint failed/);
    expect(insert({ dimension: "weight" })).toThrow(/CHECK constraint failed/);
    expect(insert({ currency: "inr" })).toThrow(/CHECK constraint failed/);
  });

  it("records stock moves against an item, and a transaction when one moved money", async () => {
    const repo = createKitchenRepository(executor);
    const item = newItem();
    await repo.createItem({ item });
    const firstId = randomUUID();
    const move = (values: {
      id?: string;
      item?: string;
      kind?: string;
      qty?: number;
      cost?: number;
      txn?: string | null;
      reverses?: string | null;
    }) => () =>
      db.prepare(
        `INSERT INTO kitchen_stock_moves (id, item_id, kind, qty_milli, cost_minor, actor, txn_id, reverses)
         VALUES (?, ?, ?, ?, ?, 'usr_rahul', ?, ?)`,
      ).run(
        values.id ?? randomUUID(), values.item ?? item.id, values.kind ?? "use", values.qty ?? 100, values.cost ?? 10,
        values.txn ?? null, values.reverses ?? null,
      );
    expect(move({ id: firstId })).not.toThrow();
    for (const kind of ["dish", "waste", "transfer", "adjust"]) expect(move({ kind })).not.toThrow();
    // A reversal names the move it puts back (240_kitchen_stock_moves), and only a reversal does.
    expect(move({ kind: "reversal", reverses: firstId })).not.toThrow();
    expect(move({ kind: "reversal" })).toThrow(/CHECK constraint failed/);
    expect(move({ kind: "use", reverses: firstId })).toThrow(/CHECK constraint failed/);
    expect(move({ kind: "gift" })).toThrow(/CHECK constraint failed/);
    expect(move({ qty: 0 })).toThrow(/CHECK constraint failed/);
    expect(move({ cost: -1 })).toThrow(/CHECK constraint failed/);
    expect(move({ item: randomUUID() })).toThrow(/FOREIGN KEY constraint failed/);
    expect(move({ txn: randomUUID() })).toThrow(/FOREIGN KEY constraint failed/);
    expect(count("kitchen_stock_moves")).toBe(6);
  });

  it("puts a move back at most once, and keeps a request's key once per item (240_kitchen_stock_moves)", async () => {
    const repo = createKitchenRepository(executor);
    const item = newItem();
    const other = newItem();
    await repo.createItem({ item });
    await repo.createItem({ item: other });
    const insert = (values: { kind?: string; reverses?: string; idem?: string; consumers?: string; on?: string }) => {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO kitchen_stock_moves (id, item_id, kind, qty_milli, cost_minor, actor, reverses, idem_key, consumers, unit)
         VALUES (?, ?, ?, 100, 10, 'usr_rahul', ?, ?, ?, 'g')`,
      ).run(id, values.on ?? item.id, values.kind ?? "use", values.reverses ?? null, values.idem ?? null, values.consumers ?? null);
      return id;
    };
    const used = insert({ idem: "use-1", consumers: JSON.stringify(["usr_rahul", "usr_anu"]) });
    insert({ kind: "reversal", reverses: used });
    expect(() => insert({ kind: "reversal", reverses: used })).toThrow(/UNIQUE constraint failed/);
    expect(() => insert({ idem: "use-1" })).toThrow(/UNIQUE constraint failed/);
    // The same key on another item is another request; moves without a key never collide.
    expect(() => insert({ idem: "use-1", on: other.id })).not.toThrow();
    expect(() => insert({})).not.toThrow();
    expect(() => insert({})).not.toThrow();
    expect(() => insert({ consumers: "{}" })).toThrow(/CHECK constraint failed/);
    expect(() => insert({ consumers: "not json" })).toThrow(/CHECK constraint failed/);
    expect(() => insert({ reverses: randomUUID(), kind: "reversal" })).toThrow(/FOREIGN KEY constraint failed/);
  });
});

// Dishes (Cookpool CP-14, migration 250): a dish and its ingredients, written
// in ONE batch with the stock it takes and the cook's charge in each source
// group; cancelled in one batch that reverses both.
describe("kitchen dishes, against a real SQLite engine", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  const orgId = asUuid("c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1");
  const now = new Date("2026-11-02T12:00:00.000Z");
  const me = { kind: "user", subjectId: "usr_rahul" } as const;
  const group = { kind: "group", orgId } as const;
  let seq = 0;

  beforeEach(() => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
  });

  afterEach(() => {
    db.close();
  });

  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  function newItem(overrides: Partial<NewKitchenItem> = {}): NewKitchenItem {
    seq += 1;
    return {
      id: asUuid(randomUUID()),
      owner: me,
      name: `Item ${seq}`,
      category: "Veg",
      dimension: "mass",
      displayUnit: "g",
      qtyMilli: 1_000_000,
      priceMinor: 4000,
      currency: "INR",
      paidBy: "usr_rahul",
      boughtOn: "2026-11-01",
      expiresOn: null,
      wastePolicy: null,
      createdBy: "usr_rahul",
      idemKey: `add-${seq}`,
      now,
      ...overrides,
    };
  }

  /** Paneer from Rahul's pantry (all 200 g, ₹95.00) and 300 g of Anu's tomatoes from the group (₹12.00). */
  async function cook(idemKey = "cook-1") {
    const repo = createKitchenRepository(executor);
    const paneer = newItem({ qtyMilli: 200_000, priceMinor: 9500 });
    const tomatoes = newItem({ owner: group, paidBy: "usr_anu" });
    for (const item of [paneer, tomatoes]) expect((await repo.createItem({ item })).ok).toBe(true);
    const dishId = asUuid(randomUUID());
    const txnId = asUuid(randomUUID());
    const txn: NewKitchenTxn = {
      id: txnId, orgId, kind: "use", title: "Paneer: Tomatoes (300 g)", totalMinor: 1200, currency: "INR",
      occurredAt: now, createdBy: "usr_rahul", sourceKind: "dish", sourceId: dishId, idemKey: `dish_${dishId}`, now,
    };
    const input = {
      dish: {
        id: dishId, cook: "usr_rahul", orgId, name: "Paneer", portionsHalf: 8, extrasMinor: 1500, currency: "INR",
        splitMode: "claims" as const, state: "open" as const, idemKey, now,
      },
      newItems: [],
      ingredients: [
        {
          owner: me, itemId: paneer.id, expectedVersion: 1, qtyMilli: 200_000, unit: "g", costMinor: 9500,
          paidBy: "usr_rahul", useTxnId: null, moveId: asUuid(randomUUID()),
        },
        {
          owner: group, itemId: tomatoes.id, expectedVersion: 1, qtyMilli: 300_000, unit: "g", costMinor: 1200,
          paidBy: "usr_anu", useTxnId: txnId, moveId: asUuid(randomUUID()),
        },
      ],
      txns: [{
        txn,
        splits: [
          { subjectId: "usr_anu", paidMinor: 1200, owedMinor: 0 },
          { subjectId: "usr_rahul", paidMinor: 0, owedMinor: 1200 },
        ],
      }],
      audits: [],
    };
    return { repo, paneer, tomatoes, dishId, txnId, input };
  }

  const itemRow = (id: string) =>
    db.prepare("SELECT qty_left_milli, cost_taken_minor, state, version FROM kitchen_items WHERE id = ?").get(id) as {
      qty_left_milli: number; cost_taken_minor: number; state: string; version: number;
    };

  it("cooks in one batch: the dish, its ingredients, the stock it takes and the cook's charge; a retry writes nothing", async () => {
    const { repo, paneer, tomatoes, dishId, txnId, input } = await cook();
    const cooked = await repo.cookDish(input);
    expect(cooked.ok && cooked.value.replayed).toBe(false);
    expect(cooked.ok && cooked.value.dish).toMatchObject({
      id: dishId, cook: "usr_rahul", orgId, portionsHalf: 8, extrasMinor: 1500, ingredientsMinor: 10700,
      totalMinor: 12200, currency: "INR", splitMode: "claims", state: "open", txnId: null, finalizedAt: null, canceledAt: null,
    });
    expect(cooked.ok && cooked.value.dish.ingredients.map((i) => [i.name, i.position, i.costMinor, i.orgId, i.useTxnId])).toEqual([
      [paneer.name, 0, 9500, null, null],
      [tomatoes.name, 1, 1200, orgId, txnId],
    ]);
    expect(itemRow(paneer.id)).toMatchObject({ qty_left_milli: 0, cost_taken_minor: 9500, state: "used_up", version: 2 });
    expect(itemRow(tomatoes.id)).toMatchObject({ qty_left_milli: 700_000, cost_taken_minor: 1200, state: "active", version: 2 });
    expect(db.prepare("SELECT kind, dish_id, txn_id, idem_key FROM kitchen_stock_moves ORDER BY rowid").all()).toEqual([
      { kind: "dish", dish_id: dishId, txn_id: null, idem_key: null },
      { kind: "dish", dish_id: dishId, txn_id: txnId, idem_key: null },
    ]);
    // The shared group's currency is pinned by the batch.
    expect((await repo.getGroupSettings(orgId)).ok).toBe(true);
    expect([count("kitchen_dishes"), count("kitchen_dish_ingredients"), count("kitchen_txns"), count("kitchen_txn_splits")]).toEqual([1, 2, 1, 2]);

    const again = await repo.cookDish({ ...input, dish: { ...input.dish, id: asUuid(randomUUID()) } });
    expect(again.ok && again.value).toMatchObject({ replayed: true, dish: { id: dishId } });
    expect([count("kitchen_dishes"), count("kitchen_stock_moves"), count("kitchen_txns")]).toEqual([1, 2, 1]);
  });

  it("writes nothing when an ingredient moved on, has not that much left, or the group counts in another currency", async () => {
    const { repo, tomatoes, input } = await cook();
    db.prepare("UPDATE kitchen_items SET version = version + 1 WHERE id = ?").run(tomatoes.id);
    expect(await repo.cookDish(input)).toEqual({ ok: false, error: { kind: "stale" } });

    db.prepare("UPDATE kitchen_items SET version = 1, qty_left_milli = 100000 WHERE id = ?").run(tomatoes.id);
    expect(await repo.cookDish(input)).toEqual({
      ok: false, error: { kind: "ingredient_short", itemId: tomatoes.id, qtyLeftMilli: 100_000 },
    });

    db.prepare("UPDATE kitchen_items SET qty_left_milli = qty_bought_milli WHERE id = ?").run(tomatoes.id);
    db.prepare("UPDATE kitchen_group_settings SET currency = 'USD' WHERE org_id = ?").run(orgId);
    expect(await repo.cookDish(input)).toEqual({ ok: false, error: { kind: "currency_mismatch", currency: "USD" } });

    expect([count("kitchen_dishes"), count("kitchen_dish_ingredients"), count("kitchen_stock_moves"), count("kitchen_txns")]).toEqual([0, 0, 0, 0]);
  });

  it("cancels in one batch: the charge reversed and every ingredient back, once", async () => {
    const { repo, paneer, tomatoes, dishId, txnId, input } = await cook();
    const cooked = await repo.cookDish(input);
    if (!cooked.ok) throw new Error("not cooked");
    const later = new Date("2026-11-02T13:00:00.000Z");
    const canceled = await repo.cancelDish({ dish: cooked.value.dish, actor: "usr_rahul", now: later, audits: [] });
    expect(canceled.ok && canceled.value).toMatchObject({ state: "canceled", canceledAt: later });
    expect(itemRow(paneer.id)).toMatchObject({ qty_left_milli: 200_000, cost_taken_minor: 0, state: "active" });
    expect(itemRow(tomatoes.id)).toMatchObject({ qty_left_milli: 1_000_000, cost_taken_minor: 0, state: "active" });
    const reversal = db.prepare("SELECT kind, reverses, source_kind, source_id, total_minor FROM kitchen_txns WHERE reverses IS NOT NULL").get();
    expect(reversal).toEqual({ kind: "reversal", reverses: txnId, source_kind: "dish", source_id: dishId, total_minor: 1200 });
    expect(db.prepare("SELECT kind, reverses IS NOT NULL AS back, txn_id IS NOT NULL AS charged FROM kitchen_stock_moves ORDER BY rowid").all()).toEqual([
      { kind: "dish", back: 0, charged: 0 },
      { kind: "dish", back: 0, charged: 1 },
      { kind: "reversal", back: 1, charged: 1 },
      { kind: "reversal", back: 1, charged: 0 },
    ]);

    // From the dish as first read: the guard refuses, and nothing more is written.
    expect(await repo.cancelDish({ dish: cooked.value.dish, actor: "usr_rahul", now: later, audits: [] })).toEqual({
      ok: false, error: { kind: "dish_not_open", state: "canceled" },
    });
    expect([count("kitchen_txns"), count("kitchen_stock_moves")]).toEqual([2, 4]);
  });

  it("keeps a dish's total, split mode, state and ingredients honest (250_kitchen_dishes)", async () => {
    const repo = createKitchenRepository(executor);
    const item = newItem();
    await repo.createItem({ item });
    const dish = (values: Record<string, unknown> = {}) => () => {
      const v = {
        id: randomUUID(), org: orgId as string | null, portions: 4, ingredients: 100, total: 150, mode: "assign",
        state: "draft", canceledAt: null as string | null, idem: randomUUID(), ...values,
      };
      db.prepare(
        `INSERT INTO kitchen_dishes (id, cook, org_id, name, portions_half, extras_minor, ingredients_minor, total_minor,
                                     currency, split_mode, state, cooked_at, canceled_at, idem_key)
         VALUES (?, 'usr_rahul', ?, 'Dal', ?, 50, ?, ?, 'INR', ?, ?, '2026-11-02T12:00:00.000Z', ?, ?)`,
      ).run(v.id, v.org, v.portions, v.ingredients, v.total, v.mode, v.state, v.canceledAt, v.idem);
      return v.id;
    };
    const dishId = dish({ idem: "dal-1" })();
    expect(dish({ mode: "claims", org: null })).toThrow(/CHECK constraint failed/);
    expect(dish({ mode: "claims" })).not.toThrow();
    expect(dish({ total: 151 })).toThrow(/CHECK constraint failed/);
    expect(dish({ portions: 0 })).toThrow(/CHECK constraint failed/);
    expect(dish({ state: "canceled" })).toThrow(/CHECK constraint failed/);
    expect(dish({ state: "canceled", canceledAt: "2026-11-02T13:00:00.000Z" })).not.toThrow();
    expect(dish({ state: "eaten" })).toThrow(/CHECK constraint failed/);
    expect(dish({ idem: "dal-1" })).toThrow(/UNIQUE constraint failed/);

    const ingredient = (values: Record<string, unknown> = {}) => () => {
      const v = { dish: dishId, item: item.id as string, qty: 100, org: null as string | null, txn: null as string | null, ...values };
      db.prepare(
        `INSERT INTO kitchen_dish_ingredients (dish_id, item_id, position, qty_milli, unit, cost_minor, org_id, paid_by, use_txn_id)
         VALUES (?, ?, 0, ?, 'g', 10, ?, 'usr_rahul', ?)`,
      ).run(v.dish, v.item, v.qty, v.org, v.txn);
    };
    expect(ingredient()).not.toThrow();
    expect(ingredient()).toThrow(/UNIQUE constraint failed/);
    expect(ingredient({ dish: randomUUID() })).toThrow(/FOREIGN KEY constraint failed/);
    expect(ingredient({ item: randomUUID() })).toThrow(/FOREIGN KEY constraint failed/);
    expect(ingredient({ qty: 0, item: newItem().id })).toThrow(/CHECK constraint failed/);
  });

  // Splitting a dish (CP-16, migration 260): claims, the cook's assignment,
  // finalize and corrections, each ONE batch guarded by the dish row.

  const mine = { cook: "usr_rahul", orgIds: [] as string[] };

  /** The dish transaction Anu 6 and Dev 2 of 8 half portions make of ₹122.00. */
  function dishTxn(dishId: string, idemKey: string, splits = [
    { subjectId: "usr_rahul", paidMinor: 12200, owedMinor: 0 },
    { subjectId: "usr_anu", paidMinor: 0, owedMinor: 9150 },
    { subjectId: "usr_dev", paidMinor: 0, owedMinor: 3050 },
  ]) {
    const txn: NewKitchenTxn = {
      id: asUuid(randomUUID()), orgId, kind: "dish", title: "Paneer", totalMinor: 12200, currency: "INR",
      occurredAt: now, createdBy: "usr_rahul", sourceKind: "dish", sourceId: dishId, idemKey, now,
    };
    return { txn, splits };
  }

  const dishRow = (id: string) =>
    db.prepare("SELECT state, version, txn_id, leftover_item_id FROM kitchen_dishes WHERE id = ?").get(id) as {
      state: string; version: number; txn_id: string | null; leftover_item_id: string | null;
    };

  it("claims within the portions only, in one guarded batch, and finalizes only at the version it read (260_kitchen_dish_shares)", async () => {
    const { repo, dishId, input } = await cook();
    expect((await repo.cookDish(input)).ok).toBe(true);
    const claim = (subjectId: string, portionsHalf: number) =>
      repo.claimDish({ dishId, subjectId, portionsHalf, shareId: asUuid(randomUUID()), setBy: subjectId, now });

    const anu = await claim("usr_anu", 6);
    expect(anu.ok && anu.value.shares.map((s) => [s.subjectId, s.portionsHalf, s.source, s.position])).toEqual([["usr_anu", 6, "self", 0]]);
    expect(dishRow(dishId).version).toBe(2);
    expect(await claim("usr_dev", 3)).toEqual({ ok: false, error: { kind: "claims_exceed_portions", portionsHalf: 8, availableHalf: 2 } });
    expect([count("kitchen_dish_shares"), dishRow(dishId).version]).toEqual([1, 2]);
    const dev = await claim("usr_dev", 2);
    if (!dev.ok) throw new Error("not claimed");
    // A claim again keeps its place; 0 takes it back.
    expect((await claim("usr_anu", 5)).ok).toBe(true);
    expect((await claim("usr_anu", 6)).ok).toBe(true);
    expect((await claim("usr_meera", 0)).ok).toBe(true);

    // Planned from a read before the last claims: the guard refuses, and nothing is written.
    const stale = await repo.finalizeDish({ dish: dev.value, txn: dishTxn(dishId, "fin"), leftover: null, now, audits: [] });
    expect(stale).toEqual({ ok: false, error: { kind: "stale" } });
    expect([count("kitchen_txns"), dishRow(dishId).state]).toEqual([1, "open"]);

    const current = await repo.getDish(dishId, mine);
    if (!current.ok) throw new Error("not read");
    expect(current.value.shares.map((s) => [s.subjectId, s.portionsHalf, s.position])).toEqual([["usr_anu", 6, 0], ["usr_dev", 2, 1]]);
    const txn = dishTxn(dishId, "fin");
    const leftover = newItem({ name: "Leftovers: Paneer", category: "Leftovers", dimension: "count", displayUnit: "pcs", qtyMilli: 500, priceMinor: 0, sourceDishId: dishId });
    const finalized = await repo.finalizeDish({ dish: current.value, txn, leftover, now, audits: [] });
    expect(finalized.ok && finalized.value.replayed).toBe(false);
    expect(dishRow(dishId)).toEqual({ state: "finalized", version: current.value.version + 1, txn_id: txn.txn.id, leftover_item_id: leftover.id });
    expect(db.prepare("SELECT source_dish_id FROM kitchen_items WHERE id = ?").get(leftover.id)).toEqual({ source_dish_id: dishId });
    expect(db.prepare("SELECT subject_id, paid_minor, owed_minor FROM kitchen_txn_splits WHERE txn_id = ? ORDER BY position").all(txn.txn.id)).toEqual([
      { subject_id: "usr_rahul", paid_minor: 12200, owed_minor: 0 },
      { subject_id: "usr_anu", paid_minor: 0, owed_minor: 9150 },
      { subject_id: "usr_dev", paid_minor: 0, owed_minor: 3050 },
    ]);

    // Once finalized: finalizing again writes nothing and answers the dish; claims and assignments are refused.
    const before = [count("kitchen_txns"), count("kitchen_items"), dishRow(dishId).version];
    const again = await repo.finalizeDish({ dish: current.value, txn: dishTxn(dishId, "fin-2"), leftover: null, now, audits: [] });
    expect(again.ok && again.value).toMatchObject({ replayed: true, dish: { state: "finalized", txnId: txn.txn.id } });
    expect(await claim("usr_meera", 1)).toEqual({ ok: false, error: { kind: "dish_not_open", state: "finalized" } });
    expect(await repo.setDishShares({ dish: current.value, shares: [], setBy: "usr_rahul", now })).toEqual({
      ok: false, error: { kind: "dish_not_open", state: "finalized" },
    });
    expect([count("kitchen_txns"), count("kitchen_items"), dishRow(dishId).version]).toEqual(before);
  });

  it("corrects in one batch — the reversal, the new transaction, the leftovers and the shares — and a retry writes nothing", async () => {
    const { repo, dishId, input } = await cook();
    expect((await repo.cookDish(input)).ok).toBe(true);
    const assigned = await repo.setDishShares({
      dish: (await repo.getDish(dishId, mine) as { ok: true; value: Parameters<typeof repo.setDishShares>[0]["dish"] }).value,
      shares: [
        { id: asUuid(randomUUID()), subjectId: "usr_anu", portionsHalf: 6, exactMinor: null },
        { id: asUuid(randomUUID()), subjectId: "usr_dev", portionsHalf: 2, exactMinor: null },
      ],
      setBy: "usr_rahul",
      now,
    });
    if (!assigned.ok) throw new Error("not assigned");
    expect(assigned.value.shares.map((s) => [s.subjectId, s.source])).toEqual([["usr_anu", "cook"], ["usr_dev", "cook"]]);
    const leftover = newItem({ name: "Leftovers: Paneer", category: "Leftovers", dimension: "count", displayUnit: "pcs", qtyMilli: 500, priceMinor: 100, sourceDishId: dishId });
    const finalized = await repo.finalizeDish({ dish: assigned.value, txn: dishTxn(dishId, "fin"), leftover, now, audits: [] });
    if (!finalized.ok) throw new Error("not finalized");
    const dish = finalized.value.dish;
    const original = await repo.getTxn(orgId, asUuid(dish.txnId!));
    if (!original.ok) throw new Error("no txn");

    const later = new Date("2026-11-02T14:00:00.000Z");
    const correction = (from: typeof dish) => ({
      dish: from,
      reversal: {
        original: original.value, id: asUuid(randomUUID()), title: "Reversal: Paneer", createdBy: "usr_rahul",
        note: "Dev had none", idemKey: "fix_reversal",
        splits: original.value.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })),
      },
      txn: dishTxn(dishId, "fix", [
        { subjectId: "usr_rahul", paidMinor: 12200, owedMinor: 0 },
        { subjectId: "usr_anu", paidMinor: 0, owedMinor: 12200 },
      ]),
      leftover: { kind: "update" as const, itemId: leftover.id, expectedVersion: 1, qtyMilli: 1000, priceMinor: 3050 },
      shares: [{ id: asUuid(randomUUID()), subjectId: "usr_anu", portionsHalf: 6, exactMinor: null }],
      setBy: "usr_rahul",
      now: later,
      audits: [],
    });
    const fixed = await repo.correctDish(correction(dish));
    expect(fixed.ok && fixed.value.replayed).toBe(false);
    if (!fixed.ok) throw new Error("not corrected");
    expect(fixed.value.dish).toMatchObject({ state: "finalized", leftoverItemId: leftover.id, version: dish.version + 1 });
    expect(fixed.value.dish.txnId).not.toBe(dish.txnId);
    expect(fixed.value.dish.shares.map((s) => [s.subjectId, s.portionsHalf, s.source])).toEqual([["usr_anu", 6, "cook"]]);
    expect(db.prepare("SELECT kind, reverses, source_kind, note FROM kitchen_txns WHERE reverses IS NOT NULL").all()).toEqual([
      { kind: "reversal", reverses: dish.txnId, source_kind: "dish", note: "Dev had none" },
    ]);
    expect(db.prepare("SELECT qty_bought_milli, qty_left_milli, price_minor, version FROM kitchen_items WHERE id = ?").get(leftover.id)).toEqual({
      qty_bought_milli: 1000, qty_left_milli: 1000, price_minor: 3050, version: 2,
    });
    const after = [count("kitchen_txns"), count("kitchen_txn_splits"), count("kitchen_dish_shares"), dishRow(dishId).version];

    // The same correction again, planned from the dish as it now is: its transaction is posted, so nothing is written.
    const retry = await repo.correctDish({
      ...correction(fixed.value.dish),
      reversal: { ...correction(fixed.value.dish).reversal, original: (await repo.getTxn(orgId, asUuid(fixed.value.dish.txnId!)) as { ok: true; value: typeof original.value }).value },
      leftover: { kind: "keep" },
    });
    expect(retry.ok && retry.value).toMatchObject({ replayed: true, dish: { txnId: fixed.value.dish.txnId } });
    // From the dish as first read, or with leftovers that moved on: stale, and nothing is written.
    expect(await repo.correctDish({ ...correction(dish), txn: dishTxn(dishId, "fix-2") })).toEqual({ ok: false, error: { kind: "stale" } });
    expect([count("kitchen_txns"), count("kitchen_txn_splits"), count("kitchen_dish_shares"), dishRow(dishId).version]).toEqual(after);
  });

  it("keeps a share to portions or an amount, once per eater, on a real dish (260_kitchen_dish_shares)", async () => {
    const { repo, dishId, input } = await cook();
    expect((await repo.cookDish(input)).ok).toBe(true);
    expect(dishRow(dishId).version).toBe(1);
    const share = (values: Record<string, unknown> = {}) => () => {
      const v = { dish: dishId as string, subject: "usr_anu", portions: 2 as number | null, exact: null as number | null, source: "self", ...values };
      db.prepare(
        `INSERT INTO kitchen_dish_shares (id, dish_id, subject_id, position, portions_half, exact_minor, source)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
      ).run(randomUUID(), v.dish, v.subject, v.portions, v.exact, v.source);
    };
    expect(share()).not.toThrow();
    expect(share()).toThrow(/UNIQUE constraint failed/);
    expect(share({ subject: "usr_dev", portions: null, exact: 0 })).not.toThrow();
    expect(share({ subject: "usr_meera", portions: 2, exact: 100 })).toThrow(/CHECK constraint failed/);
    expect(share({ subject: "usr_meera", portions: null, exact: null })).toThrow(/CHECK constraint failed/);
    expect(share({ subject: "usr_meera", portions: 0 })).toThrow(/CHECK constraint failed/);
    expect(share({ subject: "usr_meera", portions: null, exact: -1 })).toThrow(/CHECK constraint failed/);
    expect(share({ subject: "usr_meera", source: "admin" })).toThrow(/CHECK constraint failed/);
    expect(share({ subject: "usr_meera", dish: randomUUID() })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => db.prepare("UPDATE kitchen_dishes SET version = 0 WHERE id = ?").run(dishId)).toThrow(/CHECK constraint failed/);
  });

  it("records who set every share — a claim, someone else's, an assignment, a correction — and the latest write wins (290_kitchen_dish_share_setter)", async () => {
    const { repo, dishId, input } = await cook();
    expect((await repo.cookDish(input)).ok).toBe(true);
    const setBy = () =>
      db.prepare("SELECT subject_id, portions_half, source, set_by FROM kitchen_dish_shares WHERE dish_id = ? ORDER BY position").all(dishId);
    const claim = (subjectId: string, portionsHalf: number, by: string) =>
      repo.claimDish({ dishId, subjectId, portionsHalf, shareId: asUuid(randomUUID()), setBy: by, now });

    // A share written before 290 (no set_by) reads as null.
    db.prepare(
      `INSERT INTO kitchen_dish_shares (id, dish_id, subject_id, position, portions_half, exact_minor, source)
       VALUES (?, ?, 'usr_meera', 0, 1, NULL, 'self')`,
    ).run(randomUUID(), dishId);
    expect(setBy()).toEqual([{ subject_id: "usr_meera", portions_half: 1, source: "self", set_by: null }]);

    // Anu claims her own; Anu sets Dev's; then Dev changes his own — the latest write wins, its author with it.
    expect((await claim("usr_anu", 2, "usr_anu")).ok).toBe(true);
    const forDev = await claim("usr_dev", 2, "usr_anu");
    expect(forDev.ok && forDev.value.shares.map((s) => [s.subjectId, s.setBy])).toEqual([
      ["usr_meera", null],
      ["usr_anu", "usr_anu"],
      ["usr_dev", "usr_anu"],
    ]);
    expect((await claim("usr_dev", 3, "usr_dev")).ok).toBe(true);
    expect(setBy()).toEqual([
      { subject_id: "usr_meera", portions_half: 1, source: "self", set_by: null },
      { subject_id: "usr_anu", portions_half: 2, source: "self", set_by: "usr_anu" },
      { subject_id: "usr_dev", portions_half: 3, source: "self", set_by: "usr_dev" },
    ]);
    // Setting someone else's past the portions is refused like any claim, and writes nothing.
    expect(await claim("usr_kiran", 3, "usr_anu")).toEqual({ ok: false, error: { kind: "claims_exceed_portions", portionsHalf: 8, availableHalf: 2 } });
    expect(setBy()).toHaveLength(3);

    // The cook's assignment, and a correction, record their caller on every row.
    const current = await repo.getDish(dishId, mine);
    if (!current.ok) throw new Error("not read");
    const assigned = await repo.setDishShares({
      dish: current.value,
      shares: [{ id: asUuid(randomUUID()), subjectId: "usr_anu", portionsHalf: 4, exactMinor: null }],
      setBy: "usr_rahul",
      now,
    });
    expect(assigned.ok && assigned.value.shares.map((s) => [s.subjectId, s.source, s.setBy])).toEqual([["usr_anu", "cook", "usr_rahul"]]);
    const finalized = await repo.finalizeDish({
      dish: (assigned as { ok: true; value: typeof current.value }).value, txn: dishTxn(dishId, "fin"), leftover: null, now, audits: [],
    });
    if (!finalized.ok) throw new Error("not finalized");
    const original = await repo.getTxn(orgId, asUuid(finalized.value.dish.txnId!));
    if (!original.ok) throw new Error("no txn");
    const corrected = await repo.correctDish({
      dish: finalized.value.dish,
      reversal: {
        original: original.value, id: asUuid(randomUUID()), title: "Reversal: Paneer", createdBy: "usr_anu",
        note: null, idemKey: "fix_reversal",
        splits: original.value.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })),
      },
      txn: dishTxn(dishId, "fix"),
      leftover: { kind: "keep" },
      shares: [{ id: asUuid(randomUUID()), subjectId: "usr_dev", portionsHalf: 4, exactMinor: null }],
      setBy: "usr_anu",
      now,
      audits: [],
    });
    expect(corrected.ok && corrected.value.dish.shares.map((s) => [s.subjectId, s.source, s.setBy])).toEqual([["usr_dev", "cook", "usr_anu"]]);
  });
});

describe("the daily sweep, against a real SQLite engine (270_kitchen_sweeps)", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  const orgId = asUuid("b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2");
  const now = new Date("2026-11-02T02:30:00.000Z");
  let seq = 0;

  beforeEach(() => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
  });

  afterEach(() => {
    db.close();
  });

  function newItem(name: string, expiresOn: string | null, overrides: Partial<NewKitchenItem> = {}): NewKitchenItem {
    seq += 1;
    return {
      id: asUuid(randomUUID()),
      owner: { kind: "user", subjectId: "usr_rahul" },
      name,
      category: "Veg",
      dimension: "mass",
      displayUnit: "kg",
      qtyMilli: 1_000_000,
      priceMinor: 4000,
      currency: "INR",
      paidBy: "usr_rahul",
      boughtOn: "2026-10-30",
      expiresOn,
      wastePolicy: null,
      createdBy: "usr_rahul",
      idemKey: `sweep-${seq}`,
      now,
      ...overrides,
    };
  }

  it("reads every pantry's active items in the window in one query, soonest first, then by name", async () => {
    const repo = createKitchenRepository(executor);
    const group = { kind: "group", orgId } as const;
    for (const item of [
      newItem("spinach", "2026-11-03"),
      newItem("Milk", "2026-11-02"),
      newItem("Bread", "2026-11-05"), // after the window
      newItem("Yogurt", "2026-11-01"), // before it
      newItem("Oats", null),
      newItem("Apples", "2026-11-03", { owner: group }),
      newItem("Paneer", "2026-11-04", { owner: group }),
    ]) {
      expect((await repo.createItem({ item })).ok).toBe(true);
    }
    const gone = newItem("Curd", "2026-11-02", { owner: group });
    await repo.createItem({ item: gone });
    expect((await repo.removeItem(group, gone.id, now)).ok).toBe(true);
    // Used up: nothing left, so nothing to use.
    db.prepare("UPDATE kitchen_items SET state = 'used_up', qty_left_milli = 0 WHERE name = 'Paneer'").run();

    const found = await repo.listUseSoonItems({ from: "2026-11-02", through: "2026-11-04", limit: 100 });
    expect(found.ok && found.value.map((i) => [i.name, i.expiresOn, i.ownerKind])).toEqual([
      ["Milk", "2026-11-02", "user"],
      ["Apples", "2026-11-03", "group"],
      ["spinach", "2026-11-03", "user"],
    ]);
    const capped = await repo.listUseSoonItems({ from: "2026-11-02", through: "2026-11-04", limit: 2 });
    expect(capped.ok && capped.value.map((i) => i.name)).toEqual(["Milk", "Apples"]);

    // The partial index the sweep was built for (230_kitchen_pantry) is the one SQLite uses.
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT id FROM kitchen_items WHERE state = 'active' AND qty_left_milli > 0
         AND expires_on IS NOT NULL AND expires_on BETWEEN '2026-11-02' AND '2026-11-04'`,
      )
      .all() as Array<{ detail: string }>;
    expect(plan.map((p) => p.detail).join(" ")).toContain("kitchen_items_expires_idx");
  });

  it("records one row per day swept: a re-run of the day replaces its counts and counts the run", async () => {
    const repo = createKitchenRepository(executor);
    expect(await repo.lastSweep()).toEqual({ ok: true, value: null });

    const first = await repo.recordSweep({
      date: "2026-11-02", startedAt: now, finishedAt: new Date(now.getTime() + 1500), items: 5, people: 4, sent: 3, failed: 1,
    });
    expect(first.ok && first.value).toEqual({
      date: "2026-11-02", startedAt: now, finishedAt: new Date(now.getTime() + 1500), items: 5, people: 4, sent: 3, failed: 1, runs: 1,
    });
    const later = new Date(now.getTime() + 3_600_000);
    await repo.recordSweep({ date: "2026-11-02", startedAt: later, finishedAt: later, items: 5, people: 4, sent: 4, failed: 0 });
    await repo.recordSweep({ date: "2026-11-01", startedAt: now, finishedAt: now, items: 1, people: 1, sent: 1, failed: 0 });

    const last = await repo.lastSweep();
    expect(last.ok && last.value).toMatchObject({ date: "2026-11-02", finishedAt: later, sent: 4, failed: 0, runs: 2 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM kitchen_sweeps").get() as { n: number }).n).toBe(2);
  });

  it("checks the day's shape and the counts in the table itself", () => {
    const insert = (date: string, items: number) => () =>
      db
        .prepare("INSERT INTO kitchen_sweeps (sweep_date, started_at, finished_at, items) VALUES (?, ?, ?, ?)")
        .run(date, now.toISOString(), now.toISOString(), items);
    expect(insert("2026-11-02", 0)).not.toThrow();
    expect(insert("Nov 2", 0)).toThrow(/CHECK/);
    expect(insert("2026-11-03", -1)).toThrow(/CHECK/);
  });
});

// Cookpool SM-8: "from before" — the item history and the recipes reads. Each
// is ONE statement the app runs as someone types, so they are checked here
// against the engine itself, plans included: the pantries and dishes in scope
// are found through the owner and group indexes (no scan of every pantry's
// items or every dish's ingredients), with no new index.
describe("from before, against a real SQLite engine (SM-8)", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  /** Every statement the repository sent, with what it bound. */
  let sent: Array<{ query: string; values: unknown[] }>;
  const flat = asUuid("d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1");
  const lunch = asUuid("e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1");
  const elsewhere = asUuid("f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1");
  const me = { kind: "user", subjectId: "usr_rahul" } as const;
  let seq = 0;
  let clock = new Date("2026-11-04T08:00:00.000Z");

  beforeEach(() => {
    db = migratedDatabase();
    sent = [];
    const binding = d1Over(db);
    executor = createSqlExecutor({
      ...binding,
      prepare(query: string) {
        const statement = binding.prepare(query);
        const record = { query, values: [] as unknown[] };
        sent.push(record);
        return {
          ...statement,
          bind(...values: unknown[]) {
            record.values = values;
            statement.bind(...values);
            return this;
          },
          all: () => statement.all(),
        };
      },
      batch: (statements: unknown[]) => binding.batch!(statements as never),
    } as unknown as D1Binding);
  });

  afterEach(() => {
    db.close();
  });

  /** What SQLite would do with the last statement sent, as one line per step. */
  function lastPlan(): string[] {
    const last = sent[sent.length - 1]!;
    return (db.prepare(`EXPLAIN QUERY PLAN ${last.query}`).all(...(last.values as never[])) as Array<{ detail: string }>).map((p) => p.detail);
  }

  function newItem(overrides: Partial<NewKitchenItem> = {}): NewKitchenItem {
    seq += 1;
    clock = new Date(clock.getTime() + 60_000);
    return {
      id: asUuid(randomUUID()),
      owner: me,
      name: `Item ${seq}`,
      category: "Veg",
      dimension: "mass",
      displayUnit: "g",
      qtyMilli: 1_000_000,
      priceMinor: 4000,
      currency: "INR",
      paidBy: "usr_rahul",
      boughtOn: "2026-11-01",
      expiresOn: null,
      wastePolicy: null,
      createdBy: "usr_rahul",
      idemKey: `add-${seq}`,
      now: clock,
      ...overrides,
    };
  }

  async function add(overrides: Partial<NewKitchenItem>): Promise<NewKitchenItem> {
    const item = newItem(overrides);
    expect((await createKitchenRepository(executor).createItem({ item })).ok).toBe(true);
    return item;
  }

  const version = (itemId: string) =>
    (db.prepare("SELECT version FROM kitchen_items WHERE id = ?").get(itemId) as { version: number }).version;

  /** A dish taking `qtyMilli` of each item (charged to nobody: these reads never look at money). */
  async function cook(
    name: string,
    items: Array<{ item: NewKitchenItem; qtyMilli: number; unit?: string }>,
    dish: { cook?: string; orgId?: string | null; state?: "draft" | "open" } = {},
  ): Promise<string> {
    clock = new Date(clock.getTime() + 60_000);
    const id = asUuid(randomUUID());
    const result = await createKitchenRepository(executor).cookDish({
      dish: {
        id, cook: dish.cook ?? "usr_rahul", orgId: (dish.orgId ?? null) as typeof flat | null, name, portionsHalf: 4,
        extrasMinor: 500, currency: "INR", splitMode: "assign", state: dish.state ?? "draft", idemKey: `cook-${id}`, now: clock,
      },
      newItems: [],
      ingredients: items.map(({ item, qtyMilli, unit }) => ({
        owner: item.owner, itemId: item.id, expectedVersion: version(item.id), qtyMilli, unit: unit ?? item.displayUnit, costMinor: 0,
        paidBy: item.paidBy, useTxnId: null, moveId: asUuid(randomUUID()),
      })),
      txns: [],
      audits: [],
    });
    expect(result.ok || result.error).toBe(true);
    return id;
  }

  it("reads past items by name in one statement: the newest record of each, how many there were, best match first", async () => {
    await add({ name: "Milk", boughtOn: "2026-10-01", dimension: "volume", displayUnit: "L" });
    const used = await add({ name: "MILK", boughtOn: "2026-10-20", dimension: "volume", displayUnit: "L" });
    db.prepare("UPDATE kitchen_items SET qty_left_milli = 0, state = 'used_up' WHERE id = ?").run(used.id);
    const newest = await add({ owner: { kind: "group", orgId: flat }, name: "milk", boughtOn: "2026-11-02", paidBy: "usr_anu", dimension: "volume", displayUnit: "ml" });
    const removed = await add({ name: "Milk", boughtOn: "2026-11-04" });
    db.prepare("UPDATE kitchen_items SET state = 'removed' WHERE id = ?").run(removed.id);
    const leftovers = await add({ name: "Milk", boughtOn: "2026-11-04" });
    db.prepare("UPDATE kitchen_items SET source_dish_id = ? WHERE id = ?").run(randomUUID(), leftovers.id);
    await add({ owner: { kind: "group", orgId: elsewhere }, name: "Milk", boughtOn: "2026-11-04", paidBy: "usr_x" });
    await add({ name: "Almond milk", boughtOn: "2026-11-03" });
    await add({ name: "Jasmine rice", boughtOn: "2026-11-03" });

    const repo = createKitchenRepository(executor);
    const scope = { ownerSubjectId: "usr_rahul", orgIds: [flat, lunch] };
    const before = sent.length;
    const found = await repo.itemHistory({ ...scope, q: "mil", limit: 8 });
    expect(found.ok && found.value.map((r) => [r.item.id, r.item.name, r.times])).toEqual([
      [newest.id, "milk", 3],
      [expect.any(String), "Almond milk", 1],
    ]);
    expect(sent.length - before).toBe(1);
    const plan = lastPlan();
    // The two pantries through their own indexes (a person's and a group's), never a scan of the table.
    expect(plan.join(" | ")).toMatch(/MULTI-INDEX OR/);
    expect(plan.filter((p) => /kitchen_items/.test(p))).toEqual([
      expect.stringMatching(/^SEARCH kitchen_items USING INDEX \w+ \(owner_subject_id=\?\)$/),
      expect.stringMatching(/^SEARCH kitchen_items USING INDEX \w+ \(org_id=\?\)$/),
    ]);

    const recent = await repo.itemHistory({ ...scope, q: "", limit: 2 });
    expect(recent.ok && recent.value.map((r) => r.item.name)).toEqual(["Jasmine rice", "Almond milk"]); // the same day: the one added last first
    const none = await repo.itemHistory({ ownerSubjectId: "usr_nobody", orgIds: [], q: "", limit: 8 });
    expect(none).toEqual({ ok: true, value: [] });
  });

  it("reads past dishes with their newest ingredients matched to usable items, in one statement that never scans every pantry or dish", async () => {
    const eggs = await add({ name: "Eggs", dimension: "count", displayUnit: "pcs", qtyMilli: 12_000 });
    const rice = await add({ owner: { kind: "group", orgId: flat }, name: "Rice", paidBy: "usr_anu" });
    const ghee = await add({ owner: { kind: "group", orgId: elsewhere }, name: "Ghee", paidBy: "usr_x", dimension: "volume", displayUnit: "ml" });
    await cook("Egg fried rice", [{ item: eggs, qtyMilli: 2_000 }, { item: rice, qtyMilli: 200_000 }], { orgId: flat });
    const newestDish = await cook("egg fried rice", [{ item: rice, qtyMilli: 250_000 }, { item: eggs, qtyMilli: 4_000 }], { orgId: flat });
    // Someone else's dish shared with a group Rahul is not in: not his to read.
    await cook("Egg curry", [{ item: ghee, qtyMilli: 10_000, unit: "ml" }], { cook: "usr_x", orgId: elsewhere });
    // Rice usable in the Lunch club with more left; the flat's still wins (last time's pantry).
    await add({ owner: { kind: "group", orgId: lunch }, name: "rice", paidBy: "usr_kiran", qtyMilli: 5_000_000 });
    // Eggs only by weight elsewhere: not the same dimension.
    await add({ name: "eggs", dimension: "mass" });

    const repo = createKitchenRepository(executor);
    const query = { subjectId: "usr_rahul", orgIds: [flat, lunch], usableOrgIds: [flat, lunch], limit: 8 };
    const before = sent.length;
    const found = await repo.recipes({ ...query, q: "egg" });
    expect(sent.length - before).toBe(1);
    expect(found.ok && found.value).toEqual([
      {
        dishId: newestDish, cook: "usr_rahul", orgId: flat, name: "egg fried rice", portionsHalf: 4, extrasMinor: 500,
        totalMinor: 500, currency: "INR", cookedAt: expect.any(Date), times: 2,
        ingredients: [
          { itemId: rice.id, name: "Rice", dimension: "mass", position: 0, qtyMilli: 250_000, unit: "g", orgId: flat,
            match: { itemId: rice.id, orgId: flat, qtyLeftMilli: 550_000 } },
          { itemId: eggs.id, name: "Eggs", dimension: "count", position: 1, qtyMilli: 4_000, unit: "pcs", orgId: null,
            match: { itemId: eggs.id, orgId: null, qtyLeftMilli: 6_000 } },
        ],
      },
    ]);

    const plan = lastPlan();
    // Dishes by cook and by group; ingredients and their items by key; candidate items by owner and by group.
    expect(plan).toEqual(expect.arrayContaining([
      expect.stringMatching(/^SEARCH d USING INDEX \w+ \(cook=\?\)$/),
      expect.stringMatching(/^SEARCH d USING INDEX kitchen_dishes_org_idx \(org_id=\?\)$/),
      expect.stringMatching(/^SEARCH di USING INDEX \w+ \(dish_id=\?\)$/),
      expect.stringMatching(/^SEARCH i USING INDEX \w+ \(id=\?\)$/),
      "SEARCH c USING INDEX kitchen_items_owner_state_idx (owner_subject_id=? AND state=?)",
      "SEARCH c USING INDEX kitchen_items_org_state_idx (org_id=? AND state=?)",
    ]));
    // No step scans a table: only the small sets the statement built itself.
    expect(plan.filter((p) => /^SCAN (d|di|i|c|kitchen_\w+)\b/.test(p))).toEqual([]);

    // A canceled dish neither shows nor counts; no text lists the most recent.
    db.prepare("UPDATE kitchen_dishes SET state = 'canceled', canceled_at = ? WHERE id = ?").run(clock.toISOString(), newestDish);
    const after = await repo.recipes({ ...query, q: "" });
    expect(after.ok && after.value.map((r) => [r.name, r.times, r.ingredients.map((i) => i.qtyMilli)])).toEqual([
      ["Egg fried rice", 1, [2_000, 200_000]],
    ]);
  });
});

// Your measures (Cookpool SM-13, migration 300): the sizes a name is counted
// in, per pantry and dimension, read for many items in ONE statement and
// replaced as a set in one batch; and the words a use or an ingredient was
// given in, kept on the move and the ingredient row.
describe("your measures, against a real SQLite engine (300_kitchen_measures)", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  /** Every statement the repository sent, with what it bound. */
  let sent: Array<{ query: string; values: unknown[] }>;
  const flat = asUuid("c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3");
  const lunch = asUuid("c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4");
  const me = { kind: "user", subjectId: "usr_rahul" } as const;
  const inFlat = { kind: "group", orgId: flat } as const;
  const now = new Date("2026-11-05T08:00:00.000Z");
  const onion = { one: "onion", many: "onions", count: 1, amountMilli: 150_000 };
  const katori = { one: "katori", many: "katoris", count: 1, amountMilli: 120_000 };
  let seq = 0;

  beforeEach(() => {
    db = migratedDatabase();
    sent = [];
    const binding = d1Over(db);
    executor = createSqlExecutor({
      ...binding,
      prepare(query: string) {
        const statement = binding.prepare(query);
        const record = { query, values: [] as unknown[] };
        sent.push(record);
        return {
          ...statement,
          bind(...values: unknown[]) {
            record.values = values;
            statement.bind(...values);
            return this;
          },
          all: () => statement.all(),
        };
      },
      batch: (statements: unknown[]) => binding.batch!(statements as never),
    } as unknown as D1Binding);
  });

  afterEach(() => {
    db.close();
  });

  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const fresh = <T extends object>(m: T) => ({ id: asUuid(randomUUID()), ...m });

  function newItem(overrides: Partial<NewKitchenItem> = {}): NewKitchenItem {
    seq += 1;
    return {
      id: asUuid(randomUUID()),
      owner: me,
      name: "Onions",
      category: "Veg",
      dimension: "mass",
      displayUnit: "kg",
      qtyMilli: 1_000_000,
      priceMinor: 4000,
      currency: "INR",
      paidBy: "usr_rahul",
      boughtOn: "2026-11-05",
      expiresOn: null,
      wastePolicy: null,
      createdBy: "usr_rahul",
      idemKey: `add-${seq}`,
      now,
      ...overrides,
    };
  }

  it("replaces a name's set in one batch: a word kept keeps its id and who first set it, the rest go, an empty set clears it", async () => {
    const repo = createKitchenRepository(executor);
    const key = { owner: inFlat, name: "Onions", dimension: "mass" } as const;
    const first = await repo.replaceMeasures({ key, measures: [fresh(onion)], actor: "usr_anu", now });
    expect(first.ok && first.value).toEqual([
      expect.objectContaining({
        ownerKind: "group", ownerId: flat, nameKey: "onions", dimension: "mass", ...onion, position: 0,
        createdBy: "usr_anu", updatedBy: "usr_anu",
      }),
    ]);
    const onionId = first.ok ? first.value[0]!.id : "";

    // Through another spelling of the name: one set.
    const later = new Date(now.getTime() + 60_000);
    const before = sent.length;
    const second = await repo.replaceMeasures({
      key: { ...key, name: " ONIONS " },
      measures: [fresh(katori), fresh({ ...onion, amountMilli: 160_000 })],
      actor: "usr_dev",
      now: later,
    });
    // One batch: the delete, then one upsert per measure.
    expect(sent.length - before).toBe(3);
    expect(second.ok && second.value.map((m) => [m.one, m.amountMilli, m.position, m.createdBy, m.updatedBy])).toEqual([
      ["katori", 120_000, 0, "usr_dev", "usr_dev"],
      ["onion", 160_000, 1, "usr_anu", "usr_dev"],
    ]);
    expect(second.ok && second.value[1]!.id).toBe(onionId);
    expect(second.ok && second.value[1]!.createdAt).toEqual(now);
    expect(second.ok && second.value[1]!.updatedAt).toEqual(later);

    const third = await repo.replaceMeasures({ key, measures: [fresh(onion)], actor: "usr_rahul", now: later });
    expect(third.ok && third.value.map((m) => [m.id, m.one, m.position])).toEqual([[onionId, "onion", 0]]);
    expect(count("kitchen_measures")).toBe(1);
    expect(await repo.replaceMeasures({ key, measures: [], actor: "usr_rahul", now: later })).toEqual({ ok: true, value: [] });
    expect(count("kitchen_measures")).toBe(0);
  });

  it("reads many names in one statement through the lookup index, each in position order; pantries and dimensions apart", async () => {
    const repo = createKitchenRepository(executor);
    await repo.replaceMeasures({ key: { owner: inFlat, name: "Onions", dimension: "mass" }, measures: [fresh(katori), fresh(onion)], actor: "usr_anu", now });
    await repo.replaceMeasures({ key: { owner: inFlat, name: "Onions", dimension: "count" }, measures: [fresh({ ...onion, amountMilli: 1_000 })], actor: "usr_anu", now });
    await repo.replaceMeasures({ key: { owner: me, name: "Onions", dimension: "mass" }, measures: [fresh({ ...onion, amountMilli: 100_000 })], actor: "usr_rahul", now });
    const slice = { one: "slice", many: "slices", count: 16, amountMilli: 1_000 };
    await repo.replaceMeasures({ key: { owner: me, name: "Bread", dimension: "pack" }, measures: [fresh(slice)], actor: "usr_rahul", now });

    const before = sent.length;
    const found = await repo.listMeasures([
      { owner: inFlat, name: "onions", dimension: "mass" },
      { owner: { kind: "group", orgId: lunch }, name: "Onions", dimension: "mass" },
      { owner: me, name: "Bread", dimension: "pack" },
      { owner: me, name: "Onions", dimension: "mass" },
      { owner: inFlat, name: "Onions", dimension: "count" },
      { owner: inFlat, name: "Onions", dimension: "mass" },
      // A group's id where a person's would be is not that person's pantry.
      { owner: { kind: "group", orgId: "usr_rahul" as typeof flat }, name: "Bread", dimension: "pack" },
    ]);
    expect(sent.length - before).toBe(1);
    expect(found.ok && found.value.map((list) => list.map((m) => `${m.one}:${m.amountMilli}`))).toEqual([
      ["katori:120000", "onion:150000"],
      [],
      ["slice:1000"],
      ["onion:100000"],
      ["onion:1000"],
      ["katori:120000", "onion:150000"],
      [],
    ]);
    const last = sent[sent.length - 1]!;
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${last.query}`).all(...(last.values as never[])) as Array<{ detail: string }>).map(
      (p) => p.detail,
    );
    // Each key by the lookup index — never a scan of the table.
    expect(plan).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^SEARCH m USING INDEX kitchen_measures_lookup_idx \(owner_kind=\? AND owner_id=\? AND name_key=\? AND dimension=\?\)$/),
      ]),
    );
    expect(plan.filter((p) => /^SCAN m\b/.test(p))).toEqual([]);

    // No keys, no statement.
    const none = sent.length;
    expect(await repo.listMeasures([])).toEqual({ ok: true, value: [] });
    expect(sent.length).toBe(none);
  });

  it("checks the words, the numbers, the places and one row per word in the table itself", () => {
    const insert = (values: Partial<Record<"one" | "many" | "kind" | "dimension", string>> & { count?: number; amount?: number; position?: number; name?: string }) => () =>
      db.prepare(
        `INSERT INTO kitchen_measures (id, owner_kind, owner_id, name_key, dimension, one, many, count, amount_milli, position, created_by, updated_by)
         VALUES (?, ?, 'usr_rahul', ?, ?, ?, ?, ?, ?, ?, 'usr_rahul', 'usr_rahul')`,
      ).run(
        randomUUID(), values.kind ?? "user", values.name ?? "onions", values.dimension ?? "mass", values.one ?? "onion",
        values.many ?? "onions", values.count ?? 1, values.amount ?? 150_000, values.position ?? 0,
      );
    expect(insert({})).not.toThrow();
    expect(insert({})).toThrow(/UNIQUE constraint failed/);
    expect(insert({ dimension: "count" })).not.toThrow();
    expect(insert({ one: "bulb", position: 2 })).not.toThrow();
    for (const bad of [
      { one: "x", kind: "team" },
      { one: "x", dimension: "weight" },
      { one: "" },
      { one: "x".repeat(25) },
      { one: "x", many: "" },
      { one: "x", count: 0 },
      { one: "x", amount: 0 },
      { one: "x", position: 3 },
      { one: "x", position: -1 },
      { one: "x", name: "" },
    ]) {
      expect(insert(bad)).toThrow(/CHECK constraint failed/);
    }
    const row = db.prepare("SELECT created_at, updated_at FROM kitchen_measures LIMIT 1").get() as { created_at: string; updated_at: string };
    expect(Number.isNaN(new Date(row.created_at).getTime())).toBe(false);
    expect(count("kitchen_measures")).toBe(3);
  });

  it("keeps the words a use and an ingredient were given in — and a reversal's — and nothing for a unit", async () => {
    const repo = createKitchenRepository(executor);
    const item = newItem();
    await repo.createItem({ item });
    const take = async (label: string | null | undefined, qtyMilli: number) => {
      const current = await repo.getItem(me, item.id);
      const version = current.ok ? current.value.version : 0;
      const moved = await repo.takeStock({
        owner: me,
        itemId: item.id,
        expectedVersion: version,
        move: {
          id: asUuid(randomUUID()), kind: "use", qtyMilli, costMinor: qtyMilli / 250, unit: "kg", consumers: ["usr_rahul"],
          actor: "usr_rahul", idemKey: `use-${randomUUID()}`, now,
          ...(label === undefined ? {} : { label }),
        },
      });
      expect(moved.ok).toBe(true);
      return moved.ok ? moved.value : null;
    };
    const twoOnions = await take("2 onions", 300_000);
    expect(twoOnions!.move.label).toBe("2 onions");
    await take(undefined, 100_000);
    await take(null, 50_000);
    const half = await take("½ onion", 75_000);

    const undone = await repo.undoMove({
      owner: me,
      move: half!.move,
      expectedVersion: half!.item.version,
      reversal: { id: asUuid(randomUUID()), actor: "usr_rahul", idemKey: "undo-1", now },
    });
    expect(undone.ok && undone.value.move).toMatchObject({ kind: "reversal", label: "½ onion", qtyMilli: 75_000 });
    const moves = await repo.listMoves(me, item.id, 10);
    expect(moves.ok && moves.value.map((m) => [m.kind, m.label])).toEqual([
      ["reversal", "½ onion"],
      ["use", "½ onion"],
      ["use", null],
      ["use", null],
      ["use", "2 onions"],
    ]);
    expect(() =>
      db.prepare("UPDATE kitchen_stock_moves SET label = ? WHERE id = ?").run("x".repeat(65), twoOnions!.move.id),
    ).toThrow(/CHECK constraint failed/);

    // A dish's ingredient, and its move.
    const current = await repo.getItem(me, item.id);
    const dishId = asUuid(randomUUID());
    const cooked = await repo.cookDish({
      dish: {
        id: dishId, cook: "usr_rahul", orgId: null, name: "Onion curry", portionsHalf: 4, extrasMinor: 0, currency: "INR",
        splitMode: "assign", state: "draft", idemKey: "cook-1", now,
      },
      newItems: [],
      ingredients: [
        {
          owner: me, itemId: item.id, expectedVersion: current.ok ? current.value.version : 0, qtyMilli: 150_000, unit: "kg",
          label: "1 onion", costMinor: 600, paidBy: "usr_rahul", useTxnId: null, moveId: asUuid(randomUUID()),
        },
      ],
      txns: [],
      audits: [],
    });
    expect(cooked.ok && cooked.value.dish.ingredients.map((i) => [i.qtyMilli, i.unit, i.label])).toEqual([[150_000, "kg", "1 onion"]]);
    const dishMoves = await repo.listMoves(me, item.id, 1);
    expect(dishMoves.ok && dishMoves.value[0]).toMatchObject({ kind: "dish", dishId, label: "1 onion" });
    const read = await repo.getDish(dishId, { cook: "usr_rahul", orgIds: [] });
    expect(read.ok && read.value.ingredients[0]!.label).toBe("1 onion");
  });
});

// Cookpool SI-2: a code allows 5 tries, and an address can ask for 5 codes in
// 15 minutes. Both limits are one guarded statement each, so they are checked
// here against the engine itself, with requests racing: a read-then-write
// would let a call in between its read and its write (each repository call
// yields between statements), and these tests would see it.
describe("sign-in code limits, against a real SQLite engine (280_identity_login_attempts)", () => {
  let db: DatabaseSync;
  let executor: ReturnType<typeof createSqlExecutor>;
  const T0 = new Date("2026-11-02T09:00:00.000Z");
  const MINUTE = 60_000;
  const USER = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
  const OTHER = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
  const LIMIT = { max: 5, windowMs: 15 * MINUTE };

  beforeEach(async () => {
    db = migratedDatabase();
    executor = createSqlExecutor(d1Over(db));
    const repo = createIdentityRepository(executor);
    for (const [id, email] of [[USER, "anu@example.com"], [OTHER, "ravi@example.com"]] as const) {
      expect((await repo.createUser({ id, email, emailLower: email, createdAt: T0 })).ok).toBe(true);
    }
  });

  afterEach(() => {
    db.close();
  });

  async function newChallenge(id = randomUUID(), createdAt = T0) {
    const repo = createIdentityRepository(executor);
    const created = await repo.createLoginChallenge({
      id, userId: USER, method: "email_code", codeHash: "right-hash",
      expiresAt: new Date(createdAt.getTime() + 10 * MINUTE), createdAt,
    });
    expect(created.ok && created.value.attempts).toBe(0);
    return id;
  }

  function row(id: string) {
    return db.prepare("SELECT attempts, consumed_at FROM identity_login_challenges WHERE id = ?").get(id) as {
      attempts: number;
      consumed_at: string | null;
    };
  }

  const AT = new Date(T0.getTime() + MINUTE);

  it("counts wrong codes down, spends the challenge on the 5th, and refuses the right code after", async () => {
    const repo = createIdentityRepository(executor);
    const id = await newChallenge();

    const kinds = [];
    for (let i = 0; i < 5; i++) {
      const tried = await repo.consumeLoginChallenge(id, "wrong-hash", AT);
      kinds.push(tried.ok ? "ok" : tried.error);
    }
    expect(kinds).toEqual([
      { kind: "wrong_code", attemptsLeft: 4 },
      { kind: "wrong_code", attemptsLeft: 3 },
      { kind: "wrong_code", attemptsLeft: 2 },
      { kind: "wrong_code", attemptsLeft: 1 },
      { kind: "too_many_attempts" },
    ]);
    expect(await repo.consumeLoginChallenge(id, "right-hash", AT)).toEqual({ ok: false, error: { kind: "too_many_attempts" } });
    expect(row(id)).toEqual({ attempts: 5, consumed_at: null });
  });

  it("takes the right code within the limit, once", async () => {
    const repo = createIdentityRepository(executor);
    const id = await newChallenge();
    for (let i = 0; i < 4; i++) await repo.consumeLoginChallenge(id, "wrong-hash", AT);

    const right = await repo.consumeLoginChallenge(id, "right-hash", AT);
    expect(right.ok && right.value).toMatchObject({ id, userId: USER, attempts: 4, consumedAt: AT });
    expect(await repo.consumeLoginChallenge(id, "right-hash", AT)).toEqual({ ok: false, error: { kind: "already_consumed" } });
    expect(await repo.consumeLoginChallenge(id, "wrong-hash", AT)).toEqual({ ok: false, error: { kind: "already_consumed" } });
    expect(row(id)).toEqual({ attempts: 4, consumed_at: AT.toISOString() });
  });

  it("counts two wrong codes sent at once twice", async () => {
    const repo = createIdentityRepository(executor);
    const id = await newChallenge();

    const results = await Promise.all([
      repo.consumeLoginChallenge(id, "wrong-hash", AT),
      repo.consumeLoginChallenge(id, "wrong-hash", AT),
    ]);
    expect(results.map((r) => (r.ok ? null : r.error))).toEqual([
      { kind: "wrong_code", attemptsLeft: 4 },
      { kind: "wrong_code", attemptsLeft: 3 },
    ]);
    expect(row(id).attempts).toBe(2);
  });

  it("lets exactly five of ten wrong codes sent at once count, and no 6th try through", async () => {
    const repo = createIdentityRepository(executor);
    const id = await newChallenge();

    const results = await Promise.all(Array.from({ length: 10 }, () => repo.consumeLoginChallenge(id, "wrong-hash", AT)));
    const kinds = results.map((r) => (r.ok ? "ok" : r.error.kind));
    expect(kinds.filter((k) => k === "wrong_code")).toHaveLength(4);
    expect(kinds.filter((k) => k === "too_many_attempts")).toHaveLength(6);
    expect(row(id).attempts).toBe(5);

    // The right code among a burst of wrong ones after the limit: refused too.
    const burst = await Promise.all([
      repo.consumeLoginChallenge(id, "wrong-hash", AT),
      repo.consumeLoginChallenge(id, "right-hash", AT),
    ]);
    expect(burst.every((r) => !r.ok && r.error.kind === "too_many_attempts")).toBe(true);
    expect(row(id)).toEqual({ attempts: 5, consumed_at: null });
  });

  it("signs in once when the right code is sent twice at once", async () => {
    const repo = createIdentityRepository(executor);
    const id = await newChallenge();
    const results = await Promise.all([
      repo.consumeLoginChallenge(id, "right-hash", AT),
      repo.consumeLoginChallenge(id, "right-hash", AT),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.kind === "already_consumed")).toHaveLength(1);
  });

  it("refuses an expired challenge, right code or wrong, and counts no try", async () => {
    const repo = createIdentityRepository(executor);
    const id = await newChallenge();
    const late = new Date(T0.getTime() + 10 * MINUTE); // expires_at itself: no longer valid
    expect(await repo.consumeLoginChallenge(id, "right-hash", late)).toEqual({ ok: false, error: { kind: "expired" } });
    expect(await repo.consumeLoginChallenge(id, "wrong-hash", late)).toEqual({ ok: false, error: { kind: "expired" } });
    expect(row(id)).toEqual({ attempts: 0, consumed_at: null });
    expect(await repo.consumeLoginChallenge(randomUUID(), "right-hash", AT)).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("gives challenges made before the migration 0 tries, and keeps the count non-negative in the table", () => {
    db.prepare(
      "INSERT INTO identity_login_challenges (id, user_id, method, code_hash, expires_at) VALUES ('legacy', ?, 'email_code', 'h', ?)",
    ).run(USER, T0.toISOString());
    expect(row("legacy").attempts).toBe(0);
    expect(() => db.prepare("UPDATE identity_login_challenges SET attempts = -1 WHERE id = 'legacy'").run()).toThrow(/CHECK/);
  });

  it("takes 5 codes in 15 minutes, refuses the 6th until the oldest leaves the window, per person", async () => {
    const repo = createIdentityRepository(executor);
    const ask = (at: Date, userId = USER) =>
      repo.createLoginChallenge({
        id: randomUUID(), userId, method: "email_code", codeHash: "h",
        expiresAt: new Date(at.getTime() + 10 * MINUTE), createdAt: at, limit: LIMIT,
      });

    for (let i = 0; i < 5; i++) expect((await ask(new Date(T0.getTime() + i * MINUTE))).ok).toBe(true);
    expect(await ask(new Date(T0.getTime() + 5 * MINUTE))).toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAt: new Date(T0.getTime() + 15 * MINUTE) },
    });
    expect((await ask(new Date(T0.getTime() + 5 * MINUTE), OTHER)).ok).toBe(true);
    // The oldest leaves the window at exactly T0 + 15 minutes.
    expect((await ask(new Date(T0.getTime() + 15 * MINUTE - 1))).ok).toBe(false);
    expect((await ask(new Date(T0.getTime() + 15 * MINUTE))).ok).toBe(true);
    // Full again: the next to leave is the one made at T0 + 1 minute.
    expect(await ask(new Date(T0.getTime() + 15 * MINUTE))).toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAt: new Date(T0.getTime() + 16 * MINUTE) },
    });
    const count = db.prepare("SELECT COUNT(*) AS n FROM identity_login_challenges WHERE user_id = ?").get(USER) as { n: number };
    expect(count.n).toBe(6);
  });

  it("lets exactly five of eight code requests sent at once in", async () => {
    const repo = createIdentityRepository(executor);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repo.createLoginChallenge({
          id: randomUUID(), userId: USER, method: "email_code", codeHash: "h",
          expiresAt: new Date(T0.getTime() + 10 * MINUTE), createdAt: T0, limit: LIMIT,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.error.kind === "rate_limited")).toHaveLength(3);
    const count = db.prepare("SELECT COUNT(*) AS n FROM identity_login_challenges WHERE user_id = ?").get(USER) as { n: number };
    expect(count.n).toBe(5);
  });

  it("counts through the (user_id, created_at) index", () => {
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM identity_login_challenges WHERE user_id = ? AND created_at > ?",
      )
      .all(USER, T0.toISOString()) as Array<{ detail: string }>;
    expect(plan.map((p) => p.detail).join(" ")).toContain("login_challenges_user_created_idx");
  });
});
