-- 470_kitchen_ai: what each person's AI actions used, for the daily limits.
--
-- Context: kitchen
-- Epic: cookpool-ai (AI-2, design §1) — kitchen-worker calls the Anthropic
--       API (Claude Haiku 5.5 first, one Claude Sonnet 5.5 retry when the
--       answer fails its checks) and, for voice, Workers AI's Whisper. Every
--       call it makes for a person writes one row here: the daily limits (50
--       actions and 30 voice minutes per person per UTC day) are counted from
--       these rows, and the tokens let the owner watch what AI costs.
--
-- Design rules:
--   * Additive and idempotent: one new table and its index, IF NOT EXISTS.
--   * One row per action: a sentence read, a receipt read, a recipe photo
--     read, a clip transcribed, a step question answered, swaps or an idea.
--     A Sonnet retry is part of the same action: its row names the model that
--     gave the last answer, and its token counts are the sum of both calls.
--   * feature is one of the epic's features; model the last model called.
--     input_tokens are the uncached input tokens (cache writes included),
--     cached_tokens the input read from the prompt cache, output_tokens the
--     output; audio_seconds the clip's length for a transcription, else 0.
--   * ok is 1 when the action gave an answer, 0 when it failed (a refusal,
--     an error, or an answer that failed its checks twice): failed actions
--     count against the limit too — they were paid for.
--   * user_id is the person's public usr_… id. Nothing here names a group,
--     an item, a price or anything the person said: only counts.
--   * created_at is an ISO 8601 UTC instant as toISOString() writes it, so
--     text order is time order: a UTC day is the range [day, next day).
--     kitchen_ai_usage_user_idx serves the day's count per person.
--   * Nothing else points here, and nothing here moves money.

CREATE TABLE IF NOT EXISTS kitchen_ai_usage (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  feature        TEXT NOT NULL CHECK (feature IN ('uses', 'receipt', 'recipe_import', 'transcribe', 'ask_step', 'swaps', 'idea')),
  model          TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  input_tokens   INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  output_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  audio_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (audio_seconds >= 0),
  ok             INTEGER NOT NULL CHECK (ok IN (0, 1)),
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS kitchen_ai_usage_user_idx
  ON kitchen_ai_usage (user_id, created_at);

-- table kitchen_ai_usage: One row per AI action a person took (Cookpool AI-2): the daily limits are counted from it, and its tokens show what AI costs.
-- column kitchen_ai_usage.id: The row (a UUID).
-- column kitchen_ai_usage.user_id: Whose action it was (usr_…).
-- column kitchen_ai_usage.feature: Which feature: uses, receipt, recipe_import, transcribe, ask_step, swaps or idea.
-- column kitchen_ai_usage.model: The last model called (claude-haiku-5-5, claude-sonnet-5-5 after a retry, or the transcription model).
-- column kitchen_ai_usage.input_tokens: Input tokens not read from the prompt cache, summed over the action's calls.
-- column kitchen_ai_usage.cached_tokens: Input tokens read from the prompt cache, summed over the action's calls.
-- column kitchen_ai_usage.output_tokens: Output tokens, summed over the action's calls.
-- column kitchen_ai_usage.audio_seconds: The clip's length in whole seconds, rounded up, for a transcription; else 0.
-- column kitchen_ai_usage.ok: 1 when the action gave an answer, 0 when it failed.
-- column kitchen_ai_usage.created_at: When it ran (ISO 8601 UTC).
