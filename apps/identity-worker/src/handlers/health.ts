import type { Env } from "../env.js";
import { createD1Adapter } from "@saas/db/d1";
import { parseDebugDeliveryDomains } from "../debug-delivery.js";

export async function handleHealth(env: Env, requestId: string): Promise<Response> {
  const dbCheck = await checkDatabase(env);
  // Which addresses get their sign-in code on screen (SI-2): `["*"]` for all,
  // the listed domains, or none (`enabled: false`).
  const { all, domains } = parseDebugDeliveryDomains(env.DEBUG_DELIVERY_DOMAINS);
  const debugDelivery = { enabled: all || domains.length > 0, domains: all ? ["*"] : domains };

  const status = !dbCheck.configured ? "ok" : dbCheck.reachable ? "ok" : "degraded";
  const code = status === "ok" ? 200 : 503;

  return Response.json(
    {
      data: {
        status,
        service: "identity-worker",
        environment: env.ENVIRONMENT ?? "local",
        timestamp: new Date().toISOString(),
        checks: {
          database: dbCheck,
          debugDelivery,
        },
      },
      meta: { requestId, cursor: null },
    },
    { status: code },
  );
}

async function checkDatabase(env: Env): Promise<{ configured: boolean; reachable: boolean }> {
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
