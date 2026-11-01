-- 230_kitchen_pantry: every pantry's items, and every change to their stock.
--
-- Context: kitchen
-- Epic: cookpool-kitchen (CP-10) — a personal pantry per person and a pantry
--       per group. An item is something bought: what it is, how much, in which
--       unit, what was paid, who paid and when it should be used by. Using,
--       wasting and moving stock (CP-11) and cooking with it (CP-14) write
--       kitchen_stock_moves; this migration creates both tables.
--
-- Design rules:
--   * Additive and idempotent: CREATE … IF NOT EXISTS only.
--   * An item belongs to exactly one pantry. A personal item carries the
--     person (owner_subject_id) and no org_id; a group item carries the group
--     (org_id) and no person. The owner CHECK below says so. Personal rows are
--     the one deliberate exception to "every table carries org_id" (design.md
--     §1.2, risks CP-K): they follow their owner across every group.
--   * Quantities are integers in thousandths of the dimension base unit
--     (piece, gram, millilitre, pack): qty_left_milli never goes below zero
--     or above what was bought, so an over-draw fails the batch it is in.
--   * Money is integer minor units. cost_taken_minor is the part of the price
--     already charged to uses, waste and dishes; it never exceeds the price,
--     so the use that takes the last of an item can charge exactly the rest.
--   * A group item is in the group currency (kitchen-worker pins the group
--     settings row with the first item or transaction, as the ledger does).
--   * Retries are safe: idem_key is unique per pantry.
--   * version counts edits (optimistic concurrency for PATCH).
--   * org_id is an opaque reference to membership_organizations.id (a bare
--     UUID) with no cross-context FK; subject ids are public ids (usr_…).

CREATE TABLE IF NOT EXISTS kitchen_items (
  id                TEXT PRIMARY KEY,
  owner_kind        TEXT NOT NULL CHECK (owner_kind IN ('user', 'group')),
  owner_subject_id  TEXT,
  org_id            TEXT,
  name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  category          TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 60),
  dimension         TEXT NOT NULL CHECK (dimension IN ('count', 'mass', 'volume', 'pack')),
  display_unit      TEXT NOT NULL CHECK (length(display_unit) BETWEEN 1 AND 16),
  qty_bought_milli  INTEGER NOT NULL CHECK (qty_bought_milli > 0),
  qty_left_milli    INTEGER NOT NULL CHECK (qty_left_milli >= 0 AND qty_left_milli <= qty_bought_milli),
  price_minor       INTEGER NOT NULL CHECK (price_minor >= 0),
  cost_taken_minor  INTEGER NOT NULL DEFAULT 0 CHECK (cost_taken_minor >= 0 AND cost_taken_minor <= price_minor),
  currency          TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  paid_by           TEXT NOT NULL,
  bought_on         TEXT NOT NULL CHECK (bought_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expires_on        TEXT CHECK (expires_on IS NULL OR expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  waste_policy      TEXT CHECK (waste_policy IS NULL OR waste_policy IN ('split_equally', 'buyer_absorbs')),
  source_dish_id    TEXT,
  state             TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'used_up', 'wasted', 'removed')),
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by        TEXT NOT NULL,
  idem_key          TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Exactly one pantry: a person or a group, never both, never neither.
  CHECK ((owner_kind = 'user' AND owner_subject_id IS NOT NULL AND org_id IS NULL)
      OR (owner_kind = 'group' AND org_id IS NOT NULL AND owner_subject_id IS NULL)),
  -- Waste of a personal item moves no money, so it has no waste rule.
  CHECK (owner_kind = 'group' OR waste_policy IS NULL)
);

-- A person's own pantry, by state (the all-pantries view, search, the purge by subject).
CREATE INDEX IF NOT EXISTS kitchen_items_owner_state_idx
  ON kitchen_items (owner_subject_id, state);

-- A group pantry, by state.
CREATE INDEX IF NOT EXISTS kitchen_items_org_state_idx
  ON kitchen_items (org_id, state);

