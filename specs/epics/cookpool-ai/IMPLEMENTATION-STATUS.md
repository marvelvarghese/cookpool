# cookpool-ai (AI) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| AI0 — the spec | | |
| AI1 — say what you used | | |
| AI2 — receipts | | |
| AI3 — recipe import | | |
| AI4 — cooking with voice | | |
| AI5 — Cook now with swaps | | |

## Departures from the design

Each task adds a section at the end, headed `### <milestone> — <title> (<KEY>)`.

### AI1 — AI plumbing and sentence parsing in the server (AI-2)

**Built.**
- **The client** (`apps/kitchen-worker/src/ai/`): `@anthropic-ai/sdk` 1.3.0 (pinned, more than two weeks old) behind an `AiProvider` interface (`provider.ts`; tests stub it through `KitchenDeps.aiProvider`). `runner.ts` runs one `AiTask` — fixed system prompt + fixed reference block, both `cache_control: ephemeral`, then the task's user content, `output_config: { effort: "low", format: { type: "json_schema", schema } }` — on `claude-haiku-5-5`, checks the stop reason, the JSON against the schema (`schema.ts`) and the task's own `check`, and only when that fails (or the answer stopped at `max_tokens`) sends the same request once to `claude-sonnet-5-5`. A refusal, a thrown provider error or a second failed check is `ai_failed`; provider messages never reach a caller. `thinking` is left at the models' default (adaptive). The SDK client runs with `maxRetries: 1`, `timeout: 30 s`. AI-3…AI-6 add an `AiTask` each beside `uses-task.ts` and a route in `ai-routes.ts`.
- **The secret**: `ANTHROPIC_API_KEY` in kitchen-worker's `component.yaml` exactly as notifications-worker's `VAPID_PRIVATE_KEY` (`optionalSecretEnv: secret://ws_QX130J0D/cookpool/{{ .environment }}/ANTHROPIC_API_KEY` + `runtimeSecrets: "ANTHROPIC_API_KEY"`); never a var (the template carries a comment only; `tests/config-worker` pins both). No value was set.
- **Migration 470 `470_kitchen_ai`**: `kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, ok, created_at)`, `feature` CHECK in `uses, receipt, recipe_import, transcribe, ask_step, swaps, idea`, counts ≥ 0, `ok` 0/1, index `kitchen_ai_usage_user_idx (user_id, created_at)`. Repository `createAiUsageRepository` in `packages/db/src/kitchen/ai.ts` (`recordAiUsage`, `aiUsageBetween`).
- **Routes** (contracts in `packages/contracts/src/kitchen-ai.ts`, also `@saas/contracts/kitchen-ai`; api-edge already forwards `/v1/kitchen/…`, no edge change):
  - `GET /v1/kitchen/me/ai` → `{ available, features: { sayIt, receipt, import, voice, swaps }, today: { actions, actionsLimit: 50, voiceSeconds, voiceSecondsLimit: 1800 } }`. Answers without a key (`available: false`, every feature false). `sayIt` is the only feature true with a key; each later task turns its own on (`SERVER_FEATURES` in `handlers/ai.ts`).
  - `POST /v1/kitchen/me/ai/uses { text }` (1–300 chars trimmed) → `{ lines: AiUseProposal[], unsure: string[] }`, where `AiUseProposal = { itemRef: { kind: "personal", itemId } | { kind: "group", orgId, itemId }, name, pantry: PantryRef, quantity, unit? | measure?, consumers: usr_[] (caller first), label, flags: ("the_rest" | "people_removed")[] }`. Order: 503 `internal_error` `ai_unavailable` without a key (before the body is read) → 422 on the body → 429 at the limit → reads → model. Writes nothing.
  - Errors: 503 `internal_error` + `details.reason: "ai_unavailable"`; 429 `rate_limited` + `ai_daily_limit` (or `voice_daily_limit`) with `details.limit`, `used`, `resetsAt` (next UTC midnight); 502 `internal_error` + `ai_failed`. Reasons in `KITCHEN_AI_ERROR_REASONS`; no new error codes.
