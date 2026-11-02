# cookpool-sign-in (SI) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SI0 — the spec | ✅ shipped 2026-11-02 | #26 (SI-1) |
| SI1 — sign-in that holds up | in progress | #28 (SI-2) |
| SI2 — the Cookpool sign-in page | | |
| SI3 — first run and You | | |

## Departures from the design

### SI1 — sign-in that holds up (SI-2)

- **The count is per person, not per `(email, created_at)`.** Login
  challenges carry `user_id`, not an address; `login/start` resolves (or
  creates, as before) the one user a lower-cased address belongs to and
  counts that user's challenges. The index is `(user_id, created_at)`
  (`280_identity_login_attempts`). Case and IP make no difference.
- **Both limits are one statement each.** `login/complete` is one guarded
  `UPDATE … WHERE consumed_at IS NULL AND attempts < 5 AND expires_at > now`
  that consumes on the right code and adds a try on a wrong one; a read
  afterwards only says why nothing was touched. `login/start` inserts with
  `INSERT … SELECT … WHERE (SELECT COUNT(*) …) < 5`, so racing requests cannot
  get a 6th code either. The limits live in `@saas/contracts/auth`
  (`LOGIN_CODE_MAX_ATTEMPTS`, `LOGIN_CODES_PER_WINDOW`,
  `LOGIN_CODE_WINDOW_SECONDS`); the attempt limit is also
  `LOGIN_CHALLENGE_MAX_ATTEMPTS` in `@saas/db/identity`, which the guarded
  statement holds (a test pins them equal).
- **The answers.** Wrong code with tries left: 404 `not_found`,
  `details.attemptsLeft` 4…1. The 5th wrong code, and any try after it (the
  right code included): 422 `precondition_failed`,
  `details: { reason: "too_many_attempts", attemptsLeft: 0 }`. Beyond the
  design, the other two 422s now carry a reason too (`code_expired`,
  `code_used`), and the 429 from `login/start` carries
  `reason: "too_many_codes"` next to `retryAfterSeconds`, plus a
  `Retry-After` header (api-edge passes it through), so the app can tell it
  from the edge's per-IP 429 (`details.scope`). All in `AUTH_ERROR_REASONS`.
- **Two baseline bugs in the D1 repository, fixed on the way.** The old
  `UPDATE … WHERE code_hash = $2 AND consumed_at IS NULL` had no expiry check,
  so a right code still signed in after its 10 minutes; and every refusal,
  a wrong code included, came back as "already been used" (422) on D1,
  while the in-memory fake the tests used said `not_found` (404). D1 now
  answers what the tests always assumed.
- **`DEBUG_DELIVERY` is gone, not aliased.** `wrangler deploy` replaces a
  worker's vars with its config's (no `keep_vars`), so no deployed
  identity-worker can carry the old flag next to the new code.
  `DEBUG_DELIVERY_DOMAINS`: local and dev `*`, stage `cookpool.test`, prod
  empty; matching is by whole domain, case-insensitive (`sub.cookpool.test`
  does not match). `/health` reports
  `checks.debugDelivery: { enabled, domains }` (`["*"]` for every domain).
- **Security events.** A refused `login/start` records `login.start.failed` /
  `rate_limited` (metadata `retryAfterSeconds`); a spent code records
  `login.complete.failed` / `too_many_attempts`; a wrong code keeps
  `invalid_code_or_challenge` and adds `attemptsLeft` to the metadata.
- **identity-worker now has the enforced `db-migrate` edge** kitchen-worker
  has, so on `main` the migration applies before the worker that reads
  `attempts` deploys.
- **Left as they were:** membership-worker still carries its own
  `DEBUG_DELIVERY=true` on stage, which returns invitation tokens inline to
  the inviter (notifications-worker declares the var but reads nothing from
  it). Outside this task.
