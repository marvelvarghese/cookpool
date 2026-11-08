/**
 * Notifications V1 contract.
 *
 * Owner: apps/notifications-worker (bounded context: notifications).
 * Spec: specs/components/14-notifications.md.
 *
 * The contract intentionally exposes a tiny, internal-only surface:
 *
 *   - enqueue a transactional notification (the only V1 send shape),
 *   - read / update preferences for a user or organization,
 *   - read delivery status for a specific notification,
 *   - suppress further delivery to a recipient.
 *
 * Provider-specific identifiers and payloads MUST stay behind the
 * NotificationProvider adapter and MUST NOT leak through these types.
 * No secret material (tokens, magic-link codes, raw provider responses)
 * may travel on these shapes — call sites should pass a `templateKey`
 * and a bounded, redaction-safe `templateData` map only.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * Notification channels that may carry a transactional notification.
 *
 * V1 ships with email only; the type is widened here so future channels
 * (sms, push, in-app) can be added without breaking the contract.
 */
export type NotificationChannel = "email";

/**
 * High-level routing category. Used for preferences and audit categorisation.
 * Mirrors the categories called out by spec 14 (invitation / billing /
 * security / support / product).
 */
export type NotificationCategory =
  | "invitation"
  | "billing"
  | "security"
  | "support"
  | "product";

/** Delivery lifecycle for a single notification record. */
export type NotificationStatus =
  | "queued"
  | "sent"
  | "failed"
  | "suppressed";

/**
 * Preference subject kind. A preference row is keyed either to a user
 * (e.g. user-level opt-out of product email) or an organization
 * (org-wide billing recipient overrides).
 */
export type NotificationSubjectKind = "user" | "organization";

// ---------------------------------------------------------------------------
// Recipient
// ---------------------------------------------------------------------------

/**
 * Recipient of a transactional notification.
 *
 * For V1 the only supported channel is email, so `address` is the canonical
 * lower-cased email address. `subjectKind` + `subjectId` are optional and
 * let the worker join back to the preference / suppression rows; when
 * omitted, preferences are not consulted (system-level notifications). When
 * present, a preference row for that subject in the request's org that sets
 * the request's category to `false` records the notification as
 * `suppressed` instead of sending it.
 */
export interface NotificationRecipient {
  channel: NotificationChannel;
  address: string;
  subjectKind?: NotificationSubjectKind;
  subjectId?: string;
}

// ---------------------------------------------------------------------------
// Enqueue request / response
// ---------------------------------------------------------------------------

/**
 * Request shape for POST /v1/notifications.
 *
 * `templateKey` is a stable, code-controlled identifier owned by the calling
 * worker (e.g. "invitation.created", "billing.receipt"). `templateData`
 * carries strictly redaction-safe substitutions — no tokens, no magic-link
 * codes, no API keys. The notifications worker is responsible for any
 * provider-side substitution; callers MUST NOT inline secret material.
 */
export interface EnqueueNotificationRequest {
  orgId: string;
  category: NotificationCategory;
  templateKey: string;
  templateData?: Record<string, string | number | boolean | null>;
  recipient: NotificationRecipient;
  /** Optional caller-provided idempotency key (must be unique per orgId). */
  idempotencyKey?: string;
  /** Optional correlation id for tracing back to the originating request. */
  correlationId?: string;
}

/** Single delivery attempt entry as seen at the API boundary. */
export interface NotificationAttempt {
  id: string;
  notificationId: string;
  attemptNumber: number;
  status: NotificationStatus;
  attemptedAt: string;
  /** Bounded error reason — never a raw provider payload. */
  errorReason: string | null;
}

/**
 * Public delivery-status shape for a single notification.
 *
 * The `providerMessageId` field is an opaque, provider-issued reference
 * returned by the adapter. It is exposed for operator traceability only
 * and must never contain credential material.
 */
export interface NotificationDeliveryStatus {
  id: string;
  orgId: string;
  category: NotificationCategory;
  templateKey: string;
  status: NotificationStatus;
  recipient: {
    channel: NotificationChannel;
    /** Lower-cased recipient address (e.g. email). */
    address: string;
  };
  providerMessageId: string | null;
  queuedAt: string;
  sentAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  attempts: NotificationAttempt[];
}

/** Response shape for POST /v1/notifications. */
export interface EnqueueNotificationResponse {
  notification: NotificationDeliveryStatus;
}

