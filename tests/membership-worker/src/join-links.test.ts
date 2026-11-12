// Join links (Cookpool CP-3): the join-code routes for owners and admins, the
// group preview, joining by code and leaving — driven through the handlers with
// an in-memory repository that keeps the same rules the D1 repository enforces
// (one active member row per person, roles revoked on leave, the last-owner
// guard), a policy fake that grants by role, and an injected billing check.

import crypto from "node:crypto";
import { asUuid } from "@saas/db";
import { route } from "@membership-worker/router";
import {
  handleGetJoinCode,
  handleRotateJoinCode,
  handlePreviewJoin,
  handleJoin,
  type JoinLinkDeps,
  type JoinLinkRepo,
} from "@membership-worker/handlers/join";
import { handleLeaveOrganization, type LeaveOrganizationDeps } from "@membership-worker/handlers/leave";
import { generateJoinCode, normalizeJoinCode, orgPublicId, memberPublicId, JOIN_CODE_ALPHABET } from "@membership-worker/ids";
import type { checkBillingEntitlement } from "@membership-worker/billing-client";
import type { CheckBillingEntitlementResponse } from "@saas/contracts/billing";
import type { JoinCodeResponse, JoinPreview, JoinResponse, LeaveResponse } from "@saas/contracts/membership";
import type {
  JoinOrganizationInput,
  LeaveOrganizationInput,
  MembershipResult,
  Organization,
  OrganizationMember,
  RoleAssignment,
} from "@saas/db/membership";
import type { AppendEventWithAuditInput, StoredEvent, StoredAuditEntry } from "@saas/db/events";
import type { Env } from "@membership-worker/env";

if (!(globalThis as Record<string, unknown>).crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}

