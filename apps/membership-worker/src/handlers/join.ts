// Join links (Cookpool CP-3).
//
// Every organization — a Cookpool group — has a shareable join code. Owners and
// admins read it (it is minted on first read) and rotate it; a signed-in person
// who opens the link sees the group and joins it in one step as a `builder`
// ("member" in the app). There is no approval queue: the link is the
// invitation, and rotating it is how a group stops new people joining.
//
//   GET  /v1/organizations/:org/join-code          owner/admin → { code }
//   POST /v1/organizations/:org/join-code/rotate   owner/admin → { code }
//   GET  /v1/join/:code                            anyone signed in → the group preview
//   POST /v1/join  { code }                        anyone signed in → join
//
// Denials keep the worker's opaque-404 rule: a non-manager asking for a code,
// and an unknown code, both read as "not found".

import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import type { MembershipRepository, Organization } from "@saas/db/membership";
import type { EventsRepository } from "@saas/db/events";
import type { Uuid } from "@saas/db/ids";
import type { JoinCodeResponse, JoinPreview, JoinResponse } from "@saas/contracts/membership";
import { createSqlExecutor } from "@saas/db/d1";
import { createMembershipRepository } from "@saas/db/membership";
import { createEventsRepository } from "@saas/db/events";
import { authorizeViaPolicy } from "../policy-client.js";
import { checkBillingEntitlement, decideMembersLimit } from "../billing-client.js";
import { successResponse, errorResponse, validationError } from "../http.js";
import {
  parseOrgPublicId,
  orgPublicId,
  memberPublicId,
  generateJoinCode,
  normalizeJoinCode,
} from "../ids.js";
import { isSoloMode } from "../solo-mode.js";
import { MAX_GROUPS_PER_PERSON, isOpenGroups } from "../open-groups.js";

/** The role a join link grants: a member who cooks, logs and splits. */
export const JOIN_ROLE = "builder";

const MEMBERS_LIMIT_ENTITLEMENT_KEY = "limit.members";

/** Fresh codes tried before giving up on a (vanishingly unlikely) collision run. */
const MAX_MINT_ATTEMPTS = 5;

export type JoinLinkRepo = Pick<
  MembershipRepository,
  | "listRoleAssignments"
  | "getOrganizationById"
  | "getOrganizationByJoinCode"
  | "setOrganizationJoinCode"
  | "getActiveMemberBySubject"
  | "countActiveMembers"
  | "countBillableMembers"
  | "listOrganizationsForSubject"
  | "joinOrganization"
>;

export interface JoinLinkDeps {
  repo: JoinLinkRepo;
  /** When omitted on the deps path, no event is appended (tests opt in). */
  eventsRepo?: Pick<EventsRepository, "appendEventWithAudit">;
  now?: () => Date;
  generateId?: () => string;
  generateCode?: () => string;
  /**
   * Injectable `limit.members` entitlement check. Unlike the older handlers'
   * seam, omitting it does NOT skip the gate: the join falls back to the real
   * billing call and fails closed (503) without a BILLING_WORKER binding.
   */
  checkEntitlement?: typeof checkBillingEntitlement;
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

interface Repos {
  repo: JoinLinkRepo;
  eventsRepo: Pick<EventsRepository, "appendEventWithAudit"> | undefined;
}

/**
 * Run `fn` with the membership and events repositories: the injected ones in
 * tests, otherwise ones over PLATFORM_DB. Any throw becomes an opaque 500.
 */
async function withRepos(
  env: Env,
  requestId: string,
  deps: JoinLinkDeps | undefined,
  fn: (repos: Repos) => Promise<Response>,
): Promise<Response> {
  if (!deps && !env.PLATFORM_DB) {
    return errorResponse("internal_error", "Database not configured", 503, requestId);
  }
  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo = deps ? deps.repo : createMembershipRepository(executor!);
    const eventsRepo = deps ? deps.eventsRepo : createEventsRepository(executor!);
    return await fn({ repo, eventsRepo });
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}

/**
 * Owner/admin gate for the join-code routes: the actor's role assignments in
 * the org, then policy-worker on `action`. Any denial is the opaque 404.
 * Returns null on allow.
 */
async function requireManager(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgUuid: Uuid,
  action: string,
  repo: Pick<MembershipRepository, "listRoleAssignments">,
): Promise<Response | null> {
  if (!env.POLICY_WORKER) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }
  const rolesResult = await repo.listRoleAssignments(orgUuid, actor.subjectId);
  if (!rolesResult.ok) {
    return errorResponse("not_found", "Organization not found", 404, requestId);
  }
  const authResult = await authorizeViaPolicy(env.POLICY_WORKER, {
    actor,
    action,
    resource: { kind: "organization", id: orgUuid, orgId: orgUuid },
    orgId: orgUuid,
    roleAssignments: rolesResult.value,
    requestId,
  });
  if (!authResult.allow) {
    return errorResponse("not_found", "Organization not found", 404, requestId);
  }
  return null;
}

