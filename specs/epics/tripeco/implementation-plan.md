# tripeco — implementation plan

Each milestone is one task and one pull request on `orun/TR-k-<slug>`, with its contract in `tasks/TR-k.TaskContract.yaml`. One milestone is in flight at a time; each builds on the last one's merge. A milestone is marked ✅ here when its "done when" list is true, and recorded in `IMPLEMENTATION-STATUS.md`. Merges are squashes: every follow-up starts on a fresh branch from `main`. A change to a bundled package alone does not redeploy a worker, so every worker a package change affects gets its `component.yaml` touched.

## TR0 — the spec

- **TR-1:** this doc set and the eight contracts.

**Done when**
- the five documents and `tasks/TR-1..TR-8` are on `main`

## TR1 — vehicles, fuel, rides

- **TR-2** (design §1–§3): migration `610_tripeco` registered in `packages/db/src/manifest.ts`; `@saas/db/tripeco` (statements and reads); `@saas/kitchen-engine/drive` (km, cost, shares, learned mileage); `apps/tripeco-worker` (vehicles, fuel log, rides, photos, `GET /me`, group rides); api-edge's `/v1/tripeco` facade and `TRIPECO_WORKER` binding; `@saas/contracts/tripeco`; `client.tripeco.*` in `@saas/sdk`; `tests/tripeco-worker`.

**Done when**
- a vehicle, a fill-up and a ride round-trip through api-edge on stage
- two full tanks make the learned mileage, and a part fill counts toward the next full one
- every row is the owner's only (another account gets 404)

## TR2 — a ride posts to Spliteco

- **TR-3** (design §0.3, §0.4, §3): post, unpost and repost through spliteco-worker's routes with `x-tripeco-ride`; the `owned_by_tripeco` lock and `source` on the expense view; proof and group rides authorised by reading the group as the caller.

**Done when**
- a posted ride is one exact-split expense in the group and moves its balances
- Spliteco refuses to edit, delete or move it (409 `owned_by_tripeco`), Tripeco's unpost removes it and a repost edits it
- a member of the group reads the ride's proof; anyone else gets 404

## TR3 — odometer from a photo

- **TR-4** (design §4): the odometer task on kitchen-worker's AI runner at `POST /v1/kitchen/me/ai/odometer`, counted as a receipt; its contract types.

**Done when**
- a dashboard photo returns the odometer, and Trip A and the average when shown, writing nothing
- a photo with no odometer returns nulls, and the receipt cap applies

## TR4 — the Tripeco app

- **TR-5** (design §5, §0.10): `apps/tripeco-web` (Asphalt & lime, Plus Jakarta Sans, Share Tech Mono), `/api` to api-edge; `packages/gestures` with spliteco-web moved onto it; Sign in (Continue with Spliteco through a handoff Spliteco mints for Tripeco's origin; email code); identity-worker's origins for the Tripeco hosts; Home · Vehicles · Groups as one swipeable surface with the vehicle carousel.

**Done when**
- Tripeco opens on its stage URL and signs in with your Spliteco account in one tap from Spliteco
- Home, Vehicles and Groups swipe; vehicle cards swipe; Spliteco's gestures still pass their tests from the shared package

## TR5 — drive and split

- **TR-6** (design §0, §2, §5): Scan (start and end photos, Trip reset, Retake · Use, Learned · Car display), New ride, Split (tap to leave out, km slider, + Toll · + Parking · + Wear), Posted (Undo · Done · Open in Spliteco), Log fuel / Log charge, Vehicle (mileage bars, the month, wear stepper, fuel log with swipe to delete and Undo), Add vehicle, Groups, Group rides (Rides · Owed).

**Done when**
- a ride scanned at start and end, or with one Trip reset photo, posts its shares to a group, and Undo takes it back
- a fill-up logged full teaches the mileage the next ride uses
- every board on the canvas has its page, at phone width

## TR6 — rides in Spliteco

- **TR-7** (design §7): the ride row (car tile, lock, "Tripeco"), its sheet with the line and the photos, Edit in Tripeco, no swipe to delete.

**Done when**
- a ride row in a Spliteco group shows the car mark and lock and opens its photos
- Edit in Tripeco opens that ride in Tripeco on the same environment

## TR7 — close-out

- **TR-8:** `IMPLEMENTATION-STATUS.md` filled — every milestone with its PR, the departures, and what was and was not verified on stage (signed-in checks especially); the README's Status.

**Done when**
- the status file names each milestone's PR and what is still unverified
