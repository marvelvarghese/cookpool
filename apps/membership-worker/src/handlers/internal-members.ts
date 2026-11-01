// The group roster for sibling workers (Cookpool CP-7).
//
//   GET /v1/internal/membership/organizations/:orgId/members
//     → { members: [{ subjectId, subjectType, role, memberId, joinedAt }] }
//
// Service-internal, like /v1/internal/membership/authorization-context: it is
// reached over a service binding only, and api-edge routes nothing under
// /v1/internal/. The caller has already authorized its own request; this
// answers "who is in this group, in which role" so kitchen-worker can check
// that everyone a transaction names is a member and (CP-9) list the group's
// members, each with the `mem_…` id an owner changes their role with.
// `:orgId` is the organization's UUID (or its `org_…` public id). An unknown
// organization answers an empty list: membership facts, not existence, are
// the question.

import type { Env } from "../env.js";
import type { MembershipRepository, RoleAssignment } from "@saas/db/membership";
import type { RosterMember, RosterResponse } from "@saas/contracts/membership";
import { createSqlExecutor } from "@saas/db/d1";
import { createMembershipRepository } from "@saas/db/membership";
import { isUuid, type Uuid } from "@saas/db/ids";
import { errorResponse, successResponse } from "../http.js";
import { memberPublicId, parseOrgPublicId } from "../ids.js";

export type RosterRepo = Pick<MembershipRepository, "listMembers" | "listRoleAssignments" | "listRoleAssignmentsForSubjects">;

export interface InternalMembersDeps {
  repo: RosterRepo;
}

/** Highest first: a member's `role` is the first of these they hold at organization scope. */
export const ROLE_PRECEDENCE = ["owner", "admin", "builder", "viewer", "billing_admin"] as const;

/** Subjects per role-assignment lookup: D1 caps bound parameters per statement at 100. */
const SUBJECTS_PER_QUERY = 90;

export function highestOrgRole(assignments: readonly RoleAssignment[]): string | null {
  const held = new Set(
    assignments.filter((a) => a.scopeKind === "organization" && a.revokedAt === null).map((a) => a.role),
  );
  return ROLE_PRECEDENCE.find((role) => held.has(role)) ?? null;
}

function parseOrgId(param: string): Uuid | null {
  if (isUuid(param)) return param.toLowerCase() as Uuid;
  return parseOrgPublicId(param);
}

async function rolesBySubject(
  repo: RosterRepo,
  orgId: Uuid,
  subjectIds: readonly string[],
): Promise<Map<string, RoleAssignment[]> | null> {
  const out = new Map<string, RoleAssignment[]>();
  if (repo.listRoleAssignmentsForSubjects) {
    for (let i = 0; i < subjectIds.length; i += SUBJECTS_PER_QUERY) {
      const chunk = subjectIds.slice(i, i + SUBJECTS_PER_QUERY);
      const result = await repo.listRoleAssignmentsForSubjects(orgId, chunk);
      if (!result.ok) return null;
      for (const [subjectId, assignments] of result.value) out.set(subjectId, assignments);
    }
    return out;
  }
  for (const subjectId of subjectIds) {
    const result = await repo.listRoleAssignments(orgId, subjectId);
    if (!result.ok) return null;
    out.set(subjectId, result.value);
  }
  return out;
}

export async function handleInternalMembers(
  env: Env,
  requestId: string,
  orgIdParam: string,
  deps?: InternalMembersDeps,
): Promise<Response> {
  const orgId = parseOrgId(orgIdParam);
  if (!orgId) return errorResponse("not_found", "Organization not found", 404, requestId);
  if (!deps && !env.PLATFORM_DB) return errorResponse("internal_error", "Service unavailable", 503, requestId);

  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo = deps ? deps.repo : createMembershipRepository(executor!);
    const members = await repo.listMembers(orgId);
    if (!members.ok) return errorResponse("internal_error", "Failed to list members", 500, requestId);

    // Oldest first, so the roster reads in the order people joined.
    const active = [...members.value].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const roles = await rolesBySubject(repo, orgId, active.map((m) => m.subjectId));
    if (!roles) return errorResponse("internal_error", "Failed to list members", 500, requestId);

    const roster: RosterMember[] = active.map((m) => ({
      subjectId: m.subjectId,
      subjectType: m.subjectType,
      role: highestOrgRole(roles.get(m.subjectId) ?? []),
      memberId: memberPublicId(m.id),
      joinedAt: m.createdAt.toISOString(),
    }));
    return successResponse<RosterResponse>({ members: roster }, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}
