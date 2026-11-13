# tripeco (TR) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| TR0 — the spec | ✅ shipped | #169 |
| TR1 — vehicles, fuel, rides | ✅ shipped | #170 |
| TR2 — a ride posts to Spliteco | 🟡 in review | this PR (TR-3) |
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

## TR2 as built (TR-3)

- **Posting:** `POST /v1/tripeco/rides/{trp}/post` sends spliteco-worker's own `POST /groups/{org}/expenses` over `SPLITECO_WORKER`, as the caller, with `x-tripeco-ride`. The expense is an exact split: the owner paid the total, and each rider who is on owes their share. Category transport, currency INR. The idempotency key is `trp_…_v<version>_<org>`.
  - A change after posting bumps the ride's version, and the ride reads `stale` until it is reposted.
  - A repost to the same group is Spliteco's `PUT` (an edit). A repost to another group is a delete there, then an add here.
  - `unpost` is Spliteco's `DELETE`.
  - Spliteco's refusals (`not_in_group`, `currency_mismatch`, 404) come back unchanged.
- **The lock (spliteco-worker):** `resolveActor` reads `x-tripeco-ride` (`trp_` + 32 hex), ignored on a delegated request. `versionOf` stamps `source_kind = 'tripeco'` and `source_id`. `loadWritable` refuses a mismatch either way with 409 `owned_by_tripeco`: a ride row without its own header, or an ordinary bill with any ride header. The summary gains `source` and reads `locked: true`. Comments stay open.
- **The group's view:**
  - `GET /rides/{trp}/proof` and `GET /photos/{pho}` answer the owner, or a member of the group the ride posted to. Membership is checked by reading the group from spliteco-worker as the caller.
  - `GET /groups/{org}/rides` lists that group's posted rides with km, total and each person's summed shares.
- **Tests:** `tests/tripeco-worker` 32, with the posting suite on the real spliteco-worker over the same SQLite. `tests/spliteco-worker` 127 and `tests/spliteco-web` 308 are unchanged and pass.

### Departures

- **`source` is optional on `SplitecoExpenseSummary`**, so existing fixtures stay valid; spliteco-worker always sends it.
- **Moving a posted ride to another group is unpost-then-post**, not Spliteco's move, because the lock refuses Spliteco's move for every caller.
