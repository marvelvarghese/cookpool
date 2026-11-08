# cookpool-pantry — design

The canvas rows "Pantry and using — faster" and "Ask before use" are the reference for every screen. The rules from cookpool-simpler and cookpool-recipes still apply:
- five tabs;
- writes are optimistic with Undo (SM-5);
- pages are static (SM-2);
- stage first, behind `newFrame()`. With it false, every page renders what it renders today.

What exists today is mapped in §0. Each section after it says what changes.

## 0. What exists (the starting point)

- **Pantry list** (`app/(kitchen)/pantry/page.tsx`, `components/kitchen/pantry.ts`): one flat list, soonest use-by first. It has chips `All · Soon · Expired · <pantry>`. Search shows only from 900 px. A phone row shows the name, a soon or expired chip, the pantry, the note and what's left; there's no level bar. The end button logs your usual for just you, with Undo. Swiping left does the same, and holding opens `ItemActionsSheet`. The new frame adds `AlwaysHaveCard` at the bottom.
- **Logging** (`app/(kitchen)/use/page.tsx`, `quick-use.ts`, `item-use.ts`, `measures*.ts`, `faces*.ts`): a search page with "Recent and usual" pills, the tile grid (`useTiles`), Another amount, Who? and one main button. Undo comes from `useLogUse`, a 10 s toast.
- **Usuals** (`packages/db/src/kitchen/stock.ts` around line 393, SDK `usuals`): per caller, per **item id**. They're simply the last use's amount over 90 days, so a new pack has none, and there's no time of day.
- **Item page** (`app/(kitchen)/pantry/[itemRef]/page.tsx`): the stock card, note, measures, Cook with it, Wasted, Move, history with Undo, and a sticky Use some. There's no run-out estimate and no Finish.
- **Finished items:** `used_up` and `wasted` items vanish from every list (`state = 'active'` reads).
- **Adding:** one item at a time (`pantry/new`). It has the "Like last time" type-ahead (`historyFill`). There's no restock, Bought again or shopping run.
- **Adjusting:** the `adjust` move kind is allowed by the DB and contracts, but nothing writes it. Quantity and price are locked once an item is used.
- **Money:** `costOfUse` (`packages/kitchen-engine/src/money.ts`) never charges more than what's left of the price, and the use that takes the last of an item charges exactly that rest.
- **Home's "What did you use?"** (`quick-use-ui.tsx`): a link to `/use` plus up to 6 usual chips.
- **Categories:** `ITEM_CATEGORY_LABELS` lists veg, fruit, dairy, grains, protein, spices and other, plus `Leftovers`.
- The latest migration is **390**.

## 1. The Pantry (PantryNew)

