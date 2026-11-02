"use client";

/**
 * What this device remembers about a person's first run and sign-in
 * (Cookpool SI-6). Both live in localStorage under the console's prefix and
 * both are forgotten when the person signs out of this device.
 *
 * - **Asked for a name.** The Name step is shown once per person per device
 *   outside a sign-in: the kitchen's ask for someone who signed in before the
 *   step existed. The marker holds the id of the person last asked, and is set
 *   *before* the redirect, so a failed profile read on the Name step, or a
 *   skip, can never bring them back to it.
 * - **How this device signed in.** identity-worker does not say which ways a
 *   person can sign in (its profile has no linked identities), so You shows
 *   Google only when this device's last sign-in was Google, and marks the way
 *   used last. Every sign-in overwrites it; the developer form clears it.
 */

import { appConfig } from "./app-config";

// Built per call: the storage prefix is runtime config (saas-console-artifact CA1).
const askedKey = (): string => `${appConfig().storagePrefix}.name-asked`;
const methodKey = (): string => `${appConfig().storagePrefix}.sign-in-method`;

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore: without storage the kitchen asks at most once per page load */
  }
}

/** The person (`usr_…`) this device last showed the Name step to, or null. */
export function nameAskedFor(): string | null {
  return read(askedKey());
}

export function markNameAsked(userId: string): void {
  if (userId) write(askedKey(), userId);
}

export function clearNameAsked(): void {
  write(askedKey(), null);
}

export type SignInMethod = "google" | "code";

/** How this device last signed in; null when it does not know. */
export function lastSignInMethod(): SignInMethod | null {
  const value = read(methodKey());
  return value === "google" || value === "code" ? value : null;
}

/** Record how this device just signed in (null: a way You does not list, or unknown). */
export function rememberSignInMethod(method: SignInMethod | null): void {
  write(methodKey(), method);
}
