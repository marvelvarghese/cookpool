# cookpool-revamp (RV) — Implementation status

As-built ≠ intent.

| Milestone | State | PR |
|---|---|---|
| RV0 — the spec | | |
| RV1 — the new look | | |
| RV2 — close-out | | |

## Departures from the design

Each task adds a section at the end, headed `### <milestone> — <title> (<KEY>)`.

### RV1 — Finish without amounts (RV-7)

**Built.**
- **kitchen-worker** (`apps/kitchen-worker/src/dishes.ts`, `parseDish`): the "Add at least one ingredient, or something you just bought" refusal is gone. `POST /v1/kitchen/me/dishes` with `ingredients` and `newItems` empty or absent answers 201 with a dish of `ingredients: []`, `ingredientsMinor: 0`, `totalMinor` = `extrasMinor` (₹0 without), `owes: []`, no stock moves, no `use` transaction and no new items. The request and response shapes are unchanged; the `MAX_DISH_INGREDIENTS` (30) limit stays. No migration.
- **The rest of the dish works unchanged for ₹0:** the engine (`buildDish`) splits a ₹0 total among portion weights without dividing by the total, and finalize already posts no dish transaction for a dish that cost nothing (`dishTxn`). Claims, assigned shares, finalize (leftovers at ₹0), split later, cancel and Post to Community all work with no special cases.
- **contracts:** the `CookDishRequest` doc now says "none at all is a dish cooked without amounts". The types are unchanged.
- **Console:** `finishPlan` (`cook-session.ts`) no longer refuses when nothing has an amount. It sends the dish with no `ingredients`/`newItems`, and lines without an amount are still never charged. It still refuses for no name, more than 30 items and mixed currencies, and offline still refuses before the sheet opens. Both sheets use `finishPlan`: the new frame's `CookFinishSheet` (RC-6's screen and guided mode's Done) and today's `FinishSheet`. Under the main button, both say "₹0 · nothing taken from the pantry" when no line has an amount (`finishSub`/`postSub` take the line count; new `nothingTakenText`). Cooked! (`cookedView`) puts the same words in its note for a dish with no ingredients, and still offers Post to Community and Split with a group.

**Departures.**
- The words live in `cooked.ts`/`cook-session.ts`, not in `cooked-ui.tsx`/`cook-guided-*`. Those files didn't need a change: the guided last-step Finish opens the same `CookFinishSheet`, and Cooked! renders `view.note`. This also keeps clear of RV-4's restyle of those screens.
- The pinned test "won't post without a name, or with nothing in it" is now "won't post without a name". Its "Nothing to post yet" pin was removed on purpose.
- In `tests/kitchen-worker/src/dishes.test.ts`, the validation case `ingredients: [], newItems: []` → 422 is now `ingredients: "paneer"` → 422 (not a list).

**Tests.**
- `tests/kitchen-worker`: 56 suites, 1173 tests. New `no-amounts.test.ts` (7): the lists empty or absent → ₹0, nothing taken from any pantry; extras only; claims in a group; the 30 limit still refuses; claimed and finalized ₹0 posts nothing; split later by claims and by assign; cancel and post.
- `tests/web-console-next`: 113 suites, 2240 tests. New: `kitchen-cook-session.test.ts` no-amounts finish and too-many-items; `kitchen-cooked.test.ts` "a dish with no amounts" (3).
- `tests/contracts`: 35 suites, 332 tests.
- Typecheck and lint pass for web-console-next, kitchen-worker, contracts and both test packages. The 12 lint warnings in kitchen-worker-tests were already there.
- The console static build passes, every page static.
- Browser check at 390 px against a local mock on `cookpool-stage.localhost`, every request local: a named blank session, then Finish, which shows "₹0 · nothing taken from the pantry". Posting sent `{"name":"Maggi","orgId":null,"portionsHalf":2,"splitMode":"assign"}` and landed on Cooked! with ₹0, the note, Post and Split.

**Deploy order.** Deploy kitchen-worker before the console. Until the server has RV-7, a console with RV-7 posts an empty dish and gets the old 422 on `ingredients`, which shows as a refusal instead of the old in-app message. Both components change in this PR, so both redeploy. contracts changed only in a doc comment.

### RV1 — The new look's foundation (RV-2)

**What changed centrally** (`apps/web-console-next`). Page tasks build on these and use no raw hex.

- **Tokens** (`src/styles/globals.css`, `.cookpool`; Tailwind `cp-*` in `tailwind.config.mjs`):
  - The existing tokens kept their names and took the design table's light values:
    - `background` is the ground `#FAF7F2`; `foreground` ink `#17201B`; `muted-foreground` `#5F6862`.
    - `primary` is the accent `#167A4A`, with `primary-foreground` white. `accent` is the tint `#E3F3EA`, with `accent-foreground` the accent text `#0F5C37`.
    - `destructive` is expired `#B42318`. `muted`/`secondary` are `#F0ECE5`; `border` is `#E4DED4`.
    - `cp-herb-tint` is the tint; `cp-tomato` the cook colour `#D9481F` (tint `#FDEBDD`).
    - `cp-owed` is money back `#1D4ED8` on `#E3EBFD`; `cp-owe` is money you owe `#C2410C`; `cp-expired` is `#B42318` on `#FDECEC`.
  - New: `cp-card`, `cp-line`, `cp-accent-text`, `cp-accent-tint`, `cp-on-accent`, `cp-nav-bg`, `cp-nav-ink`, `cp-cook`, `cp-on-cook`, `cp-cook-bg`, `cp-cook-ink`, `cp-owe-tint`. Also `shadow-cp-card` (the soft shadow, `none` in dark), `shadow-cp-nav` and `rounded-cp-card` (22 px).
  - **Dark** (`@media (prefers-color-scheme: dark)`): Gold `#FACC15`, text `#FDE68A`, tint `#3A3112`, `#0F1412` on the accent. Ground `#0F1412`, card `#1A211D`, line `#26302A`. Money back `#93C5FD` on `#16264A`; you owe pink `#F9A8D4` on `#3A1F33`; expired `#FCA5A5` on `#3A1A1A`. `cp-cook` and `cp-tomato` are Gold, so no token has an orange hue.
- **Outfit**: `@fontsource-variable/outfit` 5.3.0 (pinned exactly, latin `wght` normal, 100–900), through `next/font/local` as `--font-cookpool` (`components/kitchen/theme.ts`). Plus Jakarta Sans is removed from the console's dependencies; spliteco-web still uses its own copy.
- **Weights**: one global rule under `.cookpool` caps `font-semibold`, `font-bold`, `font-extrabold`, `font-black`, `b`, `strong` and `th` at 500. That covers about 1,100 existing uses without touching the pages. New code should use `font-medium` or `font-normal`.
- **Kit** (`components/kitchen/kit.tsx`):
  - Cards: `K_CARD` / `KCard` have no border, use `shadow-cp-card` and `rounded-cp-card`. `K_ROWS` / `KRows` add `overflow-hidden divide-y divide-cp-line`.
  - Headings: `K_TITLE` (26 px, Medium, -0.02em), used by `PageHeader`. `K_SECTION` (17 px, Medium) and `SectionHeading` (an optional muted count).
  - Buttons: `K_BUTTON` is `h-11 rounded-[14px] px-5 text-[15px] font-medium`, on the accent with Button's default variant. `K_QUIET` and `K_BUTTON_QUIET` use the tint with the accent text.
  - `GroupAvatar` and `IconBubble`'s green use `text-cp-accent-text`.
- **Row lists** (globals.css): `.cookpool .divide-y` dividers take `cp-line`. The screens' bordered lists (`divide-y … border bg-card`, not dashed) lose the border and take the card shadow. This uses CSS, so the page tasks' files stay untouched.
- **Floating tab bar** (`components/kitchen/tab-bar.tsx`, new frame only):
  - It sits `inset-x-3`, at `bottom-[max(14px,env(safe-area-inset-bottom))]`. It is 68 px tall with padding 6, `rounded-[24px]`, `bg-cp-nav-bg` and `shadow-cp-nav`.
  - The current tab (`aria-current="page"`) is `bg-primary text-primary-foreground`; the others are `text-cp-nav-ink`. Labels are 11 px, Medium; icons 22 px.
  - Cook is no longer raised. Today's frame keeps its own bar.
  - The cooking session's phone bar moved to `bottom-[calc(max(14px,env(safe-area-inset-bottom))+76px)]`, so it sits above the floating bar.

**Departures**
- **Dark mode applies only in the new frame.** It needs `.cookpool-new` (`KITCHEN_NEW_LOOK_CLASS`), which the kitchen layout puts on its wrapper and on `<body>` once it has mounted and `newFrame()` is true.
  - The reason: today's frame still has about 600 raw light colours (`bg-white`, `text-[#…]`), and a dark ground would make them unreadable on prod.
  - The prerendered skeleton paints light before the class lands, so dark devices see a short light flash.
  - The sign-in pages call `useKitchenBodyTheme()` without the flag and stay light; RV-6 can pass `true`.
- **Use soon is not in the design table.** Light keeps amber `#8A5A00` on `#FDF1D6`; dark is `#FCD34D` on `#332A10`, a yellow rather than an orange.
- **Inputs:** `--input` stays at 3:1 (`#8A928C` light, `#6B7570` dark) rather than the boards' field colour `#C9C3B8`, which is about 1.8:1 on white.
- **Buttons have radius 14, not a full pill.** The boards draw their 44 px buttons with radius 14 (`pill()`); the 56 px main buttons on the boards (radius 18) are the pages' job.
- **Still on the pages:** 150 inline `rounded-[20px] border` cards and raw hex colours remain. Those files belong to RV-3 to RV-6.

**Tests**
- `tests/web-console-next`: 114 suites, 2,245 tests, all passing.
  - The new file is `src/kitchen-revamp-foundation.test.ts` (10 tests). It checks the light and dark values against the design table, checks that no dark token is orange, and checks the dark media query, the weight cap, Outfit and the dependency. It also checks the kit classes and the floating bar: its position, and that only the current tab is filled.
  - No existing pin needed changing: the pins on `bg-cp-herb-tint` and on page-level hex still hold.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 43 pages served as files, every kitchen page `○` static.

**Browser check** (390 × 844). The setup was `next dev` behind a local proxy, with an in-memory API mock that was never committed, on `cookpool-stage.localhost:4853`.
- Home, Pantry and Cook were checked in light and dark. Outfit loads, and titles compute to weight 500.
- The floating bar fills the current tab: green with white text in light, Gold with dark text in dark.
- The Pantry rows card is borderless with `line` dividers; `KCard` has a shadow in light and none in dark.
- In today's frame (`cookpool-prod.localhost`) with a dark device, the page stays light and keeps its old bar with + Add.
- The resource log listed only the local host; no request went to workers.dev or any cookpool host.

### RV1 — Money, Groups and Group (RV-5)

**Built** (`apps/web-console-next`, console only; no route, contract or migration). The reads, the numbers and every write are today's: only layout, words and look changed. Money's fetching and maths are untouched (SE3 will rebuild Money on its own worker).

