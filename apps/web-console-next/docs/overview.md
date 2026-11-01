# web-console-next

Next.js 15 + opennextjs/cloudflare delivery of the cookpool web console (per-environment, Workers + Static Assets)

Part of the cookpool runtime: a Cloudflare Worker serving static assets plus server rendering, deployed per environment (`stage`, `prod`; `dev` is verify-only).

## Depends on

- (none)

## Depended on by

- **cloudflare-domain** — Manages the Cloudflare zone and attaches custom domains to environment-specific Worker services (web-console-next)
