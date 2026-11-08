-- 350_kitchen_recipes: recipes — templates a cook starts from — and the dish's link to one.
--
-- Context: kitchen
-- Epic: cookpool-recipes (RC-4, design §3, §5.1, §5.2, §6) — a recipe is a
--       name, serves N, lines and steps; it never moves money. Cooking it is
--       the existing dish write, which now keeps the recipe, the factor it
--       was scaled by and, on each ingredient, the line it was for — so the
--       next session can show "last time".
--
-- Design rules:
--   * Additive and idempotent: CREATE … IF NOT EXISTS, and three nullable
--     columns with no default on the dish tables (dishes cooked before read as
--     NULL: no recipe). SQLite has no ADD COLUMN IF NOT EXISTS, so the
--     runner's applied ledger keeps the column adds from running twice.
--   * A recipe belongs to one person (owner_id, a public usr_… id), or to
--     Cookpool itself (is_system, owner usr_cookpool: visible to everyone,
--     edited by no one). Who else sees it is its visibility, cumulative:
--     only_me; groups (anyone who currently shares a group with the owner —
--     membership decides, at read time); link (groups, plus anyone signed in
--     with link_code). A link recipe has a code and nothing else does, so
--     turning the link off or rotating it ends the old code at once.
--   * A copy is its own recipe (design §5.2): owned by whoever saved it,
--     only_me, with source_recipe_id, source_owner_id and the source owner's
--     name as it was then ("from Anu"). Nothing ties it back: the source's
--     later edits and its deletion never touch the copy. "Saved by N" counts
--     the copies (kitchen_recipes_source_idx).
--   * Deleting is soft (deleted_at): the row stays for its copies' sake and
--     for dishes that name it, and every read leaves it out.
--   * serves_half counts in halves, like portions. A line's amount is
--     qty_milli: thousandths of its unit's base (grams, millilitres, pieces),
--     as an item's quantity is, in the unit it was written in (g kg ml L pcs
--     tsp tbsp cup, or a count word such as "onion"); a to-taste line has
--     neither. Exactly one line per recipe is the main one, never to taste:
--     the unique index keeps it to one, kitchen-worker to at least one.
--   * Lines are 0–39 by position, steps 0–19 of up to 200 characters; a
--     recipe's lines and steps are replaced as a whole in one batch.
--   * kind is the Explore chip it sits under (breakfast, dal_curry, …),
--     checked by kitchen-worker against the contracts' RECIPE_KINDS so RC-7
--     can add one without a table rebuild.
--   * owner_id, source_owner_id and the dish's cook are public ids (usr_…).

CREATE TABLE IF NOT EXISTS kitchen_recipes (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 128),
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  serves_half        INTEGER NOT NULL CHECK (serves_half BETWEEN 1 AND 200),
  minutes            INTEGER CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1440),
  visibility         TEXT NOT NULL CHECK (visibility IN ('only_me', 'groups', 'link')),
  link_code          TEXT UNIQUE CHECK (link_code IS NULL OR length(link_code) = 10),
  source_recipe_id   TEXT,
  source_owner_id    TEXT,
  source_owner_name  TEXT CHECK (source_owner_name IS NULL OR length(source_owner_name) BETWEEN 1 AND 120),
  is_system          INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  kind               TEXT CHECK (kind IS NULL OR length(kind) BETWEEN 1 AND 24),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT,
  -- A link recipe has its code, and nothing else has one.
  CHECK ((visibility = 'link') = (link_code IS NOT NULL)),
  -- Cookpool's own recipes belong to its system user.
  CHECK (is_system = 0 OR owner_id = 'usr_cookpool')
);

-- A person's recipes (My recipes, a person's page), newest first.
CREATE INDEX IF NOT EXISTS kitchen_recipes_owner_idx
  ON kitchen_recipes (owner_id, created_at) WHERE deleted_at IS NULL;

-- Cookpool's recipes (Explore, Cook now).
CREATE INDEX IF NOT EXISTS kitchen_recipes_system_idx
  ON kitchen_recipes (created_at) WHERE is_system = 1 AND deleted_at IS NULL;

-- The copies of a recipe ("saved by N").
CREATE INDEX IF NOT EXISTS kitchen_recipes_source_idx
  ON kitchen_recipes (source_recipe_id) WHERE source_recipe_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kitchen_recipe_lines (
  recipe_id  TEXT NOT NULL REFERENCES kitchen_recipes(id),
  position   INTEGER NOT NULL CHECK (position BETWEEN 0 AND 39),
  food_key   TEXT REFERENCES kitchen_foods(key),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  qty_milli  INTEGER CHECK (qty_milli IS NULL OR qty_milli > 0),
  unit       TEXT CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 24),
  to_taste   INTEGER NOT NULL DEFAULT 0 CHECK (to_taste IN (0, 1)),
  is_main    INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
  PRIMARY KEY (recipe_id, position),
  -- An amount in a unit, or to taste with neither.
  CHECK ((to_taste = 0 AND qty_milli IS NOT NULL AND unit IS NOT NULL)
      OR (to_taste = 1 AND qty_milli IS NULL AND unit IS NULL)),
  -- The main line scales every other: it has an amount.
  CHECK (is_main = 0 OR to_taste = 0)
);

