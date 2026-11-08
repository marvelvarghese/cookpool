# Epic: cookpool-pantry (PN)

**Cookpool's Pantry shows what's there. This epic makes it the one place where the kitchen gets used, checked and restocked, with as few taps as a set in a workout app.**
- **A Now strip.** What you usually use at this time of day (milk in the morning) and what's about to go off. One tap logs it.
- **Every item suggests an amount and says why.** It might be your usual for this time of day, the rest of a nearly finished item, or the amount to use soon. Tap the chip and it's logged, with Undo. Tap the row and it opens in place: − [1 glass] +, who had it, ✓ Use.
- **Finished items stay for a week** with Bought again, and a **shopping run** restocks everything you bought in one go: tick it, change what's different, Add.
- **A stock check** fixes the amount when nobody logged it. You set what's really left and say where the rest went: you used it, the flat shares it, or it went bad. The money stays fair.
- **Ask before use.** The buyer can guard a group item, such as saffron. Others ask; the buyer gets a push and approves or declines; nothing moves until they do.

It is built the way a good workout app works: the next thing is already filled in, one tap does it, and anything else is one more tap away.

## Status

| Field | Value |
|-------|-------|
| Status | Draft |
| Cluster | **PN** (PN0–PN4) |
| Owner(s) | **Suggestions, restocking, the stock check and asks:** `apps/kitchen-worker`, `packages/db`, `packages/contracts`, `packages/sdk`. **The ask push:** `apps/kitchen-worker` through notifications-worker's push to a subject. **The Pantry, the item page, the shopping run, the stock check and the ask screens:** `apps/web-console-next`. |
| Builds on | `cookpool-kitchen` (CP3 pantries and using, the waste rule), `cookpool-simpler` (SM-5 writes with Undo, the five tabs), `cookpool-recipes` (RC-2 item notes, RC-3 foods and kinds, RC-11 page transitions), `cookpool-guided` (GC-3 push to a subject), `cookpool-app` (PW-5/PW-6 Web Push, PW-8 rows and long-press). |
| Changes | **Pantry:** grouped by kind of food, with a level bar, counts as filters, a Now strip, a suggested amount on each row, rows that open in place, and Finished this week. **Logging:** Home's "What did you use?" opens the Pantry with search ready; the old logging screen goes. **Item page:** a level ring, when it runs out at this rate, history with Undo on your own entries. **Restocking:** Bought again on an item, and the shopping run. **Stock check:** set the real level and say where the difference went. **Ask before use:** a per-item switch, asks, approvals, a push to the buyer, and the cook session's line. |
| Decisions locked | (1) **One kitchen surface.** The Pantry is where you log, check and restock; there is no second logging screen. (2) **Suggestions come from the server and say why:** your usual for this time of day from your own last 60 days with that food, the rest when little is left, and use soon. A new pack inherits the usual because it's kept per food, not per item. (3) **One row open at a time,** and Undo instead of "Are you sure?". (4) **Finished items stay 7 days.** (5) **A shopping run is one write with one payer.** Each line keeps its own pantry and price, and Undo removes them all. (6) **The stock check never invents money.** Less than expected becomes a use by you, a use split across the group's members, or waste under the item's rule. More than expected moves no money. (7) **Ask before use is per item, off by default, and set by the buyer.** Nothing moves until they approve. An ask lapses after 24 h. The buyer can let named people skip asking. (8) **Stage first,** behind `newFrame()`. |
| Design | Claude Design canvas, rows "Pantry and using — faster" and "Ask before use": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`PantryNew`, `UseSheet`, `QuickLog`, `ItemPage`, `BuyAgain`, `StockCheck`, `AskSetting`, `AskRequest`, `AskApprove`). The stickies there hold the rules. |
| Gate | PN1 is the day the Pantry logs in one tap. PN2 is the day restocking takes one go. PN3 is the day stock can be fixed honestly. PN4 is the day a buyer can guard an item. |
| Shipped as | |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| PN0 — the spec | this doc set and its contracts | merged |
| PN1 — one tap from the Pantry | usuals by time of day and by food, kept across packs; the Pantry grouped by kind with levels, counts, search, the Now strip, a suggested amount on each row, rows that open in place, the More… sheet and Log several; Home's field opens the Pantry | on stage, at 8 am, the Now strip offers "Milk · 1 glass · Morning usual" and one tap logs it; a new pack of milk keeps the usual |
| PN2 — restocking in one go | Finished this week, Bought again, the shopping run and its single write | on stage, a shopping run adds bread, atta and milk to two pantries in one write, and Undo removes all three |
| PN3 — fixing stock honestly | the stock check and its money rule; the item page with a level ring, when it runs out, and Finish it | on stage, setting milk from 1 L to 750 ml with "Split with Flat 4B" charges each of the four members a quarter of 250 ml, and Undo reverses it |
| PN4 — ask before use | the per-item switch, asks, approvals, the push to the buyer, the Home card, and the cook session's line | on stage, Dev asks for saffron, Meera's phone gets the push, Approve logs it for Dev and Anu, and "Always let Dev" stops the next ask |

## After this epic

(Filled in by the close-out task.)
