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

As built (CP-18): `"triggers": { "crons": ["30 2 * * *"] }` is declared once
at the top of kitchen-worker's wrangler template, and wrangler's inheritance
gives it to every environment (no environment declares its own). Three
checks: tests/config-worker asserts the rendered stage and prod configs
resolve to that cron and that `src/index.ts` exports `scheduled()`;
tests/kitchen-worker runs the exported `scheduled()`; and kitchen-worker's
`/health` answers `lastSweepAt` (and `lastSweep`, the day's counts) from
`kitchen_sweeps`, so a sweep that stopped running shows as a stale date. A
sweep that cannot read the items throws, so the invocation reads as failed in
the worker's cron events.

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

## CP-R — members see each other's name or email prefix (ACCEPTED)

A group's members (viewers included) see each other's display name, else
the part of their email before the @, through the members list, People and
every screen that names someone. They never see a whole email address.
Anyone with a group's join link can join and see these names, which is the
point of a shared kitchen. A person who does not want their email prefix
shown sets a display name in Account.

## CP-S — the people reads read every group's whole ledger (ACCEPTED)

`GET /v1/kitchen/me/balances` and `GET /v1/kitchen/me/people/{usr}` load,
for every group the caller is in, its roster (one membership hop each), its
whole ledger (`listSplitsForGroup`, one query each) and its settle plan, and
then ask identity for every co-member's name (one primary-key read per
person). That is fine for a person in a few groups of a few people — the
target — and the reads run side by side; Home, People and every name in the
app share the one cached call. Revisit with CP-O's running pairwise totals,
or a per-group plan cache invalidated by each write, if the reads show in
Server-Timing (`groups`, `roster`, `db`, `identity` phases). The person view
lists every line since the group began, not only those since your last
settlement: a payment is a line too, so the sum still explains the amount;
trimming to "since you last squared up" can come with the inbox (CP-19).
The names lookup could become one `IN (json_each(…))` read
(`getUsersByIds`) when `packages/db` is next in scope.

## CP-T — a big dish is one large D1 batch (ACCEPTED)

Cooking writes the dish, its ingredients, every stock move, every item
update, one charge per source group with its splits, and the audit events in
one D1 batch, so nothing is half-written. The worked example is 34
statements; a dish at the 30-ingredient limit is about 274. D1 counts
statements toward a per-invocation query limit: 1,000 on Workers Paid (what
the factory's prerequisites require for this Cloudflare account), 50 on
Free. On Workers Paid every allowed dish fits. If the account ever runs on
Free, a dish with more than a handful of ingredients fails as a whole
(nothing written) and the limit on ingredients per dish must come down.

## CP-U — the sweep's calls grow with the people it emails (ACCEPTED)

The daily sweep (CP-18) reads every pantry's items in one D1 query and
records the run in one more, but it makes a service-binding call per group
with items in the window (its roster), per group still unnamed (a member's
groups), per 100 people (identity) and per person (the enqueue). Workers
count those as subrequests: 1,000 per invocation on Workers Paid, so one run
emails at most about 900 people, and the run reads at most 5,000 items
(`SWEEP_MAX_ITEMS`). Far above a v1 deployment's few dozen people. Accepted;
when it nears the cap, the sweep fans out — one queue message (Cloudflare
Queues) per hundred people, each its own invocation — with the same
idempotency keys, so nothing is sent twice. A run cut short is safe today:
the digests it did send are not sent again by a re-run the same day.

## CP-V — kitchen emails share one opt-out per group (ACCEPTED)

design.md §8 gives each kitchen email its own opt-out. The baseline's
preferences are per category, and the category is a fixed set the
`notifications_notifications` table CHECKs (`invitation`, `billing`,
`security`, `support`, `product`), so a category per kind would mean
rebuilding that table. All three are `product` email (CP-18): turning off
product email for a group (the console's notification settings) stops that
group's dish and logged-for-you emails; the daily digest, which is about
every pantry a person has, is sent under the system organization, and the
person's `product` preference there stops it — settable through
`PUT /v1/notifications/preferences` with that org id, but no screen offers it
yet (a follow-up for the app's settings). An opt-out per kind can come later
as per-template keys in the same preferences map, which has no CHECK.
