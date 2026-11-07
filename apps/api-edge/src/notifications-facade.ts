import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { enforceRateLimit, mergeRateLimitHeaders } from "./rate-limit.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

/**
 * Public facade for end-user notification preferences (PX3) and Web Push
 * (Cookpool PW-5).
 *
 * Every route forwards to notifications-worker over the service binding with
 * the subject **pinned to the resolved session actor**:
 *
 *   GET / PUT  /v1/notifications/preferences
 *       whatever `subjectKind` / `subjectId` the caller supplies is replaced
 *       with `user` / the actor's own id, so a user can only ever read or
 *       update their own preferences. Org-level (subjectKind=organization)
 *       defaults remain internal-only — no public route exposes them. Push
 *       preferences (`channel=push`, per kind) go through the same route.
 *   POST / DELETE  /v1/notifications/push-subscriptions
 *       the person is the actor headers, never the body: only `endpoint` and
 *       `keys` are forwarded, with the browser's User-Agent (the device's
 *       label). A caller adds and removes only their own devices.
 *   GET   /v1/notifications/push-key    the VAPID public key the app subscribes with
 *   POST  /v1/notifications/push-test   a test push to the caller's own devices
 */

const PREFERENCES_PATH = "/v1/notifications/preferences";
const PUSH_SUBSCRIPTIONS_PATH = "/v1/notifications/push-subscriptions";
const PUSH_KEY_PATH = "/v1/notifications/push-key";
const PUSH_TEST_PATH = "/v1/notifications/push-test";

const METHODS: Record<string, readonly string[]> = {
  [PREFERENCES_PATH]: ["GET", "PUT"],
  [PUSH_SUBSCRIPTIONS_PATH]: ["POST", "DELETE"],
  [PUSH_KEY_PATH]: ["GET"],
  [PUSH_TEST_PATH]: ["POST"],
};

export function isNotificationsRoute(pathname: string): boolean {
  return Object.hasOwn(METHODS, pathname);
}

type Built = { target: URL; init: RequestInit } | { error: Response };

/** The JSON object body, or an error response. An empty body reads as `{}` where `emptyOk`. */
async function readObject(request: Request, requestId: string, emptyOk = false): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    const text = await request.text();
    if (!text.trim() && emptyOk) return {};
    body = JSON.parse(text);
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("bad_request", "Body must be a JSON object", 400, requestId);
  }
  return body as Record<string, unknown>;
}

/** Only these fields of the caller's body travel on: nothing can name another person. */
function only(body: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) if (body[field] !== undefined) out[field] = body[field];
  return out;
}

async function buildDownstream(
  request: Request,
  requestId: string,
  pathname: string,
  subjectId: string,
  headers: Headers,
): Promise<Built> {
  const url = new URL(request.url);
  const target = new URL(pathname, "https://notifications.internal");

  if (pathname === PREFERENCES_PATH) {
    if (request.method === "GET") {
      // Rebuild the query with the subject pinned to the actor; pass through
      // only orgId and the optional channel filter.
      const orgId = url.searchParams.get("orgId");
      if (orgId) target.searchParams.set("orgId", orgId);
      const channel = url.searchParams.get("channel");
      if (channel) target.searchParams.set("channel", channel);
      target.searchParams.set("subjectKind", "user");
      target.searchParams.set("subjectId", subjectId);
      return { target, init: { method: "GET", headers } };
    }
    const body = await readObject(request, requestId);
    if (body instanceof Response) return { error: body };
    const pinned = { ...body, subjectKind: "user", subjectId };
    headers.set("content-type", "application/json");
    return { target, init: { method: "PUT", headers, body: JSON.stringify(pinned) } };
  }

  if (pathname === PUSH_KEY_PATH) return { target, init: { method: "GET", headers } };

  // The push writes: the device's label comes from the browser's User-Agent.
  const userAgent = request.headers.get("user-agent");
  if (userAgent) headers.set("user-agent", userAgent.slice(0, 512));
  headers.set("content-type", "application/json");
  if (pathname === PUSH_TEST_PATH) {
    const body = await readObject(request, requestId, true);
    if (body instanceof Response) return { error: body };
    return { target, init: { method: "POST", headers, body: JSON.stringify(only(body, ["endpoint"])) } };
  }
  const body = await readObject(request, requestId);
  if (body instanceof Response) return { error: body };
  const fields = request.method === "POST" ? ["endpoint", "keys"] : ["endpoint"];
  return { target, init: { method: request.method, headers, body: JSON.stringify(only(body, fields)) } };
}

export async function handleNotificationsRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  if (!METHODS[pathname]?.includes(request.method)) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  }

  const rateDecision = await enforceRateLimit(request, requestId, env, "notifications");
  if (rateDecision.kind === "denied") {
    return rateDecision.response;
  }
  const rateHeaders = rateDecision.headers;

  if (!env.IDENTITY_WORKER) {
    return mergeRateLimitHeaders(
      errorResponse("internal_error", "Authentication service unavailable", 503, requestId),
      rateHeaders,
    );
  }
  if (!env.NOTIFICATIONS_WORKER) {
    return mergeRateLimitHeaders(
      errorResponse("internal_error", "Notifications service unavailable", 503, requestId),
      rateHeaders,
    );
  }

  const timings = createTimings();
  const endTotal = timings.start("edge_total");
  const sessionResult = await timings.measure("edge_auth", () =>
    resolveActor(request, env, requestId),
  );
  if ("error" in sessionResult) {
    return mergeRateLimitHeaders(sessionResult.error, rateHeaders);
  }

  const headers = new Headers();
  headers.set("x-request-id", requestId);
  // notifications-worker's internal-actor gate: the edge is an allowed caller
  // and the actor headers carry the pinned subject.
  headers.set("x-internal-actor", "api-edge");
  headers.set("x-actor-subject-id", sessionResult.subjectId);
  headers.set("x-actor-subject-type", sessionResult.subjectType);
  const traceparent = request.headers.get("traceparent");
  if (traceparent) headers.set("traceparent", traceparent);

  const built = await buildDownstream(request, requestId, pathname, sessionResult.subjectId, headers);
  if ("error" in built) return mergeRateLimitHeaders(built.error, rateHeaders);

  try {
    const downstream = await timings.measure("edge_downstream", () =>
      env.NOTIFICATIONS_WORKER!.fetch(built.target.toString(), built.init),
    );
    endTotal();
    return mergeRateLimitHeaders(
      withEdgeTimings(
        new Response(downstream.body, {
          status: downstream.status,
          headers: downstream.headers,
        }),
        requestId,
        "edge.notifications",
        timings,
      ),
      rateHeaders,
    );
  } catch {
    return mergeRateLimitHeaders(
      errorResponse("internal_error", "Notifications service unavailable", 503, requestId),
      rateHeaders,
    );
  }
}
