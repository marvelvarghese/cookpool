# cookpool-guided — design

The canvas row "Guided cooking — step by step" is the reference for every screen. The rules from cookpool-simpler (§4) and cookpool-recipes (design §1) still apply: five tabs, the session as a device draft, stage first behind `newFrame()`.

## 1. A guided step

A recipe step (RC-4's `kitchen_recipe_steps`) gains these fields. All are optional: a step with text only is still valid, and guided mode shows it one at a time with Done.

| Field | Values | Notes |
|---|---|---|
| `key` | uuid | Stable across edits and copies. It is what the time records and learned ranges hang on (§5). |
| `phase` | `prep` · `cook` | Prep steps are listed in Before you start (§3.2). |
| `lines` | recipe line positions | The ingredients that go in at this step. They show as chips with scaled amounts, and tick the session's ingredient lines. |
| `heat` | 0 off · 1 low · 2 medium · 3 high | Drawn as one to three flames. |
| `minSeconds`, `maxSeconds` | a range, as written for the recipe's own size | "8–10 min". If both are equal, it's one time. |
| `whistles` | 1–10 | For a pressure cooker, instead of seconds. The count never scales. |
| `handsOff` | bool | The cook can go on to other steps while it runs (§3.4). |
| `timeRule` | `fixed` · `partly` · `linear` | How time grows with the size factor `f`: × 1, × f^0.5 or × f. The editor calls these "Same time", "A bit longer" and "Longer". |
| `sense` | `look` · `smell` · `sound` · `feel` · `taste` | The checkpoint's sense. |
| `checkpoint` | ≤ 80 characters | "golden brown", "the raw smell goes". It is shown as "Until it looks golden brown". |
| `tip` | ≤ 160 characters | One line, shown under the step. |

A recipe also gains **tools**: up to 10 short names, such as "Kadai with a lid" or "Pressure cooker".

**Long prep.** A prep step that is hands off and at least 60 minutes long is long prep (soaking, marinating overnight). The recipe read lists such steps in `longPrep`. The recipe page and the session's prompt show them first, with "Soak now · ping me" (a server timer, §4) or "Already done".

**Text stays plain words.** The author writes "Add the onions and a pinch of salt", attaches the Onions and Salt lines, and the cook sees "1½ onions" as a chip. There are no template tokens in the text.

## 2. Time at a size

`stepTimeAt(step, factorMilli)` in `packages/contracts` (beside `scaleLine`) returns the step's range at size `f`:
- `fixed`: as written.
- `partly`: × f^0.5.
- `linear`: × f.
- It rounds to whole minutes, never under 1 minute, and keeps `min ≤ max`.
- Whistles are returned as they are.

The plan and the step screen both use it.

## 3. Guided mode (console)

Guided mode is a mode of RC-6's session (`/cook/session`), not a new place. The draft gains:
- `mode`: `guided` or `tick`;
- the current step;
- each step's `startedAt` and `doneAt`;
- the prep ticks;
- the running timers: id, label, step key, `endsAt`, and the server timer id.

The draft stays on the device, survives reloads, and is cleared on Finish, Discard or sign-out.

### 3.1 The prompt (`GuidePrompt`)

Opening a session from a recipe that has steps shows the prompt:
- **"Cook it step by step"**: steps, about N minutes, N hands on.
- A bar split into hands-on and waiting time.
- **Before you start**: the prep, the tools, and the timers that start then.
- **Start step by step**, the main button.
- **Just tick what I use**, which keeps today's RC-6 screen.

Long prep (§1) comes first, and the guided card stays dimmed until it is done or dismissed. A recipe without steps skips the prompt.

### 3.2 Before you start (`GuidePrep`)

Three lists with 44 px ticks: **Gather** (the ingredient lines, the same ticks as RC-6's session), **Tools** and **Prep**. A hands-off prep step has a **Start N min** button, and its timer joins the strip. Progress shows as "6 of 10 ready". Start cooking works with anything unticked.

### 3.3 One step (`GuideStep`)

- **Header:** minimize, "STEP 3 OF 8 · 14 MIN IN", read aloud, and the plan.
- **Progress:** one segment per step.
- **The timer strip:** other steps' running timers. Tapping one jumps to its step.
- **Flame card:** the flames and "Medium flame".
- **The text**, in large type.
- **Ingredient chips**, scaled, that tick.
- **The checkpoint card:** the sense icon, "LOOK FOR", then "Until golden brown".
- **The timer card**, when the step is timed: a ring, the range at this size, and "Usually 7–9 min at this size · 23 cooks" when it has been learned (§5). It has Start, Pause and +1 min. A hands-off step's Start reads **Start and go on**: it starts the timer and moves on.
- **The tip.**
- **Bottom:** "Next · …" and **Done** (the main button), with Back beside it. Done on the last step reads **Finish**. You can also swipe between steps.

### 3.4 Waiting (`GuideWait`)

A hands-off step that is running opens as a big ring, with +1 min, Pause and Done early. Below it:
- "We'll ping you when it's done";
- **Keep the screen on**;
- **Meanwhile**: unticked prep, then the steps after this one up to the next hands-off step, each with **Do it**.

A whistle step shows the count instead, "1 of 3 whistles", with a large **Count a whistle** button. Once the count is reached, the next step's timer starts. "Can't hear it?" pings at the usual time for that count, when there is one.

### 3.5 The plan (`GuideTimeline`, `/recipes/[id]/plan`)

- A size switch: today's size, and the recipe's own.
- Three totals: in all, hands on, waiting.
- One row per step: its range, its learned badge, its rule in words, and a bar.
- Hands-off steps are tinted, with their Meanwhile line under them.
- It opens from the recipe page and from the session's header.

### 3.6 Done (`GuideDone`)

- The total time, "Your 12th cook".
- Hands on, steps done and the cost.
- **How each step went:** the real time on a bar, against the usual range at this size.
- **Use today's times next time** (your own recipes and copies): it writes today's times back to the steps, divided by the size rule.
- Then **Who ate?**, which opens RC-6's Finish sheet.

Posting sends the step log with the dish (§5).

### 3.7 On the phone

- **Screen on:** the Screen Wake Lock is held while a guided session is visible. It is taken again on `visibilitychange` and can be turned off.
- **Read aloud:** `speechSynthesis` reads the step and its checkpoint.
- **A timer ending in the app:** a short sound (Web Audio), plus vibration where the device supports it, and a banner.

## 4. Timers that find you

- `POST /v1/kitchen/me/timers` with `{ label, body, url, endsAt }` returns a `tmr_` id. `DELETE /v1/kitchen/me/timers/{id}` cancels it, and `GET /v1/kitchen/me/timers` lists the active ones.
- kitchen-worker's `scheduled()` gains a **per-minute** cron (`* * * * *`, beside the daily sweep). It finds timers due and not sent, and asks notifications-worker to push them to that person's devices. That is a new internal route, with the push tagged by the timer id. Sent timers are marked; anything older than a day is purged.
- Timers are explicit: one set by the cook is pushed to every device they have subscribed. No preference toggle is involved.
- Guided mode creates a server timer whenever it starts one, and cancels it on Pause, Done early, or when the step is ticked. When the page is visible at the end time it rings itself and deletes the server timer just before, so the phone doesn't get a second ping.
- With no push subscription on any device, a timer reads "Turn on notifications to hear timers with the phone locked", linking to You → Notifications.

## 5. Learning from cooks

- **What is recorded.** The dish write (`POST /v1/kitchen/me/dishes`) gains `stepLog: [{ key, startedAt, doneAt }]`. One row is kept per step in `kitchen_dish_step_times` (dish, recipe root, step key, seconds, factor, cook).
- **The recipe root.** A recipe's root is the first recipe its copies came from: Cookpool's own recipe, or yours for recipes you wrote. Copies keep their step keys, so everyone who cooks the same recipe, copy or not, adds to one pool.
- **The learned range.** The recipe read returns `learned` per step, when the step's key has at least 5 times from at least 3 cooks:
  - each time is normalised to f = 1 with the step's rule;
  - the 25th–75th percentiles are taken;
  - they are scaled back to the caller's size, as `{ lowSeconds, highSeconds, cooks }`.
- **Privacy.** Only counts and ranges leave the server, never who.
- **Use today's times** is a `PATCH` of the steps' `minSeconds`/`maxSeconds` on your own recipe. It changes only your recipe, not the pool.

## 6. Storage

| Migration | Task | What |
|---|---|---|
| `370_kitchen_guided_steps` | GC-2 | `kitchen_recipe_steps` gains `step_key`, `phase`, `line_refs` (JSON array of positions), `heat`, `min_seconds`, `max_seconds`, `whistles`, `hands_off`, `time_rule`, `sense`, `checkpoint`, `tip`, plus a backfill of keys for existing steps. `kitchen_recipes` gains `tools` (JSON). New `kitchen_dish_step_times` (dish_id, recipe_root_id, step_key, seconds, factor_milli, cook_id, created_at), indexed on (recipe_root_id, step_key). |
| `380_kitchen_timers` | GC-3 | `kitchen_timers` (`tmr_` id, user_id, label, body, url, ends_at, sent_at, canceled_at, created_at), indexed on (ends_at) where unsent |
| `390_kitchen_cookpool_guided` | GC-4 | Cookpool's 42 recipes rewritten with guided steps and tools, by `UPDATE`s on the system rows, with fixed step keys |

## 7. API

| Route | Task |
|---|---|
| recipe create/patch/read and copies carry the step fields, `tools` and `longPrep` | GC-2 |
| `POST /v1/kitchen/me/dishes` gains `stepLog` | GC-2 |
| `PATCH /v1/kitchen/me/recipes/{id}/step-times` `{ steps: [{ key, minSeconds, maxSeconds }] }` (Use today's times) | GC-2 |
| `GET/POST /v1/kitchen/me/timers`, `DELETE /v1/kitchen/me/timers/{id}` | GC-3 |
| notifications-worker internal `POST /v1/notifications/push-to-subject` (service binding only) | GC-3 |
| recipe read's `steps[].learned` | GC-7 |

## 8. Console

| Where | Task |
|---|---|
| `/cook/session`: guided mode (prompt, before you start, step, wait, done), the timer strip, wake lock, read aloud, swipe, server timers, the step log | GC-5 |
| `/recipes/new` and `/recipes/[id]/edit`: writing guided steps (`GuideEditor`) and tools | GC-6 |
| `/recipes/[id]`: structured steps in the Steps list, long prep first, a link to the plan | GC-6 |
| `/recipes/[id]/plan` (`GuideTimeline`) | GC-6 |

## 9. Out of scope

- Voice commands.
- Video or step photos.
- Planning two recipes at once (beyond Meanwhile's hint).
- Connected appliances.
- Nutrition.
- Translating steps.
