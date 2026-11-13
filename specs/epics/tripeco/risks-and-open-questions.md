# tripeco — risks and open questions

## TR-A — a misread odometer (RISK, mitigated)

A model can read 48,336 as 48,386. Every reading is shown on its own sheet beside the photo, editable, with Retake · Use; nothing is posted before Split, and a ride whose end is below its start or more than 2,000 km past it is refused.

## TR-B — someone else's ride locked into my group (RISK, mitigated)

A ride is a locked row in a group its owner shares. The riders see it with its photos and can comment; only the owner (through Tripeco) changes or removes it. Spliteco's lock is a header api-edge never forwards (design §0.4), so no client can unlock a row.

## TR-C — photos in D1 (ACCEPTED)

Two photos of up to 400 KB per ride grow the shared database. At 100 rides a month per active driver this is tens of MB a year per driver — acceptable for now; the photo table can move to R2 without changing the API (design §6).

## TR-D — no signal at the start of a trip (RISK, open)

A basement car park may have no network when the start photo is taken. The start reading is kept on the device until the ride is created; the start photo is retried with the end. A ride never posts offline.

## TR-E — mileage before two full tanks (ACCEPTED)

Until the second full fill-up, the mileage is the figure typed in Add vehicle, which tends to read high. The Vehicle page shows which it is; the ride keeps the figure it used.

## TR-F — a group in another currency (ACCEPTED)

Rides are in rupees. Posting to a group that counts in another currency is refused with spliteco-worker's `currency_mismatch` and the app says so.

## TR-G — the app's address (ACCEPTED)

Until the owner attaches a domain, Tripeco lives at `cookpool-tripeco-web-<env>.cookpool.workers.dev`; identity-worker's origin lists name those hosts.

## TR-H — gestures moved under a live app (RISK, mitigated)

Moving Spliteco's gesture modules into `packages/gestures` touches every Spliteco page. The move is import paths only, Spliteco's gesture tests run against the package, and spliteco-web is redeployed with it.
