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
