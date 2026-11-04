# cookpool-simpler — implementation plan

Milestones land in order. Each task is one pull request on an
`orun/SM-<n>-<slug>` branch with an `Orun-Task` trailer, merged when every
check is green, and created in Orunbase under its milestone with its contract
(`tasks/SM-<n>.TaskContract.yaml`). CI does not run the jest suites, so every
PR runs its affected suites locally and lists them.

## SM0 — the spec ✅

This doc set, the canvas row "Simpler", and the `SM-1` contract.

**Done when**
- the documents are on `main` under `specs/epics/cookpool-simpler`
- `orun task epic show cookpool-simpler` lists SM0 to SM5, and `SM-1` reads done

## SM1 — fast

- **SM-2 — pages are files** (web-console-next): no `headers()` in the root
  layout; the app config resolves in the browser; kitchen routes prerender;
  static files skip the worker; the timing script (design §1.2 item 5).
- **SM-3 — the database near its people** (cloudflare-d1, every worker bound
  to `PLATFORM_DB`): D1 recreated with location hint `apac`; Smart Placement;
  the migrations re-applied; wiring refreshed.
- **SM-4 — the API on the app's address** (api-edge, web-console-next, sdk):
  the console Worker forwards `/api/*` to api-edge over a service binding;
  the app calls its own origin on every host; api-edge trusts a forwarded
  client IP only over that binding. No owner step (risk SM-B).
- **SM-5 — writes show at once** (web-console-next): optimistic updates with
  Undo and rollback for every write named in design §1.2 item 4; keep last
  data while refreshing; prefetch from Home.

**Done when**
- the timing script passes on stage and prod: page first byte under 0.3 s, reads under 0.4 s at p75 from India
- logging a use shows in the list before the server answers, and a refusal rolls it back

## SM2 — for anyone

- **SM-6** (kitchen-worker, db, contracts, sdk, notifications): the
  `claims/{subjectId}` route, `set_by`, the email.
- **SM-7** (web-console-next): every row on the dish page steps for anyone,
  "by Anu"; faces and the named button on Use and Bill.

**Done when**
- Anu sets Dev's portion; Dev's row reads "by Anu", Dev is emailed once, and Dev can change it

## SM3 — from before

- **SM-8** (kitchen-worker, db, contracts, sdk): the history and recipes
  reads.
- **SM-9** (web-console-next): type-ahead on Bought and on Cook, filling the
  forms.

**Done when**
- buying milk again is: type "mi", tap Milk, tap Add

## SM4 — simpler screens

- **SM-10** (web-console-next): Home, Use, + Add, Dish, Pantry as the canvas
  draws them, under the seven rules.

**Done when**
- Home fits one phone screen with three to-dos; no screen in SM4 has a sentence of explanation above its main button

## SM5 — the rest

- **SM-11** (web-console-next): Groups, People merged with Settle, Item,
  Bill, Add item, Cook and the desktop pages under the rules; the audit's
  390 px bugs.
- **SM-12**: close the epic.

**Done when**
- every screen follows the seven rules, and the audit's bug list is empty

## Sequencing note

SM-2 and SM-3 run side by side (console vs infra). SM-4 follows SM-2 (its
entry wraps the console Worker SM-2 left serving only what is not a file). SM-5 follows SM-2. SM2 and SM3 can run side by
side (different routes). SM4 starts after SM-5 so the screens are built on
the instant writes.
