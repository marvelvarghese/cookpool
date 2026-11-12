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

## AI3 — recipe from a photo

- **AI-4: recipe from a photo in the server** (design §4). Photo only, by the owner's choice.
- **AI-9: recipe from a photo in the app** (design §4).

**Done when**
- on stage, a photo of a cookbook page becomes a guided draft with flames, times and per-step ingredients, and its checks marked

## AI4 — help while cooking

- **AI-5: transcription, step questions, Check it and rescue in the server** (design §5, §5a), with the Workers AI binding.
- **AI-10: voice, Check it and Something wrong? in guided mode** (design §5, §5a).

**Done when**
- on stage, "next" moves on, a spoken question is answered aloud, a photo gets a verdict, and a problem chip gets a fix

## AI5 — Cook now with swaps

- **AI-6: swaps and ideas in the server** (design §6).
- **AI-11: swaps and ideas in Cook now** (design §6).
- **AI-12: close-out.**

## AI6 — receipts and bills, round two

- **AI-14: discounts, taxes and charges.** The read returns adjustments as their own lines, and after a scan the app asks whether item prices should include them.
- **AI-15: Money, Scan a bill.** Add expense is filled from a photo by the same reader. Itemized splitting is left to Spliteco SE4.

**Done when**
- a receipt with a discount and GST asks once, then adds items whose costs add up to what was paid
- a bill photo in Money fills Add expense

## Sequencing

- **AI-2 first.** It builds the client, escalation, caching, limits and migration 470.
- **AI-3 to AI-6** follow it in parallel, each in its own handler file.
- **The screens (AI-7 to AI-11)** come after approval, each after its server task.
- **Prerequisites from the owner:** the API key and Workers AI. Without them everything ships and stays hidden behind `available: false`.