type MintResult =
  | { ok: true; org: Organization }
  | { ok: false; reason: "not_found" | "exhausted" | "internal" };

/** Store a freshly generated code, retrying with a new one when it is taken. */
async function mintCode(
  repo: Pick<MembershipRepository, "setOrganizationJoinCode">,
  orgUuid: Uuid,
  now: Date,
  generate: () => string,
  options: { onlyIfUnset: boolean; avoid?: string | null },
): Promise<MintResult> {
  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
    const code = generate();
    if (options.avoid && code === options.avoid) continue;
    const set = await repo.setOrganizationJoinCode(orgUuid, code, now, { onlyIfUnset: options.onlyIfUnset });
    if (set.ok && set.value.joinCode) return { ok: true, org: set.value };
    if (!set.ok && set.error.kind === "conflict") continue;
    if (!set.ok && set.error.kind === "not_found") return { ok: false, reason: "not_found" };
    return { ok: false, reason: "internal" };
  }
  return { ok: false, reason: "exhausted" };
}

function mintFailure(result: Extract<MintResult, { ok: false }>, requestId: string): Response {
  if (result.reason === "not_found") {
    return errorResponse("not_found", "Organization not found", 404, requestId);
  }
  return errorResponse("internal_error", "Could not create a join code", 503, requestId);
}

/** GET /v1/organizations/:orgId/join-code — read the code, minting it on first read. */
export async function handleGetJoinCode(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgIdParam: string,
  deps?: JoinLinkDeps,
): Promise<Response> {
  const orgUuid = parseOrgPublicId(orgIdParam);
  if (!orgUuid) return errorResponse("not_found", "Organization not found", 404, requestId);

  return withRepos(env, requestId, deps, async ({ repo }) => {
    const denied = await requireManager(env, requestId, actor, orgUuid, "organization.join_code.read", repo);
    if (denied) return denied;

    const org = await repo.getOrganizationById(orgUuid);
    if (!org.ok) return errorResponse("not_found", "Organization not found", 404, requestId);
    if (org.value.joinCode) {
      return successResponse<JoinCodeResponse>({ code: org.value.joinCode }, requestId);
    }

    // First read: mint one. `onlyIfUnset` keeps the code another manager may
    // have minted a moment ago instead of overwriting the link they shared.
    const now = deps?.now ? deps.now() : new Date();
    const minted = await mintCode(repo, orgUuid, now, deps?.generateCode ?? generateJoinCode, { onlyIfUnset: true });
    if (!minted.ok) return mintFailure(minted, requestId);
    return successResponse<JoinCodeResponse>({ code: minted.org.joinCode! }, requestId);
  });
}

