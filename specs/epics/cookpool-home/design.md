# cookpool-home — design

The boards: https://claude.ai/artifact/UKg7TpgfoHa4w9fssj7Fda. Three states (things need you, all caught up, while you cook), each in light and dark.

## The rules

- **Say less.** No date, no "N things need you" sentence: the badge on Needs you says how many.
- **One card colour** (`bg-card`, `shadow-cp-card`), herb green (`primary`, `cp-accent-*`) only for actions and the active tab.
- **Weights 400–600**, as the revamp has them.
- **Tokens only.** Every colour is a theme token, so the RV-14 black dark theme (true black ground, near-black cards, mint accent) needs no Home-specific code.
- **44 px targets** everywhere.

## The page, top to bottom (the new frame's `NewHome`)

1. **Header** — your avatar (opens You below 900 px), "Hi, Rahul", the balance pill (opens Money; hidden when settled). As today, minus nothing — it already matches.
2. **The cooking session you left** — `ResumeStrip`, unchanged. It sits first, above the actions, while a session is open (the `Cooking` board).
3. **Quick actions** — one row of tiles, icon over label:
   - **Scan bill** → `RECEIPT_SCAN_HREF` (`/pantry/run?scan=1`). Shown only when `useReceiptScanShows()`; otherwise the row has three tiles.
   - **Log use** → `quickUseFieldHref(true)` (`/pantry?focus=1`), what "What did you use?" opened.
   - **Cook** → `/cook`.
   - **Groceries** → `boughtHref()`, the shopping run from the list.
4. **Install Cookpool** — `InstallCard fresh`, unchanged.
5. **Needs you** — `NeedsYou`, its rows, order, Undo and "three, then See all" as RV-15 built them. The count becomes a small accent badge beside the heading. With no rows it shows one line, a tick and "All caught up", instead of disappearing (the `AllClear` board).
6. **Cook tonight** — the first Cook now entry as one tinted card: its name, "30 min" (or Have all), and Cook, opening the recipe. Nothing when Cook now has nothing.

"Your groups cooked" leaves Home; HM2 puts it on Kitchen.

From 900 px, two columns: resume, quick actions and Cook tonight on the left; install and Needs you on the right.

## Rejected

- **A big money number at the top, as Spliteco has.** Money is Money's tab; Cookpool's Home is what needs you and what to do next. The pill keeps the number one tap away.
- **Rewriting each Needs you row to one bare line.** The rows' sub-lines carry what the action does (portions, who paid); cutting them is its own change, after this ships.
