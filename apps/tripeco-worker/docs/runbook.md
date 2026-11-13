# tripeco-worker — runbook

## How it deploys

Merges to `main` converge automatically: CI plans changed components and runs this lane after cloudflare-d1 and db-migrate; api-edge waits for it (its `TRIPECO_WORKER` binding needs the Worker to exist). `wrangler.jsonc` is rendered from `wrangler.template.jsonc` at deploy time.

## Verify

- `GET /health` over the binding reports `service: tripeco-worker` and which bindings are configured.
- Through the edge: `GET /v1/tripeco/me` with a session answers `vehicles`, `rides` and `needs`.

## Common failures

- **503 on every route**: `PLATFORM_DB` is missing in the rendered config.
- **404 for your own vehicle or ride**: a malformed id, or the row is another account's.
- **422 on a ride**: readings that make no sense (an end below the start, more than 2,000 km).
- **409 `ride_posted`**: a posted ride can't be discarded; unpost it first.

## Rollback

Revert the commit on `main`. The tables stay; nothing else reads them.
