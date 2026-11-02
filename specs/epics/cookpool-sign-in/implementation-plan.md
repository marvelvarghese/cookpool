# cookpool-sign-in — implementation plan

Milestones land in order. Each is one or more tasks, each task one pull
request on an `orun/SI-<n>-<slug>` branch with an `Orun-Task` trailer,
merged only when every check is green. A milestone is marked ✅ here when its
"done when" list is true, and recorded in `IMPLEMENTATION-STATUS.md` in the
pull request that lands its last task. Each task is created in Orunbase
under its milestone (`orun task create --adopt SI-<n>`) with its contract,
`tasks/SI-<n>.TaskContract.yaml`, which lands in the pull request that
implements it. CI does not run the jest suites (see `cookpool-kitchen`'s
"After v1"), so every PR runs its affected suites locally and lists them.

## SI0 — the spec ✅

This doc set, the canvas row "Signing in", and the `SI-1` contract, merged
to `main`. The epic `cookpool-sign-in`, its four milestones and `SI-1` are
created in Orunbase before the pull request opens; the merge lands `SI-1`.

**Done when**
- the five documents are on `main` under `specs/epics/cookpool-sign-in`
- `orun task epic show cookpool-sign-in` lists SI0 to SI3, and `SI-1` reads done

## SI1 — sign-in that holds up

Make signing in possible on prod, and make the code safe to rely on.

- **SI-2 — limits on codes** (identity-worker, db, db-migrate, contracts):
  - 5 tries per code (`too_many_attempts`);
  - 5 codes per address per 15 minutes (`rate_limited`, with
    `retryAfterSeconds`);
  - `DEBUG_DELIVERY_DOMAINS` in place of `DEBUG_DELIVERY` (`cookpool.test`
    on stage, `*` locally and on dev);
  - the migration for the attempt count;
  - tests: a 6th try refused even with the right code, the 15-minute
    window, the domain list, and stage's rendered config.
- **SI-3 — Google switched on** (identity-worker config, config-worker
  tests):
  - the Google client secret (from the owner) and a generated
    `OAUTH_STATE_SECRET` seeded as orun secrets for stage and prod;
  - both callbacks registered with Google;
  - a deploy that pushes them, and a config test that the secret names
    are wired.

  Blocked until the owner provides the secret (risks SI-A).

**Done when**
- `GET /v1/auth/oauth/providers` lists `google` on stage and prod, and a Google sign-in on prod lands on Home
- a 6th wrong code is refused, and so is a 6th code request for one address within 15 minutes
- on stage, `login/start` for a real address returns no code in the response

## SI2 — the Cookpool sign-in page ✅

- **SI-4 — the signed-out join preview** (membership-worker, api-edge,
  contracts, sdk):
  - `GET /v1/join/{code}/preview` answers `{ groupName, inviterFirstName,
    memberCount }`;
  - api-edge routes it without a session;
  - tests: unknown and rotated codes answer 404, no ids or emails leak,
    and the edge routes it signed out.
- **SI-5 — the sign-in page** (web-console-next):
  - `/login` replaced by the phone and web designs: start, code, wrong,
    expired and rate-limited states;
  - the join-link card, and `?next=` with join completion;
  - `expired=1` after a 401 on any kitchen page;
  - the Bearer-token form only behind "Developer sign-in" on local and dev
    builds;
  - view-model tests;
  - a browser check at 390 and 1440 against a mocked API.

**Done when**
- from a join link on a phone, a person with no account signs in with a code and lands in the group, joined
- a signed-out visit to any kitchen page comes back to that page after sign-in
- the page shows no Bearer-token box and no debug code outside local and dev

## SI3 — first run and You

- **SI-6 — first run and You** (web-console-next):
  - the name step for a profile with no `displayName`, prefilled from the
    email address;
  - `/you` with name change, the ways you sign in, and sign out;
  - the Home avatar and the desktop "Me" item open it;
  - tests and a browser check.
- **SI-7 — close the epic**: the README's Shipped record, the status file,
  and the epic marked completed in Orunbase.

**Done when**
- a new person picks a name on first sign-in and their group shows it
- sign out from You ends the session on that device and opens the sign-in page
- the epic reads completed in Orunbase

## Sequencing note

SI-2 and SI-4 are backend and can run side by side. SI-3 waits on the owner's
Google secret but blocks nothing else, because the page shows Google only
when the providers list has it. SI-5 needs SI-4's preview for the join card,
and SI-2's reasons for its messages. SI-6 follows SI-5, since both change the
sign-in flow.
