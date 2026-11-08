# cookpool-guided — risks and open questions

## GC-A — Timers a minute late (ACCEPTED)

A locked phone hears a timer up to a minute after it ends, because the cron runs once a minute and the web can't schedule its own alarm. In the app, the timer rings on time. Cooking checkpoints are ranges and senses, so a minute is acceptable. Revisit with Durable Object alarms if cooks complain.

## GC-B — iPhone and the screen (RISK)

The Screen Wake Lock works in Safari 16.4+ and in the installed app, but iOS drops it when the app is backgrounded. Guided mode takes it again on return. Low Power Mode may refuse it entirely; the switch then reads "Your phone won't keep the screen on".

## GC-C — Learned ranges and odd cooks (RISK)

Someone who leaves the app open during dinner records a 90-minute onion step. To handle this:
- Percentiles (25th–75th), not the mean.
- Minimums of 5 times and 3 cooks.
- Times longer than 4× the author's maximum are dropped as abandoned.
- Steps done in under 10 seconds are taken as skipped, not timed.

## GC-D — Steps and parallel work (SETTLED)

There is no step graph. Hands-off steps free the cook, and Meanwhile offers what comes next. That covers dal and tadka, and rice beside a curry, without an editor anyone has to learn.

## GC-E — Content quality (RISK)

Cookpool's 42 recipes become step-by-step guides. A wrong flame or checkpoint teaches badly. To handle this:
- GC-4's content test checks the structure.
- The owner reads the guided steps on stage before prod.
- Learned ranges will expose times that are wrong.

## GC-F — Who sees the times (SETTLED)

Only aggregated ranges and counts leave the server. A recipe of your own learns from your cooks and from anyone who copied it.
