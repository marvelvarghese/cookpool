import {
  AI_ASK_STEP_QUESTION_MAX,
  AI_RESCUE_PROBLEMS,
  AI_RESCUE_TEXT_MAX,
  AI_TRANSCRIBE_MODEL,
  aiAudioCostMicros,
  type AiAskStepResponse,
  type AiCheckStepResponse,
  type AiRescueProblem,
  type AiRescueResponse,
  type AiTranscribeResponse,
} from "@saas/contracts/kitchen";
import type { RequestContext } from "../context.js";
import { readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { Fields } from "../validate.js";
import { aiProviderFor } from "../ai/provider.js";
import { aiEscalate, runAiTask, type AiTask } from "../ai/runner.js";
import { readStoveRef, stoveContext, type StoveContext } from "../ai/stove-context.js";
import { ASK_STEP_TASK, CHECK_STEP_TASK, RESCUE_TASK, type Photo } from "../ai/stove-tasks.js";
import { countedSeconds, readClip, transcribe } from "../ai/transcribe.js";
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
import { readPhoto } from "../ai/photo.js";
import { visibleRecipe } from "./recipes.js";

// Voice and help at the stove (cookpool-ai AI-5, design §5, §5a):
//
//   POST /v1/kitchen/me/ai/transcribe?seconds=   audio body → { text }
//   POST /v1/kitchen/me/ai/ask-step     { recipeId, factor?, stepKey, code?, question } → { answer }
//   POST /v1/kitchen/me/ai/check-step   { recipeId, factor?, stepKey, code?, image } → { verdict, say, problem? }
//   POST /v1/kitchen/me/ai/rescue       { recipeId, factor?, stepKey, code?, problem, text?, image? } → { title, steps, say }
//
// The caller's own routes, writing nothing but a usage row. In order:
//   transcribe: 503 `ai_unavailable` without the AI binding (before the body
//     is read); 422 on `seconds` / `audio`; 429 `voice_daily_limit` at 30
//     minutes today; 503 `budget`; Whisper; one row counting the clip's
//     seconds (the longer of `?seconds=` and what Whisper heard), its cost at
//     the per-minute price. A failed run is 502 `ai_failed`, still counted.
//   the other three: 503 `ai_unavailable` without the key; 422 on the body
//     (the photo checked as a receipt's); 429 `ai_daily_limit` at 50 actions;
//     503 `budget`; the recipe the caller may see (else the opaque 404) and
//     its step (else 422 on `stepKey`); the model (Haiku; Sonnet once only
//     with AI_ESCALATE on); one action counted as `ask_step`.
//
// Audio and photos are held in the request only: never stored, logged, or
// written to usage, audit or any table.

export async function handleAiTranscribe(ctx: RequestContext, request: Request): Promise<Response> {
  const ai = ctx.env.AI;
  if (!ai || typeof ai.run !== "function") return aiUnavailable(ctx.requestId);

  const clip = await readClip(request);
  if (!clip.ok) return validationError(ctx.requestId, clip.fields);

  return withAiRepos(ctx, async ({ usage }) => {
    const today = await aiToday(ctx, usage);
    if (!today) return unavailable(ctx.requestId);
    const limited = overLimit(ctx.requestId, "voice", today, ctx.now());
    if (limited) return limited;
    if (await aiBudgetReached(ctx, usage)) return aiBudgetSpent(ctx.requestId, ctx.now());

    const heard = await ctx.timings.measure("ai", () => transcribe(ai, clip));
    const seconds = countedSeconds(clip.seconds, heard.ok ? heard.seconds : null);
    await recordAiAction(
      ctx,
      usage,
      "transcribe",
      {
        ok: heard.ok,
        model: AI_TRANSCRIBE_MODEL,
        usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costMicros: aiAudioCostMicros(AI_TRANSCRIBE_MODEL, seconds) },
      },
      seconds,
    );
    if (!heard.ok) return aiFailed(ctx.requestId);
    return successResponse<AiTranscribeResponse>({ text: heard.text }, ctx.requestId);
  });
}

/** A photo field: the checked photo, or null when absent and `optional`; errors go into `fields`. */
function photoField(fields: Fields, raw: unknown, optional: boolean): Photo | null {
  if (optional && (raw === undefined || raw === null)) return null;
  const photo = readPhoto(raw);
  if (!photo.ok) {
    for (const error of photo.errors) fields.add("image", error);
    return null;
  }
  return { image: photo.image, mediaType: photo.mediaType };
}

