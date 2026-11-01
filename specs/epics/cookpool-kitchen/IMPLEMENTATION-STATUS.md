# cookpool-kitchen (CP) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| CP0 — the spec | ✅ shipped 2026-11-01 | #3 (CP-1) |
| CP1 — groups you can join | ✅ shipped 2026-11-01 | #4 (CP-2), #5 (CP-3), #6 (CP-4), #8 (CP-5) |
| CP2 — the ledger | ✅ shipped 2026-11-02 | #7 (CP-6), #9 (CP-7), #10 (CP-21), #12 (CP-8), #13 (CP-22), #15 (CP-9) |
| CP3 — pantries and using things | in progress | #11 (CP-10), #14 (CP-11) |
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

All three are closed by CP-9 (below).

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

### CP2 — the people view (CP-9)

- **Names come from identity-worker**, through a new service-internal
  `POST /v1/internal/identity/users/lookup` (`{ subjectIds }` → `{ users:
  [{ subjectId, displayName, email }] }`, at most 100 ids, unknown ones left
  out; api-edge routes nothing under `/v1/internal/`). kitchen-worker binds
  `IDENTITY_WORKER` (stage and prod) and names people best-effort: a failed
  lookup answers without names, never a 503. What members see as a
  person's `displayName` is the name they set on their profile, else **the
  part of their email before the @** (what Home already greets the
  signed-in person with) — never the whole email; people who signed in by
  email code have no name until they set one in Account. The lookup is one
  primary-key read per person (`getUserById`, side by side): `packages/db`
  was outside this task, so there is no batch repository read yet.
- **identity-worker is private now.** The baseline published it on
  workers.dev (stage and prod), and the lookup has no caller check of its
  own, so it would have handed anyone with a user id that person's email.
  Its stage and prod configs now set `workers_dev: false`, like
  membership-worker; nothing called its public URL (api-edge reaches it by
  service binding, and OAuth callbacks go through api-edge). A config test
  keeps it that way.
