# spliteco-web — runbook

- **Local**: run the dev API (`tests/spliteco-worker/src/dev-server.ts`, see its header) on :8787, then `pnpm --filter @saas/spliteco-web dev` (port 3002). `next dev` rewrites `/api/*` to `SPLITECO_DEV_API` (default http://localhost:8787).
- **Build**: `pnpm --filter @saas/spliteco-web build` (next build, then the OpenNext build into `.open-next/`).
- **Deployed**: https://cookpool-spliteco-web-stage.cookpool.workers.dev and the `-prod` host. The smoke checks the page names Spliteco and `/api/health` reaches api-edge over the binding.
- **`/api` answers 503 `api_edge_unbound`**: the deploy has no `API_EDGE` binding — CLOUDFLARE_ENV was not set to the environment.
- **Sign in**: email code. Google needs the app's origin in identity-worker's `OAUTH_ALLOWED_CONSOLE_ORIGINS`, then a build with `NEXT_PUBLIC_SPLITECO_GOOGLE=on`. Passkeys need it in `PASSKEY_ORIGINS` and are not offered yet.
