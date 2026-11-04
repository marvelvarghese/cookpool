# admin-worker

Internal Cloudflare Worker for audited support/administration diagnostics

Part of the cookpool runtime: a Cloudflare Worker deployed per environment (`stage`, `prod`; `dev` is verify-only). Not publicly routable — reached only through `api-edge` service bindings.

## Depends on

- **cloudflare-d1** — Provisions the Cloudflare D1 platform database for stage and prod
- **db-migrate** — Applies database migrations to the stage and prod Cloudflare D1 databases

## Depended on by

- (none)
