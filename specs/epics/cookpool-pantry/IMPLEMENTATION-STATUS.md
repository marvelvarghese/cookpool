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
