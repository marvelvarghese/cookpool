# Epic: cookpool-sign-in (SI)

**Cookpool is live, but nobody can sign in to it. Google sign-in has no secrets on stage or prod, and an emailed code cannot reach anyone until the mail domain exists. The page people would land on is the baseline's admin login: an "Email code / Bearer token" switch and a debug code box. This epic gives Cookpool its own front door. Continue with Google, or have a 6-digit code emailed; it is one step whether you are new or coming back. New people choose the name their groups will see. A join link brings you back into that group already joined, and the "You" screen lets you change your name and sign out. The baseline's code check also gets the limits it is missing: a code allows 5 tries, and codes cannot be requested without end.**

It is for everyone who opens Cookpool, on a phone first. Most will arrive from a join link a flatmate sent, so that path matters most: the link, sign in, then straight into the group.

## Status

| Field | Value |
|-------|-------|
| Status | In progress — SI0 and SI2 shipped; SI1 waits on Google (SI-3) |
| Cluster | **SI** (SI0–SI3) |
| Owner(s) | `apps/identity-worker` (codes, sessions, Google) · `apps/membership-worker` + `apps/api-edge` (the signed-out join preview) · `apps/web-console-next` (the sign-in page, first run, You) |
| Builds on | `cookpool-kitchen` (shipped 2026-11-02) and the `cirrus` baseline's identity: email codes, Google and GitHub sign-in, 30-day sessions, the edge rate limiter |
| Changes | The Cookpool app gets its own sign-in page, a first-run name step and a You screen. identity-worker limits code guesses and code requests, and stage stops showing codes on screen to anyone who asks. Google sign-in is switched on for stage and prod. A join link can be previewed before signing in. |
| Decisions locked | (1) **Two ways in**: Continue with Google, or a 6-digit code by email. No passwords; GitHub stays wired but is not offered; Apple is out (the baseline has none). (2) **One step for new and returning people**: the same buttons make an account. (3) **A code allows 5 tries** and lasts 10 minutes; at most 5 codes per email address in 15 minutes. (4) **You land where you were going**: `?next=` is honoured, and a join link comes back already joined. (5) **New people name themselves** once, prefilled from Google or the email address; the name can change any time under You. (6) **No Bearer-token box or debug code** on the Cookpool page; stage shows a code on screen only for test addresses. (7) **Sign out is per device**. |
| Design | Claude Design canvas, row "Signing in": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (phone sign-in flow, You, web sign-in) |
| Gate | SI1 makes sign-in possible on prod (Google). SI2 is the first time a new person can join from a link without seeing the admin console. |
| Shipped as | |

## Read order

1. `design.md` — what exists today, the two ways in, the limits, the screens, what is out of scope
2. `implementation-plan.md` — the milestones, their tasks, and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped (kept distinct from intent)

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| SI0 — the spec | this doc set and the canvas row | merged; SI-1 reads done in Orunbase |
| SI1 — sign-in that holds up | code attempt limit, code request limit, stage codes only for test addresses, Google switched on for stage and prod | someone signs in with Google on prod; a 6th wrong code and a 6th code request in 15 minutes are refused |
| SI2 — the Cookpool sign-in page | the phone and web sign-in pages, the signed-out join preview, sign-in that returns you where you were | from a join link on a phone, a new person signs in and lands in the group, joined |
| SI3 — first run and You | the name step on first sign-in, the You screen, sign out, "you were signed out" | a new person picks a name, sees it in their group, and signs out from You |
