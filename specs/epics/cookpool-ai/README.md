# Epic: cookpool-ai (AI)

**Cookpool's chores are typing: what you used, what you bought, the recipe you found online. This epic lets you say or snap them instead, and gives the cook a voice that listens. AI lives inside the screens people already use, always proposes before it writes, and costs a few rupees per person a month.**
- **Say what you used.** One sentence, typed or spoken ("Anu and I had 2 glasses of milk and half the bread"), becomes checked uses, logged with Undo.
- **Scan a receipt.** A photo of the bill fills the shopping run: matched names, amounts, prices and pantries, and anything uncertain is marked "check these".
- **A recipe from a photo.** A photo of a cookbook page or a handwritten card becomes a guided recipe draft (flames, times, checkpoints, ingredients per step) in the editor.
- **Cook with your voice.** The app reads a step, listens briefly for "next", "repeat", "timer" or a question, and answers questions about the step you're on. Whistles are still counted by tap.
- **Help at the stove.** Check it: a photo of the dish is judged against the step's checkpoint ("not yet: onions still pale, 2–3 more min"). Something wrong? Too salty, burning, too watery, curdled, each gets a fix for this recipe at this size.
- **Cook now with swaps.** "No cream: 3 tbsp curd", plus a new dish idea from what's about to go off.

## Status

| Field | Value |
|-------|-------|
| Status | Draft: the design awaits the owner's approval; the server starts first |
| Cluster | **AI** (AI0–AI5) |
| Owner(s) | **AI calls, limits, parsing, import, voice Q&A:** `apps/kitchen-worker`, `packages/db`, `packages/contracts`, `packages/sdk`. **Transcription:** a Workers AI binding on kitchen-worker. **Screens and listening windows:** `apps/web-console-next`. |
| Builds on | `cookpool-pantry` (usuals, the open row, the shopping run and purchases), `cookpool-recipes` and `cookpool-guided` (recipes, guided steps, the step editor, guided mode, read aloud, wake lock), `cookpool-community` (Cook now), `cookpool-app` (installed app). |
| Decisions locked | (1) **No chatbot tab.** AI sits inside the Pantry, the shopping run, the recipe form, the cook session and Cook now. (2) **AI proposes, you confirm.** Nothing is logged, bought or saved without a tap, every write has Undo, and money never moves on the AI's word. (3) **Phone first.** Commands, read aloud and exact matches run on the phone at no cost. (4) **The cheapest model that passes.** Claude Haiku 5.5 with strict structured output. Only a failed check escalates to Claude Sonnet 5.5. Fixed prompts and the food list are cached. (5) **What is sent:** names of items, amounts, recipe text and the question. Money, balances, group names and other people's names are never sent; people are "person 1, 2". (6) **Photos and voice clips are read, then dropped.** Only the result is stored. (7) **Limits per person per day:** 50 AI actions and 30 voice minutes, each feature with its own switch. (8) **Voice listens only in short windows,** after a step is read or while the mic is tapped. There's no wake word and no background listening. (10) **Stage first,** behind `newFrame()`. (11) **An MCP connector** for people's own assistants is a later epic. |
| Design | Claude Design canvas, row "Cookpool AI": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`AiSayIt`, `AiReceipt`, `AiImport`, `AiVoiceCook`, `AiSwaps`, `AiSettings`). |
| Needs from the owner | **An Anthropic API key**, stored as `ANTHROPIC_API_KEY` for kitchen-worker on stage and prod (the same way as `VAPID_PRIVATE_KEY`). **Workers AI** on the Cloudflare connection, for transcription. Until these are in place the AI routes answer `ai_unavailable` and the screens hide AI. |
| Cost | Estimated at **$0.05–0.20 per active person per month**. Voice is about $0.002 per cook (Whisper at $0.0005 per minute with only short clips, plus Haiku answers) and read aloud is free, and a receipt costs about $0.0006 on Haiku. |
| Gate | AI1 is the day a sentence logs. AI2 is the day a receipt fills the run. AI3 is the day a photo becomes a guided recipe. AI4 is the day the app helps at the stove. AI5 is the day Cook now suggests swaps. |
| Shipped as | |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| AI0 — the spec | this doc set and its contracts | merged |
| AI1 — say what you used | the AI plumbing (models, escalation, caching, limits, usage), sentence → proposed uses, the Pantry box, AI settings | on stage, "Anu and I had 2 glasses of milk and half the bread" shows two checked lines and logs both for you and Anu with one Undo |
| AI2 — receipts | photo → matched lines → a prefilled shopping run | on stage, a DMart receipt fills the run, the total matches, and unknown lines sit under "check these" |
| AI3 — recipe from a photo | a photo of a page → a guided draft | on stage, a photo of a cookbook page becomes a guided recipe with flames, times and per-step ingredients, with what to check marked |
| AI4 — help while cooking | listening windows, local commands, transcription, step Q&A, Check it (photo), Something wrong? (rescue), answers read aloud | on stage, in guided mode "next" moves on, a spoken question is answered aloud, a photo of pale onions reads "not yet", and Too salty gives a fix |
| AI5 — Cook now with swaps | swaps for missing items and a new idea from use-soon items | on stage, a missing ingredient shows a swap and use-soon paneer gets a 15-minute idea |

## After this epic

(Filled in by the close-out task.)
