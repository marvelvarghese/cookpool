# cookpool-simpler (SM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SM0 — the spec | ✅ shipped 2026-11-04 | #36 (SM-1) |
| SM1 — fast | in progress | #37 (SM-3), #38 (SM-2) |
| SM2 — for anyone | in progress | #39 (SM-6) |
| SM3 — from before | in progress | SM-8 |
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
