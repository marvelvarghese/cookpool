# tripeco — design

Tripeco works out what a shared drive cost and hands the shares to Spliteco. The owner of the car photographs the odometer at the start and the end (or resets Trip A and photographs it once at the end); Tripeco reads the numbers, multiplies the kilometres by what the car really burns and what fuel cost at the last fill-up, adds tolls, parking and wear if any, splits it among the people who rode, and posts it into one of the owner's Spliteco groups. The canvas (https://claude.ai/artifact/84RAnUdxVzyQnVXj5AUBzC, 12 boards) is the source of truth for every screen.

## 0. Decisions, each with its why

1. **No ledger.** A posted ride is an expense in a Spliteco group — one row, the owner paid, each rider owes their share. Balances, reminders and settling up exist only in Spliteco, so there is never a second number to reconcile.
2. **No groups of its own.** Tripeco lists the groups you have in Spliteco (`GET /v1/spliteco/me/groups`) and their people; "New" opens Spliteco. A Cookpool kitchen works too — it is a Spliteco group (bucket `other`).
3. **A ride posts through spliteco-worker, not around it.** tripeco-worker calls spliteco-worker's own add, edit and delete routes over a service binding, with the actor api-edge resolved and one extra header, `x-tripeco-ride: trp_…`. So membership, policy, the split check, the currency guard, idempotency and the "expense for you" notification are Spliteco's, once. *Rejected:* writing ledger rows directly from tripeco-worker the way kitchen-worker does — it would copy spliteco-worker's membership, policy and notification code a second time.
4. **Ride rows are locked by `source_kind = 'tripeco'`.** The row is `app = 'spliteco'`, `bucket = 'other'`, `category = 'transport'`, `source_kind = 'tripeco'`, `source_id = trp_…`. spliteco-worker refuses edit, delete, restore and move of such a row with 409 `owned_by_tripeco` unless the request carries the matching `x-tripeco-ride` — a header api-edge never forwards, so only tripeco-worker can send it. Comments stay open. *Rejected:* a new `app = 'tripeco'` value: `kitchen_txns.app` has a CHECK constraint, and changing it means rebuilding the ledger's main table on D1, which has no interactive transactions.
5. **Mileage is learned from full tanks.** A full fill-up closes a segment: the kilometres since the previous full fill-up, over everything put in since then (part fills included). The vehicle's mileage is Σkm ÷ Σlitres over its last six segments. Until there is one segment, the figure typed in Add vehicle is used. A Trip reset end photo may also read the car's own average; the ride then offers Learned or Car display, Learned selected. *Departure from the canvas:* LogFuel's "average becomes (was × 5 + new) ÷ 6" — a weighted mean of segment figures over-counts short segments; Σkm ÷ Σlitres is the honest average.
6. **Fuel price comes from the last fill-up** (amount ÷ quantity of the newest fill-up of that vehicle), else the price typed in Add vehicle. No live price feed. The ride keeps the price it used.
7. **Odometer, not GPS.** A reading is a photo read by the model and checked by the person (Retake · Use), or typed. **Typing is a first-class path** (owner, 2026-11-13): Scan has "Type km" beside the shutter, "Enter start and end" opens New ride with both readings to type (a past trip, no camera), and every number on New ride stays editable.
8. **Whole rupees.** A ride's fuel and wear are rounded to the rupee; shares are whole rupees by Cookpool's largest-remainder rule (`@saas/kitchen-engine`), so the shares always add up to the total.
9. **Personal fuel never leaves Tripeco.** Fill-ups, the fuel log and the monthly spend are the owner's only. "A rider paid" on a fill-up is a tag for the monthly You/Riders bar, not a payment — paying for a fill-up is settled in Spliteco like anything else.
10. **One account.** Tripeco signs in through Spliteco: "Continue with Spliteco" (or "Continue as Rahul" once this device has seen you) opens Spliteco, which hands back a one-time code for Tripeco's exact origin (the SE-4 handoff). "Use another account" signs in with the email code, as Spliteco does.
11. **Copy is one line per row.** No helper paragraphs, as on the canvas. The only sentence is the "Tap a name to leave them out" hint, until the first tap.
12. **Petrol, diesel, CNG, electric.** Units follow the fuel: litres (km/l, ₹/litre), kilograms (km/kg, ₹/kg), kWh (km/kWh, ₹/kWh; "Log charge", "Charged to 100%").

