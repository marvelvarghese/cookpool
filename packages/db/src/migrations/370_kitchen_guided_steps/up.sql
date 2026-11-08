-- 370_kitchen_guided_steps: steps that guide, recipe tools, and each step's time as cooked.
--
-- Context: kitchen
-- Epic: cookpool-guided (GC-2, design §1, §2, §5, §6) — a recipe step says
--       everything a cook needs: its phase (prep or cook), the ingredient
--       lines it uses, a flame, a time range or a whistle count, whether it
--       runs hands off, how its time grows with the size, a checkpoint and a
--       tip. Every step has a stable key, which copies keep, so the time a
--       step really took — kept per dish with the size it was cooked at —
--       pools by the recipe a copy came from and the step's key (GC-7 reads it).
--
-- Design rules:
--   * Additive: every column is added with ALTER TABLE ADD COLUMN (SQLite has
--     no ADD COLUMN IF NOT EXISTS, so the runner's applied ledger keeps them
--     from running twice, as 330–360 do), a backfill UPDATE, then CREATE …
--     IF NOT EXISTS. Nothing is dropped or rebuilt, and no step, line or
--     recipe changes meaning: a step written before reads as a cook step of
--     text only — no lines, no flame, no time, not hands off, time fixed.
--   * SQLite's ADD COLUMN takes neither NOT NULL without a constant default
--     nor UNIQUE, and no expression default. So step_key is nullable here:
--     the backfill gives every existing step a random key
--     (lower(hex(randomblob(16))), 32 hex characters, the form kitchen-worker
--     mints), and the unique index then keeps a key to one step per recipe.
--     Storage writes a key with every step it inserts (minting one when none
--     is given). Cookpool's own steps get random keys too: GC-4's 390
--     rewrites them with fixed ones.
--   * Each column checks its own range, and the rules between columns sit on
--     the column added last (ADD COLUMN checks every existing row, which all
--     pass: they are NULL or the default):
--       - max_seconds is set exactly when min_seconds is, and min ≤ max ≤ 86 400;
--       - whistles (1–10) only on a step with no seconds: they never scale;
--       - sense only with a checkpoint (the checkpoint's sense).
--     The worker refuses the same with field errors first. Because INSERT OR
--     IGNORE skips a row that fails a CHECK without a word (RC-7), a seed that
--     writes steps — GC-4's 390 — should use plain INSERT or UPDATE.
--   * line_refs is a JSON array of the recipe's line positions (0–39), "[]"
--     for none; tools a JSON array of up to 10 names. SQLite checks that each
--     is an array of the right length; the worker checks what is in it
--     (positions the recipe has, each name 1–40 characters).
--   * kitchen_dish_step_times keeps one row per dish and step key: the
--     seconds from the step's start to its tick, the factor the dish was
--     cooked at (the dish's recipe_factor_milli; null when it said none), the
--     cook (usr_…), and the recipe root — the first recipe its copies came
--     from, found by walking source_recipe_id (at most 8 hops). Times are
--     kept raw; GC-7 drops abandoned and skipped ones when it reads them, and
--     a canceled dish's times through the dish's state. It moves no money.

ALTER TABLE kitchen_recipe_steps ADD COLUMN step_key TEXT
  CHECK (step_key IS NULL OR (length(step_key) BETWEEN 1 AND 64 AND step_key NOT GLOB '*[^0-9A-Za-z_-]*'));

ALTER TABLE kitchen_recipe_steps ADD COLUMN phase TEXT NOT NULL DEFAULT 'cook'
  CHECK (phase IN ('prep', 'cook'));

ALTER TABLE kitchen_recipe_steps ADD COLUMN line_refs TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(line_refs) AND json_type(line_refs) = 'array' AND json_array_length(line_refs) <= 40);

ALTER TABLE kitchen_recipe_steps ADD COLUMN heat INTEGER
  CHECK (heat IS NULL OR heat BETWEEN 0 AND 3);

ALTER TABLE kitchen_recipe_steps ADD COLUMN min_seconds INTEGER
  CHECK (min_seconds IS NULL OR min_seconds BETWEEN 0 AND 86400);

ALTER TABLE kitchen_recipe_steps ADD COLUMN max_seconds INTEGER
  CHECK ((max_seconds IS NULL) = (min_seconds IS NULL) AND (max_seconds IS NULL OR max_seconds BETWEEN min_seconds AND 86400));

ALTER TABLE kitchen_recipe_steps ADD COLUMN whistles INTEGER
  CHECK (whistles IS NULL OR (whistles BETWEEN 1 AND 10 AND min_seconds IS NULL));

ALTER TABLE kitchen_recipe_steps ADD COLUMN hands_off INTEGER NOT NULL DEFAULT 0
  CHECK (hands_off IN (0, 1));

ALTER TABLE kitchen_recipe_steps ADD COLUMN time_rule TEXT NOT NULL DEFAULT 'fixed'
  CHECK (time_rule IN ('fixed', 'partly', 'linear'));

ALTER TABLE kitchen_recipe_steps ADD COLUMN checkpoint TEXT
  CHECK (checkpoint IS NULL OR length(checkpoint) BETWEEN 1 AND 80);

ALTER TABLE kitchen_recipe_steps ADD COLUMN sense TEXT
  CHECK (sense IS NULL OR (sense IN ('look', 'smell', 'sound', 'feel', 'taste') AND checkpoint IS NOT NULL));

ALTER TABLE kitchen_recipe_steps ADD COLUMN tip TEXT
  CHECK (tip IS NULL OR length(tip) BETWEEN 1 AND 160);

-- Every step written before gets its key (each row draws its own).
UPDATE kitchen_recipe_steps SET step_key = lower(hex(randomblob(16))) WHERE step_key IS NULL;

-- A key names one step of its recipe.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_recipe_steps_key_uq
  ON kitchen_recipe_steps (recipe_id, step_key);

ALTER TABLE kitchen_recipes ADD COLUMN tools TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(tools) AND json_type(tools) = 'array' AND json_array_length(tools) <= 10);

