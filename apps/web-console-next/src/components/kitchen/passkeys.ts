/**
 * Passkeys in the console (Cookpool PK-4, cookpool-passkeys design §3): where
 * they run, the words that follow the device, the one-time "Turn on Face ID"
 * offer, Sign-in and security's rows, and the two ceremonies (sign in, add
 * one) with the SDK and the browser handed in. Pure: no React, no SDK, no
 * WebAuthn library, so every rule here is unit-tested with them mocked.
 * `lib/passkey-device.ts` wires the browser; the screens are
 * `passkey-ui.tsx`.
 *
 * Sign-in is shared, so all of this applies in every frame. Where passkeys
 * do not run (no WebAuthn, or a host that is not the environment's RP ID,
 * such as the workers.dev hosts) every passkey control hides and nothing
 * else changes.
 */

import type { LoginCompleteResponse } from "@saas/contracts/auth";
import type {
  Passkey,
  PasskeyAuthenticationResponseJSON,
  PasskeyCreationOptionsJSON,
  PasskeyRegistrationResponseJSON,
  PasskeyRequestOptionsJSON,
} from "@saas/contracts/passkeys";
import { PASSKEY_ERROR_REASONS, PASSKEY_MAX_PER_USER } from "@saas/contracts/passkeys";
import { parseCustomDomains, type AppConfig } from "@/lib/app-config";
import type { ApiResult } from "@/lib/api";

// ── Where passkeys run ────────────────────────────────────────────

/** The RP ID a dev build (localhost) uses: identity-worker's dev `PASSKEY_RP_ID`. */
export const DEV_RP_ID = "localhost";

/**
 * The environment's RP ID, from the console's own deploy config: stage and
 * prod use the custom domain `customDomains` names for them
 * (`stage.cookpool.store`, `cookpool.store`), the same hosts identity-worker's
 * `PASSKEY_RP_ID` names; a build that names no environment is dev,
 * `localhost`. Null for stage or prod with no custom domain (no host can
 * match, so passkeys never run).
 */
export function passkeyRpId(config: Pick<AppConfig, "deployEnv" | "customDomains">): string | null {
  const env = config.deployEnv;
  if (env !== "stage" && env !== "prod") return DEV_RP_ID;
  for (const [host, hostEnv] of parseCustomDomains(config.customDomains)) {
    if (hostEnv === env) return host;
  }
  return null;
}

/**
 * Whether passkeys run on this page: the browser has WebAuthn
 * (`window.PublicKeyCredential`) and the page's hostname is the RP ID,
 * exactly. A workers.dev host, a `*.localhost` proxy or another
 * environment's host never matches.
 */
export function passkeysRunHere(opts: {
  hostname: string | null | undefined;
  hasWebAuthn: boolean;
  config: Pick<AppConfig, "deployEnv" | "customDomains">;
}): boolean {
  if (!opts.hasWebAuthn) return false;
  const rpId = passkeyRpId(opts.config);
  return rpId !== null && (opts.hostname ?? "").toLowerCase() === rpId;
}

// ── The device ────────────────────────────────────────────────────

export type PasskeyDevice = "iphone" | "ipad" | "android" | "mac" | "windows" | "other";

/**
 * The device from its user agent. An iPad on iPadOS 13+ says "Macintosh";
 * its touch points give it away (a Mac has none).
 */
export function passkeyDevice(userAgent: string, maxTouchPoints = 0): PasskeyDevice {
  const ua = userAgent ?? "";
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/iPad/.test(ua)) return "ipad";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Mac OS X/.test(ua)) return maxTouchPoints > 1 ? "ipad" : "mac";
  if (/Windows/.test(ua)) return "windows";
  return "other";
}

/** The name a new passkey is saved under, or undefined to let the server make one. */
export function passkeyDeviceName(device: PasskeyDevice): string | undefined {
  switch (device) {
    case "iphone":
      return "iPhone";
    case "ipad":
      return "iPad";
    case "android":
      return "Android phone";
    case "mac":
      return "Mac";
    case "windows":
      return "Windows PC";
    default:
      return undefined;
  }
}

