// Add people to a group by subject id (money-native MY-17).
//
//   POST /v1/organizations/:org/members  { sourceGroupId, subjectIds }
//
// Start from Spliteco makes a Cookpool group out of a Spliteco group and
// brings its people across. Invitations go by email and a Spliteco group read
// carries none, so this adds people who are already known to the caller by
// subject id — but only people who are in a Spliteco group the caller is in
// too, never arbitrary ids. The caller must own or administer the target.
// Each person is added (as a `builder`, like a join link) or skipped with a
// reason; one skip never fails the call. Idempotency is the edge's
// (Idempotency-Key replay); run again, everyone added is simply "already a
// member".

import type { ADD_MEMBER_SKIP_REASONS, AddMembersResponse } from "@saas/contracts/membership";
import { ADD_MEMBERS_MAX } from "@saas/contracts/membership";
import type { Uuid } from "@saas/db/ids";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { checkBillingEntitlement, decideMembersLimit } from "../billing-client.js";
import { errorResponse, successResponse, validationError } from "../http.js";
import { memberPublicId, orgPublicId, parseOrgPublicId } from "../ids.js";
import { MAX_GROUPS_PER_PERSON, countsTowardCap, isDirectGroup, isOpenGroups } from "../open-groups.js";
import { JOIN_ROLE, randomHex, requireManager, withRepos, type JoinLinkDeps } from "./join.js";

type SkipReason = (typeof ADD_MEMBER_SKIP_REASONS)[number];

