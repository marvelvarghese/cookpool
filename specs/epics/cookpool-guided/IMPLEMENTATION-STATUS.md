# cookpool-guided (GC) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| GC0 — the spec | landing | GC-1 |
| GC1 — steps that guide | | |
| GC2 — cooking with you | | |
| GC3 — timers that find you | | |
| GC4 — learning from cooks | | |

## Departures from the design

### GC3 — timers in the server (GC-3)

**Built** (design §4, §6 migration 380, §7):

- **Migration `380_kitchen_timers`:** `kitchen_timers` (`tmr_` id, `user_id` the person's `usr_…`, `label` 1–60, `body` 1–120 or NULL, `url` an app path ≤ 200 — one leading `/`, never `//`, no backslash — `ends_at` after `created_at`, `sent_at`, `canceled_at`, `created_at`). Three indexes: `kitchen_timers_due_idx (ends_at)` over active rows (the sweep), `kitchen_timers_user_idx (user_id, ends_at)` over active rows (a person's list and the limit), `kitchen_timers_ends_idx (ends_at)` over every row (the purge). Storage is `packages/db/src/kitchen/timers.ts`, its own `createTimersRepository` beside the kitchen repository (exported from `@saas/db/kitchen`); every write a race could double is one statement.
- **Routes** (kitchen-worker, `src/handlers/timers.ts`; api-edge's kitchen facade already forwards them):
  - `POST /v1/kitchen/me/timers` `{ label, body?, url?, endsAt }` → 201 `{ timer }`. `endsAt` 30 s to 24 h ahead (both ends inclusive); `url` defaults to `/cook/session`; a blank `body` is none (the push says "Time's up"). At most **10 active** a person: the eleventh is **422 `validation_failed`, `details.reason: "too_many_timers"`, `details.max: 10`** (not 429, which says "try later" and which clients retry). The count is in the insert's own statement, so two creates at once cannot both pass it.
  - `GET /v1/kitchen/me/timers` → `{ timers }`: active (unsent, not cancelled), soonest first — one past its end stays listed until the sweep claims it.
  - `DELETE /v1/kitchen/me/timers/{tmr}` → 200 `{ timer }`. Idempotent: a repeat answers the timer as the first cancel left it. Someone else's timer, a malformed id, or none is the opaque 404.
- **Contracts:** `packages/contracts/src/kitchen-timers.ts` (re-exported from `kitchen.ts`, and `@saas/contracts/kitchen-timers`): the bounds, `isKitchenTimerUrl`, `KITCHEN_TIMER_PUSH_KIND`, `KITCHEN_TIMER_ERROR_REASONS`, `KitchenTimer`, `CreateKitchenTimerRequest`, `KitchenTimerResponse`, `KitchenTimersResponse`. In `notifications.ts`: `PUSH_TO_SUBJECT_KINDS` (`["kitchen.timer"]`), `PUSH_TO_SUBJECT_INTERNAL_ACTORS` (`["kitchen-worker"]`), `PUSH_TO_SUBJECT_PATH`, `PUSH_TO_SUBJECT_LIMITS`, `PushToSubjectRequest`, `PushToSubjectResponse`; `PushMessage.kind` is now `NotificationKind | "test" | PushToSubjectKind`. `NOTIFICATION_KINDS` (the preference kinds) is unchanged: a timer is not something a preference turns off.
- **SDK:** `kitchen.timers()`, `kitchen.createTimer(body)`, `kitchen.cancelTimer(id)`, and the types and bounds re-exported.
- **notifications-worker:** internal `POST /v1/notifications/push-to-subject` `{ subjectId, message }` → `{ devices, sent, gone, failed, skipped? }`. It calls `pushToDevices` for every device of the subject with no preference check, passing only the five message fields (each bounded, the url an app path, the JSON ≤ 3 KB). A `skipped: "unreadable"` (the devices could not be read) is a 503.
- **The per-minute sweep** (kitchen-worker `src/timer-sweep.ts`): `"* * * * *"` beside `"30 2 * * *"` in the template's top-level `triggers.crons` (inherited by every environment; neither stage nor prod declares its own). `scheduled()` picks by `controller.cron`: `* * * * *` runs `runTimerSweep`; anything else runs the daily sweep, as before. Each run purges timers that ended more than 24 h ago, claims up to 200 due timers in one `UPDATE … RETURNING` that sets `sent_at`, pushes each through `src/push-client.ts` (beside `emails.ts`, same binding, six at a time; a failure is logged as `[kitchen-worker] push-to-subject tmr_…: <reason>` and never thrown), and logs one line: `[scheduled] timer sweep: due= pushed= devices= sent= unheard= failed= purged=`. No database, or a failed claim, fails the invocation.

**Departures from the design**

1. **Claimed, then pushed.** The design says sent timers are marked; the sweep marks them *before* the push — the claim is the mark — so two overlapping runs can never push one timer twice. The price is at-most-once: a push that fails (notifications-worker down or refusing, no binding) leaves the timer marked as tried and it is never retried. `sent_at` therefore means "the sweep asked for its push", not "a device heard it"; the outcome is in the log line only, not on the row.
2. **"Older than a day" is by `ends_at`, and the purge runs first.** A timer that ended more than 24 h ago is deleted whatever its state, before the claim — so one the sweep never reached (its trigger down for a day) is dropped rather than pushed a day late.
3. **Three indexes, not one.** The design's due index (`ends_at` where unsent) is there, made partial on not-cancelled too; the per-person index serves the list and the limit, and a plain `ends_at` index keeps the per-minute purge from scanning the table.
4. **push-to-subject takes kitchen-worker only.** Besides the internal-actor headers every route of the worker needs, the caller must be in `PUSH_TO_SUBJECT_INTERNAL_ACTORS`; any other internal caller — api-edge included — is 403, because the person is named in the body rather than pinned by the edge. api-edge's notifications facade was checked and not changed: it forwards only the paths it lists, by exact match, and push-to-subject is not one (tests/notifications-worker reads the facade to keep it so).
5. **Cancelling a timer already pushed** answers 200 with `sentAt` set and `canceledAt` null — it is not marked cancelled after the fact. A timer cancelled in the seconds between its run's claim and its push is still pushed (guided mode cancels before the end, so only a race at the very end).
6. **The contract was widened** to `default/cookpool/config-worker-tests`: `tests/config-worker/src/deployment-config.test.ts` pinned kitchen-worker's rendered crons to exactly `["30 2 * * *"]`, and now expects both triggers.
7. **No /health for the timer sweep.** The daily sweep records its runs in `kitchen_sweeps` for `/health`; the timer sweep records nothing — its per-minute log line is the heartbeat (kitchen-worker's runbook says what to look for).

**Not verified yet:** the milestone's "on stage, a timer set in guided mode reaches a locked phone within a minute of its end" needs a deploy and GC-5's guided mode. The chain is covered end to end in tests: `tests/kitchen-worker/src/timer-push-end-to-end.test.ts` sets a timer through kitchen-worker's route, and the sweep pushes it through the real notifications-worker router and encryption to a fake push service, where the phone decrypts it.

**Tests**

| Package | New | Suite |
|---|---|---|
| `tests/db` | `kitchen-timers-migration.test.ts`: 22 (registration, additive SQL, every CHECK, the query plans, and the repository over SQLite: the limit in the insert, cancel once, claim once, the purge) | 784 |
| `tests/contracts` | `kitchen-timers.test.ts`: 21 | 209 |
| `tests/kitchen-worker` | `timers.test.ts`: 28 (create, validation, the limit, list, cancel, someone else's is 404); `timer-sweep.test.ts`: 18 (a due timer pushed once in its words, not-yet-due, cancelled never, an overlapping run and two simultaneous runs never push twice, failures tried once, 200 a run, the purge, `scheduled()` on both crons, the template's triggers); `timer-push-end-to-end.test.ts`: 1 | 629 |
| `tests/notifications-worker` | `push-to-subject.test.ts`: 19 (no internal headers or a non-kitchen caller refused, the facade does not list it, the body checked, no devices, the exact message handed to `pushToDevices`, every device and no one else's, push off) | 150 |
| `tests/config-worker` | the kitchen-worker cron assertions now expect both triggers | 327 |
| `packages/sdk` | `kitchen-timers.test.ts`: 5 | 180 |

### GC1 — the step model in the server (GC-2)

**What shipped.** The server only: storage, contracts, kitchen-worker and the SDK. No console file changed.

- **Migration `370_kitchen_guided_steps`**, laid out as 340–360, with its manifest entry and checksum. It only adds: 13 `ALTER TABLE … ADD COLUMN`, one backfill `UPDATE`, one table and two indexes. Nothing is dropped or rebuilt.
  - `kitchen_recipe_steps` gains:
    - `step_key` (1–64 of `[0-9A-Za-z_-]`);
    - `phase` (`prep`/`cook`, default `cook`);
    - `line_refs` (a JSON array of at most 40, default `[]`);
    - `heat` (0–3);
    - `min_seconds` and `max_seconds` (0–86 400, both or neither, min ≤ max);
    - `whistles` (1–10, never with seconds);
    - `hands_off` (0/1, default 0);
    - `time_rule` (`fixed`/`partly`/`linear`, default `fixed`);
    - `checkpoint` (1–80);
    - `sense` (`look`/`smell`/`sound`/`feel`/`taste`, only with a checkpoint);
    - `tip` (1–160).

    Each column checks its own range. A rule between two columns sits on the one added later, which SQLite allows on `ADD COLUMN`.
  - **The backfill** gives every existing step a key of its own, `lower(hex(randomblob(16)))`, Cookpool's 215 included. The unique index `kitchen_recipe_steps_key_uq` on (recipe_id, step_key) is then built over the keys.
  - `kitchen_recipes.tools`: a JSON array of at most 10, default `[]`.
  - `kitchen_dish_step_times`:
    - columns: dish_id (FK), step_key, recipe_root_id (FK to `kitchen_recipes`), seconds (0–86 400), factor_milli (10–20 000 or NULL), cook_id, created_at;
    - primary key (dish_id, step_key);
    - index `kitchen_dish_step_times_root_idx` on (recipe_root_id, step_key).
- **Storage** (`packages/db/src/kitchen`):
  - `KitchenRecipeTemplateRecord` gains `guidedSteps: KitchenRecipeStepRecord[]` and `tools`. `steps` stays the texts.
  - A write's steps are `NewKitchenRecipeStep`: a string, or every field. Each list is still one `json_each` statement, so a write is still three statements. A step with no key gets one in SQL (`COALESCE(…, lower(hex(randomblob(16))))`), so no writer leaves a key NULL.
  - `updateRecipe` takes `changes.tools`.
  - `setRecipeStepTimes` is one owner-guarded batch. It sets both ends in one `UPDATE`, by key, and leaves whistle steps alone.
  - `recipeRootId` is one recursive CTE. It walks `source_recipe_id` through deleted recipes too, at most `MAX_RECIPE_ROOT_HOPS` (8) links.
  - `cookDish` takes `stepTimes` and writes them in the dish's own batch, as one `json_each` `INSERT`.
  - A repeated step key is refused as `invalid` `duplicate_step_key`.
- **Contracts** (`kitchen-recipes.ts`):
  - `KitchenRecipeStep`: position, key, text, phase, lines, heat, minSeconds, maxSeconds, whistles, handsOff, timeRule, sense, checkpoint and tip.
  - `RecipeStepInput` and `RecipeStepWrite` (a string, or a `RecipeStepInput`), and `LongPrepStep` (position, key, seconds, text).
  - `StepLogEntry` (`CookDishRequest.stepLog`), and `UpdateStepTimesRequest`/`StepTimesInput`.
  - The vocabularies: `STEP_PHASES`, `STEP_TIME_RULES`, `STEP_SENSES`.
  - The limits: `MAX_STEP_SECONDS`, `MAX_STEP_WHISTLES`, `MAX_STEP_CHECKPOINT`, `MAX_STEP_TIP`, `MAX_RECIPE_TOOLS`/`MAX_RECIPE_TOOL`, `LONG_PREP_SECONDS`, `MAX_STEP_LOG` and `STEP_KEY_RE`.
  - The helpers:
    - `stepTimeAt(step, factorMilli)` returns `{ minSeconds, maxSeconds } | { whistles } | null`;
    - `stepTimeMultiplier(rule, f)` gives 1, f^0.5 or f;
    - `isLongPrep` and `longPrepOf`.
  - `KitchenRecipe` gains `guidedSteps`, `tools` and `longPrep`. The create, `fromDishId` and PATCH bodies take `steps: RecipeStepWrite[]` and `tools`.
- **kitchen-worker**:
  - **Reads.** Create, read (by id and by link), PATCH, DELETE, both link routes, copies and `fromDishId` all answer with `guidedSteps`, `tools` and `longPrep`. `steps` is `guidedSteps[i].text`.
  - **Validation.** Every bad value is a 422 naming its field (`steps[2].minSeconds`, `tools[0]`, …):
    - a step's lines must be positions the recipe has: the lines sent with it, else the stored ones, else the dish's ingredients for `fromDishId`;
    - each line once;
    - heat 0–3;
    - seconds 0–86 400, min ≤ max;
    - whistles 1–10, and never with seconds;
    - phase, rule and sense from their lists, and a sense needs a checkpoint;
    - text 1–200, checkpoint ≤ 80, tip ≤ 160;
    - tools ≤ 10 of 1–40 characters, each once in any case.
  - **Keys** (`resolveSteps`):
    - every new step gets a server key (32 hex characters), and a key sent on create is ignored;
    - a PATCH step that sends one of the recipe's keys keeps it, with the fields it sends;
    - an unknown key, or a key already claimed in that request, is a new step;
    - copies keep every key and field, and the tools.
  - **The dish write** takes `stepLog`:
    - one row is kept per key the cooked recipe has: seconds = done − started (rounded), the dish's `recipeFactorMilli`, the cook, and the root from `recipeRootId`;
    - the root is read only when a time is kept;
    - a key the recipe does not have, a tick before its start, more than a day, and a key logged again are ignored;
    - money is computed exactly as before.
  - **`PATCH /v1/kitchen/me/recipes/{rcp}/step-times`** takes `{ steps: [{ key, minSeconds, maxSeconds }] }`:
    - only the owner may call it: anyone else, Cookpool's own, and a deleted recipe get the opaque 404;
    - it changes only those steps and bumps `updatedAt`, and answers `RecipeResponse`.
- **SDK:**
  - `KitchenClient.updateStepTimes(recipeId, body)`;
  - the step types, constants and helpers are re-exported from `@saas/sdk` (`stepTimeAt`, `longPrepOf`, …);
  - `createRecipe`, `updateRecipe` and `cookDish` carry the new fields through their contract types.

**Departures.**

- **`steps` stays `string[]` on the read, and the full steps are `guidedSteps`.** RC-5's and RC-6's screens read `recipe.steps` as texts, and this contract changes no console file. So the structured list is a sibling, and `guidedSteps[i].text === steps[i]`. `guidedSteps`, `tools` and `longPrep` are optional in the type (as RC-3's `note?` and RC-7's `gPerMl?` are), so recipes typed before still check; the server always sends all three. Design §7's `steps[].learned` (GC-7) belongs on `guidedSteps[]`. GC-5 and GC-6 read `guidedSteps`.
- **A step is written as a string or an object, both in `steps`.** A plain string on a PATCH keeps the recipe's first unclaimed step with exactly that text: its key and every guided field, with its lines cut to the lines the recipe now has. RC-5's form sends every step's text on every save. Without this, renaming a guided copy there would drop its guided fields and new keys would split its times from the pool. A changed text is a new text-only step.
- **A PATCH of lines without steps keeps the steps and their keys, minus the line refs past the new last line.** Positions are indexes, so a ref that is still in range can now name a different line. An editor that reorders lines should send the steps too (GC-6).
- **`minSeconds` alone is one time** (max = min). `maxSeconds` alone is refused.
- **A sense needs a checkpoint** (the API and a CHECK). A checkpoint without a sense is allowed and reads "Until golden brown".
- **`step_key` is nullable in the schema.** SQLite's `ADD COLUMN` takes no UNIQUE, no NOT NULL without a constant default, and no expression default. The unique index keeps a key to one step, and storage always writes one. The migration runner splits on `;`, so a trigger could not stand in for the default.
- **Cookpool's 42 recipes got random keys.** GC-4's 390 rewrites their steps with fixed keys. Three notes for 390:
  - write with plain `INSERT` or `UPDATE`: `INSERT OR IGNORE` skips a step that fails a CHECK without a word, and a test shows it;
  - set `min_seconds` and `max_seconds` in one statement;
  - leave seconds NULL on whistle steps.
- **Long prep** means a hands-off prep step whose *shortest* time (`minSeconds`) is at least 3 600 s, and `seconds` is that time. A 30–120 min marinade can be done in half an hour, so it is not long prep. The time is at the recipe's own size, unscaled.
- **`stepTimeAt` rounds every rule, fixed too, to whole minutes, at least one.** A 30 s tempering reads 1 min. It reads one end alone as one time, and a factor that is not positive or finite as × 1. × 1 is the identity only for times already in whole minutes, so that is what the property tests check.
- **The step log is kept raw.**
  - `factor_milli` is NULL when the dish said no factor (not 1 000), and 0 s is kept.
  - At most `MAX_STEP_LOG` (20) entries. A log that is not a list, an entry that is not an object, a key that is not text, a time that is not ISO 8601, and a non-empty log without `recipeId` are each a 422 on the dish write (`stepLog`, `stepLog[i].…`).
  - The first sensible entry of a key wins.
  - The rows go in the dish's own batch, so a refused or replayed dish writes none.
  - A canceled dish keeps its times, and GC-7 leaves them out through the dish's state.
  - The dish read does not return them.
- **Use today's times** needs both ends for every step it names. A key the recipe does not have, a whistle step, or a key named twice is a 422 (`steps[i].key`). The client does the division by the size rule (design §3.6).
- **Summaries are unchanged.** My recipes, a person's recipes, Explore and Cook now carry no steps, so they carry no step fields, tools or long prep either.
- **Not checked on stage** (nothing deployed).
  - `infra/db-migrate` is unchanged: it applies what the manifest lists.
  - GC-3's 380 appends to the same manifest, so whichever lands second rebases that one entry.
  - Main gained RC-8's and RC-9's console screens (#70, #71) and GC-3's timers (#72) after this branch was cut. The branch merges main with 370 before 380 in the manifest, and the totals below are for the merged tree.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/db` | 16, plus 370's checksum case in `migrations.test.ts`. `kitchen-guided-steps-migration` 9: registration; additive text; the backfill over 360's steps and a person's; every CHECK between and within columns; the unique key per recipe; tools; step times' PK, FKs, ranges and index; INSERT OR IGNORE silently skipping a bad step. `kitchen-guided-steps` 7: every field and the tools written and read in three statements; refusals; an edit keeping keys; step-times by key for the owner only; the root through a copy of a copy, a deleted link and the 8-hop cap; a dish's times in its own batch, with none on a refused dish or a replay. | 801 |
| `tests/contracts` | 13 (`kitchen-guided-steps`). Examples. Seeded properties over thousands of cases: × 1 is the identity for every rule, and fixed at every size, on the minute grid; every result is whole minutes, at least 60 s, min ≤ max, within 30 s of exact; partly and linear are monotonic in f; partly lies between fixed and linear; whistles are untouched. Long prep. The route shapes. | 222 |
| `tests/kitchen-worker` | 17 (`guided-steps`): create/read with every field, tools and long prep; plain and Cookpool steps; long prep's rule; 30 step 422s and 6 tool 422s, plus the limits and nulls; copies (and a copy of a copy) keep keys; a PATCH keeps sent keys and mints for new, unknown and repeated ones; plain texts keep their step; fewer lines prune refs; other fields leave steps be; `fromDishId` steps; the step log under the root of a copy of a copy, with the ignored entries; money unchanged with a log; 7 step-log 422s; step-times sets only those steps; owner only (co-members, a viewer, a stranger, Cookpool's, deleted: 404); 13 step-times 422s; 401/405. | 646 |
| `packages/sdk` | 1 (guided steps, tools and the step log as sent), plus `updateStepTimes` on the recipe paths test | 181 |

`pnpm typecheck` passes repo-wide (52 tasks). `pnpm lint` passes for every touched package (`packages/db`, `packages/contracts`, `packages/sdk`, `apps/kitchen-worker`, `tests/db`, `tests/contracts`, `tests/kitchen-worker`). `orun task check GC-2 --base origin/main` passes: 8 changed components, all inside the contract.
