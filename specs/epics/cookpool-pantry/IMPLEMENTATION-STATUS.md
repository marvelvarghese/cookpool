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

### PN3 — The item page and the stock check screen (PN-7)

**Built.** Console only, all behind `newFrame()`. No route, no migration, no SDK or contracts change: it uses PN-4's `checkGroupItem`/`checkPersonalItem`, PN-3's `buy`/`undoPurchase`, and PN-2's `suggestUse`/`isRunningLow`. With `newFrame()` false, the item page renders exactly what it did. `ItemView` picks its frame at the top (`newFrame() ? <NewItemView/> : <TodayItemView/>`), and today's code below it is unchanged. `/pantry/[itemRef]/check` sends a visitor to `/pantry`.

- **The item page** (`app/(kitchen)/pantry/[itemRef]/page.tsx`, with its parts in `item-page-ui.tsx` and its pure model in `item-page.ts`, design §5, the canvas's ItemPage). On a phone it reads top to bottom:
  - **The level ring** (`levelRing`): what's left, the percentage in the ring, "of 2 L", "₹34 left of ₹68" (`shortMoney`), its price once and who paid, and the use-by chip while anything is left. The ring's colour is the Pantry's level rule: PN-5's `itemStatus`/`levelTone` and `LEVEL_COLORS`.
  - **The quick-use chips** (`quickChips`): the §2.2 suggestion with its reason under it, the next two steps of the Pantry's ladder (PN-5's `itemLadder`, so the page offers what the row offers), and **More…**, which opens PN-5's `UseSheet`.
    - When the suggestion is near the top of the ladder (the rest), the chips are the two steps under it.
    - A tap logs that amount through `useLogUse`, with the ten-second Undo. It's logged for the suggestion's people, else the people from last time (`defaultConsumers`).
  - **"At this rate it runs out Sat"** with "About 200 ml a day" under it (`runOutEstimate`, in `item-use.ts`).
  - **Who had it** (`whoHadIt`/`whoHadItLine`). Group items only. One tile per person: their share ("½", "⅓", else "45%"), what they had, and what it cost them.
  - **History**, with Undo on your own entries. With `stockChecks`, a check's moves read as the check:
    - "Stock check · 250 ml split with Flat 4B", "… used by Anu", "… went bad", "… more than thought";
    - the checker's name goes on the line under ("Anu · 2 h ago");
    - an undo reads "Anu undid a stock check: 250 ml back", or "… off" for an undone raise.
    - With `adjusts`, a check's raise can be undone. `undoRefusal` reads `insufficient_stock` as "Already used".
  - **Note and Counted as**: the existing cards.
  - **Actions:**
    - **Bought again** (`useBuyAgain`): see below.
    - **Finish it**: logs the rest for the people from last time.
    - **Wasted**: the existing confirm.
    - **Fix how much is left**: opens the check.
    - **Cook with it**.
    - **Move to a group**: stays, for your own unused item.
  - There's no sticky Use some in the new frame. The chips and More… are how you use an item from its page.
- **Bought again** (`buy-again-data.ts`, design §6.2):
  - One tap writes `kitchen.buy([boughtAgainLine(item, today)])`. The line is like last time:
    - the same pantry, name, kind and price;
    - the amount from `qtyBoughtMilli` in the unit it was bought in;
    - a use-by as many days from today as it was from the day it was bought;
    - `fromItemId`, so the server copies the waste rule into its own group.
  - The new item is listed at once (`pendingItem`/`itemAddedPatches`).
  - The toast reads "Bought Milk · ₹68 · Change · Undo". **Undo** is `undoPurchase`. **Change** takes the purchase back the same way, then opens `/pantry/new?from=<itemRef>` (`buyLikeHref`).
- **The stock check** (`/pantry/[itemRef]/check`, a static page with the `[itemRef]` layout's `ParamShell`; `stock-check-ui.tsx`; pure model `stock-check.ts`; write `stock-check-data.ts`; design §7, the canvas's StockCheck):
  - **The title:** "How much is left?", with "Milk · Flat 4B" under it.
  - **The level:** a tall level you drag (`levelAt`, pointer capture, `touch-action: none`), with a dashed line at what Cookpool thinks.
    - The marks are Full, ¾, ½, ¼ and Empty of what was bought (`checkMarks`).
    - The keys (`levelKeyOf`/`stepLevel`): arrows move a step, Page Up/Down to the next mark, Home to Empty, End to Full.
    - It's `role="slider"`, with `aria-valuetext` "750 ml of 2 L".
    - The step suits the item (`checkStep`): 50/25/10/5/1 g or ml, so there are at least 20 steps to Full; for things you count, a piece, a half or a quarter.
    - A drag lands on a mark, or on what Cookpool thinks, when it's within half a step. Arrow keys stop there on the way. The level never goes above Full.
  - "Cookpool thinks 1 L · You say 750 ml".
  - **For less**, "Where did 250 ml go?" (`checkOptions`, a radiogroup). Each answer's money line comes from the engine helpers the use and waste previews use (`shareBreakdown`, `wastePreview`, `eachText`):
    - **Split with Flat 4B**: "≈ ₹2.13 each", or "₹2.00 each" when it divides evenly. It's the default and comes first for a group item.
    - **I used it**: "₹8.50 to you · Meera gets it back"; for the buyer, "₹8.50 · you paid, so no money moves"; for your own item, "Logged as yours".
    - **It went bad**: "Waste · ≈ ₹2.13 each", "Waste · Meera absorbs it", or "Waste · Nothing to split".
    - Your own item never offers Split.
    - Split's and waste's lines wait for the group's members, and Fix waits with them.
  - **For more**, "More than Cookpool thought. Fixing it moves no money."
  - **The main button** (`fixButton`) reads **Fix to 750 ml** ("Fix to empty" for none).
    - At the level Cookpool thinks, it reads **It's right**, looks disabled, and goes back without writing anything.
    - Fix writes the check (`checkRequest`), shows it at once (`checkWrite`), and goes back to the item page.
    - The request body is `{ left: { quantity: "750", unit: "ml" }, gone }`. `gone` is sent only for less, and never `split` on your own item.
    - On screen right away: a take shows the use or waste of the difference with its cost; a raise shows `stockReturnPatches` with no money. Either way the history gains a row with `via: "check"`.
    - The toast: "Fixed Milk to 750 ml · 250 ml split with Flat 4B · ≈ ₹2.13 each" (`checkToast`), or "· No money moved.".
    - Undo is `reverseTxn` when the answer has a `txn`, else the move undo. A raise's undo answering `insufficient_stock` reads "Already used · What the check added has been used since." (`checkUndoRefusal`).
    - A refusal puts everything back and says why (`checkRefusal`).
