# Epic: cookpool-mcp (MC)

**Let the assistant you already use, such as Gemini, Claude or ChatGPT, work with your Cookpool. It reads your pantry, recipes, shopping list and balances; it sets timers that ring on your phone; and it suggests uses and purchases that wait on Home for you to confirm. It never moves money on its own, and its AI costs Cookpool nothing.**

## Status

| Field | Value |
|-------|-------|
| Status | Draft: the design awaits the owner's approval; the server starts first |
| Cluster | **MC** (MC0–MC2, MC3 later) |
| Owner(s) | **Assistant tokens and scopes:** `apps/identity-worker`, `apps/api-edge`. **The MCP server and OAuth:** a new `apps/mcp-worker` with a new KV namespace (`infra/terraform/cloudflare-kv`). **Suggestions:** `apps/kitchen-worker`, `packages/db`, `packages/contracts`, `packages/sdk`. **Consent, Connected assistants, Home cards:** `apps/web-console-next`. |
| Builds on | `cookpool-pantry` (items, restock, purchases, uses), `cookpool-recipes` (recipes, cook now, scaling), `cookpool-guided` (server timers that push), the ledger (balances), `cookpool-sign-in` (sign-in). |
| Decisions locked | (1) **One standard connector:** MCP over Streamable HTTP with OAuth 2.1, PKCE and dynamic client registration, so any assistant can add it. (2) **A new worker, `mcp-worker`.** api-edge's hot path stays untouched. (3) **Assistants get a delegated user token** (`sps_dlg_…`), minted by identity-worker. It resolves as the user plus scopes, and **api-edge enforces the scopes**, so a leaked token still can't move money. (4) **Scopes:** `kitchen.read`, `money.read`, `timers.write`, `suggest.write`. The user turns each on or off on the consent page. (5) **Nothing that moves money happens directly.** A use or a purchase becomes a suggestion confirmed on Home, and suggestions expire after 24 h. (6) **Consent uses the user's own Cookpool sign-in** on a console page. (7) **Disconnect** revokes the grant and its tokens at once. (8) **Hostname:** the worker's workers.dev host first; the owner later attaches `mcp.cookpool.store` (and a stage name) in the Cloudflare dashboard, as with the console. (9) **Stage first.** |
| Design | Claude Design canvas, row "Your assistant, connected": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`McpConnect`, `McpConsent`, `McpProposal`). |
| Needs from the owner | Later, attaching the custom domain in the Cloudflare dashboard. Gemini's consumer "custom apps" may be limited by country and language, so availability depends on the account. |
| Cost | No AI cost: the user's assistant does the thinking. Only worker requests and KV. |
| Gate | MC1 is the day an assistant can read your kitchen and set a timer. MC2 is the day it can suggest, and you confirm. |
| Shipped as | |

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| MC0 — the spec | this doc set and its contracts | merged |
| MC1 — connect and read | delegated tokens with scopes, enforced at the edge; mcp-worker with OAuth and MCP tools for reading and timers; the consent page and Connected assistants | an MCP client adds the stage URL, the owner approves on the consent page, and the assistant lists the pantry and sets a timer that rings on the phone |
| MC2 — suggestions | suggestions in the server, MCP tools to propose uses and purchases, Home cards to confirm or discard | an assistant proposes "2 glasses of milk for me and Anu"; it waits on Home, and Confirm logs it with Undo |
| MC3 — live cooking (later) | the cook session kept in the server, so an assistant can drive it while the app shows each step | (its own spec) |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## After this epic

(Filled in by the close-out task.)
