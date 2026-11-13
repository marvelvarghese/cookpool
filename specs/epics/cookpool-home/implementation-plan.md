# cookpool-home — implementation plan

One task per milestone, one PR per task.

## HM0 — the spec (HM-1)

This doc set and `tasks/HM-1..HM-4`. Done when merged.

## HM1 — the calm Home (HM-2)

- `new-home.ts`: `NEW_HOME_SECTIONS` becomes greeting, quick actions, install, To do, Cook tonight — no `from-groups`.
- A `HomeQuickActions` component (Scan bill only when receipt scan shows) replaces `HomeUseField` on Home.
- `NeedsYou` takes a `caughtUp` option: Home passes it, and an empty Needs you shows "All caught up". The count is a badge.
- `HomeCookTonight` replaces Home's Cook now carousel: the first entry, one card.
- The resume strip moves above the quick actions.
- Tests in `tests/web-console-next` follow the new section list and the quick actions' links.

Done when stage's Home matches the boards in light and dark at 390 px, and the console's tests pass.

## HM2 — the feed on Kitchen (HM-3)

`FromYourGroups` moves out of `new-home-ui.tsx` into its own module and renders under the Kitchen page in the new frame. Done when the feed shows on stage's Kitchen.

## HM3 — close-out (HM-4)

`IMPLEMENTATION-STATUS.md` lists every milestone with its PR; the README reads Shipped.
