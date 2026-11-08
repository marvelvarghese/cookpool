# cookpool-recipes (RC) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| RC0 — the spec | landing | RC-1 |
| RC1 — the new frame (stage) | | |
| RC2 — recipes | | |
| RC3 — cooking sessions | | |
| RC4 — recipes travel | | |
| RC5 — prod | | |

## Departures from the design

### RC1 — item notes (RC-3)

**What shipped.**

- **Migration `330_kitchen_item_notes`**, laid out as 300: one nullable `kitchen_items.note TEXT CHECK (note IS NULL OR length(note) <= 80)`, no default, so every item written before reads as NULL. Its manifest entry follows 320 with its checksum.
- **Storage** (`packages/db/src/kitchen`): `note` is one of `ITEM_COLUMNS`, so every item read carries it: get, list, search, the use-soon sweep, the dish reads, uses and moves. The insert takes `NewKitchenItem.note`. `updateItem` sets `KitchenItemChanges.note` with no "unused" guard, so a note changes at any time, as a name does. A note over 80 is refused by the CHECK as `invalid` (`item_out_of_range`).
- **Contracts**: `KitchenItem.note`, plus `note` on `CreatePersonalItemRequest`/`CreateGroupItemRequest` and `UpdatePersonalItemRequest`/`UpdateGroupItemRequest`. Three shared helpers: `ITEM_NOTE_MAX` (80), `normalizeItemNote` (trim; empty is null) and `itemNoteLength`.
- **kitchen-worker**: the add and the edit validate `note` (`noteValue` in `pantry.ts`). It must be text or null. It is trimmed, and empty or spaces becomes null. More than 80 characters is 422 `validation_failed` on `note`. A note alone is a valid PATCH. `toKitchenItem` returns `note` on every route that answers with an item. A note writes no ledger transaction, split, stock move or audit event.
- **Who sees it**: whoever can read the item. In a personal pantry that is its owner (404 for anyone else). In a group's pantry it is every member, viewers included, and nobody outside (404). Someone who leaves loses it at once.
- **Who changes it**: anyone who can edit the item, by the same rule as any group edit. That is the buyer, or an owner or admin. Another member gets 403 `not_buyer`, and a viewer gets 404.
- **SDK**: the client already sends the contract bodies. Its doc comments name `note`, and tests cover the four calls and a 422.
- **Console**, all behind `newFrame()` (`src/lib/features.ts`, added here as RC-2 specifies it). With the flag off, every request and row is byte-for-byte what it was (tested).
  - **Bought**: a **Note** textarea sits after the use-by as the last section (`boughtSections(group, notes)`). It holds at most 80 characters, with the placeholder "For Sunday's curry". The hint reads "Only you see it" or "Everyone in Flat 4B sees it", with an `18/80` count. A note is sent only when it is not empty. Picking from "from before" keeps what was typed: notes are never filled from history. The pending row (SM-5) shows the note at once.
  - **Item page**: a **Note** block sits under the stock card. It shows the note behind a pencil, with Change, or "Add a note" when empty. Editing happens in place: the field, Cancel, then Save, which reads Remove once the field is emptied. It saves at once with the ten-second Undo, which PATCHes the old note back (`useSetItemNote`, the measures pattern). People who may not edit see the note without buttons, and nothing when there is none.
  - **Pantry row**: the note is a third line, a 12 px pencil and the note on one line, ellipsized. On desktop it also sits under the name in the table.

**Departures.**

- **`KitchenItem.note` is optional in the type** (`note?: string | null`), like `measures?`. That keeps items typed before RC-3 (fixtures, RC-2's work) compiling. The server always sends it, as null when unset.
- **Length is counted in characters, not UTF-16 units**, to match SQLite's `length()`: 80 emoji fit. The textarea's `maxLength` counts UTF-16 units, so it is the stricter of the two. Only a paste of wide characters can reach the form's "Keep it to 80 characters".
- **A note moves with its item.** Moving your own item into a group (transfer) keeps the note, and the group then sees it. Visibility follows the item, as §1.5 says. Bought's "Only you see it" holds until you move it.
- **Group audit**: `kitchen.item.added` does not carry the note, which keeps the group's log to the item's facts.
- **Removed items**: the console offers no note edit on a removed item. Used-up and wasted items can still change their note, as their name can.
- **Edits outside "the item form, the item page and the pantry row"**: `pantry/page.tsx` passes `notes: newFrame()` at its two row call sites (a likely merge point with RC-2). `tests/db/src/notifications-push.test.ts` pinned 310/320 as the last migrations, so it now checks "right after 300". Three console tests that pinned shapes now list `note`.
- **No version on a note edit**: a note PATCH sends no `version`, so the last write wins, and Undo re-sends the old note.
- **Not checked on stage** (nothing deployed). The new pieces were looked at locally at 375 px through a temporary fixture page, which was removed. Prod's frame is covered by tests only.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/db` | 5 (330's shape; real SQLite: old rows read null, every read carries it, set/clear moves no money, 80 by characters) | 724 |
| `tests/kitchen-worker` | 14 (`item-notes.test.ts`) | 488 |
| `tests/contracts` | 4 (`kitchen-item-notes.test.ts`) | 170 |
| `tests/web-console-next` | 21 (`kitchen-item-notes.test.ts` 20, from before 1) | 1316 |
| `packages/sdk` | 2 | 171 |

`pnpm typecheck` and `pnpm lint` pass, and `orun task check RC-3 --base origin/main` passes: 10 changed components, all inside the contract.
