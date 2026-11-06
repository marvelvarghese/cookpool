/**
 * No signal (Cookpool PW-4, cookpool-app design §3): whether the app can
 * reach Cookpool right now, as the page sees it.
 *
 * Offline is either the browser saying so (`navigator.onLine`, its `online`
 * and `offline` events) or the last API call failing for network reasons —
 * which includes an answer the service worker gave from its data cache
 * because the network failed (it carries `x-cookpool-cached-at`). The first
 * answer that comes from the network ends it.
 *
 * While offline:
 * - the thin banner says "Offline · showing what you saw last" (with the
 *   time of the data, when it came from the cache);
 * - every write is held back at once — `beginWrite`, the Undo toast and the
 *   API client itself refuse it, no patch, no Undo, nothing queued — and one
 *   toast says "You're offline · nothing was logged".
 *
 * Dependency-free (no React) so it is unit-testable; `connection` is the
 * page's one instance.
 */

import { CACHED_AT_HEADER } from "@/service-worker/protocol.mjs";
import { dayAndTimeText, localDayOffset, timeText } from "@/components/kitchen/when";

/** What a held-back write says, in one line. */
export const OFFLINE_WRITE_TEXT = "You're offline · nothing was logged";

/** What the banner says. */
export const OFFLINE_BANNER_TEXT = "Offline · showing what you saw last";

export { CACHED_AT_HEADER };

export interface ConnectionState {
  /** The browser says there is no network. */
  browserOffline: boolean;
  /** The last API call failed for network reasons, or was answered from the worker's cache. */
  unreachable: boolean;
  /** The oldest data shown from the worker's cache since going offline (ISO), else null. */
  cachedAt: string | null;
}

export interface Connection {
  get(): ConnectionState;
  offline(): boolean;
  subscribe(listener: () => void): () => void;
  /** The browser's `online` / `offline`. */
  browser(online: boolean): void;
  /** An API answer: from the network (`cachedAt` null), or the worker's cached copy. */
  answered(cachedAt: string | null): void;
  /** An API call that never got an answer. Aborts and held-back writes do not count. */
  failed(error: unknown): void;
  /** A write was held back: tell whoever shows the toast. */
  holdBack(): void;
  onHeldBack(listener: () => void): () => void;
}

/** A write refused because the app is offline (the API client throws it; `wrap` turns it into a refusal). */
export class OfflineError extends Error {
  constructor() {
    super(OFFLINE_WRITE_TEXT);
    this.name = "OfflineError";
  }
}

function older(a: string | null, b: string): string {
  if (!a) return b;
  return Date.parse(b) < Date.parse(a) ? b : a;
}

export function createConnection(online = true): Connection {
  let state: ConnectionState = { browserOffline: !online, unreachable: false, cachedAt: null };
  const listeners = new Set<() => void>();
  const heldBack = new Set<() => void>();
  const set = (next: ConnectionState) => {
    if (next.browserOffline === state.browserOffline && next.unreachable === state.unreachable && next.cachedAt === state.cachedAt) return;
    state = next;
    for (const l of [...listeners]) l();
  };
  return {
    get: () => state,
    offline: () => state.browserOffline || state.unreachable,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    browser(isOnline) {
      set({ ...state, browserOffline: !isOnline });
    },
    answered(cachedAt) {
      if (cachedAt && !Number.isNaN(Date.parse(cachedAt))) set({ ...state, unreachable: true, cachedAt: older(state.cachedAt, cachedAt) });
      else set({ ...state, unreachable: false, cachedAt: null });
    },
    failed(error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError" || error instanceof OfflineError) return;
      set({ ...state, unreachable: true });
    },
    holdBack() {
      for (const l of [...heldBack]) l();
    },
    onHeldBack(listener) {
      heldBack.add(listener);
      return () => {
        heldBack.delete(listener);
      };
    },
  };
}

/** The page's connection. */
export const connection: Connection = createConnection(typeof navigator === "undefined" ? true : navigator.onLine !== false);

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("online", () => connection.browser(true));
  window.addEventListener("offline", () => connection.browser(false));
}

/** True while the app is offline. */
export function isOffline(c: Connection = connection): boolean {
  return c.offline();
}

/**
 * Hold a write back when offline: true (and the toast is on its way) when it
 * must not be made. Every write path asks this, or goes through one that does.
 */
export function refuseIfOffline(c: Connection = connection): boolean {
  if (!c.offline()) return false;
  c.holdBack();
  return true;
}

/** Writes that are never held back: signing out ends this device's session whatever the network says. */
export function alwaysSent(url: string): boolean {
  return /\/v1\/auth\/logout(?:[?#]|$)/.test(url);
}

/** "7:42 pm" today, else "yesterday, 7:42 pm", "28 Oct, 7:42 pm": when the data on screen is from. */
export function asOfText(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return localDayOffset(at, now) === 0 ? timeText(iso) : dayAndTimeText(iso, now);
}

/** The banner's words. */
export function bannerText(state: ConnectionState, now: Date): string {
  const asOf = state.cachedAt ? asOfText(state.cachedAt, now) : "";
  return asOf ? `${OFFLINE_BANNER_TEXT} · as of ${asOf}` : OFFLINE_BANNER_TEXT;
}

/**
 * A toast that only repeats the held-back refusal (its title or second line
 * is OFFLINE_WRITE_TEXT, as every screen's refusal is once `wrap` says it):
 * the toast shows it as the one line, once.
 */
export function isOfflineRefusal(t: { title?: string | undefined; description?: string | undefined }): boolean {
  return t.title === OFFLINE_WRITE_TEXT || t.description === OFFLINE_WRITE_TEXT;
}

/**
 * The API client's fetch (`lib/api.ts`): refuses a write at once while
 * offline (throwing OfflineError, before anything is sent), and tells
 * `c` how every call came out.
 */
export function watchedFetch(c: Connection = connection, onAnswer?: (response: Response, init: RequestInit | undefined) => void): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (method !== "GET" && method !== "HEAD" && !alwaysSent(url) && c.offline()) {
      c.holdBack();
      throw new OfflineError();
    }
    let response: Response;
    try {
      // The platform fetch, looked up per call (not bound at construction).
      response = await globalThis.fetch(input, init);
    } catch (error) {
      c.failed(error);
      throw error;
    }
    c.answered(response.headers.get(CACHED_AT_HEADER));
    onAnswer?.(response, init);
    return response;
  };
}
