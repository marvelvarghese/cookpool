# cookpool-pantry — risks and open questions

## PN-A — Usuals from a few cooks' habits (RISK)

A bucket usual needs 2 uses and the strip needs 3, both in 60 days. For a new person the strip is empty for a week or so, and the suggestion falls back to the last amount. That is acceptable: a wrong "Morning usual" is worse than none.

## PN-B — Time zones (ACCEPTED)

The console sends its current offset. Someone who travels sees buckets in local time, which is what they eat by. Daylight saving shifts a use near a bucket edge by an hour. India has none.

## PN-C — A stock check that blames (RISK)

"Split with Flat 4B" charges everyone for what one person forgot to log. It's the default for group items because it's fair when nobody knows. Everyone sees it in Activity with the checker's name, and it can be undone. If flats find it unfair, the default can become "I used it".

## PN-D — Stock that goes up (SETTLED)

A check can raise what's left, but never above what was bought. No money moves. `costOfUse` already never charges past the price, so a raised level makes later uses cheaper, never dearer, and the item still costs at most its price in total.

## PN-E — Ask before use is social, not a lock (ACCEPTED)

The app can't stop someone taking the saffron. Asks record permission and move money only on approval. A use nobody asked for shows up as a gap in the buyer's stock check. The buyer and admins can always check an ask-first item.

## PN-F — Asks and dishes (SETTLED)

An approved ask from a cook session is the cook's own use, outside the dish's cost. Letting an approval feed a dish that's still open would need a grant the dish write consumes, and a dish finished before the answer would need re-pricing. The cook can still add the cost as an extra.

## PN-G — Spammy asks (RISK)

A flatmate who asks for milk every morning means a push every morning. "Always let Dev" on the approve card is the release valve, and the switch is per item and off by default. Asks lapse after 24 h, so an ignored one costs nothing.

## PN-H — The shopping run's payer (SETTLED)

One run, one payer: the person who shopped. A flatmate who paid for half the run adds their lines in their own run. Splitting a bill at the counter is an expense, not a purchase.

## PN-I — Shared files across wave A (RISK)

PN-2, PN-3 and PN-4 all add to the router, contracts and SDK. Each adds its own section, and whichever lands later merges `origin/main` first. The migration numbers are fixed in the plan, so the manifest won't clash.
