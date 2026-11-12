import type { Env } from "./env";
import { errorResponse } from "./http";
import { replayOrExecute } from "./idempotency";
import { cacheApiStore, bearerToken } from "./actor-cache";

const LOGOUT_PATH = "/v1/auth/logout";

const AUTH_ROUTES: Record<string, string> = {
  "/v1/auth/login/start": "POST",
  "/v1/auth/login/complete": "POST",
  "/v1/auth/session": "GET",
  "/v1/auth/resolve": "GET",
  "/v1/auth/logout": "POST",
  "/v1/auth/security-events": "GET",
  // Passkeys (Cookpool PK-2). register/* and the list take a session;
  // login/* take nobody and share the auth family's per-IP limit with
  // login/start. A delegated token is refused on all of them (index.ts).
  "/v1/auth/passkeys/register/options": "POST",
  "/v1/auth/passkeys/register/verify": "POST",
  "/v1/auth/passkeys/login/options": "POST",
  "/v1/auth/passkeys/login/verify": "POST",
  "/v1/auth/passkeys": "GET",
};

const AUTH_MULTI_METHOD_ROUTES: Record<string, Set<string>> = {
  "/v1/auth/profile": new Set(["GET", "PATCH"]),
  // Delegated tokens for assistants (MC-2): a signed-in session only. The
  // edge refuses a delegated token on every /v1/auth/ route (index.ts).
  "/v1/auth/delegations": new Set(["GET", "POST"]),
};

// DELETE /v1/auth/delegations/{dlg} (MC-2): revoke one. PATCH (cookpool-spliteco
// SE-6): change what it may do, within what was allowed at connect.
const DELEGATION_ID_RE = /^\/v1\/auth\/delegations\/[^/]+$/;

// DELETE /v1/auth/passkeys/{pky} (PK-2): remove one. Matched after the exact
// passkey paths above, so register/… and login/… are never taken for an id.
const PASSKEY_ID_RE = /^\/v1\/auth\/passkeys\/pky_[^/]+$/;

// OAuth sign-in routes (all GET). `start` and `callback` are browser-redirect
// navigations; `providers` is a JSON read. The `:provider` segment is dynamic,
// so these are matched by pattern rather than the static route map.
const OAUTH_PROVIDERS_PATH = "/v1/auth/oauth/providers";
const OAUTH_START_RE = /^\/v1\/auth\/oauth\/[^/]+\/start$/;
const OAUTH_CALLBACK_RE = /^\/v1\/auth\/oauth\/[^/]+\/callback$/;

function isOAuthRoute(pathname: string): boolean {
  return (
    pathname === OAUTH_PROVIDERS_PATH ||
    OAUTH_START_RE.test(pathname) ||
    OAUTH_CALLBACK_RE.test(pathname)
  );
}

const FORWARDED_HEADERS = [
  "authorization",
  "content-type",
  "x-request-id",
  "traceparent",
  "idempotency-key",
  // Names a passkey the person did not name (PK-2) and fills the security
  // events' user agent.
  "user-agent",
  // Forwarded so the OAuth callback can read the state cookie set by `start`
  // (double-submit CSRF defense). Cookies are first-party to api-edge.
  "cookie",
];

export function isAuthRoute(pathname: string): boolean {
  return (
    pathname in AUTH_ROUTES ||
    pathname in AUTH_MULTI_METHOD_ROUTES ||
    isOAuthRoute(pathname) ||
    DELEGATION_ID_RE.test(pathname) ||
    PASSKEY_ID_RE.test(pathname)
  );
}

export async function handleAuthRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  const expectedMethod = AUTH_ROUTES[pathname];
  const allowedMethods = AUTH_MULTI_METHOD_ROUTES[pathname];
  const oauth = isOAuthRoute(pathname);
  // Both take one DELETE: revoke a delegation (MC-2), remove a passkey (PK-2);
  // a delegation also takes PATCH (SE-6).
  const delegationId = DELEGATION_ID_RE.test(pathname);
  const delegation = delegationId || PASSKEY_ID_RE.test(pathname);

  if (!expectedMethod && !allowedMethods && !oauth && !delegation) {
    return errorResponse("not_found", `Route not found: ${pathname}`, 404, requestId);
  }

  if (delegation) {
    if (request.method !== "DELETE" && !(delegationId && request.method === "PATCH")) {
      return errorResponse("unsupported", "Method not allowed", 405, requestId);
    }
  } else if (oauth) {
    if (request.method !== "GET") {
      return errorResponse("unsupported", "Method not allowed", 405, requestId);
    }
  } else if (expectedMethod && request.method !== expectedMethod) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  } else if (allowedMethods && !allowedMethods.has(request.method)) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  }

  return replayOrExecute(request, requestId, env, "auth", async () => {
    if (!env.IDENTITY_WORKER) {
      return errorResponse(
        "internal_error",
        "Authentication service unavailable",
        503,
        requestId,
      );
    }

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    for (const name of FORWARDED_HEADERS) {
      if (name === "x-request-id") continue;
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://identity.internal");

    const init: RequestInit = {
      method: request.method,
      headers,
      // OAuth `start`/`callback` return 302s (to the provider, then back to the
      // console). Without manual mode the service-binding fetch would FOLLOW
      // them server-side instead of handing the redirect to the browser.
      // Other auth routes never redirect, so this is inert for them.
      redirect: "manual",
    };

    if (request.method === "POST" || request.method === "PATCH") {
      init.body = request.body;
    }

    try {
      const downstream = await env.IDENTITY_WORKER.fetch(target.toString(), init);
      // On a successful logout, evict the cached actor so the (now-revoked)
      // session can't be served from the edge cache for the rest of its TTL.
      if (pathname === LOGOUT_PATH && downstream.ok) {
        const token = bearerToken(request.headers.get("authorization"));
        if (token) await cacheApiStore().evict(token);
      }
      return new Response(downstream.body, {
        status: downstream.status,
        headers: downstream.headers,
      });
    } catch {
      return errorResponse(
        "internal_error",
        "Authentication service unavailable",
        503,
        requestId,
      );
    }
  });
}
