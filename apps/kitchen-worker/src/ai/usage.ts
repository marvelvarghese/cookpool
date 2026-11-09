import {
  AI_DAILY_ACTIONS,
  AI_DAILY_RECEIPTS,
  AI_DAILY_VOICE_SECONDS,
  AI_MONTHLY_BUDGET_USD_DEFAULT,
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
//
// Cost guardrails (AI-13): receipts have their own cap of AI_DAILY_RECEIPTS
// a day (inside the 50), every row records its estimated cost_micros, and
// before any model call the month's cost across everyone is summed: at or
// over AI_MONTHLY_BUDGET_USD (default 5) AI answers 503 `budget` until the
// 1st, UTC. A budget that cannot be read counts as reached — never open.

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

export type AiLimitKind = "actions" | "voice" | "receipts";

const LIMITS: Record<AiLimitKind, { limit: number; used: (t: KitchenAiUsageTotals) => number; message: string; reason: string }> = {
  actions: {
    limit: AI_DAILY_ACTIONS,
    used: (t) => t.actions,
    message: "That's today's AI: it comes back at midnight UTC",
    reason: KITCHEN_AI_ERROR_REASONS.AI_DAILY_LIMIT,
  },
  voice: {
    limit: AI_DAILY_VOICE_SECONDS,
    used: (t) => t.voiceSeconds,
    message: "That's today's voice minutes: they come back at midnight UTC",
    reason: KITCHEN_AI_ERROR_REASONS.VOICE_DAILY_LIMIT,
  },
  receipts: {
    limit: AI_DAILY_RECEIPTS,
    used: (t) => t.receipts,
    message: "That's today's receipts: they come back at midnight UTC",
    reason: KITCHEN_AI_ERROR_REASONS.RECEIPT_DAILY_LIMIT,
  },
};

/** 429 `rate_limited` when today's use has reached the limit of `kind`; null while there is room. */
export function overLimit(requestId: string, kind: AiLimitKind, today: KitchenAiUsageTotals, now: Date): Response | null {
  const { limit, used: usedOf, message, reason } = LIMITS[kind];
  const used = usedOf(today);
  if (used < limit) return null;
  return errorResponse("rate_limited", message, 429, requestId, {
    reason,
    limit,
    used,
    resetsAt: utcDay(now).to.toISOString(),
  });
}

/** The UTC month `now` falls in: [from, to). */
export function utcMonth(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** The month's budget in micro-dollars: AI_MONTHLY_BUDGET_USD, else the default when unset or not a number ≥ 0. */
export function aiMonthlyBudgetMicros(env: { AI_MONTHLY_BUDGET_USD?: string | undefined }): number {
  const raw = env.AI_MONTHLY_BUDGET_USD?.trim() ?? "";
  const usd = raw === "" ? Number.NaN : Number(raw);
  return Math.round((Number.isFinite(usd) && usd >= 0 ? usd : AI_MONTHLY_BUDGET_USD_DEFAULT) * 1_000_000);
}

/**
 * Has this month's AI cost, across everyone, reached the budget? One read
 * over kitchen_ai_usage_created_idx. A read that fails counts as reached —
 * and is logged — so a broken read never opens the gate.
 */
export async function aiBudgetReached(ctx: RequestContext, usage: AiUsageRepository): Promise<boolean> {
  const { from, to } = utcMonth(ctx.now());
  const read = await ctx.timings.measure("db", () => usage.aiCostBetween(from, to));
  if (!read.ok) {
    console.warn(`[kitchen-worker] ai budget unreadable, AI held off: ${ctx.requestId}`);
    return true;
  }
  return read.value >= aiMonthlyBudgetMicros(ctx.env);
}

/** 503 `internal_error`, `budget`: this month's AI budget is spent; AI comes back on the 1st, UTC. */
export function aiBudgetSpent(requestId: string, now: Date): Response {
  return errorResponse("internal_error", "AI is off for the rest of the month: log it by hand", 503, requestId, {
    reason: KITCHEN_AI_ERROR_REASONS.BUDGET,
    resetsAt: utcMonth(now).to.toISOString(),
  });
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
      costMicros: Math.round(result.usage.costMicros),
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
