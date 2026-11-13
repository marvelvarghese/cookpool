# Epic: cookpool-home (HM)

**Home says too much. This epic makes it calm, like Spliteco's: one header line (your face, "Hi, Rahul", the balance pill), four quick actions (Scan bill, Log use, Cook, Groceries), Needs you with three one-line rows and an "All caught up" line when there are none, and one Cook tonight card. Your groups' feed leaves Home for Kitchen. Light and the black dark theme both come from the existing tokens.**

## Status

| Field | Value |
|-------|-------|
| Status | 🟡 Planning |
| Cluster | **HM** (HM0–HM3) |
| Owner(s) | `apps/web-console-next` (Home and Kitchen), its tests in `tests/web-console-next`. No worker, route or migration changes. |
| Builds on | `cookpool-revamp` (RV-3, RV-14 black dark mode, RV-15 Needs you), `cookpool-recipes` (RC-2 the new frame, Cook now), `cookpool-ai` (receipt scan). |
| Changes | The new frame's Home (`NewHome`) only. Today's Home in prod is untouched until the new frame ships there. |
| Decisions locked | (1) **No date or summary line** in the header. (2) **Quick actions replace "What did you use?"**; Scan bill shows only when receipt scan is available. (3) **Needs you keeps its rows and Undo**; it gains an "All caught up" line instead of disappearing. (4) **One Cook tonight card**, not a carousel. (5) **"Your groups cooked" moves to Kitchen.** (6) **Tokens only**, so dark is the RV-14 black theme. |
| Design | Claude Design canvas: https://claude.ai/artifact/UKg7TpgfoHa4w9fssj7Fda (`Main`, `AllClear`, `Cooking` and their `Dark` twins) |
| Gate | HM1 is the day stage shows the calm Home in light and dark. |

## Read order

1. `design.md` — the page, top to bottom, and the alternative rejected
2. `implementation-plan.md` — the milestones and what "done" means
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What lands | Done when |
|---|---|---|
| HM0 — the spec | this doc set and the contracts (HM-1) | merged |
| HM1 — the calm Home | header, quick actions, Needs you's caught-up line, Cook tonight, no feed (HM-2) | stage's Home matches the boards in light and dark at phone width |
| HM2 — the feed on Kitchen | "Your groups cooked" under the Kitchen page (HM-3) | the feed shows on Kitchen on stage |
| HM3 — close-out | status and README (HM-4) | merged |