-- One main line per recipe.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_recipe_lines_main_uq
  ON kitchen_recipe_lines (recipe_id) WHERE is_main = 1;

CREATE TABLE IF NOT EXISTS kitchen_recipe_steps (
  recipe_id  TEXT NOT NULL REFERENCES kitchen_recipes(id),
  position   INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200),
  PRIMARY KEY (recipe_id, position)
);

ALTER TABLE kitchen_dishes ADD COLUMN recipe_id TEXT;

ALTER TABLE kitchen_dishes ADD COLUMN recipe_factor_milli INTEGER
  CHECK (recipe_factor_milli IS NULL OR recipe_factor_milli > 0);

ALTER TABLE kitchen_dish_ingredients ADD COLUMN recipe_line INTEGER
  CHECK (recipe_line IS NULL OR recipe_line BETWEEN 0 AND 39);

-- A cook's dishes of a recipe, newest first: "last time" and "most recently cooked".
CREATE INDEX IF NOT EXISTS kitchen_dishes_cook_recipe_idx
  ON kitchen_dishes (cook, recipe_id, cooked_at) WHERE recipe_id IS NOT NULL;

-- table kitchen_recipes: A recipe (RC-4): a template a cook starts from; it never moves money.
-- column kitchen_recipes.id: Recipe id (UUID); crosses the API as rcp_<32 hex>.
-- column kitchen_recipes.owner_id: Whose it is (usr_…); usr_cookpool for Cookpool's own.
-- column kitchen_recipes.name: Its name.
-- column kitchen_recipes.serves_half: Serves, × 2 (halves allowed, like portions).
-- column kitchen_recipes.minutes: How long it takes, if said.
-- column kitchen_recipes.visibility: only_me | groups (anyone sharing a group with the owner) | link (groups, plus anyone with the code).
-- column kitchen_recipes.link_code: The 10-character base-58 link code, while visibility is link; unique.
-- column kitchen_recipes.source_recipe_id: For a copy: the recipe it was saved from (UUID); null otherwise.
-- column kitchen_recipes.source_owner_id: For a copy: whose recipe that was (usr_…).
-- column kitchen_recipes.source_owner_name: For a copy: that person's name when it was saved ("from Anu").
-- column kitchen_recipes.is_system: 1 for Cookpool's own recipes: visible to everyone, edited by no one.
-- column kitchen_recipes.kind: The Explore chip it sits under (breakfast, dal_curry, rice, …); null for none.
-- column kitchen_recipes.deleted_at: When its owner deleted it (soft: copies stay); null while it is live.
-- table kitchen_recipe_lines: A recipe's lines, in order: a food (or free text), an amount in a unit or to taste, one main.
-- column kitchen_recipe_lines.recipe_id: The recipe.
-- column kitchen_recipe_lines.position: Its place, 0 to 39; a dish ingredient's recipe_line points at it.
-- column kitchen_recipe_lines.food_key: The food it asks for; null for a free-text line.
-- column kitchen_recipe_lines.name: Its words ("Onions, sliced").
-- column kitchen_recipe_lines.qty_milli: How much: thousandths of the unit's base (g, ml, pieces); null to taste.
-- column kitchen_recipe_lines.unit: The unit it was written in (g kg ml L pcs tsp tbsp cup, or a count word); null to taste.
-- column kitchen_recipe_lines.to_taste: 1 when it has no amount ("salt, to taste"): it never scales.
-- column kitchen_recipe_lines.is_main: 1 for the line that scales every other; exactly one per recipe.
-- table kitchen_recipe_steps: A recipe's steps, in order: up to 20 short texts.
-- column kitchen_recipe_steps.recipe_id: The recipe.
-- column kitchen_recipe_steps.position: Its place, 0 to 19.
-- column kitchen_recipe_steps.text: What to do, at most 200 characters.
-- column kitchen_dishes.recipe_id: The recipe it was cooked from (UUID, RC-4); null for a dish cooked without one.
-- column kitchen_dishes.recipe_factor_milli: The factor the recipe was scaled by, in thousandths (450 for × 0.45); null when not said.
-- column kitchen_dish_ingredients.recipe_line: The recipe line this ingredient was for (its position, RC-4); null otherwise.
