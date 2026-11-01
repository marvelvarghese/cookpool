import type { KitchenAction } from "@saas/contracts/kitchen";
import type { Uuid } from "@saas/db/ids";
import type { ActorContext, OrgContext } from "./context.js";
import type { Env } from "./env.js";
import { notFound, unavailable } from "./http.js";
import { fetchAuthorizationContext } from "./membership-client.js";
import { authorizeViaPolicy } from "./policy-client.js";

/**
 * The caller, from the headers api-edge sets after resolving the session or
 * API key. Null when either is missing: the route answers 401.
 */
export function resolveActor(request: Request): ActorContext | null {
  const subjectId = request.headers.get("x-actor-subject-id");
  const subjectType = request.headers.get("x-actor-subject-type");
  if (!subjectId || !subjectType) return null;
  return { subjectId, subjectType };
}

/**
 * May `actor` take `action` in the group `orgId`? `null` when allowed;
 * otherwise the Response to return as is.
 *
 * The caller's role facts come from membership-worker's authorization context
 * and the decision from policy-worker, the same two hops every bounded context
 * takes. Every denial — not a member, a role without the grant, a failed hop —
 * is the opaque 404, so a caller outside a group learns nothing about it.
 * Missing bindings are a 503.
 *
 * `orgId` is the decoded UUID (membership facts and the policy resource are
 * keyed by it), not the `org_…` public id: decode with `parseOrgPublicId`.
 */
export async function requireOrgAction(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: Uuid,
  action: KitchenAction,
): Promise<Response | null> {
  if (!env.MEMBERSHIP_WORKER || !env.POLICY_WORKER) return unavailable(requestId);

  const membership = await fetchAuthorizationContext(
    env.MEMBERSHIP_WORKER,
    actor.subjectId,
    actor.subjectType,
    orgId,
    requestId,
  );
  if (!membership.ok) return notFound(requestId);

  const decision = await authorizeViaPolicy(
    env.POLICY_WORKER,
    actor.subjectId,
    actor.subjectType,
    action,
    { kind: "organization", orgId },
    membership.memberships,
    requestId,
  );
  return decision.allow ? null : notFound(requestId);
}

/** `requireOrgAction` for the request's own group, timed as `authz`. */
export function requireGroupAction(ctx: OrgContext, action: KitchenAction): Promise<Response | null> {
  return ctx.timings.measure("authz", () =>
    requireOrgAction(ctx.env, ctx.requestId, ctx.actor, ctx.orgId, action),
  );
}