const ORG = asUuid("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
const OTHER_ORG = asUuid("11111111-2222-4333-8444-555555555555");
const ORG_PUB = orgPublicId(ORG);
const NOW = new Date("2026-11-02T10:00:00.000Z");

type Envelope<T> = {
  data: T;
  error: { code: string; message: string; details: { reason?: string; fields?: Record<string, string[]>; limit?: number } };
};

// ── In-memory repository ────────────────────────────────────────────────

type LeaveRepo = LeaveOrganizationDeps["repo"];

interface FakeRepo extends JoinLinkRepo, LeaveRepo {
  orgs: Map<string, Organization>;
  members: OrganizationMember[];
  roles: RoleAssignment[];
  pendingInvites: Map<string, number>;
  joinCalls: JoinOrganizationInput[];
  setCodeCalls: number;
}

function makeOrg(id: string, slug: string, joinCode: string | null = null, status = "active"): Organization {
  return { id, name: slug.toUpperCase(), slug, slugLower: slug, status, parentOrgId: null, joinCode, createdAt: NOW, updatedAt: NOW };
}

function createRepo(): FakeRepo {
  const orgs = new Map<string, Organization>();
  const members: OrganizationMember[] = [];
  const roles: RoleAssignment[] = [];
  const pendingInvites = new Map<string, number>();
  const joinCalls: JoinOrganizationInput[] = [];

  const activeMember = (orgId: string, subjectId: string) =>
    members.find((m) => m.orgId === orgId && m.subjectId === subjectId && m.status === "active");
  const activeRoles = (orgId: string, subjectId: string) =>
    roles.filter((r) => r.orgId === orgId && r.subjectId === subjectId && r.revokedAt === null);
  const activeCount = (orgId: string) => members.filter((m) => m.orgId === orgId && m.status === "active").length;
  const ownerCount = (orgId: string) =>
    roles.filter(
      (r) => r.orgId === orgId && r.role === "owner" && r.scopeKind === "organization" && r.revokedAt === null &&
        activeMember(orgId, r.subjectId) !== undefined,
    ).length;

  const repo: FakeRepo = {
    orgs, members, roles, pendingInvites, joinCalls, setCodeCalls: 0,

    async listRoleAssignments(orgId, subjectId) {
      return { ok: true, value: activeRoles(orgId, subjectId) };
    },
    async getOrganizationById(id) {
      const org = orgs.get(id);
      return org ? { ok: true, value: org } : { ok: false, error: { kind: "not_found" } };
    },
    async getOrganizationByJoinCode(code) {
      const org = [...orgs.values()].find((o) => o.joinCode === code);
      return org ? { ok: true, value: org } : { ok: false, error: { kind: "not_found" } };
    },
    async setOrganizationJoinCode(orgId, code, updatedAt, options) {
      repo.setCodeCalls += 1;
      const org = orgs.get(orgId);
      if (!org) return { ok: false, error: { kind: "not_found" } };
      if (options?.onlyIfUnset && org.joinCode) return { ok: true, value: org };
      if ([...orgs.values()].some((o) => o.id !== orgId && o.joinCode === code)) {
        return { ok: false, error: { kind: "conflict", entity: "join_code" } };
      }
      const next = { ...org, joinCode: code, updatedAt };
      orgs.set(orgId, next);
      return { ok: true, value: next };
    },
    async getActiveMemberBySubject(orgId, subjectId) {
      const m = activeMember(orgId, subjectId);
      return m ? { ok: true, value: m } : { ok: false, error: { kind: "not_found" } };
    },
    async countActiveMembers(orgId) {
      return { ok: true, value: activeCount(orgId) };
    },
    async countBillableMembers(orgId) {
      return { ok: true, value: activeCount(orgId) + (pendingInvites.get(orgId) ?? 0) };
    },
    async listOrganizationsForSubject(subjectId) {
      const ids = new Set(members.filter((m) => m.subjectId === subjectId && m.status === "active").map((m) => m.orgId));
      return { ok: true, value: [...ids].map((id) => orgs.get(id)!).filter(Boolean) };
    },
    async countActiveOwners(orgId) {
      return { ok: true, value: ownerCount(orgId) };
    },
    async joinOrganization(input) {
      joinCalls.push(input);
      if (activeMember(input.orgId, input.subjectId)) {
        return { ok: false, error: { kind: "conflict", entity: "organization_member" } };
      }
      let member = members.find((m) => m.orgId === input.orgId && m.subjectId === input.subjectId);
      if (member) {
        member.status = "active";
        member.updatedAt = input.joinedAt;
      } else {
        member = {
          id: input.memberId, orgId: input.orgId, subjectId: input.subjectId, subjectType: input.subjectType,
          status: "active", createdAt: input.joinedAt, updatedAt: input.joinedAt,
        };
        members.push(member);
      }
      const roleAssignment: RoleAssignment = {
        id: input.roleAssignmentId, orgId: input.orgId, subjectId: input.subjectId, subjectType: input.subjectType,
        role: input.role, scopeKind: "organization", scopeRef: null, createdAt: input.joinedAt, revokedAt: null,
      };
      roles.push(roleAssignment);
      return { ok: true, value: { member: { ...member }, roleAssignment } };
    },
    async leaveOrganization(input: LeaveOrganizationInput) {
      const member = activeMember(input.orgId, input.subjectId);
      if (!member) return { ok: false, error: { kind: "not_found" } };
      const isOwner = activeRoles(input.orgId, input.subjectId).some((r) => r.role === "owner");
      if (isOwner && ownerCount(input.orgId) <= 1 && activeCount(input.orgId) > 1) {
        return { ok: false, error: { kind: "conflict", entity: "last_owner" } };
      }
      member.status = "removed";
      member.updatedAt = input.at;
      const revoked = activeRoles(input.orgId, input.subjectId);
      for (const r of revoked) r.revokedAt = input.at;
      return { ok: true, value: { member: { ...member }, revokedRoles: revoked } };
    },
  };
  return repo;
}

/** Seed an org with members: `[subjectId, role]` pairs. */
function seed(repo: FakeRepo, orgId: string, slug: string, people: Array<[string, string]>, joinCode: string | null = null) {
  repo.orgs.set(orgId, makeOrg(orgId, slug, joinCode));
  for (const [subjectId, role] of people) {
    repo.members.push({
      id: crypto.randomUUID(), orgId, subjectId, subjectType: "user", status: "active", createdAt: NOW, updatedAt: NOW,
    });
    repo.roles.push({
      id: crypto.randomUUID(), orgId, subjectId, subjectType: "user", role, scopeKind: "organization",
      scopeRef: null, createdAt: NOW, revokedAt: null,
    });
  }
}

// ── Policy, billing and events fakes ────────────────────────────────────

const MANAGER_ACTIONS: Record<string, string[]> = {
  owner: ["organization.join_code.read", "organization.join_code.rotate"],
  admin: ["organization.join_code.read", "organization.join_code.rotate"],
};

/** A policy-worker that grants the join-code actions to owners and admins only. */
function policyByRole(seen: string[] = []): Fetcher {
  return {
    fetch: async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { action: string; context: { memberships: Array<{ role: string }> } };
      seen.push(body.action);
      const allow = body.context.memberships.some((m) => (MANAGER_ACTIONS[m.role] ?? []).includes(body.action));
      return Response.json({ data: { allow, reason: allow ? "granted" : "no_matching_role", policyVersion: 1, derivedScope: {} } });
    },
  } as unknown as Fetcher;
}

function membersLimit(limitValue: number | null, calls: Array<[string, string]> = []): typeof checkBillingEntitlement {
  return (async (_binding: Fetcher, orgId: string, key: string) => {
    calls.push([orgId, key]);
    const decision: CheckBillingEntitlementResponse = {
      allowed: true, orgId, entitlementKey: key, valueType: "quantity", limitValue, source: "plan", subscriptionId: null,
    };
    return { kind: "decision" as const, decision };
  }) as typeof checkBillingEntitlement;
}

function membersDisabled(): typeof checkBillingEntitlement {
  return (async (_binding: Fetcher, orgId: string, key: string) => ({
    kind: "decision" as const,
    decision: { allowed: false as const, orgId, entitlementKey: key, reason: "disabled" as const },
  })) as typeof checkBillingEntitlement;
}

function billingDown(): typeof checkBillingEntitlement {
  return (async () => ({ kind: "service_error" as const })) as typeof checkBillingEntitlement;
}

