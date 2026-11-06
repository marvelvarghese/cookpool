# cookpool-simpler (SM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SM0 — the spec | ✅ shipped 2026-11-04 | #36 (SM-1) |
| SM1 — fast | ✅ shipped 2026-11-04 | #37 (SM-3), #38 (SM-2), #41 (SM-4), #43 (SM-5) |
| SM2 — for anyone | ✅ shipped 2026-11-05 | #39 (SM-6), #44 (SM-7) |
| SM3 — from before | ✅ shipped 2026-11-04 | #40 (SM-8), #42 (SM-9) |
| SM6 — your measures | in progress | #46 (SM-13), SM-14 |
| SM4 — simpler screens | ✅ shipped 2026-11-05 | SM-10 (Use is rebuilt in SM-14) |
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

### SM2 — portions for anyone, in the app (SM-7)

- **Every person in the group has a row on an open dish, viewers too.**
  Viewers eat and anyone may count them in (SM-6), so they are listed like
  everyone else. Any member (not a viewer) steps any row. The rows keep
  their place as portions change: the cook first, then the group with you
  first and the rest by name, then anyone else who holds a share (someone
  who left). Before, a new share moved up the list under the thumb. The
  cook's edit (a draft, a correction) uses the same order. A finalized dish
  still lists only who had some, in the order they were shared.
- **"by Anu", and numbers only under each name.** A row someone else set
  reads "by Anu", or "by you" when you set it. It reads nothing when the
  person set their own, or `setBy` is null or missing (shares from before
  SM-6). The amount follows ("by Anu · ₹62.40"). The words are gone: "Claimed
  it", "You claimed this", "You set this", "Hasn't claimed", "Not set", "Had
  none" and "(your share)". Only "Not saved yet" stays, in the cook's edit.
  A share the cook assigned is "by" the cook too, since `…/shares` records its
  caller.
- **What is left shows once, over the rows.** An open dish reads "2 of 5
  left", green at "0 of 5 left". The leftovers note is hidden while the dish
  is open, so the count is not said twice. Draft, correction and finalized
  dishes keep "x of y set/claimed" and the note. A + that would go past what
  is free is off: the limit is what that person has plus what nobody has,
  read from the cached dish, which already holds any portion on its way.
- **One write pattern, for anyone.** SM-5's `useClaimer` became
  `usePortions` (dish-data.ts): a burst of taps per person, on `beginWrite`
  + `portionPatches` (`portionChange(dishId, subjectId, meId, half, at)`
  replaces `ownPortion`). Your own portion goes to `…/claims/me` as before;
  anyone else's goes to `…/claims/{subjectId}` (`setPortion`). `useClaimer`
  is now `usePortions` for the caller, so Home's chips are unchanged (they
  still claim only your own, as briefed). Measured on the production build
  with the mock answering 1.5 s late: the tap to the row reading "by you"
  took 7–52 ms.
- **One toast at a time, in one line.** Someone else's portion toasts as
  "Dev Patel · 2 portions", with Undo. Your own keeps its old toast. Stepping
  a second person closes the first person's toast; their write still goes,
  and a refusal still opens its own toast. A refusal for someone else reads
  "Couldn't change veena.k's portion / Only ½ portion is left for veena.k
  now." (409 `claims_exceed_portions`, from `availableHalf`). Also "Every
  portion is taken now." (0 left), "Dev isn't in the group any more." (422
  `not_in_group`) and "You only view this group, so you can't set portions."
  (the 404). These words are the caller's own claim refusals, worded for
  someone else.
- **"Anu · 1 portion" is that toast, not a button.** The brief gives it as a
  main-button label for Dish. On the dish page a member has no main button:
  the steppers write at once (SM-5), and the toast names whose portion
  changed and how much.
- **Gone from the dish page, as duplicates (rule 6) or explanations
  (rule 2):** the "How much did you have?" card (your row's stepper does the
  same; Home keeps the card), the viewer's "You view …, so you don't claim
  portions" card, "Set everyone's portions yourself" and an admin's "Set
  portions" on an open dish (the rows do it; both stay for a draft), and
  "{group} was emailed when you cooked, so everyone can claim theirs."
