import {
  AI_DAILY_ACTIONS,
  AI_DAILY_VOICE_SECONDS,
  KITCHEN_AI_ERROR_REASONS,
} from "@saas/contracts/kitchen";
import { createSqlExecutor } from "@saas/db/d1";
import {
  createAiUsageRepository,
  createKitchenRepository,
  createPurchasesRepository,
  type AiUsageRepository,
  type KitchenAiUsageFeature,
  type KitchenAiUsageTotals,
  type KitchenRepository,
  type PurchasesRepository,
} from "@saas/db/kitchen";
import type { RequestContext } from "../context.js";
import { errorResponse, unavailable } from "../http.js";
import type { AiRunResult } from "./runner.js";

// Limits and usage (Cookpool AI, AI-2, design §1). Per person per UTC day:
// AI_DAILY_ACTIONS actions across the text and image features, and
// AI_DAILY_VOICE_SECONDS of transcription — counted from kitchen_ai_usage,
// where every action writes one row, failed ones included (they were paid
// for). The check runs before the model is called; two requests at once can
// each pass at the last action and both run, so a person may end a day one or
// two actions over: a soft cap on spend, not a ledger.

const DAY_MS = 86_400_000;

/** The UTC day `now` falls in: [from, to). */
export function utcDay(now: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** 503 `internal_error`, `ai_unavailable`: the server has no key. */
export function aiUnavailable(requestId: string): Response {
  return errorResponse("internal_error", "AI isn't set up on this server", 503, requestId, {
    reason: KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE,
  });
}

/** 502 `internal_error`, `ai_failed`: the model refused, erred or answered badly twice. Never an answer. */
export function aiFailed(requestId: string): Response {
  return errorResponse("internal_error", "AI couldn't read that: try again, or log it by hand", 502, requestId, {
    reason: KITCHEN_AI_ERROR_REASONS.AI_FAILED,
  });
}

export type AiLimitKind = "actions" | "voice";

/** 429 `rate_limited` when today's use has reached the limit of `kind`; null while there is room. */
export function overLimit(requestId: string, kind: AiLimitKind, today: KitchenAiUsageTotals, now: Date): Response | null {
  const limit = kind === "actions" ? AI_DAILY_ACTIONS : AI_DAILY_VOICE_SECONDS;
  const used = kind === "actions" ? today.actions : today.voiceSeconds;
  if (used < limit) return null;
  const voice = kind === "voice";
  return errorResponse(
    "rate_limited",
    voice ? "That's today's voice minutes: they come back at midnight UTC" : "That's today's AI: it comes back at midnight UTC",
    429,
    requestId,
    {
      reason: voice ? KITCHEN_AI_ERROR_REASONS.VOICE_DAILY_LIMIT : KITCHEN_AI_ERROR_REASONS.AI_DAILY_LIMIT,
      limit,
      used,
      resetsAt: utcDay(now).to.toISOString(),
    },
  );
}

/** The caller's use today; null when it could not be read. */
export async function aiToday(ctx: RequestContext, usage: AiUsageRepository): Promise<KitchenAiUsageTotals | null> {
  const { from, to } = utcDay(ctx.now());
  const read = await ctx.timings.measure("db", () => usage.aiUsageBetween(ctx.actor.subjectId, from, to));
  return read.ok ? read.value : null;
}

/**
 * Write the action's row. Best-effort: the answer was paid for and is
 * returned even if the row cannot be written (the day's count then misses it).
 */
export async function recordAiAction(
  ctx: RequestContext,
  usage: AiUsageRepository,
  feature: KitchenAiUsageFeature,
  result: Pick<AiRunResult<unknown>, "ok" | "model" | "usage">,
  audioSeconds = 0,
): Promise<void> {
  await ctx.timings.measure("db", () =>
    usage.recordAiUsage({
      id: crypto.randomUUID(),
      userId: ctx.actor.subjectId,
      feature,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      cachedTokens: result.usage.cachedTokens,
      outputTokens: result.usage.outputTokens,
      audioSeconds,
      ok: result.ok,
      now: ctx.now(),
    }),
  );
}

export interface AiRepos {
  usage: AiUsageRepository;
  kitchen: KitchenRepository;
  /** The restock read (AI-3's receipt matching). */
  purchases: PurchasesRepository;
}

/** Run `fn` with the usage and kitchen repositories over one executor. A missing binding or a throw is a 503. */
export async function withAiRepos(ctx: RequestContext, fn: (repos: AiRepos) => Promise<Response>): Promise<Response> {
  if (!ctx.env.PLATFORM_DB) return unavailable(ctx.requestId);
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB);
  try {
    return await fn({
      usage: createAiUsageRepository(executor),
      kitchen: createKitchenRepository(executor),
      purchases: createPurchasesRepository(executor),
    });
  } catch {
    return unavailable(ctx.requestId);
  } finally {
    await executor.dispose();
  }
}
