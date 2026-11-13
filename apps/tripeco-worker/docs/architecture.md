# tripeco-worker — architecture

- **Its own tables.** `tripeco_vehicles`, `tripeco_fuel_logs`, `tripeco_rides` (with `tripeco_ride_riders` and `tripeco_ride_extras`) and `tripeco_photos` (migration 610), through `@saas/db/tripeco`. Every read is scoped by the caller's subject id; anything of anyone else's is the opaque 404.
- **The maths.** `@saas/kitchen-engine/drive`: the distance (odometer or Trip A), fuel = km ÷ mileage × price and wear = km × rate to the rupee, shares by km ridden (extras equally) with the largest-remainder rule in whole rupees, and the learned mileage — Σkm ÷ Σquantity over the last six full-tank segments, part fills counted. `views.ts`'s `recompute` is the one place a ride's numbers are worked out; every write stores what the view shows.
- **A ride's life.** `open` (no distance) → `done` (distance known) → `posted` (TR-3). A change to a posted ride bumps its `version`, so the view says `stale` until it is reposted.
- **No ledger.** Posting (TR-3) goes through spliteco-worker's own expense routes over `SPLITECO_WORKER`, with the actor api-edge resolved and `x-tripeco-ride`.
- **No assistants.** api-edge lists no delegation scope for `/v1/tripeco`; a delegated request that got here anyway is 403.
