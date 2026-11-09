// mcp-worker (Cookpool, epic cookpool-mcp: MC-3, design §2).
//
// One Worker that is both an OAuth 2.1 authorization server and the MCP
// resource it protects, through @cloudflare/workers-oauth-provider:
//
//   GET  /.well-known/oauth-authorization-server     RFC 8414 metadata             (provider)
//   GET  /.well-known/oauth-protected-resource/mcp   RFC 9728 metadata             (provider)
//   POST /register                                   dynamic client registration   (provider)
//   POST /token                                      code and refresh exchange, revocation (provider)
//   GET  /authorize                                  PKCE S256 required → the console's /connect (connect.ts)
//   *    /connect/*                                  the console's hand-off, CORS for CONSOLE_ORIGIN only (connect.ts)
//   POST /mcp                                        MCP, Streamable HTTP, stateless, bearer required (mcp.ts)
//   GET  /health
//
// Every URL the provider publishes is built from MCP_PUBLIC_ORIGIN, the
// worker's workers.dev host until the owner attaches a custom domain.

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { ASSISTANT_SCOPES } from "@saas/contracts/mcp-connect";
import { handleAuthorize, handleConnect } from "./connect.js";
import type { Env, ProviderEnv } from "./env.js";
import { errorResponse, requestIdOf } from "./http.js";
import { mcpHandler } from "./mcp.js";
import { onTokenExchange } from "./refresh.js";

const DAY = 24 * 60 * 60;

/** A grant lives 30 days from connecting, and slides 30 days on each refresh: it ends once the assistant stops using it. */
export const GRANT_TTL_SECONDS = 30 * DAY;
export const GRANT_IDLE_TTL_SECONDS = 30 * DAY;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const providers = new Map<string, OAuthProvider<Env>>();

/** The provider for this deployment, built once per isolate (its options hold the public origin). */
export function providerFor(env: Env): OAuthProvider<Env> {
  const origin = env.MCP_PUBLIC_ORIGIN.replace(/\/+$/, "");
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: `${origin}/mcp`,
      apiHandler: mcpHandler as never,
      defaultHandler: { fetch: defaultFetch as never },
      authorizeEndpoint: `${origin}/authorize`,
      tokenEndpoint: `${origin}/token`,
      clientRegistrationEndpoint: `${origin}/register`,
      scopesSupported: [...ASSISTANT_SCOPES],
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_name: "Cookpool",
      },
      // ChatGPT and other current clients identify themselves by a metadata document URL.
      clientIdMetadataDocumentEnabled: true,
      accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTTL: GRANT_TTL_SECONDS,
      refreshTokenIdleTTL: GRANT_IDLE_TTL_SECONDS,
      tokenExchangeCallback: onTokenExchange,
    });
    providers.set(origin, provider);
  }
  return provider;
}

/** The library reads its store as OAUTH_KV; ours is MCP_OAUTH_KV (design §2). */
function providerEnv(env: Env): Env {
  return { ...env, OAUTH_KV: env.MCP_OAUTH_KV } as Env;
}

const CONNECT_PREFIX = "/connect/";

function isConnectPath(pathname: string): boolean {
  return pathname.startsWith(CONNECT_PREFIX);
}

/** CORS for /connect/* only, and only for the console's origin. */
function connectCors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get("origin");
  if (!origin || origin !== env.CONSOLE_ORIGIN) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, content-type, x-request-id");
  headers.set("access-control-max-age", "600");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Everything the provider does not own: /authorize, /connect/*, /health. */
async function defaultFetch(request: Request, env: ProviderEnv): Promise<Response> {
  const url = new URL(request.url);
  const requestId = requestIdOf(request);
  if (url.pathname === "/authorize") return handleAuthorize(request, env);
  if (isConnectPath(url.pathname)) return handleConnect(request, env, requestId, url.pathname);
  if (url.pathname === "/health" && request.method === "GET") {
    return Response.json({
      status: "ok",
      service: "mcp-worker",
      environment: env.ENVIRONMENT ?? "local",
      timestamp: new Date().toISOString(),
      checks: { oauthKv: { configured: !!env.MCP_OAUTH_KV }, apiEdge: { configured: !!env.API_EDGE } },
    });
  }
  return errorResponse("not_found", `Route not found: ${url.pathname}`, 404, requestId);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (isConnectPath(url.pathname)) {
      const origin = request.headers.get("origin");
      if (request.method === "OPTIONS") return connectCors(request, env, new Response(null, { status: 204 }));
      // A browser on any other origin is refused outright; callers without an Origin (none are browsers) go on.
      if (origin && origin !== env.CONSOLE_ORIGIN) {
        return errorResponse("forbidden", "Not allowed from this origin", 403, requestIdOf(request), { reason: "origin" });
      }
      const response = await providerFor(env).fetch(request, providerEnv(env), ctx);
      return connectCors(request, env, response);
    }
    return providerFor(env).fetch(request, providerEnv(env), ctx);
  },
} satisfies ExportedHandler<Env>;
