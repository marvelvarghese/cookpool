# cookpool-guided — implementation plan

Each task is one pull request on `orun/GC-k-<slug>` with its contract in `tasks/GC-k.TaskContract.yaml`. Everything in the console is behind `newFrame()`: on stage, off in prod until cookpool-recipes RC5.

## GC0 — the spec ✅

- **GC-1:** this doc set and the contracts for GC-2 to GC-7.

**Done when**
- merged

## GC1 — steps that guide ✅

- **GC-2: the step model in the server** (design §1, §2, §5's recording, §6 migration 370, §7):
  - the step fields, `tools` and `longPrep`;
  - `stepTimeAt` in contracts;
  - the dish write's `stepLog`;
  - Use today's times;
  - the SDK;
  - tests.
- **GC-4: Cookpool's 42 recipes with guided steps** (migration 390). Every step gets a phase, flame, range, rule and checkpoint where it applies, plus its lines and tools. It is checked by a content test.
- **GC-6: writing guided steps and the plan** (design §3.5, §8):
  - the editor in the recipe form;
  - structured steps and long prep on the recipe page;
  - `/recipes/[id]/plan`.

**Done when**
- on stage, Chicken curry's steps each show their flame, ingredients, range and checkpoint
- its plan differs at 450 g and at 1 kg as the rules say
- a new recipe can be written with guided steps

## GC2 — cooking with you ✅

- **GC-5: guided mode** (design §3, §4's console side, §5's posting):
  - the prompt, Before you start, the step, waiting and Meanwhile, whistles, Done;
  - the timer strip;
  - wake lock, read aloud, swipe;
  - server timers;
  - the step log on Finish.

**Done when**
- on stage, Chicken curry cooks from the prompt to Who ate
- a simmer runs while step 7 is open
- Done shows each step's real time
- "Just tick what I use" still works

## GC3 — timers that find you ✅

- **GC-3: timers in the server** (design §4, migration 380):
  - the routes;
  - the per-minute cron;
  - notifications-worker's push to a subject.

**Done when**
- on stage, a timer set in guided mode reaches a locked phone within a minute of its end
- a cancelled timer never does

## GC4 — learning from cooks ✅

- **GC-7: learned ranges** (design §5): the aggregation by recipe root and step key, at least 5 times from 3 cooks, percentiles at the caller's size, and the recipe read's `learned`.
- **GC-8:** close the stage part.

**Done when**
- after 5 recorded cooks by 3 people, a step reads "usually N–M min at this size · K cooks" on the step and in the plan

## Sequencing

1. **Wave A, now: GC-2 and GC-3.**
   - Both are server work. They share only kitchen-worker's router and the migrations manifest, and their migration numbers are fixed (370, 380).
   - Both can run while cookpool-recipes' RC-8 builds console screens.
2. **Wave B, after RC-8, GC-2 and GC-3 land: GC-4, GC-5, GC-6 and GC-7.**
   - GC-4 and GC-7 are server work: content in migration 390, and aggregation in the recipe read.
   - GC-5 owns `/cook/session`; GC-6 owns the recipe form, the recipe page and `/recipes/[id]/plan`. Their seam is the plan link, `/recipes/<id>/plan?f=`.
3. **GC-8 closes the stage part.**
