import { createD1Adapter } from "@saas/db/d1";
import type { HealthStatus } from "@saas/contracts/health";
import type { Env } from "./env";
import { resolveRequestId, notFound } from "./http";
import { handlePreflight, applyCorsHeaders } from "./cors";
import { isAuthRoute, handleAuthRoute } from "./auth-facade";
import { isOrgRoute, handleOrgRoute } from "./org-facade";
import { isProjectRoute, handleProjectRoute } from "./project-facade";
import { isAuditRoute, handleAuditRoute } from "./audit-facade";
import { isConfigRoute, handleConfigRoute } from "./config-facade";
import { isWebhooksRoute, handleWebhooksRoute } from "./webhooks-facade";
import { isMeteringRoute, handleMeteringRoute } from "./metering-facade";
import { isBillingRoute, handleBillingRoute } from "./billing-facade";
import { isBillingWebhookRoute, handleBillingWebhookRoute } from "./billing-webhooks-facade";
import { isNotificationsRoute, handleNotificationsRoute } from "./notifications-facade";
import {
  isIntegrationsRoute,
  isIntegrationsIngressRoute,
  handleIntegrationsRoute,
  handleIntegrationsIngressRoute,
} from "./integrations-facade";
import { isKitchenRoute, handleKitchenRoute } from "./kitchen-facade";
import { isSplitecoRoute, handleSplitecoRoute } from "./spliteco-facade";
import { isTripecoRoute, handleTripecoRoute } from "./tripeco-facade";
import { isJoinPreviewRoute, handleJoinPreviewRoute } from "./join-preview-facade";
import { isSoloMode, isSoloSuppressed } from "./solo-mode";
import { withTrustedClientIp, type ClientIpSource } from "./client-ip";
import { hasDelegatedBearer, isDelegationRoute, scopeRefused } from "./delegation-scopes";
import { resolveActor } from "./resolve-actor";

// Durable Object class backing the PERF5 Stage B rate-limit counters. Must be
// exported from the Worker entry so the runtime can instantiate it for the
// `RATE_LIMITER_DO` binding.
export { RateLimiterDO } from "./rate-limit-do";

