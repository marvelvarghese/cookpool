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
