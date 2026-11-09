-- 480_kitchen_ai_cost: what each AI action cost, and the month's total.
--
-- Context: kitchen
-- Epic: cookpool-ai (AI-13, cost guardrails) — every AI action's row now
--       records its estimated cost, from the tokens the provider reported and
--       the price table in @saas/contracts (AI_PRICES_PER_MTOK). Before any
--       model call kitchen-worker sums this month's cost across everyone;
--       at or over AI_MONTHLY_BUDGET_USD, AI is off until the 1st (UTC).
--
-- Design rules:
--   * Additive: one column with a default, and one index, IF NOT EXISTS.
--   * cost_micros is micro-dollars (USD × 1 000 000), a whole number ≥ 0:
--     input (cache writes included) + cache reads + output, each times its
--     model's price; an escalated action adds both models' calls. Rows
--     written before 480 count 0.
--   * kitchen_ai_usage_created_idx (created_at, cost_micros) covers the
--     month's sum: one range read of the index, never the table.

ALTER TABLE kitchen_ai_usage ADD COLUMN cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0);

CREATE INDEX IF NOT EXISTS kitchen_ai_usage_created_idx
  ON kitchen_ai_usage (created_at, cost_micros);

-- column kitchen_ai_usage.cost_micros: The action's estimated cost in micro-dollars (USD × 1 000 000), from its calls' tokens and the price table; 0 before AI-13.
