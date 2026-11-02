# cookpool-kitchen — implementation plan

Milestones land in order. Each is one or more tasks, each task one pull
request on an `orun/CP-<n>-<slug>` branch with an `Orun-Task` trailer, merged
only when every check is green. A milestone is marked ✅ here when its "done
when" list is true, and recorded in `IMPLEMENTATION-STATUS.md` in the pull
request that lands its last task. Task keys below are the plan. Each task is
created in Orunbase under its milestone (`orun task create --adopt CP-<n>`)
with its contract, `tasks/CP-<n>.TaskContract.yaml`, which lands in the pull
request that implements it.

## CP0 — the spec ✅

This doc set and the `CP-1` contract, merged to `main`. The epic
`cookpool-kitchen`, its seven milestones and `CP-1` are created in Orunbase
before the pull request opens; the merge lands `CP-1`.

**Done when**
- the five documents are on `main`
- `task_get cookpool-kitchen` shows the epic and its seven milestones, and `CP-1` reads `done`

## CP1 — groups you can join ✅

Open up the baseline for many small groups, and stand up the empty kitchen.

- **CP-2 baseline opens up**: `SOLO_MODE` off everywhere; free-plan limits raised (members 50, organizations 25, `multi_org`); billing hidden in the console; tests for the new limits.
- **CP-3 join links**: port ogpic's join codes and requests to membership-worker; migration, handlers, api-edge routes, SDK; the join page; tests.
- **CP-4 the kitchen worker**: `apps/kitchen-worker` from the qa-worker shape (authz, router, http, ids), `kitchen-facade.ts` on api-edge, `KITCHEN_WORKER` bindings, `kitchen` bounded context, `kitchen.*` policy actions, `kitchen_group_settings` with GET/PATCH, a group created with its settings; `tests/kitchen-worker` on the node:sqlite harness.
- **CP-5 the app shell**: the `(kitchen)` route tree, tab bar and sidebar, Groups list (search, sort), group page skeleton, join flow, manifest; `/` redirects to `/home`.

**Done when**
- on stage, a new person creates a group, copies its join link, and a second person joins it from a phone
- the free plan allows a sixth member and a second group
- `GET /v1/organizations/{org}/kitchen/settings` answers on stage and prod

## CP2 — the ledger ✅

Splitwise inside each group, with every number explainable.

- **CP-6 the money engine**: pure `engine/money.ts` (largest remainder, split modes), `engine/ledger.ts` (balances, pairwise attribution, settle plan with its working); property tests.
- **CP-21 the shared engine package**: the engine moves to `packages/kitchen-engine` (`@saas/kitchen-engine`) so the console's previews use the same maths (added during the build).
- **CP-7 ledger storage and routes**: `kitchen_txns`, `kitchen_txn_splits`, `kitchen_flags`; expenses, settlements, reversal, flag, activity, balances, settle-plan; one batch per write; idempotency.
- **CP-8 ledger screens**: add expense (four modes), group activity and balances, settle up with the working, record a payment.
- **CP-9 the people view**: `GET /v1/kitchen/me/balances`, `GET /v1/kitchen/me/people/{usr}`, the People tab and the "You and Dev" screen.

**Done when**
- an expense in each split mode posts, and balances match the spec's examples
- settling up the suggested payments brings every balance to zero
- property tests pass: Σpaid = Σowed, rounded parts sum to the total, simplification keeps every net, a reversal restores balances exactly

## CP3 — pantries and using things ✅

The product becomes useful on its own.

- **CP-10 items and units**: `engine/units.ts`; `kitchen_items`, `kitchen_stock_moves`; personal and group item routes, the all-pantries read, search.
- **CP-11 using, waste and transfer**: uses split across several people (group `use` transactions), personal uses, waste by group rule or item override, transfer to a group; last-use remainder; over-draw rejected by constraint.
- **CP-12 pantry screens**: all-pantries view with the picker, add item (searchable pantry picker, who paid, waste override), item page (use for several people, waste, history).
- **CP-13 quick use and the + sheet**: `/use` with search and unit presets, the "+ Add" sheet, usuals.

**Done when**
- logging "250 ml of milk for me and Anu" from Home takes two taps and moves both balances exactly
- using the last of an item charges exactly what is left of its price
- an over-draw is refused and nothing is written

## CP4 — the dish maker

- **CP-14 cooking**: `kitchen_dishes`, `kitchen_dish_ingredients`; `POST /v1/kitchen/me/dishes` takes ingredients from any reachable pantry, posts one `use` transaction per source group charging the cook, rejects mixed currencies.
- **CP-15 the dish maker screen**: search across pantries, inline new item, extras, portions, share-with picker, the cost card with what the cook takes on.

**Done when**
- a dish with ingredients from a personal pantry and two groups decrements all three and charges the cook each buyer's exact share
- the dish total equals its ingredient costs plus extras

## CP5 — splitting dishes ✅

- **CP-16 shares and finalize**: `kitchen_dish_shares`; claims, cook assignment, finalize (dish transaction, eaters owe the cook), leftovers item, correction by reversal.
- **CP-17 dish screens and claims on Home**: the dish page (claims, how the money moves, netting), inline claims and finalize in the Home inbox.

**Done when**
- the spec's worked example reproduces to the paisa on stage
- a correction posts a reversal and a new transaction, and balances follow

## CP6 — use it before it goes

- **CP-18 the daily sweep**: `scheduled()` with cron triggers for stage and prod, `kitchen.use_soon` digest, `kitchen.dish_posted` and `kitchen.logged_for_you` emails, preferences.
- **CP-19 the Home inbox and polish**: the inbox read model, "Do it again", undo toasts everywhere, installable app, empty states, the closing pass on the desktop layouts.
- **CP-20 close the epic**: status file, README "Shipped as", the epic marked completed in Orunbase.

**Done when**
- an item two days from its use-by date sends an email on stage and shows in the Home inbox
- the app installs to a phone home screen and opens on `/home`

## Sequencing note

CP1 comes first because every kitchen route is scoped to a group, and a group
needs members. The ledger (CP2) comes before pantries because every use of
shared stock posts to it. CP3 makes the product useful without dishes. CP4
needs CP3's items and uses. CP5 needs CP4's dishes and CP2's netting. CP6 is
polish over all of them. Inside a milestone, the engine or storage task lands
before its screens.
