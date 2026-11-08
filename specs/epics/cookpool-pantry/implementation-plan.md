# cookpool-pantry — implementation plan

Each task is one pull request on `orun/PN-k-<slug>`, with its contract in `tasks/PN-k.TaskContract.yaml`. Everything in the console is behind `newFrame()`: it's on in stage and off in prod until cookpool-recipes RC5.

## PN0 — the spec

- **PN-1:** this doc set and the contracts for PN-2 to PN-10.

**Done when**
- merged

## PN1 — one tap from the Pantry

- **PN-2: usuals by time of day and by food, in the server** (design §2):
  - `?tzOffset=` and the buckets;
  - usuals resolved by name key within a pantry;
  - `now` and `strip`;
  - `suggestUse` and `isRunningLow` in contracts;
  - the SDK;
  - tests (kitchen-worker, contracts).
- **PN-5: the new Pantry** (design §1, §2.3, §3, §4):
  - sections by kind, level bars, counts as filters, and search on phones;
  - the Now strip;
  - the suggestion chip with its reason;
  - the open row;
  - the More… sheet;
  - Log several;
  - Home's field and `/use` leading to `/pantry?focus=1`;
  - view-model tests.

**Done when**
- on stage, at 8 am local time, a person with three morning glasses of milk this month sees "Milk · 1 glass · Morning usual" in the Now strip, and one tap logs it with Undo
- a new pack of milk in the same pantry shows the same suggestion
- a row opens in place, steps to 2 glasses, picks Anu and logs; the toast's Undo reverses it

## PN2 — restocking in one go

- **PN-3: restock and purchases, in the server** (design §6.4, migration 400): `GET /v1/kitchen/me/restock`, `POST`/`DELETE /v1/kitchen/me/purchases`, the SDK and tests.
- **PN-6: restocking in the app** (design §6.1–§6.3):
  - Finished this week on the Pantry;
  - Bought again with Change;
  - `/pantry/new?from=`;
  - the shopping run at `/pantry/run`;
  - **+ Bought**;
  - view-model tests.

**Done when**
- on stage, bread finished on Tuesday shows in Finished this week, and Bought again adds it like last time
- a shopping run adds bread, atta and milk to two pantries in one write, and Undo removes all three

## PN3 — fixing stock honestly

- **PN-4: the stock check in the server** (design §7, migration 410):
  - the check route for personal and group items;
  - the `adjust` move and its undo;
  - `via`;
  - the SDK and tests.
- **PN-7: the item page and the stock check screen** (design §5, §7):
  - the ring, quick-use chips, `runOutEstimate`, who had it, and the actions;
  - `/pantry/[itemRef]/check`;
  - history reading stock checks;
  - view-model tests.

**Done when**
- on stage, setting milk from 1 L to 750 ml with Split with Flat 4B charges each of the four members a quarter of 250 ml's cost, and Undo reverses it
- setting it to more than Cookpool thought moves no money
- the item page reads "At this rate it runs out <day>" after two uses on two days

## PN4 — ask before use

- **PN-8: asks in the server** (design §8.5, migration 420):
  - `askFirst` and `allowed` on group items;
  - ask, approve, decline, reopen and cancel, and the read;
  - lapsing;
  - the `ask_first` refusals on use, waste, dish and check;
  - inbox rows and the two pushes;
  - copying the settings on purchases;
  - the SDK and tests.
- **PN-9: asks in the app** (design §8.1–§8.4):
  - Who can use it on Add item and on the item page;
  - the row's Ask state, waiting and Cancel;
  - Home's ask card with Approve, Decline, Always let and Undo;
  - `/home?ask=`;
  - the cook session's Ask line;
  - view-model tests.
- **PN-10: close-out.** Status, README "Shipped as", After this epic, and `state: completed` once every task is done.

**Done when**
- on stage, Meera turns on Ask me first for saffron; Dev asks for 1 pinch for Dev and Anu; Meera's phone gets the push and her Home shows the card; Approve logs it for both, with ₹12 back to Meera
- with Always let Dev on, Dev's next pinch logs directly
- an unanswered ask reads Lapsed after 24 h

## Sequencing

- **Wave A (server, in parallel):** PN-2, PN-3 and PN-4. They all add to the kitchen-worker router, `contracts/src/kitchen.ts` and `sdk/src/kitchen.ts`. Each adds its own section, and later ones merge `origin/main` before landing. Migrations are fixed in advance: **400** is PN-3 and **410** is PN-4.
- **Wave B:**
  - PN-5 (after PN-2);
  - PN-7 (after PN-4; it touches the item page and a new route, not the Pantry list);
  - PN-8 (after PN-4, for `via = 'ask'`; migration **420**).
- **Wave C:**
  - PN-6, after PN-3 and PN-5. It adds Finished this week to the page PN-5 rewrote.
  - PN-9, after PN-8 and PN-5. It adds the Ask state to PN-5's rows.
- **PN-10** last.
- **Redeploys:** a task that changes only `contracts`/`sdk`/`db` must touch the workers that bundle them (the `# orun: redeploy` line), and the console must change its own files to pick them up.
