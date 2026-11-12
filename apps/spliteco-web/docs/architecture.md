# spliteco-web — architecture

- **Pages** (`src/app`): static client pages — Home, Groups & friends, Group, Friend, Activity, Add expense (Who paid, Split, Itemized as views of one form), Expense, Move, Insights, Share & export, You, Sign in. Ids travel in the query string (`/group?id=org_…`), so every page prerenders.
- **The wire**: `@saas/sdk` (`client.spliteco.*`, `client.auth.*`, `client.memberships.*`) with a bearer token kept in `localStorage` (`spliteco.token`). The base URL is always `<origin>/api`.
- **The maths**: `@saas/kitchen-engine/splits` — the same functions spliteco-worker splits with — drives the "adds up" bar and keeps Save off until the split adds up.
- **The Worker** (`src/worker`): `/api/*` to api-edge over `API_EDGE` (props `{ caller: "spliteco-web" }`, so api-edge trusts the forwarded client address), everything else to OpenNext.
- **Pure logic** (`src/lib`): money parsing, the split form → request builder, itemized chips, activity text — tested in tests/spliteco-web.
