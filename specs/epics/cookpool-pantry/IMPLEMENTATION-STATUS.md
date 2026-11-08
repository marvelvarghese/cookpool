# cookpool-pantry (PN) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| PN0 — the spec | | |
| PN1 — one tap from the Pantry | | |
| PN2 — restocking in one go | | |
| PN3 — fixing stock honestly | | |
| PN4 — ask before use | | |

## Departures from the design

Each task adds a section at the end, headed `### <milestone> — <title> (<KEY>)`.

### PN1 — Usuals by time of day and by food, in the server (PN-2)

**Built.** No migration and no new index.

- **`GET /v1/kitchen/me/usuals?tzOffset=&limit=`** (extended):
  - `tzOffset`: whole minutes east of UTC, −720…840, default 0. Anything else is 422 `validation_failed` with a `tzOffset` field error.
  - `limit`: 1–**100** now (was 50), default 10.
  - The response is `{ usuals: KitchenUsual[], bucket }`, where `bucket` is `morning | midday | evening | night` at `tzOffset`.
  - Each `KitchenUsual` keeps every field it had. It gains `now: UsualNow | null` and `strip: boolean`.
  - `UsualNow` is `{ bucket, qtyMilli, quantity, unit, label, consumerIds, count }`.
- **Per food.** A food is one pantry + `lower(trim(name))` + dimension. It covers the caller's uses (logged by them or naming them, not reversed) of any item of that food in any state but `removed`. A used-up pack's uses still count.
  - The reader is one statement in `packages/db/src/kitchen/usuals.ts` (`readUsuals`), and `stock.ts`'s `usuals` delegates to it. The query plan uses the existing indexes: items by owner and org, moves by `(item_id, created_at)`, and reversals by `reverses`.
  - One row comes back per active item with something left whose food has a use in 90 days. Rows are ordered by the food's use count, then by the latest use.
  - `lastQtyMilli`/`lastUnit`/`lastLabel`/`consumers`/`lastUsedAt` come from the item's own latest use. An item with no uses of its own reads its food's latest, so a new pack inherits the old one's usual.
  - The bucket is computed with `strftime('%H', created_at, '<±N> minutes')`. `now` needs ≥ 2 of the food's uses in the current bucket in the last 60 days, and `strip` needs ≥ 3.
  - `now` is the most frequent `qtyMilli`, ties going to the most recent. Its unit, label and people come from the latest use of that amount.
- **Home's inbox** reads the same repository call, so a new pack's use-soon card carries the old pack's usual.
- **Contracts**, in the new module `packages/contracts/src/kitchen-usuals.ts` (`@saas/contracts/kitchen-usuals`):
  - `USUAL_BUCKETS`, `USUAL_BUCKET_LABELS`, `USUAL_BUCKET_HOURS`, `usualBucketOfHour`, `usualBucketAt`;
  - `TZ_OFFSET_MIN`/`MAX`, `isTzOffset`;
  - `USUALS_NOW_DAYS = 60`, `USUAL_NOW_MIN_USES = 2`, `USUAL_STRIP_MIN_USES = 3`;
  - `UsualNow`;
  - `suggestUse`, `restWhy`, `usualAmount`, `isRunningLow`, `RUNNING_LOW_PERCENT`, `REST_OF_USUAL`.
  - `kitchen.ts` adds `now?`, `strip?`, `UsualsQuery.tzOffset?` and `UsualsResponse.bucket?`, and re-exports the `UsualBucket` and `UsualNow` types.
- **`suggestUse({ item, usual?, now?, ladder })`:**
  - `item` is `Pick<KitchenItem, "qtyLeftMilli" | "dimension" | "daysToUseBy">`.
  - `usual` is a `KitchenUsual` or as much of one as it reads.
  - `now` is the bucket usual and defaults to `usual.now`.
  - `ladder` takes amounts or anything with `amount.qtyMilli`, so the console's `useTiles(item, usual)` feeds it as is. The `rest` tile is skipped, and only steps under what's left count.
  - It returns `{ reason, qtyMilli, unit, label, consumerIds, why } | null`.
  - The rules run in the design's order: `rest` (left ≤ 5/4 × the bucket's, else the last, usual; or no step under what's left), then `usual_now` ("Morning usual"…), `usual` ("Your usual"), `use_soon` (`daysToUseBy` 0…`USE_SOON_DAYS`, "Use soon"), and `first`.
  - It never suggests more than what's left, and returns null only when nothing is left.
