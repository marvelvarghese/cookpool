# cookpool-sign-in — design

The screens are on the Claude Design canvas, row "Signing in":
https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`SignIn`, `Account`,
`WebSignIn`). This document is the rest: what exists, what changes, and
where each change lives.

## 1. What exists today (2026-11-02)

**identity-worker** (cirrus baseline, unchanged by `cookpool-kitchen` except
that CP-9 made it private):

- **Email code.** `POST /v1/auth/login/start { email }` creates a login
  challenge (`method: "email_code"`): a 6-digit code, stored as a SHA-256
  hash, valid 10 minutes, single use. It answers `{ challengeId, delivery }`.
  `POST /v1/auth/login/complete { challengeId, code }` consumes it and
  answers a session token. A person who has never signed in is created by
  the first completed challenge.
- **No limit on guesses.** A wrong code is recorded as a security event
  and nothing else; any number of guesses fit in the 10 minutes. Starting
  a challenge has no per-address limit either. The edge's rate limiter
  (`apps/api-edge/src/rate-limit.ts`) is the only brake: a token bucket per
  IP for signed-out requests.
- **Delivery.** With `DEBUG_DELIVERY=true` (local, dev and **stage**) the
  code is returned in the response instead of emailed. So on stage anyone
  can sign in as any address. With it off (prod) the code is enqueued to
  notifications-worker, which sends from `no-reply@mail.cookpool.app`; the
  domain is not registered, so nothing arrives.
- **Google and GitHub.** `GET /v1/auth/oauth/providers` lists a provider
  when its client id and secret are both set. The client ids are in
  `wrangler.template.jsonc`; the secrets (`GOOGLE_OAUTH_CLIENT_SECRET`,
  `GITHUB_OAUTH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`) are optional orun
  secrets that were never seeded, so both environments answer
  `providers: []`. The flow: `/v1/auth/oauth/{provider}/start?returnTo=` →
  the provider → `/v1/auth/oauth/{provider}/callback` → a redirect to the
  console's `returnTo` with `#token=…` (or `#error=…`) in the fragment.
  The provider's name becomes the person's `displayName` on first sign-in.
- **Sessions** last 30 days. `POST /v1/auth/logout` revokes the current one.
  `PATCH /v1/auth/profile { displayName }` renames the person.

**The console** (`apps/web-console-next`):

- `/login` is the baseline's page: a card with "Email code" and "Bearer
  token" tabs, the debug code shown inline, provider buttons when listed,
  and `?next=` (a same-origin path) honoured after sign-in, which the
  Cookpool join page already relies on. `/auth/callback` reads the
  fragment.
- The Cookpool `(kitchen)` app has no sign out and no screen for your own
  name; names fall back to the part of the email before the @ (CP-9).

**Join links** (`GET /v1/join/{code}`, CP-3) need a session to preview, so
a signed-out person cannot see which group they were invited to.

## 2. Two ways in

- **Continue with Google** — the primary button. Google gives a verified
  email and a name.
- **A 6-digit code by email** — for everyone else.
- Not offered: passwords (nothing to store, nothing to reset), GitHub (it
  stays wired in identity-worker for the admin console, but Cookpool's
  page does not show it), Apple (the baseline has no Apple provider; a
  later epic).

New and returning people take the same step; there is no separate sign-up.

## 3. Limits on codes (identity-worker)

- **5 tries per code.** Each wrong `login/complete` adds one to the
  challenge's attempt count, in the same statement that checks it. On the
  5th wrong try the challenge is spent. The answer is the existing
  `precondition_failed` with `details.reason: "too_many_attempts"`, and the
  app asks for a new code. A right code after that is refused too. Error
  codes are pinned (`packages/contracts/src/errors.ts`); only
  `details.reason` is new.
- **5 codes per address per 15 minutes.** `login/start` counts the
  address's challenges in the last 15 minutes and answers `rate_limited`
  with `details.retryAfterSeconds` beyond that. It counts per address, not
  per IP, so it holds against requests spread over many IPs; the edge's
  per-IP bucket stays as it is.
- **Codes on screen only for test addresses.** `DEBUG_DELIVERY` becomes
  `DEBUG_DELIVERY_DOMAINS`: a list of email domains whose codes are
  returned in the response, `cookpool.test` on stage. Every other address
  gets an email, so stage can no longer be signed into as someone else.
  Local and dev keep `*`.
