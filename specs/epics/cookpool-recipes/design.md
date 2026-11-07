# cookpool-recipes — design

The canvas is the reference for every screen: row "Cook with recipes — the new layout" and the "Architecture" board (https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv). The seven rules from cookpool-simpler design §4 apply to every screen here.

## 1. The frame (RC1)

### 1.1 Stage first

`apps/web-console-next/src/lib/features.ts` exports `newFrame(): boolean`. It is true wherever `appConfig().deployEnv` is not `"prod"`: dev, stage, local, and a workers.dev host without an environment. The value is read in the browser at runtime from the host (`app-config.ts`, CA2). One build serves every environment, as today.

- A screen whose layout changes picks its component at render: `newFrame() ? <NewHome/> : <Home/>`. The URL stays the same, so links, the service worker's page list and the PWA shortcuts keep working.
- A route that exists only in the new frame (`/money`, `/explore`, `/recipes/*`, `/cook/session`, `/r/*`) sends a prod visitor to `/home`.
- The kitchen-worker routes this epic adds are live in every environment. Prod's app does not call them until RC5. Migrations are additive and run everywhere, as always.
- RC5 sets `newFrame()` to true everywhere and deletes the old components.

### 1.2 Five tabs

**Home · Pantry · Cook · Money · You**, a bottom bar on phones and the sidebar from 900 px. Cook sits in the middle with a filled icon. The **+ tab goes**: each tab's main action sits at its top instead.

| Action | How often | Where | Taps from launch |
|---|---|---|---|
| Use something | many a day | Home's first field; Pantry row swipe or tap | 1 · 2 |
| Had some? | daily | Home, To do | 0 |
| Cook | daily | Cook tab; the session bar on every tab | 1 |
| Bought | weekly | Pantry, top button | 2 |
| Bill | weekly | Money, top | 2 |
| Settle up | monthly | Money; a To do when you owe | 2 |
| Save or share a recipe | now and then | the recipe page | 3 |

The PWA's manifest shortcuts (PW-2) become **What did you use?** and **Start cooking**.

### 1.3 Each thing in one place

- **Money lives in Money.** Home loses its balance card. A debt that needs you (Pay Dev) is a To do.
- **An open dish is a To do** (claim chips right there), never also a feed card.
- **From your groups** on Home shows finished cooks only.
- A person's page is reached by tapping a face anywhere. It holds their recipes and what is between you two, so People and Person merge into it.

### 1.4 The screens

- **Home** (`NewHome`):
  - What did you use?
  - **To do**: open dishes with claim chips, Pay X, use soon or expired.
  - **Cook now**: three cards, which RC2 and RC4 fill; until then the strip is hidden.
  - **From your groups**: cards for dishes finished in the last 7 days in any of your groups. Each card shows the cook's face, the group, when, three numbers (portions, each, you had), and the recipe link when you can see that recipe.
- **Money** (`Money`): you get back / you owe (one figure per currency), Settle up (the main button), Bill, then **People | Groups**. A person opens their page. A group opens today's group page.
- **You** (`Profile`, your page):
  - face, name, your groups;
  - three numbers: cooks, recipes, saved by;
  - cooks a week over the last 8 weeks;
  - **Recipes | Cooks**.
  - The gear opens settings: name, notifications, install, sign out. Those are today's You rows.
- **A person's page** (`Profile`, Anu's page): the same layout, plus "You get back ₹40 · Settle up" and the link to today's "why" breakdown. Their recipes show only those you may see (§5.1).
- **Desktop**: the sidebar lists the same five. A session opens as a right-hand panel.

### 1.5 Item notes

An item has an optional `note` of at most 80 characters, set on Bought and on the item page, and shown as a third line on its pantry row with a pencil glyph. In your own pantry only you see it; in a group's pantry everyone in the group does. Changing a note writes nothing to the ledger.

## 2. Foods

One shared list of foods, `kitchen_foods`, links what people buy to what recipes call for.

- A food has:
  - a `key` (`onion`) and a display name (`Onion`);
  - a `dimension` (`mass`, `volume` or `count`);
  - an optional `eachG`: one piece in grams (an onion ≈ 150 g, an egg ≈ 50 g), so counts and weights meet;
  - a `category`.
- **Names** (`kitchen_food_names`) map every spelling and language to a food: onion, onions, pyaz, kanda, red onion → `onion`. Matching lower-cases, trims, and drops a plural `s`/`es` before looking up.
- **An item links to a food** (`kitchen_items.food_key`). When an item is added, its name is looked up and the item is linked when exactly one food matches. When nothing matches, the item stays unlinked. The first time a recipe needs it, the person is asked once, "Is Kanda onion?", like a measure (SM-13). The answer is kept for that name in that pantry.
- RC-4 seeds about 60 common foods, enough to test. RC-7 brings the list to about 300 with synonyms in English, Hindi and the common regional names.

