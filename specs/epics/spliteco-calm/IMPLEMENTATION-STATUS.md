# spliteco-calm (SL) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SL0 — the spec | ✅ shipped | #146 (4f33619) |
| SL1 — the calm foundation | ✅ shipped | #149 (0f1e695) |
| SL2 — Home, Groups, Activity | ✅ shipped | this PR (SL-3) |
| SL3 — Group and expense | ✅ shipped | this PR (SL-4) |
| SL4 — Add and Itemized | ✅ shipped | this PR (SL-5) |
| SL5 — Settle | planned | |
| SL6 — close-out | planned | |

## SL1 as built (SL-2)

- **Surfaces:** `globals.css` — borderless radius-22 cards, weights up to 600, sizes 26/16/13/11, `.tabbar` and `.add-fab`; inline weights above 600 removed across the app (a test pins it).
- **Tab bar:** `TabBar` in `components/ui.tsx` (logic in `lib/tabs.ts`); `position` is a fractional tab index written to `--tab`, so SL2's pager can drive the pill. `BottomNav` is gone.
- **Gestures:** `lib/gestures/gestures.ts` and `row-gestures.ts` copied from Cookpool (source named in the header), `rules.ts` adds the pager, reveal-or-fire row swipe, hold, sheet drag, edge back and slider rules; React helpers in `components/gestures/` (`usePager`, `SwipeRow`, `useHold`, `useSheetDrag`, `useEdgeBack`, `Slider`). `Sheet` drags down to close; `Screen` with `nav={false}` gets edge back.
- **Sign in** matches `V2SignIn`; the email code, passkey and Google start are unchanged.

### Departures

- **Edge back runs only in the installed iOS app**, as in Cookpool; in Safari and on Android the system back gesture is left alone (risk SL-E).
- **The pager turns at 35 % of the width** (Cookpool's tab-swipe number), not 40 %.
- **Pull to refresh** is not in SL1; it lands with the pages that use it (SL2).

## SL2 as built (SL-3)

- **One tab surface:** `components/tab-surface.tsx`. `/`, `/groups` and `/activity` each render `<TabSurface tab={n} />`; it opens on the address's tab (`lib/home.ts` `pagerIndexOf`), pages with `usePager`, drives `TabBar({position, dragging, onTab})` so the pill follows the finger, and writes the settled tab back with `history.replaceState` (`pagerPath`; Groups' Friends is `?tab=friends`). Tapping Home, Groups or Activity turns the pager (`onTab`); You is a link. Back from a pushed screen lands on the right tab. The three pages' data loads once in the surface; a neighbour shown during a drag is lifted to the viewport's top; the first placement is instant (no slide on a deep link).
- **Home** (`components/tabs/home-tab.tsx`): mark + face, "You get back / You owe", the 52 px signed net, ↑ owed ↓ owe, three people (face, name, Cookpool dot, signed amount) then "See all N" (Groups → Friends), Scan · Live · Insights. A person swipes left to **Settle** (cobalt; `settleHref`: the one group you pay them in, else `/settle`) or **Remind** (saffron); holding opens a sheet with Settle · Remind · Open.
- **Remind with a real Undo:** `lib/delayed.ts` `DelayedSends` holds the send `UNDO_MS` (4 s) while the toast shows "Reminded Meera · Undo"; Undo cancels before any request. Leaving the page sends what is waiting. The server keeps the 24-hour rule; a refusal replaces the toast ("You reminded Meera in the last 24 hours", "… doesn't owe you anything now").
- **Groups** (`tabs/groups-tab.tsx`): search, Join and New group as icons; a compact Groups · Friends segment; one line per group or friend with tile, name, Cookpool dot, signed net; "● from Cookpool" legend. The explanatory paragraph and per-group plan lines are gone.
- **Activity** (`tabs/activity-tab.tsx`): under Today / Yesterday / date (`byDay`), one line per change: face, `activityWhat`, "· Claude" (`viaName`), `activityAmount` (signed; payments and no-change rows plain). The full sentence is the row's accessible label.
- **Pull to refresh:** `components/gestures/pull.ts` `usePull` (touch only, `pullRule`, `pullDistance`, threshold 64 px, holds at 56 px), re-reads all three, then "Up to date". The twin: the surface re-reads on `visibilitychange`.
- **Shared changes:** `useLoad().reload()` now returns a promise and a failed re-read keeps the data shown; `Sheet` renders through a portal on `document.body` so the moving pager never carries it.

