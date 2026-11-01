-- 220_kitchen_ledger: every Cookpool group's ledger.
--
-- Context: kitchen
-- Epic: cookpool-kitchen (CP-7) — expenses, settlements, reversals and flags.
--       A transaction is one money event in one group's ledger; its splits say
--       who paid what and who owes what. Balances, the fewest-payments plan
--       and every "why" view are derived from these rows; nothing stores a
--       running balance.
--
-- Design rules:
--   * Additive and idempotent: CREATE … IF NOT EXISTS only.
--   * Append-only: a transaction is never updated or deleted. A correction is
--     a new `reversal` transaction whose splits swap paid and owed, pointing at
--     the original through `reverses`. The partial unique index on `reverses`
--     means a transaction can be reversed once; whether a transaction has been
--     reversed is read by joining on it (there is no reversed_by column to
--     update).
--   * Money is integer minor units in the group's one currency. Σ paid_minor =
--     Σ owed_minor = total_minor per transaction is kept by kitchen-worker (it
--     spans rows, so no CHECK can say it); the per-row CHECKs below keep every
--     amount non-negative.
--   * Every money write is ONE D1 batch: the transaction row, all its split
--     rows and its audit event land together or not at all.
--   * Retries are safe: (org_id, idem_key) is unique, so a replayed
--     Idempotency-Key cannot post twice.
--   * org_id is an opaque reference to membership_organizations.id (a bare
--     UUID) with no cross-context FK; subject ids are the actor's public id
--     (`usr_…`), as membership stores them.

CREATE TABLE IF NOT EXISTS kitchen_txns (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('expense', 'use', 'dish', 'waste', 'settlement', 'reversal')),
  title        TEXT NOT NULL,
  total_minor  INTEGER NOT NULL CHECK (total_minor >= 0),
  currency     TEXT NOT NULL CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  occurred_at  TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  source_kind  TEXT,
  source_id    TEXT,
  reverses     TEXT REFERENCES kitchen_txns(id),
  method       TEXT,
  note         TEXT,
  idem_key     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, idem_key),
  -- Only a reversal reverses something, and every reversal does.
  CHECK ((kind = 'reversal') = (reverses IS NOT NULL)),
  -- Only a settlement says how it was paid.
  CHECK (method IS NULL OR (kind = 'settlement' AND method IN ('upi', 'cash', 'bank', 'other')))
);

-- A transaction can be reversed once: a second reversal of it is refused here.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_txns_reverses_uq
  ON kitchen_txns (reverses) WHERE reverses IS NOT NULL;

-- The group's activity, newest first, and its keyset cursor.
CREATE INDEX IF NOT EXISTS kitchen_txns_org_occurred_idx
  ON kitchen_txns (org_id, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS kitchen_txn_splits (
  txn_id      TEXT NOT NULL REFERENCES kitchen_txns(id),
  subject_id  TEXT NOT NULL,
  position    INTEGER NOT NULL CHECK (position >= 0),
  paid_minor  INTEGER NOT NULL CHECK (paid_minor >= 0),
  owed_minor  INTEGER NOT NULL CHECK (owed_minor >= 0),
  PRIMARY KEY (txn_id, subject_id)
);

-- A person's transactions across every group (the People view).
CREATE INDEX IF NOT EXISTS kitchen_txn_splits_subject_idx
  ON kitchen_txn_splits (subject_id);

CREATE TABLE IF NOT EXISTS kitchen_flags (
  id          TEXT PRIMARY KEY,
  txn_id      TEXT NOT NULL REFERENCES kitchen_txns(id),
  org_id      TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved')),
  idem_key    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, idem_key)
);

CREATE INDEX IF NOT EXISTS kitchen_flags_txn_idx
  ON kitchen_flags (txn_id, created_at);

-- table kitchen_txns: One money event in one group's ledger (expense, use, dish, waste, settlement, reversal). Append-only.
-- column kitchen_txns.id: Transaction id (UUID); crosses the API as txn_<32 hex>.
-- column kitchen_txns.org_id: Owning organization (the group) — opaque reference to membership_organizations.id, no cross-context FK.
-- column kitchen_txns.kind: expense | use | dish | waste | settlement | reversal.
-- column kitchen_txns.total_minor: The amount that moved, in integer minor units; equals Σ paid_minor and Σ owed_minor of its splits.
-- column kitchen_txns.currency: The group's ISO 4217 currency when it was posted.
-- column kitchen_txns.occurred_at: When it happened (the activity order), ISO-8601.
-- column kitchen_txns.created_by: Subject id (usr_…) of who logged it.
-- column kitchen_txns.source_kind: What it came from (item | dish | expense), when it came from one.
-- column kitchen_txns.source_id: The id of that source.
-- column kitchen_txns.reverses: For a reversal, the transaction it undoes (unique: reversed at most once).
-- column kitchen_txns.method: For a settlement, how it was paid: upi | cash | bank | other.
-- column kitchen_txns.idem_key: The request's Idempotency-Key (or one minted per request); unique per group.
-- table kitchen_txn_splits: Who paid and who owes in one transaction, one row per person.
-- column kitchen_txn_splits.subject_id: The person (usr_…).
-- column kitchen_txn_splits.position: Order the people were listed in (payers, then participants); pairwise attribution follows it.
-- column kitchen_txn_splits.paid_minor: What this person paid, in minor units.
-- column kitchen_txn_splits.owed_minor: What this person owes, in minor units.
-- table kitchen_flags: A person named in a transaction saying it looks wrong. A correction is a reversal.
-- column kitchen_flags.subject_id: Who flagged it (usr_…).
-- column kitchen_flags.state: open | resolved.
