# web-console-next — runbook

## How it deploys

Merges to `main` converge automatically: CI plans changed components
(`orun plan --changed`) and runs this component's lane via
`orun run --remote-state` with credential-free OIDC auth. The convergence
run is the deployment; the DAG orders this component after everything it
depends on. Failed lanes resume with `gh run rerun --failed`.

## Rollback

Revert the offending commit on `main`; the next convergence applies the
previous desired state. There is no out-of-band mutation to undo — the
repo is the source of truth.

## The service worker (Cookpool PW-4)

Every production build writes `/sw.js` (`scripts/service-worker.mjs`, the
build's last step): it precaches the build's pages, payloads, `/_next/static`
files and icons into `cookpool-static-<build id>`, and keeps the last-seen API
reads of the signed-in account in `cookpool-data-v1-<subject id>`. Pages are
network-first (3 s), so online people always get the deployed build; a new
build installs in the background and is offered as "New version · Reload".
`public/_headers` serves `/sw.js` with `Cache-Control: no-cache`.

**Check it after a deploy:** `curl -sI https://<host>/sw.js` shows
`cache-control: no-cache`, and its first line names the build
(`// Cookpool's service worker for build <id>`), the same id as `/BUILD_ID`.

### The kill switch

A broken service worker can pin people to an old or blank app until it is
replaced, so there is a way out that every installed worker obeys: the
browser re-fetches `/sw.js` on every navigation (bypassing the HTTP cache and
the worker itself), and a changed script is installed.

1. Set `src/service-worker/switch.mjs` to `export const SERVICE_WORKER = "off";`
   and land it (a one-line PR; deploy stage, then prod, as usual).
2. The build then writes a `/sw.js` that installs and takes over at once
   (`skipWaiting`), deletes every `cookpool-*` cache, unregisters itself and
   reloads the pages it controlled from the network. Pages of that build
   unregister any worker instead of registering one. The build log says
   `✓ service-worker: OFF`.
3. Each phone recovers the next time the app is opened online (an installed
   app: the next launch). Nothing is lost: the worker keeps no writes.
4. Leave it off for at least a week (phones that are rarely opened), fix the
   worker, then set it back to `"on"`.

Do not delete `/sw.js` instead: a 404 leaves the installed worker in place.
Reverting the PR that broke the worker also works for a worker that still
serves pages, since the reverted build's worker replaces it; the switch also
covers a worker that broke the page so badly that the "New version" offer
never shows.

**One phone, by hand:** in the browser's site settings, clear the site's data
(Chrome: Settings → Site settings → the site → Clear & reset; iPhone:
Settings → Apps → Safari → Advanced → Website Data, or delete and re-add the
home-screen app).

## Verify

The deploy lane's own verify/smoke is the gate. End-to-end behavior is
exercised through `api-edge` (this Worker has no public URL).

## Common failures

- **Missing `WIRING_*` secret at deploy**: the infrastructure terraform
  upstream has not applied — check that lane first; within one
  convergence run the DAG guarantees order.
- **Service-binding target missing (Cloudflare 10143)**: the target
  Worker does not exist yet on this account — converge the fleet before
  this lane (the bootstrap's two-pass landing handles first boot).
- **Smoke fails on `/api/health`**: the console reached no api-edge
  (`api_edge_unbound`: the deploy ran without `CLOUDFLARE_ENV`, so the top
  level of `wrangler.jsonc`, with no binding, applied) or api-edge did not
  take the client's address from it (`"source"` is not `"console"`: the
  binding's props did not arrive, and signed-out requests through `/api`
  would share one rate-limit bucket). Stage failing it holds prod back.
- **"New version · Reload" never appears after a deploy**: the new worker
  did not install. `/sw.js` answers with the new build id? An install fails
  when a precached page does not name the build (a second deploy landed
  while it downloaded); the browser retries on its next check. Network-first
  pages mean people still get the new build online meanwhile.
- **Smoke fails right after a first deploy**: a brand-new workers.dev
  route can 4xx for a few seconds; the lane already retries — persistent
  failure means a real regression.
