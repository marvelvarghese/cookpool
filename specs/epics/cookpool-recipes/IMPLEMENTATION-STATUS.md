# cookpool-recipes (RC) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| RC0 — the spec | landing | RC-1 |
| RC1 — the new frame (stage) | | |
| RC2 — recipes | | |
| RC3 — cooking sessions | | |
| RC4 — recipes travel | | |
| RC5 — prod | | |

## Departures from the design

### RC1 — item notes (RC-3)

**What shipped.**

- **Migration `330_kitchen_item_notes`**, laid out as 300: one nullable `kitchen_items.note TEXT CHECK (note IS NULL OR length(note) <= 80)`, no default, so every item written before reads as NULL. Its manifest entry follows 320 with its checksum.
- **Storage** (`packages/db/src/kitchen`): `note` is one of `ITEM_COLUMNS`, so every item read carries it: get, list, search, the use-soon sweep, the dish reads, uses and moves. The insert takes `NewKitchenItem.note`. `updateItem` sets `KitchenItemChanges.note` with no "unused" guard, so a note changes at any time, as a name does. A note over 80 is refused by the CHECK as `invalid` (`item_out_of_range`).
- **Contracts**: `KitchenItem.note`, plus `note` on `CreatePersonalItemRequest`/`CreateGroupItemRequest` and `UpdatePersonalItemRequest`/`UpdateGroupItemRequest`. Three shared helpers: `ITEM_NOTE_MAX` (80), `normalizeItemNote` (trim; empty is null) and `itemNoteLength`.
- **kitchen-worker**: the add and the edit validate `note` (`noteValue` in `pantry.ts`). It must be text or null. It is trimmed, and empty or spaces becomes null. More than 80 characters is 422 `validation_failed` on `note`. A note alone is a valid PATCH. `toKitchenItem` returns `note` on every route that answers with an item. A note writes no ledger transaction, split, stock move or audit event.
- **Who sees it**: whoever can read the item. In a personal pantry that is its owner (404 for anyone else). In a group's pantry it is every member, viewers included, and nobody outside (404). Someone who leaves loses it at once.
- **Who changes it**: anyone who can edit the item, by the same rule as any group edit. That is the buyer, or an owner or admin. Another member gets 403 `not_buyer`, and a viewer gets 404.
- **SDK**: the client already sends the contract bodies. Its doc comments name `note`, and tests cover the four calls and a 422.
- **Console**, all behind `newFrame()` (`src/lib/features.ts`, added here as RC-2 specifies it). With the flag off, every request and row is byte-for-byte what it was (tested).
  - **Bought**: a **Note** textarea sits after the use-by as the last section (`boughtSections(group, notes)`). It holds at most 80 characters, with the placeholder "For Sunday's curry". The hint reads "Only you see it" or "Everyone in Flat 4B sees it", with an `18/80` count. A note is sent only when it is not empty. Picking from "from before" keeps what was typed: notes are never filled from history. The pending row (SM-5) shows the note at once.
  - **Item page**: a **Note** block sits under the stock card. It shows the note behind a pencil, with Change, or "Add a note" when empty. Editing happens in place: the field, Cancel, then Save, which reads Remove once the field is emptied. It saves at once with the ten-second Undo, which PATCHes the old note back (`useSetItemNote`, the measures pattern). People who may not edit see the note without buttons, and nothing when there is none.
  - **Pantry row**: the note is a third line, a 12 px pencil and the note on one line, ellipsized. On desktop it also sits under the name in the table.

**Departures.**

- **`KitchenItem.note` is optional in the type** (`note?: string | null`), like `measures?`. That keeps items typed before RC-3 (fixtures, RC-2's work) compiling. The server always sends it, as null when unset.
- **Length is counted in characters, not UTF-16 units**, to match SQLite's `length()`: 80 emoji fit. The textarea's `maxLength` counts UTF-16 units, so it is the stricter of the two. Only a paste of wide characters can reach the form's "Keep it to 80 characters".
- **A note moves with its item.** Moving your own item into a group (transfer) keeps the note, and the group then sees it. Visibility follows the item, as §1.5 says. Bought's "Only you see it" holds until you move it.
- **Group audit**: `kitchen.item.added` does not carry the note, which keeps the group's log to the item's facts.
- **Removed items**: the console offers no note edit on a removed item. Used-up and wasted items can still change their note, as their name can.
- **Edits outside "the item form, the item page and the pantry row"**: `pantry/page.tsx` passes `notes: newFrame()` at its two row call sites (a likely merge point with RC-2). `tests/db/src/notifications-push.test.ts` pinned 310/320 as the last migrations, so it now checks "right after 300". Three console tests that pinned shapes now list `note`.
- **No version on a note edit**: a note PATCH sends no `version`, so the last write wins, and Undo re-sends the old note.
- **Not checked on stage** (nothing deployed). The new pieces were looked at locally at 375 px through a temporary fixture page, which was removed. Prod's frame is covered by tests only.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/db` | 5 (330's shape; real SQLite: old rows read null, every read carries it, set/clear moves no money, 80 by characters) | 724 |
| `tests/kitchen-worker` | 14 (`item-notes.test.ts`) | 488 |
| `tests/contracts` | 4 (`kitchen-item-notes.test.ts`) | 170 |
| `tests/web-console-next` | 21 (`kitchen-item-notes.test.ts` 20, from before 1) | 1316 |
| `packages/sdk` | 2 | 171 |

`pnpm typecheck` and `pnpm lint` pass, and `orun task check RC-3 --base origin/main` passes: 10 changed components, all inside the contract.

### RC1 — the new frame (RC-2)

**What shipped.** The console only; no server, contract or SDK change.

