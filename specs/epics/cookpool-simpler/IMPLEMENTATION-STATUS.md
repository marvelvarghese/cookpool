# cookpool-simpler (SM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SM0 — the spec | ✅ shipped 2026-11-04 | #36 (SM-1) |
| SM1 — fast | ✅ shipped 2026-11-04 | #37 (SM-3), #38 (SM-2), #41 (SM-4), SM-5 |
| SM2 — for anyone | in progress | #39 (SM-6) |
| SM3 — from before | ✅ shipped 2026-11-04 | #40 (SM-8), #42 (SM-9) |
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

### SM2 — portions for anyone (SM-6)

- **Route as built.** `PUT /v1/organizations/{org}/kitchen/dishes/{dsh}/claims/{subjectId}`
  `{ portionsHalf }` (`kitchen.dish.claim`, no new policy action), answering
  200 `{ dish }` with `myClaimHalf` still the caller's. It is a second router
  entry after `claims/me`, which still matches first and runs the same code;
  `me` and the caller's own `usr_…` id are the caller (no roster read, no
  email). Order of refusals: the opaque 404 (a viewer, someone outside the
  group, a dish not shared with it), 422 for the body or a malformed id
  (`validation_failed`, field `subjectId`), 409 `dish_not_open`, 422
  `not_in_group` (`details.subjectIds`) for anyone not on the roster — viewers
  are on it (they eat, CP-16) — then the claim's guarded write: 409
  `claims_exceed_portions`, `availableHalf` being what everyone else leaves
  free for that person. Two members setting different people at once are
  serialized by D1, and the second is refused by the same guard (tested with
  a write landing between read and write, and with two requests at once).
  SDK: `setPortion(orgId, dishId, subjectId, { portionsHalf })`.
- **Taking back the portion of someone who left is refused too** (422
  `not_in_group`, as the brief pins it, even for 0). The cook's `…/shares`
  replaces every share and can drop it. Follow-up if it matters: allow 0 for
  a person who still holds a share.
- **`set_by` (migration `290_kitchen_dish_share_setter`, one nullable `TEXT`
  column, null for older rows) is written by every share write: its caller.**
  That is a claim (the eater, or another member for them), the cook's
  `…/shares`, and a correction, which also rewrites the shares. The brief says
  `…/shares` "records the cook". It records whoever called it: the cook, or
  the owner or admin who split a stuck dish (`kitchen.dish.finalize_any`).
  Taking a portion back (0) deletes the row, so there is nothing to record.
- **`source` keeps its two values.** Its CHECK cannot change without
  rebuilding the table. `self` now means a claim (made by the eater, or by
  another member for them) and `cook` means the assignment or a correction.
  `setBy` says who. Until SM-7 reads `setBy`, the dish page still shows
  "Claimed it" for a portion someone else set.
