-- 490_identity_delegations: tokens a person hands to their assistant.
--
-- Context: identity
-- Epic: cookpool-mcp (MC-2) — an assistant connected over MCP acts as the
--       person who connected it, but only within the scopes they allowed.
--       A delegated token is a third bearer kind beside sessions and API keys:
--       `sps_dlg_<id>.<secret>`. It resolves as the user plus its scopes, and
--       api-edge refuses it everything its scopes do not allow.
--
-- Design rules:
--   * Additive: one new table and one index; nothing existing changes.
--   * Only the SHA-256 of the token's secret is stored (token_hash), as for
--     sessions. The raw token is shown once, when it is minted, and again
--     only when the MCP server rotates it.
--   * scopes is a JSON array of scope names, at least one; which names are
--     valid (kitchen.read, money.read, timers.write, suggest.write) is checked
--     in code (@saas/contracts/delegations), so a new scope needs no migration.
--   * A delegation lasts 90 days from its last rotation (expires_at) and stops
--     at once when revoked_at is set. last_used_at moves at most once an hour.
--   * Resolving reads one row by primary key; the list reads a person's live
--     delegations newest first, through (user_id, created_at).

CREATE TABLE IF NOT EXISTS identity_delegations (
  id            TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES identity_users(id),
  client_name   TEXT        NOT NULL CHECK (length(client_name) BETWEEN 1 AND 80),
  client_id     TEXT        NOT NULL CHECK (length(client_id) BETWEEN 1 AND 128),
  scopes        TEXT        NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array' AND json_array_length(scopes) >= 1),
  token_hash    TEXT        NOT NULL,
  created_at    TEXT        NOT NULL,
  last_used_at  TEXT,
  expires_at    TEXT        NOT NULL,
  revoked_at    TEXT
);

CREATE INDEX IF NOT EXISTS identity_delegations_user_created_idx
  ON identity_delegations (user_id, created_at);

-- table identity_delegations: Delegated user tokens for assistants (MCP clients). Only token hashes stored.
-- column identity_delegations.token_hash: SHA-256 hash of the token's secret. Raw token never stored.
-- column identity_delegations.scopes: JSON array of the scopes the person allowed (kitchen.read, money.read, timers.write, suggest.write).
-- column identity_delegations.client_id: The MCP client's id from dynamic client registration.
-- column identity_delegations.last_used_at: When the token last resolved, moved at most once an hour.
