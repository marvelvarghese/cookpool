# cookpool-app (PW) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| PW0 — the spec | landing | PW-1 |
| PW1 — an app on your home screen | | |
| PW2 — no signal, clean updates | | |
| PW3 — notifications | | |
| PW4 — gestures | | |

## Departures from the design

### PW2 — no signal, clean updates (PW-4)

- **Our own worker, built per deploy.** `scripts/service-worker.mjs` runs
  after `pages-as-files` and writes `.open-next/assets/sw.js`: the worker's
  modules (`src/service-worker/*.mjs`, plus SM-2's page table) bundled into
  one classic script, with this build's id and precache list — the 17 pages
  served as files at their own addresses (`/home`, `/dishes/_`, …; not the
  OAuth return), their `/_rsc/*.rsc` payloads, every `/_next/static/**` file
  and the icons (174 files, 3.2 MB on this build). Caches are
  `cookpool-static-<build id>`. A page or payload that does not name the
  build id fails the build and, at install, fails the install (a second
  deploy landed while it downloaded: the browser retries). A hashed file an
  earlier build's cache already has is copied, not downloaded again.
  `public/_headers` serves `/sw.js` with `Cache-Control: no-cache`; no
  `_redirects` rule or `run_worker_first` path takes it (tested).
- **Not the manifest.** The brief listed "the icons and the manifest" for the
  precache and "the manifest route" as network-only. The manifest is the
  Worker's route, rendered per deploy (runtime product name), so it stays
  network-only, as design §3 lists the precache.
- **The fetch rules are one pure function** (`classify`, routes.mjs), tested
  as a table: page loads and payloads network-first with a 3 s cutoff, then
  this build's copy (a dynamic page falls back to its `_` file); hashed
  files and icons cache-first; the listed API reads network-first into the
  account's cache; everything else network-only and never cached (any
  write, `/api/v1/auth/**`, join codes and previews, typed searches,
  `/auth/callback`, the manifest, the admin console's pages, other origins).
  Navigation preload is on, so a network-first page load does not wait for
  the worker to start.
- **The API reads kept** (after `/api`): `/v1/organizations`;
  `/v1/kitchen/me/` `inbox`, `usuals`, `pantries`, `items`, `items/:id`,
  `items/:id/moves`, `dishes/:id`, `balances`, `people/:subjectId`;
  `/v1/organizations/:org/kitchen/` `items/:id`, `items/:id/moves`,
  `dishes`, `members`, `settings`, `balances`, `settle-plan`, `activity`.
- **API reads have no cutoff.** They answer from the cache only when the
  network fails. A cutoff would let an answer stored before a write replace
  what SM-5 patched on screen on a slow connection.
- **"You" is not cached offline.** The profile (`/api/v1/auth/profile`) is
  under `/api/v1/auth/**`, which the brief keeps network-only. So offline
  screens show the last data without the person's own name and "you" parts:
  Home says "Good evening" with no name, and a dish shows no claim controls.
  Caching just the profile in the account's cache would restore them; that
  is a decision for the owner.
- **Per account, bound to the session.** The page sends the subject id and a
  SHA-256 of the session's token (`cookpool:account`) after sign-in and on
  every load. The page takes the subject id from the profile read every
  signed-in page makes anyway, so this adds no request. The worker keeps that one
  record (`cookpool-meta`, a hash, never a token). It answers from, or
  stores into, `cookpool-data-v1-<subject id>` only for requests that carry
  that very token. A request with any other token goes to the network and is
  never stored: another account in another tab, or a session from before. Telling it about another account
  deletes every other account's data. Signing out deletes all of it. So does
  a 401 that ends the session, or a page that loads with no session: the
  session's `setToken(null)` and the page itself both delete it. Entries are
  keyed by address alone, so no request header is stored. An answer still on
  its way at sign-out is not kept. Each account's cache is capped at 300
  answers.
- **Offline, as the page sees it** (`lib/connection.ts`): the browser says so,
  or the last API call failed for network reasons. An answer the worker gave
  from its cache counts as a failure; it carries `x-cookpool-cached-at`, which
  is where the banner's "as of 7:42 pm" comes from (the oldest shown). The
  banner sits in the root layout, so every page has it (canvas colours). It
  goes when an answer comes from the network, and then every read is
  refreshed. While offline the page retries on `online`, on return to the
  app, and every 30 s. React Query reads use `networkMode: "offlineFirst"`.
  Without it, a read started after the browser's `offline` event would never
  ask the worker.
- **Writes held back at three layers, so no write path is missed.**
  - `beginWrite` applies no patch and returns a handle that does nothing.
  - The Undo toast offers nothing, and an Undo pressed offline is held back.
  - The API client itself refuses every non-GET except sign-out, before
    anything is sent. This covers cook, settings, join, sign-in and every
    other path; the refusal comes back as `network_error`, `reason: "offline"`.
  The one-line toast is "You're offline · nothing was logged". A screen's own
  refusal toast that only repeats those words is shown as that one toast, once.
  A claim tap is held back before its burst shows the new count
  (`usePortions.set`). Nothing is queued.
- **Updates.** A new build installs and waits. If the open page already is
  that build, the new worker takes over silently, with no offer and no
  reload. That is the usual case after a deploy, because pages are
  network-first. The page sends its build id, read from its own flight data,
  and the worker compares it with its own. Script tags were not enough: the
  browser check showed that a changed layout chunk is loaded on demand and is
  not among them. If the page cannot read its build id, nothing is adopted and
  the offer shows. Otherwise the shared toast offers
  "New version · Reload". It waits while SM-5 counts a write on its way, while
  an Undo toast is up (the canvas), while offline, and on the sign-in pages
  (all of `/login` and `/auth/callback`, not only mid-code). Closing it
  hides it until the app comes back. Reload: `skipWaiting`, then
  `controllerchange`, then one reload (or a reload after 4 s if the swap never
  comes). On return to the foreground the page checks for a new build. Away
  (hidden) more than 24 h with one waiting, it reloads itself.
- **Kill switch.** Set `src/service-worker/switch.mjs` to `"off"` and the
  build writes a worker that takes over at once, deletes every `cookpool-*`
  cache, unregisters and reloads its pages from the network. Pages of that
  build unregister instead of registering (`docs/runbook.md`).
- **Registration** is only in production builds, after `load`, from
  `ServiceWorker` in the root layout. `next dev` unregisters a leftover
  worker on its origin. A failure leaves the app as it was.
- **Browser check** (the production build under `wrangler dev`, the SM-7 UX
  mock answering `/api` on the page's own origin from Node, so API calls
  really go through the worker; headless Chrome 156 on
  `cookpool-web-console-next-stage.localhost`, 390×844). The app's browser
  pane cannot register a service worker at all ("An unknown error occurred
  when fetching the script", on any host), and Claude in Chrome was not
  reachable.
  - Online: `/sw.js` came with `cache-control: no-cache`, `/_next/static/*`
    with `immutable`, and `/_headers` was not served. The worker installed
    174 files and took over. After Home, Pantry and a dish, the account's
    cache held the listed reads, keyed by address; the record held the
    subject id and a hash.
  - Both servers stopped, then a reload: Home, Pantry (by its tab and by
    address) and `/dishes/dsh_…2` opened from the worker, with the last data
    and the banner "Offline · showing what you saw last · as of 2:19 am".
    Logging 1 pc of Eggs showed the one toast "You're offline · nothing was
    logged", with no Undo. No write request left the page, and Pantry still
    read "7 of 12 pcs". With the servers back, the banner went at the next
    retry and the screen refreshed.
  - Updates, round 1: a rebuild with a visible change (the People tab
    renamed, then reverted) was adopted silently. The adoption then compared
    the page's scripts, and the changed layout chunk is loaded on demand.
    That check was replaced by the build id.
  - Updates, round 2: a page of the new build loaded while the old worker
    was in charge was adopted silently, as it should be. Then a page of that
    build was brought back to the foreground after the next deploy. The new
    worker installed and waited, the page showed "New version · Reload",
    and Reload made one reload into the new build (the tab read "People"
    again). The old cache was deleted and the account's data was kept.
  - A first visit (worker and caches cleared) recorded the account without
    a reload; the browser check is what found that bug (fixed with
    `serviceWorker.ready`).
  - "Sign out of this phone" sent the logout and left only the build's own
    cache: the record and the data were gone.
- **Not done here (page code, other tasks):** Add item and Add expense still
  navigate at once (SM-5), so offline the form is left and the toast says
  nothing was logged. Keeping the form when `isOffline()` is a line for the
  + Add rebuild (SM-10) and the expense page.
