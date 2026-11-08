# cookpool-recipes — implementation plan

Each task is one pull request on `orun/RC-k-<slug>`, carrying its contract in `tasks/RC-k.TaskContract.yaml`. Everything new in the console is behind `newFrame()` (design §1.1): on in dev and stage, off in prod until RC5.

## RC0 — the spec ✅

- **RC-1:** this doc set, the canvas row, and the contracts for RC-2 to RC-8.

**Done when**
- merged; the epic, its milestones and RC-1 read in Orunbase

## RC1 — the new frame (stage) ✅

- **RC-2:** the frame (design §1). It covers:
  - `features.ts`;
  - the five tabs and the sidebar;
  - the new Home: To do with claims, the Cook now slot, From your groups;
  - Money, You (your page), and a person's page;
  - the session bar's slot, which shows nothing until RC-6;
  - the manifest shortcuts.

  It is the console only. If no existing read can give "From your groups", it adds `GET /v1/kitchen/me/feed`.
- **RC-3:** item notes, end to end (design §1.5). That means migration 330, the item bodies and reads, Bought, the item page, and the pantry row.

**Done when**
- on stage, the five tabs show on a phone and the sidebar on desktop
- every old screen can still be reached
- Home has no money card
- an open dish is a To do with claim chips
- on prod nothing has changed
- a note set on Bought shows on its pantry row, to the pantry's people only

## RC2 — recipes ✅

- **RC-4:** recipes in the server (design §2, §3, §5.1, §5.2, §5.4, §6, §7). It covers:
  - migrations 340 and 350, and the ~60 seed foods;
  - `scaleLine`/`scalePortions` in contracts;
  - every recipe, food, Always have, link, copy, match and cook-now route;
  - the dish write's `recipeId`/`recipeFactorMilli`/`recipeLine`;
  - the SDK;
  - tests with property checks on scaling.
- **RC-5:** the recipe screens (design §3.5, §8). It covers:
  - the Cook hub: Start cooking, Cook now, My recipes, Explore entry;
  - the recipe page: scaling and what you have;
  - new and edit;
  - Save as recipe from a dish;
  - Home's Cook now strip;
  - recipes on You.

**Done when**
- on stage, Chicken curry written at 1 kg and scaled to 450 g changes every line by the rounding rules
- each line reads ✓, short or missing from the pantries
- "Use all 450 g you have" works
- a finished dish saves as a recipe

## RC3 — cooking sessions ✅

- **RC-6:** the session (design §4). It covers:
  - `/cook/session` and the draft store;
  - Last time, ticks, amounts and steps;
  - Add an item;
  - the bar on every tab;
  - Finish → who ate → post (cook + shares), and "Save today's amounts";
  - a blank start with from before.

**Done when**
- on stage, a dish cooked from a recipe at ×0.45 posts with every ingredient's cost and the portions from Who ate
- it waits in the eaters' To do
- the bar survives a tab switch, a reload and closing the app
- Finish offline says so and keeps the session

## RC4 — recipes travel ✅

- **RC-7:** Cookpool's content (design §2, §5.5): the full food list (~300 with names) and ~40 recipes in migration 360. It is checked by a test that every line links to a food, every recipe has one main line, and every amount scales.
- **RC-8:** sharing and explore in the console (design §5). It covers:
  - the share sheet;
  - `/r/[code]` and Save a copy;
  - recipes on a person's page;
  - Explore (Cookpool and Your groups, the kind chips, Only what I can make);
  - Always have at the bottom of Pantry;
  - the "Is Kanda onion?" ask;
  - Cook now's ranking on Home and the Cook hub.

**Done when**
- on stage, Anu shares a link and Dev opens it and saves a copy that reads "from Anu"
- Anu's edit doesn't change Dev's copy
- Cook now lists what Rahul can make, fewest missing first
- marking turmeric Always have lifts a recipe that needed it

## RC5 — prod

- **RC-9:** close the stage part (status, README), after RC-2 to RC-8.
- **RC-10**, declared when the owner says go: `newFrame()` on in prod, and the old Home, + sheet, Groups and People tabs, and the old cook screen deleted with their tests.
- **RC-11:** page transitions on phones.

**Done when**
- the owner has tried it on stage and said go
- prod shows the five tabs

## Sequencing

Three waves. The tasks inside a wave touch different files and run in parallel, each in its own session.

1. **Wave 1: RC-2, RC-3, RC-4.**
   - RC-2 is the console frame.
   - RC-3 is a thin full-stack change. In the console it touches only the item form, the item page and the pantry row.
   - RC-4 is the server: it touches no console file.
   - Migration numbers are fixed in advance (330 for RC-3, 340 and 350 for RC-4), so only the migrations manifest can conflict, and that resolves at landing.
2. **Wave 2, after wave 1 lands: RC-5, RC-6, RC-7.**
   - RC-5 and RC-6 share one seam, the session URL `/cook/session?recipe=…&f=…`.
   - RC-6 owns the bar in the layout; RC-5 owns the Cook hub and recipe pages.
   - RC-7 is server data only.
3. **Wave 3: RC-8**, which needs RC-5's recipe page and RC-7's content.

The owner's session lands each pull request when its checks are green, resolves the status file and migrations manifest at landing, and watches the deploy.