function recordingEvents() {
  const appended: AppendEventWithAuditInput[] = [];
  return {
    appended,
    eventsRepo: {
      appendEventWithAudit: async (input: AppendEventWithAuditInput) => {
        appended.push(input);
        return { ok: true as const, value: { event: {} as StoredEvent, audit: {} as StoredAuditEntry } };
      },
    },
  };
}

/** kitchen-worker's internal balance route (CP-19), as leaving asks it: every request recorded. */
interface KitchenCall {
  url: string;
  headers: Headers;
  method: string;
}

/**
 * A kitchen-worker that answers each balance from `balances` (by subject id;
 * 0 for anyone else) in INR — or answers `status`, or throws.
 */
function kitchenWorker(
  opts: { balances?: Record<string, number>; other?: Record<string, number>; status?: number; body?: unknown; throws?: boolean; calls?: KitchenCall[] } = {},
): Fetcher {
  return {
    fetch: async (url: string, init: RequestInit = {}) => {
      opts.calls?.push({ url, headers: new Headers(init.headers), method: init.method ?? "GET" });
      if (opts.throws) throw new Error("kitchen-worker is down");
      if (opts.status) return Response.json(opts.body ?? { error: { code: "internal_error" } }, { status: opts.status });
      if (opts.body !== undefined) return Response.json(opts.body);
      const subject = decodeURIComponent(new URL(url).pathname.split("/")[7] ?? "");
      return Response.json({
        data: { balanceMinor: opts.balances?.[subject] ?? 0, otherMinor: opts.other?.[subject] ?? 0, currency: "INR" },
        meta: { requestId: "req_kitchen", cursor: null },
      });
    },
  } as unknown as Fetcher;
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    POLICY_WORKER: policyByRole(),
    KITCHEN_WORKER: kitchenWorker(),
    PLATFORM_DB: {} as D1Database,
    ENVIRONMENT: "test",
    ...overrides,
  };
}

function codes(...list: string[]): () => string {
  let i = 0;
  return () => list[i++ % list.length]!;
}

const actor = (subjectId: string) => ({ subjectId, subjectType: "user" });

function joinRequest(body: unknown): Request {
  return new Request("https://membership.internal/v1/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

// ── ids ─────────────────────────────────────────────────────────────────

describe("join code ids", () => {
  it("generates 8 characters from the alphabet without look-alikes", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(code).not.toMatch(/[01OIL]/);
      for (const ch of code) expect(JOIN_CODE_ALPHABET).toContain(ch);
    }
  });

  it("normalizes what people type and rejects what cannot be a code", () => {
    expect(normalizeJoinCode(" ktch-2345 ")).toBe("KTCH2345");
    expect(normalizeJoinCode("KTCH 2345")).toBe("KTCH2345");
    expect(normalizeJoinCode("KTCH234")).toBeNull();
    expect(normalizeJoinCode("KTCH23456")).toBeNull();
    expect(normalizeJoinCode("KTCH2340")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeJoinCode("../admin")).toBeNull();
  });
});

// ── GET /v1/organizations/:org/join-code ────────────────────────────────

describe("handleGetJoinCode", () => {
  it("mints the code on an owner's first read and returns the same code after", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]]);
    const seen: string[] = [];
    const deps: JoinLinkDeps = { repo, now: () => NOW, generateCode: codes("KTCH2345", "ZZZZ2345") };

    const first = await handleGetJoinCode(env({ POLICY_WORKER: policyByRole(seen) }), "req_1", actor("usr_owner"), ORG_PUB, deps);
    expect(first.status).toBe(200);
    expect((await json<JoinCodeResponse>(first)).data).toEqual({ code: "KTCH2345" });
    expect(seen).toEqual(["organization.join_code.read"]);
    expect(repo.orgs.get(ORG)!.joinCode).toBe("KTCH2345");

    const again = await handleGetJoinCode(env(), "req_2", actor("usr_owner"), ORG_PUB, deps);
    expect((await json<JoinCodeResponse>(again)).data.code).toBe("KTCH2345");
    expect(repo.setCodeCalls).toBe(1);
  });

  it("lets an admin read it", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_admin", "admin"]], "KTCH2345");
    const res = await handleGetJoinCode(env(), "req", actor("usr_admin"), ORG_PUB, { repo });
    expect(res.status).toBe(200);
    expect((await json<JoinCodeResponse>(res)).data.code).toBe("KTCH2345");
  });

  it("retries with a fresh code when another group already has the one generated", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]]);
    seed(repo, OTHER_ORG, "lunch-club", [["usr_x", "owner"]], "TAKEN234");
    const res = await handleGetJoinCode(env(), "req", actor("usr_owner"), ORG_PUB, {
      repo, now: () => NOW, generateCode: codes("TAKEN234", "FRESH234"),
    });
    expect(res.status).toBe(200);
    expect((await json<JoinCodeResponse>(res)).data.code).toBe("FRESH234");
    expect(repo.setCodeCalls).toBe(2);
  });

  it("answers 503 when every attempt collides", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]]);
    seed(repo, OTHER_ORG, "lunch-club", [["usr_x", "owner"]], "TAKEN234");
    const res = await handleGetJoinCode(env(), "req", actor("usr_owner"), ORG_PUB, {
      repo, now: () => NOW, generateCode: codes("TAKEN234"),
    });
    expect(res.status).toBe(503);
  });

  it.each([
    ["a member (builder)", "usr_member"],
    ["a viewer", "usr_viewer"],
    ["someone outside the group", "usr_stranger"],
  ])("is an opaque 404 for %s, and mints nothing", async (_label, subjectId) => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_member", "builder"], ["usr_viewer", "viewer"]]);
    const res = await handleGetJoinCode(env(), "req", actor(subjectId), ORG_PUB, {
      repo, generateCode: codes("KTCH2345"),
    });
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe("not_found");
    expect(repo.orgs.get(ORG)!.joinCode).toBeNull();
    expect(repo.setCodeCalls).toBe(0);
  });

  it("404s a malformed org id and 503s without a policy binding", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]]);
    expect((await handleGetJoinCode(env(), "req", actor("usr_owner"), "org_nope", { repo })).status).toBe(404);
    const noPolicyEnv: Env = { PLATFORM_DB: {} as D1Database, ENVIRONMENT: "test" };
    const noPolicy = await handleGetJoinCode(noPolicyEnv, "req", actor("usr_owner"), ORG_PUB, { repo });
    expect(noPolicy.status).toBe(503);
  });
});