## 3. Recipes (RC2)

### 3.1 What a recipe is

- **Fields:**
  - a name;
  - serves N (in halves, like portions);
  - minutes (optional);
  - **lines**;
  - **steps**: short texts, up to 20;
  - who can see it (§5.1);
  - where it came from (§5.2).
- **A line has:**
  - a food (`food_key`, or none for a free-text line);
  - its words (`name`);
  - an amount and unit, or **to taste**, which has no amount;
  - **main**: exactly one line per recipe, never a to-taste line.
- Units are the app's own: `g kg ml L pcs tsp tbsp cup`, plus a food's own measure words ("onion"). A count line reads "2 onions".
- A recipe **never moves money**. Cooking it makes a dish, and the dish moves money as today.

### 3.2 Scaling

- A recipe scales by a **factor** `f`, in thousandths (`factorMilli`). Setting the main line's amount sets `f = new ÷ written`. Setting portions sets `f = portions ÷ serves`. The two stay linked.
- Every line's amount is `written × f`, rounded by its unit:
  - pcs and spoons: to the nearest ½, at least ½;
  - g and ml: to the nearest 5 below 100, the nearest 10 below 1000, then the nearest 50;
  - kg and L: two decimals.
- To-taste lines never scale. Portions show as "about 2" when `serves × f` is not a whole or half number.
- `scaleLine()` and `scalePortions()` are pure helpers in `packages/contracts` (beside `measureTakeMilli`), so the screen and the server round the same way.
- "**Use all 450 g you have**" sets the main line to the stock the match found (§3.3).

### 3.3 What you have (the match)

For a recipe at factor `f`, each line is matched against **every active item the caller can use**: their own pantry, plus each group where they hold `kitchen.item.use`.

- An item counts when its food is the line's food. Amounts compare in the line's dimension; a count meets a mass through the food's `eachG`, or the item's measure when it has one.
- **Status per line:**
  - **have**: enough, from one or more items;
  - **short**: some, but not enough;
  - **missing**: none;
  - **always**: the food is on the caller's Always have list (§3.4), or the line is to taste.
- The match names, for each line, the items it would take from. It prefers whatever expires soonest, then the caller's own pantry, then the most left.
- **`maxFactorMilli`** is the largest `f` the stock allows. It is the smallest have ÷ need over lines that aren't "always", and it is null when anything is missing.
- The match is a read. It reserves nothing.

### 3.4 Always have

Each person keeps a short list of foods they always have, such as salt, water, turmeric and garam masala. Lines for those count as there. New people start with salt and water. The list is edited at the bottom of Pantry.

### 3.5 Writing a recipe

- **New recipe**: name, serves, then lines (type a food, amount, unit), one marked main (default: the first line with a weight), steps, then Save.
- **Save as recipe**, from a finished dish (its page, or Finish in a session). Every ingredient becomes a line at the amount used, and serves becomes the dish's portions. The heaviest ingredient becomes the main line.
- Edits are the owner's alone. Copies of the recipe don't change (§5.2).

## 4. Cooking sessions (RC3)

### 4.1 The session is a draft on the device

- A session is a plain object kept in `localStorage` under the signed-in account. It holds:
  - the recipe (id, or none for blank) and the factor;
  - one line per ingredient: food, words, amount, unit, the item(s) to take from, ticked or not;
  - the steps done;
  - the start time.
- It survives tab switches, reloads and closing the app, and is cleared on Finish, Discard or sign-out. **One session at a time.** Starting another asks once to "Finish or discard Chicken curry?".
- Offline, the session keeps working. **Finish needs signal** and says "You're offline" otherwise. Nothing is queued (PW decision 5).

### 4.2 The screen (`LiveCook`, `/cook/session`)

- **Header:** minimize (chevron down), the elapsed time, the recipe name, and a chip with the scale ("For about 2 · ×0.45") that opens the recipe page.
- **One row per line**, with:
  - a tick button (44 px);
  - the name;
  - "pantry · last time 2 onions";
  - the amount as a button. Tapping it opens ± steppers in the row, with "≈ 225 g · ₹9" beside them.
- A missing line is struck through, reads "Not in your pantries · left out", and can't be ticked. To-taste lines can be ticked but have no amount.
- **Below the rows:**
  - **Add an item**, using the existing Use search, which can also add something just bought;
  - **Steps · 2 of 5**, with steps you can tick.
