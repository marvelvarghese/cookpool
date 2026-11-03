# cookpool-sign-in (SI) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| SI0 — the spec | ✅ shipped 2026-11-02 | #26 (SI-1) |
| SI1 — sign-in that holds up | in progress | #28 (SI-2) |
| SI2 — the Cookpool sign-in page | ✅ shipped 2026-11-02 (checked against a mocked API; not yet walked through on stage) | #27 (SI-4), #29 (SI-5) |
| SI3 — first run and You | ✅ shipped 2026-11-02 (checked against a mocked API) | #30 (SI-6) |
| SI4 — on cookpool.store | in progress | #32 (SI-10), #33 (SI-11), #34 (SI-8), #35 (SI-12) |

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

### SI3 — first run and You (SI-6)

The Name step is a third step of the sign-in page (`app/login/page.tsx`, the
`name` step of `signInReducer` in `components/kitchen/sign-in.ts`, drawn by
`NameStep` in `sign-in-ui.tsx`), not a `/welcome` route. You is `/you` in the
`(kitchen)` app (`app/(kitchen)/you/page.tsx`, model in
`components/kitchen/you.ts`). Sign out is `lib/sign-out.ts`; what a device
remembers between sign-ins is `lib/first-run.ts`. Console only: no backend
package changed.

- **Three ways into the Name step, one check.** After a code sign-in,
  `login/complete`'s `user` is read directly: no `displayName` (or only
  spaces) shows the step on the same page, without a navigation, the join
  card above it reading "You're joining Flat 4B". Google's callback reads the
  profile with the new token before going on and sends a nameless one to
  `/login?step=name&next=…` (`afterOAuthPath`): Google names a *new* account,
  but a Google sign-in linked to an account first made by code keeps that
  account's name, which may be none. The kitchen layout sends someone who
  signed in before SI-6 and has no name to the same URL, once
  (`firstRunRedirect`). `/login?step=name` reads the profile itself and asks,
  goes on to `next` when there is a name, or starts over with "You were
  signed out" on a 401; without a token it is the plain sign-in page.
- **It cannot loop or trap.** The kitchen asks only after a successful
  profile read, and only once per person per device: it records the
  person's id (`…name-asked` in localStorage) *before* redirecting, and the
  step records it too whenever it shows. A profile read that fails — in the
  kitchen or on the step — asks nothing and goes on to `next`. A failed save
  says why and adds **"Do this later"** (not in the artboard), which goes on
  to `next`; the kitchen does not ask again. The marker is cleared at sign
  out. A later sign-in by code or Google still asks a nameless person, since
  those check the profile, not the marker.
- **Sign-in → name → joined, no second tap.** SI-5's join record is written
  at sign-in as before, and again when the step's button is pressed: from a
  join link it reads "Join Flat 4B", and pressing it is the yes, so the
  kitchen's once-only ask from `/join/{code}` also joins without another tap.
  The step then `router.replace`s to `next`, and the join page reads the
  record as SI-5 built it.
- **The prefill is tidied, not raw.** The design says "the part of the email
  before the @"; the artboard shows `rahul@gmail.com` → "Rahul". The step
  drops a `+tag`, reads `.` and `_` as spaces and capitalises each word
  (`rahul.varghese+food@…` → "Rahul Varghese"); nothing is saved until the
  person presses Continue. Names are cleaned the same way everywhere (trimmed,
  runs of spaces made one, at most 80 characters — the console's existing
  limit; identity-worker allows 120). The live initials are CP-9's avatar
  initials (`nameInitials`), so the step shows what the groups' avatars will.
- **No keyboard on arrival.** The step takes focus straight after the code
  step; arriving from Google or the kitchen it opens without focusing the
  field, as SI-5's first load does.
- **A rename reaches every name read.** After a save (the step or You) the
  saved profile is written into the cache in place and `kitchenMe` (balances,
  people, the person view, the inbox) and every group's member list
  (`qk.kitchenMembersAll()`, new) are invalidated (`applyNewName`). The
  `/login?step=name` read also writes the profile into the cache, so `next`
  paints the fresh name.
- **"How you sign in" shows what this device knows.** identity-worker's
  profile and session say nothing about linked providers (`AuthUser` is id,
  email, name, last org; `identity_auth_identities` has no read route), and
  backend packages were out of scope. So You always lists "A code to
  {email}" (a code to the address always signs that person in), and lists
  **Google only when this device's last sign-in was Google**, marked "Last
  used" (the code row is marked when a code was). The sign-in page stashes
  the provider beside `next` before leaving for Google (`…login-provider`,
  this tab), the callback records it (`…sign-in-method`, localStorage), a
  code sign-in records `code`, the developer form clears it. A person with a
  Google link who signed in here by code sees only the code row. A follow-up
  could expose linked providers on `GET /v1/auth/profile`.
- **You.** Initials, the name your groups see (your chosen name, else the
  part of your email before the @, CP-9's fallback), email; "Change your
  name" edits in place (Save · Cancel, Enter saves, Escape cancels, focus
  returns to the button), starting from the Name step's prefill when there
  is no name, sending nothing when unchanged, and a toast "Name saved". The
  button reads "Sign out of this phone" below 900px and "Sign out of this
  device" from 900px. Sign out is offered even when the profile cannot be
  read. The artboard's "You're signed out · Sign in again" state is not
  built: sign out goes straight to `/login`, as the design says.