/** Response shape for GET /v1/notifications/:notificationId. */
export interface GetNotificationResponse {
  notification: NotificationDeliveryStatus;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * The channels a preference row can be for (Cookpool PW-5).
 *
 *   - `email`: per subject and organization (a person's email in one group),
 *     opt-out: only an explicit `false` stops a send.
 *   - `push`: Web Push to the person's devices. A person's push preferences
 *     are their own, in every group: the row lives under the system
 *     organization (PUSH_PREFERENCES_ORG_ID), and a kind is pushed only when
 *     it is explicitly `true` (opt-in, default off).
 *
 * Sends themselves stay email (`NotificationChannel`): push rides on the
 * email's enqueue, with the same template and idempotency key.
 */
export type NotificationPreferenceChannel = "email" | "push";

export const NOTIFICATION_PREFERENCE_CHANNELS: readonly NotificationPreferenceChannel[] = ["email", "push"];

/**
 * Per-category preference toggles.
 *
 * `null` means "not configured" — call sites should treat that as the
 * default (opt-in) for transactional categories. Marketing-style categories
 * are deliberately out-of-scope for V1.
 */
export interface NotificationCategoryPreferences {
  invitation?: boolean | null;
  billing?: boolean | null;
  security?: boolean | null;
  support?: boolean | null;
  product?: boolean | null;
}

/**
 * The kinds a person turns on or off one by one (PW-5): template keys of the
 * sends that can also go out as Web Push. `@saas/contracts/kitchen`'s
 * KITCHEN_EMAILS names the same keys (tests/contracts pins them):
 *
 *   kitchen.portion_set   someone set my portion ("Anu said you had 1 portion of Egg fried rice")
 *   kitchen.dish_posted   a dish to claim ("Egg fried rice is ready to claim")
 *   kitchen.paid_you      someone paid me ("Dev paid you ₹400.00 · UPI")
 */
export const NOTIFICATION_KINDS = ["kitchen.portion_set", "kitchen.dish_posted", "kitchen.paid_you"] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/**
 * Per-kind toggles, on either channel. `null` or a missing key is "not
 * configured": the channel's default — on for email (only `false` stops
 * one), off for push (only `true` sends one). A PUT merges these into what is
 * stored, key by key (`null` clears a key back to the default); categories
 * are replaced whole, as before.
 */
export type NotificationKindPreferences = { [K in NotificationKind]?: boolean | null };

/**
 * The organization a person's push preferences are stored under: the system
 * organization. Push is per person, not per group; callers leave `orgId` out
 * for `channel: "push"` and the worker uses this.
 */
export const PUSH_PREFERENCES_ORG_ID = "00000000-0000-0000-0000-000000000000";

export interface NotificationPreference {
  subjectKind: NotificationSubjectKind;
  subjectId: string;
  /** The group's id for email; PUSH_PREFERENCES_ORG_ID for push. */
  orgId: string;
  channel: NotificationPreferenceChannel;
  categories: NotificationCategoryPreferences;
  /**
   * Per-kind toggles (PW-5); `{}` when none is set. The worker returns it on
   * every row; it is optional in the type so rows built by hand before PW-5
   * still fit. Missing reads as `{}`: every kind at its channel's default.
   */
  kinds?: NotificationKindPreferences;
  updatedAt: string;
}

/**
 * GET /v1/notifications/preferences. `orgId` is required for email (and when
 * no channel is given), and left out for push. Through api-edge the subject
 * is always the signed-in person, whatever is sent.
 */
export interface GetNotificationPreferencesQuery {
  orgId?: string;
  subjectKind?: NotificationSubjectKind;
  subjectId?: string;
  channel?: NotificationPreferenceChannel;
}

/**
 * PUT /v1/notifications/preferences.
 *
 *   - email: `orgId` and `categories` are required, as before (categories
 *     replace what is stored); `kinds` is optional and merges.
 *   - push: `orgId` is left out (or is PUSH_PREFERENCES_ORG_ID), `kinds` is
 *     required and merges, and there are no categories.
 *
 * `subjectKind` / `subjectId` are pinned by api-edge to the signed-in person;
 * internal callers send them.
 */
export interface UpdateNotificationPreferencesRequest {
  orgId?: string;
  subjectKind?: NotificationSubjectKind;
  subjectId?: string;
  channel: NotificationPreferenceChannel;
  categories?: NotificationCategoryPreferences;
  kinds?: NotificationKindPreferences;
}

export interface GetNotificationPreferencesResponse {
  preferences: NotificationPreference[];
}

export interface UpdateNotificationPreferencesResponse {
  preference: NotificationPreference;
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

export type NotificationSuppressionReason =
  | "bounce"
  | "complaint"
  | "manual"
  | "unsubscribe";

export interface NotificationSuppression {
  orgId: string;
  channel: NotificationChannel;
  address: string;
  reason: NotificationSuppressionReason;
  createdAt: string;
}

export interface SuppressRecipientRequest {
  orgId: string;
  channel: NotificationChannel;
  reason: NotificationSuppressionReason;
}

export interface SuppressRecipientResponse {
  suppression: NotificationSuppression;
}

// ---------------------------------------------------------------------------
// Web Push (Cookpool PW-5)
// ---------------------------------------------------------------------------
//
// One subscription per device (a browser's PushSubscription), stored for the
// signed-in person. Every public route goes through api-edge, which pins the
// subject to the session: a person adds, replaces and removes only their own
// devices. The three kinds above are pushed to every device of a person who
// turned that kind on, after the email, with the email's idempotency key.

/** At most this many devices per person; subscribing one more drops the least recently subscribed. */
export const PUSH_SUBSCRIPTIONS_MAX_PER_PERSON = 10;

/** Longest endpoint accepted (push services' URLs are a few hundred characters). */
export const PUSH_ENDPOINT_MAX_LENGTH = 2048;

/** The browser's subscription keys, base64url: p256dh is a 65-byte P-256 point, auth 16 bytes. */
export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/**
 * POST /v1/notifications/push-subscriptions — `PushSubscription.toJSON()`
 * fits as is. The endpoint must be `https:`. Upserted by endpoint: a device
 * someone else had subscribed moves to the caller. Answers 200
 * `PushSubscriptionResponse`.
 */
export interface PushSubscriptionRequest {
  endpoint: string;
  keys: PushSubscriptionKeys;
  /** What `toJSON()` carries; ignored. */
  expirationTime?: number | null;
}

/** One of the caller's devices, as stored (never its keys). */
export interface PushDevice {
  endpoint: string;
  /** From the browser's User-Agent when it subscribed ("Chrome on Android"); null when unknown. */
  label: string | null;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface PushSubscriptionResponse {
  subscription: PushDevice;
}

/**
 * DELETE /v1/notifications/push-subscriptions `{ endpoint }`: removes the
 * caller's own subscription for that endpoint. Answers 200 `{ removed }` —
 * false when the caller has none there (another person's device is never
 * touched, and reads the same as no device).
 */
export interface UnsubscribePushRequest {
  endpoint: string;
}

export interface UnsubscribePushResponse {
  removed: boolean;
}

/**
 * GET /v1/notifications/push-key: the VAPID public key the app subscribes
 * with (`applicationServerKey`), base64url of the uncompressed P-256 point.
 * null while the environment has no VAPID key pair: push is off there.
 */
export interface PushKeyResponse {
  publicKey: string | null;
}

/**
 * POST /v1/notifications/push-test (no body, or `{ endpoint }` for one
 * device): a test push to the caller's own devices — "Send me a test".
 */
export interface PushTestRequest {
  endpoint?: string;
}

export interface PushTestResponse {
  /** The devices it was sent to. */
  devices: number;
  /** Accepted by the push service. */
  sent: number;
  /** The push service said the subscription is gone (404/410): deleted. */
  gone: number;
  /** Refused or failed otherwise (429, 5xx, …): recorded, not retried. */
  failed: number;
}

/**
 * What a push message decrypts to, for the service worker (PW-6): JSON,
 * under PUSH_MESSAGE_MAX_BYTES. `url` is a path in the app ("/dishes/dsh_…");
 * `tag` names what it is about and for whom, so a repeat replaces the one
 * shown instead of stacking.
 */
export interface PushMessage {
  kind: NotificationKind | "test" | PushToSubjectKind;
  title: string;
  body: string;
  url: string;
  tag: string;
}

export const PUSH_MESSAGE_MAX_BYTES = 3072;

// ---------------------------------------------------------------------------
// Push to a subject (Cookpool GC-3): internal only
// ---------------------------------------------------------------------------
//
// POST /v1/notifications/push-to-subject `{ subjectId, message }` pushes one
// message to every device of `subjectId`, with no preference check: it is for
// pushes the person asked for themselves — a timer they set (kitchen-worker's
// per-minute sweep) — and for an ask they must answer or one they made, on a
// group item whose buyer turned on "Ask me first" (Cookpool PN-8). The person
// is named in the body, so the route is reachable only over a service
// binding, from a worker in
// PUSH_TO_SUBJECT_INTERNAL_ACTORS: api-edge's notifications facade does not
// list it, and notifications-worker refuses any other caller (403).

/** The kinds a push to a subject may carry: never one of the preference kinds. */
export const PUSH_TO_SUBJECT_KINDS = ["kitchen.timer", "kitchen.ask"] as const;
export type PushToSubjectKind = (typeof PUSH_TO_SUBJECT_KINDS)[number];

/** The only callers notifications-worker takes a push to a subject from. */
export const PUSH_TO_SUBJECT_INTERNAL_ACTORS = ["kitchen-worker"] as const;

export const PUSH_TO_SUBJECT_PATH = "/v1/notifications/push-to-subject";

/** The longest title, body, url and tag a push to a subject may carry. */
export const PUSH_TO_SUBJECT_LIMITS = { title: 100, body: 200, url: 300, tag: 200 } as const;

export interface PushToSubjectRequest {
  /** The person (`usr_…`) whose devices hear it. */
  subjectId: string;
  /** `url` is an app path ("/cook/session"); `tag` names what it is (a timer's `tmr_…` id). */
  message: PushMessage & { kind: PushToSubjectKind };
}

/** The push summary; `skipped` says why nothing was sent, when nothing was tried. */
export interface PushToSubjectResponse extends PushTestResponse {
  skipped?: "push_off" | "no_devices";
}

// ---------------------------------------------------------------------------
// Provider adapter seam
// ---------------------------------------------------------------------------

/**
 * Bounded send context handed to a NotificationProvider implementation.
 *
 * Implementations MUST NOT receive raw secret material here. Provider-side
 * credentials are pulled from the provider's own configuration (Secrets
 * Store binding for stage/prod, no-op for local-debug).
 */
export interface ProviderSendContext {
  notificationId: string;
  orgId: string;
  category: NotificationCategory;
  templateKey: string;
  templateData: Record<string, string | number | boolean | null>;
  recipient: NotificationRecipient;
}

/**
 * Result returned by a NotificationProvider after attempting a send.
 *
 * `providerMessageId` is the opaque id the provider issued for the message
 * (used purely for operator traceability). `errorReason` is a bounded
 * human-readable string — implementations MUST scrub any provider-specific
 * payload, credential, or token from this field.
 */
export type ProviderSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; providerMessageId: string | null; errorReason: string };

/**
 * Provider extraction seam.
 *
 * V1 has exactly one implementation (local-debug) which records the
 * would-be send into the delivery table without contacting an external
 * service. A follow-up task will add a Resend / Postmark / SES adapter
 * behind this interface without touching any call site.
 */
export interface NotificationProvider {
  /** Stable identifier (e.g. "local-debug", "resend", "postmark"). */
  readonly name: string;
  send(ctx: ProviderSendContext): Promise<ProviderSendResult>;
}

// ---------------------------------------------------------------------------
// Internal service-binding contract sentinel
// ---------------------------------------------------------------------------

/**
 * Header sentinels for the internal-only V1 surface.
 *
 * The notifications worker MUST reject requests that arrive without these
 * headers — there is no public api-edge facade in V1. See spec 14
 * "Extraction Seam".
 */
export const NOTIFICATIONS_INTERNAL_ACTOR_HEADER = "x-internal-actor";
export const NOTIFICATIONS_INTERNAL_ACTOR_VALUES = [
  "identity-worker",
  "membership-worker",
  "billing-worker",
  "webhooks-worker",
  "events-worker",
  "policy-worker",
  "projects-worker",
  "config-worker",
  "metering-worker",
  "notifications-worker",
  // Cookpool's emails (CP-18): the use-soon digest, a dish posted for claims,
  // and a use or expense someone else logged for you.
  "kitchen-worker",
  // The public edge forwards end-user preference reads/updates over the
  // service binding with the subject pinned to the resolved session actor.
  "api-edge",
] as const;

export type NotificationsInternalActor =
  (typeof NOTIFICATIONS_INTERNAL_ACTOR_VALUES)[number];

// ---------------------------------------------------------------------------
// Audit event types
// ---------------------------------------------------------------------------

/**
 * Event type strings emitted on the events seam.
 *
 * Bodies MUST contain zero secret material — templateData substitutions
 * are deliberately not included in the envelope. Subscribers see only
 * non-secret routing metadata (orgId, category, templateKey, recipient
 * channel, recipient address).
 */
export const NOTIFICATION_EVENT_TYPES = {
  QUEUED: "notification.queued",
  SENT: "notification.sent",
  FAILED: "notification.failed",
  PREFERENCE_UPDATED: "notification.preference_updated",
  SUPPRESSED: "notification.suppressed",
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];
