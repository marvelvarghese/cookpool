# cookpool-mcp (MC) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| MC0 — the spec | | |
| MC1 — connect and read | | |
| MC2 — suggestions | | |

## Departures from the design

Each task adds a section at the end, headed `### <milestone> — <title> (<KEY>)`.

### MC1 — Delegated tokens and scope enforcement (MC-2)

**Built.** A delegated token is a third bearer kind in identity-worker, and api-edge holds it to a scope allowlist.

- **Migration 490** `490_identity_delegations`: `identity_delegations` (`id`, `user_id` → `identity_users`, `client_name` 1–80, `client_id` 1–128, `scopes` a JSON array of at least one name, `token_hash`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`), indexed by `(user_id, created_at)`. Scope names are checked in code, not SQL.
- **Token:** `sps_dlg_<32 hex id>.<64 hex secret>`. Only the SHA-256 of the secret is stored; a token is resolved by primary key plus hash. It lasts 90 days. `last_used_at` moves at most once an hour (best-effort; the boundary is inclusive).
- **Contracts:** `@saas/contracts/delegations` (also re-exported from the index): `DELEGATION_SCOPES` = `kitchen.read`, `money.read`, `timers.write`, `suggest.write`; the request and response types; `DELEGATION_ERROR_REASONS`; and the header names. `ActorContext.delegation?` is added.
- **Routes** (identity-worker; the first three go through api-edge's auth facade):

  | Route | Body | Answer |
  |---|---|---|
  | `POST /v1/auth/delegations` | `{ scopes, clientName, clientId, requestId? }` | **201** `{ delegation, token }` |
  | `GET /v1/auth/delegations` | — | `{ delegations }`: live ones only, newest first, up to 100 |
  | `DELETE /v1/auth/delegations/{dlg}` | — | `{ id, revokedAt }`. Idempotent; someone else's or an unknown one is 404 |
  | `POST /v1/internal/delegations/refresh` | `{ delegationId }` | `{ delegation, token }`: a new secret and 90 more days, and the old token stops at once. Revoked or expired: 422 `precondition_failed` with reason `revoked` or `expired`. Unknown: 404. Bad id: 422 `validation_failed` |

  `delegation` is `{ id: "dlg_…", scopes, clientName, clientId, createdAt, expiresAt, lastUsedAt }`.
- **Session only.** The three `/v1/auth/delegations` routes need a signed-in session:
  - any other bearer (a delegated token or an API key) gets 403 `forbidden` with `details.reason: "session_required"`;
  - a missing, revoked or expired session gets 401.
- **Refresh callers.** The refresh route reads as 404 (before the method is checked) unless `x-internal-actor: mcp-worker`. api-edge routes nothing under `/v1/internal/`.
- **Security events:** `delegation.created`, `delegation.revoked` and `delegation.refreshed`. They carry the delegation id, never the token.
- **`resolveBearer`:** a live `sps_dlg_` token answers `{ actorType: "user", actorId: usr_…, email, displayName, user, delegation: { id, scopes, clientName } }`, with no `session`.
  - A revoked, expired, malformed or unknown token is `unauthenticated`.
  - It never falls through to the API-key lookup.
  - Sessions and API keys are unchanged.
- **api-edge** (`src/delegation-scopes.ts`) enforces the allowlist in two layers:
  1. **`index.ts`, before any facade.**
     - If the `Authorization` header mentions `sps_dlg_` (however it is spelled) and no scope allows the method and whole path, the answer is 403 `forbidden` with `details.reason: "scope"`. Identity is not called.
     - If some scope does allow it, the token is resolved there, so the scope check runs before idempotency replay.
  2. **`resolveActor`.** Every actor resolved with a `delegation` is checked against its own scopes, whichever facade asks.
     - The check runs on cache hits too: `delegation` is cached with the actor for the same 30 s.
     - It fails closed: a `sps_dlg_` token that resolves without a delegation, or a delegation on a non-user actor, gets 401.
     - Scopes the edge does not know are dropped.
- **Forwarded headers.** The kitchen facade forwards `x-actor-delegation-id` and `x-actor-scopes` (comma-separated) for a delegated actor only. It never forwards them for a session, even when the client sends its own.
- **Allowlist.** Each scope allows these methods and paths, matched whole:

  | Scope | Allows |
  |---|---|
  | `kitchen.read` | `GET /v1/kitchen/me/{pantries, items, items/itm_…, search, restock, cook-now, recipes, recipes/rcp_…/match}`, `GET /v1/kitchen/recipes`, `GET /v1/kitchen/recipes/{id}`, `GET /v1/organizations/{org}/kitchen/items` |
  | `kitchen.read` + `money.read` | `GET /v1/kitchen/me/inbox` |
  | `money.read` | `GET /v1/kitchen/me/balances`, `GET /v1/kitchen/me/people/usr_…`, `GET /v1/organizations/{org}/kitchen/balances` |
  | `timers.write` | `GET`/`POST /v1/kitchen/me/timers`, `DELETE /v1/kitchen/me/timers/tmr_…` |
  | `suggest.write` | `POST /v1/kitchen/me/suggestions` (the route is MC-5's) |

- **SDK:** `auth.delegations()`, `auth.createDelegation()`, `auth.revokeDelegation(id)`. `DELEGATION_SCOPES` and the delegation types are exported.

**Departures from the design**

1. **The inbox needs `money.read` as well as `kitchen.read`.** The design lists the inbox under `kitchen.read`, but it carries the payments the caller owes (`payment_due` with amounts). Under `kitchen.read` alone, an assistant with `money.read` switched off (the consent default) could read money. No MC-3 tool uses the inbox.
2. **"GET under `/v1/kitchen/me/`" is enumerated** to the resources the design names, not taken as a prefix:
   - Ids are matched by their prefix (`itm_`, `rcp_`, `usr_`, `tmr_`), so a fixed word kitchen-worker routes in an id's place (`/me/items/history`, `/me/recipes/copies`) is not allowed.
   - Not allowed: item moves, item history, dishes, usuals, asks, foods, always-have, profile, feed, activity, AI, a group item by id, and group activity.
   - `GET /v1/kitchen/recipes…` means `/recipes` and `/recipes/{id}` only.
3. **`POST /v1/auth/delegations` answers 201 `{ delegation, token }`**, not just `{ token }`, so the consent page (MC-4) has the delegation id for `/connect/complete`. `requestId` is accepted (a string up to 128) and not stored.
4. **`lastUsedAt` is on every delegation**, for Connected assistants. `DELETE` answers `{ id, revokedAt }` and is idempotent.
5. **New reasons:** `session_required` (403, delegation routes called with a non-session bearer), and `revoked` / `expired` (422, refresh). They ride on the pinned codes; no error code was added.
6. **Refresh** names its caller in `x-internal-actor` (`DELEGATION_INTERNAL_ACTORS = ["mcp-worker"]`). It refuses an expired delegation rather than reviving it: after 90 days without a refresh, the person reconnects.

**Tests**
- `tests/db`: 915 (11 new: `identity-delegations-migration.test.ts`). The `280_identity_login_attempts` order pin now expects `490_identity_delegations` as the next identity migration.
- `tests/identity-worker`: 227 (29 new in `delegations.test.ts` and `delegations-resolve.test.ts`). They cover:
  - create, list and revoke, with field errors;
  - hashing: the secret appears nowhere stored;
  - delegated tokens and API keys refused on all three routes;
  - expiry at exactly 90 days;
  - the resolve shape, and no fall-through to API keys;
  - the hourly `lastUsedAt`;
  - refresh: rotation, revoked, expired, unknown, and the caller check;
  - the router.
- `tests/api-edge`: 624 (20 new).
  - `delegation-routes.test.ts` reads kitchen-worker's route tables (`router.ts`, `community-routes.ts`, `ai-routes.ts`) and every `*-facade.ts` path and pattern from source. A completeness check requires every facade pattern to have a sample.
  - It sends every path with all five methods, using a token holding all four scopes. Everything outside the pinned allowlist is 403 `scope`, with no identity or worker call. The allowed list, including its only three writes, is pinned.
  - `delegation-scopes.test.ts` covers:
    - each scope alone, and `money.read` gating;
    - the auth, org, billing and notification routes;
    - the forwarded headers;
    - the `resolveActor` layer and failing closed;
    - a revoked token: it works from the cache for at most 30 s, then is refused (with an in-memory Cache API).
- `tests/contracts`: 315 (6 new). `packages/sdk`: 223 (5 new). `tests/config-worker`: 335, unchanged.

**Follow-ups and deploy notes**
- **MC-3 needs an `IDENTITY_WORKER` service binding** on mcp-worker to call refresh, since api-edge does not route `/v1/internal/`. It sends `x-internal-actor: mcp-worker`. Refresh rotates the token, so mcp-worker must store the new one in the grant's props; the old one stops at once.
- **Disconnect** takes effect within api-edge's 30 s actor cache, as designed. The revoker holds a session, not the delegated token, so the edge cannot evict the token's cache entry.
- **Delegated requests resolve twice** (the gate, then the facade). In production the second is a Cache API hit. Sessions' hot path is unchanged.
- **Deploy order.** Migration 490 is additive. identity-worker and api-edge change in their own paths, so both deploy. db-migrate applies 490 first on merge. kitchen-worker needs no redeploy: it ignores the new headers until MC-5 reads them.
- **No cap on live delegations per person** (the list answers at most 100). Add one if abuse shows.

### MC1 — The MCP server (MC-3)

**What shipped.** `apps/mcp-worker` (`@saas/mcp-worker`, component `mcp-worker`): one Worker that is the OAuth 2.1 authorization server and the MCP resource it protects, with `@cloudflare/workers-oauth-provider` **1.2.4**, `@modelcontextprotocol/sdk` **1.32.2** (`WebStandardStreamableHTTPServerTransport`, stateless, JSON responses), `zod` **4.6.7** and `@cfworker/json-schema` **4.1.1** (the SDK's Ajv validator compiles with `new Function`, which Workers forbid), all pinned exactly.

**Feasibility (risk MC-E): closed.** `wrangler deploy --dry-run` bundles it (1.84 MiB, 321 KiB gzip). Before building the tools, a throwaway build ran in local workerd (`wrangler dev`, local KV only) through metadata → DCR → PKCE authorize → token → 401 challenge → `initialize`/`tools/list`/`tools/call`, with the grant's props reaching the tool.

**Hosts and config** (`wrangler.template.jsonc`):
- `workers_dev: true` on **stage and prod** (the only public worker besides api-edge and the console): `https://cookpool-mcp-worker-stage.cookpool.workers.dev`, `https://cookpool-mcp-worker-prod.cookpool.workers.dev`. The connector URL is `<that>/mcp`.
- Vars: `CONSOLE_ORIGIN` (stage `https://stage.cookpool.store`, prod `https://cookpool.store`), `MCP_PUBLIC_ORIGIN` (the workers.dev origin above; issuer, endpoints and resource `${MCP_PUBLIC_ORIGIN}/mcp` are built from it).
- `MCP_OAUTH_KV` ← `infra/terraform/cloudflare-kv` `cloudflare_workers_kv_namespace.mcp_oauth` (title `${namespacePrefix}${repo}-mcp-oauth-${env}`, adopted like the idempotency namespace), wiring key `mcp_oauth_kv_id` (+ `mcp_oauth_kv_title`) in the same `WIRING_CLOUDFLARE_KV` document.
- `API_EDGE` (`props: { caller: "mcp-worker" }`) and `IDENTITY_WORKER` (refresh only). Compat flags `nodejs_compat`, `global_fetch_strictly_public` (CIMD fetches).
- `component.yaml`: enforced-on-main `cloudflare-kv`, `policy-worker`, `api-edge`; advisory `identity-worker`; `secretEnv` `WIRING_CLOUDFLARE_KV_STAGE/PROD`; `wiringComponents: "cloudflare-kv"`.

**Routes** (shapes in `packages/contracts/src/mcp-connect.ts`, new export `@saas/contracts/mcp-connect`; envelopes `{ data, meta }` / `{ error: { code, message, details } }`):

| Route | Auth | Shape |
|---|---|---|
| `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource/mcp` | none | provider; `code_challenge_methods_supported: ["S256"]`, `scopes_supported` = the four scopes |
| `POST /register` | none | RFC 7591 DCR (provider). CIMD clients (ChatGPT) also accepted |
| `POST /token` | client | code / refresh exchange, revocation (provider). Access tokens 1 h; grant 30 days, sliding 30 days on refresh |
| `GET /authorize` | none | PKCE **S256 required of every client** (else redirect `error=invalid_request`); untrusted client/redirect → 400 page, never a redirect. Stores the request 600 s in KV (`cookpool:connect:<req>`, 43-char random id) → **302 `${CONSOLE_ORIGIN}/connect?req=<id>`** |
| `GET /connect/request?req=` | none | 200 `{ req, clientId, clientName, clientDomain: string\|null, redirectHost, redirectIsLoopback, requestedScopes: AssistantScope[], expiresAt }`; gone → **404 `not_found`, `details.reason: "expired"`** |
| `POST /connect/complete` | **session bearer** (`sps_ses_…` only) | `{ req, delegationId, token }` → 200 `{ redirectTo }`. 401 no/bad session; 403 `forbidden` `reason: "delegated"` for a delegated token; 422 fields `req`/`delegationId`/`token`; 404 `reason: "expired"` / `reason: "delegation"`; 412 if the provider refuses the stored request |
| `POST /connect/deny` | **session bearer** | `{ req }` → 200 `{ redirectTo }` (`error=access_denied`, `state`, `iss`); 404 `reason: "expired"` |
| `POST /connect/disconnect` | **session bearer** | `{ delegationId }` → 200 `{ revokedGrants, delegationRevoked }` |
| `POST /mcp` | OAuth access token | MCP Streamable HTTP, stateless; 401 + `WWW-Authenticate … resource_metadata=` without one |
| `GET /health` | none | `{ status, service, environment, checks }` |

`/connect/*` sends CORS only for `CONSOLE_ORIGIN` (methods GET, POST, OPTIONS; headers authorization, content-type, x-request-id) and refuses any other browser `Origin` with 403 `reason: "origin"`.

**Completing consent.** The session is checked through api-edge (`GET /v1/auth/session` → `data.user.id`); the delegation must appear in the caller's `GET /v1/auth/delegations`, be live, have `clientId` equal to the OAuth client's, and the token's id part must be the delegation's (`sps_dlg_<hex>.…` ↔ `dlg_<hex>`). Scopes come from **identity's record**, not the client's request. The pending request is deleted before `completeAuthorization`, with props `{ delegatedToken, scopes, delegationId, delegatedExpiresAt }` (encrypted by the provider) and metadata `{ delegationId, clientName }` (in the clear, so Disconnect can find it). A reconnect of the same client replaces the old grant (provider default) and revokes the old grant's delegation.

**Refresh.** On a refresh-token exchange, when the delegated token has under 45 days left, `POST identity /v1/internal/delegations/refresh { delegationId }` over `IDENTITY_WORKER` with `x-internal-actor: mcp-worker` → `{ delegation, token }`; the new token and `delegation.expiresAt` replace the grant's props (the old token dies at once). 404 or any other 4xx (MC-2's 422 `precondition_failed` revoked/expired) → `invalid_grant`, which deletes the grant; 5xx → `temporarily_unavailable`, grant kept.