CREATE TABLE IF NOT EXISTS kitchen_dish_step_times (
  dish_id         TEXT NOT NULL REFERENCES kitchen_dishes(id),
  step_key        TEXT NOT NULL CHECK (length(step_key) BETWEEN 1 AND 64),
  recipe_root_id  TEXT NOT NULL REFERENCES kitchen_recipes(id),
  seconds         INTEGER NOT NULL CHECK (seconds BETWEEN 0 AND 86400),
  factor_milli    INTEGER CHECK (factor_milli IS NULL OR factor_milli BETWEEN 10 AND 20000),
  cook_id         TEXT NOT NULL CHECK (length(cook_id) BETWEEN 1 AND 128),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- One time per step of a dish.
  PRIMARY KEY (dish_id, step_key)
);

-- A step's times across every cook of the recipe and its copies (GC-7's pool).
CREATE INDEX IF NOT EXISTS kitchen_dish_step_times_root_idx
  ON kitchen_dish_step_times (recipe_root_id, step_key);

-- column kitchen_recipe_steps.step_key: The step's stable key (32 hex characters, or a seed's fixed key): kept across edits and copies; unique per recipe.
-- column kitchen_recipe_steps.phase: prep (listed in Before you start) or cook.
-- column kitchen_recipe_steps.line_refs: The recipe lines this step uses, as a JSON array of their positions ("[]" for none).
-- column kitchen_recipe_steps.heat: The flame: 0 off, 1 low, 2 medium, 3 high; null when it says none.
-- column kitchen_recipe_steps.min_seconds: The shortest time it takes at the recipe's own size, in seconds; null when untimed.
-- column kitchen_recipe_steps.max_seconds: The longest time it takes at the recipe's own size, in seconds; set exactly with min_seconds.
-- column kitchen_recipe_steps.whistles: A pressure cooker's whistle count (1–10), instead of seconds; it never scales.
-- column kitchen_recipe_steps.hands_off: 1 when the cook can go on to other steps while it runs.
-- column kitchen_recipe_steps.time_rule: How its time grows with the size factor f: fixed (× 1), partly (× f^0.5), linear (× f).
-- column kitchen_recipe_steps.checkpoint: What to watch for ("golden brown"), at most 80 characters; null for none.
-- column kitchen_recipe_steps.sense: The checkpoint's sense: look, smell, sound, feel or taste; null for none.
-- column kitchen_recipe_steps.tip: One line shown under the step, at most 160 characters; null for none.
-- column kitchen_recipes.tools: The tools it needs, as a JSON array of up to 10 short names ("Pressure cooker").
-- table kitchen_dish_step_times: How long each step of a dish took (GC-2): one row per dish and step key, pooled by recipe root for learned ranges (GC-7).
-- column kitchen_dish_step_times.dish_id: The dish.
-- column kitchen_dish_step_times.step_key: The step's key in the recipe the dish was cooked from.
-- column kitchen_dish_step_times.recipe_root_id: The first recipe that recipe's copies came from (itself when it is no copy).
-- column kitchen_dish_step_times.seconds: From the step's start to its tick, in whole seconds (0 to 86 400), kept raw.
-- column kitchen_dish_step_times.factor_milli: The size it was cooked at (the dish's recipe_factor_milli); null when the dish said none.
-- column kitchen_dish_step_times.cook_id: Who cooked it (usr_…).
-- column kitchen_dish_step_times.created_at: When the dish was written.
