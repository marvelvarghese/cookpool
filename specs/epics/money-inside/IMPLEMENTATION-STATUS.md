# money-inside — implementation status

| Milestone | Task | State | PR |
|---|---|---|---|
| MN0 — the spec | MN-1 | shipped | #187 |
| MN1 — the shared tab | MN-2 | shipped | #188 |
| MN2 — Cookpool's Money | MN-3 | shipped | #189 |
| MN3 — Tripeco's Money | MN-4 | shipped | #190 |
| MN4 — close-out | MN-5 | shipped | #191 |
| (follow-up) old Money out | MN-6 | shipped | this PR |

## Departures from the boards

- Tripeco's real tabs are Home · Vehicles · Groups, so Money is a fourth tab there, not the boards' Drive · Rides · Fuel · Money · You.
- Group rows show the group's initial, not the members' faces (the groups read carries no members).

## Found on the way

- KC-9 (#185) left `kitchen-revamp-foundation.test.ts` unable to load (it read the dark palette's old selector); MN-6 points it at the pinned-Dark rule.

## Not yet verified

- Neither app's Money tab has been seen signed in on stage. In Cookpool it shows only in the new frame (not prod).

## Follow-ups

- ~~Remove Cookpool's old Money screens~~ (MN-6). The kitchen-only Settle page (`/money/settle`) stays: dishes and group settings link to it.
- Settle inside the tab instead of opening Spliteco.

## Round two — Money stays in Cookpool

The owner asked for every Money feature inside Cookpool, with no trip to the
Spliteco app. Spliteco's own screens are mounted in Cookpool rather than
copied:

| Task | What | State | PR |
|---|---|---|---|
| MN-7 | Spliteco's screens mountable: relative imports, links through `to()`, the session as context | shipped | this PR |
| MN-8 | Cookpool mounts group, Add expense, expense, Settle up and Scan under /money; the tab stops handing off | planned | |