/** Face ID on iPhone and iPad, a fingerprint on Android, otherwise the screen lock. */
export type PasskeyUnlock = "face" | "fingerprint" | "lock";

export function passkeyUnlock(device: PasskeyDevice): PasskeyUnlock {
  if (device === "iphone" || device === "ipad") return "face";
  if (device === "android") return "fingerprint";
  return "lock";
}

export const PASSKEY_BUTTON = "Sign in with a passkey";

/** The remembered card's main button for a passkey account. */
export function passkeySignInLabel(device: PasskeyDevice): string {
  const unlock = passkeyUnlock(device);
  if (unlock === "face") return "Sign in with Face ID";
  if (unlock === "fingerprint") return "Sign in with your fingerprint";
  return PASSKEY_BUTTON;
}

/** "passkey on this phone" (the remembered card's subtitle). */
export function passkeyHere(device: PasskeyDevice): string {
  if (device === "iphone" || device === "android") return "passkey on this phone";
  if (device === "ipad") return "passkey on this iPad";
  return "passkey on this device";
}

/** The Sign in tab's helper line, where passkeys run. */
export const PASSKEY_SIGN_IN_HELPER = "No password. A passkey uses Face ID or your fingerprint; the email code works on any device.";

// ── Notices ───────────────────────────────────────────────────────

export const PASSKEY_FAILED_NOTICE = "That passkey didn't work. Try again, or use Google or an email code.";
export const PASSKEY_UNREACHABLE_NOTICE = "Couldn't sign in with a passkey just now. Try again, or use Google or an email code.";
/** A refused passkey sign-in (401) also says this (PK-6): passkeys saved before the fix were never stored. */
export const PASSKEY_READD_HINT = "If you turned on Face ID before today, open Sign-in and security after signing in and add it again.";
export const PASSKEY_REFUSED_NOTICE = `${PASSKEY_FAILED_NOTICE} ${PASSKEY_READD_HINT}`;
/** The options were not ready at the tap (PK-6): they have been fetched now, so the next tap opens the sheet. */
export const PASSKEY_TAP_AGAIN_NOTICE = "That took a moment. Tap again to carry on.";
export const PASSKEY_LIMIT_NOTICE = `You have ${PASSKEY_MAX_PER_USER} passkeys. Remove one under Sign-in and security first.`;
export const PASSKEY_ADD_FAILED_NOTICE = "Couldn't save the passkey. Try again, or carry on with Google or an email code.";

/** InvalidStateError on register: this device already holds one for this account. */
export function passkeyAlreadyNotice(device: PasskeyDevice): string {
  if (device === "iphone" || device === "android") return "This phone already has a Cookpool passkey.";
  if (device === "ipad") return "This iPad already has a Cookpool passkey.";
  return "This device already has a Cookpool passkey.";
}
export const PASSKEY_REMOVE_FAILED_NOTICE = "Couldn't remove that passkey. It still works; try again.";
export const PASSKEY_REMOVED = "Passkey removed. Also delete it from your phone's passwords.";

// ── Turn on Face ID ───────────────────────────────────────────────

/** "Not now" quiets the offer on this device for this long. */
export const OFFER_SNOOZE_DAYS = 30;
export const OFFER_SNOOZE_MS = OFFER_SNOOZE_DAYS * 24 * 60 * 60 * 1000;

/** Whether "Not now" (at `dismissedAt`, ms) still holds at `now`. */
export function offerSnoozed(dismissedAt: number | null, now: number): boolean {
  return dismissedAt !== null && Number.isFinite(dismissedAt) && now - dismissedAt < OFFER_SNOOZE_MS;
}

/**
 * Whether to offer "Turn on Face ID" now. Only straight after a code or
 * Google sign-in (`afterSignIn`), and only when every one holds: passkeys run
 * here, the device has a platform authenticator, this device holds no
 * passkey of ours, and "Not now" was not chosen in the last 30 days.
 */
