-- 290_kitchen_dish_share_setter: who set each share of a dish.
--
-- Context: kitchen
-- Epic: cookpool-simpler (SM-6) — anyone sets anyone's portion. Until now a
--       member claimed only their own portion of an open dish, and only the
--       cook assigned other people's. Now any member of the dish's group may
--       set any member's portion (PUT …/claims/{subjectId}), so a row needs to
--       say who wrote it: the app shows "by Anu", and the person whose portion
--       someone else set is emailed once.
--
-- Design rules:
--   * Additive: one nullable column, no default. Rows written before this
--     migration read as NULL (nobody recorded who set them). SQLite has no
--     ADD COLUMN IF NOT EXISTS, so the runner's applied ledger is what keeps
--     the column add from running twice (as 240, 260 and 280 do).
--   * Every share write records its caller: a claim (claims/me, or
--     claims/{subjectId} for someone else), the cook's assignment
--     (…/shares — the cook, or the owner or admin who split a stuck dish) and
--     a correction. The latest write wins, and its author with it.
--   * source keeps what it said: which route wrote the row — self, a claim
--     (now made by the eater or by another member for them); cook, the
--     assignment or a correction. set_by says who.
--   * set_by is a public id (usr_…), as subject_id is.

ALTER TABLE kitchen_dish_shares ADD COLUMN set_by TEXT;

-- column kitchen_dish_shares.set_by: Who wrote the share (usr_…): the eater claiming it, another member setting it for them, or whoever assigned or corrected the shares; null for shares written before SM-6.
