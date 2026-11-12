/**
 * The getting-in screens (Cookpool PK-3, cookpool-passkeys design §3): the
 * words and rules of the redesigned Sign in, Create account, the code screen
 * and Can't sign in?, after the canvas row "Getting in" (`AuthWelcome`,
 * `AuthSignUp`, `AuthCode`, `AuthHelp`, `WebAuth`). Pure, so it is
 * unit-testable; `app/login/page.tsx` and `app/login/help/page.tsx` wire it.
 *
 * These screens are what everyone sees, in every frame: sign-in is shared.
 * The passkey and Face ID controls the boards draw come with PK-4.
 */

import type { JoinPreviewPublic } from "@saas/contracts/membership";
import { LOGIN_CODES_PER_WINDOW, LOGIN_CODE_WINDOW_SECONDS } from "@saas/contracts/auth";
import { loginPathFor } from "@/lib/safe-next";
import { nameInitials } from "./members";
import {
  CODE_LENGTH,
  CODE_LIFETIME_MINUTES,
  DEFAULT_HEADLINE,
  cleanDisplayName,
  countdownText,
  isCodeComplete,
  looksLikeEmail,
  resendControl,
  startHeadline,
  type SignInState,
} from "./sign-in";

// ── Copy ───────────────────────────────────────────────────────────

export const WELCOME_BACK_HEADLINE = "Good to see you again.";
export const SIGN_UP_TITLE = "Make your account";
export const SIGN_IN_TITLE = "Sign in";
export const SIGN_IN_HELPER = `No password. We email you a ${CODE_LENGTH}-digit code that works for ${CODE_LIFETIME_MINUTES} minutes.`;
export const SIGN_UP_HELPER = `No password. We email a ${CODE_LENGTH}-digit code; an email that already has an account just signs in.`;
export const USE_ANOTHER_ACCOUNT = "Use another account";
export const CANT_SIGN_IN = "Can't sign in?";
export const HELP_PATH = "/login/help";
/** No longer drawn (RV-18: the code screen keeps one helper line, `NO_EMAIL_LINE`). */
export const CODE_HINT = "The code signs you in on its own once all six digits are in. You can paste it too.";
export const NO_EMAIL_LINE = "No email after a minute? Look in spam or Promotions.";
export const RESENT_NOTICE = "New code sent. The old one no longer works.";
/** The desktop panel's line under the chips (`WebAuth`). */
export const PANEL_LINE = "Shared pantries, dishes split by portion, and the fewest payments to settle up.";
export const PANEL_FOOTER = "Flatmates, hostels, lunch clubs, families.";
/** The panel's three chips: a pantry, a dish, a balance. */
export const PANEL_CHIPS = ["Milk · Anu paid", "Dal for 4 · ₹38 each", "You're square"] as const;

export type SignInTab = "in" | "new";

export const SIGN_IN_TABS: readonly { mode: SignInTab; label: string }[] = [
  { mode: "in", label: "Sign in" },
  { mode: "new", label: "Create account" },
];

/** "Continue with Google" on Sign in, "Sign up with Google" on Create account. */
export function googleLabel(mode: SignInTab): string {
  return mode === "new" ? "Sign up with Google" : "Continue with Google";
}

/**
 * The green panel's headline. A join link names who you are joining; Sign in
 * with an account remembered here says "Good to see you again."; otherwise
 * the pitch (a first visit lands on Sign in, and "again" would be wrong).
 */
export function heroTitle(mode: SignInTab, remembered: boolean, preview: JoinPreviewPublic | null): string {
  if (preview) return startHeadline(preview);
  return mode === "in" && remembered ? WELCOME_BACK_HEADLINE : DEFAULT_HEADLINE;
}

/** The form's title beside the desktop panel. */
export function formTitle(mode: SignInTab): string {
  return mode === "new" ? SIGN_UP_TITLE : SIGN_IN_TITLE;
}

/** The code screen's label at the top: Create account's second step, or plain Sign in. */
export function codeStepLabel(mode: SignInTab): string {
  return mode === "new" ? "Step 2 of 2" : "Sign in";
}

// ── Create account ─────────────────────────────────────────────────

/** `Your groups see it, like "Rahul paid ₹60".` */
export function signUpNameHint(draft: string): string {
  const first = cleanDisplayName(draft).split(" ")[0] || "You";
  return `Your groups see it, like "${first} paid ₹60".`;
}

/** Create account's "Email me a code" works once there is a name and an address that looks like one. */
export function canStartSignUp(state: Pick<SignInState, "signUpName" | "email" | "busy">): boolean {
  return state.busy === null && cleanDisplayName(state.signUpName) !== "" && looksLikeEmail(state.email);
}

