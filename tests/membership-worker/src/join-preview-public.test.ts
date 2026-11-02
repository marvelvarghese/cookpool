// The signed-out join preview (Cookpool SI-4): GET /v1/join/:code/preview.
//
// The one membership read that answers someone with no account, so these tests
// pin the boundary: exactly three fields and nothing else in the body (no ids,
// slug, code, other names or emails), the same 404 for an unknown, malformed or
// rotated code (and a group that is not active) after at most one lookup, the
// count of people actually in the group, and the inviter's first name with its
// fallbacks. Driven through the handler with an in-memory repository that reads
// the way the D1 one does (active members only, unrevoked roles only), and an
// identity-worker fake for names.

import crypto from "node:crypto";
import { asUuid } from "@saas/db";
import type {
  MembershipResult,
  Organization,
  OrganizationMember,
  RoleAssignment,
} from "@saas/db/membership";
import { JOIN_PREVIEW_PUBLIC_KEYS, type JoinPreviewPublic } from "@saas/contracts/membership";
import { route } from "@membership-worker/router";
import {
  handlePublicJoinPreview,
  type JoinPreviewPublicRepo,
} from "@membership-worker/handlers/join-preview-public";
import { handlePreviewJoin, type JoinLinkRepo } from "@membership-worker/handlers/join";
import { firstNameOf } from "@membership-worker/identity-client";
import { orgPublicId } from "@membership-worker/ids";
import type { Env } from "@membership-worker/env";

if (!(globalThis as Record<string, unknown>).crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}

const ORG = asUuid("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
const ORG_PUB = orgPublicId(ORG);
const T0 = new Date("2026-11-01T00:00:00.000Z");
const CODE = "KTCH2345";

type Envelope<T> = {
  data: T;
  meta: { requestId: string; cursor: string | null };
  error: { code: string; message: string; details: Record<string, unknown>; requestId: string };
};

// ── In-memory repository ────────────────────────────────────────────────

interface FakeRepo extends JoinPreviewPublicRepo {
  orgs: Organization[];
  members: OrganizationMember[];
  roles: RoleAssignment[];
  /** Every repository method called, in order. */
  reads: string[];
}

function createRepo(): FakeRepo {
  const repo: FakeRepo = {
    orgs: [],
    members: [],
    roles: [],
    reads: [],
    async getOrganizationByJoinCode(code) {
      repo.reads.push("getOrganizationByJoinCode");
      const org = repo.orgs.find((o) => o.joinCode === code);
      return org ? { ok: true, value: org } : { ok: false, error: { kind: "not_found" } };
    },
    async listMembers(orgId) {
      repo.reads.push("listMembers");
      return { ok: true, value: repo.members.filter((m) => m.orgId === orgId && m.status === "active") };
    },
    async listRoleAssignments(orgId, subjectId) {
      repo.reads.push("listRoleAssignments");
      return {
        ok: true,
        value: repo.roles.filter((r) => r.orgId === orgId && r.subjectId === subjectId && r.revokedAt === null),
      };
    },
    async listRoleAssignmentsForSubjects(orgId, subjectIds) {
      repo.reads.push("listRoleAssignmentsForSubjects");
      const map = new Map<string, RoleAssignment[]>(subjectIds.map((id) => [id, []]));
      for (const r of repo.roles) {
        if (r.orgId === orgId && r.revokedAt === null && map.has(r.subjectId)) map.get(r.subjectId)!.push(r);
      }
      return { ok: true, value: map };
    },
  };
  return repo;
}

function group(repo: FakeRepo, opts: { name?: string; code?: string | null; status?: string } = {}): void {
  repo.orgs.push({
    id: ORG,
    name: opts.name ?? "Flat 4B",
    slug: "flat-4b",
    slugLower: "flat-4b",
    status: opts.status ?? "active",
    parentOrgId: null,
    joinCode: opts.code === undefined ? CODE : opts.code,
    createdAt: T0,
    updatedAt: T0,
  });
}

/** A person in the group, `joinedMinutes` after T0, holding `roles` (none: a member row with no role). */
function person(
  repo: FakeRepo,
  subjectId: string,
  joinedMinutes: number,
  roles: string[],
  opts: { status?: string; revoked?: boolean; subjectType?: string } = {},
): void {
  const at = new Date(T0.getTime() + joinedMinutes * 60_000);
  repo.members.push({
    id: crypto.randomUUID(),
    orgId: ORG,
    subjectId,
    subjectType: opts.subjectType ?? "user",
    status: opts.status ?? "active",
    createdAt: at,
    updatedAt: at,
  });
  for (const role of roles) {
    repo.roles.push({
      id: crypto.randomUUID(),
      orgId: ORG,
      subjectId,
      subjectType: opts.subjectType ?? "user",
      role,
      scopeKind: "organization",
      scopeRef: null,
      createdAt: at,
      revokedAt: opts.revoked ? at : null,
    });
  }
}

// ── identity-worker fake ────────────────────────────────────────────────

interface IdentityUser {
  subjectId: string;
  displayName: string | null;
  email: string;
}

interface IdentityCall {
  url: string;
  method: string;
  body: unknown;
}

function identity(
  users: IdentityUser[],
  opts: { status?: number; throws?: boolean; body?: unknown; calls?: IdentityCall[] } = {},
): Fetcher {
  return {
    fetch: async (url: string, init: RequestInit = {}) => {
      opts.calls?.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : null });
      if (opts.throws) throw new Error("identity-worker is down");
      if (opts.status) return Response.json({ error: { code: "internal_error" } }, { status: opts.status });
      if (opts.body !== undefined) return new Response(JSON.stringify(opts.body), { headers: { "content-type": "application/json" } });
      const asked = (JSON.parse(init.body as string) as { subjectIds: string[] }).subjectIds;
      return Response.json({
        data: { users: users.filter((u) => asked.includes(u.subjectId)) },
        meta: { requestId: "req_identity", cursor: null },
      });
    },
  } as unknown as Fetcher;
}

