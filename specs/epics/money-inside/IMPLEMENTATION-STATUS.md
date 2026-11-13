# money-inside — implementation status

| Milestone | Task | State | PR |
|---|---|---|---|
| MN0 — the spec | MN-1 | shipped | #187 |
| MN1 — the shared tab | MN-2 | shipped | #188 |
| MN2 — Cookpool's Money | MN-3 | shipped | #189 |
| MN3 — Tripeco's Money | MN-4 | shipped | #190 |
| MN4 — close-out | MN-5 | shipped | this PR |

## Departures from the boards

- Tripeco's real tabs are Home · Vehicles · Groups, so Money is a fourth tab there, not the boards' Drive · Rides · Fuel · Money · You.
- Group rows show the group's initial, not the members' faces (the groups read carries no members).

## Not yet verified

- Neither app's Money tab has been seen signed in on stage. In Cookpool it shows only in the new frame (not prod).

## Follow-ups

- Remove Cookpool's old Money screens (`MoneyScreen`, its Bill and kitchen-only Settle up), now unused on `/money`.
- Settle inside the tab instead of opening Spliteco.