- **`setBy` is optional in the contract type** (`setBy?: string | null` on
  `KitchenDishShare`), but every dish read sends it (the dish, both lists,
  every write's answer). tests/web-console-next builds `KitchenDishShare`
  literals and is outside this task. SM-7 can make it required when it
  touches them. No setter name is added: dish reads carry no names (CP-16),
  and the app has the group's member list.
- **The email is its own template, `kitchen.portion_set`**, the fourth in
  `KITCHEN_EMAILS` (data `PortionSetEmail`: `actorName`, `dishName`,
  `groupName`, `portions`, `yourShare`, `dishUrl`). It is not a fourth `kind`
  of `kitchen.logged_for_you`, because the idempotency key is
  template-scoped: `kitchen.portion_set:<dsh>:<usr>`. Subject "Anu said you
  had 1 portion of Egg fried rice". The body gives the share at the dish's
  price as it splits now (for the cook, without the unclaimed portions) and
  links to `/dishes/{dsh}`. It goes under the dish's group as `product`
  email, so the group's product opt-out stops it. It is sent only when
  someone else sets a portion above 0, after the batch commits
  (`ctx.defer`), best-effort. Not for your own portion, not for taking one
  back, not from `…/shares` or corrections. kitchen-worker asks on every such
  write and notifications-worker collapses repeats. So "once per dish and
  person" means a later change (1 → 1½ portions, or by a third member) sends
  nothing more.
- **No audit event.** Like claims and assignments (CP-16), setting a portion
  moves no money and writes no event. The row's `set_by` and the email are
  the trail (risk SM-E).
- **Deploy order.** db-migrate (290) before kitchen-worker is enforced.
  notifications-worker is a peer edge. If kitchen-worker goes live first, a
  portion email asked for in that gap is recorded as failed (no template)
  under its key, and that dish and person get no email later either.

### SM3 — from before: the history and recipes reads (SM-8)

- **Routes.** `GET /v1/kitchen/me/items/history?q=&limit=` and
  `GET /v1/kitchen/me/dishes/recipes?q=&limit=` (kitchen-worker
  `handlers/from-before.ts`; SDK `kitchen.itemHistory(q)` and
  `kitchen.recipes(q)`; contracts `ItemHistoryResponse`, `RecipesResponse`).
  `limit` is 1–20, default 8; anything else is 422 `validation_failed`, as on
  the other lists. They sit ahead of the `{itm}` and `{dsh}` routes in the
  router, whose capture would otherwise take "history" and "recipes".
- **Match order.** Design §3 says "newest first". Names starting with the
  text typed come first, then names with a word starting with it, then names
  that only contain it, and newest first within each, so "mi" puts Milk ahead
  of a newer Jasmine rice. With no text, the order is newest first.
- **What counts as bought before.** Every record of the name counts,
  including used-up and wasted ones. Two kinds are left out: items removed
  as added by mistake, and a dish's leftovers (`source_dish_id`), which were
  cooked, not bought. "Last time" is the record with the latest `bought_on`,
  then the latest `created_at`, so a purchase logged later but bought earlier
  doesn't win. `useByDays` is never below 0, because an edit can set a use-by
  before the day bought.
- **What counts as cooked before.** Canceled dishes are left out: they
  neither show nor count towards `times`.
- **Case.** Names group and match case-insensitively through SQLite's
  `lower()`, which folds ASCII letters only (as the pantry search does).
- **Seeing only what one may.** History reads the caller's own pantry and
  every group they hold a group role in, viewers included, as the
  cross-pantry reads do. A billing admin's group is not read. Recipes read the
  caller's dishes and those shared with any of their groups, as the dish list
  does. An ingredient's `pantry` is null when it came from a pantry the caller
  can't see: another cook's own pantry, or a group they aren't in. A recipe's
  `orgId` is null once the caller has left that group. `match` comes only
  from the caller's own pantry or a group where their role holds
  `kitchen.item.use`, so a viewer group's stock is never matched.
- **Fields added to the brief.** The brief didn't name three fields that
  were added: `Recipe.currency` (extras and total need it), `Recipe.totalMinor`
  ("₹156" on the canvas), and `RecipeMatch.pantry` (the note under an
  ingredient names where the match is now, which can differ from last time).
- **One statement each, no new index.** No migration. The history read is a
  window over the items in scope, found through the existing owner and group
  indexes. The recipes read is one statement of `MATERIALIZED` steps: the
  dishes in scope by cook and by group, then their newest ingredients by
  dish (a `CROSS JOIN` keeps that order), then the usable items with those
  names by owner and by group, then the best item per ingredient. No step
  scans a table. tests/db pins both plans. Both reads grow with the caller's
  own history, not the database's. With 18,000 visible items (118,000 in the
  database), node:sqlite runs a history read in 23 ms ("mi") and 80 ms (empty
  text). A recipes read over 2,000 visible dishes (22,000 in all) takes
  14 ms.

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

### SM3 — from before, in the app (SM-9)