export function offerDue(opts: {
  afterSignIn: boolean;
  runsHere: boolean;
  platformAuthenticator: boolean;
  deviceHasPasskey: boolean;
  dismissedAt: number | null;
  now: number;
}): boolean {
  return (
    opts.afterSignIn &&
    opts.runsHere &&
    opts.platformAuthenticator &&
    !opts.deviceHasPasskey &&
    !offerSnoozed(opts.dismissedAt, opts.now)
  );
}

export interface OfferCopy {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  action: string;
  doneTitle: string;
  doneBody: string;
}

/** The offer's words, which follow the device (`PasskeyOffer`). */
export function offerCopy(device: PasskeyDevice, firstName: string | null | undefined): OfferCopy {
  const unlock = passkeyUnlock(device);
  const name = passkeyDeviceName(device);
  const where = device === "iphone" || device === "android" ? "this phone" : device === "ipad" ? "this iPad" : "this device";
  const eyebrow = firstName?.trim() ? `You're in, ${firstName.trim()}` : "You're in";
  const after = "Change it any time under You → Sign-in and security.";
  const nothingToType = "Nothing to type, nothing to leak. Your email code still works too.";
  if (unlock === "face") {
    return {
      eyebrow,
      title: "Next time, just use Face ID",
      body: `Save a passkey on ${where}. No code, no email, one look and you're back in.`,
      points: ["Works with Face ID, or your passcode.", "Syncs through iCloud Keychain, so a new phone keeps it.", nothingToType],
      action: "Turn on Face ID",
      doneTitle: "Face ID is on",
      doneBody: `Saved as "${name}" in your iCloud Keychain. ${after}`,
    };
  }
  if (unlock === "fingerprint") {
    return {
      eyebrow,
      title: "Next time, just use your fingerprint",
      body: `Save a passkey on ${where}. No code, no email, one touch and you're back in.`,
      points: [
        "Works with your fingerprint or screen lock.",
        "Syncs through your Google account, so a new phone keeps it.",
        nothingToType,
      ],
      action: "Turn on fingerprint",
      doneTitle: "Fingerprint sign-in is on",
      doneBody: `Saved as "${name}" with your Google account. ${after}`,
    };
  }
  return {
    eyebrow,
    title: "Next time, just use your screen lock",
    body: `Save a passkey on ${where}. No code, no email: unlock and you're back in.`,
    points: [
      "Works with your fingerprint, face or screen lock.",
      "Your password manager can sync it to your other devices.",
      nothingToType,
    ],
    action: "Turn on passkey",
    doneTitle: "Your passkey is on",
    doneBody: `Saved${name ? ` as "${name}"` : ""} on ${where}. ${after}`,
  };
}

// ── Sign-in and security ──────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A passkey's last use in the person's own days: "used today", "used
 * yesterday", "used 3 days ago", "used 2 months ago", or "never used".
 */
export function lastUsedText(lastUsedAt: string | null | undefined, now: number): string {
  if (!lastUsedAt) return "never used";
  const at = Date.parse(lastUsedAt);
  if (!Number.isFinite(at)) return "never used";
  // Calendar days in local time; rounding absorbs a daylight-saving hour.
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS));
  if (days === 0) return "used today";
  if (days === 1) return "used yesterday";
  if (days < 60) return `used ${days} days ago`;
  return `used ${Math.floor(days / 30)} months ago`;
}

/**
 * The row's second line: "Synced · used today" for a passkey the platform
 * syncs (iCloud Keychain, Google Password Manager), else "One device · used
 * today" (a security key, or a passkey kept on one device).
 */
export function passkeyMeta(passkey: Pick<Passkey, "lastUsedAt" | "backedUp">, now: number): string {
  return `${passkey.backedUp ? "Synced" : "One device"} · ${lastUsedText(passkey.lastUsedAt, now)}`;
}

/** Whether another passkey can be added (the server refuses the eleventh). */
export function canAddPasskey(count: number): boolean {
  return count < PASSKEY_MAX_PER_USER;
}

