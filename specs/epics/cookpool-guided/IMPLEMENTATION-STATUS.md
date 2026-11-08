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
  - Main gained RC-8's console screens (#70, #71) after this branch was cut. Merged with them, `apps/web-console-next` and `tests/web-console-next` still typecheck.

**Tests.**

| Package | New | Total |
|---|---|---|
| `tests/db` | 16, plus 370's checksum case in `migrations.test.ts`. `kitchen-guided-steps-migration` 9: registration; additive text; the backfill over 360's steps and a person's; every CHECK between and within columns; the unique key per recipe; tools; step times' PK, FKs, ranges and index; INSERT OR IGNORE silently skipping a bad step. `kitchen-guided-steps` 7: every field and the tools written and read in three statements; refusals; an edit keeping keys; step-times by key for the owner only; the root through a copy of a copy, a deleted link and the 8-hop cap; a dish's times in its own batch, with none on a refused dish or a replay. | 778 |
| `tests/contracts` | 13 (`kitchen-guided-steps`). Examples. Seeded properties over thousands of cases: × 1 is the identity for every rule, and fixed at every size, on the minute grid; every result is whole minutes, at least 60 s, min ≤ max, within 30 s of exact; partly and linear are monotonic in f; partly lies between fixed and linear; whistles are untouched. Long prep. The route shapes. | 201 |
| `tests/kitchen-worker` | 17 (`guided-steps`): create/read with every field, tools and long prep; plain and Cookpool steps; long prep's rule; 30 step 422s and 6 tool 422s, plus the limits and nulls; copies (and a copy of a copy) keep keys; a PATCH keeps sent keys and mints for new, unknown and repeated ones; plain texts keep their step; fewer lines prune refs; other fields leave steps be; `fromDishId` steps; the step log under the root of a copy of a copy, with the ignored entries; money unchanged with a log; 7 step-log 422s; step-times sets only those steps; owner only (co-members, a viewer, a stranger, Cookpool's, deleted: 404); 13 step-times 422s; 401/405. | 599 |
| `packages/sdk` | 1 (guided steps, tools and the step log as sent), plus `updateStepTimes` on the recipe paths test | 176 |

`pnpm typecheck` passes repo-wide (52 tasks). `pnpm lint` passes for every touched package (`packages/db`, `packages/contracts`, `packages/sdk`, `apps/kitchen-worker`, `tests/db`, `tests/contracts`, `tests/kitchen-worker`). `orun task check GC-2 --base origin/main` passes: 8 changed components, all inside the contract.
