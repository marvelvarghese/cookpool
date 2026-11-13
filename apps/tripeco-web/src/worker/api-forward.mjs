// Copied from apps/web-console-next/src/worker/api-forward.mjs for the Tripeco
// app (tripeco TR-5): the same `/api/*` forwarder, with the binding's
// props naming this app (`caller: "tripeco-web"`), which api-edge's
// client-ip.ts trusts as it trusts the console.
//
// THE API ON THE APP'S ADDRESS (Cookpool SM-4, cookpool-simpler design §1.2
// item 2).
//
// The app calls the API on its own origin, `/api/*` (cookpool.store/api/…,
// stage.cookpool.store/api/…, and the console's workers.dev hosts alike), so a
// browser never sends a CORS preflight. The console Worker answers those
// requests itself, before OpenNext is even loaded (./index.mjs), by handing
// them to api-edge over the `API_EDGE` service binding with the prefix
// stripped: `/api/v1/kitchen/me/home?x=1` reaches api-edge as
// `/v1/kitchen/me/home?x=1`, with the method, headers (Authorization
// included), body and query as they came, and its answer (a redirect too,
// `redirect: "manual"`) goes back as it is.
//
// THE CLIENT'S ADDRESS. api-edge keys signed-out rate limits on the client's
// IP. A service-binding request carries no CF-Connecting-IP of Cloudflare's,
// so the forwarder sends the one Cloudflare gave this request in
// `x-console-client-ip`, and api-edge believes that header only over this
// binding (its `props`, apps/api-edge/src/client-ip.ts). Every header a client
// could use to name an address (that one included) is removed first: what a
// client sends to `/api` never reaches api-edge as its address.
//
// Plain JavaScript (with api-forward.d.mts beside it), like the rest of the
// Worker's own code: wrangler bundles it as it is, and the tests import it.
// No dependencies, no Next.

/** The path prefix the console Worker forwards to api-edge. */
export const API_PREFIX = "/api";

/** The header the client's address travels to api-edge in (apps/api-edge/src/client-ip.ts). */
export const CLIENT_IP_HEADER = "x-console-client-ip";

/** The `props` the binding declares (wrangler.jsonc); api-edge trusts CLIENT_IP_HEADER only with them. */
export const BINDING_PROPS = Object.freeze({ caller: "tripeco-web" });

/**
 * Headers that name a client's address or the hops it came through. A client
 * can send any of them; none goes on to api-edge.
 */
export const ADDRESS_HEADERS = Object.freeze([
  "cf-connecting-ip",
  "cf-connecting-ipv6",
  "cf-pseudo-ipv4",
  "true-client-ip",
  "x-real-ip",
  "x-forwarded-for",
  "forwarded",
  CLIENT_IP_HEADER,
]);

const REQUEST_ID_RE = /^[\w-]{1,128}$/;

/** True for `/api` and everything under `/api/` (not `/apis`, not `/API`). */
export function isApiPath(pathname) {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

/** The request to send over the binding: the prefix stripped, the client's address forwarded (see the header). */
export function apiEdgeRequest(request) {
  const target = new URL(request.url);
  // Set as a path, never parsed as a URL: `/api//evil.test/x` stays a path on this origin.
  target.pathname = target.pathname.slice(API_PREFIX.length) || "/";
  const headers = new Headers(request.headers);
  for (const name of ADDRESS_HEADERS) headers.delete(name);
  // Cloudflare's own, for the request that reached this Worker (a client's
  // value never survives the edge).
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  return new Request(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: "manual",
    // Node's Request (the tests) needs it for a stream body; Workers ignores it.
    ...(hasBody ? { duplex: "half" } : {}),
  });
}

function unavailable(request, status, reason) {
  const given = request.headers.get("x-request-id");
  const requestId = given && REQUEST_ID_RE.test(given) ? given : `req_${crypto.randomUUID().replace(/-/g, "")}`;
  return Response.json(
    { error: { code: "internal_error", message: "The API is unavailable", details: { reason }, requestId } },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

/**
 * Forward an `/api/*` request to api-edge over `binding` and return its
 * answer. 503 (`api_edge_unbound`) when this deploy has no binding (local
 * `wrangler dev`, `dev`), 502 (`api_edge_unreachable`) when the call fails.
 */
export async function forwardToApiEdge(request, binding) {
  if (!binding || typeof binding.fetch !== "function") return unavailable(request, 503, "api_edge_unbound");
  try {
    return await binding.fetch(apiEdgeRequest(request));
  } catch {
    return unavailable(request, 502, "api_edge_unreachable");
  }
}

/**
 * The console Worker: `/api/*` to api-edge; everything else to OpenNext, which
 * `loadOpenNext()` imports on the first request that needs it, so an isolate
 * that only answers `/api` never loads the Next bundle.
 */
export function createConsoleWorker(loadOpenNext) {
  return {
    async fetch(request, env, ctx) {
      if (isApiPath(new URL(request.url).pathname)) return forwardToApiEdge(request, env.API_EDGE);
      const { default: openNext } = await loadOpenNext();
      return openNext.fetch(request, env, ctx);
    },
  };
}
