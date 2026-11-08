# cookpool-ai — risks and open questions

## AI-A — Wrong reads (RISK)

AI misreads amounts, people or receipt lines. Every result is a proposal: lines are checked against the schema and stock, uncertain lines are marked, nothing writes without a tap, and Undo covers every write.

## AI-B — Cost runaway (RISK)

A loop or an abuser could run up calls. To prevent that:
- daily limits per person;
- Haiku first;
- cached prompts;
- shared import cache;
- local-first matching and commands;
- a usage table for watching spend.

## AI-C — Privacy (RISK)

Money, groups and full names never reach the model. First names of co-members are the one exception, for reading "Anu and I", and the settings say so. Photos and audio are never stored.

## AI-D — Kitchen noise and whistle detection (RISK)

Exhaust fans and sizzling can fool the detector. It has a frequency band, a minimum duration and a cool-down, plus "+1/−1" correction. It's on only during whistle steps and can be turned off.

## AI-E — iPhone audio (RISK)

`MediaRecorder` needs iOS 14.3+ and the app in front. Wake lock keeps the screen on (GC-5). If the mic is refused, voice hides and the buttons remain.

## AI-F — Fetching pages (SETTLED)

Only http(s). Private and link-local IPs are refused. Size and time are capped, redirects limited. JSON-LD is preferred over scraping.

## AI-G — Owner prerequisites (ACCEPTED)

The API key and Workers AI are owner steps. Until they're done, AI is hidden, not broken.
