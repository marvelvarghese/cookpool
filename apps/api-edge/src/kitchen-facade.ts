import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

// Cookpool's kitchen (cookpool-kitchen epic) → kitchen-worker:
//   /v1/kitchen/…                          the caller across every group (/v1/kitchen/me/…)
//   /v1/organizations/{org}/kitchen/…      one group: settings, pantry, ledger, dishes
// The edge resolves the session, forwards the actor, and runs the shared
// rate-limit and idempotency gate; kitchen-worker owns routing below these
// prefixes, so new kitchen routes need no edge change.
const KITCHEN_RE = /^\/v1\/(?:kitchen|organizations\/[^/]+\/kitchen)(?:\/.*)?$/;
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const WITH_BODY = new Set(["POST", "PATCH", "PUT"]);
const FORWARDED_HEADERS = ["content-type", "traceparent", "idempotency-key"];

export function isKitchenRoute(pathname: string): boolean {
  return KITCHEN_RE.test(pathname);
}

export async function handleKitchenRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  }

  return replayOrExecute(request, requestId, env, "kitchen", async () => {
    if (!env.IDENTITY_WORKER) {
      return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
    }
    if (!env.KITCHEN_WORKER) {
      return errorResponse("internal_error", "Kitchen service unavailable", 503, requestId);
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
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://kitchen.internal");
    const init: RequestInit = { method: request.method, headers };
    if (WITH_BODY.has(request.method)) init.body = request.body;

    try {
      const downstream = await timings.measure("edge_downstream", () =>
        env.KITCHEN_WORKER!.fetch(target.toString(), init),
      );
      const res = new Response(downstream.body, { status: downstream.status, headers: downstream.headers });
      endTotal();
      return withEdgeTimings(res, requestId, "edge.kitchen", timings);
    } catch {
      return errorResponse("internal_error", "Kitchen service unavailable", 503, requestId);
    }
  });
}