- **Faces, one component** (`faces.ts`, `faces-ui.tsx`). `FaceRow` is a
  grid of faces: initials on a colour that is the same on every screen
  (yours is the app's green, others one of six by id), the name under each,
  you first and the rest by name. It shows ten faces, then "+N" (anyone
  picked further down stays shown). A tap puts the person in or takes them
  out. `Face` is one person. The faces replace "Who had it?" (`WhoHadIt` is
  removed) on Use and on the item page's Use. On Bill they replace the
  "Paid by" chips (one pick) and, in Equally, the tick list ("For", with
  Everyone / No one). The dish page's rows and Bill's per-person rows (Exact,
  %, Shares) use `Face`. Seven or more people share six colours, so two
  faces can match. The initials and names tell them apart.
- **The main button says who it is for.** On Use it reads "Log 1 glass ·
  ₹17.00 / You + Anu · ₹8.50 each". On Bill it reads "Add · ₹600.00 / You +
  Anu · ₹300.00 each". With no amount yet it reads "Add expense". Exact, %
  and Shares give names only. "≈ ₹5.67 each" means the paisa do not divide
  (the engine's split). Four or more people read "You + Anu + 2 more". Bill's
  button is now the one main button: sticky above the tab bar on a phone,
  with Cancel removed (the back link stays). The item page's button keeps its
  label ("Log 100 g for you and Dev"), which already named who.
- **Less text on Use and Bill.** Use loses the who-owes-whom list, its two
  empty-state sentences and "… Split equally; whoever paid is paid back." The
  button carries the numbers, and "Meera paid" is in the item's line. Bill's
  Equally loses its hint, the "assigned" check and "Enter the amount to see
  everyone's share."
- **Fixed: the expense toast read "split split equally".** It now reads
  "₹600.00, split equally." (`expenseAddedText`).
- **`KitchenDishShare.setBy` stays optional** in `packages/contracts`, which
  is outside SM-7's contract. The app treats `undefined` as null.
- **Follow-ups.** Someone who left the group but still holds a share has a
  row with a stepper. Changing it is refused (422 `not_in_group`, SM-6), and
  the toast says they are not in the group any more. SM-6's suggested fix
  (allow 0 for a person who still holds a share) would let it go to 0.
  Nothing to redeploy beyond the console: only web-console-next changed.

### SM6 — your measures, in the server (SM-13)

- **Routes as built.** `PUT /v1/organizations/{org}/kitchen/items/{itm}/measures`
  (`kitchen.item.use`, no new policy action) and
  `PUT /v1/kitchen/me/items/{itm}/measures` (the pantry's owner), body
  `{ measures: [{ one, many, count, amountMilli }] }`, 0–3 entries, answer
  200 `{ measures: [{ id: "msr_…", one, many, count, amountMilli }] }` in
  order (kitchen-worker `handlers/measures.ts`, `measures.ts`). Order of
  refusals: the opaque 404 (a viewer, someone outside the group, another
  pantry's item, a malformed id), 422 `validation_failed` with field errors
  (`measures`, `measures[1].one` …). The words are trimmed, 1–24 characters,
  each `one` once case-insensitively; `count` and `amountMilli` are positive
  safe integers. SDK: `kitchen.setMeasures(scope, itemId, measures)`, where
  `scope` is `{ kind: "personal" }` or `{ kind: "group", orgId }` — an item's
  `pantry`, or the app's item ref, fits as is (contracts `ItemScope`).
- **Also refused: `amountMilli` below `count`.** Not in the design. A measure
  smaller than a thousandth of the unit would make half of one round to
  nothing, a use that takes no stock. Every real size passes (a grain of rice
  ≈ 0.02 g is `count` 1, `amountMilli` 20).
- **Replacing keeps what stays.** One batch: the words the name no longer has
  are deleted and the rest upserted on the table's unique
  (`owner_kind, owner_id, name_key, dimension, one`), so a word kept keeps its
  `msr_` id and `created_by`/`created_at`, and every row written records the
  caller in `updated_by`. The unique is case-sensitive: changing "Onion" to
  "onion" is a new measure. Last writer wins between two people saving at
  once (each batch leaves exactly its set). No audit event: a size moves no
  money (like a portion, SM-6); the row says who set it, and a use's audit
  payload now carries its `label`.
- **The name key is SQLite's.** `name_key` is written and looked up as
  `lower(trim(name))` in SQL on both sides, so it folds exactly as the pantry
  search and the history reads do (ASCII letters) and can never disagree with
  itself. The `measure` a use names is matched against `one` in the worker,
  case-insensitively (any letters). Owner: `owner_kind` user with the
  person's `usr_…`, or group with the group's UUID, as `kitchen_items` keys
  its pantry.
- **One statement for many items.** `repo.listMeasures(keys)` binds every
  (pantry, name, dimension) as one JSON parameter and answers one list per
  key; the worker folds items sharing a key into one. The lookup goes through
  `kitchen_measures_lookup_idx` (pantry, name, dimension, position), so it
  also comes back in order; tests/db pins the plan. Both the table's unique
  index and this one exist: the second is the one that gives the order.
- **Every item answer carries `measures`**, not only the reads: a pantry's
  list, every pantry (`/me/items`, `usable=1`), search, one item (both
  scopes), and every write that answers an item — add, edit, remove, use,
  waste, undo, transfer (a moved item reads the group's measures for its
  name). The settings and the measures are read side by side, so a group's
  list is three statements however many items (items, settings, measures),
  an item three in a group and two in a personal pantry, usuals two —
  tests/kitchen-worker counts them with two items and with twenty-seven. A
  write that answers an item reads the measures once more after it commits (a
  use in a measure has them already from its plan); a failed read there is a 503, as
  the other reads after a commit are, and the Idempotency-Key replays the
  write. Usuals carry `measures` and the last use's words, `lastLabel` (not in
  the brief: "Do it again" can show "1½ onions").
- **Not on these reads:** `itemHistory` and `recipes` (SM-8), as the brief
  says. Design §6.1 lists "history" among the reads; the item's own history
  (its moves) carries `label`. A recipe's ingredient still reads in the
  item's unit (300 g, not "2 onions"), and Home's use-soon card's usual
  amount has no words either. Follow-ups if SM-14 wants them.
- **How much a use in a measure takes** (contracts `measureTakeMilli`,
  shared with the app): round(quantity × amountMilli ÷ count) thousandths,
  halves up — then exactly a unit use's path: the stock guard, 409
  `insufficient_stock` (nothing written), cost = the engine's `costOfUse` of
  that amount, the ledger. One addition so "16 uses of 1 slice" cost exactly
  the pack: a sixteenth of 1 000 milli-pack is 62.5, so each slice takes 63,
  and the 16th would ask 63 of the 55 left. A use in a measure that comes
  within rounding of what is left takes exactly what is left; then the
  engine's last-use rule charges exactly what is left of the price. "Within
  rounding" is ½ a thousandth per half-measure the item held (rounded up),
  never more than a quarter of the measure: 15 milli-pack for the bread,
  7 milli-g (0.007 g) for a kilo of onions. So it only ever absorbs rounding;
  "1 onion" with 100 g left is still refused, and "The rest" (in the unit)
  takes it. The money path is untouched: the measure only chooses
  `qtyMilli`, and the tests compare each cost with `costOfUse` for that
  amount and the sum of a used-up pack's uses with its price.
- **The words.** `measureLabel`: "½ onion", "1 onion", "1½ onions",
  "2 onions" — `one` up to 1, `many` above. `quantity` in a measure is a
  positive multiple of ½ up to 10 000 (the label then fits the column's 64).
  A use in a measure stores the item's own unit and the amount in it
  (`unit`, `quantity`, `qtyMilli`), with `label` beside it. The group use's
  title reads "Onions (2 onions)", the dish's charge "Onion curry: Onions
  (2 onions)", the logged-for-you email "2 onions of Onions", the audit
  description the same words. A reversal (a ledger reversal, an undo, a
  canceled dish) copies the label of the move it puts back.
- **A dish ingredient in a measure:** `CookIngredientRequest.measure`
  (exclusive with `unit`; field errors under `ingredients[i].measure` /
  `.quantity`), stored on the ingredient row and its `dish` move; the cook
  reads the items' measures in one more statement, only when an ingredient
  names one. Over the stock: 409 `insufficient_stock` with `itemId`, as
  before. `CookNewItemRequest` is unchanged. Waste takes no measure (the
  design does not ask for one).
- **The new response fields are optional in the contract types**
  (`KitchenItem.measures?`, `KitchenStockMove.label?`,
  `KitchenDishIngredient.label?`, `KitchenUsual.lastLabel?` and
  `measures?`), as SM-6 did with `setBy`: web-console-next and
  tests/web-console-next build these literals (the optimistic `pendingMove`)
  and are outside this task. Every answer sends them. SM-14 can make them
  required when it touches those files.
- **The arithmetic lives in `packages/contracts`** (`findMeasure`,
  `measureLabel`, `measureTakeMilli`, `inMeasure` — what is left in a
  measure, to the half), next to the types, so the app shows the same words
  and amounts the server writes. `packages/kitchen-engine` is outside this
  task's contract; moving them there is a follow-up if wanted.
- **Deploy order.** db-migrate (300) before kitchen-worker is enforced (SM-3).
  If kitchen-worker went live first, every item read would fail on the
  missing table (503) until the migration ran. Nothing else to redeploy:
  kitchen-worker changes in this PR, and no other worker reads measures or
  labels. The console picks up the SDK and contracts with SM-14.

### SM4 — simpler screens (SM-10)

Home, the + Add sheet, the dish page and the Pantry list, as the canvas's
"Simpler" row draws them, under design §4's seven rules. Use, the item page,
Cook, Add item and the desktop pages are SM-14's and SM-11's.

- **Home is one screen.** "Hi, Rahul" (the canvas; the time-of-day greeting
  and "Your kitchen, across every group." are gone), one money card, "What
  did you use?" with one row of your usuals under it, at most three to-dos,
  and two recent rows. At 390×844 with three to-dos (one of them the claim
  row, the tallest) the whole page fits above the tab bar: see the measures
  below.
- **The money line** (`homeMoney`, home.ts): "You get back ₹62.50" big, in
  the currency most of your groups count in (unless that one is settled and
  another is not), and "You owe $25.00" under it for each other currency
  with money open — never added across currencies. The card opens People.
  **Each debt shows once:** the card lists no people and has no Settle up
  (People has both); a payment you owe is a to-do ("Pay Dev · $25.00 ·
  Paid"); "By group" is gone (the Groups tab is that list).
- **The to-dos** (`homeTodo`/`homeTodos`, inbox.ts; `HomeTodoList`,
  inbox-ui.tsx): one row each — a word or two and one line of numbers
  ("Egg fried rice / Meera · ₹31.20 each", "Greek yogurt / Expired", "Aloo
  paratha / 2 of 4 had", "Pay Dev / $25.00") — with its one action at the
  end of the row and no captions. At most three, in the server's order;
  "See all 13" opens the rest in place (there is no to-do page), "Show
  less" folds them. The actions: a dish to say how much you had → the
  canvas's chips 0 · ½ · 1 · 1½ · 2 (your own portion, SM-7's `useClaimer`);
  your dish → Finalize in one tap (the preview card "Once you finalize, they
  owe you" is gone: the one-line toast says who owes what, with Correct it);
  an assigned dish → Set (its page); food to use soon → its measure ("1
  cup", "1 glass"), your usual amount for just you, with Undo; a payment →
  Paid; a flag → Open.
- **Departure: Paid is two taps, not one.** The canvas's "Paid" records at
  once; a payment records how it was paid, so Paid opens UPI · Cash · Bank
  (and ×) under the row, without the old sentence about where the money
  moves, and the pick records it with Undo (SM-5). A viewer's payment row
  has no button (no sentence either).
- **Departure: usuals, not "Use soon", under the search.** The canvas draws
  a row of use-soon chips there; the brief's "one quick-log row of usuals,
  not three places" wins. The row is + Add's old "Do it again"
  (`doItAgainRows`, unchanged in quick-use.ts): each chip says what —
  "Milk · 1 glass" — and, when it is not just you, the faces of who it is
  for (design rule 4: a one-tap that charges Anu shows Anu); a tap logs it
  again with the Undo toast. It scrolls sideways without a scrollbar
  (`.scrollbar-none`, globals.css). Home's "Use soon" strip is gone: what is
  due soon is a to-do, and Pantry's Soon chip lists the rest.
- **Recent is two rows** (`RECENT_ROWS`), each one title, "Flat 4B · Dev ·
  yesterday" and your part; the total only when you are not in it. **A
  payment shows the money that moved** (`paymentAsCash`): "Anu paid you ·
  UPI" is +₹400.00 in blue (it was −₹400.00 in orange, the audit's bug),
  one you paid is −. On Home only: a group's activity feed is SM-11's and
  still shows what an entry did to your balance.
- **+ Add is the four tiles and nothing else** (nav.ts `ADD_TILES`): the
  canvas's Used · Cooked · Bought · Paid a bill, under "Add" — no subtitle,
  no captions, no "Do it again" (Home's row and Use's recents), and none of
  the canvas's "Pay back" / "Invite" buttons (the brief: the four actions
  only; People and the group page have them). `ADD_SECONDARY` and the tiles'
  `hint`/`live` (every tile shipped long ago) are gone. **The title and ×
  never scroll away:** the sheet itself does not scroll, only the part under
  its title (the group picker can be long). The tab bar's + Add is the
  primary green, not tomato (one primary colour; the sidebar's "Cook a
  dish" too).
- **The dish page** (canvas "Simpler — Dish"): an icon back (named "Back to
  Flat 4B"), the name, "Meera · ₹31.20 a portion" and **one status word**
  (`dishStateChip`: Open · Draft · Finalized · Canceled); **one count** —
  "2 of 5 left" while it is open, "3½ of 4 had" otherwise (`claimCount` says
  "had" now, not "claimed"/"set") — over a bar of half portions; "Who had
  some?" as one card, the steppers 44×44 with the + in green; the money; and
  **one main button** at the end of the page, held above the tab bar while
  the page is longer than the screen: the cook's Finalize, full width (no
  "Remind group · SOON" — there are no SOON placeholders on these screens
  now), or Settle up once it is final, in green (it was black). Everything
  else is behind **one "…" menu** at the top: for an owner or admin of
  someone else's dish, Set portions (a draft), Finalize for Meera, Correct
  it; for the cook, Cancel dish (a confirm dialog; it was a paragraph on the
  page) and Correct it.
- **The money in two lines** (`dishMoneySummary`): "Anu and Dev owe Meera
  ₹93.60 · in Flat 4B" (from your side: "You owe…", "…owe you…") and, when
  the cook took from others' pantries, "Meera owes ₹49.60 for ingredients"
  — or your part, "Meera owes you ₹12.00 for ingredients", when it is owed
  to you. **Departure:** the brief's example ends "· settled in Flat 4B"; it
  reads as already settled, so it is "· in Flat 4B". Behind **Details**: when
  and where it was cooked, every ingredient with its pantry and price, the
  total and a portion's price, who owes the cook, what the cook owes each
  buyer, and "In the end" per person (`moneyFlow`, now in plain titles:
  "They owe Meera", "Meera owes, for ingredients" — no "netting", "posted"
  or "folds"). The cost card (Total · Portions · Each), the "Posted to Flat
  4B … nothing is overwritten" box, the canceled paragraph, the editing
  hints ("Set how much everyone had, then finalize."), the "just for you"
  footnote and the correction's helper line are gone: no sentence sits
  above the main button.
- **Leftovers in numbers** (`leftoverNote`): "2 portions left over · to your
  pantry · ₹105.50", "Rahul kept 2 portions". Shown, as before, only when
  the dish is not open (while it is open the count says it).
- **One-line toasts** on these screens: your portion "You · 1 portion ·
  ₹31.20" (`claimedToast`; it was "Claimed 1 portion of Egg fried rice" over
  "You had 1 · you'll owe Meera ₹31.20."), "Finalized · Anu and Dev owe you
  ₹105.50" (`finalizedToast`; no "Posted to"), "Saved who had what",
  "Corrected …", "Canceled …" without their second lines.
- **The Pantry list on a phone** (canvas "Simpler — Pantry"): "Pantry" and a
  round + (Add an item); **one row of chips** — All · Soon · 4 · Expired · 1,
  then the pantries, Me first (a second tap on a pantry goes back to all);
  and one list, soonest use-by first, **each item one row**
  (`pantryListRow`): its name, what is left (never wrapped), one chip only
  when it is due soon or expired, the pantry's chip on All — the row opens
  the item — and **Use**: your usual amount ("1 glass") logged for just you
  in one tap with Undo when you have one that fits, otherwise "Use", which
  opens Use with the item chosen. Nobody else is charged from a row. Gone on
  phones: the picker, "15 items · worth …" and its sentence, the folding
  sections and their meta lines, and each item's price per unit, worth, bar
  and who paid (the item page has them). From 900px the page is as it was
  (SM-11), with the filter chips' new words.
- **Removed with what used them:** `HomeUseSoon`, Home's inbox cards
  (`NeedsYou`, the finalize preview), `DishClaimStepper`/`DishClaimChoices`,
  `DishCostCard`, `MoneyFlowCard`, the phone `ItemCard`, `greetingFor`,
  `byGroupRows`, `finalizePreview`, `inboxItemIds`, `claimText`,
  `claimChoiceLabel`; their tests went with them or now test what replaced
  them. Left in place, unused, because SM-14 works in those files:
  `useUseSoonItems` (pantry-data.ts), `soonStrip`/`HOME_USE_SOON`
  (pantry.ts).
- **Not here (other tasks' screens):** the use toast's "… it nets with
  everything else at settle-up" (`loggedText`, item-use.ts: Use and the item
  page, SM-14); the payment toast's second line (`useRecordPayment`,
  settle-card.tsx, Settle's, SM-11); toasts above the sticky bar.
- **Two toasts on these screens still have a second line**, because the
  words are other screens' code: a use logged from Home's usuals or
  Pantry's Use says "Logged 1 glass of Milk for you and Anu in Flat 4B." over
  "₹17.00 — it nets with everything else at settle-up." (`loggedText`,
  item-use.ts, which Use and the item page share: SM-14 rebuilds them), and
  Paid says "Payment recorded" over "You paid Dev $25.00 by UPI."
  (`useRecordPayment`, settle-card.tsx, Settle's: SM-11). Both have Undo.
- **Measured** (the production build behind the SM-2 proxy with SM-7's mock,
  390×844 at DPR 2; words are the visible ones — screen-reader-only text
  left out — counted the same way before and after on the same mock): Home
  484 words (94 above the fold) and 4,365 px tall before, **91 words and
  everything above the fold** after (the audit's own count was 541); with
  three to-dos, one of them the claim row, the last recent row ends at
  767 px and the tab bar starts at 783 px, so nothing on Home needs a
  scroll (the page's bottom padding makes it 871 px tall). The + Add sheet:
  7 words (the audit counted 116). The dish page, member: 136 → 51 words,
  1,356 px → one screen; cook: 163 → 61 words, 1,583 → 971 px; finalized:
  172 → 59 words, 1,652 → 871 px. Pantry: 244 →
  122 words, 2,028 → 1,250 px (15 items, one row each). No page scrolls
  sideways (`scrollWidth` 390); no "left" amount wraps. The build still
  serves the same 18 pages as files.
- **Known:** on the cook's open dish with five people the held Finalize sits
  over the money card until you scroll (the rows above it, what you choose,
  are all in sight); at the end of the page it sits below the card.
- **Checked in the browser:** a claim chip on Home writes `claims/me` and
  toasts "You · 1 portion · ₹31.20"; a usual chip logs for the people its
  faces show; Paid → UPI takes the row off at once and records the payment;
  Pantry's "1 glass" turns 1 L into 750 ml at once; the cook's Finalize
  turns the status word to Finalized, the main button to Settle up and
  toasts "Finalized · Anu, Dev Patel and Meera owe you ₹131.87" with
  Correct it; "…" → Cancel dish asks first; an owner sees "Finalize for
  Meera" on Meera's dish; Paid a bill on + Add opens "Which group?" with the
  title and × in place.
- **Tests** (tests/web-console-next): `kitchen-home.test.ts` (the greeting;
  the money line both ways and in two currencies, a settled own currency, no
  groups, no people listed), `kitchen-inbox.test.ts` (three to-dos at most
  and See all, each debt once when the server repeats it, the rows' words and
  actions, no captions or ledger words; Recent is two rows, payments as
  money that moved), `kitchen-dish.test.ts` (the money summary from the
  cook's, a member's and a bystander's side, never more than two lines, the
  empty, solo, canceled and over cases, no ledger words; the byline; the
  status word, "had", leftovers in numbers, the one-line toasts),
  `kitchen-pantry.test.ts` (each item one row with only its name, what is
  left, one chip and the pantry on All; Use logs your usual or opens Use;
  none for a viewer, a used-up item or a pending row; the pantry chips),
  `kitchen-nav.test.ts` (the four tiles and nothing else). Pinned words that
  changed on purpose were updated where they are tested.
- **Nothing to redeploy beyond the console:** only web-console-next changed.
