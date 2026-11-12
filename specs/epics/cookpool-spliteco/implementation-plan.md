# cookpool-spliteco — implementation plan

Each milestone is one task and one pull request on `orun/SE-k-<slug>`, with its contract in `tasks/SE-k.TaskContract.yaml`. A milestone is marked ✅ here when its "done when" list is true, and recorded in `IMPLEMENTATION-STATUS.md`.

## SE0 — the spec ✅

- **SE-1:** this doc set and the six contracts.

**Done when**
- the five documents and `tasks/SE-1..SE-6` are on `main`

## SE1 — groups, expenses, balances ✅

- **SE-2** (design §1–3):
  - migration 530;
  - the itemized maths in `kitchen-engine`;
  - `apps/spliteco-worker` behind api-edge, with contracts and SDK;
  - `apps/spliteco-web`, with Home, Groups & friends, Group, Friend, Activity, Add expense, Who paid, Split, Itemized, Expense breakdown, Move, Insights, Share & export, and You.

**Done when**
- the Spliteco app opens on its stage URL, signs in with a Cookpool account, and lists every group you're in, kitchens included
- any of the six splits saves, including itemized with portions, % or exact per person plus tax and discount; Save stays off until it adds up
- Home, group and friend balances match Cookpool's for the same group to the paisa
- edit, delete (restorable for 30 days) and move to another group change balances and show in Activity
- a group's insights charts and its CSV and JSON export work

## SE2 — settle up and reminders ✅

- **SE-3** (design §2, §5): settlements in spliteco-worker, the Settle up screen, UPI IDs on the profile, "not received", reminders, and the simplify-debts switch per group.

**Done when**
- Pay with UPI opens a UPI app with the payee's UPI ID, the amount and a note, and the payment is recorded only after "I paid"
- cash and bank payments record in one tap, and the person paid can mark one "not received", which reverses it
- simplify debts can be switched per group, and the plan shows the fewest payments
- Remind sends a push or email at most once per person per 24 hours

## SE3 — Cookpool's money runs on Spliteco ✅

- **SE-4** (design §0.4, §0.11, §4): `packages/spliteco-ui`; Cookpool's Money tab rebuilt on spliteco-worker with Kitchen balance, Add a bill and Settle up; the two balances and the kitchen-first payment rule; item rows from kitchen-worker; "More in Spliteco" with a one-time sign-in code; `made_in` filters.

**Done when**
- Cookpool's Money tab adds bills and settles up through spliteco-worker, and a payment made in either app shows in both
- Cookpool shows only the Kitchen balance; Spliteco shows Kitchen and Other, and a Spliteco payment settles Kitchen first
- a new Cookpool kitchen appears in Spliteco by itself; groups made in Spliteco never appear in Cookpool
- More in Spliteco opens that group in Spliteco already signed in, and Back returns to Cookpool
- leaving a kitchen while either balance is open is still refused

## SE4 — bills from a photo, split together ✅

- **SE-5** (design §2, §5):
  - receipt scan into an itemized draft, reusing the Cookpool receipt route;
  - live split sessions with a join code and QR, refreshed by polling, and claims.

**Done when**
- a receipt photo becomes an itemized draft with doubtful lines flagged, and it must match the printed total before assigning
- a live split shows a code and QR; people who sign in claim their items and see each other's claims within 3 seconds
- the bill locks when every item is claimed and posts as one itemized expense

## SE5 — your AI assistant logs splits ✅

- **SE-6** (design §0.9, §5):
  - the `money.write` scope;
  - Spliteco tools in mcp-worker: find_people, list_groups, get_balances, search_expenses, draft_expense, save_expense, edit_expense, delete_expense, move_expense, add_comment, send_reminder;
  - "via <assistant>" in Activity;
  - the AI assistants page.

**Done when**
- an assistant with Add & edit access drafts, saves, edits, deletes and moves an expense; nothing saves without the user's confirm
- asking an assistant to settle returns a link into the app; no MCP tool records a payment
- Activity shows "via <assistant>" on every change an assistant made, and the people on it are notified
- Settings → AI assistants lists each one with Look only, Add & edit and Disconnect

## Sequencing note

- SE1 first: every later rung reads its model and API.
- SE2 before SE3: SE3 rebuilds Cookpool's settle up on SE2's settlement routes.
- SE4 needs only SE1's itemized model.
- SE5 needs SE1's API, plus the cookpool-mcp consent page (MC-4). If MC-4 has not landed when SE5 starts, SE5 waits for it rather than building a second consent page.
- One milestone is in flight at a time.