- **Money** (`components/kitchen/money-ui.tsx`, board `RvMoney`; new frame only, as before):
  - The big net figure, one per currency (`moneyNets`): "You get back" / "You owe" / "All settled", the amount signed (`+₹817.00`) and coloured by direction (`cp-owed`, `cp-owe`, muted), 48 px Medium.
  - One main button under it, **Add expense**: today's Bill flow (which group, straight there with one, then Add a bill).
  - **People**: three rows, then See all / Show less in place. Each row is one line ("Owes you ₹54.00", "You owe ₹25.00", "Settled"; " · " between currencies) and one quiet button: **Pay** (the person's page, where Settle up is) when you owe them anything, **Remind** when they owe you, none when settled.
  - **Groups**: each row has the tile, the name and your signed balance ("+₹842.00", "−₹25.00", "Settled"), with **All** opening the Groups page.
  - Gone from Money: the Settle up / Bill pair, the People | Groups switch (`?list=` is now ignored), and New group / Join under Groups (they're on the Groups page and in the no-groups state).
- **Groups** (`app/(kitchen)/groups/page.tsx`, board `RvGroups`): New group and Join with link are two quiet buttons at the top (the round + and its sheet are gone), then the search card, then rows reading "6 people · +₹842.00" with the amount coloured ("settled" at zero). `?new=1` / `?join=1` still open the dialogs.
- **Group** (new `components/kitchen/group-detail-ui.tsx`, board `RvGroup`; the page renders it when `newFrame()`, and today's `GroupView` otherwise):
  - The header has Back, the name (24 px) and a gear to Settings. Under it, the avatar stack (you first, four faces, then "+N", one `role="img"` with the names) and your balance as a pill ("+₹842.00" on the money-back tint, "−…" on the owe tint, "Settled" muted). The pill opens Settle up for the group when money is open.
  - **Activity · Pantry · Money** is a tab list, kept in `?tab=`:
    - **Activity**: Latest, today's `ActivityFeed` with three rows and its See all, then Dishes (three).
    - **Pantry**: Use soon, the group pantry's first three items soonest first (today's `usePantryItems`), each "1 L · Tomorrow". See all opens Pantry on the group.
    - **Money**: Balances, everyone else with money open, three rows, signed ("−₹610.00"). See all opens Settle up on the group.
  - One main button, **Add**, sticky above the floating tab bar, opens "Add to {group}": Expense (Add a bill), Pantry item (`/pantry/new?pantry=org_…`) or Dish I cooked (`/cook`). A viewer has no Add.
- **Pure helpers** (unit-tested):
  - `money-page.ts`: `signedMoney`, `moneyNets`, `personLine`, `personTone`, `personAction`, `remindText`, `groupFact`, `groupMeta`, `MONEY_PEOPLE_ROWS`; `MoneyGroupRow` gains `fact`.
  - `group-page.ts`: `GROUP_TABS`, `groupTabFrom`, `groupTabHref`, `GROUP_TAB_ROWS`, `groupFaces`, `groupPill`, `balanceFact`, `groupAddChoices`.
- **Weights:** `font-semibold`/`bold`/`extrabold` became `font-medium` in the group page, its settings and expense pages, `settle-card`, `new-group-dialog` and `join-group-dialog`. That's no visible change, since RV-2's cap already rendered them at 500. None of these files has raw hex.

**Departures.**
- **Remind** has no server behind it in the kitchen, since reminders are spliteco's (SE2), and this task doesn't touch it. It opens the phone's share sheet with "Hi Anu, a reminder from Cookpool: you owe me ₹54.00." Where there's no share sheet, it copies that text and shows "Reminder copied". Nothing is sent by the app and the ledger doesn't change.
- **Pay** opens the person's page (Settle up there), not a payment sheet in the row.
- **Money's See all** expands in place, as the board does. People (`/people`) stays reachable from a person's page and a group's Settle up.
- **Groups' search** is always shown in the new frame, as the board does; today's frame keeps "past 8 groups". The board's placeholder "Search groups or people" is "Search groups", because the list has no member names to search. "Archived · 2" isn't built: groups have no archive.
- **Group's Pantry tab** heads its three items "Use soon", as the board does, even when none is near its date. They're the pantry's soonest-first items.
- **Activity's See all** is the feed's own button under the rows (in `activity-feed.tsx`, left untouched), not in the heading.
- **Dishes** stay under Activity, so no content is lost. The board's group settings sheet stays today's Settings page behind the gear.
- **Today's frame:** Groups takes the new layout there too, without Back and with the search past 8. The group page keeps today's view. Money remains new-frame only.

**Pinned copy changed:** none. No existing test pin needed changing. The words that changed live in the views and are pinned by the new test:
- Money: "Settle up" + "Bill" became one "Add expense".
- Money: "Join with a link" became "Join with link".
- Money: "settled" became "All settled", and "you get back ₹40.00" in a row became "Owes you ₹40.00".
- Groups: "Join with a code" (in the + sheet) became "Join with link".
- Group: "Add a bill" became "Add".
- Group: "Settings" (aria-label) became "Group settings".
- Group: "Activity" (heading) became "Latest".

**Tests.**
- `tests/web-console-next`: 115 suites, 2,272 tests, all passing. The new file is `src/kitchen-revamp-money-groups.test.ts` (22 tests). It covers the net figure and signs, the people rows' line, colour and one button, Remind's text, the group facts and "N people · ±₹" meta, the tabs in the address, the face stack, the pill, signed balances and the Add choices. It also checks that the four views have no raw hex and no weight above 500, that Money has one main button and no switch, and that Groups has no round +.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 43 pages served as files, with `/money` and `/groups` `○` static and `/groups/[orgSlug]` `●` (the `_` shell).

**Browser check** (390 × 844, light and dark). The setup was `next dev` behind an in-memory API mock that was never committed, on `cookpool-stage.localhost:4961`; the token was a dummy in localStorage.
- Money: the net figure in blue/light blue, three people with Remind/Pay, then Show less with all four, and the group rows signed.
- Groups: the quiet buttons, the search and "6 people · +₹842.00".
- Group: the stack, the pill and all three tabs (`?tab=` updates), and the Add sheet.
- Dark: Gold main buttons, tint pills and a pink owe.
- Today's frame (`cookpool-prod.localhost`): the group page is today's, and Groups has its new rows.
- The resource log listed only the local host.

### RV1 — Home, Pantry and Item (RV-3)

**Built** (`apps/web-console-next`, new frame only unless said; no routes, no migrations, no server change).

- **Home** (`new-home-ui.tsx`, new `new-home-parts-ui.tsx`, new `new-home-look.ts`), in the board's order:
  - Your avatar (opens You), "Hi, Rahul" at 26 px Medium, and the **balance pill**: `+₹62.50` on `cp-owed-tint` or `−₹25.00` on `cp-owe-tint`, named "You get back ₹62.50", opening Money. It is hidden while settled up, in no group, or before it loads (`balancePill`). `homeSections` is unchanged: the pill is part of the greeting, not a money card.
  - **What did you use?** is a 54 px card (`QuickUse fresh`). The usual chips stay, as tint pills. The + Bought beside it is gone from Home (it stays in the Pantry's header).
  - **The resume strip** (`ResumeStrip`): the open cooking session's name, "12 min · 3 of 7 in" (`resumeMeta`) and Resume, on `cp-cook-bg` with a `cp-cook` tile. The floating phone bar stays off `/home` (`homeShowsResume`, one line in `session-bar.tsx`).
  - **Needs you · N** (`HomeTodoList fresh` → `FreshTodoList` in `inbox-ui.tsx`):
    - The asks and split reminders come first, then one borderless card of rows, three, then See all at the foot.
    - A dish row has one button, **I had some**, which opens the 0–2 chips under it. Picking one claims at once and closes the chips; the Undo toast is unchanged.
    - Pay X: Paid on the accent, then the method chips. Use soon: the amount pill. Finalize/Set/Open are pills too.
    - Today's frame keeps its list exactly (`TodayTodoList`); the look is picked through a `RowLook` context.
  - **Cook now** (`HomeCookNow`, reading `useCookNow`): three 148 px cards, each a 76 px tile, the name, and the tag **Have all** or **Need yogurt** / **Need 2** (`cookNowTag`). In dark the tile takes `cp-line`. **All** opens Cook.
  - **Your groups cooked** (renamed from "From your groups"): one row per dish — the face, the dish, "Anu · you had 1 · ₹31.20 each" (`groupsCookedMeta`) — opening the dish. A 44 px bookmark Saves the recipe it was cooked from, when it's yours to save (RC-8's `useSaveCopy`). Three, then See all.
  - Inbox cards: `ask-card-ui.tsx` and `split-reminder-ui.tsx` use tokens and pills. The split reminder is one row: Split, plus a quiet × that dismisses (with Undo).
- **Pantry** (`pantry-new-ui.tsx`, `pantry-row-ui.tsx`, new `pantry-look.ts`, plus `now-strip-ui.tsx`, `finished-ui.tsx`, `pantry-ui.tsx` tokens):
  - "Pantry" at 26 px, + Bought on the accent, and the scan camera on the tint.
  - Search is a shadowed card, "Find an item". Log several is a tint pill (the accent while on).
  - The chips are on the card, or the accent when chosen.
  - **Use soon**, the board's strip: three tiles, past its date first, then the soonest (`useSoonTiles`). Each tile is the name plus "Expired" in red, or "Today"/"Tomorrow"/"Sat"; it opens the item. **Cook** beside the heading opens Cook (what the old amber card linked to).
  - The sections are 17 px headings with "· 5", still folding. Each shows **three, then See all N** (`sectionRows`), and all of them while searching or when `?open=` names a row further down.
  - Rows: Medium names, a 4 px bar (muted, amber, red), and one tint pill ("1 glass", **Use**). The Ask button is on the ink; Cancel is on the use-soon tint.
- **Item** (`app/(kitchen)/pantry/[itemRef]/page.tsx` `NewItemView`, `item-page-ui.tsx`):
  - Back, the name at 28 px Medium, and one muted line ("Flat 4B · Used up") with the ask pill.
  - The ring card is borderless; its ring is ink, amber or red through `stroke-*` tokens.
  - The use card keeps ✓ Use and **More**. The run-out line is plain ("… · rate"), no blue card.
  - Who had it shows 48 px faces without cards. **History** is three, then See all, with Undo as a tint pill.
  - The actions are shadowed cards. **Measures and note** is one folded card holding the note and Counted as.

**Copy changed** (none of it is pinned in tests; no existing test changed):
- Home: "To do" → "Needs you · N". "From your groups" → "Your groups cooked". Cook now's "See all" → "All", and its "Have all · for 3" / "Missing 1 · yogurt" → "Have all" / "Need yogurt". The claim chips sit behind "I had some". Split reminder Dismiss → a × (same label).
- Pantry: the placeholder "Find in your pantries" → "Find an item". "Use…" → "Use". The Now strip's "One tap logs it" is dropped. The use-soon card "3 things to use soon · … · Cook with them" → the Use soon strip with Cook.
- Item: "More…" → "More". The ring's "left" under the percent is dropped. "Measures and note" is new.

**Departures.**
- The Pantry's sections stay **by kind** (Dairy, Veg…), as PN-5 built them, not by pantry as the board draws them; the pantry chips still filter by pantry.
- The Now strip, Log several, Say it, Finished this week and Always have are kept. The board leaves them out, but the brief keeps every behaviour.
- The Needs you claim chips keep 0 (0, ½, 1, 1½, 2: 0 takes a claim back). The board draws four.
- The balance pill shows the exact amount (`₹62.50`), not the board's rounded `₹62`.
- `session-bar.tsx` (not on the brief's list) gained one line, so the phone bar stays off Home, which now shows the strip itself.
- Shared parts the pages render but other tasks own keep their old look: `AmountPicker`, `UseSheet`, `SetRow`, `ask-ui`, `item-note-ui`, `measures-ui`, `AlwaysHaveCard`, `InstallCard`, `SayIt*`, `BackButton`.
- Today's-frame branches in `inbox-ui.tsx`, `pantry-ui.tsx` and the item page's `TodayItemView` still use `font-bold`/`font-semibold`. RV-2's cap renders them at 500.
- The Cook now tile's dark colours use `[@media(prefers-color-scheme:dark)]`, not the `.cookpool-new` gate. That is safe because the strip renders only in the new frame.

**Tests.**
- `tests/web-console-next`: 115 suites, 2,261 tests, all passing. New: `kitchen-revamp-home-pantry.test.ts` (11): three then See all, a section kept whole, the balance pill, the resume line and `/home`, Cook now's tag, Your groups cooked's line, and the Use soon strip's order, facts and filters.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 43 pages served as files, `/home` and `/pantry` `○`, `/pantry/[itemRef]` `●`.

**Browser check** (390 × 844, light and dark). The setup was `next dev` on :4982 behind an uncommitted in-memory mock on `cookpool-stage.localhost:4983`.
- Home showed the pill, the strip, Needs you · 3, Cook now and Your groups cooked (See all 4, Save).
  - I had some opened the chips. Picking 1 sent `PUT …/dishes/dsh_fried…/claims/me {"portionsHalf":2}` with the Undo toast, and the row left.
  - Paid opened UPI · Cash · Bank.
- On the Pantry, the Use soon strip read Greek yogurt Expired · Paneer Tomorrow · Tomatoes Sun.
  - Dairy · 5 showed three rows, and See all showed five.
  - The row's 1 glass sent `POST …/items/itm_milk…/uses` with Undo.
- The item page (Milk) showed the ring, the use card, Who had it, History (See all 5), the actions and Measures and note (opens).
- Today's frame (`cookpool-prod.localhost`) still shows the old Home ("You get back", To do with inline chips, Recent).
- Every resource came from the local host.

### RV1 — You, Community and Sign in (RV-6)

**Built** (`apps/web-console-next` only; no route, contract or migration).
- **You** (`RvYou`, new frame): `/you` is `YouHome` (`components/kitchen/you-home-ui.tsx`): the 64 px avatar, the name (26 px) and the @handle (your email before you have a handle); then short grouped lists from `youGroups` (`you.ts`), each row a label and a chevron in a `K_ROWS` card:
  - Account: Name and handle → `/you/settings`; Your recipes and cooks → `/you/cooks`; Groups → `/groups`.
  - Sign-in and security: Passkeys → `/you/security` (it reads "Email" where passkeys don't run); Connected apps → `/you/assistants`.
  - Cookpool AI: AI settings → `/you/ai`. Notifications: Push → `/you/notifications`.
  - This phone: Install the app (PW-2's flow), only while there is something to install.
  - Sign out, quiet red text, centred (the same `signOutOfThisDevice`, now `useSignOut`).
- **New page `/you/cooks`** (new frame only; `NEW_FRAME_ONLY` → `/you`; parent `/you`; added to `STATIC_PAGES`, no pull): what the new frame's `/you` showed before (`YourCooks`, formerly `YourPage`, in `profile-ui.tsx`): the groups line, Cooks · Recipes · Saved by · Groups, Cooks a week, Recipes | Cooks (`?list=cooks` on `/you/cooks`).
- **`/you/settings`** (new frame) is now Name and handle (`YouNameScreen`): the name card with Change your name, and the @handle card with Followers, Following, Edit and follow requests. The rows it held since RC-2 are on You's lists.
- **Parents:** `/you/notifications`, `/you/security` and `/you/ai` go back to `/you` in the new frame (they went to `/you/settings`).
- **Cookpool AI, Sign-in and security, Turn on Face ID:** tokens, `K_TITLE`/`K_SECTION`, `K_CARD`; the switches use `primary`/`input`; the Add a passkey button is the quiet tint.
- **Community** (`RvCommunity`): the header has Back, Community, a search icon (people search; the search field is gone) and the bell, its count on the accent. Following · Everyone tabs in a track; the tab's heading ("From people you follow", "New from everyone"); compact post cards (`PostCardView`): the recipe's 76 px tile with its initial (the line colour in dark), the dish, "Anu Mathew · 2 h" (to the author), "450 g · 48 min · 12 yums · 3 comments" (`postNumbers`), and two 44 px icons: Yum (a heart, filled in the accent when yours) and the save (Cook this as a bookmark, `CookThisButton icon`, filled once the recipe is yours or saved; it copies and opens as before). The same cards fill a profile's Cooks.
- **Sign in** (`RvSignIn`, every frame): the welcome panel in the accent with the mark and the headline (no chips on the phone); Sign in · Create account in a track; the remembered card on the card, its one main button in the accent with Face ID's (or the fingerprint's) icon for a passkey account, and Use another account; Google and Passkey side by side (`SIGN_IN_SECONDARY`; each keeps its full name as its accessible name), then "or", Email, Email me a code; one helper line, the terms, under Can't sign in?. The code screen, the Name step, Can't sign in? and Turn on Face ID take the tokens and 400/500.
- **Dark on sign-in:** `/login` and `/login/help` add `KITCHEN_NEW_LOOK_CLASS` and pass `useKitchenBodyTheme(newLook)`, where `newLook` is `newFrame()` read after mount (`useSignInNewLook`). Every raw colour is gone from the sign-in files (Google's mark keeps its brand fills), and it was checked in both themes. Prod stays light until the new frame ships there.
- **The flows are unchanged:** no handler in `app/login/page.tsx` changed. The page only gained the dark class and `rememberedPasskey` (`continueMethod(...) === "passkey"`, for the icon). Options are still prefetched, and `startPasskey`, `continueAsRemembered`, `turnOn` and `add` still have no await before the ceremony (`kitchen-passkey-tap.test.ts` passes untouched). Codes, join links, the safe `next`, stage's test code and the developer sign-in are as they were.
- No raw hex and no weight above 500 in any RV-6 file (`community-*`, `sign-in-*`, `passkey-*`, `you-*`, `ai-settings-ui`, `app/login/**`); `profile-ui.tsx` only in You's parts (the person page is RV-5's ground).

**Departures.**
- The board's Voice cooking, Email digest, Help centre and Privacy and terms rows are not drawn: none has a page of its own. Install the app took a "This phone" group instead.
- The board's Sign-in and security has both Passkeys and Email; both open `/you/security`, so one row is drawn, named for what the page leads with.
- Community: no "See all" (the feed pages itself as you scroll) and no floating Share a cook (sharing starts from a dish; there is no general entry). Everyone's heading is "New from everyone", not "Popular today": the tab holds the newest public cooks. The compact card drops the caption, the comments button and ⋯ (report, mute, block, who sees it, delete); all are on the post's page. Likes are the app's Yum: a heart, "12 yums".
- Sign in: the remembered card keeps "rahul@gmail.com · Google" (the board shows only the address), since it says how Continue will sign in. Create account keeps "Email me a code" (the board says Next), because the code is the next step.
- `cook-hub.ts`'s `profileHref` (Cook's file) is untouched and now unused by You; the switch builds `/you/cooks` hrefs itself.

**Pinned copy and pins changed (each deliberate).**
- Community's second tab: "Discover" → "Everyone" (`FEED_TAB_LABELS`; `?tab=discover` is unchanged).
- Sign in: "or with email" → "or". The helper under Email me a code (`SIGN_IN_HELPER`, `PASSKEY_SIGN_IN_HELPER`, `SIGN_UP_HELPER`) and Create account's name hint (`signUpNameHint`) are no longer drawn; the constants and their pins stay. Google beside Passkey reads "Google" (its name stays "Continue with Google" / "Sign up with Google"); the passkey button reads "Passkey" (its name stays "Sign in with a passkey").
- You (new frame): "Sign out" (`SIGN_OUT`); today's frame keeps "Sign out of this phone" (its pin unchanged).
- `kitchen-community-posts.test.ts`: the card-drawing test now checks the compact card (byline, Yum's label, and no caption or ⋯).
- `kitchen-community.test.ts`: the outlined Follow button pins `border-border`, not `border-[#C9CFC6]`.
- `kitchen-new-frame.test.ts`, `kitchen-say-it.test.ts`: `/you/notifications` and `/you/ai` new-frame parent `/you` (was `/you/settings`). `kitchen-transitions.test.ts`: `/you/notifications` depth 1 (was 2). `gestures.test.ts`: `/you/cooks` doesn't pull.

**Tests.**
- `tests/web-console-next`: 115 suites, 2,281 tests, all passing. New file: `kitchen-revamp-you-sign-in.test.ts` (26 tests): Google and Passkey side by side with their names; Create account and no-passkey cases; the remembered card with Face ID's icon; the panel; dark only with the new look; and no raw hex and no heavy weight in 21 RV-6 files. New in `kitchen-you.test.ts`: You's groups and hrefs (each a static page), Email where passkeys don't run, the subline, `SIGN_OUT`, and `/you/cooks` in the new frame only. New in `kitchen-community-posts.test.ts`: `postNumbers`, the byline, the tab labels and headings.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 44 pages served as files (with `/you/cooks`).

**Browser check** (390 × 844, light and dark). The setup was `next dev` on 48630 behind a local proxy with an in-memory API mock on `cookpool-stage.localhost:48631`, never committed. The network log listed only that origin and `cookpool-prod.localhost:48631`.
- `/login` showed the accent panel, tabs, Google, "or", Email and the main button. In dark it was Gold with dark text, on the dark ground. A code request opened the code screen in dark.
- The remembered card was checked in both themes.
- `/you` showed the lists and Sign out in both themes, and `/you/settings` and `/you/cooks` rendered.
- `/community` and `?tab=discover` showed the compact cards, with the heart filled on a Yum'd post and the bookmarks.
- Today's frame (`cookpool-prod.localhost`) on a dark device showed `/login` light.
- Passkeys don't run on a `*.localhost` host (PK-4), so Passkey beside Google was checked by the render test, not in the browser. Google's round trip leaves for the real API and was not opened.

**Deploy.** Only the console changes; nothing on the server.

### RV1 — Cook, Recipe, Cook step and Cooked (RV-4)

**Built** (`apps/web-console-next`, new frame only; every screen here already rendered only with `newFrame()` true). No routes, no migrations, no contracts or SDK change.

- **Cook tab** (`cook-hub-ui.tsx`, `cook-hub-views.tsx`, `cook-hub.ts`; board `RvCook`):
  - "Cook" and the one main button, **New dish** (a blank session, `/cook/session`, on the accent). It replaces the full-width cook-colour Start cooking.
  - **Find a recipe** filters both lists by name, any case (`hubMatches`), shows every row while typing, and says "Nothing matches".
  - **Cook now · N**: what you have everything for, tag "Have all" (`cookNowHubRows`). Each row opens its recipe at the size the stock allows (`/recipes/<id>?f=` from `cookNowStartFactor`), so "for 3" still carries over.
  - **Saved recipes · N**: yours and your copies not in Cook now, last cooked first, one tag each (`savedHubRows`): "Need yogurt" (Cook now's missing-1), else "From Anu", else "Cooked <day>", else "Serves 4".
  - Each list is a card of rows (tile, name, tag), three then "See all N" / "Show less" (`HubList`, `HUB_FIRST` = 3).
  - Under the lists, quiet: New recipe and Explore (tint pills), From a photo (AI-9) and Community (CM-5).
  - Recipe tiles keep their per-recipe tint in light and take the line and ink in dark, as the boards do (CSS variables plus a dark arbitrary variant in `RecipeTileView`).
- **Recipe** (`recipe-ui.tsx`, `recipe-views.tsx`, `recipes.ts`; board `RvRecipe`):
  - Back, then Share and Edit as 44 px icons (owner), or Save (quiet tint).
  - The name in 28 px. Under it, one line: **"Serves 4 · 35 min · Have 7 of 9"** (`recipeMetaLine`, `haveShort`; "Have all 9" when nothing is short). The byline with its face follows when the recipe is someone's.
  - "Use all 450 g you have" stays, as a quiet chip.
  - **Ingredients** with the servings stepper **− 4 +** beside it (`ServingsStepper`, the same factor as before).
  - **Dot rows**: a filled muted dot when you have it, a ring in the money-you-owe colour when it is short or missing; the amount in the same tone. What the pantries hold is screen-reader text.
  - **Steps** open on the page, numbered on the tint (the guided rows are unchanged). **Start cooking** is 60 px on the accent, with the pot.
- **Cook step** (`cook-guided-ui.tsx`, `cook-guided-screens.ts`, `cook-guided-screen.tsx`; board `RvCookStep`):
  - The header shows the dish's name (new `title`), with read aloud and the plan.
  - A **thin progress bar with "3 of 7"** (`StepProgress`, new `countText`).
  - Other steps' timers are card pills.
  - **One heat/time chip**, e.g. "Medium flame · 5–7 min" (`HeatChip`).
  - The **step text** at 30 px, and what to watch for in one muted line (`CheckLine`).
  - The **timer chip** (`TimerChip`): "Start 7:00" (or "Start and go on"), then "6:59 · Pause" on the cook strip, "· Resume" when paused, and +1 min. It keeps the learned line, the push note and the push hint.
  - The lines as chips (struck through on the tint once in), then **"Add amounts"** as a quiet link. It opens Before you start (`showPrep`), where the lines take their amounts.
  - **Back** is quiet text; **Done/Finish** is the one main button, 60 px on the accent, always enabled (RV-7's behaviour is kept).
  - The waiting screen takes the same header, bar, chip and type, and keeps its ring, whistles, ping, keep-screen-on and Meanwhile.
  - The prompt, prep and done screens are on the tokens; their main buttons moved from the cook colour to the accent.
- **Cooked** (`cooked-ui.tsx`, `cooked.ts`; board `RvCooked`):
  - ✓, the dish's name at 30 px ("Cooked!" is screen-reader text), **"₹124 · 4 portions"** (new `CookedView.fact`; RV-7's "₹0 · nothing taken from the pantry" for a dish with no amounts), and the group-items note.
  - **Split with a group** is the main button on the accent; **Post to Community** is quiet on the tint. Each becomes a ✓ card row once done ("Split with Flat 4B"; "Posted to Community" opens the post). Then Done, as quiet text.
- **Finish sheets** (`cook-finish-sheet.tsx`, `cooked-finish-sheet.tsx`): the main button is on the accent. Both sheets still use `finishPlan` and RV-7's no-amounts line.
- **Tokens:** no raw hex is left in the files above except `RECIPE_TILE_COLORS` (`cook-hub.ts`), the tile data that community's gradient reads.
  - Class colours map to `cp-*` and the shadcn tokens.
  - The guided `INK`/`COOK`/`HERB`/`TINT` constants are now `hsl(var(--…))`, as is the session bar's ink.
  - Every weight is `font-medium` or `font-normal`, and bordered cards became the borderless card with the shadow.
  - The same token pass covers `cook-session-screen.tsx`/`cook-session-ui.tsx` (styling only), `recipe-form-ui.tsx`, `recipe-photo-ui.tsx`, `recipe-share-*`, `recipe-link-views.tsx`.

**Departures**
- **Recipe — the main item's − amount + is gone** (the old How much card, `HowMuchCard`, removed). Scaling is by the servings stepper, Use all, or `?f=`. The factor chip ("×0.45 · every line follows") is no longer shown.
- **Recipe:** "For about 2 · chicken 450 g" under Start cooking is now screen-reader text only. The per-line status words ("Short · you have 450 g") are screen-reader text, so each row stays one line. The recipe tile is no longer beside the title, so a tapped card's tile doesn't travel into the page (the title still does).
- **Cook tab:**
  - Cook now's "Can make N | Missing 1 · N" switch and each row's Start are gone; a missing-one recipe shows in Saved recipes as "Need yogurt".
  - My recipes' cards (ingredients line, meta, tinted Start cooking) became one-line rows.
  - The hub no longer reads every recipe in full for its ingredient names (`useRecipesInFull` is dropped there).
  - The pure helpers `cookNowRows`, `cookNowCounts`, `myRecipeCards`, `ingredientNames` and `ingredientsTeaser` are now unused by the app; they are kept with their tests.
- **Cook step:** the per-step segments and the 72 px ring on the step are replaced by the bar and the timer chip. The view-model still computes `segments`. The waiting screen keeps its 196 px ring.
- **Cooked:** the tiles (steps/servings/cost) and the "What next" heading are folded into the fact line (`NEXT_HEADING` removed). The board's "Add amounts" link on a finished dish is not built, since there is no flow to add amounts to a posted dish. The Split ✓ row has no Undo (there is no unsplit).
- **Not touched:** in `cook-hub-views.tsx`, the parts other screens render (Home's `CookNowStrip`, You's `YourRecipes`, `PersonRecipesView`, `SaveCopyChip`, `FeedRecipeRowView`, `Segmented`) are left to their own tasks.

**Pinned copy and pins changed** (`tests/web-console-next`)
- `kitchen-cook-hub.test.ts`:
  - The hub test is now "New dish (a blank session), Find a recipe, Cook now and Saved recipes" ("Start cooking" → "New dish", "My recipes" → "Saved recipes").
  - The empty-hub test passes `saved: []`.
  - Removed: the `CookNowSection` segments render test and the `MyRecipesSection` render test (components removed).
  - New: 4 tests for the lists.
- `kitchen-community.test.ts`: "a Community entry, above My recipes" → "after New recipe".
- `kitchen-recipes-travel.test.ts`, `kitchen-recipe-photo.test.ts`: `cards` → `saved`; the photo entry is checked on `CookHubView`.
- `kitchen-recipe-page.test.ts`:
  - The How much test → the servings stepper and Use all.
  - The ingredients test no longer pins "Have 6 of 8 · 2 to get" (now "Have 6 of 8" in the header, pinned in a new header test) and pins the ring dot.
  - "For about 2 · chicken 450 g" is pinned as screen-reader text.
- `kitchen-cook-guided.test.ts`:
  - The step render test: `text-[26px]` → `text-[30px]`; "LOOK FOR" → "Look for: "; the flame/ring/hex pins → `data-heat="2"`, "Medium flame · 5–7 min", the progress bar and "2 of 8", ">Add amounts<".
  - Prompt and Done main buttons `bg-[#B4471F]` → `bg-primary text-primary-foreground`.
  - Long prep `bg-[#FDF1D6]` → `bg-cp-soon-tint`.
  - The strip `background-color:#17201B` → a card pill.
- `kitchen-cook-guided-timers.test.ts`: `TimerCard` → `TimerChip` (same assertions).
- `kitchen-cook-session.test.ts`: `background-color:#17201B` → `hsl(var(--cp-cook-bg))`; `bg-[#B4471F]` → `bg-cp-cook`; `bg-[#EEF7F1]` → `bg-cp-accent-tint`.
- `kitchen-recipe-share.test.ts`: `bg-[#B42318]` → `bg-destructive`.

**Tests.** `tests/web-console-next`: 114 suites, 2,253 tests, all passing. Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`. `console-artifact.mjs build` passes: 43 pages served as files, `/cook` and `/cook/session` `○` static.

**Browser check** (390 × 844, light and dark). The setup was `next dev` behind a local in-memory API mock (never committed) on `cookpool-stage.localhost:4862`. Every resource came from that host.
- Cook: New dish, search, Cook now · 4 and Saved recipes · 5 with See all, tags, and dark tiles.
- The curry recipe: "Serves about 2 · 45 min · Have 5 of 6", Use all, − about 2 +, dot rows with the yogurt ring, Start cooking.
- Guided step 2 of 8: the chip, 30 px text, the check line, "Start 7:00" → "6:59 · Pause" with +1 min and the push note, and Add amounts → Before you start.
- Cooked: "₹12 · 4 portions"; Split opened the sheet, and after splitting showed "✓ Split with Flat 4B", Post quiet, Done.

### RV1 — Swipe between tabs, and Pantry becomes Kitchen (RV-9)

**Built** (`apps/web-console-next`). No routes, no migrations, no contracts or SDK change.

- **Swipe between tabs** (new frame only, below 900 px, on the five roots `/home`, `/pantry`, `/cook`, `/money`, `/you` only; never their sub-pages):
  - The rules are pure, in `components/kitchen/tab-swipe.ts`: `tabSwipeOn`, `neighbourTab`/`tabSwipeTarget` (`nav.ts`'s order, nothing past either end), `tabSwipeClaims`, `tabSwipeOffset`, `tabSwipeRelease`, `refusesTabSwipe`, `tabSwipeRule`.
  - **Numbers:** go at `|dx|` ≥ 64 px (`TAB_SWIPE_PX`). Sideways means `|dx|` > 1.6 × `|dy|` (`TAB_SWIPE_RATIO`), decided once the finger has gone `DECIDE_PX` (8 px, PW-7's), so in the first moves. Never within 24 px of either side (`TAB_SWIPE_EDGE_PX`). The page follows at 0.3× the finger, at most 72 px, and not toward an end.
  - **No `preventDefault` before the decision:** the claim is false until 8 px, so the first moves are never cancelled; vertical and diagonal drags are left to the browser.
  - **Never from:** anything that scrolls sideways (`scrollersBetween(…, "x")`: Home's Cook now cards, chip rows), PW-7's `OWN_DRAGS` (inputs, textareas, selects, contenteditable, `data-gestures="off"`), and `NO_TAB_SWIPE`: `[data-no-tab-swipe]` (new opt-out), `[data-swipe-row]` (`SwipeRow`), `input[type=range]`, `[role=slider]`, `[role=tablist]`, `[role=dialog]`/`[role=alertdialog]`, `[data-vt-keep]` (tab bar, sidebar, the cook session's bar). It also never starts while any dialog or sheet is open.
  - **The frame's part** is `TabSwipe` (`gestures-ui.tsx`), mounted by the kitchen layout in the new frame. It is on `<main>` and goes through PW-7's `listenForDrags`; there is no second gesture system.
  - **Release:** past the threshold it navigates with `navigate(href, { kind: "tab" })` inside `transitions.tabSwiped(direction, …)`. Short of it, the page springs back (`SETTLE_MS`).
  - **The slide:** `lib/transitions.ts` gains the styles `swipe-next`/`swipe-prev` (240 ms, `TRANSITION_MS`). In `globals.css`, the old page leaves the way the finger went, from where the finger left it, and the next tab comes in from the other side.
  - Without view transitions (iOS before 18), `<main>` slides away itself, then the tab opens.
  - With reduced motion the page doesn't follow or slide: it navigates (the existing `reduced` 100 ms fade).
- **Pantry becomes Kitchen** (every frame; routes, ids, query keys and code names unchanged, and `/pantry` keeps working):
  - The tab label in both frames' tab bars and the sidebar (`nav.ts`), so today's frame reads Home · Kitchen · Add · Groups · People.
  - The page title (`pantry-new-ui.tsx`, today's `app/(kitchen)/pantry/page.tsx`).
  - Empty and error states: "Nothing in your kitchen yet", "Couldn't load your kitchen." (Kitchen, Bought, the dish maker), "Your kitchen" (an unknown item's link back).
  - "Find in your kitchen", Use's "In your kitchen", and the manifest screenshot's label.
  - Every "your pantry/pantries", "Your pantry" and "My pantry" phrase became "your kitchen":
    - Add's "to your kitchen", the dish's "your kitchen" lines and leftovers note, "Saved for … in your kitchen.", "Added 3 to your kitchen · ₹374".
    - The receipt's "matching to your kitchen…" and its personal fallback "My kitchen".
    - The dish maker's "Your kitchen" chip, "from your kitchen", "stays in your kitchen".
    - Quick use's "across your kitchen" and "from your kitchen".
    - The recipe's "✓ Your kitchen · …" and "Check your kitchen again"; the session's "Your kitchen" and "Not in your kitchen · left out".
    - The item's "You can't add to your kitchen any more." and "You moved it here from your kitchen".
    - Say it's "isn't in your kitchen"; join's "Your own kitchen comes with you."; assistants' "Read your kitchen, recipes, …"; sign-in help's "Your groups, kitchen and balances…".
  - There was no "Back to Pantry", breadcrumb or Home link that said Pantry: Back is an icon labelled "Back", and Home has no Pantry link.

**Departures and words that stay.**
- **A group's Pantry sub-tab** (`GROUP_TABS`, "Activity · Pantry · Money"), its "Pantry" heading on today's group page, "Nothing in the pantry", "Couldn't load the pantry." and the group's "Pantry item" add option all stay "Pantry". They mean that group's shelf; "Kitchen" there would read as the Kitchen tab, which holds every shelf.
- **Phrases that name a shelf, not your whole kitchen, stay**, for example "a pantry you can see", "every group pantry you're in", "Take from any pantry", "Search every pantry", "back in its pantry" and "stays in the pantry". The same goes for the desktop table's "Pantry" column, the pantry chips' group label, and the marketing "share a pantry".
- **The Cook tab** has no horizontal strip since RV-4 (its lists are rows). The "Cook now cards" exclusion is Home's `CookNowStrip`; the rule refuses any element that actually scrolls sideways, so a chip row that fits doesn't block a swipe.
- **Release ignores flicks:** only the 64 px distance counts, as specified (the edge swipe's flick rule is not used).

**Pinned copy changed** (`tests/web-console-next`, each on purpose):
- `kitchen-nav.test.ts`, `kitchen-new-frame.test.ts`: the tab and sidebar labels "Pantry" → "Kitchen".
- `kitchen-cook-session.test.ts`: "Your pantry · last time 500 g" → "Your kitchen · …"; "Not in your pantries · left out" → "Not in your kitchen · left out" (2).
- `kitchen-dish-maker.test.ts`: the chip "Your pantry" → "Your kitchen"; "70 g stays in your kitchen"; "from your kitchen"; "Your kitchen · 450 g left".
- `kitchen-dish.test.ts`: three "· your kitchen ₹" lines; "left over · to your kitchen" (2); "in your kitchen as Leftovers".
- `kitchen-measures.test.ts`: "Saved for rice in your kitchen."
- `kitchen-item-form.test.ts`: `who: "to your kitchen"`.
- `kitchen-receipt-run.test.ts`: "Added 4 to your kitchen · ₹503"; "matching to your kitchen…" (2).
- `kitchen-shopping-run.test.ts`: "Added 3 to your kitchen · ₹374".
- `kitchen-quick-use.test.ts`: "across your kitchen" (2); "Log 2 pcs of Eggs from your kitchen, …".
- `kitchen-recipe-page.test.ts`: "✓ Your kitchen · 150 ml" / "· 450 g".
- `kitchen-sign-in-screens.test.ts`: "Your groups, kitchen and balances stay as they are meanwhile."

**Tests.**
- `tests/web-console-next`: 118 suites, 2,338 tests, all passing.
- New `kitchen-tab-swipe.test.ts` (18 tests): the order and labels; where it is on (roots only, new frame, below 900); next/previous and the ends; the numbers; the decision at 8 px; the follow offset; the release; the edges; sideways scrollers; every refused target; an open sheet; synthetic touch events (no move cancelled before the decision, vertical and diagonal untouched, a short swipe, the edge).
- New in `kitchen-transitions.test.ts` (3 tests): `swipe-next`/`swipe-prev` styles, durations and no shared parts; `tabSwiped` for one step only; reduced motion and no view transitions.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 44 pages served as files.

**Browser check** (390 × 844). `next dev` on 47390 ran behind RV-4's in-memory API mock on `cookpool-stage.localhost:47391` (never committed). The resource log listed only that host. Swipes were simulated with `TouchEvent`s:
- Kitchen → left → Cook. The first 4 px move was not cancelled and the rest were. `<main>` followed at −2.7 to −36 px.
- Cook → right → Kitchen, with `data-vt="swipe-prev"` during the step.
- Kitchen → right → Home; on Home, a right swipe did nothing (no cancelled moves, no follow).
- Starts at x = 10 and x = 380 did nothing. A left swipe on Home's Cook now cards (scrolling sideways) did nothing.
- A vertical drag on Home had no cancelled moves and no transform. You → left did nothing, You → right → Money, and `/you/settings` doesn't swipe.
- The title and tab read "Kitchen".
- Light/dark and reduced motion were covered by the unit tests, not in the browser.

**Deploy.** Only the console changes.

### RV1 — Kitchen, tick to log, with the unit picker (RV-10)

**Built** (`apps/web-console-next`, new frame only). **Console-only:** no route, no migration, no contracts or SDK change, no worker change. Everything the row needs is already on the list view: the items read carries `measures`; the new frame's usuals read (`limit=100`, `tzOffset`) carries each food's last use (`lastQtyMilli`, `lastLabel`, `lastUsedAt`) and its usual for this part of the day (`now`).

- **The shared row** (for RV-11's cook ingredients too):
  - `components/kitchen/tick-row.ts`, pure, built on PN-11's `amount-picker.ts` so a tick logs exactly what the picker would:
    - `tickStart(item, suggestion, usualUnit?)`: the ghost, PN-11's `pickStart` from the row's suggestion (PN-2's bucket usual through PN-5's ladder), converted to the food's usual unit when the item offers it. `tickStartAt(item, qtyMilli, usualUnit?)` does the same from a plain amount (RV-11's scaled recipe amount).
    - `tickAmount(item, start, { typed, unit })` → `{ units, unit, ghost, ghostPick, pick, typed, invalid, number, word, words, qtyMilli }`. The chips are `amountUnits` (the item's own measures, then its dimension's plain units). A chosen unit converts the ghost (`pickUnit`, rounded to the unit's step). Typing uses `pickTyped` (½, 1½, 1,5, fractions; capped at what is left); junk leaves the ghost in force and marks the box invalid.
    - `tickUnitChoice` (clears the typed amount, keeps the unit), `cleanTyped`, `tickWrite` (`pickWrite`: a measure's count, else the base unit).
    - `lastUseText(usual, item, now)`: "1 glass · yesterday, 8:10 pm" (with the time today and yesterday, the date before), counted things in their own word ("2 eggs"). `tickMeta`: "Expired · 200 g left" (red), "50 g · 9 Nov · use by tomorrow" (amber), else the last use or "1.2 kg left" (muted).
    - `usualUnitKey`, `parseUsualUnits`, `putUsualUnit` (at most 200 foods), `tickLoggedText` ("2 logged").
  - `components/kitchen/tick-row-ui.tsx`: `TickHeader` (ITEM · LAST TIME | AMOUNT | ✓, decorative) and `TickRow`, a 3-column grid `minmax(0,1fr) 124px 48px`. Props: `id`, `name`, `href?`, `meta`, `amount` (null: no box, no tick), `state`/`onState` (controlled), `onUnit?(unitId)`, `done: { number, word } | null`, `onTick`, `end?` (replaces the tick), `busy?`, `tickLabel?(words, name, done)`, `children` (under the name). The unit button sits in the box and opens a chip row under the row; Enter in the box ticks. Done: the row is on `cp-accent-tint`, the box is locked on what was logged, and the tick is filled and `aria-pressed`.
- **The Kitchen** (`kitchen-tick-ui.tsx`, `pantry-new-ui.tsx`):
  - `KitchenTickRow` + `useKitchenTicks`. Each item's box and tick state is held once per screen, so Milk in Usual now and Milk in Dairy tick together.
  - The tick goes through `useLogUse` (optimistic, the one Undo toast) for **you alone** (personal: nobody). Who else had it stays on the item page, where the name links.
  - Ticking again presses that toast's Undo. Pressing Undo on the toast unticks the row. A refusal unticks it.
  - **Usual now · <part of day>** (`usualNowRows` in `pantry-look.ts`): listed, usable rows whose food has a `now` usual, most uses in the bucket first, at most 6. It shows on All with no search, all rows (no See all), with "N logged" beside the heading.
  - Each kind section has the column header, the tick rows, three then See all, and "N logged" beside its heading.
  - An ask-first row (PN-9) shows a lock button in the tick's place that asks with the box's amount. A waiting ask shows × (Cancel). Its status line stays under the name.
  - The usual unit is kept on the device (`lib/pantry-device.ts`: `useUsualUnits`, `saveUsualUnit`, `<prefix>.pantry-units`, cleared with the rest on sign-out).
- **The toast** (`undo-toast.ts`): `UndoToastHandle.undo()` presses Undo from elsewhere and takes the toast away. `useLogUse` takes `onUndoable(undo)` and `onUndone()` (from `restore`). Existing callers are unchanged.

**Departures.**
- **Log several and the Now strip are gone from the Kitchen.** Ticks log in one tap each, which is what the tray did. Usual now takes the strip's place. The open-in-place set row, the row swipe and the long-press More… sheet are gone from Kitchen rows too: the name opens the item page, which keeps Use with people, Finish it, Wasted, Bought again and Cook with it. `PantryRowView`, `NowStripView`, `LogTray` and `SetRow` stay in the code (used by nothing on this page now). Say it still uses `useLogSeveral`.
- **Sections stay by kind**, as RV-3 kept them (the board draws them by pantry). The chips, the Use soon strip, Finished this week and Always have stay.
- **The time reads CP-23's way:** "yesterday, 8:10 pm" and "3 Nov", not the board's "yesterday 8:10" and "Wed". At 390 px a long line truncates with an ellipsis.
- **The unit chips are labelled with the plural word** ("glasses", "ml", "eggs"), as PN-11's chips are.
- **Usual now uses `now`** (PN-2's bucket usual, USUAL_NOW_MIN_USES uses), not the strip's stricter `strip` flag, and has no use-soon filler.
- **The usual unit is per device**, not on the server. The server's usual follows the next logs in that unit.
- **The board's footnote** ("Tick logs the grey amount…") is left out.

**Pinned copy changed:** none.

**Tests.**
- `tests/web-console-next`: 119 suites, 2,361 tests, all passing. New `kitchen-tick-row.test.ts` (23): the ghost (measure, count word, plain unit, usual unit, nothing left, from a plain amount); typing (½, decimals, junk, capped); the chips (only the item's), conversion (1 glass → 250 ml → ¼ L, 2 glasses → ½ L), clearing typed, typing in the chosen unit, an unknown unit; what a tick writes; the line under the name; the kept units; Usual now.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 44 pages served as files, `/pantry` `○`.

**Browser check** (390 × 844, light and dark). `next dev` on 47610 ran behind an uncommitted in-memory mock on `cookpool-stage.localhost:47611` (RV-3's, plus usuals, measures and move undo). Every request was local.
- Usual now · Evening listed Milk ("1 glass · yesterday, …", amber: use by Sat) and Eggs. Dairy had the header row and See all 5. Greek yogurt read "Expired · 200 g left" in red.
- Ticking Milk sent `POST …/items/itm_milk…/uses {"quantity":"1","measure":"glass","consumers":[me]}`. Both Milk rows turned green and locked, with "1 logged". Ticking again sent `POST …/moves/mov_11/undo` and both rows unlocked.
- Typing 3 over Eggs' grey 2 and ticking sent `{"quantity":"3","unit":"pcs"}`, with the toast "Logged 3 eggs · ₹8.50 · Undo". The toast's Undo sent `…/me/moves/mov_13/undo` and unticked the row.
- Milk's unit opened glasses · ml · L. Picking ml made the grey amount 250 ml and kept `u:ml` for the food. In dark, the tick sent `{"quantity":"250","unit":"ml",…}` and the row turned gold.

### RV1 — Native-feeling tab swipe, and swiping on the tab bar (RV-12)

**Built** (`apps/web-console-next`). No routes, no migrations, no contracts or SDK change. New frame only, below 900 px, as RV-9's swipe.

- **The page tracks the finger** (`TabSwipe`, `gestures-ui.tsx`):
  - `<main>` follows one to one (`tabSwipeOffset(pathname, dx, width)`, never past a full width). RV-9's 0.3× follow with a 72 px cap is gone.
  - The tab beside comes in alongside it, one width away. It is an absolutely positioned, `aria-hidden`, `pointer-events-none` layer (`fixed top-0 z-30 h-dvh`, under the bars) that moves with the finger.
  - Moves still come through PW-7's `listenForDrags`. They are coalesced to one paint per `requestAnimationFrame`, with `translate3d` only, and `will-change: transform` on both layers only while dragging. Nothing is transformed at rest.
  - Reversing mid-drag swaps the preview to the other neighbour.
- **What the neighbour layer shows** (`components/kitchen/tab-preview.ts`, new): a snapshot. It is a detached `cloneNode` of `<main>` (ids and inline view-transition names stripped), taken:
  - about 1 s after arriving on a tab root, at idle (`requestIdleCallback`);
  - again as the tab is left by a swipe or the bar.
  - A tab not seen yet this visit shows its title (`K_TITLE`) over the frame's skeleton.
  - The copies live in memory only, so a reload starts with skeletons.
  - **Why a snapshot, not the live page or an early navigation:** both of those mount a whole React tab (queries, effects, layout) in the first frames of the gesture, which is where a mid-range phone drops frames. Navigating early would also bring a view transition and a scroll reset mid-drag. With a snapshot, the drag only moves two composited layers. Then `router.push` (via `navigate(href, { kind: null })`, so nothing animates twice) commits once the spring has settled, and the real page replaces the copy in the same frame (a layout effect resets the page on arrival).
- **Release** (`tabSwipeRelease(pathname, dx, vx, width)`):
  - Opens the tab beside past 35% of the width (`TAB_SWIPE_FRACTION`), or on a flick of ≥ 0.5 px/ms toward it after 24 px (PW-7's `FLICK_PX_PER_MS`/`FLICK_MIN_PX`).
  - A flick back (≥ 0.5 px/ms away) cancels however far it went. Nothing opens past either end.
- **Settle:** a critically damped spring, in closed form (`springAt`, `springFrame`), with ω = 0.028/ms (`TAB_SPRING_OMEGA`). It starts at the finger's release speed.
  - From rest, a full width settles in about 300 ms.
  - It is done within 0.5 px and below 0.05 px/ms, at 450 ms at most, or the moment it would pass its target (so a fast flick never shows the gap beyond the tab).
  - A cancelled swipe springs back the same way.
- **Rubber band** past Home and You (`rubberBand`: (1 − 1/(|dx|·0.55/w + 1))·w). `tabSwipeClaims` now takes a sideways drag toward an end too (RV-9 ignored it), so the page resists and springs back.
- **Reduced motion:** nothing moves. On release the same rule decides, and the tab opens with the existing `reduced` fade (`transitions.tabSwiped`).
- **Kept unchanged:** the 8 px decision with no `preventDefault` before it, the 1.6 ratio, the 24 px edges, and every exclusion (sideways scrollers, `OWN_DRAGS`, `NO_TAB_SWIPE`, open sheets and dialogs).
- **The tab bar slides** (`FloatingTabBar`, `tab-bar.tsx`):
  - A sideways drag on the bar (through `listenForDrags`; `|dx| > |dy|`, decided at 8 px) shows a gliding highlight: `[data-tab-highlight]`, `bg-primary`, 200 ms transform, none with reduced motion.
  - The highlight starts on the current tab and moves to the cell under the finger (`barTabAt`: five equal cells inside the 6 px padding, clamped to the ends). The label under it turns `text-primary-foreground`.
  - Each crossing calls `navigator.vibrate(8)`, only where it exists and never with reduced motion.
  - Lifting on another tab opens it with RV-9's `swipe-next`/`swipe-prev` slide (`barDirection`). Lifting on the tab already shown does nothing. The click that follows a slide is swallowed.
  - A plain tap is the link's, as before. At rest the bar's markup is RV-2's (current tab `bg-primary text-primary-foreground`).
  - The bar gains `data-gestures="off"`, so the installed iPhone's edge swipe never starts on it.
  - It works on every page that shows the bar.

**Departures**
- **Distance threshold:** 35% of the width replaces RV-9's 64 px, and flicks now count. RV-9's status said flicks were ignored on purpose; RV-12 asks for them.
- **The swipe no longer uses the `swipe-next`/`swipe-prev` view transitions:** the page has already moved with the finger. Those styles now serve the bar's slide. The swipe's no-view-transitions fallback (iOS before 18) is no longer needed: the spring works everywhere.
- **The first visit to a tab shows a skeleton**, not live data, as the neighbour.
- **A new swipe can't start during the ~300 ms settle.**

**Pinned values changed** (`tests/web-console-next/src/kitchen-tab-swipe.test.ts`, each on purpose):
- `TAB_SWIPE_PX` (64) → `TAB_SWIPE_FRACTION` 0.35 and `TAB_SWIPE_FLICK_PX_PER_MS` 0.5.
- `TAB_SWIPE_RESISTANCE`/`TAB_SWIPE_MAX_PX` removed: the offset is 1:1, and rubber-banded toward an end.
- `tabSwipeClaims("/home", 30, 0)` and `("/you", -30, 0)`: false → true (rubber band).
- `tabSwipeRelease` takes `vx` and `width`.
- "a short swipe springs back" now holds still before lifting. The same swipe, flicked, opens the tab (new test).

**Tests.**
- `tests/web-console-next`: 119 suites, 2,355 tests, all passing.
- New `kitchen-tab-swipe-native.test.ts` (16 tests): release by distance, by flick, a flick back, the ends; the rubber band; the spring (closed form and its derivative, about 300 ms with no overshoot, spring back, the release speed carries, the cap); the bar's finger-to-cell mapping, its ends and direction; the bar at rest (RV-2's markup, `data-gestures="off"`); and the haptic guard.
- `kitchen-tab-swipe.test.ts`: 19 tests (RV-9's 18, updated as above, plus 1).
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 44 pages served as files.

**Browser check.** Headless Chromium (Playwright) at 390 × 844, touch and mobile, light and dark, CPU throttled 4× to stand in for a mid-range phone.
- **Setup:** `next dev` on 47720 behind RV-10's in-memory API mock on `cookpool-stage.localhost:47721` (never committed). Every request to another host was aborted and logged: none were made.
- **Input:** real touches through CDP `Input.dispatchTouchEvent`. The throttled flick was sent as in-page `TouchEvent`s, because CDP itself can't send a flick fast enough under throttle.
- **Slow drag** Kitchen → left, 120 px: `<main>` at −120 px, and Cook's layer at +270 px beside it.
- **Cancel:** let go there, slowly. It sprang back (−67 px 60 ms later, then at rest with no transform) and stayed on Kitchen.
- **Flick** (about 90 px at about 1 px/ms, under 4× throttle) switched Cook → Money.
- **Rubber band:** Home dragged right by 200 px moved 85.8 px and sprang back.
- **Vertical scroll:** a vertical drag scrolled the page by 285 px, with no transform.
- **The bar:** sliding from Kitchen to Money moved the highlight to `translate3d(300%)`, lit "Money" and ticked twice. Lifting opened `/money`. A plain tap on Cook opened `/cook`.
- **A seen neighbour:** swiping right on Cook showed Kitchen's copy (not the skeleton).
- **Frame rate** (`requestAnimationFrame` intervals, read with `performance.now()`, 4× throttle): during the slow drag, 60 fps (avg 16.67 ms, worst 16.8 ms, 0 frames over 20 ms, 148 frames). During the throttled flick and its settle, 60.6 fps (one 24.8 ms frame, at the commit). This is headless desktop Chromium with a CPU throttle, not a real phone.

**Deploy.** Only the console changes.

### RV1 — Cooking, tick what went in (RV-11)

**Built** (`apps/web-console-next`, new frame only; with `newFrame()` false the session keeps RC-6's `SessionRow`s). **Console-only:** no route, no migration, no contracts, SDK or worker change.

- **The cook session's ingredients are RV-10's tick rows** (`cook-tick.ts`, pure; `cook-tick-ui.tsx`; board `RvCookLines`). One card: `TickHeader` "INGREDIENT · FROM | AMOUNT | ✓", a `TickRow` per line, then **Add an ingredient** at the card's foot (it opens today's item picker, now titled "Add an ingredient"), and the board's note under the card ("Tick what went in. Grey is the recipe's amount for about 2; …").
  - **The name and its source** (`cookLineMeta`): "Flat 4B · Meera paid", "Mine", "Flat 4B + Mine", "Just bought", "Always have", "None left now", "· short" when the items have less; "Not in your kitchen" in the money-you-owe tone (`cp-owe`) for a missing line.
  - **The grey amount** is the recipe's amount scaled to the session: what the line's items were matched for (`cookTickItem` → `tickStartAt(item, matchMilli)`), on the line's first read item (its measures; what is left summed over the line's items). Something just bought reads its own amount; a line with no item (Always have, missing, not read yet) a stand-in of the line's dimension.
  - **The line's own unit as a chip:** a line counted in tsp, tbsp, cup or a count word ("2 onions" of a kilo of onions, "1 tbsp" of a litre of oil) gets that word as a measure of its own, first among the item's chips (`LINE_MEASURE_ID`), when it is a whole number of halves; so the grey amount reads as the recipe says, and the picker offers "onions · g · kg", "tbsp · ml · L".
  - **The unit picker** is the item's chips (RV-10's `amountUnits`). In a plain unit the grey amount is the recipe's exactly (1 tbsp → 15 ml, not the 50 ml step `pickUnit` would round to), and a typed amount is carried over exactly (`cookUnitChoice`: 3 onions → "450" g). A picked unit becomes the food's usual unit on the device, as in the Kitchen.
  - **A typed amount, or a unit,** sets the line's amount at once (`setLineFromTick` → `setLineAmount`; the takes follow in proportion). Clearing the box puts the recipe's amount back. Coming back to the session, a changed amount shows in the box over the grey (`cookTickState`).
  - **The tick is went in:** the line's ticked state (`tickLine`) in the session on the device; Enter in the box ticks too. No use is written until Finish.
  - **Ask-first lines** (PN-9): a lock in the tick's place that asks, × to cancel while it waits, the approved ✓ / waiting ⌛ / declined icon, and the ask's status under the name. An ask on its way or approved holds its amount (words, no box).
  - To taste reads "To taste" in the box's place with a tick; a missing line shows its amount in grey and a dashed, empty tick cell.
- **Header:** the session's top bar, the name, the scale chip and "N of M in" stay; under them a **thin progress bar** (`CookTickBar`, `cookTickPercent`).
- **Finish** (`cookFinishText`): "₹147.70 so far · 3 in", or "₹0 · nothing taken from the kitchen" while nothing is ticked; always enabled (RV-7).
- **Unticked rows aren't charged:** the new frame's Finish sheet (`CookFinishSheet`, which guided mode's Done also opens) posts only ticked lines (`unticked: "out"`); its "N not ticked · Took them all / Leave them out" box is gone. Lines with no amount are still never charged (RV-7).
- **Guided mode's ingredient list** (Before you start's Gather) uses the same `CookTickList` (new `GuidePrepView` prop `gatherList`).
- **RV-10's row, additive only** (`tick-row-ui.tsx`, `tick-row.ts`): `TickRow` takes `fixed?: string | null` — words in the box's place with the tick still drawn when there is no `amount`; without it the Kitchen's rows draw exactly as before. `TickTone` gains `"owe"`.
- **Kept:** add an ingredient (in the card), the item picker and bought-new lines, ask-first lines, the session clock and guided timers, the steps card, discard, the one-at-a-time prompt, the session bar, offline Finish, a refusal pointing at its line (the row is outlined and scrolled to).

**Departures.**
- **The header keeps the session's top bar** (minimize, COOKING, the clock) and the scale chip ("For about 2 · ×0.45"), with "N of M in" beside the chip, instead of the board's back arrow, "For 4 · 3 of 7 in" and Steps button. Steps stay the session's Steps card.
- **The amount column is RV-10's 124 px**, not the board's 112 px (the row is shared, not forked).
- **A missing line can't be ticked** (it isn't in your kitchen, so it can't go in the dish) and isn't counted in M; the board draws a tick on Yogurt and counts it in "of 7".
- **The source line drops "last time 2 onions"**: one line under the name, as the board draws it.
- **Money keeps its paise:** "₹147.70 so far", where the board rounds to "₹223".
- **Unticked rows are left out in guided mode's Finish too,** since it opens the same sheet; the Took them all / Leave them out choice is gone from the new frame. Today's frame's `FinishSheet` keeps it.
- The Finish sheet's own line for no amounts is still RV-7's "₹0 · nothing taken from the pantry" (pinned); the button on the screen says "kitchen".
- A spoon or count unit that isn't a whole number of halves (¼ tsp) reads in the item's plain units.

**Pinned copy changed:** none.

**Tests.**
- `tests/web-console-next`: 121 suites, 2,383 tests, all passing. New `kitchen-cook-tick.test.ts` (9): the grey amount in grams, in the line's own word ("2 onions" with chips onions · g · kg), in a spoon ("1 tbsp", "½ tsp" with no item), to taste; typing 3 onions → 450 g and clearing back to 2, the box seeded from the line on return; kg; 1 tbsp → 15 ml exactly and typed onions carried to "450" g; junk; the source line (Flat 4B · … paid, Mine, Always have, Not in your kitchen in owe); "0 of 5 in" → "2 of 5 in", 40 %, "₹0 · nothing taken from the kitchen" → "₹138 so far · 2 in", the tick's names; Finish with nothing ticked posts no ingredients, and only the ticked line at its typed amount.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 45 pages served as files, `/cook/session` static.

**Browser check** (390 × 844, light and dark). `next dev` on 47711 behind RV-4's uncommitted in-memory mock on `cookpool-stage.localhost:47712`; every request was to that host.
- The curry at ×0.45, Just tick what I use: Chicken 450 g · Mine, Onions 2 onions · Flat 4B, Yogurt 90 g · Not in your kitchen (owe), Garam masala ½ tsp · Always have, Salt To taste, Cooking oil 1 tbsp · Flat 4B · you paid; "0 of 5 in"; Finish "₹0 · nothing taken from the kitchen".
- Ticking Chicken: the row green and locked, the bar at 20 %, "₹126 so far · 1 in". Typing 3 over Onions' grey 2 and Enter: "₹144 so far · 2 in". Oil's unit opened tbsp · ml · L; ml read 15; typing 20 and ticking: "₹147.70 so far · 3 in".
- Dark: gold ticks and Finish, the pink "Not in your kitchen".
- Finish → the sheet (no unticked box) → Finish posted `{"ingredients":[{chicken "450" g, line 0},{onions "450" g, line 1},{oil "20" ml, line 5}], "recipeId", "recipeFactorMilli":450, …}` and landed on Cooked! with "₹147.70 · 2 portions".
- Start step by step → Before you start: Gather showed the same tick rows.

**Deploy.** Only the console changes.

### RV1 — dark mode is black with the green (RV-14)

- The owner replaced dark mode's Gold with the light mode's green on black (canvas, 12 Nov). `globals.css`'s dark block (`prefers-color-scheme: dark`, new frame only) now sets ground `#000000`, cards and the tab bar `#141414`, lines `#262626`, borders `#333333`, ink `#F5F5F5`, muted `#A3A3A3`, the accent, ring, success and cook colour `#22C55E` with black text, accent text `#4ADE80`, tint `#0F2E1C`. Money back (blue), money you owe (pink), use soon (amber) and expired (red) are unchanged.
- The dark `theme-color` is `#000000` (was `#09090b`).
- `kitchen-revamp-foundation.test.ts` pins the new dark values; its no-orange check still passes. design.md §1 and the README's decisions record the change.

### RV1 — Kitchen: tick to pick, Log once, one flat list (RV-13)

**Built** (`apps/web-console-next`, new frame only; with `newFrame()` false `/pantry` still renders today's `TodaysPantry`). **Console-only:** no route, no migration, no contracts, SDK or worker change. Spec: the board `RvKitchen` and its note `tickRules`.

- **A tick picks** (`kitchen-picks.ts`, pure; `kitchen-tick-ui.tsx`). A Kitchen tick only marks the row: it turns green, the tick is `aria-pressed`, and the amount box and unit stay editable. Ticking again unpicks it. Nothing is written until Log. `useKitchenTicks` now holds `boxes`, `picked` (kept in the order things were picked) and `logged`. The single-use write (`useLogUse`) is gone from the row. Ask-first rows keep their Ask and Cancel buttons and can't be picked.
- **`TickRow` picked mode** (`tick-row-ui.tsx`). It takes a new optional prop, `picked?: boolean`: green row, pressed tick, editable box with a transparent border and accent text, and the unit button in the accent. While a row is picked, Enter only puts the keyboard away. Without the prop the row behaves as before. The cook session (RV-11) still passes `done` and never `picked`, so its ticks and its locked done rows are unchanged.
- **The Log button** (`KitchenLogBar`). It shows only while at least one row is picked: accent background, check icon, "Log 2 items" over "Milk 1 glass · Eggs 2" (`logBar`, `pickWords`; the unit word is dropped when it is the thing itself), truncated to one line.
  - It is sticky at the end of the page, so it can never cover the last rows. It sits at `max(14px, safe-area) + 82px` (the board's 96 px above the screen edge), or +150px while the cooking bar shows, and at `bottom-6` from 900px.
  - It is marked `data-toast-above`, so toasts lift above it.
- **Log once** (`useLogPicks`). One tap logs every picked row through Log several's path (`useLogSeveral`). Each row is its own use on the existing route, with its own idempotency key, for you alone (nobody named in your own pantry), sent one after another.
  - The box becomes a step through `pickStep`: a count of a measure, otherwise an amount in the base unit. That is exactly what a tick wrote before.
  - The picks clear at once, and ONE toast reads "Logged 2 items". Its Undo undoes every use, the last one first, and picks the rows again with what their boxes held (as the board does).
  - A logged row's line reads "Logged 1 glass · just now" in the accent text (new `TickTone` `"logged"`) until reload.
  - A refused row is picked again with what it had. The toast becomes "Logged 1 of 2 items · Couldn't log Butter. Still ticked." When every row is refused, it shows Log several's existing refusal.
- **`useLogSeveral`, additive only** (`log-several-data.ts`). It now resolves to the refused entries (it used to resolve to `void`; Say what you used ignores the result). It takes `onRestore` (called when Undo is pressed). An `ask_first` refusal turns the row into its ask row, as a single use already does (PN-9, new frame only).
- **The unit picker on every row.** Why it didn't work on stage:
  1. The unit button was disabled with no ▾ whenever the item had one unit. That covers every pack, most counted things bought under a dozen, and grams of anything bought under 1 kg with no measures (Paneer, Butter, Tomatoes in the mock).
  2. It was disabled once ticked, and a tick logged at once, so there was never a picked row to change.
  - Now the button and its ▾ show and work whenever the box is editable, on unpicked and picked rows alike (`unitPickerOn`). They stay locked only while `done` (the cook session).
  - An item with one unit opens its single chip plus **Add a measure**, which links to the item's page (Counted as).
  - Picking a chip converts the grey amount and is kept as the usual unit (`saveUsualUnit`, unchanged).
- **One flat list, no folding** (`pantry-list.ts` `pantrySections`, replacing `kindSections` / `sectionOpen` / `toggleFold`).
  - Order: Usual now · <bucket>, then one section per pantry (each group by its name, in the pantry chips' order, groups opened last first), then yours titled **Mine**.
  - Each section shows three rows, then See all. Use soon comes first, then running low, then by name. The heading reads "Flat 4B · 6", with "2 ticked" on the right (`tickPickedText`, which replaces `tickLoggedText`).
  - There is no fold chevron and no section by kind. The kinds survive only for naming a typed category on a row.
  - Search, the filter chips (still filtering the rows inside the pantry sections), Use soon, Finished this week (still folding, as before) and Always have are unchanged. Searching shows every matching row. The board's footnote sits under the sections.

**Departures.**
- **A row listed in Usual now is left out of its pantry's section** (the board lists each item once). With a filter chip or a search, Usual now is empty, so every row shows in its pantry.
- **Groups come before Mine**, as on the board, although the pantry chips put yours first.
- **Undo picks the rows again**, as the board does; the brief only says Undo undoes the uses.
- **Add a measure** for one-unit items isn't on the board. Without it a one-unit item's ▾ would open a single chip and nothing else.

**Pinned copy changed:** the section count "2 logged" → "2 ticked" (`tickPickedText`; `kitchen-tick-row.test.ts`), because the board's words changed with what a tick does.

**Tests.**
- `tests/web-console-next`: 125 suites, 2,455 tests, all passing.
  - New `kitchen-picks.test.ts` (14): pick and unpick in order; logged rows out, refused ones back; no single-use write left in the row; the button's words ("Log 2 items", "Milk 1 glass · Eggs 2", "Log 1 item"); the sticky, safe-area, toast-lift placement; one Log several call with `pickToast` and `onRestore` and an idempotency key per use; send in order and undo last-first, skipping the refused; the toasts ("Logged 2 items", "Logged 1 of 2 items · Couldn't log Milk. Still ticked."); the logged line.
  - The unit picker on unpicked and picked rows: ▾ on a one-unit item, Add a measure, converting 1 glass → 250 ml on a picked row and what Log then writes, and still locked when `done` (the cook rows pass `done`, never `picked`).
  - `kitchen-pantry-new.test.ts`: the kind-section and fold tests are replaced by `pantrySections` tests: by pantry in the chips' order with Mine last, never by kind, use soon first, chip and search filtering, a search showing all four matching dals with no See all, three rows then "See all 4" with Usual now's row left out, and no fold chevron in the screen.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 45 pages served as files.

**Browser check** (390 × 844, light and dark). `next dev` on 47930 ran behind RV-10's in-memory mock, copied and never committed, on `cookpool-stage.localhost:47931`. In the copy, Butter's uses are refused with 409 `insufficient_stock`. The resource log listed only that host.
- The list showed Usual now · Evening (Milk, Eggs), then Flat 4B · 6 (three rows and See all 6), then Mine · 3, with no fold chevron. Paneer (g only) showed its ▾.
- Ticking Milk and Eggs turned both rows green, put "2 ticked" on Usual now, and showed "Log 2 items · Milk 1 glass · Eggs 2" above the tab bar. No request was made.
- Milk's ▾ on the picked row opened glasses · ml · L. Choosing ml made the box read 250 and the button read "Milk 250 ml · Eggs 2".
- With Butter added, Log 3 items posted three uses (Milk `250 ml`, Eggs `2 pcs`, Butter refused). One toast read "Logged 2 of 3 items · Couldn't log Butter. Still ticked.", lifted above "Log 1 item · Butter 100 g". The Milk and Eggs rows read "Logged 250 ml · just now" and "Logged 2 eggs · just now" in green.
- Atta and Cheese slices were logged, then undone from the toast. The mock took two undos (the last first), and both rows were picked again under "Log 2 items".
- In dark mode, the gold tick, Log button and logged lines showed.
- The old frame on `cookpool-prod.localhost:47931/pantry` rendered today's list as before.

**Deploy.** Only the console changes; it has no package or worker dependency to redeploy.

### RV1 — Tab bar on pushed screens, shared bits and pantry flows (RV-19)

**Built** (`apps/web-console-next`). **Console-only:** no route, no migration, no contracts, SDK or worker change. Spec: the revamp audit's "Tab bar and shared parts" section and the boards `RvItem`, `RvRecipe`, `RvCookStep`, `RvCooked`, `RvGroups` (drawn without the tab bar).

- **Pushed screens hide the tab bar** (new frame only). `tabBarHidden(newFrame, pathname, search)` in `nav.ts` is true on:
  - an item's page `/pantry/<ref>` (not `/pantry/new` or `/pantry/run`; a stock check `/pantry/<ref>/check` keeps the bar);
  - a recipe's page `/recipes/<id>` (not `new`, `edit` or `plan`);
  - the cooking session `/cook/session` (guided and tick);
  - Cooked! (`/dishes/<ref>?cooked=1`, until its Done drops the parameter);
  - the Groups list `/groups` (not a group's page).
  - The kitchen layout reads the query in a Suspense'd `SearchProbe` (pages stay static) and skips `KitchenTabBar` there. Today's frame always shows its bar.
- **The bar's room as CSS variables, for other tasks to adopt.** The layout's wrapper carries `data-tabbar="shown"|"hidden"` in the new frame (nothing in today's frame). `globals.css` turns it into:
  - `--cp-tabbar-space`: `calc(max(14px, env(safe-area-inset-bottom)) + 76px)` where the bar shows; `0px` where it is hidden and from 900px.
  - `--cp-bottom-bar`: where a sticky bottom bar's bottom edge sits: the same as `--cp-tabbar-space` where the bar shows; `max(12px, env(safe-area-inset-bottom))` where it is hidden; `24px` from 900px.
  - `--cp-main-bottom`: `<main>`'s end padding where the bar is hidden (`env(safe-area-inset-bottom) + 1.5rem`). Where it shows, `<main>` falls back to today's `env(safe-area-inset-bottom) + 6.5rem`.
  - **How to adopt it:** write `bottom-[var(--cp-bottom-bar,<today's offset>)]` (e.g. `bottom-[var(--cp-bottom-bar,calc(env(safe-area-inset-bottom)+5.75rem))]`). Today's frame sets no variable, so the fallback keeps its offset. Add item, the shopping run and the stock check use it. **The screens that hide the bar have no shared helper, so their bars were not changed here.** They still sit at the tab bar's height until their owners switch them: the item page's sticky bar (`pantry/[itemRef]/page.tsx`, RV-15); the session's `cook-session-screen.tsx:460`, guided `cook-guided-ui.tsx:407/1043/1162`, recipe `recipe-views.tsx:318` and Cooked `cooked-ui.tsx:93` (RV-16). The cooking session's phone bar (`SessionBarCard`, `cook-session-ui.tsx:485`) shows on `/groups` and should also move to `--cp-bottom-bar`.
- **Faces** (`faces.ts`): `ME_FACE` and `FACE_COLORS` are now `hsl(var(--cp-face-me))` and `hsl(var(--cp-face-1…6))`. The face tokens are the canvas's six colours; yours is the accent `#167A4A` in light and `#15803D` in dark (white initials, 5:1).
- **Main button words** (`faces-ui.tsx` `MainButtonLabel`): 17px Medium over a 12px Regular line under `.cookpool-new`; today's frame keeps 16/13.
- **Group tints** (new `group-tint.ts`; `kit.tsx` `GroupAvatar`): six tints (green, blue, amber on existing tokens; purple, teal, slate on new `--cp-purple(-tint)`, `--cp-teal(-tint)`, `--cp-slate(-tint)` tokens with dark pairs, as `cp-*` Tailwind colours). The tint is picked by a hash of the group id (the name when a caller has no id). It is applied only under `.cookpool-new`, so today's frame keeps the green tint. `data-tint` names it. Groups, the sidebar and the group picker pass `id`.
- **Chip and Segmented** (`ledger-ui.tsx`), new frame only: no border, Medium. A chip is on the muted fill, or on the accent tint with accent text when picked. Segmented is a muted track with the choice on the accent.
- **The card-border rule** (`globals.css`): `.cookpool-new [class*="rounded"].border.bg-card` loses its border for the card shadow. Inputs, textareas, selects, labels, buttons, anything with a `role`, `aria-pressed`/`-checked`/`-selected`, dashed borders and anything that directly holds a field keep their boundary.
- **Restyled to tokens, Medium/Regular only, no bordered cards** (both frames, since the light tokens are today's values):
  - Add item (`pantry/new/page.tsx`): the 26px title, 15px Medium legends, the "filled from before" note on the accent tint, a quiet Retry, the sticky bar on `--cp-bottom-bar`, and the token shadow.
  - `shopping-run-ui`: the 26px title, rows in `K_ROWS`, ticks as RV-13's (accent, or the line fill), "Something new" as a tint pill, and the footer as the one helper line. **The header's "Tick what you bought · change what differs" is dropped**, because the main button already says "Tick what you bought".
  - `run-line-editor-ui`: borderless steppers and pantry choices on tints. The price field keeps an `input` border.
  - `receipt-scan-ui`: the camera screen in black and white with token accents; `AiChip` and `AI_EDGE` on accent → cook colour tokens (all green in dark). These are shared with Say it and the recipe photo, which keep the same look. The run's Scan a receipt button drops its sub-line.
  - `receipt-run-ui`: Matched · N / Check · N in sentence case, CHECK cards on the amber tint, Yes on ink, Change on the card. The name field keeps an `input` border.
  - `stock-check-ui`: the 26px title, mark chips on tints, Cookpool thinks / You say tiles, radio rows on the tint, and token shadows.

**Departures.**
- **The tints, the Chip/Segmented look and the main-button sizes apply only under `.cookpool-new`.** Today's frame renders them as before. The restyled pantry flows use the tokens in both frames.
- **Group tints come from the id only where the caller passes it.** Money (`money-ui.tsx`, frozen by owner decision 6), the join page, sign-in's group card, `PantryBadge` and the dish maker still pass only the name, so a group can show a different tint there until those owners add `id={…}` (a one-word change each).
- **The shopping run's section titles stay uppercase** ("FINISHED", "RUNNING LOW", "YOU USUALLY BUY"). They come from `shopping-run.ts`, and tests pin them; they are now 13px Medium muted.
- **Group detail and Community** are also drawn without a tab bar on their boards. They were outside this task's list and keep the bar.

**Pinned copy changed:** none. The dropped helper lines were not pinned.

**Tests.**
- `tests/web-console-next`: 126 suites, 2,469 tests, all passing.
  - New `kitchen-tabbar-shared.test.ts` (14): which screens hide the bar and which keep it (including `/pantry/new`, `/pantry/run`, a stock check, recipe forms, a group page, a plain dish and `?cooked=0`); today's frame never hides it; the layout renders by the rule with `data-tabbar` and a Suspense'd probe; the variables' values; the sticky bars' fallback; the card-border rule and its exclusions; group tints stable from the id, spread over six, drawn only under `.cookpool-new`, kept across a rename, with dark pairs; face tokens; MainButtonLabel's 17/500 and 12/400; Chip and Segmented's new look; no raw hex, no heavy weight and no `rgba(` in the six restyled files.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: every kitchen page static, 45 pages served as files.

**Browser check** (390 × 844, light and dark). `next dev` on 49190 ran behind RV-13's in-memory mock, copied and never committed, plus a restock route, on `cookpool-stage.localhost:49191`. The resource log listed only that host.
- `/groups` had no tab bar (`data-tabbar="hidden"`), with tinted tiles (blue and slate in the mock).
- On an item's page the bar was gone and `<main>` ended 24px from the bottom.
- `/pantry/run` kept the bar. Ticking Milk filled its tick with the accent and opened the borderless steppers, the bordered price field and the blue pantry pill, and the main button read "Add 1 · ₹68" in green (dark).
- Add item showed borderless chips on the muted fill with the picked chip on the tint, and fields with their boundary.
- The stock check showed tint chips and tiles in dark.
- `cookpool-prod.localhost`: Groups kept today's bar with + Add, green tiles and 104px end padding.
- Not opened: the receipt scan screens (the mock has no `/me/ai`, so Scan a receipt stays hidden). The recipe, session and Cooked screens were checked by the rule's tests.

**Deploy.** Only the console changes; there is no package or worker to redeploy. **Land before RV-15 and RV-16**, which can then move their bottom bars to `--cp-bottom-bar`.

### RV1 — You, Community and sign-in match the boards (RV-18)

**Built** (`apps/web-console-next` only; no route, contract, SDK, worker or migration). Spec: `RvYou`, `RvCommunity`, `RvSignIn` and the revamp audit's You, Community and Sign in sections, under the owner's decisions of 13 Nov (all functionality kept; Create account's name field kept).

- **You** (`you.ts`, `you-home-ui.tsx`, new frame):
  - A **Help** group, last: Help centre → `/login/help?next=%2Fyou`, Privacy and terms → `/login/help?next=%2Fyou#privacy`. This phone (Install) now sits before Help. Signed in, the help page's Back goes to `next` (`/you`), not to the sign-in page (`app/login/help/page.tsx`, read after mount).
  - **One name per row and page:** Connected apps (`ASSISTANTS_TITLE`, was "Connected assistants"), AI settings (`AI_SETTINGS_TITLE`, was "Cookpool AI"; You's group keeps "Cookpool AI"), Push notifications (`PUSH_TITLE`; the row was "Push"). `/you/notifications` is shared, so its title is `newFrame() ? PUSH_TITLE : NOTIFY_TITLE`; prod keeps "Notifications".
  - Sign out has 40 px under it (`pb-10`) on top of the layout's tab-bar room, so it clears the floating bar.
  - Name and handle (`MeCard`): Change your name and Cancel are the quiet tint in the new frame; prod keeps its outlined buttons. Try again buttons are quiet.
- **Settings pages:** `notify-ui` (card, `bg-input` track, `cp-card` knob, `cp-line` rows, no `text-white`, 400/500), `assistants-ui` (17 px headings, `K_ROWS`, the tab track from `rv-look`, quiet Disconnect on the expired tint, no raw hex), `connect-ui` (card, tokens, use-soon tint for the money note, quiet Cancel), `ai-settings-ui` (15 px card headings), `passkey-security-ui` (Google and email on tiles, no bordered circle), `community-setup-ui` (14 px Medium labels, not uppercase; the boards' 1.5 px `input` field line; Blocked people on the card).
- **Community:**
  - **Share a cook** (`community-share-cook.ts`, `community-share-cook-ui.tsx`): the board's one main button, floating 82 px above the screen bottom (above the tab bar) on a phone, sticky at the column's foot from 900 px, with its own room at the feed's end. It opens a sheet of your 5 latest postable cooks (`shareCookChoices`: cooked by you, not canceled, from `useMyDishes`); each opens the existing Share this cook? on its dish (`shareHref`, `?share=1`). With none: "Nothing cooked yet" and Cook something.
  - **One link per post** (`PostCardView`): the tile, dish, byline and numbers are one link to the post; Yum and the save stay beside it. The byline no longer links to the author (the post's page does).
  - Tabs with no ring (`SEG_ON`: the card in light, `border` grey in dark, as the board's `segOn`). The empty state has no dashed border. Section headings (`SectionLabel`) are 17 px Medium, not 12 px uppercase. The setup card's subline and every meta line are 400.
  - **Activity:** No is quiet text (`PLAIN_BUTTON`), Accept stays green; the title is `K_TITLE`; the push helper line is gone.
  - **Search:** the field is the card with its shadow (no 1.5 px ink border); the Follow/Following second button (`OUTLINE_BUTTON`) is now the quiet tint everywhere (search, profile, requests, blocked).
  - **Post `/p/[id]`:** no borders on the recipe line, comments, comment bar or menu items; caption, meta and comments at 400; "No comments yet" (was "… Say something nice.") and the "Hold a comment to report it" line is gone (⋯ still opens the same options).
  - **Profile `/u/[handle]`:** the name is the 26 px title; Share and Following are the quiet tint; menu items on `secondary`.
- **Sign in** (every frame):
  - **Terms** and **Privacy notice** are links to `/login/help#privacy` (keeping `next`, `termsHref`). The help page gained a **Privacy and terms** section (`PRIVACY_TITLE`, `PRIVACY_LINES`, and "Write to us with any question" when the console has a contact address, `privacyMailHref`).
  - Google and Passkey: the shadow only in light, no `ring-1`; a 1 px line in the new look's dark only (`CARD_EDGE`). The chosen tab has no ring.
  - The code step has one helper line ("No email after a minute?…"); `CODE_HINT` is no longer drawn ("Signing you in…" still shows while verifying).
  - Can't sign in?'s cards have no border; their buttons are the quiet tint.
  - **First paint:** confirmed real. next-themes' default (`defaultTheme="dark"`) put `class="dark"` and `color-scheme: dark` on `<html>` before the first paint on every page, so `/login` painted the admin console's dark ground (and before RV-14, the dark tokens' Gold where the new look's class was present) around its light card until it mounted. `app/providers.tsx` now forces next-themes to light on `/login` and `/login/*` (`isSignInPath`, `lib/sign-in-path.ts`); the inline script then writes `light`. Checked: the served script's args carry `"light"` as the forced theme on `/login` and `null` on `/home`.
  - **Flows unchanged:** no handler in `app/login/page.tsx` changed. Google, passkeys (options prefetched, no await before the ceremony), codes, join links, the safe `next`, stage's test code and the developer sign-in are as they were.
- `rv-look.ts` holds the dark-only classes (`CARD_EDGE`, `SEG_TRACK`, `SEG_ON`, `SEG_OFF`). Tailwind's `dark:` can't be used for them: it is the admin console's `.dark` class, which is on `<html>` everywhere else.

**Departures.**
- **Search's label stays "Search people"** (`SEARCH_LABEL`), not the board's "Search people and recipes": `/community/search` finds people only (name or @handle). Recipes are found in Explore.
- **Privacy and terms** is a section of `/login/help`, since there is no Terms or Privacy page. It says what the app keeps and that the full Terms and Privacy notice aren't published yet. The owner should supply real terms (follow-up).
- **Sign-in and security** keeps its single row ("Passkeys", or "Email" where passkeys don't run), named for what the page leads with; the page's title stays "Sign-in and security", which is the group's heading.
- **Fields keep a line:** the boards draw their fields with a 1.5 px field line (`RvSignIn`), so HandleSetup's fields take that (`border-input`) rather than going borderless.
- **The profile byline on a feed card no longer opens the author** (one link per post); the author is one tap away on the post.
- **Share a cook** is a sheet of your recent cooks, not a new composer: a post is always made from a dish (CM-6), so it reuses the dish page's Share this cook?.
- Voice cooking and Email digest (board rows) are still not drawn: no page of their own.

**Pinned copy and pins changed (each deliberate).**
- `kitchen-you.test.ts`: You's groups end with Help (Help centre, Privacy and terms); "Push" → "Push notifications"; the static-page check strips `?next`/`#privacy`.
- `kitchen-community-posts.test.ts`: the compact card has one link (to `/p/pst_1`, holding the title and byline) and no `/u/anucooks` link.
- `kitchen-community.test.ts`: Following is `bg-cp-accent-tint`, no longer `border-border`.
- `kitchen-revamp-you-sign-in.test.ts`: the terms sentence is checked as text with its two links to `/login/help#privacy`.
- Titles: "Connected assistants" → "Connected apps", "Cookpool AI" (the AI page's title) → "AI settings" (no test pinned them).
- Copy shortened: "No comments yet. Say something nice." → "No comments yet".

**Tests.**
- `tests/web-console-next`: 126 suites, 2,473 tests, all passing. New `kitchen-revamp-rv18.test.ts` (18): rows named as their pages, Help and its hrefs and the signed-in Back, Sign out's room and This phone before Help; `shareCookChoices` (yours, not canceled, newest, at most 5, `?share=1`), the floating button and its room; tabs with no ring, no dashed empty state, plain headings; the search label, Activity's quiet No and no helper; `termsHref`; the sign-in buttons' and tab's rings; one helper on the code step; Privacy and terms on Can't sign in? with no borders; `isSignInPath` and the forced theme; no raw hex, heavy weight, `text-white`/`bg-white` or uppercase in the six newly restyled files.
- The sign-in flow suites pass untouched: `kitchen-sign-in`, `kitchen-sign-in-screens`, `kitchen-passkeys`, `kitchen-passkey-tap`, `kitchen-passkey-device`, `join-code`, `safe-next`, `sign-in-session` (157 tests).
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 45 pages served as files.

**Browser check** (390 × 844, light and dark). `next dev` on 48830 behind RV-6's in-memory mock (copied, with your dishes added, never committed) on `cookpool-stage.localhost:48831`. The resource log listed only that origin and `cookpool-prod.localhost:48831`.
- `/login` in light and dark: `<html class="light">`, no ring on the tab or Google, the line on Google in dark, Terms and Privacy notice links. The code screen showed one helper line. `/login/help#privacy` showed Privacy and terms; from You's row its Back was `/you`.
- `/you` in both themes: Push notifications, Connected apps, AI settings, This phone, then Help; Sign out clear of the tab bar when scrolled to the end.
- `/community` in both themes: one link per card, the ringless tab, Share a cook floating above the tab bar; its sheet listed Dal tadka and Egg fried rice (not Anu's curry), and Dal tadka opened `/dishes/dsh_1?share=1`. `/you/assistants` and `/community/search` in dark.
- Today's frame (`cookpool-prod.localhost`) with a dark device: `/login` light, `<html class="light">`.

**Follow-ups.**
- The kitchen pages still get next-themes' `dark` class on `<html>` (the same first-paint cause); RV-19 or a later task could force light for the kitchen paths too.
- Share a cook uses RV-13's literal `82px` tab-bar offset; switch to RV-19's `--cp-tabbar-space` when it lands.
- Real Terms and Privacy pages, then point `termsHref` and You's row at them.

**Deploy.** Only the console changes; nothing to redeploy elsewhere.

### RV1 — Cookpool's recipes are replaced by 13 Kerala recipes (RV-20)

**What changed.** The owner's decision: the 42 recipes Cookpool provided are gone, and 13 Kerala recipes take their place. Cook now offers only what your kitchen can make.

**Migration `590_kitchen_no_starter_recipes`** (kitchen; one file, 65 KB, 56 statements, each under 50 KB; no LIKE or GLOB).
1. **Delete first, the app's way.** One `UPDATE kitchen_recipes SET deleted_at = now, updated_at = now WHERE (is_system = 1 OR owner_id = 'usr_cookpool') AND deleted_at IS NULL AND substr(id, 1, 8) <> 'c00c0590'`. It is the same soft delete as `deleteRecipe`. No row is hard-deleted, so lines, steps, dishes, posts, activity, step times and copies keep what they point at. Because it skips 590's own ids, running it again deletes nothing new.
2. **16 new food names** (`INSERT OR IGNORE`, so a name another food already has stays there). They are kaima rice, kaima ari, jeerakasala (rice), jeerakasala rice, vadi matta, vadi matta rice, kerala matta rice, red matta rice and kerala red rice → rice; thenga kothu, coconut slices, coconut slivers and coconut bits → coconut; malabar tamarind, fish tamarind and pot tamarind → kokum. Pantry items named exactly one of these words, still unlinked and never answered for, are linked to the food. **No new food was needed**: 360 already maps kudampuli → kokum, matta rice → rice and keema → mutton, and curry leaves, ghee, coconut and coconut oil are on the list.
3. **13 recipes.** Each is owned by `usr_cookpool` with `is_system = 1`, visibility groups and no link code. They have fixed ids `c00c0590-0000-4000-8000-0000000000NN` (01–13) and are inserted with `ON CONFLICT (id) DO NOTHING`. Each serves 4, has tools, and has a `created_at` one minute earlier than the one before it from 2026-11-13T00:59, so Explore lists them in the owner's order.
4. **Lines and steps.** For each recipe the migration deletes its lines and inserts them again with plain `INSERT`, then does the same for its steps. That is 390's pattern: re-runnable, and a row that fails a CHECK fails the migration instead of being skipped. Step keys are fixed, `c00c0590-<recipe>-<step>`.

| # | Name | Kind | Min | Lines | Steps (prep/cook) | Tools |
|---|---|---|---|---|---|---|
| 1 | Chicken curry (Kerala style) | dal_curry | 60 | 16 | 9 (2/7) | Kadai with a lid, Mortar and pestle |
| 2 | Chilli chicken | snack | 45 | 22 | 9 (3/6) | Kadai or wok, Mixing bowl, Slotted spoon |
| 3 | Chicken kondattam | snack | 60 | 19 | 8 (2/6) | Kadai, Mixing bowl, Slotted spoon |
| 4 | Chettinad chicken curry | dal_curry | 70 | 21 | 10 (2/8) | Heavy pan with a lid, Mixer jar |
| 5 | Chicken roast (Kerala) | dal_curry | 60 | 17 | 9 (2/7) | Kadai with a lid, Mortar and pestle |
| 6 | Beef roast (Kerala ularthiyathu) | dal_curry | 90 | 16 | 9 (2/7), 5 whistles | Pressure cooker, Heavy kadai, Mortar and pestle |
| 7 | Ghee rice with kaima curry | rice | 75 | 24 | 11 (2/9) | Heavy pan with a tight lid, Kadai, Sieve |
| 8 | Vadi matta rice | rice | 50 | 3 | 5 (1/4) | Large pot, Colander |
| 9 | Pork vindaloo | dal_curry | 90 | 16 | 8 (4/4), marinade is long prep | Heavy pan with a lid, Mixer jar, Mixing bowl |
| 10 | Chilli pork | snack | 75 | 17 | 9 (1/8), 3 whistles | Pressure cooker, Kadai or wok |
| 11 | Fish curry (Kerala, with kudampuli) | dal_curry | 45 | 15 | 7 (2/5) | Clay pot (manchatti) or heavy pan, Mortar and pestle |
| 12 | Fish fry (Kerala masala) | snack | 45 | 11 | 6 (3/3) | Flat pan (tawa), Mixing bowl |
| 13 | Beef fry (Kerala) | snack | 80 | 13 | 8 (2/6), 4 whistles | Pressure cooker, Heavy kadai |

**Recipe content.**
- **Amounts** are for 4, on each unit's rounding grid: g, tsp, tbsp, cup and pcs. Spoons and cups meet weighed packs through the foods' densities.
- **Steps** follow 390's rules: prep before cook, a flame on every cook step, a checkpoint or a time, hands-off steps timed or counted in whistles, and ranges of at least 30 s with the longest no more than three times the shortest. The words carry no amounts or times, and every line is used.

**Readers checked.** Each reader leaves deleted recipes out, or stands on its own words.
- **Explore** (`listRecipes` system / sharedBy / publicListed), **search** (`q`), the **person-page and profile lists** (listedBy), **My recipes** (ownerId) and **Cook now**: all filter `r.deleted_at IS NULL`.
- **One recipe**: `getRecipe` and `getRecipeByLinkCode` return the opaque 404, so the read, match, copy, cook-from-recipe and stove AI paths are all 404.
- **Posts**: a post's recipe link is `LEFT JOIN … deleted_at IS NULL`, so it reads as `recipe: null` and keeps its title. `linkOf` ignores a deleted recipe.
- **Activity**: recipe names use `recipeNames … deleted_at IS NULL`, so they read as none.
- **Profile counts** count only live, listed recipes. **"Saved by N"** counts live copies.
- **Dishes** keep their own `name` and `recipe_id`. The console's cooked screen and share sheet already treat a recipe that won't load as none.
- **Cook history** (`/me/dishes/recipes`) reads dishes, not recipes.
- **Step times** pool by recipe root through deleted rows too, as 370 designed.
- **MCP** `what_can_i_cook` and `recipe_search` go through the same routes.
- **Re-seeding**: nothing seeds the old recipes again. Only 360 and 390 wrote them, and the worker always writes `is_system = 0`.

**Cook now = makeable only.**
- `GET /v1/kitchen/me/cook-now` keeps its shape `{ recipes: CookNowEntry[] }`. It now returns only entries where `canMake(recipe, summary)` holds: no line missing (to-taste lines and Always have count as had) and enough stock for at least half a portion, `floor(servesHalf × maxFactorMilli / 1000) ≥ 1`.
- Every entry therefore has `match.missing = 0` and a `forPortionsHalf`. The order is unchanged (largest factor, then most recently cooked, then name), capped at 20, and the list may be empty. Cookpool's 13 are included when the kitchen can make them.
- This is the existing "Have all" rule (`missing === 0`, scaled to the stock), which Home's cards and the Cook tab's `cookNowHubRows` already apply. The Cook tab therefore gets the same filter without a console change.
- `canMake` is in `apps/kitchen-worker/src/recipes.ts`. The `CookNowResponse` comment in `contracts/src/kitchen-recipes.ts` is updated (comment only).

**Departures.**
- **Saved copies of old recipes stay.** A copy someone saved belongs to them (350: a copy is its own recipe, and its source's deletion never touches it). It keeps "from Cookpool" and can still be cooked, so it can appear in that person's Cook now.
- **Kinds.** The dry fries (chilli chicken, kondattam, chilli pork, fish fry, beef fry) are filed under `snack`, curries and roasts under `dal_curry`, and the rice dishes under `rice`. The breakfast, roti, sweet and drink chips now have no Cookpool recipe.
- **"Need yogurt" on Saved rows is no longer shown.** The Cook tab's Saved rows got that tag from Cook now entries with one line missing (`savedHubRows`), and Cook now no longer returns those entries, so Saved rows fall back to From, Cooked or Serves. Bringing it back would need an additive field; that is a follow-up.
- **Short lines still count as makeable.** A short line scales the recipe down to the stock ("for 2"), as "Have all" always has. Only a recipe that can't make half a portion is left out.
- **In-flight sessions.** A cook session started from an old recipe before 590 gets a 404 when it saves its dish, as for any deleted recipe.
- **No console change**, so no browser check was needed.

**Tests.**
- `tests/db`: 46 suites, 984 tests. New `kitchen-no-starter-recipes-migration.test.ts` (7) covers:
  - registration, and the text: delete first, softly, sparing 590's ids; no DROP, ALTER, LIKE or GLOB; no DELETE of recipes; OR IGNORE only for names; ON CONFLICT on the recipe row.
  - what is left live: the 13 in order, their shape and keys.
  - that all 42 old recipes are deleted with their rows kept, and that a person's recipe and a saved copy are untouched.
  - that a rerun changes nothing, and the new names and item links.
  - The 360 and 390 suites now read the database through 580, before 590 replaced those recipes.
- `tests/kitchen-worker`: 1,232 tests.
  - New `kerala-recipes.test.ts` (16) checks each of the 13 through the recipe read with 390's guided rules and 590's keys, the whistles, and that vindaloo is the only long prep. It also checks that a dish, its post, a saved copy and cook history of an old recipe keep working after 590's delete, while reading or cooking it is the 404.
  - `cookpool-recipes`: the seed checks (units and scaling at × 0.5 and × 2) now cover 360's and 590's rows. The router tests cover:
    - Explore lists only the 13; kind=rice and q=matta narrow it; poha, chai and rajma find nothing.
    - Vadi matta rice reads in full, nobody may edit it, and it can be copied; the old chai is 404.
    - Cook now offers only Vadi matta rice for a pantry with matta rice plus everything chai needs: `maxFactorMilli` 2,604, "for 8". With the rice density removed, it offers nothing.
  - `cookpool-guided` restores 360's rows in its world to check 390's content.
  - `guided-steps` reads a Kerala recipe for the Cookpool cases.
  - `recipe-match`'s Cook now tests are rewritten for the filter. Missing paneer or tea, and not enough for half a portion, are left out; a makeable Cookpool recipe is included. Twenty Always-have staples are capped at 20, and Explore still names three missing lines. Turmeric lifts dal into Cook now.
- `tests/contracts` 346 and `tests/mcp-worker` 97 pass. Typecheck and lint pass for kitchen-worker, contracts, db, db-tests and kitchen-worker-tests. kitchen-worker-tests shows only 12 existing warnings.

**Deploy.**
- kitchen-worker changes in its own path, so it redeploys.
- The migrations folder changes, so the `db-migrate` component (path `packages/db/src/migrations`) applies 590 to stage and then prod. The contract's `affects` gained `default/cookpool/db-migrate` for this.
- The console is unchanged.
- Deploy order: if 590 runs before the new worker, the old worker briefly suggests makeable-or-not recipes from the 13. That is harmless.

### RV1 — Money, groups and people match the boards (RV-17)

**Built** (`apps/web-console-next` only; no route, contract, SDK, worker or migration). Spec: the owner-approved boards `RvMoney`, `RvMoneyGroup`, `RvGroups`, `RvGroup`, and the revamp audit's Money, Groups, Group, People and settle sections (owner decision 6 lifted: the Money board is approved).

- **The one settle path (the choice).** Every Settle up in the new frame goes to `/money/settle?group=&to=[&back=]` — spliteco-worker's `POST /v1/spliteco/groups/{org}/settlements` with `bucket: "kitchen"` (`payKitchen`, the shared `SettleUp`: UPI with `upi://pay` then "I paid", cash or bank). Chosen because it is the path the Spliteco rules are written for (spliteco design §0.11; SE3): a Cookpool payment settles Kitchen only, never more than the Kitchen plan between the two, the payer confirms it, the payee is told (`spliteco.paid_you`) and can say "not received". kitchen-worker's `POST …/kitchen/settlements` (Record → UPI · Cash · Bank) also caps at Kitchen but is a compatibility route (SE3 departure); the new frame no longer calls it from Money, a person's page, a group's page or People. `settleHref` / `safeSettleBack` (`money-page.ts`) build the address; `back` is only Money, a person's or a group's page.
- **Money** (`money-ui.tsx`, board `RvMoney`, new frame only as before):
  - Header: the 26 px title, a Scan a bill button on the accent tint (only where Scan a receipt runs; opens Add a bill straight on the photo step, `AddBillSheet startScan`) and **+ Add a bill** (the main button; the shared form on spliteco-worker, as SE3).
  - **One net card**: the figure per currency, whole rupees where whole ("+₹62.50", "+₹52"), blue/orange/muted, and the **only Settle up** (tint), shown when any payment you can record is open. It opens a sheet: each payment that involves you, what you pay first — "You pay Dev ₹25 · Lunch club" with **Pay** (the settle path) or "Anu pays you ₹54" with **Remind**. `?settle=1` opens it.
  - **People**: three, then All / Less in place. One line, "Anu · owes you ₹54" / "Dev · you owe ₹25" / "Priya · square", the fact coloured; Pay goes straight to Settle up when you owe them in one group (else the sheet), Remind shares the note. A row opens the person's balance and why.
  - **Groups**: three (recent first), then All (`/groups`); "+₹87" / "−₹25" / "Square" from your view; a row opens that group's balance and why, `/money?group=org_…`.
  - **More in Spliteco**: one quiet row (the icon, "More in Spliteco", "Trips, insights, live split…", Open ↗); the same one-time handoff, now without a group (`next=/`).
  - Removed per owner decision 3: the per-kitchen chips. The Kitchen balance card and its Why moved one tap away (below).
- **A group's balance and why** (new `money-group-ui.tsx`, board `RvMoneyGroup`): `/money?group=org_…` (static; the Money page reads the query). Back to Money, the group tile, the 26 px name, "N people"; the balance card (spliteco-worker's Kitchen-only read, so what you see is what Settle up pays against) with Settle up (accent) opening who pays whom in place; **Why**: three rows, then See all / Show less — an icon by kind (bill, dish, use, waste, payment on the tint), title, one fact ("your portion · Yesterday"), the signed amount. A viewer sees "View only" and no Settle up.
- **A person's balance and why** (`profile-ui.tsx` `NewPerson`, same parts): Back, face, name, "In Flat 4B with you"; the balance per currency with Settle up listing each group (Pay / Remind); **Why** across shared groups, newest first, "Bill · Lunch club · Yesterday" (the group named only when you share several), undone lines struck through. Their Cooks / Recipes / Saved by and Recipes | Cooks stay below, restyled (no borders, 400/500). `/you/cooks`' chart labels are 400/500.
- **People** (`/people`) in the new frame leads to Money: `/people` → `/money?settle=1`, `/people?group=<slug>` → `/money?group=org_…` (Home, a dish, `/settle` and the leave guard still link it). Prod renders today's page unchanged (`TodayPeople`).
- **Group** (`group-detail-ui.tsx`, board `RvGroup`):
  - **Latest**: one line per row (`ActivityFeed variant="line"`): the face of who logged it, "Meera cooked Egg fried rice" / "Dev used Oil" / "You paid Gas cylinder" / "Spinach went to waste" / "Anu paid you · UPI", one coloured fact from your view ("+₹825", "−₹200"; the total muted when it isn't yours; "Undone" struck through). Undo and Flag are behind the row (a tap opens them); your own use or waste still swipes to Undo. **See all** sits beside the heading (controlled `expanded`); Load more stays under the rows once expanded.
  - **Money tab**: everyone from your view in the Kitchen plan — "+₹610" blue (they owe you), "−₹24" orange (you owe them), "Square" — three, then See all to the group's balance and why. The header pill ("+₹842", whole) opens the same.
  - **Pantry tab**: "Expired" alone in the expired colour.
  - **Dishes** (`dish-ui.tsx` `GroupDishesPanel`): borderless rows, 400/500, quiet buttons. Add's sticky bar is on `--cp-bottom-bar`.
- **Groups** (`groups/page.tsx`): unchanged layout (RV-5/RV-19), now "6 people · +₹842" in whole rupees.
- **Restyled to tokens**: group settings (17 px section titles, quiet Copy link / Share / Try again, Leave on the expired tint instead of a red outline, `cp-line` member rows; Segmented is RV-19's borderless one), the old add-bill page (quiet tint steppers, the token nav shadow, the sticky bar on `--cp-bottom-bar`), New group (the waste rule as one card of radio rows on the tint; the dialog line and the currency hint kept for screen readers only), Join with link (the "Dashes and spaces" hint screen-reader only), `/join/[code]` (26 px titles, 400/500, quiet Retry, the "You'll join as a member…" and "Nothing to do here" lines dropped, `GroupAvatar` given the group's id), `/money/settle` (quiet Back to Money; Back and Done go where it was opened). `ActivityFeed`'s card rows are capped at 500.

**Departures.**
- **"Got it" (recording that someone paid you) is not offered in the new frame.** Spliteco records only the payer's confirmation; a "pays you" row offers Remind. An owner or admin recording a payment between two others (People's group plan) is not in the new frame either. Both stay in prod's frame, and Home's "Paid" (RV-15's `inbox-ui`) still records through kitchen-worker — follow-up.
- **Method chips are on the settle screen, not inline in the sheet.** UPI must open the UPI app and wait for "I paid", which the shared `SettleUp` does; Cash and Bank there record in one tap. No Undo toast: a spliteco payment is reversed by the payee's "not received".
- **The settle sheet's amounts come from `/me/balances`** (kitchen-worker's per-group plan, Kitchen only); the settle screen pays spliteco-worker's plan amount. They are the same rows with the same simplify rule; if they ever differ, the screen's amount is the one paid.
- **The group's Why is a flat list with See all**, not This week / Earlier sections (the board's).
- **Group's "Expense" (Add) still opens the old add-bill page** (several payers, Exact, %, Shares; kitchen-worker, Kitchen) restyled, because Money's form is equal-split only. Scan stays on Money's Add a bill.
- **Group settings stay cards with headings**, not one sheet of rows; Join link has no on/off switch (there is no such setting).
- **Latest rows don't link** to a recipe or item (the transaction carries neither); the tap opens Undo / Flag. No long-press.
- **Money has no "Archived" groups** (no archive), as RV-5.

**Pinned copy and pins changed (each deliberate).**
- `kitchen-revamp-money-groups.test.ts`: Groups' meta "+₹87.00"/"−₹25.00" → "+₹87"/"−₹25"; the pill "+₹842.00" → "+₹842" (and "+₹24.50" stays decimal).
- `kitchen-money-spliteco.test.ts`: Money's order is NetCard, People, Groups, More in Spliteco (no `<KitchenMoney`); the Kitchen balance and its why are checked in `money-group-ui.tsx`.
- Words: People's "See all"/"Show less" → "All"/"Less"; a person row "Owes you ₹54.00" → "Anu · owes you ₹54"; "Settled" → "square"/"Square"; "Kitchen money" heading and "powered by Spliteco" are gone; Spliteco's four tiles became "Trips, insights, live split…"; "Open Spliteco" → "Open".

**Tests.**
- `tests/web-console-next`: 128 suites, 2,526 tests, all passing. New `kitchen-revamp-rv17.test.ts` (39): whole rupees; the net; People's facts; Groups from your view with Square; `settleHref`/`safeSettleBack` (refuses other hosts and pages); the sheet's rows (you pay first, viewers' groups left out); direct Pay; Remind; a person's and a group's Why; a person's settle rows; Latest titles and facts; Money-tab balances; the expired tone; and the sources — no raw hex, `rgba(` or weight above 500 in the 13 restyled files, no kitchen-worker Record in Money, the balance pages or the group page, one Settle up button on Money, scan, the settle screen's back, People's redirect, the group's line feed and bottom-bar variable.
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build` passes: 45 pages served as files.

**Browser check** (390 × 844, light and dark). `next dev` on 49370 behind RV-19's in-memory mock (copied, plus Spliteco kitchen reads, a person and a Kitchen payment; never committed) on `cookpool-stage.localhost:49371`. The network log listed only that host and `cookpool-prod.localhost:49371`.
- `/money` (light): "+₹62.50", Settle up, Meera/Anu with Remind and Dev with Pay, Flat 4B "+₹842", Goa trip "Square", the Spliteco row. The sheet listed "You pay Dev ₹25 · Lunch club" first with Pay to `/money/settle?…&back=%2Fmoney`, then two Reminds.
- `/money/settle`: Dev, ₹25.00, UPI / cash / bank; cash → "Recorded ₹25.00 to Dev" (one POST to spliteco-worker's settlements).
- `/money?group=<Flat 4B>` (dark): "+₹842" in light blue, Settle up in green, Dev ₹610 and Meera ₹232 with Remind, Why with three rows (pink −₹54) and See all.
- `/people/<Anu>` (dark): "+₹54", Settle up, Why "Paneer tikka · Dish · Yesterday".
- `/groups/flat-4b` (dark): one-line Latest with See all, Dishes borderless, Add above the tab bar; `?tab=money`: Dev +₹610, Meera +₹232, Anu Square.
- `/people?group=lunch-club` landed on `/money?group=<Lunch club>`. Today's frame (`cookpool-prod.localhost`): `/people` is today's page with Record buttons.
- Not opened: Scan a bill (the mock has no `/me/ai`), More in Spliteco's handoff.

**Follow-ups.**
- Home's "Paid" (RV-15) and the dish page's Settle up link (RV-16) still use kitchen-worker's Record or `/people?group=`; pointing them at `settleHref` makes the new frame's settle path single everywhere.
- RV-19's `back.ts` maps `/people/:subjectId`'s parent to `/money` already; `/money?group=` returns to `/money` by its own Back.

**Deploy.** Only the console changes; nothing to redeploy elsewhere.

### RV1 — Kitchen: title switcher, shared staples, shopping list (RV-21)

Built to the owner-approved boards `RvKitchenB` and `RvShopping`, with the owner's changes during the task (below).

**Migration 600 (`600_kitchen_staples`, context kitchen).** Additive. On stage and then prod it:
- creates `kitchen_staples`: `id` (UUID), `owner_kind` `user` | `group`, `owner_id` (a `usr_…`, or the group's UUID), `name` 1–60, `name_key` = lower(trim(name)), `food_key` (references `kitchen_foods`, nullable), `status` `ok` | `low` | `out`, `last_price_minor`, `currency`, `last_qty_milli`, `last_unit`, `want_qty_milli`, `want_unit`, `last_txn_id`, `bought_at`, `created_by/at`, `updated_by/at`; unique index on (owner_kind, owner_id, name_key);
- creates `kitchen_shopping_items`: `id`, `owner_kind`, `owner_id`, `name`, `name_key`, `qty_milli`, `unit`, `added_by`, `created_at`; unique index on (owner_kind, owner_id, name_key);
- copies every saved personal Always have list (`kitchen_always_have` joined to `kitchen_foods`) into `kitchen_staples` as `user` staples with the food's name, status ok, the row's `created_at`. It uses INSERT OR IGNORE on the unique index, so a rerun adds nothing twice. Ids are random v4 UUIDs made in SQL;
- changes, drops and deletes nothing. `kitchen_always_have` and `kitchen_always_have_lists` stay. No LIKE or GLOB.

**Personal Always have, decided.** The personal list now lives in staples:
- `getAlwaysHave` (Cook now, recipe matches) reads the person's `user` staples that link to a food.
- `PUT /me/always-have` replaces those rows. A same-named staple without a food takes the food. Staples without a food are left alone.
- The PUT still writes `kitchen_always_have` too, so a worker still on the old code reads the same list during a deploy. The FK refusal of an unknown food is kept the same way.
- Until a person first changes their list they read salt and water. The staples read shows these with ids derived from SHA-256(person, food), and every personal write first runs `seedPersonal`, which writes them under those ids (INSERT OR IGNORE) and marks the list saved.
- Behaviour kept: Cook now counts only your own staples; group staples don't count as there (follow-up if wanted).

**Routes** (kitchen-worker; api-edge's facade routes every `/v1/kitchen/…` and `/v1/organizations/{org}/kitchen/…` by prefix, so the edge needed no change; no new policy actions; contracts in `contracts/src/kitchen-staples.ts`, SDK section "Always have per pantry and the shopping list"):
- `GET /v1/kitchen/me/staples` → `{ pantries: StaplePantry[] }`: yours, then each group by name. `StaplePantry = { owner: {kind:"personal"} | {kind:"group",orgId,slug,name}, currency, splitAmong: usr_…[] (the group's current roster; [] for yours), staples: KitchenStaple[], isSet, items: ShoppingItem[] }`.
- `KitchenStaple = { id stp_…, name, foodKey, status, lastPriceMinor, currency, lastQtyMilli, lastUnit, wantQtyMilli, wantUnit, boughtAt, updatedBy, updatedAt }`; `ShoppingItem = { id shp_…, name, qtyMilli, unit, addedBy, createdAt }`.
- `POST /me/staples` `{ name, foodKey? }` → 201 `{ staple }` (without a foodKey the name is matched to the food list as items are); `PATCH /me/staples/{stp}` `{ status?, wantQtyMilli?, wantUnit? }` → `{ staple }`; `DELETE /me/staples/{stp}` → `{ staple }`; `POST /me/staples/{stp}/bought` `{ priceMinor ≥ 0, currency?, qtyMilli?, unit? }` → 200 `{ staple, txn: null }` (price and amount recorded, status ok, the list's amount cleared, nothing split).
- `POST /me/shopping` `{ name, qtyMilli?, unit? }` → 201 `{ item }`; `PATCH /me/shopping/{shp}` `{ qtyMilli, unit }`; `DELETE /me/shopping/{shp}` → `{ item }`; `POST /me/shopping/clear` `{ itemIds?, stapleIds? }` → `{ items, staples }`.
- The same under `/v1/organizations/{org}/kitchen/…`: `GET staples` (kitchen.pantry.read) → `StaplePantry`; `POST/PATCH/DELETE staples…`, `shopping…` and `shopping/clear` (kitchen.item.create: not a viewer).
- `POST …/staples/{stp}/bought` (kitchen.expense.create, Idempotency-Key) → 201 `{ staple, txn }`. It posts ONE plain `expense` (Kitchen bucket, title the staple's name) for `priceMinor > 0`, paid by the caller and split `equal` among the group's current roster with the engine's largest remainder. It goes through `repo.postTxn`, the path every Cookpool and Spliteco-era (SE3) bill takes. The staple's update (ok, price, amount, `last_txn_id`) rides in the same batch through a new optional `PostTxnInput.extra`. The same key replays without posting or updating again. The audit event is `kitchen.expense.added` with `stapleId`; everyone named gets the "logged for you" email, as an expense does.
- Clear (owner change): for when a shopping run is saved. In one batch it deletes the given hand-added lines and sets the given staples back to ok. Nothing is split, because the run records what was paid. Ids not in that pantry are skipped.
- Refusals use pinned codes only: the opaque 404 for a non-member, a viewer's write, or a staple or line not in that pantry; 409 `conflict` with `reason: already_listed`; 422 with field errors, or `currency_mismatch`.
- `contracts`: `shoppingLines(pantry)` is the one rule for a pantry's list. It gives the staples running low or out (asking `want…`, else `last…` amount, `source: "staple"`), then the hand-added lines (`source: "hand"`).

**Console** (new frame only; `newFrame()` false renders today's Pantry unchanged, checked on `cookpool-prod.localhost`):
- Title switcher: "Kitchen ▾" or "<pantry> ▾". The sheet "Pantries" lists All kitchens, Mine, then each group, each with "N items · N people", the use-soon dot and count, and the current one checked. The choice is kept in localStorage (`cookpool.kitchen.view`), and `?pantry=` still wins on arrival. All is Usual now, then each pantry: three rows, then "See all N", which switches to that pantry, then its Always have. A pantry is "Items · N" with all its rows, then its Always have. A pantry with no rows still shows its staples.
- Header: List with a count badge, linking to `/pantry/list` (staples low or out plus hand lines, every pantry), and **+ Groceries** (the shopping run).
- Say it in search: the ✦ inside the field toggles "Say what you used", tinted. Enter sends the sentence to AI-7's read (`/me/ai/uses`, unchanged) and **ticks** the rows it names with the unit and number said (`saidTicks`). The Log bar then logs them, as for any tick. No match gives a toast. The ✦ is hidden whenever Say it was hidden (no AI, switched off). The separate Say it box and its sheet are gone from the Kitchen.
- Rows: use soon was already first in each section. The line reads "Use by tomorrow" in amber or "Expired" in red. A 3 px stock bar sits under the name: the accent, amber under 1/5, the expired tint, at least 4 %, with screen-reader text. The Use soon strip and the filter chips are removed (audit decision 3). The Log bar now sits on RV-19's `--cp-bottom-bar`.
- Always have chips at the bottom of each pantry, with a dot: none, amber, or red. A tap opens a sheet with Running low · Out · **Got more**. Got more shows the price (last price in grey), then "₹60 each · You, Anu, Meera" and **Split ₹180 equally**, or for your own "Just you · no split" and **Add ₹320**. Every write is optimistic with an Undo toast: status Undo PATCHes it back; Got more Undo reverses the group's bill and restores the status; add and remove Undo each other. + Add opens a name field. "Remove from Always have" is in the chip's sheet. Viewers see the chips without editing.
- Finished this week (owner change): three rows, then See all. **Add to list** adds the name to its pantry's list, then reads "On the list", with Undo in the toast.
- `/pantry/list` (owner change: a plain list for now; RV-22 builds the design on these routes): it is grouped by pantry. Staples show the "Always have" tag, a dot, the amount and the last price; hand lines show who added them and the amount, with ✕. Each pantry has + Add, and **Done shopping** links to `/pantry/run`. It is a static page, new frame only (today's frame goes to `/pantry`), with no tab bar (RV-19's rule already covered it), Back to `/pantry`, and no pull to refresh.

**Departures.**
- The owner's copy: "+ Bought" is **+ Groceries**; the chip sheet says **Got more**; the list's button says **Done shopping**; Finished's "Bought again" is **Add to list**.
- `/pantry/list` is the plain list above, not the RvShopping board: no device ticks and no "Bought N items" prefilling the run. The run is not prefilled; RV-22 will build that and call `shopping/clear` when a run is saved.
- Buying a group staple through the shopping run stocks it as an item (split by use), as any run line. Only the chip's Got more splits it equally.
- Say it now ticks rows for you alone. The sheet's "Anu and I" consumers and its per-line costs are gone with the sheet.
- The Kitchen header drops the receipt camera; Scan a receipt stays at the top of the shopping run.
- The rows' column header (ITEM · LAST TIME | AMOUNT | ✓) and the footnote "Tick what you used, then Log once…" are gone, as on the board.
- Your own staple's Bought may be ₹0; a group's must cost something.
- The old Always have card (food-list search, ✕ chips) is no longer drawn on the new Kitchen. Its add now takes any name; a food is linked when the name matches.

**Pins changed.**
- `kitchen-picks.test.ts`: the Log bar's class is now `bottom-[calc(var(--cp-bottom-bar,…+76px))+6px)]`.
- `static-pages.test.ts`: 18 `_redirects` rules (the list is a fourth pin).
- `gestures.test.ts`: `/pantry/list` is in NO_PULL.

**Tests.**
- `tests/db`: 47 suites, 991 tests. New `kitchen-staples-migration.test.ts` (6) covers: registration, last in the manifest; additive text with no LIKE or GLOB; the copy and a rerun; the CHECKs and the unique name; seeding under fixed ids and Always have through staples; and a Bought's statement. Nothing else changed.
- `tests/kitchen-worker`: 61 suites, 1,241 tests. New `staples.test.ts` (9) covers:
  - the default list written on the first change, under the same ids;
  - Cook now's list being the same rows, plus the PUT;
  - duplicates, unknown foods and bad statuses refused; remove and 404s;
  - a personal Bought;
  - group authz: a viewer and an outsider get 404 on every write and read;
  - equal split: ₹100.01 among four is 2501/2500/2500/2500 and sums exactly; the payer paid all; an idempotent replay; a member who left drops out of the next split (₹180 → 6000 × 3);
  - refusals write nothing;
  - list lines with amounts;
  - clear.
- `tests/contracts`: 348 tests (new `kitchen-staples.test.ts`, 2).
- `tests/web-console-next`: 2,502 tests. New `kitchen-staples.test.ts` (15) covers the switcher, titles and kept views, the row line and stock bar, chips, status toasts, the Got more sheet for a group and for your own, the list count and rows, amounts, the tab bar on `/pantry/list`, and Say it ticks.
- Typecheck and lint pass for db, contracts, sdk, kitchen-worker and web-console-next. `console-artifact.mjs build` serves all 46 pages as files, with 18 `_redirects` rules.

**Browser check** (390 × 844, light and dark).
- Setup: `next dev` on 49830 behind an uncommitted in-memory mock on `cookpool-stage.localhost:49831` (the audit mock plus staples, restock, AI status and a sentence read). Every request was to that host.
- Kitchen on All: the pantry sections, the stock bars (Onions amber at 15 %, Curd expired tint), and chips with amber and red dots.
- The switcher picked Flat 4B: "Items · 6", kept in localStorage.
- Tea → Got more → "₹60 each · You, Anu Thomas, Meera" → Split ₹180 equally: the POST was 201, the dot cleared, the badge went 5 → 4, and the toast read "Tea ₹180 · ₹60 each" with Undo.
- ✦ with "2 eggs and some milk" + Enter ticked Eggs 2 and Milk 250 ml: "Log 2 items".
- In dark, black and green.
- `/pantry/list`: Mine and Flat 4B with tags, dots, amounts and Done shopping, and no tab bar.
- Finished this week's Add to list turned Butter into "On the list", and the badge went 4 → 5.
- `cookpool-prod.localhost/pantry` rendered today's Pantry.

**Deploy.**
- kitchen-worker, the console and the migrations folder (db-migrate) change in their own paths, so all three redeploy. The sdk, contracts and db change with them.
- **Order doesn't matter.** The pipeline runs db-migrate and kitchen-worker side by side, so the new worker can serve before 600 has run. It tolerates that:
  - Always have (Cook now, recipe matches, `GET/PUT /me/always-have`) falls back to the old `kitchen_always_have` list on D1's `no such table: kitchen_staples` (`isNoSuchTable`, `packages/db/src/d1/errors.ts`). The PUT kept writing that list, so nothing is lost; 600 then copies it in.
  - Until 600 runs, the staple and shopping routes answer the worker's existing 503 (`internal_error`, "Service unavailable").
  - Tests: `tests/db` 992 (a pre-600 database reads and writes Always have, refuses an unknown food, and has the list read from staples after 600) and `tests/kitchen-worker` 1,242 (the fallback through the router, and 503 on the new routes).
- api-edge is unchanged.

### RV1 — Home and the item page match the boards (RV-15)

**Built** (`apps/web-console-next`). **Console-only:** no route, no migration, no contracts, SDK or worker change. Spec: `HomeRevamp` (owner-approved 13 Nov), `RvItem`, the audit's Home and Item sections and owner decisions 1–2.

**Home** (new frame only; prod's `TodayHome` renders as before):
- **Order** (`NEW_HOME_SECTIONS`): greeting and balance pill · What did you use? · the cooking strip · Install · Needs you · Cook now · Your groups cooked.
- **The field stands alone** (`HomeUseField`): no usual chips, no Say it (decision 2). Prod's `QuickUse` keeps both.
- **Install card kept, restyled** (`InstallCard fresh`): borderless on the token shadow, 16/500 title, 13/400 line, Install on the tint, × 44 px.
- **Needs you** (`inbox-needs-ui.tsx`, rows in `inbox-needs-rows-ui.tsx` and `inbox-row-ui.tsx`, words in `inbox-needs.ts`). One card, every kind, in the board's order:
  1. asks you answer (`AskRow`: face, "Anu asks for Milk", "1 glass · ₹12 back to you", No · Allow, and the "Always let Anu use milk" switch under it);
  2. open dishes (the cook's face, "Meera cooked · ₹31 a portion"; I had some opens ½ 1 1½ 2, no 0 chip);
  3. Pay X ("₹25 you owe"; Paid opens UPI · Cash · Bank);
  4. food (Expired / Today / N days; the amount, or **Used** once past its date; swipe and hold kept);
  5. splits (your assigned dish: "Split your Dal tadka · Who had how much · ₹180" → Set portions; your open group dish → Finalize; split reminders → Split and ×);
  6. your own asks that wait (`AsksResponse.mine`: "Asked Meera for saffron · 1 pinch · waiting · 24 h left" → Cancel);
  7. flags ("Dev flagged Groceries · “Charged twice” · ₹420" → Open).
  - A pick, payment, use or answer dims the row in place ("You had 1 · ₹31.20", "Paid ₹25 · UPI", "Used · 100 g", "Allowed · Anu owes you ₹12", "Said no · Anu was told") with an Undo pill; the toast's Undo also puts the row back. Rows stay until you leave Home.
  - "Needs you · N" counts what is left, "· all done" once all are done; three rows, then See all (the push's `?ask=` row is always shown). **With no rows the section is gone.** Whole rupees drop ".00".
- **Cook now**: RV-20's makeable recipes, tagged "Have all · 30 min"; hidden when there are none.
- **Your groups cooked**: "Anu · you had 1 · ₹54", what you paid (your `amounts[].owedMinor`).

**Item page** (new frame):
- Subtitle "Flat 4B · Meera paid ₹68" (`itemSubtitle`), state appended once finished.
- Ring card: 88 px ring, "1 L of 2 L" and "₹34 left", the use-by after it in its colour.
- Use row (`quickPicks`): ½ · your usual on the accent · 2×, then More (the full picker in the Use sheet). Twice the usual becomes The rest at what is left. In ask-first items the same taps ask.
- "Runs out Sun" (`RunOutEstimate.short`); the rate is read to screen readers.
- Who had it: a face and an amount. History: a face first (`historyFace`), the money on the line under, no ₹ column.
- Actions: **Got more** · Finish it · **Wasted at once** with the ten-second Undo (no WasteConfirm on the page). Fix how much is left and Cook with it are quiet secondary links under them.
- Measures and note also holds the per-unit price ("₹3.40 per 100 ml"), moved out of the ring card.
- Restyled to tokens, 400/500 weights: `ask-ui.tsx` (status line, wait box, Ask button on `bg-foreground`, Who can use it), `amount-picker-ui.tsx`, `item-actions-ui.tsx` (WasteConfirm, the held-item sheet), Move to a group's buttons.
- Today's sticky Use some bar moved to `bottom-[var(--cp-bottom-bar,…)]`.

**Departures.**
- **Cancel on your own ask has no Undo.** A cancelled ask cannot be reopened, so the row dims to "Cancelled · Meera was told" with no pill.
- **The ask's "Always let" switch stays** as a line under the ask row (the board leaves it out; decision 1 keeps it).
- **Pay's Undo pill needed the toast's handle.** I added an optional `onUndoable` to `useRecordPayment` in `settle-card.tsx` (RV-17's file); nothing else there changed.
- **"Got more" toast**: `boughtAgainTitle` now reads "Got more Milk · ₹68". It is shared with the Kitchen's restock rows, which now read the same.
- **The old To do's revamped branches were removed** from `inbox-ui.tsx`; today's To do is unchanged.
- The held-item sheet's Wasted keeps its confirm. Only the item page acts at once.

**Pinned copy changed:** `boughtAgainTitle` "Bought Milk · ₹68" → "Got more Milk · ₹68" (`kitchen-item-page.test.ts`, `kitchen-restock.test.ts`, 4 pins).

**Tests.** `tests/web-console-next`: 128 suites, 2,518 tests, all passing. New `kitchen-revamp-rv15.test.ts` (31) covers:
- Home's order, and no usuals or Say it in the field;
- every Needs you kind's words and the board's order;
- the count, and what each row says once done;
- ask rows, answers and your own asks;
- Cook now's minutes, and what you paid;
- the item subtitle, ring lines, the use row, Runs out and history faces;
- the actions;
- no raw hex and no weight over 500 in ten files;
- the bar variable.

Typecheck and lint pass for both packages. `console-artifact.mjs build`: every kitchen page static, 45 pages served as files.

**Browser check** (390 × 844, light and dark). `next dev` on 47150 ran behind an uncommitted in-memory mock on `cookpool-stage.localhost:47151`. The resource log listed only that origin (and `cookpool-prod.localhost:47151`).
- Needs you showed all seven kinds in order.
- Picking 1 portion, Paid → UPI, Used and Allow each dimmed their row with Undo, and the count went 7 → 3.
- Cancel dimmed your ask. Undo on Pay cleared its dimmed row; the mock has no reversal route, so the payment stayed recorded there.
- With an empty inbox and no makeable recipes, Needs you and Cook now were gone.
- Item page in dark: the use row, the ring with its amber use-by, faces in Who had it and History. A tap logged 1 glass and Wasted marked it wasted at once, each with the Undo toast.
- `cookpool-prod.localhost`: Home kept the money card, usual chips and To do.
- The Install card was not seen: it shows only from the device's second day.

**Follow-ups.**
- **One settle path (from RV-17):** Needs you's Paid should open `settleHref(orgId, toSubjectId)` (`money-page.ts`, `/money/settle?group=&to=`) instead of recording through kitchen-worker, keeping the row's look. `settleHref` was not on main when this finished. `safeSettleBack` does not allow `/home` as `back`, so it will go without one unless RV-17 adds it.
- **Deploy:** console only; nothing to redeploy.

### RV1 — The cook flow matches the boards (RV-16)

**Built** (`apps/web-console-next`; boards `RvCook`, `RvRecipe`, `RvCookStart`, `RvCookPrep`, `RvCookStep`, `RvCookWait`, `RvCookDone`, `RvCookLines`, `RvCookFinish`, `RvCooked`). **Console-only:** no route, no migration, no contracts, SDK or worker change. The recipe page, the session (guided and tick) and Cooked show only in the new frame; the dish page, the plan, Explore, the form and the share sheets show in both, on tokens whose light values are today's.

- **Recipe** (`recipe-views.tsx`, `guided-views.tsx`): Steps are one card of rows (`K_ROWS`), each number 26 px on the tint and the words 15 px Regular; the flame, range, Prep/Hands off, checkpoint, learned badge and tip stay as quiet lines under it. Open, the heading is "Steps · N" (muted count) with **The plan** as a tint pill and no fold chevron; a recipe's link (`/r/<code>`) keeps the fold. The " · main" suffix is gone. Long prep is a borderless use-soon card ("Long prep first", Soak now on the use-soon colour, Already done quiet on the card). Start cooking sits on `--cp-bottom-bar`. Save as recipe, Try again and Cook (not found) are quiet tint buttons.
- **Prompt** (`GuidePromptView`, `RvCookStart`): Back to recipe, the name at 30 px, "8 steps · about 54 min" (`promptLine`), the hands-on/waiting bar (8 px), long prep when there is some; at the foot the screen line, **Step by step** (60 px, the one main button; "After: Soak …" under it while long prep waits) and **Just tick what I use**, then Discard.
- **Before you start** (`GuidePrepView`, `RvCookPrep`): Back and the name; "Before you start" at 26 px, a 4 px bar and "6 of 10"; **Gather · 1 of 6** (RV-11's tick rows), **Tools** and **Prep** as cards of rows with the 48 × 44 tick at the end (line fill, the accent when ticked); hands-off prep keeps Start N min on the cook strip; **Start step 1** / "Back to step 3" / "Finish" (new `PrepScreenView.startLabel`, `title`, `gather`).
- **Step** (`GuideStepView`, `RvCookStep`): "Medium · 5–7 min" (`HEAT_WORDS`; "· Stay close" dropped). The timer chip reads **Done · again** when it ends (it sets the timer again); +1 min only while it runs or is paused. **One hint** (`timerHint`): the push note, else Turn on notifications, else what cooks learned; the tip shows only when none of those does. **Back is off on step 1.**
- **Waiting** (`GuideWaitView`, `RvCookWait`): the name in the header ("STEP 6 OF 8 · HANDS OFF" is screen-reader text), "Low · hands off", the step at 28 px and its check line; a timer card with the time left at 64 px, "of 20:00", a thin bar and Pause/Resume, +1 min and Done early as tint pills; Meanwhile rows are whole buttons with the mark at the end; Keep the screen on as a switch card and "We'll ping you when it's done" as one muted line; one hint.
- **Done** (`GuideDoneView`, `RvCookDone`): Back to the steps (⌄ Minimize kept at the end), ✓ on the tint, the name at 30 px ("is done" for a screen reader), "37 min · 8 steps" (new `DoneScreenView.name`, `line`); How each step went as rows (number on the tint, name, the usual under it, the time in its colour), three then See all; **Remember times** (Use today's times); "Your times help other cooks, never with your name"; Discard; Finish with "₹140.78 · yours" under it.
- **Tick session** (`SessionHeader` in `cook-session-ui.tsx`, `RvCookLines`): Back (it minimizes), the name at 22 px (or the blank session's name field), "For about 2 · 1 of 6 in · 0:14" (the clock moved into that line), and a **Steps** tint pill: back to step by step when the recipe has guided steps (`chooseMode(…, "guided")`), else it opens and scrolls to the Steps checklist. Discard's buttons are quiet; Finish sits on `--cp-bottom-bar`.
- **A missing line keeps its box and tick** (`cook-tick-ui.tsx`, `cook-session.ts` `tickable`): it ticks (it went in, from outside your kitchens) and counts in "N of M in", but `includedLines` still leaves it out of the dish, so it is never charged. This reverses RV-11's departure, as the audit asks.
- **Finish sheet** (`cooked-finish-sheet.tsx`, `RvCookFinish`): the sheet on the ground with a 5 px handle, "Finish" at 22 px, one card holding Servings (− and + 44 px on the tint, 20 px number) and the save switch row, "Split the servings after", and Finish with its sub.
- **Cooked** (`cooked-ui.tsx`, `RvCooked`): the last button always reads **Done** (`cookedDoneLabel`); the group-items note is gone; the **Posted** row has **Undo** (it deletes the post with `useDeletePost`, whose own toast can put it back, and clears the remembered post), wired from the dish page (`onUnpost`).
- **Cook tab** (`cook-hub-views.tsx`, `cook-hub-ui.tsx`): Community is its own quiet card row (`HubCommunityLink`) without the helper sentence; From a photo is a card row (no gradient border); Try again is quiet. The parts other screens render from this file (Home's CookNowStrip, YourRecipes, PersonRecipesView, SaveCopyChip, FeedRecipeRowView, Segmented) take the tokens and Medium/Regular only.
- **Token pass, no raw hex, no heavy weights, no bordered cards or outline buttons:** `plan-views.tsx` (Start on the accent, numbers on the tint, hands-off on the line fill, the bar on `--cp-bottom-bar`), `step-editor-ui.tsx` (chips on the tint/muted, the preview a light card rather than the dark hero, the textarea keeps its input border), `recipe-form-ui.tsx` (steppers on the tint, quiet Add, the bar on `--cp-bottom-bar`), `explore-views.tsx` (kind chips on the tint, cards with the shadow, the empty state undashed), `community-share-ui.tsx` and `recipe-share-views.tsx` (radio rows on the tint with an inset ring, Copy on the accent, quiet Not now), `recipe-link-views.tsx`, `recipe-photo-ui.tsx` (quiet buttons), the dish page (26 px title, Regular meta, the bar on `--cp-bottom-bar`) and `dish-ui.tsx`'s dish-page parts only (PortionStepper on the muted fill and tint, WhoHadSomeList and DishMoney borderless, `cp-purple` for "by"). `GroupDishesPanel` and `DishChipPill` are left to RV-17.
- **Settle up on a finalized group dish** follows RV-17's one settle path (merged from main): someone who ate goes to `settleHref(orgId, cook, "/groups/<slug>")`; the cook goes to the group's Money tab (else `/money`). It was `/people?group=`, which now redirects.
- **Height:** the guided screens, the session and Cooked fill the phone where the tab bar is hidden (`min-h` uses `--cp-tabbar-space`, falling back to today's 8 rem).

**Departures**
- **Prompt:** the "Cook it step by step" card, its stats tiles, the Hands on / Waiting legend, the Before you start list and the scale chip are gone (the board has none of them; the bar keeps its words for a screen reader, and Before you start lists the prep and tools itself).
- **Before you start:** Tools stay tickable rows (the board draws them as one muted line), so ticking a tool still counts in "N of M".
- **Waiting:** Done early stays as a third pill beside Pause and +1 min (the board has only two); the timer card shows "Done" rather than "0:00 · Again" when it ends.
- **Done:** the hands-on and cost tiles fold away (the cost is under Finish); the per-row bars are gone; Use today's times' sub is screen-reader text.
- **Tick session:** the scale chip ("×0.45", linking to the recipe) is gone from the header; Back returns where you came from. The elapsed clock moved into the sub line.
- **Cooked:** the **Split** row still has no Undo: there is no route to unsplit a dish, and RV-16 is console-only. A server route would be a follow-up.
- **Is this the same food?** (`FoodAskCard` in `always-have-views.tsx`) still uses raw hex: that file is RV-21's. Restyle it there.
- **The recipe page's own step rows keep "Medium flame"** (the guided chip says "Medium").
- The wait screen was not reached in the browser (the mock's simmer ran as a done step); it is covered by the tests.

**Pinned copy and pins changed** (`tests/web-console-next`)
- `kitchen-cook-session.test.ts`: the missing yogurt now ticks and counts ("0 of 5 in" → "0 of 6 in", "1 of 5" → "1 of 6", "2 of 5" → "2 of 6"; the bar "Cooking · 12 min · 1 of 6 in"); its row keeps a tick (no dashed, disabled tick); `tickable: true`, and a ticked missing line is still not in `includedLines`.
- `kitchen-cook-tick.test.ts`: "0 of 6 in", 33 % and 17 %; new: the ticked yogurt reads "₹138 so far · 3 in" (counted, not charged).
- `kitchen-cook-guided.test.ts`: the prompt (Back to recipe, `promptLine`, "Step by step", no "Cook it step by step" or BEFORE YOU START, no hex or semibold); prep ("0 of 10", `gather`, `startLabel` "Start step 1", "h-11 w-12", Back, no GATHER caps); the step ("Medium · 5–7 min", no "Medium flame", the tip hidden behind the learned line, Back off on step 1); the yogurt chip `tickable: true`; Meanwhile counts `aria-label="Do it: …"` rows; Done (the sr-only "is done", "37 min · 8 steps", "Cooked in 37:00", See all 8, Remember times, Back to the steps, no cook strip).
- `kitchen-cooked.test.ts`: `cookedDoneLabel` is "Done" before anything is done ("Not now · done" removed).
- `kitchen-recipe-page.test.ts`: no " · main"; "Steps <muted>· 2</muted>".
- `kitchen-guided-recipe.test.ts`: "Steps <muted>· 8</muted>", no `aria-expanded` when open, rows card, no hex/heavy; long prep ">Long prep first<" and `bg-cp-soon-tint`; the plan's hands-off number on `bg-cp-line`.
- `kitchen-recipes-travel.test.ts`: the chosen kind chip on `bg-cp-accent-tint`; `text-cp-soon` / `text-cp-accent-text` for the match; the switch card on the tint; Saved on the tint.
- `kitchen-recipe-share.test.ts`: the chosen radio on the tint with an inset ring; Copy on `bg-primary`.

**Tests.** `tests/web-console-next`: 129 suites, 2,541 tests, all passing (after merging RV-17 and RV-21 from main). Typecheck and lint pass for `@saas/web-console-next` and `@saas/web-console-next-tests`. `console-artifact.mjs build` passes: 45 pages served as files.

**Browser check** (375 × 812, light and dark). `next dev` on 47961 behind RV-11's in-memory mock (copied, never committed, with RV-20's Kerala names: Chicken curry (Kerala style), Chilli chicken, Vadi matta rice, Fish fry (Kerala masala), Pork vindaloo …) on `cookpool-stage.localhost:47962`; every request went to that host.
- Cook: the lists, then New recipe · Explore, and Community as one row.
- Chicken curry (Kerala style) at about 2: "Have 5 of 6", dot rows, Steps · 10 as one card with The plan; Start cooking at the screen's foot.
- The prompt, Before you start (Gather · 0 of 6; ticking the missing yogurt turned it green and read "1 of 10"), step 1 with Back off, step 2's "Start 7:00" → "7:00 · Pause" with only the push note under it, Done with three rows and See all 8, the Finish sheet, then Cooked in dark: Done, Post → "Posted to Community · Undo" → Undo sent `DELETE /me/posts/…` and brought Post back.
- Just tick what I use (dark): Back, the name, "For about 2 · 0 of 6 in · 0:08", Steps; ticking Chicken read "1 of 6 in" and "₹126 so far · 1 in"; Steps opened Before you start.
- The plan, Explore and the dish page in light.

**Follow-ups**
- An unsplit route, for Cooked's Split Undo.
- `FoodAskCard`'s tokens (RV-21).

**Deploy.** Only the console changes; there is no package or worker to redeploy.

### RV1 — Shopping list and shopping run (RV-22)

Built to the owner-approved boards `RvShopping` and `RvShoppingRun`, on RV-21's routes. No migration.

**Server (additive).**
- `POST /v1/kitchen/me/purchases` takes an optional `paidBy` (`CreatePurchaseRequest.paidBy`, a `usr_…`): the run's group lines are paid by that person, who must be in every group the run adds to (422 `not_in_group` with `details.subjectIds`; a bad id is 422 on `paidBy`). Personal lines stay the caller's; a line paid by someone else never copies "Ask me first". The purchase stays the caller's (`createdBy`), so the caller's Undo still works. Left out, nothing changes.
- `POST /v1/organizations/{org}/kitchen/staples/{stp}/bought` takes an optional `paidBy` (`StapleBoughtRequest.paidBy`): the equal-split expense is paid by that current member (422 `not_in_group` otherwise). Your own staple's Bought refuses it (422 on `paidBy`).
- SDK: `kitchen.buy(lines, opts, paidBy?)`.

**Console** (new frame only; with `newFrame()` false `/pantry/list` and `/pantry/run` still send you to `/pantry`, checked on `cookpool-prod.localhost`):
- `/pantry/list` (`shopping-list-ui.tsx`, model `shopping-list.ts`, writes `shopping-list-data.ts`): "Shopping list · N", **Add what we need…** with up to three suggestions: names bought before (`items/history`, with pantry, last amount and when), then foods (`/v1/kitchen/foods`, to Mine), and a new name offered to Mine and each group you add to. Enter adds the first. Each pantry with lines: the title (a group's "· split equally"), "2 of 3 got", and rows on the shared `TickRow`: the name; "Always have" with a Low/Out dot, or who added it; the amount box with the saved amount in grey and a unit picker of its family (g/kg, ml/L, pcs/dozen, pack); and one tick for got it. Ticks live on this device (localStorage `cookpool.shopping.got`, keyed by pantry, source and name). A line added while anything is ticked comes in ticked ("Ginger · Flat 4B · got it", with Undo). An amount is saved on the line on blur or on a unit pick: a hand line through `PATCH …/shopping/{shp}`, a staple through `PATCH …/staples/{stp}` `{ wantQtyMilli, wantUnit }`. A viewer's rows show their amount with no box and no tick. **Done shopping · N items** (with what was got under it) opens `/pantry/run?from=list`.
- `/pantry/run?from=list` (`list-run-ui.tsx`, model `list-run.ts`, writes `list-run-data.ts`). Plain `/pantry/run` is still the old run (`ShoppingRun`), unchanged, for + Groceries and `?scan=1`. It has "Shopping run · N" and rows by where they go: Mine, "<group> · split equally" (a group's staple), "<group> · by use" (an item). Each row has an amount box with a unit picker and a ₹ box (last price in grey; the total counts it). A tap on the name opens where it goes: a staple's own Always have ("Flat 4B · equally", or Mine for yours), then Mine and each group "· by use". **+ Add something else** adds one piece to Mine under "Not on the list", removable.
- **Scan the receipt** shows only where Scan a receipt shows (AI available, switch on), and uses AI-8's read and its capture, reading and problem screens. The receipt's lines match list rows by food key, name, or the row's words in the line ("Tea" in "Tata Tea Gold"). Matched rows get ✓ and the receipt's price on the tint, unmatched list rows say "not on receipt", and the other food lines become "Also on the receipt · N" (removable, in the read's pantry, with categories from AI-8's lookup). Non-food lines are left out. The card reads "DMart · today 6:40 pm", "3 matched · 2 added · ₹1,093" and Retake, then "GST ₹42 · Delivery ₹30 · −₹50 off" and ONE question, **Include in item costs?** Yes/No (Yes to start). Yes spreads taxes, charges, discounts and round-off over the receipt's own priced lines by price (AI-14's `spreadAdjustment`). The boxes keep the printed prices.
- **Paid by**: You plus whoever is in every group the run pays into (from each pantry's `splitAmong`). It shows only when there is a choice.
- **Add to kitchen · ₹1,093** saves and goes back, with the toast "Added 7 items · ₹1,093" and Undo:
  - every item row (by use, Mine, a staple moved to another pantry, receipt and added rows) goes in ONE `POST /me/purchases` (the old run's write path), with `paidBy` when someone else paid. Categories come from the restock read or the food list, else "other";
  - each staple kept in a group's Always have goes through `…/staples/{stp}/bought` (one expense, split equally, `paidBy` when someone else paid). **This fixes RV-21's departure**: buying a group staple in the run no longer adds it split by use. Your own staple kept in Mine records its price through `/me/staples/{stp}/bought`;
  - then each home pantry gets `shopping/clear` with the hand lines and staples the run saved. If the purchase is refused, only the staples that went in are cleared. The saved rows' device ticks are dropped.
  - A group staple with no price is refused on screen ("Tea needs a price · it's split equally"), as is an amount that isn't one.
- **Undo** reverses what it can: the purchase's unused items (`DELETE /me/purchases/{pur}`), each group staple's bill (`reverseTxn`), each staple back to Low or Out, each hand line added back with its amount, and the ticks put back.
- Tab bar: hidden on `/pantry/list` (already) and on `/pantry/run?from=list` (a new `tabBarHidden` rule). Plain `/pantry/run` keeps it. Both new bottom bars sit on `--cp-bottom-bar`.
- `tick-row-ui.tsx` gains two optional props only: `onAmountBlur` and `chipsEnd`.

**Departures.**
- Removing a hand line moved from RV-21's ✕ into the unit chips, as "Take off the list", with Undo. The board draws no remove.
- Order is the read's (Mine, then each group), not the board's sample order.
- Food suggestions without a past buy go to the first pantry (Mine); past buys go to their own pantry; a new name is offered to every pantry.
- The bar stays up while a toast shows (the toast lifts above it); the board hides it.
- Undo limits:
  - your own staple's recorded price and "bought at" stay;
  - a re-added hand line is a new line added by you;
  - a purchase item someone used meanwhile stays, with the old run's warning.
- Non-food receipt lines are left out silently (the old run's "Show" is not here).

**Pins changed.** `kitchen-staples.test.ts` (RV-21): the list's main button is now `href={LIST_RUN_HREF}` with `{bar.title}`, where it was `href="/pantry/run"` / `title="Done shopping"`.

**Tests.**
- `tests/kitchen-worker`: 60 suites, 1,244 tests (+2). `purchases.test.ts` covers Paid by on group lines only, a personal line staying the caller's, the caller's Undo, a payer outside one group (422 `not_in_group`, nothing written) and a bad id. `staples.test.ts` covers Bought paid by a member, an outsider refused, and your own refusing `paidBy`.
- `tests/web-console-next`: 130 suites, 2,558 tests. The new `kitchen-shopping-list-run.test.ts` (17) covers:
  - list groups, dots and who added;
  - viewers;
  - the amount box, units and save-only-a-change;
  - tick keys and labels;
  - Done shopping;
  - suggestions;
  - tab bar rules;
  - no Bought wording;
  - run rows and sections, destination choices and moving a row;
  - price and amount problems;
  - the save mapping: staples through Bought, the rest in one purchase, clears per pantry, Undo's restore list and ticks;
  - Paid by choices and where `paidBy` goes;
  - receipt matching, extras and non-food;
  - the one adjustment question (spread over receipt lines only; No leaves it out);
  - + Add something else;
  - the run page switch.
- `tests/contracts`: 348.
- Typecheck and lint pass for contracts, sdk, kitchen-worker and web-console-next and their test packages. `console-artifact.mjs build` serves all 46 pages as files, with 18 `_redirects` rules.

**Browser check** (390 × 844, light and dark).
- Setup: `next dev` on 49861 behind an uncommitted in-memory mock on `cookpool-stage.localhost:49862` (RV-21's mock plus history, foods, shopping PATCH and clear, purchases and a receipt read). Every request went to that host.
- The list: ticks turned rows green and "3 of 3 got". Typing 500 for Tea sent the PATCH `{ wantQtyMilli: 500000, wantUnit: "g" }`. "gin" suggested "Ginger · 100 g · Flat 4B · Sat" and "Gin" to Mine and to Flat 4B. Adding Ginger brought it in ticked, and the toast read "Ginger · Flat 4B · got it".
- Done shopping · 5 items opened the run with no tab bar. The scan filled Tea ₹175, Oil ₹198 and Onions ₹38 with ✓, marked Coffee and Ginger "not on receipt", and added Atta and Paneer.
- Paid by Anu → Add to kitchen sent: one purchase with `paidBy`; Oil and Tea Bought with `paidBy`, split equally; Coffee's price recorded; both pantries cleared. Undo reversed the purchase and both bills, PATCHed the three staples back and re-added Onions.
- A first pass spread the receipt's taxes over Coffee too, which wasn't on the receipt. It is fixed and pinned.
- In dark, black and green. `cookpool-prod.localhost/pantry/run?from=list` went to today's Pantry.

**Deploy.** kitchen-worker and the console change in their own paths, so both redeploy. contracts and sdk change with them. Order doesn't matter: an old worker ignores `paidBy`, and the bill would then be the caller's.

### RV1 — Shared frame, Money, Groups, Community and sign-in polish (RV-23)

Closes the "TASK RV-23" gaps of the 13 Nov re-audit (`RV-audit2.md`). Console and `packages/spliteco-ui` only: no routes, no migrations, no server change.

**Frame and tokens.**
- Gutter and top: in the new frame `<main>` is 18 px at the sides and 18 px under the safe area on top, kept in `--cp-gutter: 18px`. Today's frame keeps 16/20.
- Tab icons (`icons.ts`, `nav.ts`): the boards' own glyphs, made with lucide's `createLucideIcon` so they take the same props. Kitchen is `KitchenJar`, Money `MoneyCard` (the striped card), You `PlainPerson`. They appear in the tab bar and the sidebar.
- `SEG_TRACK` (`rv-look.ts`) is `cp-card` (`#141414`) in dark. A group's section tabs now use `SEG_TRACK`/`SEG_ON`/`SEG_OFF`, so the chosen tab is `#333` on `#141414`.
- `globals.css` tokens:
  - `--cp-soon-tint`: `#FFF3D6` light, `#2E2405` dark.
  - New `--cp-expired-bar`: `#EBB0A9` light, `#7F2A2A` dark. Use it as `hsl(var(--cp-expired-bar))` (RV-24's stock bar).
  - New `--cp-box`, the amount box's edge: `#E4DED4` light, `#262626` dark.
  - New `--cp-face-me-ink`.
- Your face in dark is `#22C55E` with black initials. `--cp-face-me` changed. One globals.css rule, `.cookpool [style*="var(--cp-face-me)"]`, gives your face `--cp-face-me-ink`, so every face component (faces-ui, set-row, ask-ui, community) follows without being edited.
- Group badges (`GroupAvatar`, kit.tsx): in dark, every tint is the neutral `cp-line` with ink words. In light, the warm tint is the owe tint (`cp-owe-tint`/`cp-owe`), not use-soon's amber. The tint's name stays `amber`, so `data-tint` pins hold.
- Weights go to 500 in `sidebar.tsx`, `group-picker.tsx` and `ledger-ui.tsx`. The global cap already rendered them at 500, so nothing looks different in either frame.
- The offline banner (`gestures-ui.tsx`) is `bg-foreground text-background`.

**Money.**
- The Settle up sheet:
  - a title row whose 44 px × is the sheet's own close, moved into the row (muted, radius 14);
  - no handle, padding 18/18/28, a 12 px gap;
  - 64 px rows with a face and one line.
- `PayRow` lost its `group` line (the group stays in Pay's spoken name) and takes a `className`.
- The Why icon tile is `cp-line`: `#F0ECE5` light, `#262626` dark.
- `spliteco-ui/why.ts`: "split 4", not "split 4 ways". This shows in Spliteco's web app too, through the shared package.
- `bill-scan-ui.tsx`: the three outline buttons are quiet tint.

**Groups.**
- The placeholder (new frame) is "Search groups or people".
- `filterGroups(groups, query, members?)` matches a group's name together with its people's names. `groupMemberNames(people)` builds that map from `myBalances().people`.
- Try again is quiet.
- The waste hint is "Whoever added it pays for what goes to waste."

**A group.**
- `latestFact` gives `{ text, tone: "owed" | "owe" | "waste" | "settled" }`:
  - "+₹92" back;
  - "₹38 you" (owe) for your share;
  - "₹8 you" (red, `waste`) for waste;
  - a payment, muted, the money that moved: "₹500";
  - a dish you weren't in: "₹31 a portion", the smallest share owed;
  - anything else that doesn't name you: its total, muted.
- `latestTitle`: someone using your item reads "Dev used your oil". "Yours" means you are its payer split; a title starting with one capital is lowercased.
- `groupPill` reads "Square" at zero.
- Latest's See all shows only when there is more than three. `ActivityFeed` has a new `onHasMore` prop.
- `GroupDishesPanel` has a new optional `heading`. With it, the panel draws the heading with See all / Show less beside it, and each row leads with the cook's face. Today's group page doesn't pass it and is unchanged.
- Activity's Try again and the group page's outline buttons (load error, Try again, Settle up) are quiet.

**You.** In the new frame, Try again and the name buttons are ghost on the quiet tint. Sign out is the expired tint with no outline. Today's frame keeps its outlines.

**Community.**
- Everyone's heading is "Popular today", with See all → `/explore` beside both tabs' headings.
- The numbers read "12 likes" (comments only above 0). The heart's label is "Like …" / "Liked …".
- The tile is the board's plate glyph (aria-hidden), not an initial.
- The Share a cook sheet:
  - a 17 px title in a 44 px row;
  - radius 26;
  - a `cp-line` handle.
- The floating button sits at `calc(var(--cp-tabbar-space, today's 76 px) + 6px)`, the same 82 px as before while the bar shows.

**Sign in.**
- The Sign in tab's hero is "Good to see you again." whether or not an account is remembered. A join link still names the group; Create account keeps the pitch.
- The footer reads "By continuing you agree to the Terms and Privacy.", with the links in ink at 500 and underlined only on hover.
- The "or" rule is `cp-line` in dark.
- No flow changed: Google, passkeys, codes, join links and `next` all run as before, and their suites pass.

**Departures.**
- The amount box's `#262626` edge is a token only (`--cp-box`). The box lives in `tick-row-ui.tsx` (RV-24's), which should use `border-[hsl(var(--cp-box))]`.
- `cp-expired-bar` is a CSS variable, not a Tailwind colour: `tailwind.config` isn't in this task's files. Use `bg-[hsl(var(--cp-expired-bar))]`.
- "Popular today" is copy only. The Everyone feed's order is still the server's, newest first.
- Yum stays Yum outside the compact card: the post page's button, Activity ("said Yum to …") and the notification setting. Those are other files.
- The old frame's Add sheet still says "Bought" (`nav.ts` `KITCHEN_ADD_ACTIONS`). It is prod-only and must render as it does today.
- Payment titles keep the full name ("Dev Patel paid you · UPI"); the board writes "Dev paid you". That is `activity.ts`'s `settlementTitle`, not in this task.
- Full-bleed strips in other tasks' files still use `-mx-4`/`px-4`, so in the new frame they stop 2 px short of the edge. Moving them to `-mx-[var(--cp-gutter)]` fixes it.

**Pins changed** (each where the design shortened or changed the words):
- `kitchen-revamp-money-groups.test.ts`: the pill at zero is "Square" (was "Settled").
- `kitchen-revamp-rv17.test.ts`:
  - "₹38 you" (was "−₹38");
  - a payment to you is "₹500" muted (was "+₹500" owed);
  - added "₹8 you" waste, "₹31 a portion" and "Dev used your oil".
- `kitchen-community-posts.test.ts`:
  - "likes" for "yums";
  - "Popular today" for "New from everyone";
  - the heart's label "Liked Chicken curry".
- `kitchen-revamp-you-sign-in.test.ts`: "…the Terms and Privacy." and the "Privacy" link (was "…and the Privacy notice.").
- `kitchen-sign-in-screens.test.ts`: the hero is the welcome back without a remembered account too.
- `kitchen-revamp-rv18.test.ts`: Share a cook's offset uses `--cp-tabbar-space`.
- `kitchen-tabbar-shared.test.ts`: the Segmented is `font-medium` in both frames (was `[.cookpool-new_&]:font-medium`).
- `spliteco-ui.test.tsx`: "you paid · split 3".

**Tests.**
- `tests/web-console-next`: 131 suites, 2,589 tests, all passing. The sign-in suites are among them (`kitchen-sign-in*`, `kitchen-revamp-you-sign-in`, `kitchen-revamp-rv18`).
- `tests/spliteco-ui`: 16. `tests/spliteco-web`: 23 suites, 307 (after merging main at 8a72f86). `tests/identity-worker`: 21 suites, 314 (unchanged code; run for sign-in).
- Typecheck and lint pass for `@saas/web-console-next` and `@saas/spliteco-ui`.
- `console-artifact.mjs build` passes: every page is static.
- `orun task check RV-23 --base origin/main`: affects ok, 4 components. The contract gained `default/cookpool/spliteco-ui-tests` for the "split 3" pin.

**Browser check** (390 × 844, light and dark).
- Setup: `next dev` on 47423 behind RV-17's in-memory mock, copied and never committed, on `cookpool-stage.localhost:47424`. The copy added a dish you weren't in, a dish with your share, waste, and a feed post in today's `FeedResponse` shape. The resource log listed only that host, and `cookpool-prod.localhost:47424` for the old-frame check.
- `/login`: "Good to see you again." with no remembered account; "By continuing you agree to the Terms and Privacy."
- `/money` (light):
  - jar, card and person tab icons and the 18 px edge;
  - Settle up opened the sheet with its title row and 44 px ×, no handle, and rows of 64 px.
- `/groups/flat-4b` (dark):
  - the track is `rgb(20,20,20)`, and your face is green with black "You";
  - Latest read "₹31 a portion", "₹38 you" (pink), "₹8 you" (red); See all added "+₹825", "Dev used your oil +₹92", "₹200 you" and "₹500" muted;
  - Dishes had See all beside its heading and the cooks' faces.
- `/groups` (dark): the placeholder "Search groups or people". "dev" found Lunch club by its member. The badges are neutral grey.
- `/community?tab=discover` (light):
  - "Popular today" with See all;
  - the plate tile and "450 g · 48 min · 12 likes";
  - the Share a cook sheet with its 17 px title and line handle.
- `cookpool-prod.localhost/groups/flat-4b`: today's group view with a 16 px gutter.

**Deploy.** Console only. `packages/spliteco-ui` changes "split N" for spliteco-web too, but spliteco-web has no change of its own in this PR, so it picks the wording up on its next deploy (see "orun plan skips dependents"). RV-24 and RV-25 consume `--cp-expired-bar` and may consume `--cp-box`.