### Departures

- **Activity's All / Payments / Cookpool filters are gone** — V2Home has none; the Cookpool face and plain payment amounts carry the distinction.
- **Remind's 24-hour rule is checked by the server after the Undo window** (Home's data has no last-reminded time); a refusal shows as a second toast. Reminders sent in this session are remembered locally and refused at once.
- **The Cookpool dot on a person** is inferred from the groups' plans (a kitchen whose plan names them), falling back to a shared kitchen's name when no plan does.
- **Settled groups** read "settled" rather than ₹0, behind "Show N settled".


- **Remind can still be refused** with "nothing owed" for someone whose net balance says they owe you: the server reminds by the simplified plan (SE2), where they may pay someone else. The app shows the server's reason; aligning Home's Remind with the plan is a follow-up.

## SL3 as built (SL-4)

- **Group** (`app/group/page.tsx`, rules in `lib/group-view.ts`): back ← with share and ⋯ icons; tile, name (26/500), faces, the signed net; a Cookpool kitchen keeps its Kitchen · Other line under the head. **Bills · Balances** is a segment whose knob follows `usePager`'s fractional `position`; tapping a segment turns the pager.
- **Bills:** `billMonths` headers ("November"; another year says its year); one row per bill: category tile, title (ellipsis), `billMeta` "Dev paid · ₹4,960", `billShare` signed (+ lent, − borrowed, "not involved" dim). Tapping opens `/expense`.
- **Delete with a real Undo:** a bill swipes left to a red trash action (`SwipeRow actionTone="red"`; reveal, or fire past 40 % / a flick). `BillDeletes` (on `DelayedSends`) hides the row at once (it collapses) and sends `deleteExpense` only after `UNDO_MS` while the "Deleted · Undo" toast shows; Undo cancels before any request; leaving the page (`pagehide`/unmount) flushes. A refusal brings the row back and toasts "Not deleted · <reason>" (`errorText`, e.g. `owned_by_cookpool`). Only `billWritable` bills (Spliteco's, not a payment, you can write) offer the swipe.
- **Hold (480 ms):** a sheet with the bill's icon, title, total and `holdTiles`: Edit (`/add?edit=`) · Move (`/move?id=`) · Comment (`/expense?id=…&comment=1`, which focuses the comment box); Cookpool's rows, payments and viewers get Open · Comment.
- **Balances:** `planTitle` ("Fewest payments" / "Pair by pair") and one row per payment of the group plan, From → To with the amount in saffron, largest first; your own payment links to Settle for that person; a payment to you keeps the compact Remind. Then "Settle up" → `/settle?group=`.
- **One main action:** the centred cobalt "+ Add" pill (`.add-pill`) → `/add?group=`; the old FAB, Settle/Totals buttons and the header Invite pill are gone from the page.
- **Edge back:** every pushed screen (Group, Expense, Move, Add, Settle, Insights, Share, Scan, Live) renders `Screen nav={false}` (a test pins it). `usePager({ leaveEdge: true })` ignores touches that start within `EDGE_PX` (20 px) of the left edge (`pagerHearsStart`), so Group's pager never takes the edge swipe; the tab surface is unchanged.
- **Expense, lightly:** your share is one line ("You borrowed · Meera paid", `−₹3,600`), the Cookpool note is "From Cookpool · change it there", the delete sheet says "Restorable for 30 days."
- **Pull to refresh** on Group (`usePull`), and it re-reads on `visibilitychange`.

### Departures

- **Invite, Totals and Simplify debts live in the ⋯ sheet** (tiles plus the switch); the board has only share in the header.
- **Balances keeps a compact Remind** on a payment someone owes you, and your own payment row opens Settle for that person — the board shows plain rows.
- **The Delete action is the trash icon alone** (labelled for screen readers), as on the board; there is no mouse swipe — the twin is the bill page's Delete.
- **A settled net reads "settled"** rather than ₹0 in the Group head.

## SL4 as built (SL-5)

- **Add, keypad first** (`components/add/add-sheet.tsx`, rules in `lib/add-split.ts`): grabber, ✕ · group chip (the existing picker) · scan; the 46 px amount (saffron when set) is a button that selects it; "What for?"; a "<face> You paid" chip (the existing Who paid view, several payers included: "2 people paid") and a details chip (category · date · note in a sheet). Add drags down to close (`useSheetDrag`) — ✕ is the twin.
- **Method strip:** six pills (Equally · Exact ₹ · Percent · Shares · + / − · Itemized), the chosen one centred; it swipes (`listenForDrags`, one pill per 112 px or one on a flick, `stripRelease`) and every pill taps. One line under it (`METHOD_LINES`).
- **One row per person (§4)** from `rowsOf`: face, name, what the share comes to, then the control — Equally a ✓ toggle (out rows dim, "out"); Exact ₹ a ₹ field; Percent a % field with its ₹; Shares − n + that repeat on hold (`components/gestures/repeat.ts` `useRepeat`, 400 ms then every 140 ms; Enter/Space step once); + / − a signed field (teal +, coral −) with the result. The list scrolls inside the card; the keypad and Save stay put.
- **Footer** from `footerOf`: "4 of 4 in · ₹600 each", "₹1,200 of ₹2,400 · ₹1,200 left / ₹200 over / Adds up ✓", "80% of 100% · 20% left", "5 shares · ₹480 a share", "₹575 each, then ± · Someone is below ₹0"; green when it adds up, coral when not; "Type the amount" with no amount.
- **One keypad** (`keypadKeys`, `pressKey`, `typeInto`): 1–9, ".", 0, ⌫; "." is "±" while a + / − field is selected. It types into the amount or the selected person's field (cobalt ring and caret); two decimals at most, one point, a lone 0 replaced, 7 whole digits (3 for %). Choosing Exact, Percent or + / − selects the first person (`selectionFor`). The fields are buttons (focusable, labelled, no OS keyboard); the hardware keyboard types into the selected field (`keyFromKeyboard`: digits, "." ",", Backspace/Delete, + − as ±), and Tab/focus selects a field. The keypad keeps focus on the field (mousedown is not a focus).
- **Save** (`saveLabel`): "Save" when `buildRequest` is ok; otherwise the amount first ("Type the amount"), then the footer's verdict ("₹400 left", "20% left", "Someone is below ₹0", "Pick someone"), then "Say what it was for", then whatever else the engine refuses (who paid). Edit (`/add?edit=`) loads into the same screen. The keypad writes the same text fields the old per-row inputs did, so every method sends the same request (a test pins it per method).
- **Itemized** (`components/add/itemized.tsx`): header with the title (editable) and bill total; dots (current saffron, coral = not fully assigned); one card per item on `usePager` (`leaveEdge`); the card shows qty × unit (`qtyLine`), name, total, the faces on it with their share and a badge when not one portion (`faceBadge`: ¼ ½ 2 % ₹), and a dashed + that opens **Who had it?** (grid of the group to toggle, Everyone, Same as last item). Tapping or holding a face opens its sheet: Portions / % / ₹ (chips ¼ ½ 1 2 3 and 10–100 %; ₹ − / + by ₹10, repeating on hold) and Remove from item. The card's ⋯ opens the item sheet (name, qty, each, total; Everyone · Split evenly · Reset · Remove item); "+ Item", "Adjustments" (tax, service, discount in a sheet) and Live sit under the deck. Bottom: each person's total (`personTotals`) and Save ("Save" / "N items left to assign").
- Scan → `/add?from=scan&method=items` still opens Itemized with the draft; Live still opens from Itemized.

### Departures

- **The old Split screen is gone** (`split-view.tsx`): the strip and rows on Add replace it. Leaving Itemized keeps the items, unused (the old "Change ▾" that cleared them is gone); the bill total becomes the amount.
- **Category, date and note** moved into a Details sheet behind a chip next to Who paid — V2Add has none of them.
- **+ / −:** "±" on an empty field leaves a lone "−" waiting for digits; `split-form.ts` now reads a lone sign as 0 (it was an invalid value) — no valid request changes.
- **Hold on a face** is touch/pen only (as every hold); a mouse taps, which opens the same sheet.
- **Shares** stop at 99 a person.
- **Who had it?** has no search; the grid scrolls in the sheet for large groups.

