# billing-worker

Cloudflare Worker for the Billing API surface (private, service-binding only)

Part of the cookpool runtime: a Cloudflare Worker deployed per environment (`stage`, `prod`; `dev` is verify-only). Not publicly routable — reached only through `api-edge` service bindings.

## Depends on

- **policy-worker** — Cloudflare Worker for policy authorization decisions
- **cloudflare-d1** — Provisions the Cloudflare D1 platform database for stage and prod
- **db-migrate** — Applies database migrations to the stage and prod Cloudflare D1 databases

## Depended on by

- **api-edge** — Cloudflare Worker for the API edge Runtime
- **integrations-worker** — Cloudflare Worker for the integrations bounded context — provider connections (GitHub App first), inbound delivery inbox, repo links, and the installation-token broker
- **membership-worker** — Cloudflare Worker for the Membership org runtime
- **projects-worker** — Cloudflare Worker for the Projects runtime
