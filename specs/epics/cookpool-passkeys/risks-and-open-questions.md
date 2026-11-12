# cookpool-passkeys — risks and open questions

## PK-A — WebAuthn library on Workers (RISK)

`@simplewebauthn/server` has to bundle and run on Workers. PK-2 runs a dry-run bundle and one verification in a test before building the routes.

## PK-B — Stage and prod share a parent domain (SETTLED)

`stage.cookpool.store` sits under `cookpool.store`, so a stage page could ask for prod-scoped passkeys. Prod checks the exact origin, which is `https://cookpool.store` only. Stage holds only test data.

## PK-C — workers.dev hosts can't use passkeys (ACCEPTED)

Passkeys belong to a domain. On the workers.dev console hosts the buttons hide, and Google or the code still work.

## PK-D — Lost device (SETTLED)

Passkeys sync through iCloud Keychain or the Google account. When none is left, the email code or Google gets the person back in, and they can remove old passkeys under Sign-in and security.

## PK-E — Prod email (ACCEPTED)

Codes reach prod only once `mail.cookpool.store` is verified in Cloudflare Email. Passkeys and Google don't depend on email.