**Tools** (listed only when the grant's scopes, narrowed by the access token's, include theirs; each calls api-edge with `Authorization: Bearer <delegatedToken>`; writes carry `Idempotency-Key: mcp_<random>` and are retried once, same key, on 503/no answer; each answers two text blocks: a one-line summary and compact JSON):

| Tool | Scope | Calls |
|---|---|---|
| `pantry_list { pantry?: "all"\|"personal"\|org_…, soon?, query?, limit? 1–100 }` | kitchen.read | `GET /v1/kitchen/me/items?pantry=&filter=soon&q=&limit=` (default all, 50) |
| `pantry_running_low {}` | kitchen.read | `GET /v1/kitchen/me/restock` → `runningLow` |
| `what_can_i_cook {}` | kitchen.read | `GET /v1/kitchen/me/cook-now` |
| `recipe_get { recipeId: rcp_…, serves? 0.5–100, factor? 0.01–20 }` | kitchen.read | `GET /v1/kitchen/recipes/{id}` (`?f=<milli>` when `factor` is given); lines scaled here with `scaleLine`/`scalePortions` |
| `recipe_search { query? }` | kitchen.read | `GET /v1/kitchen/me/recipes` (name filtered here) + `GET /v1/kitchen/recipes?source=cookpool&q=` + `…source=groups&q=`; ≤ 25 rows |
| `shopping_list {}` | kitchen.read | `GET /v1/kitchen/me/restock` (finished, running low, usual, last price) |
| `balances {}` | money.read | `GET /v1/kitchen/me/balances`; money as `₹1,200.00` (kitchen-engine `formatMinor`) |
| `timer_start { label 1–60, minutes 1–600, note? ≤120 }` | timers.write | `POST /v1/kitchen/me/timers { label, endsAt: now+minutes, body? }` |
| `timer_list {}` | timers.write | `GET /v1/kitchen/me/timers` |
| `timer_cancel { timerId: tmr_… }` | timers.write | `DELETE /v1/kitchen/me/timers/{id}` |

