# kitchen-engine — architecture

Three modules, no I/O, no runtime dependencies:

- `money.ts` — integer minor units; largest-remainder splits (`splitByWeights`, `splitBy`), the cost of a use with the last-use remainder (`costOfUse`), `formatMinor`.
- `units.ts` — quantities as integer thousandths of a base unit (piece, gram, millilitre, pack); exact decimal parsing (`toMilli`), display units and formatting.
- `ledger.ts` — transaction builders (expense, use, ingredient take, dish, waste, settlement, reversal), `balances`, pairwise attribution (`pairLines`), the fewest-payments plan with its working (`settlePlan`) and the per-person view (`personView`).

kitchen-worker is the source of truth for every amount it stores; the console imports the same functions for live previews so both round identically. The rules are in `specs/epics/cookpool-kitchen/design.md` §2–§4.