- **Limits**: 50 actions (every feature but `transcribe`) and 1800 voice seconds per person per UTC day, counted from `kitchen_ai_usage` before the call; failed actions count. One usage row per action.
- **Say what you used**: the model gets the caller's usable items with something left (`searchItems`, ≤ 100) as `{ ref: "iN", name, pantry: "mine" | "gN", unit, left, measures: [one…] }`, pantries as refs, and people as `me` + `person N` with a first name and their shared pantry refs (≤ 40). The check fails the answer (→ Sonnet) on an unknown item or person ref, no people, both/neither unit and measure, a unit of the wrong dimension, a measure the item lacks, or an amount ≤ 0. Then it fixes what the sentence may really say: more than is left → the rest in the item's unit (`the_rest`); a named person not in the item's group, or anyone but the caller on a personal item → left out (`people_removed`); a group line nobody left can have is dropped and the names go to `unsure`. Measures said in the plural are accepted and counts are rounded to halves. The model's `unsure` words are trimmed, de-duplicated, at most 10.

**Departures from the design.**
- **No `kitchen_ai_imports`** (owner's scope change during AI-2): recipe import will be from a photo only — no links, no pasted text — so the shared URL cache is not needed; migration 470 has `kitchen_ai_usage` only. AI-4's task and design §4 still describe links/text and the cache; AI-4 should follow the new scope.
- **One usage row per action**, not per model call: a Sonnet retry's tokens are summed into the action's row and `model` is the last model called. Spend per model is therefore approximate for escalated actions.
- **Limits are soft**: the count is read before the call, so concurrent requests at the 50th action can each run (a person may end a day an action or two over).
- **First names**: the first run of letters of the person's display name, else of their email's local part (`kiran.rao@…` → `kiran`); a person with neither is not sent and cannot be named. Item names are sent as the user typed them.
- **`ai_failed` is 502** and `ai_unavailable` 503, both on the pinned `internal_error` code.
- **A sentence with nothing usable** returns `{ lines: [], unsure: [] }` without calling the model and without counting an action.
- **Proposal shape**: the design's `itemRef` is the console's item ref (`{ kind, orgId?, itemId }`), plus `flags`. Ask-first items (PN-8) are proposed like any other; the console's use call will meet `ask_first` as it does today.
- **Caching**: the system prompt and the units reference are cached, and so is the caller's pantries block (third breakpoint). The food list (RC-3) is not sent for this task — it is not needed to read a use. Haiku's minimum cacheable prefix may be larger than this prompt, in which case the cache silently does not apply.
- `voice_daily_limit` and `audio_seconds` exist and are tested at the helper level; the transcription route that uses them is AI-5's.

**Tests.**
- `tests/kitchen-worker`: `ai-plumbing.test.ts` 27 (an image block passes through the runner for AI-3; availability, 401/405/422, Haiku request shape and caching, one Sonnet retry on failed check / not JSON / off-schema / cut short, both fail → 502 with a failed row, refusal and provider error → 502 with no retry, limits and their 429s, usage rows, nothing usable → no call, groups unreadable → 503), `ai-uses.test.ts` 21 (the milk-and-bread sentence, what the model is sent, the rest, measures, people not in the group, personal items, usr_ mapping, unsure, ten check failures → Sonnet, nothing written, and the prompt carrying no money, balances, group/org names, full names, emails or ids). Whole package (after merging main): 993 passed.
- `tests/db`: `kitchen-ai-migration.test.ts` 17 (registration, additive text, columns, no imports table, CHECKs, the index the day's count walks, the repository). Whole package (after merging main): 891 passed.
- `tests/contracts`: `kitchen-ai.test.ts` 5. Whole package (after merging main): 305 passed.
- `packages/sdk`: `kitchen-ai.test.ts` 4 (`ai()`, `aiUses(text)`, errors decoded). Whole package (after merging main): 216 passed.
- `tests/config-worker`: the Anthropic key is a secret reference + runtime secret, never a var (4). Whole package (after merging main): 331 passed.
- `tests/api-edge`: `/v1/kitchen/me/ai` and `/me/ai/uses` are kitchen routes (2). Whole package (after merging main): 603 passed.
