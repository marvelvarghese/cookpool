# kitchen-worker

Cloudflare Worker for the kitchen bounded context — group settings, pantries, the group ledger and dishes (Cookpool)

Part of the cookpool runtime: a Cloudflare Worker deployed per environment (`stage`, `prod`; `dev` is verify-only). Not publicly routable — reached only through `api-edge` service bindings.

## Depends on

- **membership-worker** — Cloudflare Worker for the Membership org runtime
- **policy-worker** — Cloudflare Worker for policy authorization decisions
- **notifications-worker** — Cloudflare Worker for the Notifications bounded context
- **cloudflare-d1** — Provisions the Cloudflare D1 platform database for stage and prod
- **db-migrate** — Applies database migrations to the stage and prod Cloudflare D1 databases

## Depended on by

- **api-edge** — Cloudflare Worker for the API edge Runtime
