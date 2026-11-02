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

/*
 * Which provider the round trip went to (Cookpool SI-6), stashed beside
 * `next` the same way, so the callback can record how this device signed in
 * (You's "How you sign in"). The callback's URL does not name the provider.
 */

const providerKey = (): string => `${appConfig().storagePrefix}.login-provider`;

export function rememberOAuthProvider(providerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(providerKey(), providerId);
  } catch {
    /* ignore: You then cannot say this device used Google */
  }
}

/** Read and clear the stashed provider id (one use). */
export function takeOAuthProvider(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(providerKey());
    window.sessionStorage.removeItem(providerKey());
    return value;
  } catch {
    return null;
  }
}

/*
 * Join after sign-in (Cookpool SI-5). A join link sends a signed-out person
 * to sign-in, which shows the group's card; once they sign in, the join page
 * joins at once and opens the group instead of asking for one more tap.
 *
 * That shortcut is only for someone who saw the card, so it is not a URL
 * flag (any link could carry one and join a signed-in person to a group
 * without asking). The sign-in page records the code in this tab's
 * sessionStorage when it sends the person on; the join page reads it once,
 * for that code only, within the time below.
 */

const joinKey = (): string => `${appConfig().storagePrefix}.join-after-sign-in`;

/** Long enough for an emailed code or a Google round trip; short enough not to linger. */
export const JOIN_AFTER_SIGN_IN_TTL_MS = 30 * 60_000;

export function rememberJoinAfterSignIn(code: string, now: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(joinKey(), JSON.stringify({ code, at: now }));
  } catch {
    /* ignore: the join page then asks for its usual tap */
  }
}

/** Whether the sign-in page asked for `code` to be joined. A read only: clear it with `clearJoinAfterSignIn`. */
export function joinAfterSignInPending(code: string, now: number = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(joinKey());
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    return (
      parsed.code === code &&
      typeof parsed.at === "number" &&
      now - parsed.at >= 0 &&
      now - parsed.at <= JOIN_AFTER_SIGN_IN_TTL_MS
    );
  } catch {
    return false;
  }
}

export function clearJoinAfterSignIn(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(joinKey());
  } catch {
    /* ignore */
  }
}
