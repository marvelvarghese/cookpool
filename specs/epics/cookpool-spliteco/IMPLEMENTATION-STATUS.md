# cookpool-spliteco (SE) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SE0 — the spec | | |
| SE1 — groups, expenses, balances | built, awaiting PR (SE-2) | |
| SE2 — settle up and reminders | built, awaiting PR (SE-3) | |
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


## SE2 as built (SE-3)

- **Migration 540** (`540_spliteco_settle_up`): `ledger_reminders` (rmd_ ids; org, from, to, amount, currency, sent_at), `spliteco_profiles` (subject_id, upi_vpa, default_currency), `spliteco_group_settings` (org_id, simplify_debts default 1). Payments are `kitchen_txns` settlements with their bucket and method.
- **Maths:** `packages/kitchen-engine/src/settle.ts` — `pairwisePlan` (simplify off), `planFor`, `plannedBetween`, and `allocatePayment` (Kitchen first, then Other, or the payer's own split; never more than is owed in a balance).
- **API** (spliteco-worker): `POST /v1/spliteco/groups/{org}/settlements` (upi|cash|bank, the caller is the payer), `POST /v1/spliteco/settlements/{txn}/not-received` (the payee only), `GET /v1/spliteco/groups/{org}/settle-plan`, `PUT /v1/spliteco/groups/{org}/settings` (`simplifyDebts`), `POST /v1/spliteco/reminders` (`{ to, groupId? }`, 409 `reminded_recently` inside 24 h), `GET|PUT /v1/spliteco/me/profile` (UPI ID, validated as `handle@bank`). The group read gains `settings`, `upi` (members' UPI IDs) and `reminded`; the friend read gains `upiVpa`, `lastRemindedAt` and `plans`; every row gains `paymentMethod`. Audit events `spliteco.settlement.recorded|not_received` and `spliteco.reminder.sent` are written in the same batch. Contracts in `packages/contracts/src/spliteco.ts`, client methods in `packages/sdk`.
- **Notifications:** kinds `spliteco.reminder` and `spliteco.paid_you` (`NOTIFICATION_KINDS`), email templates and push lines in notifications-worker (titled "Spliteco"), `spliteco-worker` added to the internal actors; spliteco-worker gains the `NOTIFICATIONS_WORKER` binding and `APP_URL` for links.
- **App:** `/settle` (who you pay across groups, in a group, or one person: All / Part of it, UPI / cash / bank, the UPI deep link then "Back from your UPI app — did it go through?" with "I paid ₹X" / "It didn't"; UPI off with a hint when the payee has no UPI ID; Kitchen-first split with "Change split" for kitchen groups), "Not received" on a payment you received (its expense page), Remind with the message preview and "last reminded" (group and friend), the Simplify debts switch in group settings, and the UPI ID on You. Entry points from Home, Group and Friend.

## SE2 departures

- **No `spliteco.settlement.write` grant.** The policy engine (`packages/policy-engine`) is outside SE-3's `affects`, so payments, "not received", reminders and the simplify switch are gated on `spliteco.expense.write` — the same roles (every role but viewer). Adding the grant is a one-line change of `SETTLE_ACTION` in `apps/spliteco-worker/src/handlers/settle.ts` once policy-engine (and tests/policy-engine) are in a contract.
- **Simplify debts lives in its own table**, `spliteco_group_settings`, not on `kitchen_group_settings`: the first row there pins a group's currency, and switching simplify must not.
- **A payment that pays both balances is two rows** (Kitchen, then Other) sharing `source_kind = 'payment'` and `source_id`; the API answers one `payment` with its `parts`. "Not received" on either row reverses both.
- **What a payment may cover** is the group's plan between the two people in each balance (the fewest payments, or pair by pair with simplify off) — so with simplify on, paying someone the plan does not route you to is 409 `nothing_owed`.
- **Only the payer records a payment** (the caller is always `from`); the payee cannot record "they paid me cash". Settlements recorded in Cookpool are still Cookpool's (kitchen-worker), and its own reversal path is unchanged.
- **Reminders** go to someone who owes the caller by a shared group's plan (409 `nothing_owed` otherwise); without `groupId` the reminder is about the group they owe most in. `ledger_reminders` also keeps the amount and currency. A reminder is refused through a delegation only at the edge (SE5 plans a `send_reminder` tool); payments, "not received" and setting a UPI ID are also refused in the worker (403 `not_from_an_assistant`).
- **Push** rides on the email enqueue as for Cookpool's kinds, and is opt-in per kind; Cookpool's notification settings do not list the Spliteco kinds yet, so in practice these are emails until a push switch exists in an app. The push opens on the origin of the app that subscribed.
- **The reminder's 24-hour guard** is a read then a guarded insert; of two racing reminders only one is sent, but the loser's audit event is still written.
- **The UPI link** carries `pa`, `pn`, `am`, `cu=INR` and `tn` (the note, defaulting to the group's name); UPI is offered only for groups that count in INR.
