# cloudflare-kv

Provisions Cloudflare KV namespaces for the api-edge idempotency replay store and mcp-worker's OAuth store (stage and prod)

Terraform-managed infrastructure for cookpool, per environment (`stage`, `prod`; `dev` is verify-only and provisions nothing).

## Depends on

- (none)

## Depended on by

- **api-edge** — Cloudflare Worker for the API edge Runtime
- **mcp-worker** — Cloudflare Worker for the MCP server and its OAuth 2.1 authorization server (Cookpool MC-3)
