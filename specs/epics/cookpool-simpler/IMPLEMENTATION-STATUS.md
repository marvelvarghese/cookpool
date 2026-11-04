# cookpool-simpler (SM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SM0 — the spec | ✅ shipped 2026-11-04 | #36 (SM-1) |
| SM1 — fast | in progress | #37 (SM-3), SM-2 |
| SM2 — for anyone | | |
| SM3 — from before | | |
| SM4 — simpler screens | | |
| SM5 — the rest | | |

## Departures from the design

### SM1 — the database near its people (SM-3)

- **A new database beside the old one, not a replacement.** Design §1.2
  item 3 says the database is "recreated" with the hint `apac`. It is a new
  database, `cookpool-<env>-apac` (resource
  `cloudflare_d1_database.platform_apac`), and the one before it
  (`cookpool-<env>`, no hint) is dropped from Terraform's state with a
  `removed { lifecycle { destroy = false } }` block instead of being
  destroyed. A replacement in place would have deleted the old database at
  the start of the run, leaving every Worker bound to a database that no
  longer exists until its own deploy, or for longer if a deploy failed.
  This way each Worker keeps serving from the old database until it is
  redeployed onto the new one. D1 names are unique per account, hence the
  suffix; every Worker's `wrangler.template.jsonc` names the new database.
  **Owner step:** once the run is green and the old databases' Metrics show
  no queries since it, delete `cookpool-stage` and `cookpool-prod` in the
  Cloudflare dashboard.
- **The Cloudflare provider of `cloudflare-d1` moves to v5, pinned to
  5.28.1.** v4 (`~> 4.30`, at most 4.52.10) has no location hint on
  `cloudflare_d1_database`. 5.28.1 has `primary_location_hint` and upgrades
  the v4 state of this resource on its own. The provider gets an exact pin
  because the root has no lock file. `cloudflare-kv` and `cloudflare-domain`
  stay on v4. Creating the database through the D1 API inside `adopt.tf` was
  the alternative. It was rejected because that step runs at plan time, so a
  pull request's plan-only lane would have created the database before the
  merge.
- **The hint counts only at creation** (`ignore_changes =
  [primary_location_hint]`). Cloudflare never returns the hint, so an
  adopted (imported) database would otherwise plan a replacement, which
  deletes its rows.
- **Every Worker bound to `PLATFORM_DB` now waits on `db-migrate` on main**
  (an enforced edge, advisory on pull requests). Before, only identity,
  kitchen and notifications did, and the other ten would have gone live on
  the new, empty database before its tables existed. api-edge reads no
  tables (its `/health` ping only) but takes the edge too, so the rule has no
  exception. notifications-worker's edge, already ordering on main, now says
  so explicitly. tests/config-worker pins the edges.
- **Smart Placement is declared at the top level** of the thirteen
  templates, so `dev` inherits it as well. dev is verify-only (dry runs), so
  this changes nothing deployed. Placement moves fetch handlers only: cron
  triggers (kitchen, metering, integrations, webhooks) and api-edge's
  `RateLimiterDO` are placed as before. policy-worker and web-console-next
  bind no database and are unchanged.
- **Not measured yet:** whether reads from India now stay under 0.4 s. That
  is SM-2's timing check. Smart Placement moves a Worker only after it sees
  steady traffic from several locations, so a quiet environment may keep
  running near the caller for a while.

### SM1 — pages are files (SM-2)

- **What was slow was the Worker, not the rendering.** Measured on stage
  before the change (2026-11-04, curl, a new connection each, 5 runs; colos
  NRT/SIN/HKG): `/login` 0.53–1.81 s to first byte, `/home` 0.64–2.07 s,
  `/manifest.webmanifest` 1.21–2.20 s although it renders nothing, a 404
  0.28–2.70 s; the console Worker is a 16 MB bundle (2.5 MB gzipped), and a
  cold isolate pays for it. Every route was dynamic (`ƒ`): the root layout
  called `headers()` and also set `dynamic = "force-dynamic"`.
- **Static files already skipped the Worker.** `/_next/static/*` and
  `/icons/*` answered without `x-opennext` (Workers Static Assets, no
  `run_worker_first`), in 0.19–0.91 s with connection setup, most of it the
  TLS handshake and the colo. §1.1's "static files go through the worker
  too" was not so; no asset config changed.
- **Pages are files, and so are their client navigations.** The kitchen
  pages, `/login`, `/auth/callback` and `/` are prerendered, and
  `scripts/pages-as-files.mjs` copies each one's HTML into the assets (the
  build fails if one stops being static). An App Router client navigation
  fetches the RSC payload from the page's own path (`/home?_rsc=…`), which a
  static file cannot tell from a page load — served the HTML, Next would turn
  every in-app tap into a full reload and lose the in-memory cache SM-5
  builds on. So the payloads are files too (`/_rsc/home.rsc`), and an inline
  script in the root layout sends Next's RSC requests for exactly these pages
  there (`src/lib/static-pages.mjs`); everything else passes through, and a
  missing payload falls back to the original request. Not in the design: it
  is what keeps the Worker out of navigations as well as page loads.
