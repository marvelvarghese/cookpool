-- 520_identity_passkeys_id_check: an id check that D1 can run.
--
-- Context: identity
-- Epic: cookpool-passkeys (PK-7) — saving a passkey answered 500 on stage.
--
-- Why: 510 checked identity_passkeys.id with one GLOB of 132 characters
--   ('pky_' and sixteen '[0-9a-f]'). D1 limits a LIKE or GLOB pattern to 50
--   bytes, so on D1 every INSERT into identity_passkeys failed with "LIKE or
--   GLOB pattern too complex" and no passkey was ever stored. Plain SQLite
--   allows 50,000 bytes, which is why the tests passed.
--
-- Design rules:
--   * The same rule in short pieces: 20 characters, starting 'pky_', and no
--     character after that outside 0-9 and a-f (the longest pattern is 11
--     bytes). Nothing else about the table changes: the same columns, types,
--     defaults, constraints and index, so the worker from before this
--     migration reads and writes it unchanged.
--   * SQLite cannot change a CHECK constraint in place, so the table is
--     rebuilt: the new shape is created under a temporary name, every row is
--     copied, the old table is dropped, the new one takes the old name and
--     its index is re-created. Nothing references identity_passkeys, so the
--     DROP breaks no foreign key. On stage and prod the table is empty (no
--     insert could succeed), so the copy moves nothing there.
--   * The runner applies these statements one at a time with no transaction.
--     Until the DROP a rerun is harmless (CREATE … IF NOT EXISTS, and INSERT
--     OR IGNORE skips rows already copied). The one gap is a failure between
--     the DROP and the RENAME: the rerun then fails on its copy, naming the
--     missing table, and the fix is to run the RENAME by hand (runbook).

CREATE TABLE IF NOT EXISTS identity_passkeys_next (
  id             TEXT     PRIMARY KEY CHECK (length(id) = 20 AND substr(id, 1, 4) = 'pky_' AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
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

INSERT OR IGNORE INTO identity_passkeys_next
  (id, user_id, credential_id, public_key, sign_count, transports, aaguid, device_name, backed_up, created_at, last_used_at)
SELECT id, user_id, credential_id, public_key, sign_count, transports, aaguid, device_name, backed_up, created_at, last_used_at
  FROM identity_passkeys;

DROP TABLE identity_passkeys;

ALTER TABLE identity_passkeys_next RENAME TO identity_passkeys;

CREATE INDEX IF NOT EXISTS identity_passkeys_user_idx
  ON identity_passkeys (user_id);
