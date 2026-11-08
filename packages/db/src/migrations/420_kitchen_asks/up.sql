-- 420_kitchen_asks: ask before use — a group item its buyer guards, the
-- people who never need to ask, and the asks themselves.
--
-- Context: kitchen
-- Epic: cookpool-pantry (PN-8, design §8.5) — the buyer of a group item can
--       turn on "Ask me first" (saffron, the good olive oil). Anyone else in
--       the group then asks for an amount, for the people who will have it;
--       nothing comes off the stock and no money moves until the buyer (or an
--       admin, once the buyer has left the group) approves. Approving posts
--       the use exactly as the asker would have, at that moment's price and
--       stock, as one ordinary `use` move with via = 'ask' (410). The buyer
--       can let named people skip asking.
--
-- Design rules:
--   * Additive and idempotent: one column on kitchen_items (SQLite has no ADD
--     COLUMN IF NOT EXISTS, so the runner's applied ledger keeps it from
--     running twice) and two new tables, CREATE … IF NOT EXISTS.
--   * ask_first is 0 or 1, 0 for every item there is: off by default, and
--     only kitchen-worker's group routes ever set it (a personal item never
--     asks). The CHECK also lets a guarded write fail its batch on purpose.
--   * kitchen_item_allowed is a set per item: one row per member who never
--     needs to ask. It is kept when ask_first is turned off, so turning it
--     back on keeps the list.
--   * An ask records the request, never the money: qty_milli in thousandths
--     of the item's base unit, the unit it was asked in, the measure's words
--     (label, "1 pinch") when it was asked in one, the consumers (a JSON array
--     of usr_… ids) and their weights (NULL: equal shares). Approving prices
--     it then; the move and the transaction it posted are named by move_id
--     and txn_id (txn_id NULL when it moved no money).
--   * state is what was decided: pending, approved, declined or canceled.
--     Lapsing is read-side, never written: a pending ask past expires_at
--     (created_at + 24 h), or on an item no longer active or no longer
--     ask-first, reads as lapsed. answered_at and answered_by say who decided
--     and when (the asker, for a cancel).
--   * granted says the approval added the asker to the item's allowed list
--     ("Always let Dev"), so undoing that approval takes it back off.
--   * Retries are safe: idem_key (the asker's Idempotency-Key) is unique per
--     item, as a move's is.
--   * Indexes: an item's asks by state (the toAnswer read, the lapse rules),
--     and a person's own asks by time (their "mine" read). Every time is an
--     ISO 8601 UTC instant as toISOString() writes it, so text order is time
--     order.
--   * org_id is an opaque reference to membership_organizations.id with no
--     cross-context FK; subject ids are public ids (usr_…).

ALTER TABLE kitchen_items ADD COLUMN ask_first INTEGER NOT NULL DEFAULT 0
  CHECK (ask_first IN (0, 1));

CREATE TABLE IF NOT EXISTS kitchen_item_allowed (
  item_id     TEXT NOT NULL REFERENCES kitchen_items(id),
  member_id   TEXT NOT NULL CHECK (length(member_id) BETWEEN 1 AND 128),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (item_id, member_id)
);

CREATE TABLE IF NOT EXISTS kitchen_asks (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  item_id      TEXT NOT NULL REFERENCES kitchen_items(id),
  asker_id     TEXT NOT NULL CHECK (length(asker_id) BETWEEN 1 AND 128),
  qty_milli    INTEGER NOT NULL CHECK (qty_milli > 0),
  unit         TEXT NOT NULL CHECK (length(unit) BETWEEN 1 AND 16),
  label        TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 80),
  consumers    TEXT NOT NULL CHECK (
                 json_valid(consumers) AND json_type(consumers) = 'array'
                 AND json_array_length(consumers) BETWEEN 1 AND 100
               ),
  weights      TEXT CHECK (weights IS NULL OR (
                 json_valid(weights) AND json_type(weights) = 'array'
                 AND json_array_length(weights) = json_array_length(consumers)
               )),
  source       TEXT NOT NULL DEFAULT 'pantry' CHECK (source IN ('pantry', 'cook')),
  state        TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'declined', 'canceled')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  answered_at  TEXT,
  answered_by  TEXT,
  move_id      TEXT,
  txn_id       TEXT,
  granted      INTEGER NOT NULL DEFAULT 0 CHECK (granted IN (0, 1)),
  idem_key     TEXT NOT NULL,
  CHECK (expires_at > created_at),
  -- Approved is exactly the state with a move; only an approval sets txn_id.
  CHECK ((state = 'approved') = (move_id IS NOT NULL)),
  CHECK (txn_id IS NULL OR state = 'approved'),
  -- A pending ask has no answer; every other state says who decided, and when.
  CHECK ((state = 'pending') = (answered_at IS NULL AND answered_by IS NULL))
);