- **A dynamic page is one file.** `/dishes/[dishRef]`, `/pantry/[itemRef]`,
  `/people/[subjectId]`, `/groups/[orgSlug]` (and its `expense`) and
  `/join/[code]` are prerendered once, for `_`; `_redirects` serves that file
  for every value (`/pantry/new` pinned first), and the pages read the value
  from the address (`usePathParam`), since `useParams()` says `_` there. Each
  segment's layout keys the page by the value, so going from one dish to
  another still remounts it, as before.
- **The browser resolves the config itself, from the compiled-in values.**
  `CONSOLE_CUSTOM_DOMAINS` joined the compiled defaults; `appConfig()` in a
  browser resolves once, synchronously, from `window.location.host`, on the
  first call — the session's state initializers, before any API client
  exists (risk SM-C). The Worker's `CONSOLE_*` vars no longer reach the
  browser at all (they still apply to what the Worker renders: the manifest,
  the admin console's server HTML), so a test keeps `DEFAULT_APP_CONFIG`
  equal to `wrangler.jsonc`'s vars. This narrows saas-console-artifact CA1:
  a console built from another tree would not take this product's identity
  from vars in the browser; Cookpool builds its own console.
- **The title stays "cookpool Console"**, now static: the deploy smoke greps
  `/` for it.
- **Sign-in's static file is the page with no query.** `?next=`, the join
  card, `?expired=1` and `?step=name` apply when the browser renders it
  (`useSearchParams` under a Suspense boundary, as Next requires for a
  static page).
- **Still the Worker's:** `/manifest.webmanifest` (runtime product name), the
  admin console (`/orgs…`, `/account…`, `/onboarding`, `/demo`; its routes
  without params now build as `○` but are still rendered by the Worker on
  request, with the no-op incremental cache), and any 404.
- **Caching:** the pages and payloads served as files take the assets
  default (`max-age=0, must-revalidate`, ETag) instead of `no-store`.
- **The timing check** (`tooling/perf/check.mjs`, `ai/context/operations.md`)
  reuses a connection per host by default (`--fresh` for a new one each
  time) and reports, per line, how many answers came from the Worker and
  which colos answered.

### SM1 — the API on the app's address (SM-4)

- **A service binding from the console Worker, not a Workers Route.** Design
  §1.2 item 2 had `cookpool.store/api/*` routed to api-edge on the zone, an
  owner step in the dashboard (the deploy token has no zone rights), and
  workers.dev hosts left on the workers.dev API. Instead the console Worker
  answers `/api/*` itself and forwards it to api-edge over `API_EDGE` (prefix
  stripped; method, headers, body and query as they came; `redirect:
  "manual"`; api-edge's answer returned as it is). It works on every host the
  console serves, workers.dev included, and deploys with the console: no
  dashboard step. design.md and risk SM-B now say so. `assets.run_worker_first:
  ["/api/*"]` keeps the API out of the static assets and SM-2's `_redirects`.
- **Its own entry, with OpenNext imported lazily.** `wrangler.jsonc` `main` is
  `src/worker/index.mjs`; it handles `/api` and imports `.open-next/worker.js`
  with a dynamic `import()` on the first other request, and re-exports
  OpenNext's two Durable Object classes (`DOQueueHandler`,
  `DOShardedTagCache`) so the deploy exports what it did. Verified: the
  bundle wrangler builds (esbuild, no `no_bundle`, no code splitting) wraps
  all of OpenNext in a deferred initializer that only the page path calls;
  under `wrangler dev` a log line at the top of OpenNext's module did not
  appear across `/api` requests (first one 19 ms, then 2 ms) and appeared
  on the first page the Worker rendered (`/orgs`, 268 ms, then 12 ms). Not
  avoided: it is still one 16.6 MB script (2.5 MB gzipped), so a cold isolate
  still loads and compiles it before an `/api` request; compiling it without
  running it took ~90 ms in Node on a laptop. Risk SM-B says what to do if
  that shows in the timing check.
- **Per-environment bindings through `CLOUDFLARE_ENV`.** The composition
  (`cloudflare-workers-assets-turbo`) deploys with `--name
  cookpool-web-console-next-<env>` and no `--env`, and the committed
  `wrangler.jsonc` had no environments. It now has `dev`, `stage` and `prod`
  sections (only stage and prod bind `API_EDGE` → `cookpool-api-edge-<env>`),
  and the component sets `env: CLOUDFLARE_ENV: "{{ .environment }}"`, which
  wrangler reads like `--env` (`--name` still names the Worker; checked in
  `orun plan`, which renders `CLOUDFLARE_ENV: stage` / `prod` / `dev` on each
  job). `vars` do not carry into environments, so each section repeats them;
  tests/config-worker keeps all four the same. Without `CLOUDFLARE_ENV`
  (local `wrangler dev`) the top level applies and `/api` answers 503
  `internal_error` (`details.reason: "api_edge_unbound"`).
- **The client address: trusted from the console only over its binding.**
  api-edge keys signed-out rate limits on `CF-Connecting-IP`, which a
  service-binding request does not carry. The console strips every address
  header a client sent (`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`,
  `True-Client-IP`, `Forwarded`, `x-console-client-ip`, …) and sends the
  `CF-Connecting-IP` Cloudflare gave it as `x-console-client-ip`. The rule
  in api-edge (`src/client-ip.ts`), applied once at the entry: when
  `ctx.props.caller === "web-console-next"` (the binding's `props`, set in
  the console's wrangler config, which only a deploy can set; a request from
  the internet has none), the address is `x-console-client-ip` if it is a
  bare IPv4/IPv6 address, else none; otherwise it is `CF-Connecting-IP` as
  Cloudflare set it, and `x-console-client-ip` is dropped unread. The
  request then goes on with exactly that one `CF-Connecting-IP` (or none)
  and no forwarded header, so rate-limit.ts is unchanged. A named
  entrypoint would have been the other way to tell the binding apart, and
  was rejected: Cloudflare documents that Smart Placement "only affects the
  execution of fetch event handlers. It does not affect RPC methods or named
  entrypoints", and api-edge's placement near the database is SM-3's point.
  Locally (workerd) the props reached the default `fetch` over the binding,
  and a public `/health` with a forged header still said `cloudflare`.
- **`/health` says which address it used** (`checks.clientIp.source`:
  `cloudflare`, `console` or `none`), and the console's deploy smoke now also
  requires `"source":"console"` from `${DEPLOYED_URL}/api/health`: proof
  that the binding and its props work in that environment. A stage that
  fails it holds prod back.
- **The console deploys after api-edge again on main** (`dependsOn:
  api-edge`, enforced on main, advisory on pull requests). A binding target
  must exist at deploy (Cloudflare 10143), and the console's forwarded
  header means something only to the api-edge of this change. It has
  deployed beside api-edge since stack-tectonic 0.18.2; this puts api-edge's
  deploy back on the console's path on main. api-edge depends on nothing
  that leads back (no cycle).
- **OAuth starts on api-edge's workers.dev host.** Its start sets a state
  cookie on its own host that Google's callback (registered on the
  workers.dev API, `OAUTH_REDIRECT_BASE_URL`) must carry back, so a start on
  `cookpool.store/api` would fail. The SDK gains `ClientOptions.oauthBaseUrl`
  (default `baseUrl`) for `auth.oauthStartUrl`; each API target carries
  `directUrl`, the workers.dev API, and the console passes it. Checked in the
  browser: the start navigates to
  `https://cookpool-api-edge-stage.cookpool.workers.dev/v1/auth/oauth/google/start?return_to=<page origin>/auth/callback`.
