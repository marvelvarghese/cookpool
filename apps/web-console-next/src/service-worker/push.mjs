// NOTIFICATIONS (Cookpool PW-6, cookpool-app design §4): the service worker's
// `push`, `notificationclick` and `pushsubscriptionchange` handlers, as a
// factory over what they need from the platform (the registration, the
// window clients), so they are tested with fakes. scripts/service-worker.mjs
// bundles this into `/sw.js` beside runtime.mjs and wires it to the events;
// the kill switch's worker has none of it (it unregisters, which ends every
// push subscription with it).
//
// - PUSH shows what notifications-worker sent: JSON `{ kind, title, body,
//   url, tag }` (contract `PushMessage`). A missing or unreadable payload
//   still shows a notification ("Cookpool"): a subscription made with
//   `userVisibleOnly` must show one for every push.
// - A TAP focuses an open Cookpool window and opens the push's page in it,
//   or opens a new window there. Only paths in the app are opened.
// - A RENEWED SUBSCRIPTION (`pushsubscriptionchange`) is re-made with the
//   same key, and open pages are told, so one of them re-posts it with the
//   session (the worker never holds a token). Every signed-in launch
//   re-posts it too. Best effort.

import { MESSAGE } from "./protocol.mjs";

/** The notification's icon, and the small monochrome one Android shows in the status bar. */
export const NOTIFICATION_ICON = "/icons/icon-192.png";
export const NOTIFICATION_BADGE = "/icons/badge-96.png";

/** Where a push with no page of its own opens. */
export const DEFAULT_PATH = "/home";

/** What a push whose payload cannot be read shows. */
export const GENERIC_TITLE = "Cookpool";
export const GENERIC_BODY = "Something new for you";

/** A path in the app (`/dishes/dsh_…`), else null: never another origin, never a scheme. */
export function appPath(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

function words(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * What one push shows, from its payload's text: `{ title, options }` for
 * `showNotification`. The same tag replaces the one shown, quietly
 * (`renotify: false`).
 */
export function pushNotice(payload) {
  let message = null;
  try {
    message = typeof payload === "string" && payload ? JSON.parse(payload) : null;
  } catch {
    message = null;
  }
  const title = message && typeof message === "object" ? words(message.title, 120) : null;
  const body = title ? words(message.body, 400) : null;
  const options = {
    body: body ?? GENERIC_BODY,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    renotify: false,
    data: { url: (body && appPath(message.url)) || DEFAULT_PATH },
  };
  const tag = body ? words(message.tag, 200) : null;
  if (tag) options.tag = tag;
  return { title: body ? title : GENERIC_TITLE, options };
}

/** `env`: `origin`, and the platform's `registration` and `clients`. */
export function createPushHandlers(env) {
  const { origin, registration, clients } = env;

  /** Show the push (`payload`: its data as text, or null). */
  async function push(payload) {
    const { title, options } = pushNotice(payload);
    try {
      await registration.showNotification(title, options);
    } catch {
      // Whatever went wrong, one notification still shows.
      await registration.showNotification(GENERIC_TITLE, { body: GENERIC_BODY, icon: NOTIFICATION_ICON, data: { url: DEFAULT_PATH } });
    }
  }

  /** A tap: focus a Cookpool window and open the push's page there, or open one. */
  async function click(notification) {
    try {
      notification?.close?.();
    } catch {
      /* already gone */
    }
    const path = appPath(notification?.data?.url) ?? DEFAULT_PATH;
    const url = new URL(path, origin).href;
    // The windows this worker controls (it claims every page when it starts).
    const open = (await clients.matchAll({ type: "window" })).filter((c) => {
      try {
        return new URL(c.url).origin === origin;
      } catch {
        return false;
      }
    });
    const target = open.find((c) => c.focused) ?? open.find((c) => c.visibilityState === "visible") ?? open[0];
    if (target) {
      try {
        const focused = (await target.focus()) ?? target;
        if (focused.url === url) return;
        await focused.navigate(url);
        return;
      } catch {
        /* it could not be moved: open the page instead */
      }
    }
    await clients.openWindow(url);
  }

  /** The push service renewed (or dropped) this device's subscription. */
  async function subscriptionChange(event) {
    let renewed = event?.newSubscription ?? null;
    const key = event?.oldSubscription?.options?.applicationServerKey;
    if (!renewed && key) {
      try {
        renewed = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch {
        renewed = null;
      }
    }
    if (!renewed) return;
    for (const c of await clients.matchAll({ type: "window" })) {
      try {
        c.postMessage({ type: MESSAGE.pushRenewed });
      } catch {
        /* best effort */
      }
    }
  }

  return { push, click, subscriptionChange };
}