- **Sign out of this device** (`signOutOfThisDevice`): marks the page as
  signing out (so `useRequireAuth` neither shows "You were signed out" for a
  401 nor redirects on the missing token), calls `POST /v1/auth/logout` best
  effort (offline or already expired, the device still forgets the token),
  clears the token (`setToken(null)`), the React Query cache
  (`queryClient.clear()`), SI-5's join record and `next` stash, the provider
  stash, the Name step marker, the sign-in method, the recent groups and the
  admin console's last org, then `location.replace("/login")` — a full load,
  so nothing in memory and no Cookpool class on `<body>` outlives it. The API
  target (the developer picker's choice) is the device's and stays. The
  admin console's own sign-outs (`/account`, its sidebar menu) are unchanged
  and still clear only the token.
- **Navigation.** Home's avatar opens `/you` (was the admin console's
  `/account`), with CP-9-style initials. The sidebar gains "Me" after People
  (`KITCHEN_SIDEBAR_LINKS`; the phone tab bar, `KITCHEN_TABS`, is unchanged,
  and no tab is current on `/you`); the person at the sidebar's foot opens
  `/you` too, and the gear beside it, which still opens `/account`, is now
  labelled "Admin console" (it was "Account settings", which You now is).
- **The callback handles its fragment once** (a ref), so React's development
  double effects no longer report a failure after a successful sign-in.
- **Checked** against a mocked API (SI-5's harness plus profile GET/PATCH and
  logout, never reaching stage) at 390 and 1440: a code newcomer gets the
  step prefilled and lands on Home; a join-link newcomer goes sign-in → name
  → in Flat 4B; Google with a name skips it, Google onto a nameless account
  gets it and joins; a pre-SI-6 nameless session is asked once, a failed read
  never traps, a failed save offers "Do this later"; You renames (Home, the
  sidebar and the member list follow) and signs out to a bare `/login` with
  nothing of the person left in storage.

### SI1 — stage shows the sign-in code on screen (SI-9)

- At the owner's request (2026-11-03): stage's `DEBUG_DELIVERY_DOMAINS` is
  `*`, so login/start returns the code for every address there, and the
  sign-in page shows it as "Test code" for any address. `testCodeFor` no
  longer second-guesses the server by domain on stage; it shows whatever
  identity-worker returns, and still never anything on prod. Risk SI-C
  records the trade (anyone can sign in to stage as anyone while this
  holds).

### SI4 — Cookpool on the new Cloudflare account (SI-10)

- At the owner's request (2026-11-03) Cookpool moved from
  Rahulvarghesepullely@gmail.com's Account to Marvelvarghese18@gmail.com's
  Account (connection `int_f78dd4cd874640ab8c8a5741ffb3ff83`). Every address
  moved from `*.rahulvarghesepullely.workers.dev` to `*.cookpool.workers.dev`.
- The deploy tokens (`CLOUDFLARE_API_TOKEN` workers-deploy,
  `CLOUDFLARE_D1_TOKEN` d1-edit, `CLOUDFLARE_ACCOUNT_ID`) are brokered from
  the new connection at the `cookpool` project rung, shadowing the
  workspace-shared ones from the old connection, which are left in place.
- The `cloudflare-d1` and `cloudflare-kv` Terraform states (stage, prod) were
  backed up and deleted before the move, so the apply created a fresh
  database and namespace in the new account. Changing the account in place
  would have planned a replacement whose destroy step cannot reach the old
  account. The old account's Workers, database and namespace keep running,
  unmanaged; data did not move, so both environments start empty.
- `ai/context/deployment.md` records the steps for a future move.
- The Google callback URLs change with the subdomain (design §4).
- **Missed in SI-10, fixed in SI-11:** the console's committed
  `apps/web-console-next/wrangler.jsonc` (not a rendered template) still set
  `CONSOLE_WORKERS_DEV_SUBDOMAIN` to the old subdomain, so the new app called
  the old account's API and the browser refused it (CORS). It now says
  `cookpool`, and a config test keeps it equal to the console component's
  `workersDevSubdomain` and to identity's console origins.

### SI4 — Cookpool on cookpool.store (SI-8)

- The owner bought `cookpool.store` (GoDaddy, 2026-11-02) and moved its
  nameservers to the new Cloudflare account (`carmelo` and
  `magdalena.ns.cloudflare.com`, 2026-11-03).
- Names: the prod app is the bare `cookpool.store`, stage is
  `stage.cookpool.store`, email is sent from `no-reply@mail.cookpool.store`.
  The API stays on `cookpool-api-edge-<env>.cookpool.workers.dev`, so the
  Google callback URLs do not move again.
- Every `cookpool.app` placeholder outside the docs' history became
  `cookpool.store`: api-edge's `CONSOLE_CUSTOM_DOMAIN` (CORS), identity's
  console origins (the workers.dev origins stay), kitchen's `APP_URL`,
  billing's `POLAR_SUCCESS_URL`, notifications' sender, `intent.yaml`, the
  rebrand values, the SDK/CLI defaults (now the prod workers.dev API) and
  their tests.
- **Custom domains attached in the dashboard, not by Terraform.** The
  baseline's `cloudflare-domain` stack only looks the zone up: the
  custom-domain resource was dropped in Phase 1 of its v4→v5 migration and
  never re-added, and the brokered deploy token has no zone or DNS rights.
  The two Workers Custom Domains were therefore added in the Cloudflare
  dashboard; the component stays parked with a note on how to bring them
  under Terraform.
- **Found after SI-8 went live, fixed in SI-12:** the console learns its
  environment from a `-<env>` in its workers.dev host, and a custom domain has
  none, so the prod app on `cookpool.store` fell back to offering both API
  targets and called stage's API (refused by CORS). The console now reads
  `CONSOLE_CUSTOM_DOMAINS` (`stage=stage.cookpool.store,prod=cookpool.store`,
  in its wrangler.jsonc) and maps an exactly matching host to its
  environment; `CONSOLE_DEPLOY_ENV` still wins. A config test keeps the map
  equal to api-edge's `CONSOLE_CUSTOM_DOMAIN` per environment.