// ── POST /v1/organizations/:org/join-code/rotate ────────────────────────

describe("handleRotateJoinCode", () => {
  it("replaces the code, the old link stops resolving, and the rotation is audited without the code", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_admin", "admin"]], "PREV2345");
    const { appended, eventsRepo } = recordingEvents();
    const seen: string[] = [];

    const res = await handleRotateJoinCode(env({ POLICY_WORKER: policyByRole(seen) }), "req_rot", actor("usr_admin"), ORG_PUB, {
      repo, eventsRepo, now: () => NOW, generateId: () => "evt_id", generateCode: codes("PREV2345", "NEWC2345"),
    });
    expect(res.status).toBe(200);
    expect((await json<JoinCodeResponse>(res)).data.code).toBe("NEWC2345");
    expect(seen).toEqual(["organization.join_code.rotate"]);
    expect(repo.orgs.get(ORG)!.joinCode).toBe("NEWC2345");

    const old = await handlePreviewJoin(env(), "req", actor("usr_x"), "PREV2345", { repo });
    expect(old.status).toBe(404);

    expect(appended).toHaveLength(1);
    expect(appended[0]!.event.type).toBe("membership.join_link.rotated");
    expect(appended[0]!.event.actorId).toBe("usr_admin");
    expect(appended[0]!.audit.category).toBe("membership");
    const logged = JSON.stringify(appended[0]);
    expect(logged).not.toContain("NEWC2345");
    expect(logged).not.toContain("PREV2345");
  });

  it("is an opaque 404 for a member, and leaves the code alone", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_member", "builder"]], "PREV2345");
    const res = await handleRotateJoinCode(env(), "req", actor("usr_member"), ORG_PUB, {
      repo, generateCode: codes("NEWC2345"),
    });
    expect(res.status).toBe(404);
    expect(repo.orgs.get(ORG)!.joinCode).toBe("PREV2345");
  });
});

// ── GET /v1/join/:code ──────────────────────────────────────────────────

describe("handlePreviewJoin", () => {
  it("shows the group to anyone signed in", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_anu", "builder"]], "KTCH2345");
    const res = await handlePreviewJoin(env(), "req", actor("usr_stranger"), "KTCH2345", { repo });
    expect(res.status).toBe(200);
    expect((await json<JoinPreview>(res)).data).toEqual({
      orgId: ORG_PUB, name: "FLAT-4B", slug: "flat-4b", memberCount: 2, alreadyMember: false,
    });
  });

  it("says when the caller is already in, and accepts the code as typed", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_anu", "builder"]], "KTCH2345");
    const res = await handlePreviewJoin(env(), "req", actor("usr_anu"), "ktch-2345", { repo });
    expect(res.status).toBe(200);
    expect((await json<JoinPreview>(res)).data.alreadyMember).toBe(true);
  });

  it("404s an unknown code, a malformed one, and a suspended group", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]], "KTCH2345");
    repo.orgs.set(OTHER_ORG, makeOrg(OTHER_ORG, "frozen", "FRZN2345", "suspended"));
    for (const code of ["UNKN2345", "short", "%E0%A4%A", "FRZN2345"]) {
      const res = await handlePreviewJoin(env(), "req", actor("usr_x"), code, { repo });
      expect(res.status).toBe(404);
      expect((await json(res)).error.code).toBe("not_found");
    }
  });
});

// ── POST /v1/join ───────────────────────────────────────────────────────