`suggest.write` lists no tools yet (`suggest_use`/`suggest_purchase` are MC-5's); `tools/list` still answers `[]`. Errors become `isError` results in plain words: 401 → "Reconnect Cookpool: …"; 403 `reason: "scope"` → "Cookpool didn't allow this. The person can allow it …"; other 403 → "Cookpool didn't allow this."; 404 → "couldn't find that"; 422 `too_many_timers` → "already N timers running"; 422 fields → "couldn't accept that. field: …"; 429 → "Try again in a minute"; 5xx / unreachable → "isn't answering right now".

**Tests.**
- `tests/mcp-worker` (new, `mcp-worker-tests`): **63** — `oauth.test.ts` 22 (metadata, 401 challenge, DCR, authorize → console, PKCE required for a confidential client and `plain` refused, untrusted redirect rendered not redirected, expired req, the full register → authorize → complete → token → MCP call with the delegated token reaching the edge, the token absent from KV in the clear, wrong verifier, session rules incl. delegated token and API key, every delegation check, single use, scopes from identity, reconnect revokes the old delegation, deny, CORS, disconnect and its user scoping); `tools.test.ts` 35 (listing per scope set, unlisted tool never reaches the edge, schemas and annotations, each tool's exact edge call and answer, input bounds, write retry with the same key, every error mapping, revocation → "Reconnect"); `refresh.test.ts` 6 (no rotation far from expiry, rotation with `x-internal-actor` and the new token used next, three "gone" answers delete the grant, 5xx keeps it). In-memory KV and fake api-edge/identity only.
- `tests/config-worker`: **350** (+15 for mcp-worker: name and compat flags, no committed IDs, `workers_dev: true`, KV wiring token and render, exact bindings with caller props, vars per env, dev bare, terraform resource and wiring key, deploy order and secretEnv).
- `tests/contracts` 309, `tests/api-edge` 604 (after `wire:fixture`), unchanged and green. Typecheck and lint clean for `@saas/mcp-worker`, `@saas/mcp-worker-tests`, `@saas/contracts`, `@saas/config-worker-tests`. `orun task check MC-3`: affects ok.

**Departures and additions.**
- **KV binding name:** the design's `MCP_OAUTH_KV` is kept; the library hard-codes `env.OAUTH_KV`, so `index.ts` passes it an env with `OAUTH_KV` aliased to `MCP_OAUTH_KV`.
- **`IDENTITY_WORKER` binding** added for refresh: api-edge never routes `/v1/internal/`, and adding such a route would widen the public edge. mcp-worker sends only that one call on it.
- **`GET /connect/request`** and **`POST /connect/disconnect`** are added (the console page needs the first; the second does design §2's "disconnecting deletes the provider grant and revokes the delegation" in one call). MC-4 may still revoke through identity directly; the grant then dies at its next refresh or fails with "Reconnect".
- **`/connect/deny` requires the session**, as the console's contract asks.
- **CIMD enabled** beside DCR: the MCP 2026-07-28 spec prefers it and ChatGPT uses it.
- **PKCE for every client**, stricter than the provider's public-clients-only rule.
- **`recipe_get`:** `?f=` only moves the learned step times (GC-7); amounts are scaled in the worker with contracts' `scaleLine`, as the app does. **`recipe_search`** leaves out Explore's `public` source (strangers' recipes; risk MC-B).
- **Scopes list** lives in `@saas/contracts/mcp-connect` as `ASSISTANT_SCOPES` (same four, same order) because MC-2's `@saas/contracts/delegations` (`DELEGATION_SCOPES`) is not on main yet.

**Needed from MC-2 that the design didn't pin** (all match MC-2's branch as read on 2026-11-09): the token's id part equals the delegation id's hex; `GET /v1/auth/delegations` → `{ delegations: [{ id, clientId, scopes, expiresAt, … }] }` (live ones only); `DELETE /v1/auth/delegations/{id}`; refresh `{ delegationId }` + `x-internal-actor: mcp-worker` → `{ delegation, token }`; api-edge must route `/v1/auth/delegations…` and answer `GET /v1/auth/session` for a session bearer.

**What the owner must do later.**
1. Nothing before the first deploy: the merge applies `cloudflare-kv` (new namespace), then deploys mcp-worker on stage and prod. **MC-2 must be deployed before assistants are pointed at it** (until then tools answer "Reconnect"/"didn't allow").
2. **Attach `mcp.cookpool.store`** (and a stage name if wanted) in the Cloudflare dashboard to `cookpool-mcp-worker-prod`; then, in one PR, set that environment's `MCP_PUBLIC_ORIGIN` to it and update the pinned value in `tests/config-worker`. Until then the connector URL is `https://cookpool-mcp-worker-<env>.cookpool.workers.dev/mcp`. Assistants connected on the old host reconnect once.

**Follow-ups.**
- Swap `ASSISTANT_SCOPES` for `DELEGATION_SCOPES` once MC-2 is on main (or make one re-export the other).
- Every path the tools call is on MC-2's api-edge allowlist (`apps/api-edge/src/delegation-scopes.ts` on its branch, checked 2026-11-09). A new tool needs its path there first.
- No cron runs `purgeExpiredData()`; KV TTLs remove records, so it is optional.
- `apps/identity-worker/docs/overview.md` doesn't list mcp-worker under "Depended on by" (outside this contract).
