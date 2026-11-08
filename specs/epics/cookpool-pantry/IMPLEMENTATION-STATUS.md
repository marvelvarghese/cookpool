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

### PN2 — restocking in one go (PN-3)

**Built:** the server half of restocking (design §6.4), with migration 400, the SDK and tests. Nothing in the console changes.

**Migration 400 `400_kitchen_purchases`:** `kitchen_items.purchase_id TEXT` (nullable, no default) and `kitchen_items_purchase_idx ON kitchen_items (purchase_id) WHERE purchase_id IS NOT NULL`. There is no purchases table: a purchase is the items sharing the id. There is no name-key index either, because the restock read doesn't need one: its plan walks the owner and group indexes (MULTI-INDEX OR) and the moves' `(item_id, created_at)` index, and `tests/db` pins that.

**Routes** (kitchen-worker, `/v1/kitchen/me/…`; api-edge's facade already forwards every method under `/v1/kitchen/…`, so the edge is unchanged):
- `GET /v1/kitchen/me/restock` → `{ finished, runningLow, usual }`. It reads the caller's own pantry plus every group they hold a group role in, in one D1 statement. Each line is `{ name, nameKey, category, pantry: PantryRef, canAdd, reason, why, last }`, a union typed by `reason`:
  - `finished`: `why: { finishedAt, how: "used_up"|"wasted", itemId }`;
  - `running_low`: `why: { leftQtyMilli, boughtQtyMilli, itemId }`;
  - `usual`: `why: { everyDays, lastBoughtAt, times }`;
  - `last`: `{ itemId, quantityMilli, unit, priceMinor, currency, wastePolicy, expiresAfterDays, paidBy }`.
  - Each name key and pantry appears once, in the first group it fits. Order: `finished` by latest finish, `runningLow` least left first, `usual` most overdue first (elapsed ÷ everyDays). At most 50 lines a group.
- `POST /v1/kitchen/me/purchases` takes `{ lines: PurchaseLine[] }` (1–30) and returns 201 `{ purchaseId: "pur_…", items: KitchenItem[] }` in line order. A line is `{ pantry: "personal" | "org_…", name, category, quantity, unit, priceMinor, currency?, expiresOn?, wastePolicy?, note?, fromItemId? }`.
  - Every line is paid by the caller and bought today; a line's `paidBy` and `boughtOn` are ignored.
  - Reachability: one `kitchen.item.create` policy decision per group (Add item's check). Any refusal refuses the whole run.
  - The write is one `db.batch`: currency pins, inserts with food links, and each group line's `kitchen.item.added` audit event (its payload carries `purchaseId`).
  - Each item's key is `<Idempotency-Key>·<line>`, unique per pantry. A retry answers with the purchase it made. A key another person used in the same pantry gets 409 `idempotency_key_reused`.
- `DELETE /v1/kitchen/me/purchases/{pur}` → 200 `{ purchaseId, removed: KitchenItem[], kept: KitchenItem[] }`. One UPDATE removes the purchase's items that are still unused (same rule as removing one item). A repeat answers the same.
- **SDK:** `kitchen.restock()`, `kitchen.buy(lines, opts)`, `kitchen.undoPurchase(id)`. Contracts are in `packages/contracts/src/kitchen-restock.ts`, re-exported from `kitchen.ts`.

**Departures and choices:**
- **`kept` is in the body**, beside `removed`, not in `details.kept`: the Undo succeeds even when it keeps something, so it answers 200, not an error envelope.
- **A pantry out of reach is 422 `validation_failed`**, with `lines[i].pantry: "Must be a pantry you can add to"` for each such line. The wording is the same whether the group doesn't exist, the caller isn't in it, or they can only read it. It isn't the opaque 404, because that would read as "no such route" on the caller's own route.
- **Running low uses the 20 % rule alone** (`RESTOCK_LOW_PERCENT`). The per-caller "under one usual amount" half of `isRunningLow` is PN-2's and isn't applied here.
- **A name stays out of `runningLow` while another active item of it in the pantry is at or above 20 %.** A fresh pack means nothing to restock. With several low items, the newest one gives `why`.
- **"Newer" in Finished means added later** (`created_at`). An older pack still active doesn't hide a newer one finishing; a pack added after it does. The finish time is the item's last move.
- **A usual counts distinct purchase days**: two packs on one day are one time. `everyDays` is the median gap between those days, rounded, and the line is due once that many days have passed since `lastBoughtAt`, which is a day (`YYYY-MM-DD`), not an instant.
- **Additions to the shapes:**
  - `canAdd` on each line: a viewer still sees a group's finished and running-low lines, but `usual` is only for pantries they can add to;
  - `why.itemId` and `why.how` on finished lines, `why.itemId` on running-low lines;
  - `why.times` on usual lines;
  - an optional `currency` on a purchase line. A group line must match its group (otherwise 422 `currency_mismatch`, with `details.currency` and `details.line`); a personal line defaults to INR, as on Add item.
- **`last.wastePolicy` is the item's own rule** (null when it follows its group), so sending it back reproduces the item.
- **`fromItemId`** may name any item the caller can reach; an unknown one is 422 on `lines[i].fromItemId`. Its waste rule is copied only into its own group, and only when the line sends no `wastePolicy`. **PN-8's seam:** `inheritedSettings()` in `apps/kitchen-worker/src/purchases.ts` is where `askFirst` and `allowed` join.
- **The Undo removes a group's items only while the caller still holds `kitchen.item.edit` there.** Otherwise they're listed in `kept`. Items in a group the caller has left aren't visible and aren't reported. Only the purchaser (the items' creator) can undo; anyone else gets the opaque 404.
- **`insertItemStatement` names `purchase_id` only for a run's items**, so a single add's insert is unchanged.

**Tests:**
- `tests/kitchen-worker`: 731 pass, 30 of them new.
  - `restock.test.ts` (18): each group with its edges (a rebought item leaves Finished, any case; an older active pack doesn't hide it; a name in two pantries; the 20 % line; another pack above the line; the 3-day threshold with same-day packs; the median gap, not yet passed and passed; the 120-day window; dedupe across the groups; removed items and leftovers excluded; a viewer's group with `canAdd: false` and no usuals; a group the caller left), one D1 statement, 503, 401, 405, and the median and due rules as unit tests.
  - `purchases.test.ts` (12): mixed personal and two groups in one batch with one `pur_` id and audit events; one unreachable pantry refusing all of it; validation; currency, including a race fixed between read and write that writes nothing; `fromItemId` copying; idempotency; the Undo with one used item kept, a demoted group kept, purchaser only.
- `tests/db`: 822 pass, 6 new in `kitchen-purchases-migration.test.ts` (registration, the text, the column and index on real SQLite, the repository's batch, replay and Undo, and the restock plan).
- `tests/contracts`: 251 pass, 3 new in `kitchen-restock.test.ts`.
- `packages/sdk`: 185 pass, 4 new in `kitchen-restock.test.ts`.
- `tests/api-edge`: 587 pass after `wire:fixture`, unchanged.

### PN3 — The stock check in the server (PN-4)

**Built.**

- **Migration 410** `410_kitchen_moves_via`: `ALTER TABLE kitchen_stock_moves ADD COLUMN via TEXT CHECK (via IS NULL OR via IN ('check', 'ask'))`. It's registered in `manifest.ts` with its sha256. Every move written before reads NULL. `'ask'` is there for PN-8.
- **`POST /v1/kitchen/me/items/{itm}/check`** and **`POST /v1/organizations/{org}/kitchen/items/{itm}/check`**:
  - **Request:** `{ left: { quantity, unit? }, gone?: "me" | "split" | "waste" }`.
    - `quantity` is a decimal string or number, and `0` (or `"0.0"`) means empty.
    - `unit` is any unit the use routes take that measures what the item does. The default is the item's own unit.
  - **Response:** 201 `StockMoveResponse` (`{ item, move, txn }`), also typed as `CheckItemResponse`. Idempotency works as on every write.
  - **Authz:** a group item takes `kitchen.item.use`, the same as using it: members, owners and admins, not viewers. Everyone else gets the opaque 404. A personal item is keyed by the caller's subject.
  - **Less than is left:** the check writes exactly what `…/uses` or `…/waste` would have written for the difference. It goes through the same planners, so the move, cost, transaction, splits, audit event, email and Undo are theirs:
    - `me` is a use by the caller. A group item posts a `use` txn charging the caller, or none when the caller is the buyer.
    - `split` is a use whose consumers are every member on the group's roster, oldest first. It uses `buildUse` equal shares, so the odd paisa goes one each to the earliest. Personal items refuse it.
    - `waste` is waste under the item's rule, else the group's. Split equally posts a `waste` txn shared by the roster; buyer absorbs, and every personal item, writes the move only.
  - **More than is left:** an `adjust` move of the difference, with `cost_minor` 0, no txn, and `qty_left` raised. The item becomes `active`. A group item writes the audit event `kitchen.item.adjusted`.
  - **Every move a check writes has `via = 'check'`.** Reversals never carry `via`.
  - **Refusals,** each writing nothing:
    - the same level as is left: 422 `details.reason: "unchanged"` with `details.qtyLeftMilli`;
    - above what was bought: 422 `details.reason: "more_than_bought"` with `details.qtyBoughtMilli`;
    - less without `gone`, `split` on a personal item, or a bad `gone`: 422 field `gone`;
    - a malformed level, a unit of another dimension, or a `measure`: 422 fields `left`, `left.quantity`, `left.unit` or `left.measure`.
- **Shared write paths** (refactored out of the handlers, behaviour unchanged; the existing 709 worker tests pass as they were):
  - `planGroupUse`, `planGroupWaste` and `emailUse` (`handlers/uses.ts`), and `planPersonalUse` and `planPersonalWaste` (`handlers/my-uses.ts`). The use and waste routes and the check all call them.
  - The worker's `takeStock` (`stock.ts`) takes `kind: "check"` and a plan that returns either a take or an adjust (`StockWrite`). A replay matches a check's key only to a move with `via = 'check'` by the same actor. A use or waste key matches only a move with no `via`.
- **Database:**
  - `KitchenStockMoveRecord.via` and `TakeStockInput.move.via`.
  - The new `repo.adjustStock(AdjustStockInput)` writes one batch: the guarded `adjust` insert, then `qty_left + d` and `state = 'active'`. It fails as `stale` on a moved version and as `invalid: more_than_bought` on the CHECK.
  - `repo.undoMove` on an `adjust` uses `unadjustStatements`, which take `d` back off. An item it empties is finished as its latest take still in effect left it: `wasted` after a waste, else `used_up`. If less than `d` is left, it fails with `insufficient_stock`.
- **Undo of an adjust** goes through the existing `…/moves/{mov}/undo` (personal and group), with the same authz: its logger, or `kitchen.txn.reverse_any`. It's allowed whenever the difference is still all there, even when it isn't the latest move. Otherwise it's 409 `insufficient_stock` with `details.qtyLeftMilli`. Undo of a check's use or waste is the existing undo: reverse its transaction, or `…/undo` when it posted none.
- **Contracts:**
  - `KitchenStockMove.via?: "check" | "ask"`, present only when set.
  - The new module `packages/contracts/src/kitchen-stock-check.ts`, re-exported from `kitchen.ts`, holds:
    - `STOCK_MOVE_VIAS` and `StockMoveVia`;
    - `STOCK_CHECK_GONE` and `StockCheckGone`;
    - `KITCHEN_CHECK_ERROR_REASONS` (`unchanged`, `more_than_bought`) and `KitchenCheckErrorReason`;
    - `StockCheckLevel`, `CheckGroupItemRequest`, `CheckPersonalItemRequest` (no `split`) and `CheckItemResponse`.
- **SDK:** `kitchen.checkGroupItem(orgId, itemId, body, opts)` and `kitchen.checkPersonalItem(itemId, body, opts)`. The PN-4 names are re-exported from `@saas/sdk`.
- **kitchen-engine:** no change. `costOfUse` already keeps a raised item inside its price. A route test (raise, then use it all: the moves in effect sum to exactly ₹60) and a 500-run randomised sequence of uses and raises confirm it.

**Departures and decisions:**
- **A check can raise a finished item.** A used-up or wasted item is active again after an `adjust`, and costs nothing more: it has already cost its price. Nothing is refunded. Reversing the use or waste is how money comes back. Undoing that adjust finishes it again, as it was.
- **An adjust's undo isn't latest-only.** The design says "if it's still there". An adjust costs nothing, so no later move's cost depends on it, and it can come off whenever the difference is still all there. Every other move keeps the latest-only rule.
- **Restocks stop at what was bought.** `restockStatements` now sets `qty_left = MIN(qty_bought, qty_left + q)`. A transaction reversal or a cancelled dish for a use logged *before* a raising check would otherwise go over what was bought, fail the stock CHECK and answer 500. Now it stops at full and the money still comes back exactly. Without an adjust the cap can't be reached. The reversal move still records the original quantity, so history can overstate what came back in that one case.
- **Activity says why.** A check's txn title ends in " · stock check" ("Milk (250 ml) · stock check", "Wasted: Milk (100 ml) · stock check"). Its audit description says so too, and its audit payload carries `via`. Otherwise the txn is the one the use or waste route writes. This follows risks PN-C ("Everyone sees it in Activity with the checker's name").
- **Usuals skip check moves.** PN-2's `readUsuals` (`packages/db/src/kitchen/usuals.ts`) adds `AND (m.via IS NULL OR m.via <> 'check')`. A split check names everyone, and fixing a level isn't a habit, so it must not become anyone's "Your usual". `via = 'ask'` uses (PN-8) still count.
- **Split's members are the roster,** viewers included, the same set waste split equally charges ("every current member"). Someone who has left isn't charged.
- **`gone` is ignored when the level is more,** so the console can send its default answer either way. It's validated whenever it's sent.
- **The level is absolute,** read against the item when the check writes. A use landing between the read and the write only shrinks the difference, through the usual one stale retry.
- **A retried check is answered with its move,** not refused as unchanged. A key reused between a check and a use or waste is 409 `idempotency_key_reused`.
- **The check's reasons** live in their own `KITCHEN_CHECK_ERROR_REASONS`, as the timers' do, not in `KITCHEN_ERROR_REASONS`. Error codes are unchanged: all refusals are `validation_failed` 422.
- **A level takes a unit only.** `left.measure` is refused, because it would otherwise read as the item's own unit.
- **`kitchen-stock-check.ts` has no package subpath.** It's reachable through `@saas/contracts/kitchen`, which keeps `packages/contracts/package.json` untouched.
- **PN-8's seam:** `groupCheckRefusal(ctx, item, gone)` in `handlers/stock-check.ts`. It runs after the difference is known and before anything is planned, and returns null today.

**Tests:**
- `tests/kitchen-worker` (32 suites, **738 tests**, PN-2's included). `src/stock-check.test.ts` is new with 29 tests:
  - **`me`:** the same move and txn as `…/uses`, apart from `via` and the title note; the buyer's own check posting nothing and being undone directly; a level of 0 charging exactly what's left of the price.
  - **`split`:** the design's Flat 4B (₹3.75 × 4, Meera +₹11.25); ₹50.51 four ways (1263/1263/1263/1262); the roster with the viewer, and without someone who left; a buyer-only group posting no txn, with undo.
  - **`waste`:** split equally, the same as `…/waste`; buyer absorbs, and the item's rule winning over the group's; 0 meaning wasted.
  - **Undo restores exactly:** reversing `me`, `split` and `waste` brings back every balance to {} and the item to 1 L / ₹60.
  - **More:** the adjust (no txn, worth unchanged, `kitchen.item.adjusted`); its undo by the checker, a 403 for others, and an admin's undo; undo after later uses while the difference is there, and 409 `insufficient_stock` once it isn't; waking a used-up and a wasted item, with the undo finishing each again as it was; the total never above the price; a reversal after a raise capped at full; the randomised `costOfUse` property.
  - **Refusals:** `unchanged` in three spellings, `more_than_bought`, 11 malformed bodies, and authz (viewer, outsider, another group, a bad id, 405, 401).
  - **Retries and races:** a retry replays; keys can't cross between a use and a check; a use landing mid-check shrinks the difference.
  - **History:** `via` on check moves only.
  - **Personal:** `me` with undo, `waste`, and raising with undo; `split`, `unchanged`, `more_than_bought` and another person's item refused.
  - **Usuals:** a split check is nobody's usual. This test fails without the filter.
- `tests/db` (30 suites, **823 tests**). `src/kitchen-moves-via-migration.test.ts` is new with 7 tests: the registration order (PN-3's 400 may land first); the text (one additive column); the CHECK; a pre-410 move reading NULL; and, through the repository, `via` round-trips, `adjustStock` (cost 0, `more_than_bought`, `stale`, replay) and the adjust's undo (`insufficient_stock`, and finishing it again).
- `tests/contracts` (25 suites, **265 tests**). `src/kitchen-stock-check.test.ts` is new with 2 tests: the constants, a compile-time check that `StockMoveVia` equals `KitchenStockMove["via"]`, and the request types (`split` is a type error on a personal check).
- `packages/sdk` (**185 tests**). `src/__tests__/kitchen-stock-check.test.ts` is new with 4 tests: the paths, the body, the idempotency key, the errors with their reasons, and the re-exports.
- `tests/api-edge` (**587**) passes unchanged. The kitchen facade forwards any `/v1/…/kitchen/…` path, so the edge needed no change. `apps/web-console-next` typechecks.
- `typecheck` and `lint` are clean for `@saas/db`, `@saas/contracts`, `@saas/sdk`, `@saas/kitchen-worker` and `@saas/kitchen-engine`, and for the three test packages.

**For later tasks:**
- **PN-7:**
  - Answer `gone` only when the level is less, and cap the level at Full. "It's right" sends nothing.
  - Undo of a check's use or waste is `reverseTxn` when `txn` isn't null, else `undo…Move`. An adjust is `undo…Move`, and `insufficient_stock` means what it added has been used.
  - History reads `move.via === "check"` as "Stock check · …". A `use` with several consumers is the split.
- **PN-8:**
  - `'ask'` is already in the CHECK and in `KitchenStockMoveVia`. `planGroupUse(ctx, item, { …, via: "ask" })` writes the approved use, and usuals still count it.
  - Restrict checks in `groupCheckRefusal`.
- **Deploy order:** `MOVE_COLUMNS` now reads `m.via`, so migration 410 must apply before this kitchen-worker serves. On main, kitchen-worker's enforced `db-migrate` edge orders it, and the new migration directory plans `db-migrate` by path.
  - kitchen-worker changes in its own path, so it redeploys.
  - Nothing else bundles the kitchen repository.
  - The console has no change here, and will pick up the contracts and SDK when PN-7 changes its files.

### PN1 — The new Pantry (PN-5)

**Built.** Console only, all behind `newFrame()`. No route, no migration, no SDK change. With `newFrame()` false, `/pantry`, `/use` and Home render exactly what they did: each page picks its frame at the top (`newFrame() ? <NewPantry/> : <TodaysPantry/>`, the same for `/use`), and today's code below it is unchanged.

- **The Pantry** (`pantry-new-ui.tsx`, design §1, the canvas's PantryNew), top to bottom:
  - "Pantry" and **+ Bought**;
  - the search, on phones too, with **Log several** beside it. `?q=` fills it and `?focus=1` focuses it;
  - the **Now strip**;
  - the chips with counts;
  - the use-soon card;
  - the sections by kind;
  - a marked slot for PN-6's Finished this week;
  - Always have.
  - It reads `items?pantry=all` once and does every filter, count and search locally.
- **The view-models:**
  - `pantry-list.ts`: kinds and sections, filters and chips, the row (tag, level, chip), the use-soon card, and the address helpers.
  - `pantry-set.ts`: the ladder, the suggestion, − and +, the reason, Last, the faces' cost, and the drafts.
  - `now-strip.ts`: the strip, the tray, and the usuals read.
- **The UI:**
  - `pantry-row-ui.tsx`: the row, its chip, the swipe and hold.
  - `set-row-ui.tsx`: the open row.
  - `use-sheet-ui.tsx`: the More… sheet.
  - `now-strip-ui.tsx`: the strip and the tray.
- **Writes:**
  - `log-several-data.ts` is Log several's write.
  - `lib/pantry-device.ts` keeps the folded sections and the drafts on the device.
- **Sections** run Dairy, Veg, Fruit, Grains, Protein, Spices, Leftovers (`LEFTOVERS_CATEGORY`), Other.
  - An item's kind is its category, case-insensitive. A category outside the list sits under Other, and its row's level line ends with the category as typed ("· Snacks").
  - Inside a section: use soon first (soonest, so expired, first), then running low, then by name.
  - A header tap folds its section, and the device remembers it (`<prefix>.pantry-folded`). A section stays open while searching, or while it holds the open row.
- **Chips:**
  - They read `All N · Use soon N · Running low N · <pantry> N`.
  - The pantry chips show only with more than one pantry, yours first, then groups opened last first.
  - A count of 0 hides its chip, except All and the one chosen.
  - It's one choice at a time, mirrored in `?filter=soon|low` or `?pantry=`.
- **A row:**
  - **The tag:**
    - It is one of: Ask (PN-9) › Expired › "Use soon · Tue" (today / tomorrow / the use-by's weekday) › Running low › the pantry on All.
    - When the tag says something else, the pantry goes beside the level ("1 L of 1 L · Flat 4B").
  - **The level bar** is `#1F7A4D`, `#D97706` when running low or use soon, and `#B42318` once expired. The tag or a count always says it too.
  - **The chip** is `suggestUse`'s amount ("1 glass"). One tap logs it through `useLogUse` for the people from last time (the bucket's for a bucket usual, else you), with the usual Undo toast. A swipe left does the same, and holding opens the sheet. "Use…" (open the row) shows only when there's no suggestion. A viewer's row has no chip.
  - **Usuals** come from `useUsuals()` by `itemId`. `isRunningLow` gets the usual and its `now`.
- **The set row** (§1.1):
  - "Last: 1 glass · today, 8:10 am · you and Anu" comes from the item's moves, skipping a stock check's `via: "check"` use. With no use of its own, it reads the usual's last use, so a new pack inherits it.
  - − [amount] + walks the ladder, starting at the suggestion with its reason. Once moved it reads "Changed from 1 glass".
  - For a group item, up to 4 faces and "+N" (which opens the sheet), and the cost, "₹17.00 · ₹8.50 each" (the engine's split of the people who had it).
  - ✓ Use and More….
  - The amount and the people are the device's draft for that item (`<prefix>.pantry-drafts`, the newest 40), shared with the sheet and cleared on Use. Both device keys are cleared on sign-out (`clearDeviceRecords`).
- **The More… sheet** (§1.2), in place of `ItemActionsSheet` on the new Pantry:
  - name, level, "Flat 4B · Meera paid ₹68.00 · Use by …", the note, and Open;
  - How much: the item's `useTiles` (4 at most, The rest included) plus Other, a − + stepper in the item's unit;
  - Who had it (`FaceRow`);
  - Log, as "Log 1 glass" over "You + Anu · ₹8.50 each";
  - Finish it (logs the rest for the faces), Wasted (the existing `WasteConfirm`), and Cook with it (`/cook?item=`).
- **Log several** (§1.3):
  - The toggle turns the row chips, their swipes and the strip chips into tray toggles (ticked while in).
  - The tray sits above the tab bar: "1 glass milk · eggs × 2 · 100 g atta", **Log 3 for you**, and "A meal for others? Cook it instead" (`/cook`).
  - `useLogSeveral` patches every item at once and sends the uses one after another, each to the ordinary `…/uses` route.
  - One toast: "Logged 3 for you · ₹29.00". Its one Undo reverses each written use, the last first (`undoStockMove`).
  - If some are refused, it reads "Logged 2 of 3 for you · Couldn't log …"; if all are refused, the refusal.
- **The Now strip** (§3), "NOW · EVENING":
  - first, the usuals with `strip: true` whose row logs in one tap, most uses in the bucket first, at most 4;
  - then use-soon items with something left, soonest first, via `soonStrip` — 6 in all.
  - A chip reads "Milk · 1 glass · Evening usual". A tap logs it, or under Log several it goes to the tray.
  - It isn't drawn when empty, nor while searching.
- **The usuals read** (`usualsRead`, `useUsualBucket`):
  - **New frame:** `GET /v1/kitchen/me/usuals?limit=100&tzOffset=<-getTimezoneOffset()>`, keyed `["kitchenPantry","usuals",<bucket>]`. That's under the old prefix, so stock writes still refresh and patch it, and the last answer stays on screen while the next loads.
  - The bucket is looked at again at the next bucket's start (`msToNextBucket`) and whenever the page comes back. A new bucket is a new key, so the read runs again.
  - **Today's frame:** exactly `?limit=10` under `["kitchenPantry","usuals"]`, as before. Home's usual chips and + Add's Do it again read the same entry in each frame.
- **Home and `/use`** (§4), new frame only:
  - Home's "What did you use?" links to `/pantry?focus=1`, and the usual chips stay.
  - `/use` replaces itself with `/pantry?focus=1`.
  - `/use?item=<ref>` replaces itself with `/pantry?open=<ref>`, which opens that row and scrolls to it.
  - `?focus` and `?open` are dropped from the address once used. Every `quickUseHref` link (item page, Home cards) therefore lands on the open row. Navigation uses RC-11's `Link` and `useKitchenRouter`.
- **Helpers:**
  - `soonStrip` is reused by the Now strip.
  - `pantrySections` (per pantry), `OPEN_SECTIONS` and its types are removed, superseded by `kindSections`, along with their 5 tests. The `pantryRows` test stays, under "the desktop table's rows".
- **Seams:**
  - **PN-9:** `pantryRow(item, { askName })` gives `variant: "ask"`, the tag "Ask Meera" with a lock, and no chip. PN-9 draws the asking chip and set row.
  - **PN-6:** the marked slot above Always have in `pantry-new-ui.tsx`, and `boughtHref`.
- **Shared files, all additive:**
  - `pantry-data.ts`: `useUsuals` and the new `useUsualBucket`. `USUALS_LIMIT` is now re-exported from `now-strip.ts`.
  - `query-keys.ts`: `kitchenUsualsAt`.
  - `sign-out.ts`: `clearPantryDevice`.
  - `quick-use-ui.tsx`: the field's href.
  - `row-gestures-ui.tsx`: `SwipeRow` lets a control marked `data-row-surface` swipe and hold, because the row's open-in-place surface is a `<button>`.
  - `pantry.ts`: the removal above.
  - `item-use.ts` is untouched.

**Departures and decisions:**
- **The ladder is longer than the tiles.**
  - `useTiles` alone gives at most three amounts and The rest; it keeps a slot for "Count in …". So 1 L of milk would step ½ glass, 1 glass, then straight to 1 L, and the plan's "steps to 2 glasses" couldn't happen.
  - The ladder is the tiles, plus up to 6 steps above the suggestion, below what's left: ×2…×7 of an amount ("2 glasses", "200 g"), or one more of a measure at a time ("3 onions"). They're in order of amount, then The rest. This matches the canvas's UseSheet tiles (½ glass, 1 glass, 2 glasses).
  - The tiles are fed the **bucket's** usual when there is one, so the usual tile is the amount the row suggests.
- **`/use?item=` opens the row without focusing the search.** The design has `?focus=1` too, but on a phone the keyboard would come up over the row you came to log. `/use` alone still focuses.
- **Use soon counts expired items too.** The old frame's Expired chip folds into it, and `?filter=expired` reads as Use soon. The use-soon card counts only items still in date, since expired food isn't something to cook with.
- **A "Running low" tag** is added to the design's tags, so the amber bar is never the only signal for a low item. The pantry then moves beside the level.
- **Log several logs for you alone** ("Log 3 for you", the canvas's words). A meal for others is the tray's Cook link. Only the one-tap chips go to the tray; the set row's ✓ Use and the sheet's Log still log at once. The toggle sits beside the search, so it's there without the strip.
- **The chip on The rest** says the amount ("300 ml"), with "The rest" as its reason in the set row and the strip.
- **The sheet's Other** is a − + stepper in the item's unit (50 g / 50 ml / 1 pc / ½ pack steps); it takes no typed amount. A typed amount remains on the item page.
- **Search is local** over the loaded items (`matchesQuery`, every word), not the server's search. Results are rows like any other.
- **One layout at every width:** the same sections in a 760 px column beside the sidebar. The desktop table is today's frame's.
- **+ Bought** goes to `/pantry/new` (with `?pantry=` when one is chosen), as the Pantry's + did, because `/pantry/run` doesn't exist yet. PN-6 changes `boughtHref`.
- **The set row has no "Fix how much is left".** The canvas shows it, but it's PN-7's route.
- **Drafts aren't timed out.** They're kept until Use (the newest 40), as the design says. A stale draft shows as "Changed from …".

**Tests:**
- `tests/web-console-next` (**91 suites, 1,839 tests**). Three files are new, with 47 tests; 5 `pantrySections` tests are removed.
  - **`kitchen-pantry-new.test.ts` (19 tests):**
    - the kinds' order and counts;
    - Other labelled as typed;
    - the order inside a section;
    - choice and search;
    - folding;
    - the chips and their counts, with zeros hidden, the single-pantry case, and `?filter=`/`?pantry=`;
    - + Bought;
    - the use-soon card;
    - the row's tags, level text and bar colours;
    - the chip's words, people, personal and viewer cases;
    - PN-9's variant;
    - Home's field in both frames;
    - the `/use` mapping.
  - **`kitchen-pantry-set.test.ts` (18 tests):**
    - the ladder: liquid, measure, multiples, empty, and Other's amount;
    - the suggestion: bucket, rest, pieces, use soon, first, and never more than what's left;
    - stepping and its ends;
    - the reason and "Changed from …";
    - Last: own moves, an undone one, a stock check skipped, the usual's, personal, and none;
    - who it starts with;
    - the cost each, including a buyer who had none;
    - drafts: round trip, a measure, parsing, and the cap.
  - **`kitchen-now-strip.test.ts` (10 tests):**
    - the heading;
    - strip usuals before use-soon, by count, then soonest;
    - the 4/6 caps with no repeats;
    - unloggable rows left out;
    - the tray's toggle, line, button and toast;
    - the usuals read in both frames (`{ limit: 10 }` unchanged; `limit=100` with `tzOffset` under the bucket key);
    - `msToNextBucket`.
  - `kitchen-pantry-fixtures.ts` gains `makeUsual`, `morningUsual` and `ONION`.
- `typecheck` and `lint` are clean for `@saas/web-console-next` and `@saas/web-console-next-tests`. `console-artifact.mjs build` serves 29 pages as files; `/pantry`, `/use` and `/home` stay static.
- **In the browser** (`next dev`, with the SM-15 in-page API mock extended with `now`/`strip` by `?tzOffset=`; no request left the machine), at 390×844 and 1280×800:
  - **The page:** the header, search, "NOW · EVENING" with Milk / Eggs / Dal makhani…, `All 20 · Use soon 7 · Running low 2 · Me · Flat 4B · …`, the use-soon card, Dairy · Veg · Fruit · Grains · Protein · Leftovers · Other with tags and coloured bars, "· Snacks" under Other, and Always have.
  - **Logging and Undo:**
    - The Milk chip logged "You + Anu · 1 glass · ₹8.50 each", and Undo reversed the txn back to 500 ml.
    - The set row showed Last, 1 glass · Evening usual → + → 2 glasses · Changed from 1 glass, then Anu → ✓ Use ("You + Anu · 2 glasses · ₹17.00 each"), and the row closed.
  - **The sheet:** personal and group sheets with faces, and Wasted's confirm.
  - **Log several:** 3 in the tray → three POSTs in order, one toast "Logged 3 for you · ₹29.00", and one Undo reversed all three.
  - **Arriving:**
    - `/use?item=` → `/pantry` with Milk open.
    - Home's field → `/pantry?focus=1`, with the search focused and the usual chips still on Home.
  - **Search, filter and fold:** search "dal" → Grains and Leftovers only, no strip. Running low → `?filter=low`. A folded Dairy survived a reload.
  - **Gestures:** a touch hold opened the sheet, and a touch swipe left logged with Undo.
  - **Fit:** no sideways scroll at 390 px, and every control is 44 px or more.
  - **Found and fixed during the check:** the cost each counted a buyer who had none ("≈ ₹5.67" for two people), and the set row's cost line was truncated beside five faces.
  - Today's frame (prod) wasn't opened in the browser: it needs a prod host. It is covered by the untouched code paths and the frame tests above.

**For later tasks:**
- **PN-6:** Finished this week goes in the marked slot in `pantry-new-ui.tsx`. Point `boughtHref` at `/pantry/run`. A row of Finished this week can reuse `RowTagPill`/`LevelBar`.
- **PN-7:** the item page's "Use some" still links to `/use?item=`, which now opens the row on the Pantry. It could link to `/pantry?open=` directly, or use `pantry-set.ts`'s ladder for its quick-use chips. `lastLine` already skips `via: "check"`.
- **PN-9:** pass `askName` to `pantryRow`, then draw the ask chip and set row for `variant === "ask"`.
- **Deploy:**
  - The new frame asks for `limit=100`, which needs PN-2's kitchen-worker (on main since #81). Today's frame still asks for 10, so prod is unaffected.
  - Only console files change, so only the console redeploys.

### PN4 — Ask before use in the server (PN-8)

**Built:** design §8.5, with migration 420, the SDK and tests. Nothing in the console changes.

**Migration 420 `420_kitchen_asks`** (registered with its sha256):
- `kitchen_items.ask_first INTEGER NOT NULL DEFAULT 0 CHECK (ask_first IN (0, 1))`. Every existing item reads 0.
- `kitchen_item_allowed (item_id → kitchen_items, member_id, created_at, PRIMARY KEY (item_id, member_id))`. The list is kept when `ask_first` is turned off.
- `kitchen_asks`:
  - `id` (`ask_` in the API), `org_id`, `item_id` → kitchen_items, `asker_id`, `qty_milli`, `unit`, `label`;
  - `consumers` (a JSON array, 1–100), `weights` (NULL, or one per consumer), `source` (`pantry`|`cook`);
  - `state` (`pending`|`approved`|`declined`|`canceled`), `created_at`, `expires_at` (+24 h), `answered_at`, `answered_by`, `move_id`, `txn_id`;
  - two columns the design didn't list: `granted` (0/1: this approval added the asker to `allowed`) and `idem_key` (unique per item).
  - CHECKs: approved ⇔ `move_id`; `txn_id` only when approved; pending ⇔ no answer.
  - Indexes `(item_id, state)`, `(asker_id, created_at)`, and unique `(item_id, idem_key)`.
- **Lapsing is read-side.** A pending ask lapses past `expires_at`, or once its item isn't active or isn't ask-first (`askIsLive`, `liveSql` in `packages/db/src/kitchen/asks.ts`).

**Who is who** (`apps/kitchen-worker/src/asks.ts`):
- **The answerer** is the buyer while they're a member, else the group's owners and admins (`MANAGE_ROLES`, pinned against the engine). The answerer is also the only one who sets `askFirst` and `allowed`.
- **Who must ask:** anyone else not in `allowed`, owners and admins included while the buyer is a member.

**Routes** (kitchen-worker; api-edge already forwards `/v1/…/kitchen/…`, so the edge is unchanged):
- **`PATCH …/items/{itm}`** takes `askFirst` (boolean) and `allowed` (up to 100 members, 422 `not_in_group` otherwise).
  - Anyone but the answerer gets 403 `not_buyer`, even an owner while the buyer is a member. Other fields keep the old rule.
  - A personal item refuses both with 422 field errors.
  - **`POST …/items`** takes the same two fields too (§8.1 "set on Add item"), only when the caller pays for the item (422 `askFirst` otherwise).
- **Item reads:** every group item carries `askFirst`. An ask-first item also carries `allowed`, `mustAsk` (for the caller) and `answerer` (null once the buyer has left) on:
  - a group's items, one item, and an edit's or add's answer;
  - every pantry and search;
  - the purchases answer;
  - the use, waste, check and approve answers.
  - The allowed lists are one more statement and the roster is fetched once per group, both only when some item asks first. The measures test's pinned counts are unchanged.
- **Refusals for someone who must ask:** 403 `forbidden`, `details: { reason: "ask_first", itemId, answerer }`, writing nothing. This covers:
  - `…/uses` and `…/waste`;
  - `POST /v1/kitchen/me/dishes` taking the item;
  - the check's `me` and `split` (PN-4's `groupCheckRefusal`). Owners, admins and the buyer may always check, and a raise or a check's `waste` stays open to anyone who may use the item (see departures).
- **`POST …/items/{itm}/asks`** (`kitchen.item.use`) takes `{ quantity, unit | measure, consumers?, weights?, source? }` and returns 201 `{ ask }`.
  - The amount is checked as a use's: 409 `insufficient_stock`, and 422 for a bad unit or measure.
  - Consumers must be in the group (422 `not_in_group`).
  - 409 `no_need` when the caller needn't ask: the buyer, someone allowed, an item that doesn't ask first, or an owner or admin once the buyer has left.
  - A retried key answers with the same ask. A key someone else used is 409 `idempotency_key_reused`.
- **`POST …/asks/{ask}/approve`** (the answerer) takes `{ alwaysAllow?, takeWhatsLeft? }` and returns 201 `{ ask, item, move, txn }`.
  - It writes one `db.batch` (`repo.approveAsk`):
    - the guarded ask update (not pending or past its time sets an invalid state, and the CHECK fails the batch);
    - PN-4's `planGroupUse(asker ctx, item, { via: "ask" })`: the txn and splits, the move with the asker as actor and the txn's `created_by`, and the item update;
    - the allowed insert with `alwaysAllow`;
    - the audit event.
  - The price and stock are that moment's. A stale item is planned again once.
  - Less left than asked is 409 `insufficient_stock` with `details.qtyLeftMilli`. With `takeWhatsLeft`, it approves what is left, in the item's unit, with no label.
  - The asker and every consumer must still be members (422 `not_in_group`).
  - The same key by the same answerer answers the same (at the worker and in the repository).
  - Anyone but the answerer gets 403 `not_buyer`. An ask in another group, or a bad id, is the opaque 404.
- **`POST …/asks/{ask}/decline`** and **`…/reopen`** (the answerer) and **`…/cancel`** (the asker; anyone else gets 403 `not_creator`) return 200 `{ ask }`.
  - Each moves from one state only, while the ask is live. A declined ask reopens only inside its 24 h.
  - A lapsed ask is 409 `lapsed`. Any other state is 409 `not_pending` with `details.state`.
  - The same answer repeated by the same person answers the same.
- **`GET /v1/kitchen/me/asks`** returns `{ toAnswer, mine }`, at most 50 each:
  - `toAnswer`: live pending asks in the caller's groups on items they bought, or, as an owner or admin, on items whose buyer has left. Oldest first.
  - `mine`: the caller's own asks from the last 24 h, in any state. Newest first.
- **`KitchenAsk`** (`packages/contracts/src/kitchen-asks.ts`) holds:
  - `id` and `orgId`;
  - `item { id, ref, name, pantry, displayUnit, qtyLeftMilli, qtyLeft, state }`;
  - `asker` and `askerName`;
  - `qtyMilli`, `quantity`, `unit`, `label`, and `amount` ("1 pinch");
  - `consumers` and `consumerNames`, and `weights`;
  - `source` and `state` (with `lapsed`);
  - `createdAt`, `expiresAt`, `answeredAt` and `answeredBy`;
  - `answerer` and `answererName`, and `paidBy`;
  - `costMinor` (now's price while pending, the move's once approved), `backMinor` (what returns to the buyer), and `currency`;
  - `enough`, `moveId` and `txnId`.
- **Undo** of an approval goes the existing way, `…/txns/{txn}/reverse` or `…/moves/{mov}/undo`.
  - Besides its logger and `reverse_any`, the person who approved it (`answered_by`) may now do either. That's needed because the use is the asker's.
  - The reversal's own batch (`ask-undo.ts`, wired into `reverseTxn` and `undoMove` for `via = 'ask'` moves only) does two more things. It puts the ask back to **pending**, or **canceled** when the asker undid it. It also deletes the allowed row that the approval granted.
  - Undo after Decline is `reopen`.
- **Home's inbox** (`GET /v1/kitchen/me/inbox`) gains `asks: [{ kind: "ask", ask }]`: the caller's `toAnswer`. That is one more statement.
- **Pushes,** through notifications-worker's push to a subject with the new kind `kitchen.ask`. Each is deferred after the commit, and a failure is logged and never fails the write:
  - **On an ask:** "Dev asks for 1 pinch of your saffron" / "For Dev and Anu · ₹12 to you", url `/home?ask=<askId>`, tag `askId`. It goes to the buyer, or to every owner and admin once the buyer has left ("… of the saffron", "₹12 to Meera").
  - **On approve:** to the asker, "Meera said yes · 1 pinch of saffron logged".
  - **On decline:** to the asker, "Meera said no to the saffron".
  - Both answer pushes carry the group's name as body and open the item page.
  - Reopen and cancel push nothing.
- **Purchases:** PN-3's `inheritedSettings()` copies `askFirst` and the item's `allowed` from an ask-first `fromItemId` in the line's own group (one more read only then).
  - The new pack is paid by the caller, so they become its answerer.
  - A line's own `askFirst`/`allowed` are ignored.
- **Usuals:** `via = 'ask'` uses count (PN-4 filters only `'check'`). A test pins it for the asker and a consumer.
- **SDK:** `askToUse`, `approveAsk`, `declineAsk`, `reopenAsk`, `cancelAsk`, `asks()`. `updateGroupItem` takes `askFirst`/`allowed` through the contract types. The PN-8 names are re-exported from `@saas/sdk`.
- **notifications-worker:** `PUSH_TO_SUBJECT_KINDS` gains `kitchen.ask` (contracts). Its `component.yaml` redeploy line is touched so it accepts the kind, and its handler comment is updated. It has no other change.

**Departures and decisions:**
- **The ask rows are their own list, `InboxResponse.asks`,** not a sixth `InboxItem` kind. The console's `NEW_TODO_RANK: Record<InboxItem["kind"], number>` (`new-home.ts`) would stop compiling, and the console isn't in this task. `counts` leaves the asks out, and the field is optional in the types (always sent). PN-9 renders it at the top of To do.
- **Admins ask too while the buyer is a member.** They're neither the buyer nor allowed. They may always run the stock check, though. The check refuses `me` and `split` only, as §8.2 lists; a raise and the check's `waste` stay open (risks PN-E).
- **Undoing an approval puts the ask back,** rather than leaving it approved with its move reversed. Both writes are in one batch, and it's cheap: two statements, on `via = 'ask'` moves only.
- **Reasons:** `ask_first` (403 `forbidden`); `no_need`, `lapsed` and `not_pending` (409 `conflict`), in `KITCHEN_ASK_ERROR_REASONS`. Existing reasons where they fit: `not_buyer`, `not_creator`, `insufficient_stock`, `not_in_group`. Error codes are unchanged.
- **Several pending asks** by one person on one item are allowed.
- **Repeats:** a repeated decline, cancel or reopen answers the same from the ask's state, with no stored key. The edge's 24 h key cache covers retries, so the worker keeps no `answer_key`.
- **A `PATCH` with the setting and other fields** checks both rights, then writes `updateItem` and then `replaceAllowed`. That's two writes; neither moves money.
- **Push words:** the item's first letter is lowercased ("saffron") unless its name starts with a capitalised pair ("MDH masala"). Whole rupees drop ".00".
- **The approval's audit event** (`kitchen.item.used`) has the approver as actor, and its payload carries `askId`, `askedBy`, `approvedBy` and `via`. The txn title is the plain use's ("Saffron (1 pinch)").
- **`KitchenItemRecord.askFirst` is optional in the types,** as `note` was. Every read sets it: `ITEM_COLUMNS` reads `ask_first`.

**Tests:**
- `tests/kitchen-worker` (35 suites, **798 tests**). `src/asks.test.ts` is new with 30 tests:
  - setting rights: the buyer; owners and admins refused while she's a member and allowed after she leaves; outsiders; bad values; Add item; personal refused; `MANAGE_ROLES` against the engine;
  - every refusal: `ask_first` on use, waste and dish, and on the check's `me`/`split` (owners and the buyer may check); `no_need`; 404 for a viewer or outsider; the amount's checks;
  - asking moves nothing, pushes the buyer, and shows in `toAnswer`, `mine` and the inbox;
  - approve posts the same money as a direct use on a twin item, with the asker as logger and `via: ask`, plus the yes push, the audit event, the replay and the second approval refused;
  - `alwaysAllow`, then a direct use;
  - `takeWhatsLeft`, at exactly the rest of the price;
  - the admins answering once the buyer has left, and a consumer who left refused;
  - undo by reversing the txn (back to pending, the grant taken back, approvable again), by the asker (canceled), and by the move's undo when there's no txn;
  - decline with its push, then reopen, and reopen after 24 h lapsed; cancel; 404 and 405;
  - lapsing at 24 h, on a finished item and when the setting is turned off, and approvable again once it's back on;
  - a retried ask; a stale item replanned; a failed push and no binding never failing the write;
  - Bought again copying the setting into the same group only, with the new buyer answering;
  - an approved use counting as a usual.
  - `inbox.test.ts`'s pins change on purpose: the empty inbox now carries `asks: []` (twice), and the read count is 13 (was 12) and 14 (was 13) with a third group.
- `tests/db` (32 suites, **844 tests**). `src/kitchen-asks-migration.test.ts` is new with 13 tests:
  - the registration;
  - the text;
  - the default and the CHECKs on real SQLite;
  - through the repository: allowed lists, the ask replay, approve in one batch with the grant and its replay, nothing written when the ask moved on, lapsed or the item went stale, the answers' states, the list reads and their index plans, and undo through `reverseTxn` and `undoMove` (pending, and canceled for the asker).
  - Two tests that run today's repository on an older schema now bring the schema up first, because `ITEM_COLUMNS` reads `ask_first`. They are `sqlite-schema.test.ts`'s 330 note test, which applies every later migration before reading, and the 410 test, which writes its pre-410 item by hand. What they check is unchanged.
- `tests/contracts` (27 suites, **271 tests**). `src/kitchen-asks.test.ts` is new with 3 tests. `kitchen-timers.test.ts`'s `PUSH_TO_SUBJECT_KINDS` pin now includes `kitchen.ask`.
- `packages/sdk` (**195 tests**). `src/__tests__/kitchen-asks.test.ts` is new with 6 tests.
- `tests/notifications-worker` (**151 tests**). One new test: an ask's push is carried.
- `tests/api-edge` (**587**, after `wire:fixture`) and `tests/web-console-next` (**1839**) pass unchanged. The console and its tests typecheck.
- `typecheck` and `lint` are clean for db, contracts, sdk, kitchen-worker and notifications-worker, and for the test packages.

**For later tasks:**
- **PN-9:**
  - Render `InboxResponse.asks` first in To do, and `/home?ask=`.
  - A row reads `item.mustAsk`/`item.answerer` ("Ask Meera"; null means "Ask an admin"). `mine` drives the row's "Asked Meera · waiting" and Cancel.
  - Undo after Approve is `reverseTxn(txn.id)`, or `undoGroupMove(move.id)` when `txn` is null. Undo after Decline is `reopenAsk`.
  - A cook session's line sends `source: "cook"`.
  - `askFirst`/`allowed` on Add item work only when paying yourself.
- **Deploy order:**
  - `ITEM_COLUMNS` now reads `ask_first`, so migration 420 must apply before this kitchen-worker serves. As with PN-4, kitchen-worker's enforced `db-migrate` edge orders it, and the new migration directory plans `db-migrate` by path.
  - notifications-worker must be redeployed (its redeploy line is touched) before ask pushes are accepted. Until it is, they're refused with 422 and logged, and every write still succeeds.
  - kitchen-worker changes in its own path, so it redeploys.
  - The console has no change here, and picks up the contracts and SDK when PN-9 changes its files.
- **A bound:** `toAnswer` reads at most 50 live asks before it drops, for an owner or admin, those whose buyer is still a member. A group with more than 50 pending asks could hide some until others are answered.
