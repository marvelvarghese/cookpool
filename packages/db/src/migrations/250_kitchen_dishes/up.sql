-- 250_kitchen_dishes: a dish, and what went into it.
--
-- Context: kitchen
-- Epic: cookpool-kitchen (CP-14) — a cook makes one dish from their own
--       pantry and any group pantries they can use. Cooking takes stock out of
--       every source pantry (kitchen_stock_moves of kind `dish`, dish_id set)
--       and charges the cook each buyer's share in one `use` transaction per
--       source group, all in one batch. Sharing the dish out among its eaters
--       (claims, shares, finalize, leftovers) arrives with CP-16.
--
-- Design rules:
--   * Additive and idempotent: CREATE … IF NOT EXISTS only.
--   * A dish belongs to its cook (a usr_…), like a personal pantry: org_id is
--     the group it is shared with, null for "just me". Claims need a group.
--   * Money is integer minor units in the dish's one currency: every
--     ingredient's, and the shared group's. total_minor is always
--     ingredients_minor + extras_minor (the CHECK says so).
--   * state: draft (assign mode — the cook alone decides the shares), open
--     (claims mode — the group's members claim portions), finalized (the dish
--     transaction posted, CP-16), canceled (every ingredient put back and its
--     charges reversed). Each closing state carries its timestamp.
--   * An ingredient row is one item taken for the dish: how much, what it
--     cost, the pantry it came from (org_id; null = the cook's own), who had
--     bought it, and the `use` transaction that charged the cook for it (null
--     when nobody else paid for it: the cook's own items, free items).
--   * Retries are safe: idem_key is unique per cook.
--   * kitchen_stock_moves.dish_id (230_kitchen_pantry) stays a plain column:
--     SQLite cannot add a foreign key to an existing column without
--     rebuilding the table. kitchen-worker writes it only in the batch that
--     inserts the dish; the index below makes a dish's moves one lookup.
--   * org_id is an opaque reference to membership_organizations.id (a bare
--     UUID) with no cross-context FK; subject ids are public ids (usr_…).

CREATE TABLE IF NOT EXISTS kitchen_dishes (
  id                 TEXT PRIMARY KEY,
  cook               TEXT NOT NULL,
  org_id             TEXT,
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  portions_half      INTEGER NOT NULL CHECK (portions_half > 0),
  extras_minor       INTEGER NOT NULL DEFAULT 0 CHECK (extras_minor >= 0),
  ingredients_minor  INTEGER NOT NULL CHECK (ingredients_minor >= 0),
  total_minor        INTEGER NOT NULL,
  currency           TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  split_mode         TEXT NOT NULL CHECK (split_mode IN ('assign', 'claims')),
  state              TEXT NOT NULL CHECK (state IN ('draft', 'open', 'finalized', 'canceled')),
  txn_id             TEXT REFERENCES kitchen_txns(id),
  leftover_item_id   TEXT REFERENCES kitchen_items(id),
  cooked_at          TEXT NOT NULL,
  finalized_at       TEXT,
  canceled_at        TEXT,
  idem_key           TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (cook, idem_key),
  -- What the dish costs is what went into it plus the extras, exactly.
  CHECK (total_minor = ingredients_minor + extras_minor),
  -- Claims are made by a group's members: a dish for "just me" is assigned.
  CHECK (split_mode = 'assign' OR org_id IS NOT NULL),
  CHECK ((state = 'finalized') = (finalized_at IS NOT NULL)),
  CHECK ((state = 'canceled') = (canceled_at IS NOT NULL))
);

-- The dishes someone cooked, newest first (the "my dishes" read).
CREATE INDEX IF NOT EXISTS kitchen_dishes_cook_idx
  ON kitchen_dishes (cook, cooked_at DESC, id DESC);

-- The dishes shared with a group, newest first.
CREATE INDEX IF NOT EXISTS kitchen_dishes_org_idx
  ON kitchen_dishes (org_id, cooked_at DESC, id DESC) WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kitchen_dish_ingredients (
  dish_id     TEXT NOT NULL REFERENCES kitchen_dishes(id),
  item_id     TEXT NOT NULL REFERENCES kitchen_items(id),
  position    INTEGER NOT NULL CHECK (position >= 0),
  qty_milli   INTEGER NOT NULL CHECK (qty_milli > 0),
  unit        TEXT NOT NULL CHECK (length(unit) BETWEEN 1 AND 16),
  cost_minor  INTEGER NOT NULL CHECK (cost_minor >= 0),
  org_id      TEXT,
  paid_by     TEXT NOT NULL,
  use_txn_id  TEXT REFERENCES kitchen_txns(id),
  PRIMARY KEY (dish_id, item_id),
  -- Only a group item's cost is charged in a ledger: a personal pantry has none.
  CHECK (use_txn_id IS NULL OR org_id IS NOT NULL)
);

-- The dishes an item went into (its history).
CREATE INDEX IF NOT EXISTS kitchen_dish_ingredients_item_idx
  ON kitchen_dish_ingredients (item_id);

-- A dish's stock moves: what cancelling it puts back.
CREATE INDEX IF NOT EXISTS kitchen_stock_moves_dish_idx
  ON kitchen_stock_moves (dish_id) WHERE dish_id IS NOT NULL;

-- table kitchen_dishes: One dish a cook made, shared with a group or just for them. Its ingredients are kitchen_dish_ingredients.
-- column kitchen_dishes.id: Dish id (UUID); crosses the API as dsh_<32 hex>.
-- column kitchen_dishes.cook: Who cooked it (usr_…); the only one who may cancel it.
-- column kitchen_dishes.org_id: The group it is shared with — opaque reference to membership_organizations.id, no cross-context FK; null for just the cook.
-- column kitchen_dishes.portions_half: Portions × 2 (half portions are allowed); above zero.
-- column kitchen_dishes.extras_minor: Gas, spices and the like, paid by the cook, in minor units.
-- column kitchen_dishes.ingredients_minor: What its ingredients cost, Σ kitchen_dish_ingredients.cost_minor.
-- column kitchen_dishes.total_minor: ingredients_minor + extras_minor.
-- column kitchen_dishes.currency: ISO 4217 code: every ingredient's, and the shared group's.
-- column kitchen_dishes.split_mode: assign (the cook sets the shares) | claims (members claim portions; needs a group).
-- column kitchen_dishes.state: draft (assign) | open (claims) | finalized | canceled.
-- column kitchen_dishes.txn_id: The dish transaction once finalized (CP-16).
-- column kitchen_dishes.leftover_item_id: The leftovers, as an item (CP-16).
-- column kitchen_dishes.cooked_at: When it was cooked (the list order).
-- column kitchen_dishes.finalized_at: When its shares were posted; set exactly when finalized.
-- column kitchen_dishes.canceled_at: When it was canceled; set exactly when canceled.
-- column kitchen_dishes.idem_key: The cooking request Idempotency-Key (or one minted for it); unique per cook.
-- table kitchen_dish_ingredients: One item taken for a dish, from any pantry the cook could use.
-- column kitchen_dish_ingredients.position: The order the cook listed it in.
-- column kitchen_dish_ingredients.qty_milli: How much was taken, in thousandths of the item base unit.
-- column kitchen_dish_ingredients.unit: The unit it was entered in (as the stock move records it).
-- column kitchen_dish_ingredients.cost_minor: What it cost (the engine costOfUse, the last use taking what is left of the price).
-- column kitchen_dish_ingredients.org_id: The group pantry it came from; null for the cook own pantry.
-- column kitchen_dish_ingredients.paid_by: Who bought the item (usr_…).
-- column kitchen_dish_ingredients.use_txn_id: The use transaction in that group that charged the cook for it; null when nobody else paid for it.
