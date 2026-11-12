# spliteco-calm (SL) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SL0 — the spec | ✅ shipped | #146 (4f33619) |
| SL1 — the calm foundation | ✅ shipped | this PR (SL-2) |
| SL2 — Home, Groups, Activity | planned | |
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