- **The routes' tables:**
  - `STATIC_PAGES` gains `/pantry/:itemRef/check`. `next build` prerenders it as `/pantry/_/check` (●).
  - `console-artifact.mjs build` reports 30 pages served as files and 14 `_redirects` rules. The check's rule comes before the item's.
  - `back.ts` sends it back to `/pantry/<itemRef>`, at depth 2, and the step there is `forward`.
  - It's in `NEW_FRAME_ONLY`, sending today's frame to `/pantry`.
  - It doesn't pull to refresh.
- **The toast** gains a second, quieter action: `secondary` in `components/ui/toast.tsx`, and `extra` on the `UndoOffer`. A refusal drops it.

**Departures and decisions:**
- **`runOutEstimate(moves, item, now)`:**
  - **What counts as used:** the uses and dishes still in effect (a check's use included), less what a check's raise found still there.
  - **The rule:** at least 2 of them, and at least 2 days since the bought-on day (from its UTC midnight).
  - **Days** are the viewer's, by `localDayOffset`: "today", "tomorrow", then the weekday up to 6 days ahead.
  - **Weeks:** from 7 days on it says "in about N weeks", rounded, and "in about a week" for one.
  - **When there's none:**
    - a use-by before the estimate's day ends, including one already past;
    - a finished item;
    - nothing used, net.
  - **The rate line** ("About 200 ml a day", the canvas's) is an addition. It's rounded to two figures, and given per week when a day's amount is under 1 g or ml (or a tenth of a piece).
- **Who had it** counts uses only. Dishes and waste aren't anyone's share. It's shown for group items with at least one use, never for your own pantry. Each tile also shows what that person had and what it cost them (the canvas's tiles).
- **History** reads check moves in the item's own unit ("1.75 L"), not the unit the check sent.
- **A raise's Undo isn't latest-only** in history, as the server allows. Its checker, or an owner or admin, can undo it.
- **Bought again** shows to whoever may add to the pantry, on finished items too, and so does **Fix how much is left**: a check can wake a finished item (PN-4). The note isn't copied: a note is about one pack.
- **Change undoes the one-tap purchase before opening the form,** so changing it never leaves two. `/pantry/new?from=` doesn't prefill yet. PN-6 adds that, and the link is already in place.
- **The check's title** is "How much is left?" with the name under it, not "How much milk is left?", so any name reads ("Eggs").
- **Split comes first** among the answers, as on the canvas. The design lists I used it first.
- **More… opens PN-5's `UseSheet`.** Its Open goes to the page it's opened from.
- **The chips show the first step until the usuals arrive** (PN-5's `useUsuals`, per part of the day), then swap to the suggestion, as the Pantry's rows do.

**Tests** (`tests/web-console-next`, pure modules only):
- The package has 93 suites and **1885 tests**. 46 of the tests are new.
- `kitchen-item-page.test.ts` is new, with 25 tests:
  - `runOutEstimate`: the 2-use and 2-day rule, undone uses, the weekday, today and tomorrow, weeks, dishes, a raise taken off, a use-by inside or past, finished items, the weekly rate.
  - The ring and its worth, tone and dash.
  - The chips on PN-5's ladder: the first step, a bucket usual with its people, the rest with the two steps under it, never more than is left, and the measure they log in.
  - Who had it: shares, the engine's split with the odd paisa, ties, a use naming nobody.
  - Share text.
  - Check history: every label, the checker line, the unit, an undone raise, and today's labels unchanged with `stockChecks` off.
  - A raise's Undo in the new frame only.
  - Bought again's line, toast, links, who sees it, and its refusals.
- `kitchen-stock-check.test.ts` is new, with 18 tests:
  - the marks;
  - the step sizes;
  - drag snapping and the cap at Full;
  - every key;
  - the level's words;
  - the difference and its words;
  - the answers for group and personal items, with money previews, among them ₹8.50 four ways (213/213/212/212, checked against `buildUse` and `buildWaste`), ₹2.00 even, empty at ₹34 three ways (1134/1133/1133), the buyer's own answers, buyer absorbs, a group of one, and members still loading;
  - the Fix label;
  - the request bodies (group, more, capped, personal, count and mass units);
  - the optimistic take and raise;
  - the toasts;
  - the refusals;
  - the route's place in the app (static, back parent, depth, transition, the frame redirect).
- `static-pages.test.ts`: the redirect count goes from 13 to 14, and there's a new test for the check's rule and files. `gestures.test.ts` lists the check as not pulling. `kitchen-back.test.ts` adds its parent.
- `typecheck` and `lint` are clean for `@saas/web-console-next` and `@saas/web-console-next-tests`. `console-artifact.mjs build` passes, with the check static.

**Browser check** (390 × 844, `next dev` behind the SM-2 proxy with an in-page mock of the API; nothing reached the network, by the network log):
- **Milk** (2 L, ₹68, 1 L left):
  - The ring read 50 %, "1 L of 2 L", "₹34 left of ₹68".
  - The chips read "1 glass · Midday usual · 2 glasses · 3 glasses · More…".
  - "At this rate it runs out Sat · About 180 ml a day".
  - Who had it showed five tiles, and the history read "Stock check · 250 ml split with Flat 4B · Anu · Yesterday".
- **A chip** logged 2 glasses for you and Anu: the ring changed at once and the toast read "₹8.50 each · Undo".
- **The check:**
  - Arrow keys, a drag to ⅜ (750 ml) and the marks all set the level.
  - "Where did 250 ml go?" offered Split (₹1.70 each over five members), I used it (₹8.50 to you · Meera gets it back) and It went bad.
  - At the thought level the button read "It's right", muted.
- **Writes:**
  - **Fix to 750 ml:** sent `{ left: { quantity: "750", unit: "ml" } }`, went back to the page, and the toast read "No money moved". The history row read "Stock check · 250 ml more than thought", and its Undo took it back off.
  - **Fix to empty, split:** the toast's Undo reversed the transaction and the ring came back at once.
  - **Raise to Full, then Finish it, then undo the raise:** read "Already used".
  - **Eggs** (personal): offered I used it and It went bad only, and sent `gone: "me"` in pcs.
- **Bought again:** sent the line above. The toast read "Bought Milk · ₹68 · Change · Undo", and Change deleted the purchase and opened `/pantry/new?from=…`.
- **More…** (after merging PN-5) opened the Pantry's sheet.
- **The old frame**, on a host naming prod: Tomatoes read exactly as before (stock card, Cook with it, Wasted, history, Use some), and `/…/check` went to `/pantry`.
- **Fixed on the way:** "Fix how much is left" was clipped at 390 px, and the check's title read "How much Eggs is left?".

**For later tasks:**
- **PN-6:**
  - Prefill `/pantry/new?from=<itemRef>` with `historyFill`. Bought again's Change already links there.
  - The finished rows can call `useBuyAgain` (`buy-again-data.ts`) as it is. `boughtAgainLine` builds a line from any item.
- **PN-9:**
  - Who can use it goes on the item page's right column.
  - An ask's use (`via: "ask"`) has no label of its own yet. `checkMoveText` is where one would go.
- **Deploy:** only console files change, so only the console redeploys. The check route, purchases and usuals it calls are on main and deployed (#81–#83).

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

### PN2 — Restocking in the app (PN-6)

**Built.** Console only, all behind `newFrame()` (design §6.1–§6.3, the canvas's PantryNew and BuyAgain). No route, no migration, no SDK change: it reads and writes PN-3's routes. With `newFrame()` false, `/pantry`, `/pantry/new` and Home render what they did (checked in the browser on a host naming prod), and `/pantry/run` sends its visitor to `/pantry`.

- **Finished this week** (`finished-ui.tsx`, `restock.ts`), in PN-5's slot above Always have:
  - One row per `restock().finished` line: the name, then "Finished Tue · Flat 4B", or "Went bad Tue" when `why.how` is `wasted`. "today" and "yesterday" read as words, the weekday within six days, else the date, all in the viewer's calendar.
  - **Bought again** on each row the caller can add to (`canAdd`). A viewer's row shows without it.
  - The heading folds it like the kinds, in the same device memory (`<prefix>.pantry-folded`, key `finished`). It stays open while searching.
  - It shows every line on All, a pantry's lines on its chip, and none under Use soon or Running low; the search narrows it. It isn't drawn when empty. It also shows under the empty Pantry, when everything is finished.
  - The read is `GET /v1/kitchen/me/restock`, keyed `["kitchenPantry","restock"]` (`qk.kitchenRestock`), so every stock write and purchase reads it again.
- **Bought again** is PN-7's `useBuyAgain` (`buy-again-data.ts`), not a second hook:
  - A restock line becomes the item it buys like with `boughtAgainItem(line, { today, groupWastePolicy })`: its `last` as an untouched item (the same `itm_` id, name, kind, pantry, amount in its unit, price, currency, the use-by gap from today, and its waste rule).
  - PN-7's `boughtAgainLine` then writes the one line: `{ pantry, name, category, quantity, unit, priceMinor, currency, fromItemId, expiresOn? }`. The toast reads "Bought Brown bread · ₹45 · Change · Undo".
  - **Undo** is `undoPurchase`. **Change** undoes it and opens `/pantry/new?from=<itemRef>` of the line's `last.itemId`.
  - **Added to PN-7's hook:** its optimistic write also takes the name off the restock read (`restockBoughtPatch`), so a finished row leaves Finished at once and its new item shows in its kind. Undo puts both back.
  - **On a running-low row's More… sheet** (PN-5's `UseSheet`, a new optional `buyAgain` on its target): "Bought again · ₹250" under Finish it · Wasted · Cook with it. It buys like the matching `runningLow` line (by `why.itemId`, else name and pantry), or, for a row that is low only by its usual, like the item itself. A viewer's or a pending row has none.
- **`/pantry/new?from=<itemRef>`** (new frame only, `addFormFrom`):
  - It reads that item (`useKitchenItem`), maps it to a From-before entry (`historyEntryOfItem`) and fills the form with the existing `historyFill`. It reads "Filled from last time · change anything", with focus on Add.
  - The payer is you: Change is you buying it again. A group you no longer add to falls back as `historyFill` does.
  - An item that can't be read leaves the form empty, after the read's retry.
- **The shopping run, `/pantry/run`** (`shopping-run.ts`, `shopping-run-ui.tsx`, `app/(kitchen)/pantry/run/page.tsx`):
  - Header: ✕ Close (the back control's action), "Shopping run" and "Tick what you bought · change what differs".
  - FINISHED, RUNNING LOW and YOU USUALLY BUY, in the server's order, empty groups left out. Each line reads "Like last time: 2 L · ₹136 · Flat 4B" until ticked, then its why: "Finished Tue", "600 g of 5 kg left", "Every 4 days · last Sun".
  - **Ticking** (a 44 px tick; nothing ticked to start with) opens:
    - − [amount] +, starting at last time's amount. The ladder is half of it when that's a whole amount (a gram or ml or more, or whole pieces), then ×1 … ×7. − and + are PN-5's `stepFrom`/`canStep` over `LadderStep`s.
    - The price: last time's scaled to the amount, to the paisa (`scaledPrice`), editable. A typed price stays until the amount changes. Money is parsed to minor units (`parseMinor`).
    - The pantry chip, which opens the pantries you add to (yours, and groups where you aren't a viewer). Moving to a pantry in another currency empties the price until one is typed.
  - A line in a pantry you only view (`!canAdd`) can't be ticked: a lock, and "You only view Lunch club".
  - **Something new** opens `/pantry/new`.
  - **The footer:** "Paid by you · each goes to its own pantry" (or "Price for Milk" while a price doesn't read), then **Add 3 · ₹640**, or a muted "Tick what you bought". Currencies total apart ("₹56 + $3.20").
  - **Add** is one `POST /v1/kitchen/me/purchases`, the ticked lines in the run's order. Each line is `{ pantry, name, category, quantity, unit, priceMinor, currency, fromItemId, wastePolicy?, expiresOn? }`. `wastePolicy` is sent only into the line's own group; `fromItemId` is always sent.
  - It's optimistic (`useShoppingRun`): every item listed at once and its name off the restock read, then back to where you came from. The toast reads "Added 3 to your pantries · ₹640 · Undo". Undo is one `undoPurchase`; when something was used meanwhile it reads "Someone already used some · Milk stays in the pantry · 2 taken off." A refusal puts it all back and says why in one line.
- **+ Bought** (`boughtHref`) now opens `/pantry/run`. The empty search's "Bought it?" still adds one item (`addItemHref`).
- **Home:** in the new frame, a small **+ Bought** beside "What did you use?" (`quick-use-ui.tsx`) opens the run. Today's frame keeps the field alone.
- **The page's place:** `/pantry/run` is in `STATIC_PAGES` (pinned before the item's rule), `NEW_FRAME_ONLY` (→ `/pantry`), `back.ts` (parent `/pantry`), and doesn't pull to refresh. `console-artifact.mjs build` reports it static (○) and serves 31 pages as files with 15 `_redirects` rules.
- **Shared files, all additive:**
  - `query-keys.ts`: `kitchenRestock`.
  - `use-sheet-ui.tsx`: the optional `buyAgain` and `onBoughtAgain`.
  - `buy-again-data.ts`: the restock patch.
  - `pantry-list.ts`: `boughtHref` and `addItemHref`.
  - `pantry-new-ui.tsx`, `quick-use-ui.tsx`, `pantry/new/page.tsx`, `static-pages.mjs`, `features.ts` and `back.ts`.
  - The toast's second action (`secondary`, `extra`) was written identically to PN-7's while both were open, so the merge took one copy.

**Departures and decisions:**
- **No `useBoughtAgain` of PN-6's own.** PN-7 landed `useBuyAgain` first. Finished rows and the sheet call it with `boughtAgainItem(line)`, so there's one Bought again write. Its line sends no `wastePolicy`: the server copies `fromItemId`'s rule into its own group (PN-3), which is the same item.
- **Running low's why reads "600 g of 5 kg left",** not "lasts about 3 days". The restock read carries no rate, and the item page's `runOutEstimate` needs the moves.
- **A usual's why** says "Every week", "Every 2 weeks", "Every day · yesterday", and "last 27 Oct" for a date over six days back.
- **The why shows once ticked, Like last time before** (the canvas does this). The group headings say which group a line is in.
- **The quantity ladder goes up to ×7,** with half below, because a purchase isn't capped by what's left the way the set row's is.
- **Change on Bought again opens the last purchase's item** (`last.itemId`), the one the line was copied from, not the new one it undoes.
- **After Add** the run goes back (the Close action) rather than pushing `/pantry`, so Back doesn't return to a spent run.
- **The More… sheet's Bought again** shows only on running-low rows, as the design says, not on every row.

**Tests** (`tests/web-console-next`, pure modules): **95 suites, 1,917 tests**, 32 of them new.
- `kitchen-restock.test.ts` (18):
  - Finished rows: used up and went bad, the weekday, today, yesterday, a date, the label and price, canAdd, the choices and search, empty, folding.
  - Bought again's line from `last` through PN-7's `boughtAgainLine`: the amount in its unit (L, kg, ml, dozen, pcs), the price and currency, the pantry ("personal" or the group), `fromItemId`, no payer and no waste rule, and the use-by from today (none, 0, 14 across a month). Also `boughtAgainItem` itself, the toast, and Change's href.
  - The Undo's words, all removed or some kept; the refusals; the restock patch.
  - `?from=`: the ref, the new frame only, the mapping to the history entry with you as payer, the fill through `historyFill`, and the fallback pantry.
  - Today's frame: `/pantry/run` → `/pantry`, Home's field → `/use`.
- `kitchen-shopping-run.test.ts` (12):
  - the groups, their order and dropping empty ones;
  - every why and Like last time;
  - `!canAdd` untickable;
  - nothing ticked to start with;
  - ticking's defaults, and untick;
  - the ladder (half when whole, ×2 …, its ends);
  - price scaling and a typed price reset by a step;
  - pantry change (personal, no waste rule; another currency empties the price and blocks Add until typed);
  - a price that doesn't read;
  - the count, total, label and toast;
  - the request body in order;
  - no use-by when none, and mixed currencies.
- `kitchen-restock-fixtures.ts` is new (restock lines).
- Changed: `kitchen-pantry-new.test.ts` (+ Bought → `/pantry/run`, `addItemHref`); `static-pages.test.ts` (15 rules with PN-7's, and the run's pin); `gestures.test.ts` and `kitchen-back.test.ts` (the run).
- `typecheck` and `lint` are clean for `@saas/web-console-next` and `@saas/web-console-next-tests`. `orun task check PN-6 --base origin/main`: affects ok.

**Browser check** (390 × 844, `next dev` behind the SM-2 proxy with PN-5's in-page API mock plus finished items, the restock read computed from them, purchases and their Undo; no request left the machine):
- **Pantry:** FINISHED THIS WEEK 4 read Saffron · Finished yesterday · Lunch club (no button, a viewer), Coriander · Went bad yesterday · Flat 4B, Brown bread · Finished Fri · Flat 4B, and Curd · Finished Thu · Me, in a dashed card.
- **Bought again:**
  - With the server held 5 s, Curd left Finished and was listed in Dairy at once. The toast read "Bought Curd · ₹60 · Change · Undo".
  - On Coriander, Undo took it out of Veg and put it back in Finished at once, then sent `DELETE …/purchases/pur_…`.
  - Change sent the DELETE and opened `/pantry/new?from=org:…:itm_…` filled from Coriander: Flat 4B, 1 pc, ₹20, Veg, You paid, "Filled from last time".
  - The line sent: `{ pantry: "org_…f1a", name: "Brown bread", category: "grains", quantity: "1", unit: "pcs", priceMinor: 4500, currency: "INR", fromItemId: "itm_…20", expiresOn: "2026-11-16" }`.
- **The sheet:** Atta's More… (running low) ended with "Bought again · ₹250", and it toasted "Bought Atta · ₹250 · Change · Undo".
- **The run:**
  - It read FINISHED (Saffron locked), RUNNING LOW (Atta) and YOU USUALLY BUY (Potatoes, Coffee), with "Tick what you bought" muted.
  - I ticked Brown bread, Atta and Coffee ("Add 3 · ₹745"), stepped Atta to 2.5 kg (₹125), typed ₹470 for Coffee, and moved Coffee to Flat 4B. The chips offered Me · Flat 4B · Goa trip, not Lunch club. It read "Add 3 · ₹640".
  - Moving Brown bread to Goa trip emptied its price to "$" with a red border, and the footer read "Price for Brown bread".
  - **Add 3** sent one POST with three lines (Coffee into Flat 4B without a waste rule), went back to the Pantry with the three listed, and toasted "Added 3 to your pantries · ₹640 · Undo".
  - A second run (Curd, Potatoes) had its Undo take both off at once and send one DELETE.
- **Home:** "+ Bought" beside the field opened the run, and Close went back to Home.
- **Fit:** no sideways scroll at 390 px, and every control is 44 px or more. The price box is the label around its input.
- **Fixed on the way:** the pantry chip read 42 px wide.
- **Today's frame** (`cookpool-prod.localhost`, the mock answering `/api`): the Pantry was today's (All · Soon · Expired, no Finished, no restock read), `/pantry/run` went to `/pantry`, Home's field went to `/use` with no + Bought, and `?from=` read no item and left the form empty.

**For later tasks:**
- **PN-9:** asks don't touch restocking. A purchase line's `fromItemId` already lets the server copy ask-first (PN-8).
- **Not done:** the service worker's `API_READS` doesn't keep `/v1/kitchen/me/restock`, so offline the Pantry shows no Finished section. Add it there if wanted.
- **Deploy:** only console files change, so only the console redeploys. It then also picks up PN-8's contracts and SDK, which are additive. The restock and purchase routes are on main and deployed (#82).

### PN4 — Ask before use in the app (PN-9)

**Built.** Console only, all behind `newFrame()`. No route, no migration, no SDK or contracts change: it uses PN-8's `askToUse`, `approveAsk`, `declineAsk`, `reopenAsk`, `cancelAsk`, `asks()`, `updateGroupItem({ askFirst, allowed })`, the item fields `askFirst`/`allowed`/`mustAsk`/`answerer`, and `InboxResponse.asks`. With `newFrame()` false nothing changes: today's Pantry never passes `askName`, today's Home passes no ask cards, the item page's and Add item's parts render only in the new frame, and the asks are never read.

- **The modules:**
  - `ask-before-use.ts` (pure): who sets it, the choices, the chips, the explainer, the PATCH and Add item's fields; `askName` for PN-5's row seam; an ask's state as the row says it; the row's end; the request; what a write shows at once (`pendingAsk`, `withMineAsk`, `withAskChanged`, `asksPatch`, `askItemPatches`, `askFirstRefusalFields`).
  - `ask-card.ts` (pure): Home's card, the answer bodies, the answered texts, the Undo each takes, the refusals, `askCardsShown`, `parseAskParam`, `askArrival`.
  - `ask-data.ts`: `useAsks` (`GET /v1/kitchen/me/asks` under `qk.kitchenAsks()` = `["kitchenPantry","asks"]`, so every stock write reads it again; read again every 20 s while one of yours waits, and the pantry is read again when one stops waiting), `useAskToUse`, `useCancelAsk`, `useAnswerAsk`, `useSaveAskSetting`, `useCookAsk`, `useSessionAsks`, `useMinuteNow`.
  - `ask-ui.tsx`: `AskStatusLine`, `AskWaitBox`, `ASK_BUTTON`, `AskSettingFields`, `ItemAskSetting`. `ask-card-ui.tsx`: `AskCards`.
- **Who can use it** (§8.1, the canvas's AskSetting):
  - **Who sees it:** the answerer only — `item.answerer`, or, on an item that doesn't ask yet, its buyer while in the group, else an owner or admin (`canSetAsk`). Never on your own pantry's item or a finished one.
  - **The card:** "WHO CAN USE IT" with the radios "Anyone in Flat 4B · Use it like everything else" / "Ask me first · You approve each use"; with Ask me first, "NEVER NEED TO ASK": who is on the list (face, first name, ×), then "+ Name" for every other member who can use items (no viewers, never the answerer or you); then the three lines ("Others see Ask Rahul instead of Use." · "Nothing comes off and no money moves until you approve." · "You get a push. An ask lapses after 24 h.").
  - **The item page** puts it in the right column under Counted as. **Save** shows once something changed and sends `{ askFirst: true, allowed }` or `{ askFirst: false }` (members only; nothing when unchanged), at once in every cached read of the item, with the toast "Saved · others ask you first" / "Saved · anyone can use it" and Undo, which PATCHes back `{ askFirst, allowed }` as they were.
  - **Add item** shows it after "If it goes to waste" for a group item you pay for, and sends `askFirst: true, allowed` with the create (nothing for Anyone). `?from=` an ask-first item starts it on Ask me first with that list.
- **Asking** (§8.2, the canvas's AskRequest):
  - **The row:** `pantryRow(item, { askName })` (PN-5's seam) — the tag "Ask Meera" (now amber, as on the canvas), no log chip; at the end, the ink chip **Ask Meera**, which asks for the suggestion for the people from last time (`askRowEnd`). The ask's line goes under the level: "Asked Meera · 1 pinch · waiting · lapses in 24 h", then "Meera said yes · logged" / "Meera said no" / "Lapsed" for 2 h after the answer (`ASK_ANSWER_SHOWN_MS`); a cancelled ask shows nothing. While it waits the end is **Cancel**.
  - **The open row:** the main button reads **Ask Meera** (ink, with a lock) and asks for the amount and faces set; while it waits the row shows the wait box ("Asked Meera · 1 pinch" over "Waiting · lapses in 24 h · nothing logged yet") with Cancel.
  - **The More… sheet:** "Ask Meera · 1 pinch" over who it's for; **Ask for the rest**; "Nothing comes off until Meera says yes". Wasted and Cook with it are hidden for them (the server refuses both). While it waits, the wait box.
  - **The item page:** the header chip "Ask Meera"; "Each tap asks Meera" over the quick chips, which ask; the wait box while it waits; **Ask for the rest** in place of Finish it; no Wasted or Cook with it.
  - **The write** (`useAskToUse`): the ask is in your asks at once (its row reads waiting before the server answers; Cancel waits for the server's id); the toast "Asked Meera · 1 pinch · Nothing comes off until they say yes." with Undo, which cancels it. The body is a use's (`{ quantity: "1", measure: "pinch", consumers }` or `{ quantity: "250", unit: "ml", consumers }`; `source` only from a cook session).
  - **`no_need` (409):** the same amount is logged as a use (`useLogUse`), and the item's `mustAsk` goes false in every read.
  - **`ask_first` (403) on a use:** the toast says "Couldn't log Ghee · Ask Meera first" and the item's rows turn into the ask row at once (`askFirstRefusalFields` → `askItemPatches`). New frame only; today's refusal words are unchanged.
  - **Cancel** (`useCancelAsk`): at once, toast "Ask cancelled"; a refusal puts it back ("It was already answered.").
  - **The stock check:** for someone who must ask, only **It went bad** is offered (and is the default), with "Ask Meera to log what was used" (`checkAskNote`).
- **Answering** (§8.3, the canvas's AskApprove): Home's To do starts with `InboxResponse.asks` as cards (`HomeTodoList`'s new `lead` slot; with asks, To do is never "All clear"):
  - the asker's face, "Dev asks for 1 pinch of saffron", "For Dev and Anu · asked 2 min ago · 1.4 g left", the blue money line "If you approve · ₹12 back to you" (`backMinor`; "No money moves" at 0), the switch **Always let Dev use saffron** (`role="switch"`, `aria-checked`), **Decline** and **Approve**; an amber border while it waits.
  - **Not enough** (`enough: false`): "Only 0.03 g left" and **Approve what's left** (`takeWhatsLeft`). An approval refused with `insufficient_stock` turns the card into that.
  - **Approve** shows at once "Approved · Dev and Anu owe you ₹12" over "1 pinch of saffron logged for Dev and Anu" (or "Dev won't need to ask for saffron again" with the switch), then the server's words; what's left reads as what's left. **Undo** is `reverseTxn`, or `undoGroupMove` without a txn.
  - **Decline** shows "Declined · Dev was told · Nothing was logged"; **Undo** is `reopenAsk`.
  - An answered card stays in its place with Undo until you leave Home (the inbox has moved on); Undo lists it again at once.
  - **`/home?ask=<askId>`** scrolls to that card and lights it (amber ring, 4 s), then drops `?ask=`; an ask already answered or lapsed says "Already answered".
- **The cook session** (§8.4, RC-6's screen and GC-5's Gather):
  - A line taking from an item the cook must ask for (`lineAskTake`) reads **Ask Meera** (an ink pill) in the tick's place. It isn't tickable, isn't counted in "0 of 1 in" or the unticked count, and is never in the dish write (`includedLines`, `soFarMinor`, `finishPlan`).
  - Tapping it sends `{ quantity, unit (the item's base), consumers: [cook], source: "cook" }` for what the line takes from that item. The draft keeps the ask on the line (`SessionLine.ask`, optional, so older drafts read as before).
  - The line then reads "Asked Meera · waiting · lapses in 24 h" with Cancel (an hourglass in the tick's place), "Meera said yes · logged as yours" (a check; still out of the dish, even if Always let means Dev may now use it), "Meera said no" or "Lapsed" with **Ask again** while it still must ask. `useSessionAsks` keeps the lines' asks as `mine` has them (`syncLineAsks`); a cancelled ask comes off its line.
  - `refreshTakes` now also notices `mustAsk` changing (it doesn't bump the item's version).
- **History** (PN-7's `checkMoveText` seam): a `via: "ask"` use reads "Dev and Anu · 1 pinch" with "Asked · approved by Meera · 2 h ago" under it (`askMoveText`).
- **Shared files, all additive:** `query-keys.ts` (`kitchenAsks`), `pantry-data.ts` (`useLogUse`'s `ask_first` branch), `inbox-ui.tsx` (`lead`), `new-home-ui.tsx`, `pantry-new-ui.tsx`, `pantry-row-ui.tsx`, `set-row-ui.tsx`, `use-sheet-ui.tsx` (Bought again stays below either button set), `item-page-ui.tsx`, the item page, Add item, `stock-check.ts`/`-ui.tsx`, `item-use.ts`, `cook-session.ts`/`-ui.tsx`/`-screen.tsx`, `cook-guided-ui.tsx`/`-screen.tsx`.

**Departures and decisions:**
- **History names the buyer as the approver.** The move doesn't carry who approved it (PN-8), and the answerer is the buyer while they're in the group. An admin's approval after the buyer left would still read "approved by Meera".
- **The row's chip reads "Ask Meera", not an amount** (as the brief says). One tap asks for the suggestion for the people from last time; the toast's Undo cancels it.
- **An answered ask shows on its row for 2 hours** ("briefly"); `mine` holds it for 24.
- **Cancel has no Undo.** Undoing a cancel would be a new ask and a second push to the buyer. Asking's own toast has Undo (it cancels).
- **Home's card keeps Undo on the card itself** (the canvas's), not a toast, until you leave Home.
- **A line that takes from an ask-first item stays out of the dish as a whole**, its other items too (rare: two packs of one food, one guarded). It asks only for what it takes from the guarded item.
- **Wasted and Cook with it are hidden**, not explained, for someone who must ask; the sheet and the item page say "Nothing comes off until Meera says yes" / "Each tap asks Meera". The dish maker's `?item=` isn't offered for them (a dish taking the item is refused).
- **The stock check** offers only It went bad to someone who must ask, though the server would also take a raise (that path is the level itself).
- **The "Never need to ask" chips leave viewers out** (they use nothing) and show first names.
- **"lapses in N h"** never says more than 24, and under an hour says minutes.
- **The mock answers as the buyer.** Nothing here reads stage or prod.

**Tests** (`tests/web-console-next`, pure modules): the package has 97 suites and **1951 tests**; 34 are new, in two files, with `kitchen-ask-fixtures.ts` (Meera's saffron, Dev's ask):
- `kitchen-ask.test.ts` (21): who sees Who can use it (buyer, admins after she leaves, an item not asking yet, personal, finished); the radios; the chips (× and +, leavers dropped, the buyer never listed); the three lines and Save's toasts; Save's body (on with the list, members only, changed, off, unchanged → none); Add item's fields (paying yourself only); `askName` and `itemWords`; PN-5's ask variant and the row's end (Ask Meera with its label and people, Cancel once the server has it); the row's texts per state (waiting and its countdown, the 24 h cap, 30 min, said yes, said no, an admin's answer, lapsed, hidden after 2 h, cancelled, a waiting ask before an older answer, cook asks left to their lines); the request bodies (unit, measure, cook); `withMineAsk`/`withAskChanged`; the `ask_first` patch; history's "Asked · approved by Meera / you" and today's frame unchanged; the stock check's options, default and note; today's refusal words unchanged.
- `kitchen-ask-card.test.ts` (13): the card (title, sub, money, Always let, Approve), with the buyer among the people and no money; not enough (Only … left, Approve what's left, nothing left, a refusal turning into it, what's left at once); the approve bodies; the answered texts; the Undo choice (txn, move, reopen) and refusal words; `askCardsShown`; `?ask=` parsing and arrival; the cook line (Ask Meera, not tickable, out of Took them all and the counts; its request; waiting, approved staying out after Always let; declined → Ask again, lapsed, cancelled, a tick again once it needn't ask; `finishPlan` sending only the other item); and with newFrame false a row, Home's sections and a session line read as before.
- `typecheck` and `lint` are clean for `@saas/web-console-next` and `@saas/web-console-next-tests`. `console-artifact.mjs build` serves 31 pages as files with 15 `_redirects` rules; `/home`, `/pantry`, `/cook/session` stay static.

**Browser check** (390 × 844, `next dev` behind the SM-2 proxy with an in-page mock: PN-6's plus asks; nothing left the machine):
- **Asker, Pantry:** Saffron read "Ask Meera" (amber lock tag) with the ink chip. The open row's Ask Meera sent `{ quantity: "1", measure: "pinch", consumers: [you, Anu] }`; the row showed the wait box and the toast "Asked Meera · 1 pinch"; Cancel appeared once the server answered, and Cancel sent `…/cancel` with "Ask cancelled".
- **`no_need`:** Jaggery's Ask Anu came back 409, and the same 100 g was logged (`POST …/uses`), "Logged 100 g · ₹12.00 · Undo"; the row became ordinary.
- **`ask_first`:** Ghee's 100 g chip was refused; "Couldn't log Ghee · Ask Meera first", the stock went back, and the row turned into Ask Meera.
- **Sheet:** "Ask Meera · 1 pinch / You", Ask for the rest, the lock line; no Wasted or Cook with it.
- **Item page (asker):** the header chip, "Each tap asks Meera"; 2 pinches asked and showed the wait box with the stock unchanged; actions were Bought again · Ask for the rest · Fix how much is left. Once the mock approved it, the 20 s read turned the page to "said yes · logged", the ring to 1.3 g, and history to "You · 2 pinches — Asked · approved by Meera · Just now".
- **Buyer, Home** (`/home?ask=` of the pine nuts): both cards first in To do; the pine nuts card lit up and `?ask=` left the address. Always let + Approve on the olive oil sent `{ alwaysAllow: true }` and read "Approved · Dev and Anu owe you ₹54 · Dev won't need to ask for olive oil again"; Undo sent `…/txns/{txn}/reverse`, the card came back open and Dev was off the list. Decline → "Declined · Dev was told", Undo → `reopen`. Approve what's left sent `{ takeWhatsLeft: true }` and read "Approved · Dev owes you ₹60 · 20 g of pine nuts logged for Dev"; its Undo reversed it.
- **Item page (buyer):** Who can use it with Anu on the list, + Dev, + Meera; Save sent `{ askFirst: true, allowed: [Anu, Dev] }` with "Saved · others ask you first · Undo"; Anyone sent `{ askFirst: false }` and its Undo sent the list back. History read "Dev Patel and Anu · 100 ml — Asked · approved by you".
- **Add item:** Who can use it showed for Flat 4B paid by you, and not for Anu paying or your own pantry; Kesar was created with `askFirst: true, allowed: [Anu]`.
- **Cook session:** Saffron's line read Ask Meera, "0 of 1 in"; the ask sent `{ quantity: "0.05", unit: "g", consumers: [you], source: "cook" }`; the line showed waiting with Cancel, then "Meera said yes · logged as yours"; Finish posted the dish with only the onions (₹4.00).
- **Today's frame** (a host naming prod): Saffron an ordinary row with Use, Home with its money card and no ask cards (`?ask=` ignored), and no asks read.
- **Fit:** no sideways scroll at 390 px; every control on the cards is 44 px or more.
- **Fixed on the way:** "lapses in 25 h" from a minute-old clock; the open row repeating its wait; Approve what's left first reading as the amount asked; full names and a viewer in the chips; the cook line's ask text cut off.
- Not opened in the browser: GC-5's Gather (it draws the same rows through `SessionRow` with the same handlers) and the stock check screen (the PN-6 mock has no check route; its options are unit-tested).

**For later tasks:**
- **PN-10:** nothing left open here for the epic's done-when; on stage it needs a second person (Meera) to answer.
- **Not done:** an approver can't undo an approved ask's use from the item page's history unless they're an owner or admin (PN-8 lets `answered_by` reverse it; `canUndoMove` doesn't know who approved). The Home card's Undo covers it.
- **Deploy:** only console files change, so only the console redeploys; it picks up PN-8's contracts and SDK (already on main). PN-8's kitchen-worker and migration 420 are deployed (#86), and notifications-worker accepts `kitchen.ask`.
