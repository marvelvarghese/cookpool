# cookpool-sign-in (SI) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SI0 — the spec | ✅ shipped 2026-11-02 | #26 (SI-1) |
| SI1 — sign-in that holds up | in progress | #28 (SI-2) |
| SI2 — the Cookpool sign-in page | ✅ shipped 2026-11-02 (checked against a mocked API; not yet walked through on stage) | #27 (SI-4), #29 (SI-5) |
| SI3 — first run and You | | |

## Departures from the design

### SI2 — the signed-out join preview (SI-4)

Route as built: `GET /v1/join/{code}/preview` → `{ groupName,
inviterFirstName, memberCount }` (`JoinPreviewPublic`; the key list is
`JOIN_PREVIEW_PUBLIC_KEYS` in `@saas/contracts/membership`), served by
membership-worker (`handlers/join-preview-public.ts`) and routed by api-edge
(`join-preview-facade.ts`) without a session. SDK:
`client.memberships.previewJoinPublic(code)`.

- **"The inviter" is the group's first owner.** CP-3 keeps the join code on
  the organization row with nobody's id beside it (a rotation's actor is only
  in the event log, and the first mint is in neither), so who made a link is
  not recorded. The preview names the earliest-joined active member holding
  the owner role (people only, never a service principal).
- **The name is the first word of their profile name, else null.** Not the
  part of the email before the @ that CP-9's names fall back to: this answer
  goes to people with no account, so no piece of an address is shown. A first
  word containing `@` is treated as no name.
- **membership-worker binds `IDENTITY_WORKER`** (stage and prod) for the name,
  through CP-9's internal lookup. identity-worker already depends on
  membership-worker, so the binding is not a `dependsOn` edge; like CP-19's
  kitchen binding it is acknowledged in tests/config-worker
  (`ACKNOWLEDGED_BINDING_CYCLES`). A failed or missing lookup answers without
  a name, never an error.
- **`memberCount` counts people with a group role** (owner, admin, member,
  viewer — CP-9's count): removed members, revoked roles and a
  billing_admin-only seat are not counted. The signed-in preview
  (`GET /v1/join/{code}`) still counts every active member row; it is
  unchanged.
- **One 404 for every code that names no joinable group**: unknown, malformed,
  rotated away, or a group that is not active. CP-3 has no "join links off"
  switch (rotating is how a group stops a link), so there is nothing else to
  refuse. A malformed code answers before any read; every other miss costs
  the same single lookup.
- **Its own rate-limit family, `join_preview`: 30 a minute per IP.** The
  design said "the same per-IP signed-out bucket"; it is the same mechanism
  (`anon:<family>:<ip>`), in a family of its own so it and sign-in (`auth`,
  10 a minute) do not spend each other's budget. Unlike every other family it
  is keyed by IP even when a token is sent: otherwise a fresh random
  `Authorization` header per request would buy a fresh bucket each time.
- **The edge re-picks the three fields** from membership-worker's 200 (a body
  without them is a 503), forwards only `x-request-id` and `traceparent` (no
  token, cookie, actor header, query or body), and every answer from the
  route, errors and 429s included, carries `Cache-Control: no-store`. The
  Solo profile hides it with the other join routes.
