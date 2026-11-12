# cookpool-spliteco (SE) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SE0 — the spec | | |
| SE1 — groups, expenses, balances | built, awaiting PR (SE-2) | |
| SE2 — settle up and reminders | | |
| SE3 — Cookpool hands its money over | | |
| SE4 — bills from a photo, split together | | |
| SE5 — your AI assistant logs splits | | |

## SE1 as built (SE-2)

- **Migration 530** (`530_spliteco_ledger`; 520 went to passkeys): `membership_organizations.made_in`, `kind`; `kitchen_txns.app`, `bucket`, `category`, `revises`, `moved_from`, `deleted_at`, `via_delegation`, `split_spec`; partial unique indexes on `revises` and `moved_from`; `ledger_txn_items`, `ledger_txn_item_shares`, `ledger_txn_adjustments`, `ledger_comments`.
- **Maths:** `packages/kitchen-engine/src/splits.ts` (six methods, itemized with portions/%/exact, tax/service/discount by items, several payers), on `splitByIntegerWeights`, the largest-remainder rule `splitByWeights` now delegates to.
- **API:** `apps/spliteco-worker` behind api-edge's `/v1/spliteco` facade (`SPLITECO_WORKER`), storage in `packages/db/src/spliteco`, wire in `packages/contracts/src/spliteco.ts`, client `client.spliteco` in `packages/sdk`. Grants `spliteco.ledger.read` (every group role) and `spliteco.expense.write` (all but viewer).
- **Groups:** membership-worker takes `madeIn`/`kind` on create, answers `?view=spliteco` (direct groups and members included) on the internal groups read, and finds or makes direct groups at `POST /v1/internal/membership/direct-groups`.
- **App:** `apps/spliteco-web` (Next.js on Workers, worker `cookpool-spliteco-web-<env>`), tests in `tests/spliteco-web`; worker tests and a local dev API in `tests/spliteco-worker`.

## Departures from the design

- **`kitchen_txns.title` was not added**: it exists since migration 220.
- **`split_spec` column added** (not in §1): the request an expense was saved from, so an edit can start from it.
- **A delete stamps `deleted_at` on its reversal row**, not on the original, so no row is ever updated; restore is a new version with `revises` pointing at the deleted one. `revises` and `moved_from` are unique when set.
- **Extra routes:** `GET /v1/spliteco/me/activity` (Activity across every group) and `POST /v1/spliteco/me/friends/{usr}/direct` (find or make the two-person group before the first expense outside groups; only for someone you share a group with, else 403 `no_shared_group`). Insights take `groupId` (not `org`) as the query name.
- **Direct groups are hidden from Cookpool now**, not only in SE3: membership-worker's public list and its default internal groups read leave out `kind = 'direct'`, and joining one by code reads as an unknown code. The public create refuses `kind: direct` and `direct-` slugs. They do not count toward the 50-group cap.
- **Two balances (§0.11):** everything added through spliteco-worker is bucket `other`, Cookpool's rows `kitchen`; a reversal keeps its original's bucket. The Kitchen balance equals kitchen-worker's balances for a group while it holds only Cookpool's rows. kitchen-worker is not changed in SE1 (outside SE-2's ceiling), so Cookpool still shows the whole ledger (Kitchen + Other) for a kitchen group that has Spliteco-added rows; its filter on `bucket = 'kitchen'` belongs to SE3. Tests pin both facts.
- **Home's "owed to you / you owe"** sum the per-person balances (as Splitwise reads), so they agree with the people listed; the net equals the sum of group balances.
- **Sign-in on the Spliteco host is the email code only.** Google needs the app's origin in identity-worker's `OAUTH_ALLOWED_CONSOLE_ORIGINS`, and passkeys need it in `PASSKEY_ORIGINS`/RP ID; identity-worker is outside SE-2's ceiling. The Google button is built behind `NEXT_PUBLIC_SPLITECO_GOOGLE=on`.
- **api-edge trusts the forwarded client address from the Spliteco app's binding** (`props.caller = "spliteco-web"`) as it does the console's.
- **Portions ×1000 make ⅓ a weight of 333**, so three people on ⅓ each still add up exactly (largest remainder), but ⅓ against 1 is 333:1000, not exactly 1:3.
- **Not in SE1, as planned:** settle up, reminders, scan, live split, assistants, the Cookpool-linked group screen; the app shows those entry points as disabled "Soon" or leaves them out.

