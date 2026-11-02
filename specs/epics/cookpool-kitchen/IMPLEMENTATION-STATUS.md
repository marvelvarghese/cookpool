# cookpool-kitchen (CP) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| CP0 — the spec | ✅ shipped 2026-11-01 | #3 (CP-1) |
| CP1 — groups you can join | ✅ shipped 2026-11-01 | #4 (CP-2), #5 (CP-3), #6 (CP-4), #8 (CP-5) |
| CP2 — the ledger | ✅ shipped 2026-11-02 | #7 (CP-6), #9 (CP-7), #10 (CP-21), #12 (CP-8), #13 (CP-22), #15 (CP-9) |
| CP3 — pantries and using things | in progress | #11 (CP-10), #14 (CP-11), #18 (CP-12) |
| CP4 — the dish maker | in progress | #16 (CP-14) |
| CP5 — splitting dishes | in progress | #17 (CP-16) |
| CP6 — use it before it goes | in progress | #19 (CP-18) |

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

### CP4 — cooking (CP-14)

- **Routes as built.** `POST /v1/kitchen/me/dishes` `{ name, orgId?, portionsHalf,
  extrasMinor?, splitMode, ingredients?: [{ itemId, quantity, unit? }],
  newItems?: [{ name, category?, quantity, unit, priceMinor, expiresOn?,
  useQuantity?, useUnit? }] }` → 201 `{ dish }`; `GET /v1/kitchen/me/dishes?state=&cursor=&limit=`
  (`{ dishes, nextCursor }`, newest first), `GET /v1/kitchen/me/dishes/{dsh}`,
  `POST /v1/kitchen/me/dishes/{dsh}/cancel` → 200 `{ dish }`, and
  `GET /v1/organizations/{org}/kitchen/dishes` (`kitchen.pantry.read`). The
  design's `GET …/dishes/{dsh}` inside a group is the `me` read: its cook, or
  any member of its group. The breakdown is on the dish itself:
  `fromMineMinor` (what the cook paid for: their own pantry and their own
  purchases in a group) and `owes: [{ orgId, buyerId, amountMinor }]`, with
  `fromMineMinor + Σ owes = ingredientsMinor`.
- **State at cook time.** Claims open the dish to the group at once
  (`open`); an assigned dish is a `draft` until its cook's shares are posted
  and finalized (CP-16). Claims need a group (422 on `splitMode`, and a table
  CHECK); a dish just for the cook is assigned.
- **Who may cook what.** Sharing with a group needs `kitchen.dish.cook`
  there; every source group `kitchen.item.use`, confirmed with policy once
  per group. Items are looked up only in the cook's own pantry and the groups
  whose role holds `kitchen.item.use`, so an item anywhere else — another
  group, a group they may only read, nowhere — is the opaque 404.
- **One batch, as CP-11 writes a use.** The shared group's currency pin, one
  `use` transaction per source group (with `source_kind 'dish'`, `source_id`
  the dish; lines whose buyer is the cook are left out, and a group with none
  left posts none), the dish, the "just bought" items, then per ingredient
  the guarded `dish` move and item update (`takeStockStatements`, now shared
  with uses and waste) and its row, then the audit events. Costed from the
  items as read; an item that moved on fails the batch and the dish is planned
  once more from a fresh read (409 `stale` on a second loss). The shared
  group's currency is pinned by the same batch, and the dish goes in only in
  it, as a group's first item or transaction would. A dish has at most
  `MAX_DISH_INGREDIENTS` (30) ingredients and new items together, which keeps
  the batch under 300 statements at worst (34 for the worked example);
  each statement may count toward the Worker's per-invocation D1 query
  limit (1,000 on Workers Paid).
