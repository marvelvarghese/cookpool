/**
 * The invitation to install Cookpool (cookpool-app PW-2, design §2): once, in
 * the way the phone allows.
 *
 * - **How this browser installs** (`installWay`): already installed (the page
 *   runs standalone) → never ask; Chromium holding a `beforeinstallprompt`
 *   event → one tap opens the browser's own prompt; an iPhone or iPad (no
 *   prompt API) → our sheet with the two steps; any other browser → no card,
 *   and You says in one line what it can or cannot do.
 * - **When the card shows** (`showInstallCard`): from the second day this
 *   device uses Cookpool, never in its first session, and not for 30 days
 *   after ✕. Per device (localStorage), not per account, and kept when the
 *   person signs out.
 *
 * The event itself is caught by the root layout's inline script
 * (`app-shell.ts`), before React, so the browser's own mini-infobar never
 * shows and a prompt that fires before Home mounts is not lost.
 *
 * Pure apart from the storage helpers (which tolerate a missing or throwing
 * storage), so it is unit-testable. No "use client": the root layout (a
 * server component) reads the window keys below.
 */

import { appConfig } from "./app-config";

/** Where the root layout's script keeps the held `beforeinstallprompt` event. */
export const PROMPT_KEY = "__cookpoolInstallPrompt";
/** Set to true by the same script when the browser says the app was installed (`appinstalled`). */
export const INSTALLED_KEY = "__cookpoolInstalled";
/** The window event the script sends whenever either of those changes. */
export const INSTALL_CHANGE = "cookpool:install-change";

/** The `display-mode` values of an installed app (ours is `standalone`; the others are its fallbacks or a desktop window). */
export const INSTALLED_DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"] as const;

export type InstallWay =
  /** Running as the installed app, or just installed from this page: nothing to offer. */
  | "installed"
  /** Chromium with a held prompt: one tap. */
  | "prompt"
  /** iPhone or iPad: the two drawn steps. */
  | "ios"
  /** A browser that installs from its own menu (Chromium before it offers, Android browsers). */
  | "menu"
  /** A browser that cannot install Cookpool. */
  | "none";

export interface InstallEnv {
  /** A `display-mode` of an installed app matches, or iOS's `navigator.standalone`. */
  standalone: boolean;
  /** The browser said `appinstalled` on this page. */
  installedNow: boolean;
  /** A `beforeinstallprompt` event is held. */
  promptHeld: boolean;
  /** The browser has the install-prompt API at all (`onbeforeinstallprompt` in window: Chromium). */
  promptApi: boolean;
  userAgent: string;
  /** `navigator.maxTouchPoints`: an iPad asking for desktop sites says "Macintosh" but has a touch screen. */
  maxTouchPoints: number;
}

/** An iPhone, iPod or iPad, including an iPad that asks for desktop sites. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/** An app's own web view (Facebook, Instagram, …): it has no Share → Add to Home Screen. */
export function isInAppBrowser(userAgent: string): boolean {
  return /\b(FBAN|FBAV|Instagram|LinkedInApp|Snapchat|musical_ly|BytedanceWebview)\b|\bLine\//.test(userAgent);
}

export function installWay(env: InstallEnv): InstallWay {
  if (env.standalone || env.installedNow) return "installed";
  if (env.promptHeld) return "prompt";
  if (isIos(env.userAgent, env.maxTouchPoints)) return isInAppBrowser(env.userAgent) ? "none" : "ios";
  if (env.promptApi || /\bAndroid\b/.test(env.userAgent)) return "menu";
  return "none";
}

/** Safari on an iPhone (not Chrome, Firefox or Edge for iOS): its Share button is in the bottom toolbar. */
export function isIphoneSafari(userAgent: string): boolean {
  return /\biPhone\b/.test(userAgent) && /\bVersion\/\d+/.test(userAgent) && !/\b(CriOS|FxiOS|EdgiOS|OPiOS)\//.test(userAgent);
}

/**
 * The first step's words. Safari 26 (iOS 26) moved Share into the ··· menu of
 * its compact tab bar; earlier Safari and the other iOS browsers show the
 * Share button itself.
 */
