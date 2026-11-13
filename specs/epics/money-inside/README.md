# Epic: money-inside (MN)

**The Money tab in Cookpool and Tripeco is Spliteco itself: the same calm, group-first Spliteco screens in Spliteco's Deep ocean, with a small "‹ Cookpool" / "‹ Tripeco" pill back and the host's tab bar turned navy. One total, Settle up and + Expense, the groups as chips and rows, a group's people (Remind) and its three latest rows. Writing money (settle, an expense, the whole group) opens the Spliteco app.**

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped (2026-11-13) — #187, #188, #189, #190 and the close-out |
| Cluster | **MN** (MN0–MN4) |
| Owner(s) | `packages/spliteco-ui` (the shared tab), `apps/web-console-next` (Cookpool's Money), `apps/tripeco-web` (Tripeco's new Money tab), and their tests. No worker, route or migration changes. |
| Builds on | `cookpool-spliteco` (SE3 the shared package, the handoff), `spliteco-calm`, `tripeco` (TR-5 sign-in through Spliteco), `cookpool-kitchen-calm` (the calm look). |
| Decisions locked | (1) **Spliteco inside, not two copies**: one `SplitecoMoneyTab` in `@saas/spliteco-ui`, both hosts render it. (2) **Deep ocean whatever the host**, the one fixed look in the package (`inside-look.ts`). (3) **The host's tabs stay**, only recoloured navy with a gold Money tab: one tap back. (4) **Reads in the tab, writes in Spliteco**: settle and expenses open the Spliteco app (Cookpool by one-time code, Tripeco directly — it signed in through Spliteco). (5) **Tripeco gets a fourth tab**, Money; Groups (rides per group) stays. (6) The tab shows Spliteco's whole balance, not only the Kitchen part. |
| Design | Claude Design canvas: https://claude.ai/artifact/UKg7TpgfoHa4w9fssj7Fda ("Money, calmer — Cookpool and Tripeco", the B row) |
| Gate | MN2 and MN3 are the day stage shows the tab in each app. |

## Milestones at a glance

| Milestone | What lands | Done when |
|---|---|---|
| MN0 — the spec | this doc set and the contracts (MN-1) | merged |
| MN1 — the shared tab | `SplitecoMoneyTab`, its pure parts, the Deep ocean look (MN-2) | the package tests pass |
| MN2 — Cookpool's Money | `/money` renders it; the tab bar turns navy there (MN-3) | stage's Cookpool Money shows Spliteco inside |
| MN3 — Tripeco's Money | a fourth tab, `/money`, navy bar (MN-4) | stage's Tripeco Money shows Spliteco inside |
| MN4 — close-out | status and README (MN-5) | merged |