describe("handleJoin", () => {
  function joinDeps(repo: FakeRepo, extra: Partial<JoinLinkDeps> = {}): JoinLinkDeps {
    return { repo, now: () => NOW, generateId: () => "evt_id", checkEntitlement: membersLimit(50), ...extra };
  }

  it("joins a new person as a builder, checks limit.members, and records membership.joined_via_link", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]], "KTCH2345");
    const { appended, eventsRepo } = recordingEvents();
    const billingCalls: Array<[string, string]> = [];

    const res = await handleJoin(joinRequest({ code: "ktch 2345" }), env(), "req_join", actor("usr_anu"), joinDeps(repo, {
      eventsRepo, checkEntitlement: membersLimit(50, billingCalls),
    }));

    expect(res.status).toBe(201);
    const data = (await json<JoinResponse>(res)).data;
    expect(data.orgId).toBe(ORG_PUB);
    expect(data.slug).toBe("flat-4b");
    expect(data.alreadyMember).toBe(false);
    expect(data.memberId).toMatch(/^mem_[0-9a-f]{32}$/);

    expect(billingCalls).toEqual([[ORG_PUB, "limit.members"]]);
    expect(repo.joinCalls).toHaveLength(1);
    expect(repo.joinCalls[0]!.role).toBe("builder");
    expect(repo.joinCalls[0]!.subjectId).toBe("usr_anu");
    const roles = await repo.listRoleAssignments(ORG, "usr_anu");
    expect(roles.ok && roles.value.map((r) => r.role)).toEqual(["builder"]);

    expect(appended).toHaveLength(1);
    expect(appended[0]!.event.type).toBe("membership.joined_via_link");
    expect(appended[0]!.event.actorId).toBe("usr_anu");
    expect(appended[0]!.event.payload).toMatchObject({ role: "builder", memberId: data.memberId, orgId: ORG_PUB });
    expect(JSON.stringify(appended[0])).not.toContain("KTCH2345");
  });

  it("is idempotent for someone already in the group: 200, nothing written", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_anu", "builder"]], "KTCH2345");
    const { appended, eventsRepo } = recordingEvents();
    const billingCalls: Array<[string, string]> = [];

    const res = await handleJoin(joinRequest({ code: "KTCH2345" }), env(), "req", actor("usr_anu"), joinDeps(repo, {
      eventsRepo, checkEntitlement: membersLimit(1, billingCalls),
    }));

    expect(res.status).toBe(200);
    const data = (await json<JoinResponse>(res)).data;
    expect(data).toMatchObject({ orgId: ORG_PUB, slug: "flat-4b", alreadyMember: true });
    expect(data.memberId).toBe(memberPublicId(repo.members.find((m) => m.subjectId === "usr_anu")!.id));
    expect(repo.joinCalls).toHaveLength(0);
    expect(billingCalls).toHaveLength(0); // a full group still lets its own members back in
    expect(appended).toHaveLength(0);
  });

  it("treats losing a race with the same person's other join as already joined", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]], "KTCH2345");
    const realJoin = repo.joinOrganization.bind(repo);
    // The other tap lands between this request's membership check and its write.
    repo.joinOrganization = async (input) => {
      await realJoin({ ...input, memberId: crypto.randomUUID(), roleAssignmentId: crypto.randomUUID() });
      return realJoin(input);
    };
    const res = await handleJoin(joinRequest({ code: "KTCH2345" }), env(), "req", actor("usr_anu"), joinDeps(repo));
    expect(res.status).toBe(200);
    expect((await json<JoinResponse>(res)).data.alreadyMember).toBe(true);
  });

  it("refuses a full group with 412 limit_reached, counting pending invitations as seats", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_anu", "builder"]], "KTCH2345");
    repo.pendingInvites.set(ORG, 1);
    const res = await handleJoin(joinRequest({ code: "KTCH2345" }), env(), "req", actor("usr_dev"), joinDeps(repo, {
      checkEntitlement: membersLimit(3),
    }));
    expect(res.status).toBe(412);
    const body = await json(res);
    expect(body.error.code).toBe("precondition_failed");
    expect(body.error.details.reason).toBe("limit_reached");
    expect(repo.joinCalls).toHaveLength(0);

    // A seat frees up when the invitation goes away.
    repo.pendingInvites.set(ORG, 0);
    const ok = await handleJoin(joinRequest({ code: "KTCH2345" }), env(), "req", actor("usr_dev"), joinDeps(repo, {
      checkEntitlement: membersLimit(3),
    }));
    expect(ok.status).toBe(201);
  });

  it("passes the billing reason through when members are not on the plan", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]], "KTCH2345");
    const res = await handleJoin(joinRequest({ code: "KTCH2345" }), env(), "req", actor("usr_dev"), joinDeps(repo, {
      checkEntitlement: membersDisabled(),
    }));
    expect(res.status).toBe(412);
    expect((await json(res)).error.details.reason).toBe("disabled");
  });

  it("fails closed when billing cannot answer or is not bound", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]], "KTCH2345");
    const down = await handleJoin(joinRequest({ code: "KTCH2345" }), env(), "req", actor("usr_dev"), joinDeps(repo, {
      checkEntitlement: billingDown(),
    }));
    expect(down.status).toBe(503);

    const unbound = await handleJoin(joinRequest({ code: "KTCH2345" }), env(), "req", actor("usr_dev"), {
      repo, now: () => NOW,
    });
    expect(unbound.status).toBe(503);
    expect(repo.joinCalls).toHaveLength(0);
  });

  it("caps open groups per person, counting groups joined", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]], "KTCH2345");
    for (let i = 0; i < 50; i++) {
      const id = crypto.randomUUID();
      seed(repo, id, `g-${i}`, [["usr_busy", "builder"]]);
    }
    const res = await handleJoin(joinRequest({ code: "KTCH2345" }), env({ OPEN_GROUPS: "true" }), "req", actor("usr_busy"), joinDeps(repo));
    expect(res.status).toBe(412);
    const body = await json(res);
    expect(body.error.details).toEqual({ reason: "groups_per_person", limit: 50 });

    const fine = await handleJoin(joinRequest({ code: "KTCH2345" }), env({ OPEN_GROUPS: "true" }), "req", actor("usr_anu"), joinDeps(repo));
    expect(fine.status).toBe(201);
  });

  it("lets someone who left come back", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_anu", "builder"]], "KTCH2345");
    const firstId = repo.members.find((m) => m.subjectId === "usr_anu")!.id;
    expect((await handleLeaveOrganization(env(), "req", actor("usr_anu"), ORG_PUB, { repo, now: () => NOW })).status).toBe(200);

    const res = await handleJoin(joinRequest({ code: "KTCH2345" }), env(), "req", actor("usr_anu"), joinDeps(repo));
    expect(res.status).toBe(201);
    expect((await json<JoinResponse>(res)).data.memberId).toBe(memberPublicId(firstId));
    const roles = await repo.listRoleAssignments(ORG, "usr_anu");
    expect(roles.ok && roles.value.map((r) => r.role)).toEqual(["builder"]);
  });

  it("validates the body and 404s unknown or malformed codes", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]], "KTCH2345");
    const deps = joinDeps(repo);

    expect((await handleJoin(joinRequest("not json"), env(), "req", actor("usr_x"), deps)).status).toBe(400);
    const missing = await handleJoin(joinRequest({}), env(), "req", actor("usr_x"), deps);
    expect(missing.status).toBe(422);
    expect((await json(missing)).error.details.fields).toHaveProperty("code");
    expect((await handleJoin(joinRequest({ code: 12345678 }), env(), "req", actor("usr_x"), deps)).status).toBe(422);
    expect((await handleJoin(joinRequest({ code: "UNKN2345" }), env(), "req", actor("usr_x"), deps)).status).toBe(404);
    expect((await handleJoin(joinRequest({ code: "x" }), env(), "req", actor("usr_x"), deps)).status).toBe(404);
    expect(repo.joinCalls).toHaveLength(0);
  });

  it("is refused under the Solo profile", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]], "KTCH2345");
    const res = await handleJoin(joinRequest({ code: "KTCH2345" }), env({ SOLO_MODE: "true" }), "req", actor("usr_x"), joinDeps(repo));
    expect(res.status).toBe(403);
    expect((await json(res)).error.details.reason).toBe("solo_profile");
  });
});

