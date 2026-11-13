# cookpool-home (HM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| HM0 — the spec | shipped | #165 |
| HM1 — the calm Home | shipped | #166 |
| HM2 — the feed on Kitchen | shipped | #167 |
| HM3 — close-out | shipped | this PR (HM-4) |

## HM1 — as built

- `home-actions.ts` lists the tiles; `HomeQuickActions` and `HomeCookTonight` live in `new-home-parts-ui.tsx`.
- `NeedsYou` takes `caughtUp`: only Home passes it, so every other use keeps RV-15's behaviour (hidden when empty, "· 3" count).
- The avatar moved from the accent fill to the accent tint, as the boards draw it.
- `FromYourGroups` is exported but unused until HM-3 mounts it on Kitchen.
- Not yet checked signed in on stage, in light or dark.

## HM2 — as built

- `FromYourGroups` and its row moved from `new-home-ui.tsx` to `groups-cooked-ui.tsx`, unchanged.
- Kitchen (`NewPantry`) shows it on the All view, under Finished this week, and hides it while searching, as Finished does.
- Not yet checked signed in on stage.

## Still unverified

- Neither Home nor Kitchen has been seen signed in on stage, in light or dark: the session could not sign in. Check at phone width once stage deploys.
- Prod shows none of this until the new frame ships there (`newFrame()`).

## Follow-ups

- Needs you's rows still carry their sub-lines; the boards' one-line rows are a separate change (design.md, Rejected).
