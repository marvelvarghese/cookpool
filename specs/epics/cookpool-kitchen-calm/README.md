# Epic: cookpool-kitchen-calm (KC)

**Kitchen gets the calm Home's look. Tick to pick stays, and each row's measure opens one Measure drawer where a new measure is added right there. Add item picks its unit from the same drawer. The item page drops the ring and its extra cards: whose it is and which group, how much is left on one line, three amounts and Other (in place of More), and Got more · Finished · Wasted.**

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped (2026-11-13) |
| Cluster | **KC** (KC0–KC4) |
| Owner(s) | `apps/web-console-next` (Kitchen, Add item, the item page), its tests in `tests/web-console-next`. No worker, route or migration changes. |
| Builds on | `cookpool-revamp` (RV-10/RV-13 tick to pick, RV-15 the item page, RV-14 black dark mode), `cookpool-pantry` (SM-13 measures, PN-5 the use sheet), `cookpool-home` (the calm look). |
| Decisions locked | (1) **Tick to pick and one Log stay.** (2) **One Measure drawer** for every unit pick in the Kitchen, with New measure in it. (3) **Other replaces More** on the item page; it opens the same use sheet. (4) **The owner chip** ("Asha's · Flat 4B") opens the group. (5) **Ring, Runs out card and Who had it card leave the item page**; the run-out goes on the level line, who had it is in History. (6) **Tokens only**, so dark is RV-14's black. |
| Design | Claude Design canvas: https://claude.ai/artifact/UKg7TpgfoHa4w9fssj7Fda ("Kitchen, calmer": `Kitchen`, `KitchenUnit`, `AddItem`, `UnitDrawer`, `NewMeasure`, `Item`, `ItemOther` and their `Dark` twins) |
| Gate | KC1–KC3 are the day stage shows each board in light and dark. |
| Shipped as | #171, #173, #176, #174, #177; round two (kitchen picker, shopping list, Paid by) #181, #182 and KC-8 |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What lands | Done when |
|---|---|---|
| KC0 — the spec | this doc set and the contracts (KC-1) | merged |
| KC1 — the Measure drawer on Kitchen | the drawer, the tick row's measure opens it, New measure saves and picks (KC-2) | stage's Kitchen opens the drawer from a row's measure |
| KC2 — Add item | the unit button and drawer, measures added with the item (KC-3) | stage's Add item has no unit chips; a measure added there is on the item |
| KC3 — the calm item page | owner chip, level line, Other, one actions card, Cook with it pill (KC-4) | stage's item page matches the board |
| KC4 — close-out | status and README (KC-5) | merged |
