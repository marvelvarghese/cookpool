/**
 * Notifications on THIS device (cookpool-app PW-6): the browser's side of
 * `push.ts` — what the device can do, its push subscription, removing it
 * when nobody is signed in, and the icon badge with its switch.
 *
 * Everything here tolerates a browser without the API and never throws: a
 * notification that cannot be set up leaves the app as it was.
 */

import type { PushSubscriptionRequest } from "@saas/contracts/notifications";
import { appConfig } from "./app-config";
import { INSTALLED_DISPLAY_MODES, isInAppBrowser, isIos } from "./install";
import { base64UrlBytes, forgetPush, sameServerKey, type BadgeAction, type DevicePort, type DeviceState, type NotifyEnv } from "./push";

/** How long subscribing waits for the service worker to be ready (it registers after `load`). */
const READY_MS = 10_000;

/** How long the browser's push service may take to subscribe this device before the switch goes back. */
const SUBSCRIBE_MS = 20_000;

/** `job`, or a rejection after `ms`. */
function within<T>(job: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    job.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(what));
      },
    );
  });
}

/** Safari (on a Mac) or any browser on iOS: WebKit. */
export function isWebKit(userAgent: string, maxTouchPoints: number): boolean {
  if (isIos(userAgent, maxTouchPoints)) return true;
  return /\bVersion\/\d+.*\bSafari\//.test(userAgent) && !/\b(Chrome|Chromium|Edg|OPR|Firefox)\//.test(userAgent);
}

/**
 * What this browser can do (call it in an effect: the pages are prerendered).
 * `worker`: this build registers Cookpool's service worker (`WORKER_ON`).
 */
export function readNotifyEnv(worker: boolean): NotifyEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    INSTALLED_DISPLAY_MODES.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true) || nav.standalone === true;
  const ua = nav.userAgent;
  const touch = nav.maxTouchPoints ?? 0;
  return {
    ios: isIos(ua, touch),
    inAppBrowser: isInAppBrowser(ua),
    standalone,
    pushApi: "serviceWorker" in nav && "PushManager" in window && "Notification" in window,
    worker,
    badgeApi: "setAppBadge" in nav,
    webkit: isWebKit(ua, touch),
  };
}

/** `Notification.permission`, or "default" where there is no Notification API. */
export function notificationPermission(): NotificationPermission {
  try {
    return typeof Notification === "undefined" ? "default" : Notification.permission;
  } catch {
    return "default";
  }
}

/** Cookpool's worker registration, if there is one yet (never waits). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    return (await navigator.serviceWorker.getRegistration("/")) ?? null;
  } catch {
    return null;
  }
}

/** The registration once its worker is active (it registers after `load`); throws after READY_MS. */
function readyRegistration(): Promise<ServiceWorkerRegistration> {
  return within(navigator.serviceWorker.ready, READY_MS, "service worker");
}

/** This device's push subscription, or null. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const r = await registration();
  try {
    return (await r?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Permission and subscription, as the switches need them. */
export async function readDeviceState(): Promise<DeviceState> {
  const sub = await currentSubscription();
  return { permission: notificationPermission(), endpoint: sub?.endpoint ?? null };
}

/** `toJSON()` as the server takes it; throws when the browser left the keys out. */
export function subscriptionBody(sub: PushSubscription): PushSubscriptionRequest {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error("subscription without keys");
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/** This device, as `turnKindOn` drives it. */
export const browserDevice: DevicePort = {
  permission: notificationPermission,
  requestPermission: () => Notification.requestPermission(),
  async subscribe(publicKey) {
    const key = base64UrlBytes(publicKey);
    if (!key) throw new Error("not a key");
    const r = await readyRegistration();
    let sub = await r.pushManager.getSubscription();
    // Made with another key (the environment's key changed): replace it.
    if (sub && !sameServerKey(sub.options.applicationServerKey, publicKey)) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    // A push service that never answers (blocked on this network) must not hold the switch forever.
    sub ??= await within(r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), SUBSCRIBE_MS, "subscribe");
    return subscriptionBody(sub);
  },
};

/**
 * Sign-out: remove this device — the server is told (`tellServer`, while the
 * session still works; not when offline) and the browser unsubscribes.
 * Never throws.
 */
export function forgetThisDevicePush(tellServer?: (endpoint: string) => Promise<unknown>, offline = false): Promise<string | null> {
  return forgetPush({ subscription: currentSubscription, tellServer, offline });
}

/**
 * Nobody is signed in (a 401 that ended the session, a page loaded with no
 * session, sign-out's last step): the browser drops this device's
 * subscription — the server can no longer be told, and its next push there
 * is answered "gone", which deletes it — and the icon's count goes.
 */
export function dropThisDevicePush(): void {
  void forgetPush({ subscription: currentSubscription });
  applyBadge({ kind: "clear" });
}

// ── The icon badge ───────────────────────────────────────────────────

/** The window event when the badge switch changes on this page. */
export const BADGE_CHANGE = "cookpool:badge-change";

const badgeKey = (): string => `${appConfig().storagePrefix}.badge`;

/** The badge switch: per device, off until turned on. */
export function badgeOn(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(badgeKey()) === "on";
  } catch {
    return false;
  }
}

export function setBadgeOn(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(badgeKey(), "on");
    else window.localStorage.removeItem(badgeKey());
  } catch {
    /* without storage the switch is off */
  }
  try {
    window.dispatchEvent(new Event(BADGE_CHANGE));
  } catch {
    /* no window events (tests) */
  }
}

/** Sign-out: the next person starts with the switch off, and with no count on the icon. */
export function clearBadgeRecord(): void {
  setBadgeOn(false);
  applyBadge({ kind: "clear" });
}

/** The browser can badge the app's icon. */
export function badgeSupported(): boolean {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

/** Do what `badgeAction` decided, if the browser can. */
export function applyBadge(action: BadgeAction): void {
  if (!action || !badgeSupported()) return;
  try {
    const nav = navigator as Navigator & { setAppBadge(n?: number): Promise<void>; clearAppBadge(): Promise<void> };
    const done = action.kind === "set" ? nav.setAppBadge(action.count) : nav.clearAppBadge();
    void done?.catch?.(() => undefined);
  } catch {
    /* best effort */
  }
}
