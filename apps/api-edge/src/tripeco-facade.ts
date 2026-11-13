import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

// Tripeco (tripeco TR-2) → tripeco-worker:
//   /v1/tripeco/…   vehicles, the fuel log, rides and their photos
// The edge resolves the session, forwards the actor, and runs the shared
// rate-limit and idempotency gate, exactly as for Spliteco
// (./spliteco-facade.ts); tripeco-worker owns routing below the prefix.
// No delegation scope lists a Tripeco route, so an assistant's token is
// refused before it gets here (./delegation-scopes.ts); the worker refuses one
// again. The edge never forwards `x-tripeco-ride` (it builds the headers
// afresh): only tripeco-worker sends it to spliteco-worker (design §0.4).
const TRIPECO_RE = /^\/v1\/tripeco(?:\/.*)?$/;
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const WITH_BODY = new Set(["POST", "PATCH", "PUT"]);
const FORWARDED_HEADERS = ["content-type", "traceparent", "idempotency-key"];

export function isTripecoRoute(pathname: string): boolean {
  return TRIPECO_RE.test(pathname);
}

export async function handleTripecoRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  }

  return replayOrExecute(request, requestId, env, "tripeco", async () => {
    if (!env.IDENTITY_WORKER) {
      return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
    }
    if (!env.TRIPECO_WORKER) {
      return errorResponse("internal_error", "Tripeco service unavailable", 503, requestId);
    }

    const timings = createTimings();
    const endTotal = timings.start("edge_total");
    const session = await timings.measure("edge_auth", () => resolveActor(request, env, requestId));
    if ("error" in session) return session.error;
    // Belt and braces: no scope allows /v1/tripeco, so this never passes the
    // allowlist in index.ts; if it ever did, an assistant still gets nothing.
    if (session.delegation) {
      return errorResponse("forbidden", "Not available to an assistant", 403, requestId, { reason: "scope" });
    }

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    headers.set("x-actor-subject-id", session.subjectId);
    headers.set("x-actor-subject-type", session.subjectType);
    headers.set("x-actor-email", session.email);
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://tripeco.internal");
    const init: RequestInit = { method: request.method, headers };
    if (WITH_BODY.has(request.method)) init.body = request.body;

    try {
      const downstream = await timings.measure("edge_downstream", () =>
        env.TRIPECO_WORKER!.fetch(target.toString(), init),
      );
      const res = new Response(downstream.body, { status: downstream.status, headers: downstream.headers });
      endTotal();
      return withEdgeTimings(res, requestId, "edge.tripeco", timings);
    } catch {
      return errorResponse("internal_error", "Tripeco service unavailable", 503, requestId);
    }
  });
}