- **Columns the design did not list** (`250_kitchen_dishes`):
  `kitchen_dishes.canceled_at` (each closing state carries its timestamp, by
  CHECK), `idem_key` (unique per cook: a retry answers the dish it made),
  `created_at`/`updated_at`; `kitchen_dish_ingredients.position`, `unit`,
  `org_id` (the source pantry; null for the cook's own) and `paid_by`.
  `kitchen_stock_moves.dish_id` stays a plain column with an index: SQLite
  cannot add a foreign key to an existing column without rebuilding the
  table. Dish moves carry no `idem_key` (the dish's covers them).
- **Cancel** is the cook's (403 `not_creator` for a member, the opaque 404
  for anyone else), only while `draft` or `open` (409 `dish_not_open`), and
  idempotent (a canceled dish answers as it is). One batch: the dish's state
  is the guard (anything but draft/open becomes NULL and fails the batch),
  each use transaction gets a reversal (`source_kind 'dish'`, note "The dish
  was canceled") that puts its moves' stock back, and the cook's own
  ingredients come back with plain `reversal` moves.
- **A dish's charges are reversed only by cancelling it.**
  `POST …/txns/{txn}/reverse` refuses a transaction whose source is a dish
  (409 `not_reversible`, `details.dishId`): reversing it alone would put the
  stock back under a dish that still lists it. A dish move cannot be undone
  on its own either (`not_reversible`, as before).
- **Audit:** `kitchen.dish.cooked` and `kitchen.dish.canceled` (an event the
  design did not list), one per group the dish touches — its shared group and
  each source group — each with that group's part; only the shared group's
  carries the dish's totals. A dish of the cook's own pantry alone writes
  none (the event log is per organization).
- **New reason:** `dish_not_open`.

### CP5 — splitting dishes (CP-16)

- **Routes as built.** In the dish's group:
  `PUT …/dishes/{dsh}/claims/me` `{ portionsHalf }` (`kitchen.dish.claim`; 0
  takes the claim back), `PUT …/dishes/{dsh}/shares` `{ shares: [{ subjectId,
  portionsHalf } | { subjectId, exactMinor }] }`, `POST …/dishes/{dsh}/finalize`
  and `POST …/dishes/{dsh}/correct` `{ shares, note? }` — each answers 200
  `{ dish }`. The design's snake_case bodies (`portions_half`, `usr`,
  `exact_minor`) are camelCase like every other kitchen body. Added: `POST
  /v1/kitchen/me/dishes/{dsh}/finalize`, the cook's own route, because a dish
  just for its cook is in no group: it is only marked finalized (no
  transaction, no leftovers); a shared dish finalizes there as on the group
  route. SDK: `claimDish`, `setDishShares`, `finalizeDish`, `finalizeMyDish`,
  `correctDish`.
- **Who.** A dish not shared with the path's group, and a role without the
  route's grant (a viewer claiming; anyone without `kitchen.dish.finalize`
  assigning, finalizing or correcting), is the opaque 404. Assigning,
  finalizing and correcting are the cook's — or, beyond the design's "the
  cook" for assigning and correcting, an owner's or admin's
  (`kitchen.dish.finalize_any`), so a stuck dish can be split, not only
  finalized; another member gets 403 `not_creator`. Everyone a set of shares
  names must be on the roster (422 `not_in_group`; viewers count, they eat).
- **States.** Claims only on an `open` dish (claims mode). An assigned dish
  stays a `draft` while the cook sets its shares — `…/shares` never changes
  the state — and is finalized from there; `…/shares` also works on an open
  dish, replacing the claims (each row then says `source: cook`; members may
  claim again after). Finalize takes a draft or an open dish; corrections
  only a finalized one. A state that does not allow the write is 409
  `dish_not_open` with `details.state`, now for claiming, assigning,
  finalizing and correcting as well as cancelling.
- **Columns the design did not list** (`260_kitchen_dish_shares`):
  `kitchen_dish_shares.position` (the order eaters were listed or claimed in,
  which the split's ties follow) and `created_at`/`updated_at`;
  `kitchen_dishes.version` (an `ALTER … ADD COLUMN` with default 1), bumped
  by every claim, assignment, finalize and correction in the same batch.
- **One batch per write, guarded by the dish row.** A claim is the dish
  update and the upsert of the claimer's row: the update sets the state NULL
  — failing the batch on the NOT NULL constraint — unless the dish is open
  and the claim plus everyone else's portions fit (409
  `claims_exceed_portions`, `details.portionsHalf` and `availableHalf`, a new
  reason). Finalize is the dish transaction (pin, transaction, splits), the
  leftovers item, then the dish update — guarded by the state and the version
  the split was planned from, so a claim that lands in between fails the
  batch and finalize is planned once more from a fresh read (409 `stale` on a
  second loss) — then the audit event: about 7 statements plus one per
  eater, a correction about 8 plus three per eater; at most
  `MAX_DISH_SHARES` (50) eaters, whatever the ingredients.