**Top to bottom:**
1. **Header:** "Pantry", with **+ Bought** opening the shopping run (§6.3).
2. **Search:** on phones too. `?q=` fills it, and `?focus=1` focuses it (Home's field, §4).
3. **The Now strip** (§3).
4. **Filter chips with counts:** `All · Use soon N · Running low N · <pantry> N…`. A count of 0 hides its chip, except All. The choice stays mirrored in `?filter=` and `?pantry=`.
5. **Use soon card:** "N things to use soon · Cook with them", linking to Cook now. It shows only when N > 0 on All.
6. **Sections by kind:** in the order Dairy, Veg, Fruit, Grains, Protein, Spices, Leftovers, Other. Each section has a heading with its count and collapses on a tap (remembered on the device). An item's kind is its category. A category outside the list goes under Other, labelled as typed. Inside a section, items run use soon first, then running low, then by name.
7. **Finished this week** (§6.1).
8. **Always have** (the existing card).

**A row:**
- The name, then a tag: the pantry when on All, "Use soon · Tue", "Expired", or "Ask Meera" (§8).
- A **level bar** (§2.3 colours) and, when present, the note in one line.
- At the end, the **suggestion chip** (§2): "1 glass". A tap logs it for the faces from last time, with Undo. When nothing fits, it reads "Use…" and opens the row.
- A tap on the row **opens it in place** (§1.1). Only one row is open at a time; opening another closes the first.
- Swiping left logs the suggestion. Holding opens the More… sheet (§1.2). Every gesture keeps its button (PW-8).

### 1.1 The open row (the set row)

Like a set in a workout app:
- "Last: 1 glass · today 8:10 · you and Anu" (from the item's moves).
- **− [amount] +:** the amount box steps through the item's ladder: `useTiles` order without "Other", then The rest. It starts at the suggestion and shows its reason under it ("Morning usual", "The rest", "Use soon", or "Changed from 1 glass" once moved).
- **Faces**, only for group items (`FaceRow`, the default from last time), with the cost: "₹17 · ₹8.50 each".
- **✓ Use** logs it, closes the row and shows the Undo toast. **More…** opens the sheet.
- The amount and the people are kept per item on the device until Use, so reopening the row keeps what you set.

### 1.2 The More… sheet (UseSheet)

A bottom sheet for one item. It replaces `ItemActionsSheet` in the new frame and holds:
- the name, level, note, and **Open** (the item page);
- **How much:** the 4 tiles plus Other, a stepper in the item's unit;
- **Who had it:** the faces and the split;
- the main button **Log**;
- then a row of **Finish it** (logs the rest), **Wasted** (the existing waste confirmation) and **Cook with it**.

### 1.3 Log several

From the search or the Now strip, **Log several** turns taps into a tray instead of logging each one. The tray reads "Log 3 for you · A meal for others? Cook it instead". **Log 3** writes the uses one after another, each through the existing route, and one Undo reverses all three. Several items for other people make a dish, and the tray links to Cook.

## 2. Suggestions

### 2.1 Usuals by time of day, kept per food

`GET /v1/kitchen/me/usuals` gains `?tzOffset=<minutes east of UTC>` (−720…840; default 0). The console sends `-new Date().getTimezoneOffset()`.

**Buckets, in local time:**
- `morning`: 05:00–10:59
- `midday`: 11:00–15:59
- `evening`: 16:00–20:59
- `night`: 21:00–04:59

**What a usual is keyed by.** It's the caller's uses (logged by them or naming them, not reversed, in the last **60 days**) of any item with the same **name key** (`lower(trim(name))`, as measures use) in the **same pantry**. A new pack therefore inherits the usual of the old one.

**For each active item the caller can use, the response gives:**
- **The existing fields** (`lastQtyMilli`, `lastLabel`, consumers), now resolved by name key when the item has no uses of its own.
- **`now`:** the usual for the current bucket, when the caller has **at least 2 uses** of that name key in this bucket. It's the most frequent amount (ties go to the most recent), with its label, consumers and count: `{ bucket, qtyMilli, label, consumerIds, count }`.
- **`strip`:** true when the caller has **at least 3 uses** of that name key in the current bucket.

The response also carries `bucket`, the current one.

### 2.2 The suggestion and its reason

`suggestUse({ item, usual, now })` in `packages/contracts`, a pure function the console and the tests share. The first rule that fits wins:
1. **`rest`:** what's left ≤ 1.25 × the usual amount (the bucket's, else the last one), or ≤ the smallest ladder step. Suggest all that's left. It reads "The rest", or "The rest · only 1 left" for counts.
2. **`usual_now`:** a bucket usual exists. It reads "Morning usual" (or "Midday usual", "Evening usual", "Night usual").
3. **`usual`:** a last usual exists. It reads "Your usual".
4. **`use_soon`:** use-by within `USE_SOON_DAYS`, with no usual. Suggest the first ladder step. It reads "Use soon".
5. **`first`:** the first ladder step, with no reason shown.

The amount is always ≤ what's left.

### 2.3 Running low and the level colours

`isRunningLow({ item, usual })` in contracts: true when what's left is under 20 % of what was bought, or under one usual amount.

**The bar's colour:**
- green `#1F7A4D` normally;
- amber `#D97706` when running low or use soon;
- red `#B42318` when expired.

The bar is never the only signal: the tag or the count says it too.

## 3. The Now strip

A horizontal strip under search, headed with the bucket ("NOW · MORNING"). It's built in the console from the usuals and items:
1. items whose usual has `strip: true`, most uses first, at most 4;
2. then use-soon items with something left, soonest first, up to 6 in all.

A chip reads "Milk · 1 glass · Morning usual" (the §2.2 suggestion). One tap logs it for its consumers, with Undo; under Log several, it goes to the tray instead. With nothing to show, the strip isn't drawn.

## 4. Home's "What did you use?"

In the new frame, Home's field links to `/pantry?focus=1` and the usual chips under it stay. `/use` in the new frame redirects to `/pantry?focus=1`, keeping `?item=` as `?open=<itemRef>`, which opens that row. Its old page stays for the old frame. Search results are rows like any other, with the suggestion chip and the open row, so there is one way to log.

## 5. The item page (ItemPage)

**Top to bottom:**
1. A **level ring:** the amount left, of the amount bought, and the worth left ("₹34 left of ₹68").
2. **Quick-use chips:** the §2.2 suggestion, the next two ladder steps, and More… (§1.2).
3. **"At this rate it runs out Tue":** `runOutEstimate(moves, item, now)`, a pure function. The rate is what was used since it was bought, divided by days since it was bought. It needs **2+ uses and 2+ days**, and is never shown for an item with a use-by inside the estimate. It reads a weekday within 7 days, "in about N weeks" after that, and nothing when there's no estimate.
4. **Who had it:** this item's people with their share of what was used ("Anu ½ · You ⅓ · Dev ⅙").
5. **History,** with Undo on your own entries (exists). Stock checks (§7) and asks (§8) read as such.
6. **Measures and note** (exist), and **Who can use it** (§8.1, group items).
7. **Actions:** Bought again (§6.2), Finish it, Wasted, and **Fix how much is left** (§7). Cook with it stays.

## 6. Restocking

### 6.1 Finished this week

A Pantry section listing items that were used up or wasted in the last **7 days**, in pantries the caller can reach. An item doesn't show when a newer active item with the same name key is in the same pantry. A row reads "Bread · finished Tue · Flat 4B" with **Bought again** (§6.2). The section collapses like the others and hides when empty.

### 6.2 Bought again

From a finished row, the item page, or a running-low row's More… sheet. One tap writes a one-line shopping run (§6.4) like last time, and the toast reads "Bought bread · ₹45 · Change · Undo". **Change** opens `/pantry/new?from=<itemRef>`, which prefills with `historyFill` from that item.

### 6.3 The shopping run (BuyAgain)

`/pantry/run`, reached from the Pantry's **+ Bought** and from Home.

**The groups:**
- **FINISHED:** §6.1's items.
- **RUNNING LOW:** active items with `isRunningLow`.
- **YOU USUALLY BUY:** names bought **at least 3 times** in the last 120 days in a pantry where the caller can add. The median gap between purchases must have passed since the last one, and there's no active item of that name above running low.

Each line shows its why ("Finished Tue", "600 g left · lasts about 3 days", "Every 4 days · last Wed").

**Ticking a line** expands it into:
- the quantity stepper (the last purchase's amount, then its ladder);
- the price (the last price, scaled to the quantity, editable);
- its pantry chip, which you can change to another reachable pantry.

**Footer:** "Paid by you · each goes to its own pantry", then **Add N · ₹total**. One write; Undo removes them all. **Something new** opens `/pantry/new`.

### 6.4 The server

**`GET /v1/kitchen/me/restock`**
- Returns `{ finished: RestockLine[], runningLow: RestockLine[], usual: RestockLine[] }`.
- `RestockLine` is `{ name, nameKey, category, pantry: PantryRef, reason, why, last }`:
  - `why` holds `finishedAt` · `leftQtyMilli` + `boughtQtyMilli` · `everyDays` + `lastBoughtAt`;
  - `last` is the latest purchase of that name in that pantry: `{ itemId, quantityMilli, unit, priceMinor, currency, wastePolicy, expiresAfterDays, paidBy }`.
- Each name and pantry appears at most once, in the first group it qualifies for.

**`POST /v1/kitchen/me/purchases`**
- **Request:** `{ lines: PurchaseLine[] }`, 1–30 lines. Each line is `{ pantry, name, category, quantity, unit, priceMinor, expiresOn?, wastePolicy?, note?, fromItemId? }`.
- **Paid by the caller.** Each group line's currency is that group's. The caller must be able to add to every pantry, or the whole write is refused.
- **One `db.batch`.** Every item is created with the same `purchase_id` (`pur_`), and a group line with `fromItemId` copies that item's waste policy and ask-first settings (§8).
- **Response:** `{ purchaseId, items }`, with idempotency as every write has.

**`DELETE /v1/kitchen/me/purchases/{purchaseId}`**
- The Undo. It removes the purchase's items that are still unused.
- If any were used, it removes the rest and says which stayed (`details.kept`).

**Migration 400** `kitchen_purchases`: `kitchen_items.purchase_id TEXT NULL` and an index on `(purchase_id)`, plus an index for the name-key lookups if the plan needs one.

## 7. The stock check (StockCheck)

`/pantry/[itemRef]/check`, from the item page's **Fix how much is left**.

**The screen:**
- A tall level you drag, or tap marks for Empty, ¼, ½, ¾ and Full (of what was bought), with arrow keys.
- "Cookpool thinks 1 L · You say 750 ml".
- **When less:** "Where did 250 ml go?", with one answer:
  - **I used it:** "₹8.50 to you · Meera gets it back", or for a personal item just "Logged as yours".
  - **Split with Flat 4B:** "₹2.13 each". This is the default for group items; it isn't offered for personal ones.
  - **It went bad:** waste under the item's rule.
- **When more:** "More than Cookpool thought. Fixing it moves no money."
- **Fix to 750 ml**, with Undo. When it's the same, "It's right" writes nothing.

**`POST …/items/{itemId}/check`**, for both personal (`/v1/kitchen/me/items/…`) and group (`/v1/organizations/{org}/kitchen/items/…`) items.
- **Request:** `{ left: { quantity, unit } , gone?: "me" | "split" | "waste" }`.
- **Less than what's left:**
  - `me` is a use of the difference by the caller (a group item posts a `use` txn charging the caller; none if the caller is the buyer);
  - `split` is a use of the difference with every **current member** as a consumer, split equally;
  - `waste` is a waste of the difference under the item's rule.
  - These are the existing use and waste paths, so money, Undo and emails behave as they do today. `gone` is required; for a personal item, `split` is refused.
- **More than what's left:** an `adjust` move that raises `qty_left` by the difference, with no txn.
  - It's refused when the result would exceed what was bought (the CHECK); the screen caps the level at Full.
  - `costOfUse` already never charges past the price, so later uses stay inside it.
  - Undoing it takes the difference back off, if it's still there.
- **Equal:** 422, `details.reason: "unchanged"`. The console doesn't send it.
- Every move the check writes carries `via = 'check'`, and history reads it as "Stock check · 250 ml split with Flat 4B".

**Migration 410** `kitchen_moves_via`: `kitchen_stock_moves.via TEXT NULL CHECK (via IN ('check','ask'))`.

## 8. Ask before use

### 8.1 The setting (AskSetting)

- **Scope:** a group item gains `askFirst` (bool, default false) and `allowed` (member ids who never need to ask).
- **Who sets it:** only the **buyer** (`paid_by`), or a group admin once the buyer is no longer a member. It's set on Add item ("Ask me first", group items you pay for) and on the item page's **Who can use it**.
- **Personal items** never ask.
- **A Bought again or shopping run line** from an ask-first item copies both settings.

### 8.2 Asking (AskRequest)

- **Who asks:** a member who isn't the buyer and isn't allowed. For them the row's tag reads **Ask Meera** with a lock, and the set row's button reads **Ask Meera**.
- **What happens:** asking sends the amount and the faces. Nothing comes off the stock and no txn is posted.
- **While it waits:** the row reads "Asked Meera · 1 pinch · waiting · lapses in 24 h" with **Cancel**.
- **The direct paths refuse:** the use and waste routes, and a dish taking the item, are refused for that person with `details.reason: "ask_first"`. So are the stock check's `me`/`split` answers. The stock check is the buyer's and admins' on an ask-first item.

### 8.3 Answering (AskApprove)

The buyer gets a push and a card at the top of Home's To do.
- **The push:** "Dev asks for 1 pinch of your saffron", with "For Dev and Anu · ₹12 to you". Tapping it opens `/home?ask=<askId>`, and the card is scrolled to and highlighted.
- **The card:** the asker, the amount, who it's for, when, what's left, and "If you approve: ₹12 back to you". It has **Always let Dev use saffron** (a switch), **Decline** and **Approve**.
- **Approve** posts the use exactly as the asker would have, at that moment's price and stock, with the asker as `created_by` and `via = 'ask'`. With the switch on, it also adds the asker to `allowed`.
  - If less is left than was asked, the card says so and offers **Approve what's left**.
- **Decline** tells the asker. The buyer can undo either answer: Undo after Approve reverses the use; Undo after Decline reopens the ask.
- **The asker** gets a push either way: "Meera said yes · 1 pinch of saffron logged" or "Meera said no to the saffron".
- **An ask lapses** 24 h after it's made, when the item is finished, or when its setting is turned off. A lapsed ask can't be approved, and the asker sees "Lapsed" on the row.

### 8.4 In a cook session

When the cook can't use an item without asking, its ingredient line reads **Ask Meera** instead of a tick. Tapping it sends an ask for the line's amount for the cook. The line stays out of the dish. Once approved, it's logged as the cook's own use and isn't part of the dish's cost, so the stock is never taken twice.

### 8.5 The server

**Migration 420** `kitchen_asks`:
- `kitchen_items.ask_first INTEGER NOT NULL DEFAULT 0`.
- `kitchen_item_allowed (item_id, member_id, created_at, PRIMARY KEY (item_id, member_id))`.
- `kitchen_asks`:
  - **Identity and request:** `ask_` id, `org_id`, `item_id`, `asker_id`, `qty_milli`, `label`, `consumers` JSON, `weights` JSON NULL, `source` `pantry|cook`.
  - **State:** `state` `pending|approved|declined|canceled`, `created_at`, `expires_at`, `answered_at`, `answered_by`, `move_id`, `txn_id`.
  - **Indexes:** by item and state, and by asker.
- **Lapsing is read-side:** a pending ask past `expires_at`, or on an item that's no longer active or no longer ask-first, reads as `lapsed`.

**Routes** (group scope `/v1/organizations/{org}/kitchen/…`, plus a cross-group read):
- `PATCH items/{itemId}` accepts `askFirst` and `allowed`, from the buyer or an admin as in §8.1.
- `POST items/{itemId}/asks` takes `{ quantity, unit | measure, consumers, weights?, source? }` and returns `{ ask }`.
  - It's refused when the caller needn't ask: `details.reason: "no_need"`. The console then uses the item directly.
- `POST asks/{askId}/approve` takes `{ alwaysAllow?: boolean, takeWhatsLeft?: boolean }`; `POST asks/{askId}/decline`; `POST asks/{askId}/reopen` (buyer, a declined ask still within its 24 h); `POST asks/{askId}/cancel` (asker).
- `GET /v1/kitchen/me/asks` returns `{ toAnswer: Ask[], mine: Ask[] }`. `toAnswer` is pending asks on items the caller answers for; `mine` is the caller's asks from the last 24 h, in any state.
- **Home's inbox** gains `ask` rows (pending, to answer) at the top of To do.
- **Pushes** go through notifications-worker's `POST /v1/notifications/push-to-subject` (GC-3).

## 9. Routes and SDK, summary

| Route | SDK | Task |
|---|---|---|
| `GET /v1/kitchen/me/usuals?tzOffset=` (extended) | `usuals({ tzOffset })` | PN-2 |
| `GET /v1/kitchen/me/restock` | `restock()` | PN-3 |
| `POST /v1/kitchen/me/purchases`, `DELETE …/{id}` | `buy(lines)`, `undoPurchase(id)` | PN-3 |
| `POST …/items/{id}/check` (personal and group) | `checkPersonalItem`, `checkGroupItem` | PN-4 |
| `PATCH …/items/{id}` (`askFirst`, `allowed`) | `updateGroupItem` | PN-8 |
| `POST …/items/{id}/asks`, `POST …/asks/{id}/approve · decline · reopen · cancel` | `askToUse`, `approveAsk`, `declineAsk`, `reopenAsk`, `cancelAsk` | PN-8 |
| `GET /v1/kitchen/me/asks` | `asks()` | PN-8 |

Pure helpers in `packages/contracts`:
- `suggestUse` and `isRunningLow` (PN-2);
- `runOutEstimate`, which may live in the console's `item-use.ts` instead (PN-7).

## 10. Out of scope

- A shopping list made before the shop, and sharing one.
- Unequal splits in the UI (the API's `weights` stays unused).
- A physical lock or proof of use.
- Asks on personal items.
- Notification action buttons (iPhone web push has none).
- Averaged or seasonal usuals.
- Barcode or receipt scanning.
