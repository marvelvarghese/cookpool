# cookpool-simpler (SM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SM0 — the spec | ✅ shipped 2026-11-04 | #36 (SM-1) |
| SM1 — fast | in progress | #37 (SM-3) |
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
