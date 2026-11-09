# cookpool-ai — risks and open questions

## AI-A — Wrong reads (RISK)

AI misreads amounts, people or receipt lines. Every result is a proposal: lines are checked against the schema and stock, uncertain lines are marked, nothing writes without a tap, and Undo covers every write.

## AI-B — Cost runaway (RISK)

A loop or an abuser could run up calls. To prevent that:
- daily limits per person;
- Haiku first;
- cached prompts;
- tight output caps, no Sonnet retry unless `AI_ESCALATE` is on, and a monthly budget (AI-13);
- local-first matching and commands;
- a usage table for watching spend.

## AI-C — Privacy (RISK)

Money, groups and full names never reach the model. First names of co-members are the one exception, for reading "Anu and I", and the settings say so. Photos and audio are never stored.

## AI-D — Whistle listening (DROPPED)

The owner chose not to have it. Whistles are counted by tap, as in GC-5.

## AI-E — iPhone audio (RISK)

`MediaRecorder` needs iOS 14.3+ and the app in front. Wake lock keeps the screen on (GC-5). If the mic is refused, voice hides and the buttons remain.

## AI-F — Fetching pages (DROPPED)

Import is from a photo only, by the owner's choice (design §4): no links and no pasted text, so the server never fetches a page and there is no shared import cache.

## AI-G — Owner prerequisites (ACCEPTED)

The API key and Workers AI are owner steps. Until they're done, AI is hidden, not broken.
