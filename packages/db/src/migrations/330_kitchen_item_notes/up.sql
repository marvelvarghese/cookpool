-- 330_kitchen_item_notes: an item's note — one line about it, "For Sunday's curry".
--
-- Context: kitchen
-- Epic: cookpool-recipes (RC-3, design §1.5 and §6) — an item takes an
--       optional note of at most 80 characters, set on Bought and on the
--       item's page and shown as a third line on its pantry row. It lives on
--       the item, so who can read it is who can read the item: in a person's
--       own pantry only they do; in a group's pantry everyone in the group.
--
-- Design rules:
--   * Additive: one nullable column with no default, so every item written
--     before reads as NULL (no note). SQLite has no ADD COLUMN IF NOT EXISTS,
--     so the runner's applied ledger is what keeps the add from running twice
--     (as 240, 260, 280, 290 and 300 do).
--   * At most 80 characters, by SQLite's own length() (characters, not
--     bytes). kitchen-worker trims it and stores an empty note as NULL, so a
--     stored note is never blank; the CHECK is the last guard on the length.
--   * No money: a note is words only. Setting or clearing it writes no ledger
--     transaction and no stock move, and changes no price or quantity.

ALTER TABLE kitchen_items ADD COLUMN note TEXT
  CHECK (note IS NULL OR length(note) <= 80);

-- column kitchen_items.note: One line about the item ("For Sunday's curry"), at most 80 characters, trimmed; null when it has none. Read by whoever can read the item.
