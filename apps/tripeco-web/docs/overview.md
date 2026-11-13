# tripeco-web

The Tripeco app (tripeco TR-5) — split what the drive cost; Next.js 15 on Workers via OpenNext, its own address, install and Asphalt & lime theme, talking only to api-edge

Live per environment at `cookpool-tripeco-web-<env>.cookpool.workers.dev` (stage and prod; dev verifies only) until a domain is attached (risk TR-G). Signs in with your Spliteco account (Spliteco's `/handoff/out` hands back a one-time code) or the email code.

## Depends on

- **api-edge** — `/api/*` over the `API_EDGE` service binding: `/v1/tripeco/…` (vehicles, fuel, rides, posting), `/v1/spliteco/…` (your groups and their people), `/v1/kitchen/me/ai/odometer` (reading a photo), `/v1/auth/…` (sign-in, the handoff)

## Depended on by

- (none)