export interface OtherWayRow {
  way: "google" | "code";
  title: string;
  subtitle: string;
  /** "Linked", when known; null when it is not. */
  badge: string | null;
}

/**
 * Other ways in: Google when the API offers it ("Linked" only when this
 * device last signed in with it; the profile does not say which providers a
 * person has), and the email code, always on.
 */
export function otherWaysIn(opts: { email: string; googleOffered: boolean; googleLinked: boolean }): OtherWayRow[] {
  const rows: OtherWayRow[] = [];
  if (opts.googleOffered) {
    rows.push({ way: "google", title: "Google", subtitle: opts.email, badge: opts.googleLinked ? "Linked" : null });
  }
  rows.push({ way: "code", title: "Email code", subtitle: `${opts.email} · always on, so you can't lock yourself out`, badge: null });
  return rows;
}

// ── Remove, with Undo ─────────────────────────────────────────────

/** A removal waits this long for Undo before the DELETE is sent. */
export const REMOVE_HOLD_MS = 5000;

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface HeldRemoval {
  /** Undo: the DELETE is never sent. False when it was already sent. */
  undo: () => boolean;
  /** Send it now (the page is closing). */
  flush: () => void;
}

/**
 * Hold a removal for `REMOVE_HOLD_MS`, then send it once. Undo before then
 * cancels it; `flush` sends it at once.
 */
export function holdRemoval(send: () => void, timers: Timers, holdMs: number = REMOVE_HOLD_MS): HeldRemoval {
  let state: "held" | "sent" | "undone" = "held";
  const fire = () => {
    if (state !== "held") return;
    state = "sent";
    send();
  };
  const handle = timers.set(fire, holdMs);
  return {
    undo: () => {
      if (state !== "held") return false;
      state = "undone";
      timers.clear(handle);
      return true;
    },
    flush: () => {
      if (state !== "held") return;
      timers.clear(handle);
      fire();
    },
  };
}

// ── The ceremonies ────────────────────────────────────────────────

/**
 * The browser's sheet was closed, timed out or refused (WebAuthn says
 * `NotAllowedError` for all of these, and `AbortError` when we aborted it):
 * nothing to say. Errors may be wrapped (SimpleWebAuthn's `WebAuthnError`
 * keeps the browser's name, and the original as `cause`).
 */
export function isCeremonyCancel(error: unknown): boolean {
  const names = new Set<string>();
  let e: unknown = error;
  for (let i = 0; i < 3 && e && typeof e === "object"; i += 1) {
    const rec = e as { name?: unknown; code?: unknown; cause?: unknown };
    if (typeof rec.name === "string") names.add(rec.name);
    if (rec.code === "ERROR_CEREMONY_ABORTED") return true;
    e = rec.cause;
  }
  return names.has("NotAllowedError") || names.has("AbortError");
}

/** The device already holds one of this person's passkeys (`excludeCredentials` matched). */
export function isAlreadyRegistered(error: unknown): boolean {
  let e: unknown = error;
  for (let i = 0; i < 3 && e && typeof e === "object"; i += 1) {
    const rec = e as { name?: unknown; code?: unknown; cause?: unknown };
    if (rec.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || rec.name === "InvalidStateError") return true;
    e = rec.cause;
  }
  return false;
}


/**
 * The browser's name for what went wrong (`NotAllowedError`,
 * `InvalidStateError`, `SecurityError`, …), looking through
 * SimpleWebAuthn's wrapper to the error the browser threw.
 */
export function ceremonyErrorName(error: unknown): string {
  let e: unknown = error;
  for (let i = 0; i < 3 && e && typeof e === "object"; i += 1) {
    const rec = e as { name?: unknown; cause?: unknown };
    if (typeof rec.name === "string" && rec.name !== "Error" && rec.name !== "WebAuthnError") return rec.name;
    e = rec.cause;
  }
  return "Error";
}

