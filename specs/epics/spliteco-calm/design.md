# spliteco-calm — design

The canvas boards (row 7) are the reference; this file is the rules they share. Content and behaviour stay as built in `cookpool-spliteco` unless a section says otherwise.

## 0. Decisions, each with its why

1. **Deep ocean stays; Cookpool's rules come over.** Spliteco is its own brand (cookpool-spliteco §0.3). What carries over from `cookpool-revamp` is the discipline: one line per row, numbers not sentences, three then See all, one main button, borderless cards. Why: the owner asked for Cookpool's philosophy "to a small extent", not its look.
2. **Every gesture has a visible twin.** A swipe or a hold only makes something faster; a tap reaches the same place. Why: gestures are invisible, and the mouse, keyboard and screen readers need the twin (as in Cookpool PW-8).
3. **No gesture library.** The rules are pure functions (pointer events in, decisions out, an injected clock); React only forwards events and moves things with CSS transforms. Why: Cookpool's `lib/gestures.ts` and `lib/row-gestures.ts` already prove the approach and their tests run in node.
4. **The gesture modules are copied, not shared.** `apps/spliteco-web/src/lib/gestures/` starts as a copy of Cookpool's two modules, with a header naming the source. Why: moving them into a package would touch `web-console-next` and its tests in an epic that otherwise doesn't; risk SL-A tracks the duplication.
5. **One keypad.** Add's keypad types into whatever is selected: the amount, or the person's field in Exact, Percent or + / −. Why: a second keyboard per row is what made splits unclear.
6. **Save waits until it adds up**, and its label says what is missing ("₹400 left", "20% left"). Why: the old form disabled Save without saying why.

**The alternative rejected:** restyling with tokens only (colours, borders, weights) and keeping the screens. Cheap, but it keeps the sentences and the buttons-for-everything that the owner said were too much, and it leaves the split methods unclear.

## 1. Surfaces and type (`globals.css`)

- **Cards:** radius 22, no border, `--surface` on `--ground`; rows inside split by a 1 px `--line-soft`.
- **Weights:** 400 body, 500 row titles, buttons and tabs, 600 for the big figures only. Nothing above 600.
- **Sizes:** page titles 26 px, rows 16 px, meta 13 px, tab labels 11 px; the big figure 52 px on Home, 46 px on Add.
- **Tab bar:** floating, 12 px from the sides and 14 px from the bottom, radius 24, `--surface` with a shadow. The current tab is a cobalt pill that slides. Pushed screens (Group, Add, Settle…) hide it.
- **Main action:** one per screen — the round cobalt + above the tab bar on Home, a cobalt "Add" pill on Group.
- **Amounts:** `+₹` teal when you get back, `−₹` coral when you owe, plain when settled. The sign is always there.
- **Light theme:** the same rules with the existing light tokens.

## 2. Gestures (`src/lib/gestures/`, `src/components/gestures/`)

| Gesture | Where | What it does | Twin |
|---|---|---|---|
| Swipe sideways | Home ↔ Groups ↔ Activity; Group's Bills ↔ Balances; Itemized items; Add's method strip | next / previous; the indicator follows the finger | the tab, the segment, the dots, the chip |
| Swipe a row left | a person on Home: Settle (you owe) or Remind (they owe); a bill on Group: Delete | a short swipe reveals the action; past 40 % or a flick fires it; Remind and Delete show Undo | the hold sheet; the person or bill page |
| Hold a row (480 ms) | person: Settle · Remind · Open; bill: Edit · Move · Comment | opens the actions sheet, with a light vibrate where supported | tapping opens the page, which has the same actions |
| Pull down | Home, Groups, Activity, Group | re-reads the screen | — (the screen re-reads on focus) |
| Drag a sheet down | every sheet; Add itself | closes it | ✕ / the scrim |
| From the left edge | every pushed screen | goes back | ← |
| Hold a face | Itemized | opens their adjust sheet (portions, %, ₹) | tapping the face |
| Hold − / + | Shares, Itemized ₹ | repeats | tapping |
| Slide | Settle | records the payment | Enter on the focused slider |

Thresholds are Cookpool's: decide after 8 px, fire past 40 % of the width or a 0.5 px/ms flick over 24 px, settle in 200 ms with `cubic-bezier(0.32,0.72,0,1)`; reduced motion makes it instant. A horizontal drag on a row is the row's when it goes left, the pager's when it goes right.

## 3. Pages

| Page | Board | What changes |
|---|---|---|
| Sign in | `V2SignIn` | Mark, name, one line; Google and Passkey side by side; "Email me a code" below; "Same account as Cookpool". |
| Home (`/`) | `V2Home` | The big net figure with ↑ owed / ↓ owe; three people then See all; Scan · Live · Insights tiles; the pager, row swipe, hold sheet and pull. |
| Groups (`/groups`) | `V2Home` page 2 | One line per group or friend: tile, name, Cookpool dot, net. |
| Activity (`/activity`) | `V2Home` page 3 | One line per change: face, what, "· Claude" when an assistant made it, amount. |
| Group (`/group`) | `V2Group` | Tile, name, faces, net; Bills · Balances; bills by month with "who paid · total" and your share; Fewest payments; the Add pill. |
| Add (`/add`) | `V2Add` | §4. |
| Itemized (Add → Itemized) | `V2Itemized` | One card per item, swipe between them, dots; faces on the card with their share; + opens Who had it? (with Everyone); hold or tap a face to adjust; a totals strip; Save says how many items are left. |
| Settle (`/settle`) | `V2Settle` | You → them, the big amount, All or part, UPI · Cash · Bank tiles; UPI: Open UPI app, then Slide when paid; Cash and Bank: Slide to record; a tick and Undo. |
| Everything else | — | Takes §1's surfaces and type; layout unchanged. |

## 4. Add: how every split sets each share

One row per person; the right side of the row is how that person's share is set, and the footer says whether it adds up.

| Method | The row's control | The footer |
|---|---|---|
| Equally | ✓ in or out | "4 of 4 in · ₹600 each" |
| Exact ₹ | the ₹ they pay (keypad) | "₹1,200 of ₹2,400 · ₹1,200 left" / "over" / "Adds up ✓" |
| Percent | their % (keypad), with the ₹ it comes to | "80% of 100% · 20% left" |
| Shares | − n + (hold repeats), with the ₹ it comes to | "5 shares · ₹480 a share" |
| + / − | + or − ₹ (keypad; ± flips), with the result | "₹575 each, then ±"; refuses anyone below ₹0 |
| Itemized | — opens Itemized | Itemized's own Save |

- The keypad types into the selected field; tapping the amount selects it. Exact, Percent and + / − select the first person when chosen.
- A one-line hint under the method names it ("Type each person's %").
- Save reads "Save" when the split adds up, and otherwise says what's left ("₹400 left", "Type the amount").
- The maths is `split-form.ts` and `kitchen-engine` as built; only the form changes.

## 5. Out of scope

- New features or routes. Swipe-to-delete uses the existing delete (restorable 30 days).
- A redesign of Insights, Share, Move, Live split, Scan, You and Assistants beyond §1.
- Cookpool's own screens.
