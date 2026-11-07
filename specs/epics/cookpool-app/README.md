# Epic: cookpool-app (PW)

**Cookpool already installs: it has a manifest, icons, and opens without the browser's bars. But installed, it is worse than in the browser. Nothing invites you to install it. It shows nothing without signal. A new version arrives unannounced. And on an iPhone an installed web app loses Safari's swipe-back and pull-to-refresh, so there is no way back except the buttons we drew. This epic makes the home-screen app the best way to use Cookpool: an invitation to install that fits each phone, the screens you last saw when there is no signal, clean updates, notifications for what needs you, and the gestures a phone app has (pull to refresh, swipe back, drag a sheet away, swipe a row, press and hold). Every gesture has a visible twin, and nothing that moves money happens on a swipe alone.**

It is for the same people: flatmates on phones, mostly iPhones and mid-range Androids, often in a kitchen with one hand free.

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped 2026-11-08 |
| Cluster | **PW** (PW0–PW4) |
| Owner(s) | `apps/web-console-next`: the manifest, the service worker, the install card, the notification settings, the gestures. `apps/notifications-worker`, `packages/db` and `apps/kitchen-worker` for push (PW3). |
| Builds on | `cookpool-kitchen` (CP-23: manifest, icons, standalone) and `cookpool-simpler` (SM-2 static pages, SM-5 instant writes, the simpler screens) |
| Changes | The app invites you to install it once, in the way your phone allows. Installed, it opens on Home without browser chrome, with a back control on every screen. With no signal it shows what you last saw and holds writes back, saying why. A new version offers "Reload" and never interrupts a write. Lists pull to refresh. Swiping from the left edge goes back on iPhone. Sheets drag away. A pantry row swipes to "use my usual". Your own log swipes to Undo. Steppers repeat while held. Notifications tell you when someone set your portion, a dish is ready to claim, or you were paid. The icon shows your to-do count. |
| Decisions locked | (1) **Standalone, not fullscreen**: no browser bars, but the phone's status bar stays, and iPhones ignore "fullscreen" anyway. (2) **Every gesture has a visible twin**, and gestures only make things faster. (3) **No money on a swipe**: Paid, Finalize, Leave and delete stay buttons; swipes only do things that Undo takes back. (4) **No swiping between tabs**: it fights the row swipes, the back swipe and the carousels. (5) **Offline is read-only**: no queued writes, because two phones logging the same milk offline cannot both be right. (6) **Data cached on the phone is per account** and cleared on sign-out. (7) **No haptics**: iPhones give web apps no vibration. (8) **Gestures come after the simpler screens** (SM-10, SM-11, SM-14), so they are built once. (9) **A PWA, not store apps** (owner, 2026-11-05: users are on both iPhone and Android). Invite links open straight into the app. Store apps that wrap the same code (Capacitor) stay a later option, only if people ask. (10) **Notifications are in**, before gestures. |
| Design | Claude Design canvas, row "On your home screen": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`AppInstall`, `AppOffline`, `AppNotify`, `AppGestures`) |
| Gate | PW1 is the day it is worth installing. PW3 is the day it calls you back. PW4 is the day it feels like an app. |
| Shipped as | PW0 #45 · PW1 #50 #55 · PW2 #48 · PW3 #52 #56 #59 #60 · PW4 #57 #58 · close PW-11. The app invites you to install it the way your phone allows, opens on Home without browser bars with a back control on every screen, shows what you last saw with no signal and holds writes back, offers Reload for a new version, sends a push when someone sets your portion, a dish is ready to claim or you were paid, badges the icon with your to-do count, and has pull to refresh, the edge swipe back, sheets that drag away, row swipes, long-press menus and steppers that repeat while held, each with its visible twin. |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| PW0 — the spec | this doc set and the canvas row | merged |
| PW1 — an app on your home screen | the install invitation (Android one tap, iPhone instructions), manifest shortcuts and screenshots, iPhone splash screens, a back control on every screen, no rubber-band or double-tap zoom, the keyboard never covering the field | installed on an iPhone and an Android, it opens on Home without browser chrome, and every screen can be left without the browser |
| PW2 — no signal, clean updates | a service worker: the app's files and the last-seen data cached per account, an offline banner, writes held back offline, "New version · Reload" | in airplane mode an installed phone opens Home, Pantry and a dish with the last data; a write says you're offline; a deploy offers Reload |
| PW3 — notifications | Web Push for "Anu set your portion", "a dish to claim" and "you were paid back", each on or off in You, plus the to-do count as the icon badge | a portion set by Anu reaches Dev's locked phone: Android in the browser or installed, iPhone installed |
| PW4 — gestures | pull to refresh, swipe back from the edge (iPhone, installed), drag a sheet away, swipe a pantry row to use your usual, swipe your log to Undo, long-press an item for its actions, hold a stepper to repeat | each gesture works on iPhone Safari and Android Chrome, installed, and has a visible twin |

## After this epic

What the tasks reported and left, for a later epic or a small fix:

- **Real phones.** Push is checked: a test push reached the owner's installed iPhone on stage (2026-11-08). The rest of each PR's checklist is still the owner's, on an iPhone (installed and in Safari) and an Android (installed): install (#50), back controls (#55), offline and Reload (#48), a portion set by someone else and the badge (#56, #59), the gestures (#57, #58).
- **A switch that can't turn on doesn't say why** (PW-12, declared). A closed permission prompt puts the switch back silently, and every other failure shows only "Couldn't turn that on". The owner's first try on the iPhone never reached "Send me a test", and the second worked, so the cause is unknown. PW-12 makes each step say why (the phone's answer, the service worker, the subscription, the server) and logs a refused push with the push service's host and status.
- **"You" is not cached offline.** The profile read is network-only, so offline Home has no name and a dish shows no claim controls. Caching the profile in the account's cache would restore them (PW-4).
- **Data reads again on focus.** Coming back to the app after a minute re-reads the screen in the background (PW-7 turned `refetchOnWindowFocus` on as the pull's twin). Reverting it is one line, if fewer reads matter more.
- **A new push key reaches a phone only when someone flips a switch.** Comparing the subscription's key at launch would re-subscribe at once (PW-6, PW-9).
- **No gesture hint card.** The canvas's "Swipe left to use your usual · hold for more" was left out on purpose; every gesture has its button (PW-8).
- **No mouse or pen drags.** The gestures answer touch; from 900 px the Pantry is a table with no swipe (PW-7, PW-8).
- **Android Chrome has no icon badge API.** Its icon shows a dot for unread notifications by itself, so the badge switch shows only where `navigator.setAppBadge` exists (PW-6).
- **Store apps** (Capacitor around the same code) stay a later option, only if people ask (decision 9).
