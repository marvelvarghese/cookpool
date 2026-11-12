import type { SplitecoAction } from "@saas/contracts/spliteco";
import {
  ACTOR_DELEGATION_CLIENT_HEADER,
  ACTOR_DELEGATION_ID_HEADER,
  ACTOR_SCOPES_HEADER,
  DELEGATION_CLIENT_NAME_MAX,
} from "@saas/contracts/delegations";
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
  const delegationId = request.headers.get(ACTOR_DELEGATION_ID_HEADER) || null;
  if (!delegationId) return { subjectId, subjectType, delegationId: null, scopes: [], clientName: null };
  const scopes = (request.headers.get(ACTOR_SCOPES_HEADER) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { subjectId, subjectType, delegationId, scopes, clientName: clientNameOf(request.headers.get(ACTOR_DELEGATION_CLIENT_HEADER)) };
}

/** The assistant's name from its header (URI-encoded by api-edge): trimmed, printable, at most 80; null when unusable. */
export function clientNameOf(raw: string | null): string | null {
  if (!raw) return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return name ? Array.from(name).slice(0, DELEGATION_CLIENT_NAME_MAX).join("") : null;
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
