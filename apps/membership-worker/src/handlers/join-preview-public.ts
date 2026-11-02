// The signed-out join preview (Cookpool SI-4).
//
//   GET /v1/join/:code/preview   no session → { groupName, inviterFirstName, memberCount }
//
// The sign-in page reads it when someone arrives from a join link before they
// have an account: "Sign in to join Flat 4B · Anu invited you · 5 people are
// in". It is the one membership read that needs no actor, so it is built as a
// boundary:
//
//   - It takes no actor and reads none. api-edge forwards no session and no
//     actor headers on this route, and the router ignores any it is sent.
//   - It answers exactly three fields, built here one by one from what was
//     read (never a spread of a row), and api-edge re-picks the same three.
//   - An unknown, malformed or rotated code, and a group that is not active,
//     all answer join.ts's one 404 body. A malformed code answers before any
//     read; every other code costs the same single lookup before its 404, so
//     the timing tells no more than the code's format already does.
//   - The inviter is the group's first owner: the earliest-joined active member
//     holding the owner role. CP-3 keeps the code on the organization row with
//     nobody's id beside it (a rotation's actor is only in the event log, and
//     the first mint is in neither), so who made the link is not recorded.
//     Their name comes from identity-worker (../identity-client.ts), first
//     word only, and is null when they have none: never the email.
//   - The count is active members holding a group role (owner, admin, member,
//     viewer), the people the kitchen counts (CP-9). Removed members and
//     revoked roles are not counted, nor a billing_admin-only seat.
//
// The signed-in preview, GET /v1/join/:code (./join.ts), is unchanged.

import type { Env } from "../env.js";
import type { MembershipRepository, OrganizationMember } from "@saas/db/membership";
import type { Uuid } from "@saas/db/ids";
import type { JoinPreviewPublic } from "@saas/contracts/membership";
import { KITCHEN_GROUP_ROLES } from "@saas/contracts/kitchen";
import { createSqlExecutor } from "@saas/db/d1";
import { createMembershipRepository } from "@saas/db/membership";
import { errorResponse, successResponse } from "../http.js";
import { fetchDisplayName, firstNameOf } from "../identity-client.js";
import { decodePathCode, resolveGroup, unknownCode } from "./join.js";
import { highestOrgRole, rolesBySubject } from "./internal-members.js";

export type JoinPreviewPublicRepo = Pick<
  MembershipRepository,
  "getOrganizationByJoinCode" | "listMembers" | "listRoleAssignments" | "listRoleAssignmentsForSubjects"
>;

export interface JoinPreviewPublicDeps {
  repo: JoinPreviewPublicRepo;
}

const GROUP_ROLES: ReadonlySet<string> = new Set(KITCHEN_GROUP_ROLES);

function oldestFirst(a: OrganizationMember, b: OrganizationMember): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** GET /v1/join/:code/preview — the group a join link names, for someone with no session. */
export async function handlePublicJoinPreview(
  env: Env,
  requestId: string,
  codeParam: string,
  deps?: JoinPreviewPublicDeps,
): Promise<Response> {
  const code = decodePathCode(codeParam);
  if (!code) return unknownCode(requestId);
  if (!deps && !env.PLATFORM_DB) {
    return errorResponse("internal_error", "Database not configured", 503, requestId);
  }

  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo = deps ? deps.repo : createMembershipRepository(executor!);
    const group = await resolveGroup(repo, code, requestId);
    if (!group.ok) return group.response;
    const orgId = group.org.id as Uuid;

    const members = await repo.listMembers(orgId);
    if (!members.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);
    const roles = await rolesBySubject(repo, orgId, members.value.map((m) => m.subjectId));
    if (!roles) return errorResponse("internal_error", "Service unavailable", 503, requestId);

    const roleOf = (m: OrganizationMember) => highestOrgRole(roles.get(m.subjectId) ?? []);
    const inGroup = members.value.filter((m) => {
      const role = roleOf(m);
      return role !== null && GROUP_ROLES.has(role);
    });
    const firstOwner = inGroup
      .filter((m) => m.subjectType === "user" && roleOf(m) === "owner")
      .sort(oldestFirst)[0];
    const inviterFirstName = firstOwner
      ? firstNameOf(await fetchDisplayName(env.IDENTITY_WORKER, firstOwner.subjectId, requestId))
      : null;

    const preview: JoinPreviewPublic = {
      groupName: group.org.name,
      inviterFirstName,
      memberCount: inGroup.length,
    };
    return successResponse<JoinPreviewPublic>(preview, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}
