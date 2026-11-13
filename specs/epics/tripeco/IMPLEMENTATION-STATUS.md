# tripeco (TR) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| TR0 — the spec | ✅ shipped | #169 |
| TR1 — vehicles, fuel, rides | ✅ shipped | #170 |
| TR2 — a ride posts to Spliteco | ✅ shipped | #172 |
| TR3 — odometer from a photo | ✅ shipped | #175 |
| TR4 — the Tripeco app | ✅ shipped | #178 |
| TR5 — drive and split | ✅ shipped | #179 |
| TR6 — rides in Spliteco | 🟡 in review | this PR (TR-7) |
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

## TR3 as built (TR-4)

- **`POST /v1/kitchen/me/ai/odometer { image, mode? }`** returns `{ odometerKm, tripKm, averageKmPer }`, each null when it isn't shown. It runs on kitchen-worker's AI runner (`ai/odometer-task.ts`, `handlers/ai-odometer.ts`) with the receipt reader's photo check, switches, daily caps and budget. Usage is recorded under feature `receipt`, so a read counts as a receipt (AI_DAILY_RECEIPTS = 10 a day).
- **The model** is sent only the photo and one line: "Read the odometer.", or the trip line in Trip reset. The prompt tells it never to guess a digit and not to mistake range, speed or the clock for the odometer.
- **Checks:** the odometer at most 2,000,000 km, the trip at most 10,000 km and the average 0–100. They round to whole km, 0.1 km and 0.1 km per unit. With escalation off, the numbers that pass on their own are kept.
- **Wire:** `AiOdometerRequest` and `AiOdometerResponse` in `@saas/contracts/kitchen`, and `client.kitchen.aiOdometer(image, mode)`.
- **Tests:** `tests/kitchen-worker` `ai-odometer` (4); kitchen-worker 1,248 passing.

### Departures

- **No `odometer` usage feature of its own:** `kitchen_ai_usage.feature` is CHECK-constrained, and the design counts a read as a receipt anyway.

## TR4 as built (TR-5)

- **`apps/tripeco-web`** follows spliteco-web's build: Next.js 15 on Workers through OpenNext, and the `/api/*` forwarder with caller `tripeco-web`. It deploys as `cookpool-tripeco-web-<env>.cookpool.workers.dev`, and the smoke check wants "Tripeco" and `/api/health` over the binding.
  - **Look:** Asphalt & lime tokens on `:root` (`globals.css`), Plus Jakarta Sans, and Share Tech Mono via `@fontsource/share-tech-mono`.
  - **Tabs:** Home · Vehicles · Groups are one pager surface (`components/tab-surface.tsx`), with the tab bar as the tap twin, pull to refresh, and a re-read on return.
- **Home** (canvas Main):
  - the vehicle cards: mark, name, ₹/km and the month's fuel
  - the dots, Start trip and Log fuel
  - Needs you: Add the end km, or Post with Undo, which is a real unpost. When nothing waits it reads All caught up.
  - Recent rides, and an Account sheet with Sign out
- **Vehicles:** one row per vehicle, showing its mileage, Learned or Estimate, and ₹/km.
- **Groups** (canvas Groups): your Spliteco groups. Those with rides come first, with a count and your side of them. The others have a Ride button, and New opens Spliteco.
- **Sign in** (canvas SignIn): Continue with Spliteco, or Continue as Rahul once remembered on this device. It opens Spliteco's new `/handoff/out?to=<origin>&next=`, which mints a handoff code for exactly that origin (`lib/tripeco-link.ts`) and returns to `/handoff` here. If you're signed out there, Spliteco signs you in first and then continues. "Use another account" is the email code.
- **identity-worker:** `HANDOFF_ORIGINS` lists `cookpool-tripeco-web-<env>` beside Spliteco's host, in each environment only.
- **`packages/gestures` (`@saas/gestures`):** Spliteco's rules (`gestures`, `row-gestures`, `rules`) and React helpers (`react/*`) moved here, with git history kept. spliteco-web and its tests import them from the package (risk SL-A closed for Spliteco; Cookpool's console keeps its own copy).
- **Tests:** `tests/tripeco-web` (12), `tests/spliteco-web` 312 (with the new `tripeco-link`), `tests/identity-worker` handoff. `next build` prerenders all 9 pages.

### Departures

- **Home's vehicle cards scroll natively with snap points** under `data-no-pager`, not on a second `usePager`. Two pagers over one swipe fight, since both use the same rule. The dots are the tap twin; a swipe that starts on a card never turns the tab.
- **The Account face opens a sheet** (name, email, Sign out) rather than the canvas's link to Sign in.
- **Continue as Rahul needs one sign-in on the device first.** Before that it reads Continue with Spliteco: Tripeco can't know your name before you sign in.
- **The drive pages** (Scan, New ride, Split, Posted, Log fuel, Vehicle, Add vehicle, Group rides) arrive in TR5; until then those links 404.

## TR5 as built (TR-6)

