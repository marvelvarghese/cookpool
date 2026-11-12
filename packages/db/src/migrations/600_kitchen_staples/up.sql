-- 600_kitchen_staples: Always have per pantry, and the shopping list.
--
-- Context: kitchen
-- Epic: cookpool-revamp (RV-21, the board RvKitchenB and RvShopping) — every
--       pantry has its own Always have: yours ("Mine") and each group's. A
--       staple is a name (linked to the food list when one matches), with a
--       status (ok, running low, out) and what it last cost. A group's
--       staples are bought for the group: Bought posts one plain expense,
--       split equally among the group's current members, and sets the
--       staple back to ok in the same batch. Your own are not split: Bought
--       records the price. Staples running low or out, plus items people add
--       by hand, are the shopping list.
--
-- Design rules:
--   * Additive: two new tables and their indexes. Nothing existing changes.
--   * kitchen_staples.owner_kind is 'user' (owner_id the person's usr_…) or
--     'group' (owner_id the group's UUID), as kitchen_food_answers keys a
--     pantry. One name per pantry: name_key is lower(trim(name)), unique per
--     owner.
--   * The personal Always have list moves here. Until now it lived in
--     kitchen_always_have (340); Cook now counts a person's personal staples
--     that link to a food from this migration on, and Always have's PUT
--     writes them. The copy below takes every saved list's foods, with the
--     food's name, status ok. kitchen_always_have and
--     kitchen_always_have_lists stay: the lists table still says whether a
--     person has saved a list (until then they read salt and water), and the
--     old table is left in place, unread, so a worker still running the
--     previous code keeps working until it is replaced.
--   * The copy is re-runnable: INSERT OR IGNORE on the (owner, name_key)
--     index, so a rerun adds nothing twice. Ids are random UUIDs made in SQL
--     (version 4, variant 8–b).
--   * want_qty_milli / want_unit: the amount the shopping list asks for a
--     staple (NULL: what it was last bought in, last_qty_milli / last_unit).
--     Quantities are thousandths of the base unit, as kitchen_items counts
--     them; the unit is the one shown.
--   * kitchen_shopping_items: a line someone added to a pantry's shopping
--     list by hand, one name per pantry, with an optional amount and who
--     added it. Picking a line up is the device's; buying it deletes the row.
--   * No LIKE or GLOB (D1 limits a pattern to 50 bytes).

CREATE TABLE IF NOT EXISTS kitchen_staples (
  id               TEXT PRIMARY KEY CHECK (length(id) = 36),
  owner_kind       TEXT NOT NULL CHECK (owner_kind IN ('user', 'group')),
  owner_id         TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 64),
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  name_key         TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 60),
  food_key         TEXT REFERENCES kitchen_foods(key),
  status           TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'low', 'out')),
  last_price_minor INTEGER CHECK (last_price_minor IS NULL OR last_price_minor BETWEEN 0 AND 100000000000),
  currency         TEXT CHECK (currency IS NULL OR length(currency) = 3),
  last_qty_milli   INTEGER CHECK (last_qty_milli IS NULL OR last_qty_milli > 0),
  last_unit        TEXT CHECK (last_unit IS NULL OR length(last_unit) BETWEEN 1 AND 24),
  want_qty_milli   INTEGER CHECK (want_qty_milli IS NULL OR want_qty_milli > 0),
  want_unit        TEXT CHECK (want_unit IS NULL OR length(want_unit) BETWEEN 1 AND 24),
  last_txn_id      TEXT,
  bought_at        TEXT,
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_by       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_staples_owner_name_idx ON kitchen_staples (owner_kind, owner_id, name_key);

CREATE TABLE IF NOT EXISTS kitchen_shopping_items (
  id          TEXT PRIMARY KEY CHECK (length(id) = 36),
  owner_kind  TEXT NOT NULL CHECK (owner_kind IN ('user', 'group')),
  owner_id    TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 64),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  name_key    TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 60),
  qty_milli   INTEGER CHECK (qty_milli IS NULL OR qty_milli > 0),
  unit        TEXT CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 24),
  added_by    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_shopping_items_owner_name_idx ON kitchen_shopping_items (owner_kind, owner_id, name_key);

-- Every saved personal Always have list, copied as personal staples.
INSERT OR IGNORE INTO kitchen_staples (
  id, owner_kind, owner_id, name, name_key, food_key, status,
  created_by, created_at, updated_by, updated_at
)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  'user', a.user_id, f.name, lower(trim(f.name)), a.food_key, 'ok',
  a.user_id, a.created_at, a.user_id, a.created_at
FROM kitchen_always_have a
JOIN kitchen_foods f ON f.key = a.food_key;

-- column kitchen_staples.owner_kind: user (owner_id a usr_ id) or group (owner_id the group UUID).
-- column kitchen_staples.status: ok, low (running low) or out; low and out put it on the shopping list.
-- column kitchen_staples.last_price_minor: What it cost the last time it was bought, in minor units of currency.
-- column kitchen_staples.want_qty_milli: The amount the shopping list asks for, thousandths of the base unit; NULL means last_qty_milli.
-- column kitchen_staples.last_txn_id: The group expense its last Bought posted (UUID); NULL for a personal staple.
-- column kitchen_shopping_items.qty_milli: The amount wanted, thousandths of the base unit; NULL when none was given.
