# mcp-worker — architecture

One Worker that is both an OAuth 2.1 authorization server and the MCP
resource it protects, built on `@cloudflare/workers-oauth-provider` (1.2.4)
and the official MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.2,
`WebStandardStreamableHTTPServerTransport`, stateless, JSON responses).

## Routes

| Route | Owner | What |
|---|---|---|
| `GET /.well-known/oauth-authorization-server` | provider | RFC 8414 metadata: endpoints, `S256`, the four scopes |
| `GET /.well-known/oauth-protected-resource/mcp` | provider | RFC 9728 metadata for `${MCP_PUBLIC_ORIGIN}/mcp` |
| `POST /register` | provider | dynamic client registration (CIMD clients also accepted) |
| `POST /token` | provider | code and refresh exchange, revocation |
| `GET /authorize` | `src/connect.ts` | PKCE S256 required of every client; keeps the request 10 min in KV and sends the browser to `${CONSOLE_ORIGIN}/connect?req=<id>` |
| `GET /connect/request?req=` | `src/connect.ts` | what the console's consent page shows |
| `POST /connect/complete` | `src/connect.ts` | the person's session; `{ req, delegationId, token }` → `{ redirectTo }` |
| `POST /connect/deny` | `src/connect.ts` | the person's session; `{ req }` → `{ redirectTo }` (`access_denied`) |
| `POST /connect/disconnect` | `src/connect.ts` | the person's session; `{ delegationId }` → ends the grant and revokes the delegation |
| `POST /mcp` | `src/mcp.ts` | MCP; the tools listed are those the grant's scopes allow |
| `GET /health` | `src/index.ts` | liveness |

`/connect/*` answers CORS for `CONSOLE_ORIGIN` only, and refuses any other
browser origin. Shapes: `packages/contracts/src/mcp-connect.ts`.

## Trust

- **The delegated token** (`sps_dlg_…`, minted by identity-worker, MC-2) is
  kept only in the grant's `props`, which the provider encrypts with a key
  wrapped by the access/refresh token. Tokens and codes are stored as hashes.
- **Every tool** calls `API_EDGE` with that token as the bearer; api-edge
  resolves it to the person plus their scopes and enforces an allowlist. The
  worker's own scope filter (which tools are listed) is a convenience, not
  the boundary.
- **Consent** needs the person's own session (`sps_ses_…`), checked through
  api-edge (`GET /v1/auth/session`); the delegation must be theirs, live, for
  this client, and the token must be that delegation's.
- **Refresh**: when a refreshed grant's delegated token has under 45 days
  left, identity's internal `POST /v1/internal/delegations/refresh`
  (`IDENTITY_WORKER`, `x-internal-actor: mcp-worker`) rotates it; a gone
  delegation ends the grant (`invalid_grant`).

## Bindings

- `MCP_OAUTH_KV` — `infra/terraform/cloudflare-kv` `mcp_oauth`, wiring key
  `mcp_oauth_kv_id`. The library reads it as `OAUTH_KV` (aliased in `index.ts`).
- `API_EDGE` — `props: { caller: "mcp-worker" }`.
- `IDENTITY_WORKER` — delegated-token refresh only.
- Vars `CONSOLE_ORIGIN`, `MCP_PUBLIC_ORIGIN`.