/**
 * One stove request: the body (the step ref, then `extra`'s own fields), the
 * limits, the recipe and its step, then `task` on what `input` builds.
 */
async function stoveRoute<X, I, O>(
  ctx: RequestContext,
  request: Request,
  extra: (fields: Fields, body: Record<string, unknown>) => X,
  task: AiTask<I, O>,
  input: (stove: StoveContext, x: X) => I,
): Promise<Response> {
  const provider = aiProviderFor(ctx);
  if (!provider) return aiUnavailable(ctx.requestId);

  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const ref = readStoveRef(fields, body);
  const x = extra(fields, body);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);

  return withAiRepos(ctx, async ({ usage, kitchen }) => {
    const today = await aiToday(ctx, usage);
    if (!today) return unavailable(ctx.requestId);
    const limited = overLimit(ctx.requestId, "actions", today, ctx.now());
    if (limited) return limited;
    if (await aiBudgetReached(ctx, usage)) return aiBudgetSpent(ctx.requestId, ctx.now());

    const visible = await visibleRecipe(ctx, kitchen, ref.recipeId, ref.code);
    if (visible instanceof Response) return visible;
    const stove = stoveContext(visible.recipe, ref.factorMilli, ref.stepKey);
    if (!stove) return validationError(ctx.requestId, { stepKey: ["Not a step of this recipe"] });

    const result = await ctx.timings.measure("ai", () => runAiTask(provider, task, input(stove, x), { escalate: aiEscalate(ctx.env) }));
    await recordAiAction(ctx, usage, task.feature, result);
    if (!result.ok) return aiFailed(ctx.requestId);
    return successResponse<O>(result.data, ctx.requestId);
  });
}

export function handleAiAskStep(ctx: RequestContext, request: Request): Promise<Response> {
  return stoveRoute<string, Parameters<typeof ASK_STEP_TASK.content>[0], AiAskStepResponse>(
    ctx,
    request,
    (fields, body) => {
      const question = typeof body.question === "string" ? body.question.trim() : "";
      if (question.length === 0 || question.length > AI_ASK_STEP_QUESTION_MAX) {
        fields.add("question", `Must be 1 to ${AI_ASK_STEP_QUESTION_MAX} characters`);
      }
      return question;
    },
    ASK_STEP_TASK,
    (ctx, question) => ({ ctx, question }),
  );
}

export function handleAiCheckStep(ctx: RequestContext, request: Request): Promise<Response> {
  return stoveRoute<Photo | null, Parameters<typeof CHECK_STEP_TASK.content>[0], AiCheckStepResponse>(
    ctx,
    request,
    (fields, body) => photoField(fields, body.image, false),
    CHECK_STEP_TASK,
    (ctx, photo) => ({ ctx, ...photo! }),
  );
}

interface RescueFields {
  problem: AiRescueProblem;
  text: string | null;
  photo: Photo | null;
}

export function handleAiRescue(ctx: RequestContext, request: Request): Promise<Response> {
  return stoveRoute<RescueFields, Parameters<typeof RESCUE_TASK.content>[0], AiRescueResponse>(
    ctx,
    request,
    (fields, body) => {
      const problem = (AI_RESCUE_PROBLEMS as readonly unknown[]).includes(body.problem) ? (body.problem as AiRescueProblem) : null;
      if (!problem) fields.add("problem", `Must be one of ${AI_RESCUE_PROBLEMS.join(", ")}`);
      let text: string | null = null;
      if (body.text !== undefined && body.text !== null) {
        const t = typeof body.text === "string" ? body.text.trim() : "";
        if (t.length > AI_RESCUE_TEXT_MAX || typeof body.text !== "string") fields.add("text", `Must be at most ${AI_RESCUE_TEXT_MAX} characters`);
        else if (t !== "") text = t;
      }
      if (problem === "other" && text === null && !fields.errors.text) fields.add("text", "Say what is wrong");
      return { problem: problem ?? "other", text, photo: photoField(fields, body.image, true) };
    },
    RESCUE_TASK,
    (ctx, x) => ({ ctx, ...x }),
  );
}
