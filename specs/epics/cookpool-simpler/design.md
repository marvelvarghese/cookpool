# cookpool-simpler — design

The screens are on the design canvas, row "Simpler — less to read, one tap"
(`SimpleHome`, `SimpleUse`, `SimpleDish`, `SimpleAdd`, `SimplePantry`,
`SimpleAddItem`, `SimpleCook`). The phone audit they answer is `ux-audit.md`.

## 1. Fast (SM1)

### 1.1 What is slow, measured 2026-11-04 from the owner's connection (Cloudflare colos HKG, SIN)

| What | Time | Why |
|---|---|---|
| Any app page, first byte | 1.4–2.6 s | The root layout calls `headers()` to learn its host (SI-12's environment lookup), which makes every route dynamic: each visit renders on the OpenNext worker. Even `/icons/icon-192.png` takes 0.8 s, so static files go through the worker too. |
| A CORS preflight | 0.28–0.40 s | The app (`cookpool.store`) and the API (`…workers.dev`) are different origins. `Access-Control-Max-Age: 86400` is set, but browsers cache per URL (Chrome caps at 2 h), so each new path pays once. |
| An API read with one D1 query | 0.40–0.72 s (vs 0.2–0.55 s for a 404 with no database) | The D1 database was created with no location hint (by the CI runner), so it most likely lives in North America while the workers run in Asia; every query crosses the Pacific, several in a row on busy screens. |
| A write in the UI | the full round trip | The app waits for the server before it shows the change. |

### 1.2 The changes

1. **Pages are files.** The root layout stops reading request headers. The
   app config (product name, workers.dev subdomain, custom domains, the
   environment) resolves in the browser from `window.location` and the
   values the build already carries, so every route can be prerendered.
   Kitchen pages are client-rendered already; their HTML becomes static and
   is served by Workers Static Assets without running the worker. Routes
   that truly need the server (the OAuth callback, the manifest) stay
   dynamic.
2. **The API on the app's address.** The app calls the API on its own
   origin, `/api/*`, on every host that serves it: `cookpool.store`,
   `stage.cookpool.store` and the console's workers.dev hosts alike. Same
   origin, so there is no preflight at all. The console Worker answers those
   requests itself, before it loads OpenNext, by forwarding them to api-edge
   over a service binding (`API_EDGE` → `cookpool-api-edge-<env>`) with the
   `/api` prefix stripped; static files and `_redirects` never see them.
   api-edge keys signed-out rate limits on the client's IP, which a
   service-binding request does not carry: the console forwards the address
   Cloudflare gave it, and api-edge believes that header only over the
   console's binding (its `props`), never from the internet. Sign-in with
   Google still starts on api-edge's workers.dev host, where Google returns
   (the registered callback and its state cookie). Nothing is set up in the
   dashboard: the binding deploys with the console. Local development keeps
   the workers.dev targets.
3. **The database near its people.** The D1 database is recreated with the
   location hint `apac` (Asia–Pacific). It starts empty (decision 3). The
   workers that query it (api-edge, kitchen, identity, membership, and the
   others bound to `PLATFORM_DB`) get Smart Placement, so a request that runs
   several queries executes next to the database.
4. **Writes show at once.** Logging a use, claiming or setting a portion,
   "Paid", "Used it", finalizing and adding an item update the screen
   immediately (React Query optimistic updates) with the one Undo toast; a
   refusal rolls back and says why in one line. Reads keep showing the last
   data while they refresh (no spinners on revisit); Home prefetches what
   its rows open.
5. **A timing check.** A script measures first byte for the app pages and the
   main reads on stage and prod (median and 75th percentile of 10) and fails
   above the budgets: page 0.3 s, read 0.4 s.

## 2. Portions for anyone (SM2)

Today a member sets only their own portion (`PUT …/dishes/{dsh}/claims/me`);
only the cook assigns other people's (`PUT …/shares`).

- **Route.** `PUT /v1/organizations/{org}/kitchen/dishes/{dsh}/claims/{subjectId}`
  `{ portionsHalf }` (`kitchen.dish.claim`): any member sets any member's
  portion while the dish is open, under the same "never more than the
  portions" guard. `claims/me` stays as the shorthand for yourself.
- **Storage.** `kitchen_dish_shares` gains `set_by` (who set it; null for
  rows written before). A row someone else set reads "by Anu".
- **Email.** Setting someone else's portion emails them once per dish and
  person ("Anu said you had 1 portion of Egg fried rice"), with a link to the
  dish, through CP-18's `kitchen.logged_for_you` path.
- **Changing it.** The person, the cook and any member can change it again;
  the latest write wins and its author is shown.
- **Faces everywhere.** Use, Dish and Bill all show the same row of faces;
  tapping a face includes that person, and the main button names who it is
  for ("You + Anu · ₹8.50 each").

## 3. From before (SM3)

- **Buying.** Typing a name on "Bought" suggests items you (or your groups)
  bought before, newest first, with what was bought, where and how often
  ("Milk · 1 L · Flat 4B · 6 times · ₹68"). Picking one fills quantity, unit,
  price, pantry, who paid and a use-by offset from last time; you change only
  what differs. Read: `GET /v1/kitchen/me/items/history?q=&limit=` over items
  you can see, used-up ones included, grouped by name.
- **Cooking.** Typing a dish name suggests dishes cooked before ("Egg fried
  rice · 3 times · 5 portions"). Picking one fills portions, extras and the
  ingredients, each matched to an item you can use now with the same name;
  an ingredient with no stock left is listed as "Not in a pantry · add it".
  Read: `GET /v1/kitchen/me/dishes/recipes?q=&limit=`.

## 4. The seven rules (every screen)

1. One main button per screen, in thumb reach; nothing sticky covers what you
   are choosing.
2. Numbers, not sentences: at most one short hint per screen, the why behind
   a tap.
3. Plain words: You get back · You owe · Had some? — no netting, claims,
   plans or posted.
4. Faces for people; the button says who it is for.
5. Anyone can set anyone's portion, with "by Anu".
6. Each debt shows once; one-line toasts with Undo; no duplicate controls;
   fewer cards; 44 px targets.
7. Start from before: picking a past item or dish fills everything in.

## 5. Screens

SM4 builds the five most-used screens as the canvas draws them; SM5 brings
the rest under the same rules and fixes what the audit found broken at
390 px (the join link wrapping mid-code, "300 g" wrapping, the + Add sheet
losing its header on scroll, the carousel scrollbar, both "Who ate?" options
looking selected on Cook, "Anu paid you" shown as red −₹400, three primary
button colours, "Soon" placeholders in primary spots).

## 6. Your measures (SM6)

Until now an item had one kind of amount — pieces, weight, volume or packs —
and Use offered the same tiles for every item of a kind: anything weighed got
"1 cup · ½ cup · a spoon · a teaspoon", a guess for rice and meaningless for
onions. People count food the way they eat it: onions bought by the kilo are
used one at a time, bread is bought by the pack and eaten by the slice. The
screens are the canvas row "Use it your way — measures" (`MeasureUse`,
`MeasureFirst`, `MeasureItem`, `MeasureCook`).

- **One stock, plus sizes.** An item keeps its one stock in the unit it was
  bought in — that is what the price paid for — and money is worked out from
  it as before. A measure is a size in that stock's unit: "1 onion ≈ 150 g",
  "20 slices in a pack", "1 katori ≈ 120 g". It is stored exactly, as *count*
  of the measure making *amount* of the stock (1 onion = 150 000 milli-g;
  20 slices = 1 000 milli-pack), so a slice of a 16-slice pack is exactly a
  sixteenth of it.
- **Per name, pantry and dimension.** Measures belong to a name
  (case-insensitive) in one pantry — a person's own, or a group's — for one
  dimension, not to one purchase: next week's onions in Flat 4B already count
  in onions. At most three per name. Anyone who can use an item can add,
  change or remove its measures (`kitchen.item.use` in a group; the owner in
  a personal pantry).
- **Asked once, never on Bought.** Bought stays as short as it is. The first
  time someone wants an item counted another way, Use offers a "Count in
  onions" tile that asks one question ("1 onion weighs about", "How many
  slices in a pack?") with four quick picks and Save; it is not asked again
  for that name in that pantry. There is no built-in table of sizes: a wrong
  guess would quietly move money between people.
- **A use in a measure.** A use, or a dish ingredient, may be given as a
  count of a measure ("2 onions"; halves allowed). The server takes count ×
  size from the stock — the money is price × amount ÷ amount bought, as for
  any use — and keeps the words, so the activity, the item's history and the
  dish read "2 onions", not "300 g". Changing a size later changes future
  uses only: a past use keeps its amount and its words.
- **Rough is fine; the last use is exact.** Sizes are approximate (onions
  vary), and the app shows "≈" for a weight or volume measure. "The rest"
  always takes exactly what is left, so an item's uses add up to exactly what
  was paid.
- **Built in, and gone.** Volume measures (a glass 250 ml, ½ glass, a splash
  50 ml, tsp, tbsp) are exact for any liquid and stay built in. The guessed
  weight tiles (cup 200 g, spoon 20 g, teaspoon 5 g) go: a weighed item
  offers weights ("100 g", "250 g", "½ kg", "The rest") and its own measures.

### 6.1 API

- `PUT /v1/organizations/{org}/kitchen/items/{itm}/measures` and
  `PUT /v1/kitchen/me/items/{itm}/measures`
  `{ measures: [{ one, many, count, amountMilli }] }` (0–3) replace the
  measures of that item's name in its pantry → `{ measures }`. `one` / `many`
  are the words ("onion" / "onions"), 1–24 characters; `count` and
  `amountMilli` are positive integers.
- Every item read (a pantry's items, an item, the cross-pantry and quick-use
  reads, history) carries `measures` (empty when none).
- `…/uses` and a cook's ingredient take `quantity` + `unit` as today, or
  `quantity` + `measure` (a measure's `one`; `quantity` may be a half). A
  measure the item's name does not have is 422 `validation_failed`
  (`measure`).
- A stock move and a dish ingredient carry `label` ("2 onions"), or null.

### 6.2 Storage

Migration 300: `kitchen_measures` (`msr_…`; the pantry as `owner_kind`
user | group and `owner_id`; `name_key`, the trimmed lower-cased name;
`dimension`; `one`, `many`, `count`, `amount_milli`, `position`; who set it
and when; unique on pantry, `name_key`, `dimension` and `one`), and a
nullable `label` on `kitchen_stock_moves` and `kitchen_dish_ingredients`.

## 7. Out of scope

Native apps; offline mode; push notifications; a new visual identity (the
green, the type and the shapes stay); changing how money is computed.
