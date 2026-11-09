import { AI_RECIPE_PHOTO_MAX_BYTES, type AiRecipePhotoResponse } from "@saas/contracts/kitchen";
import type { RequestContext } from "../context.js";
import { readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { readPhoto } from "../ai/photo.js";
import { aiProviderFor } from "../ai/provider.js";
import { RECIPE_PHOTO_TASK } from "../ai/recipe-photo-task.js";
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

// Recipe from a photo (cookpool-ai AI-4, design §4):
//
//   POST /v1/kitchen/me/ai/recipe-photo   self: { image } → { draft, checks }; writes nothing
//
// In order: 503 `ai_unavailable` without a key; 422 on a bad photo (not a
// base64 JPEG or WebP, or over 1.5 MB decoded — AI-3's own check); 429 at
// today's 50 actions (`ai_daily_limit`); 503 `budget` once this month's AI
// budget is spent (AI-13); the model reads the photo (Haiku, thinking off;
// one Sonnet retry on a failed check only with AI_ESCALATE on — else the
// mended draft with its checks, or 502 `ai_failed` when nothing usable was
// read); the food list is looked up for the lines in ONE read (AI-3's
// matchFoods). One action is counted (feature `recipe_import`), with its cost.
//
// Nothing is saved: the console opens the recipe form prefilled and saves
// through POST /v1/kitchen/me/recipes. The image is held in this request
// only, sent to the model and dropped: it is never stored, logged, or written
// to the usage row.

export async function handleAiRecipePhoto(ctx: RequestContext, request: Request): Promise<Response> {
  const provider = aiProviderFor(ctx);
  if (!provider) return aiUnavailable(ctx.requestId);

  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const photo = readPhoto(body.image, AI_RECIPE_PHOTO_MAX_BYTES);
  if (!photo.ok) return validationError(ctx.requestId, { image: photo.errors });

  return withAiRepos(ctx, async ({ usage, kitchen }) => {
    const today = await aiToday(ctx, usage);
    if (!today) return unavailable(ctx.requestId);
    const limited = overLimit(ctx.requestId, "actions", today, ctx.now());
    if (limited) return limited;
    if (await aiBudgetReached(ctx, usage)) return aiBudgetSpent(ctx.requestId, ctx.now());

    const result = await ctx.timings.measure("ai", () =>
      runAiTask(provider, RECIPE_PHOTO_TASK, { image: photo.image, mediaType: photo.mediaType }, { escalate: aiEscalate(ctx.env) }),
    );
    await recordAiAction(ctx, usage, RECIPE_PHOTO_TASK.feature, result);
    if (!result.ok) return aiFailed(ctx.requestId);
    const { draft, checks, foods: names } = result.data;

    // Each line's food: its plain ingredient name first ("Onions"), else the line as written.
    const foods = await ctx.timings.measure("db", () => kitchen.matchFoods([...names, ...draft.lines.map((l) => l.name)]));
    if (!foods.ok) return unavailable(ctx.requestId);
    const lines = draft.lines.map((line, i) => ({
      ...line,
      foodKey: foods.value.get(names[i] ?? "")?.key ?? foods.value.get(line.name)?.key ?? null,
    }));

    return successResponse<AiRecipePhotoResponse>({ draft: { ...draft, lines }, checks }, ctx.requestId);
  });
}
