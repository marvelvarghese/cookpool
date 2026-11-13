# cookpool-kitchen-calm — implementation plan

One task per milestone, one PR per task.

## KC0 — the spec (KC-1)

This doc set and `tasks/KC-1..KC-5`. Done when merged.

## KC1 — the Measure drawer on Kitchen (KC-2)

- `measure-drawer.ts` (pure: `measureBase`, `readNewMeasure`) and `measure-drawer-ui.tsx` (`MeasureDrawer`).
- `TickRow` takes `drawer`; with it the unit opens the drawer, without it the chip row stays.
- `KitchenTickRow` passes the item's dimension and a New measure that saves through `useSetMeasures`.

Done when stage's Kitchen opens the drawer from a row's measure and a new measure is saved and picked.

## KC2 — Add item (KC-3)

The unit button and the drawer replace the chips; measures added there are saved for the item once `useAddItem` answers. Done when stage's Add item matches the board.

## KC3 — the calm item page (KC-4)

`ItemOwnerChip`, `ItemLevel` and `CookWithItPill` in `item-page-ui.tsx`; `QuickUse`'s last button reads Other; `ItemActionsRow` is one card. The page drops `LevelRingCard`, `RunOutCard` and `WhoHadItCard`. Done when stage's item page matches the board in light and dark.

## KC4 — close-out (KC-5)

`IMPLEMENTATION-STATUS.md` lists every milestone with its PR; the README reads Shipped.
