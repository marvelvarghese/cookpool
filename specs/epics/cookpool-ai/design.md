# cookpool-ai — design

The canvas row "Cookpool AI" is the reference for every screen. Earlier rules still apply:
- five tabs;
- Undo, not "Are you sure?";
- static pages;
- stage first, behind `newFrame()`.

## 1. The plumbing (AI-2)

**Where it runs.** kitchen-worker calls the Anthropic API with the official `@anthropic-ai/sdk`, which runs on Workers. The key is the secret `ANTHROPIC_API_KEY`, declared in `component.yaml` like notifications-worker's `VAPID_PRIVATE_KEY`. Without the key, every AI route answers 503 with `details.reason: "ai_unavailable"`, and `GET /v1/kitchen/me/ai` says `available: false`.

**Models.** `claude-haiku-5-5` comes first, at effort `low`, with structured output (`output_config.format`, a strict JSON schema per task). The worker validates the result: the schema, plus each task's own checks, such as amounts ≤ what's left or a total that matches the receipt. If validation fails, the same request is retried **once** on `claude-sonnet-5-5`, still at effort `low`. Refusals and errors return `ai_failed`; they're never shown as an answer.

**Prompts.** Each task has a fixed system prompt with `cache_control`. The food list and units (RC-3's foods, kinds and `g_per_ml`) go in a cached block after it. Only the person's input changes from call to call. Model calls never include money, balances, group or org names, or people's names: people are passed as `person 1…n`, and items as `{ ref, name, unit, left }`.

**Limits and usage.** Migration **470** `470_kitchen_ai` adds `kitchen_ai_usage`: `id`, `user_id`, `feature`, `model`, `input_tokens`, `cached_tokens`, `output_tokens`, `audio_seconds`, `ok`, `created_at`, with an index on `(user_id, created_at)`.
- Per person per day (UTC): **50 actions** across text and image features, and **30 voice minutes**.
- Going over answers 429 `rate_limited` with `details.reason` `ai_daily_limit` or `voice_daily_limit`.
- `GET /v1/kitchen/me/ai` returns `{ available, features: { sayIt, receipt, import, voice, swaps }, today: { actions, actionsLimit, voiceSeconds, voiceSecondsLimit } }`.

**Switches.** Each feature's switch is a device preference in the console. The server only enforces limits.

## 2. Say what you used (AI-2 server, AI-7 app)

`POST /v1/kitchen/me/ai/uses { text }` takes up to 300 characters and returns `{ lines: Proposal[], unsure: string[] }`. A `Proposal` is `{ itemRef, name, pantry, quantity, unit | measure, consumers: usr_[], label }`.

**How a sentence is read:**
1. The worker gives the model the caller's usable items from `/me/items?usable` (name, unit, what's left, the item's measures) and the caller's group roster as `person n` with first names, which the model needs to read "Anu and I". It maps those back to `usr_` ids.
   - **Exception to "no names":** first names of the caller's own co-members are sent here. That is the minimum needed to read the sentence, and it's stated in the settings' "What is sent".
2. The model returns lines with an item ref, an amount in a unit or measure, and people. The worker checks each line: the item is usable by everyone named, the amount is ≤ what's left (otherwise "the rest", flagged), and the people are in the item's group.
3. Names that match nothing go into `unsure`.

**Nothing is written.** The console logs the confirmed lines through the existing use routes, one after another with one Undo (PN-5's Log several pattern). A spoken sentence goes through §5's transcription first.

## 3. Receipts (AI-3 server, AI-8 app)

`POST /v1/kitchen/me/ai/receipt { image: base64 JPEG/WebP ≤ 1.5 MB }`. The console shrinks the photo to 1200 px on the long side first.

**Response:** `{ store?, total?, lines: [{ text, name?, foodId?, quantity?, unit?, priceMinor?, pantry?, fromItemId?, confidence: "sure"|"check", reason? }] }`.

**How it's read:**
1. Haiku reads the lines: printed text, quantity, unit, price, and whether it's food.
2. The worker matches each name **locally first**, against the caller's restock lines, item history and the food list. A line gets a sure match only when name, unit and price all fit the history.
3. Non-food lines and unmatched lines come back as `check`. A pantry is chosen from the name's last purchase.
4. `total` is checked against the sum of the lines; any difference is reported.

**Storage:** the image is never stored or logged.

**In the app:** the console opens the shopping run (PN-6) prefilled. Sure lines are ticked, and check lines sit under "CHECK THESE", unticked. Add uses `buy()` as today.

## 4. Recipe import (AI-4 server, AI-9 app)

`POST /v1/kitchen/me/ai/recipe-import` takes `{ url } | { text ≤ 20k chars } | { image }`. It returns `{ draft: RecipeDraft, checks: [{ path, message }] }`. `RecipeDraft` is RC-4's recipe form shape with GC-2's guided step fields: lines with food ids where they match, steps with phase, lines, heat, min/max seconds or whistles, hands-off, time rule, sense, checkpoint and tip, plus tools.

**Links:**
- The worker fetches the page server-side: http(s) only, no private IPs, 2 MB, 10 s, and it follows redirects up to 3.
- It reads a schema.org `Recipe` JSON-LD block when there is one, and otherwise the main text.
- The result is cached in `kitchen_ai_imports (url_hash, draft, created_at)` (migration 470) for 30 days and **shared by everyone**. A second import of the same URL costs nothing.

**Models:** Haiku first, then Sonnet when the draft fails validation (steps without text, lines that don't parse, times out of range).

**Nothing is saved.** The console opens the recipe form (RC-5/GC-6 editor) prefilled, with the checks marked; Save uses the existing create route. The recipe stores its source URL in its note.

## 5. Voice while cooking (AI-5 server, AI-10 app)

**On the phone (free):**
- **Read aloud:** GC-5's speech synthesis.
- **Listening windows:** after a step is read, and while the mic button is held. A window is 6 s, extended while speech continues.
- **Voice activity detection** through the Web Audio API: only stretches with speech are recorded (`MediaRecorder`, Opus/AAC), at most 15 s a clip.
- **Commands** match a short local grammar on the *transcript*: next, back, repeat, start/stop timer, pause, how much \<ingredient\>. They go straight to the session.
- **The whistle counter:** while a whistle step runs, the mic listens with no upload. It detects a pressure-cooker whistle as a sustained high band (about 2–5 kHz) above a threshold, with a 4 s cool-down, and ticks the count. A "+1" and a "−1" correct it. It's on by default only for whistle steps.

**On the server:**
- `POST /v1/kitchen/me/ai/transcribe` takes the audio body (≤ 15 s, ≤ 1 MB) and returns `{ text }`. It uses Workers AI `@cf/openai/whisper-large-v3-turbo` through an `AI` binding on kitchen-worker, counts `audio_seconds`, and stores nothing.
- `POST /v1/kitchen/me/ai/ask-step { recipeId, factor, stepKey, question }` returns `{ answer }`. Haiku answers in at most 60 words, given the recipe's lines scaled to the factor, the current step, its heat, time, checkpoint and tip, the next step, and the question. The recipe part of the prompt is cached per recipe. It's never asked about money.

**The flow in the app:** the transcript goes to the local command matcher first, and only if nothing matches is it sent to `ask-step`. The answer is shown and read aloud.

## 6. Cook now with swaps (AI-6 server, AI-11 app)

`POST /v1/kitchen/me/ai/swaps { recipeIds: rcp_[] (≤ 5) }` returns, per recipe, `{ missing: [{ line, swap?: { text, lines } }] }` for lines the caller lacks. It's computed from Cook now's matching (RC-8) and only called for recipes missing 1–2 lines.

`POST /v1/kitchen/me/ai/idea { itemRefs (≤ 6, use-soon first) }` returns `{ draft: RecipeDraft }`: a quick dish from those items, cached per person for a day. It opens in the recipe form like an import.

## 7. Settings (AI-7)

You → **Cookpool AI**:
- one switch per feature: Say what you used, Scan receipts, Recipe import, Voice while cooking, Count cooker whistles, Swaps;
- today's use against the limits;
- "What is sent".

The switches are stored on the device. When `available` is false, the page says "AI isn't set up yet" and the entry points hide.

## 8. Out of scope

- A general chat.
- A wake word or background listening.
- Storing photos or audio.
- Server-side text-to-speech; MeloTTS can come later.
- The MCP connector (its own epic).
- Nutrition.
- Meal plans.
- Shopping lists.
