# cookpool-passkeys (PK) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| PK0 — the spec | ✅ | #112 |
| PK1 — getting in | ✅ | #113 (PK-3), #114 (PK-2), #116 (PK-4), #117 (PK-6), #118 (PK-7) |
| PK2 — close-out | ✅ | this PR (PK-5) |

## Departures from the design

Each task adds a section at the end, headed `### <milestone> — <title> (<KEY>)`.

### PK1 — The getting-in screens (PK-3)

Console only; no server, contract or SDK change. Shown in every frame (sign-in is shared), not behind `newFrame()`. No passkey or Face ID control: PK-4 adds those.

**What was built** (`apps/web-console-next`):
- **Sign in (`/login`)**: on a phone, the green welcome panel at the top (mark, headline, three chips) and under it the **Sign in · Create account** tabs (`role=tablist`); from 900 px, the `WebAuth` two columns: the green panel (headline, chips, one line, footer) beside the form with the tabs and a form title. Google ("Continue with Google" / "Sign up with Google") when the API lists it, "or with email", the email field, **Email me a code**, the helper line, **Can't sign in?** and the terms line.
- **The remembered account** (`lib/remembered-account.ts`, localStorage `<prefix>.remembered-account` = `{ name, email, method: "google" | "code" }`): saved after every successful code sign-in (`app/login/page.tsx`) and Google sign-in (`app/auth/callback/page.tsx`, after its profile read); its name is updated when Create account or the Name step saves one. Sign in then shows "Welcome back, Rahul · rahul@gmail.com · Google", one dark main button **Continue as Rahul** (Google again, or a code sent straight to the remembered address) and **Use another account**, which deletes it and opens the empty form. It holds no token and deliberately **outlives sign-out** (`clearDeviceRecords` does not clear it): welcoming the person back after they signed out is its point.
- **Create account**: name (with the live initials and `Your groups see it, like "Rahul paid ₹60".`) and email up front; Email me a code stays grey until both are there. After the code is accepted the name is saved with `PATCH /v1/auth/profile` (a client made with the new token) **only when the profile has no name** (`signUpNameToSave`); an address that already has a named account just signs in. If that save fails, the existing Name step opens prefilled with the typed name and the error, so it never traps. The existing Name step still covers Google sign-ups with no name (`?step=name`).
- **The code**: back bar ("Sign in", or "Step 2 of 2" from Create account), the envelope tile, six boxes drawn from one real transparent input laid over them (`inputmode=numeric`, `autocomplete=one-time-code`, `maxlength=6`); it signs in by itself at six digits (once per code typed, as before) and accepts a paste ("246 810" keeps its digits). The boxes turn red for a refused code with the existing "That code didn't match. 4 more tries…" notice; **Open Gmail** (only for gmail.com / googlemail.com, opens `https://mail.google.com/mail/u/0/#inbox` in a new tab) beside **Send a new code** with the existing 60 s countdown, labelled "Again in 0:59"; after a resend the green notice "New code sent. The old one no longer works."; stage's "Test code" line; the spam line and Can't sign in?.
- **Can't sign in? (`/login/help`)**, a new static page: the four problems open in place, one at a time, with the board's tips and one way forward each (Send a new code → sign in, Write to us → `mailto:`, Continue with Google, Back to sign in), and the safety note. It calls no API about any address (only the OAuth provider list), so it can never say whether an email has an account; it names only the address this tab typed (sessionStorage `<prefix>.login-email`, which also refills the sign-in field on the way back). It carries the safe `next` there and back (`helpPathFor`).
- **Kept as they were**: join links (the card above the tabs, "You're joining Flat 4B" on Create account, the headline naming who you join, join-after-sign-in), the safe `next`, Google and its OAuth return, stage's test code, the developer sign-in off prod, the signed-out notice, every refusal and rate-limit message, and the Name step.
- **Static build**: `/login/help` is in `STATIC_PAGES` (`src/lib/static-pages.mjs`). It has no dynamic segment, so `_redirects` gains no rule: it is served as `login/help.html` with `_rsc/login/help.rsc`. `console-artifact.mjs build`: 51 pages generated, "42 pages served as files, 17 _redirects rules", `/login` and `/login/help` both static.

