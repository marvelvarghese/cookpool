/**
 * Notifications, in the app (cookpool-app PW-6, design §4, the `AppNotify`
 * artboard): the pure rules behind You → Notifications, the sign-out
 * clean-up and the icon badge. No DOM, no React, no SDK: the browser's side
 * is `push-device.ts`, the screen `components/kitchen/notify-ui.tsx`, and
 * the service worker's handlers `src/service-worker/push.mjs`.
 *
 * - **Where push can work** (`notifyDevice`, then `pushView` once the
 *   server's key is known): an iPhone or iPad in the browser must install
 *   first; a browser without Web Push can't; an environment with no VAPID
 *   key (`publicKey: null`) has none yet. The badge switch is separate and
 *   local (`badgeRowShown`).
 * - **The ask comes after a choice** (`turnKindOn`): permission, then this
 *   device's subscription, then the server's copy of it, then the kind.
 *   Turning a kind off (`turnKindOff`) never touches the device, so turning
 *   the last one off keeps the subscription.
 * - **A switch is on** when the person has that kind on and THIS device is
 *   subscribed with permission (`shownOn`): a kind turned on from another
 *   phone does not reach this one until it subscribes too.
 */

import type {
  NotificationKind,
  NotificationKindPreferences,
  NotificationPreference,
  PushSubscriptionRequest,
  PushTestResponse,
} from "@saas/contracts/notifications";

// ── The words ────────────────────────────────────────────────────────

export const NOTIFY_TITLE = "Notifications";
export const INSTALL_FIRST_LINE = "Add Cookpool to your Home Screen to get notifications";
export const NO_PUSH_LINE = "This browser can't show notifications from Cookpool.";
export const NOT_YET_LINE = "Notifications aren't available yet.";
export const BLOCKED_LINE = "Notifications are blocked in your browser settings";
export const EMAIL_LINE = "Emails keep coming either way.";
export const SEND_TEST = "Send me a test";
export const TEST_SENT = "Sent · it arrives in a moment";
export const TEST_FAILED = "Couldn't send a test";
export const TURN_ON_FAILED = "Couldn't turn that on";
export const TURN_OFF_FAILED = "Couldn't turn that off";

/** The three kinds, in the canvas's order, each with its one-line example. */
export const PUSH_ROWS: readonly { kind: NotificationKind; title: string; example: string }[] = Object.freeze([
  { kind: "kitchen.portion_set", title: "Someone set my portion", example: "Anu said you had 1 portion" },
  { kind: "kitchen.dish_posted", title: "A dish to claim", example: "Egg fried rice is ready" },
  { kind: "kitchen.paid_you", title: "Someone paid me", example: "Dev paid you ₹400" },
]);

/** The fourth switch: Home's to-do count on the app icon (local to this device; no server). */
export const BADGE_ROW = Object.freeze({ title: "To-dos on the app icon", example: "3" });

// ── Where push can work ──────────────────────────────────────────────

export interface NotifyEnv {
  /** An iPhone, iPod or iPad (`isIos`, an iPad asking for desktop sites included). */
  ios: boolean;
  /** An app's own web view (Instagram, Facebook): no Add to Home Screen there. */
  inAppBrowser: boolean;
  /** Running as the installed app (a `display-mode` of one, or iOS's `navigator.standalone`). */
  standalone: boolean;
  /** `PushManager`, `Notification` and service workers all exist. */
  pushApi: boolean;
  /** This build registers Cookpool's service worker (a production build, with the kill switch on). */
  worker: boolean;
  /** `navigator.setAppBadge` exists. */
  badgeApi: boolean;
  /** Safari or another WebKit browser, where the icon badge shows only with notification permission. */
  webkit: boolean;
}

export type NotifyDevice =
  /** iPhone or iPad in the browser: Web Push works only for the installed app (iOS 16.4+). */
  | "install-first"
  /** No Web Push here (an older browser, an in-app web view, an installed app on iOS before 16.4). */
  | "no-push"
  /** No service worker in this build (`next dev`, or the kill switch is off): push can't be delivered. */
  | "no-worker"
  /** Push can work on this device. */
  | "push";

