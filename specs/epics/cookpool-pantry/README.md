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
| Status | ✅ Shipped on stage 2026-11-08 · reaches prod with cookpool-recipes RC5 |
| Cluster | **PN** (PN0–PN4) |
| Owner(s) | **Suggestions, restocking, the stock check and asks:** `apps/kitchen-worker`, `packages/db`, `packages/contracts`, `packages/sdk`. **The ask push:** `apps/kitchen-worker` through notifications-worker's push to a subject. **The Pantry, the item page, the shopping run, the stock check and the ask screens:** `apps/web-console-next`. |
| Builds on | `cookpool-kitchen` (CP3 pantries and using, the waste rule), `cookpool-simpler` (SM-5 writes with Undo, the five tabs), `cookpool-recipes` (RC-2 item notes, RC-3 foods and kinds, RC-11 page transitions), `cookpool-guided` (GC-3 push to a subject), `cookpool-app` (PW-5/PW-6 Web Push, PW-8 rows and long-press). |
| Changes | **Pantry:** grouped by kind of food, with a level bar, counts as filters, a Now strip, a suggested amount on each row, rows that open in place, and Finished this week. **Logging:** Home's "What did you use?" opens the Pantry with search ready; the old logging screen goes. **Item page:** a level ring, when it runs out at this rate, history with Undo on your own entries. **Restocking:** Bought again on an item, and the shopping run. **Stock check:** set the real level and say where the difference went. **Ask before use:** a per-item switch, asks, approvals, a push to the buyer, and the cook session's line. |
| Decisions locked | (1) **One kitchen surface.** The Pantry is where you log, check and restock; there is no second logging screen. (2) **Suggestions come from the server and say why:** your usual for this time of day from your own last 60 days with that food, the rest when little is left, and use soon. A new pack inherits the usual because it's kept per food, not per item. (3) **One row open at a time,** and Undo instead of "Are you sure?". (4) **Finished items stay 7 days.** (5) **A shopping run is one write with one payer.** Each line keeps its own pantry and price, and Undo removes them all. (6) **The stock check never invents money.** Less than expected becomes a use by you, a use split across the group's members, or waste under the item's rule. More than expected moves no money. (7) **Ask before use is per item, off by default, and set by the buyer.** Nothing moves until they approve. An ask lapses after 24 h. The buyer can let named people skip asking. (8) **Stage first,** behind `newFrame()`. |
| Design | Claude Design canvas, rows "Pantry and using — faster" and "Ask before use": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`PantryNew`, `UseSheet`, `QuickLog`, `ItemPage`, `BuyAgain`, `StockCheck`, `AskSetting`, `AskRequest`, `AskApprove`). The stickies there hold the rules. |
| Gate | PN1 is the day the Pantry logs in one tap. PN2 is the day restocking takes one go. PN3 is the day stock can be fixed honestly. PN4 is the day a buyer can guard an item. |
| Shipped as | PN0 #79 · PN1 #81 #84 · PN2 #82 #87 · PN3 #83 #85 · PN4 #86 #88 · close PN-10. On stage: usuals by time of day, kept per food so a new pack inherits them; the Pantry by kind with level bars, counts as filters, phone search, the Now strip, a suggested amount with its reason on every row, rows that open in place, the More… sheet and Log several; Home's field opens the Pantry; Finished this week, Bought again with Change and Undo, `/pantry/new?from=`, and the shopping run in one write (migration 400); the item page with a level ring, quick-use chips, when it runs out, who had it and its actions; the stock check, whose difference becomes your use, a split with the group or waste, and whose raise moves no money (migration 410); and ask before use: the buyer's switch and allowed list, asks from rows, sheets, the item page and the cook session, the buyer's Home card with Approve, Decline and Always let, pushes both ways, and 24 h lapsing (migration 420). |

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

These are what the tasks reported and left for later, or for a small fix:

- **Prod.** Everything lives inside the new frame, so it reaches prod with cookpool-recipes RC5, when the owner says go.
- **Owner checks on an installed iPhone and on stage:**
  - the Now strip at a real morning, after three morning uses of the same thing;
  - one-tap chips, the open row and Log several, each with Undo;
  - a shopping run across two pantries, and its Undo;
  - a stock check split with the flat, and its Undo;
  - an ask reaching the buyer's locked phone, the push opening the Home card, Approve with Always let, and the asker's push;
  - an unanswered ask reading Lapsed after 24 h.
- **Running low in the restock read** uses only the 20 % rule. The per-person "under one usual" half applies only on the Pantry (PN-3).
- **"Lasts about N days"** on running-low lines needs a use rate in the restock read; the line reads "600 g of 5 kg left" for now (PN-6).
- **Offline,** the service worker doesn't cache the restock read, so Finished this week is hidden (PN-6).
- **The new Pantry's search** is over the loaded items, not the server's search. It has one layout at every width; the desktop table stays in the old frame (PN-5).
- **Other amounts** are a stepper, with no typed amount (PN-5).
- **History after a raising stock check:** a reversal of a use logged before the raise is capped at what was bought, so its move can overstate what came back. The money is exact (PN-4).
- **Asks:**
  - history names the buyer as the approver, because moves don't record who approved (PN-9);
  - an approver who isn't an owner or admin can undo an approved ask only from the Home card, not from history (PN-9);
  - `toAnswer` returns at most 50 (PN-8);
  - several pending asks per person per item are allowed (PN-8);
  - an approved cook-session ask is the cook's own use, outside the dish's cost (risk PN-F).
- **PN-8's contract** had a "done when" line over Orunbase's 200-character limit, so it was never attached; PN-10 split the line and attached it.