- **The main button, Finish** (with the running cost), opens the finish sheet:
  - If lines are unticked: "3 not ticked · Took them all / Leave them out". Took them all is the default.
  - **Who ate**: faces with ½ steppers, you at 1 by default.
  - **Post to <group>**: the group of most of the ingredients, or the last one used, changeable.
  - **Save today's amounts to my recipe**: a switch, off by default. It shows only when amounts differ from the recipe and you own it. For a blank session it reads **Save as a recipe**.
  - **Post**: the cost and each person's share.
- **Last time** is the caller's last dish cooked from this recipe: each line's amount and words then.

### 4.3 Posting

Finish makes one `POST /v1/kitchen/me/dishes`, the existing cook write:
- ingredients from the lines' items;
- `splitMode: "claims"`;
- `portionsHalf` from Who ate's total;
- two new fields, `recipeId` and `recipeFactorMilli`, kept on the dish;
- a new `recipeLine` on each ingredient, so Last time finds it.

Then one `PUT …/shares` sets each eater's portion (SM2: anyone sets anyone's). It is the existing route, and the dish waits in everyone's To do as today. The two writes are SM-5 instant writes with Undo. A failed share write leaves the dish open, and people claim as they can today.

### 4.4 The bar

While a session exists, every tab shows a dark bar above the tab bar (sidebar footer on desktop): pot · name · "Cooking · 12 min · 3 of 7 in" · **Resume**. It hides while the keyboard is open.

### 4.5 Starting

- **Start cooking** (Cook tab) opens a blank session. Its first field is the name, with SM-3's "from before" suggestions: picking a past dish fills its lines.
- From a recipe, **Start cooking** carries the factor: `/cook/session?recipe=rcp_…&f=450`, where `f` is `factorMilli`.
- **Cook this** on a feed card opens the recipe page.

## 5. Sharing and explore (RC4)

### 5.1 Who can see a recipe

The levels are cumulative:
- **Only me**: the owner only.
- **My groups**: plus anyone who currently shares a group with the owner. It shows on the owner's page and in Explore's "Your groups". Leaving the group ends it.
- **Anyone with the link**: plus anyone signed in who opens `/r/<code>`. The code is 10 random base-58 characters, shown and copied from the share sheet. Turning the link off or rotating it ends the old code at once.

Defaults: a recipe you write is **My groups**, since your dishes already show to them. A copy you save is **Only me**. Cookpool's recipes are seen by everyone.

### 5.2 Saving a copy

**Save** (from a person's page, a feed card's recipe, Explore or a link) writes a new recipe owned by the saver:
- the same lines and steps;
- `source_recipe_id` and the source owner's name, kept for "from Anu";
- visibility Only me.

The source's later edits and deletion don't touch the copy. A Cookpool recipe can be cooked without saving and saved like any other. "Saved by N" counts the copies.

### 5.3 Explore

- **Cookpool | Your groups**: Cookpool's recipes, or every recipe you can see through your groups, newest first.
- Search, plus kind chips: Breakfast, Dal & curry, Rice, Snacks, Sweet.
- **Only what I can make** keeps recipes with nothing missing.
- Each row shows its match: "✓ You have everything", or "Missing yogurt".

### 5.4 Cook now

