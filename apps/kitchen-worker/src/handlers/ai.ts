import {
  AI_DAILY_ACTIONS,
  AI_DAILY_RECEIPTS,
  AI_DAILY_VOICE_SECONDS,
  AI_USES_TEXT_MAX,
  type AiStatus,
  type AiUsesResponse,
} from "@saas/contracts/kitchen";
import type { RequestContext } from "../context.js";
import { readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { aiAvailable, aiProviderFor } from "../ai/provider.js";
import { aiEscalate, runAiTask } from "../ai/runner.js";
import {
  aiBudgetReached,
  aiBudgetSpent,
  aiFailed,
  aiToday,
  aiUnavailable,
  overLimit,
  recordAiAction,
  withAiRepos,
} from "../ai/usage.js";
import { readUsesContext } from "../ai/uses-context.js";
import { USES_TASK } from "../ai/uses-task.js";

// Cookpool AI (cookpool-ai AI-2, design §1, §2):
//
//   GET  /v1/kitchen/me/ai        self: is AI set up, which features, today's use
//   POST /v1/kitchen/me/ai/uses   self: { text } → { lines, unsure }; writes nothing
//
// The caller's own routes, like their personal pantry: checked against their
// subject, never the policy engine. An AI route answers, in order: 503
// `ai_unavailable` without a key, 422 on a bad body, 429 at today's limit,
// 503 `budget` once this month's AI budget is spent (AI-13), then calls the
// model; a refusal, an error or a failed check with no retry left is 502
// `ai_failed`. Every model call is counted in kitchen_ai_usage, with its cost.

/** What this server offers now, when it has a key. AI-3…AI-6 turn theirs on. */
const SERVER_FEATURES = { sayIt: true, receipt: true, import: false, voice: false, swaps: false } as const;

export async function handleAiStatus(ctx: RequestContext): Promise<Response> {
  const keyed = aiAvailable(ctx.env);
  return withAiRepos(ctx, async ({ usage }) => {
    const today = await aiToday(ctx, usage);
    if (!today) return unavailable(ctx.requestId);
    // The month's budget (AI-13): read even without a key, so the state is always told.
    const reached = await aiBudgetReached(ctx, usage);
    const available = keyed && !reached;
    const features = Object.fromEntries(
      Object.entries(SERVER_FEATURES).map(([key, on]) => [key, available && on]),
    ) as AiStatus["features"];
    return successResponse<AiStatus>(
      {
        available,
        features,
        budget: reached ? "reached" : "ok",
        today: {
          actions: today.actions,
          actionsLimit: AI_DAILY_ACTIONS,
          voiceSeconds: today.voiceSeconds,
          voiceSecondsLimit: AI_DAILY_VOICE_SECONDS,
          receipts: today.receipts,
          receiptsLimit: AI_DAILY_RECEIPTS,
        },
      },
      ctx.requestId,
    );
  });
}

export async function handleAiUses(ctx: RequestContext, request: Request): Promise<Response> {
  const provider = aiProviderFor(ctx);
  if (!provider) return aiUnavailable(ctx.requestId);

  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length === 0 || text.length > AI_USES_TEXT_MAX) {
    return validationError(ctx.requestId, { text: [`Must be 1 to ${AI_USES_TEXT_MAX} characters`] });
  }

  return withAiRepos(ctx, async ({ usage, kitchen }) => {
    const today = await aiToday(ctx, usage);
    if (!today) return unavailable(ctx.requestId);
    const limited = overLimit(ctx.requestId, "actions", today, ctx.now());
    if (limited) return limited;
    if (await aiBudgetReached(ctx, usage)) return aiBudgetSpent(ctx.requestId, ctx.now());

    const read = await readUsesContext(ctx, kitchen, text);
    if (!read.ok) return unavailable(ctx.requestId);
    // Nothing to use: no model call, and no action counted.
    if (read.input.items.length === 0) return successResponse<AiUsesResponse>({ lines: [], unsure: [] }, ctx.requestId);

    const result = await ctx.timings.measure("ai", () => runAiTask(provider, USES_TASK, read.input, { escalate: aiEscalate(ctx.env) }));
    await recordAiAction(ctx, usage, USES_TASK.feature, result);
    if (!result.ok) return aiFailed(ctx.requestId);
    return successResponse<AiUsesResponse>(result.data, ctx.requestId);
  });
}
