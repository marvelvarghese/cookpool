# spliteco-calm (SL) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SL0 — the spec | ✅ shipped | #146 (4f33619) |
| SL1 — the calm foundation | ✅ shipped | #149 (0f1e695) |
| SL2 — Home, Groups, Activity | ✅ shipped | this PR (SL-3) |
| SL3 — Group and expense | planned | |
| SL4 — Add and Itemized | planned | |
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
