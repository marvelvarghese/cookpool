"use client";

/**
 * Carry the sign-in page's `next` across an OAuth round trip (Cookpool CP-5).
 *
 * The email-code flow finishes on the login page, which still has `?next=`.
 * The OAuth flow leaves the app and comes back on `/auth/callback`, so the
 * login page stashes `next` in sessionStorage (this tab only) before leaving
 * and the callback takes it back. Whatever comes back is re-checked by
 * `postLoginDestination`, so a tampered value can only fall back to Home.
 */

import { appConfig } from "./app-config";

// Built per call: the storage prefix is runtime config (saas-console-artifact CA1).
const nextKey = (): string => `${appConfig().storagePrefix}.login-next`;

export function rememberLoginNext(next: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (next) window.sessionStorage.setItem(nextKey(), next);
    else window.sessionStorage.removeItem(nextKey());
  } catch {
    /* ignore: storage unavailable means Home after sign-in */
  }
}

/** Read and clear the stashed `next` (one use). */
export function takeLoginNext(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(nextKey());
    window.sessionStorage.removeItem(nextKey());
    return value;
  } catch {
    return null;
  }
}
