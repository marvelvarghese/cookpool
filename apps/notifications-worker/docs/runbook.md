# notifications-worker — runbook

## How it deploys

Merges to `main` converge automatically: CI plans changed components
(`orun plan --changed`) and runs this component's lane via
`orun run --remote-state` with credential-free OIDC auth. The convergence
run is the deployment; the DAG orders this component after everything it
depends on. Failed lanes resume with `gh run rerun --failed`.

## Rollback

Revert the offending commit on `main`; the next convergence applies the
previous desired state. There is no out-of-band mutation to undo — the
repo is the source of truth.

## Verify

The deploy lane's own verify/smoke is the gate. End-to-end behavior is
exercised through `api-edge` (this Worker has no public URL).

## Web Push keys (Cookpool PW-5)

Each environment has its own VAPID pair. Until both halves are in place push
is off there: `GET /v1/notifications/push-key` answers `publicKey: null`, no
push is sent, email is unaffected, and the worker logs once per isolate
`Web Push is off: … Email is unaffected.` naming what is missing (never a key).

1. `node apps/notifications-worker/scripts/vapid-keys.mjs` prints
   `VAPID_PUBLIC_KEY=…` and `VAPID_PRIVATE_KEY=…` to stdout (nothing written).
2. Put the public key in `wrangler.template.jsonc`, `env.<env>.vars.VAPID_PUBLIC_KEY`.
3. `orun secrets set VAPID_PRIVATE_KEY --workspace ws_QX130J0D --env <env>`
   (it prompts; paste the private key there and nowhere else).
4. Merge: the deploy pushes the secret (`runtimeSecrets`) with the new var.

Replacing a pair invalidates every subscription made with the old public key:
pushes to them fail at the push service, and browsers subscribe again the
next time the app runs with push on.

## Common failures

- **Migration 320 stopped between its DROP and its RENAME** (the runner
  sends statements one at a time, with no transaction): the rerun fails on
  its copy, naming `notifications_notification_preferences`. Run
  `ALTER TABLE notifications_notification_preferences_next RENAME TO notifications_notification_preferences;`
  and `CREATE INDEX IF NOT EXISTS notification_prefs_org_idx ON notifications_notification_preferences (org_id);`
  against that database, then rerun db-migrate.
- **"VAPID_PRIVATE_KEY does not sign for VAPID_PUBLIC_KEY" in the log**: the
  stored private key is not the one the var's public key belongs to —
  regenerate and store both together.

- **Missing `WIRING_*` secret at deploy**: the infrastructure terraform
  upstream has not applied — check that lane first; within one
  convergence run the DAG guarantees order.
- **Service-binding target missing (Cloudflare 10143)**: the target
  Worker does not exist yet on this account — converge the fleet before
  this lane (the bootstrap's two-pass landing handles first boot).
- **Smoke fails right after a first deploy**: a brand-new workers.dev
  route can 4xx for a few seconds; the lane already retries — persistent
  failure means a real regression.
