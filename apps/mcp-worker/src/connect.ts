// Authorizing an assistant (design §2): /authorize, then the console's
// /connect page, then back here to finish.
//
//   GET  /authorize               the client's OAuth request (PKCE S256 required) → 302 {CONSOLE_ORIGIN}/connect?req=<id>
//   GET  /connect/request?req=    what the console's page shows → ConnectRequestInfo
//   POST /connect/complete        session bearer; { req, delegationId, token } → { redirectTo }
//   POST /connect/deny            session bearer; { req } → { redirectTo } with error=access_denied
//   POST /connect/disconnect      session bearer; { delegationId } → { revokedGrants, delegationRevoked }
//
// The pending request is kept in MCP_OAUTH_KV for CONNECT_REQUEST_TTL_SECONDS
// under an unguessable id, and is used once. The grant's props, encrypted by
// the provider, hold the delegated token; its metadata (in the clear) holds
// only the delegation id and client name, so Disconnect can find it.

import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type AuthRequest,
  type GrantSummary,
} from "@cloudflare/workers-oauth-provider";
import {
  CONNECT_REQUEST_TTL_SECONDS,
  isAssistantScope,
  type ConnectDisconnectResponse,
  type ConnectRedirectResponse,
  type ConnectRequestInfo,
} from "@saas/contracts/mcp-connect";
import type { GrantMetadata, GrantProps, ProviderEnv } from "./env.js";
import { bearerOf, errorResponse, jsonObject, plainError, randomToken, successResponse } from "./http.js";
import {
  DELEGATED_TOKEN_PREFIX,
  listDelegations,
  revokeDelegation,
  sessionUser,
  tokenMatchesDelegation,
} from "./identity.js";

const PENDING_PREFIX = "cookpool:connect:";
const REQ_RE = /^[A-Za-z0-9_-]{32,64}$/;
const MAX_TOKEN_LENGTH = 512;

interface PendingConnect {
  authRequest: AuthRequest;
  info: Omit<ConnectRequestInfo, "req">;
}

async function loadPending(env: ProviderEnv, req: unknown): Promise<PendingConnect | null> {
  if (typeof req !== "string" || !REQ_RE.test(req)) return null;
  return env.OAUTH_KV.get<PendingConnect>(PENDING_PREFIX + req, { type: "json" });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

// ── GET /authorize ─────────────────────────────────────────

export async function handleAuthorize(request: Request, env: ProviderEnv): Promise<Response> {
  if (request.method !== "GET") return plainError("Use GET for /authorize.", 405);
  let authRequest: AuthRequest;
  let info: PendingConnect["info"];
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    // The provider requires PKCE of public clients only; Cookpool requires it of every client.
    if (!authRequest.codeChallenge || authRequest.codeChallengeMethod !== "S256") {
      return redirect(authorizationErrorRedirect(authRequest, "invalid_request", "PKCE with S256 is required"));
    }
    const consent = await env.OAUTH_PROVIDER.describeConsent(authRequest);
    info = {
      clientId: consent.clientId,
      clientName: consent.clientName,
      clientDomain: consent.clientDomain ?? null,
      redirectHost: consent.redirectHost,
      redirectIsLoopback: consent.redirectIsLoopback,
      requestedScopes: consent.scope.filter(isAssistantScope),
      expiresAt: new Date(Date.now() + CONNECT_REQUEST_TTL_SECONDS * 1000).toISOString(),
    };
  } catch (error) {
    // A redirect is safe only once the client and its exact redirect URI are validated.
    if (error instanceof AuthorizationError && error.redirectTo) return redirect(error.redirectTo);
    if (error instanceof AuthorizationError) return plainError(error.description);
    if (error instanceof CimdFetchError) return plainError("This assistant could not be verified.");
    throw error;
  }

  const req = randomToken(32);
  const pending: PendingConnect = { authRequest, info };
  await env.OAUTH_KV.put(PENDING_PREFIX + req, JSON.stringify(pending), { expirationTtl: CONNECT_REQUEST_TTL_SECONDS });
  const to = new URL("/connect", env.CONSOLE_ORIGIN);
  to.searchParams.set("req", req);
  return redirect(to.toString());
}

