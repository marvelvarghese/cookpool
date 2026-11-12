# spliteco-worker

Cloudflare Worker for Spliteco (cookpool-spliteco) — groups, expenses split six ways, balances, settling up, reminders, activity, insights and export on Cookpool's shared ledger, under `/v1/spliteco`

Part of the cookpool runtime: a Cloudflare Worker deployed per environment (`stage`, `prod`; `dev` is verify-only). Not publicly routable — reached only through `api-edge`'s `SPLITECO_WORKER` service binding.

## Depends on

- **membership-worker** — a person's groups with their members (`?view=spliteco`), making Spliteco groups, the hidden two-person direct groups, and authorization facts
- **policy-worker** — the decision for `spliteco.ledger.read` and `spliteco.expense.write` (SE2's payments, reminders and the simplify switch are gated on the latter)
- **identity-worker** — people's names, and the address a reminder or "paid you" goes to
- **notifications-worker** — `spliteco.reminder` and `spliteco.paid_you` (email, plus push for a person who turned the kind on), SE2
- **cloudflare-d1** — the platform database (the shared ledger)
- **db-migrate** — migrations 530 and 540 before this serves

## Depended on by

- **api-edge** — the `/v1/spliteco/…` facade
