# cookpool-kitchen — design

The screens this document describes are drawn, and clickable, in the Claude
Design canvas https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv. Where the two
disagree, the canvas shows intent for layout and this document for behaviour.

## 1. The resources

### 1.1 Reused from the cirrus baseline

| Concept | Baseline resource | Notes |
|---|---|---|
| A person | identity subject `usr_…` | sign-in, sessions, email unchanged |
| A group | membership organization `org_…` | name, slug, members, roles. A person belongs to many. |
| Group roles | `owner`, `admin`, `builder`, `viewer` | joining by link grants `builder` ("member" in the UI); `viewer` is read-only |
| Joining | `membership_organizations.join_code` (migration `200_membership_join_codes`; ogpic's join codes without its request queue) | a code per group; opening it joins straight away. No approval queue in v1: rotating the code is how a group closes the door |
| Audit | `appendEventWithAudit` into the shared D1 | every money write emits one event |
| Email | `notifications-worker` templates | three new templates (§8) |

### 1.2 New: the `kitchen` bounded context (`apps/kitchen-worker`, shared D1, `kitchen_*` tables)

Ids follow the baseline's `<prefix>_<32hex>` rule.

```
kitchen_group_settings        one row per group (org_id PK), written on its first change;
                              a group without one reads as INR / split_equally
  currency          text      ISO 4217, fixed once the row exists (INR default)
  waste_policy      text      split_equally | buyer_absorbs

kitchen_items         itm_    an item in one pantry
  owner_kind        text      user | group
  owner_subject_id  text?     set for a personal pantry item
  org_id            text?     set for a group pantry item
  name, category    text
  dimension         text      count | mass | volume | pack
  display_unit      text      pcs, g, kg, ml, L, dozen, pack …
  qty_bought_milli  integer   quantity in thousandths of the base unit (piece, g, ml, pack)
  qty_left_milli    integer   CHECK (0 <= qty_left_milli <= qty_bought_milli)
  price_minor       integer   what was paid, in paise; CHECK (>= 0)
  cost_taken_minor  integer   price already charged to uses, waste and dishes (for the last-use remainder)
  currency          text
  paid_by           text      usr_… who paid
  bought_on         text      ISO date
  expires_on        text?     ISO date
  waste_policy      text?     null = follow the group; split_equally | buyer_absorbs
  source_dish_id    text?     set when the item is a dish's leftovers
  state             text      active | used_up | wasted | removed
  version           integer   optimistic concurrency for edits
  CHECK ((owner_kind = 'user' AND owner_subject_id IS NOT NULL AND org_id IS NULL)
      OR (owner_kind = 'group' AND org_id IS NOT NULL AND owner_subject_id IS NULL))

kitchen_stock_moves   mov_    every change to qty_left
  item_id, kind     text      use | dish | waste | transfer | adjust | reversal
  qty_milli         integer
  cost_minor        integer
  actor             text      who logged it
  txn_id, dish_id   text?

kitchen_dishes        dsh_
  cook              text      usr_…
  org_id            text?     the group it is shared with; null = just me
  name              text
  portions_half     integer   portions × 2 (half portions are allowed)
  extras_minor      integer   gas, spices: paid by the cook
  ingredients_minor integer
  total_minor       integer   ingredients + extras
  currency          text
  split_mode        text      assign | claims
  state             text      draft | open | finalized | canceled
  txn_id            text?     the dish transaction once finalized
  leftover_item_id  text?

kitchen_dish_ingredients      dish_id, item_id, qty_milli, cost_minor, use_txn_id?
kitchen_dish_shares   dsr_    dish_id, subject_id, portions_half? | exact_minor?, source cook | self
                              UNIQUE (dish_id, subject_id)

kitchen_txns          txn_    one money event in one group's ledger
  org_id            text      always a group: personal pantries have no ledger
  kind              text      expense | use | dish | waste | settlement | reversal
  title             text
  total_minor       integer
  currency          text
  occurred_at       text
  created_by        text
  source_kind       text?     item | dish | expense
  source_id         text?
  reverses          text?     txn_… this one undoes
  reversed_by       text?
  idem_key          text      UNIQUE (org_id, idem_key)

kitchen_txn_splits            txn_id, subject_id, paid_minor, owed_minor
                              PRIMARY KEY (txn_id, subject_id)
                              invariant: Σ paid_minor = Σ owed_minor = total_minor

kitchen_flags         flg_    txn_id, subject_id, reason, state open | resolved
```

Personal pantry rows carry no `org_id`. This is the one deliberate exception
to the baseline's "every table carries org_id" convention, because a personal
pantry follows its owner across every group. They are keyed and purged by
`owner_subject_id` (CP-K).

## 2. Units and money

- **Money** is an integer number of paise (the group currency's minor unit). A
  group's currency is fixed when the group is created. A personal item uses its
  owner's default currency, and a dish refuses ingredients in a currency other
  than the shared group's (`422 currency_mismatch`).
- **Splitting an amount** across weights uses largest-remainder rounding: floor
  every share, then give the leftover paise one each to the largest fractional
  parts, ties broken by the order the people are listed in. Parts always add up
  to the total exactly.
- **Quantities** are integers in thousandths of the base unit of a dimension:
  pieces (count), grams (mass), millilitres (volume), packs. Display units
  convert inside a dimension: kg↔g, L↔ml, tsp 5 ml, tbsp 15 ml, cup 240 ml,
  dozen 12 pcs. There is no conversion across dimensions in v1.
- **The cost of using some of an item** is
  `round(price_minor × qty_used / qty_bought)`. When a use takes the last of an
  item, it costs `price_minor − cost_taken_minor` instead, so a fully used item
  has cost exactly what was paid for it.

## 3. How money moves

Buying records who paid; nothing is split. Every later event is one transaction
in one group's ledger, written in one D1 batch with its splits, its stock moves
and the item updates.

| Event | Ledger | Paid | Owed |
|---|---|---|---|
| **Expense** (a bill) | the group | each payer, their amount | per split mode: equal, exact, percent, shares |
| **Use of a group item** (alone or by several people) | the item's group | the buyer: the cost | the people who had it, split equally (or by amounts) |
| **Use of a personal item** | none | — | — |
| **Ingredient taken for a dish** from a group pantry | that item's group | the buyer: the cost | the cook: the cost |
| **Dish** shared with a group | the dish's group | the cook: the dish total | the eaters, by portions or exact amounts; unclaimed portions fall to the cook |
| **Waste**, group rule *split equally* | the item's group | the buyer: the unused value | every current member, equally |
| **Waste**, *buyer absorbs* | none | — | — (the stock move is still recorded) |
| **Settlement** (A pays B) | the group | A: the amount | B: the amount |
| **Reversal** | same as the original | the original's owed | the original's paid |

A buyer who uses some of their own item appears on both sides of the
transaction, so their own share nets to zero. Any member can log a use for
other members ("Anu and I had the milk"). Everyone named sees it in their
activity and can flag it; a flag notifies the logger and a group admin, and a
correction is a reversal.

**Worked example.** Rahul cooks paneer butter masala with rotis and shares it
with Flat 4B. He uses his own paneer (₹95.00), butter (₹28.00) and cream
(₹30.00), Anu's tomatoes from Flat 4B (₹12.00), Dev's onions from Flat 4B
(₹7.00) and Kiran's chapati flour from the Lunch club (₹24.00), plus ₹15.00 of
extras. The total is ₹211.00 for 4 portions, ₹52.75 a portion.

- At cook time: a `use` transaction in Flat 4B (Anu paid ₹12.00, Dev paid
  ₹7.00, Rahul owes ₹19.00) and one in the Lunch club (Kiran paid ₹24.00,
  Rahul owes ₹24.00).
- At finalize, with claims You 1½, Anu 1, Dev 1, Meera ½: a `dish` transaction
  in Flat 4B. Rahul paid ₹211.00. Owed: Rahul ₹79.13, Anu ₹52.75, Dev ₹52.75,
  Meera ₹26.37. The odd paisa goes to Rahul as the largest remainder.
- Netted inside Flat 4B: Anu owes Rahul ₹40.75, Dev ₹45.75 and Meera ₹26.37.
  Rahul owes Kiran ₹24.00 in the Lunch club.

## 4. Settling up

- A member's **balance** in a group is Σ paid − Σ owed over the group's
  transactions. Balances always sum to zero.
- **Fewest payments**: repeatedly pair the largest creditor with the largest
  debtor and settle the smaller amount. Ties break by subject id, so the plan
  is stable. This gives at most n − 1 payments and keeps every member's net.
- **Showing the working**: the settle-up screen reports three numbers. The
  pairwise debts the transactions created ("10 debts"), how many pairs remain
  once two people's debts in opposite directions cancel ("5"), and the payments
  in the plan ("3").
- **The per-person view** ("You and Dev") lists, for each group two people
  share, every transaction that moved money between them, attributed pairwise.
  A transaction with one payer attributes each owed share to that payer. For a
  multi-payer expense, each person's net in that transaction is matched
  against the others' in split order, so the lines always add up exactly. Then it
  shows the pairwise total, and the *group shortcut*: the difference between
  that total and what the settle-up plan asks this pair to pay. Every number on
  every balance taps through to this view.
- **Across groups**: the Home and People views add up per-person nets across
  groups. Payments are still recorded in the group they belong to.

## 5. The API

Every route goes through `api-edge`, using the baseline's idempotency,
actor-resolution and rate-limit path (`kitchen-facade.ts`, the same shape as
`qa-facade.ts`). Responses use `{ data, meta }`; errors use
`{ error: { code, message, details, requestId } }`. Every `POST` takes an
`Idempotency-Key`.

**Personal, and across everything I can reach** (`/v1/kitchen/me/…`)
```
GET    /v1/kitchen/me/pantries                     my pantry + every group pantry I can see, with counts
GET    /v1/kitchen/me/items?pantry=&q=&filter=     items across pantries (soonest use-by first)
POST   /v1/kitchen/me/items                        add to my personal pantry
PATCH  /v1/kitchen/me/items/{itm}
POST   /v1/kitchen/me/items/{itm}/uses             use some of my own item (no ledger)
POST   /v1/kitchen/me/items/{itm}/transfer         move it into a group pantry
GET    /v1/kitchen/me/search?q=                    quick-use and dish-maker search across all pantries
GET    /v1/kitchen/me/usuals                       presets and "Do it again" from my history
GET    /v1/kitchen/me/inbox                        Home: dishes to claim or finalize, items to use, payments due
GET    /v1/kitchen/me/balances                     per group and per person
GET    /v1/kitchen/me/people/{usr}                 the "why" view for one person
POST   /v1/kitchen/me/dishes                       cook: ingredients from any reachable pantry; optional org
GET    /v1/kitchen/me/dishes?state=
```

**Inside one group** (`/v1/organizations/{org}/kitchen/…`)
```
GET    PATCH  …/settings                           { currency, wastePolicy, updatedAt|null }; PATCH is
                                                   owner/admin; currency fixed once saved (409 currency_locked)
GET    POST   …/items                              the group pantry
PATCH  DELETE …/items/{itm}                        buyer or admin
POST   …/items/{itm}/uses                          { qty, consumers: [usr…], amounts? }
POST   …/items/{itm}/waste                         { qty? } (default: everything left)
GET    …/dishes   GET …/dishes/{dsh}
PUT    …/dishes/{dsh}/claims/me                    { portions_half }
PUT    …/dishes/{dsh}/shares                       cook assigns { shares: [{ usr, portions_half | exact_minor }] }
POST   …/dishes/{dsh}/finalize                     cook, or an admin for a stuck dish
POST   …/dishes/{dsh}/correct                      reversal + new dish transaction
GET    POST   …/expenses
POST   …/txns/{txn}/reverse
POST   …/txns/{txn}/flags
GET    …/activity?cursor=
GET    …/balances
GET    …/settle-plan                               { payments, working: { debts, pairs, payments } }
POST   …/settlements
```

**Groups and joining** (membership-worker)
```
POST   /v1/organizations                           create a group (baseline; free-plan cap lifted)
GET    /v1/organizations/{org}/join-code           { code }, minted on first read (owner/admin)
POST   /v1/organizations/{org}/join-code/rotate    { code }; the old link stops working (owner/admin)
GET    /v1/join/{code}                             { orgId, name, slug, memberCount, alreadyMember }
POST   /v1/join                                    { code } → 201 { orgId, slug, memberId, alreadyMember }
                                                   (200 when already in; 412 + details.reason when full)
POST   /v1/organizations/{org}/leave               { orgId, memberId, left }; the last owner is refused
                                                   while others remain (409 last_owner). Refusing while
                                                   your balance is not zero arrives with the ledger (CP2).
```

`ERROR_CODES` stay pinned. Kitchen outcomes ride on an existing code with
`details.reason` (`KITCHEN_ERROR_REASONS` in `@saas/contracts/kitchen`):
`currency_locked` (409, CP-4), and as their routes land `insufficient_stock`,
`currency_mismatch`, `not_in_group`, `dish_not_open`, `claims_exceed_portions`,
`already_reversed`, `balance_not_settled`.

## 6. Who can do what

New policy actions, mapped onto the baseline roles in `ORG_ROLE_PERMISSIONS`:

| Action | owner / admin | builder (member) | viewer |
|---|---|---|---|
| `kitchen.pantry.read`, `kitchen.ledger.read` | ✓ | ✓ | ✓ |
| `kitchen.item.create`, `kitchen.item.use`, `kitchen.dish.claim` | ✓ | ✓ | |
| `kitchen.item.edit` (own) / `kitchen.item.manage` (anyone's) | ✓ / ✓ | ✓ / | |
| `kitchen.dish.cook`, `kitchen.dish.finalize` (own) | ✓ | ✓ | |
| `kitchen.dish.finalize_any`, `kitchen.txn.reverse_any` | ✓ | | |
| `kitchen.expense.create`, `kitchen.settlement.create`, `kitchen.txn.flag` | ✓ | ✓ | |
| `kitchen.settings.manage`, `organization.join_code.read`, `organization.join_code.rotate` | ✓ | | |

`billing_admin` holds no kitchen action: it is not a group role.

The personal pantry is checked against the actor's subject, not the policy
engine: only its owner can read or change it. A dish may use a group item only
if the cook holds `kitchen.item.use` in that item's group.

## 7. The app

A consumer route tree, `apps/web-console-next/src/app/(kitchen)/`, beside the
baseline's admin `(app)` shell, which stays for account settings. It follows
ogpic's `rondo` pattern: its own layout and navigation, built from the
existing shadcn, Radix and Tailwind kit.

| Route | Canvas artboard | What a person can do |
|---|---|---|
| `/home` | Home — inbox | quick-use search; balance; claim portions, finalize, use expiring items, record payments inline |
| sheet over any page | + Add sheet | I used something · I cooked · I bought food · I paid a bill · Do it again |
| `/use` | Use something | search every pantry, pick a preset amount, pick who had it, log, undo |
| `/pantry` | Pantry — all pantries | every reachable pantry as a folding section; picker; use-soon filter; Use on every row |
| `/pantry/new` | Add an item | personal or any group (searchable picker), who paid, waste override |
| `/pantry/[itm]` | Item — Tomatoes | stock, use some for several people, cook with it, mark wasted, history |
| `/cook` | Dish maker — any pantry | ingredients from any pantry, extras, portions, share with a group, assign or claims |
| `/dishes/[dsh]` | Dish — claims & split | claims, how the money moves, netting, finalize, correct |
| `/groups` | Groups — many | search, sort, balances |
| `/groups/[slug]` | Group — Flat 4B | activity, balances, pantry, dishes, rules |
| `/groups/[slug]/expense` | Add expense | four split modes |
| `/groups/[slug]/settle` | Settle up — fewest payments | group picker, the working, record payments |
| `/people/[usr]` | You and Dev — why | every amount between two people, across groups |
| `/join/[code]` | Join from a link | inviter's link and QR code; joiner's accept |

Navigation: bottom tabs Home · Pantry · **+ Add** · Groups · People below
900px; a sidebar with the same items above it. Anywhere a group or pantry is
chosen, the control is a searchable picker with recent choices first; there
are no per-group tabs. Destructive and money actions confirm by **undo**
(a toast with a 10-second undo that posts a reversal), not by a dialog. Data
loads through `useApiQuery` with `kitchen*` keys; open dishes poll every 20
seconds while on screen. `public/manifest.webmanifest` gets Cookpool's name,
icons and `start_url: /home`.

## 8. Baseline changes, events and jobs

**Baseline changes (CP1)**
- `SOLO_MODE` false in the api-edge, identity-worker and membership-worker
  wrangler templates, and `NEXT_PUBLIC_SOLO_MODE` false in the console.
- `apps/billing-worker/src/plan-catalog.ts`, free plan: `limit.members` 50,
  `limit.organizations` 25, `feature.multi_org` true. Billing screens hidden.
- Join links ported from ogpic's join codes (migration
  `200_membership_join_codes`, handlers `join`, `leave`), without its
  approval queue, replacing email invites in the UI.
- `apps/kitchen-worker` with bindings `PLATFORM_DB`, `MEMBERSHIP_WORKER`,
  `POLICY_WORKER` and `NOTIFICATIONS_WORKER`; `KITCHEN_WORKER` bound on
  api-edge; `kitchen` added to `BOUNDED_CONTEXTS`; migrations
  `NNN_kitchen_*` from `210_kitchen_settings` on, with manifest entries.

**Audit events**: `kitchen.item.added`, `kitchen.item.used`,
`kitchen.item.wasted`, `kitchen.item.transferred`, `kitchen.dish.cooked`,
`kitchen.dish.finalized`, `kitchen.expense.added`,
`kitchen.settlement.recorded`, `kitchen.txn.reversed`, `kitchen.txn.flagged`,
`membership.join_link.rotated`, `membership.joined_via_link`, `membership.left`.

**Emails** (notifications-worker, each with an opt-out in preferences):
`kitchen.use_soon` (a daily digest of items within two days of use-by),
`kitchen.dish_posted` (a dish you can claim), `kitchen.logged_for_you`
(someone logged a use or expense naming you).

**Job**: `kitchen-worker` `scheduled()` runs a daily sweep at 02:30 UTC (08:00
IST). It sends `use_soon` digests and refreshes the inbox. The cron
**triggers are declared for stage and prod in the wrangler template**. A
schedule with no trigger never runs.

## 9. Out of scope

Receipt scanning; reusable recipes; shopping lists; currency conversion and
multi-currency groups; one-to-one splits outside a group; real-time updates
(the app polls); payment rails such as UPI deep links; push notifications;
native apps; conversion across dimensions (an egg's weight); public listing of
anyone's pantry. Each is a candidate for a later epic once the core loop ships.
