# cookpool-kitchen-calm — implementation status

| Milestone | Task | State | PR |
|---|---|---|---|
| KC0 — the spec | KC-1 | shipped | #171 |
| KC1 — the Measure drawer on Kitchen | KC-2 | shipped | #173 |
| KC2 — Add item | KC-3 | shipped | #176 |
| KC3 — the calm item page | KC-4 | shipped | #174 |
| KC4 — close-out | KC-5 | shipped | #177 |
| KC5 — Paid by selector | KC-6 | shipped | #181 |
| KC6 — the Kitchen header | KC-7 | shipped | #182 |
| KC7 — the shopping list's drawer | KC-8 | shipped | #183 |
| KC8 — Appearance in You | KC-9 | shipped | #185 |
| KC9 — the Kitchen list | KC-10 | shipped | this PR |

## Departures from design.md

- Use by keeps its choices (3 days · 5 days · 2 wks · None · Date), not the board's 1 week · 1 month · 6 months.
- Bought before was already a search as you type (SM-9); it is unchanged.

## Departures, round two

- Who paid?'s search shows only past six people; a small group gets the list alone.
- The kitchen picker and the shopping list already existed; KC-6 and KC-7 restyle them. The list keeps + Groceries beside it.

- Appearance (KC-9): dark was the phone's only; `data-look` on <html> now pins Light or Dark on this device, and every `[@media(prefers-color-scheme:dark)]` class became the `cp-dark:` variant.

## Departures, round three

- The Kitchen list (KC-10) shipped late: KC-2 to KC-8 built the drawer, Add item, the item page, the header and the shopping list, but the page's list itself stayed the old Usual now and per-pantry sections until KC-10.
- Usual now, the per-pantry sections and All's Always have cards are gone from the Kitchen; one pantry still shows its Always have. Finished this week and Your groups cooked stay under the Shelf.
- The search keeps Say what you used (✦) inside it; it opens from the round Search.

## Not yet verified

- None of it has been seen signed in on stage, in light or dark.

## Follow-ups

- One Undo toast when Add item saves an item and its measures together.