export function notifyDevice(env: NotifyEnv): NotifyDevice {
  if (env.ios && !env.standalone) return env.inAppBrowser ? "no-push" : "install-first";
  if (!env.pushApi) return "no-push";
  if (!env.worker) return "no-worker";
  return "push";
}

/**
 * What the three push switches' place shows: the device's line, or — where
 * push can work — the server's key decides (`undefined` while it is read,
 * `null` when the environment has no VAPID key yet), else the switches.
 */
export type PushView = "install-first" | "no-push" | "not-yet" | "loading" | "error" | "switches";

export function pushView(device: NotifyDevice, key: { publicKey?: string | null | undefined; failed?: boolean | undefined }): PushView {
  if (device === "install-first") return "install-first";
  if (device === "no-push") return "no-push";
  if (device === "no-worker") return "not-yet";
  if (key.failed) return "error";
  if (key.publicKey === undefined) return "loading";
  if (!key.publicKey) return "not-yet";
  return "switches";
}

/** The badge switch shows wherever the browser can badge the icon, except where the app must be installed first. */
export function badgeRowShown(env: NotifyEnv): boolean {
  return env.badgeApi && notifyDevice(env) !== "install-first";
}

/** WebKit shows an icon badge only with notification permission, so turning the badge on asks there. */
export function badgeAsksPermission(env: NotifyEnv): boolean {
  return env.webkit;
}

// ── Which switches are on ────────────────────────────────────────────

export type KindsOn = Record<NotificationKind, boolean>;

/** The person's push kinds (GET …/preferences?channel=push): only an explicit `true` is on (push is opt-in). */
export function kindsOn(preferences: readonly Pick<NotificationPreference, "channel" | "kinds">[] | null | undefined): KindsOn {
  const row = preferences?.find((p) => p.channel === "push");
  const out = {} as KindsOn;
  for (const { kind } of PUSH_ROWS) out[kind] = row?.kinds?.[kind] === true;
  return out;
}

/** The read with the server's answer to a PUT as its push row (replaced, or added when there was none). */
export function withPushRow<T extends { preferences: NotificationPreference[] }>(read: T | undefined, row: NotificationPreference): T {
  const preferences = (read?.preferences ?? []).filter((p) => p.channel !== "push");
  return { ...(read as T), preferences: [...preferences, row] };
}

export interface DeviceState {
  /** `Notification.permission`. */
  permission: NotificationPermission;
  /** This device's push subscription's endpoint, or null when it has none. */
  endpoint: string | null;
}

/**
 * The switch for `kind` is on when the person has it on and this device is
 * subscribed with permission — or while turning it on or off is on its way
 * (`flipping`), which shows the new state at once.
 */
export function shownOn(kind: NotificationKind, kinds: KindsOn, device: DeviceState, flipping?: boolean): boolean {
  if (flipping !== undefined) return flipping;
  return kinds[kind] && device.endpoint !== null && device.permission === "granted";
}

// ── Turning a kind on or off ─────────────────────────────────────────

/** The browser, as turning a kind on needs it (`push-device.ts` over the real one). */
export interface DevicePort {
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  /** This device's subscription for `publicKey` (the one it has, or a new one), as `toJSON()` gives it. */
  subscribe(publicKey: string): Promise<PushSubscriptionRequest>;
}

/** The server, as the switches need it (`client.notifications`). */
export interface PushServerPort {
  subscribePush(subscription: PushSubscriptionRequest): Promise<unknown>;
  setPushKinds(kinds: NotificationKindPreferences): Promise<{ preference: NotificationPreference }>;
}

export type TurnOnOutcome =
  | { ok: true; endpoint: string; preference: NotificationPreference }
  /** "blocked": the browser said no (now or before) · "dismissed": the prompt was closed · "failed": anything else. */
  | { ok: false; reason: "blocked" | "dismissed" | "failed" };

