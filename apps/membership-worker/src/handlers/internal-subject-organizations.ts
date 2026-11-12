// A person's groups for sibling workers (Cookpool CP-10).
//
//   GET /v1/internal/membership/subjects/:subjectId/organizations
//     → { organizations: [{ orgId, slug, name, role }] }
//
// Service-internal, like the group roster beside it
// (/v1/internal/membership/organizations/:orgId/members): reached over a
// service binding only — api-edge routes nothing under /v1/internal/. The
// caller has already resolved who is asking; this answers "which groups is
// this person in, in which role" so kitchen-worker can show every pantry they
// can reach. Active memberships of active organizations only, by name. A
// subject in none answers an empty list.

import type { Env } from "../env.js";
import type { MembershipRepository, RoleAssignment } from "@saas/db/membership";
import {
  SUBJECT_ORGANIZATIONS_SPLITECO_VIEW,
  type SubjectOrganization,
  type SubjectOrganizationsResponse,
} from "@saas/contracts/membership";
import { createSqlExecutor } from "@saas/db/d1";
import { createMembershipRepository } from "@saas/db/membership";
import type { Uuid } from "@saas/db/ids";
import { errorResponse, successResponse } from "../http.js";
import { orgPublicId } from "../ids.js";
import { highestOrgRole } from "./internal-members.js";

export type SubjectOrganizationsRepo = Pick<
  MembershipRepository,
  | "listOrganizationsForSubject"
  | "listRoleAssignments"
  | "listRoleAssignmentsForSubjectAcrossOrgs"
  | "listActiveMembersForOrganizations"
>;

/** The organization role order `highestOrgRole` ranks by, for a member's roles as plain names. */
const ROLE_RANK = ["owner", "admin", "builder", "viewer", "billing_admin"];

function highestRoleName(roles: readonly string[]): string | null {
  for (const role of ROLE_RANK) if (roles.includes(role)) return role;
  return null;
}

export interface SubjectOrganizationsDeps {
  repo: SubjectOrganizationsRepo;
}

/** A public subject id as the edge forwards it (`usr_…`, `sp_…`). */
const SUBJECT_ID_RE = /^[A-Za-z0-9][\w-]{0,127}$/;

/** The subject's active role assignments, grouped by organization. Null on a failed read. */
async function rolesByOrg(
  repo: SubjectOrganizationsRepo,
  subjectId: string,
  orgIds: readonly string[],
): Promise<Map<string, RoleAssignment[]> | null> {
  const out = new Map<string, RoleAssignment[]>(orgIds.map((id) => [id, []]));
  if (repo.listRoleAssignmentsForSubjectAcrossOrgs) {
    const result = await repo.listRoleAssignmentsForSubjectAcrossOrgs(subjectId);
    if (!result.ok) return null;
    for (const assignment of result.value) out.get(assignment.orgId)?.push(assignment);
    return out;
  }
  for (const orgId of orgIds) {
    const result = await repo.listRoleAssignments(orgId as Uuid, subjectId);
    if (!result.ok) return null;
    out.set(orgId, result.value);
  }
  return out;
}

export async function handleInternalSubjectOrganizations(
  env: Env,
  requestId: string,
  subjectIdParam: string,
  deps?: SubjectOrganizationsDeps,
  /** `spliteco` (cookpool-spliteco SE1): include the hidden direct groups and each group's members. */
  view: string | null = null,
): Promise<Response> {
  let subjectId: string;
  try {
    subjectId = decodeURIComponent(subjectIdParam);
  } catch {
    return errorResponse("not_found", "Subject not found", 404, requestId);
  }
  if (!SUBJECT_ID_RE.test(subjectId)) return errorResponse("not_found", "Subject not found", 404, requestId);
  if (!deps && !env.PLATFORM_DB) return errorResponse("internal_error", "Service unavailable", 503, requestId);

  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo = deps ? deps.repo : createMembershipRepository(executor!);
    const orgs = await repo.listOrganizationsForSubject(subjectId);
    if (!orgs.ok) return errorResponse("internal_error", "Failed to list organizations", 500, requestId);

    const spliteco = view === SUBJECT_ORGANIZATIONS_SPLITECO_VIEW;
    const active = orgs.value
      .filter((org) => org.status === "active")
      // The hidden two-person groups (kind direct) are Spliteco's alone.
      .filter((org) => spliteco || org.kind !== "direct")
      .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const roles = await rolesByOrg(repo, subjectId, active.map((org) => org.id));
    if (!roles) return errorResponse("internal_error", "Failed to list organizations", 500, requestId);

    let members: Map<string, { subjectId: string; subjectType: string; role: string | null }[]> | null = null;
    if (spliteco) {
      if (!repo.listActiveMembersForOrganizations) {
        return errorResponse("internal_error", "Service unavailable", 503, requestId);
      }
      const all = await repo.listActiveMembersForOrganizations(active.map((org) => org.id));
      if (!all.ok) return errorResponse("internal_error", "Failed to list organizations", 500, requestId);
      members = new Map();
      for (const m of all.value) {
        const list = members.get(m.orgId) ?? [];
        list.push({ subjectId: m.subjectId, subjectType: m.subjectType, role: highestRoleName(m.roles) });
        members.set(m.orgId, list);
      }
    }

    const organizations: SubjectOrganization[] = active.map((org) => ({
      orgId: orgPublicId(org.id),
      slug: org.slug,
      name: org.name,
      role: highestOrgRole(roles.get(org.id) ?? []),
      madeIn: org.madeIn ?? "cookpool",
      kind: org.kind ?? "kitchen",
      ...(members ? { members: members.get(org.id) ?? [] } : {}),
    }));
    return successResponse<SubjectOrganizationsResponse>({ organizations }, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}
