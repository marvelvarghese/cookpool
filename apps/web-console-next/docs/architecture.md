# web-console-next — architecture

A `cloudflare-workers-assets-turbo` component: TypeScript built by the turbo pipeline
from `apps/web-console-next`, deployed per environment by its CI lane.

## Bindings and wiring

- `ASSETS` — Workers Static Assets (`.open-next/assets`): the pages served as
  files (SM-2) and Next's static chunks, answered before the Worker runs.
  `assets.run_worker_first: ["/api/*"]` sends the API to the Worker instead.
- `API_EDGE` (stage, prod) — service binding to `cookpool-api-edge-<env>`,
  default entrypoint, `props: { caller: "web-console-next" }` (SM-4). The
  Worker's entry (`src/worker/index.mjs`) forwards `/api/*` over it with the
  prefix stripped and the client's address in `x-console-client-ip`, which
  api-edge believes only with those props; everything else goes to OpenNext's
  `.open-next/worker.js`, imported lazily on the first such request. Each
  environment's section of `wrangler.jsonc` is chosen by `CLOUDFLARE_ENV`,
  which the component sets per job.

## Boundaries

This Worker owns its bounded context: its data, its invariants, its
API surface (exposed to the fleet through the edge). Cross-context calls
go over service bindings; nothing else may reach into its storage.
