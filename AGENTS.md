# AGENTS.md — Cookpool

How to work in `marvelvarghese/cookpool`, for coding agents and
the people running them.

## What this is

Cookpool is a multi-tenant SaaS on Cloudflare alone.
`apps/api-edge` is the only public Worker; it reaches twelve bounded-context
Workers (`apps/*-worker`: identity, membership, projects, policy, events,
config, metering, billing, notifications, webhooks, integrations, admin)
over service bindings. `apps/web-console-next` is the console, and it talks
only to the edge. The data plane is a D1 database per environment and a KV
namespace for the edge's idempotency store. `stage` and `prod` deploy; `dev`
only verifies.

## Read first, in this order

1. [ai/context/operations.md](ai/context/operations.md) — the operating
   contract: tenancy, how a merge deploys, the secrets model, how to verify.
2. [ai/context/deployment.md](ai/context/deployment.md) — the live URLs, the
   workspace and the secrets by name. It reads "Not rendered yet" until the
   bootstrap's last phase has written it.
3. [intent.yaml](intent.yaml) — environments, lanes, the pinned composition
   stack and the workspace CI runs against.
4. [apps/api-edge/docs/overview.md](apps/api-edge/docs/overview.md) — the
   edge and what it depends on. Every component carries the same three pages
   in its `docs/`: overview, architecture, runbook.
5. `apps/web-console-next` — the console.
6. `packages/contracts` — the API, tenancy, event and error types the
   Workers and the console share. A change to an API's shape starts here.

## How a change lands

- Everything deployable is an Orun component: a directory under `apps/`,
  `infra/`, `packages/` or `tests/` with a `component.yaml`. Orun discovers
  it, and `intent.yaml` says where it deploys.
- Before a pull request: `pnpm install`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test`; then `orun validate --intent intent.yaml` and
  `orun plan --changed --intent intent.yaml` to see what CI will run.
- One task, one pull request. CI plans the changed components and verifies
  them; the merge to `main` deploys them, `stage` first and then `prod`.
- A green run that planned no lanes deployed nothing. Check the outcome —
  the URLs, the published secrets — as operations.md shows.
- A schema change is a new numbered directory with an `up.sql` under
  `packages/db/src/migrations/`, registered with its checksum in
  `packages/db/src/manifest.ts`. Never edit one that has been applied.
  `infra/db-migrate` applies them on merge. D1 has no interactive
  transactions: see the README.

## Do not hand-edit

- `ai/context/deployment.md`, and the README section between
  `<!-- 08-docs:begin -->` and `<!-- 08-docs:end -->`: both are regenerated
  from probed state.
- `apps/*/wrangler.jsonc` of a Worker that has a `wrangler.template.jsonc`:
  it is rendered at deploy time and gitignored. Edit the template.
- `pnpm-lock.yaml` (let pnpm write it), `.rebrand/values.json` (the record
  of the inputs this product was built with) and, if present,
  `apps/web-console-next/console-artifact.pin.json` (the prebuilt-console
  pin).
- `execution.state.workspace` in `intent.yaml`: every remote operation,
  CI's included, runs against that workspace.
- The last line of a `component.yaml` that reads `# orun: redeploy …` is a
  deploy trigger, not configuration; nothing reads it back.

## Secrets

Never print or commit a secret value, and never put one in `ai/context/`.
The Cloudflare credentials are brokered per run from the workspace's
connection; runtime secrets are set with
`orun secrets set <KEY> --org <workspace> --env <env>` and inspected by
name only.
