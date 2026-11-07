# cookpool-recipes — risks and open questions

## RC-A — Two frames at once (RISK)

Until RC5, the console carries the old screens (prod) and the new ones (everywhere else). A change to a shared component can break the frame nobody is looking at.

**Mitigation:**
- Every page that picks a frame has a test for each frame.
- Prod's frame is today's code, unchanged.
- RC5 deletes the old frame soon after the owner says go.

## RC-B — Matching food is fuzzy (RISK)

"What you have" and Cook now are only as good as the links from items to foods. Most pantries hold things named loosely ("Amul taaza", "dhaniya").

**Mitigation:**
- A names table in several languages.
- The "Is Kanda onion?" ask, once per name per pantry.
- Unlinked items never count as a match. They are never guessed.
- The match is advice: cooking still lets you pick any item.

## RC-C — Counts meet weights roughly (ACCEPTED)

A recipe asks for 2 onions while the pantry holds 600 g, or the other way round. A food's `eachG` (onion ≈ 150 g) or the item's own measure bridges them. The answer is "≈", and the session shows the grams it will take before Finish.

## RC-D — A session lives on one phone (ACCEPTED)

The session is a device draft, so starting on the phone and finishing on the laptop isn't possible. Server-side sessions would need sync and conflict rules for little gain. Revisit if people ask.

## RC-E — Recipes from others (SETTLED)

- No public profiles, followers or stranger search; recipes travel through groups and links.
- A copy is a copy: no live updates from the source.
- A link opens only for signed-in people, so nothing in a recipe is public on the web. That includes the owner's name.

## RC-F — Cookpool's content (RISK)

40 recipes and 300 foods are content, not code. A bad amount teaches the wrong dish.

**Mitigation:**
- RC-7's test checks structure.
- The owner reads the list once before RC5.
- Every Cookpool recipe can be saved and corrected as your own copy.

## RC-G — Cloud sessions build in parallel (RISK)

Wave tasks run in separate sessions that cannot see each other.

**Mitigation:**
- Seams fixed in this plan: migration numbers, the session URL, who owns the bar and the Cook hub.
- Each contract's `affects`.
- Landing one at a time on fresh `main`.

## RC-H — The + tab goes (SETTLED)

Use moves to Home's first field (1 tap, as before). Bought moves to Pantry's top (2 taps, as before). Bill moves to Money's top (2 taps, as before). "Do it again" stays as Home's search suggestions and Cook's from before.
