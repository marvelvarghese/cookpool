// Cookpool AI's usage (cookpool-ai AI-2, migration 470_kitchen_ai).
//
// One row per AI action a person takes, for the daily limits and for
// watching what AI costs. Counts only: no group, item, price or text.
//
//   recordAiUsage   one insert per action (a Sonnet retry's tokens are summed
//                   into its action's row by the caller)
//   aiUsageBetween  a person's actions, receipts and voice seconds in
//                   [from, to): the day's count the limits check, in ONE
//                   statement over kitchen_ai_usage_user_idx
//   aiCostBetween   everyone's cost_micros in [from, to): the month's total
//                   the AI budget checks (AI-13, 480_kitchen_ai_cost), in ONE
//                   statement over kitchen_ai_usage_created_idx
//
// Kept apart from KitchenRepository (its own factory), like the timers.

import type { SqlExecutor } from "../d1/executor.js";
import type { KitchenResult } from "./types.js";

/** What a row's `feature` may be (the CHECK in 470_kitchen_ai). */
export const KITCHEN_AI_USAGE_FEATURES = [
  "uses",
  "receipt",
  "recipe_import",
  "transcribe",
  "ask_step",
  "swaps",
  "idea",
] as const;
export type KitchenAiUsageFeature = (typeof KITCHEN_AI_USAGE_FEATURES)[number];

/** The feature that counts voice seconds rather than actions. */
export const KITCHEN_AI_VOICE_FEATURE: KitchenAiUsageFeature = "transcribe";

export interface NewKitchenAiUsage {
  id: string;
  userId: string;
  feature: KitchenAiUsageFeature;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  audioSeconds: number;
  /** The action's estimated cost in micro-dollars (AI-13): rounded, at least 0. */
  costMicros: number;
  ok: boolean;
  now: Date;
}

export interface KitchenAiUsageRecord {
  id: string;
  userId: string;
  feature: KitchenAiUsageFeature;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  audioSeconds: number;
  costMicros: number;
  ok: boolean;
  createdAt: Date;
}

/** A person's use over a range: every action but a transcription, the receipts among them, and the transcriptions' seconds. */
export interface KitchenAiUsageTotals {
  actions: number;
  receipts: number;
  voiceSeconds: number;
}

export interface AiUsageRepository {
  recordAiUsage(input: NewKitchenAiUsage): Promise<KitchenResult<KitchenAiUsageRecord>>;
  /** `userId`'s actions and voice seconds with created_at in [from, to). */
  aiUsageBetween(userId: string, from: Date, to: Date): Promise<KitchenResult<KitchenAiUsageTotals>>;
  /** Everyone's cost_micros with created_at in [from, to) (AI-13). */
  aiCostBetween(from: Date, to: Date): Promise<KitchenResult<number>>;
}

const COLUMNS =
  "id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, cost_micros, ok, created_at";

/** A count the table keeps non-negative: a whole number, at least 0. */
const count = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

function mapUsage(row: Record<string, unknown>): KitchenAiUsageRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    feature: row.feature as KitchenAiUsageFeature,
    model: row.model as string,
    inputTokens: Number(row.input_tokens),
    cachedTokens: Number(row.cached_tokens),
    outputTokens: Number(row.output_tokens),
    audioSeconds: Number(row.audio_seconds),
    costMicros: Number(row.cost_micros),
    ok: Number(row.ok) === 1,
    createdAt: new Date(row.created_at as string),
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

export function createAiUsageRepository(executor: SqlExecutor): AiUsageRepository {
  return {
    async recordAiUsage(input) {
      try {
        const result = await executor.execute(
          `INSERT INTO kitchen_ai_usage (${COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING ${COLUMNS}`,
          [
            input.id,
            input.userId,
            input.feature,
            input.model,
            count(input.inputTokens),
            count(input.cachedTokens),
            count(input.outputTokens),
            count(input.audioSeconds),
            count(input.costMicros),
            input.ok ? 1 : 0,
            input.now.toISOString(),
          ],
        );
        return { ok: true, value: mapUsage(result.rows[0]!) };
      } catch (err) {
        return internal(err);
      }
    },

    async aiUsageBetween(userId, from, to) {
      try {
        const result = await executor.execute(
          `SELECT
             COALESCE(SUM(CASE WHEN feature <> $4 THEN 1 ELSE 0 END), 0) AS actions,
             COALESCE(SUM(CASE WHEN feature = $5 THEN 1 ELSE 0 END), 0) AS receipts,
             COALESCE(SUM(CASE WHEN feature = $4 THEN audio_seconds ELSE 0 END), 0) AS voice_seconds
           FROM kitchen_ai_usage
           WHERE user_id = $1 AND created_at >= $2 AND created_at < $3`,
          [userId, from.toISOString(), to.toISOString(), KITCHEN_AI_VOICE_FEATURE, "receipt"],
        );
        const row = result.rows[0] ?? {};
        return {
          ok: true,
          value: {
            actions: Number(row.actions ?? 0),
            receipts: Number(row.receipts ?? 0),
            voiceSeconds: Number(row.voice_seconds ?? 0),
          },
        };
      } catch (err) {
        return internal(err);
      }
    },

    async aiCostBetween(from, to) {
      try {
        const result = await executor.execute(
          `SELECT COALESCE(SUM(cost_micros), 0) AS cost_micros
           FROM kitchen_ai_usage
           WHERE created_at >= $1 AND created_at < $2`,
          [from.toISOString(), to.toISOString()],
        );
        const total = Number(result.rows[0]?.cost_micros ?? 0);
        if (!Number.isFinite(total)) return internal(new Error("the month's AI cost is not a number"));
        return { ok: true, value: total };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