// ── /connect/* ─────────────────────────────────────────────

export async function handleConnect(request: Request, env: ProviderEnv, requestId: string, pathname: string): Promise<Response> {
  switch (pathname) {
    case "/connect/request":
      return request.method === "GET" ? describe(request, env, requestId) : methodNotAllowed(requestId);
    case "/connect/complete":
      return request.method === "POST" ? complete(request, env, requestId) : methodNotAllowed(requestId);
    case "/connect/deny":
      return request.method === "POST" ? deny(request, env, requestId) : methodNotAllowed(requestId);
    case "/connect/disconnect":
      return request.method === "POST" ? disconnect(request, env, requestId) : methodNotAllowed(requestId);
    default:
      return errorResponse("not_found", `Route not found: ${pathname}`, 404, requestId);
  }
}

function methodNotAllowed(requestId: string): Response {
  return errorResponse("unsupported", "Method not allowed", 405, requestId);
}

function expired(requestId: string): Response {
  return errorResponse("not_found", "This connection request has expired. Start again from your assistant.", 404, requestId, {
    reason: "expired",
  });
}

async function describe(request: Request, env: ProviderEnv, requestId: string): Promise<Response> {
  const req = new URL(request.url).searchParams.get("req");
  const pending = await loadPending(env, req);
  if (!pending) return expired(requestId);
  return successResponse<ConnectRequestInfo>({ req: req!, ...pending.info }, requestId);
}

type Signed = { ok: true; session: string; userId: string } | { ok: false; response: Response };

/** The person's own session, checked through api-edge. A delegated token never consents or disconnects. */
async function signedIn(request: Request, env: ProviderEnv, requestId: string): Promise<Signed> {
  const session = bearerOf(request);
  if (!session) {
    return { ok: false, response: errorResponse("unauthenticated", "Sign in to Cookpool first", 401, requestId) };
  }
  if (session.startsWith(DELEGATED_TOKEN_PREFIX)) {
    return {
      ok: false,
      response: errorResponse("forbidden", "An assistant's token can't do this", 403, requestId, { reason: "delegated" }),
    };
  }
  const user = await sessionUser(env, session, requestId);
  if (!user.ok) {
    return {
      ok: false,
      response:
        user.status === 503
          ? errorResponse("internal_error", "Cookpool sign-in is unavailable", 503, requestId)
          : errorResponse("unauthenticated", "Sign in to Cookpool first", 401, requestId),
    };
  }
  return { ok: true, session, userId: user.userId };
}