const MEMBERS_LIMIT_ENTITLEMENT_KEY = "limit.members";
/** The policy action of owners and admins who may bring people in. */
const ADD_ACTION = "organization.invitation.create";
const SUBJECT_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export async function handleAddMembers(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgParam: string,
  deps?: JoinLinkDeps,
): Promise<Response> {
  const orgUuid = parseOrgPublicId(orgParam);
  if (!orgUuid) return errorResponse("not_found", "Organization not found", 404, requestId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
  }
  if (!body || typeof body !== "object") {
    return validationError(requestId, { body: ["Request body must be a JSON object"] });
  }
  const { sourceGroupId, subjectIds } = body as { sourceGroupId?: unknown; subjectIds?: unknown };
  const fields: Record<string, string[]> = {};
  const sourceUuid = typeof sourceGroupId === "string" ? parseOrgPublicId(sourceGroupId) : null;
  if (!sourceUuid) fields.sourceGroupId = ["The Spliteco group the people come from is required"];
  let ids: string[] = [];
  if (!Array.isArray(subjectIds) || subjectIds.length === 0 || subjectIds.length > ADD_MEMBERS_MAX) {
    fields.subjectIds = [`Give 1 to ${ADD_MEMBERS_MAX} subject ids`];
  } else if (subjectIds.some((s) => typeof s !== "string" || !SUBJECT_RE.test(s))) {
    fields.subjectIds = ["Every subject id must be a plain id"];
  } else {
    ids = [...new Set(subjectIds as string[])];
  }
  if (Object.keys(fields).length > 0) return validationError(requestId, fields);

  return withRepos(env, requestId, deps, async ({ repo, eventsRepo }) => {
    // Owner or admin of the target; anyone else reads as "not found".
    const denied = await requireManager(env, requestId, actor, orgUuid, ADD_ACTION, repo);
    if (denied) return denied;

    const target = await repo.getOrganizationById(orgUuid);
    if (!target.ok || target.value.status !== "active" || isDirectGroup(target.value)) {
      return errorResponse("not_found", "Organization not found", 404, requestId);
    }

    // The source: a live Spliteco group the caller is in. Every refusal reads the same.
    const notInSource = () =>
      errorResponse("forbidden", "You can bring only people from a Spliteco group you are in", 403, requestId, {
        reason: "not_in_source_group",
      });
    const source = await repo.getOrganizationById(sourceUuid as Uuid);
    if (!source.ok || source.value.status !== "active" || source.value.madeIn !== "spliteco" || isDirectGroup(source.value)) {
      return notInSource();
    }
    const me = await repo.getActiveMemberBySubject(sourceUuid as Uuid, actor.subjectId);
    if (!me.ok) return me.error.kind === "not_found" ? notInSource() : errorResponse("internal_error", "Service unavailable", 503, requestId);

    // The group's `limit.members`, decided as an invitation or a join decides it.
    const now = deps?.now ? deps.now() : new Date();
    const entitlementFn = deps?.checkEntitlement ?? checkBillingEntitlement;
    if (!env.BILLING_WORKER && !deps?.checkEntitlement) {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }
    const entitlement = await entitlementFn(env.BILLING_WORKER as Fetcher, orgPublicId(orgUuid), MEMBERS_LIMIT_ENTITLEMENT_KEY, requestId);
    if (entitlement.kind === "service_error") return errorResponse("internal_error", "Service unavailable", 503, requestId);
    const billable = await repo.countBillableMembers(orgUuid, now);
    if (!billable.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);

    const genId = deps?.generateId ?? (() => randomHex(16));
    const added: AddMembersResponse["added"] = [];
    const skipped: AddMembersResponse["skipped"] = [];
    const skip = (subjectId: string, reason: SkipReason) => skipped.push({ subjectId, reason });

    for (const subjectId of ids) {
      const inSource = await repo.getActiveMemberBySubject(sourceUuid as Uuid, subjectId);
      if (!inSource.ok) {
        if (inSource.error.kind !== "not_found") return errorResponse("internal_error", "Service unavailable", 503, requestId);
        skip(subjectId, "not_in_source_group");
        continue;
      }
      const already = await repo.getActiveMemberBySubject(orgUuid, subjectId);
      if (already.ok) {
        skip(subjectId, "already_member");
        continue;
      }
      if (already.error.kind !== "not_found") return errorResponse("internal_error", "Service unavailable", 503, requestId);

      if (isOpenGroups(env)) {
        const theirs = await repo.listOrganizationsForSubject(subjectId);
        if (!theirs.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);
        if (countsTowardCap(theirs.value) >= MAX_GROUPS_PER_PERSON) {
          skip(subjectId, "groups_per_person");
          continue;
        }
      }
      const gate = decideMembersLimit(entitlement.decision, billable.value + added.length);
      if (gate.kind === "service_error") return errorResponse("internal_error", "Service unavailable", 503, requestId);
      if (gate.kind === "deny") {
        skip(subjectId, "group_full");
        continue;
      }

      const joined = await repo.joinOrganization({
        orgId: orgUuid,
        memberId: crypto.randomUUID(),
        roleAssignmentId: crypto.randomUUID(),
        subjectId,
        subjectType: inSource.value.subjectType,
        role: JOIN_ROLE,
        joinedAt: now,
      });
      if (!joined.ok) {
        if (joined.error.kind === "conflict") {
          skip(subjectId, "already_member");
          continue;
        }
        return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
      }
      const member = joined.value.member;
      if (eventsRepo) {
        const appended = await eventsRepo.appendEventWithAudit({
          event: {
            id: genId(),
            type: "membership.member_added",
            version: 1,
            source: "membership-worker",
            occurredAt: now,
            actorType: actor.subjectType,
            actorId: actor.subjectId,
            orgId: orgUuid,
            subjectKind: "member",
            subjectId: member.id,
            requestId,
            payload: {
              orgId: orgPublicId(orgUuid),
              memberId: memberPublicId(member.id),
              subjectType: member.subjectType,
              subjectId,
              role: JOIN_ROLE,
              sourceGroupId: orgPublicId(sourceUuid as Uuid),
            },
          },
          audit: {
            id: genId(),
            category: "membership",
            description: `Member ${memberPublicId(member.id)} added by subject id as ${JOIN_ROLE}, from Spliteco group ${orgPublicId(sourceUuid as Uuid)}`,
          },
        });
        if (!appended.ok) return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
      }
      added.push({ subjectId, memberId: memberPublicId(member.id) });
    }

    return successResponse<AddMembersResponse>({ orgId: orgPublicId(orgUuid), added, skipped }, requestId, 200);
  });
}
