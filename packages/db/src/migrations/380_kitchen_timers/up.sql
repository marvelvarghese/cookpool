-- 380_kitchen_timers: timers a cook sets, pushed to their phone when they end.
--
-- Context: kitchen
-- Epic: cookpool-guided (GC-3, design §4, §6) — guided mode sets a server
--       timer whenever it starts one (a simmer, a rest), and cancels it on
--       Pause, Done early or when the step is ticked. kitchen-worker's
--       per-minute cron finds the timers that have ended and asks
--       notifications-worker to push each one to every device of the person
--       who set it. The web cannot schedule its own alarm: this is how a
--       timer reaches a locked phone.
--
-- Design rules:
--   * Additive and idempotent: one new table and its indexes, IF NOT EXISTS
--     throughout.
--   * One person's (user_id, the public usr_… id), never a group's: only they
--     list or cancel it, and only their devices hear it.
--   * label (1–60 characters) is the push's title, body (1–120, or NULL for
--     the default line) its text, url the app path it opens ("/cook/session")
--     — a path on the app's own origin, never another host.
--   * ends_at is set 30 s to 24 h after created_at (kitchen-worker checks the
--     bounds; the table keeps it after). Every time is an ISO 8601 UTC
--     instant as toISOString() writes it, so text order is time order.
--   * Active is sent_at IS NULL AND canceled_at IS NULL. The sweep claims a
--     due timer by setting sent_at in the same statement that finds it, so
--     two overlapping runs never push one timer twice; sent_at is set
--     whether or not the push then got through ("tried"), so the sweep never
--     loops on one. canceled_at is set once and kept.
--   * At most ten active per person (KITCHEN_TIMERS_MAX_ACTIVE): the insert
--     counts them in the same statement. kitchen_timers_user_idx serves that
--     count and the person's list; kitchen_timers_due_idx the sweep, active
--     rows only; kitchen_timers_ends_idx the purge of rows that ended more
--     than a day ago, whatever their state.
--   * Nothing else points here, and nothing here moves money.

CREATE TABLE IF NOT EXISTS kitchen_timers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  label        TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  body         TEXT CHECK (body IS NULL OR length(body) BETWEEN 1 AND 120),
  url          TEXT NOT NULL CHECK (
                 length(url) BETWEEN 1 AND 200
                 AND substr(url, 1, 1) = '/'
                 AND substr(url, 1, 2) <> '//'
                 AND instr(url, '\') = 0
               ),
  ends_at      TEXT NOT NULL,
  sent_at      TEXT,
  canceled_at  TEXT,
  created_at   TEXT NOT NULL,
  CHECK (ends_at > created_at)
);

CREATE INDEX IF NOT EXISTS kitchen_timers_due_idx
  ON kitchen_timers (ends_at) WHERE sent_at IS NULL AND canceled_at IS NULL;

CREATE INDEX IF NOT EXISTS kitchen_timers_user_idx
  ON kitchen_timers (user_id, ends_at) WHERE sent_at IS NULL AND canceled_at IS NULL;

CREATE INDEX IF NOT EXISTS kitchen_timers_ends_idx
  ON kitchen_timers (ends_at);

-- table kitchen_timers: Timers a cook set (Cookpool GC-3): the per-minute sweep pushes each to their devices once, when it ends. Rows that ended more than a day ago are purged.
-- column kitchen_timers.id: The timer (tmr_ + 32 hex in the API).
-- column kitchen_timers.user_id: Who set it (usr_…): the only person who lists or cancels it, and whose devices hear it.
-- column kitchen_timers.label: The push's title ("Simmer · step 7"), 1–60 characters.
-- column kitchen_timers.body: The push's text, 1–120 characters; NULL for the default line.
-- column kitchen_timers.url: The app path the push opens (starts with one "/"; never another host).
-- column kitchen_timers.ends_at: When it ends: 30 s to 24 h after it was set.
-- column kitchen_timers.sent_at: When the sweep claimed it and asked notifications-worker to push it (whether or not a device then heard it); NULL until then.
-- column kitchen_timers.canceled_at: When its person cancelled it; a cancelled timer is never pushed.
-- column kitchen_timers.created_at: When it was set.
