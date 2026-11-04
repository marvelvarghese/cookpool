# cookpool-simpler (SM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SM0 — the spec | ✅ shipped 2026-11-04 | #36 (SM-1) |
| SM1 — fast | | |
| SM2 — for anyone | | |
| SM3 — from before | | |
| SM4 — simpler screens | | |
| SM5 — the rest | | |

## Departures from the design

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