- **The switch** (`src/lib/features.ts`): `newFrame()` is true wherever `appConfig().deployEnv` is not `prod`. That covers stage, dev, local and a workers.dev host that names no environment. It is read in the browser from the page's host. `newFrameFor(env)` is the pure rule. `frameRedirect(page, on)` says where a new-frame-only page sends a prod visitor. Every kitchen page renders only once the session is ready, never while it is prerendered, so one prerendered file serves both frames.
- **Five tabs** (`nav.ts`, `tab-bar.tsx`, `sidebar.tsx`): **Home · Pantry · Cook · Money · You**. Cook sits in the middle, its icon in a 44 px filled green rounded square. There is no + tab, and the Add sheet is not mounted in the new frame. From 900 px the sidebar lists the same five. It has no Add button and keeps Recent groups and the person at its foot. With the flag off, both bars are today's.
- **Home** (`/home` picks `NewHome` or today's at render; `new-home.ts` lists each frame's sections):
  - "Hi, Rahul".
  - What did you use?, today's field with its usuals row.
  - **To do**: today's inbox rows, reordered: dishes first, an open dish with its ½-step chips (0 ½ 1 1½ 2) in the row; then Pay X; then use soon or past its date; then flags.
  - **Cook now**: an empty slot, `CookNow` in `cook-now-slot.tsx`, for RC-5 to replace.
  - **From your groups**: a card per dish finished in the last 7 days in any of your groups. Each has the cook's face, "Meera cooked", the group and when, the name, and three numbers: portions, each, you had.
  - No money card and no Recent.
- **Money** (`/money`, new frame only, `money-ui.tsx`):
  - One figure per currency: you get back / you owe.
  - **Settle up**, the main button, goes to today's settle screen (`/people`). **Bill** asks which group and then opens today's Add a bill.
  - A segmented **People | Groups**, kept in the address as `?list=groups`. A person row has face, name, shared group and the amount with its direction; it opens `/people/[id]`. A group row has its tile, name, member count and your balance; it opens today's group page.
  - Under Groups: **New group** and **Join with a link**.
  - A prod visitor is sent to `/home`.
- **You** (`/you`, `YourPage` in `profile-ui.tsx`):
  - Your 64 px face, name and groups.
  - **Cooks** and **Groups**.
  - A "Cooks a week" column chart over the last 8 weeks.
  - Your recent cooks.
  - The gear opens **`/you/settings`**, today's You rows (name, how you sign in, notifications, install, sign out) titled Settings. In prod `/you` is today's page, and `/you/settings` sends a visitor to `/you`.
- **A person** (`/people/[id]`, `NewPerson`):
  - Back, their 64 px face, name and "In Flat 4B with you".
  - The balance strip ("You get back ₹40.00"), with **Settle up**.
  - Their recent cooks in the groups you share.
  - Today's itemized Why, open under a **Why** heading.
  - In prod the page is unchanged (`TodayPerson`).
- **Session bar slot**: `SessionBar` (`session-bar.tsx`) sits in the kitchen layout above the tab bar, in the new frame only. It renders nothing; RC-6 owns it.
- **Routes**: `/money` and `/you/settings` are added to `static-pages.mjs` (SM-2's pattern), so they are served as files and precached.
- **Home-screen shortcuts** (plan item): in the new frame they are **What did you use?** (`/use`) and **Start cooking** (`/cook`).
- **Offline**: `GET /v1/kitchen/me/dishes` joins the service worker's `API_READS`.

**Departures.**

- **No feed route.** From your groups, your Cooks, Cooks a week and a person's cooks all come from the existing `GET /v1/kitchen/me/dishes`: what you cooked plus what was shared with your groups, newest cooked first. It is read 100 at a time, at most four pages, until it covers 14 days (Home) or 56 days (You, a person). One cache entry, under `qk.kitchenDishes()`, serves all three. Two limits follow:
  - A dish finished this week but cooked more than 14 days ago does not show on Home.
  - Past 400 dishes read, Cooks reads "400+".
- **The To do order is set in the console.** Dishes, then payments, then use soon or past its date, then flags; within each, the server's order holds. The server's own order (past-date food first) is unchanged, and so is the icon badge count. Home still shows three rows and "See all".
- **Home keeps two things the canvas doesn't draw**: the install card (PW-2) under the greeting, and the usuals row under What did you use? ("the existing field", and RC-H's "Do it again stays").
- **`/cook` is today's cook screen** in the Cook tab, Back button included; in the new frame Back goes Home. RC-5 replaces it.
- **Settle up on Money** goes to `/people`, today's settle screen; `/settle` only redirects there. **Settle up on a person's page** is today's Record payment (which group, then UPI · Cash · Bank) under the new label.
- **Bill** skips groups you only view, and goes straight to the group when there is one.
- **You**:
  - Only Cooks and Groups; RC-5 adds Recipes and Saved by.
  - "Your cooks" stands alone; RC-5 adds the Recipes | Cooks tabs.
  - Cooks a week counts 7-day windows ending today, not calendar weeks. The number sits on this week's column only; every column states its count in its tooltip and accessible name.
- **A person's cooks** are those in the groups the person read lists. That read also lists any group where money between you is still open.
- **Where pages sit in the new frame**:
  - Tabs: `/use` is Home's; `/dishes`, `/recipes`, `/explore` and `/r` are Cook's; `/people`, `/settle`, `/groups` and `/join` are Money's; `/you/*` is You's.
  - Back: Groups, People, a group, a person, a join link and `/settle` go back to Money, and `/you/notifications` to settings. `backParent` and the edge swipe take the frame.
  - People and Groups, now reached from Money, show a Back in the new frame only.
- **The manifest decides its shortcuts on the server, from the request's host.** It switches only where the host names an environment other than prod. Localhost, an unknown host or no request keeps today's three, so prod's can't change by accident. `app-config.ts` gains `requestAppConfig(host)` for this.
- **Colours**: amounts use the kit's tokens (`cp-owed` #1D5FB8, `cp-owe` #C2410C), not the brief's #1D4ED8. The cook colour #B4471F marks the pot on From your groups cards.
- **Moved without change** so both frames share it:
  - today's You → `you-settings-ui.tsx` (gains `title`/`sub` props whose defaults render as before);
  - today's person page → `person-ui.tsx` (Record payment gains a `title` prop, default "Record payment");
  - Home's QuickUse → `quick-use-ui.tsx`.