/** What the server said, small enough to read out: the step (register), else the reason or code, and the status. */
export function serverFailureDetail(r: { status: number; error: { code: string; reason?: string | undefined; details?: Record<string, unknown> | undefined } }): string {
  const step = r.error.details?.["step"];
  const what = typeof step === "string" ? step : (r.error.reason ?? r.error.code);
  return r.status > 0 ? `${what} · ${r.status}` : what;
}

// ── Options before the tap (PK-6) ─────────────────────────────────
//
// iPhone Safari opens the passkey sheet only from the tap itself: a
// `navigator.credentials.create/get` after an `await` is refused with
// NotAllowedError. So the ceremony options are fetched when the screen
// shows, kept while fresh, and the tap opens the sheet with no `await`
// before it.

/** Options fetched ahead are used for this long; the challenge itself lives PASSKEY_CHALLENGE_TTL_SECONDS (5 min). */
export const PASSKEY_OPTIONS_FRESH_MS = 4 * 60 * 1000;

type OptionsFailure = Extract<ApiResult<unknown>, { ok: false }>;

export interface OptionsPrefetch<T> {
  /** Fetch options unless fresh ones are held or a fetch is under way. Answers this fetch's failure, or null. */
  refresh: () => Promise<OptionsFailure | null>;
  /** Synchronous: the held options when fresh, taken (a challenge is good once); null otherwise. */
  take: () => T | null;
  /** When the held options stop being fresh (ms), or null when none are held. */
  staleAt: () => number | null;
}

