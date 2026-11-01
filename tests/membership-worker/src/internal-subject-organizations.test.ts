// A person's groups for sibling workers (Cookpool CP-10):
// GET /v1/internal/membership/subjects/:subjectId/organizations. kitchen-worker
// reads it for every pantry a person can reach.

import type { MembershipResult, Organization, RoleAssignment } from "@saas/db/membership";
import type { SubjectOrganizationsResponse } from "@saas/contracts/membership";
import { route } from "@membership-worker/router";
import {
  handleInternalSubjectOrganizations,
  type SubjectOrganizationsRepo,
} from "@membership-worker/handlers/internal-subject-organizations";
import type { Env } from "@membership-worker/env";

const T0 = new Date("2026-11-01T00:00:00.000Z");
const FLAT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LUNCH = "11111111-2222-4333-8444-555555555555";
const TRIP = "99999999-8888-4777-8666-555555555555";
const GONE = "12121212-3434-4565-8787-909090909090";
const pub = (uuid: string) => `org_${uuid.replace(/-/g, "")}`;

const env: Env = { ENVIRONMENT: "test" };

function org(id: string, name: string, status = "active"): Organization {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return { id, name, slug, slugLower: slug, status, parentOrgId: null, joinCode: null, createdAt: T0, updatedAt: T0 };
}

function role(orgId: string, name: string, scopeKind = "organization"): RoleAssignment {
  return {
    id: `ra-${orgId}-${name}`, orgId, subjectId: "usr_rahul", subjectType: "user", role: name, scopeKind,
    scopeRef: scopeKind === "organization" ? null : "prj-1", createdAt: T0, revokedAt: null,
  };
}

interface FakeRepo extends SubjectOrganizationsRepo {
  calls: string[];
}

function fakeRepo(
  orgs: Organization[],
  roles: RoleAssignment[],
  options: { batched?: boolean; failOrgs?: boolean; failRoles?: boolean } = {},
): FakeRepo {
  const calls: string[] = [];
  const fail = <T>(): MembershipResult<T> => ({ ok: false, error: { kind: "internal", message: "boom" } });
  const repo: FakeRepo = {
    calls,
    async listOrganizationsForSubject(subjectId) {
      calls.push(`orgs:${subjectId}`);
      return options.failOrgs ? fail() : { ok: true, value: orgs };
    },
    async listRoleAssignments(orgId) {
      calls.push(`roles:${orgId}`);
      return options.failRoles ? fail() : { ok: true, value: roles.filter((r) => r.orgId === orgId) };
    },
  };
  if (options.batched !== false) {
    repo.listRoleAssignmentsForSubjectAcrossOrgs = async (subjectId) => {
      calls.push(`all-roles:${subjectId}`);
      return options.failRoles ? fail() : { ok: true, value: roles };
    };
  }
  return repo;
}

async function organizations(res: Response): Promise<SubjectOrganizationsResponse["organizations"]> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: SubjectOrganizationsResponse }).data.organizations;
}

describe("membership-worker: a person's groups", () => {
  const orgs = [org(LUNCH, "Lunch club"), org(FLAT, "Flat 4B"), org(GONE, "Old flat", "deleted"), org(TRIP, "Goa trip")];
  const roles = [
    role(FLAT, "builder"),
    role(FLAT, "owner"),
    role(LUNCH, "viewer"),
    role(LUNCH, "admin", "project"),
    role(GONE, "owner"),
  ];

  it("lists active organizations by name, each with the highest organization role, in two reads", async () => {
    const repo = fakeRepo(orgs, roles);
    expect(await organizations(await handleInternalSubjectOrganizations(env, "req_1", "usr_rahul", { repo }))).toEqual([
      { orgId: pub(FLAT), slug: "flat-4b", name: "Flat 4B", role: "owner" },
      { orgId: pub(TRIP), slug: "goa-trip", name: "Goa trip", role: null },
      { orgId: pub(LUNCH), slug: "lunch-club", name: "Lunch club", role: "viewer" },
    ]);
    expect(repo.calls).toEqual(["orgs:usr_rahul", "all-roles:usr_rahul"]);
  });

  it("falls back to one role read per organization", async () => {
    const repo = fakeRepo(orgs, roles, { batched: false });
    const listed = await organizations(await handleInternalSubjectOrganizations(env, "req_1", "usr_rahul", { repo }));
    expect(listed.map((o) => o.role)).toEqual(["owner", null, "viewer"]);
    expect(repo.calls.filter((c) => c.startsWith("roles:"))).toHaveLength(3);
  });

  it("is an empty list for someone in no organization", async () => {
    const repo = fakeRepo([], []);
    expect(await organizations(await handleInternalSubjectOrganizations(env, "req_1", "usr_new", { repo }))).toEqual([]);
  });

  it("is a 404 for a malformed subject id, and a 500 when a read fails", async () => {
    for (const bad of ["", "%E0%A4%A", "usr rahul", "-usr"]) {
      const res = await handleInternalSubjectOrganizations(env, "req_1", bad, { repo: fakeRepo(orgs, roles) });
      expect(res.status).toBe(404);
    }
    const failedOrgs = await handleInternalSubjectOrganizations(env, "req_1", "usr_rahul", {
      repo: fakeRepo(orgs, roles, { failOrgs: true }),
    });
    expect(failedOrgs.status).toBe(500);
    const failedRoles = await handleInternalSubjectOrganizations(env, "req_1", "usr_rahul", {
      repo: fakeRepo(orgs, roles, { failRoles: true }),
    });
    expect(failedRoles.status).toBe(500);
  });

  it("is routed for GET only, and is a 503 without a database", async () => {
    const url = "http://membership-worker/v1/internal/membership/subjects/usr_rahul/organizations";
    expect((await route(new Request(url), env)).status).toBe(503);
    expect((await route(new Request(url, { method: "POST" }), env)).status).toBe(405);
  });
});
