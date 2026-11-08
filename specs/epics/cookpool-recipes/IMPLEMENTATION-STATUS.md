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
