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

### RC1 — the new frame (RC-2)

**What shipped.** The console only; no server, contract or SDK change.

- **The switch** (`src/lib/features.ts`): `newFrame()` is true wherever `appConfig().deployEnv` is not `prod`. That covers stage, dev, local and a workers.dev host that names no environment. It is read in the browser from the page's host. `newFrameFor(env)` is the pure rule. `frameRedirect(page, on)` says where a new-frame-only page sends a prod visitor. Every kitchen page renders only once the session is ready, never while it is prerendered, so one prerendered file serves both frames.
- **Five tabs** (`nav.ts`, `tab-bar.tsx`, `sidebar.tsx`): **Home · Pantry · Cook · Money · You**. Cook sits in the middle, its icon in a 44 px filled green rounded square. There is no + tab, and the Add sheet is not mounted in the new frame. From 900 px the sidebar lists the same five. It has no Add button and keeps Recent groups and the person at its foot. With the flag off, both bars are today's.
- **Home** (`/home` picks `NewHome` or today's at render; `new-home.ts` lists each frame's sections):
  - "Hi, Rahul".
  - What did you use?, today's field with its usuals row.
  - **To do**: today's inbox rows, reordered: dishes first, an open dish with its ½-step chips (0 ½ 1 1½ 2) in the row; then Pay X; then use soon or past its date; then flags.
  - **Cook now**: an empty slot, `CookNow` in `cook-now-slot.tsx`, for RC-5 to replace.
  - **From your groups**: a card per dish finished in the last 7 days in any of your groups. Each has the cook's face, "Meera cooked", the group and when, the name, and three numbers: portions, each, you had.
  - No money card and no Recent.
- **Money** (`/money`, new frame only, `money-ui.tsx`):
  - One figure per currency: you get back / you owe.
  - **Settle up**, the main button, goes to today's settle screen (`/people`). **Bill** asks which group and then opens today's Add a bill.
  - A segmented **People | Groups**, kept in the address as `?list=groups`. A person row has face, name, shared group and the amount with its direction; it opens `/people/[id]`. A group row has its tile, name, member count and your balance; it opens today's group page.
  - Under Groups: **New group** and **Join with a link**.
  - A prod visitor is sent to `/home`.
- **You** (`/you`, `YourPage` in `profile-ui.tsx`):
  - Your 64 px face, name and groups.
  - **Cooks** and **Groups**.
  - A "Cooks a week" column chart over the last 8 weeks.
  - Your recent cooks.
  - The gear opens **`/you/settings`**, today's You rows (name, how you sign in, notifications, install, sign out) titled Settings. In prod `/you` is today's page, and `/you/settings` sends a visitor to `/you`.
- **A person** (`/people/[id]`, `NewPerson`):
  - Back, their 64 px face, name and "In Flat 4B with you".
  - The balance strip ("You get back ₹40.00"), with **Settle up**.
  - Their recent cooks in the groups you share.
  - Today's itemized Why, open under a **Why** heading.
  - In prod the page is unchanged (`TodayPerson`).
