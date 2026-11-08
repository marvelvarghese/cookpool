# cookpool-ai — implementation plan

Each task is one pull request on `orun/AI-k-<slug>`, with its contract in `tasks/AI-k.TaskContract.yaml`. Screens are behind `newFrame()` and wait for the owner's approval of the canvas row.

## AI0 — the spec

- **AI-1:** this doc set and the contracts.

## AI1 — say what you used

- **AI-2: the plumbing and sentence parsing in the server** (design §1, §2; migration 470).
- **AI-7: Say what you used and AI settings in the app** (design §2, §7).

**Done when**
- on stage, a sentence about milk and bread shows two checked lines and logs them with one Undo
- AI settings show today's use

## AI2 — receipts

- **AI-3: receipts in the server** (design §3).
- **AI-8: receipt scanning in the shopping run** (design §3).

**Done when**
- on stage, a receipt fills the shopping run, sure lines are ticked, and check lines wait

## AI3 — recipe import

- **AI-4: recipe import in the server** (design §4).
- **AI-9: import in the recipe form** (design §4).

**Done when**
- on stage, a link becomes a guided draft with flames, times and per-step ingredients, and its checks marked

## AI4 — cooking with voice

- **AI-5: transcription and step questions in the server** (design §5), with the Workers AI binding.
- **AI-10: voice and whistles in guided mode** (design §5).

**Done when**
- on stage, "next" moves on, three whistles tick themselves, and a spoken question is answered aloud

## AI5 — Cook now with swaps

- **AI-6: swaps and ideas in the server** (design §6).
- **AI-11: swaps and ideas in Cook now** (design §6).
- **AI-12: close-out.**

## Sequencing

- **AI-2 first.** It builds the client, escalation, caching, limits and migration 470.
- **AI-3 to AI-6** follow it in parallel, each in its own handler file.
- **The screens (AI-7 to AI-11)** come after approval, each after its server task.
- **Prerequisites from the owner:** the API key and Workers AI. Without them everything ships and stays hidden behind `available: false`.
