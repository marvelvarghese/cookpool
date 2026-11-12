# cookpool-spliteco — design

The screens are on the Claude Design canvas (README). This file is the model behind them. Section numbers are referenced by the contracts.

## 0. Decisions, each with its why

1. **Spliteco lives inside Cookpool** (this repository, workspace `ws_QX130J0D`). Why: the ledger, groups, people, sign-in, push and email, receipt AI and the MCP server all exist here already. Building elsewhere would mean two accounts per person and a sync service between apps.
2. **One ledger, shared.** `kitchen_txns` and `kitchen_txn_splits` (migration 220) stay the single record of money. Their statements stay in `packages/db/src/kitchen/ledger.ts`, and the maths stays in `packages/kitchen-engine` (`money.ts`, `ledger.ts`). Why: kitchen-worker splices a txn into the same D1 batch as a stock move (`stock.ts`, `dishes.ts`, `asks.ts`). Moving the ledger behind another worker would break that atomic write.
3. **Spliteco gets its own worker and its own app.** `apps/spliteco-worker` owns the money API under `/v1/spliteco/…`. `apps/spliteco-web` is its own Next.js app on Workers, with its own address, install and theme. Why: a clear owner for money and a separate brand, without touching kitchen-worker's hot path. This follows the precedent of `mcp-worker`.
4. **Cookpool keeps its kitchen money; Spliteco is the extended app.** Cookpool's Money tab keeps bills, balances and settle up for its kitchen groups, in Cookpool's style, but it calls spliteco-worker and draws its screens from a shared `packages/spliteco-ui`, so the rules and maths exist once. Spliteco adds what a kitchen doesn't need: trips and friends outside the kitchen, insights, export, restaurant bills, live split, AI assistants. "More in Spliteco" on Cookpool's Money tab opens it with a one-time sign-in code (no second sign-in).
5. **A group is a membership organization.** Every Cookpool kitchen is therefore a Spliteco group with no sync. A new column, `membership_organizations.made_in` (`cookpool` | `spliteco`, default `cookpool`), lets Cookpool hide groups made in Spliteco. Members of Cookpool-made groups are managed in Cookpool.
6. **Friends outside a group** share a hidden two-person organization (`kind = 'direct'`), created on the first expense between them. A friend's balance is the sum over every group the two share. Why: every expense stays group-scoped, so policy, roster and the ledger need no second path.
7. **The ledger stays append-only.** An edit is a reversal plus a new txn linked by `revises`. A delete is a reversal, and restoring within 30 days re-posts it. A move is a reversal in group A plus a new txn in group B linked by `moved_from`. Why: this is how Cookpool already corrects money (`reverseSplits`, the partial unique index on `reverses`), and it gives a full history for free.
8. **Rounding is Cookpool's largest-remainder rule** (`splitByWeights`): leftover paise go to the largest fractions, ties to the earlier position. Why: one rule for both apps on one ledger. The canvas note "leftover paisa go to the payer" is corrected to match.
9. **Settling up happens in an app** — Cookpool's Money tab or Spliteco — never from an assistant. Both write the one ledger, so a payment made in either app shows in both.
10. **One MCP server.** `apps/mcp-worker` gains Spliteco tools and a `money.write` scope that covers expenses and comments, never settlements.
11. **Two balances per kitchen group.** *Kitchen*: everything Cookpool posts plus bills added in Cookpool — shown in both apps. *Other*: anything added to that group in Spliteco (rent, Wi-Fi) — shown only in Spliteco. A payment made in Cookpool settles only Kitchen, never more than it. A payment made in Spliteco settles Kitchen first, then Other, and the payer can change the split before saving. So the kitchen number always agrees across apps, and Cookpool never shows a confusing partial total. Simplify debts runs within each balance.

**The alternative rejected:** a separate product on `cirrus-baseline` v28, in its own repository and workspace. It would be clean on paper, but it costs:
- two identity systems, so two accounts per person;
- a sync API so kitchens appear in Spliteco;
- a distributed write, with an outbox and retries, for every Cookpool use;
- a second MCP server, receipt pipeline and notification setup.

Splitly (`~/apps/sourceplane/splitly`) is an empty scaffold with nothing to reuse.

## 1. The model (migration 530)

Existing tables are reused as they are: `kitchen_txns` (kinds expense, use, dish, waste, settlement, reversal), `kitchen_txn_splits` (`paid_minor`, `owed_minor` per person), `kitchen_group_settings` (currency locked on first money write) and `kitchen_flags`. Amounts are integer paise and money is never summed across currencies.

New and changed:

```
membership_organizations   + made_in text ('cookpool'|'spliteco'), + kind text ('kitchen'|'trip'|'home'|'couple'|'other'|'direct')
kitchen_txns               + app text ('cookpool'|'spliteco'), + bucket text ('kitchen'|'other'; Cookpool posts and Cookpool-added bills are kitchen, Spliteco-added are other; a settlement carries the bucket it pays), + title text, + category text,
                           + revises text (txn id), + moved_from text (txn id), + deleted_at, + via_delegation text
ledger_txn_items           txn_id, position, name, qty, unit_minor, total_minor
ledger_txn_item_shares     txn_id, item_position, subject_id, mode ('portion'|'pct'|'exact'), value (portion×1000 | basis points | paise)
ledger_txn_adjustments     txn_id, kind ('tax'|'service'|'discount'), label, amount_minor
ledger_comments            id cmt_…, txn_id, subject_id, body, created_at
ledger_reminders           org_id, from_subject, to_subject, sent_at           -- at most one per pair per 24 h
ledger_live_sessions       id lvs_…, org_id, code, draft json, state ('open'|'locked'), created_by
spliteco_profiles          subject_id, upi_vpa, default_currency
```

