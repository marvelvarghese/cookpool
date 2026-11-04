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
2. **The API on the app's address.** `cookpool.store/api/*` (and
   `stage.cookpool.store/api/*`) reach api-edge directly through a Workers
   Route on the zone; api-edge strips the `/api` prefix. On a custom domain
   the app calls its own origin, so there is no preflight at all. On
   workers.dev the app keeps calling the workers.dev API (preflights cached
   as today).
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

## 6. Out of scope

Native apps; offline mode; push notifications; a new visual identity (the
green, the type and the shapes stay); changing how money is computed.
