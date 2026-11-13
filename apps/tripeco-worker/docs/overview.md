# tripeco-worker

Cloudflare Worker for Tripeco (tripeco) — vehicles, a private fuel log, mileage learned from full tanks, and rides whose shares post into a Spliteco group through spliteco-worker, under `/v1/tripeco`

Part of the cookpool runtime: a Cloudflare Worker deployed per environment (`stage`, `prod`; `dev` is verify-only). Not publicly routable — reached only through `api-edge`'s `TRIPECO_WORKER` service binding.

## Depends on

- **spliteco-worker** — posting a ride as a Spliteco expense, and reading a group as the caller to check a member's right to a ride's proof (TR-3)
- **cloudflare-d1** — the platform database (the `tripeco_*` tables)
- **db-migrate** — migration 610 before this serves

## Depended on by

- **api-edge** — the `/v1/tripeco/…` facade
