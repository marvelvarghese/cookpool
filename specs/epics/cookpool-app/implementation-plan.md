# cookpool-app — implementation plan

Milestones land in order. Each task is one pull request on an `orun/PW-<n>-<slug>` branch with an `Orun-Task` trailer, merged when every check is green, created in Orunbase under its milestone with its contract (`tasks/PW-<n>.TaskContract.yaml`). CI does not run the jest suites, so every PR runs its affected suites locally and lists them. Real-phone checks (an iPhone and an Android) are the owner's, from a short checklist in each PR.

## PW0 — the spec

This doc set, the canvas row "On your home screen", and the `PW-1` contract.

**Done when**
- the documents are on `main` under `specs/epics/cookpool-app`, and `PW-1` reads done

## PW1 — an app on your home screen

- **PW-2:** the install card and the iPhone sheet; You's "Install the app"; manifest shortcuts and screenshots; iPhone splash images.
- **PW-3:** back controls on every non-tab screen and parent-aware back; overscroll, touch-action, selection, `100dvh`; the keyboard rule.

**Done when**
- installed on an iPhone and an Android, Cookpool opens on Home without browser chrome, and every screen can be left without the browser

## PW2 — no signal, clean updates

- **PW-4:** the service worker (build-generated precache list, the fetch rules, the per-account data cache cleared on sign-out); the offline banner and held-back writes; the update toast.

**Done when**
- in airplane mode, an installed phone opens Home, Pantry and a dish with the last data, and a write says "You're offline"
- a deploy shows "New version · Reload" and never during a write

## PW3 — notifications

- **PW-5:** subscriptions (migration, routes), the VAPID secret, notifications-worker sending Web Push.
- **PW-6:** You's settings and the permission ask (only after the person turns a kind on), and the icon badge.

**Done when**
- a portion set by Anu reaches Dev's locked phone (Android in the browser or installed; iPhone installed)

## PW4 — gestures

- **PW-7:** pull to refresh, the edge swipe back (installed iPhone), dragging sheets away.
- **PW-8:** row swipes (use my usual, Undo your log), long-press actions, hold-to-repeat steppers.

**Done when**
- each gesture in design §4 works on iPhone Safari and Android Chrome, installed, and has its visible twin

## Sequencing

- PW-4 (the service worker) starts first. It touches the build, the root layout and the write helpers, not the screens the simpler epic is rebuilding.
- PW-2 and PW-3 follow SM-10, because the install card sits on Home and the back controls sit in every screen's header.
- PW3 follows PW2, because push needs the service worker.
- PW4 waits for SM-10, SM-11 and SM-14, so the gestures are built on the final screens.
