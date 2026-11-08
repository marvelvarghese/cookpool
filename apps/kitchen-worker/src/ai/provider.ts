import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env.js";

// The model provider (Cookpool AI, AI-2, design §1): one Messages API call.
// Kept behind this interface so the task runner never sees the SDK's client,
// and tests stub it — no test reaches the network. In production it is the
// official @anthropic-ai/sdk client (it runs on Workers), built from the
// ANTHROPIC_API_KEY secret for the one request.

export type AiMessageParams = Anthropic.MessageCreateParamsNonStreaming;
export type AiMessage = Anthropic.Message;

export interface AiProvider {
  /** One non-streaming Messages call. May throw: the runner maps anything thrown to `ai_failed`. */
  createMessage(params: AiMessageParams): Promise<AiMessage>;
}

/**
 * One SDK retry for a dropped connection, a 429 or a 5xx, and a 30 s timeout
 * per attempt: an AI answer is worth waiting a little for, never a minute.
 */
const CLIENT_OPTIONS = { maxRetries: 1, timeout: 30_000 } as const;

export function anthropicProvider(apiKey: string): AiProvider {
  const client = new Anthropic({ apiKey, ...CLIENT_OPTIONS });
  return { createMessage: (params) => client.messages.create(params) };
}

/** Is AI set up on this server? Only the key decides (design §1). */
export function aiAvailable(env: Pick<Env, "ANTHROPIC_API_KEY">): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.trim() !== "";
}

/**
 * The provider for one request: the stub a test put in place, else the
 * Anthropic client; null when the server has no key (→ 503 `ai_unavailable`),
 * stub or not.
 */
export function aiProviderFor(ctx: { env: Pick<Env, "ANTHROPIC_API_KEY">; aiProvider?: AiProvider }): AiProvider | null {
  if (!aiAvailable(ctx.env)) return null;
  return ctx.aiProvider ?? anthropicProvider(ctx.env.ANTHROPIC_API_KEY!.trim());
}
