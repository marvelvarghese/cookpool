# config-worker

Cloudflare Worker for the Config read-only API surface

Part of the cookpool runtime: a Cloudflare Worker deployed per environment (`stage`, `prod`; `dev` is verify-only). Not publicly routable — reached only through `api-edge` service bindings.

## Depends on

- **membership-worker** — Cloudflare Worker for the Membership org runtime
- **policy-worker** — Cloudflare Worker for policy authorization decisions
- **cloudflare-d1** — Provisions the Cloudflare D1 platform database for stage and prod

## Depended on by

- **api-edge** — Cloudflare Worker for the API edge Runtime