- **Session bar slot**: `SessionBar` (`session-bar.tsx`) sits in the kitchen layout above the tab bar, in the new frame only. It renders nothing; RC-6 owns it.
- **Routes**: `/money` and `/you/settings` are added to `static-pages.mjs` (SM-2's pattern), so they are served as files and precached.
- **Home-screen shortcuts** (plan item): in the new frame they are **What did you use?** (`/use`) and **Start cooking** (`/cook`).
- **Offline**: `GET /v1/kitchen/me/dishes` joins the service worker's `API_READS`.

**Departures.**

- **No feed route.** From your groups, your Cooks, Cooks a week and a person's cooks all come from the existing `GET /v1/kitchen/me/dishes`: what you cooked plus what was shared with your groups, newest cooked first. It is read 100 at a time, at most four pages, until it covers 14 days (Home) or 56 days (You, a person). One cache entry, under `qk.kitchenDishes()`, serves all three. Two limits follow:
  - A dish finished this week but cooked more than 14 days ago does not show on Home.
  - Past 400 dishes read, Cooks reads "400+".
- **The To do order is set in the console.** Dishes, then payments, then use soon or past its date, then flags; within each, the server's order holds. The server's own order (past-date food first) is unchanged, and so is the icon badge count. Home still shows three rows and "See all".
- **Home keeps two things the canvas doesn't draw**: the install card (PW-2) under the greeting, and the usuals row under What did you use? ("the existing field", and RC-H's "Do it again stays").
- **`/cook` is today's cook screen** in the Cook tab, Back button included; in the new frame Back goes Home. RC-5 replaces it.
- **Settle up on Money** goes to `/people`, today's settle screen; `/settle` only redirects there. **Settle up on a person's page** is today's Record payment (which group, then UPI · Cash · Bank) under the new label.
- **Bill** skips groups you only view, and goes straight to the group when there is one.
- **You**:
  - Only Cooks and Groups; RC-5 adds Recipes and Saved by.
  - "Your cooks" stands alone; RC-5 adds the Recipes | Cooks tabs.
  - Cooks a week counts 7-day windows ending today, not calendar weeks. The number sits on this week's column only; every column states its count in its tooltip and accessible name.
- **A person's cooks** are those in the groups the person read lists. That read also lists any group where money between you is still open.
- **Where pages sit in the new frame**:
  - Tabs: `/use` is Home's; `/dishes`, `/recipes`, `/explore` and `/r` are Cook's; `/people`, `/settle`, `/groups` and `/join` are Money's; `/you/*` is You's.
  - Back: Groups, People, a group, a person, a join link and `/settle` go back to Money, and `/you/notifications` to settings. `backParent` and the edge swipe take the frame.
  - People and Groups, now reached from Money, show a Back in the new frame only.
- **The manifest decides its shortcuts on the server, from the request's host.** It switches only where the host names an environment other than prod. Localhost, an unknown host or no request keeps today's three, so prod's can't change by accident. `app-config.ts` gains `requestAppConfig(host)` for this.
- **Colours**: amounts use the kit's tokens (`cp-owed` #1D5FB8, `cp-owe` #C2410C), not the brief's #1D4ED8. The cook colour #B4471F marks the pot on From your groups cards.
- **Moved without change** so both frames share it:
  - today's You → `you-settings-ui.tsx` (gains `title`/`sub` props whose defaults render as before);
  - today's person page → `person-ui.tsx` (Record payment gains a `title` prop, default "Record payment");
  - Home's QuickUse → `quick-use-ui.tsx`.
- **Existing tests touched**, because a new page must choose:
  - `gestures.test.ts`: `/money` pulls to refresh, `/you/settings` doesn't;
  - `sw-routes.test.ts`: the new offline read.

  No assertion about today's frame changed.
- **Merged with RC-3**: one `newFrame()`, RC-2's. It is a superset with the same rule and default, so RC-3's test of it passes unchanged. RC-3's `notes: newFrame()` in `pantry/page.tsx` is kept.
- **Not checked on stage** (nothing deployed). The new screens were looked at locally at 375 px and 1280 px against a temporary in-page mock of the API, so no request left the machine. The mock was removed and never committed. Prod's frame is covered by tests only.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/web-console-next` | 69: `kitchen-features` 6, `kitchen-new-frame` 20 (tabs in both frames, active tab, Back, swipe, pull, shortcuts), `kitchen-money-page` 14 (figures, People, Groups, list, prod redirect), `kitchen-new-home` 15 (sections in both frames, no money card, To do order, From your groups, read window), `kitchen-cooks` 13, offline read 1 | 1385 (76 suites, after merging RC-3) |

`pnpm typecheck` and `pnpm lint` pass for `apps/web-console-next` and `tests/web-console-next`, and `orun task check RC-2 --base origin/main` passes: 2 changed components, all inside the contract.