/** POST /v1/organizations/:orgId/join-code/rotate — replace the code; the old link stops working. */
export async function handleRotateJoinCode(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgIdParam: string,
  deps?: JoinLinkDeps,
): Promise<Response> {
  const orgUuid = parseOrgPublicId(orgIdParam);
  if (!orgUuid) return errorResponse("not_found", "Organization not found", 404, requestId);

  return withRepos(env, requestId, deps, async ({ repo, eventsRepo }) => {
    const denied = await requireManager(env, requestId, actor, orgUuid, "organization.join_code.rotate", repo);
    if (denied) return denied;

    const org = await repo.getOrganizationById(orgUuid);
    if (!org.ok) return errorResponse("not_found", "Organization not found", 404, requestId);

    const now = deps?.now ? deps.now() : new Date();
    const minted = await mintCode(repo, orgUuid, now, deps?.generateCode ?? generateJoinCode, {
      onlyIfUnset: false,
      avoid: org.value.joinCode,
    });
    if (!minted.ok) return mintFailure(minted, requestId);

    if (eventsRepo) {
      const genId = deps?.generateId ?? (() => randomHex(16));
      // The code itself is a bearer credential for joining: it never goes into
      // the event log or the audit trail.
      const appended = await eventsRepo.appendEventWithAudit({
        event: {
          id: genId(),
          type: "membership.join_link.rotated",
          version: 1,
          source: "membership-worker",
          occurredAt: now,
          actorType: actor.subjectType,
          actorId: actor.subjectId,
          orgId: orgUuid,
          subjectKind: "organization",
          subjectId: orgUuid,
          requestId,
          payload: { orgId: orgPublicId(orgUuid), hadCode: org.value.joinCode !== null },
        },
        audit: {
          id: genId(),
          category: "membership",
          description: "Join link rotated",
        },
      });
      if (!appended.ok) {
        return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
      }
    }

    return successResponse<JoinCodeResponse>({ code: minted.org.joinCode! }, requestId);
  });
}

function decodePathCode(param: string): string | null {
  try {
    return normalizeJoinCode(decodeURIComponent(param));
  } catch {
    return null;
  }
}

function unknownCode(requestId: string): Response {
  return errorResponse("not_found", "No group found for that join link", 404, requestId);
}

type ResolvedGroup =
  | { ok: true; org: Organization }
  | { ok: false; response: Response };

/** The active organization a code names, or the response to answer with. */
async function resolveGroup(
  repo: Pick<MembershipRepository, "getOrganizationByJoinCode">,
  code: string,
  requestId: string,
): Promise<ResolvedGroup> {
  const org = await repo.getOrganizationByJoinCode(code);
  if (!org.ok) {
    if (org.error.kind === "not_found") return { ok: false, response: unknownCode(requestId) };
    return { ok: false, response: errorResponse("internal_error", "Service unavailable", 503, requestId) };
  }
  // A suspended or deleted group is not joinable; say so the same way as an
  // unknown code rather than revealing its state.
  if (org.value.status !== "active") return { ok: false, response: unknownCode(requestId) };
  return { ok: true, org: org.value };
}

/** GET /v1/join/:code — the group a link points at, for the join page. */
export async function handlePreviewJoin(
  env: Env,
  requestId: string,
  actor: ActorContext,
  codeParam: string,
  deps?: JoinLinkDeps,
): Promise<Response> {
  const code = decodePathCode(codeParam);
  if (!code) return unknownCode(requestId);

  return withRepos(env, requestId, deps, async ({ repo }) => {
    const group = await resolveGroup(repo, code, requestId);
    if (!group.ok) return group.response;
    const orgUuid = group.org.id as Uuid;

    const memberCount = await repo.countActiveMembers(orgUuid);
    if (!memberCount.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);

    const member = await repo.getActiveMemberBySubject(orgUuid, actor.subjectId);
    if (!member.ok && member.error.kind !== "not_found") {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }

    return successResponse<JoinPreview>(
      {
        orgId: orgPublicId(orgUuid),
        name: group.org.name,
        slug: group.org.slug,
        memberCount: memberCount.value,
        alreadyMember: member.ok,
      },
      requestId,
    );
  });
}

function limitMessage(reason: string): string {
  return reason === "limit_reached"
    ? "This group is full"
    : "Joining this group is not available on its current plan";
}

