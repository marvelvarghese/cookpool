# cookpool-app (PW) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| PW0 — the spec | landing | PW-1 |
| PW1 — an app on your home screen | | |
| PW2 — no signal, clean updates | | |
| PW3 — notifications | | |
| PW4 — gestures | | |

## Departures from the design

### PW1 — worth installing (PW-2)

- **The card's second line is "Open it like an app"** (design §2), not the canvas's "Full screen · works offline": nothing works offline until PW-4.
- **No rubber-band only in the installed app.** `overscroll-behavior: none` on `html, body` applies under `display-mode: standalone` (and fullscreen, minimal-ui). In a browser tab the browser keeps its own pull-to-refresh, which installed iPhone apps lose and PW4 replaces.
- **The first iPhone step follows Safari's version.** Safari 26 moved Share into the ··· menu of its compact tab bar, so there step 1 reads "Tap ··· then Share"; earlier Safari and the other iOS browsers read "Tap Share". An app's own web view (Instagram, Facebook) gets no card.
- **Hidden for 30 days by more than ✕.** Dismissing Android's prompt, or "Got it" on the iPhone steps, also hides the card for 30 days. Chrome offers a new prompt on the next page load, and Safari cannot tell us it was added, so either would bring the card back the next day otherwise. You keeps "Install the app" any time.
- **A browser with no prompt says what it can do.** You's row reads "Install it from your browser's menu." on Chromium before it offers its prompt and on Android browsers without one, and "This browser can't install Cookpool." elsewhere (Firefox or Safari on a computer). Home shows no card for either.
- **The browser's own install banner never shows.** The root layout's inline script (`src/lib/app-shell.ts`) takes `beforeinstallprompt` on every page, before React mounts, so the one invitation is Home's card. The same script keeps a focused text field above the keyboard (the shared helper for the keyboard rule).
- **The first day is the first day Home opens** on the device (Home is the start page). It is stored per device in localStorage, kept on sign-out, and the first browser session never shows the card even past midnight.
- **Shortcut icons are the + Add tiles'.** They use the same lucide icons in the same tint colours (Used, Bought, Cooked). Each is one 96 px PNG declared `any maskable`, drawn full-bleed with the glyph inside the safe zone.
- **Splash screens are committed, not built.** `scripts/gen-icons.mjs` draws them from the icon on `#F6F7F4`, like the icons since CP-23. There are eleven, one for every iPhone screen on a current iOS: SE 2nd/3rd gen, XR/11, XS/11 Pro/12–13 mini, XS Max/11 Pro Max, 12–14 and 16e, 12–13 Pro Max/14 Plus, 14 Pro–16, 14 Pro Max–16 Plus, 16 Pro/17/17 Pro, Air, and 16–17 Pro Max. They are palette PNGs, about 99 KB for all eleven, and an iPhone fetches only its own. iPads are left out because they need both orientations and many sizes.
- **Sheets close with ✕, "Got it" or a tap outside.** Dragging one down was not trivial with the Radix sheet and is PW4's.
- **The app-like basics land here**, not in PW-3: no tap highlight, `touch-action: manipulation` on controls, no selection or link callout on buttons and tabs, `100dvh` for `100vh`, and the keyboard helper. Back controls stay PW-3's.
