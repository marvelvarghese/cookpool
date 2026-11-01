# db-migrate

Applies database migrations to the stage and prod Cloudflare D1 databases

Applies this repo's ordered migrations to the environment's Cloudflare D1 database: plan on pull requests, apply on merge to `main`.

## Depends on

- **db** — D1 executor, repositories and the ordered migrations the Workers and db-migrate use
- **cloudflare-d1** — Provisions the Cloudflare D1 platform database for stage and prod

## Depended on by

- **kitchen-worker** — Cloudflare Worker for the kitchen bounded context — group settings, pantries, the group ledger and dishes (Cookpool)
- **notifications-worker** — Cloudflare Worker for the Notifications bounded context
