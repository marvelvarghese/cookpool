# kitchen-worker — architecture

A `cloudflare-worker-turbo` component: TypeScript built by the turbo pipeline
from `apps/kitchen-worker`, deployed per environment by its CI lane.

## Bindings and wiring

- **Service bindings** → `membership-worker`, `policy-worker`, `notifications-worker`, `identity-worker` —
  in-process RPC to sibling Workers; no public hops between contexts.
- **Wired configuration** (resolved at deploy time from job-output
  secrets published by the infrastructure terraform; names only):
  `WIRING_CLOUDFLARE_D1_STAGE`, `WIRING_CLOUDFLARE_D1_PROD`.
- **`PLATFORM_DB`** is a D1 binding. SQLite types apply: timestamps are
  ISO-8601 text, JSON is text, booleans are 0/1, and there is no
  interactive transaction (see `packages/db/src/d1`).

## Cron triggers

`scheduled()` picks its job by `controller.cron` (both triggers are declared
once, at the top level of `wrangler.template.jsonc`):

- **`30 2 * * *`** — the daily use-soon sweep (CP-18): one digest per person.
- **`* * * * *`** — the timer sweep (GC-3): it purges timers that ended
  more than a day ago, claims the due ones (`kitchen_timers`, migration 380)
  in one `UPDATE … RETURNING`, at most 200 a run, asks notifications-worker's
  internal `POST /v1/notifications/push-to-subject` to push each to its
  person's devices, and logs one line:
  `[scheduled] timer sweep: due=… pushed=… devices=… sent=… unheard=… failed=… purged=…`.
  A claimed timer is never claimed again, so a push is at most once; one that
  fails is logged and not retried.

## Boundaries

This Worker owns its bounded context: its data, its invariants, its
API surface (exposed to the fleet through the edge). Cross-context calls
go over service bindings; nothing else may reach into its storage.
