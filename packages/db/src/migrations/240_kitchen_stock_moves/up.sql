-- 240_kitchen_stock_moves: what a stock move records once people use, waste,
-- move and undo things.
--
-- Context: kitchen
-- Epic: cookpool-kitchen (CP-11) — using some of an item (alone or for
--       several people), waste, moving a personal item into a group, and
--       undoing a move. 230_kitchen_pantry created kitchen_stock_moves with
--       nothing writing it; this adds what those writes need to say.
--
-- Design rules:
--   * Additive: four nullable columns and two partial unique indexes on a
--     table nothing has written yet. SQLite has no ADD COLUMN IF NOT EXISTS,
--     so the runner's applied ledger is what keeps the column adds from
--     running twice.
--   * consumers is who had it (a use): a JSON array of usr_… in the order
--     they were named. A use where every consumer is the buyer posts no
--     transaction, so the move is the only place that says who had it; the
--     history and the usuals read it.
--   * unit is the unit the move was logged in ("250 ml" of a 1 L item), so
--     history and "Do it again" show it as it was entered.
--   * A move is undone by a later `reversal` move pointing at it through
--     reverses, never by an update: the unique index below means a move is
--     put back at most once, even under racing undos, and only a reversal
--     points at anything (the CHECK).
--   * Retries are safe: idem_key (the request Idempotency-Key) is unique per
--     item, so a retried use or waste answers with the move it made instead
--     of taking the stock twice. Reversal moves written by a ledger reversal
--     carry none: the reversal transaction's own key covers them.

ALTER TABLE kitchen_stock_moves ADD COLUMN consumers TEXT
  CHECK (consumers IS NULL OR (json_valid(consumers) AND json_type(consumers) = 'array'));

ALTER TABLE kitchen_stock_moves ADD COLUMN unit TEXT
  CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 16);

ALTER TABLE kitchen_stock_moves ADD COLUMN reverses TEXT REFERENCES kitchen_stock_moves(id)
  CHECK ((kind = 'reversal') = (reverses IS NOT NULL));

ALTER TABLE kitchen_stock_moves ADD COLUMN idem_key TEXT;

-- column kitchen_stock_moves.consumers: For a use, who had it: a JSON array of subject ids (usr_…) in the order named; null for every other kind.
-- column kitchen_stock_moves.unit: The unit the move was logged in (g, kg, ml, L, tsp, tbsp, cup, pcs, dozen, pack); null reads as the item display unit.
-- column kitchen_stock_moves.reverses: For a reversal, the move it puts back (unique: a move is undone at most once).
-- column kitchen_stock_moves.idem_key: The request Idempotency-Key (or one minted for it); unique per item. Null on reversals a ledger reversal wrote.

-- A move is put back at most once: a second reversal of it is refused here.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_stock_moves_reverses_uq
  ON kitchen_stock_moves (reverses) WHERE reverses IS NOT NULL;

-- A retried use, waste or undo is answered with the move it made, once per item.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_stock_moves_item_idem_uq
  ON kitchen_stock_moves (item_id, idem_key) WHERE idem_key IS NOT NULL;