// ── POST /v1/organizations/:org/leave ───────────────────────────────────

describe("handleLeaveOrganization", () => {
  it("removes the caller, revokes their roles, and records membership.left", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_anu", "builder"]]);
    const { appended, eventsRepo } = recordingEvents();
    const memberId = repo.members.find((m) => m.subjectId === "usr_anu")!.id;

    const res = await handleLeaveOrganization(env(), "req_leave", actor("usr_anu"), ORG_PUB, {
      repo, eventsRepo, now: () => NOW, generateId: () => "evt_id",
    });
    expect(res.status).toBe(200);
    expect((await json<LeaveResponse>(res)).data).toEqual({ orgId: ORG_PUB, memberId: memberPublicId(memberId), left: true });
    expect((await repo.getActiveMemberBySubject(ORG, "usr_anu")).ok).toBe(false);
    const roles = await repo.listRoleAssignments(ORG, "usr_anu");
    expect(roles.ok && roles.value).toEqual([]);

    expect(appended).toHaveLength(1);
    expect(appended[0]!.event.type).toBe("membership.left");
    expect(appended[0]!.event.actorId).toBe("usr_anu");
    expect(appended[0]!.event.payload).toMatchObject({ previousRoles: ["builder"], revokedRoleCount: 1 });
  });

  it("refuses the last owner while others remain (409 last_owner)", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_anu", "builder"]]);
    const res = await handleLeaveOrganization(env(), "req", actor("usr_owner"), ORG_PUB, { repo, now: () => NOW });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("conflict");
    expect(body.error.details.reason).toBe("last_owner");
    expect((await repo.getActiveMemberBySubject(ORG, "usr_owner")).ok).toBe(true);
  });

  it("lets the last owner leave once they are the only one left", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]]);
    const res = await handleLeaveOrganization(env(), "req", actor("usr_owner"), ORG_PUB, { repo, now: () => NOW });
    expect(res.status).toBe(200);
  });

  it("lets one of two owners leave", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_meera", "owner"], ["usr_anu", "builder"]]);
    const res = await handleLeaveOrganization(env(), "req", actor("usr_owner"), ORG_PUB, { repo, now: () => NOW });
    expect(res.status).toBe(200);
  });

  it("maps the repository's own last-owner guard (a concurrent leave) to the same 409", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_meera", "owner"], ["usr_anu", "builder"]]);
    // Both owners passed the handler's check; Meera's leave committed first.
    repo.leaveOrganization = async (): Promise<MembershipResult<never>> => ({
      ok: false, error: { kind: "conflict", entity: "last_owner" },
    });
    const res = await handleLeaveOrganization(env(), "req", actor("usr_owner"), ORG_PUB, { repo, now: () => NOW });
    expect(res.status).toBe(409);
    expect((await json(res)).error.details.reason).toBe("last_owner");
  });

  it("404s someone who is not in the group, and a malformed org id", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]]);
    expect((await handleLeaveOrganization(env(), "req", actor("usr_stranger"), ORG_PUB, { repo })).status).toBe(404);
    expect((await handleLeaveOrganization(env(), "req", actor("usr_owner"), "org_bad", { repo })).status).toBe(404);
  });
});