- **Which hosts call `/api`.** A target is the page's own `${origin}/api`
  only when the page's host itself names the target's environment (its
  custom domain or its `-<env>` workers.dev host), so a build locked to one
  environment opened on another's host keeps its workers.dev API; localhost,
  dev servers and the dev workers.dev host stay unlocked with both workers.dev
  targets (the developer's picker).
- **Smart Placement and the binding.** Cloudflare: "By default, both Workers
  run on the same thread of the same Cloudflare server. With Smart
  Placement, each Worker is placed in a location chosen to optimize overall
  performance", and its full-stack advice is a front Worker near the user
  calling a placed back end over a service binding. So api-edge (placed,
  SM-3) can run near the database while the console runs near the caller.
  The console gets no Smart Placement: it binds no database and makes one
  call per request.
- **Browser check** (the real build under `wrangler dev`, console plus a
  mock api-edge Worker answering from the UX mock, on
  `cookpool-web-console-next-stage.localhost`): sign-in, Home and a logged
  use made every API call to `/api/…` on the page's own origin, with no
  preflight (the browser's network log and the mock both saw only GETs and
  POSTs, every one with the console's props and a forwarded address and none
  with `CF-Connecting-IP`); SM-2's RSC shim kept sending navigations to the
  payload files.
- **Measuring is after the deploy.** `tooling/perf/check.mjs` now also times
  `/api/health` and `/api/v1/auth/oauth/providers` on each app host (both
  custom domains and both console workers.dev hosts) beside api-edge's own
  host. `ai/context/operations.md` still describes the reads as api-edge's
  only (outside this task's contract).