- **Existing tests touched**, because a new page must choose:
  - `gestures.test.ts`: `/money` pulls to refresh, `/you/settings` doesn't;
  - `sw-routes.test.ts`: the new offline read.

  No assertion about today's frame changed.
- **Merged with RC-3**: one `newFrame()`, RC-2's. It is a superset with the same rule and default, so RC-3's test of it passes unchanged. RC-3's `notes: newFrame()` in `pantry/page.tsx` is kept.
- **Not checked on stage** (nothing deployed). The new screens were looked at locally at 375 px and 1280 px against a temporary in-page mock of the API, so no request left the machine. The mock was removed and never committed. Prod's frame is covered by tests only.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/web-console-next` | 69: `kitchen-features` 6, `kitchen-new-frame` 20 (tabs in both frames, active tab, Back, swipe, pull, shortcuts), `kitchen-money-page` 14 (figures, People, Groups, list, prod redirect), `kitchen-new-home` 15 (sections in both frames, no money card, To do order, From your groups, read window), `kitchen-cooks` 13, offline read 1 | 1385 (76 suites, after merging RC-3) |

`pnpm typecheck` and `pnpm lint` pass for `apps/web-console-next` and `tests/web-console-next`, and `orun task check RC-2 --base origin/main` passes: 2 changed components, all inside the contract.

### RC2 — recipes in the server (RC-4)

**What shipped.** The server only: storage, contracts, kitchen-worker and the SDK. No console file changed.

- **Migration `340_kitchen_foods`**:
  - `kitchen_foods` (key PK, name, `mass`/`volume`/`count`, `each_g` in whole grams or NULL, a pantry category);
  - `kitchen_food_names` (name_key PK, folded as `lower(trim())` → one food);
  - `kitchen_items.food_key` (nullable, FK to the list);
  - `kitchen_food_answers` (the "asked once" answer per pantry and name, keyed `owner_kind` + `owner_id` as `kitchen_measures` is; `food_key` NULL is "none of these");
  - `kitchen_always_have` (user_id, food_key) and `kitchen_always_have_lists` (who has saved a list);
  - the seed: 70 foods and 330 names in English, Hindi and regional words (onion/onions/pyaz/kanda, aloo, chawal, dahi, haldi, dhaniya, jeera, dal, …), one row per food and then one row per name, with `INSERT OR IGNORE`, so RC-7's 360 extends it the same way;
  - one backfill `UPDATE` that links the items already in pantries by the same lookup.
- **Migration `350_kitchen_recipes`**:
  - `kitchen_recipes`: `rcp_` id, owner, name, `serves_half`, minutes, visibility, `link_code` UNIQUE, the three source fields, `is_system` (only for `usr_cookpool`), kind, created/updated/deleted. A CHECK keeps `link_code` set exactly while visibility is `link`.
  - `kitchen_recipe_lines`: positions 0–39. Each line has an amount in a unit or is to taste with neither. A unique partial index allows one main line per recipe, and the main line is never to taste.
  - `kitchen_recipe_steps`: positions 0–19, at most 200 characters each.
  - `kitchen_dishes.recipe_id`, `kitchen_dishes.recipe_factor_milli` and `kitchen_dish_ingredients.recipe_line`, all nullable, plus an index on (cook, recipe_id, cooked_at) for last time.
  - Its manifest entries follow RC-3's 330.
- **matchFood** is one SQL expression (`packages/db/src/kitchen/food-link.ts`). A pantry's answer wins, a "none" answer included. Then comes the name itself. Then the name without a plural "es" or "s", which links only when those agree on exactly one food. The add's own batch links the item with it, personal or group, and a dish's just-bought items too, so the item add needs no extra read. `foodNameKey` and `foodLookupKeys` in contracts mirror it for the console.
- **Scaling** (`packages/contracts/src/kitchen-recipes.ts`, re-exported from `kitchen.ts`):
  - `scaleLine(qtyMilli, unit, factorMilli)` rounds pcs, count words and spoons to ½ (at least ½); g and ml to 5 below 100, 10 below 1000, then 50 (at least 5 g); kg and L to 0.01 (at least 0.01). To taste returns null.
  - `scalePortions(servesHalf, factorMilli)` returns `{ portionsHalf, about, label }`: "2", "2½", "about 2".
  - Also `factorForMain`, `factorForPortions` and `lineQuantity`.
- **Routes** (design §7), all in kitchen-worker's router behind the existing `/v1/kitchen/*` facade, with the usual envelopes, 422 with field errors, and the opaque 404 for anything the caller may not see:

  | Method and path | Who | Contract types |
  |---|---|---|
  | `GET /v1/kitchen/foods?q=&limit=` | signed in | `FoodsQuery`, `FoodsResponse` (`FoodMatch`) |
  | `PUT /v1/kitchen/me/food-answers` | own pantry, or `kitchen.item.use` in the group | `SetFoodAnswerRequest`, `SetFoodAnswerResponse` |
  | `GET`/`PUT /v1/kitchen/me/always-have` | self | `AlwaysHaveResponse`, `SetAlwaysHaveRequest` |
  | `GET /v1/kitchen/me/recipes` | self | `MyRecipesResponse` (`RecipeSummary`) |
  | `POST /v1/kitchen/me/recipes` | self | `CreateRecipeBody` = `CreateRecipeRequest` \| `SaveDishAsRecipeRequest`; `RecipeResponse` |
  | `GET /v1/kitchen/recipes/{rcp}?code=` | may see it | `RecipeResponse` (`KitchenRecipe`, `RecipeLastCook`) |
  | `PATCH`/`DELETE /v1/kitchen/me/recipes/{rcp}` | owner | `UpdateRecipeRequest`; `RecipeResponse` |
  | `GET /v1/kitchen/me/recipes/{rcp}/match?f=&code=` | may see it | `RecipeMatchQuery`, `RecipeMatchResponse` (`RecipeLineMatch`, `RecipeMatchItem`, `RecipeMatchSummary`, `UnlinkedItem`) |
  | `POST`/`DELETE /v1/kitchen/me/recipes/{rcp}/link` | owner | `RecipeResponse` (`recipe.linkCode`) |
  | `GET /v1/kitchen/recipe-links/{code}` | signed in | `RecipeResponse` |
  | `POST /v1/kitchen/me/recipes/copies` | may see it | `CopyRecipeRequest`; `RecipeResponse` |
  | `GET /v1/kitchen/people/{usr}/recipes` | shares a group | `PersonRecipesResponse` |
  | `GET /v1/kitchen/recipes?source=cookpool\|groups&q=&kind=` | signed in | `ExploreRecipesQuery`, `ExploreRecipesResponse` (`ExploreRecipe`) |
  | `GET /v1/kitchen/me/cook-now` | self | `CookNowResponse` (`CookNowEntry`) |
  | `POST /v1/kitchen/me/dishes` gains `recipeId`, `recipeFactorMilli`, `ingredients[].recipeLine` | as today | `CookDishRequest`; `KitchenDish.recipeId`/`recipeFactorMilli`, `KitchenDishIngredient.recipeLine` |

