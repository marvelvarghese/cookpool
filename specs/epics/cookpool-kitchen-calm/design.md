# cookpool-kitchen-calm — design

The boards are the spec: https://claude.ai/artifact/UKg7TpgfoHa4w9fssj7Fda, section "Kitchen, calmer".

## Kitchen (`Kitchen`, `KitchenUnit`)

The tick rows stay as RV-13 has them: the name, its line and bar, the amount box, the tick; a tick picks, one Log logs every picked row with one Undo. What changes is the unit inside the box: it opens the **Measure drawer** (`MeasureDrawer`) instead of a chip row under the row. The drawer has the item's plain units as a grid, Your measures ("1 glass · 250 ml"), and **New measure**: "1 [box] = [500] g", Save and use. Saving writes the item's measures (SM-14's `useSetMeasures`, with its Undo toast) and picks the new one at once. The shopping list and the cook session keep their chip row.

## Add item (`AddItem`, `UnitDrawer`, `NewMeasure`)

The unit chips and their "more" go. The unit is one button beside How much, opening the same drawer with all ten units. New measure there is kept on the form ("1 bowl = 150 g" shows beside the unit) and saved for the item once it is added. A switch to a unit of another kind drops them. The name's From before list (SM-9) is already a search as you type; Use by keeps its choices. The title is Add item.

## The item page (`Item`, `ItemOther`)

Top to bottom: Back and the Cook with it pill; the name; the **owner chip**, a face and "Asha's · Flat 4B" (or "Yours"), opening the group; **how much is left**, "1.2 kg of 2 kg · Runs out Tue" and one bar; Use some, the three amounts and **Other** (the PN-5 use sheet, as More opened); **Got more · Finished · Wasted** in one card, with Fix how much is left as a quiet link under it; History; Measures and note; Who can use it; Move.

Gone: the ring card, the Runs out card, the Who had it card (History has the same people), the subtitle line.

## Rejected

A separate "Details" page for history, measures and note: one more tap for things people check often, and the folded card already keeps them quiet.
