-- 460_kitchen_split_later: a dish cooked as the cook's own, split with a
-- group later; and Home's reminder to split it, which its cook can dismiss.
--
-- Context: kitchen
-- Epic: cookpool-community (CM-8, design §2a) — cooking ends at Cooked! with
--       the dish saved as the cook's own (org_id NULL, as a "just me" dish
--       always was). Posting it to Community and splitting it with a group
--       are separate actions, in any order or never. Splitting later sets
--       the dish's org_id once, and from then on it is a group dish like any
--       other: open for claims (or a draft for its cook's shares), finalized
--       with one `dish` transaction. Its money total is what it was at cook
--       time; nothing moves until the split's shares are finalized.
--
-- Design rules:
--   * Additive: two nullable columns on kitchen_dishes, no default. SQLite
--     has no ADD COLUMN IF NOT EXISTS, so the runner's applied ledger is
--     what keeps them from being added twice (as 260 does).
--   * split_at is when a dish cooked as its cook's own was split with a
--     group: set exactly once, in the batch that sets org_id, and only on a
--     dish that has a group (the CHECK). A dish cooked straight into a group
--     keeps it NULL.
--   * split_dismissed_at is when the cook dismissed Home's split reminder
--     for the dish; NULL while it would still remind (Undo clears it).
--   * No new index: the reminder reads one cook's recent dishes, which
--     kitchen_dishes_cook_idx (cook, cooked_at) already orders.

ALTER TABLE kitchen_dishes ADD COLUMN split_at TEXT CHECK (split_at IS NULL OR org_id IS NOT NULL);

ALTER TABLE kitchen_dishes ADD COLUMN split_dismissed_at TEXT;

-- column kitchen_dishes.split_at: When a dish cooked as its cook own was split with a group (org_id set then); NULL for a dish cooked into a group or never split.
-- column kitchen_dishes.split_dismissed_at: When the cook dismissed the Home reminder to split this dish; NULL while it would remind.
