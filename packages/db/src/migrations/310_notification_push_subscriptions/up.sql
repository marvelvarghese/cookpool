-- 310_notification_push_subscriptions: one Web Push subscription per device.
--
-- Context: notifications
-- Epic: cookpool-app (PW-5) — push, in the server. A phone or browser
--       subscribes (PushManager.subscribe) and the app hands its endpoint and
--       keys to POST /v1/notifications/push-subscriptions; notifications-worker
--       then pushes "someone set my portion", "a dish to claim" and "someone
--       paid me" to every device of a person who turned that kind on.
--
-- Design rules:
--   * One row per device: the endpoint is unique. A device that changes hands
--     (someone else signs in on it and subscribes) moves to the new person.
--   * Per person, not per organization: a person's devices get their pushes
--     from every group they are in, so the row has no org_id. subject_id is
--     the person's public id (usr_…), as notifications' recipient_subject_id
--     is.
--   * p256dh and auth are the browser's public key and auth secret
--     (base64url): what the payload is encrypted to, not a credential of
--     ours. The endpoint is an unguessable capability URL: it is never
--     logged, and only its own person's routes ever name it.
--   * At most ten per person (PUSH_SUBSCRIPTIONS_MAX_PER_PERSON): subscribing
--     one more drops the least recently subscribed (updated_at). The subject
--     index serves that and the per-person send.
--   * last_success_at / last_failure_at and a bounded reason record the last
--     send to the device; a 404 or 410 from the push service deletes the row.
--   * Additive: one new table, IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS notifications_push_subscriptions (
  id                   TEXT PRIMARY KEY,
  subject_id           TEXT NOT NULL,
  endpoint             TEXT NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 2048),
  p256dh               TEXT NOT NULL,
  auth                 TEXT NOT NULL,
  user_agent           TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 64),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  last_success_at      TEXT,
  last_failure_at      TEXT,
  last_failure_reason  TEXT CHECK (last_failure_reason IS NULL OR length(last_failure_reason) <= 160)
);

CREATE INDEX IF NOT EXISTS notifications_push_subscriptions_subject_idx
  ON notifications_push_subscriptions (subject_id, updated_at);

-- table notifications_push_subscriptions: One Web Push subscription per device (unique endpoint), for one person (subject_id, usr_…); at most ten per person. Not org-scoped: push reaches a person from every group.

-- column notifications_push_subscriptions.endpoint: The push service URL the browser gave (https only). An unguessable capability URL: never logged, never shown to anyone but its own person.

-- column notifications_push_subscriptions.p256dh: The browser's P-256 public key (base64url, 65 bytes uncompressed) the payload is encrypted to (RFC 8291). Not a credential.

-- column notifications_push_subscriptions.auth: The browser's 16-byte auth secret (base64url) mixed into the payload's key (RFC 8291). Only ever used to encrypt to that browser.

-- column notifications_push_subscriptions.user_agent: A short label from the browser's User-Agent when it subscribed ("Chrome on Android"); null when unknown.

-- column notifications_push_subscriptions.last_failure_reason: Bounded reason for the last failed send ("push_service_429"); never a raw push-service response.
