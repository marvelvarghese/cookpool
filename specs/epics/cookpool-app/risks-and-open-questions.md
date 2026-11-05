# cookpool-app — risks and open questions

## PW-A — iPhones give web apps less (ACCEPTED)

No install prompt (hence the drawn steps), no vibration, push only for the installed app on iOS 16.4+, and the edge swipe has to be ours. The design asks nothing of iOS it doesn't give.

## PW-B — a service worker can serve an old app (RISK)

A cached build that outlives its deploy would call an API that has moved on.

Mitigations:
- pages and payloads are network-first;
- the worker checks for a new build on every launch;
- "Reload" swaps it in;
- an app left open a day reloads itself on its next launch.

The build ID check SM-2 noted still forces a full reload when payloads change.

## PW-C — personal data cached on a shared phone (RISK)

The last-seen data cache is named for the account and deleted on sign-out. Tokens and codes are never cached. A phone handed to someone else while signed in shows what the app shows anyway.

## PW-D — gestures that fight each other or the phone (RISK)

Row swipes vs carousels, the edge swipe vs Safari's own, pull to refresh vs scrolling.

Mitigations:
- the edge swipe is on only when installed on iPhone;
- carousels take horizontal drags first;
- pull to refresh starts only at the very top;
- tab swiping is not built.

## PW-E — push on iPhone only once installed (ACCEPTED)

iOS gives Web Push only to the installed app (iOS 16.4+). The browser shows one line saying how to get notifications, and the install invitation (PW1) is what makes it work. Email keeps carrying every message either way.

## PW-F — store apps (SETTLED, 2026-11-05)

The owner chose a PWA over store apps. Users are on both iPhone and Android, and invite links must open straight into the app. Wrapping this same code for the stores (Capacitor; TWA on Android) stays possible later and would reuse all of this epic.