-- What to use soon: the daily sweep reads active items by use-by date.
CREATE INDEX IF NOT EXISTS kitchen_items_expires_idx
  ON kitchen_items (expires_on) WHERE state = 'active';

-- A retried add is answered with the item it added, once per pantry.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_items_owner_idem_uq
  ON kitchen_items (owner_subject_id, idem_key) WHERE owner_subject_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_items_org_idem_uq
  ON kitchen_items (org_id, idem_key) WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kitchen_stock_moves (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES kitchen_items(id),
  kind        TEXT NOT NULL CHECK (kind IN ('use', 'dish', 'waste', 'transfer', 'adjust', 'reversal')),
  qty_milli   INTEGER NOT NULL CHECK (qty_milli > 0),
  cost_minor  INTEGER NOT NULL CHECK (cost_minor >= 0),
  actor       TEXT NOT NULL,
  txn_id      TEXT REFERENCES kitchen_txns(id),
  dish_id     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- An item history, oldest first.
CREATE INDEX IF NOT EXISTS kitchen_stock_moves_item_idx
  ON kitchen_stock_moves (item_id, created_at);

-- The moves a transaction made (undo reverses them together).
CREATE INDEX IF NOT EXISTS kitchen_stock_moves_txn_idx
  ON kitchen_stock_moves (txn_id) WHERE txn_id IS NOT NULL;

-- table kitchen_items: One item in one pantry — a person (owner_kind user) or a group (owner_kind group).
-- column kitchen_items.id: Item id (UUID); crosses the API as itm_<32 hex>.
-- column kitchen_items.owner_kind: user (a personal pantry) | group (a group pantry).
-- column kitchen_items.owner_subject_id: For a personal item, its owner (usr_…); null for a group item.
-- column kitchen_items.org_id: For a group item, the group — opaque reference to membership_organizations.id, no cross-context FK; null for a personal item.
-- column kitchen_items.dimension: count | mass | volume | pack; quantities never convert across dimensions.
-- column kitchen_items.display_unit: The unit it was entered in (pcs, dozen, g, kg, ml, L, tsp, tbsp, cup, pack).
-- column kitchen_items.qty_bought_milli: What was bought, in thousandths of the dimension base unit.
-- column kitchen_items.qty_left_milli: What is left, in the same unit; 0 to qty_bought_milli.
-- column kitchen_items.price_minor: What was paid, in integer minor units of currency.
-- column kitchen_items.cost_taken_minor: The part of the price already charged to uses, waste and dishes.
-- column kitchen_items.currency: ISO 4217 code; a group item is in the group currency.
-- column kitchen_items.paid_by: Who paid (usr_…), the buyer.
-- column kitchen_items.bought_on: ISO date it was bought.
-- column kitchen_items.expires_on: ISO use-by date, if any.
-- column kitchen_items.waste_policy: A group item override of the group waste rule; null follows the group (always null for a personal item).
-- column kitchen_items.source_dish_id: Set when the item is a dish leftovers (CP-16).
-- column kitchen_items.state: active | used_up | wasted | removed (added by mistake; only while nothing was used).
-- column kitchen_items.version: Starts at 1 and counts edits (optimistic concurrency).
-- column kitchen_items.created_by: Who added it (usr_…); may differ from paid_by.
-- column kitchen_items.idem_key: The adding request Idempotency-Key (or one minted for it); unique per pantry.
-- table kitchen_stock_moves: Every change to an item qty_left — a use, a dish ingredient, waste, a transfer, an adjustment or a reversal.
-- column kitchen_stock_moves.kind: use | dish | waste | transfer | adjust | reversal.
-- column kitchen_stock_moves.qty_milli: How much moved, in thousandths of the item base unit (always positive).
-- column kitchen_stock_moves.cost_minor: What it cost, in minor units.
-- column kitchen_stock_moves.actor: Who logged it (usr_…).
-- column kitchen_stock_moves.txn_id: The ledger transaction it belongs to, if it moved money.
-- column kitchen_stock_moves.dish_id: The dish it went into (no FK until dishes exist, CP-14).
