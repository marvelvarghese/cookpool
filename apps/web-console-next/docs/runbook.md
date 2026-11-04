# web-console-next — runbook

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

- **Missing `WIRING_*` secret at deploy**: the infrastructure terraform
  upstream has not applied — check that lane first; within one
  convergence run the DAG guarantees order.
- **Service-binding target missing (Cloudflare 10143)**: the target
  Worker does not exist yet on this account — converge the fleet before
  this lane (the bootstrap's two-pass landing handles first boot).
- **Smoke fails on `/api/health`**: the console reached no api-edge
  (`api_edge_unbound`: the deploy ran without `CLOUDFLARE_ENV`, so the top
  level of `wrangler.jsonc`, with no binding, applied) or api-edge did not
  take the client's address from it (`"source"` is not `"console"`: the
  binding's props did not arrive, and signed-out requests through `/api`
  would share one rate-limit bucket). Stage failing it holds prod back.
- **Smoke fails right after a first deploy**: a brand-new workers.dev
  route can 4xx for a few seconds; the lane already retries — persistent
  failure means a real regression.
