// Sending Web Push (Cookpool PW-5): one encrypted POST per device, VAPID
// signed, and what the push service's answer means for the subscription.
//
//   2xx       sent: last_success_at
//   404, 410  the subscription is gone: deleted (RFC 8030 §7.3)
//   else      failed (429, 5xx, 400/401/403/413, a network error): recorded as
//             last_failure_at + a bounded reason, never retried here — the
//             next event tries again
//
// Best-effort throughout: nothing here throws to its caller, so a push can
// never fail the email it rides on.

import {
  PUSH_PREFERENCES_ORG_ID,
  isNotificationKind,
  type PushMessage,
  type PushTestResponse,
} from "@saas/contracts/notifications";
import type { NotificationsRepository, PushSubscriptionsRepository, StoredPushSubscription } from "@saas/db/notifications";
import type { Uuid } from "@saas/db/ids";
import type { TemplateData } from "../templates/index.js";
import { renderPushMessage } from "../templates/push.js";
import {
  VAPID_TOKEN_TTL_SECONDS,
  audienceOf,
  base64urlDecode,
  encryptWebPush,
  isUncompressedP256,
  signEs256Jwt,
  vapidAuthorization,
} from "./crypto.js";
import { logPushOff, type VapidKeys, type VapidLoad } from "./vapid.js";

/** A day: an event a phone hears about a day late is still worth hearing. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** How long one push service gets to answer. */
export const PUSH_TIMEOUT_MS = 10_000;

export type PushOutcome =
  | { kind: "sent"; status: number }
  | { kind: "gone"; status: number }
  | { kind: "failed"; status: number | null; reason: string };

export interface PushSendDeps {
  fetch: typeof fetch;
  now: () => Date;
}

/** One VAPID token per push service origin per run (they live 12 hours). */
type TokenCache = Map<string, Promise<string>>;

function tokenFor(endpoint: string, keys: VapidKeys, deps: PushSendDeps, cache: TokenCache): Promise<string> {
  const aud = audienceOf(endpoint);
  let token = cache.get(aud);
  if (!token) {
    const exp = Math.floor(deps.now().getTime() / 1000) + VAPID_TOKEN_TTL_SECONDS;
    token = signEs256Jwt({ aud, exp, sub: keys.subject }, keys.privateKey);
    cache.set(aud, token);
  }
  return token;
}

/** Encrypt `message` to one device and POST it to its push service. Never throws. */
export async function sendWebPush(
  subscription: Pick<StoredPushSubscription, "endpoint" | "p256dh" | "auth">,
  message: PushMessage,
  keys: VapidKeys,
  deps: PushSendDeps,
  cache: TokenCache = new Map(),
): Promise<PushOutcome> {
  const uaPublic = base64urlDecode(subscription.p256dh);
  const auth = base64urlDecode(subscription.auth);
  if (!isUncompressedP256(uaPublic) || !auth || auth.length !== 16) {
    return { kind: "failed", status: null, reason: "invalid_subscription_keys" };
  }
  let body: Uint8Array;
  let authorization: string;
  try {
    body = await encryptWebPush(new TextEncoder().encode(JSON.stringify(message)), uaPublic, auth);
    authorization = vapidAuthorization(await tokenFor(subscription.endpoint, keys, deps, cache), keys.publicKey);
  } catch {
    return { kind: "failed", status: null, reason: "encrypt_failed" };
  }

  let response: Response;
  try {
    response = await deps.fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(PUSH_TTL_SECONDS),
        urgency: "normal",
      },
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch {
    return { kind: "failed", status: null, reason: "push_service_unreachable" };
  }
  // Nothing in the answer is ours to keep (it may echo the endpoint).
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or closed: nothing to release.
  }
  const status = response.status;
  if (status >= 200 && status < 300) return { kind: "sent", status };
  if (status === 404 || status === 410) return { kind: "gone", status };
  return { kind: "failed", status, reason: `push_service_${status}` };
}

export interface PushDeliveryDeps extends PushSendDeps {
  subscriptions: PushSubscriptionsRepository;
  /** The environment's VAPID keys (loadVapidKeys(env) in the worker). */
  keys: () => Promise<VapidLoad>;
}

export type PushSummary = PushTestResponse & {
  /** Why nothing was sent, when nothing was tried. */
  skipped?: "push_off" | "no_devices" | "unreadable";
};

const NOTHING: PushTestResponse = { devices: 0, sent: 0, gone: 0, failed: 0 };

/**
 * Push `message` to a person's devices — every one, or only `endpoint` — and
 * keep what each push service said. Never throws.
 */
export async function pushToDevices(
  deps: PushDeliveryDeps,
  subjectId: string,
  message: PushMessage,
  endpoint?: string,
): Promise<PushSummary> {
  try {
    const loaded = await deps.keys();
    if (!loaded.ok) {
      logPushOff(loaded.problem);
      return { ...NOTHING, skipped: "push_off" };
    }
    const listed = await deps.subscriptions.listForSubject(subjectId);
    if (!listed.ok) return { ...NOTHING, skipped: "unreadable" };
    const devices = endpoint ? listed.value.filter((s) => s.endpoint === endpoint) : listed.value;
    if (devices.length === 0) return { ...NOTHING, skipped: "no_devices" };

    const cache: TokenCache = new Map();
    const outcomes = await Promise.all(
      devices.map(async (device) => {
        const outcome = await sendWebPush(device, message, loaded.keys, deps, cache);
        const at = deps.now();
        try {
          if (outcome.kind === "sent") await deps.subscriptions.recordSuccess(device.id, at);
          else if (outcome.kind === "gone") await deps.subscriptions.deleteGone(device.id, device.endpoint);
          else await deps.subscriptions.recordFailure(device.id, at, outcome.reason);
        } catch {
          // The record is bookkeeping; the push itself already happened (or not).
        }
        return outcome;
      }),
    );
    return {
      devices: devices.length,
      sent: outcomes.filter((o) => o.kind === "sent").length,
      gone: outcomes.filter((o) => o.kind === "gone").length,
      failed: outcomes.filter((o) => o.kind === "failed").length,
    };
  } catch {
    return { ...NOTHING, skipped: "unreadable" };
  }
}

export interface TemplatePush {
  /** The recipient (`usr_…`). */
  subjectId: string;
  templateKey: string;
  templateData: TemplateData;
  /** The enqueue's idempotency key, or the notification's own id: names what and for whom. */
  tag: string;
}

export interface TemplatePushDeps extends PushDeliveryDeps {
  prefs: Pick<NotificationsRepository, "listPreferences">;
}

/**
 * The push that goes with an email (enqueue): only for the three kinds, only
 * to a person who turned that kind on for push (their row under the system
 * organization; default off), to every device they have. Never throws.
 */
export async function pushForTemplate(deps: TemplatePushDeps, push: TemplatePush): Promise<PushSummary | null> {
  if (!isNotificationKind(push.templateKey)) return null;
  try {
    const loaded = await deps.keys();
    if (!loaded.ok) {
      logPushOff(loaded.problem);
      return { ...NOTHING, skipped: "push_off" };
    }
    const prefs = await deps.prefs.listPreferences(PUSH_PREFERENCES_ORG_ID as Uuid, "user", push.subjectId, "push");
    // A preference that cannot be read is off: push is opt-in.
    if (!prefs.ok || !prefs.value.some((p) => p.kinds[push.templateKey] === true)) return null;
    const message = renderPushMessage(push.templateKey, push.templateData, push.tag);
    if (!message) return null;
    return await pushToDevices(deps, push.subjectId, message);
  } catch {
    return null;
  }
}
