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
