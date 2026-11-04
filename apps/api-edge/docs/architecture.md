# api-edge — architecture

A `cloudflare-worker-turbo` component: TypeScript built by the turbo pipeline
from `apps/api-edge`, deployed per environment by its CI lane.

## Bindings and wiring

- **Service bindings** → `projects-worker`, `events-worker`, `config-worker`, `webhooks-worker`, `billing-worker`, `integrations-worker`, `identity-worker`, `membership-worker`, `metering-worker`, `notifications-worker`, `kitchen-worker` —
  in-process RPC to sibling Workers; no public hops between contexts.
- **Wired configuration** (resolved at deploy time from job-output
  secrets published by the infrastructure terraform; names only):
  `WIRING_CLOUDFLARE_D1_STAGE`, `WIRING_CLOUDFLARE_D1_PROD`, `WIRING_CLOUDFLARE_KV_STAGE`, `WIRING_CLOUDFLARE_KV_PROD`.
- **Callers.** The internet, on `cookpool-api-edge-<env>.<subdomain>.workers.dev`,
  and `web-console-next` over its `API_EDGE` service binding (the app's
  `/api/*` on its own address, SM-4), which declares
  `props: { caller: "web-console-next" }`. The client address the rate
  limits key on is Cloudflare's `CF-Connecting-IP` from the internet and the
  console's `x-console-client-ip` over that binding, never the other way
  round (`src/client-ip.ts`); `/health` reports which (`checks.clientIp.source`).
- **`PLATFORM_DB`** is a D1 binding. SQLite types apply: timestamps are
  ISO-8601 text, JSON is text, booleans are 0/1, and there is no
  interactive transaction (see `packages/db/src/d1`).

## Boundaries

This Worker owns its bounded context: its data, its invariants, its
API surface (exposed to the fleet through the edge). Cross-context calls
go over service bindings; nothing else may reach into its storage.
