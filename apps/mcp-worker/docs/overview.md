# mcp-worker

Cloudflare Worker for the MCP server and its OAuth 2.1 authorization server (Cookpool MC-3)

Part of the cookpool runtime: a Cloudflare Worker deployed per environment (`stage`, `prod`; `dev` is verify-only). **Publicly routable on purpose**: it is the connector URL people add to their assistant (Claude, ChatGPT, Gemini), on its workers.dev host until the owner attaches `mcp.cookpool.store`.

- `https://cookpool-mcp-worker-stage.cookpool.workers.dev/mcp`
- `https://cookpool-mcp-worker-prod.cookpool.workers.dev/mcp`

It reads the person's pantry, recipes, shopping list and balances, sets kitchen timers and, with money.write, logs Spliteco expenses from a draft the person confirms, always through `api-edge` with the person's delegated token, so api-edge's scope allowlist decides what an assistant may do. No tool records a payment: settling up happens in an app.

## Depends on

- **cloudflare-kv** — Provisions Cloudflare KV namespaces (its `mcp_oauth` namespace is this worker's OAuth store)
- **policy-worker** — Cloudflare Worker for policy authorization decisions (its pre-deploy places binding stubs)
- **api-edge** — Cloudflare Worker for the API edge Runtime
- **identity-worker** — Cloudflare Worker for identity (delegated-token refresh only)

## Depended on by

- (none)