const PEOPLE: IdentityUser[] = [
  { subjectId: "usr_anu", displayName: "Anu Varghese", email: "anu.varghese@example.com" },
  { subjectId: "usr_ravi", displayName: "Ravi Kumar", email: "ravi@example.com" },
  { subjectId: "usr_meera", displayName: "Meera", email: "meera@example.com" },
  { subjectId: "usr_noname", displayName: null, email: "noname.person@example.com" },
];

/** `null`: no IDENTITY_WORKER binding at all. */
function env(identityWorker: Fetcher | null = identity(PEOPLE)): Env {
  return { ENVIRONMENT: "test", PLATFORM_DB: {} as D1Database, ...(identityWorker ? { IDENTITY_WORKER: identityWorker } : {}) };
}

async function preview(
  repo: FakeRepo,
  code = CODE,
  e: Env = env(),
): Promise<{ res: Response; body: Envelope<JoinPreviewPublic>; raw: string }> {
  const res = await handlePublicJoinPreview(e, "req_pub", code, { repo });
  const raw = await res.text();
  return { res, body: JSON.parse(raw) as Envelope<JoinPreviewPublic>, raw };
}

/** The usual group: Anu made it, Ravi is a second owner, Meera an admin, Sam a member, Vik a viewer. */
function flat4b(): FakeRepo {
  const repo = createRepo();
  group(repo);
  person(repo, "usr_anu", 0, ["owner"]);
  person(repo, "usr_meera", 5, ["admin"]);
  person(repo, "usr_ravi", 10, ["owner"]);
  person(repo, "usr_sam", 20, ["builder"]);
  person(repo, "usr_vik", 30, ["viewer"]);
  return repo;
}

// ── The answer: three fields and nothing else ───────────────────────────

