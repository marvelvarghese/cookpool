# cookpool-guided (GC) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| GC0 — the spec | landing | GC-1 |
| GC1 — steps that guide | | |
| GC2 — cooking with you | | |
| GC3 — timers that find you | | |
| GC4 — learning from cooks | | |

## Departures from the design

### GC3 — timers in the server (GC-3)

**Built** (design §4, §6 migration 380, §7):

- **Migration `380_kitchen_timers`:** `kitchen_timers` (`tmr_` id, `user_id` the person's `usr_…`, `label` 1–60, `body` 1–120 or NULL, `url` an app path ≤ 200 — one leading `/`, never `//`, no backslash — `ends_at` after `created_at`, `sent_at`, `canceled_at`, `created_at`). Three indexes: `kitchen_timers_due_idx (ends_at)` over active rows (the sweep), `kitchen_timers_user_idx (user_id, ends_at)` over active rows (a person's list and the limit), `kitchen_timers_ends_idx (ends_at)` over every row (the purge). Storage is `packages/db/src/kitchen/timers.ts`, its own `createTimersRepository` beside the kitchen repository (exported from `@saas/db/kitchen`); every write a race could double is one statement.
- **Routes** (kitchen-worker, `src/handlers/timers.ts`; api-edge's kitchen facade already forwards them):
  - `POST /v1/kitchen/me/timers` `{ label, body?, url?, endsAt }` → 201 `{ timer }`. `endsAt` 30 s to 24 h ahead (both ends inclusive); `url` defaults to `/cook/session`; a blank `body` is none (the push says "Time's up"). At most **10 active** a person: the eleventh is **422 `validation_failed`, `details.reason: "too_many_timers"`, `details.max: 10`** (not 429, which says "try later" and which clients retry). The count is in the insert's own statement, so two creates at once cannot both pass it.
  - `GET /v1/kitchen/me/timers` → `{ timers }`: active (unsent, not cancelled), soonest first — one past its end stays listed until the sweep claims it.
  - `DELETE /v1/kitchen/me/timers/{tmr}` → 200 `{ timer }`. Idempotent: a repeat answers the timer as the first cancel left it. Someone else's timer, a malformed id, or none is the opaque 404.
- **Contracts:** `packages/contracts/src/kitchen-timers.ts` (re-exported from `kitchen.ts`, and `@saas/contracts/kitchen-timers`): the bounds, `isKitchenTimerUrl`, `KITCHEN_TIMER_PUSH_KIND`, `KITCHEN_TIMER_ERROR_REASONS`, `KitchenTimer`, `CreateKitchenTimerRequest`, `KitchenTimerResponse`, `KitchenTimersResponse`. In `notifications.ts`: `PUSH_TO_SUBJECT_KINDS` (`["kitchen.timer"]`), `PUSH_TO_SUBJECT_INTERNAL_ACTORS` (`["kitchen-worker"]`), `PUSH_TO_SUBJECT_PATH`, `PUSH_TO_SUBJECT_LIMITS`, `PushToSubjectRequest`, `PushToSubjectResponse`; `PushMessage.kind` is now `NotificationKind | "test" | PushToSubjectKind`. `NOTIFICATION_KINDS` (the preference kinds) is unchanged: a timer is not something a preference turns off.
- **SDK:** `kitchen.timers()`, `kitchen.createTimer(body)`, `kitchen.cancelTimer(id)`, and the types and bounds re-exported.
- **notifications-worker:** internal `POST /v1/notifications/push-to-subject` `{ subjectId, message }` → `{ devices, sent, gone, failed, skipped? }`. It calls `pushToDevices` for every device of the subject with no preference check, passing only the five message fields (each bounded, the url an app path, the JSON ≤ 3 KB). A `skipped: "unreadable"` (the devices could not be read) is a 503.
- **The per-minute sweep** (kitchen-worker `src/timer-sweep.ts`): `"* * * * *"` beside `"30 2 * * *"` in the template's top-level `triggers.crons` (inherited by every environment; neither stage nor prod declares its own). `scheduled()` picks by `controller.cron`: `* * * * *` runs `runTimerSweep`; anything else runs the daily sweep, as before. Each run purges timers that ended more than 24 h ago, claims up to 200 due timers in one `UPDATE … RETURNING` that sets `sent_at`, pushes each through `src/push-client.ts` (beside `emails.ts`, same binding, six at a time; a failure is logged as `[kitchen-worker] push-to-subject tmr_…: <reason>` and never thrown), and logs one line: `[scheduled] timer sweep: due= pushed= devices= sent= unheard= failed= purged=`. No database, or a failed claim, fails the invocation.

**Departures from the design**

1. **Claimed, then pushed.** The design says sent timers are marked; the sweep marks them *before* the push — the claim is the mark — so two overlapping runs can never push one timer twice. The price is at-most-once: a push that fails (notifications-worker down or refusing, no binding) leaves the timer marked as tried and it is never retried. `sent_at` therefore means "the sweep asked for its push", not "a device heard it"; the outcome is in the log line only, not on the row.
2. **"Older than a day" is by `ends_at`, and the purge runs first.** A timer that ended more than 24 h ago is deleted whatever its state, before the claim — so one the sweep never reached (its trigger down for a day) is dropped rather than pushed a day late.
3. **Three indexes, not one.** The design's due index (`ends_at` where unsent) is there, made partial on not-cancelled too; the per-person index serves the list and the limit, and a plain `ends_at` index keeps the per-minute purge from scanning the table.
4. **push-to-subject takes kitchen-worker only.** Besides the internal-actor headers every route of the worker needs, the caller must be in `PUSH_TO_SUBJECT_INTERNAL_ACTORS`; any other internal caller — api-edge included — is 403, because the person is named in the body rather than pinned by the edge. api-edge's notifications facade was checked and not changed: it forwards only the paths it lists, by exact match, and push-to-subject is not one (tests/notifications-worker reads the facade to keep it so).
5. **Cancelling a timer already pushed** answers 200 with `sentAt` set and `canceledAt` null — it is not marked cancelled after the fact. A timer cancelled in the seconds between its run's claim and its push is still pushed (guided mode cancels before the end, so only a race at the very end).
6. **The contract was widened** to `default/cookpool/config-worker-tests`: `tests/config-worker/src/deployment-config.test.ts` pinned kitchen-worker's rendered crons to exactly `["30 2 * * *"]`, and now expects both triggers.
7. **No /health for the timer sweep.** The daily sweep records its runs in `kitchen_sweeps` for `/health`; the timer sweep records nothing — its per-minute log line is the heartbeat (kitchen-worker's runbook says what to look for).

**Not verified yet:** the milestone's "on stage, a timer set in guided mode reaches a locked phone within a minute of its end" needs a deploy and GC-5's guided mode. The chain is covered end to end in tests: `tests/kitchen-worker/src/timer-push-end-to-end.test.ts` sets a timer through kitchen-worker's route, and the sweep pushes it through the real notifications-worker router and encryption to a fake push service, where the phone decrypts it.

**Tests**

| Package | New | Suite |
|---|---|---|
| `tests/db` | `kitchen-timers-migration.test.ts`: 22 (registration, additive SQL, every CHECK, the query plans, and the repository over SQLite: the limit in the insert, cancel once, claim once, the purge) | 784 |
| `tests/contracts` | `kitchen-timers.test.ts`: 21 | 209 |
| `tests/kitchen-worker` | `timers.test.ts`: 28 (create, validation, the limit, list, cancel, someone else's is 404); `timer-sweep.test.ts`: 18 (a due timer pushed once in its words, not-yet-due, cancelled never, an overlapping run and two simultaneous runs never push twice, failures tried once, 200 a run, the purge, `scheduled()` on both crons, the template's triggers); `timer-push-end-to-end.test.ts`: 1 | 629 |
| `tests/notifications-worker` | `push-to-subject.test.ts`: 19 (no internal headers or a non-kitchen caller refused, the facade does not list it, the body checked, no devices, the exact message handed to `pushToDevices`, every device and no one else's, push off) | 150 |
| `tests/config-worker` | the kitchen-worker cron assertions now expect both triggers | 327 |
| `packages/sdk` | `kitchen-timers.test.ts`: 5 | 180 |
