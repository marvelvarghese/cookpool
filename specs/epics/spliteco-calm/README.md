# Epic: spliteco-calm (SL)

**Spliteco works, but it says too much: rows carry sentences, cards carry borders, and every action is a button. This epic gives it the calmer look from the design canvas (row 7, "Say less, swipe more"): borderless Deep ocean cards, one line per row, numbers instead of sentences, a floating tab bar, and Cookpool's gestures — swipe between tabs and across rows, hold for actions, pull to refresh, swipe back from the edge, slide to pay — each with a tap twin. Add becomes keypad first, and every split method shows how each person's share is set and what is still left.**

## Status

| Field | Value |
|-------|-------|
| Status | In progress: design approved by the owner on 2026-11-13 |
| Cluster | **SL** (SL0–SL6) |
| Owner(s) | `apps/spliteco-web`, its tests in `tests/spliteco-web`. No worker, route or migration changes. |
| Builds on | `cookpool-spliteco` (EP-13, the app as shipped); `cookpool-revamp` (the look's rules) and `cookpool-app` PW-7/PW-8 (the gestures, `apps/web-console-next/src/lib/gestures.ts` and `row-gestures.ts`). |
| Changes | Restyles every Spliteco page and rebuilds Home, Groups, Activity, Group, Add, Itemized, Settle and Sign in to their boards. Behaviour and the API stay as built. |
| Decisions locked | (1) **Deep ocean stays**; Cookpool's rules come over, not its colours. (2) **Every gesture has a tap twin** — a gesture only makes something faster. (3) **Gestures are pure modules plus thin React**, no gesture library, as in Cookpool. (4) **+ and − on every amount**, so colour is never alone. (5) **One keypad** types into the amount or the selected person's field. (6) **Save waits until the split adds up**, and its label says what is missing. |
| Design | Claude Design canvas row 7: https://claude.ai/artifact/SyrCkQEe95pwPdQTFkqLWH (`V2SignIn`, `V2Home`, `V2Group`, `V2Add`, `V2Itemized`, `V2Settle`) |
| Gate | SL2 is the day stage swipes. SL4 is the day Add shows every share. |
| Shipped as | |

## Read order

1. `design.md` — the rules, the gestures, each page, and the alternative rejected
2. `implementation-plan.md` — the milestones and what "done" means
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What lands | Done when |
|---|---|---|
| SL0 — the spec | this doc set and the contracts | merged |
| SL1 — the calm foundation | tokens, type weights, borderless cards, floating tab bar, the gesture modules, Sign in | every page on stage has the new surfaces; Sign in matches `V2SignIn` |
| SL2 — Home, Groups, Activity | the tab pager, row swipe, hold sheet, pull to refresh | the gestures work on stage at phone width |
| SL3 — Group and expense | swipe to delete with Undo, hold sheet, Bills · Balances pager, edge back | as on `V2Group` |
| SL4 — Add and Itemized | keypad first, the method strip, a row per person for every method, the item carousel | as on `V2Add` and `V2Itemized` |
| SL5 — Settle | slide to pay | as on `V2Settle` |
| SL6 — close-out | status and README | merged |
