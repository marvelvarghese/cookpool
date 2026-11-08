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
