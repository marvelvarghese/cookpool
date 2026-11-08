-- 400_kitchen_purchases: a shopping run's items belong to one purchase.
--
-- Context: kitchen
-- Epic: cookpool-pantry (PN-3, design §6.4) — a shopping run adds many items
--       across the caller's pantries in one write, paid by the caller, and
--       its Undo removes them all. Every item the run adds carries the run's
--       purchase id (pur_… in the API), so the Undo finds them in one lookup.
--
-- Design rules:
--   * Additive: one nullable column with no default, so every item written
--     before (and every item added one at a time, cooked as leftovers or
--     bought while cooking) reads as NULL — in no purchase. SQLite has no ADD
--     COLUMN IF NOT EXISTS, so the runner's applied ledger is what keeps the
--     add from running twice (as 240, 290, 300 and 330 do).
--   * No purchases table: a purchase is the set of items sharing the id, with
--     one payer and one creator, written in one batch. Its money is the items'
--     own prices; buying moves none (CP-10), so there is nothing else to keep.
--   * The index serves the Undo (every item of one purchase) and the replay of
--     a retried run; it is partial, over the items that are in a purchase.
--   * No index for the restock read's name lookups: that read groups the
--     caller's pantries by name in one statement, through the owner and group
--     indexes the pantry lists already walk (as the "from before" read does).

ALTER TABLE kitchen_items ADD COLUMN purchase_id TEXT;

CREATE INDEX IF NOT EXISTS kitchen_items_purchase_idx
  ON kitchen_items (purchase_id) WHERE purchase_id IS NOT NULL;

-- column kitchen_items.purchase_id: The shopping run (purchase) that added the item — a UUID, pur_<32 hex> in the API — shared by every item that run added; null for an item added on its own.
