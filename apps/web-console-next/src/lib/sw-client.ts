/**
 * The page's side of Cookpool's service worker (PW-4, cookpool-app design §3):
 * telling it who is signed in and when nobody is, and when to offer, apply or
 * silently adopt a new build. The worker itself is src/service-worker/*.mjs,
 * bundled into `/sw.js` by scripts/service-worker.mjs.
 *
 * The decisions are pure and tested (`updateOffered`, `reloadsOnReturn`);
 * the rest talks to `navigator.serviceWorker` and never throws: a browser
 * without service workers, or a registration that fails, leaves the app as
 * it was.
 */

import {
  CACHE_PREFIX,
  DATA_CACHE_PREFIX,
  MESSAGE,
  META_CACHE,
  isSubjectId,
  tokenHash,
} from "@/service-worker/protocol.mjs";

/** Where the worker is served; its scope is the whole app. */
export const SW_URL = "/sw.js";

/** An app brought back after this long, with a new build waiting, reloads itself. */
export const AWAY_RELOAD_MS = 24 * 60 * 60 * 1000;

/** Sign-in, where a reload would lose a code being typed (and the OAuth return). */
export function isSignInPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/auth/callback" || pathname.startsWith("/auth/callback/");
}

export interface UpdateGate {
  /** A new build is installed and waiting. */
  waiting: boolean;
  /** SM-5's writes on their way (`writesInFlight(queryClient)`). */
  writesInFlight: number;
  /** Undo toasts still on screen (`undoOffersOpen()`): a reload would take the Undo away. */
  undoOffersOpen: number;
  offline: boolean;
  pathname: string;
  /** The person closed the offer; it comes back when the app does. */
  snoozed: boolean;
}

/**
 * "New version · Reload" shows only when a build is waiting and nothing would
 * be lost by reloading: no write on its way, no Undo on screen, not offline
 * (the reload would open the old copy anyway), not on sign-in, and not after
 * the person closed it.
 */
export function updateOffered(g: UpdateGate): boolean {
  return g.waiting && g.writesInFlight === 0 && g.undoOffersOpen === 0 && !g.offline && !isSignInPath(g.pathname) && !g.snoozed;
}

/** An app brought back to the foreground after more than a day, with a build waiting, reloads itself (when nothing would be lost). */
export function reloadsOnReturn(g: { waiting: boolean; awayMs: number; writesInFlight: number; offline: boolean; pathname: string }): boolean {
  return g.waiting && g.awayMs > AWAY_RELOAD_MS && g.writesInFlight === 0 && !g.offline && !isSignInPath(g.pathname);
}

function container(): ServiceWorkerContainer | null {
  try {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;
  } catch {
    return null;
  }
}

/** True where a service worker can run. */
export function workersSupported(): boolean {
  return container() !== null;
}

/** Post to the worker controlling this page and to the registration's active one (it may not control the page yet). */
function tell(message: Record<string, unknown>): void {
  const sw = container();
  if (!sw) return;
  const now = sw.controller;
  try {
    now?.postMessage(message);
  } catch {
    /* best effort */
  }
  // On a first visit the page knows who is signed in before its worker is
  // installed (it registers after `load`): `ready` delivers the message once
  // there is an active worker (and never, harmlessly, where none registers).
  void sw.ready
    .then((r) => {
      if (r.active && r.active !== now) r.active.postMessage(message);
    })
    .catch(() => undefined);
}

/** After sign-in and on every load while signed in: whose data the worker may keep, and their session (as a hash). */
export async function tellWorkerAccount(subjectId: string, token: string): Promise<void> {
  if (!container() || !isSubjectId(subjectId)) return;
  try {
    tell({ type: MESSAGE.account, subjectId, tokenHash: await tokenHash(token) });
  } catch {
    /* no crypto.subtle (not a secure context): no worker either */
  }
}

/**
 * Nobody is signed in (sign-out, a 401 that ended the session, a page loaded
 * without a session): the worker deletes every account's data. The page
 * deletes it too, in case no worker hears it.
 */
export function tellWorkerSignedOut(): void {
  tell({ type: MESSAGE.signedOut });
  void deleteCaches((name) => name.startsWith(DATA_CACHE_PREFIX) || name === META_CACHE);
}

async function deleteCaches(which: (name: string) => boolean): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    for (const name of await caches.keys()) if (which(name)) await caches.delete(name);
  } catch {
    /* best effort */
  }
}

/** The kill switch, page side: unregister every Cookpool worker and delete its caches. */
export async function removeWorkers(): Promise<void> {
  const sw = container();
  if (!sw) return;
  try {
    for (const r of await sw.getRegistrations()) {
      const script = r.active?.scriptURL ?? r.waiting?.scriptURL ?? r.installing?.scriptURL ?? "";
      if (script.endsWith(SW_URL)) await r.unregister();
    }
  } catch {
    /* best effort */
  }
  await deleteCaches((name) => name.startsWith(CACHE_PREFIX));
}

/**
 * The build this page is (Next's build id), read from the page's own
 * flight data (`self.__next_f`, whose first row carries `"b":"<build id>"`).
 * Null when it cannot be read — then no worker is adopted, and the offer
 * shows instead, which is the safe way to be wrong.
 */
export function pageBuildId(win: unknown = typeof window === "undefined" ? undefined : window): string | null {
  const rows = (win as { __next_f?: unknown } | undefined)?.__next_f;
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    const text = Array.isArray(row) ? row[1] : undefined;
    if (typeof text !== "string") continue;
    const m = /"b":"([A-Za-z0-9_-]+)"/.exec(text);
    if (m) return m[1] ?? null;
  }
  return null;
}

/**
 * Ask a waiting worker whether it is this page's own build. If so it takes
 * over at once, with no reload and no offer: the page loaded the new build
 * from the network while the old worker was in charge (pages are network
 * first, so that is the usual way a deploy arrives). Resolves to whether it
 * did.
 */
export function adoptIfSameBuild(waiting: ServiceWorker, timeoutMs = 3000): Promise<boolean> {
  const buildId = pageBuildId();
  if (!buildId || typeof MessageChannel === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      resolve((event.data as { adopted?: unknown } | null)?.adopted === true);
    };
    try {
      waiting.postMessage({ type: MESSAGE.adopt, buildId }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/** Reload: the waiting worker takes over (`skipWaiting`), and `controllerchange` reloads the page once. */
export function activateWaiting(waiting: ServiceWorker): void {
  try {
    waiting.postMessage({ type: MESSAGE.activate });
  } catch {
    /* the fallback reload still comes */
  }
}
