import { createSqlExecutor } from "@saas/db/d1";
import { createKitchenRepository, type KitchenRepository } from "@saas/db/kitchen";
import type { RequestContext } from "./context.js";
import { unavailable } from "./http.js";

/**
 * Run `fn` with a kitchen repository over the request's D1 binding. A missing
 * binding or anything `fn` throws is a 503; the executor is always disposed.
 */
export async function withKitchenRepo(
  ctx: Pick<RequestContext, "env" | "requestId">,
  fn: (repo: KitchenRepository) => Promise<Response>,
): Promise<Response> {
  if (!ctx.env.PLATFORM_DB) return unavailable(ctx.requestId);
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB);
  try {
    return await fn(createKitchenRepository(executor));
  } catch {
    return unavailable(ctx.requestId);
  } finally {
    await executor.dispose();
  }
}