`GET /v1/kitchen/me/cook-now` ranks every recipe you can see: yours and your copies, Cookpool's, and your groups'.
- It sorts by fewest missing, then the largest `maxFactorMilli`, then the most recently cooked.
- It returns the first 20, each with its match summary, "for N" (`serves × maxFactor`, capped at the recipe's serves × 2), and up to three missing names.
- Home shows three; the Cook tab shows "Can make" and "Missing 1".

### 5.5 Cookpool's recipes

About 40 home staples, written once and kept in a migration (RC-7):
- breakfasts, dals and curries, rice, rotis, snacks, sweets and chai;
- each in Indian home measures (katori, tsp), serving 2 to 6;
- every line linked to a food and every recipe with one main line.

They belong to the system user `usr_cookpool`, cannot be edited, and are visible to everyone.

## 6. Storage

Migrations 330–360, each with its manifest entry and checksum:

| Migration | Task | What |
|---|---|---|
| `330_kitchen_item_notes` | RC-3 | `kitchen_items.note TEXT NULL CHECK (note IS NULL OR length(note) <= 80)` |
| `340_kitchen_foods` | RC-4 | `kitchen_foods` (key PK, name, dimension, each_g, category), `kitchen_food_names` (name_key PK → food_key), `kitchen_items.food_key NULL`, `kitchen_food_answers` (org or user, name_key, food_key: the "asked once" answers), `kitchen_always_have` (user_id, food_key, PK both), the ~60 seed foods |
| `350_kitchen_recipes` | RC-4 | `kitchen_recipes` (`rcp_` id, owner_id, name, serves_half, minutes, visibility `only_me`/`groups`/`link`, link_code UNIQUE NULL, source_recipe_id, source_owner_id, source_owner_name, is_system, kind, created/updated/deleted_at), `kitchen_recipe_lines` (recipe_id, position, food_key NULL, name, qty_milli NULL, unit NULL, to_taste, is_main; one main per recipe), `kitchen_recipe_steps` (recipe_id, position, text ≤ 200), `kitchen_dishes.recipe_id NULL`, `kitchen_dishes.recipe_factor_milli NULL`, `kitchen_dish_ingredients.recipe_line NULL` |
| `360_kitchen_cookpool_recipes` | RC-7 | the full food list and names, and Cookpool's ~40 recipes under `usr_cookpool` |

## 7. API

All routes go through api-edge's kitchen facade (idempotency + actor) to kitchen-worker, with the usual envelopes (`{ data, meta }`; `{ error: { code } }`, 422 on validation). Types live in `packages/contracts/src/kitchen.ts` (or `kitchen-recipes.ts`), and the client in `packages/sdk` (`KitchenClient`).

| Route | Task | Who |
|---|---|---|
| item create/update bodies gain `note` | RC-3 | as today |
| `GET /v1/kitchen/foods?q=` | RC-4 | signed in |
| `PUT /v1/kitchen/me/food-answers` `{ nameKey, foodKey, orgId? }` | RC-4 | pantry member |
| `GET /PUT /v1/kitchen/me/always-have` | RC-4 | self |
| `GET /v1/kitchen/me/recipes` (yours and your copies, by last cooked) · `POST` (create; `fromDishId` saves a dish as a recipe) | RC-4 | self |
| `GET /v1/kitchen/recipes/{id}` (with `lastCook` for the caller) | RC-4 | who may see it (§5.1) |
| `PATCH /DELETE /v1/kitchen/me/recipes/{id}` | RC-4 | owner |
| `GET /v1/kitchen/me/recipes/{id}/match?f=` | RC-4 | who may see it |
| `POST /DELETE /v1/kitchen/me/recipes/{id}/link` | RC-4 | owner |
| `GET /v1/kitchen/recipe-links/{code}` | RC-4 | signed in |
| `POST /v1/kitchen/me/recipes/copies` `{ recipeId }` or `{ linkCode }` | RC-4 | who may see it |
| `GET /v1/kitchen/people/{usr}/recipes` | RC-4 | shares a group |
| `GET /v1/kitchen/recipes?source=cookpool\|groups&q=&kind=` | RC-4 | signed in |
| `GET /v1/kitchen/me/cook-now` | RC-4 | self |
| `POST /v1/kitchen/me/dishes` gains `recipeId`, `recipeFactorMilli`, `ingredients[].recipeLine` | RC-4 | as today |
| `GET /v1/kitchen/me/feed` (finished dishes in your groups, last 7 days), only if today's reads can't give it | RC-2 | self |

Policy actions follow `kitchen.*` in `packages/policy-engine`: recipes are personal, so ownership is checked in the worker as personal items are today. Group visibility is a membership read.

## 8. Console routes

| Route | Task | Frame |
|---|---|---|
| `/home`, `/pantry`, `/you`, `/people/[id]` | RC-2 | same URL; the page picks the new or old component |
| `/money` | RC-2 | new frame only |
| `/cook` | RC-5 | the Cook hub in the new frame; today's cook screen in prod |
| `/recipes/[id]`, `/recipes/new`, `/recipes/[id]/edit` | RC-5 | new frame only |
| `/cook/session` | RC-6 | new frame only |
| `/explore`, `/r/[code]` | RC-8 | new frame only |

Dynamic routes follow SM-2's static pages (`scripts/pages-as-files.mjs`, the `_` file fallback, `usePathParam`), as `dishes/[id]` does. Reads a screen needs offline are added to the service worker's `API_READS` (PW-4).

## 9. Out of scope

- Photos.
- Likes and comments.
- Followers and public profiles.
- Search of strangers' recipes.
- Shopping lists from missing lines (the obvious next step).
- Timers per step.
- Nutrition.
- Translating recipes.
- Store apps.
