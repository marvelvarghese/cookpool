# kitchen-worker — runbook

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

## Common failures

- **Timers never reach a phone**: look for the per-minute
  `[scheduled] timer sweep:` line in the Worker's logs. None at all means the
  `* * * * *` trigger is missing from the deployed config. `failed=` above 0
  means notifications-worker refused or could not be reached (the line before
  names the reason per timer, `[kitchen-worker] push-to-subject tmr_…`);
  `unheard=` means the person has no subscribed device, or push is off in that
  environment (notifications-worker's VAPID keys). Either way the timer is not
  retried.
- **AI says "isn't set up" (`GET /v1/kitchen/me/ai` → `available: false`,
  AI routes 503 `ai_unavailable`)**: the `ANTHROPIC_API_KEY` runtime secret is
  not stored for that environment. It is an owner step: store it with
  `orun secrets set ANTHROPIC_API_KEY --org <workspace> --env <env>` (never in
  the template or a var), then redeploy kitchen-worker so secrets-live pushes
  it. AI routes answering 502 `ai_failed` mean the key is there but the
  calls fail or are refused: the request's rows in `kitchen_ai_usage` have
  `ok = 0`. A person at 429 `ai_daily_limit` has 50 rows today (UTC).
- **Missing `WIRING_*` secret at deploy**: the infrastructure terraform
  upstream has not applied — check that lane first; within one
  convergence run the DAG guarantees order.
- **Service-binding target missing (Cloudflare 10143)**: the target
  Worker does not exist yet on this account — converge the fleet before
  this lane (the bootstrap's two-pass landing handles first boot).
- **Smoke fails right after a first deploy**: a brand-new workers.dev
  route can 4xx for a few seconds; the lane already retries — persistent
  failure means a real regression.
