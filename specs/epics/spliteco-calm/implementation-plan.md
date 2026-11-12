# spliteco-calm — implementation plan

Each milestone is one task and one pull request on `orun/SL-k-<slug>`, with its contract in `tasks/SL-k.TaskContract.yaml`. A milestone is marked ✅ here when its "done when" list is true, and recorded in `IMPLEMENTATION-STATUS.md`.

## SL0 — the spec ✅

- **SL-1:** this doc set and the seven contracts.

**Done when**
- the five documents and `tasks/SL-1..SL-7` are on `main`

## SL1 — the calm foundation ✅

- **SL-2** (design §1, §2, Sign in): the surfaces and type; the floating tab bar; the gesture modules (`src/lib/gestures/`, copied from Cookpool with their tests) and their React helpers (pager, row swipe, hold, pull, sheet drag, edge back, slider); the Sign in page.

**Done when**
- every Spliteco page on stage has borderless cards, weights up to 600 and the floating tab bar
- Sign in shows Google and Passkey side by side and Email me a code, as on `V2SignIn`
- the gesture modules' tests pass in `tests/spliteco-web`

## SL2 — Home, Groups, Activity ✅

- **SL-3** (design §2, §3): Home, Groups and Activity to `V2Home`, with the tab pager, the row swipe (Settle / Remind with Undo), the hold sheet and pull to refresh.

**Done when**
- swiping sideways moves between Home, Groups and Activity, and the tab pill follows
- swiping a person left settles or reminds, with Undo; holding opens Settle · Remind · Open
- pulling down re-reads the page; rows are one line with signed amounts

## SL3 — Group and expense ✅

- **SL-4** (design §2, §3): the Group page to `V2Group`; swipe a bill to delete with Undo; hold for Edit · Move · Comment; the Bills · Balances pager; the edge swipe back on every pushed screen.

**Done when**
- a bill swiped left is deleted and Undo restores it
- holding a bill opens Edit · Move · Comment; Bills · Balances swipe
- swiping from the left edge goes back on every pushed screen

## SL4 — Add and Itemized ✅

- **SL-5** (design §4, §3): Add keypad first, the method strip, a row per person for every method with the footer, Save that says what is left; Itemized as one card per item with + Who had it?, hold to adjust and the totals strip.

**Done when**
- each of Equally, Exact ₹, Percent, Shares and + / − shows how each person's share is set and what is left, and saves only when it adds up
- the keypad types into the amount or the selected person
- Itemized swipes between items, adds people with +, adjusts by holding a face, and Save says how many items are left

## SL5 — Settle ✅

- **SL-6** (design §3): Settle to `V2Settle` with the slider.

**Done when**
- Cash and Bank record by sliding; UPI opens the UPI app first and then slides when paid; a tick and Undo follow

## SL6 — close-out ✅

- **SL-7:** status and README.

**Done when**
- `IMPLEMENTATION-STATUS.md` lists SL0–SL5 with their PRs, and the README reads Shipped

## Sequencing note

- SL1 first: every later rung uses its surfaces and gesture helpers.
- SL2 before SL3: the Group page reuses SL2's row swipe and hold sheet.
- SL4 and SL5 need only SL1, but go in order to keep one milestone in flight.