- **`isRunningLow({ item, usual?, now? })`:** true when left × 100 < bought × 20, or left is under one usual amount (the bucket's, else the last).
- **SDK:** `kitchen.usuals({ limit?, tzOffset? })`. The PN-2 names are re-exported from `@saas/sdk`.

**Departures and decisions:**
- **The food key includes the dimension.** Milli amounts don't compare across dimensions, and measures key the same way. So Milk counted in packs is not the same food as Milk in litres.
- **Two windows.** The last-use fields keep `USUALS_DAYS` = 90, so every usual a caller had before still shows. `now` and `strip` use 60 days, as the design says.
- **`usedCount` counts the food's uses** (every pack), not the item's. The type stays the same, and no console code reads the number; it only orders.
- **`now` carries `quantity` and `unit`** on top of the design's `{ bucket, qtyMilli, label, consumerIds, count }`, so it can be logged the way it was logged. `count` is every use of the food in the bucket, which is what the thresholds count.
- **The new response fields are optional in the types** (`now?`, `strip?`, `bucket?`), as `lastLabel?` was for SM-13. Every answer carries them.
- **`MAX_USUALS_LIMIT` went from 50 to 100,** so PN-5 can ask for a usual on every row; PN-5 doesn't own the worker.
- **"The rest · only N left"** reads only for a whole count of pieces (`count` dimension). Anything else reads "The rest".
- **`isRunningLow`'s "one usual amount"** is the same amount `suggestUse` reads (the bucket's, else the last). The server's restock (PN-3) has no bucket, so it passes the usual alone.
- **`kitchen-usuals.ts` is its own subpath** and isn't `export *`-ed from `kitchen.ts`. It reads `USE_SOON_DAYS` from `kitchen.ts`, and re-exporting it from there would make a runtime import cycle. `kitchen.ts` imports only its types.

**Tests:**
- `tests/kitchen-worker` (31 suites, **709 tests**). `src/usuals-by-time.test.ts` is new with 8 tests:
  - the bucket at several offsets;
  - `tzOffset` validation and `limit=100`;
  - uses bucketed by their own local hour across midnight and at the 04:59/05:00 edge;
  - a new pack inheriting, while the same name in the caller's own pantry, another group, or counted in packs does not;
  - two open packs each keeping their own last use;
  - the 2/3 thresholds and the most frequent amount with ties to the most recent;
  - reversed uses left out, both a personal undo and a group txn reversal;
  - the 60-day window beside the 90-day last use;
  - the inbox inheriting.
- `using.test.ts`'s pinned usuals now include `now` and `strip`. The `measures.test.ts` statement count (2) is unchanged.
- `tests/contracts` (24 suites, **263 tests**). `src/kitchen-usuals.test.ts` is new with 15 tests: the buckets and the zone shift, each `suggestUse` rule, the never-more-than-left sweep, and `isRunningLow`.
- `packages/sdk` (**181 tests**): `usuals({ tzOffset })` builds `?tzOffset=` and `?limit=&tzOffset=`.
- `tests/db` (**815**) and `tests/api-edge` (**587**, after `wire:fixture`) pass unchanged.

**For later tasks:**
- **PN-5:** send `tzOffset: -new Date().getTimezoneOffset()`. The `kitchenUsuals` query key has no bucket in it, so a read cached at 10:55 still says morning at 11:05. Refetch when `usualBucketAt(new Date(), tz)` changes.
- **PN-3:** can call `isRunningLow({ item, usual })` with the last usual. The name-key reads here need no index.
