-- 280_identity_login_attempts: how many wrong codes a login challenge has taken.
--
-- Context: identity
-- Epic: cookpool-sign-in (SI-2) — a 6-digit email code allows 5 tries, and an
--       address can ask for at most 5 codes in 15 minutes. Until now a wrong
--       code was recorded as a security event and nothing else, so any number
--       of guesses fit in a code's 10 minutes.
--
-- Design rules:
--   * Additive: one column with a constant default (every existing challenge
--     reads as 0 tries) and one index. SQLite has no ADD COLUMN IF NOT EXISTS,
--     so the runner's applied ledger is what keeps the column add from running
--     twice (as 240 and 260 do).
--   * The count is kept by the statement that checks the code: login/complete
--     is one guarded UPDATE (consumed_at IS NULL AND attempts below the limit
--     AND not expired) that either consumes the challenge or adds one try. Two
--     wrong codes at once count twice, and nothing gets past the limit. The
--     limit itself lives in code (LOGIN_CHALLENGE_MAX_ATTEMPTS), not here.
--   * login/start counts a person's challenges created in the last 15 minutes
--     in the statement that inserts the next one. The (user_id, created_at)
--     index makes that count a range scan instead of every challenge they
--     ever had.

ALTER TABLE identity_login_challenges ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0);

CREATE INDEX IF NOT EXISTS login_challenges_user_created_idx
  ON identity_login_challenges (user_id, created_at);

-- column identity_login_challenges.attempts: Wrong codes this challenge has taken; at the limit it is spent and even the right code is refused.
