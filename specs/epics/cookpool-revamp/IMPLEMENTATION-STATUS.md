# cookpool-revamp (RV) — Implementation status

As-built ≠ intent.

| Milestone | State | PR |
|---|---|---|
| RV0 — the spec | | |
| RV1 — the new look | | |
| RV2 — close-out | | |

## Departures from the design

Each task adds a section at the end, headed `### <milestone> — <title> (<KEY>)`.

### RV1 — Finish without amounts (RV-7)

**Built.**
- **kitchen-worker** (`apps/kitchen-worker/src/dishes.ts`, `parseDish`): the "Add at least one ingredient, or something you just bought" refusal is gone. `POST /v1/kitchen/me/dishes` with `ingredients` and `newItems` empty or absent answers 201 with a dish of `ingredients: []`, `ingredientsMinor: 0`, `totalMinor` = `extrasMinor` (₹0 without), `owes: []`, no stock moves, no `use` transaction and no new items. The request and response shapes are unchanged; the `MAX_DISH_INGREDIENTS` (30) limit stays. No migration.
- **The rest of the dish works unchanged for ₹0:** the engine (`buildDish`) splits a ₹0 total among portion weights without dividing by the total, and finalize already posts no dish transaction for a dish that cost nothing (`dishTxn`). Claims, assigned shares, finalize (leftovers at ₹0), split later, cancel and Post to Community all work with no special cases.
- **contracts:** the `CookDishRequest` doc now says "none at all is a dish cooked without amounts". The types are unchanged.
- **Console:** `finishPlan` (`cook-session.ts`) no longer refuses when nothing has an amount. It sends the dish with no `ingredients`/`newItems`, and lines without an amount are still never charged. It still refuses for no name, more than 30 items and mixed currencies, and offline still refuses before the sheet opens. Both sheets use `finishPlan`: the new frame's `CookFinishSheet` (RC-6's screen and guided mode's Done) and today's `FinishSheet`. Under the main button, both say "₹0 · nothing taken from the pantry" when no line has an amount (`finishSub`/`postSub` take the line count; new `nothingTakenText`). Cooked! (`cookedView`) puts the same words in its note for a dish with no ingredients, and still offers Post to Community and Split with a group.

**Departures.**
- The words live in `cooked.ts`/`cook-session.ts`, not in `cooked-ui.tsx`/`cook-guided-*`. Those files didn't need a change: the guided last-step Finish opens the same `CookFinishSheet`, and Cooked! renders `view.note`. This also keeps clear of RV-4's restyle of those screens.
- The pinned test "won't post without a name, or with nothing in it" is now "won't post without a name". Its "Nothing to post yet" pin was removed on purpose.
- In `tests/kitchen-worker/src/dishes.test.ts`, the validation case `ingredients: [], newItems: []` → 422 is now `ingredients: "paneer"` → 422 (not a list).

**Tests.**
- `tests/kitchen-worker`: 56 suites, 1173 tests. New `no-amounts.test.ts` (7): the lists empty or absent → ₹0, nothing taken from any pantry; extras only; claims in a group; the 30 limit still refuses; claimed and finalized ₹0 posts nothing; split later by claims and by assign; cancel and post.
- `tests/web-console-next`: 113 suites, 2240 tests. New: `kitchen-cook-session.test.ts` no-amounts finish and too-many-items; `kitchen-cooked.test.ts` "a dish with no amounts" (3).
- `tests/contracts`: 35 suites, 332 tests.
- Typecheck and lint pass for web-console-next, kitchen-worker, contracts and both test packages. The 12 lint warnings in kitchen-worker-tests were already there.
- The console static build passes, every page static.
- Browser check at 390 px against a local mock on `cookpool-stage.localhost`, every request local: a named blank session, then Finish, which shows "₹0 · nothing taken from the pantry". Posting sent `{"name":"Maggi","orgId":null,"portionsHalf":2,"splitMode":"assign"}` and landed on Cooked! with ₹0, the note, Post and Split.

**Deploy order.** Deploy kitchen-worker before the console. Until the server has RV-7, a console with RV-7 posts an empty dish and gets the old 422 on `ingredients`, which shows as a refusal instead of the old in-app message. Both components change in this PR, so both redeploy. contracts changed only in a doc comment.
