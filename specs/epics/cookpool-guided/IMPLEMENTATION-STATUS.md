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

### GC4 — learning from cooks (GC-7)

**Built** (design §5, §7's `learned`). The server only: contracts, storage, kitchen-worker and the SDK. No console file and no migration changed.

- **The read.** Each entry of a full recipe's `guidedSteps` gains `learned?: { lowSeconds, highSeconds, cooks, samples }` (`LearnedStepRange`) once its key has 5 times from 3 cooks; otherwise the key is absent (not null). `GET /v1/kitchen/recipes/{rcp}?code=&f=` and `GET /v1/kitchen/recipe-links/{code}?f=` take `f`, the size in thousandths: the match's `factorParam` (a whole number from 10 to 20 000; anything else, `?f=1e3` and `?f=1.5` included, is 422 naming `f`), default 1000. `f` changes only `learned`. Every other `{ recipe, lastCook }` answer (create, copies, PATCH, DELETE, both link routes, step-times) carries `learned` at 1000. Summaries (My recipes, a person's, Explore, Cook now) carry no steps, so no `learned`.
- **The aggregation** (`packages/contracts/src/kitchen-recipes.ts`, pure, beside `stepTimeAt`). `learnedStepTime(step, samples, f)`:
  - **drops** (`keepsStepTime`) a time under `LEARNED_MIN_SECONDS` (10 s, skipped); one over `abandonedAfterSeconds(step, f_cooked)` = `LEARNED_ABANDONED_TIMES` (4) × the author's max (else min) × the rule's multiplier at the size it was cooked at — that is, normalised time over 4 × max; for a step with no time (untimed, whistles, or 0 s) the cap is `LEARNED_UNTIMED_MAX_SECONDS` (4 h) of wall clock; and one whose size is null or not a positive number;
  - **normalises** each kept time to f = 1: `normalizeStepSeconds` = seconds ÷ `stepTimeMultiplier(rule, f)`;
  - **requires** `LEARNED_MIN_SAMPLES` (5) kept times from `LEARNED_MIN_COOKS` (3) distinct cooks, both counted after the drops;
  - **takes** `percentile(values, p)` at `LEARNED_LOW_PERCENTILE`/`LEARNED_HIGH_PERCENTILE` (0.25/0.75), linear interpolation between the nearest ranks (type 7: h = (n − 1)p);
  - **scales** back with `scaleStepSeconds` and rounds with `wholeStepMinutes` (nearest minute, halves up, at least 60 s), which `stepTimeAt` now uses too, unchanged in behaviour;
  - **returns** `cooks` and `samples` only.
- **Storage** (`packages/db/src/kitchen/recipes.ts`): `pooledStepTimes({ recipeId, stepKeys, minSeconds })`, ONE statement per recipe for all its keys. It runs the `recipeRootId` walk (now a shared `rootChainSql` CTE) and returns the root's times for those keys from `kitchen_dish_step_times` joined to `kitchen_dishes`. SQL leaves out canceled dishes (`d.state <> 'canceled'`), times under `minSeconds`, and times of no size (`COALESCE(t.factor_milli, d.recipe_factor_milli) IS NULL`). Cook ids never leave storage: each read numbers its cooks 1, 2, 3…. No keys means no statement.
- **kitchen-worker:** `learnedSteps(ctx, repo, record, f)` in `src/recipes.ts` groups the pool by key and calls `learnedStepTime` with each step's own rule and times. `recipeResponse` runs it in parallel with the last cook, and `toKitchenRecipe` puts the ranges on the steps. A failed pool read is a 503, as a failed last cook is.
- **SDK:** `getRecipe(id, { code?, f? })` and `recipeByLink(code, { f? }, opts)`. It re-exports `LearnedStepRange`, `RecipeQuery`, `LEARNED_MIN_SAMPLES` and `LEARNED_MIN_COOKS`.
- **Speed:** there is no new index and no migration 400. The plan (pinned by a test) is:
  - `SEARCH t USING INDEX kitchen_dish_step_times_root_idx (recipe_root_id=? AND step_key=?)`;
  - the root is found once, as a scalar subquery over the recipes' primary key;
  - each time's dish comes by `sqlite_autoindex_kitchen_dishes_1`.

  Rows read grow with the pool: each kept time's row and its dish, plus at most 9 recipes. Nothing caps the pool.

**Departures**

1. **`learned` is on `guidedSteps[]` and adds `samples`.** Design §7 says `steps[].learned` and §5 `{ lowSeconds, highSeconds, cooks }`. `steps` stays text (GC-2), and the task asked for `samples`.
2. **Every full answer carries `learned`, not only the read.** A write answers at the recipe as written. A copy saved from a learned recipe therefore shows its range at once. A brand-new recipe always reads an empty pool, which costs one cheap indexed statement; it is not skipped, so there is one code path. The link read takes `?f=` too.
3. **`?f=` is checked before visibility,** as on the match: a bad `f` on a recipe the caller cannot see is 422, not 404.
4. **Abandoned is judged at the size cooked.** "Over 4 × max" is applied to the normalised time, so a time at twice the size of a linear step may be up to 8 × the written max. "4 × min" applies only when a step has a min alone, which storage never has. A step written as 0 s is treated as untimed. The 4 h cap for untimed and whistle steps is wall clock: it is neither normalised nor scaled.
5. **The reader's step judges the pool.** The step log does not record the rule or the times a dish was cooked under. Each time is normalised and capped by the step as the recipe being read has it now. A copy that kept a key but changed that step's rule or range (a PATCH sending the key, or Use today's times) reads the shared pool through its own step. Two copies can then show slightly different ranges from the same times.
6. **A time of no size counts for nothing, fixed steps included,** as the task says, though a fixed step's time does not depend on the size. The dish's own factor is the fallback (`COALESCE`), but GC-2's write always stores the dish's factor on the time, so today the two are the same.
7. **Drops happen in two places.** Canceled, skipped and sizeless times are dropped in SQL to keep rows off the wire. `learnedStepTime` applies every rule again, so the helper is the whole definition. "Abandoned" is checked only in the helper, because it needs the step's rule (√f).
8. **Whistle steps learn a time.** They are capped at 4 h and normalised by their rule (fixed unless written otherwise). This is the "usual time for that count" that design §3.4's "Can't hear it?" can use.
9. **Fixed keys from GC-4's 390.** Times logged against Cookpool's 370 random keys stop counting once 390 gives those steps fixed keys. Nothing is deployed, so no real times are lost.

**Not verified yet.** The milestone's "after 5 recorded cooks by 3 people, a step reads 'usually N–M min at this size · K cooks'" needs GC-5's step screen, GC-6's plan, and a stage deploy. The server half is covered end to end in `tests/kitchen-worker/src/learned.test.ts`: dishes are posted with step logs through the real write, then read back.

**Tests**

| Package | New | Suite |
|---|---|---|
| `tests/contracts` | `kitchen-learned.test.ts`: 26 — the percentile (examples, and seeded properties: matches a reference, bounds, monotonic in p, order-free, shift and scale) · normalise and scale round trip by rule, 1000 as identity, fixed at every size, cross-size · whole minutes (examples, = `stepTimeAt`'s rounding, properties) · the drops (10 s, 4 × at the size cooked, 4 h untimed, no size) · the range at 1000/450/2000 for linear, partly and fixed, the minimums counted after drops, no cook token, robustness to an odd cook · properties: whole minutes ≥ 60 and low ≤ high within the kept times, equal times read back, fixed size-free and partly/linear monotonic · the types | 248 |
| `tests/db` | 4 in `kitchen-guided-steps.test.ts`: one statement, the same pool from the root, a copy and a copy of a copy (one deleted), only the keys asked for, a recipe of its own apart · canceled, skipped and sizeless left out, the dish's factor as fallback · cooks as per-read numbers, no ids · the query plan | 805 |
| `tests/kitchen-worker` | `learned.test.ts`: 8 — under 5 times or 3 cooks there is no `learned`, and the fifth time and third cook bring it · 5 times from 3 cooks at five sizes give the right range at f = 1, 450 and 2000 for linear, partly and whistle steps, and `f` changes nothing else · canceled, skipped, abandoned (at 1× and 2×) and sizeless times are dropped and kept raw, and a dish canceled later leaves the pool · copies and a copy of a copy pool with the root, through its deletion, and a rewritten step starts over · a recipe of your own pools only with its copies · no cook id or name in the read · `learned` on the link read at `?f=`, on the writes at 1000, never on summaries · `?f=` 422s on both reads | 654 |
| `packages/sdk` | the recipe-paths test now covers `getRecipe(…, { f })` and `recipeByLink(…, { f })` | 181 |

`pnpm typecheck` passes repo-wide (52 tasks). `pnpm lint` passes for every touched package (`packages/contracts`, `packages/db`, `packages/sdk`, `apps/kitchen-worker`, `tests/contracts`, `tests/db`, `tests/kitchen-worker`). `orun task check GC-7 --base origin/main` passes: 7 changed components, all inside the contract.

### GC1 — Cookpool's recipes with guided steps (GC-4)

**What shipped.** Content only: one migration, its manifest entry, and tests. No worker, contract, SDK or console file changed.

- **Migration `390_kitchen_cookpool_guided`**, with its manifest entry and checksum. For each of 360's 42 recipes, one block of three statements:
  - `UPDATE kitchen_recipes SET tools = '[…]' WHERE id = '<360's fixed id>'`: two to four tools ("Pressure cooker", "Kadai with a lid", "Tawa", "Rolling pin and board", "Tadka pan", "Mixer jar", …).
  - `DELETE FROM kitchen_recipe_steps WHERE recipe_id = '<id>'`.
  - one plain `INSERT` of its guided steps, every column in the row (both seconds together; whistle steps leave them NULL).
- **Fixed keys** `c00c0390-<recipe>-<step>`, both two digits and the step counted from 1 (Masala chai's milk step is `c00c0390-32-04`). They are the same in every environment and in every copy saved from now on, so GC-7's pool hangs on them.
- **The content: 303 steps (215 before), 75 prep and 228 cook, 73 hands off.**
  - **Prep comes first** in every recipe: chopping, rinsing, soaking, marinating, kneading and resting.
  - **Every cook step has a flame** (0 off, 1 low, 2 medium, 3 high). A step done off the flame (mashing, mixing, garnishing, a drink) says 0.
  - **Every cook step has a checkpoint or a time.** Most have both. Chicken curry, the milestone dish, has a flame, lines, a range and a checkpoint on every cook step.
  - **The checkpoints** are the ones home cooks use: golden brown, the raw smell goes, oil shows at the edges, mustard seeds splutter, dal is soft and mashable, no pink inside, a bean mashes easily between your fingers, it leaves the sides of the pan. Each reads after "Until …".
  - **Time rules:**
    - `fixed` for tempering, boiling a pot of water, soaking, resting, the pressure dropping and a timed low flame;
    - `partly` for frying onions, searing, reducing a gravy, cooking more vegetables in one pan, and bringing the recipe's own water or milk to a boil;
    - `linear` only for work done once a piece: chopping, and rolling or frying rotis, parathas, puris, pakodas and omelettes one after another.
  - **Pressure cookers**, in 9 recipes: a whistles step (on high for beans and potatoes, medium for dal and rice, which froth), then a timed low flame where the recipe needs one (rajma 15–20 min, chole 20–25 min), then "let the pressure drop" as a hands-off step off the heat (10–15 min, or 15–20 for a full cooker of beans).
  - **Long prep:** rajma's and chole's overnight soak (8–12 h), sabudana's soak (5–8 h), and fried rice's rice, cooked and cooled ahead (1–3 h).
  - **Lines:** every line goes in at some step. A line split between steps ("half the cumin", "the rest of the ghee"), or chopped in prep and added later, is attached to each step that uses it.
  - **Text** is plain imperative words with no digits at all, so no amounts and no times. Tips and checkpoints have no digits either.

| # | Recipe | Steps (prep + cook) | Hands off | Long prep | Whistles |
|---|---|---|---|---|---|
| 01 | Kanda poha | 8 (3 + 5) | 1 | — | — |
| 02 | Rava upma | 7 (1 + 6) | 0 | — | — |
| 03 | Egg bhurji | 6 (2 + 4) | 0 | — | — |
| 04 | Masala omelette | 4 (2 + 2) | 0 | — | — |
| 05 | Sabudana khichdi | 8 (2 + 6) | 1 | 5–8 h | — |
| 06 | Aloo paratha | 10 (3 + 7) | 3 | — | 3 |
| 07 | Plain paratha | 6 (2 + 4) | 1 | — | — |
| 08 | Chapati | 6 (2 + 4) | 1 | — | — |
| 09 | Puri | 6 (3 + 3) | 1 | — | — |
| 10 | Dal tadka | 10 (2 + 8) | 3 | — | 3 |
| 11 | Dal fry | 10 (2 + 8) | 4 | — | 4 |
| 12 | Rajma | 11 (2 + 9) | 5 | 8–12 h | 3 |
| 13 | Chole | 13 (3 + 10) | 5 | 8–12 h | 2 |
| 14 | Sambar | 9 (2 + 7) | 6 | — | 4 |
| 15 | Tomato rasam | 7 (3 + 4) | 3 | — | — |
| 16 | Kadhi | 6 (2 + 4) | 1 | — | — |
| 17 | Palak paneer | 10 (1 + 9) | 0 | — | — |
| 18 | Paneer bhurji | 7 (2 + 5) | 0 | — | — |
| 19 | Matar paneer | 7 (2 + 5) | 1 | — | — |
| 20 | Aloo gobi | 6 (2 + 4) | 1 | — | — |
| 21 | Bhindi fry | 6 (2 + 4) | 0 | — | — |
| 22 | Baingan bharta | 7 (1 + 6) | 0 | — | — |
| 23 | Chicken curry | 9 (2 + 7) | 3 | — | — |
| 24 | Egg curry | 9 (1 + 8) | 2 | — | — |
| 25 | Fish curry | 9 (3 + 6) | 3 | — | — |
| 26 | Jeera rice | 6 (1 + 5) | 3 | — | — |
| 27 | Veg pulao | 9 (2 + 7) | 3 | — | — |
| 28 | Lemon rice | 9 (1 + 8) | 2 | — | — |
| 29 | Curd rice | 7 (1 + 6) | 3 | — | 4 |
| 30 | Moong dal khichdi | 7 (2 + 5) | 3 | — | 4 |
| 31 | Veg fried rice | 6 (2 + 4) | 1 | 1–3 h | — |
| 32 | Masala chai | 5 (1 + 4) | 0 | — | — |
| 33 | Filter coffee | 5 (0 + 5) | 1 | — | — |
| 34 | Sweet lassi | 3 (1 + 2) | 1 | — | — |
| 35 | Nimbu pani | 3 (1 + 2) | 1 | — | — |
| 36 | Onion pakoda | 6 (2 + 4) | 1 | — | — |
| 37 | Pav bhaji | 10 (2 + 8) | 3 | — | 3 |
| 38 | Veg sandwich | 6 (2 + 4) | 1 | — | — |
| 39 | Rava sheera | 6 (0 + 6) | 0 | — | — |
| 40 | Rice kheer | 6 (2 + 4) | 2 | — | — |
| 41 | Besan ladoo | 6 (1 + 5) | 2 | — | — |
| 42 | Gajar halwa | 6 (2 + 4) | 1 | — | — |

**Departures.**

- **The steps are replaced, not updated.** Design §6 says "by `UPDATE`s on the system rows". The number of steps changes for nearly every recipe (215 become 303), so each recipe's rows are deleted and inserted again, as the brief asked. The runner applies a migration statement by statement with no transaction and re-runs it whole after a failure. Each block deletes before it inserts, so a re-run leaves the same rows, and a test shows it.
- **Only steps and tools change.** Lines, names, `minutes`, `created_at` and `updated_at` stay as 360 wrote them. The guided totals don't always match the recipe card's `minutes`. Rajma's and chole's cook steps alone come to 60–80 min, plus the whistles. Besan ladoo comes to 63–87 min with its two cooling waits, against 40. The card's number is left for whoever owns it.
- **Keys are 14 characters, not 32 hex.** `STEP_KEY_RE` and 370's CHECK both allow them.
- **Copies saved before 390 keep their old steps**, with 370's random keys, because a copy never follows its source. Their times would pool under Cookpool's recipe as the root, but under keys the new steps don't have. Nothing is on prod yet. Stage could have such copies if GC-2's 370 was applied there before 390.
- **Times logged against the old random keys stop counting.** GC-7's `learned` pools by root and key. Once 390 gives Cookpool's steps their fixed keys, any time a dish logged against one of 370's random keys no longer matches a step, so GC-7 leaves it out. This is expected, and GC-7's status notes it too. No console sent a step log before GC-5, so no real times are lost.
- **Long prep is four recipes, not two.** Rajma and chole carry the overnight soak. Sabudana khichdi's soak (5–8 h) and fried rice's cooled rice (1–3 h) are just as real. Chicken curry's marinade is 30–90 min, so GC-2's rule (shortest time at least an hour) keeps it ordinary hands-off prep. Its tip says an hour or more in the fridge makes it more tender.
- **The pressure cooker's timed step is in the two bean recipes only.** RC-7's texts said 6–8 whistles for rajma and 6–7 for chole. 390 gives them 3 and 2 whistles, then 15–20 and 20–25 min on low, then the drop: fewer whistles, and the low flame does the slow cooking. Dals, khichdi, curd rice and the vegetables for pav bhaji and aloo paratha need no timed step. Veg pulao stays in a pot with a lid, and its tip gives the cooker way.
- **Whistle steps carry no checkpoint.** The count is what you watch for.
- **"Boiling a fixed amount of water" is read literally.** A pot of water whose amount doesn't change with the size (blanching, boiling eggs) is `fixed`. The recipe's own water or milk, which grows with the size, is `partly`.
- **Some prep steps are untimed** and not hands off: rinse the dal, tie the tea bag, beat the eggs, crumble the paneer. A cook step always has a heat and a checkpoint or a time. Prep needs neither.
- **The drinks' first steps are prep** ("Chill the curd and milk", "Chill the water", each with "Skip this if they're already cold"), so lassi and nimbu pani have three steps like every other recipe. Filter coffee and rava sheera have no prep.
- **A split line shows its whole amount at each step.** The chip is the line, and the text says "half the …" or "the rest of the …". This is the same as RC-7's texts. Splitting a line in two would change 360's lines, which 390 leaves alone.
- **Four older tests now expect 390's steps:**
  - RC-7's db test reads 360's steps through 380 for its 3-to-8 bound;
  - RC-7's kitchen-worker content test bounds the steps at `MAX_RECIPE_STEPS` (the guided suite checks them closely now);
  - GC-2's guided-steps suite expects Cookpool's steps under 390's keys and with tools, not as text-only cook steps;
  - CP-4's kitchen-migration rule required every kitchen migration to CREATE or ALTER. 390 only writes, so the rule now counts INSERT, UPDATE and DELETE too, still on `kitchen_*` tables only.
- **The generator stayed in the scratchpad.** `up.sql` is the source of truth, and it reads on its own: a comment heads each recipe's block with its counts.
- **Not checked on stage** (nothing deployed). `infra/db-migrate` is unchanged: it applies what the manifest lists. GC-5 (guided mode), GC-6 (the step editor and plan) and GC-7 (learned ranges) read these steps through `guidedSteps` and change nothing here.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/db` | 10. `kitchen-cookpool-guided-migration` has 9: registration right after 380; the text, three statements a recipe naming only the 42, plain INSERT with no IGNORE or REPLACE, each statement under 20 KB; every row landing under the CHECKs on top of 380, and a re-run leaving the same rows and tools; fixed keys per recipe and position, unique across all, prep before cook, a flame on every cook step, none of 370's random keys left; tools, 1–10 names of 1–40 characters, each once; the rules between columns (both seconds or neither, min ≤ max, whistles without seconds and fixed, a sense with its checkpoint, every wait timed) plus every line ref real and every line used; long prep for rajma and chole of 6–12 h, and exactly the four; whistles followed by hands-off steps to the drop off the heat; nothing else changing (Cookpool's lines, recipe rows but for tools, a person's recipe, a copy saved before 390). The 10th is 390's checksum case in `migrations.test.ts`. Adjusted: RC-7's step bound (through 380) and the kitchen migration rule (writes count). | 815 |
| `tests/kitchen-worker` | 47 in `cookpool-guided`, all through the real recipe read: one case for each of the 42 recipes, checking fixed keys, prep first, tools, a flame and a checkpoint or time on every cook step, a timer on every wait, whistles without seconds and never scaling, ranges of at least 30 s and at most 12 h for prep or 2 h for cook with the longest at most three times the shortest, no number with a unit in any text, every line ref real and every line used, and `longPrep` matching the rule. Then 5 more: rajma's and chole's soak first, as long prep of at least 6 h, with whistles, low flame and drop; the four long-prep recipes; Chicken curry's every cook step complete, its plan longer at 1 kg than at 750 g, and longer at 750 g than at 450 g, with the tempering unchanged; a copy keeping every step, key and tool; a cook's times on a copy of Masala chai pooling under Cookpool's recipe by `c00c0390-32-02` and `-04`. Adjusted: RC-7's step bound and GC-2's Cookpool read. | 701 |

Totals are for the tree with main merged in, after GC-7 (#74): its 805 and 654, plus GC-4's 10 and 47. GC-7's suites pass unchanged over 390's steps.

`pnpm typecheck` and `pnpm lint` pass for every touched package (`packages/db`, `tests/db`, `tests/kitchen-worker`). `orun task check GC-4 --base origin/main` passes: 4 changed components, all inside the contract.

### GC1 — writing guided steps, and the plan (GC-6)

**Built** (design §1, §2, §3.5, §8; the canvas's `GuideEditor` and `GuideTimeline`). The console only: `apps/web-console-next` and its tests. Everything renders only when `newFrame()` is true; no server, SDK or `/cook/session` file changed.

- **The step editor** (`/recipes/new`, `/recipes/[id]/edit`; `step-editor.ts` pure, `step-editor-ui.tsx`):
  - each step is a draft (`StepDraft`): the server's `key` it was read with, Prep | Cook, What to do, the lines that go in now (held by the form's line keys, so they follow the lines as they move or go, and turned into positions in the lines sent only on Save), the flame, None | Minutes | Whistles with the range (Shortest and Longest steppers) or the count, Hands off ("The cook can do the next steps meanwhile"), More food takes (Same time · A bit longer · Longer → fixed / partly / linear), Done when (Look · Smell · Sound · Feel · Taste and the checkpoint) and the Tip;
  - each step is a row — its number (tinted when hands off), its words and what is set ("Medium flame · 10–12 min · Until it looks golden brown") — that opens into the editor; a step with an error is held open;
  - **the live preview** shows what the cook sees at the recipe's own size: "THE COOK SEES · SERVES 4", the flame and time in words ("MEDIUM FLAME · 8–10 MIN · HANDS OFF"), the text, the chips with the amounts as written ("3 onions", "2 tbsp ginger-garlic paste", "Salt"), "Until it looks golden brown" and the tip;
  - **Save** sends every step with a key, or any guided field, as a `RecipeStepInput` with all its fields and its key (`stepWrite`), so keys survive edits, removals and line moves; a new step of text only is still its words (a string), so RC-5's plain steps stay valid; `formFromRecipe` reads `guidedSteps` (texts when the read has none);
  - **Tools** sit under the name: chips with ×, and a field with Add (up to 10, 1–40 characters, each once in any case); always sent, so a PATCH replaces the list;
  - **422s** land on the part they name (`errorsFromDetails`): `steps[i].text`/`steps[i]` on the words, `minSeconds`/`maxSeconds`/`whistles` on the time, `lines`, `heat`, `phase`, `handsOff`, `timeRule`, `sense`/`checkpoint` on Done when, `tip`; `tools[i]` on that tool; blanks left out are counted (`stepIndexes`, `toolIndexes`).
- **The recipe page** (`/recipes/[id]`):
  - **Long prep first** (`long-prep.ts`, `long-prep-ui.tsx`, `lib/long-prep-store.ts`): an amber card under the title, one row per long-prep step (`longPrep`, else `longPrepOf(guidedSteps)`) with its words and time ("· 8 h"), **Soak now · ping me** and **Already done**. Soak now calls `createTimer` with `{ label: <recipe name>, body: "Time's up: <step>", url: /recipes/<id> (+ ?code=), endsAt: now + its shortest time }`; once set the row reads "Started · we'll ping you at 8:00 pm". Ten timers running reads "You have 10 timers running. Cancel one to set this."
  - **The Steps list** (`stepRows`): each guided step's flames and "Medium flame", its range at the page's size by `stepTimeAt`, Prep, Hands off, "Until it looks golden brown" with the sense's icon, the learned badge ("Usually 7–9 min · 23 cooks", blue) when the read has `learned`, and the tip. A text-only step is its words alone.
  - **The plan** link sits beside Steps (`recipePlanHref(id, f, code)`: `/recipes/<id>/plan?f=450`).
- **The plan** (`/recipes/[id]/plan`; `planOf` in `guided-steps.ts`, `plan-views.tsx`, `plan-ui.tsx`): the recipe's own static shell (`/recipes/_/plan`), added to `STATIC_PAGES` (a 13th `_redirects` rule), `NEW_FRAME_ONLY` (prod → Home) and Back's parents (→ the recipe); no pull to refresh. It has:
  - the size switch, "450 g · about 2" | "1 kg · 4" (`?f=` and the recipe's own), or the own size alone;
  - In all · Hands on · Waiting;
  - one row per step: its number (tinted when hands off), words, range at this size ("7–8 min · hands off"), learned badge, rule in words (Same at any size · Partly follows the amount · Follows the amount) and a bar;
  - the Meanwhile line under a hands-off step;
  - **Start step by step** → `/cook/session?recipe=<id>&f=<f>` (GC-5's seam).

  The recipe is read at the size on screen (`getRecipe(id, { code, f })`, GC-7) under `qk.kitchenRecipeAt(id, f)`, which sits under `qk.kitchenRecipe(id)` so writes and patches reach it.

**Departures**

1. **Time has a third choice, None**, beside Minutes | Whistles: an untimed step must be writable. The range is two steppers (Shortest, Longest), not the canvas's one "8–10 min" with only − on the low end and + on the high. They step 1 min under 10 min, 5 under an hour, 15 under 3 h, then an hour (a soak of 8 h is a few taps), from 1 min to a day. Either end pushes the other. A step's seconds that are off the minute grid stay as read until touched. Switching kinds keeps the other kind's numbers.
2. **No per-step Save.** The canvas's "Save step" is the form's own Save; a step only opens and folds.
3. **Picking the lit flame again clears it** to "no flame" (null), which is not Off (0). A sense picked with no checkpoint is not sent (the server needs one), and a lit sense picked again clears it. A guided step with no words is "Say what to do", not left out.
4. **The checkpoint's words.** "Until it looks golden brown" takes the sense's verb (looks, smells, sounds, feels, tastes). Words that are a sentence already ("the raw smell goes", "it stops sizzling": they start with the, a, it, they, no…) read "Until the raw smell goes", and a leading "until" is not said twice. Without a sense: "Until golden brown".
5. **The preview is at the recipe's own size** ("serves 4", amounts as written), as the task says; the canvas shows "for about 2".
6. **The learned badge.** The recipe page reads without a size, so every stepper tap shares one cache entry. Its ranges come at × 1 and are scaled to the page's size by the step's rule (`learnedAt`, `wholeStepMinutes`), the arithmetic GC-7 does. The plan reads at its size and shows them as sent. Until that read answers, it paints from the last size's answer or the recipe page's, scaled from the size it was read at. Whistle steps show theirs too: the usual time the count takes (GC-7 departure 8).
7. **Long prep:**
   - the card sits under the title, above How much;
   - the button's verb is the step's first word when it is a long-prep verb (Soak, Marinate, Rest, Rise, Proof, Chill, Ferment, Brine, Steep, Thaw, Defrost, Set), else "Start now · ping me";
   - **Already done** is kept in localStorage (`<prefix>.long-prep`, by recipe and step key) for 24 h; a started timer counts as done once it ends, for a day more;
   - Already done on a started row also cancels its timer (best effort);
   - a row that is done leaves the card, and the card goes when all are;
   - the record is forgotten on sign-out (`clearDeviceRecords`, the one line added to `lib/sign-out.ts`);
   - "Turn on notifications to hear timers" (§4) is not shown here.
8. **The plan's totals** add each timed step's middle at the size, rounded to minutes. Hands on is the steps that are not hands off; Waiting is the rest. Time saved by doing steps meanwhile is not taken off, as on the canvas. **Long prep and whistle steps stay outside the totals**, and a line says so: "Long prep (8 h) comes first and isn't counted. Whistle steps aren't counted: their time is the cooker's." Bars are against the longest step of the cooking, so the soak has none. A long prep row reads "Long prep · do it first", with no Meanwhile.
9. **Meanwhile** names the steps after a hands-off step up to the next hands-off one, without numbers: "Meanwhile: Chop the coriander · Flame off, coriander, taste", and "· +N more" past three. It is empty when the next step waits too, and for long prep.
10. **The plan link shows only when some step has a time** (a plan of texts says nothing). It carries `?f=` (left out at × 1) and the link code.
11. **The Steps list shows Prep and the tip too**, beyond the flame, range, checkpoint, Hands off and learned badge asked for. It does not show the line chips: the ingredients are listed just above.

**Not verified yet:** nothing ran in a browser. The console has no local API, and this task does not call stage. It is covered by rendering every view in tests, by `next build` (which prerenders `/recipes/_/plan`), and by GC-2's and GC-7's server tests for the write and read shapes. The milestone's Chicken curry check waits for GC-4's 390.

**Tests** (`tests/web-console-next`, 84 suites, 1674 tests)

| File | New | What |
|---|---|---|
| `kitchen-step-editor.test.ts` | 33 | A guided recipe's edit form: keys and lines as line keys, sent back exactly; texts when there are no `guidedSteps`; whistles. Each field into the write body: phase, words, lines, flame (and cleared), minutes and whistles never both, hands off, the three rules, sense only with a checkpoint, tip, a new step without a key. Keys kept across edits, a removed step and moved or removed lines; blank plain steps left out, wordless guided ones refused. The 422 mapping, every part and tools, blanks counted, and the fallbacks. The stepper's grid and bounds, min ≤ max, whistles 1–10. The preview's words (flame, time, Hands off, chips, the checkpoint by sense and as a sentence, prep, serves), drawn. The folded summary. The editor drawn folded and opened on an error. Tools: once, ≤ 10, ≤ 40, sent always, a repeat refused, drawn. |
| `kitchen-guided-recipe.test.ts` | 26 | The Steps list at 450, 1000 and 2000 by `stepTimeAt`; flames, checkpoints, Hands off, Prep. Learned when present, at the page's size by rule, or as read at the read's size, and absent otherwise; whistle steps; garbage refused. Texts only; chips. Drawn, with The plan's link. Long prep: listed or derived; the verb and duration; the `createTimer` body (url back to the recipe, `?code=`, clipped label and body); `createTimer` called once and remembered; ten timers, the server's words, offline; done for a day, started until its end, then done; the memory parsed and pruned; the card drawn idle, started and empty. The plan: its address and `?f=`; the sizes and labels; the totals at 450 and 1000, and against `stepTimeAt` at five sizes; each row's range, learned, rule words and bar; Meanwhile and +N more; long prep and whistles outside the totals, and the note; drawn with the switch, the tinted number and Start's link; the sized read's query and key. Prod: redirected Home, shown on stage, the static shell, Back. |
| changed | — | `kitchen-recipe-form.test.ts`: steps as drafts, `tools: []` in the body. `static-pages.test.ts`: 13 rules, the plan's. `gestures.test.ts`: the plan does not pull. `kitchen-cook-hub.test.ts`: the plan among the new-frame-only pages, and its Back. |

`next build` passes (it prerenders `/recipes/_/plan`). `pnpm typecheck` passes repo-wide (52 tasks), and lint passes for `apps/web-console-next` and `tests/web-console-next`. `orun task check GC-6 --base origin/main` passes: 2 changed components, all inside the contract.

### GC2 — guided mode (GC-5)

**What shipped.** The console only (`apps/web-console-next`), behind `newFrame()` like the session itself: `/cook/session` is new-frame only, and `guidedScreen(s, newFrame())` is null in today's frame.

- **The draft** (`components/kitchen/cook-guide-draft.ts`): RC-6's `CookSession` gains an optional `guide` — `mode` (`null` until the prompt is answered, then `guided` or `tick`), the recipe's guided steps (with GC-7's `learned`) and tools, `screen` (`prep`/`step`/`done`) and `current`, `cookStartedAt`/`finishedAt`, `times` per step key (`startedAt`, `doneAt`), `prepDone`, `toolsDone`, `timers` (id, step key, label, body, `endsAt`, `pausedLeftMs`, `totalMs`, `serverId`, `push` `pending`/`set`/`here` with a `pushNote`, `rang`, `seen`), `cancels` (server timers still to cancel), `whistles`, `screenOn` and `timesSaved`. `parseGuide` reads it back; `guideStepLog` is what Finish posts.
- **The changes** (`cook-guided.ts`, pure): `guidedSessionFromRecipe` (RC-6's session plus the guide when `guidedSteps` is non-empty), `chooseMode`, `startCooking`, `goToStep` (`go` starts a step, `look` only shows it), `stepBy` (swipe and Back), `markStepDone`, `backToSteps`, `tickPrep`, `tickTool`, `longPrepDone`, `startTimer`, `startAndGoOn`, `pauseTimer`, `resumeTimer`, `addMinute`, `seeTimer`, `countWhistle`; the server side as a plan (`timerWork`: create, cancel, hand over, short, ring, quiet) and its answers (`afterCreate`, `afterCancel`, `handOver`, `markShort`, `markRang`), run by `runTimerWork` against injected routes; `todaysStepTimes`/`writtenStepTimes` for Use today's times.
- **The screens** (`cook-guided-screens.ts` view-models, `cook-guided-ui.tsx` drawing, `cook-guided-screen.tsx` wiring):
  - **The prompt** (`GuidePrompt`): long prep first as the amber card ("Soak the rajma in plenty of water · 8 h first", its lines as chips, **Soak now · ping me** and **Already done**); "Cook it step by step" with steps, about N minutes and N hands on (via `stepTimeAt` at the session's factor), the hands-on/waiting bar and Before you start; **Start step by step** (the main button, cook colour; dimmed and disabled until long prep is done) and **Just tick what I use**.
  - **Before you start** (`GuidePrep`): Gather is RC-6's own `SessionRow`s (the same ticks and ± amounts), then Tools and Prep with 44 px ticks; a hands-off prep step has **Start N min**; "N of M ready"; **Start cooking · Step 1 of N**.
  - **A step** (`GuideStep`): "STEP k OF N · M MIN IN", read aloud, the plan link (`/recipes/<id>/plan?f=<factorMilli>`, GC-6's); progress segments (done, current, running, to do); the timer strip; the flame card ("Low/Medium/High flame", "Flame off", "Stay close" on high); the text at 26 px; the step's lines as scaled chips that tick the session's lines; the checkpoint card on #E4F2EA ("LOOK FOR", "Until golden brown"); the timer card (ring, range at this size, "Usually 7–9 min at this size · 23 cooks" only when `learned` is there, Start / Pause / Resume / +1 min, **Start and go on** for a hands-off step); the tip; "Next · …", Back and **Done** (herb green), **Finish** on the last step. Swipe left and right between steps (PW-7's `listenForDrags`, never from the left 20 px, where the installed app swipes back).
  - **Waiting** (`GuideWait`): a hands-off step with its timer set, or any whistle step: the big ring with +1 min, Pause/Resume and Done early; "We'll ping you when it's done"; **Keep the screen on**; **Meanwhile** (unticked prep, then the steps after this one up to the next hands-off step, each with **Do it**); "Go on to step k · the timer keeps running". A whistle step shows "1 of 3 whistles" as circles and **Count a whistle**; at the count it ticks the step, opens the next and starts its timer; "Can't hear it? Ping me at about 13 min" when the step has a learned time.
  - **Done** (`GuideDone`): "Chicken curry is done", the time in all, hands on, steps done, cost; **How each step went** (today's time on a bar against the usual range at this size — `learned`, else the author's range); **Use today's times next time** on your own recipe or copy (`updateStepTimes` with today's times ÷ `stepTimeMultiplier`, whole minutes); then **Who ate?**, which opens RC-6's Finish sheet.
  - **The banner**: a timer that ends in view rings (Web Audio beeps, `navigator.vibrate` where it exists) and shows its push's words with "Open step k", until dismissed or its step is ticked.
- **Server timers** (GC-3): every timer started sets one (`label` "Simmer done · Chicken curry", `body` "Next: Chop the coriander", `url` `/cook/session`); Pause, +1 min, Done, Done early, ticking a prep step, Just tick, Discard and Finish cancel. While the page is visible, a timer within 5 s of its end is taken over: its server timer is cancelled and the page rings it. 422 `too_many_timers` (or any refusal) leaves the timer running here, saying "Rings here only: 10 timers are set already". With no push on this device (`readDeviceState`: no permission or no subscription), a running timer says "Turn on notifications to hear timers with the phone locked", linking to `/you/notifications`.
- **Screen on**: `navigator.wakeLock.request("screen")` while a guided screen past the prompt is visible and the switch is on, taken again on `visibilitychange`; where it is refused or missing, "Your phone won't keep the screen on".
- **Read aloud**: `speechSynthesis` reads the step, then its checkpoint; leaving the step stops it.
- **Finish** posts `stepLog` with the dish (`finishPlan`): every cook step with both a start and a tick, in step order; prep is not logged, and Just tick sends none.
- **GC-7, merged in:** steps use the contracts' `learned?: LearnedStepRange`, and the session reads its recipe with `getRecipe(id, { f })`, under GC-6's `qk.kitchenRecipeAt(id, f)` (the recipe's own key, so refreshing the recipe refreshes it).
- **GC-6, merged in:** the step header's plan link is GC-6's `recipePlanHref(id, f)` (`/recipes/<id>/plan?f=`). The session's long prep agrees with the recipe page's (GC-6's `lib/long-prep-store.ts`): a soak started or marked done there is so in the session's prompt (`withLongPrepMemory`, when the session starts) — a running one adopted with its server timer, not set twice — and what the session does is written back (`longPrepMarks`), so the page shows it too.

**Departures.**

1. **One draft, same version.** The guide is an optional field of RC-6's draft at `SESSION_VERSION` 1, not a new version: a draft from before reads as it was, and a guide that can't be read is dropped while the lines stay. The guided steps are copied into the draft (as RC-6 copies lines and steps), so a reload cooks on without the recipe read.
2. **Any recipe with guided steps gets the prompt**, text-only steps included (design §3.1: "a recipe that has steps"). Only a recipe without `guidedSteps` (or with none) skips it.
3. **Prep is not counted in "STEP k OF N".** Prep steps are listed in Before you start (long prep there too, after its card on the prompt) and in Meanwhile; the steps one at a time are the cook steps. The prompt's minutes and hands on include non-long prep.
4. **Long prep holds the start.** Start step by step stays disabled ("After: Soak the rajma…") until long prep is ticked, as the canvas draws it. A soak timer that ends reads "Time's up" with **Done**; it is not ticked by itself (decision 2). The card's title is the step's text with its time ("· 8 h first") and its lines as chips, not "Soak 1 cup rajma for 8 h" — design §1 keeps amounts out of the text.
5. **How long a timer runs**: the low end of the learned range when there is one, else the low end of the author's range at this size — the checkpoint says when it is done.
6. **Timer words** come from the step's text: the last of a list of waiting verbs it uses ("…cover and simmer" → "Simmer done"), else "Step k done" or "Prep done". The body is "Next: <the next step>", "Next: Who ate?" after the last, "Next: start cooking" for prep.
7. **A step's start** is set when the cook goes to it (Done, Start cooking, Do it, the strip, a banner), not when they only look (swipe, Back); a step ticked without one started when it was shown. A hands-off step starts when it opens and ends when it is ticked — Done early is Done.
8. **Finish ends the cooking.** On the last step (or once every other step is ticked) the button reads Finish and opens Done, even with a hands-off step still unticked: Done lists it as "Not ticked", and its timer stays in Done's strip until Discard or Finish cancel it. Done elsewhere opens the next unticked step after it, else the first before it.
9. **Whistles**: at the count the step is ticked, the next opens and its timer starts (design §3.4); a cooker counting shows in the strip once gone on from. A mis-counted whistle can't be taken back.
10. **Do it on a prep row ticks it**: prep has no step screen to jump to. Do it on a step opens it.
11. **The ring and the push.** A timer that ended while the page was hidden (its push sent) and is seen 30 s or more later is marked without a sound; seen sooner, the page rings it too, so a push sent in those seconds can come with a ring. A timer under 35 s rings only here (the server takes 30 s and more). A failed cancel stays in `cancels` and is tried again after 15 s; Discard and Finish send their cancels without waiting, as the draft is cleared right after.
12. **Just tick what I use takes the timers out of the session**: RC-6's screen has none. Each is cancelled but a long prep's (a soak), which keeps pinging and shows on the recipe page. RC-6's screen drains the cancels (`useGuideTimers`) and cancels on Finish and Discard; nothing on it shows.
13. **Use today's times is a switch that writes at once** — on writes today's times, off writes the recipe's own back — rather than waiting for Who ate. Only steps that already have a time range are written (not whistle or untimed steps), as one time (min = max) in whole minutes.
14. **"Your Nth cook" is left out.** There is no cheap count: your page reads 8 weeks of dishes, and Done would need them all.
15. **The keep-screen-on switch is on the Waiting screen only** (design §3.4); the prompt says "Your screen stays on while you cook", or that the phone won't. The lock is held from Before you start on, not on the prompt.
16. **RC-6's code moved, unchanged**: the Finish sheet to `cook-finish-sheet.tsx` and the item refresh to `useFreshTakes` (`cook-session-data.ts`), so both screens share them. Guided Gather has no Add an item (Just tick does).
17. **Signing out** forgets the draft (RC-6) and the recipe page's long prep (GC-6) but not their server timers: one set before signing out still pings.
18. **Discard and Finish leave a soak pinging.** The rajma is still soaking, and the recipe page has it; Already done (here or there) cancels it. Every other timer is cancelled.

**Not verified yet.** Nothing is deployed, and the screens were not run in a browser (the session needs a sign-in, and this task does not call stage). On stage, on an iPhone (the installed app): a soak started on the recipe page shows as running in the session's prompt (with no second push); the screen stays on through a step and the Waiting screen, and comes back on after locking and unlocking; a simmer started then locked reaches the phone as a push within a minute of its end, and with the app open it rings once (the push cancelled); read aloud speaks the step and its checkpoint; swipe moves between steps without fighting the edge swipe back; Chicken curry cooks from the prompt to Who ate and Done shows each step's time.

**Tests**

| Package | New | Suite |
|---|---|---|
| `tests/web-console-next` | `kitchen-cook-guided.test.ts`: 44 — the draft (the guide from a recipe, none without steps, the mode, steps, ticks and timers, a reload, a bad guide dropped, the screens and the new frame) · the prompt with and without long prep (stats, bar, Before you start, Soak now with the step's time, Already done) · long prep with the recipe page's memory (done there, started there adopted, written back, a soak kept past Discard) · prep (Gather's ticks, tools, prep, "N of M ready", Start 15 min into the strip, Start cooking) · the step (header, segments, plan link, flames, scaled chips, checkpoint, timer and learned range shown or absent, tip, Done and Finish, swipe only looks) · hands off (Start and go on, the strip, waiting, the banner) · Meanwhile · whistles (the count, Can't hear it?, the strip, the next step's timer) · Done (rows, the cost, Use today's times' body and its undo, only for your own) · the posted `stepLog` · Just tick unchanged · prod. `kitchen-cook-guided-timers.test.ts`: 23 — server timer create and cancel (start, Pause, Resume, +1 min, a tick, Discard), the visible hand-over and one ring, hidden left to the push, too short, a stale create cancelled, a failed cancel retried · `too_many_timers` and other refusals · the push hint · the wake lock (mocked: taken, released, retaken on visibility, waits for visible, refused, missing) · read aloud (mocked) · the bell (mocked) · swipe. `kitchen-cook-guided-content.test.ts`: 3 — Cookpool's 42 recipes, read from GC-4's 390, each open on the prompt (long prep holding the start) and cook from the first step to Done: every step shows, every push fits GC-3's bounds, whistles count, the step log has every cook step. Fixtures in `kitchen-cook-guided-fixtures.ts` (GC-6's `kitchen-guided-fixtures.ts` is its own). RC-6's 52 tests pass unchanged. | 1744 (87 suites) |

`pnpm typecheck` and `pnpm lint` pass for `apps/web-console-next` and `tests/web-console-next`; `next build` passes (`/cook/session` 33 kB). `orun task check GC-5 --base origin/main` passes: 2 changed components, all inside the contract.
