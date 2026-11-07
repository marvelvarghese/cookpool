-- 320_notification_push_preferences: push as a preference channel, and a
-- toggle per kind.
--
-- Context: notifications
-- Epic: cookpool-app (PW-5) — push, in the server. A person turns each of
--       three kinds on or off for push, independently of email: "someone set
--       my portion" (kitchen.portion_set), "a dish to claim"
--       (kitchen.dish_posted) and "someone paid me" (kitchen.paid_you).
--
-- Design rules:
--   * The same preferences model, extended, not a second one: a row per
--     organization, subject and channel, where the channel may now be 'push'
--     as well as 'email', and a `kinds` map ({ "kitchen.portion_set": true })
--     beside `categories`. A person's push row lives under the system
--     organization (push is theirs in every group); email rows stay per group.
--   * Defaults live in the worker, not here: a kind missing from `kinds` is on
--     for email and off for push.
--   * SQLite cannot change a CHECK constraint in place, so the table is
--     rebuilt: the new shape is created under a temporary name, every row is
--     copied (kinds '{}'), the old table is dropped and the new one takes the
--     old name. Same name, the same columns plus kinds, the same unique key
--     (inline, so there is no moment without it), the org index re-created:
--     the worker from before this migration reads and writes it unchanged.
--   * The runner applies these statements one at a time with no transaction.
--     Until the DROP a rerun is harmless (CREATE … IF NOT EXISTS, and INSERT
--     OR IGNORE skips rows already copied). The one gap is a failure between
--     the DROP and the RENAME: the rerun then fails on its copy, naming the
--     missing table, and the fix is to run the RENAME by hand (runbook).
--   * No row changes meaning: every existing row is email, its categories as
--     they were, its kinds empty.

CREATE TABLE IF NOT EXISTS notifications_notification_preferences_next (
  id              TEXT        PRIMARY KEY,
  org_id          TEXT        NOT NULL,
  subject_kind    TEXT        NOT NULL,
  subject_id      TEXT        NOT NULL,
  channel         TEXT        NOT NULL,
  categories      TEXT        NOT NULL DEFAULT '{}',
  kinds           TEXT        NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  CONSTRAINT notification_prefs_subject_kind_check
    CHECK (subject_kind IN ('user', 'organization')),
  CONSTRAINT notification_prefs_channel_check
    CHECK (channel IN ('email', 'push')),
  CONSTRAINT notification_prefs_subject_channel_unique
    UNIQUE (org_id, subject_kind, subject_id, channel)
);

INSERT OR IGNORE INTO notifications_notification_preferences_next
  (id, org_id, subject_kind, subject_id, channel, categories, kinds, created_at, updated_at)
SELECT id, org_id, subject_kind, subject_id, channel, categories, '{}', created_at, updated_at
  FROM notifications_notification_preferences;

DROP TABLE notifications_notification_preferences;

ALTER TABLE notifications_notification_preferences_next RENAME TO notifications_notification_preferences;

CREATE INDEX IF NOT EXISTS notification_prefs_org_idx
  ON notifications_notification_preferences (org_id);

-- table notifications_notification_preferences: Per-subject, per-organization, per-channel notification preferences (email per group; push per person, under the system organization). subject_id is an opaque identifier (no FK into identity / membership).

-- column notifications_notification_preferences.channel: 'email' or 'push' (PW-5).

-- column notifications_notification_preferences.kinds: Bounded TEXT map { template key: boolean } for kitchen.portion_set, kitchen.dish_posted and kitchen.paid_you. Missing is the channel's default: on for email, off for push.