/**
 * The name Create account saves after the code, or null: only when the tab
 * was Create account, a name was typed, and the account has none yet. An
 * address that already has an account (and a name) just signs in.
 */
export function signUpNameToSave(
  state: Pick<SignInState, "mode" | "signUpName">,
  user: { displayName?: string | null } | null | undefined,
): string | null {
  if (state.mode !== "new" || !user) return null;
  if (cleanDisplayName(user.displayName) !== "") return null;
  const name = cleanDisplayName(state.signUpName);
  return name === "" ? null : name;
}

// ── The remembered account ─────────────────────────────────────────

/** How the remembered account signed in last on this device (a passkey since PK-4). */
export type RememberedMethod = "google" | "code" | "passkey";

/** Who signed in on this device last (localStorage), for "Welcome back". */
export interface RememberedAccount {
  name: string;
  email: string;
  method: RememberedMethod;
}

/** A stored value read back, or null when it is not a remembered account. */
export function parseRememberedAccount(raw: string | null | undefined): RememberedAccount | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.email !== "string" || !looksLikeEmail(v.email)) return null;
  if (v.method !== "google" && v.method !== "code" && v.method !== "passkey") return null;
  return { name: cleanDisplayName(typeof v.name === "string" ? v.name : ""), email: v.email.trim(), method: v.method };
}

/** What to remember after a sign-in, from the signed-in profile. */
export function rememberedFrom(
  user: { email: string; displayName?: string | null },
  method: RememberedMethod,
): RememberedAccount | null {
  if (!looksLikeEmail(user.email)) return null;
  return { name: cleanDisplayName(user.displayName), email: user.email.trim(), method };
}

export interface RememberedCard {
  initials: string;
  title: string;
  subtitle: string;
  action: string;
}

/**
 * "Welcome back, Rahul" · "rahul@gmail.com · Google" · "Continue as Rahul".
 * A passkey account (PK-4), where passkeys run (`passkey`), reads
 * "rahul@gmail.com · passkey on this phone" and its button is the device's
 * own ("Sign in with Face ID"); where they do not, it falls back to the code.
 */
export function rememberedCard(
  account: RememberedAccount,
  passkey: { label: string; here: string } | null = null,
): RememberedCard {
  const first = account.name.split(" ")[0] ?? "";
  const withPasskey = account.method === "passkey" && passkey !== null;
  const how =
    account.method === "google" ? "Google" : account.method === "passkey" ? (passkey?.here ?? "passkey") : "email code";
  return {
    initials: account.name ? nameInitials(account.name) : (account.email.charAt(0).toLocaleUpperCase() || "?"),
    title: first ? `Welcome back, ${first}` : "Welcome back",
    subtitle: `${account.email} · ${how}`,
    action: withPasskey ? passkey.label : first ? `Continue as ${first}` : "Continue",
  };
}

/**
 * How "Continue as" signs in: a passkey when that is how this device signed
 * in and passkeys run here, Google when that is how and Google is offered,
 * else a code to the remembered address.
 */
export function continueMethod(
  account: RememberedAccount,
  googleOffered: boolean,
  passkeysRun: boolean = false,
): RememberedMethod {
  if (account.method === "passkey" && passkeysRun) return "passkey";
  return account.method === "google" && googleOffered ? "google" : "code";
}

// ── The code screen ────────────────────────────────────────────────

export type CodeBoxState = "empty" | "filled" | "active" | "wrong";

export interface CodeBox {
  digit: string;
  state: CodeBoxState;
}

/**
 * The six boxes the one real input draws: each digit typed, the next box
 * marked while the field has focus, all of them red for a refused code.
 */
export function codeBoxes(code: string, opts: { wrong: boolean; focused: boolean }): CodeBox[] {
  const active = opts.focused && !isCodeComplete(code) ? code.length : -1;
  return Array.from({ length: CODE_LENGTH }, (_, i) => {
    const digit = code.charAt(i);
    if (opts.wrong) return { digit, state: "wrong" };
    if (i === active) return { digit, state: "active" };
    return { digit, state: digit ? "filled" : "empty" };
  });
}

/** Gmail's inbox, only for a gmail.com or googlemail.com address. */
export function gmailInboxUrl(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain === "gmail.com" || domain === "googlemail.com" ? "https://mail.google.com/mail/u/0/#inbox" : null;
}

/** "Send a new code" as the half-width button draws it: the same countdown, shorter words. */
export function resendButton(state: SignInState, now: number): { label: string; disabled: boolean } {
  const control = resendControl(state, now);
  if (state.busy === "send") return { label: "Sending…", disabled: true };
  if (control.secondsLeft > 0) return { label: `Again in ${countdownText(control.secondsLeft)}`, disabled: true };
  return { label: "Send a new code", disabled: control.disabled };
}

