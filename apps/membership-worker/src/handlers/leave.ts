// Leaving a group (Cookpool CP-3): POST /v1/organizations/:orgId/leave.
//
// The caller removes their OWN membership. No policy grant is needed — any
// member may leave — but the group's last owner cannot leave while anyone else
// is still in it (409, `details.reason: "last_owner"`): they make someone else
// an owner first. An owner who is the only member left may leave.
//
// The end state is the one an admin removal leaves (remove-member.ts): the
// member row 'removed' and every role of theirs in the org revoked — here in
// one atomic batch (`leaveOrganization`), which also re-checks the last-owner
// rule so two owners leaving at once cannot strand a group without one.
//
// Nobody leaves owing or owed (Cookpool CP-19, risks CP-L): before the batch,
// kitchen-worker is asked for the caller's balance in the group over the
// KITCHEN_WORKER service binding, and a balance that is not zero is a 409
// (`details.reason: "balance_not_settled"`, with `balanceMinor` and
// `currency`). When kitchen-worker cannot answer — unbound, down, an error —
// leaving fails CLOSED with 503: an outage must not let someone walk away
// from a debt. The check is not atomic with the leave: an expense naming the
// caller that lands between the two still posts (kitchen-worker checked its
// roster first), and leaves a balance under their name, as an admin removal
// does. A group's only member is held to the same rule.

import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import type { MembershipRepository } from "@saas/db/membership";
import type { EventsRepository } from "@saas/db/events";
import type { LeaveResponse } from "@saas/contracts/membership";
import { createSqlExecutor } from "@saas/db/d1";
import { createMembershipRepository } from "@saas/db/membership";
import { createEventsRepository } from "@saas/db/events";
import { KITCHEN_ERROR_REASONS } from "@saas/contracts/kitchen";
import { successResponse, errorResponse } from "../http.js";
import { parseOrgPublicId, orgPublicId, memberPublicId } from "../ids.js";
import { fetchKitchenBalance } from "../kitchen-client.js";

export interface LeaveOrganizationDeps {
  repo: Pick<
    MembershipRepository,
    "getActiveMemberBySubject" | "listRoleAssignments" | "countActiveOwners" | "countActiveMembers" | "leaveOrganization"
  >;
  /** When omitted on the deps path, no event is appended (tests opt in). */
  eventsRepo?: Pick<EventsRepository, "appendEventWithAudit">;
  now?: () => Date;
  generateId?: () => string;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let hex = "";
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

function lastOwner(requestId: string): Response {
  return errorResponse(
    "conflict",
    "You are this group's last owner. Make someone else an owner before you leave.",
    409,
    requestId,
    { reason: "last_owner" },
  );
}

export async function handleLeaveOrganization(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgIdParam: string,
  deps?: LeaveOrganizationDeps,
): Promise<Response> {
  const orgUuid = parseOrgPublicId(orgIdParam);
  if (!orgUuid) return errorResponse("not_found", "Organization not found", 404, requestId);

  if (!deps && !env.PLATFORM_DB) {
    return errorResponse("internal_error", "Database not configured", 503, requestId);
  }

  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo = deps ? deps.repo : createMembershipRepository(executor!);
    const eventsRepo = deps ? deps.eventsRepo : createEventsRepository(executor!);

    // Not a member reads the same as an org that does not exist.
    const member = await repo.getActiveMemberBySubject(orgUuid, actor.subjectId);
    if (!member.ok) {
      if (member.error.kind === "not_found") {
        return errorResponse("not_found", "Organization not found", 404, requestId);
      }
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }

    const roles = await repo.listRoleAssignments(orgUuid, actor.subjectId);
    if (!roles.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);

    const isOwner = roles.value.some((r) => r.scopeKind === "organization" && r.role === "owner");
    if (isOwner) {
      const owners = await repo.countActiveOwners(orgUuid);
      if (!owners.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);
      if (owners.value <= 1) {
        const members = await repo.countActiveMembers(orgUuid);
        if (!members.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);
        if (members.value > 1) return lastOwner(requestId);
      }
    }

    // Money in the group (CP-19): settled up, or not leaving.
    const balance = await fetchKitchenBalance(env.KITCHEN_WORKER, orgUuid, actor.subjectId, requestId);
    if (!balance.ok) {
      return errorResponse(
        "internal_error",
        "Your balance in this group cannot be checked right now. Try again in a moment.",
        503,
        requestId,
      );
    }
    if (balance.balanceMinor !== 0) {
      return errorResponse(
        "conflict",
        balance.balanceMinor < 0
          ? "You still owe money in this group. Settle up before you leave."
          : "You are still owed money in this group. Settle up before you leave.",
        409,
        requestId,
        { reason: KITCHEN_ERROR_REASONS.BALANCE_NOT_SETTLED, balanceMinor: balance.balanceMinor, currency: balance.currency },
      );
    }

    const now = deps?.now ? deps.now() : new Date();
    const left = await repo.leaveOrganization({ orgId: orgUuid, subjectId: actor.subjectId, at: now });
    if (!left.ok) {
      if (left.error.kind === "conflict") return lastOwner(requestId);
      if (left.error.kind === "not_found") {
        return errorResponse("not_found", "Organization not found", 404, requestId);
      }
      return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
    }

    const memberId = left.value.member.id;
    if (eventsRepo) {
      const genId = deps?.generateId ?? (() => randomHex(16));
      const previousRoles = roles.value.filter((r) => r.scopeKind === "organization").map((r) => r.role);
      const appended = await eventsRepo.appendEventWithAudit({
        event: {
          id: genId(),
          type: "membership.left",
          version: 1,
          source: "membership-worker",
          occurredAt: now,
          actorType: actor.subjectType,
          actorId: actor.subjectId,
          orgId: orgUuid,
          subjectKind: "member",
          subjectId: memberId,
          requestId,
          payload: {
            memberId: memberPublicId(memberId),
            previousRoles,
            revokedRoleCount: left.value.revokedRoles.length,
          },
        },
        audit: {
          id: genId(),
          category: "membership",
          description: `Member ${memberPublicId(memberId)} left the organization`,
        },
      });
      if (!appended.ok) {
        return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
      }
    }

    return successResponse<LeaveResponse>(
      { orgId: orgPublicId(orgUuid), memberId: memberPublicId(memberId), left: true },
      requestId,
    );
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}
