import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";
import { ACTOR_DELEGATION_CLIENT_HEADER, ACTOR_DELEGATION_ID_HEADER, ACTOR_SCOPES_HEADER } from "@saas/contracts/delegations";

// Spliteco (cookpool-spliteco SE1) → spliteco-worker:
//   /v1/spliteco/…   groups, expenses, balances, activity, insights, export
// The edge resolves the session, forwards the actor, and runs the shared
// rate-limit and idempotency gate, exactly as for the kitchen
// (./kitchen-facade.ts); spliteco-worker owns routing below the prefix.
// Delegated tokens (assistants) reach only what ./delegation-scopes.ts allows
// under money.read and money.write (SE-6) — never a payment — and the worker
// checks the same again.
const SPLITECO_RE = /^\/v1\/spliteco(?:\/.*)?$/;
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const WITH_BODY = new Set(["POST", "PATCH", "PUT"]);
const FORWARDED_HEADERS = ["content-type", "traceparent", "idempotency-key"];

export function isSplitecoRoute(pathname: string): boolean {
  return SPLITECO_RE.test(pathname);
}

export async function handleSplitecoRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  }

  return replayOrExecute(request, requestId, env, "spliteco", async () => {
    if (!env.IDENTITY_WORKER) {
      return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
    }
    if (!env.SPLITECO_WORKER) {
      return errorResponse("internal_error", "Spliteco service unavailable", 503, requestId);
    }

    const timings = createTimings();
    const endTotal = timings.start("edge_total");
    const session = await timings.measure("edge_auth", () => resolveActor(request, env, requestId));
    if ("error" in session) return session.error;

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    headers.set("x-actor-subject-id", session.subjectId);
    headers.set("x-actor-subject-type", session.subjectType);
    headers.set("x-actor-email", session.email);
    // A delegated actor (MC-2) — and only one — carries its delegation, so a
    // route can require an assistant (MC-5's suggestions) or refuse one.
    if (session.delegation) {
      headers.set(ACTOR_DELEGATION_ID_HEADER, session.delegation.id);
      headers.set(ACTOR_SCOPES_HEADER, session.delegation.scopes.join(","));
      // SE-6: so Activity can say "via Claude".
      headers.set(ACTOR_DELEGATION_CLIENT_HEADER, encodeURIComponent(session.delegation.clientName));
    }
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://spliteco.internal");
    const init: RequestInit = { method: request.method, headers };
    if (WITH_BODY.has(request.method)) init.body = request.body;

    try {
      const downstream = await timings.measure("edge_downstream", () =>
        env.SPLITECO_WORKER!.fetch(target.toString(), init),
      );
      const res = new Response(downstream.body, { status: downstream.status, headers: downstream.headers });
      endTotal();
      return withEdgeTimings(res, requestId, "edge.spliteco", timings);
    } catch {
      return errorResponse("internal_error", "Spliteco service unavailable", 503, requestId);
    }
  });
}