async function complete(request: Request, env: ProviderEnv, requestId: string): Promise<Response> {
  const body = await jsonObject(request);
  const fields: Record<string, string[]> = {};
  const req = body?.req;
  const delegationId = body?.delegationId;
  const token = body?.token;
  if (typeof req !== "string" || req === "") fields.req = ["Required"];
  if (typeof delegationId !== "string" || delegationId === "") fields.delegationId = ["Required"];
  if (typeof token !== "string" || !token.startsWith(DELEGATED_TOKEN_PREFIX) || token.length > MAX_TOKEN_LENGTH) {
    fields.token = ["Must be the sps_dlg_ token minted with the delegation"];
  } else if (typeof delegationId === "string" && !tokenMatchesDelegation(token, delegationId)) {
    fields.token = ["Must be the token of this delegation"];
  }
  if (Object.keys(fields).length > 0) {
    return errorResponse("validation_failed", "Validation failed", 422, requestId, { fields });
  }

  const signed = await signedIn(request, env, requestId);
  if (!signed.ok) return signed.response;
  const pending = await loadPending(env, req);
  if (!pending) return expired(requestId);

  const listed = await listDelegations(env, signed.session, requestId);
  if (!listed.ok) return errorResponse("internal_error", "Cookpool couldn't read your assistants", 503, requestId);
  const delegation = listed.delegations.find((d) => d.id === delegationId);
  if (!delegation || delegation.revokedAt !== null) {
    return errorResponse("not_found", "That assistant connection isn't yours or has ended", 404, requestId, {
      reason: "delegation",
    });
  }
  if (delegation.clientId !== pending.info.clientId) {
    return errorResponse("validation_failed", "Validation failed", 422, requestId, {
      fields: { delegationId: ["Must be a delegation made for this assistant"] },
    });
  }
  const scopes = delegation.scopes.filter(isAssistantScope);
  if (scopes.length === 0) {
    return errorResponse("validation_failed", "Validation failed", 422, requestId, {
      fields: { delegationId: ["Must allow at least one thing"] },
    });
  }

  // Used once: a second Allow on the same request finds nothing.
  await env.OAUTH_KV.delete(PENDING_PREFIX + (req as string));

  const earlier = await grantsOf(env, signed.userId, (g) => g.clientId === pending.info.clientId);
  const props: GrantProps = {
    delegatedToken: token as string,
    scopes,
    delegationId: delegation.id,
    delegatedExpiresAt: delegation.expiresAt,
  };
  const metadata: GrantMetadata = { delegationId: delegation.id, clientName: pending.info.clientName };
  let redirectTo: string;
  try {
    // By default this also revokes the person's earlier grants for this client.
    ({ redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: pending.authRequest,
      userId: signed.userId,
      metadata,
      scope: scopes,
      props,
    }));
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      return errorResponse("precondition_failed", "This assistant can no longer be connected. Start again from your assistant.", 412, requestId);
    }
    throw error;
  }

  // A reconnect replaces the old grant (above); end the delegations those grants held too.
  for (const grant of earlier) {
    const old = (grant.metadata as Partial<GrantMetadata> | null)?.delegationId;
    if (typeof old === "string" && old !== delegation.id) await revokeDelegation(env, signed.session, old, requestId);
  }
  return successResponse<ConnectRedirectResponse>({ redirectTo }, requestId);
}

async function deny(request: Request, env: ProviderEnv, requestId: string): Promise<Response> {
  const body = await jsonObject(request);
  const signed = await signedIn(request, env, requestId);
  if (!signed.ok) return signed.response;
  const pending = await loadPending(env, body?.req);
  if (!pending) return expired(requestId);
  await env.OAUTH_KV.delete(PENDING_PREFIX + (body!.req as string));
  const redirectTo = authorizationErrorRedirect(pending.authRequest, "access_denied", "The person declined");
  return successResponse<ConnectRedirectResponse>({ redirectTo }, requestId);
}

async function disconnect(request: Request, env: ProviderEnv, requestId: string): Promise<Response> {
  const body = await jsonObject(request);
  const delegationId = body?.delegationId;
  if (typeof delegationId !== "string" || !delegationId.startsWith("dlg_")) {
    return errorResponse("validation_failed", "Validation failed", 422, requestId, {
      fields: { delegationId: ["Must be a dlg_ id"] },
    });
  }
  const signed = await signedIn(request, env, requestId);
  if (!signed.ok) return signed.response;
  // Only this person's grants are listed, so nobody ends another person's.
  const grants = await grantsOf(env, signed.userId, (g) => (g.metadata as Partial<GrantMetadata> | null)?.delegationId === delegationId);
  for (const grant of grants) await env.OAUTH_PROVIDER.revokeGrant(grant.id, signed.userId);
  const delegationRevoked = await revokeDelegation(env, signed.session, delegationId, requestId);
  return successResponse<ConnectDisconnectResponse>({ revokedGrants: grants.length, delegationRevoked }, requestId);
}

/** The person's grants that match, across every page. */
async function grantsOf(env: ProviderEnv, userId: string, match: (g: GrantSummary) => boolean): Promise<GrantSummary[]> {
  const out: GrantSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await env.OAUTH_PROVIDER.listUserGrants(userId, { limit: 100, ...(cursor ? { cursor } : {}) });
    out.push(...result.items.filter(match));
    if (!result.cursor) break;
    cursor = result.cursor;
  }
  return out;
}

