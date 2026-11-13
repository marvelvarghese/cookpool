# tripeco-web — architecture

- **Pages** (`src/app`): static client pages. Home · Vehicles · Groups are one swipeable surface (`components/tab-surface.tsx`, `@saas/gestures`'s pager; the tab bar is the tap twin) at `/`, `/vehicles` and `/groups`. Sign in (`/sign-in`) and the handoff landing (`/handoff`). The drive pages arrive in TR-6. Ids travel in the query string (`/vehicle?id=veh_…`), so every page prerenders.
- **Sign in** (design §0.10): "Continue with Spliteco" (or "Continue as Rahul" once this device has seen you) opens Spliteco's `/handoff/out?to=<this origin>`; Spliteco mints a one-time code for exactly this origin and sends you to `/handoff?code=…`, which exchanges it for this app's own session. "Use another account" is the email code.
- **The wire**: `@saas/sdk` (`client.tripeco.*`, `client.spliteco.*`, `client.auth.*`) with a bearer token in `localStorage` (`tripeco.token`), base `<origin>/api`.
- **The Worker** (`src/worker`): `/api/*` to api-edge over `API_EDGE` (props `{ caller: "tripeco-web" }`, so api-edge trusts the forwarded client address), everything else to OpenNext.
- **Look**: Asphalt & lime in `src/app/globals.css` (tokens on `:root`), Plus Jakarta Sans and Share Tech Mono for odometer digits.
- **Gestures**: `@saas/gestures`, shared with spliteco-web. The vehicle cards on Home scroll natively with snap points under `data-no-pager`, so they never fight the tab pager.