- **Where.** The name field of Add item (`/pantry/new`, where "+ Add → I
  bought food" lands) and of the dish maker (`/cook`) is a combobox over the
  SM-8 reads; the suggestions sit directly under it, one 44 px row each —
  "Milk · 1 L · Flat 4B · 6× · ₹68", "Egg fried rice · 3× · 5 portions ·
  ₹156" — under a small "From before" / "Cooked before" label (the list's own
  label, as on the canvas; nothing is added above the field). Focus (or a tap
  on the field after Esc) shows the most recent; ↑/↓ move and wrap, Enter
  picks the highlighted row (with none highlighted it stays the form's), Esc
  closes. A row is pressed without taking focus from the field, so a tap is
  one pick. Pure parts in `components/kitchen/from-before.ts`, the reads in
  `from-before-data.ts`, the combobox and list in `from-before-ui.tsx`.
- **The reads.** `useItemHistory(q)` and `useRecipes(q)`: one React Query
  entry per typed text, normalized as the server matches it (trimmed, spaces
  collapsed, ASCII letters folded, 100 characters), under `kitchenPantry()` —
  so adding an item, a use and cooking (which refresh every pantry read)
  refresh them too. `staleTime` five minutes (retyping a prefix answers from
  the cache), `placeholderData: keepPreviousData`, no retry (a failed read
  just shows no suggestions). The query function hands React Query's signal
  to the SDK, so the request for a text typed past is aborted when the field
  moves on (tested against a real `QueryClient`). The text is debounced
  120 ms; an emptied field asks at once. **`limit=5`**, not the read's
  default 8: five rows fit above a phone's keyboard. While the next answer
  loads, the last one is narrowed at once to names containing what is typed
  now, and kept whole when nothing in it matches, so the list follows each
  keystroke and never flashes empty.
- **On a phone the list stays in sight** (rule 1): below 900 px, when the
  list would end under the keyboard (`visualViewport`) or, with the keyboard
  down, under the tab bar and a sticky button, the page scrolls just enough —
  never so far that the field leaves the screen.
- **Bought: what a pick fills.** Name, quantity and unit, price, pantry, who
  paid, the waste rule and a use-by as many days after buying as last time —
  and the **category**, which the brief didn't list but the form requires
  (without it "tap Add" would stop at "Pick a category"). The use-by counts
  from the form's "Bought on", which is today unless changed. Focus then moves
  to Add (focusing scrolls to it; the form's layout is as before, SM-11
  restyles it), so buying milk again is: type "mi", tap Milk, tap Add.
  Last time's pantry when you can no longer add there (you view it, or left)
  falls back to the form's default — the `?pantry=` group when you add there,
  else your own — and the rest is kept, with two exceptions: who paid becomes
  you when it falls back to your own pantry, and the **price is cleared when
  the pantry it falls back to counts in another currency** than last time. A
  unit or category the app doesn't know keeps the form's own; a cooking
  measure opens "more" units.
- **Cook: what a pick fills.** Name, portions (1–100), extras, who it is for
  and the ingredients. **Who it is for:** the group, while you still cook in
  it; a group you now only view keeps the form's default; and **`orgId:
  null` is "Just me"** — null means either a dish for its cook alone or a
  group you have left, the form can't tell which, and "Just me" never posts a
  dish to a group nobody picked. The split mode stays the form's (a recipe
  doesn't carry it). Each matched ingredient goes in at last time's amount,
  never more than is left now, priced by the form's own pricing from the
  item in the usable-items list; two ingredients from one item go in as one.
  A match that list doesn't hold (it lists 100) is read on its own
  (`useItemsByRef`) once the list has loaded, with a placeholder row
  meanwhile — never guessed. An ingredient with no match, whose item has
  nothing left now, or whose item can't be read reads "Not in a pantry · add
  it"; a tap opens the existing "Bought it just now?" for it (a new `buy`
  prop on `PantryPanel`), with its name and last time's unit — how much and
  the price are what you bought now — and once added, that line takes last
  time's amount, not all of it. A second pick replaces what the first one put
  in; what the cook added by hand (or came with "Cook with it") stays. Focus
  then moves to the Ingredients heading, which on a phone puts the keyboard
  away over what was filled.
- **Tests** (`tests/web-console-next/src/kitchen-from-before.test.ts`, 35):
  the Add-item fill (pantry fallback, other currency, use-by across months,
  a leap day and the year's end, the request it posts), the recipe fill
  (matched, capped, pending, missing, a group no longer yours, "Just me"),
  the debounce, the stale request aborted and the cache answering a retyped
  prefix, the keyboard. The test package maps `@tanstack/react-query` to the
  app's own install (it has no copy of its own, and adding one would change
  the lockfile).
- **Left for SM-11.** The canvas's "Filled from last time · change anything"
  card and "Add Milk · ₹68" button belong to Add item's and Cook's restyle;
  both screens keep their layout (and Cook its subtitle) here.

### SM1 — writes show at once (SM-5)

- **One optimistic handle, not a `useMutation` per write.** The writes were
  already callbacks with their own toasts and refusal words, so React Query's
  pattern — patch before the request (`onMutate`), roll back exactly when it
  is refused (`onError`), read again what it touched once it answers
  (`onSettled`) — is one handle they share (`beginWrite`,
  `src/components/kitchen/optimistic-data.ts`) over a pure core
  (`src/lib/optimistic.ts`). Each write's patches are pure too
  (`src/components/kitchen/cache-patches.ts`): one write patches every cached
  read that shows the thing, by the `qk.*` keys. tests/web-console-next
  (`kitchen-optimistic.test.ts`) applies each write's patches to a cache
  holding every read a phone has after Home, Pantry, an item, a dish and a
  group, and rolls them back.
- **What the screen shows at once, per write.**

  | Write (screens) | Changes in the same frame | A refusal puts back |
  |---|---|---|
  | Log a use (Use, the item page, Do it again, Home's one tap) | what is left (and what the rest is worth, by the engine's cost of use — the price on the button) on the item, every pantry list, Home's strip and card, search, usuals; a row at the top of the item's history; the Use screen resets, the sheet closes | all of it, exactly |
  | "Used it" (Home's use card) | the card's "left" (the card goes when nothing is left) | the card |
  | Waste (the item page) | none left, the history row | all of it |
  | Claim / portion (the dish page, Home's chips) | the share, "x of y claimed", Home's "x of y portions left"; the dish page previews what it costs with the engine | the dish as it was |
  | Finalize (the dish page, Home) | the dish reads finalized everywhere, Home's card goes | the dish and the card |
  | "Paid" (Home, Settle up, a group's Balances, a person) | the payment leaves the group's plan and Home, its row tops the group's activity; on All groups the row reads "Recorded" | plan, Home, activity |
  | Add an item | the pantry opens with the item listed (inert until the server's item replaces it) | the row |
  | An expense | the group opens with its row on top: who paid, each share as the form split it | the row |

  Every one opens the one Undo toast at once. Its second line, where it is
  money (what a use or waste charged, what finalizing posted), is the
  server's, filled in when it answers.
- **Money stays the server's (risk SM-D).** Balances, plans' amounts, pantry
  totals and a dish's `amounts`/`netting` are never patched; they are read
  again once the write answers. Two numbers that are not balances do change:
  the plan's payment count (a row taken off) and an item's worth (by the
  engine, as the button priced it). While a portion is shown before the
  answer the dish's `amounts` lag its shares, so the dish page previews the
  split with the engine then (`amountsFitShares`): before, it showed "₹0.00
  (your share)" for that moment.
- **A refusal turns the same toast into why**: "Couldn't log Milk" with the
  refusal message each screen had, in one line, and no Undo. The inline
  error boxes on the Use form, the item page's Use and Waste, the claim
  buttons and Home's cards are gone: the toast says it, and the form has
  usually moved on. The item page still takes people who left the group off
  "Who had it". Add item and Add expense navigate at once, so a refusal there
  (rare: both forms validate first) means typing it again; the form's own
  field errors from the server are now the toast's one line.
- **Undo works before the answer.** Pressing it puts the screen back at
  once ("Undone" shows at once), and the reversal is sent once the write
  has landed — or nothing, if the write was refused. Pressed after the
  answer, the reads that hold the server's answer get the inverse patch.
  Either way a refresh already on its way is stopped first, so it cannot
  bring the undone write back. A claim burst (taps on − ½ +) is one toast
  whose words follow the taps; Undo goes back to before the burst.
- **Finalize keeps "Correct it", not Undo.** The canvas shows Finalize
  turning into Undo; there is no un-finalize route (a correction is a
  reversal and a new transaction), so the toast still offers Correct it.
- **Home's claim card stays until the server answers.** The server drops a
  claim card once you have a share; the card's count and your chip change at
  once and the card goes with the inbox's refresh, as before.
- **Refreshes wait for writes on their way** (`afterWrites` in `useApiQuery`,
  and in the dish, item, activity and Dishes reads): a read again of
  something on screen started while a write is on its way waits for it, so
  an answer computed before the write cannot bring the old screen back for a
  moment. A first read (nothing on screen) goes at once. Not in the design.
- **Left waiting for the server, on purpose:** cooking (the page it opens is
  the dish the server makes: its id, price per portion and who owes whom are
  the server's), the cook's shares, a correction and cancelling a dish (they
  re-split or reverse money), moving an item into a group (it becomes
  another item, in another pantry), Undo of an entry from the activity menu
  (already struck through at once since CP-8), flags, group settings, roles,
  join codes, joining, leaving and new groups.
- **No spinners on revisit:** `staleTime` 60 s (was 30 s) and `gcTime` 30 min
  (was 5): writes refresh what they touch, so tabs within a minute read
  nothing again, and a revisit within half an hour paints from the cache.
  Quick use's search keeps the last matches while the next come
  (`keepPreviousData`); a pantry chip opened the first time shows its items
  from "All" until its own arrive. The toast API gained `update` and
  `dismiss` (and `toast()` returns an id).
- **Home reads ahead what its rows open:** each person on the balance card
  (their "why") and the group members of each dish card, when Home renders;
  a group row (members, balances, first activity page), a recent row, a
  use-soon item (and its history) and a to-do card, on press-in (pointer
  down, hover, focus).
- **Waterfalls taken out.** A group page opened cold waited for the group
  list before reading the group: the slug's id from last time is remembered
  on this device (`recent-groups.ts`, beside the recent slugs, cleared on sign
  out and on leaving) and its members, balances and activity start beside
  the list; Home's Recent activity does the same for the groups opened most
  recently. The pantry page read a chosen pantry's items only after the
  pantry list (to check it is still reachable): they now start together. The
  item page read its history and its group's members only after the item:
  they now start with it. Left, because the second read needs the first's
  answer: a dish page's group members (Home reads them ahead), the inbox's
  cards' dishes and items, Settle up's per-group plans.
- **For SM-7:** a portion's patch takes whose portion it is
  (`PortionChange.subjectId`, `withPortion`, `portionPatches`; `ownPortion`
  is the caller's), and its `setBy` and `myClaimHalf` follow the caller, so
  setting someone else's portion reuses it.
- **Measured** (the production build, the UX mock answering every request
  1.5 s late, in the app's browser pane, from the tap to the DOM change):
  logging a use on the item page changed what is left in 8–13 ms and opened
  the toast in 5–10 ms (before: 3.0 s and 1.5 s — the write's round trip,
  then a read's); Undo 13 ms; a forced refusal put it back 1.5 s after the
  tap, when the answer came; Home's claim chip 23 ms, "Used it" 19 ms,
  Finalize 17 ms, "Paid" 14 ms; Settle up's Record 8 ms; Add item opened the
  pantry with the row listed in 46 ms and Add expense the group with its row
  in 92 ms (the dev server; the payload fetch). The pane was hidden, which
  slows timers and rendering; a visible tab should be quicker. Revisiting
  Home, Pantry, People and Groups showed no skeletons; a person opened from
  Home painted without one.

### SM1 — the exit check (2026-11-04)

`node tooling/perf/check.mjs` after SM-2, SM-3 and SM-4 deployed, from the
owner's machine (kept-alive connection, 10 GETs each, p75):

- **Pages** on every app host came from assets (`worker 0/10`): stage
  0.07–0.13 s (SIN), prod 0.20–0.23 s (MRS). All under 0.3 s.
- **Reads** through `/api` on the app's own address, answered in Asia
  (SIN, HKG, NRT): `/health` (one D1 query) 0.18–0.19 s, providers
  0.08–0.19 s. Under 0.4 s.
- **Not from India.** This machine is routed to SIN/HKG/NRT most of the time
  and to CDG/MRS some of the time; from CDG `/health` is 0.43 s, because the
  database is in Asia–Pacific and Smart Placement had not moved the quiet
  api-edge yet (`cf-placement: local-*`). The budget is for India, which
  Cloudflare serves from Indian and nearby Asian colos.
- **Writes** show at once (SM-5): from the tap to the screen 8–23 ms against
  a mock that answers in 1.5 s; a refusal rolls back when the answer comes.