- **Visibility** (§5.1), checked in the worker (`canSee` in `recipes.ts`), with no policy action:
  - Cookpool's own and the owner's are always visible.
  - only_me: nobody else.
  - link: anyone with the code.
  - groups or link: anyone who shares a group with the owner now. This reads membership for both people, so leaving ends it at once.
  - Explore's "Your groups" and Cook now read the co-members from the rosters of the caller's groups.
  - The link code is only ever shown to the owner.
- **The match** (§3.3):
  - Items count when they are active, have something left, link to the line's food, and sit in the caller's own pantry or a group whose role holds `kitchen.item.use`.
  - Lines of the same dimension compare directly. A count line meets an item through its measure (the one the line's unit names, else its first), else a mass item through `each_g`. A mass line meets a count item through `each_g`.
  - Items are taken soonest use-by first, then the caller's own, then the most left, until the need is met; each carries `takeMilli`.
  - `maxFactorMilli` is the smallest available ÷ written over the lines that aren't "always", and null when anything is missing.
  - The whole match is four reads, however many recipes (items, foods, Always have, measures).
- **Cook now** ranks every visible recipe (yours and your copies, Cookpool's, your groups'). It sorts by fewest missing, then the largest factor, then the most recently cooked, then by name, and returns the first 20. Each entry carries its summary (up to three missing names) and `forPortionsHalf`.
- **The dish write**:
  - The recipe must be visible to the cook (404 otherwise).
  - A `recipeLine` must be a line the recipe has (422).
  - `recipeFactorMilli` and `recipeLine` need `recipeId` (422).
  - All three are stored and returned on every dish read. Costs, transactions and splits are computed exactly as before; a test compares them with the same take without a recipe.
- **lastCook** is the caller's latest dish with the recipe that wasn't canceled: when, the factor, the portions, and for each ingredient that named a line its quantity, unit and label.
- **fromDishId** saves any dish the caller can read that wasn't canceled. Each ingredient becomes a line at the amount used, linked to its item's food. Serves comes from the dish's portions. The heaviest ingredient is the main line: volume counts as water, pieces by `each_g`.
- **SDK**: `KitchenClient` gains `foods`, `setFoodAnswer`, `alwaysHave`, `setAlwaysHave`, `myRecipes`, `createRecipe`, `getRecipe`, `updateRecipe`, `deleteRecipe`, `recipeMatch`, `shareRecipeLink`, `stopRecipeLink`, `recipeByLink`, `copyRecipe`, `personRecipes`, `exploreRecipes` and `cookNow`. The types and the scaling helpers are re-exported from `@saas/sdk`.

**Departures.**

- **70 seed foods, not about 60**, and 340 also links the items already in pantries (one `UPDATE … WHERE food_key IS NULL`). Without it, every existing pantry would read "missing" until each item was re-added.
- **An extra table, `kitchen_always_have_lists`.** It records that someone has saved their list, so a list they emptied stays empty instead of falling back to salt and water.
- **Answers are keyed like measures** (`owner_kind`, `owner_id`), and **"none of these" is an answer** (`foodKey: null`). It unlinks that name's items in that pantry and stops the names table from linking them again, so the ask happens once.
- **The exact name wins over its plural-dropped forms.** "Exactly one food" applies to the "es"/"s" candidates, which link only when they agree.
- **Type names.** SM-8 already owns `Recipe`, `RecipeMatch`, `RecipeIngredient` and `RecipesResponse` (dishes cooked before), so the recipe types are `KitchenRecipe`, `RecipeSummary`, `KitchenRecipeLine`, `RecipeMatchResponse` and so on. They live in `kitchen-recipes.ts`, which is re-exported from `kitchen.ts` (and is `@saas/contracts/kitchen-recipes`). The storage record is `KitchenRecipeTemplateRecord`.
- **A line's `qtyMilli` is thousandths of its unit's base** (g, ml, pieces), as an item's is. A count word ("onion") is one piece. `RECIPE_UNITS` restates the engine's unit sizes in contracts, which has no dependencies; a kitchen-worker test pins the two equal.
- **Factor range** is 10–20 000 (× 0.01 to × 20). `maxFactorMilli` is capped at 20 000, and is 20 000 when no line limits it.
- **`?code=` on `GET /recipes/{rcp}` and `…/match`** lets a link holder read and match a recipe without saving it first. The dish write takes no code: a link holder cooks from their copy.
- **The match carries more than the design lists.** It has the portions, and per item `takeMilli`, `ref`, the pantry, name, unit and use-by. It also has `unlinked`: up to 20 usable items that link to no food and were never answered, which is what RC-8's "Is Kanda onion?" asks about. Items themselves don't expose `foodKey`, which keeps the item shape RC-3 just changed as it is.
- **Spoons don't meet weights.** There are no densities, so "1 tsp turmeric" never meets a pantry's 100 g of it, and reads missing unless turmeric is on Always have (the design's own example). This is worth revisiting with RC-7's content.
- **Explore**: "Your groups" leaves out the caller's own recipes, which are in My recipes, and includes link ones. It returns at most 50, newest first, each with its match at its written size.
- **Kinds** are `breakfast`, `dal_curry`, `rice`, `roti`, `snack`, `sweet`, `drink` and `other`. Explore's chips plus three for RC-7's rotis, chai and the rest. The worker checks them; the table has no CHECK, so RC-7 can add one without a rebuild.
- **Sharing**: PATCH to `link` mints a code if there is none. Any other visibility drops it. `DELETE …/link` returns the recipe to My groups. Deleting is soft and leaves visibility and code as they were, but no read sees a deleted recipe. DELETE answers the recipe as it was.
- **More of the dish write takes a line**: `newItems[].recipeLine` too, for something bought during a session. The new dish fields are optional in the contract types (as `label` is), so dishes typed before still check. The server always sends them.
- **fromDishId** takes a dish shared with the caller's group, not only their own. A canceled dish is 409 `dish_not_open`. A dozen becomes `pcs` and a pack becomes the count word "pack".
- **`GET /people/{usr}/recipes` for yourself is 404**, as the person read is; use `/me/recipes`.
- **A copy of Cookpool's own** reads "from Cookpool". "Saved by" counts live copies.
- **Recipes write no audit event.** The log is a group's, and a recipe is a person's, as with a personal item.
- **`tests/db/src/notifications-push.test.ts`** checks the two migrations right after 300 rather than the last two. RC-3 made the same change, and the merge took theirs.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/db` | 23: `kitchen-recipes-migration` 11 (340/350 shape, the seed and its names, the backfill, every CHECK, FK and unique rule on real SQLite), `kitchen-recipes` 12 (matchFood, linking on add, answers, Always have, search, usable and unlinked items, recipes written, listed, edited, linked, deleted, copied, the dish's recipe link and last cook) | 749 |
| `tests/contracts` | 16 (`kitchen-recipes`: examples and seeded property checks, each over thousands of cases: scaling by 1 is the identity after rounding, every result sits on its unit's grid and never below one step, within half a step of exact, monotonic in the factor; portions exact exactly when whole or half; folding; the route shapes) | 186 |
| `tests/kitchen-worker` | 42: `foods` 10, `recipes` 17 (writing, the visibility matrix — owner, co-member, viewer, stranger, link holder, after rotating, after the link is off, after leaving — Cookpool's own, edit/delete, copies and their independence, a person's recipes, Explore, 401/405 on every route, the unit sizes against the engine), `recipe-match` 9 (have/short/missing/always, preference order, count↔mass through each_g and through a measure, Always have, maxFactor, a viewer's match, Cook now's order and limit), `recipe-dishes` 6 (dish with a recipe, money unchanged, refusals, lastCook, fromDishId) | 530 |
| `packages/sdk` | 4 | 175 |

`pnpm typecheck` and `pnpm lint` pass repo-wide (`tests/web-console-next`, untouched, still passes 1385), and `orun task check RC-4 --base origin/main` passes: 8 changed components, all inside the contract.

### RC3 — cooking sessions (RC-6)

**What shipped.** The console only; no server, contract, SDK or migration change. Everything is behind `newFrame()`: with it off, no screen, request or bar changes.

- **The draft** (`components/kitchen/cook-session.ts`, pure) and its **store** (`lib/cook-session-store.ts`, a thin localStorage adapter):
  - One plain object per account under `<storagePrefix>.session.<accountId>`. It holds the recipe id (or null) and factor, the name, serves (for the chip), whether you own the recipe, the lines, the steps done, the post-to group and `startedAt`.
  - A line holds its food, its words, the amount (`qtyMilli`) and unit, the item(s) to take (each with what the match took and a snapshot of the item: price, who paid, what is left), `recipeLine`, ticked, missing and to taste, last time's words, and the recipe's own line as written.
  - **One at a time** (`openChoice`): `/cook/session` resumes what is open; `?recipe=` for the same recipe resumes; another recipe asks "Finish or discard Chicken curry?" (**Resume** / **Discard and start**). An empty blank session gives way without asking.
  - Cleared on Finish, on Discard, and on sign-out: `clearDeviceRecords` now also clears every `<prefix>.session.*` key. Other tabs follow through the `storage` event.
- **`/cook/session`** (new page, `cook-session-screen.tsx`, `cook-session-ui.tsx`, `cook-session-data.ts`). A prod visitor goes to `/home` (`NEW_FRAME_ONLY`). It is a static page (SM-2), belongs to the Cook tab, has no pull to refresh, and minimize goes back, else to `/cook`.
  - **From a recipe** (`?recipe=rcp_…&f=450`): it reads the recipe (`GET /v1/kitchen/recipes/{id}`, with `lastCook`) and the match at `f`, makes the draft, then drops the query from the address. Each line takes the match's items, one take per item. Its amount comes from `scaleLine`. Last time comes from `lastCook`, summed per line when one unit. A missing line is kept, struck through ("Not in your pantries · left out") with a dashed, disabled tick.
  - **Blank:** the first field is the name, with from before's "Cooked before" under it (SM-3's type-ahead and `useRecipes`). Picking one fills its lines at last time's amounts, from the item matched now. A second pick replaces the first pick's lines and keeps lines added by hand.
  - **Header:** minimize (chevron-down), COOKING, a clock since `startedAt` ("12:04"), the name as h1, the dark chip "For about 2 · ×0.45" to `/recipes/<id>` (none blank), and "3 of 7 in".
  - **Rows:**
    - a 44 px tick (green when ticked; the row is `#EEF7F1`);
    - the name;
    - "Flat 4B · Meera paid · last time 2 onions" ("Your pantry", "Always have", "Just bought", "None left now", "· short");
    - the amount as a button that opens − / + in the row, with "≈ 225 g · ₹9" (the dish maker's `lineCost`; just the money when the line counts in the item's own unit; "not counted" when it takes nothing).
    - To-taste lines tick and show "To taste".
  - **Add an item:** a dashed button that opens today's item picker (`PantryPanel`: search every pantry, Bought it just now) in a sheet. It adds a line with that item at the dish maker's starting amount, or a just-bought line.
  - **Steps · 2 of 5**, expandable, each step a checkbox. **Discard session** under them asks once, then goes to `/cook`.
  - The items are read fresh as you cook: from the usable-items list, else each on its own by ref. Less left cuts the take, and an item gone leaves it out.
- **Finish:** the green main button above the tab bar, "Finish" over "₹143.96 so far · post to Flat 4B" ("Nothing in yet · …" before a tick). Offline it says "You're offline…" and keeps the session. It opens a bottom sheet:
  - "3 not ticked" with **Took them all** (default) / **Leave them out**;
  - **Who ate:** the post-to group's faces, ½ steppers and each share by the engine (you at 1, the rest at 0);
  - **Post to** (`SharePicker`, titled "Post to"): the group most lines take from, else the group opened last, else Just me. Just me hides Who ate;
  - the switch: **Save today's amounts to my recipe** (yours, and an amount differs) or **Save as a recipe** (blank);
  - **Post to Flat 4B** in the cook colour, "₹143.96 · 2 portions · ₹71.98 each".
- **Posting** (`finishPlan`, then `runFinish`, wired by `useFinishSession`):
  1. `POST /v1/kitchen/me/dishes` with name, `orgId`, `portionsHalf` (Who ate's total, at least ½), `splitMode: "claims"`, ingredients `{ itemId, quantity, unit, recipeLine }`, `recipeId` and `recipeFactorMilli`.
  2. `PUT …/dishes/{dsh}/shares` with each eater (you first, then the group's order).
  3. With the switch on, `PATCH /v1/kitchen/me/recipes/{id}` `{ lines }` or `POST /v1/kitchen/me/recipes` `{ fromDishId }`.
  4. Then the draft is cleared, the dish page opens, and the toast offers Undo, which cancels the dish (the existing cancel route).
  - A refusal (409 `insufficient_stock` and the like) closes the sheet, says why above Finish, outlines the line and scrolls to it, and keeps the session. A shares or recipe write that fails leaves the dish cooked and says so in a second toast.
- **The bar** (`session-bar.tsx`): while a session is open and you are not on it, a dark bar (`#17201B`, radius 18) sits above the tab bar. It holds a pot tile in `#B4471F`, the name, "Cooking · 12 min · 3 of 7 in" and a white **Resume** to `/cook/session`. From 900 px it is in the sidebar's footer. It hides while a field has the keyboard up on a phone, and adds room at the end of the page so it covers nothing.

**Departures.**

- **Just me posts `splitMode: "assign"`**, one portion, and no shares: the server takes claims only in a group (today's dish maker does the same).
- **An item two lines take from is sent once**: the server refuses an item named twice ("Name each item once"). It is summed, no more than is left, and carries the first line's `recipeLine`.
- **Ingredients go in the item's base unit** (g, ml, pcs, pack), never in a measure. The next session's Last time therefore reads "300 g" for an onion line cooked this way, where `lastCook` has no label.
- **The stepper** steps 50 g or 50 ml from 100 up and 10 below 100, so a spoon-sized amount can move. Pieces, spoons, cups, packs and count words step by ½. One step is the least: a line is taken out with Leave them out, not by stepping to 0.
- **A line's takes follow its amount in proportion**, each capped at what is left, with the rest moving to the next item. When nothing can cover it, the line reads "short" and its note "all there is".
- **"so far" counts the ticked lines.** Post's total counts what posts: ticked lines, plus the unticked ones on Took them all.
- **"Save today's amounts"** writes a changed line back at the recipe's own size (today's amount ÷ the factor, on its unit's grid). Every other line stays exactly as written, so ×0.45 doesn't rewrite the whole recipe. It is off by default, and it needs `mine` from the recipe read.
- **The bar stays off the forms that have their own sticky main button** (`/use`, Bought, an item, a dish, Add a bill), as well as off the session. It does show on `/cook`. Until RC-5 replaces today's dish maker there, the bar can sit over its Cook button on stage.
- **Desktop shows the session as a page**, not design §1.4's right-hand panel. The bar sits in the sidebar's footer.
- **The draft keeps a snapshot of each item**, so costs and payers show after a reload and offline. An item is read again whenever the usable-items list changes, or on its own when it isn't in that list (more than 100 items).
- **An empty blank session stays on the device** but hides from the bar, and its clock restarts when the page opens it again.
- **Query keys:** `qk.kitchenRecipe(id)` and `qk.kitchenRecipeMatch(id, f)`, the match under `kitchenPantry()` so a stock write refreshes it. RC-5 will want the same reads: merge to one pair.
- **Offline reads:** the recipe read and the match are not in `API_READS` (RC-5 adds them). Offline, starting from a recipe shows "Couldn't start cooking that recipe"; an open session keeps working.
- **Edits outside the new files:**
  - `features.ts` (`/cook/session` → `/home`), `static-pages.mjs`, `back.ts` (parent `/cook`) and `query-keys.ts`;
  - `sign-out.ts` (`clearCookSessions` in `clearDeviceRecords`);
  - `sidebar.tsx` (the footer slot), and the comment in `(kitchen)/layout.tsx`;
  - `SharePicker` gains an optional `title` (default "Share it with": the dish maker is unchanged);
  - `gestures.test.ts` lists `/cook/session` among the pages that don't pull to refresh. No other existing assertion changed.
- **Not checked on stage** (nothing deployed). The screens were looked at locally at 375 px and 1280 px, against a temporary in-page mock of the API, so no request left the machine. The mock was removed and never committed. What was checked:
  - from a recipe;
  - ticks and the stepper;
  - the bar on Money and Home, after a reload too;
  - Resume;
  - Finish, with the posted body, the shares call and the PATCH;
  - blank with Cooked before;
  - Add an item;
  - the one-at-a-time sheet;
  - Finish offline;
  - the sidebar's bar.

  `next build` prerenders `/cook/session` as a static page.

### RC4 — Cookpool's recipes and the food list (RC-7)

**What shipped.** Storage, contracts and kitchen-worker's match. No console file changed.

- **Migration `360_kitchen_cookpool_recipes`**, laid out as 340 and 350, with its manifest entry and checksum:
  - **Density**: `kitchen_foods.g_per_ml REAL NULL CHECK (g_per_ml IS NULL OR (g_per_ml > 0 AND g_per_ml <= 5))`, grams per millilitre. One `UPDATE … WHERE g_per_ml IS NULL` sets it on 50 of RC-4's 70 foods (spices, salt, sugar, flours, rice, dals, oil, ghee, milk and curd, and chopped vegetables and herbs). The new foods carry theirs in the insert. In all, 173 of the 300 foods have one.
  - **Foods**: 230 more, so **300** in all, in RC-4's seven categories: veg 62, fruit 28, grains (grains, flours, dals and pulses) 51, dairy 13, protein 14, spices 55, other (oils, sauces and condiments, baking, nuts and dry fruit, snacks, drinks) 77. Each food has a dimension, `each_g` where people count it (sweet potato 200, drumstick 50, pav 40, papad 10), and answers to its own key in words.
  - **Names**: 1,850 more, so **2,180** in all. That is 1,361 for the new foods and 489 more for RC-4's. They are in English, Hindi, Tamil, Telugu, Malayalam, Kannada, Bengali and Marathi where common (lauki, sorakkai, anapakaya, churakka, lau, dudhi), plus cuts and varieties (rohu, surmai, pomfret, bangda and mathi are fish; boneless and keema are chicken or mutton). RC-4's 70 foods and 330 names are exactly as 340 wrote them, which a test checks.
  - **Cookpool's 42 recipes** under `usr_cookpool`, with `is_system = 1` and visibility `groups` and no link code, as RC-4's helpers write them:
    - breakfast 5: Kanda poha, Rava upma, Egg bhurji, Masala omelette, Sabudana khichdi;
    - roti 4: Aloo paratha, Plain paratha, Chapati, Puri;
    - dal & curry 16: Dal tadka, Dal fry, Rajma, Chole, Sambar, Tomato rasam, Kadhi, Palak paneer, Paneer bhurji, Matar paneer, Aloo gobi, Bhindi fry, Baingan bharta, Chicken curry, Egg curry, Fish curry;
    - rice 6: Jeera rice, Veg pulao, Lemon rice, Curd rice, Moong dal khichdi, Veg fried rice;
    - drink 4: Masala chai, Filter coffee, Sweet lassi, Nimbu pani;
    - snack 3: Onion pakoda, Pav bhaji, Veg sandwich;
    - sweet 4: Rava sheera, Rice kheer, Besan ladoo, Gajar halwa.

    Each serves 2 to 6 and has its minutes and 4 to 18 lines (477 in all), exactly one of them main and never to taste. Every line, the 65 to-taste ones included, names a food on the list, in g, kg, ml, L, pcs, tsp, tbsp or cup. Every amount sits on its unit's rounding grid, so `scaleLine` at × 1 returns it as written. Each recipe has 3 to 6 steps of at most 200 characters (215 in all).
  - **Backfill**: items still unlinked are linked to the new foods and names by the same lookup an add uses, unless their pantry answered for that name.
  - Every seed statement is `INSERT OR IGNORE`, one per group of foods, of names, and of recipes' lines and steps. The largest is 15 KB, well under D1's 100 KB statement limit.
- **Storage** (`packages/db/src/kitchen`): `KitchenFoodRecord.gPerMl`, read by every food read (search, `getFoods`, `matchFood`, Always have).
- **Contracts**: `KitchenFood.gPerMl` (on `FoodMatch` and Always have's foods too), documented on the type. The `availableMilli` doc now says volumes meet weights.
- **kitchen-worker**: `toKitchenFood` returns `gPerMl`. In `itemPerLine` (the match, and with it Explore and Cook now), a count line still meets any item through its measure first. Otherwise both sides go through grams: a gram is 1, a millilitre is the food's `g_per_ml`, a piece is its `each_g`. So 1 tsp of turmeric meets a 100 g pack (3 g of it), a cup of rice meets a 1 kg bag (192 g), 50 g of ghee meets a 500 ml jar (≈ 56 ml), and a cup of chopped onion meets onions counted by the piece. A food without the figure it needs still reads missing.

**Density sources.** These are household weights per volume, rounded to two figures, for a 5 ml teaspoon, a 15 ml tablespoon and a 240 ml cup (contracts' `RECIPE_UNITS`).
- USDA FoodData Central (SR Legacy) household measures, for example:
  - ground turmeric 1 tsp = 3.0 g, so 0.6;
  - chilli powder 2.7 g/tsp, so 0.54;
  - table salt 6 g/tsp, so 1.2;
  - granulated sugar 200 g/cup, so 0.85;
  - whole-wheat flour 120 g/cup, so 0.5;
  - all-purpose flour 125 g/cup, so 0.52;
  - raw rice 185–200 g/cup, so 0.8;
  - lentils and mung beans 192–207 g/cup, so 0.8–0.85;
  - butter 0.95, yogurt 1.03, rolled oats 0.34, cornstarch 0.53, semolina 0.7, honey 1.42, ketchup 1.13, soy sauce 1.07.
- The FAO/INFOODS Density Database v2.0 (2012) for liquids and fats: oils 0.91–0.92, milk 1.03, ghee 0.9.
- Common Indian kitchen conversions where USDA has no entry: thick poha ≈ 75 g/cup (0.32), besan ≈ 95 g/cup (0.4), sabudana ≈ 155 g/cup (0.65), ground masalas 0.45–0.6.

**Departures.**

- **300 foods, 2,180 names and 42 recipes**, not "about 300" and "about 40". The names are close to seven per food because regional words are most of the value.
- **No katori.** RC-4's units are `g kg ml L pcs tsp tbsp cup`. Any other unit is a count word, one piece of the line's food, so "1 katori dal" would mean one dal. Lines say cups instead. A katori unit would need the kitchen engine's unit table, which this contract does not cover.
- **Small and whole spices are to taste.** Amounts round to half a spoon, so the smallest spoon line is ½ tsp. `each_g` is whole grams and RC-4's foods may not change, so a clove, a bay leaf, a cardamom pod or a sprig of curry leaves cannot be counted. Those lines, and hing, saffron and salt, are to taste with their food linked: 65 of 477 lines. The match counts them as there, as it does any to-taste line.
- **The conversion goes through grams both ways and for counts too**, rather than only volume ↔ mass. A cup of chopped onion meets onions counted in pieces (`g_per_ml ÷ each_g`). A measure still wins for a count line. The match also adds a millionth of a thousandth of slack before it floors what is available, so 1 ÷ 0.9 never loses the last thousandth (500 ml of ghee is 450 g, not 449.999).
- **`gPerMl` is optional in the type** (`gPerMl?: number | null`), as RC-3's `note?` is, so foods typed before RC-7 (fixtures, RC-5's and RC-6's work) still check. The server always sends it, as null when there is none.
- **The column has a CHECK** (above 0, at most 5) beyond the brief's `REAL NULL`. Because `INSERT OR IGNORE` skips a row that fails a CHECK without a word, a test applies 360's seed with plain `INSERT` on top of 350 and every row lands.
- **360 also backfills items** still unlinked, as 340 did, skipping any name a pantry answered ("none of these" included). Without it, an existing "Kaju" or "Arhar" would stay unlinked until re-added.
- **Fixed recipe ids and times.** The recipes are `c00c0360-0000-4000-8000-0000000000NN`, so a re-run adds nothing and copies keep their source. Their `created_at` is a minute apart from 2026-11-08T00:00Z, so Explore's newest-first order is the seed's order, from Kanda poha down to Gajar halwa.
- **Recipe names**: Kanda poha, Rava upma, Tomato rasam, Moong dal khichdi, Veg fried rice, Sweet lassi, Rava sheera and Rice kheer say which one they are. Explore's `q=poha` and the like still find them.
- **Words left out or placed on purpose**:
  - `methi` is the leaves; the seeds are `methi dana`.
  - `vellam` stays jaggery (Tamil), not water (Malayalam).
  - `dalia` is broken wheat, not the Gujarati roasted gram.
  - `sitaphal` is custard apple, not pumpkin.
  - `chakka` (jackfruit in Malayalam, hung curd in Marathi) and `kaya` are left out.
  - Brand names are left out (Milkmaid, Nutrela, Dalda, Frooti).
  - Fish varieties and chicken or mutton cuts are names of `fish`, `chicken` and `mutton`, not foods of their own, so Fish curry meets a pantry's rohu.
- **RC-4's tests changed only where the larger list or the seed changes the truth**:
  - the turmeric line in the match test now reads have (3 g of the pack);
  - food reads carry `gPerMl`;
  - search: `dal` lists dalchini, dalia, dal moth and dalimb before chana dal (RC-4's tiers put a name that starts with the query before a word that does), `pyaz` also finds spring onion (hara pyaz), and `chilli` finds six;
  - `?limit=100` is now a full page, so the egg is found by `q=anda`;
  - the 340 seed test reads a database migrated through 350;
  - the names test's not-a-food placeholder is now `kohlrabi`, since `shallot` is a name.

  Tests that count or rank recipes exactly (Explore, Cook now's order and its limit, the db list and the refused write) first take out Cookpool's seed (`withoutCookpoolSeed`).
- **Save as recipe** still weighs volume as water when it picks the heaviest line. That is a recipe route, outside this contract.
- **Not checked on stage** (nothing deployed). `infra/db-migrate` is unchanged: it applies whatever the manifest lists, as it did 330–350.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/web-console-next` | 52 (`kitchen-cook-session.test.ts`): the store 7 (per-account key, a fresh store after a reload, snapshots and subscribers, other versions dropped, one at a time, the discard sheet, cleared on sign-out); from a recipe 7 (lines from the match, takes, where from and last time, missing left out, to taste, the chip and steps, fresh reads); blank with from before 3; ticks 1; the stepper 4; Add an item 2; the Finish sheet 6 (unticked, who ate, post to, the button's cost, the switch, today's amounts); posting 11 (the exact body with `recipeId`/`recipeFactorMilli`/`recipeLine`, leave out and one item once, the shares call, just you, ½ at least, save amounts, save as a recipe, problems, a refusal pointing at its line, shares refused, offline); the bar 5; a row as drawn 3; the address and prod 3 | 1437 (77 suites) |

`pnpm typecheck` and `pnpm lint` pass for `apps/web-console-next` and `tests/web-console-next`, and `orun task check RC-6 --base origin/main` passes: 2 changed components, all inside the contract.

| `tests/db` | 11 (`kitchen-cookpool-recipes-migration`: 360's registration and text, every seed row landing under plain INSERT, re-running adds nothing, the backfill and answered names, the column and its CHECK, ≥ 280 foods in their categories and named by their keys, RC-4's foods and names untouched, ≥ 1,500 unique folded names, the densities, ≥ 38 recipes under usr_cookpool, their lines and steps); 5 RC-4 tests adjusted | 761 |
| `tests/kitchen-worker` | 52 (`cookpool-recipes`: the content test, one case per Cookpool recipe (42) for one main line not to taste, every line a known food or to taste, the contracts' units, amounts above zero, `scaleLine` at × 0.5, × 1 and × 2 on the grid, 3–8 steps ≤ 200 characters and serves 2–6; plus the count; 6 for the match through density (turmeric, rice and its factor, ghee by weight, onion by the cup, paneer with none still missing, a density taken away); 3 through the router (Explore `source=cookpool` with kind and q, a full read with no edits and a copy, Masala chai first in Cook now and missing tea and sugar without densities)); 7 RC-4 tests adjusted | 582 |
| `tests/contracts` | 2 (`kitchen-food-density`) | 188 |

`pnpm typecheck` passes repo-wide (52 tasks). `pnpm lint` passes for every touched package (`packages/db`, `packages/contracts`, `apps/kitchen-worker`, `tests/db`, `tests/contracts`, `tests/kitchen-worker`).