- **The split is the engine's.** `buildDish` over the shares listed with the
  cook's own share first and then by `position`: exact amounts off the top,
  the rest by half portions, largest remainder, unclaimed portions to the
  cook. Ties go to the order listed, so the worked example's odd paisa —
  a tie between Rahul's 1½ and Meera's ½ portions, not a larger remainder as
  design.md §3 puts it — is Rahul's however the claims arrived. When the cook
  claimed nothing the engine lists the unclaimed portions after the eaters,
  so a tie there goes to an eater. What the unclaimed portions are worth is
  their part of the cook's share (`splitByWeights` of the cook's portion
  amount between their own claim and the unclaimed halves).
- **A dish transaction for every group dish that cost anything**, even when
  nobody but the cook had any (the cook paid and owes the total: no money
  moves, but the group's activity shows the dish, and a correction always has
  a transaction to reverse). None for a dish that cost nothing, none for a
  dish just for its cook. Its `source_kind` is `dish`, so the ledger's
  reverse route refuses it (and a correction's reversal) like cooking's
  charges.
- **Leftovers** are a personal item: "Leftovers: {dish}" (cut to 120
  characters), category `Leftovers`, counted in `pcs` — a portion is one
  piece, so 1½ portions left is 1.5 pcs — priced at what the unclaimed
  portions are worth, paid by the cook, `source_dish_id` the dish (the insert
  now writes that column), no use-by date, created by whoever finalized.
  Being personal, they move no money and write no event.
- **Corrections** reverse the dish transaction and post a new one (with the
  shares replaced, `source: cook`) in one batch, guarded like finalize;
  `finalized_at` keeps the first finalize. The leftovers follow only while
  untouched — active, still the cook's, nothing taken: updated in place, or
  removed (the dish then points at none) when nothing is left over; new ones
  are created when there were none. Leftovers the cook has eaten from,
  wasted, moved or removed stay as they are.
- **Idempotency.** Finalize uses fixed keys per dish (`dish_<hex>_finalize`
  for the transaction, `dish_<hex>_leftovers`), and a finalized dish answers
  as it is (200). A correction's transactions take keys made from the
  request's `Idempotency-Key`; a retry finds its transaction posted and
  writes nothing. Claims and assignments are PUTs: the same body sets the
  same rows.
- **Reads.** Every dish read (`GET /v1/kitchen/me/dishes[/{dsh}]`, the group
  list, and every write's answer) adds `shares` (cook first), `myClaimHalf`
  (the caller's), `claimedHalf`, `unclaimedHalf`, `unclaimedMinor`,
  `amounts` (what each person owes for the dish, cook first: `buildDish` over
  the stored shares — a preview until finalized, the transaction's numbers
  after; empty once canceled) and `netting` (in the shared group, per eater
  and per buyer of what the cook took from that group's pantry: what they owe
  the cook for the dish, what the cook owes them, and the net — the engine's
  `pairLines` over the dish's split and that group's ingredient take). Names
  are not included: the app has the group's member list.
- **Audit:** `kitchen.dish.finalized` in the dish's group, and
  `kitchen.dish.corrected` (an event the design did not list). Claims and
  assignments move no money and write no event.
- **Not yet:** leftovers get no use-by date (the daily sweep, CP-18, may
  want one); finalize does not re-check that every eater is still in the
  group (they ate; assigning and correcting do check).

### CP3 — pantry screens (CP-12)

- **One item route.** `/pantry/[itemRef]` names the item and its pantry:
  `me:itm_…` for your own, `org:org_…:itm_…` for a group's (`parseItemRef`
  also reads the percent-encoded form). **Use** on a row opens the item
  page's Use section (`#use`) until quick use (`/use`, CP-13) ships.
- **Two layouts for /pantry.** Phones get the folding section per pantry
  (Personal, then groups recent first; the first three open, and any further
  one with something to use or expired); from 900px it is one table, soonest
  use-by first, with an item search and "Show all N items" after twelve, as
  the canvas's web artboard draws it. `?pantry=` and `?filter=` keep the
  choice. The items of the chosen pantry are read 100 a page, at most 1,000
  (then a note says so).
- **Filters say what the server counts.** "Use soon · N" is today to three
  days ahead and "Expired · N" (shown only when something has expired) is
  separate, matching the pantry totals; the phone canvas counted expired
  items under use soon. The caller's own pantry reads "Personal" (badge "Me"),
  not the API's "My pantry".
- **Prices read per kg and per L.** An item bought in grams is priced per kg,
  in millilitres or spoons per L (the engine's `pricePerUnit`), counts per
  piece, packs per pack — "₹560.00/kg", not "₹0.56/g", which rounds away most
  of the price. For the same reason the add form's live line is "₹X per kg ·
  ₹Y per 100 g" (and per L · per 100 ml), not "per g"; the item page's "Costs"
  is per 100 g / 100 ml / piece / pack.
- **Use some.** The stepper counts 50 g, 50 ml, one piece or one pack (a typed
  amount is accepted, never more than is left, and "All that's left" takes the
  rest); the request is sent in that base unit. The cost is the engine's
  `costOfUse` from what the item has cost so far (price − worth), so the last
  of an item costs exactly what is left. Who had it: you first, then the
  group's member order — the order sent, so the preview's odd paisa lands
  where the server's does (`buildUse`). Viewers can be named as having had
  some (they are on the roster); they cannot log.
- **Mark wasted** throws away everything left (no partial amount in v1) after
  a preview of who pays under the rule in force: split equally by the
  engine's `buildWaste` over the group's member list (`…/kitchen/members`,
  oldest first), buyer absorbs, or — your own item — nothing to split. The
  preview's member order is the members route's; if membership's internal
  roster ever orders differently, the odd paisa could fall on another person
  in the ledger than in the preview (the total is the same).
- **Undo.** A use or waste ends in the 10-second Undo toast (CP-8's pattern):
  it reverses the transaction when one posted (that puts the stock back), else
  undoes the move (personal, or a buyer's own use / absorbed waste). The
  item's History also offers Undo — on a use or waste with a transaction for
  its logger or an owner/admin, and on one without only while it is the
  latest move still in effect — with the CP-11 refusals in words
  (`not_latest`, `already_reversed`, `not_reversible`, `not_creator`).
  Adding an item ends in an Undo toast that removes it, offered when you paid
  for it or are an owner/admin (`not_buyer` otherwise).
- **Move to a group is confirmed, not undone**: transfer is not reversible in
  v1, so picking a group shows what will happen ("…becomes Flat 4B's, paid by
  you. This can't be undone.") and a "Move to Flat 4B" button. Groups you
  only view are left out; a group counting in another currency is named as
  unable to take it. Once any of the item is used, the card explains why it
  stays.
- **History** lists the item's stock moves (undone ones struck through and
  marked "Undone", undos as "You undid a use: 100 g back") and ends with the
  purchase, made from the item itself ("Anu added 1 kg · ₹40.00"; "· Anu
  paid" when someone else bought it), since adding writes no stock move.
- **Viewers** see a group's pantry, items and history with no Use, Mark
  wasted, Move or Undo (rows show no Use: `canUse`); the add form's picker
  leaves out groups you only view (roles from `myBalances`), and a
  `/pantry/new?pantry=` naming one falls back to your own pantry with a note.
- **Add an item**: categories are stored as ids (`veg`, `fruit`, `dairy`,
  `grains`, `protein`, `spices`, `other`) and shown by their chip label; the
  quantity is checked with the engine's `toMilli` and sent as typed (".5" is
  sent as "0.5"); a group item omits `currency` (the group's applies) and
  sends `wastePolicy` only when it overrides the group's rule; a personal item
  is sent in the personal pantry's currency. "Bought on" cannot be after
  today (a check in the form only — the API accepts any date). After adding,
  the app opens that pantry.
- **Home's "Use soon"** reads two small lists (`filter=soon` and
  `filter=expired`, four each) and shows the soonest four, still-usable
  first; with nothing to show it says so, or — with no items anywhere —
  invites you to add what you buy.
- **Also changed:** a group's Pantry tab lists its first six items with links
  to the pantry and to Add (not a "coming soon" card); "I bought food" in the
  + Add sheet is live (CP-13 still owns "I used something"); Home's quick-use
  note now points to Use on pantry rows. Pantry reads cache under
  `qk.kitchenPantry()`, invalidated with the group's ledger after every stock
  write. No SDK change was needed.
- **Not in this task:** editing or removing an item from its page (the
  canvas's pencil), quick use and "Do it again" (CP-13), Cook with it (shown
  as "Soon" until CP-15).

### CP6 — the daily sweep and emails (CP-18)

- **Delivery needs a sending domain (open).** notifications-worker sends
  from `no-reply@mail.cookpool.app` through Cloudflare's `send_email`
  binding on stage and prod, and `cookpool.app` is not registered yet. Until
  it is registered and onboarded to Cloudflare Email, every email (these
  three and the baseline's sign-in links) is enqueued, rendered and recorded
  but not delivered to an inbox. This is a setup step for the account owner,
  not code.

- **The job as built.** kitchen-worker's entry exports `scheduled()` beside
  `fetch()`; `"triggers": { "crons": ["30 2 * * *"] }` (08:00 IST) is
  declared once at the top of its wrangler template and inherited by every
  environment — wrangler resolves it for the rendered stage and prod configs
  (tests/config-worker asserts both; no environment overrides it). The day
  swept is the trigger's scheduled UTC day. Each run is recorded in
  `kitchen_sweeps` (migration `270_kitchen_sweeps`: one row per day swept —
  started, finished, items, people, sent, failed, runs; a re-run of the day
  replaces its counts), and `GET /health` answers `lastSweepAt` (null until
  the first run) and `lastSweep` `{ date, items, people, sent, failed, runs }`
  beside its unchanged `checks`. The design's "refreshes the inbox" is not a
  write: the Home inbox (CP-19) reads live.
- **Who gets a digest, and of what.** Active items with something left whose
  use-by date is today through two days ahead (`USE_SOON_EMAIL_DAYS` = 2, the
  design's "within two days"; the app's own use-soon filter looks three days
  ahead) — not used up, wasted or removed, not already past their date, and
  not items with no date: leftovers (no use-by, CP-16) are never swept until
  they get one (follow-up). A personal item goes to its owner; a group item to
  the group's members whose role may use it (owner, admin, member — not a
  viewer). One digest per person per day lists at most 10 items, soonest
  first then by name, and counts the rest; each item says its pantry ("My
  pantry", or the group's name).
- **Reads, however many people** (risks CP-T, CP-U): one D1 query for every
  pantry's items in the window (the `kitchen_items_expires_idx` partial index
  230 made for it; at most `SWEEP_MAX_ITEMS` = 5,000) and one write for the
  run; one roster per group with items in the window; one person's groups
  per group still unnamed — a group's name is read through one of its
  members, because membership-worker has no sibling route for a group by id;
  one identity lookup per 100 people for names and addresses (CP-9's lookup,
  reused: `People.users`); then one enqueue per person, four at a time.
- **The real notifications path.** Every email is `POST /v1/notifications` to
  notifications-worker over `NOTIFICATIONS_WORKER`, through the baseline's
  `@saas/notifications-client` (`enqueueNotification`, `buildIdempotencyKey`;
  now a kitchen-worker dependency). `kitchen-worker` joins
  `NOTIFICATIONS_INTERNAL_ACTOR_VALUES` so the internal-actor gate lets it in.
  Each email goes to one person, tagged `subjectKind: user` and their id,
  under the `product` category; the digest under notifications' system
  organization (the nil UUID, as identity's sign-in emails) because it spans
  groups, the event emails under their group.
- **Once each.** Keys are `kitchen.use_soon:<usr>:<day>`,
  `kitchen.dish_posted:<dsh>:<usr>` and `kitchen.logged_for_you:<txn>:<usr>`
  — template-scoped, as the client's convention asks (the brief's
  `use_soon:{subject}:{date}` with the template as scope), and naming the
  recipient, because notifications-worker keeps a key once per organization,
  not per recipient. A second sweep the same day, a retried request (which
  asks again, deliberately: the first ask may not have landed) and a replayed
  dish all collapse onto the first send.
- **Best-effort, after the commit.** Handlers ask for event emails through
  `ctx.defer(...)` once their batch has committed; the entry now passes the
  runtime's `ExecutionContext.waitUntil`, so the work runs after the
  response. Without one (tests) it runs before the response — never dropped.
  It never throws into the request: notifications-worker down, identity
  unreadable, a person with no address — the write answers exactly as before.
- **`kitchen.dish_posted`**: a dish cooked with a group and `splitMode:
  claims` (open), to the group's members whose role holds
  `kitchen.dish.claim` (owner, admin, member — `CLAIM_ROLES`, pinned against
  the engine), not the cook and not viewers. Only at cook time: an assigned
  dish, a dish just for its cook, finalizing and corrections send nothing.
- **`kitchen.logged_for_you`**, once per transaction: for a group use, each
  person who had some (its consumers) other than whoever logged it, when the
  use posted a transaction (a use that moves no money — the buyer had it —
  sends nothing); for an expense, everyone it names other than its creator —
  sharers *and* payers (the brief said participants; someone said to have
  paid deserves to hear it too) — who owes or paid something in it. Waste
  split equally, dish charges and settlements send nothing. The email says
  who logged what (a use as "250 ml of Milk"), the total, the recipient's
  share and, for an expense, what it says they paid.
- **Templates** (`apps/notifications-worker/src/templates/index.ts`, keyed
  by `KITCHEN_EMAILS` from `@saas/contracts/kitchen`, which also defines
  their data): "3 things to use soon" (the list, "use by today / tomorrow /
  Wed 4 Nov", a link to `/home`); "Meera made Egg fried rice — claim yours"
  (portions and total, a link to `/dishes/{dsh}` — the dish page arrives with
  the dish screens); "Anu logged 250 ml of Milk for you" (share, a link to
  `/groups/{slug}`). Subject, text and HTML; every value escaped, subjects
  kept to one line, links only over http(s). Amounts arrive formatted;
  links are absolute from kitchen-worker's new `APP_URL` var: the live
  console on workers.dev
  (`https://cookpool-web-console-next-{stage,prod}.rahulvarghesepullely.workers.dev`,
  `http://localhost:3000` locally). `cookpool.app` is not registered yet,
  so links to it would not open; switch `APP_URL` when the domain exists.
- **Preferences.** notifications-worker never read preferences when it
  enqueued; the contract said a subject-tagged recipient's preferences apply.
  Now they do: a preference row for that subject in the request's org with
  the request's category `false` records the notification `suppressed`
  (no send, `notification.suppressed`), like a suppressed address. Untagged
  sends (sign-in, invitations) are unchanged. There is no opt-out per kind:
  categories are a fixed, CHECKed set, so all three are `product` email
  (risks CP-V) — one opt-out per group, and the digest's under the system
  organization, which no screen sets yet (follow-up).
- **Verified end to end** in tests/kitchen-worker against the real
  notifications-worker router, provider and templates over the same SQLite:
  the digest sends once however often the sweep runs, a member who turned off
  product email for the group is recorded suppressed, a retried use sends
  once.
- **Deploy order.** db-migrate (270) before kitchen-worker is enforced.
  notifications-worker (the gate and the templates) is a peer edge: emails
  kitchen-worker asks for before it is deployed are refused and dropped
  (the next day's digest goes; a dish or use logged in that gap emails no
  one).


### CP6 — the inbox API and leaving with a balance (CP-19)

The backend half of the original CP-19 (the screens are CP-23).

- **The route as built.** `GET /v1/kitchen/me/inbox` → `{ items, counts }`
  (`InboxResponse` in `@saas/contracts/kitchen`; SDK `kitchen.inbox()`),
  with `counts` `{ total, claim_dish, finalize_dish, use_soon, payment_due,
  flag }`. Each card carries what its one-tap action needs. Beyond the
  brief's shapes: every group card has `groupSlug`; both dish kinds share one
  `InboxDish` (`state`, `splitMode`, `claimedHalf`, `unclaimedHalf`,
  `perPortionMinor`, `totalMinor` on each); an item has `daysToUseBy` and its
  `pantry` (a `PantryRef`) beside `orgId`, and `usual` is
  `{ quantity, unit, qtyMilli }` or **null** (never absent), `qtyMilli` so
  the app can tell whether the usual still fits; a payment says `canRecord`
  (`kitchen.settlement.create` — viewers owe but cannot record); a flag has
  `flagId`, `txnKind`, `totalMinor`, `currency` and `dishId` (a dish's charge
  is undone by cancelling or correcting the dish, not by a reversal). The
  brief's `note?` is **`reason`**: CP-7 stores every flag with a required
  `reason`, and `KitchenFlag` calls it that.
- **Who sees what.** Only the groups membership says the caller is in are
  read, and the role it gives decides what is offered (as the other
  cross-group reads; every action still asks policy). `claim_dish`: open
  dishes in groups whose role holds `kitchen.dish.claim` (`CLAIM_ROLES`),
  cooked by someone else, where the caller has **no share at all** (a claim,
  or an amount the cook assigned them) and **portions are still free** (a
  fully claimed dish would only answer `claims_exceed_portions`).
  `finalize_dish`: the caller's own open or draft dishes, just for them or in
  a group where their role holds `kitchen.dish.finalize` — a cook made a
  viewer, or gone from the group, is not asked. A dish **just for its cook**
  is included: it stays a draft until finalized (CP-16), so CP-23 may want
  the cook flow to finalize solo dishes at once. `use_soon`: the caller's own
  pantry and groups whose role holds `kitchen.item.use`. `payment_due`: every
  group, viewers included. `flag`: transactions the caller logged in their
  current groups. `FINALIZE_ROLES` and `SETTLE_ROLES` are pinned against the
  policy engine like `USE_ROLES` and `CLAIM_ROLES`.
- **Flags.** "Still open" is `state = 'open'`, raised by **someone else** (a
  flag you raised on your own entry is left out), on a transaction **not
  reversed** — a correction is a reversal, and nothing else resolves a flag
  (there is no resolve route, so `state` never leaves `open`). One card per
  flag.
- **Payments due** are the group's settle plan's payments from the caller,
  so they match Settle up — including one to someone who has since left
  (removed by an admin, or left before this task), which `…/settlements`
  refuses (`not_in_group`); `canRecord` does not know that (it would cost a
  roster read per group).
- **The use-soon window** is two days back to two days ahead
  (`INBOX_EXPIRED_DAYS`, `INBOX_USE_SOON_DAYS` = the digest's
  `USE_SOON_EMAIL_DAYS`); the app's own "use soon" filter looks three ahead.
  At most `INBOX_USE_SOON_MAX` (10), soonest first. `usual` is the caller's
  last logged amount from their usuals (CP-11; the top 100 read).
- **A portion's price** is the engine's `splitByWeights(total, [2,
  portionsHalf − 2])[0]` (₹211.00 for 4 portions is ₹52.75); a dish of half
  a portion is priced at twice its total per portion.
- **Order**: food at or past its use-by date, then dishes to claim (oldest
  cooked first), the caller's dishes to finalize (oldest first), food due in
  the next two days, payments (largest first), flags (oldest first).
  `counts` count the cards listed; each kind is capped by its read — 10
  items, 50 open and 50 draft dishes (newest first, so a person with more
  than 50 open dishes in reach misses the oldest), 50 flags.
- **Bounded reads** (risks CP-S, CP-T): one membership hop (the caller's
  groups; no rosters); on D1, two dish lists (three queries each), the
  use-soon items, the usuals, the groups' settings, one whole-ledger read per
  group (`listSplitsForGroup`, as balances) and the flags — **10 + one per
  group**, all side by side — and one identity lookup per 100 names.
  Server-Timing phases `groups`, `dishes`, `items`, `ledger`, `flags`,
  `identity`. A test counts the statements and shows the number does not move
  with more items, dishes or flags. Any failed read is a 503 (an inbox that
  silently left something out would be wrong); names are best-effort.
- **A new ledger read.** `listFlags` is per transaction, which would be a
  query per transaction, so the kitchen repository gained
  `listOpenFlagsOnTxnsBy({ createdBy, orgIds, limit })`
  (`KitchenOpenFlagRecord`: the flag with the transaction's title, kind,
  total, currency and source) — one statement driven from `kitchen_flags`
  (whose unique index leads with `org_id`), the transaction by primary key,
  the reversal check through `kitchen_txns_reverses_uq`. tests/db proves it
  on SQLite: reversed transactions, resolved flags, flags raised on your own
  entry and other people's transactions left out; groups bound as one JSON
  parameter; oldest first; the cap.
- **Leaving with a balance (risks CP-L).** membership-worker's
  `POST /v1/organizations/{org}/leave` now asks kitchen-worker, after the
  member and last-owner checks and before the leave batch, over a new
  `KITCHEN_WORKER` binding (stage and prod), via a new service-internal
  `GET /v1/internal/kitchen/organizations/{org}/subjects/{usr}/balance` →
  `{ balanceMinor, currency }` (the engine's whole-ledger balance, as
  `…/balances` reads it; 0 with no money in the group; `{org}` is the `org_…`
  id or the UUID). Not zero is **409 `conflict`, `details.reason:
  "balance_not_settled"`**, with `balanceMinor` (positive: owed) and
  `currency`, and a message that says which way; the reason joins
  `KITCHEN_ERROR_REASONS`, where design.md §5 lists it. The console's group
  page already shows the message in its "Couldn't leave" toast; linking it to
  Settle up is CP-23's.
- **It fails closed.** Kitchen-worker unbound, unreachable, answering
  anything but a 2xx with a whole-number balance — leaving is a **503**
  `internal_error` and nobody leaves: an outage must not let someone walk
  away from a debt. A group's only member is held to the same rule (their
  balance can be non-zero only when someone left before this task, or was
  removed by an admin, with money still open; reversing entries is the way
  out — deleting a group is out of scope). The check is not atomic with the leave: an expense naming the
  caller that kitchen-worker accepted against the roster just before the
  leave committed still posts, as after an admin removal. An admin's
  removal is not checked (CP-L: the balance stays under their name).
- **Reachable only over the binding.** kitchen-worker has no workers.dev URL
  (stage and prod, unchanged); api-edge's kitchen facade matches
  `/v1/kitchen/…` and `/v1/organizations/{org}/kitchen/…` only, so **no edge
  change** was needed — tests/api-edge pins that the internal path (and its
  `..` and `%2e%2e` spellings) 404s without calling kitchen-worker, that an
  encoded slash stays inside the `/v1/kitchen/…` path it forwards (which
  kitchen-worker matches literally), and that `x-internal-actor` is never
  forwarded. tests/config-worker pins that only api-edge and
  membership-worker are bound to kitchen-worker. As a second lock, the
  internal route answers only a caller naming itself `membership-worker` in
  `x-internal-actor` (`KITCHEN_INTERNAL_ACTORS`); anyone else — a signed-in
  member's request included — gets the plain "Route not found", before the
  method is even looked at.
- **The binding is an acknowledged cycle.** kitchen-worker depends on
  membership-worker, so membership-worker's `KITCHEN_WORKER` is not a
  `dependsOn` edge: tests/config-worker's `ACKNOWLEDGED_BINDING_CYCLES` lists
  `membership-worker -> kitchen-worker`, and its component.yaml says why. On
  a fresh account `tooling/deploy/fleet-stubs.mjs` places kitchen-worker
  before the binding holder deploys.
- **Deploy order.** Both workers change here and their stage/prod lanes are
  advisory. Until kitchen-worker with the internal route is live, its old
  router answers 404 and leaving fails closed (503) — minutes, no money at
  risk. No redeploy markers: the contracts change is read at runtime only by
  kitchen-worker and membership-worker, which both change; the SDK's
  `inbox()` is unused until CP-23 changes the console.
- **Tests.** tests/kitchen-worker `inbox.test.ts` (43): each kind appears and
  goes (claimed, fully claimed, finalized, canceled, settled, reversed, used
  up, demoted, left), viewers and other groups never see claims or items,
  order, counts, the read count, the internal route and its gate, and
  membership-worker's own client against kitchen-worker's router (the
  `@membership-worker/*` mapping is new in tests/kitchen-worker); tests/db
  for the open-flags read.
  tests/membership-worker: refused owing and owed, allowed at zero, 503 for
  an unbound, throwing, 503, 404 or malformed kitchen-worker, nothing asked
  for a stranger or a refused last owner, the only member held too.
