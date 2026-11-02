-- 270_kitchen_sweeps: one row per day the daily use-soon sweep ran.
--
-- Context: kitchen
-- Epic: cookpool-kitchen (CP-18) — kitchen-worker's scheduled() runs a sweep
--       at 02:30 UTC every day: it finds the items close to their use-by date
--       and asks notifications-worker to send each person one digest. A cron
--       without a trigger fails silently (risks CP-N), so the worker records
--       every run here and /health reports the last one.
--
-- Design rules:
--   * Additive and idempotent: CREATE TABLE IF NOT EXISTS only.
--   * Keyed by the UTC day swept: a re-run of the same day updates its row
--     (the digests themselves are once per person per day by their
--     notifications idempotency key, not by this table).
--   * Counts only: no names, addresses or item ids are kept here.

CREATE TABLE IF NOT EXISTS kitchen_sweeps (
  sweep_date   TEXT PRIMARY KEY CHECK (sweep_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  started_at   TEXT NOT NULL,
  finished_at  TEXT NOT NULL,
  items        INTEGER NOT NULL DEFAULT 0 CHECK (items >= 0),
  people       INTEGER NOT NULL DEFAULT 0 CHECK (people >= 0),
  sent         INTEGER NOT NULL DEFAULT 0 CHECK (sent >= 0),
  failed       INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  runs         INTEGER NOT NULL DEFAULT 1 CHECK (runs >= 1)
);

-- table kitchen_sweeps: One row per UTC day the daily use-soon sweep ran (Cookpool CP-18); /health reads the latest.
-- column kitchen_sweeps.sweep_date: The UTC day swept (YYYY-MM-DD): items whose use-by is this day through two days later.
-- column kitchen_sweeps.started_at: When the latest run of this day started.
-- column kitchen_sweeps.finished_at: When the latest run of this day finished: /health's lastSweepAt.
-- column kitchen_sweeps.items: Items in the window, across every pantry.
-- column kitchen_sweeps.people: People with at least one of them to use.
-- column kitchen_sweeps.sent: Digests notifications-worker accepted (new, already sent today, or suppressed).
-- column kitchen_sweeps.failed: Digests that could not be enqueued (no address, or notifications-worker unreachable).
-- column kitchen_sweeps.runs: How many times this day was swept.
