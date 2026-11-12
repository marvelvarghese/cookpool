# cookpool-passkeys — implementation plan

Each task is one pull request on `orun/PK-k-<slug>`, with its contract in `tasks/PK-k.TaskContract.yaml`.

## PK0 — the spec

- **PK-1:** this doc set and the contracts.

## PK1 — getting in

- **PK-2: passkeys in the server** (design §1–2): migration 510, identity-worker routes, the api-edge facade, contracts, SDK.
- **PK-3: the getting-in screens** (design §3: Sign in, Create account, code, Can't sign in, desktop). These need no server change.
- **PK-4: passkey screens** (design §3: Sign in with a passkey, Turn on Face ID, Sign-in and security). These need PK-2 on main.

**Done when**
- on stage, a person signs in with a code and turns on Face ID
- they sign out, then sign back in with Face ID and nothing else
- removing the passkey stops it working

## PK2 — close-out

- **PK-5:** the status file, the README, and the epic marked completed.

## Sequencing

PK-2 and PK-3 run together. PK-4 follows PK-2.
