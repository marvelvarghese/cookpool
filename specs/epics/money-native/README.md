# Epic: money-native (MY)

**Cookpool's Money becomes a Cookpool page, not a window onto Spliteco: cream, herb green and Cookpool's own tab bar, with one 11px "Powered by Spliteco" line under the title and nowhere else. A Groups | People switch, one shared expanding button that grows into the Settle or Expense box, Add group (with "Start from Spliteco") and Manage group. Every page reads colour tokens and takes a `theme` prop, `cookpool` or `spliteco`, so the Spliteco app shows the same pages in Deep ocean — one set of pages, two looks.**

## Status

| Field | Value |
|-------|-------|
| Status | 📝 Planned (2026-11-14) — the spec PR (MY-1) only; nothing built |
| Cluster | **MY** (MY0–MY6, MY-1..MY-14) |
| Owner(s) | `packages/spliteco-ui` (tokens, the expanding button, Groups, People, Person), `apps/web-console-next` (the host: `/money`, settle and expense wiring, Add group, Manage group), `apps/spliteco-web` (takes the pages, MY-12), and their tests. No worker, route or migration changes are planned; the open questions in the risks may add one. |
| Builds on | `money-inside` (supersedes its "round two", MN-8, which was never built), `cookpool-spliteco` (SE3 shared package, the settle and balance logic), `cookpool-kitchen-calm` (the calm look and tab bar). |
| Decisions locked | Ten, from the owner's approval of 2026-11-14 — see [design.md](design.md). |
| Design | Claude Design canvas: https://claude.ai/artifact/UKg7TpgfoHa4w9fssj7Fda — Settle_Money, Money_People, Person_Dev, Money_AddGroup, Money_AddGroupFrom, Money_PickSpliteco, Group_Manage, Group_Waste, Settle_Custom, ExpandButton, Money_Ocean, Theme_Tokens, and the sticky "Money — what is decided". |
| Gate | MY4 is the day stage shows Money native; MY6 is the day the old screens go. |
| Open | Three questions the owner has not answered; see [risks](risks-and-open-questions.md). They do not block MY0–MY4. |

## Read in this order

[design.md](design.md) → [implementation-plan.md](implementation-plan.md) → [risks-and-open-questions.md](risks-and-open-questions.md) → [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md). The declaration is [epic.yaml](epic.yaml); task contracts are `tasks/MY-n.TaskContract.yaml`.

## Milestones at a glance

| Milestone | What lands | Done when (you can see) |
|---|---|---|
| MY0 — the spec | this doc set and the contracts (MY-1) | merged |
| MY1 — one look, one button | theme tokens and the `theme` prop (MY-2); the expanding button (MY-3) | the package tests pass; the button opens and closes, and fades with reduced motion |
| MY2 — the pages, read | Groups (MY-4); People and a person's page (MY-5) | both themes render real reads |
| MY3 — settle and expense | the settle box (MY-6); the expense box (MY-7) | a payment and an Equal and an Exact expense are recorded |
| MY4 — Cookpool's Money is native | `/money` mounts the pages, tab bar cream (MY-8) | stage's Money is cream, with no trip to Spliteco |
| MY5 — groups | Add group (MY-9); Start from Spliteco (MY-10); Manage group (MY-11) | a group is added, started from Spliteco, managed |
| MY6 — one set of pages, old Money out | the Spliteco app takes the pages (MY-12); old Money out (MY-13); close-out (MY-14) | Spliteco shows Deep ocean from the same pages; the old code is gone |
