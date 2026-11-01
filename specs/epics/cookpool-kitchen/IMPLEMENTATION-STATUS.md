# cookpool-kitchen (CP) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| CP0 — the spec | ✅ shipped 2026-11-01 | #3 (CP-1) |
| CP1 — groups you can join | ✅ shipped 2026-11-01 | #4 (CP-2), #5 (CP-3), #6 (CP-4), #8 (CP-5) |
| CP2 — the ledger | in progress | #7 (CP-6), #9 (CP-7), #10 (CP-21), #12 (CP-8) |
| CP3 — pantries and using things | in progress | #11 (CP-10) |
| CP4 — the dish maker | | |
| CP5 — splitting dishes | | |
| CP6 — use it before it goes | | |

## Departures from the design

### CP0 — work is minted in Orunbase, not declared by a file
The design (and the factory skill at the time) declared the epic in
`epic.yaml` with a `work:` section in `intent.yaml`. orun 2.82 removed both:
the epic `cookpool-kitchen` (EP-2), its seven milestones and every task are
created in Orunbase with `orun task …`, the doc set lives in
`specs/epics/cookpool-kitchen/`, and contracts in `tasks/`. Contract `affects`
names components as `default/cookpool/<component>`.

### CP1 — open groups instead of plan changes (CP-2)
The design said "raise `limit.organizations` and turn on `multi_org`". The
baseline's MO2 gate would still have made a person's *earliest* group — maybe
someone else's — the billing parent of every group they create. Built instead:
`OPEN_GROUPS` in membership-worker (each group standalone, at most 50 per
person, `412 groups_per_person`); only `limit.members` was raised (5 → 50).

### CP1 — join links without an approval queue (CP-3)
Routes as built: `GET/POST …/join-code[/rotate]` (owner/admin),
`GET /v1/join/:code`, `POST /v1/join`, `POST /v1/organizations/:org/leave`.
A link joins straight away as `builder`; no approval option in v1.

### CP1 — settings are defaults until first saved (CP-4)
"A group created with its settings" became: GET returns INR / split equally
until the first PATCH; the currency locks once a row exists.

### CP1 — billing not hidden in the admin console (CP-2 → CP-5)
Instead of hiding billing, the console now opens as Cookpool at `/home`
(CP-5); the admin console stays reachable from the account menu.

### CP1 — gaps in the app shell (CP-5), carried into CP-9
- Other members show as short `usr_…` ids: `PublicMember` has no name.
- The Groups list shows no role or member count (the list API returns
  neither), and members (non-admins) don't see a member count.
- The last owner is told to hand over ownership, but no screen changes
  roles yet.

### CP2 — the ledger (CP-7)

- **`reversed_by` is not a column.** The ledger is append-only: whether a
  transaction was reversed, and by which one, is read by joining on
  `reverses` (its partial unique index makes that a one-row lookup). The API
  still answers `reversed` and `reversedBy`.
- **Columns the design did not list:** `kitchen_txn_splits.position` keeps the
  order people were listed in, which pairwise attribution (§4) follows;
  `kitchen_txns.method` (`upi | cash | bank | other`, settlements only) and
  `kitchen_txns.note`; `kitchen_flags.idem_key` (a flag is a POST, so it is
  idempotent too) and `created_at`/`updated_at`.
- **The first money write fixes the group's currency.** The same batch that
  posts a group's first transaction writes its settings row with the current
  currency (INR by default) when it has none, and the transaction insert is
  conditional on that currency, so a ledger can never change currency under
  existing money. A group that never saved settings therefore reads
  `updatedAt` as the time of its first transaction.
- **The roster comes from a new service-internal route**,
  `GET /v1/internal/membership/organizations/{orgId}/members` on
  membership-worker (`{ subjectId, subjectType, role }`; api-edge does not
  route `/v1/internal/…`). It carries no display name or email: membership
  holds neither.
