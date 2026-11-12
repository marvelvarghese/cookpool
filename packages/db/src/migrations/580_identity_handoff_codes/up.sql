-- 580_identity_handoff_codes: one tap from Cookpool into Spliteco, signed in.
--
-- Context: identity
-- Epic: cookpool-spliteco (SE-4, risk SE-D) — "More in Spliteco" on
--       Cookpool's Money tab opens Spliteco on its own host already signed
--       in. Cookpool asks identity-worker for a one-time handoff code for the
--       signed-in person and the target app's origin; the Spliteco app
--       exchanges it, once, for a session of its own.
--
-- Design rules:
--   * Additive: one new table.
--   * Only the code's SHA-256 hash is stored; the raw code is shown once.
--   * A code is bound to its person and to the origin it was made for, lives
--     60 seconds and is used once: the exchange stamps used_at in one
--     guarded UPDATE, so of two racing exchanges only one gets a session.

CREATE TABLE IF NOT EXISTS identity_handoff_codes (
  id             TEXT NOT NULL PRIMARY KEY CHECK (id GLOB 'hof_*'),
  user_id        TEXT NOT NULL REFERENCES identity_users(id),
  code_hash      TEXT NOT NULL,
  target_origin  TEXT NOT NULL CHECK (length(target_origin) BETWEEN 8 AND 200),
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  used_at        TEXT,
  session_id     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_handoff_codes_hash_uq
  ON identity_handoff_codes (code_hash);

CREATE INDEX IF NOT EXISTS identity_handoff_codes_user_idx
  ON identity_handoff_codes (user_id, created_at);

-- table identity_handoff_codes: One-time codes that sign a person into another of the product's apps (Spliteco) from a signed-in session. Only hashes stored.
-- column identity_handoff_codes.code_hash: SHA-256 hash of the one-time code. Raw value never stored.
-- column identity_handoff_codes.target_origin: The exact origin (scheme, host, port) the code may be exchanged from.
-- column identity_handoff_codes.expires_at: 60 seconds after created_at, ISO-8601.
-- column identity_handoff_codes.used_at: Set once, by the exchange that took it; a code is never used twice.
-- column identity_handoff_codes.session_id: The session the exchange minted.
