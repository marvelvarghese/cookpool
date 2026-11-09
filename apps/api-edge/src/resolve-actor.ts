import type { Env } from "./env";
import { errorResponse } from "./http";
import { cacheApiStore, bearerToken, type ActorCacheStore } from "./actor-cache";
import { isDelegatedToken, isDelegationAllowed, scopeRefused } from "./delegation-scopes";
import { isDelegationScope, type DelegationActor } from "@saas/contracts/delegations";

export interface ActorInfo {
  subjectId: string;
  subjectType: string;
  email: string;
  orgId?: string;
  /**
   * A delegated token's (cookpool-mcp MC-2): the user acting through an
   * assistant, within these scopes. Cached with the rest for the same 30 s.
   */
  delegation?: DelegationActor;
}

/** The scope check every resolution passes through: a delegated actor gets only what its scopes allow. */
function withinScopes(info: ActorInfo, request: Request, requestId: string): ActorInfo | ActorFailure {
  if (!info.delegation) return info;
  const { pathname } = new URL(request.url);
  if (!isDelegationAllowed(request.method, pathname, info.delegation.scopes)) {
    return { error: scopeRefused(requestId) };
  }
  return info;
}

/** The delegation identity answered, kept only when well formed; scopes this edge does not know are dropped. */
function readDelegation(raw: unknown): DelegationActor | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as { id?: unknown; scopes?: unknown; clientName?: unknown };
  if (typeof d.id !== "string" || !Array.isArray(d.scopes)) return null;
  return {
    id: d.id,
    scopes: d.scopes.filter(isDelegationScope),
    clientName: typeof d.clientName === "string" ? d.clientName : "",
  };
}

export interface ActorFailure {
  error: Response;
}

export interface ResolveActorDeps {
  /** Injectable cache store (tests). Defaults to the Cache-API store. */
  cache?: ActorCacheStore;
}

/**
 * Resolves bearer token to actor context via IDENTITY_WORKER /v1/auth/resolve.
 * Supports both user sessions (sps_ses_ tokens) and API keys (service_principal).
 *
 * Hot-path cache (Task 0131 / PERF2): a successful resolution is cached by a
 * hash of the token for a short TTL, so repeat requests skip the identity-worker
 * hop + its DB queries. Misses and failures fall through to a live resolve.
 */
export async function resolveActor(
  request: Request,
  env: Env,
  requestId: string,
  deps?: ResolveActorDeps,
): Promise<ActorInfo | ActorFailure> {
  const authorization = request.headers.get("authorization");
  const token = bearerToken(authorization);
  if (!authorization || !token) {
    return {
      error: errorResponse("unauthenticated", "Missing or invalid Authorization header", 401, requestId),
    };
  }

  if (!env.IDENTITY_WORKER) {
    return {
      error: errorResponse("internal_error", "Authentication service unavailable", 503, requestId),
    };
  }

  const cache = deps?.cache ?? cacheApiStore();
  const cached = await cache.get(token);
  if (cached) {
    // A cached entry for a delegated token without its delegation can only
    // be stale or foreign: never let it act as the plain user.
    if (isDelegatedToken(token) && !cached.delegation) {
      await cache.evict(token);
    } else {
      return withinScopes(cached, request, requestId);
    }
  }

  const headers = new Headers();
  headers.set("authorization", authorization);
  headers.set("x-request-id", requestId);

  const target = new URL("/v1/auth/resolve", "https://identity.internal");

  try {
    const response = await env.IDENTITY_WORKER.fetch(target.toString(), {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      return {
        error: errorResponse("unauthenticated", "Authentication failed", 401, requestId),
      };
    }

    const json = (await response.json()) as {
      data?: {
        actor?: {
          actorType?: string;
          actorId?: string;
          email?: string;
          orgId?: string;
          delegation?: unknown;
        };
        user?: { id?: string; email?: string };
      };
    };

    const actor = json?.data?.actor;
    if (!actor?.actorType || !actor?.actorId) {
      return {
        error: errorResponse("unauthenticated", "Authentication failed", 401, requestId),
      };
    }

    // For user actors, prefer user-level email; for service_principal, use actor email or empty
    const email = json?.data?.user?.email ?? actor.email ?? "";

    // MC-2: a delegated token must come back with its delegation, and a
    // delegation only ever rides on a user. Anything else fails closed.
    const delegation = actor.delegation === undefined ? null : readDelegation(actor.delegation);
    if ((actor.delegation !== undefined || isDelegatedToken(token)) && (!delegation || actor.actorType !== "user")) {
      return {
        error: errorResponse("unauthenticated", "Authentication failed", 401, requestId),
      };
    }

    const info: ActorInfo = {
      subjectId: actor.actorId,
      subjectType: actor.actorType,
      email,
      ...(actor.orgId && { orgId: actor.orgId }),
      ...(delegation && { delegation }),
    };
    // Cache only successful resolutions (best-effort; never cache a denial).
    await cache.set(token, info);
    return withinScopes(info, request, requestId);
  } catch {
    return {
      error: errorResponse("internal_error", "Authentication service unavailable", 503, requestId),
    };
  }
}