- **Refusals inside the group are 403s.** Outsiders and roles without the
  route's grant still get the opaque 404; a member who can see a transaction
  but may not act on it gets `403 forbidden` with `details.reason`
  `not_a_party` (recording someone else's payment, flagging a transaction that
  does not name you) or `not_creator` (reversing someone else's). "An owner or
  admin" is decided by policy as `kitchen.txn.reverse_any`.
- **A reversal can itself be reversed** (it is a transaction like any other),
  which puts the original's effect back.
- **No `GET …/expenses`**: the activity feed is the ledger's read.
- **Not yet:** the flag's notification to the logger and an admin arrives
  with the emails (CP-18); refusing to leave a group with a non-zero balance
  (§5, CP-L) needs membership-worker to ask kitchen-worker and is a follow-up.
  Someone who left with a balance still shows in `…/balances`, but a payment
  to or from them is refused (`not_in_group`): an admin reverses instead.

### CP2 — the ledger screens (CP-8)

- **Settle up is `/settle`, not `/groups/[slug]/settle`.** One page with a
  searchable group picker that includes *All groups*; it opens on the group
  it came from (`?group=<slug>`), else All groups. All groups, Home's balance
  card and its Settle up button read every group's `…/settle-plan` (one call
  per group) until the cross-group read lands (CP-9).
- **People are "You" or "Member · 3f9a"** (the last four of their id), all
  through `memberLabel` (`components/kitchen/members.ts`), which CP-9 points
  at real names. The add-expense roster is the group's balances list (every
  member, plus anyone who left with money still open); owners and admins
  narrow it to current members, and a `not_in_group` refusal drops whoever
  it names from the form.
- **Money actions confirm by undo.** Saving an expense, recording a payment
  and undoing an entry each end in a 10-second toast whose Undo posts a
  reversal (the kit's toast gained an optional action and duration). Undo on
  a row strikes it through at once and puts it back if the reversal fails.
  A reversal row offers no Undo of its own; the toast is the way back.
- **The debts behind a plan** are computed in the browser with the engine's
  `pairLines` over the whole feed (read 100 at a time, at most 5,000
  entries), grouped per pair. Undone entries and their reversals stay in the
  list (struck through), because the server's working counts them too.
- **The console bundles `@saas/kitchen-engine`** (`transpilePackages`), so an
  engine change must also touch `apps/web-console-next` to redeploy it.

### CP3 — pantries (CP-10)

- **Columns the design did not list:** `kitchen_items.created_by` (who added
  it; the buyer is `paid_by`, and may be someone else) and
  `kitchen_items.idem_key`, unique per pantry, so a retried add answers with
  the item it added (as the ledger and flags do).
- **"Nothing used" means nothing taken and nothing charged:**
  `qty_left_milli = qty_bought_milli AND cost_taken_minor = 0`. The design
  said `cost_taken_minor = 0`, but a use of a free item charges nothing.
  Until then quantity and price can change, and the item can be removed;
  after, `409 item_used` (mark it wasted instead, CP-11). Edits may send
  `version` and get `409 version_conflict` on a stale read. A group PATCH
  may also change the item's own waste rule.
- **No `adjust` stock move for an edit.** Changing what was bought before
  any use corrects the purchase rather than moving stock (and a move's
  `qty_milli > 0` carries no sign). `kitchen_stock_moves` is created here and
  first written by CP-11.
- **Audit:** adding a group item writes `kitchen.item.added` in the same
  batch, and no ledger transaction. A personal item writes no event: the
  event log is per organization (`org_id` is NOT NULL) and a personal pantry
  is in none. Edits and removals write no event (the design lists none).
- **The first group item fixes the group's currency**, through the same
  pinning statement the ledger's first transaction uses
  (`pinGroupCurrencyStatement`); the item's currency is read from that row
  inside the batch, so a group whose currency changed in between refuses the
  whole batch (`422 currency_mismatch`).
- **"Every pantry I can reach" trusts membership's role.** A new
  service-internal route,
  `GET /v1/internal/membership/subjects/{subjectId}/organizations`
  (`{ orgId: "org_…", slug, name, role }`, active organizations, by name),
  says which groups a person is in. The all-pantries reads keep the groups
  where that role is owner, admin, builder or viewer — every one of which
  holds `kitchen.pantry.read` — instead of one policy hop per group. Every
  group route still authorizes through the policy engine.
- **Shapes:** responses wrap their lists (`{ pantries }`,
  `{ items, nextCursor }`, `{ item }`); DELETE answers the removed item.
  `GET /v1/kitchen/me/items/{itm}` (and `getPersonalItem`) was added for the
  item page. A personal pantry is shown in the currency most of its items
  are in, and its worth counts only those (amounts in two currencies do not
  add up). Item lists skip removed, used-up and wasted items.
- **Dates are UTC days** (risks CP-P).