export function createOptionsPrefetch<T>(
  fetchOptions: () => Promise<ApiResult<{ options: T }>>,
  now: () => number = Date.now,
): OptionsPrefetch<T> {
  let held: { options: T; at: number } | null = null;
  let inflight: Promise<OptionsFailure | null> | null = null;
  const fresh = () => held !== null && now() - held.at < PASSKEY_OPTIONS_FRESH_MS;
  return {
    refresh: () => {
      if (fresh()) return Promise.resolve(null);
      if (inflight) return inflight;
      const asked = now();
      inflight = fetchOptions()
        .then((r) => {
          if (!r.ok) return r;
          held = { options: r.data.options, at: asked };
          return null;
        })
        .catch(() => ({ ok: false as const, status: 0, error: { code: "network_error" } }) as OptionsFailure)
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    take: () => {
      if (!fresh()) {
        held = null;
        return null;
      }
      const out = held!.options;
      held = null;
      return out;
    },
    staleAt: () => (held ? held.at + PASSKEY_OPTIONS_FRESH_MS : null),
  };
}

// ── The ceremonies ────────────────────────────────────────────────
//
// Both start the browser's sheet synchronously, in the caller's tap, with
// options from the prefetch. If none are ready they fetch them and answer
// `retry` (tap again) instead of opening the sheet after an await. After
// each attempt the prefetch is refilled for the next.

export interface PasskeySignInDeps {
  options: Pick<OptionsPrefetch<PasskeyRequestOptionsJSON>, "take" | "refresh">;
  /** The browser's sheet (`startAuthentication`). */
  authenticate: (options: PasskeyRequestOptionsJSON) => Promise<PasskeyAuthenticationResponseJSON>;
  loginVerify: (response: PasskeyAuthenticationResponseJSON) => Promise<ApiResult<LoginCompleteResponse>>;
}

export type PasskeySignInOutcome =
  | { kind: "signed_in"; session: LoginCompleteResponse }
  | { kind: "cancelled" }
  /** The options were not ready: fetched now; the next tap opens the sheet. */
  | { kind: "retry" }
  | { kind: "failed"; notice: string };

/**
 * Sign in with a passkey: the browser's sheet (opened before this returns),
 * then login verify. A cancelled sheet is `cancelled`; a refused passkey
 * (401) reads PASSKEY_REFUSED_NOTICE, nothing about why; a browser error
 * PASSKEY_FAILED_NOTICE; the network or a limit PASSKEY_UNREACHABLE_NOTICE.
 */
export function signInWithPasskey(deps: PasskeySignInDeps): Promise<PasskeySignInOutcome> {
  const options = deps.options.take();
  if (!options) {
    return deps.options.refresh().then((failed) => (failed ? { kind: "failed", notice: PASSKEY_UNREACHABLE_NOTICE } : { kind: "retry" }));
  }
  const sheet = deps.authenticate(options);
  return finishSignIn(sheet, deps).then((out) => {
    // Signed in: this page is leaving, so no new challenge is asked for.
    if (out.kind !== "signed_in") void deps.options.refresh();
    return out;
  });
}

async function finishSignIn(sheet: Promise<PasskeyAuthenticationResponseJSON>, deps: PasskeySignInDeps): Promise<PasskeySignInOutcome> {
  let response: PasskeyAuthenticationResponseJSON;
  try {
    response = await sheet;
  } catch (error) {
    if (isCeremonyCancel(error)) return { kind: "cancelled" };
    return { kind: "failed", notice: PASSKEY_FAILED_NOTICE };
  }
  const verified = await deps.loginVerify(response);
  if (verified.ok) return { kind: "signed_in", session: verified.data };
  const refused = verified.status === 401 || verified.error.reason === PASSKEY_ERROR_REASONS.PASSKEY_FAILED;
  return { kind: "failed", notice: refused ? PASSKEY_REFUSED_NOTICE : PASSKEY_UNREACHABLE_NOTICE };
}

export interface AddPasskeyDeps {
  options: Pick<OptionsPrefetch<PasskeyCreationOptionsJSON>, "take" | "refresh">;
  /** The browser's sheet (`startRegistration`). */
  register: (options: PasskeyCreationOptionsJSON) => Promise<PasskeyRegistrationResponseJSON>;
  registerVerify: (input: { response: PasskeyRegistrationResponseJSON; deviceName?: string }) => Promise<
    ApiResult<{ passkey: Passkey }>
  >;
  deviceName: string | undefined;
}

export type AddPasskeyOutcome =
  | { kind: "added"; passkey: Passkey }
  | { kind: "cancelled" }
  /** This device already holds one of this person's passkeys. */
  | { kind: "already" }
  /** At PASSKEY_MAX_PER_USER. */
  | { kind: "limit" }
  /** The options were not ready: fetched now; the next tap opens the sheet. */
  | { kind: "retry" }
  /** `detail`: the browser's error name, or the server's step and status, shown small for the owner to read out. */
  | { kind: "failed"; detail: string };

function isLimit(r: { ok: false; status: number; error: { reason?: string | undefined } }): boolean {
  return r.error.reason === PASSKEY_ERROR_REASONS.TOO_MANY_PASSKEYS;
}

function optionsRefused(r: OptionsFailure): AddPasskeyOutcome {
  return isLimit(r) ? { kind: "limit" } : { kind: "failed", detail: serverFailureDetail(r) };
}

/** Add a passkey on this device: the browser's sheet (opened before this returns), then register verify with a device name. */
export function addPasskey(deps: AddPasskeyDeps): Promise<AddPasskeyOutcome> {
  const options = deps.options.take();
  if (!options) return deps.options.refresh().then((failed) => (failed ? optionsRefused(failed) : { kind: "retry" }));
  const sheet = deps.register(options);
  return finishAdd(sheet, deps).finally(() => void deps.options.refresh());
}

async function finishAdd(sheet: Promise<PasskeyRegistrationResponseJSON>, deps: AddPasskeyDeps): Promise<AddPasskeyOutcome> {
  let response: PasskeyRegistrationResponseJSON;
  try {
    response = await sheet;
  } catch (error) {
    if (isAlreadyRegistered(error)) return { kind: "already" };
    if (isCeremonyCancel(error)) return { kind: "cancelled" };
    return { kind: "failed", detail: ceremonyErrorName(error) };
  }
  const verified = await deps.registerVerify(deps.deviceName ? { response, deviceName: deps.deviceName } : { response });
  if (verified.ok) return { kind: "added", passkey: verified.data.passkey };
  return isLimit(verified) ? { kind: "limit" } : { kind: "failed", detail: serverFailureDetail(verified) };
}
