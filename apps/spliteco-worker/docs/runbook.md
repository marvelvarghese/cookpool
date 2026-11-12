# spliteco-worker — runbook

## How it deploys

Merges to `main` converge automatically: CI plans changed components and runs this lane after policy-worker (whose pre-deploy places a stub for every binding target, `tooling/deploy/fleet-stubs.mjs`), cloudflare-d1 and db-migrate. `wrangler.jsonc` is rendered from `wrangler.template.jsonc` at deploy time.

## Verify

- `GET /health` over the binding reports `service: spliteco-worker` and which bindings are configured.
- Through the edge: `GET /v1/spliteco/me/groups` with a session lists the caller's groups.

## Common failures

- **503 on every route**: a binding (D1, membership, policy) is missing in the rendered config.
- **404 for a group the person is in**: membership-worker's `?view=spliteco` answer or the policy decision failed; both read as the opaque 404.
- **409 `not_current`**: the version was edited, deleted or moved meanwhile; the app reloads the expense.
- **A reminder or payment answers 201 but nobody gets an email** (SE2): the NOTIFICATIONS_WORKER binding is missing (`/health` shows `notifications.configured: false`), or the person turned email off; `delivered: false` on a reminder says notifications-worker did not take it. Links in them use `APP_URL`.
- **409 `reminded_recently`**: one reminder per pair per 24 hours, by design (`details.nextAllowedAt`).
- **422 `over_settled` / 409 `nothing_owed`**: the payment is more than the group's plan says the payer owes the payee (switching simplify debts changes the plan).

## Rollback

Revert the commit on `main`; the ledger rows it wrote stay (append-only) and kitchen-worker reads them as ordinary transactions.
