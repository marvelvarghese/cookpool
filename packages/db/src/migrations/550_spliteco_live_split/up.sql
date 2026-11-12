-- 550_spliteco_live_split: a live split — people at the table claim their
-- own items before the bill posts.
--
-- Context: kitchen
-- Epic: cookpool-spliteco (SE-5) — an itemized draft opened as a session with
--       a short join code; group members who sign in claim their items, the
--       opener locks it once every item is claimed, and it posts as ONE
--       itemized expense (kitchen_txns plus its ledger_txn_* rows).
--
-- Design rules:
--   * Additive: three new tables, nothing altered, dropped or rewritten.
--   * A session is not money. Its draft (title, payers, items, adjustments)
--     is JSON; nothing in the ledger changes until the lock, which writes the
--     expense, its audit events and the session's state in one batch.
--   * The code is 8 characters from membership's join-code alphabet (no
--     look-alikes), unique across sessions; a session is open for 24 hours
--     from expires_at being set at open.
--   * ledger_live_claims holds one row per (session, item, person) with the
--     same mode and value an item share stores (portion x1000, basis points,
--     or minor units). Claims are state, not history: they are set, changed
--     and cleared while the session is open, and frozen once it is locked.
--   * ledger_live_presence holds when each person last read the session (a
--     poll every 2 s); "here" is seen within the last 10 s.

CREATE TABLE IF NOT EXISTS ledger_live_sessions (
  id          TEXT PRIMARY KEY CHECK (id GLOB 'lvs_*'),
  org_id      TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE CHECK (length(code) = 8),
  draft       TEXT NOT NULL CHECK (json_valid(draft)),
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'locked')),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  txn_id      TEXT,
  locked_at   TEXT
);

CREATE INDEX IF NOT EXISTS ledger_live_sessions_org_idx
  ON ledger_live_sessions (org_id, created_at);

CREATE TABLE IF NOT EXISTS ledger_live_claims (
  session_id     TEXT NOT NULL REFERENCES ledger_live_sessions (id),
  item_position  INTEGER NOT NULL CHECK (item_position >= 0),
  subject_id     TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('portion', 'pct', 'exact')),
  value          INTEGER NOT NULL CHECK (value >= 0),
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (session_id, item_position, subject_id)
);

CREATE TABLE IF NOT EXISTS ledger_live_presence (
  session_id  TEXT NOT NULL REFERENCES ledger_live_sessions (id),
  subject_id  TEXT NOT NULL,
  seen_at     TEXT NOT NULL,
  PRIMARY KEY (session_id, subject_id)
);

-- table ledger_live_sessions: A live split (SE4): an itemized draft people at the table claim items on before it posts.
-- column ledger_live_sessions.id: lvs_ plus 32 hex.
-- column ledger_live_sessions.org_id: The group it posts to (opaque reference to membership_organizations.id); only its members can open the code.
-- column ledger_live_sessions.code: The join code, 8 characters from ABCDEFGHJKMNPQRSTUVWXYZ23456789.
-- column ledger_live_sessions.draft: The itemized draft as JSON: title, category, note, payers, items (name, qty, unit, total) and adjustments (tax, service, discount).
-- column ledger_live_sessions.state: open (claims change) | locked (posted as one expense; claims frozen).
-- column ledger_live_sessions.created_by: Who opened it (usr_…); only they lock it or set others' claims.
-- column ledger_live_sessions.expires_at: 24 hours after it was opened; after that nothing changes it.
-- column ledger_live_sessions.txn_id: The expense the lock posted (kitchen_txns.id).
-- table ledger_live_claims: Who had which item of a live split, as an item share (mode and value).
-- column ledger_live_claims.item_position: The item's index in the draft's items.
-- column ledger_live_claims.value: portion x1000, basis points, or minor units, as ledger_txn_item_shares.value.
-- table ledger_live_presence: When each person last read a live split; "here" is within the last 10 seconds.
