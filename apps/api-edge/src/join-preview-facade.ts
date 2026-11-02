// The signed-out join preview (Cookpool SI-4).
//
//   GET /v1/join/{code}/preview → membership-worker → { groupName, inviterFirstName, memberCount }
//
// The only route under /v1/join… that answers without a session: the sign-in
// page shows which group a join link is for before the person has an account.
// Everything else under /v1/join… stays in the org facade and still resolves
// a session first (GET /v1/join/{code}, POST /v1/join).
//
// What keeps it narrow:
//   - Matching. One anchored pattern: `/v1/join/`, exactly one non-empty
//     segment with no `/`, then `/preview`, and nothing after (no trailing
//     slash, no further segments, case-sensitive). The pathname it is tested
//     against is the URL parser's, so dot segments (`/x/../`, `%2e%2e`) are
//     already resolved; `%2F` stays inside the one segment, and
//     membership-worker reads that as a malformed code (404).
//   - Forwarding. Only GET. The path is rebuilt from the captured segment, with
//     no query string and no body; the only headers sent are x-request-id and
//     traceparent. No Authorization, Cookie or x-actor-* header ever reaches
//     membership-worker from here, whatever the caller sent, and no session is
//     resolved, so a stale token neither helps nor hurts.
//   - Rate limit. `replayOrExecute` with family `join_preview`, whose identity
//     bucket is always `anon:join_preview:<ip>`, even when a token is sent
//     (rate-limit.ts, SIGNED_OUT_FAMILIES).
//   - The answer. A 200 is re-built from the three contract fields
//     (JOIN_PREVIEW_PUBLIC_KEYS), so even a membership-worker that answered
//     more could not leak it through here; a body without them is a 503.
//     Other statuses pass through with their body (the one 404 for an unknown,
//     malformed or rotated code).
//   - Every response from this route, errors and 429s included, carries
//     `Cache-Control: no-store`.

import type { Env } from "./env.js";
import type { JoinPreviewPublic } from "@saas/contracts/membership";
import { createTimings } from "@saas/contracts/timing";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";

const JOIN_PREVIEW_PUBLIC_RE = /^\/v1\/join\/([^/]+)\/preview$/;

const FORWARDED_HEADERS = ["x-request-id", "traceparent"] as const;

/** Is this the signed-out join preview, `GET /v1/join/{code}/preview`? */
export function isJoinPreviewRoute(pathname: string): boolean {
  return JOIN_PREVIEW_PUBLIC_RE.test(pathname);
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The three contract fields, each checked; null when the body is not a preview. */
function pickPreview(body: unknown): JoinPreviewPublic | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { groupName, inviterFirstName, memberCount } = data as Record<string, unknown>;
  if (typeof groupName !== "string") return null;
  if (inviterFirstName !== null && typeof inviterFirstName !== "string") return null;
  if (typeof memberCount !== "number" || !Number.isSafeInteger(memberCount) || memberCount < 0) return null;
  return { groupName, inviterFirstName, memberCount };
}

export async function handleJoinPreviewRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  const match = JOIN_PREVIEW_PUBLIC_RE.exec(pathname);
  if (!match) {
    return noStore(errorResponse("not_found", `Route not found: ${pathname}`, 404, requestId));
  }
  if (request.method !== "GET") {
    return noStore(errorResponse("unsupported", "Method not allowed", 405, requestId));
  }
  const codeSegment = match[1]!;

  const response = await replayOrExecute(request, requestId, env, "join_preview", async () => {
    if (!env.MEMBERSHIP_WORKER) {
      return errorResponse("internal_error", "Membership service unavailable", 503, requestId);
    }

    const timings = createTimings();
    const endTotal = timings.start("edge_total");

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    for (const name of FORWARDED_HEADERS) {
      if (name === "x-request-id") continue;
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const target = new URL(`/v1/join/${codeSegment}/preview`, "https://membership.internal");

    let downstream: Response;
    try {
      downstream = await timings.measure("edge_downstream", () =>
        env.MEMBERSHIP_WORKER!.fetch(target.toString(), { method: "GET", headers }),
      );
    } catch {
      return errorResponse("internal_error", "Membership service unavailable", 503, requestId);
    }

    let res: Response;
    if (downstream.status === 200) {
      let parsed: unknown = null;
      try {
        parsed = await downstream.json();
      } catch {
        parsed = null;
      }
      const preview = pickPreview(parsed);
      if (!preview) {
        return errorResponse("internal_error", "Membership service unavailable", 503, requestId);
      }
      res = Response.json({ data: preview, meta: { requestId, cursor: null } }, { status: 200 });
    } else {
      res = new Response(downstream.body, {
        status: downstream.status,
        headers: { "content-type": downstream.headers.get("content-type") ?? "application/json" },
      });
    }
    endTotal();
    return withEdgeTimings(res, requestId, "edge.join_preview", timings);
  });

  return noStore(response);
}
