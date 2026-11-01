// The group roster for sibling workers (Cookpool CP-7):
// GET /v1/internal/membership/organizations/:orgId/members. kitchen-worker
// reads it to check that the people a transaction names are in the group.

import { asUuid } from "@saas/db";
import type { MembershipResult, OrganizationMember, RoleAssignment } from "@saas/db/membership";
import type { RosterResponse } from "@saas/contracts/membership";
import { route } from "@membership-worker/router";
import { handleInternalMembers, highestOrgRole, type RosterRepo } from "@membership-worker/handlers/internal-members";
import type { Env } from "@membership-worker/env";

const ORG = asUuid("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
const ORG_PUB = `org_${ORG.replace(/-/g, "")}`;
const T0 = new Date("2026-11-01T00:00:00.000Z");

const env: Env = { ENVIRONMENT: "test" };

function member(subjectId: string, joinedMinutes: number, subjectType = "user"): OrganizationMember {
  const at = new Date(T0.getTime() + joinedMinutes * 60_000);
  return { id: subjectId, orgId: ORG, subjectId, subjectType, status: "active", createdAt: at, updatedAt: at };
}

function role(subjectId: string, name: string, scopeKind = "organization", revokedAt: Date | null = null): RoleAssignment {
  return {
    id: `ra-${subjectId}-${name}`, orgId: ORG, subjectId, subjectType: "user", role: name, scopeKind,
    scopeRef: scopeKind === "organization" ? null : "prj-1", createdAt: T0, revokedAt,
  };
}

interface FakeRoster extends RosterRepo {
  batches: string[][];
}

function fakeRepo(members: OrganizationMember[], roles: RoleAssignment[], options: { batched?: boolean; fail?: boolean } = {}): FakeRoster {
  const batches: string[][] = [];
  const fail = <T>(): MembershipResult<T> => ({ ok: false, error: { kind: "internal", message: "boom" } });
  const repo: FakeRoster = {
    batches,
    async listMembers(orgId) {
      if (options.fail) return fail();
      return { ok: true, value: members.filter((m) => m.orgId === orgId) };
    },
    async listRoleAssignments(orgId, subjectId) {
      return { ok: true, value: roles.filter((r) => r.orgId === orgId && r.subjectId === subjectId && r.revokedAt === null) };
    },
  };
  if (options.batched !== false) {
    repo.listRoleAssignmentsForSubjects = async (orgId, subjectIds) => {
      batches.push([...subjectIds]);
      const map = new Map<string, RoleAssignment[]>(subjectIds.map((id) => [id, []]));
      for (const r of roles) if (r.orgId === orgId && r.revokedAt === null && map.has(r.subjectId)) map.get(r.subjectId)!.push(r);
      return { ok: true, value: map };
    };
  }
  return repo;
}

async function roster(res: Response): Promise<RosterResponse["members"]> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: RosterResponse }).data.members;
}

describe("membership-worker: the internal group roster", () => {
  it("lists active members oldest first, each with their highest organization role", async () => {
    const repo = fakeRepo(
      [member("usr_anu", 5), member("usr_rahul", 0), member("sp_bot", 9, "service_principal")],
      [
        role("usr_rahul", "builder"),
        role("usr_rahul", "owner"),
        role("usr_anu", "viewer"),
        role("usr_anu", "admin", "project"),
      ],
    );
    expect(await roster(await handleInternalMembers(env, "req_1", ORG, { repo }))).toEqual([
      { subjectId: "usr_rahul", subjectType: "user", role: "owner", memberId: "mem_usr_rahul", joinedAt: "2026-11-01T00:00:00.000Z" },
      { subjectId: "usr_anu", subjectType: "user", role: "viewer", memberId: "mem_usr_anu", joinedAt: "2026-11-01T00:05:00.000Z" },
      { subjectId: "sp_bot", subjectType: "service_principal", role: null, memberId: "mem_sp_bot", joinedAt: "2026-11-01T00:09:00.000Z" },
    ]);
  });

  it("names each membership by its public mem_ id, the one the member routes take (CP-9)", async () => {
    const id = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e";
    const repo = fakeRepo([{ ...member("usr_rahul", 0), id }], [role("usr_rahul", "owner")]);
    const [rahul] = await roster(await handleInternalMembers(env, "req_1", ORG, { repo }));
    expect(rahul).toMatchObject({ memberId: "mem_0f1e2d3c4b5a49688778695a4b3c2d1e", joinedAt: T0.toISOString() });
  });

  it("accepts the organization's public id as well as its UUID", async () => {
    const repo = fakeRepo([member("usr_rahul", 0)], [role("usr_rahul", "owner")]);
    expect(await roster(await handleInternalMembers(env, "req_1", ORG_PUB, { repo }))).toHaveLength(1);
    expect(await roster(await handleInternalMembers(env, "req_1", ORG.toUpperCase(), { repo }))).toHaveLength(1);
  });

  it("is an empty list for an organization with nobody in it", async () => {
    expect(await roster(await handleInternalMembers(env, "req_1", ORG, { repo: fakeRepo([], []) }))).toEqual([]);
  });

  it("reads roles in batches D1 can bind, and falls back to one lookup per member", async () => {
    const people = Array.from({ length: 120 }, (_, i) => member(`usr_${String(i).padStart(3, "0")}`, i));
    const repo = fakeRepo(people, people.map((m) => role(m.subjectId, "builder")));
    const members = await roster(await handleInternalMembers(env, "req_1", ORG, { repo }));
    expect(members).toHaveLength(120);
    expect(members.every((m) => m.role === "builder")).toBe(true);
    expect(repo.batches.map((b) => b.length)).toEqual([90, 30]);

    const unbatched = fakeRepo(people.slice(0, 3), [role(people[0]!.subjectId, "admin")], { batched: false });
    expect((await roster(await handleInternalMembers(env, "req_1", ORG, { repo: unbatched }))).map((m) => m.role)).toEqual([
      "admin",
      null,
      null,
    ]);
  });

  it("is a 404 for an id that is neither a UUID nor an org_ id, and a 500 when the read fails", async () => {
    const bad = await handleInternalMembers(env, "req_1", "grp_123", { repo: fakeRepo([], []) });
    expect(bad.status).toBe(404);
    const failed = await handleInternalMembers(env, "req_1", ORG, { repo: fakeRepo([], [], { fail: true }) });
    expect(failed.status).toBe(500);
  });

  it("is routed for GET only, and is a 503 without a database", async () => {
    const url = `http://membership-worker/v1/internal/membership/organizations/${ORG}/members`;
    expect((await route(new Request(url), env)).status).toBe(503);
    expect((await route(new Request(url, { method: "POST" }), env)).status).toBe(405);
  });

  it("orders roles owner > admin > builder > viewer > billing_admin, ignoring revoked and project roles", () => {
    expect(highestOrgRole([role("u", "viewer"), role("u", "admin")])).toBe("admin");
    expect(highestOrgRole([role("u", "billing_admin"), role("u", "builder")])).toBe("builder");
    expect(highestOrgRole([role("u", "owner", "organization", T0), role("u", "viewer")])).toBe("viewer");
    expect(highestOrgRole([role("u", "project_admin", "project")])).toBeNull();
  });
});
