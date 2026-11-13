# tripeco (TR) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| TR0 — the spec | ✅ shipped | #169 |
| TR1 — vehicles, fuel, rides | 🟡 in review | this PR (TR-2) |
| TR2 — a ride posts to Spliteco | ⏳ planned | — |
| TR3 — odometer from a photo | ⏳ planned | — |
| TR4 — the Tripeco app | ⏳ planned | — |
| TR5 — drive and split | ⏳ planned | — |
| TR6 — rides in Spliteco | ⏳ planned | — |
| TR7 — close-out | ⏳ planned | — |

## TR1 as built (TR-2)

- **Migration 610 (`610_tripeco_drive`, context kitchen):** `tripeco_vehicles`, `tripeco_fuel_logs`, `tripeco_rides`, `tripeco_ride_riders`, `tripeco_ride_extras`, `tripeco_photos`. Ids are stored with their prefix. A CHECK ties `state = 'posted'` to `posted_txn_id`. Photos are one per role (`UNIQUE (ride_id, role)`), so a retake replaces the first.
- **The maths:** `@saas/kitchen-engine/drive`, covering the distance, cost, shares, learned mileage, last price and ₹/km. Shares are whole rupees by `splitByWeights`, so the spare rupee goes to the earliest rider with the largest remainder.
- **tripeco-worker** at `/v1/tripeco`:
  - `me`
  - vehicles: list, add, read, change, archive
  - fuel: log a fill-up, delete one
  - rides: list, start, read, change, discard
  - ride photos: attach, and read (owner only until TR-3)
  - `views.ts`'s `recompute` works out every number a ride stores.
- **api-edge:** `tripeco-facade.ts`, the `tripeco` rate-limit family, and the `TRIPECO_WORKER` binding. That binding is an enforced edge on main, so tripeco-worker exists before api-edge binds it. The edge also trusts the caller `tripeco-web`. Delegated tokens are refused.
- **Wire:** `@saas/contracts/tripeco`, `client.tripeco.*`.
- **Tests:** `tests/tripeco-worker` (26, on spliteco-worker's harness), `tests/db` `tripeco-migration`, `tests/api-edge` `tripeco-facade`.

### Departures

- **A rider's km "whole ride" is stored as 2,000 km** (`DRIVE_MAX_KM`) and clamped to the ride, so a rider follows the ride's length until someone moves their slider.
- **Log fuel answers `logged`** (the fill-up) beside the vehicle and its log, not `fuel`.
- **Photo roles are `start` and `end`** only. A Trip reset ride's one photo is its `end`.
- **Months are counted in India time** (UTC+5:30) for the Vehicle bar.
