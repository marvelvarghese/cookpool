-- 300_kitchen_measures: your measures — an item counted the way people eat it.
--
-- Context: kitchen
-- Epic: cookpool-simpler (SM-13, design §6) — onions bought by the kilo are
--       used one at a time, bread is bought by the pack and eaten by the
--       slice. An item keeps its one stock in the unit it was bought in (what
--       the price paid for, and what money is worked out from); a measure is a
--       size in that stock's unit: "1 onion ≈ 150 g", "20 slices in a pack".
--       A use or a dish ingredient given in a measure takes count × size from
--       the stock and keeps its words ("2 onions") on the move and on the
--       ingredient row.
--
-- Design rules:
--   * Additive and idempotent: CREATE … IF NOT EXISTS, and two nullable
--     columns with no default (rows written before read as NULL). SQLite has
--     no ADD COLUMN IF NOT EXISTS, so the runner's applied ledger is what keeps
--     the column adds from running twice (as 240, 260, 280 and 290 do).
--   * A measure belongs to a name in one pantry, for one dimension — not to
--     one purchase: next week's onions in the same pantry already count in
--     onions. The pantry is owner_kind + owner_id, the way kitchen_items keys
--     it: a person's own (owner_kind user, owner_id their usr_…) or a group's
--     (owner_kind group, owner_id the group's UUID). name_key is the item's
--     name trimmed and lower-cased with SQLite's own lower() (ASCII letters
--     fold, as the pantry search and the history reads fold them), written
--     and matched by the same expression, so the two can never disagree.
--   * Exact: `count` of the measure make `amount_milli` thousandths of the
--     dimension's base unit (1 onion = 150000 milli-g; 20 slices = 1000
--     milli-pack), both whole and above zero, so a slice of a 16-slice pack is
--     exactly a sixteenth of it. No money here: a use's cost is still the
--     engine's proportional cost of what it took.
--   * At most three per name, in `position` order (0, 1, 2). A name's set is
--     replaced as a whole in one batch (kitchen-worker), so the CHECK on
--     position and the unique `one` per name keep it to three.
--   * label (on a move and on a dish ingredient) is the words a use was given
--     in ("2 onions", "½ onion"); null when it was given in a unit. The
--     quantity and unit beside it stay in the item's own unit.
--   * owner_id is an opaque reference (membership_organizations.id, or a
--     public usr_… id) with no cross-context FK; created_by and updated_by are
--     public ids (usr_…).

CREATE TABLE IF NOT EXISTS kitchen_measures (
  id            TEXT PRIMARY KEY,
  owner_kind    TEXT NOT NULL CHECK (owner_kind IN ('user', 'group')),
  owner_id      TEXT NOT NULL,
  name_key      TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 120),
  dimension     TEXT NOT NULL CHECK (dimension IN ('count', 'mass', 'volume', 'pack')),
  one           TEXT NOT NULL CHECK (length(one) BETWEEN 1 AND 24),
  many          TEXT NOT NULL CHECK (length(many) BETWEEN 1 AND 24),
  count         INTEGER NOT NULL CHECK (count > 0),
  amount_milli  INTEGER NOT NULL CHECK (amount_milli > 0),
  position      INTEGER NOT NULL CHECK (position BETWEEN 0 AND 2),
  created_by    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- One measure of each word per name, pantry and dimension.
  UNIQUE (owner_kind, owner_id, name_key, dimension, one)
);

-- Every item read looks up its name's measures, many names in one statement:
-- by pantry, name and dimension, in position order.
CREATE INDEX IF NOT EXISTS kitchen_measures_lookup_idx
  ON kitchen_measures (owner_kind, owner_id, name_key, dimension, position);

ALTER TABLE kitchen_stock_moves ADD COLUMN label TEXT
  CHECK (label IS NULL OR length(label) BETWEEN 1 AND 64);

ALTER TABLE kitchen_dish_ingredients ADD COLUMN label TEXT
  CHECK (label IS NULL OR length(label) BETWEEN 1 AND 64);

-- table kitchen_measures: A size an item is counted in, per name, pantry and dimension ("1 onion ≈ 150 g"): count of it make amount_milli of the stock.
-- column kitchen_measures.id: Measure id (UUID); crosses the API as msr_<32 hex>.
-- column kitchen_measures.owner_kind: user (a personal pantry) | group (a group pantry), as kitchen_items.owner_kind.
-- column kitchen_measures.owner_id: The pantry: the person (usr_…) for a personal pantry, the group (membership_organizations.id, no cross-context FK) for a group's.
-- column kitchen_measures.name_key: The item name it belongs to, lower(trim(name)) — ASCII letters fold, as the pantry search folds them.
-- column kitchen_measures.dimension: count | mass | volume | pack: the stock unit's dimension the size is in.
-- column kitchen_measures.one: The word for one ("onion", "slice"); unique per name, pantry and dimension.
-- column kitchen_measures.many: The word for more than one ("onions", "slices").
-- column kitchen_measures.count: How many of the measure make amount_milli (20 slices in a pack: 20).
-- column kitchen_measures.amount_milli: What count of them amount to, in thousandths of the dimension base unit.
-- column kitchen_measures.position: Its place among the name's measures, 0 to 2.
-- column kitchen_measures.created_by: Who first set it (usr_…).
-- column kitchen_measures.updated_by: Who set it last (usr_…).
-- column kitchen_stock_moves.label: The words a use or a dish's take was given in ("2 onions", "½ onion"); null when given in a unit.
-- column kitchen_dish_ingredients.label: The words the ingredient was given in ("2 onions"); null when given in a unit.
