# notifications-worker — architecture

A `cloudflare-worker-turbo` component: TypeScript built by the turbo pipeline
from `apps/notifications-worker`, deployed per environment by its CI lane.

## Bindings and wiring

- **Service bindings** → `events-worker` —
  in-process RPC to sibling Workers; no public hops between contexts.
- **Wired configuration** (resolved at deploy time from job-output
  secrets published by the infrastructure terraform; names only):
  `WIRING_CLOUDFLARE_D1_STAGE`, `WIRING_CLOUDFLARE_D1_PROD`.
- **Web Push (Cookpool PW-5)**: `VAPID_PUBLIC_KEY` (a var per
  environment, base64url of the uncompressed P-256 point) and
  `VAPID_PRIVATE_KEY` (a runtime secret from orun secrets, base64url of the
  PKCS#8 DER). The VAPID `sub` is `mailto:` `EMAIL_FROM_ADDRESS`.

## Web Push (Cookpool PW-5)

Push rides on the email path. When an enqueue of `kitchen.portion_set`,
`kitchen.dish_posted` or `kitchen.paid_you` creates a notification (sent or
suppressed — never an idempotent hit), the worker pushes to every device of
the recipient who turned that kind on (`channel: "push"` preference row
under the system organization, `kinds`; default off). `src/push/crypto.ts`
does RFC 8291 `aes128gcm` and RFC 8292 VAPID with WebCrypto only;
`src/push/deliver.ts` POSTs to the push service (`TTL` 24 h, `Urgency:
normal`), deletes a subscription on 404/410 and records anything else on the
row, never retrying. Subscriptions live in `notifications_push_subscriptions`
(migration 310), one per endpoint, at most ten a person. Routes (internal;
api-edge exposes them with the subject pinned): `POST`/`DELETE
/v1/notifications/push-subscriptions`, `GET /v1/notifications/push-key`,
`POST /v1/notifications/push-test`.

## Boundaries

This Worker owns its bounded context: its data, its invariants, its
API surface (exposed to the fleet through the edge). Cross-context calls
go over service bindings; nothing else may reach into its storage.
