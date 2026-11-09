import type Anthropic from "@anthropic-ai/sdk";
import { aiCallCostMicros } from "@saas/contracts/kitchen";
import type { KitchenAiUsageFeature } from "@saas/db/kitchen";
import type { AiMessage, AiMessageParams, AiProvider } from "./provider.js";
import { schemaProblems, type JsonSchema } from "./schema.js";

// The AI task runner (Cookpool AI, AI-2, design §1). Every AI feature is one
// task — its fixed system prompt, a fixed reference block, its strict output
// schema, how it renders its input, and its own check — and runs the same way:
//
//   1. claude-haiku-5-5 at effort `low`, thinking disabled (AI-13: the
//      answers are reads, not reasoning, and thinking tokens are output
//      tokens), the task's own tight `max_tokens`, and the task's schema as
//      `output_config.format`. The system prompt and the reference block carry
//      `cache_control`, so only the person's input is new from call to call.
//   2. The answer is checked: the stop reason, the JSON against the schema,
//      then the task's own check (amounts ≤ what's left, a total that adds up…).
//   3. If — and only if — that check fails (or the answer was cut short):
//      with escalation on (AI_ESCALATE=on), the same request is sent ONCE to
//      claude-sonnet-5-5, still at effort `low` (thinking at its default), and
//      checked the same way. With escalation off — the default (AI-13) — there
//      is no second call: a task with a `salvage` returns what of a
//      schema-valid answer is usable (`degraded`), anything else is
//      `ai_failed`.
//   4. A refusal, a provider error or a failed check with nothing more to
//      try is `ai_failed`; nothing a provider throws reaches a caller.
//
// The result carries the model that answered, the tokens of every call and
// their estimated cost (AI_PRICES_PER_MTOK), for kitchen_ai_usage.

export const AI_FIRST_MODEL = "claude-haiku-5-5";
export const AI_RETRY_MODEL = "claude-sonnet-5-5";
export const AI_EFFORT = "low";
/** Haiku runs without thinking (AI-13): allowed on claude-haiku-5-5 at effort `high` or below. */
export const AI_FIRST_THINKING = { type: "disabled" } as const;

export interface AiRunOptions {
  /** Retry a failed check once on Sonnet (AI_ESCALATE=on). Off by default (AI-13). */
  escalate: boolean;
}

/** Is Sonnet escalation on? Only the exact value `on` turns it on (AI-13). */
export function aiEscalate(env: { AI_ESCALATE?: string | undefined }): boolean {
  return env.AI_ESCALATE === "on";
}

/** A task's own check of a schema-valid answer: the value to return, or what is wrong with it. */
export type AiCheck<O> = { ok: true; value: O } | { ok: false; problems: string[] };

export interface AiTask<I, O> {
  /** The feature its usage row is counted under. */
  feature: KitchenAiUsageFeature;
  /** The fixed instructions: never built from a request. */
  system: string;
  /** Fixed reference material after the instructions (units, the food list); cached with them. */
  reference?: string;
  /** The strict JSON schema of the answer. */
  schema: JsonSchema;
  maxTokens: number;
  /** The user turn for one input. Mark a block `cache_control` when it repeats across a person's calls. */
  content(input: I): Anthropic.ContentBlockParam[];
  /** Check a schema-valid answer against the input, and shape what the route returns. */
  check(answer: unknown, input: I): AiCheck<O>;
  /**
   * With escalation off, what of a schema-valid answer that failed `check` is
   * still usable; null when nothing is. Tasks without one fail instead (AI-13).
   */
  salvage?(answer: unknown, input: I): O | null;
}

export interface AiUsageTally {
  /** Input tokens not read from the cache (cache writes included). */
  inputTokens: number;
  /** Input tokens read from the prompt cache. */
  cachedTokens: number;
  outputTokens: number;
  /** The calls' estimated cost in micro-dollars, unrounded (AI-13). */
  costMicros: number;
}

export type AiFailure = "refusal" | "error" | "invalid";

export type AiRunResult<O> =
  | { ok: true; data: O; model: string; usage: AiUsageTally; escalated: boolean; degraded: boolean }
  | { ok: false; reason: "ai_failed"; failure: AiFailure; model: string; usage: AiUsageTally; problems: string[] };

