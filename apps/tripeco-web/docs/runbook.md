# tripeco-web — runbook

## How it deploys

Merges to `main` build it in its own lane and deploy it after api-edge (its `API_EDGE` binding), as spliteco-web. The smoke check wants the page to say Tripeco and `/api/health` to reach api-edge over the binding.

## Verify

- `https://cookpool-tripeco-web-stage.cookpool.workers.dev/` shows Sign in; Continue with Spliteco round-trips through Spliteco and lands signed in.
- `/api/health` answers api-edge's health with `"source":"console"` (the binding's caller is trusted).

## Common failures

- **Continue with Spliteco ends on "That sign-in link was for another app"**: identity-worker's `HANDOFF_ORIGINS` doesn't list this host.
- **`/api/*` answers 503**: the `API_EDGE` binding is missing (local `wrangler dev` has none).

## Rollback

Revert the commit on `main`; the next merge redeploys the previous build.