### Product calls argued (owner's call recorded here)

- **A ride needs a name.** The canvas's New ride has none, but the Spliteco row must say something: one line, "Where to?", defaulting to "Swift · 124 km". *(Better than an unnamed row in someone's bills.)*
- **Wear is on by default when the vehicle has a rate.** The canvas's Split opens with wear off even though Vehicle sets ₹2/km and says "Riders pay it too"; a rate that has to be re-added every ride is a rate nobody uses. It stays one tap to remove.
- **The owner can leave themselves out** (Split's rule), on New ride too, where the canvas's chip for "You" ignores the tap.

## 1. The model (migration 610_tripeco)

| Table | What it holds |
|---|---|
| `tripeco_vehicles` | `veh_…`, the owner, name, plate, fuel (`petrol` `diesel` `cng` `electric`), the last odometer, the typed mileage and price, wear in paise per km, `archived_at` |
| `tripeco_fuel_logs` | `ful_…`, the vehicle, paid (paise), quantity (×1000), odometer, full or part, `me` or `rider`, when |
| `tripeco_rides` | `trp_…`, the vehicle, the owner, state (`open` → `done` → `posted`, or `solo`), mode (`odo` / `trip`), start and end odometer, Trip A, the car's average, the mileage and its source, the price, wear per km, the title, the group, fuel/wear/extras/total in paise, the Spliteco expense it posted as, started and ended times |
| `tripeco_ride_riders` | per ride: subject, on/off, kilometres ridden, share in paise |
| `tripeco_ride_extras` | per ride: toll or parking, paise |
| `tripeco_photos` | `pho_…`, the ride, role (`start` or `end`), a JPEG as base64 (≤ 400 KB), its size |

Everything is the owner's: every query is scoped by the owner's subject id, and nothing in these tables is readable by anyone else except a posted ride's proof (§3).

## 2. The maths (`@saas/kitchen-engine/drive`, pure, shared by worker and app)

- `km = end − start` (odometer mode) or `km = trip` (Trip reset mode).
- `fuel = round₹(km ÷ mileage × price)`; `wear = round₹(km × wearPerKm)` when on; `extras = Σ toll, parking`.
- Fuel and wear split by kilometres ridden among the riders who are on (a km slider per person, 0 … the ride); extras split equally among them. Both by largest remainder in whole rupees.
- `learnedMileage(fills)` → the segments (km, quantity, figure) and Σkm ÷ Σqty of the last six, or null.
- `perKm = price ÷ mileage (+ wear)`; the month's fuel and the riders' part of it for the Vehicle bar.

## 3. The API (`apps/tripeco-worker`, behind api-edge at `/v1/tripeco`)

| Route | What it does |
|---|---|
| `GET /me` | vehicles (with learned mileage, ₹/km, this month's fuel), recent rides, and what needs you (an open ride without its end, a done ride not posted) |
| `POST /vehicles` · `GET/PATCH/DELETE /vehicles/{veh}` | add, read (segments, fuel log), change (wear, name, plate, price, mileage), archive |
| `POST /vehicles/{veh}/fuel` · `DELETE /fuel/{ful}` | log a fill-up or charge; delete one (the app holds it for Undo first) |
| `POST /rides` · `GET/PATCH/DELETE /rides/{trp}` | start (vehicle, mode, start reading), change (end, Trip A, the car's average, mileage source, price, riders and km, extras, wear, title, group), read, discard an unposted ride |
| `POST /rides/{trp}/photos` | attach a start or end photo (base64 JPEG) |
| `POST /rides/{trp}/post` · `POST /rides/{trp}/unpost` | post to the ride's group (a repost edits the posted expense); undo a post |
| `GET /rides/{trp}/proof` · `GET /photos/{pho}` | the ride's numbers and photos, for its owner or any member of the group it posted to (checked by reading that group through spliteco-worker as the caller) |
| `GET /groups/{org}/rides` | every ride posted to a group you are in: km, total, your share |

Posting builds an exact split — the owner paid the total, each rider owes their share — and sends it to spliteco-worker's `POST /v1/spliteco/groups/{org}/expenses` with `source: tripeco`, the title, category transport and an idempotency key `trp_<id>_<version>`. Unpost is spliteco-worker's delete; a repost after a change is its edit. A ride with no rider but the owner is "Save as a solo drive" and posts nothing.

## 4. Reading an odometer (`apps/kitchen-worker`, the receipt reader's path)

`POST /v1/kitchen/me/ai/odometer { image, mode }` runs one AI task on the same runner, provider, switches and daily caps as the receipt reader (it counts as a receipt). It returns `{ odometerKm, tripKm, averageKmPer }`, each null when not on the photo, and writes nothing. The model is sent only the photo. The photo is checked as a receipt's (JPEG or WebP, ≤ 1.5 MB) and not stored by kitchen-worker; Tripeco stores its own downscaled copy as proof.

## 5. The app (`apps/tripeco-web`, Next.js on Workers, like spliteco-web)

- **Look:** Asphalt & lime — ground `#0B0C0E` / `#060708`, cards `#17191C` / `#22252A`, hairline `#24272C`, border `#3A3E45`, muted `#8E949C`, text `#F2F3F5`, lime `#C6F432` with `#141A04` on it, link `#D9F99D`; money as in Spliteco: saffron `#FFC857` amount, teal `#5EEAD4` get back, coral `#FF8A7A` owe; Plus Jakarta Sans, Share Tech Mono for odometer digits; cobalt `#2563EB` only for Spliteco links.
- **Pages:** Home · Vehicles · Groups (one swipeable tab surface), Scan, New ride, Split, Posted, Log fuel, Vehicle, Add vehicle, Group rides, Sign in, Handoff — one per canvas board.
- **Gestures:** swipe between tabs and between vehicle cards, swipe a fill-up to delete with Undo, sheets that drag down, edge back, the km slider. They come from `packages/gestures` (`@saas/gestures`), moved out of `apps/spliteco-web` so both apps use one copy (closes risk SL-A for Spliteco; Cookpool's console keeps its own).
- **The wire:** `@saas/sdk` (`client.tripeco.*`, `client.spliteco.*` for groups) with the bearer token in `localStorage` (`tripeco.token`); `/api/*` goes to api-edge over a service binding, as in spliteco-web.
- **Photos:** taken with the camera input, downscaled to 1280 px JPEG in the browser, sent once to the reader and once to the ride.

## 6. Photos are kept in D1

A downscaled odometer photo is 100–300 KB; it is stored base64 in `tripeco_photos`, capped at 400 KB, two per ride. *Rejected:* R2 — no bucket exists in this stack and adding one means a new infra component and wiring for one feature; the table can move to R2 later without changing the API.

## 7. Spliteco's side (`apps/spliteco-web`, `apps/spliteco-worker`)

- spliteco-worker: the lock (§0.4), and `source: { kind: "tripeco", id }` on an expense's view.
- spliteco-web: a ride row has a lime car tile and a lock beside "Tripeco"; its sheet shows the line "124 km · Swift · 18.6 km/l · ₹104/L", the start and end photos, **Edit in Tripeco** (opens the ride in Tripeco on the same environment) and Comment. Swipe to delete is off for it.

## 8. Out of scope

GPS, live fuel prices, a Tripeco ledger or settle-up, multiple owners of one vehicle, offline posting, R2, Cookpool's console gestures.
