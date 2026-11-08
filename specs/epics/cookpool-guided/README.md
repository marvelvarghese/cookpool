# Epic: cookpool-guided (GC)

**Cookpool's recipes say what goes in. This epic makes them cook with you, step by step.**
- **A step says everything you need.** It gives the flame, the ingredients it uses (already scaled), a time range, and a checkpoint for the moment it's done: the onions turn golden, the raw smell goes, the oil shows at the edges.
- **Before you start** gathers ingredients, tools and prep. Long prep, like soaking rajma for 8 h, shows up front rather than mid-cook.
- **During cooking**, you tick each step and the next one comes up. Hands-off steps (simmer, rest, pressure-cook) run a timer, and while it runs the app shows what you can do meanwhile. Timers survive closing the app, ring in it, and reach a locked phone. The screen stays on.
- **Pressure cookers count whistles.**
- **Times get better with use.** Each step's real time is kept with the size cooked, so after a few cooks a step reads "usually 7–9 min at this size".
- **Done** shows how each step went, then Who ate posts the dish as today.

It is built the way a good workout app works: one thing at a time, big targets, the plan always one tap away.

## Status

| Field | Value |
|-------|-------|
| Status | In progress — GC0 landing |
| Cluster | **GC** (GC0–GC4) |
| Owner(s) | **Step model, timers and learning:** `apps/kitchen-worker`, `packages/db`, `packages/contracts`, `packages/sdk`. **Timer pushes:** `apps/notifications-worker`. **Guided mode, the step editor and the plan:** `apps/web-console-next`. |
| Builds on | `cookpool-recipes`: RC-4 recipes and steps, RC-5 the recipe page and form, RC-6 the cooking session, RC-7 Cookpool's recipes. `cookpool-app` (PW-5/PW-6 Web Push). |
| Changes | **Recipe steps:** a step gains a phase (prep or cook), the ingredients it uses, a flame, a time range or a whistle count, hands-off, how its time scales, a checkpoint (look, smell, sound, feel, taste) and a tip. Recipes gain tools, and every step gets a stable key. **The session:** it gains guided mode (the prompt, Before you start, one step at a time, waiting with Meanwhile, the plan, Done). **Timers:** set from the app, pushed from the server when they end. **Dishes:** each records how long each step took, and recipes show learned ranges after enough cooks. **Content:** Cookpool's 42 recipes are rewritten with guided steps. |
| Decisions locked | (1) **Guided is the default when a recipe has steps.** "Just tick what I use" (RC-6) stays; it is the same session, the same Finish and the same money. (2) **A step ends when you tick it.** The checkpoint is what you watch for; the timer is a guide. (3) **Parallel work comes from waiting.** A hands-off step frees the cook, and the app offers the next steps meanwhile. Authors write steps in order, with no flowchart. (4) **Long prep is planned up front.** A hands-off prep step of an hour or more shows on the recipe page and at the start, with a reminder. (5) **Times scale by rule, per step:** the same, a bit longer (× size^0.5) or longer (× size). Whistles never scale. (6) **Ranges from other cooks show only from 5 cooks by 3 people.** They are aggregated, never shown with a name, and never rewrite the author's words. (7) **The server pushes a timer within a minute of its end.** The web can't schedule its own alarm. In the app it rings on time. (8) **Ingredients are attached to a step, not written into its text.** The step shows them as chips with scaled amounts, so there is no template language. (9) **No voice commands.** iPhone web speech recognition is unreliable. Instead: big buttons, swipe, read aloud, screen on. (10) **Stage first,** behind `newFrame()`. |
| Design | Claude Design canvas, row "Guided cooking — step by step": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`GuidePrompt`, `GuidePrep`, `GuideStep`, `GuideWait`, `GuideTimeline`, `GuideEditor`, `GuideDone`). The stickies there hold the rules and this epic's draft. |
| Gate | GC1 is the day a recipe knows how to guide. GC2 is the day it cooks with you. GC3 is the day a timer finds you. GC4 is the day it learns. |
| Shipped as | |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| GC0 — the spec | this doc set and its contracts | merged |
| GC1 — steps that guide | the step model in the server; writing guided steps; the plan page; long prep on the recipe page; Cookpool's 42 recipes with guided steps | on stage, Chicken curry's steps each show a flame, ingredients, a time range and a checkpoint, and its plan reads differently at 450 g and 1 kg |
| GC2 — cooking with you | guided mode: the prompt, Before you start, one step at a time, waiting and Meanwhile, whistles, screen on, read aloud, swipe, Done | on stage, Chicken curry cooks from the first step to Who ate, the simmer runs while step 7 is open, and Done shows each step's time |
| GC3 — timers that find you | timers set in the server, and the per-minute push | a timer set in guided mode reaches a locked phone within a minute of its end |
| GC4 — learning from cooks | each step's time recorded with the size; ranges from 5 cooks | after 5 recorded cooks, a step reads "usually N–M min at this size · K cooks" |