export default {
  async fetch(incoming: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    // The client's address, once, before anything reads it: Cloudflare's
    // CF-Connecting-IP from the internet, the console's forwarded one over its
    // service binding (ctx.props), and never a client's own (./client-ip.ts).
    const { request, source: clientIpSource } = withTrustedClientIp(incoming, ctx?.props);

    const preflight = handlePreflight(request, env);
    if (preflight) return preflight;

    const url = new URL(request.url);
    const requestId = resolveRequestId(request);

    let response: Response;

    // Assistants (cookpool-mcp MC-2): a delegated token reaches only the
    // allowlisted methods and paths (./delegation-scopes.ts). Anything else is
    // refused here, before any facade — the auth routes included — sees it;
    // an allowlisted one is resolved and held to its own scopes before the
    // facade's idempotency replay can answer from a stored response.
    let delegatedRefusal: Response | null = null;
    if (url.pathname !== "/health" && hasDelegatedBearer(request)) {
      if (!isDelegationRoute(request.method, url.pathname)) {
        delegatedRefusal = scopeRefused(requestId);
      } else {
        const actor = await resolveActor(request, env, requestId);
        if ("error" in actor) delegatedRefusal = actor.error;
      }
    }

    if (delegatedRefusal) {
      response = delegatedRefusal;
    } else if (url.pathname === "/health") {
      response = await handleHealth(env, clientIpSource);
    } else if (isSoloMode(env) && isSoloSuppressed(url.pathname, request.method)) {
      // M0 / Solo profile: org/team/project and platform-plumbing surfaces are
      // hidden. Suppress at the edge before any facade dispatch — the route
      // reads as "not found" to the single-user surface. Flip SOLO_MODE off and
      // this branch is dead, restoring the full baseline. (See ./solo-mode.ts.)
      response = notFound(requestId, url.pathname);
    } else if (isAuthRoute(url.pathname)) {
      response = await handleAuthRoute(request, env, requestId, url.pathname);
    } else if (isAuditRoute(url.pathname)) {
      response = await handleAuditRoute(request, env, requestId, url.pathname);
    } else if (isConfigRoute(url.pathname)) {
      response = await handleConfigRoute(request, env, requestId, url.pathname);
    } else if (isIntegrationsIngressRoute(url.pathname)) {
      // Public install-callback ingress (no session) — authenticated by the
      // signed single-use state verified in integrations-worker.
      response = await handleIntegrationsIngressRoute(request, env, requestId, url.pathname);
    } else if (isIntegrationsRoute(url.pathname)) {
      response = await handleIntegrationsRoute(request, env, requestId, url.pathname);
    } else if (isBillingWebhookRoute(url.pathname)) {
      // Public inbound provider webhook (no session) — matched before the
      // authenticated webhooks/billing facades.
      response = await handleBillingWebhookRoute(request, env, requestId, url.pathname);
    } else if (isWebhooksRoute(url.pathname)) {
      response = await handleWebhooksRoute(request, env, requestId, url.pathname);
    } else if (isNotificationsRoute(url.pathname)) {
      response = await handleNotificationsRoute(request, env, requestId, url.pathname);
    } else if (isMeteringRoute(url.pathname)) {
      response = await handleMeteringRoute(request, env, requestId, url.pathname);
    } else if (isBillingRoute(url.pathname)) {
      response = await handleBillingRoute(request, env, requestId, url.pathname);
    } else if (isJoinPreviewRoute(url.pathname)) {
      // The signed-out join preview (Cookpool SI-4): GET /v1/join/{code}/preview
      // and only that exact shape, WITHOUT a session, behind the per-IP
      // `join_preview` rate limit. Every other /v1/join… route is the org
      // facade's below and still resolves a session (./join-preview-facade.ts).
      response = await handleJoinPreviewRoute(request, env, requestId, url.pathname);
    } else if (isKitchenRoute(url.pathname)) {
      // Cookpool's kitchen (CP-4): matched before the project and org facades,
      // which own other sub-resources of /v1/organizations/{org}.
      response = await handleKitchenRoute(request, env, requestId, url.pathname);
    } else if (isSplitecoRoute(url.pathname)) {
      // Spliteco (cookpool-spliteco SE1): its own prefix, nothing else owns it.
      response = await handleSplitecoRoute(request, env, requestId, url.pathname);
    } else if (isTripecoRoute(url.pathname)) {
      // Tripeco (tripeco TR-2): its own prefix, nothing else owns it.
      response = await handleTripecoRoute(request, env, requestId, url.pathname);
    } else if (isProjectRoute(url.pathname)) {
      response = await handleProjectRoute(request, env, requestId, url.pathname);
    } else if (isOrgRoute(url.pathname)) {
      response = await handleOrgRoute(request, env, requestId, url.pathname);
    } else {
      response = notFound(requestId, url.pathname);
    }

    return applyCorsHeaders(response, request, env);
  },
} satisfies ExportedHandler<Env>;

async function handleHealth(env: Env, clientIpSource: ClientIpSource): Promise<Response> {
  const db = await checkDatabase(env);
  const identity = checkIdentityBinding(env);
  const membership = checkMembershipBinding(env);

  const status: HealthStatus = !db.configured
    ? "ok"
    : db.reachable
      ? "ok"
      : "degraded";

  const code = status === "ok" ? 200 : 503;

  return Response.json(
    {
      status,
      service: "api-edge",
      environment: env.ENVIRONMENT ?? "local",
      timestamp: new Date().toISOString(),
      // `clientIp.source` says which address the rate limits would key this
      // request on: "cloudflare" from the internet, "console" over the
      // console's binding (`/api/health` on the app's address; the console's
      // deploy smoke requires it), "none" when there is none to trust.
      checks: { database: db, identity, membership, clientIp: { source: clientIpSource } },
    },
    { status: code },
  );
}

function checkIdentityBinding(env: Env): { configured: boolean } {
  return { configured: !!env.IDENTITY_WORKER };
}

function checkMembershipBinding(env: Env): { configured: boolean } {
  return { configured: !!env.MEMBERSHIP_WORKER };
}

async function checkDatabase(
  env: Env,
): Promise<{ configured: boolean; reachable: boolean }> {
  if (!env.PLATFORM_DB) {
    return { configured: false, reachable: false };
  }

  const adapter = createD1Adapter(env.PLATFORM_DB);
  try {
    return await adapter.ping();
  } finally {
    await adapter.dispose();
  }
}
