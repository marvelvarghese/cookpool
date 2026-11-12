-- 530_spliteco_ledger: Spliteco on Cookpool's ledger.
--
-- Context: kitchen
-- Epic: cookpool-spliteco (SE-2) — groups made in Spliteco, expenses split six
--       ways (itemized included), edited, deleted, restored and moved, with
--       comments. One ledger for both apps: kitchen_txns and
--       kitchen_txn_splits stay the record of money (design §0.2).
--
-- Design rules:
--   * Additive: columns with defaults, new tables, new indexes. Every
--     existing row reads as Cookpool's (made_in 'cookpool', kind 'kitchen',
--     app 'cookpool').
--   * Still append-only: an edit is a reversal plus a new transaction that
--     `revises` the old one; a delete is a reversal stamped `deleted_at`
--     (the reversal row carries it, the original is never updated); a
--     restore is a new transaction that `revises` the deleted one; a move is
--     a reversal in one group plus a new transaction `moved_from` the old
--     one in another. The partial unique indexes on `revises` and
--     `moved_from` mean a version is replaced at most once, so two edits of
--     the same version cannot both land.
--   * An itemized expense still posts ONE transaction with per-person
--     splits; ledger_txn_items, ledger_txn_item_shares and
--     ledger_txn_adjustments are its explanation, written in the same batch.
--   * Two balances per kitchen group (design §0.11): `bucket` is `kitchen`
--     for every existing row and everything Cookpool posts, and `other` for
--     anything added through Spliteco (in any group). A reversal carries its
--     original's bucket; a settlement (SE2) carries the bucket it pays.
--   * `split_spec` keeps the request an expense was saved from (JSON), so an
--     edit can start from it.
--   * Comments are append-only too: ledger_comments rows are never updated.

ALTER TABLE membership_organizations ADD COLUMN made_in TEXT NOT NULL DEFAULT 'cookpool' CHECK (made_in IN ('cookpool', 'spliteco'));
ALTER TABLE membership_organizations ADD COLUMN kind TEXT NOT NULL DEFAULT 'kitchen' CHECK (kind IN ('kitchen', 'trip', 'home', 'couple', 'other', 'direct'));

ALTER TABLE kitchen_txns ADD COLUMN app TEXT NOT NULL DEFAULT 'cookpool' CHECK (app IN ('cookpool', 'spliteco'));
ALTER TABLE kitchen_txns ADD COLUMN bucket TEXT NOT NULL DEFAULT 'kitchen' CHECK (bucket IN ('kitchen', 'other'));
ALTER TABLE kitchen_txns ADD COLUMN category TEXT;
ALTER TABLE kitchen_txns ADD COLUMN revises TEXT;
ALTER TABLE kitchen_txns ADD COLUMN moved_from TEXT;
ALTER TABLE kitchen_txns ADD COLUMN deleted_at TEXT;
ALTER TABLE kitchen_txns ADD COLUMN via_delegation TEXT;
ALTER TABLE kitchen_txns ADD COLUMN split_spec TEXT CHECK (split_spec IS NULL OR json_valid(split_spec));

-- A version is replaced (edited or restored) at most once, and moved at most once.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_txns_revises_uq
  ON kitchen_txns (revises) WHERE revises IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_txns_moved_from_uq
  ON kitchen_txns (moved_from) WHERE moved_from IS NOT NULL;

-- Activity across several groups, newest first.
CREATE INDEX IF NOT EXISTS kitchen_txns_org_created_idx
  ON kitchen_txns (org_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ledger_txn_items (
  txn_id       TEXT NOT NULL REFERENCES kitchen_txns(id),
  position     INTEGER NOT NULL CHECK (position >= 0),
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  qty          REAL NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_minor   INTEGER CHECK (unit_minor IS NULL OR unit_minor >= 0),
  total_minor  INTEGER NOT NULL CHECK (total_minor >= 0),
  PRIMARY KEY (txn_id, position)
);

CREATE TABLE IF NOT EXISTS ledger_txn_item_shares (
  txn_id         TEXT NOT NULL REFERENCES kitchen_txns(id),
  item_position  INTEGER NOT NULL CHECK (item_position >= 0),
  subject_id     TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('portion', 'pct', 'exact')),
  value          INTEGER NOT NULL CHECK (value >= 0),
  PRIMARY KEY (txn_id, item_position, subject_id)
);

CREATE TABLE IF NOT EXISTS ledger_txn_adjustments (
  txn_id        TEXT NOT NULL REFERENCES kitchen_txns(id),
  position      INTEGER NOT NULL CHECK (position >= 0),
  kind          TEXT NOT NULL CHECK (kind IN ('tax', 'service', 'discount')),
  label         TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (txn_id, position)
);

CREATE TABLE IF NOT EXISTS ledger_comments (
  id          TEXT PRIMARY KEY CHECK (id GLOB 'cmt_*'),
  txn_id      TEXT NOT NULL REFERENCES kitchen_txns(id),
  org_id      TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS ledger_comments_txn_idx
  ON ledger_comments (txn_id, created_at);

-- column membership_organizations.made_in: Where the group was made: cookpool (every kitchen, the default) | spliteco (hidden from Cookpool's lists in SE3).
-- column membership_organizations.kind: kitchen | trip | home | couple | other | direct — direct is the hidden two-person group for friends outside any group, excluded from the open-groups cap.
-- column kitchen_txns.app: Which app wrote it: cookpool (the default) | spliteco. Spliteco refuses to edit, delete or move cookpool rows.
-- column kitchen_txns.bucket: Which balance it counts toward: kitchen (every Cookpool row, the default) | other (added in Spliteco). Balances are computed per bucket.
-- column kitchen_txns.category: Spliteco's category (food, groceries, stay, transport, shopping, entertainment, bills, other); null for Cookpool's rows.
-- column kitchen_txns.revises: For an edit or a restore, the version it replaces (unique: replaced at most once).
-- column kitchen_txns.moved_from: For a move, the version in the other group it replaces (unique: moved at most once).
-- column kitchen_txns.deleted_at: On a reversal only: set when the reversal is a delete (restorable for 30 days), ISO-8601.
-- column kitchen_txns.via_delegation: The delegation (assistant) that wrote it, when one did (SE5).
-- column kitchen_txns.split_spec: The Spliteco request the expense was saved from (method, payers and shares), JSON; null for Cookpool's rows.
-- table ledger_txn_items: The items of an itemized expense, in bill order.
-- column ledger_txn_items.qty: How many were on the bill.
-- column ledger_txn_items.unit_minor: The price of one, when the bill says it.
-- column ledger_txn_items.total_minor: The item's total in minor units.
-- table ledger_txn_item_shares: Who had an item and how much: portions share what is left after exact and percent shares.
-- column ledger_txn_item_shares.mode: portion | pct | exact.
-- column ledger_txn_item_shares.value: portion ×1000, basis points, or minor units, by mode.
-- table ledger_txn_adjustments: Tax, service and discount on an itemized bill, spread by each person's items.
-- column ledger_txn_adjustments.amount_minor: Always positive; a discount is taken off.
-- table ledger_comments: Comments on an expense (cmt_ ids). Append-only.
-- column ledger_comments.subject_id: Who wrote it (usr_…).