**Itemized maths** (pure, in `kitchen-engine`):
1. Exact and percent shares come off each item's total first.
2. People on portions share the rest by weight.
3. An item with money left over, or more assigned than it costs, blocks Save.
4. Tax, service and discount spread in proportion to each person's item total.
5. Everything rounds with `splitByWeights`.

An itemized expense still posts one txn with per-person splits. The item tables are its explanation.

## 2. The API (spliteco-worker, behind api-edge)

These follow the kitchen facade pattern (`apps/api-edge/src/kitchen-facade.ts`): a prefix, `replayOrExecute` idempotency, and actor headers. Envelopes are `{ data, meta }`, and a denial is an opaque 404, as in kitchen-worker.

```
GET    /v1/spliteco/me/home                         balances, owed/owe totals, people
GET    /v1/spliteco/me/groups                       every org I'm in, with made_in, kind and my net
POST   /v1/spliteco/groups                          create a Spliteco group (made_in=spliteco)
GET    /v1/spliteco/groups/{org}                    balances, simplified plan, expenses by month
GET    /v1/spliteco/me/friends/{usr}                balance across shared groups, shared expenses
POST   /v1/spliteco/groups/{org}/expenses           any split: equal|exact|pct|shares|adjust|items, several payers
PUT    /v1/spliteco/expenses/{txn}                  edit (reversal + new txn)
DELETE /v1/spliteco/expenses/{txn}                  delete (reversal); POST …/restore within 30 days
POST   /v1/spliteco/expenses/{txn}/move             { to_org } — everyone on it must be a member there
GET    /v1/spliteco/expenses/{txn}                  breakdown, items, adjustments, comments, history
POST   /v1/spliteco/expenses/{txn}/comments
GET    /v1/spliteco/groups/{org}/activity           including "via <assistant>"
GET    /v1/spliteco/insights?org&month              by category, by payer, by month
GET    /v1/spliteco/groups/{org}/export.{csv,json}
POST   /v1/spliteco/groups/{org}/settlements        SE2: upi|cash|bank, confirmed by the payer
POST   /v1/spliteco/settlements/{txn}/not-received  SE2: the receiver reverses it
POST   /v1/spliteco/reminders                       SE2: { to } — 409 inside 24 h
POST   /v1/spliteco/groups/{org}/live               SE4: open a live split; GET …/live/{code}, POST …/claims
```

Rules:
- Expenses with `app = 'cookpool'` are read-only here: edit, delete and move answer 409 `owned_by_cookpool`.
- Moving into a group requires every person on the expense to be a member; otherwise the answer is 409 `not_members`.

## 3. The app (apps/spliteco-web)

Screens as on the canvas. The itemized split shows one item per slide (swipe, arrows, item chips, dots), and each card shows only the people on that item plus an "+ Add" picker over the group (search, Everyone, Same as last item), because groups can be large. Screens:
- Home, Groups & friends, Group, Friend, Activity
- Add expense, Who paid, Split (six methods), Itemized (per-person portions, % or exact; item actions), Scan
- Expense breakdown, Insights, Settle up, Live split, Share & export, Move
- Cookpool-linked group, You & settings, AI assistants, and the web dashboard

It is a Next.js app on Workers with OpenNext, binding `API_EDGE`, as `web-console-next` does, with its own PWA manifest. Sign-in is the same identity (Google and passkeys), so the same account works in both apps.

## 4. Cookpool's side (SE3)

- Cookpool keeps its groups and its Money tab: kitchen bills, the Kitchen balance with its "why", Add a bill, and Settle up (UPI, cash, bank). The tab calls spliteco-worker and is drawn from `packages/spliteco-ui` in Cookpool's colours; kitchen-worker's own money routes are folded into spliteco-worker so there is one implementation.
- kitchen-worker keeps posting uses, dishes and waste into the ledger (bucket `kitchen`), now with item rows.
- Cookpool's Money tab never shows Spliteco-only groups, friends, or a kitchen group's *Other* balance. A "More in Spliteco" card opens Spliteco on that group with a one-time 60-second sign-in code minted by identity-worker.
- Cookpool's group lists filter on `made_in = 'cookpool'`. The leave guard (`handlers/internal.ts`, risk CP-L) checks both balances.

## 5. Events, secrets, integrations

- **Audit events:** `spliteco.expense.added|edited|deleted|restored|moved`, `spliteco.settlement.recorded|not_received`, `spliteco.reminder.sent`. Each is written in the same batch as its txn, as kitchen-worker does.
- **Notifications:** new kinds `spliteco.expense_for_you`, `spliteco.reminder` and `spliteco.paid_you`, through `packages/notifications-client`, by push or email.
- **UPI:** a `upi://pay?pa=<vpa>&am=<amount>&tn=<note>` link only. No payment provider and no secret.
- **Receipts** reuse `POST /v1/kitchen/me/ai/receipt`, which writes nothing, under the `cookpool-ai` rules: money never moves on the AI's word, and names never go to the model.
- **MCP:** a new `money.write` scope in `apps/api-edge/src/delegation-scopes.ts` allows the expense and comment routes only.

## 6. Out of scope

- Multi-currency conversion.
- Recurring expenses.
- Bank or card feeds.
- Payment through a provider. UPI is a deep link; Spliteco never holds money.
- A native mobile app; the PWA comes first.
- Guests in a live split without an account.
- Import from a Splitwise CSV, which is a later task.
