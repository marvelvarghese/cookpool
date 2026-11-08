"use client";

/**
 * Where the cooking session lives (cookpool-recipes RC-6, design §4.1): one
 * draft per signed-in account, in localStorage under
 * `<storagePrefix>.session.<accountId>`, so it survives tab switches,
 * reloads and closing the app. Cleared on Finish, on Discard, and when the
 * person signs out of this device (`clearCookSessions`, from
 * `clearDeviceRecords`).
 *
 * A thin adapter over the pure draft (`components/kitchen/cook-session.ts`):
 * it reads, writes and forgets the plain object, tells subscribers (this tab,
 * and other tabs through `storage` events) and keeps one parsed snapshot per
 * stored text, as `useSyncExternalStore` needs.
 */

import * as React from "react";
import { appConfig } from "./app-config";
import { parseSession, type CookSession } from "@/components/kitchen/cook-session";

/** What the adapter needs of localStorage (a test's map will do). */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

/** The key a person's draft is kept under. */
export function sessionKey(prefix: string, accountId: string): string {
  return `${prefix}.session.${accountId}`;
}

export interface CookSessionStore {
  read(accountId: string): CookSession | null;
  write(accountId: string, session: CookSession): void;
  /** Change the draft in place (nothing when there is none, or `change` returns it unchanged). */
  update(accountId: string, change: (s: CookSession) => CookSession): void;
  clear(accountId: string): void;
  /** Every account's draft on this device (signing out). */
  clearAll(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * A store over `storage` (null while there is none: prerendering, or storage
 * refused) and the console's prefix (runtime config, read per call).
 */
export function createCookSessionStore(opts: {
  storage: () => SessionStorageLike | null;
  prefix: () => string;
  /** Other tabs' changes (the `storage` event); the browser's by default. */
  external?: (onChange: () => void) => () => void;
}): CookSessionStore {
  const listeners = new Set<() => void>();
  const cache = new Map<string, { raw: string | null; value: CookSession | null }>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  const storage = () => {
    try {
      return opts.storage();
    } catch {
      return null;
    }
  };
  const store: CookSessionStore = {
    read(accountId) {
      if (!accountId) return null;
      const key = sessionKey(opts.prefix(), accountId);
      let raw: string | null = null;
      try {
        raw = storage()?.getItem(key) ?? null;
      } catch {
        raw = null;
      }
      const hit = cache.get(key);
      if (hit && hit.raw === raw) return hit.value;
      const value = parseSession(raw);
      cache.set(key, { raw, value });
      return value;
    },
    write(accountId, session) {
      if (!accountId) return;
      try {
        storage()?.setItem(sessionKey(opts.prefix(), accountId), JSON.stringify(session));
      } catch {
        // Storage full or refused: the session lasts as long as this page does.
        return;
      }
      notify();
    },
    update(accountId, change) {
      const current = store.read(accountId);
      if (!current) return;
      const next = change(current);
      if (next !== current) store.write(accountId, next);
    },
    clear(accountId) {
      if (!accountId) return;
      try {
        storage()?.removeItem(sessionKey(opts.prefix(), accountId));
      } catch {
        return;
      }
      notify();
    },
    clearAll() {
      const s = storage();
      if (!s) return;
      const prefix = `${opts.prefix()}.session.`;
      try {
        const keys: string[] = [];
        const n = typeof s.length === "number" ? s.length : 0;
        for (let i = 0; i < n; i++) {
          const k = s.key?.(i);
          if (k && k.startsWith(prefix)) keys.push(k);
        }
        for (const k of keys) s.removeItem(k);
      } catch {
        return;
      }
      cache.clear();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      const off = opts.external?.(listener);
      return () => {
        listeners.delete(listener);
        off?.();
      };
    },
  };
  return store;
}

/** This page's store, over the browser's localStorage. */
export const cookSessions: CookSessionStore = createCookSessionStore({
  storage: () => (typeof window === "undefined" ? null : window.localStorage),
  prefix: () => appConfig().storagePrefix,
  external: (onChange) => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => undefined;
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  },
});

/** Forget every cooking session on this device (signing out, SI-6's device records). */
export function clearCookSessions(): void {
  cookSessions.clearAll();
}

/** The signed-in person's session, or null; re-renders when it changes (here or in another tab). */
export function useCookSession(accountId: string | null): CookSession | null {
  const get = React.useCallback(() => (accountId ? cookSessions.read(accountId) : null), [accountId]);
  return React.useSyncExternalStore(cookSessions.subscribe, get, () => null);
}