// ── Leaving with a balance (Cookpool CP-19, risks CP-L) ─────────────────

describe("handleLeaveOrganization: money in the group", () => {
  function group(): FakeRepo {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"], ["usr_anu", "builder"]]);
    return repo;
  }

  it("asks kitchen-worker for the caller's balance, over the internal route, naming itself", async () => {
    const repo = group();
    const calls: KitchenCall[] = [];
    const res = await handleLeaveOrganization(env({ KITCHEN_WORKER: kitchenWorker({ calls }) }), "req_leave", actor("usr_anu"), ORG_PUB, {
      repo, now: () => NOW,
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe(`/v1/internal/kitchen/organizations/${ORG_PUB}/subjects/usr_anu/balance`);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers.get("x-internal-actor")).toBe("membership-worker");
    expect(calls[0]!.headers.get("x-request-id")).toBe("req_leave");
  });

  it.each([
    ["owes", -1250, "You still owe money in this group. Settle up before you leave."],
    ["is owed", 800, "You are still owed money in this group. Settle up before you leave."],
  ])("refuses someone who %s money there (409 balance_not_settled), and leaves them in the group", async (_how, balance, message) => {
    const repo = group();
    const { appended, eventsRepo } = recordingEvents();
    const res = await handleLeaveOrganization(
      env({ KITCHEN_WORKER: kitchenWorker({ balances: { usr_anu: balance } }) }),
      "req",
      actor("usr_anu"),
      ORG_PUB,
      { repo, eventsRepo, now: () => NOW },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string; details: Record<string, unknown> } };
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toBe(message);
    expect(body.error.details).toEqual({ reason: "balance_not_settled", balanceMinor: balance, otherMinor: 0, currency: "INR" });
    expect((await repo.getActiveMemberBySubject(ORG, "usr_anu")).ok).toBe(true);
    expect(appended).toHaveLength(0);
  });

  // cookpool-spliteco SE3: a kitchen group keeps two balances; Other (added in
  // Spliteco) is not shown in Cookpool, and leaving is still refused while it is open.
  it.each([
    ["owes", -400000, "You still owe money in this group in Spliteco. Settle up before you leave."],
    ["is owed", 50, "You are still owed money in this group in Spliteco. Settle up before you leave."],
  ])("refuses someone who %s money in the Other balance, with Kitchen settled", async (_how, other, message) => {
    const repo = group();
    const res = await handleLeaveOrganization(
      env({ KITCHEN_WORKER: kitchenWorker({ other: { usr_anu: other } }) }),
      "req",
      actor("usr_anu"),
      ORG_PUB,
      { repo, now: () => NOW },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string; details: Record<string, unknown> } };
    expect(body.error.message).toBe(message);
    expect(body.error.details).toEqual({ reason: "balance_not_settled", balanceMinor: 0, otherMinor: other, currency: "INR" });
    expect((await repo.getActiveMemberBySubject(ORG, "usr_anu")).ok).toBe(true);
  });

  it("refuses when the Other balance is malformed (cannot tell), and reads a kitchen-worker without it as Kitchen alone", async () => {
    const bad = await handleLeaveOrganization(
      env({ KITCHEN_WORKER: kitchenWorker({ body: { data: { balanceMinor: 0, otherMinor: "12", currency: "INR" } } }) }),
      "req",
      actor("usr_anu"),
      ORG_PUB,
      { repo: group(), now: () => NOW },
    );
    expect(bad.status).toBe(503);
    const old = await handleLeaveOrganization(
      env({ KITCHEN_WORKER: kitchenWorker({ body: { data: { balanceMinor: 0, currency: "INR" } } }) }),
      "req",
      actor("usr_anu"),
      ORG_PUB,
      { repo: group(), now: () => NOW },
    );
    expect(old.status).toBe(200);
  });

  it("lets someone at zero leave", async () => {
    const repo = group();
    const res = await handleLeaveOrganization(
      env({ KITCHEN_WORKER: kitchenWorker({ balances: { usr_owner: 500 } }) }),
      "req",
      actor("usr_anu"),
      ORG_PUB,
      { repo, now: () => NOW },
    );
    expect(res.status).toBe(200);
    expect((await repo.getActiveMemberBySubject(ORG, "usr_anu")).ok).toBe(false);
  });

  it.each([
    ["kitchen-worker is not bound", { KITCHEN_WORKER: undefined }],
    ["the call throws (kitchen-worker unreachable)", { KITCHEN_WORKER: kitchenWorker({ throws: true }) }],
    ["kitchen-worker answers 503", { KITCHEN_WORKER: kitchenWorker({ status: 503 }) }],
    ["kitchen-worker does not know the route (404)", { KITCHEN_WORKER: kitchenWorker({ status: 404 }) }],
    ["the answer has no balance", { KITCHEN_WORKER: kitchenWorker({ body: { data: { currency: "INR" } } }) }],
    ["the balance is not a whole number", { KITCHEN_WORKER: kitchenWorker({ body: { data: { balanceMinor: 1.5, currency: "INR" } } }) }],
    ["the answer is not JSON", {
      KITCHEN_WORKER: { fetch: async () => new Response("<html>", { status: 200 }) } as unknown as Fetcher,
    }],
  ])("fails closed with 503 when %s: nobody leaves owing because of an outage", async (_case, overrides) => {
    const repo = group();
    const res = await handleLeaveOrganization(env(overrides as Partial<Env>), "req", actor("usr_anu"), ORG_PUB, { repo, now: () => NOW });
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("internal_error");
    expect((await repo.getActiveMemberBySubject(ORG, "usr_anu")).ok).toBe(true);
  });

  it("asks nothing for someone not in the group, nor for a last owner who cannot leave anyway", async () => {
    const repo = group();
    const calls: KitchenCall[] = [];
    const kitchen = env({ KITCHEN_WORKER: kitchenWorker({ calls, balances: { usr_owner: -300 } }) });
    expect((await handleLeaveOrganization(kitchen, "req", actor("usr_stranger"), ORG_PUB, { repo })).status).toBe(404);
    const owner = await handleLeaveOrganization(kitchen, "req", actor("usr_owner"), ORG_PUB, { repo, now: () => NOW });
    expect((await json(owner)).error.details.reason).toBe("last_owner");
    expect(calls).toHaveLength(0);
  });

  it("holds a group's only member to the same rule", async () => {
    const repo = createRepo();
    seed(repo, ORG, "flat-4b", [["usr_owner", "owner"]]);
    const res = await handleLeaveOrganization(
      env({ KITCHEN_WORKER: kitchenWorker({ balances: { usr_owner: -300 } }) }),
      "req",
      actor("usr_owner"),
      ORG_PUB,
      { repo, now: () => NOW },
    );
    expect(res.status).toBe(409);
    expect((await json(res)).error.details.reason).toBe("balance_not_settled");
  });
});