- **The SDK sends no credential on it**, even from a signed-in client (the
  transport's new `anonymous` request flag).

### SI1 — sign-in that holds up (SI-2)

- **The count is per person, not per `(email, created_at)`.** Login
  challenges carry `user_id`, not an address; `login/start` resolves (or
  creates, as before) the one user a lower-cased address belongs to and
  counts that user's challenges. The index is `(user_id, created_at)`
  (`280_identity_login_attempts`). Case and IP make no difference.
- **Both limits are one statement each.** `login/complete` is one guarded
  `UPDATE … WHERE consumed_at IS NULL AND attempts < 5 AND expires_at > now`
  that consumes on the right code and adds a try on a wrong one; a read
  afterwards only says why nothing was touched. `login/start` inserts with
  `INSERT … SELECT … WHERE (SELECT COUNT(*) …) < 5`, so racing requests cannot
  get a 6th code either. The limits live in `@saas/contracts/auth`
  (`LOGIN_CODE_MAX_ATTEMPTS`, `LOGIN_CODES_PER_WINDOW`,
  `LOGIN_CODE_WINDOW_SECONDS`); the attempt limit is also
  `LOGIN_CHALLENGE_MAX_ATTEMPTS` in `@saas/db/identity`, which the guarded
  statement holds (a test pins them equal).
- **The answers.** Wrong code with tries left: 404 `not_found`,
  `details.attemptsLeft` 4…1. The 5th wrong code, and any try after it (the
  right code included): 422 `precondition_failed`,
  `details: { reason: "too_many_attempts", attemptsLeft: 0 }`. Beyond the
  design, the other two 422s now carry a reason too (`code_expired`,
  `code_used`), and the 429 from `login/start` carries
  `reason: "too_many_codes"` next to `retryAfterSeconds`, plus a
  `Retry-After` header (api-edge passes it through), so the app can tell it
  from the edge's per-IP 429 (`details.scope`). All in `AUTH_ERROR_REASONS`.
- **Two baseline bugs in the D1 repository, fixed on the way.** The old
  `UPDATE … WHERE code_hash = $2 AND consumed_at IS NULL` had no expiry check,
  so a right code still signed in after its 10 minutes; and every refusal,
  a wrong code included, came back as "already been used" (422) on D1,
  while the in-memory fake the tests used said `not_found` (404). D1 now
  answers what the tests always assumed.
- **`DEBUG_DELIVERY` is gone, not aliased.** `wrangler deploy` replaces a
  worker's vars with its config's (no `keep_vars`), so no deployed
  identity-worker can carry the old flag next to the new code.
  `DEBUG_DELIVERY_DOMAINS`: local and dev `*`, stage `cookpool.test`, prod
  empty; matching is by whole domain, case-insensitive (`sub.cookpool.test`
  does not match). `/health` reports
  `checks.debugDelivery: { enabled, domains }` (`["*"]` for every domain).
- **Security events.** A refused `login/start` records `login.start.failed` /
  `rate_limited` (metadata `retryAfterSeconds`); a spent code records
  `login.complete.failed` / `too_many_attempts`; a wrong code keeps
  `invalid_code_or_challenge` and adds `attemptsLeft` to the metadata.
- **identity-worker now has the enforced `db-migrate` edge** kitchen-worker
  has, so on `main` the migration applies before the worker that reads
  `attempts` deploys.
- **Left as they were:** membership-worker still carries its own
  `DEBUG_DELIVERY=true` on stage, which returns invitation tokens inline to
  the inviter (notifications-worker declares the var but reads nothing from
  it). Outside this task.

### SI2 — the sign-in page (SI-5)

`/login` is Cookpool's page for both apps (`app/login/page.tsx`), with the
model in `components/kitchen/sign-in.ts` (pure: the step reducer, every
refusal's message, the countdown, the join card, `next`, the environment
gates) and the pieces in `components/kitchen/sign-in-ui.tsx`. Phone below
900px (`SignIn`), the green panel beside the form from 900px (`WebSignIn`),
in the kitchen theme (`useKitchenBodyTheme`, shared with the kitchen layout).

- **"Local or dev" is a runtime fact, not a build.** The console ships one
  artifact for every environment (saas-console-artifact CA1/CA2), and there is
  no `NEXT_PUBLIC_ENVIRONMENT`. The page reads the console's own flag,
  `appConfig().deployEnv` (`CONSOLE_DEPLOY_ENV`, else the build's
  `NEXT_PUBLIC_DEPLOY_ENV`, else the `-stage`/`-prod` of its workers.dev
  host), plus its hostname: `signInEnvironment()` says `local` for
  localhost, 127.0.0.1, [::1] and `*.localhost`, `dev` for a
  `…-dev.<subdomain>.workers.dev` host (the console does not deploy to dev
  today), and **`prod` for anything else** — a custom domain without
  `CONSOLE_DEPLOY_ENV` gets no developer aids. "Developer sign-in" (the
  baseline's Bearer-token form and API target picker, folded behind a link)
  renders only on local and dev, and only after mount (the server HTML on
  stage and prod never contains it). Its code is in the bundle every
  environment serves, as the old tabs were.
- **The test code** ("Test code: 123456", under the field) shows when the
  answer carries one (`delivery.mode: "local_debug"`): any address on local
  and dev; on stage only an `@cookpool.test` address (whole domain), even if
  stage's server were ever set wider; never on prod.
- **Every refusal has its words** (`startRefusal`, `completeOutcome`), on
  SI-2's shapes: a wrong code says how many tries are left (singular at 1)
  and keeps the code, selected, until it changes; `too_many_attempts`,
  `code_expired`, `code_used` and a bare 404 (unknown challenge) all **send a
  new code at once, without asking**, and say "That code has expired. We've
  sent a new one." If that send is refused (the address's 5 codes in 15
  minutes), the page says both — "That code has expired. Too many codes for
  this address. Try again in N minutes." — disables the field, and rests
  "Send a new code" until `retryAfterSeconds` is up. The edge's per-IP 429
  (no reason, `details.scope`) reads "Too many tries from here. Try again in
  N seconds." Minutes round up, never below one.
- **"Send a new code"** rests 60 seconds after any send, counting down in its
  label ("Send a new code in 0:42", "New code sent. Send again in 0:42").
  A full code submits itself once; pasting "246 810" keeps the digits.
- **The Terms line names Terms and the Privacy notice without links**: there
  are no such pages yet, and a link to a 404 is worse than none. "New to
  Cookpool? The same buttons make your account." leads it only when Google is
  listed (alone, the code form is one button).
- **The join card.** `next=/join/{code}` (a same-origin path naming the join
  page itself, `joinCodeFromNext`) reads `client.memberships.previewJoinPublic`
  without a token; a skeleton holds the card and headline while it loads, and
  a 404 or any failure shows the plain page. Headline variants beyond the
  design: "…join Anu and one other" for two people, "…join Anu" alone, and
  "…join Flat 4B" when the preview has no inviter name. The avatar is the
  app's `GroupAvatar` ("F4"), not the artboard's "4B".
- **Joined without a second tap, but not by URL.** The join page joined on a
  tap and then offered "Open Flat 4B" — two more taps. The brief's `?auto=1`
  would let any link join a signed-in person to a group they never saw, so
  instead the sign-in page records the code in this tab's sessionStorage
  (`rememberJoinAfterSignIn`, 30 minutes, that code only) when the person
  signs in — or leaves for Google — having seen the card. The join page reads
  it once, joins, and replaces itself with `/groups/{slug}` ("You joined Flat
  4B"); already a member, it opens the group; a full group or the per-person
  cap shows the existing page. Without the record (a link opened while
  signed in, `?auto=1` or not) the page is unchanged.
- **Google's `returnTo` carries `next`** (`/auth/callback?next=…`;
  identity-worker checks only the origin). The callback prefers it, falls back
  to the baseline's sessionStorage stash (still written), re-checks either
  with `postLoginDestination`, and scrubs query and fragment as before. It now
  wears the Cookpool look, and "Back to sign in" keeps `next`.
- **Signed out, found once.** `createClient` takes an `onUnauthorized`
  callback (an SDK `fetch` wrapper) that fires on a 401 to a request that
  carried the token, and the session reports it only while that token is
  still current. The kitchen layout's `useRequireAuth({ returnHere,
  signOutOnUnauthorized })` then clears the token (`setToken(null)`, as every
  sign-out does) and `location.replace`s to `/login?next=<page>&expired=1`
  (`loginPathFor(path, { signedOut: true })`); Home and the root get
  `/login?expired=1`. No token at all means no session was had: the plain
  `/login?next=<page>`, no notice. The admin `(app)` console is unchanged.
- **Below 900px the panel is hidden, not stacked**: a phone gets the `SignIn`
  artboard, with the form first. From 900px the form's title is "Sign in"
  (or the join headline) and the panel's pitch is its `h2`.
- **The token is handled as before**: `setToken` from `login/complete`, the
  callback's fragment, or the developer form, into the same storage key; the
  sign-in calls still go through the session's client. Sign-in now
  `router.replace`s to `next` (was `push`), so Back does not reopen the code
  step, and the "Signed in" toasts are gone (the page you land on says it).
- **Left for later:** `/terms` and `/privacy` pages; SI-6's name step must run
  between sign-in and the automatic join (the record lasts 30 minutes, so
  sign-in → name → `/join/{code}` keeps working).
