import type { AiOdometerMode, AiOdometerResponse } from "@saas/contracts/kitchen";
import type { RequestContext } from "../context.js";
import { readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { readPhoto } from "../ai/photo.js";
import { aiProviderFor } from "../ai/provider.js";
import { aiEscalate, runAiTask } from "../ai/runner.js";
import { ODOMETER_TASK } from "../ai/odometer-task.js";
import { aiBudgetReached, aiBudgetSpent, aiFailed, aiToday, aiUnavailable, overLimit, recordAiAction, withAiRepos } from "../ai/usage.js";

// Odometers (tripeco TR-4, design §4):
//
//   POST /v1/kitchen/me/ai/odometer   self: { image, mode? } → AiOdometerResponse; writes nothing
//
// The receipt reader's order: 503 `ai_unavailable` without a key; 422 on a
// bad photo; 429 at today's actions or receipts (a read counts as a receipt);
// 503 `budget` once this month's budget is spent; then the model reads it.
// The image is held in this request only and never stored or logged here.

export async function handleAiOdometer(ctx: RequestContext, request: Request): Promise<Response> {
  const provider = aiProviderFor(ctx);
  if (!provider) return aiUnavailable(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const photo = readPhoto(body.image);
  if (!photo.ok) return validationError(ctx.requestId, { image: photo.errors });
  if (body.mode !== undefined && body.mode !== "odo" && body.mode !== "trip") return validationError(ctx.requestId, { mode: ["Must be odo or trip"] });
  const mode: AiOdometerMode = body.mode === "trip" ? "trip" : "odo";

  return withAiRepos(ctx, async ({ usage }) => {
    const today = await aiToday(ctx, usage);
    if (!today) return unavailable(ctx.requestId);
    const limited = overLimit(ctx.requestId, "actions", today, ctx.now()) ?? overLimit(ctx.requestId, "receipts", today, ctx.now());
    if (limited) return limited;
    if (await aiBudgetReached(ctx, usage)) return aiBudgetSpent(ctx.requestId, ctx.now());
    const result = await ctx.timings.measure("ai", () =>
      runAiTask(provider, ODOMETER_TASK, { image: photo.image, mediaType: photo.mediaType, mode }, { escalate: aiEscalate(ctx.env) }),
    );
    await recordAiAction(ctx, usage, ODOMETER_TASK.feature, result);
    if (!result.ok) return aiFailed(ctx.requestId);
    return successResponse<AiOdometerResponse>(result.data, ctx.requestId);
  });
}