/** The request one attempt sends: the same for both models but the model. */
export function aiRequest<I, O>(task: AiTask<I, O>, input: I, model: string): AiMessageParams {
  const cached = { type: "ephemeral" } as const;
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: task.system, cache_control: cached }];
  if (task.reference) system.push({ type: "text", text: task.reference, cache_control: cached });
  return {
    model,
    max_tokens: task.maxTokens,
    ...(model === AI_FIRST_MODEL ? { thinking: AI_FIRST_THINKING } : {}),
    system,
    messages: [{ role: "user", content: task.content(input) }],
    output_config: { effort: AI_EFFORT, format: { type: "json_schema", schema: task.schema as Record<string, unknown> } },
  };
}

/** Add one call's tokens and its cost, priced for the model it was sent to. */
function tally(total: AiUsageTally, message: AiMessage | null, model: string): void {
  const usage = message?.usage;
  if (!usage) return;
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  total.inputTokens += input;
  total.cachedTokens += cacheRead;
  total.outputTokens += output;
  total.costMicros += aiCallCostMicros(model, { input, cacheRead, output });
}

type Attempt<O> =
  | { kind: "ok"; value: O }
  | { kind: "refusal" | "error" }
  /** `answer` is set when it was schema-valid JSON that failed the task's check. */
  | { kind: "invalid"; problems: string[]; answer?: unknown };

/** The answer's text: its text blocks, joined (thinking blocks are skipped). */
function answerText(message: AiMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

function judge<I, O>(task: AiTask<I, O>, input: I, message: AiMessage): Attempt<O> {
  if (message.stop_reason === "refusal") return { kind: "refusal" };
  // Cut short (or anything but a finished turn): the JSON may be incomplete.
  if (message.stop_reason !== "end_turn") return { kind: "invalid", problems: [`stopped: ${message.stop_reason ?? "unknown"}`] };
  let answer: unknown;
  try {
    answer = JSON.parse(answerText(message));
  } catch {
    return { kind: "invalid", problems: ["the answer is not JSON"] };
  }
  const problems = schemaProblems(task.schema, answer);
  if (problems.length > 0) return { kind: "invalid", problems };
  try {
    const checked = task.check(answer, input);
    return checked.ok ? { kind: "ok", value: checked.value } : { kind: "invalid", problems: checked.problems, answer };
  } catch {
    return { kind: "invalid", problems: ["the answer could not be checked"] };
  }
}

async function attempt<I, O>(
  provider: AiProvider,
  task: AiTask<I, O>,
  input: I,
  model: string,
  usage: AiUsageTally,
): Promise<Attempt<O>> {
  let message: AiMessage;
  try {
    message = await provider.createMessage(aiRequest(task, input, model));
  } catch {
    return { kind: "error" };
  }
  tally(usage, message, model);
  return judge(task, input, message);
}

/**
 * Run `task` on `input`: Haiku first; on a failed check, one Sonnet retry
 * when `escalate` is on, else the task's salvage (or `ai_failed`). Never throws.
 */
export async function runAiTask<I, O>(
  provider: AiProvider,
  task: AiTask<I, O>,
  input: I,
  options: AiRunOptions = { escalate: false },
): Promise<AiRunResult<O>> {
  const usage: AiUsageTally = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costMicros: 0 };
  const first = await attempt(provider, task, input, AI_FIRST_MODEL, usage);
  if (first.kind === "ok") return { ok: true, data: first.value, model: AI_FIRST_MODEL, usage, escalated: false, degraded: false };
  if (first.kind !== "invalid") {
    return { ok: false, reason: "ai_failed", failure: first.kind, model: AI_FIRST_MODEL, usage, problems: [] };
  }

  if (!options.escalate) {
    let salvaged: O | null = null;
    if (task.salvage && first.answer !== undefined) {
      try {
        salvaged = task.salvage(first.answer, input);
      } catch {
        salvaged = null;
      }
    }
    if (salvaged !== null) return { ok: true, data: salvaged, model: AI_FIRST_MODEL, usage, escalated: false, degraded: true };
    return { ok: false, reason: "ai_failed", failure: "invalid", model: AI_FIRST_MODEL, usage, problems: first.problems };
  }

  const second = await attempt(provider, task, input, AI_RETRY_MODEL, usage);
  if (second.kind === "ok") return { ok: true, data: second.value, model: AI_RETRY_MODEL, usage, escalated: true, degraded: false };
  return {
    ok: false,
    reason: "ai_failed",
    failure: second.kind,
    model: AI_RETRY_MODEL,
    usage,
    problems: second.kind === "invalid" ? second.problems : first.problems,
  };
}
