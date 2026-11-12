# Epic: cookpool-spliteco (SE)

**Cookpool knows who used what, but its money lives in a corner of a cooking app, and it can't split a trip, a dinner out or the rent. Spliteco is a Splitwise-style app for every shared cost — groups, friends, six ways to split, itemized bills, settling up — and it becomes the home of all of Cookpool's money. It is built inside Cookpool on the ledger Cookpool already has, so every kitchen is a Spliteco group from day one, one account works in both apps, and a Cookpool use still records its cost in the same write.**

Spliteco is for anyone who shares costs: flatmates, a trip, a dinner table. They add an expense, choose how it splits, see who owes whom, and settle up by UPI, cash or bank. Cookpool keeps its kitchens and their money — bills, balances and settling up stay in Cookpool's Money tab — and Spliteco shows the same kitchens with every pantry use and dish as a locked, itemized row, plus everything a kitchen doesn't need. Later, they can scan a bill, split it live at the table, or tell their AI assistant to log it.

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped (2026-11-12) |
| Cluster | **SE** (SE0–SE5) |
| Owner(s) | **The money API:** a new `apps/spliteco-worker` behind `apps/api-edge`. **The ledger:** `packages/db` (tables, statements) and `packages/kitchen-engine` (the maths), shared with `apps/kitchen-worker`. **The app:** a new `apps/spliteco-web`. **The wire:** `packages/contracts`, `packages/sdk`. **Groups:** `apps/membership-worker`. **Assistants:** `apps/mcp-worker`. |
| Builds on | `cirrus-baseline` (v27) — identity, membership, policy, notifications; `cookpool-kitchen` (the ledger: `kitchen_txns`, splits, settlements, the settle plan); `cookpool-ai` (receipt reading); `cookpool-mcp` (delegated tokens and the MCP server). |
| Changes | Adds an app, a worker and one migration (530). Cookpool keeps posting its own costs; in SE3 its Money tab is rebuilt on Spliteco's worker and shared screens, and gains "More in Spliteco". |
| Decisions locked | (1) **Inside Cookpool**, not a separate product. (2) **One ledger:** the tables and maths stay shared; Spliteco reads and writes them through `packages/db`. (3) **A group is a membership organization**; Spliteco-made groups are marked and hidden from Cookpool. (4) **Append-only:** edit, delete and move are reversals plus new entries. (5) **Cookpool keeps kitchen money** (two balances: Kitchen in both apps, Other in Spliteco only); settling up happens in either app, never from an assistant. (6) **One MCP server** for both apps; assistants may add and edit expenses but never record a payment. |
| Design | Claude Design canvas: https://claude.ai/artifact/SyrCkQEe95pwPdQTFkqLWH (21 screens, Deep ocean theme) |
| Needs from the owner | Later, a custom domain for the app. Each person enters their own UPI ID (SE2). |
| Cost | No new paid service. Receipt reading uses the existing `ANTHROPIC_API_KEY` (SE4). |
| Gate | SE1 is the day Spliteco opens with your groups and balances. SE3 is the day Cookpool's Money tab runs on it. |
| Shipped as | #115, #120, #122, #125, #131, #133 and the close-out; live at https://cookpool-spliteco-web-prod.cookpool.workers.dev |

## Read order

1. `design.md` — the model, the routes, the app, the decisions and the alternative rejected
2. `implementation-plan.md` — the milestones and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| SE0 — the spec | this doc set and the six contracts | merged |
| SE1 — groups, expenses, balances | spliteco-worker, migration 530, the Spliteco app | you sign in, see every group (kitchens too), add an expense six ways, and balances match Cookpool to the paisa |
| SE2 — settle up and reminders | UPI, cash and bank payments; "not received"; reminders; simplify debts | a UPI payment is recorded only after "I paid", and a reminder arrives at most once a day |
| SE3 — Cookpool's money runs on Spliteco | Cookpool's Money tab on spliteco-worker and shared screens; Kitchen and Other balances; More in Spliteco | a payment in either app shows in both, and Cookpool shows only the Kitchen balance |
| SE4 — bills from a photo, split together | receipt scan into an itemized draft; live split with a join code | a photo becomes a checked draft, and people at the table claim their items live |
| SE5 — your AI assistant logs splits | Spliteco tools on the MCP server, a `money.write` scope, the assistants page | an assistant drafts, saves, edits and moves an expense with your confirmation, and can't settle |