describe("GET /v1/join/:code/preview — what it answers", () => {
  it("answers exactly groupName, inviterFirstName and memberCount", async () => {
    const { res, body } = await preview(flat4b());
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["data", "meta"]);
    expect(Object.keys(body.data).sort()).toEqual([...JOIN_PREVIEW_PUBLIC_KEYS].sort());
    expect(Object.keys(body.data).sort()).toEqual(["groupName", "inviterFirstName", "memberCount"]);
    expect(body.data).toEqual({ groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 5 });
    expect(body.meta).toEqual({ requestId: "req_pub", cursor: null });
  });

  it("leaks no id, slug, code, email or other name anywhere in the body", async () => {
    const repo = flat4b();
    const { raw } = await preview(repo);
    for (const secret of [
      ORG, ORG.replace(/-/g, ""), ORG_PUB, "org_", "flat-4b", CODE, "usr_", "mem_", "@",
      "anu.varghese", "Varghese", "Ravi", "Kumar", "Meera", "example.com",
      ...repo.members.map((m) => m.id),
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("accepts the code as a person might have typed it", async () => {
    const { res, body } = await preview(flat4b(), "ktch-2345");
    expect(res.status).toBe(200);
    expect(body.data.groupName).toBe("Flat 4B");
  });
});

// ── Who is counted ──────────────────────────────────────────────────────

describe("memberCount", () => {
  it("counts active members holding a group role, and nobody else", async () => {
    const repo = flat4b(); // five people in the group
    person(repo, "usr_gone", 1, ["builder"], { status: "removed" }); // left: member row removed
    person(repo, "usr_demoted", 2, ["builder"], { revoked: true }); // role revoked
    person(repo, "usr_roleless", 3, []); // a member row with no role at all
    person(repo, "usr_billing", 4, ["billing_admin"]); // a billing seat, not a kitchen role
    const { body } = await preview(repo);
    expect(body.data.memberCount).toBe(5);
  });

  it("counts someone who holds two roles once", async () => {
    const repo = createRepo();
    group(repo);
    person(repo, "usr_anu", 0, ["owner", "billing_admin"]);
    person(repo, "usr_sam", 1, ["builder", "viewer"]);
    const { body } = await preview(repo);
    expect(body.data.memberCount).toBe(2);
  });

  it("reads 0 for a group nobody is in any more", async () => {
    const repo = createRepo();
    group(repo);
    person(repo, "usr_anu", 0, ["owner"], { status: "removed" });
    const calls: IdentityCall[] = [];
    const { res, body } = await preview(repo, CODE, env(identity(PEOPLE, { calls })));
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ groupName: "Flat 4B", inviterFirstName: null, memberCount: 0 });
    expect(calls).toHaveLength(0);
  });
});

// ── The inviter ─────────────────────────────────────────────────────────

describe("inviterFirstName", () => {
  it("is the first word of the earliest-joined owner's name, asked of identity for that one person", async () => {
    const calls: IdentityCall[] = [];
    const { body } = await preview(flat4b(), CODE, env(identity(PEOPLE, { calls })));
    expect(body.data.inviterFirstName).toBe("Anu");
    expect(calls).toEqual([
      { url: "http://identity-worker/v1/internal/identity/users/lookup", method: "POST", body: { subjectIds: ["usr_anu"] } },
    ]);
  });

  it("skips an owner who left, and an admin who joined before any remaining owner", async () => {
    const repo = createRepo();
    group(repo);
    person(repo, "usr_anu", 0, ["owner"], { status: "removed" });
    person(repo, "usr_meera", 5, ["admin"]);
    person(repo, "usr_ravi", 10, ["owner"]);
    const { body } = await preview(repo);
    expect(body.data.inviterFirstName).toBe("Ravi");
  });

  it("is never a service principal's", async () => {
    const repo = createRepo();
    group(repo);
    person(repo, "sp_bot", 0, ["owner"], { subjectType: "service_principal" });
    person(repo, "usr_meera", 5, ["owner"]);
    const { body } = await preview(repo);
    expect(body.data.inviterFirstName).toBe("Meera");
  });

  it("is null when the owner has set no name — never their email or a piece of it", async () => {
    const repo = createRepo();
    group(repo);
    person(repo, "usr_noname", 0, ["owner"]);
    const { body, raw } = await preview(repo);
    expect(body.data.inviterFirstName).toBeNull();
    expect(raw).not.toContain("noname");
    expect(raw).not.toContain("@");
  });

  it("is null when there is no owner to name, without asking identity", async () => {
    const repo = createRepo();
    group(repo);
    person(repo, "usr_sam", 0, ["builder"]);
    const calls: IdentityCall[] = [];
    const { body } = await preview(repo, CODE, env(identity(PEOPLE, { calls })));
    expect(body.data.inviterFirstName).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["there is no IDENTITY_WORKER binding", null],
    ["identity answers 500", identity(PEOPLE, { status: 500 })],
    ["identity is unreachable", identity(PEOPLE, { throws: true })],
    ["identity answers a malformed body", identity(PEOPLE, { body: { data: { users: "nope" } } })],
    ["identity does not know the person", identity([])],
    [
      "identity answers for someone else",
      identity([], { body: { data: { users: [{ subjectId: "usr_other", displayName: "Other", email: "o@example.com" }] } } }),
    ],
  ])("is null, and the preview still answers 200, when %s", async (_label, identityWorker) => {
    const { res, body } = await preview(flat4b(), CODE, env(identityWorker));
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ groupName: "Flat 4B", inviterFirstName: null, memberCount: 5 });
  });

  it("takes the first word of a name, and shows none for a blank name or one that is an email address", () => {
    expect(firstNameOf("Anu Varghese")).toBe("Anu");
    expect(firstNameOf("  Anu   Varghese  ")).toBe("Anu");
    expect(firstNameOf("Anu")).toBe("Anu");
    expect(firstNameOf("Anu\tVarghese")).toBe("Anu");
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf("   ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf("anu@example.com")).toBeNull();
    expect(firstNameOf("anu@example.com Varghese")).toBeNull();
  });
});

