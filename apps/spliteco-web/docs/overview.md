# spliteco-web

The Spliteco app (epic cookpool-spliteco, SE1): groups, friends, expenses split six ways, itemized bills, balances, activity, insights and export, on the ledger Cookpool shares; from SE2, settling up by UPI (a `upi://pay` deep link, recorded only after "I paid"), cash or bank, "Not received", reminders, simplify debts per group and your UPI ID. Next.js 15 on Cloudflare Workers via OpenNext, with its own address, PWA manifest and Deep ocean theme.

## Depends on

- api-edge — every call goes to `/api/*` on the app's own address, which the Worker forwards to api-edge over the `API_EDGE` service binding. The money API is spliteco-worker behind it (`/v1/spliteco/…`).

## Depended on by

- (none)
