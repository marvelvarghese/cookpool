# cookpool-mcp — design

The canvas row "Your assistant, connected" is the reference for the screens.

## 0. What exists

- **Auth is bearer-only.** Sessions are `sps_ses_<id>.<secret>`, kept hashed in identity-worker with a 30-day TTL. The console keeps the token in localStorage.
- **api-edge:** `resolve-actor.ts` calls identity's `/v1/auth/resolve`, caches the answer for 30 s, then forwards with `x-actor-*` headers (for example `kitchen-facade.ts`). kitchen-worker trusts those headers.
- **API keys** are org-scoped service principals. They can't act as a user.
- **There's no OAuth server and no MCP code** today.
- **KV:** one namespace, `IDEMPOTENCY_KV`, used by api-edge and provisioned by `infra/terraform/cloudflare-kv`.
- **Hostnames:** the console is on custom domains `stage.cookpool.store` and `cookpool.store`, attached by hand. api-edge is on workers.dev. Other workers have `workers_dev: false`.
- **Template for a wired worker:** `apps/events-worker` (`wrangler.template.jsonc` with `@@wiring@@` tokens and `wiring.fixture.json`), registered in `tests/config-worker/src/deployment-config.test.ts`.

## 1. Delegated tokens and scopes (MC-2)

**identity-worker** gains delegated tokens, a third bearer kind beside sessions and API keys.
- **Shape:** `sps_dlg_<id>.<secret>`, stored hashed in a new table, in migration **490** `490_identity_delegations`:
  - `identity_delegations`: `id`, `user_id`, `client_name` (≤ 80), `client_id` (the MCP client's id), `scopes` (a JSON array), `token_hash`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`.
  - Tokens last 90 days and are refreshable by the MCP server (§2).
- **`resolveBearer`** maps a live delegated token to `{ actorType: "user", actorId: usr_…, delegation: { id, scopes, clientName } }`.
- **Routes** (signed-in user session only; a delegated token may not call them):
  - `POST /v1/auth/delegations { requestId, scopes, clientName, clientId }` → `{ token }`;
  - `GET /v1/auth/delegations` lists the user's delegations;
  - `DELETE /v1/auth/delegations/{id}` revokes one;
  - `POST /v1/internal/delegations/refresh`, internal for mcp-worker, rotates a token.
- `last_used_at` is updated at most once an hour.

**api-edge** enforces scopes for a delegated actor. This is the security boundary: an allowlist by method and path, and anything else is 403 `forbidden` with `details.reason: "scope"`.

| Scope | Allows |
|---|---|
| `kitchen.read` | `GET` under `/v1/kitchen/me/` (pantries, items, search, restock, inbox, cook-now, recipes, match), `GET /v1/kitchen/recipes…` and `GET /v1/organizations/{org}/kitchen/items` |
| `money.read` | `GET /v1/kitchen/me/balances`, `GET /v1/kitchen/me/people/{usr}` and `GET …/kitchen/balances` |
| `timers.write` | `POST`/`GET`/`DELETE /v1/kitchen/me/timers…` |
| `suggest.write` | `POST /v1/kitchen/me/suggestions` (MC-5) |

A delegated token is never allowed auth or account routes, other writes, or admin routes. A test enumerates every write route and asserts it's refused.

## 2. The MCP server (MC-3)

**`apps/mcp-worker`** is a new worker, from the events-worker template.
- `workers_dev: true` for stage and prod, so it's reachable until the custom domain is attached.
- It uses `@cloudflare/workers-oauth-provider` for OAuth 2.1:
  - authorization server metadata at `/.well-known/oauth-authorization-server`, and protected resource metadata;
  - dynamic client registration at `/register`;
  - `/authorize`, `/token`, PKCE required.
- MCP is served over **Streamable HTTP** at `/mcp`, stateless, through the official MCP TypeScript SDK's server transport.
- **KV:** a new namespace, `MCP_OAUTH_KV`, holds clients, grants and tokens. It's added to `infra/terraform/cloudflare-kv` as `mcp_oauth_kv_id` and wired like api-edge's.
- **Service binding:** `API_EDGE`.

**Authorizing:**
1. The client opens `/authorize`.
2. mcp-worker stores the request and redirects to the console's `/connect?req=<id>` (MC-4).
3. The user, signed in, picks scopes and taps Allow.
4. The console calls identity `POST /v1/auth/delegations`, which mints the delegated token, then `POST {mcp}/connect/complete { req, delegationId }` with the user's session.
5. mcp-worker checks the session through API_EDGE, then completes the provider's authorization with props `{ delegatedToken, scopes }`, encrypted in the grant.
6. It redirects back to the client.

**Tools** call API_EDGE with the delegated token as the bearer. Each tool is listed only when its scope is granted, and each has a JSON schema and a short, honest description.

| Tool | Scope | Calls |
|---|---|---|
| `pantry_list` | read | `/me/items` (filters: pantry, soon, query) |
| `pantry_running_low` | read | `/me/restock` |
| `what_can_i_cook` | read | `/me/cook-now` |
| `recipe_get` | read | `/recipes/{id}?f=` (scaled) |
| `recipe_search` | read | `/recipes?q=` and `/me/recipes` |
| `shopping_list` | read | `/me/restock` (finished, running low, usual) |
| `balances` | money | `/me/balances` |
| `timer_start` | timers | `POST /me/timers` (label, minutes, ≤ 600) |
| `timer_list`, `timer_cancel` | timers | `GET`/`DELETE /me/timers` |
| `suggest_use` | suggest | MC-5 |
| `suggest_purchase` | suggest | MC-5 |

- **Results** are compact JSON plus a one-line text summary. Money is shown in the currency.
- **Errors** map to MCP tool errors with plain words.
- **Revocation:** disconnecting deletes the provider grant and revokes the delegation. A request with a revoked token is refused, within api-edge's 30 s actor cache.

## 3. Consent and Connected assistants (MC-4)

- **`/connect?req=`** is a static console page.
  - It requires sign-in, then returns to the page after sign-in.
  - It shows the client name and its four scope switches, all on by default except `money.read`, plus the never-moves-money note, Cancel and Allow.
  - Cancel tells mcp-worker to deny.
- **You → Connected assistants** (`/you/assistants`):
  - the connector URL for the environment, with Copy;
  - Gemini, Claude and ChatGPT tabs with short steps (no logos or brand styling);
  - the delegations list with client name, connected and last used times, and Disconnect;
  - the can and can't list.
- Both pages are new frame only.

## 4. Suggestions (MC-5 server, MC-6 app)

**Migration 500** `500_kitchen_suggestions` adds `kitchen_suggestions`:
- `sug_` id, `user_id`, `delegation_id`, `client_name`, `kind` (`use|purchase`), `payload` (JSON), `summary` (≤ 120);
- `state` (`pending|confirmed|discarded|expired`), `created_at`, `expires_at` (+24 h), `answered_at`, `result_ref`.

**Creating a suggestion:** `POST /v1/kitchen/me/suggestions { kind, payload }`, with a delegated token only.
- The payload is validated like the real write: a use is an item ref, quantity, unit or measure, and consumers; a purchase is lines shaped like PN-3's.
- At most 20 pending per user. It writes nothing else.

**The MCP tools:**
- `suggest_use` resolves item names through the read routes first, so the suggestion carries ids.
- `suggest_purchase` carries purchase lines.

**Answering** (user session only; a delegated token is refused):
- `GET /v1/kitchen/me/suggestions` lists them.
- `POST …/{sug}/confirm` performs the real write as the user, through the same handlers, so ask-first and every other rule applies. It returns its move or purchase for Undo.
- `POST …/{sug}/discard`.
- Expiry is read-side.

**Home:** the inbox gains `suggestions` (pending). Home shows "FROM YOUR ASSISTANT" cards with the summary, the lines, Discard and Confirm (Log it / Add to run), each with Undo.

## 5. Out of scope

- Live cooking driven by an assistant (MC3).
- Posting to Community.
- Groups and settings.
- Assistant-to-assistant calls.
- Notification-based confirmation.