/**
 * Turn `kind` on: ask for permission if it was not given (the first await,
 * so the tap still counts as the gesture Safari wants), then subscribe this
 * device with the server's key, keep the subscription on the server, and
 * turn the kind on. Asked only from here — never on load.
 */
export async function turnKindOn(kind: NotificationKind, publicKey: string, device: DevicePort, server: PushServerPort): Promise<TurnOnOutcome> {
  if (device.permission() !== "granted") {
    let answer: NotificationPermission;
    try {
      answer = await device.requestPermission();
    } catch {
      return { ok: false, reason: "failed" };
    }
    if (answer === "denied") return { ok: false, reason: "blocked" };
    if (answer !== "granted") return { ok: false, reason: "dismissed" };
  }
  try {
    const subscription = await device.subscribe(publicKey);
    await server.subscribePush(subscription);
    const { preference } = await server.setPushKinds({ [kind]: true });
    return { ok: true, endpoint: subscription.endpoint, preference };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Turn `kind` off on the server. The device keeps its subscription, even when this was the last kind on. */
export async function turnKindOff(kind: NotificationKind, server: Pick<PushServerPort, "setPushKinds">): Promise<NotificationPreference | null> {
  try {
    return (await server.setPushKinds({ [kind]: false })).preference;
  } catch {
    return null;
  }
}

/** What "Send me a test" says, from the server's answer (null: it failed). */
export function testOutcome(answer: PushTestResponse | null): { ok: boolean; title: string } {
  return answer && answer.sent > 0 ? { ok: true, title: TEST_SENT } : { ok: false, title: TEST_FAILED };
}

// ── Signing out removes this device ──────────────────────────────────

/** How long sign-out waits for this device to be removed before it goes on anyway. */
export const FORGET_PUSH_MS = 2500;

export interface ForgetPorts {
  /** This device's subscription, or null. */
  subscription(): Promise<{ endpoint: string; unsubscribe(): Promise<boolean> } | null>;
  /** `client.notifications.unsubscribePush(endpoint)` with the session still valid; absent when it is not (a 401). */
  tellServer?: ((endpoint: string) => Promise<unknown>) | undefined;
  /** Offline: the server cannot be told (and a write would only be held back). */
  offline?: boolean | undefined;
}

/**
 * Remove this device's push subscription: tell the server (while the session
 * still works) and unsubscribe in the browser, together. Never throws.
 * Resolves to the endpoint removed, or null when there was none.
 */
export async function forgetPush(ports: ForgetPorts): Promise<string | null> {
  let sub: Awaited<ReturnType<ForgetPorts["subscription"]>> = null;
  try {
    sub = await ports.subscription();
  } catch {
    return null;
  }
  if (!sub) return null;
  const { endpoint } = sub;
  const server = ports.tellServer && !ports.offline ? ports.tellServer(endpoint) : null;
  await Promise.allSettled([server, sub.unsubscribe()]);
  return endpoint;
}

// ── The icon badge ───────────────────────────────────────────────────

export type BadgeAction = { kind: "set"; count: number } | { kind: "clear" } | null;

/**
 * The icon badge: Home's to-do count while the switch is on (cleared at zero),
 * cleared when it is off; nothing where the browser cannot badge, or while
 * the count is not known yet.
 */
export function badgeAction(s: { on: boolean; supported: boolean; count: number | null }): BadgeAction {
  if (!s.supported) return null;
  if (!s.on) return { kind: "clear" };
  if (s.count === null) return null;
  return s.count > 0 ? { kind: "set", count: s.count } : { kind: "clear" };
}

// ── The server's key ─────────────────────────────────────────────────

/** base64url → bytes (the VAPID key as `applicationServerKey` takes it); null for anything that is not base64url. */
export function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) return null;
  const b64 = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (b64.length % 4 === 1) return null;
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A subscription made with `key` (its `options.applicationServerKey`) is for this server key. */
export function sameServerKey(key: ArrayBuffer | null | undefined, publicKey: string): boolean {
  const want = base64UrlBytes(publicKey);
  if (!key || !want) return false;
  const have = new Uint8Array(key);
  return have.length === want.length && have.every((b, i) => b === want[i]);
}
