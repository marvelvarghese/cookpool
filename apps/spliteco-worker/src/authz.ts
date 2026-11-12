import type { SplitecoAction } from "@saas/contracts/spliteco";
import { ACTOR_DELEGATION_ID_HEADER } from "@saas/contracts/delegations";
import type { Uuid } from "@saas/db/ids";
import type { ActorContext, RequestContext } from "./context.js";
import { notFound, unavailable } from "./http.js";
import { fetchAuthorizationContext } from "./membership-client.js";
import { authorizeViaPolicy } from "./policy-client.js";

/** The caller, from the headers api-edge sets. Null when either is missing: the route answers 401. */
export function resolveActor(request: Request): ActorContext | null {
  const subjectId = request.headers.get("x-actor-subject-id");
  const subjectType = request.headers.get("x-actor-subject-type");
  if (!subjectId || !subjectType) return null;
  return { subjectId, subjectType, delegationId: request.headers.get(ACTOR_DELEGATION_ID_HEADER) };
}

/**
 * May the caller take `action` in the group `orgId`? `null` when allowed;
 * otherwise the Response to return as is. The same two hops kitchen-worker
 * takes (membership's facts, policy's decision); every denial is the opaque
 * 404, so a caller outside a group learns nothing about it.
 */
export async function requireOrgAction(ctx: RequestContext, orgId: Uuid, action: SplitecoAction): Promise<Response | null> {
  const { env, requestId, actor } = ctx;
  if (!env.MEMBERSHIP_WORKER || !env.POLICY_WORKER) return unavailable(requestId);
  return ctx.timings.measure("authz", async () => {
    const membership = await fetchAuthorizationContext(env.MEMBERSHIP_WORKER!, actor.subjectId, actor.subjectType, orgId, requestId);
    if (!membership.ok) return notFound(requestId);
    const decision = await authorizeViaPolicy(
      env.POLICY_WORKER!,
      actor.subjectId,
      actor.subjectType,
      action,
      { kind: "organization", orgId },
      membership.memberships,
      requestId,
    );
    return decision.allow ? null : notFound(requestId);
  });
}
