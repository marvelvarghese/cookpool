-- 560_spliteco_assistants: an assistant logs splits, from a draft the person saw.
--
-- Context: kitchen
-- Epic: cookpool-spliteco (SE-6) — Claude, ChatGPT or Gemini, connected over
--       Cookpool's MCP server with the money.write scope, drafts an expense,
--       shows it, and saves it only when the person says yes. Every row an
--       assistant writes names its delegation (kitchen_txns.via_delegation,
--       migration 530) and now the assistant's name, so Activity can say
--       "via Claude" after the connection has ended.
--
-- Design rules:
--   * Additive: one nullable column and one new table; nothing existing
--     changes. Old rows read via_client as NULL ("via an assistant").
--   * via_client is the client name the person saw on the consent page
--     (identity_delegations.client_name, 1–80 characters), copied onto the
--     row as written, like created_by: the ledger stays append-only.
--   * A draft is not money. ledger_drafts holds what would be saved (the
--     add or edit request, or the move's target) for 10 minutes, for the
--     person and the delegation that made it; saving it runs the ordinary
--     write with the draft's id as its idempotency key, so a save is never
--     posted twice. saved_txn_id/saved_at are stamped after the write.
--   * Drafts are read by id (the primary key) and pruned by expires_at.

ALTER TABLE kitchen_txns ADD COLUMN via_client TEXT
  CHECK (via_client IS NULL OR length(via_client) BETWEEN 1 AND 80);

CREATE TABLE IF NOT EXISTS ledger_drafts (
  id             TEXT PRIMARY KEY CHECK (id GLOB 'drf_*' AND length(id) = 36),
  subject_id     TEXT NOT NULL,
  delegation_id  TEXT,
  action         TEXT NOT NULL CHECK (action IN ('add', 'edit', 'move')),
  org_id         TEXT NOT NULL,
  txn_id         TEXT,
  body           TEXT NOT NULL CHECK (json_valid(body)),
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  saved_txn_id   TEXT,
  saved_at       TEXT,
  CHECK ((action = 'add') = (txn_id IS NULL))
);

CREATE INDEX IF NOT EXISTS ledger_drafts_expires_idx ON ledger_drafts (expires_at);

-- column kitchen_txns.via_client: The assistant's name (as connected) when an assistant wrote the row; NULL otherwise.
-- table ledger_drafts: An assistant's expense drafts (add, edit, move), saved only on the person's yes; 10 minutes.