// ── Can't sign in? ─────────────────────────────────────────────────

export const HELP_TITLE = "Can't sign in?";
export const HELP_SUBTITLE = "There's no password to reset. Pick what's happening and we'll get you back in.";
export const HELP_SAFETY =
  "Cookpool never asks for a password and never sends a code you didn't ask for. If you got one you didn't ask for, ignore it.";

/**
 * Can't sign in?'s Privacy and terms section (RV-18): where Sign in's Terms
 * and Privacy notice links and You's "Privacy and terms" row land. Cookpool
 * has no published Terms or Privacy notice yet, so it says what the app keeps
 * and says so plainly.
 */
export const PRIVACY_TITLE = "Privacy and terms";
export const PRIVACY_LINES = [
  "Cookpool keeps your email, the name your groups see, and what you add to your groups and pantries.",
  "Your groups see what you share with them. Community shows only what you post there.",
  "The full Terms and Privacy notice aren't published yet.",
] as const;

export type HelpAction = "sign_in" | "write" | "google";

export interface HelpItem {
  id: "none" | "lost" | "which" | "tries";
  question: string;
  tips: string[];
  cta: string;
  action: HelpAction;
  primary: boolean;
}

/**
 * The four problems. Nothing here depends on whether an address has an
 * account: `typedEmail` is only what this tab typed on the sign-in page.
 */
export function helpItems(opts: {
  typedEmail: string | null;
  googleOffered: boolean;
  /** The console's support address (`supportEmail`); without one, "Write to us" becomes "Back to sign in". */
  supportEmail?: string | null | undefined;
}): HelpItem[] {
  const canWrite = looksLikeEmail(opts.supportEmail ?? "");
  const typed = opts.typedEmail && looksLikeEmail(opts.typedEmail) ? opts.typedEmail.trim() : null;
  const windowMinutes = Math.round(LOGIN_CODE_WINDOW_SECONDS / 60);
  const google: Pick<HelpItem, "cta" | "action"> = opts.googleOffered
    ? { cta: "Continue with Google", action: "google" }
    : { cta: "Back to sign in", action: "sign_in" };
  return [
    {
      id: "none",
      question: "The code didn't arrive",
      tips: [
        "Give it a minute, then look in spam and Promotions.",
        typed ? `Check the address: ${typed}. A typo sends it nowhere.` : "Check the address you typed. A typo sends it nowhere.",
        "Using Gmail? Continue with Google needs no email at all.",
      ],
      cta: "Send a new code",
      action: "sign_in",
      primary: true,
    },
    {
      id: "lost",
      question: "I can't open that email any more",
      tips: [
        "If you signed up with Google, Continue with Google still works.",
        ...(canWrite
          ? ["Otherwise write to us from your new address. We'll check with someone in your group, then move your account across."]
          : []),
        "Your groups, kitchen and balances stay as they are meanwhile.",
      ],
      ...(canWrite ? { cta: "Write to us", action: "write" as const } : { cta: "Back to sign in", action: "sign_in" as const }),
      primary: false,
    },
    {
      id: "which",
      question: "I'm not sure which email I used",
      tips: [
        "Try Continue with Google first; most people signed up that way.",
        "Ask someone in your group which address they invited.",
        "A code to a new address makes a new, empty account, so check first.",
      ],
      ...google,
      primary: true,
    },
    {
      id: "tries",
      question: "It says too many tries",
      tips: [
        `After ${LOGIN_CODES_PER_WINDOW} codes in ${windowMinutes} minutes we pause new codes to that address for up to ${windowMinutes} minutes. It keeps your account safe.`,
        "Wait, then ask for one fresh code and use only the newest email.",
      ],
      cta: "Back to sign in",
      action: "sign_in",
      primary: false,
    },
  ];
}

/** Can't sign in?'s address, carrying the sign-in's safe `next` there and back. */
export function helpPathFor(rawNext: string | null | undefined): string {
  const login = loginPathFor(rawNext);
  const q = login.indexOf("?");
  return q < 0 ? HELP_PATH : `${HELP_PATH}${login.slice(q)}`;
}

/** Privacy and terms' "Write to us": null without a contact address; nothing about the person in it. */
export function privacyMailHref(contactEmail: string): string | null {
  return looksLikeEmail(contactEmail) ? `mailto:${contactEmail}?subject=${encodeURIComponent("Cookpool privacy and terms")}` : null;
}

/** "Write to us": a mail to the console's contact address, nothing about the person in it. */
export function writeToUsHref(contactEmail: string): string {
  return `mailto:${contactEmail}?subject=${encodeURIComponent("Can't sign in to Cookpool")}`;
}
