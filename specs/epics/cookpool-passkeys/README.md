# Epic: cookpool-passkeys (PK)

**Sign in with Face ID, a fingerprint or the phone's screen lock. Passkeys become the fast way back in. Google and the 6-digit email code stay as the other ways in, and there are still no passwords. The same work redesigns getting in: a clearer Sign in, its own Create account, a better code screen, and "Can't sign in?" in place of Forgot password.**

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped 2026-11-12 (stage and prod) |
| Cluster | **PK** (PK0–PK2) |
| Owner(s) | **Passkeys:** `apps/identity-worker`, `packages/db` (migration 510), `packages/contracts`, `packages/sdk`, `apps/api-edge` (auth facade routes). **Screens:** `apps/web-console-next`. |
| Builds on | `cookpool-sign-in` (email code, Google, sessions, the name step) |
| Decisions locked | (1) **No passwords.** Passkeys, Google and the email code. (2) **WebAuthn passkeys** that can be discovered on the device, with user verification required. (3) **The server keeps only public keys:** credential id, public key, sign count, transports and a device name. (4) **Each environment has its own RP ID** (`stage.cookpool.store`, `cookpool.store`), and origins are checked exactly against a list. The workers.dev hosts don't offer passkeys. (5) **Challenges are one-time, last 5 minutes and are kept in D1.** (6) **A passkey sign-in returns the same session** the email code returns. (7) **Delegated (assistant) tokens can't use any passkey route.** (8) **At most 10 passkeys per person.** The email code always stays on, so nobody can lock themselves out. |
| Design | Claude Design canvas, row "Getting in": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`AuthWelcome`, `AuthSignUp`, `AuthCode`, `AuthHelp`, `PasskeyOffer`, `PasskeyManage`, `WebAuth`). |
| Needs from the owner | Nothing for passkeys. Codes reach prod only once `mail.cookpool.store` is verified in Cloudflare Email. |
| Gate | PK1 is the day a person on stage signs in with Face ID. |
| Shipped as | PK0 #112 · PK1 #113 #114 #116 #117 #118 · close PK-5. Sign in with Face ID, a fingerprint or the screen lock (WebAuthn passkeys, migrations 510 and 520), alongside Google and the email code, with no passwords. Also: the Sign in · Create account tabs, the remembered account, the six-box code, Can't sign in? (`/login/help`), the one-time Turn on Face ID offer, and You → Sign-in and security. Verified on iPhone Safari on stage. |

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| PK0 — the spec | this doc set and its contracts | merged |
| PK1 — getting in | passkeys in the server; the redesigned Sign in, Create account, code and Can't sign in; the Face ID offer and Sign-in and security | on stage, a person adds a passkey after a code sign-in, signs out, and signs back in with Face ID |
| PK2 — close-out | status, README, done | merged |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## After this epic

(Filled in by the close-out task.)
