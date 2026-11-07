"use client";

/**
 * Sign out of this device (Cookpool SI-6, design §7): "Sign out of this
 * phone" on You. Sessions are per device, so this ends only this one.
 *
 * In order:
 * 1. From here on, a 401 is not "you were signed out" and a missing token is
 *    not a reason to redirect (`signingOut()`, read by `useRequireAuth`): the
 *    session is being ended on purpose, and the page is about to leave.
 * 2. This device's push subscription goes (cookpool-app PW-6), while the
 *    session still works: the server forgets it and the browser
 *    unsubscribes, so a shared phone stops getting the previous person's
 *    notifications. Best effort, and never more than `FORGET_PUSH_MS`.
 * 3. `POST /v1/auth/logout`, best effort: a failure (offline, already
 *    expired) still signs this device out, since the token is forgotten.
 * 4. The token, the React Query cache, and everything this device remembers
 *    for the person: SI-5's join record and `next` stash, the OAuth provider
 *    stash, the Name step marker, how they signed in, their recent groups,
 *    the admin console's last org and the icon badge's switch (and count).
 *    The API target is the device's, not the person's, and stays.
 * 5. A full navigation to `/login` (replacing You in history), so nothing
 *    in memory — and no Cookpool theme on <body> — outlives the session.
 */

import { clearJoinAfterSignIn, takeLoginNext, takeOAuthProvider } from "./login-return";
import { clearNameAsked, rememberSignInMethod } from "./first-run";
import { clearRecentGroups } from "./recent-groups";
import { clearLastOrgSlug } from "./last-org";
import { clearBadgeRecord } from "./push-device";
import { FORGET_PUSH_MS } from "./push";

/** Where signing out lands. */
export const SIGNED_OUT_PATH = "/login";

let ending = false;

/** True once this page has started signing out; the page is leaving. */
export function signingOut(): boolean {
  return ending;
}

/** Forget everything this device remembers for the signed-in person (not the token: `setToken(null)` does that). */
export function clearDeviceRecords(): void {
  clearJoinAfterSignIn();
  takeLoginNext();
  takeOAuthProvider();
  clearNameAsked();
  rememberSignInMethod(null);
  clearRecentGroups();
  clearLastOrgSlug();
  clearBadgeRecord();
}

export interface SignOutDeps {
  /** Remove this device's push subscription (`forgetThisDevicePush`), with the current token. */
  forgetPush?: () => Promise<unknown>;
  /** How long to wait for it (default `FORGET_PUSH_MS`). */
  forgetPushMs?: number;
  /** `client.auth.logout()` with the current token. */
  logout: () => Promise<unknown>;
  /** The session's `setToken`, which removes the stored token too. */
  setToken: (token: null) => void;
  /** `queryClient.clear()`. */
  clearCache: () => void;
  /** `location.replace`. */
  go: (path: string) => void;
}

/** `job`, but no longer than `ms`; never rejects. */
function atMost(job: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    job.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

export async function signOutOfThisDevice(deps: SignOutDeps): Promise<void> {
  ending = true;
  if (deps.forgetPush) {
    let job: Promise<unknown>;
    try {
      job = deps.forgetPush();
    } catch {
      job = Promise.resolve();
    }
    await atMost(job, deps.forgetPushMs ?? FORGET_PUSH_MS);
  }
  try {
    await deps.logout();
  } catch {
    /* best effort: this device forgets the token either way */
  }
  deps.setToken(null);
  deps.clearCache();
  clearDeviceRecords();
  deps.go(SIGNED_OUT_PATH);
}
