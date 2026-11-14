# money-native — implementation plan

One task per PR; one milestone in flight. A merge is a squash. Each rung leaves stage coherent: `/money` is not switched until the boxes it needs exist.

## MY0 — the spec
- **MY-1** — this doc set, `epic.yaml`, `tasks/MY-1..MY-14`, and a line in money-inside's status that MN-8 is superseded.
- **Done when:** merged; the declaration lists 7 milestones and 14 tasks.

## MY1 — one look, one button (`packages/spliteco-ui`)
- **MY-2** — `look.ts` (the two token sets, `LookScope`, the `theme` prop type; Deep ocean from `SPLITECO_INSIDE`). **Done when:** a page drawn in either scope uses only tokens; the tests pass.
- **MY-3** — `expand-button.tsx` (kinds, dim, focus trap, Escape, reduce-motion fade). **Done when:** it opens and closes by tap, Dim and Escape, focus returns, and with reduced motion nothing grows.
- *Order: MY-3 reads MY-2's tokens.*

## MY2 — the pages, read
- **MY-15** — backend: one new `spliteco-worker` read, `GET /v1/spliteco/me/people`, returns everyone you share a group with, their net per currency, and the groups behind it (contract in `packages/contracts`, a method on the SDK client). **Done when:** the route answers with per-person nets that match the groups' own balances. *First in MY2: MY-5 reads it.*
- **MY-4** — the Money shell and Groups page (title with the one Powered-by line, the switch, rows, `+ Group`, `Add group` row). Built on `moneyTotals` and `moneyTabGroups`. **Done when:** Groups renders real reads in both themes.
- **MY-5** — People and a person's page (balance by group, Kitchen first; `Pay` / `Got it`). Reads MY-15's one endpoint, no client-side joins; **Got it** records a received payment from them to you and the balance clears at once. **Done when:** People and a person render both themes from the real read.
- *The floating buttons appear from MY-6 and MY-7; here the slots are empty.*

## MY3 — settle and expense
- **MY-6** — the settle box: All / Kitchen only / Custom keypad, `kitchenFirst`, UPI then **Paid** records one payment per group touched. **Done when:** a recorded payment moves the balances.
- **MY-7** — the expense box: Equal and Exact, Exact must sum, saved through Spliteco's own call. **Done when:** an Equal and an Exact expense are saved and show in the group.

## MY4 — Cookpool's Money is native (the gate)
- **MY-8** — `/money` mounts the pages with theme `cookpool`; the person route; the tab bar goes back to Cookpool's; the hand-off is no longer used for settle, expense or group. **Done when:** stage's Money is cream and you settle and add an expense without leaving.

## MY5 — groups (`apps/web-console-next`)
- **MY-9** — Add group (name, selectable currency, food rule, join link) over the existing creation. **Done when:** a group is made from Money.
- **MY-10** — Start from Spliteco (the searchable list, editable name, people and currency carried). **Done when:** a Spliteco group becomes a Cookpool group; renaming it leaves Spliteco's name alone.
- **MY-11** — Manage group (people, simplify, split default, food rule page, selectable currency, join link, leave). **Done when:** each row works for someone allowed to, and reads only for others.
- *MY-10 and MY-11 each need MY-9's sheet or route; they do not need each other.*

## MY6 — one set of pages, old Money out
- **MY-12** — `spliteco-web` shows the shared pages with theme `spliteco`. **Done when:** the Spliteco app looks as today, from the shared pages.
- **MY-13** — delete what no caller has left: `MoneyInside`, the hand-off glue it used, the navy bar, and each old Money screen whose callers are gone; `SplitecoMoneyTab` is **not** deleted: Tripeco still uses it. **Done when:** nothing imports them, every test file loads.
- **MY-14** — close-out: status, README, `state: completed`.

## Follow-up epic (not in this one)

**Tripeco moves to the new pages** with theme `spliteco`, with its own tab bar and Tripeco look; when it has moved, that epic deletes `SplitecoMoneyTab`.