export function iosShareStep(userAgent: string): string {
  const safari = /\bVersion\/(\d+)/.exec(userAgent);
  const other = /\b(CriOS|FxiOS|EdgiOS|OPiOS)\//.test(userAgent);
  if (safari && !other && Number(safari[1]) >= 26) return "Tap ··· then Share";
  return "Tap Share";
}

// ── The words ────────────────────────────────────────────────────────

export const CARD_TITLE = "Install Cookpool";
export const CARD_LINE = "Open it like an app";
export const HIDDEN_TOAST = "Install is in You, any time";
export const INSTALLED_TOAST = "Cookpool is on your home screen";
export const ROW_TITLE = "Install the app";
export const SHEET_TITLE = "Add to your Home Screen";
export const ADD_STEP = "Tap Add to Home Screen";

/** The card's button: the browser's prompt on Android, our steps on an iPhone. */
export function installLabel(way: InstallWay): string {
  return way === "ios" ? "How" : "Install";
}

/** You's one line when this browser has nothing to tap. */
export function cannotInstallLine(way: InstallWay): string | null {
  if (way === "menu") return "Install it from your browser's menu.";
  if (way === "none") return "This browser can't install Cookpool.";
  return null;
}

// ── When the card shows ──────────────────────────────────────────────

/** ✕ hides the card for this many days. */
export const HIDE_DAYS = 30;

/** A local calendar day, "2026-11-05". */
export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `day` plus `n` calendar days ("2026-11-05" + 30 → "2026-12-05"); null for a malformed day. */
export function addDays(day: string, n: number): string | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** What this device remembers about the card. */
export interface InstallMemory {
  /** The day this device first used Cookpool. */
  firstDay: string | null;
  /** The day the card was last hidden (✕, or the browser's prompt dismissed). */
  hiddenOn: string | null;
  /** This browser session is the device's first: the card waits for the next one. */
  firstSession: boolean;
}

/**
 * Whether Home shows the install card today: only where there is a way to
 * offer (the prompt, or the iPhone steps), from the second day this device
 * uses Cookpool and not in its first session, and not within 30 days of ✕.
 * A day that cannot be read (no storage, a clock gone back) shows nothing.
 */
export function showInstallCard(way: InstallWay, today: string, memory: InstallMemory): boolean {
  if (way !== "prompt" && way !== "ios") return false;
  if (memory.firstSession || !memory.firstDay || !DAY.test(memory.firstDay) || !DAY.test(today)) return false;
  if (today <= memory.firstDay) return false;
  if (memory.hiddenOn) {
    const until = addDays(memory.hiddenOn, HIDE_DAYS);
    if (!until || today < until) return false;
  }
  return true;
}

// ── What this device remembers ───────────────────────────────────────

// Built per call: the storage prefix is runtime config (saas-console-artifact CA1).
const firstDayKey = (): string => `${appConfig().storagePrefix}.install.first-day`;
const hiddenKey = (): string => `${appConfig().storagePrefix}.install.hidden-on`;
const firstSessionKey = (): string => `${appConfig().storagePrefix}.install.first-session`;

type StoreName = "localStorage" | "sessionStorage";

function read(store: StoreName, key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window[store].getItem(key);
  } catch {
    return null;
  }
}

function write(store: StoreName, key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window[store].setItem(key, value);
    return true;
  } catch {
    /* ignore: without storage the card never shows */
    return false;
  }
}

/**
 * What this device remembers, recording `today` as its first day the first
 * time it is asked (and marking this browser session as that first one).
 */
export function installMemory(today: string): InstallMemory {
  let firstDay = read("localStorage", firstDayKey());
  let firstSession = read("sessionStorage", firstSessionKey()) === "1";
  if (!firstDay && write("localStorage", firstDayKey(), today)) {
    firstDay = today;
    firstSession = true;
    write("sessionStorage", firstSessionKey(), "1");
  }
  return { firstDay, hiddenOn: read("localStorage", hiddenKey()), firstSession };
}

/** Hide the card for `HIDE_DAYS` from `today` (✕, a dismissed prompt, or "Got it"). */
export function hideInstallCard(today: string): void {
  write("localStorage", hiddenKey(), today);
}