// ── Codes that name no joinable group ───────────────────────────────────

describe("unknown, malformed and rotated codes", () => {
  it("answer one identical 404, whichever it is", async () => {
    const repo = flat4b();
    // Rotated: WASK2345 was this group's link until an owner rotated it.
    repo.orgs[0] = { ...repo.orgs[0]!, joinCode: "WASK2345" };
    expect((await preview(repo, "WASK2345")).res.status).toBe(200);
    repo.orgs[0] = { ...repo.orgs[0]!, joinCode: "NEWC2345" };
    // A suspended group with a code of its own.
    repo.orgs.push({ ...repo.orgs[0]!, id: asUuid("11111111-2222-4333-8444-555555555555"), status: "suspended", joinCode: "FRZN2345" });

    const answers: string[] = [];
    for (const code of ["ZZZZ2345", "WASK2345", "FRZN2345", "short", "KTCH23456", "%E0%A4%A", "KTCH%2F2345", "ABCD-EFG0", ""]) {
      const { res, raw } = await preview(repo, code);
      expect(res.status).toBe(404);
      answers.push(raw);
    }
    expect(new Set(answers).size).toBe(1);
    expect(JSON.parse(answers[0]!)).toEqual({
      error: { code: "not_found", message: "No group found for that join link", details: {}, requestId: "req_pub" },
    });

    // The new code still works.
    expect((await preview(repo, "NEWC2345")).res.status).toBe(200);
  });

  it("is the same 404 the signed-in preview answers", async () => {
    const repo = flat4b();
    // An unknown code is answered after the code lookup alone.
    const signedIn = await handlePreviewJoin(env(), "req_pub", { subjectId: "usr_x", subjectType: "user" }, "ZZZZ2345", {
      repo: repo as unknown as JoinLinkRepo,
    });
    const signedOut = await preview(repo, "ZZZZ2345");
    expect(signedOut.raw).toBe(await signedIn.text());
  });

  it("costs no read for a malformed code, and exactly one lookup for an unknown, rotated or suspended one", async () => {
    const calls: IdentityCall[] = [];
    const e = env(identity(PEOPLE, { calls }));

    const malformed = flat4b();
    await preview(malformed, "short", e);
    expect(malformed.reads).toEqual([]);

    for (const code of ["ZZZZ2345", "WASK2345", "FRZN2345"]) {
      const repo = flat4b();
      repo.orgs[0] = { ...repo.orgs[0]!, joinCode: "NEWC2345" };
      repo.orgs.push({ ...repo.orgs[0]!, id: asUuid("11111111-2222-4333-8444-555555555555"), status: "suspended", joinCode: "FRZN2345" });
      await preview(repo, code, e);
      expect(repo.reads).toEqual(["getOrganizationByJoinCode"]);
    }
    expect(calls).toHaveLength(0);
  });
});

