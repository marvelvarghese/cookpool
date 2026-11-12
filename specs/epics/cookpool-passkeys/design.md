# cookpool-passkeys — design

## 1. Passkeys in identity-worker

**Migration 510, `510_identity_passkeys`:**

- **`identity_passkeys`**
  - `id`: `pky_` plus 16 hex characters
  - `user_id`
  - `credential_id`: base64url, unique
  - `public_key`: COSE, base64url
  - `sign_count`: integer
  - `transports`: a JSON array
  - `aaguid`
  - `device_name`: 1–60 characters
  - `backed_up`: 0 or 1
  - `created_at`, `last_used_at`
  - an index on `(user_id)`
- **`identity_passkey_challenges`**
  - `id`, `kind` (`register` or `login`), `user_id` (null for `login`), `challenge`
  - `created_at`, `expires_at` (5 minutes later), `used_at`

**Configuration per environment:**
- `PASSKEY_RP_ID`: `localhost` for dev, `stage.cookpool.store` for stage, `cookpool.store` for prod.
- `PASSKEY_RP_NAME`: `Cookpool`.
- `PASSKEY_ORIGINS`: exact origins only. Prod lists just `https://cookpool.store`, so a stage page can never sign in to prod.
- When `PASSKEY_RP_ID` is empty, every passkey route answers 404 `passkeys_off`.

**Routes**, through api-edge's auth facade to identity-worker:

| Route | Who | Does |
|---|---|---|
| `POST /v1/auth/passkeys/register/options` | session | Creation options: `userVerification: required`, `residentKey: required`, excluding credentials the person already has. Refused with 409 `too_many_passkeys` at 10. |
| `POST /v1/auth/passkeys/register/verify` `{ response, deviceName? }` | session | Verifies the challenge, the origin, the RP ID hash and that the user was verified, then stores the passkey. 201 `{ passkey }`. A device name is made from the transports and the user agent when none is given. |
| `GET /v1/auth/passkeys` | session | `{ passkeys: [{ id, deviceName, createdAt, lastUsedAt, backedUp }] }`, newest first. |
| `DELETE /v1/auth/passkeys/{pky}` | session | Removes your own passkey; 404 otherwise. |
| `POST /v1/auth/passkeys/login/options` | anyone | Request options with an empty `allowCredentials` (the device offers its passkeys) and `userVerification: required`. Rate-limited by IP like `login/start`. |
| `POST /v1/auth/passkeys/login/verify` `{ response }` | anyone | Finds the credential, verifies it, checks that the sign count went up (or is 0), marks the challenge used, updates `last_used_at`, and returns **exactly the session body `login/complete` returns**. Unknown credentials, a bad signature, a used or expired challenge or a wrong origin all get 401 `passkey_failed`, with no detail. |

**Rules:**
- A delegated actor gets 403 on every passkey route.
- Security events `passkey.added`, `passkey.removed` and `passkey.used` are written through the existing security-events path.
- The library is `@simplewebauthn/server`, which runs on Workers with WebCrypto. A dry-run bundle confirms that first.

## 2. Contracts and SDK

- `packages/contracts/src/passkeys.ts`
- The SDK's `auth` gains `passkeyRegisterOptions`, `passkeyRegisterVerify`, `passkeys`, `removePasskey`, `passkeyLoginOptions` and `passkeyLoginVerify`.

## 3. Screens (apps/web-console-next, new frame and today's frame alike)

Every screen is on the canvas row "Getting in".

- **Sign in (`/login`)**
  - Tabs: Sign in · Create account.
  - A green welcome panel.
  - The **remembered account**, kept on this device: name, email, and the last method. With a passkey it shows **Sign in with Face ID**. "Use another account" forgets it.
  - For everyone else: Sign in with a passkey, then Google, then email → code.
- **Create account:** name and email up front, then the code. The name is saved after the code is accepted, but only if the account has no name yet.
- **Code:** six boxes that fill from one real input (`autocomplete=one-time-code`), sign in automatically at six digits, and accept a paste. Also Open Gmail (Gmail addresses only), resend with a countdown, the wrong-code and resent notices, and "Can't sign in?".
- **Can't sign in? (`/login/help`):** four problems that open in place: the code didn't arrive, I can't open that email any more, I'm not sure which email I used, too many tries. It never says whether an email has an account.
- **Turn on Face ID:** shown once after a code or Google sign-in when all of these are true:
  - the device has a platform authenticator;
  - the host matches `PASSKEY_RP_ID`;
  - this device holds no passkey;
  - it wasn't dismissed in the last 30 days.

  The words follow the device: Face ID on iPhone, fingerprint on Android, otherwise "your screen lock".
- **You → Sign-in and security:**
  - **Passkeys:** each by device name and last use, with Remove and Undo (the Remove waits 5 s).
  - **Add a passkey on this device.**
  - **Other ways in:** Google (linked or not), and the email code, always on.
- **Desktop:** the same steps beside the welcome panel.
- **Where passkeys don't run:** when WebAuthn is missing or the host isn't the RP ID (workers.dev), the passkey buttons hide and nothing else changes.

## 4. Out of scope

- Passwords.
- Sign out everywhere.
- Cross-device QR sign-in beyond what the browser offers on its own.
- Attestation checks; we accept `none`.
