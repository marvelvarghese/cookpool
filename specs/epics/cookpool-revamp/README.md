# Epic: cookpool-revamp (RV)

**Cookpool gets a calmer look: one Fresh green accent, a warm ground with borderless cards, the Outfit typeface at normal weights, and screens that say less. Each row is one line and one action, and Home, Pantry, Cook, Money, groups, You, Community and Sign in follow the same rules. This epic also fixes Finish so a dish can be finished without amounts.**

## Status

| Field | Value |
|-------|-------|
| Status | In progress: design approved by the owner on 2026-11-12 |
| Cluster | **RV** (RV0–RV3) |
| Owner(s) | `apps/web-console-next`. The Finish fix also touches `apps/kitchen-worker`. |
| Builds on | Every Cookpool epic's screens. `cookpool-spliteco` SE3 will later rebuild the Money tab on Spliteco; this epic changes only how Money looks. |
| Decisions locked | (1) **Light mode:** Fresh green `#167A4A`, ground `#FAF7F2`, white cards with a soft shadow and no borders. (2) **Dark mode:** Gold `#FACC15` with no orange; money you owe is pink. (3) **Type:** Outfit everywhere, self-hosted; Regular 400 for body text and Medium 500 for titles, buttons and tabs; nothing bolder; page titles at 26 px. (4) **Money colours:** blue for money back, orange (pink in dark) for money you owe, red only for expired. (5) **Rules on every page:** one line per row, numbers not sentences, at most one button per row, three items then See all, one main button. (6) **A floating tab bar.** (7) **The new look applies where `newFrame()` is true.** The sign-in screens are shared, so they change in every frame. |
| Design | Canvas rows "UI revamp — Home first" and "UI revamp — every page": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`HomeRevamp`, `HomeRevampDark`, `RvPantry`, `RvItem`, `RvCook`, `RvRecipe`, `RvCookStep`, `RvCooked`, `RvMoney`, `RvGroups`, `RvGroup`, `RvYou`, `RvCommunity`, `RvSignIn`) |
| Gate | RV1 is the day stage shows the new look on every main page. |
| Shipped as | |

## Milestones

| Milestone | What lands | Done when |
|---|---|---|
| RV0 — the spec | this doc set | merged |
| RV1 — the new look | the foundation (tokens, Outfit, weights, cards, tab bar, dark mode), then every main page, then the Finish fix | on stage every main page matches its board, at phone width, in light and dark |
| RV2 — close-out | status and README | merged |

## Read order

`design.md`, `implementation-plan.md`, `risks-and-open-questions.md`, `IMPLEMENTATION-STATUS.md`