// ── Failures ────────────────────────────────────────────────────────────

describe("failures", () => {
  it("answers 503 when the members cannot be read, and 500 when a read throws", async () => {
    const failing = flat4b();
    failing.listMembers = async (): Promise<MembershipResult<OrganizationMember[]>> => ({
      ok: false,
      error: { kind: "internal", message: "boom" },
    });
    expect((await preview(failing)).res.status).toBe(503);

    const throwing = flat4b();
    throwing.getOrganizationByJoinCode = async () => {
      throw new Error("db down");
    };
    const { res, raw } = await preview(throwing);
    expect(res.status).toBe(500);
    expect(raw).not.toContain("db down");
  });

  it("answers 503 without a database", async () => {
    const res = await handlePublicJoinPreview({ ENVIRONMENT: "test" }, "req_pub", CODE);
    expect(res.status).toBe(503);
  });
});

// ── Router ──────────────────────────────────────────────────────────────

describe("router: the signed-out preview", () => {
  // No PLATFORM_DB: a request that reaches the handler with a well-formed code
  // answers 503 "Database not configured", which proves the dispatch.
  const bareEnv: Env = { ENVIRONMENT: "test" };

  function call(path: string, method = "GET", headers: Record<string, string> = {}): Promise<Response> {
    return route(new Request(`https://membership.internal${path}`, { method, headers }), bareEnv);
  }

  it("dispatches GET /v1/join/:code/preview with no actor", async () => {
    const res = await call(`/v1/join/${CODE}/preview`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as Envelope<unknown>).error.message).toBe("Database not configured");
  });

  it("ignores actor headers: the same dispatch with or without them", async () => {
    const res = await call(`/v1/join/${CODE}/preview`, "GET", {
      "x-actor-subject-id": "usr_anu",
      "x-actor-subject-type": "user",
      "x-actor-email": "anu@example.com",
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as Envelope<unknown>).error.message).toBe("Database not configured");
  });

  it("answers a malformed code's 404 before touching the database", async () => {
    for (const path of ["/v1/join/short/preview", "/v1/join/A%2FB/preview", "/v1/join/%E0%A4%A/preview"]) {
      const res = await call(path);
      expect(res.status).toBe(404);
      expect(((await res.json()) as Envelope<unknown>).error.message).toBe("No group found for that join link");
    }
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("405s %s", async (method) => {
    expect((await call(`/v1/join/${CODE}/preview`, method)).status).toBe(405);
  });

  it.each([
    `/v1/join/${CODE}/preview/`,
    `/v1/join/${CODE}/preview/extra`,
    `/v1/join/${CODE}/PREVIEW`,
    `/v1/join/${CODE}/previews`,
    "/v1/join//preview",
    `/v1/join/${CODE}/x/preview`,
  ])("does not serve %s", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(404);
    expect(((await res.json()) as Envelope<unknown>).error.message).toMatch(/^Route not found/);
  });

  it("leaves the signed-in preview and joining requiring an actor", async () => {
    expect((await call(`/v1/join/${CODE}`)).status).toBe(401);
    expect((await call("/v1/join/preview")).status).toBe(401);
    const join = await route(
      new Request("https://membership.internal/v1/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: CODE }),
      }),
      bareEnv,
    );
    expect(join.status).toBe(401);
  });
});
