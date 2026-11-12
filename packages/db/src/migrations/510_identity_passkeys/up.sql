-- 510_identity_passkeys: WebAuthn passkeys, and the challenges that sign with them.
--
-- Context: identity
-- Epic: cookpool-passkeys (PK-2) — a person signs in with Face ID, a
--       fingerprint or the phone's screen lock. The server keeps only the
--       public half of each passkey; the private key never leaves the device.
--
-- Design rules:
--   * Additive: two new tables and their indexes; nothing existing changes.
--   * identity_passkeys holds the credential id (base64url, unique across
--     everyone), the COSE public key (base64url), the sign count, the
--     transports (a JSON array), the AAGUID, a device name of 1–60 characters
--     and whether the passkey is backed up (synced). Never a private key.
--   * At most 10 passkeys per person; the insert counts them in the same
--     statement (packages/db/src/identity/passkeys.ts).
--   * identity_passkey_challenges: one row per options call. kind is
--     `register` (user_id set: the signed-in person) or `login` (user_id
--     null: the device offers whichever passkey it holds). A challenge is
--     used once (used_at) and lasts 5 minutes (expires_at); the use is one
--     UPDATE that checks both, so two verifies of one challenge cannot both win.
--   * Old challenges are pruned when new ones are made, through expires_at.

CREATE TABLE IF NOT EXISTS identity_passkeys (
  id             TEXT     PRIMARY KEY CHECK (id GLOB 'pky_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  user_id        TEXT     NOT NULL REFERENCES identity_users(id),
  credential_id  TEXT     NOT NULL UNIQUE CHECK (length(credential_id) BETWEEN 1 AND 1366),
  public_key     TEXT     NOT NULL CHECK (length(public_key) >= 1),
  sign_count     INTEGER  NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports     TEXT     NOT NULL DEFAULT '[]' CHECK (json_valid(transports) AND json_type(transports) = 'array'),
  aaguid         TEXT     NOT NULL,
  device_name    TEXT     NOT NULL CHECK (length(device_name) BETWEEN 1 AND 60),
  backed_up      INTEGER  NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  created_at     TEXT     NOT NULL,
  last_used_at   TEXT
);

CREATE INDEX IF NOT EXISTS identity_passkeys_user_idx
  ON identity_passkeys (user_id);

CREATE TABLE IF NOT EXISTS identity_passkey_challenges (
  id          TEXT  PRIMARY KEY,
  kind        TEXT  NOT NULL CHECK (kind IN ('register', 'login')),
  user_id     TEXT  REFERENCES identity_users(id),
  challenge   TEXT  NOT NULL UNIQUE,
  created_at  TEXT  NOT NULL,
  expires_at  TEXT  NOT NULL,
  used_at     TEXT,
  CHECK ((kind = 'register' AND user_id IS NOT NULL) OR (kind = 'login' AND user_id IS NULL))
);

CREATE INDEX IF NOT EXISTS identity_passkey_challenges_expires_idx
  ON identity_passkey_challenges (expires_at);

-- table identity_passkeys: WebAuthn passkeys. Public keys only; the private key never leaves the device.
-- column identity_passkeys.credential_id: The WebAuthn credential id, base64url. Unique across everyone.
-- column identity_passkeys.public_key: The COSE public key, base64url.
-- column identity_passkeys.sign_count: The authenticator's signature counter; a sign-in must raise it (or both stay 0).
-- column identity_passkeys.device_name: What the person sees under Sign-in and security, 1–60 characters.
-- table identity_passkey_challenges: One-time WebAuthn challenges, 5 minutes each.
-- column identity_passkey_challenges.user_id: The signed-in person for a register challenge; null for a login challenge.