- **Scan** (`/scan`, canvas ScanOdo):
  - **Start:** pick Odometer or Trip reset, then the shutter, which opens the camera input. Trip reset starts with "Reset done · start trip", with no photo.
  - **Each photo:** shrunk to 1280 px JPEG (≤ 390 KB, `lib/photo.ts`) and read by `aiOdometer`. The reading sheet shows the photo beside an editable number, plus "Car says 20.4 km/l" on a Trip A end. Retake · Use.
  - **Riding:** Trip on, the vehicle, and the start time and reading. Then "End trip · photo".
  - **Done:** the cost, km and litres, and the two readings. When the car showed its average, a Learned · Car display choice. Then Fix numbers or Split.
  - **Saving:** the ride is started on the server at the start photo, and the photos are attached as `start` and `end`.
- **Manual entry** (owner's ask): "Type km" beside the shutter opens the sheet without a photo. At the start, "Enter start and end" creates the ride and opens New ride with both readings to type.
- **New ride** (`/ride`, canvas NewRide):
  - a one-line name, the total and km, and Scan odometer
  - Start/End (or Trip A), ₹ per unit and mileage
  - Who rode: the group chip opens the group picker, and tapping a person's chip leaves them out (the owner too)
  - the split card (→ Split), and Post ₹X to the group, or Save as a solo drive
  - Numbers are worked out as you type (`lib/ride-draft.ts`, the same `@saas/kitchen-engine/drive`) and saved 500 ms after the last change (`lib/use-ride.ts`).
- **Split** (`/split`, canvas SplitHow): tap a name to leave them out, tap the km for a slider, + Toll · + Parking · + Wear (+ Wear only when the vehicle has a rate and it is off), and "Tap a name to leave them out" until the first tap.
- **Posted** (`/posted`, canvas Posted): the tick, "₹519 to Goa Trip", the row as it shows in Spliteco with who owes what, Open in Spliteco, Undo (a real unpost) or Post again, and Done.
- **Log fuel / Log charge** (`/fuel`, canvas LogFuel):
  - paid, quantity, the computed rate, the odometer, Full tank or Part fill
  - the mileage this fill-up makes, worked out live with `learnedMileage`
  - I paid · A rider paid
- **Vehicle** (`/vehicle`, canvas Vehicle):
  - the odometer, Real mileage or Estimate with segment bars, and ₹/km
  - the month split You · Riders, and the wear stepper in ₹0.5 steps
  - the fuel log, where a swipe left deletes a fill-up with an Undo held 4 s (`DelayedSends`), and ⋯ → Remove vehicle
- **Add vehicle** (`/vehicle/new`, canvas AddVehicle): Petrol · Diesel · CNG · Electric with the canvas's hints.
- **Group rides** (`/group`, canvas GroupRides): km and total, the Rides · Owed pager, Settle in Spliteco, and Ride for the group.
- **Also:** `/rides` lists every ride.
- **A local dev API** (`tests/tripeco-web/dev/dev-server.ts`): the real tripeco-worker and spliteco-worker over SQLite, seeded, with a stand-in odometer reader. Home, Sign in and Scan were clicked through in it at phone width.
- **Tests:** `tests/tripeco-web` 17, with the new `ride-draft`.

### Departures

- **The camera is the phone's own camera** (`<input capture>`), not a live viewfinder with a guide that reads as you aim. The frame shows the photo taken, and the reading follows the shot.
- **InSpliteco (the Spliteco ride row and sheet) is TR6.**

## TR6 as built (TR-7)

- **The row:** a lime car mark (`CategoryIcon` when `source.kind` is `tripeco`) and a lock before "Tripeco · You paid ₹939" (`billMeta`). There is no swipe to delete (`locked`).
- **Holding a ride** opens its sheet: the title and total, the line "124 km · Swift · 18.6 km/l · ₹104/L" (`lib/ride-view.ts`, plus wear, toll and parking when there were any), and the start and end photos from `GET /v1/tripeco/photos/{pho}`.
  - **Edit in Tripeco** is shown to the driver only and opens `/ride?id=` on this environment's Tripeco (`tripecoRideHref`).
  - **Comment** is shown to everyone.
- **The expense page** shows "From Tripeco · change it there" with the same proof, instead of Cookpool's line.
- **Fix:** Spliteco's `/handoff/out` (TR-5) 404'd on stage. spliteco-web's `.gitignore` ignored `out/` at any depth, so `src/app/handoff/out/page.tsx` was never committed. The pattern is now anchored (`/out/`), the page is committed, and a test pins both.
- **Tests:** `tests/spliteco-web` 317 (new `ride-row`, and the `.gitignore` guard in `tripeco-link`).

### Departures

- **Edit in Tripeco is the driver's only.** A rider sees the proof and Comment, since only the owner can change a ride.
- **The proof photos load as data URLs** through the SDK (the bearer token lives in `localStorage`, so an `<img src>` can't carry it).
