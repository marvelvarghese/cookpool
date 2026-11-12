"use client";

/**
 * Passkeys on this device (Cookpool PK-4): the browser side of
 * `components/kitchen/passkeys.ts`. It asks whether passkeys run on this
 * page, runs the WebAuthn sheets through `@simplewebauthn/browser`, and keeps
 * two small records in localStorage under the console's prefix:
 *
 * - `<prefix>.passkey-here`: this device holds one of our passkeys (set when
 *   one is added here or used to sign in here). The "Turn on Face ID" offer
 *   is never shown on such a device.
 * - `<prefix>.passkey-offer-dismissed`: when "Not now" was chosen (ms).
 *
 * And one in this tab only (sessionStorage), `<prefix>.passkey-offer-due`: a
 * code or Google sign-in just happened, so the offer may show before landing
 * (on the sign-in page, or after the Name step Google's return opens).
 *
 * None of these is cleared on sign-out: they are about the device, not the
 * session. None holds a credential.
 */

import {
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type {
  PasskeyAuthenticationResponseJSON,
  PasskeyCreationOptionsJSON,
  PasskeyRegistrationResponseJSON,
  PasskeyRequestOptionsJSON,
} from "@saas/contracts/passkeys";
import { appConfig } from "./app-config";
import { offerDue, passkeyDevice, passkeysRunHere, type PasskeyDevice } from "@/components/kitchen/passkeys";

const hereKey = (): string => `${appConfig().storagePrefix}.passkey-here`;
const dismissedKey = (): string => `${appConfig().storagePrefix}.passkey-offer-dismissed`;
const dueKey = (): string => `${appConfig().storagePrefix}.passkey-offer-due`;

function store(kind: "local" | "session"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function get(kind: "local" | "session", key: string): string | null {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function put(kind: "local" | "session", key: string, value: string | null): void {
  try {
    const s = store(kind);
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* ignore: without storage the offer may show again */
  }
}

/** Whether passkeys run on this page (WebAuthn, and the host is the RP ID). False before mount. */
export function passkeysRunOnThisPage(): boolean {
  if (typeof window === "undefined") return false;
  return passkeysRunHere({
    hostname: window.location?.hostname,
    hasWebAuthn: typeof window.PublicKeyCredential === "function",
    config: appConfig(),
  });
}

/** This device, from its user agent. */
export function thisDevice(): PasskeyDevice {
  if (typeof navigator === "undefined") return "other";
  return passkeyDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

/** Whether the device has Face ID, a fingerprint or a screen lock WebAuthn can use. */
export async function platformAuthenticator(): Promise<boolean> {
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export function deviceHasPasskey(): boolean {
  return get("local", hereKey()) === "1";
}

export function markDeviceHasPasskey(): void {
  put("local", hereKey(), "1");
}

export function offerDismissedAt(): number | null {
  const raw = get("local", dismissedKey());
  const at = raw === null ? NaN : Number(raw);
  return Number.isFinite(at) ? at : null;
}

/** "Not now". */
export function dismissOffer(now: number = Date.now()): void {
  put("local", dismissedKey(), String(now));
}

/** A code or Google sign-in just happened in this tab. */
export function markOfferDue(): void {
  put("session", dueKey(), "1");
}

/** Whether a sign-in just happened, and forget it: the offer is asked about once. */
export function takeOfferDue(): boolean {
  const due = get("session", dueKey()) === "1";
  put("session", dueKey(), null);
  return due;
}

/**
 * Whether to show "Turn on Face ID" now (`offerDue`). It takes the "a sign-in
 * just happened" mark either way, so the offer is weighed once per sign-in,
 * and asks the browser about its authenticator only when everything else
 * says yes.
 */
export async function shouldOfferPasskey(now: number = Date.now()): Promise<boolean> {
  const base = {
    afterSignIn: takeOfferDue(),
    runsHere: passkeysRunOnThisPage(),
    deviceHasPasskey: deviceHasPasskey(),
    dismissedAt: offerDismissedAt(),
    now,
  };
  if (!offerDue({ ...base, platformAuthenticator: true })) return false;
  return offerDue({ ...base, platformAuthenticator: await platformAuthenticator() });
}

/** The browser's sign-in sheet. */
export function authenticate(options: PasskeyRequestOptionsJSON): Promise<PasskeyAuthenticationResponseJSON> {
  return startAuthentication({
    optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
  }) as Promise<PasskeyAuthenticationResponseJSON>;
}

/** The browser's save-a-passkey sheet. */
export function register(options: PasskeyCreationOptionsJSON): Promise<PasskeyRegistrationResponseJSON> {
  return startRegistration({
    optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
  }) as Promise<PasskeyRegistrationResponseJSON>;
}
