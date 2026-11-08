-- 410_kitchen_moves_via: what wrote a stock move, when it was not a plain use,
-- waste or undo.
--
-- Context: kitchen
-- Epic: cookpool-pantry (PN-4, design §7) — the stock check sets what is
--       really left of an item. Less than expected becomes a use by the
--       checker, a use split across the group's members, or waste under the
--       item's rule; more becomes an `adjust` move. Every move a check writes
--       is an ordinary use, waste or adjust, so money, Undo and history work
--       as they always have; via says a check wrote it, so history can read
--       "Stock check · 250 ml split with Flat 4B". PN-8 (ask before use) will
--       write 'ask' on the use an approval posts: it is in the CHECK now so
--       PN-8 needn't rebuild the column.
--
-- Design rules:
--   * Additive: one nullable column on kitchen_stock_moves. Every move
--     written before reads NULL, which means "logged directly". SQLite has
--     no ADD COLUMN IF NOT EXISTS, so the runner's applied ledger is what
--     keeps the add from running twice.
--   * Only 'check' or 'ask', or NULL: the CHECK refuses anything else.
--   * A reversal never carries it: an undo is an undo, whatever wrote the
--     move it puts back.

ALTER TABLE kitchen_stock_moves ADD COLUMN via TEXT
  CHECK (via IS NULL OR via IN ('check', 'ask'));

-- column kitchen_stock_moves.via: What wrote the move when it was not logged directly: check (a stock check, PN-4) or ask (an approved ask, PN-8); null for every other move.
