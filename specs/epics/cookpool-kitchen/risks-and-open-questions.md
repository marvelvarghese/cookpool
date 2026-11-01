# cookpool-kitchen — risks and open questions

Each entry is a letter, a title, and a state: **RISK** (open, with a
mitigation), **RESOLVED** (decided; say what and why), **ACCEPTED** (a cost we
carry knowingly), **SETTLED** (decided for now; revisit on a stated cadence).

## CP-A — D1 cannot roll back a half-written money event (RISK, mitigated)

The baseline's `executor.transaction` runs statements in order with no
rollback. A use that decrements stock but fails to write its splits would
leave balances wrong. Mitigation: every money event is one `db.batch()` (D1
runs a batch atomically). Invariants are database constraints, so a violation
aborts the whole batch: `qty_left_milli >= 0`, one split row per person, a
unique idempotency key per group. The API retries are idempotent, and a
nightly check recomputes Σpaid = Σowed per transaction and alerts on drift.

## CP-B — what a group is (RESOLVED)

Options: a cirrus organization per group, or a kitchen-owned group table.
Decision: **a cirrus organization**. It reuses members, roles, audit and the
policy engine, and ogpic's consumer app did the same. The personal pantry is
keyed by the person, so it is not tied to any organization.

## CP-C — the baseline's free plan blocks small groups (RESOLVED)

Free allows 5 members and 1 organization, and joined groups count toward the
organization limit. Decision: raise the free plan to 50 members and 25
groups, turn on `multi_org`, and hide billing. Cookpool has no paid tier in
this epic.

## CP-D — email invites cannot be accepted (RESOLVED)

The baseline's invitation email carries no token and the console has no accept
page. Decision: port ogpic's join links (code, optional approval, rotate,
leave). Email invites stay in the API but are not offered in the app.
As built (CP-3): no approval queue in v1 — opening a link joins straight
away as a member, and rotating the code is how a group stops new joins.

## CP-E — rounding (RESOLVED)

Integer paise everywhere, with largest-remainder splits (ties by list order)
and the last-use remainder on items. The parts of every transaction add up to
its total by construction, and property tests guard it.

## CP-F — one currency per group (ACCEPTED)

No conversion. A dish refuses ingredients in a currency other than its
group's. Most groups live in one country; a later epic can add conversion.
As built (CP-4): a group reads as INR until its settings are first saved, and
the first save fixes the currency, even one that changes only the waste rule.
The upsert enforces the lock in one statement, so racing first saves cannot
disagree. The app should offer the currency on the first settings save.
As built (CP-7): a group's first transaction also fixes it — the posting
batch writes the settings row when there is none, and only inserts the
transaction if the group's currency is the one it names.

## CP-G — logging a use on someone else's behalf (RISK, mitigated)

Anyone can say "Anu had some too". Abuse is unlikely among people who share a
kitchen, but mistakes are not. Mitigation: everyone named sees it in
activity and can flag it; a flag notifies the logger and an admin; a
correction is a reversal; `kitchen.logged_for_you` emails a weekly summary.

## CP-H — a dish spans pantries in several groups (RESOLVED)

Decision: the cook is charged for each group item at cook time, in that
item's group. The dish itself is shared in one group, and its eaters owe the
cook. Netting happens inside each group; there is no cross-group netting of
debts, only cross-group *display* (People, Home).

## CP-I — debt simplification can route money through people who never dealt directly (ACCEPTED)

Greedy simplification sometimes asks Dev to pay Rahul for a debt Dev owed
Anu. That is the right answer, but it surprises people. The per-person view
shows the "group shortcut" amount explicitly, so it is never unexplained.

## CP-J — real-time claims (ACCEPTED)

Claims update by polling every 20 seconds on an open dish. Durable Objects or
websockets are a later concern.

## CP-K — personal rows without org_id (RISK, mitigated)

The baseline assumes every table carries `org_id`. Personal pantry rows do
not. Mitigation: a CHECK constraint makes the owner explicit; the workspace
purge path deletes kitchen rows by subject as well as by org; a test pins it.

## CP-L — leaving a group with a balance (RESOLVED)

Leaving is refused while your balance in that group is not zero
(`balance_not_settled`). An admin can still remove a member; their balance
stays in the ledger under their name.

## CP-M — Orunbase identity and the build (RISK, mitigated)

The `orun` CLI is signed in as one identity (Marvel Varghese,
`api.orunbase.com`, account `openproduct-3qgmqphg`), the claude.ai Orunbase
connector as another. Mitigation: the workspace and every check go through the
CLI. The Splitly run's fixes are applied up front: `ORUN_BACKEND_URL`, an
https git remote with the gh credential helper, and a pre-created repository
under a personal GitHub account.

## CP-N — the cron sweep never firing (RISK, mitigated)

A `scheduled()` handler without `triggers` in wrangler never runs, and fails
silently. Mitigation: triggers declared per environment, a test asserting
they are present in the rendered wrangler config, and `/health` reporting the
last sweep time.

## CP-O — balances read the whole ledger (ACCEPTED)

`…/balances` and `…/settle-plan` load every transaction and split of the group
(`listSplitsForGroup`) and let the engine compute them, because the plan's
working (debts → pairs) needs every transaction's pairwise lines, not only
the per-person sums. That is one indexed query and a few thousand rows for a
flat that logs a few meals a day for a year — fine for v1. Revisit when a
group passes ~20k transactions or the read shows in Server-Timing: balances
can become a `SUM(paid_minor − owed_minor) GROUP BY subject_id` query, and
the working can be kept as running pairwise totals written in the same batch
as each transaction.

## CP-P — "today" is a UTC day (ACCEPTED)

Use-by dates are calendar dates, and "use soon" (today to three days ahead)
and "expired" (before today) are measured from today's date in UTC. Between
midnight IST and 05:30 IST the server's day is still yesterday, so an item
can read as one day further from its date for those hours. Accepted for v1:
the daily sweep runs at 08:00 IST, well inside the same day. If it shows,
the app can send its own date (`?today=`) or a person can carry a time zone.

## CP-Q — usuals read a person's moves without an index on who had it (ACCEPTED)

`GET /v1/kitchen/me/usuals` counts the uses a person logged or was named in.
Who had a use is a JSON array on the move (`consumers`), so the read joins
the person's reachable items to their moves through the item index and
filters with `json_each`: every use of every reachable item in the last 90
days. That is a few thousand rows for a flat that cooks every day, fine for
v1. Revisit when the read shows in Server-Timing: a
`kitchen_stock_move_consumers (move_id, subject_id)` table indexed by subject,
written in the same batch as the move.