- **A group's members, for every member**: `GET
  /v1/organizations/{org}/kitchen/members` (`kitchen.pantry.read`) →
  `{ members: [{ subjectId, displayName, role, memberId, joinedAt }] }`,
  oldest first. The design did not list it; it replaces the admin-only
  `memberships.listMembers` in the app, so members and viewers see names,
  roles and the count, and the app learns its own role exactly (viewers
  included). For it, membership-worker's internal roster now also answers
  each member's `memberId` (`mem_…`, what `updateMemberRole` takes) and
  `joinedAt`; kitchen-worker reads both as null from a membership-worker that
  does not send them yet.
- **`GET /v1/kitchen/me/balances`** answers `{ groups, people, totals }`:
  per group your balance, `role` and `memberCount` (people with a group
  role); per person every group you share (and any group whose plan still
  has a payment between you — someone who left owing), with `netMinor` =
  what that group's **settle plan** has between you (so a person's nets in a
  group add up to your balance there, and match Settle up); totals per
  currency (`owedToYouMinor`, `youOweMinor`, `netMinor`), never added
  across currencies. People are listed largest amount first, then by name;
  settled co-members are included at zero. Like the all-pantries view, "your
  groups" is membership's answer, not one policy hop per group.
- **`GET /v1/kitchen/me/people/{usr}`** answers, per group you share (or
  where money is still open between you), the engine's `personView`: the
  lines between you (newest first, with `reversed` / `reverses` so the app
  strikes undone ones through and files an undo under what it undoes),
  `pairwiseMinor`, `planMinor`, `shortcutMinor` — plus, beyond the design,
  `shortcutVia`: one three-person step (`from` owes `via`, `via` owes `to`,
  so `from` pays `to` directly) that explains the shortcut, chosen from the
  group's pairwise debts, preferring a step whose direct payment is in the
  plan; null when no single third person explains it (the app then says
  what the shortcut does in general). 404 for yourself, for someone you
  share nothing with, and for a malformed id. Lines are every line since
  the group began, not since your last settlement (risks CP-S).
- **The app**: `memberLabel` takes the names the screen has (from
  `myBalances().people`, or a group's member list), so Activity, Balances,
  Add expense, Settle up and People all show names; a person's avatar shows
  their initials. Home's balance card, Settle up's All groups and the Groups
  list (your role, member count and balance per group) read the one
  cross-group call instead of one `…/settle-plan` per group;
  `homeSettleSummary` and `useSettlePlans` are gone. People (`/people`) and
  the person view (`/people/{usr}`) are new; every balance on Home, People
  and a group's Balances tab opens the person. Record payment on the person
  view posts the plan's payment in the group you pick (UPI · Cash · Bank, 10
  second undo); Remind is "Soon".
- **Viewers see no write actions**: no Add expense (the Add sheet leaves
  their groups out, and Add expense explains instead of showing the form),
  no Record, no Undo, no Flag. While a role is loading the write actions
  wait; if the member list cannot be read they show and the server decides.
- **Make owner / Make admin**: on a group's Members card an owner can make
  another member an owner, or an admin, with `memberships.updateMemberRole`
  after a confirm dialog; the last-owner message on Leave links to it.

### CP3 — using things (CP-11)

- **Routes as built.** In a group: `POST …/items/{itm}/uses`
  `{ quantity, unit?, consumers?, weights? }` (the design's
  `{ qty, consumers, amounts? }`: shares are positive `weights`, `consumers`
  defaults to the caller, `unit` to the item's own and must measure what the
  item does), `POST …/items/{itm}/waste` `{ quantity?, unit? }`,
  `GET …/items/{itm}/moves`, and `POST …/moves/{mov}/undo` (added, below).
  Personal: `POST /v1/kitchen/me/items/{itm}/uses|waste|transfer`,
  `GET /v1/kitchen/me/items/{itm}/moves`, `POST /v1/kitchen/me/moves/{mov}/undo`,
  `GET /v1/kitchen/me/usuals`. Every write answers 201 `{ item, move, txn }`
  (`txn` null when no money moved). Uses and waste need `kitchen.item.use`
  (waste has no action of its own); everyone named must be on the roster.
- **Columns the design did not list** (migration `240_kitchen_stock_moves`):
  `consumers` (a JSON array: a use where every consumer is the buyer posts no
  transaction, so the move is the only record of who had it), `unit` (as
  logged, so history and "Do it again" say 250 ml, not 0.25 L), `reverses`
  (a move is undone by a `reversal` move pointing at it — unique, so once)
  and `idem_key` (unique per item: a retried use or waste answers with its
  move instead of taking the stock twice).
- **The write is optimistic.** A use is costed from the item as read (the
  last use takes what is left of the price), so its batch applies only at
  that version: the move's `item_id` is read from the item at the expected
  version, and a NULL fails the NOT NULL constraint and the whole batch. An
  over-draw fails the item's stock CHECK. The worker plans once more from a
  fresh read; a second lost race is 409 `stale`.
- **Waste split equally** charges every member on the roster, viewers
  included ("every current member").
- **Undo.** Reversing a `use` or `waste` transaction puts back every stock
  move it made in the same batch, in any order (the cost taken stays the sum
  of the moves still in effect). A reversal that put stock back cannot itself
  be reversed (409 `not_reversible`): taking the stock again at its original
  price after later uses would break "a used-up item costs exactly its
  price" — log the use again instead. A move with no transaction is undone
  through `…/moves/{mov}/undo`: the personal route, and a group route
  (added, so a buyer's own use and buyer-absorbed waste can be undone too)
  for the move's logger or `kitchen.txn.reverse_any`, audited as
  `kitchen.move.undone` (an event the design did not list). Only the latest
  move still in effect on its item (409 `not_latest`), once (409
  `already_reversed`), and only uses and waste (`not_reversible`); a move
  with a transaction is 409 `has_transaction`.
- **Transfer** refuses a used item with the existing `item_used` (the same
  condition edits and removal use), and gives the item the idempotency key
  `transfer_<move id>` so it cannot collide in its new pantry. It moves no
  money and is not undoable in v1.
- **canUse and `usable=1`** (on `/v1/kitchen/me/items` and `…/search`, as
  `ReachableItem`) come from membership's role: owner, admin and builder hold
  `kitchen.item.use`, viewer does not (`USE_ROLES`, pinned against the policy
  engine by a test). Every write still asks policy.
- **Usuals** are uses in the last 90 days (`USUALS_DAYS`) that the caller
  logged or was named in, not undone, of items with something left in
  pantries they may use: most used first, then most recent, each with how it
  was last logged (`lastQuantity`, `lastUnit`, `consumers`) and what is left
  (`qtyLeftMilli`, so "Do it again" can tell whether it still fits).
- **New reasons:** `insufficient_stock`, `stale`, `not_latest`,
  `has_transaction`, `not_reversible`.
