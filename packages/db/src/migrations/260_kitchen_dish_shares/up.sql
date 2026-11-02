-- 260_kitchen_dish_shares: who had how much of a dish.
--
-- Context: kitchen
-- Epic: cookpool-kitchen (CP-16) — splitting a dish among the people who ate
--       it. Members claim half portions of an open dish (claims mode), or the
--       cook assigns each eater portions or an exact amount (assign mode).
--       Finalizing posts one `dish` transaction in the dish's group from these
--       rows: the cook paid the total, each eater owes their share, and the
--       portions nobody had fall to the cook (and become leftovers in the
--       cook's own pantry). A correction replaces the rows, reverses the dish
--       transaction and posts a new one, in one batch.
--
-- Design rules:
--   * Additive: one new table, and one column on kitchen_dishes with a
--     constant default (every existing dish reads as version 1). SQLite has
--     no ADD COLUMN IF NOT EXISTS, so the runner's applied ledger is what
--     keeps the column add from running twice (as 240 does).
--   * A share is portions (half portions, portions_half) OR an exact amount
--     (exact_minor), never both and never neither (the CHECK). Exact amounts
--     come off the top of the dish total; the rest is split by portions.
--   * One row per eater per dish: UNIQUE (dish_id, subject_id). A claim is
--     an upsert of the claimer's own row (source self); the cook's
--     assignment replaces every row (source cook).
--   * position keeps the order eaters were listed in (the cook's assignment)
--     or claimed in: the split's ties (the odd paisa) follow it, after the
--     cook, who is always listed first.
--   * kitchen_dishes.version counts every change to a dish's shares and
--     state. A claim or an assignment bumps it in the batch that writes the
--     rows; finalizing and correcting apply only at the version they were
--     planned from, so a claim landing in between fails the batch and the
--     write is planned again from a fresh read.
--   * Whether claims exceed the portions spans rows, so no CHECK can say it:
--     the claim's batch refuses itself through the dish's NOT NULL state.
--   * subject ids are public ids (usr_…).

ALTER TABLE kitchen_dishes ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

CREATE TABLE IF NOT EXISTS kitchen_dish_shares (
  id             TEXT PRIMARY KEY,
  dish_id        TEXT NOT NULL REFERENCES kitchen_dishes(id),
  subject_id     TEXT NOT NULL,
  position       INTEGER NOT NULL CHECK (position >= 0),
  portions_half  INTEGER CHECK (portions_half IS NULL OR portions_half > 0),
  exact_minor    INTEGER CHECK (exact_minor IS NULL OR exact_minor >= 0),
  source         TEXT NOT NULL CHECK (source IN ('cook', 'self')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (dish_id, subject_id),
  -- Portions or an exact amount: exactly one of them.
  CHECK ((portions_half IS NULL) <> (exact_minor IS NULL))
);

-- column kitchen_dishes.version: Counts changes to the dish shares and state; finalize and correct apply only at the version they read (CP-16).
-- table kitchen_dish_shares: One eater share of a dish — half portions or an exact amount — claimed by them or assigned by the cook.
-- column kitchen_dish_shares.id: Share id (UUID); crosses the API as dsr_<32 hex>.
-- column kitchen_dish_shares.dish_id: The dish (kitchen_dishes.id).
-- column kitchen_dish_shares.subject_id: Who had it (usr_…), a member of the dish group.
-- column kitchen_dish_shares.position: The order they were listed in or claimed in; the split ties follow it, after the cook.
-- column kitchen_dish_shares.portions_half: Half portions they had (1 = ½); null for an exact amount.
-- column kitchen_dish_shares.exact_minor: A fixed amount they owe, in minor units; null for portions.
-- column kitchen_dish_shares.source: self (claimed by the eater) | cook (assigned by the cook).