/** POST /v1/join { code } — join the group the code names, as a member. */
export async function handleJoin(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  deps?: JoinLinkDeps,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
  }
  if (!body || typeof body !== "object") {
    return validationError(requestId, { body: ["Request body must be a JSON object"] });
  }
  const raw = (body as { code?: unknown }).code;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return validationError(requestId, { code: ["A join code is required"] });
  }
  const code = normalizeJoinCode(raw);
  if (!code) return unknownCode(requestId);

  // M0/Solo: the account is its one personal organization, so joining another
  // is refused here too (api-edge already hides the route under Solo).
  if (isSoloMode(env)) {
    return errorResponse("forbidden", "This account cannot join other organizations", 403, requestId, {
      reason: "solo_profile",
    });
  }

  return withRepos(env, requestId, deps, async ({ repo, eventsRepo }) => {
    const group = await resolveGroup(repo, code, requestId);
    if (!group.ok) return group.response;
    const org = group.org;
    const orgUuid = org.id as Uuid;

    const alreadyIn = (memberId: string): Response =>
      successResponse<JoinResponse>(
        { orgId: orgPublicId(orgUuid), slug: org.slug, memberId: memberPublicId(memberId), alreadyMember: true },
        requestId,
        200,
      );

    // Opening the link again is not an error: the person is simply in.
    const existing = await repo.getActiveMemberBySubject(orgUuid, actor.subjectId);
    if (existing.ok) return alreadyIn(existing.value.id);
    if (existing.error.kind !== "not_found") {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }

    // Open groups: the per-person cap counts groups joined as well as created.
    if (isOpenGroups(env)) {
      const mine = await repo.listOrganizationsForSubject(actor.subjectId);
      if (!mine.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);
      if (mine.value.length >= MAX_GROUPS_PER_PERSON) {
        return errorResponse(
          "precondition_failed",
          `A person can be in at most ${MAX_GROUPS_PER_PERSON} groups`,
          412,
          requestId,
          { reason: "groups_per_person", limit: MAX_GROUPS_PER_PERSON },
        );
      }
    }

    // The group's `limit.members`, decided exactly as create-invitation does:
    // the billable count (active members + pending invitations) must be under
    // the plan's limit. Fails closed on any billing or count error.
    const now = deps?.now ? deps.now() : new Date();
    const entitlementFn = deps?.checkEntitlement ?? checkBillingEntitlement;
    if (!env.BILLING_WORKER && !deps?.checkEntitlement) {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }
    const entitlement = await entitlementFn(
      env.BILLING_WORKER as Fetcher,
      orgPublicId(orgUuid),
      MEMBERS_LIMIT_ENTITLEMENT_KEY,
      requestId,
    );
    if (entitlement.kind === "service_error") {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }
    const billable = await repo.countBillableMembers(orgUuid, now);
    if (!billable.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);
    const gate = decideMembersLimit(entitlement.decision, billable.value);
    if (gate.kind === "service_error") {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }
    if (gate.kind === "deny") {
      return errorResponse("precondition_failed", limitMessage(gate.reason), 412, requestId, { reason: gate.reason });
    }

    // One atomic batch: the member row and its builder role.
    const joined = await repo.joinOrganization({
      orgId: orgUuid,
      memberId: crypto.randomUUID(),
      roleAssignmentId: crypto.randomUUID(),
      subjectId: actor.subjectId,
      subjectType: actor.subjectType,
      role: JOIN_ROLE,
      joinedAt: now,
    });
    if (!joined.ok) {
      if (joined.error.kind === "conflict") {
        // Lost a race with this person's own other tap: they are in now.
        const raced = await repo.getActiveMemberBySubject(orgUuid, actor.subjectId);
        if (raced.ok) return alreadyIn(raced.value.id);
        return errorResponse("conflict", "Could not join this group", 409, requestId);
      }
      return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
    }
    const member = joined.value.member;

    if (eventsRepo) {
      const genId = deps?.generateId ?? (() => randomHex(16));
      const appended = await eventsRepo.appendEventWithAudit({
        event: {
          id: genId(),
          type: "membership.joined_via_link",
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
            subjectType: actor.subjectType,
            subjectId: actor.subjectId,
            role: JOIN_ROLE,
          },
        },
        audit: {
          id: genId(),
          category: "membership",
          description: `Member ${memberPublicId(member.id)} joined by link as ${JOIN_ROLE}`,
        },
      });
      if (!appended.ok) {
        return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
      }
    }

    return successResponse<JoinResponse>(
      { orgId: orgPublicId(orgUuid), slug: org.slug, memberId: memberPublicId(member.id), alreadyMember: false },
      requestId,
      201,
    );
  });
}
