# Epic: cookpool-recipes (RC)

**Cooking is what Cookpool is for, yet today a dish is a form you fill in after the fact. This epic makes cooking work like a good workout app: recipes are templates, and cooking is a session. You start from a recipe or a blank page. Each amount shows what you used last time, and you tick things off as you go. The session follows you across tabs, and Finish asks who ate. Recipes scale by their main item: a 1 kg chicken recipe follows you to 450 g. Each line shows what your pantries hold. You can keep recipes to yourself, show them to your groups, or share a link, and saving someone's recipe gives you your own copy. Cookpool brings about 40 home staples of its own, and Cook now lists what you can make with what you have. Items take a note. Around all this the app gets a clearer frame: five tabs (Home · Pantry · Cook · Money · You), each thing in one place, and how often you do something decides how close it sits.**

It is for the same people: flatmates on phones, cooking for each other and splitting the cost.

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped on stage 2026-11-08 · prod waits for the owner (RC5) |
| Cluster | **RC** (RC0–RC5) |
| Owner(s) | `apps/web-console-next`: the five tabs, the recipe screens, the cooking session. `apps/kitchen-worker`, `packages/db`, `packages/contracts`, `packages/sdk`: foods, recipes, sharing, notes, Always have, Cook now. |
| Builds on | `cookpool-kitchen` (dishes, the ledger), `cookpool-simpler` (SM-3 from before, SM-5 instant writes, SM-6 measures, the seven rules) and `cookpool-app` (PW-4's service worker, PW-7/PW-8 gestures) |
| Changes | Five tabs replace Home · Pantry · + · Groups · People. Home holds To do, Cook now and what your groups cooked. Money holds people and groups together. You is your own page. Recipes: a main item, lines, steps and serves N, scaled by the main item or by portions, with each line matched to your pantries. A cooking session is a draft kept on the phone, with Last time, ticks, a bar on every tab, and Finish → who ate → the existing dish write. Sharing is Only me, My groups, or Anyone with the link; saving someone's recipe makes your own copy. About 40 recipes by Cookpool, a shared food list, Always have, and Cook now. Items take a one-line note. |
| Decisions locked | (1) **Stage first.** The new layout and everything in it turns on wherever the app is not prod (`src/lib/features.ts`, read at runtime from the environment the host names). Prod keeps today's app until the owner says so (RC5). (2) **A recipe never moves money.** A dish, a use, a bill and a payment do, as today. (3) **Saving someone's recipe makes your own copy**, marked "from Anu". Their later edits don't change yours. (4) **No public profiles, followers, likes, comments or search of strangers.** Recipes reach other people through your groups or a link. (5) **One main item per recipe.** It and the portions scale every line. "To taste" lines never scale. (6) **One shared food list** links items to recipe lines, asked once per item name like measures. (7) **The session is a draft on the device.** It survives tab switches and closing the app. Finish needs signal, and nothing is queued (PW decision 5). (8) **Each thing lives in one place.** Money is only in Money, except a debt that needs you, which is a To do. (9) **Photos come later**, not in this epic. |
| Design | Claude Design canvas, row "Cook with recipes — the new layout" and "Architecture — how it fits together": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`NewHome`, `CookTab`, `Recipe`, `LiveCook`, `Explore`, `ShareRecipe`, `Profile`, `Money`, `ItemNote`, `Architecture`) |
| Gate | RC1 is the day the app has its new frame on stage. RC3 is the day cooking feels like an app. RC4 is the day recipes travel. RC5 is the owner's call. |
| Shipped as | RC0 #62 · RC1 #64 #63 · RC2 #65 #68 · RC3 #66 · RC4 #67 #70 · close RC-9. On stage: the five tabs (Home, Pantry, Cook, Money, You), item notes, recipes with scaling by the main item and what you have, cooking sessions with Last time and the bar on every tab, Cookpool's 42 recipes and 300 foods with densities, sharing by groups or link with copies, Explore, Always have, and Cook now. Prod still shows the old frame. |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| RC0 — the spec | this doc set, the canvas row, the task contracts | merged |
| RC1 — the new frame (stage) | the stage switch; five tabs (sidebar on desktop); Home (To do, Cook now, from your groups); Money; You; a person's page; item notes; Always have | on stage the five tabs show and every old screen is still reachable; prod is unchanged; a note shows on its pantry row |
| RC2 — recipes | the food list; recipes in the server (lines, main item, steps, serves, who can see); My recipes; the recipe page with scaling and what you have; new and edit; save a dish as a recipe | on stage, Chicken curry scaled from 1 kg to 450 g changes every line, and each line says ✓, short or missing |
| RC3 — cooking sessions | Start cooking, blank or from a recipe; the session (Last time, ticks, amounts); the bar on every tab; Finish → who ate → the dish | a dish cooked from a recipe on stage posts with the right costs and portions; the bar survives a tab switch and a reload |
| RC4 — recipes travel | Only me · My groups · link; `/r/<code>` and Save a copy; recipes on a person's page; Explore (Cookpool, your groups); about 40 Cookpool recipes; Cook now | Anu shares a link, Dev saves a copy that reads "from Anu"; Cook now lists what Rahul can make on stage |
| RC5 — prod | the switch on in prod, the old screens deleted | the owner says go; prod shows the five tabs |

## After this epic

These are what the tasks reported and left for later, or for a small fix:

- **RC5, prod.** When the owner says go: turn `newFrame()` on in prod, delete the old Home, the + sheet, the Groups and People tabs and the old cook screen, and update the home-screen shortcuts there.
- **Owner checks on real phones.** Each PR lists what to try on stage (#63, #64, #65, #66, #67, #68, #70). The ones that need a person:
  - Finish from a recipe, then Undo;
  - the session bar after a reload;
  - a share link opened while signed out;
  - Cook now with Always have.
- **Undelete.** The server can't undelete a recipe, so Delete waits for Undo's 10 seconds before it calls the server (RC-5). An undelete route would let the console delete at once.
- **The food ask guesses its line.** The match's `unlinked` list doesn't say which line an item could be, so the console pairs them by shared words (RC-8). The server could name the line.
- **No katori unit.** Recipes use cups (RC-7); a katori unit would read more naturally.
- **The desktop session is a page**, not the right-hand panel in the design (RC-6).
- **The feed is read from your dishes**, 100 at a time, up to 4 pages (RC-2). A dish started more than 14 days ago that finished this week doesn't show, and Cooks caps at "400+". A server feed read would fix both.
- **The Cook hub reads each recipe in full** to list its ingredient names (RC-5). A summary that includes the names would save the reads.
- **"Saved by N" is a count only.** No read says who saved a recipe.
- **"Your groups" in Explore shows at most 50 recipes** (RC-4).
