# cloudflare-d1 — architecture

A `terraform` component rooted at `infra/terraform/cloudflare-d1/terraform`.

- **State** lives in the platform's HTTP state backend (run-token auth) —
  no local state, no cloud-vendor state buckets.
- **Credentials are brokered per run** from the workspace's Cloudflare
  connection; no long-lived provider secrets exist anywhere in CI.
- **Outputs are published as job-output secrets** on the environment
  rungs: `WIRING_CLOUDFLARE_D1` (database id/name for deploy-time binding). Downstream deploy lanes resolve them by name.
- **Self-healing adoption** (`adopt.tf`): when the platform state is
  empty but the resource already exists at the provider, plan-time import
  adopts it instead of failing with "already exists" — safe re-bootstrap
  over half-torn-down attempts.
- **The database lives in Asia–Pacific** (SM-3): `cloudflare_d1_database.platform_apac`
  is created with `primary_location_hint = "apac"`, named `cookpool-<env>-apac`.
  The hint is read only at creation (`ignore_changes`): Cloudflare never
  returns it, and a change would replace the database and delete its rows.
  This root pins the Cloudflare provider to 5.28.1 (v4 has no hint); the
  other roots stay on v4.
- **The previous database is forgotten, not destroyed** (SM-3): a `removed`
  block with `destroy = false` drops `cloudflare_d1_database.platform` (the
  no-hint `cookpool-<env>`) from state and leaves it running, so the Workers
  stay bound to a live database until each one redeploys onto the new one.
  The owner deletes it in the dashboard.
