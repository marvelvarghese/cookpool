import type {
  EnqueueNotificationRequest,
  EnqueueNotificationResponse,
  GetNotificationResponse,
  GetNotificationPreferencesQuery,
  GetNotificationPreferencesResponse,
  NotificationKindPreferences,
  PushKeyResponse,
  PushSubscriptionRequest,
  PushSubscriptionResponse,
  PushTestResponse,
  SuppressRecipientRequest,
  SuppressRecipientResponse,
  UpdateNotificationPreferencesRequest,
  UpdateNotificationPreferencesResponse,
  UnsubscribePushResponse,
} from "@saas/contracts/notifications";

import type { RequestOptions, Transport } from "./transport.js";

/**
 * Notifications resource client.
 *
 * Backed by `apps/notifications-worker`. NOTE: per spec 14 the V1 surface is
 * service-binding-internal. The exceptions are the public api-edge routes,
 * with the subject pinned to the session: preferences (PX3) and Web Push
 * (Cookpool PW-5: `pushKey`, `subscribePush`, `unsubscribePush`,
 * `sendTestPush`, and push preferences through `getPreferences` /
 * `updatePreferences` with `channel: "push"`). The worker enforces this by requiring the `x-internal-actor`,
 * `x-actor-subject-id`, and `x-actor-subject-type` headers on every request.
 *
 * This SDK exposes the typed shape so internal callers (other workers, the
 * Cookpool backplane gateway, the CLI's privileged internal mode) can hit
 * the worker over a service binding with the correct headers passed via
 * `opts.headers`. External consumers MUST NOT receive this client wired to a
 * public base URL.
 */
export class NotificationsClient {
  constructor(private readonly transport: Transport) {}

  /**
   * POST /v1/notifications
   *
   * Enqueue a transactional notification. Pass `idempotencyKey` in `opts` for
   * safe retry semantics; the request body also carries an optional
   * `idempotencyKey` field that the worker uses for content-level dedupe.
   */
  enqueue(
    body: EnqueueNotificationRequest,
    opts: RequestOptions = {},
  ): Promise<EnqueueNotificationResponse> {
    return this.transport.request<EnqueueNotificationResponse>(
      { method: "POST", path: "/v1/notifications", body },
      opts,
    );
  }

  /** GET /v1/notifications/:notificationId */
  get(
    notificationId: string,
    opts: RequestOptions = {},
  ): Promise<GetNotificationResponse> {
    return this.transport.request<GetNotificationResponse>(
      {
        method: "GET",
        path: `/v1/notifications/${encodeURIComponent(notificationId)}`,
      },
      opts,
    );
  }

  /**
   * GET /v1/notifications/preferences
   *
   * Reads per-subject preferences; through api-edge the subject is always the
   * signed-in person. Email is per group: pass `orgId`. Push (PW-5) is the
   * person's own, in every group: `{ channel: "push" }` and no `orgId` — the
   * one row's `kinds` say which kinds are on (missing or null: off).
   */
  getPreferences(
    query: Partial<GetNotificationPreferencesQuery> = {},
    opts: RequestOptions = {},
  ): Promise<GetNotificationPreferencesResponse> {
    const params: Record<string, string> = {};
    if (query.orgId) params.orgId = query.orgId;
    if (query.subjectKind) params.subjectKind = query.subjectKind;
    if (query.subjectId) params.subjectId = query.subjectId;
    if (query.channel) params.channel = query.channel;
    return this.transport.request<GetNotificationPreferencesResponse>(
      { method: "GET", path: "/v1/notifications/preferences", query: params },
      opts,
    );
  }

  /**
   * PUT /v1/notifications/preferences
   *
   * Email: `{ orgId, channel: "email", categories }` (categories replace what
   * is stored; optional `kinds` merge). Push (PW-5): `{ channel: "push",
   * kinds }` — merged key by key, so `{ "kitchen.paid_you": true }` turns that
   * one kind on and leaves the others as they were.
   */
  updatePreferences(
    body: UpdateNotificationPreferencesRequest,
    opts: RequestOptions = {},
  ): Promise<UpdateNotificationPreferencesResponse> {
    return this.transport.request<UpdateNotificationPreferencesResponse>(
      { method: "PUT", path: "/v1/notifications/preferences", body },
      opts,
    );
  }

  /** The push kinds on for the signed-in person (PW-5): `updatePreferences` for `channel: "push"`. */
  setPushKinds(kinds: NotificationKindPreferences, opts: RequestOptions = {}): Promise<UpdateNotificationPreferencesResponse> {
    return this.updatePreferences({ channel: "push", kinds }, opts);
  }

  /**
   * GET /v1/notifications/push-key (PW-5): the VAPID public key to subscribe
   * with — `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
   * takes it as is (base64url). `publicKey` is null while push is off in this
   * environment.
   */
  pushKey(opts: RequestOptions = {}): Promise<PushKeyResponse> {
    return this.transport.request<PushKeyResponse>({ method: "GET", path: "/v1/notifications/push-key" }, opts);
  }

  /**
   * POST /v1/notifications/push-subscriptions (PW-5): keep this device's
   * subscription for the signed-in person. `subscription.toJSON()` fits as
   * is. Safe to repeat (it is upserted by endpoint): call it on every launch
   * that finds a subscription, so renewed keys reach the server.
   */
  subscribePush(subscription: PushSubscriptionRequest, opts: RequestOptions = {}): Promise<PushSubscriptionResponse> {
    const body: PushSubscriptionRequest = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    };
    return this.transport.request<PushSubscriptionResponse>(
      { method: "POST", path: "/v1/notifications/push-subscriptions", body },
      opts,
    );
  }

  /**
   * DELETE /v1/notifications/push-subscriptions (PW-5): forget this device
   * for the signed-in person (`removed: false` when it was not theirs or not
   * there). Call it before `subscription.unsubscribe()` and on sign-out.
   */
  unsubscribePush(endpoint: string, opts: RequestOptions = {}): Promise<UnsubscribePushResponse> {
    return this.transport.request<UnsubscribePushResponse>(
      { method: "DELETE", path: "/v1/notifications/push-subscriptions", body: { endpoint } },
      opts,
    );
  }

  /** POST /v1/notifications/push-test (PW-5): "Send me a test" — to this device only, given its endpoint. */
  sendTestPush(endpoint?: string, opts: RequestOptions = {}): Promise<PushTestResponse> {
    return this.transport.request<PushTestResponse>(
      { method: "POST", path: "/v1/notifications/push-test", body: endpoint ? { endpoint } : {} },
      opts,
    );
  }

  /**
   * POST /v1/notifications/recipients/:address/suppress
   *
   * Suppress further delivery to a recipient address. The body carries the
   * org id, channel, and reason; the URL slot carries the address verbatim
   * (already URL-encoded by the SDK).
   */
  suppressRecipient(
    address: string,
    body: SuppressRecipientRequest,
    opts: RequestOptions = {},
  ): Promise<SuppressRecipientResponse> {
    return this.transport.request<SuppressRecipientResponse>(
      {
        method: "POST",
        path: `/v1/notifications/recipients/${encodeURIComponent(address)}/suppress`,
        body,
      },
      opts,
    );
  }
}
