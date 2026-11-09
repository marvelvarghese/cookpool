# mcp-worker — runbook

## How it deploys

Merges to `main` converge automatically: CI plans changed components
(`orun plan --changed`) and runs this component's lane via
`orun run --remote-state` with credential-free OIDC auth. On main it waits
for `cloudflare-kv` (its namespace and wiring), `policy-worker` (binding
stubs) and `api-edge`. Failed lanes resume with `gh run rerun --failed`.

## Rollback

Revert the offending commit on `main`; the next convergence applies the
previous desired state. Grants and tokens in `MCP_OAUTH_KV` survive a
rollback; an assistant that can no longer use its grant is told to
reconnect.

## Verify

- `GET https://cookpool-mcp-worker-<env>.cookpool.workers.dev/health` → 200.
- `GET …/.well-known/oauth-authorization-server` names that origin as issuer.
- `POST …/mcp` without a token → 401 with a `resource_metadata` challenge.

Never connect a real assistant or create OAuth clients against stage or prod
from automation.

## Attaching the custom domain (owner)

1. Cloudflare dashboard → Workers → `cookpool-mcp-worker-prod` → Domains →
   add `mcp.cookpool.store` (and a stage name for `-stage` if wanted).
2. Change `MCP_PUBLIC_ORIGIN` for that environment in
   `wrangler.template.jsonc` to the new origin, and the pinned value in
   `tests/config-worker`, in one pull request. The issuer and resource move
   with it: assistants connected on the workers.dev URL must reconnect.

## Common failures

- **Missing `WIRING_CLOUDFLARE_KV_*` at deploy**: `cloudflare-kv` has not
  applied the `mcp_oauth` namespace yet — check that lane first.
- **Every tool says "Reconnect Cookpool"**: api-edge answers 401 for the
  delegated token — the person disconnected, or the delegation expired.
- **Every tool says "Cookpool didn't allow this"**: api-edge's scope
  allowlist (MC-2) refuses the route; check it lists the tool's path.
