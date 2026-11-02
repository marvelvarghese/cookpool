# Epic: cookpool-kitchen (CP)

**People who live, work or travel together share food, but the tools they use to split costs only understand bills. Splitwise can split a grocery receipt; it cannot say that Dev used half the oil, that Meera had a glass of milk, or that four people ate a curry made from three different pantries. So flatmates either split everything equally and someone overpays, or they keep score in their heads. Cookpool makes the food itself the unit of account. Every item records who paid for it; every use, alone or in a dish, records who had it; and everything nets out inside each group the way Splitwise nets bills. The one design idea: *pay for what you use*. Buying never splits anything. Using does. A dish is simply the cook using items and the eaters using the dish.**

It is for groups of two to twenty: flatmates, a hostel batch, an office lunch club, a family that shares a kitchen. One person belongs to many groups and keeps one personal pantry that comes with them everywhere. The app is mobile first, because food is logged at the fridge, and works as a full web app on desktop for the weekly shop and the settle-up.

## Status

| Field | Value |
|-------|-------|
| Status | In progress — CP0, CP1, CP2, CP3 and CP5 shipped |
| Cluster | **CP** (CP0–CP6) |
| Owner(s) | `apps/kitchen-worker` (pantries, uses, dishes, the ledger) · `apps/membership-worker` (groups, join links) · `apps/api-edge` (the kitchen facade) · `packages/db` + `packages/contracts` + `packages/sdk` (tables and the wire) · `apps/web-console-next` (the `(kitchen)` app) |
| Builds on | `cirrus` baseline: identity, membership, policy, audit/events, notifications and the console shell are reused. A group is a cirrus organization. |
| Changes | A new product in a new repository (`cookpool`) and a new Orunbase workspace in the openproduct account. The baseline's single-user mode is turned off, its free-plan limits are lifted, and join links replace email invites. |
| Decisions locked | (1) **Pay for what you use**: buying records who paid; only using moves money. (2) **A group is a cirrus organization**; the personal pantry belongs to the person, not to any group. (3) **A dish can take items from any pantry the cook can reach**; the cook owes the buyers of what they took, and the eaters owe the cook by portion. (4) **Anyone can use any item directly**, and one use can be split across several people. (5) **Money is integer paise**, split with largest-remainder rounding so parts always add up; the last use of an item takes whatever is left of its price. (6) **History is append-only**: a correction is a reversal plus a new entry. (7) **Every money write is one D1 batch**, guarded by constraints, behind an idempotency key. (8) **Waste follows the group's rule** (split equally, or the buyer absorbs it), and each item can override it. (9) **No group tabs anywhere**: groups and pantries are chosen with searchable pickers. |
| Design | Claude Design canvas: https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (14 phone screens, 4 desktop pages) |
| Gate | CP1 is the first thing a user can touch (groups and join links). CP3 is the first day the product is useful on its own (pantries and using things). CP5 completes the core loop. |
| Shipped as | |

## Read order

1. `design.md` — the resources, the money rules, the routes, the screens, what is out of scope
2. `implementation-plan.md` — the milestones, their tasks, and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped (kept distinct from intent)

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| CP0 — the spec | this doc set | merged; CP-1 reads done in Orunbase |
| CP1 — groups you can join | single-user mode off, free limits lifted, join links, the kitchen-worker skeleton, the app shell | two people end up in one group through a link, on a phone, on stage |
| CP2 — the ledger | expenses in four split modes, balances, fewest-payments settle-up, the per-person "why" view | settling up brings every balance to zero |
| CP3 — pantries and using things | personal and group pantries, units, the all-pantries view, direct use split across people, quick use, the "+ Add" sheet, waste | "250 ml of milk for me and Anu" takes two taps and moves both balances exactly |
| CP4 — the dish maker | dishes from any mix of pantries, items added inline, cost per portion | the cook owes each buyer exactly their ingredients' cost |
| CP5 — splitting dishes | assign or claim portions, finalize, leftovers, reversal, claims from Home | eaters owe the cook to the paisa, netted against the cook's ingredient debts |
| CP6 — use it before it goes | the daily use-by sweep and emails, the Home inbox, "Do it again", an installable app | an expiring item emails and shows on Home; the app installs to a phone |
