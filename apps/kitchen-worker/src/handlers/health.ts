import { createSqlExecutor } from "@saas/db/d1";
import { createKitchenRepository, type KitchenSweepRecord } from "@saas/db/kitchen";
import type { Env } from "../env.js";
import { successResponse } from "../http.js";

/**
 * The latest run of the daily sweep (CP-18): a scheduled() without a trigger
 * never runs and says nothing (risks CP-N), so /health shows when it last
 * did. Null when it never ran, or the database cannot be read — health
 * itself never fails on it.
 */
async function lastSweep(env: Env): Promise<KitchenSweepRecord | null> {
  if (!env.PLATFORM_DB) return null;
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const found = await createKitchenRepository(executor).lastSweep();
    return found.ok ? found.value : null;
  } catch {
    return null;
  } finally {
    await executor.dispose();
  }
}

export async function handleHealth(env: Env, requestId: string): Promise<Response> {
  const sweep = await lastSweep(env);
  return successResponse(
    {
      status: "ok",
      service: "kitchen-worker",
      environment: env.ENVIRONMENT ?? "local",
      timestamp: new Date().toISOString(),
      lastSweepAt: sweep ? sweep.finishedAt.toISOString() : null,
      lastSweep: sweep
        ? { date: sweep.date, items: sweep.items, people: sweep.people, sent: sweep.sent, failed: sweep.failed, runs: sweep.runs }
        : null,
      checks: {
        database: { configured: !!env.PLATFORM_DB },
        membership: { configured: !!env.MEMBERSHIP_WORKER },
        policy: { configured: !!env.POLICY_WORKER },
        notifications: { configured: !!env.NOTIFICATIONS_WORKER },
      },
    },
    requestId,
  );
}