**Departures from the design and the boards:**
- **Create account is one form, not a second screen.** On a phone the Create account tab shows the name and email in place (as `WebAuth` draws for desktop) rather than `AuthWelcome`'s "Next" to a separate `AuthSignUp` screen with "Step 1 of 2"; the code screen still says "Step 2 of 2". One screen fewer, the same fields.
- **"Good to see you again."** heads the panel only when an account is remembered here; otherwise the pitch ("Cook together. Pay for what you use."), since a first visit also lands on Sign in. A join link's panel names who you are joining, as before.
- **Help's words, corrected where the board was not true of Cookpool:** "Check the address: …" uses the address this tab typed, or "the address you typed"; "they see the email you joined with under Members" became "Ask someone in your group which address they invited" (members' emails are not shown in the app); "After 5 wrong codes we pause new codes … for 15 minutes" became "After 5 codes in 15 minutes we pause new codes to that address for up to 15 minutes" (`LOGIN_CODES_PER_WINDOW`, `LOGIN_CODE_WINDOW_SECONDS`: five wrong tries only replace the code).
- **"Write to us" needs a support address.** It mails the new console config value `supportEmail` (runtime var `CONSOLE_SUPPORT_EMAIL`), **empty by default**. While it is empty, "I can't open that email any more" shows its other two tips and **Back to sign in** in place of Write to us (the "write to us from your new address" tip hides with it). It never falls back to `salesEmail`, which is another company's address.
- **"Continue with Google" on Help** is shown only when the API lists Google; otherwise that problem's button is Back to sign in.
- **Desktop footer**: Can't sign in? and the full terms sentence stacked, not `WebAuth`'s one row with "Terms · Privacy" links (there are no /terms or /privacy pages yet).
- The wrong-code words stay "…then we'll send you a new one." (SI-5's, pinned by its tests), not the board's "send a new one".

**Tests** (`tests/web-console-next`, pure modules): **110 suites, 2,197 tests**, 22 new in `kitchen-sign-in-screens.test.ts`: the tabs (switching only on the start, the back step keeping tab, name and address), labels and titles, the headline rules, Create account's readiness and name hint, saving the name only when the account has none, parsing and making the remembered account, its card and Continue method, the six boxes, Open Gmail only for Gmail, the resend button's countdown and the resent notice, Help's four problems and their actions, Help never varying with the address, the safe `next` on the help path, Write to us (and its hiding with no support address), and `/login/help` as a static page with no rewrite. Updated on purpose: `app-config` (the new `supportEmail` field), and for the new page `static-pages`, `kitchen-back` (`OUTSIDE_THE_APP`), `kitchen-transitions` and `gestures` page lists. `typecheck` and `lint` clean for `@saas/web-console-next` and `@saas/web-console-next-tests`.

**Browser check** (`next dev` behind a local mock of the API on `cookpool-stage.localhost:47732`, so `/api` stays on the page's origin; the network log showed no request to workers.dev or a cookpool host): at 390 × 844, `/login?next=/join/KTCH2345` showed the panel "Sign in to join Anu and the others", the join card, the tabs, Google and the email form; Create account showed "You're joining Flat 4B", the name with live "RV" and the grey button turning green; Email me a code opened "Step 2 of 2" with six boxes, Test code 246810, Open Gmail and "Again in 1:00"; 111111 turned the boxes red with "4 more tries"; pasting "246 810" signed in, sent `PATCH /v1/auth/profile {"displayName":"Rahul Varghese"}` (the mock account had no name) and went on to `/join/KTCH2345`, and the device stored `{"name":"Rahul Varghese","email":"rahul@gmail.com","method":"code"}`. Back on `/login`: "Good to see you again.", the RV card "rahul@gmail.com · email code", **Continue as Rahul** (which sent a code straight to that address) and Use another account (which removed the record and focused the empty email field). Can't sign in? from the code screen opened `/login/help`; the first problem opened in place with "Check the address: rahul@gmail.com." At 1440 × 900, the two columns as `WebAuth`. Not opened in the browser: Google's round trip (it leaves for the real API host), the resend after the full minute and the replaced-code path (unit-tested).

**For later tasks:**
- **PK-4:** add "Sign in with a passkey" above Google in `StartStep` (`components/kitchen/sign-in-steps-ui.tsx`) and "Sign in with Face ID" as the remembered card's button when `RememberedAccount.method` gains `"passkey"`; record it with `rememberAccount(user, "passkey")` after `passkeyLoginVerify`.
- **Owner:** pick Cookpool's support address and set `CONSOLE_SUPPORT_EMAIL` on the console Worker (stage and prod vars); until then Can't sign in? shows no Write to us.
- **Deploy:** console only.

### PK1 — Passkeys in the server (PK-2)

**Library (risk PK-A, settled).** `@simplewebauthn/server` **14.0.3**, pinned exactly in `apps/identity-worker`. Before the routes were built, a probe that generated registration and authentication options bundled with `wrangler deploy --dry-run --env prod` (~138 KiB gzip of library) and answered under local `wrangler dev` (workerd). The finished worker bundles at 999 KiB / 173 KiB gzip. The library logs nothing by default.

**Migration 510, `510_identity_passkeys`** (identity context, after 490):
- `identity_passkeys`: `id` (`pky_` + 16 hex, checked), `user_id` → `identity_users`, `credential_id` (base64url, UNIQUE), `public_key` (COSE, base64url), `sign_count` ≥ 0, `transports` (JSON array), `aaguid`, `device_name` 1–60, `backed_up` 0/1, `created_at`, `last_used_at`; index `identity_passkeys_user_idx (user_id)`.
- `identity_passkey_challenges`: `id`, `kind` (`register`|`login`), `user_id` (set for register, null for login — a CHECK), `challenge` (UNIQUE), `created_at`, `expires_at`, `used_at`; index on `expires_at`.
- Storage: `packages/db/src/identity/passkeys.ts` (`createPasskeysRepository`). The 10-passkey limit is counted inside the INSERT; a challenge is spent by one UPDATE that checks kind, person, unused and unexpired; the sign count moves only from the value it was read at (compare-and-set); challenges that expired more than a day ago are pruned when a new one is made.

**Routes** (identity-worker, forwarded by api-edge's auth facade):

| Route | Who | Answer |
|---|---|---|
| `POST /v1/auth/passkeys/register/options` | session | `{ options }`: `rp {name, id}`, `user.id` = the account UUID's 16 bytes, `residentKey: required`, `userVerification: required`, `attestation: none`, `excludeCredentials` = your passkeys, `timeout` 300000. 409 `conflict` / `too_many_passkeys` at 10. |
| `POST /v1/auth/passkeys/register/verify` `{ response, deviceName? }` | session | 201 `{ passkey: { id, deviceName, createdAt, lastUsedAt, backedUp } }`. 422 `validation_failed` (fields `response`, `deviceName`); 422 `precondition_failed` / `passkey_failed` when it does not verify; 409 `too_many_passkeys`. |
| `GET /v1/auth/passkeys` | session | `{ passkeys: [...] }`, newest first. |
| `DELETE /v1/auth/passkeys/{pky}` | session | `{ id, removedAt }`; 404 `not_found` when not yours. |
| `POST /v1/auth/passkeys/login/options` | anyone | `{ options }`: `rpId`, `allowCredentials: []`, `userVerification: required`, `timeout` 300000. |
| `POST /v1/auth/passkeys/login/verify` `{ response }` | anyone | Exactly login/complete's body `{ token, tokenType, expiresAt, user }`, from the same code. Any failure: 401 `unauthenticated`, message "Passkey sign-in failed", `details: { reason: "passkey_failed" }`, nothing else. |

- Every assertion is checked for: a challenge issued here, of its kind, unused and under 5 minutes old (spent before anything else is checked); the origin against `PASSKEY_ORIGINS` exactly; the RP ID hash; user presence and verification; the signature; a sign count that went up (or stayed 0 on both sides); and, when present, a user handle that is the passkey's person.
- **Delegated tokens:** 403 `forbidden` / `session_required` on all six at identity (API keys too; on the two public routes only when a non-session bearer is sent). api-edge refuses a delegated token on all six before forwarding (403 / `scope`): the delegation allowlist has no `/v1/auth/` entry, and `tests/api-edge` now lists the six paths among the refused.
- **Off switch:** an empty `PASSKEY_RP_ID` makes all six answer 404 `not_found` / `passkeys_off`, before the session or delegated-token checks.
- **Security events:** `passkey.added` (`passkeyId`, `deviceName`, `backedUp`, `aaguid`), `passkey.removed`, `passkey.used` (with the new session's id), `session.created` with `method: "passkey"`, and `login.complete.failed` with `method: "passkey"` and an outcome on each failed sign-in. Never a credential id or public key.
- **Config** (`wrangler.template.jsonc`, plain vars): local and dev `localhost` / `http://localhost:3000`; stage `stage.cookpool.store` / `https://stage.cookpool.store`; prod `cookpool.store` / `https://cookpool.store`; `PASSKEY_RP_NAME` `Cookpool` everywhere.
- **Contracts** `packages/contracts/src/passkeys.ts` (`@saas/contracts/passkeys`, re-exported from the index): the request and response types, the WebAuthn JSON shapes, `PASSKEY_MAX_PER_USER` 10, `PASSKEY_CHALLENGE_TTL_SECONDS` 300, `PASSKEY_DEVICE_NAME_MAX` 60, `PASSKEY_ID_RE`, `PASSKEY_ERROR_REASONS`. **SDK** `auth.passkeyRegisterOptions`, `passkeyRegisterVerify`, `passkeys`, `removePasskey`, `passkeyLoginOptions`, `passkeyLoginVerify`.

**Departures from the design**
- The pinned error codes stay as they are: `too_many_passkeys` is 409 `conflict` with `details.reason`, `passkeys_off` is 404 `not_found` with a reason, and `passkey_failed` is 401 `unauthenticated` with a reason.
- A registration that does not verify answers 422 `precondition_failed` / `passkey_failed`; the design names no status for it. A browser that reports `credProps.rk: false` is refused the same way.
- An empty `PASSKEY_ORIGINS` also turns passkeys off, since nothing could verify without it.
- Session minting was refactored, not copied: `issueSession` in `services/auth.ts` now serves the email code, OAuth and passkeys, and `handlers/session-body.ts` builds login/complete's 200 for both login/complete and passkey login. The session check that refuses delegated tokens moved from the delegation service to `services/session-user.ts`, shared by delegations and passkeys. Responses for both are unchanged.
- api-edge's auth facade now forwards `user-agent` on every auth route. It used to forward none, which left `security_events.user_agent` empty through the edge. It is what names a passkey nobody named (iPhone, Android phone, Mac, Windows PC, Security key, Phone; otherwise Passkey).

**Tests**
- `tests/identity-worker`: 18 suites, 280 tests, 53 of them new (`passkeys.test.ts` 17, `passkeys-refusals.test.ts` 36). A software authenticator (`helpers/soft-authenticator.ts`, an ES256 key made in the test that signs `authenticatorData` and `clientDataJSON`) drives register-then-login end to end and a body identical to login/complete's. The refusals cover a replayed challenge (login and register), an expired challenge (the 5-minute edge), an unissued challenge, a register challenge used to sign in, a wrong origin (lookalikes included), a wrong RP ID, a counter that went backwards or stood still, an unknown credential, a forged signature, no user verification, a wrong user handle, removal stopping login, the 10-passkey limit at options and at verify, delegated tokens and API keys refused on all six, and RP ID off.
- `tests/db`: 39 suites, 927 tests. New: `identity-passkeys-migration.test.ts` checks the checksum and order, the SQL text, the constraints on real SQLite, and the repository (limit, duplicates, compare-and-set count, one-time and expiring challenges, pruning). `identity-migration.test.ts` now lists 510 after 490.
- `tests/contracts`: 34 suites, 328 tests (new: `passkeys.test.ts`, 5).
- `tests/api-edge`: 28 suites, 635 tests (new: `passkeys-facade.test.ts`, 5; the six paths added to the delegated-token refusals and the facade route samples).
- `packages/sdk`: 16 files, 239 tests (new: `auth-passkeys.test.ts`, 7).
- `tests/config-worker`: 354 tests pass, unchanged.

**Deploy order.** db-migrate applies 510 before identity-worker deploys (an enforced edge on main). api-edge forwards to routes that 404 until identity-worker is out, which is harmless. PK-4's screens need this on main.

### PK1 — Passkey screens (PK-4)

Console only (`apps/web-console-next`, `tests/web-console-next`); no server, contract or SDK change (PK-2's `auth.passkey*` methods are used as they are). Shown in every frame (sign-in is shared), not behind `newFrame()`.

**Client library.** `@simplewebauthn/browser` **14.0.0** (released 2026-09-02), pinned exactly in `apps/web-console-next`, the same major as PK-2's `@simplewebauthn/server` 14.0.3. Only `startAuthentication`, `startRegistration` and `platformAuthenticatorIsAvailable` are used, in `lib/passkey-device.ts`; base64url handling is the library's.

**Where passkeys run** (`components/kitchen/passkeys.ts`, `passkeyRpId` / `passkeysRunHere`): `window.PublicKeyCredential` exists **and** the page's hostname equals the RP ID, which comes from the console's own deploy config: for `deployEnv` stage or prod, the custom domain `customDomains` names for that environment (`stage.cookpool.store`, `cookpool.store`); for a build that names no environment, `localhost`. A workers.dev host, a `*.localhost` proxy or the other environment's host never matches. Decided after mount (the pages are prerendered); until then nothing passkey-shaped renders. Everywhere else every passkey control is hidden and the screens are exactly PK-3's.

**What was built:**
- **Sign in with a passkey** (`PasskeySignInButton` in `passkey-ui.tsx`, wired in `StartStep`): the dark button above Google on the Sign in tab (phone and the `WebAuth` desktop form alike), "or with email" under it, and the helper line "No password. A passkey uses Face ID or your fingerprint; the email code works on any device." It runs `passkeyLoginOptions` → `startAuthentication` → `passkeyLoginVerify({ response })` (`signInWithPasskey`) and finishes through the same `signedIn` as a code: the token, `rememberSignInMethod("passkey")`, the remembered account with method `"passkey"`, the join-after-sign-in record, the Name step when the account has no name, then the safe `next`. A closed or timed-out sheet (`NotAllowedError`, `AbortError`, SimpleWebAuthn's wrapped forms) leaves the screen as it was; a 401 / `passkey_failed` (or a browser error) reads "That passkey didn't work. Try again, or use Google or an email code." under the button; options or network failures read "Couldn't sign in with a passkey just now. …".
- **The remembered account**: `RememberedMethod` gains `"passkey"`. Where passkeys run the card reads "rahul@gmail.com · passkey on this phone" (iPad: "this iPad", else "this device") and its button "Sign in with Face ID" (iPhone, iPad), "Sign in with your fingerprint" (Android), else "Sign in with a passkey", running the same flow (`continueMethod(account, google, passkeysRun)`). Where they do not run, it falls back to "Continue as Rahul" with a code.
- **Turn on Face ID** (`PasskeyOfferScreen`, `PasskeyOffer`): full screen, before landing, after a code sign-in (`app/login/page.tsx`, every place that used to `router.replace(destination)` now calls `land()`) or a Google sign-in (`app/auth/callback/page.tsx`; with no name the Name step goes first and the sign-in page offers it after). Shown only when `offerDue`: a sign-in just happened in this tab (sessionStorage `<prefix>.passkey-offer-due`, taken once), passkeys run, `isUserVerifyingPlatformAuthenticatorAvailable()` is true (asked last), this device holds no passkey (localStorage `<prefix>.passkey-here`, set on register or on a passkey sign-in), and "Not now" was not chosen in the last 30 days (`<prefix>.passkey-offer-dismissed`, ms). Turn on runs `passkeyRegisterOptions` → `startRegistration` → `passkeyRegisterVerify({ response, deviceName })` with `deviceName` "iPhone", "iPad", "Android phone", "Mac" or "Windows PC" from the user agent (iPadOS's "Macintosh" told apart by touch points; anything else leaves it to the server), then the done state and **Go on**. A closed sheet stays on the offer; the 10-passkey limit, "already registered here" or any failure goes on to the destination quietly. Words follow the device: Face ID (iPhone, iPad), fingerprint (Android), otherwise "your screen lock".
- **Sign-in and security** (`/you/security`, `passkey-security-ui.tsx`, `PasskeyManage`), a new static page in every frame. You's settings list (today's `/you`, the new frame's `/you/settings`) gains a **Sign-in and security** row under How you sign in, only where passkeys run. **Passkeys:** each by device name with "Synced · used today" / "One device · used 3 days ago" / "… never used"; **Remove** hides the row and shows "Passkey removed. Also delete it from your phone's passwords." with **Undo** for 5 s (`holdRemoval`), then sends `DELETE /v1/auth/passkeys/{pky}`; Undo cancels it; leaving the page sends a held removal at once; a failed DELETE brings the row back with a notice. **+ Add a passkey on this device** (hidden at 10), the same register ceremony; the limit and "already has one" have their own notices. **Other ways in:** Google when the API lists it ("Linked" only when this device last signed in with Google), and "Email code · always on, so you can't lock yourself out". Where passkeys do not run only Other ways in shows. Parent: `/you` (today's frame), `/you/settings` (new frame).
- **`user-agent` through `/api`**: checked. The console Worker's forwarder (`src/worker/api-forward.mjs`) copies every request header but the address ones, so `user-agent` reaches api-edge (and, since PK-2, identity-worker). No change; a test now pins it.

**Departures from the design and the boards:**
- The passkey row's second line says "Synced" or "One device" (from `backedUp`), not the board's "iCloud Keychain": the server does not know the provider.
- The offer's done button is "Go on" (per the task), not the board's "Go to Home": it goes to the safe `next`.
- Off-iPhone/Android words for the offer are this task's: "Next time, just use your screen lock", "Turn on passkey", "Your passkey is on". Android's: "Turn on fingerprint", "Fingerprint sign-in is on", "Saved as "Android phone" with your Google account."
- You's row to Sign-in and security shows only where passkeys run, so You on a workers.dev host is unchanged; "How you sign in" stays as it was (a passkey sign-in counts as no known method there).
- No "Signed in" section and no "Sign out everywhere" (out of scope).

**Tests** (`tests/web-console-next`): **112 suites, 2,226 tests**. New: `kitchen-passkeys.test.ts` (23: the RP ID from config and where passkeys run, the device from the user agent, device names, the button and card per device, `continueMethod`, the offer's conditions and the 30-day snooze, the offer's words, last-used wording, Synced/One device, the limit, Other ways in, Remove held 5 s / Undo / flush, sign-in success, cancel, `passkey_failed` and unreachable, register with and without a device name, the limit at options and verify, cancel / already / failed), `kitchen-passkey-device.test.ts` (5: the device records, the once-per-sign-in mark, and `shouldOfferPasskey` asking the browser only when everything else holds), and one in `api-forward.test.ts` (user-agent passes through). Updated on purpose: `kitchen-sign-in-screens` (`"passkey"` is now a valid remembered method; the bad-method example became `"password"`), `gestures` (`/you/security` does not pull to refresh). `typecheck` and `lint` clean for `@saas/web-console-next` and `@saas/web-console-next-tests`. `console-artifact.mjs build`: 52 pages generated, "43 pages served as files, 17 _redirects rules", `/login`, `/auth/callback` and `/you/security` static.

**Browser check** (`next dev` on 47911 behind a local mock of the API on `cookpool-stage.localhost:47912`; every request went to that origin, none to workers.dev or a cookpool host). With the real config the host is not the RP ID: `/login` (which has `PublicKeyCredential`) showed no passkey button, `/you/settings` no Sign-in and security row, `/you/security` only Other ways in. Then, with an **uncommitted** one-line change mapping stage's custom domain to `cookpool-stage.localhost` (reverted after) and `navigator.credentials` stubbed in the page (no real authenticator), at 375 × 812 (Android user agent): `/login?next=/join/KTCH2345` showed the join card, the dark Sign in with a passkey above Google; a cancelled sheet changed nothing; a mock 401 showed the failed notice; a good assertion signed in, opened the Name step (the account had none), then landed on `/join/KTCH2345` with `{"method":"passkey"}` remembered and no offer. Back on `/login`: "rahul@gmail.com · passkey on this phone" and **Sign in with your fingerprint**. A code sign-in after clearing the device flag opened "Next time, just use your fingerprint"; a cancelled sheet stayed on it; Turn on sent register options and verify (the new passkey listed as "Android phone") and showed "Fingerprint sign-in is on" → Go on → `/home`. `/you/security` listed four passkeys with their last use; Remove → Undo sent no DELETE; Remove and wait sent the DELETE only after 5 s. At 1440 × 900 the passkey button sits above Google in the `WebAuth` form. Not run in a browser: a real authenticator, Google's round trip, Not now (unit-tested).

**For later tasks:**
- **Deploy:** console only. It needs PK-2's routes live (they are on main); on a host where they 404, the button would say "Couldn't sign in with a passkey just now" — only on the RP ID hosts, which PK-2 already configures.
- The `passkey-here` flag is per device and is not cleared when the person removes this device's passkey under Sign-in and security (the page cannot tell which passkey is this device's), so the offer will not come back on that device by itself; Add a passkey on this device still works.

### PK1 — Passkey fixes from the first phone test (PK-6)

**What happened.** On stage, in iPhone Safari, Turn on Face ID after a code or Google sign-in saved nothing on the server, so passkey sign-in failed afterwards. There were two causes. First, both buttons fetched the ceremony options *after* the tap, and Safari allows `navigator.credentials.create/get` only straight from a tap (after an `await` it throws `NotAllowedError`, which the console read as a closed sheet). Second, the server refused any registration whose `credProps.rk` was `false`, and Safari can report that for a passkey it has just saved. Nothing was recorded either way: registration failures wrote no event, and the offer moved on quietly after any failure.

**Server (`apps/identity-worker/src/services/passkeys.ts`).**
- `registerVerify` no longer refuses on `credProps.rk === false`. `residentKey: required` in the options is what asks for a passkey, and by the time `credProps` arrives the device already holds the passkey.
- Every refused registration writes the security event **`passkey.add.failed`**. Its `outcome` (and `metadata.step`) is the step that refused it: `invalid_challenge`, `not_verified`, `not_user_verified`, `store_failed`, `duplicate` or `too_many`. The event also carries `metadata.method: "passkey"`, the user and the session. It never carries a credential id, a public key, or the attestation.
- The 422 for a registration that doesn't verify keeps `precondition_failed` / `details.reason: "passkey_failed"` and adds **`details.step`** (`invalid_challenge`, `not_verified` or `not_user_verified`). The 409s (`too_many_passkeys`, already added) and the 500 (store failed) are unchanged; only their event is new. `too_many` is recorded both at options and at verify.
- User verification is still required. The library is now called with `requireUserVerification: false` and the service checks `info.userVerified` itself, so that refusal can name its own step. The library still checks user presence.
- Login refusals are exactly as before: the bare 401 `passkey_failed`, with `login.complete.failed` events.
- **Contracts:** `PASSKEY_REGISTER_STEPS` and `PasskeyRegisterStep` in `packages/contracts/src/passkeys.ts`. No new error code.

**Console.**
- **Options before the tap.** `createOptionsPrefetch` in `components/kitchen/passkeys.ts` holds one set of options. They count as fresh for `PASSKEY_OPTIONS_FRESH_MS` (4 minutes; the challenge lives 5). Fetches that overlap share one request, and taking the options spends them. `usePrefetchedOptions` / `useRegisterOptions` in `passkey-ui.tsx` fetch while their screen shows, again when the options go stale, and when the tab becomes visible. A failed fetch is not retried on a timer; the next tap fetches again. Where they run:
  - **Turn on Face ID** (`PasskeyOfferScreen`): register options, from the moment the offer shows.
  - **Add a passkey on this device:** register options, while the button shows.
  - **Sign in with a passkey and the remembered card's Face ID button:** login options, while the Sign in tab's start step shows, only where passkeys run.
- **The tap rule.** `signInWithPasskey` and `addPasskey` take the prefetch, not an options call, and start `startAuthentication` / `startRegistration` synchronously; the tap handlers (`turnOn`, `add`, `startPasskey`, `continueAsRemembered`) have no `await` before them. If no fresh options are held at the tap, they fetch them and answer `retry`: the screen shows "That took a moment. Tap again to carry on." and the button reads Try again, instead of opening the sheet after an await. Each attempt that does not sign in refills the prefetch.
- **Turn on Face ID and Add a passkey never move on silently.** What each outcome shows:
  - **A closed sheet:** stays on the screen, with no notice.
  - **Any other failure:** "Couldn't save the passkey. Try again, or carry on with Google or an email code.", **Try again**, and on the offer **Not now** too. Under it, in small muted mono text, is the browser's error name (`NotAllowedError`, `SecurityError`, …, seen through SimpleWebAuthn's wrapper) or the server's `step · status` (e.g. `not_user_verified · 422`).
  - **The limit:** "You have 10 passkeys. Remove one under Sign-in and security first."; on the offer the main button becomes Go on (which snoozes the offer).
  - **`InvalidStateError`:** still counted as set up (the device is marked, and the offer shows its done state with Go on), and it now says "This phone already has a Cookpool passkey." (iPad: "This iPad …", otherwise "This device …").
- **Refused passkey sign-in (401)** now reads "That passkey didn't work. Try again, or use Google or an email code. If you turned on Face ID before today, open Sign-in and security after signing in and add it again." A browser error keeps the shorter notice; options or network failures keep "Couldn't sign in with a passkey just now. …".

**Departures**
- `PASSKEY_LIMIT_NOTICE` and `PASSKEY_ADD_FAILED_NOTICE` changed their words, on purpose, on Sign-in and security too. The security page's old "This device already has a passkey for you." became the device-aware notice above.
- On the offer, the limit replaces Turn on with Go on, rather than offering Try again, which could not succeed.
- On the offer, `InvalidStateError` now shows the done screen with the "already has" line, instead of landing straight away.
- The prefetch spends one request from the auth family's per-IP limit (10 a minute) each time the Sign in tab shows, plus one every 4 minutes while it stays open and visible.

**Tests**
- `tests/identity-worker`: 19 suites, **290 tests**.
  - New: `passkeys-register-failures.test.ts` (11 tests):
    - `credProps.rk` false is stored and then signs in;
    - each verify step's 422 carries `details.step` and writes one `passkey.add.failed` with that outcome;
    - a replayed challenge gives `invalid_challenge`;
    - the same credential twice gives `duplicate`;
    - a failed store gives `store_failed`;
    - the limit gives `too_many` at options and at verify;
    - the event holds no id, rawId, attestationObject or clientDataJSON;
    - login refusals stay the bare 401 and write no `passkey.add.failed`.
  - Changed on purpose: `passkeys-refusals.test.ts` lost its "not resident" refusal row.
- `tests/contracts`: 34 suites, **329 tests** (+1: the register steps, none of them an error code).
- `tests/web-console-next`: 113 suites, **2,235 tests**.
  - New: `kitchen-passkey-tap.test.ts` (9 tests):
    - the sheet starts synchronously in the tap, with no network call before it, for add and for sign-in;
    - with no options at the tap, it fetches and answers `retry` without opening the sheet;
    - after an attempt it fetches again, and a challenge is never reused;
    - a source check that the four tap handlers have no `await`, `.then(` or fetch before the ceremony;
    - options stay fresh for 4 minutes, and overlapping fetches share one;
    - the notices, the detail line and `addNotice`'s mapping.
  - `kitchen-passkeys.test.ts`: the ceremony tests were moved to the prefetch, the refused-sign-in notice was added, and failures now carry their detail.
- `typecheck` and `lint` are clean for `@saas/contracts`, `@saas/identity-worker`, `@saas/web-console-next` and the three test packages.
- `console-artifact.mjs build`: "43 pages served as files, 17 _redirects rules". `/login`, `/auth/callback` and `/you/security` are static.

**Browser check** (`next dev` on 47961 behind a local mock and proxy on `cookpool-stage.localhost:47962`; every resource went to that origin; an **uncommitted** change mapped stage's custom domain to that host and was reverted afterwards).
- `navigator.credentials` was stubbed to act like Safari: it rejects with `NotAllowedError` if any `fetch` ran between the click and the call.
- `/login` fetched login options on load.
- Sign in with a passkey opened the sheet with no fetch first. The mock's 401 showed the new notice, and login options were fetched again.
- A code sign-in opened the offer, which fetched register options as it showed.
  - A cancelled sheet stayed on the offer.
  - A mock 422 with `not_user_verified` showed the failure notice, `not_user_verified · 422`, Try again and Not now, still on `/login`.
- On `/you/security`, register options were fetched once Add showed. A 422 gave Try again and the detail; Try again with the server accepting added "iPhone" with a new challenge; `InvalidStateError` showed "This device already has a Cookpool passkey." (desktop user agent).
- Not run: a real iPhone, a real authenticator, the limit notice in a browser (unit-tested).

**Deploy.** identity-worker and the console both change in this PR, so each redeploys on its own path. The order doesn't matter: the console reads `details.step` when it is there and shows the code otherwise. Passkeys that people "turned on" before this fix were never stored. The new sign-in notice tells them to add the passkey again. Their phones may still hold an orphan passkey; the server cannot clean those up.

### PK1 — Saving a passkey answers 500 on stage (PK-7)

**Root cause.** Migration 510 checked `identity_passkeys.id` with a single GLOB of 132 characters: `'pky_'` followed by sixteen `'[0-9a-f]'`. D1 limits a LIKE or GLOB pattern to 50 bytes (`SQLITE_LIMIT_LIKE_PATTERN_LENGTH`), while plain SQLite allows 50,000. So on D1, every `INSERT` into `identity_passkeys` failed with `D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR`. The repository's `create` caught it as "Failed to create passkey", and `registerVerify` answered 500 `internal_error` "Failed to store passkey", with `passkey.add.failed` / `store_failed`. No passkey was ever stored on stage, whatever the device sent. The iPhone response shape, the foreign keys, `RETURNING`, the JSON CHECKs, the challenge and the security events were all fine. The tests passed because `tests/db` runs on `node:sqlite` with default limits, and `tests/identity-worker` uses an in-memory fake store.

**Reproduced locally.**
- Ran `wrangler dev --local` with miniflare's local D1. A scratch config was used: the rendered `wrangler.jsonc`'s local vars plus a top-level `PLATFORM_DB` binding, because the template binds D1 only under stage and prod. `PASSKEY_RP_ID=localhost`, `PASSKEY_ORIGINS=http://localhost:3000`.
- Every manifest migration was applied in order with `wrangler d1 execute --local --file`. The repo's runner speaks only D1's REST API, so it has no local mode.
- A script signed in through the on-screen code, then sent register options and then verify, with an iPhone-shaped ES256 credential:
  - `fmt: none`, AAGUID all zeros;
  - flags UP, UV, BE, BS, AT;
  - `transports ["hybrid","internal"]`, `authenticatorAttachment: platform`;
  - `clientExtensionResults` `{credProps:{rk:true}}` and `{}`.
- Before the fix, verify answered 500 "Failed to store passkey". A temporary `console.error` (since removed) showed the D1 error.
- After the fix, verify answered 201 for both `clientExtensionResults` shapes. Sign-in with the new passkey answered 200, and the list showed the passkey with its last use. `passkey.added`, `passkey.used` and `session.created` were recorded with their session ids. This was checked on the migrated local D1 and again on a fresh one with all 51 migrations.
- Nothing touched stage or prod.

**Fix: migration 520, `520_identity_passkeys_id_check`** (identity, after 510).
- It rebuilds `identity_passkeys` the same way 320 rebuilt its table: create `identity_passkeys_next`, `INSERT OR IGNORE` every row, `DROP`, `RENAME`, and re-create `identity_passkeys_user_idx`.
- The id CHECK is now `length(id) = 20 AND substr(id, 1, 4) = 'pky_' AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'`. It is the same rule, and its longest pattern is 11 bytes.
- Every other column, default, constraint and the foreign key are unchanged, so the worker needs no change. Nothing references the table, so the DROP breaks no foreign key. On stage and prod the table is empty, so the copy moves nothing.
- `identity_passkey_challenges` is untouched.
- Checked on local D1: the new CHECK refuses uppercase, non-hex and short ids.

**Console** (`components/kitchen/passkeys.ts`, `serverFailureDetail`). On a 5xx, the small detail line now puts the server's message first, for example `Failed to store passkey · internal_error · 500`, so a future failure says which step broke.
- The message is cut at 120 characters.
- The SDK's stand-in `HTTP 5xx` is left out.
- Below 500 nothing changes (`not_user_verified · 422`).
- identity-worker's 500 messages were already generic and named their step ("Failed to store passkey", "Failed to read passkeys", "Failed to create passkey challenge"), and none carries a credential. They are unchanged.

**Departures**
- The task named `apps/db-migrate` or `wrangler d1 migrations` for applying migrations locally. Neither exists for this repo's layout: db-migrate is `infra/db-migrate` over `packages/db/src/runner`, which talks to the REST API only. So the manifest's `up.sql` files were applied in order with `wrangler d1 execute --local`. No repo script was added.
- No identity-worker source change: the fix is the schema.

**Tests**
- **The test databases now follow D1's rules.** New `tests/db/src/d1-sqlite.ts`: `openD1Sqlite()` turns foreign keys on and sets D1's 50-byte pattern limit through `node:sqlite`'s `limits` option. Node 25 enforces that option; older Node ignores it. `likePatternsOver()` finds any LIKE or GLOB literal in the schema longer than 50 bytes, on any Node version. `sqlite-schema.test.ts` and `identity-passkeys-migration.test.ts` now open their databases with `openD1Sqlite()`; this matches production.
- `tests/db`: 40 suites, **937 tests**.
  - New `identity-passkeys-id-check-migration.test.ts` (8 tests):
    - registered after 510, with its checksum;
    - only the rebuild statements;
    - after 510 the schema holds one 132-character pattern, and after 520 none;
    - the iPhone-shaped passkey stores through the repository on D1 limits;
    - 510's id rule still holds;
    - the other constraints, the FK and the index still hold;
    - a 510 table's rows are copied;
    - 510 alone refuses the insert where the limit applies.
  - New in `sqlite-schema.test.ts`: every LIKE or GLOB pattern in the final schema is within 50 bytes. This guards every table, now and later.
  - Changed on purpose: `identity-migration.test.ts` lists 520 after 510.
- `tests/identity-worker`: 20 suites, **292 tests**. New `passkeys-d1-store.test.ts` (2 tests):
  - register verify and then sign-in on the real passkeys repository, over SQLite with every migration, foreign keys and D1's limit, with the iPhone shape and both `clientExtensionResults`;
  - a failed store answers 500 "Failed to store passkey" without the credential id.
- **Fails without the fix.** With 520 taken out of the manifest:
  - `sqlite-schema`'s pattern check fails on any Node version;
  - six `identity-passkeys-migration` tests fail with "LIKE or GLOB pattern too complex" on Node 25;
  - the identity-worker iPhone test fails with stage's exact 500, "Failed to store passkey".
- `tests/web-console-next`: 113 suites, **2,235 tests** (the 500 cases were added to existing tests in `kitchen-passkey-tap` and `kitchen-passkeys`).
- `typecheck` and `lint` are clean for `@saas/db`, `@saas/db-tests`, `@saas/identity-worker-tests`, `@saas/web-console-next` and `@saas/web-console-next-tests`.
- `console-artifact.mjs build`: "43 pages served as files, 17 _redirects rules". `/login` and `/you/security` are static.

**Deploy.**
- db-migrate applies 520 on its own path. It is the whole server fix: identity-worker needs no redeploy, since its code is unchanged.
- The console redeploys on its own files, for the detail line.
- After 520 is on stage, Add a passkey should save. Passkeys that people "turned on" before this fix were never stored. Their phones may hold orphan Cookpool passkeys; adding again saves a new one.

### PK2 — Close-out (PK-5)

- **Verified on a real phone on 2026-11-12.** The owner, on iPhone Safari on stage, added a passkey under Sign-in and security, signed out, and signed back in with Face ID. That meets PK1's done-when.
- **Two bugs only a real phone found:**
  - **Safari's tap rule (PK-6):** options are now fetched before the tap.
  - **D1's 50-byte LIKE/GLOB pattern limit (PK-7):** migration 520. The tests now run with D1's limits, and a schema check refuses any pattern over 50 bytes.
- **Open for the owner:** a Cookpool support address. Until one is set, "Write to us" on Can't sign in? stays hidden (`supportEmail`).
- **Prod:** the passkey routes, migrations 510 and 520, and the getting-in screens are all deployed. Passkeys work on `cookpool.store`. Email codes reach prod once `mail.cookpool.store` is verified in Cloudflare Email.
- **Passkeys added before PK-7 were never stored.** Phones may still hold orphan Cookpool passkeys. Adding one again replaces them.

