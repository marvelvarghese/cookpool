# spliteco-worker

Cloudflare Worker for Spliteco (cookpool-spliteco) — groups, expenses split six ways, balances, activity, insights and export on Cookpool's shared ledger, under `/v1/spliteco`

Part of the cookpool runtime: a Cloudflare Worker deployed per environment (`stage`, `prod`; `dev` is verify-only). Not publicly routable — reached only through `api-edge`'s `SPLITECO_WORKER` service binding.

## Depends on

- **membership-worker** — a person's groups with their members (`?view=spliteco`), making Spliteco groups, the hidden two-person direct groups, and authorization facts
- **policy-worker** — the decision for `spliteco.ledger.read` and `spliteco.expense.write`
- **identity-worker** — people's names
- **cloudflare-d1** — the platform database (the shared ledger)
- **db-migrate** — migration 530 before this serves

## Depended on by

- **api-edge** — the `/v1/spliteco/…` facade