CREATE INDEX IF NOT EXISTS kitchen_asks_item_state_idx
  ON kitchen_asks (item_id, state);

CREATE INDEX IF NOT EXISTS kitchen_asks_asker_idx
  ON kitchen_asks (asker_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_asks_item_idem_uq
  ON kitchen_asks (item_id, idem_key);

-- column kitchen_items.ask_first: 1 when the item's buyer asks to be asked first (Cookpool PN-8): anyone else in the group, unless allowed, asks before using it; 0 (the default) for every other item, and always for a personal item.
-- table kitchen_item_allowed: The members who never need to ask before using an ask-first group item (Cookpool PN-8), one row each; set by the item's buyer, or an admin once the buyer has left.
-- column kitchen_item_allowed.item_id: The item.
-- column kitchen_item_allowed.member_id: The member (usr_…) who may use it without asking.
-- column kitchen_item_allowed.created_at: When they were let.
-- table kitchen_asks: Asks to use an ask-first group item (Cookpool PN-8): pending until the buyer (or an admin, once the buyer has left) approves or declines, or the asker cancels; a pending ask past expires_at, or on an item no longer active or ask-first, reads as lapsed.
-- column kitchen_asks.id: The ask (ask_ + 32 hex in the API).
-- column kitchen_asks.org_id: The group whose pantry the item is in.
-- column kitchen_asks.item_id: The item asked for.
-- column kitchen_asks.asker_id: Who asked (usr_…).
-- column kitchen_asks.qty_milli: How much, in thousandths of the item's base unit.
-- column kitchen_asks.unit: The unit it was asked in (the item's own when it was asked in a measure).
-- column kitchen_asks.label: The measure's words when it was asked in one ("1 pinch"); NULL for an amount in a unit.
-- column kitchen_asks.consumers: Who will have it: a JSON array of usr_… ids, the consumers of the use an approval posts.
-- column kitchen_asks.weights: Their weights, one per consumer; NULL for equal shares.
-- column kitchen_asks.source: Where it was asked from: pantry (the Pantry or the item page) or cook (a cook session's ingredient line).
-- column kitchen_asks.state: pending, approved, declined or canceled; lapsing is read-side.
-- column kitchen_asks.created_at: When it was asked.
-- column kitchen_asks.expires_at: When a pending ask lapses: 24 hours after it was asked.
-- column kitchen_asks.answered_at: When it was approved, declined or canceled; NULL while pending.
-- column kitchen_asks.answered_by: Who approved or declined it, or the asker for a cancel; NULL while pending.
-- column kitchen_asks.move_id: The use move its approval posted (via = 'ask'); NULL unless approved.
-- column kitchen_asks.txn_id: The use transaction its approval posted; NULL unless that use moved money.
-- column kitchen_asks.granted: 1 when its approval also added the asker to the item's allowed list.
-- column kitchen_asks.idem_key: The asker's Idempotency-Key, unique per item: a retried ask answers with the ask it made.