// ── Router wiring ───────────────────────────────────────────────────────

describe("router: join-link routes", () => {
  const actorHeaders = { "x-actor-subject-id": "usr_anu", "x-actor-subject-type": "user", "content-type": "application/json" };
  // No PLATFORM_DB: a request that reaches its handler answers 503 "Database
  // not configured", which proves the dispatch without a database.
  const bareEnv: Env = { ENVIRONMENT: "test", POLICY_WORKER: policyByRole() };

  function call(path: string, method: string, headers: Record<string, string> = actorHeaders, body?: unknown): Promise<Response> {
    return route(
      new Request(`https://membership.internal${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      bareEnv,
    );
  }

  it.each([
    ["/v1/join", "POST", { code: "KTCH2345" }],
    ["/v1/join/KTCH2345", "GET", undefined],
    [`/v1/organizations/${ORG_PUB}/join-code`, "GET", undefined],
    [`/v1/organizations/${ORG_PUB}/join-code/rotate`, "POST", undefined],
    [`/v1/organizations/${ORG_PUB}/leave`, "POST", undefined],
  ])("dispatches %s %s to its handler", async (path, method, body) => {
    const res = await call(path, method, actorHeaders, body);
    expect(res.status).toBe(503);
    expect((await json(res)).error.message).toBe("Database not configured");
  });

  it.each([
    ["/v1/join", "POST"],
    ["/v1/join/KTCH2345", "GET"],
    [`/v1/organizations/${ORG_PUB}/join-code`, "GET"],
    [`/v1/organizations/${ORG_PUB}/join-code/rotate`, "POST"],
    [`/v1/organizations/${ORG_PUB}/leave`, "POST"],
  ])("requires an actor on %s %s", async (path, method) => {
    const res = await call(path, method, { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });

  it.each([
    ["/v1/join", "GET"],
    ["/v1/join/KTCH2345", "POST"],
    [`/v1/organizations/${ORG_PUB}/join-code`, "POST"],
    [`/v1/organizations/${ORG_PUB}/join-code/rotate`, "GET"],
    [`/v1/organizations/${ORG_PUB}/leave`, "DELETE"],
  ])("405s %s %s", async (path, method) => {
    const res = await call(path, method);
    expect(res.status).toBe(405);
  });
});
