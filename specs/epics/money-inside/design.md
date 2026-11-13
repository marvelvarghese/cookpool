# money-inside — design

The B row of "Money, calmer" on the canvas is the spec.

## The tab (`@saas/spliteco-ui/money-tab-ui`)

Top to bottom, in Spliteco's Deep ocean: "‹ Cookpool" (or Tripeco) and the Spliteco mark; **Overall**, your net per currency (gold when you get back, coral when you owe); **Settle up** and **+ Expense**; the group chips (All, then every group, unsettled first); then either the group rows (initial, name, "4 people", one signed balance or Settled) or, for a chosen group, its balance, the people **you** settle with (Remind for who pays you, Settle for whom you pay — from the group's plan), and **Latest**, three rows with who and when, and "All in Spliteco".

It reads through the host's own API client (`groups`, `group`, `groupActivity`, `remind`); it writes nothing but a reminder. Settle up, + Expense and "All in Spliteco" call the host's `onOpen`, which opens Spliteco at `/settle?group=`, `/add?group=` or `/group?id=`.

## Hosts

- **Cookpool** (`/money`, the new frame): `MoneyInside` passes `client.spliteco`, opens Spliteco with a one-time handoff code (`handoffUrlTo`) and `back` to this page. The tab bar's fill and words turn Spliteco's while on `/money`.
- **Tripeco**: a fourth tab, Money (`/money`), in the pager; `.tabbar-spliteco` while it is current. Spliteco opens directly — you signed in to Tripeco through it.

## Rejected

- **Option A** (a calm Money screen in each host's own colours): two copies of the same money screens that drift.
- **A full app switch** (Swiggy → Instamart, own tab bar): one more way to get lost; the host's tabs stay, recoloured.