- Storage: a migration adds `attempts INTEGER NOT NULL DEFAULT 0` to the
  login challenges table, plus an index on `(email, created_at)` if the
  count needs one. Both are additive.

## 4. Google switched on

- The owner of the Google Cloud project creates (or reuses) an OAuth
  client for the id in `wrangler.template.jsonc`. They register both
  callbacks:
  `https://cookpool-api-edge-stage.rahulvarghesepullely.workers.dev/v1/auth/oauth/google/callback`
  and the `-prod` one.
- The client secret and a fresh random `OAUTH_STATE_SECRET` are stored as
  orun secrets for each environment
  (`secret://ws_QX130J0D/cookpool/{stage,prod}/…`); identity-worker's
  `secrets-live` step pushes them at deploy. Only the owner can supply the
  Google secret; the state secret is generated.
- `OAUTH_ALLOWED_CONSOLE_ORIGINS` already lists the workers.dev consoles.
- Done when `GET /v1/auth/oauth/providers` lists `google` on stage and
  prod, and a Google sign-in on prod lands on Home.

## 5. The sign-in page (the app)

One route, `/login`, replaced by Cookpool's page. The admin `(app)` routes
use it too, so there is one way in.

- **Start.** The mark, "Cook together. Pay for what you use." (or "Sign in
  to join Anu and the others" from a join link), "Continue with Google",
  "or", an Email field, "Email me a code", and the Terms and Privacy line.
  Google shows only when the providers list has it; if it does not, the
  code form stands alone.
- **Code.** "Check your email", the address, "It works for 10 minutes", a
  single input (`inputmode="numeric"`, `autocomplete="one-time-code"`, 6
  digits) that signs in as soon as it is full, "Sign in", "Send a new code"
  (disabled for 60 seconds after a send), and "Use a different email".
  Wrong: "That code didn't match. N more tries, then we'll send you a new
  one." Spent or expired: "That code has expired. We've sent a new one."
  after a new `login/start`. Rate limited: "Too many codes for this
  address. Try again in N minutes."
- **From a join link.** When `next` is `/join/{code}`, the page reads the
  signed-out preview (§6) and shows the group card: "Sign in to join
  Flat 4B", "Anu invited you · 5 people are in". After sign-in (and the
  name step for new people) the join completes and the group opens.
- **Desktop.** At 900px and wider: a green panel with the pitch on one side
  and the same form on the other (the `WebSignIn` artboard); below 900px it
  stacks.
- **Signed out.** Every `(kitchen)` page that gets a 401 sends the person
  to `/login?next=<that page>&expired=1`. The page then says "You were
  signed out. Sign in to carry on."
- **Removed from Cookpool's page:** the Bearer-token tab and the debug code
  box. Local and dev builds keep a small "Developer sign-in" link that opens
  the token form (`NEXT_PUBLIC_ENVIRONMENT` of `local` or `dev`).

## 6. The signed-out join preview (membership-worker, api-edge)

`GET /v1/join/{code}/preview` answers a signed-out caller with
`{ groupName, inviterFirstName, memberCount }` and nothing else: no ids, no
other names, no email. An unknown or rotated code answers 404. The join
code is the secret here: anyone holding it can already join, so showing the
group's name to them reveals less than joining would. api-edge routes it
without a session, behind the same per-IP signed-out bucket. The signed-in
preview and `POST /v1/join` are unchanged.

## 7. First run and You (the app)

- **First run.** After a sign-in, a person whose profile has no
  `displayName` sees "What should your groups call you?", prefilled with
  the part of their email before the @. "Continue" saves it
  (`PATCH /v1/auth/profile`), then goes on to `next`, or joins first when
  `next` is a join link. Google sign-ins already have a name and skip
  this step.
- **You** (`/you`): the person's initials, name and email; "Change your
  name"; "How you sign in" (Google, and a code to the address); and "Sign
  out of this phone", which calls `logout`, clears the token and opens
  `/login`. "Your groups, pantry and balances stay as they are." The
  avatar on Home opens it. On desktop, the sidebar's "Me" item opens it.
  The phone tab bar is unchanged.

## 8. Out of scope

Passwords; Apple; offering GitHub in Cookpool; a list of signed-in devices
and "sign out everywhere"; changing your email; deleting your account;
registering the `cookpool.app` mail domain (an owner's setup step, listed
under "After v1" in `cookpool-kitchen`'s status); a custom domain for the
app.
