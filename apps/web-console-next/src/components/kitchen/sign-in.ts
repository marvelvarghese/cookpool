/**
 * The sign-in page's model (Cookpool SI-5): the two steps (an email, then a
 * 6-digit code), the message for every answer the sign-in API can give, the
 * "Send a new code" countdown, the join-link card, where sign-in returns to,
 * and which developer aids an environment may show. Pure (types and constants
 * only) so it is unit-testable; `app/login/page.tsx` wires it to the API.
 *
 * SI-6 adds the Name step after sign-in, for a profile with no name, and the
 * first-run checks that lead to it (after a code, after Google, and the
 * kitchen's once-only ask for people who signed in before it existed).
 *
 * The API answers are SI-2's, as built (`@saas/contracts/auth`):
 * - login/complete, wrong code with tries left: 404 `not_found` with
 *   `details.attemptsLeft` 4…1;
 * - login/complete, the code is spent (`too_many_attempts`), out of time
 *   (`code_expired`) or already used (`code_used`): 422 `precondition_failed`
 *   with that reason. An unknown challenge is a bare 404;
 * - login/start, this address has had 5 codes in 15 minutes: 429
 *   `rate_limited`, `reason: "too_many_codes"`, `retryAfterSeconds`. The
 *   edge's own per-IP limit is a 429 too, with `details.scope` and no reason.
 */

import { AUTH_ERROR_REASONS, type LoginStartResponse } from "@saas/contracts/auth";
import type { JoinPreviewPublic } from "@saas/contracts/membership";
import { nameStepPath, postLoginDestination, safeNextPath } from "@/lib/safe-next";
import { DISPLAY_NAME_MAX } from "@/components/account/profile";
import { normalizeJoinCode } from "./join-code";
import { nameInitials } from "./members";

// ── Copy ───────────────────────────────────────────────────────────

export const DEFAULT_HEADLINE = "Cook together. Pay for what you use.";
export const START_SUBTITLE = "Sign in, or make your account. It's the same step.";
/** The form's title beside the desktop panel, which carries the pitch. */
export const DESKTOP_TITLE = "Sign in";
export const DESKTOP_SUBTITLE = "New here? The same step makes your account.";
export const SIGNED_OUT_NOTICE = "You were signed out. Sign in to carry on.";
export const CODE_REPLACED_NOTICE = "That code has expired. We've sent a new one.";
export const INVALID_EMAIL_NOTICE = "Enter your email address, like you@example.com.";
export const INVALID_CODE_NOTICE = "Enter the 6-digit code from the email.";
export const NETWORK_NOTICE = "Couldn't reach Cookpool. Check your connection and try again.";
export const GENERIC_NOTICE = "Something went wrong. Try again in a moment.";
/** The Terms line. There are no /terms or /privacy pages yet, so it names them without links. */
export const TERMS_SENTENCE = "By continuing you agree to the Terms and the Privacy notice.";

/**
 * The line under "Email me a code" on a phone. "The same buttons" only reads
 * right when Google is there too; alone, the code form is the one step.
 */
export function termsLine(withGoogle: boolean): string {
  return withGoogle ? `New to Cookpool? The same buttons make your account. ${TERMS_SENTENCE}` : TERMS_SENTENCE;
}

// ── Limits the page shows ──────────────────────────────────────────

/** Digits in a sign-in code. */
export const CODE_LENGTH = 6;
/** How long a code works, as the page says it ("It works for 10 minutes"). */
export const CODE_LIFETIME_MINUTES = 10;
/** "Send a new code" rests this long after any send. */
export const RESEND_COOLDOWN_SECONDS = 60;

// ── The code field ─────────────────────────────────────────────────

/** What the code field keeps of what was typed or pasted: digits, at most six ("246 810" → "246810"). */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D+/g, "").slice(0, CODE_LENGTH);
}

export function isCodeComplete(code: string): boolean {
  return code.length === CODE_LENGTH && /^\d+$/.test(code);
}

/** A plausible address: something@something.tld, no spaces. The server has the last word. */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

// ── Messages from the API's answers ────────────────────────────────

/** What `wrap()` hands back for a refused call (`ApiErrorBody`, with the HTTP status beside it). */
export interface ApiRefusal {
  code: string;
  reason?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface SignInNotice {
  /** `error` is an alert (red); `info` is a status line (amber). */
  tone: "error" | "info";
  text: string;
}

/** Whole minutes to wait, rounded up, never less than one. */
export function minutesToWait(retryAfterSeconds: number): number {
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) return 1;
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}

/** "That code didn't match. 4 more tries, then we'll send you a new one." */
export function wrongCodeMessage(attemptsLeft: number): string {
  const n = Math.max(1, Math.floor(attemptsLeft));
  return `That code didn't match. ${n} more ${n === 1 ? "try" : "tries"}, then we'll send you a new one.`;
}

/** "Too many codes for this address. Try again in 13 minutes." */
export function rateLimitedMessage(retryAfterSeconds: number): string {
  const m = minutesToWait(retryAfterSeconds);
  return `Too many codes for this address. Try again in ${m} ${m === 1 ? "minute" : "minutes"}.`;
}

/** The edge's per-IP limit (many sign-ins from one network): usually seconds, not minutes. */
export function tooManyTriesMessage(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return "Too many tries from here. Wait a moment and try again.";
  }
  if (retryAfterSeconds < 60) {
    const s = Math.ceil(retryAfterSeconds);
    return `Too many tries from here. Try again in ${s} ${s === 1 ? "second" : "seconds"}.`;
  }
  const m = minutesToWait(retryAfterSeconds);
  return `Too many tries from here. Try again in ${m} ${m === 1 ? "minute" : "minutes"}.`;
}

function detail(refusal: ApiRefusal, key: string): unknown {
  return refusal.details?.[key];
}

function reasonOf(refusal: ApiRefusal): string | undefined {
  const fromDetails = detail(refusal, "reason");
  return typeof fromDetails === "string" ? fromDetails : refusal.reason;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** A refusal the page shows as is, and how long "Send a new code" should rest because of it. */
export interface Refused {
  notice: SignInNotice;
  retryAfterSeconds: number | null;
}

function rateLimited(refusal: ApiRefusal): Refused {
  const retryAfterSeconds = positiveNumber(detail(refusal, "retryAfterSeconds"));
  const text =
    reasonOf(refusal) === AUTH_ERROR_REASONS.TOO_MANY_CODES
      ? rateLimitedMessage(retryAfterSeconds ?? 60)
      : tooManyTriesMessage(retryAfterSeconds);
  return { notice: { tone: "error", text }, retryAfterSeconds };
}

/** Why `POST /v1/auth/login/start` did not send a code, in the page's words. */
export function startRefusal(refusal: ApiRefusal, status: number): Refused {
  if (status === 429 || refusal.code === "rate_limited") return rateLimited(refusal);
  if (status === 400 || refusal.code === "validation_failed" || refusal.code === "bad_request") {
    return { notice: { tone: "error", text: INVALID_EMAIL_NOTICE }, retryAfterSeconds: null };
  }
  if (status === 0 || refusal.code === "network_error") {
    return { notice: { tone: "error", text: NETWORK_NOTICE }, retryAfterSeconds: null };
  }
  return { notice: { tone: "error", text: GENERIC_NOTICE }, retryAfterSeconds: null };
}

/**
 * What to do after `POST /v1/auth/login/complete` refused a code:
 * - `wrong`: tries are left; say how many and keep the code on screen;
 * - `new_code`: the code can never work now (spent, expired, used, or its
 *   challenge is unknown); send a new one at once and say so;
 * - `refused`: show the message (rate limits, a bad request, the network).
 */
export type CompleteOutcome =
  | { kind: "wrong"; attemptsLeft: number; notice: SignInNotice }
  | { kind: "new_code" }
  | ({ kind: "refused" } & Refused);

export function completeOutcome(refusal: ApiRefusal, status: number): CompleteOutcome {
  if (status === 404 || refusal.code === "not_found") {
    const left = positiveNumber(detail(refusal, "attemptsLeft"));
    if (left !== null) {
      return { kind: "wrong", attemptsLeft: left, notice: { tone: "error", text: wrongCodeMessage(left) } };
    }
    // A bare 404 names no challenge we can still use.
    return { kind: "new_code" };
  }
  if (status === 422 || refusal.code === "precondition_failed") {
    // too_many_attempts, code_expired, code_used — and any reason added later:
    // a 422 from login/complete always means this code is finished.
    return { kind: "new_code" };
  }
  if (status === 429 || refusal.code === "rate_limited") return { kind: "refused", ...rateLimited(refusal) };
  if (status === 400 || refusal.code === "validation_failed" || refusal.code === "bad_request") {
    return { kind: "refused", notice: { tone: "error", text: INVALID_CODE_NOTICE }, retryAfterSeconds: null };
  }
  if (status === 0 || refusal.code === "network_error") {
    return { kind: "refused", notice: { tone: "error", text: NETWORK_NOTICE }, retryAfterSeconds: null };
  }
  return { kind: "refused", notice: { tone: "error", text: GENERIC_NOTICE }, retryAfterSeconds: null };
}

/**
 * The automatic new code (after `new_code`) was refused too — most likely the
 * address's 15-minute limit. Say both: the old code is finished, and why
 * there is no new one.
 */
export function replacementRefusedNotice(refused: Refused): SignInNotice {
  return { tone: "error", text: `That code has expired. ${refused.notice.text}` };
}

// ── The Name step (SI-6, design §7) ────────────────────────────────

export const NAME_EYEBROW = "Welcome to Cookpool";
export const NAME_TITLE = "What should your groups call you?";
export const NAME_LABEL = "Your name";
export const NAME_FOOTNOTE = "You can change it any time under You.";
/** "Do this later": offered once saving has failed, so the step can never trap anyone. */
export const NAME_LATER = "Do this later";
export const NAME_SAVE_FAILED_NOTICE = "Couldn't save your name. Try again, or do this later under You.";
/** The longest name the app asks for (the admin console's limit; identity-worker allows 120). */
export const NAME_MAX = DISPLAY_NAME_MAX;
export const NAME_INVALID_NOTICE = `That name can't be used. Keep it under ${NAME_MAX} characters.`;

/** A name as it will be saved: trimmed, runs of spaces made one, at most NAME_MAX characters. */
export function cleanDisplayName(raw: string | null | undefined): string {
  return [...(raw ?? "").replace(/\s+/g, " ").trim()].slice(0, NAME_MAX).join("").trim();
}

/**
 * The Name step's first guess, from the part of the email before the @
 * (design §7): a `+tag` dropped, dots and underscores read as spaces, each
 * word capitalised — "rahul.varghese+food@gmail.com" → "Rahul Varghese",
 * "anu@example.com" → "Anu". Nothing is saved until the person presses
 * Continue.
 */
export function namePrefill(email: string | null | undefined): string {
  const local = (email ?? "").trim().split("@")[0] ?? "";
  const base = local.split("+")[0] ?? "";
  const words = base
    .split(/[._\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1));
  return cleanDisplayName(words.join(" "));
}

/** The avatar beside the field, live as the person types: "Rahul Varghese" → "RV", "" → "?". */
export function liveInitials(draft: string): string {
  return nameInitials(cleanDisplayName(draft));
}

/** `It shows next to what you buy, use and cook, like "Rahul paid ₹60.00".` */
export function nameExample(draft: string): string {
  const first = cleanDisplayName(draft).split(" ")[0] || "You";
  return `It shows next to what you buy, use and cook, like "${first} paid ₹60.00".`;
}

/** "Continue", or "Join Flat 4B" when sign-in came from a join link whose group was found. */
export function nameStepAction(preview: JoinPreviewPublic | null): string {
  return preview ? `Join ${preview.groupName}` : "Continue";
}

/** Whether a profile still needs a name: no `displayName`, or only spaces. */
export function needsName(user: { displayName?: string | null } | null | undefined): boolean {
  return !!user && cleanDisplayName(user.displayName) === "";
}

/** A profile read (`GET /v1/auth/profile`) as the first-run checks see it. */
export type ProfileRead =
  | { ok: true; user: { id: string; email: string; displayName: string | null } }
  | { ok: false; status: number };

/**
 * After Google's callback has the token: the Name step when the profile has
 * no name, else `next`. Google normally brings a name, but a Google sign-in
 * linked to an account first made by code keeps that account's (empty) name,
 * so it is read, not assumed. A read that fails goes on to `next`: never a
 * trap.
 */
export function afterOAuthPath(read: ProfileRead, rawNext: string | null | undefined): string {
  return read.ok && needsName(read.user) ? nameStepPath(rawNext) : postLoginDestination(rawNext);
}

/** What `/login?step=name` does once it has read the profile. */
export type NameCheck =
  | { kind: "ask"; userId: string; email: string }
  /** Named already, or the read failed: go on to `next` — the step never traps. */
  | { kind: "go" }
  /** The token is no longer accepted: sign in again. */
  | { kind: "signed_out" };

export function nameCheck(read: ProfileRead): NameCheck {
  if (read.ok) return needsName(read.user) ? { kind: "ask", userId: read.user.id, email: read.user.email } : { kind: "go" };
  return read.status === 401 ? { kind: "signed_out" } : { kind: "go" };
}

/**
 * The kitchen's once-only ask, for someone who signed in before the Name step
 * existed: where to send them, or null. Only a profile that was read and has
 * no name, and only if this device has not asked this person yet
 * (`askedFor`, which the caller sets before redirecting) — so a failed read,
 * a skip, or a Name step that cannot read the profile never brings them
 * back here.
 */
export function firstRunRedirect(read: ProfileRead | null, askedFor: string | null, here: string): string | null {
  if (!read || !read.ok || !needsName(read.user)) return null;
  if (askedFor === read.user.id) return null;
  return nameStepPath(here);
}

/** Why `PATCH /v1/auth/profile` did not save, in the page's words. */
export type SaveNameOutcome = { kind: "signed_out" } | { kind: "refused"; notice: SignInNotice };

export function saveNameOutcome(refusal: ApiRefusal, status: number): SaveNameOutcome {
  if (status === 401 || refusal.code === "unauthenticated") return { kind: "signed_out" };
  if (status === 400 || refusal.code === "validation_failed") {
    return { kind: "refused", notice: { tone: "error", text: NAME_INVALID_NOTICE } };
  }
  if (status === 0 || refusal.code === "network_error") return { kind: "refused", notice: { tone: "error", text: NETWORK_NOTICE } };
  return { kind: "refused", notice: { tone: "error", text: NAME_SAVE_FAILED_NOTICE } };
}

// ── The step machine ───────────────────────────────────────────────

export interface SignInState {
  /** `name` (SI-6): signed in, choosing the name their groups see. */
  step: "start" | "code" | "name";
  /** The address typed; on the code step, where the code went. */
  email: string;
  /** The challenge the code answers. Null once it can never be answered. */
  challengeId: string | null;
  /** The digits typed so far. */
  code: string;
  /** The code the server just refused: Sign in stays off until it changes. */
  rejectedCode: string | null;
  /** A code shown on screen for testing (see {@link testCodeFor}). */
  testCode: string | null;
  notice: SignInNotice | null;
  /** When "Send a new code" comes back (ms since epoch). */
  resendAt: number;
  /** A new code was sent from the code step, so the countdown says so. */
  resent: boolean;
  /** The Name step's field (SI-6). */
  name: string;
  /** Saving the name failed at least once, so "Do this later" is offered. */
  nameSaveFailed: boolean;
  busy: "send" | "verify" | "save" | null;
}

export const INITIAL_SIGN_IN: SignInState = {
  step: "start",
  email: "",
  challengeId: null,
  code: "",
  rejectedCode: null,
  testCode: null,
  notice: null,
  resendAt: 0,
  resent: false,
  name: "",
  nameSaveFailed: false,
  busy: null,
};

export type SignInEvent =
  | { type: "email"; value: string }
  | { type: "code"; value: string }
  | { type: "busy"; busy: "send" | "verify" | "save" }
  /**
   * Signed in, and the profile has no name (SI-6): the Name step, prefilled
   * from `email` unless a `name` is given. Nothing of the code is kept.
   */
  | { type: "ask_name"; email: string; name?: string }
  /** The Name step's field. */
  | { type: "name"; value: string }
  /** The name was not saved; say why and offer "Do this later". */
  | { type: "name_refused"; notice: SignInNotice }
  /** A code went out: the first one, a requested one, or the automatic replacement. */
  | {
      type: "sent";
      email: string;
      challengeId: string;
      testCode: string | null;
      at: number;
      resent: boolean;
      notice?: SignInNotice | null;
    }
  /** Something was refused. `challengeGone` when the code on screen can never work now. */
  | { type: "refused"; refused: Refused; at: number; challengeGone?: boolean; notice?: SignInNotice }
  | { type: "wrong"; code: string; notice: SignInNotice }
  /** "Use a different email". */
  | { type: "back" };

export function signInReducer(state: SignInState, event: SignInEvent): SignInState {
  switch (event.type) {
    case "email":
      return { ...state, email: event.value, notice: null };
    case "code": {
      const code = sanitizeCode(event.value);
      if (code === state.code) return state;
      // Editing the code clears what was said about the last one.
      return { ...state, code, notice: null };
    }
    case "busy":
      return {
        ...state,
        busy: event.busy,
        notice: (event.busy === "send" && state.step === "start") || event.busy === "save" ? null : state.notice,
      };
    case "sent":
      return {
        ...state,
        step: "code",
        email: event.email,
        challengeId: event.challengeId,
        code: "",
        rejectedCode: null,
        testCode: event.testCode,
        notice: event.notice ?? null,
        resendAt: event.at + RESEND_COOLDOWN_SECONDS * 1000,
        resent: event.resent,
        busy: null,
      };
    case "refused": {
      const waitUntil = event.refused.retryAfterSeconds ? event.at + event.refused.retryAfterSeconds * 1000 : 0;
      return {
        ...state,
        notice: event.notice ?? event.refused.notice,
        resendAt: Math.max(state.resendAt, waitUntil),
        // The last thing that happened was a refusal, not a send.
        resent: false,
        busy: null,
        ...(event.challengeGone ? { challengeId: null, code: "", rejectedCode: null, testCode: null } : {}),
      };
    }
    case "wrong":
      return { ...state, rejectedCode: event.code, notice: event.notice, busy: null };
    case "back":
      return { ...INITIAL_SIGN_IN, email: state.email };
    case "ask_name":
      return {
        ...INITIAL_SIGN_IN,
        step: "name",
        email: event.email,
        name: event.name !== undefined ? cleanDisplayName(event.name) : namePrefill(event.email),
      };
    case "name":
      return { ...state, name: [...event.value].slice(0, NAME_MAX).join(""), notice: null };
    case "name_refused":
      return { ...state, notice: event.notice, nameSaveFailed: true, busy: null };
  }
}

/** Whether Continue (or "Join Flat 4B") can save now: a name to save, and nothing in flight. */
export function canSaveName(state: SignInState): boolean {
  return state.step === "name" && state.busy === null && cleanDisplayName(state.name) !== "";
}

/** Whether "Sign in" works now (and whether a full code may submit itself). */
export function canVerify(state: SignInState): boolean {
  return (
    state.step === "code" &&
    state.challengeId !== null &&
    state.busy === null &&
    isCodeComplete(state.code) &&
    state.code !== state.rejectedCode
  );
}

/** "0:59", "12:05". */
export function countdownText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface ResendControl {
  label: string;
  disabled: boolean;
  secondsLeft: number;
}

/**
 * "Send a new code": resting for a minute after any send (longer when the
 * address's limit says so), with the countdown in its label.
 */
export function resendControl(state: SignInState, now: number): ResendControl {
  const secondsLeft = Math.max(0, Math.ceil((state.resendAt - now) / 1000));
  if (state.busy === "send") return { label: "Sending a new code…", disabled: true, secondsLeft };
  if (secondsLeft <= 0) return { label: "Send a new code", disabled: state.busy !== null, secondsLeft: 0 };
  const wait = countdownText(secondsLeft);
  return {
    label: state.resent ? `New code sent. Send again in ${wait}` : `Send a new code in ${wait}`,
    disabled: true,
    secondsLeft,
  };
}

// ── Environments: developer aids and test codes ────────────────────

/**
 * Where this console is running, for the sign-in page's developer aids. The
 * console has one build for every environment (saas-console-artifact CA1/CA2):
 * it learns the environment at runtime from `CONSOLE_DEPLOY_ENV` (or the
 * build's `NEXT_PUBLIC_DEPLOY_ENV`), else from its workers.dev host
 * (`…-stage.…`, `…-prod.…`) — that is `appConfig().deployEnv`. With none of
 * those, a local development host (localhost, 127.0.0.1, [::1], *.localhost)
 * is `local` and a `…-dev.<subdomain>.workers.dev` host is `dev`. Anything
 * else — a custom domain without `CONSOLE_DEPLOY_ENV`, an unknown value — is
 * treated as `prod`, so the aids fail closed.
 */
export type SignInEnvironment = "local" | "dev" | "stage" | "prod";

export function isLocalHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
}

const DEV_WORKERS_HOST = /^[a-z0-9-]+-dev\.[a-z0-9-]+\.workers\.dev$/;

export function signInEnvironment(deployEnv: string | null | undefined, hostname: string): SignInEnvironment {
  const env = (deployEnv ?? "").trim().toLowerCase();
  if (env === "stage" || env === "dev" || env === "local" || env === "prod") return env;
  if (env !== "") return "prod";
  if (isLocalHostname(hostname)) return "local";
  if (DEV_WORKERS_HOST.test(hostname.trim().toLowerCase())) return "dev";
  return "prod";
}

/** The Bearer-token form and the API target picker: local and dev only, never stage or prod. */
export function showsDeveloperSignIn(env: SignInEnvironment): boolean {
  return env === "local" || env === "dev";
}

/**
 * The "Test code: 123456" line, or null. Only when identity-worker put a
 * code in the answer (`delivery.mode: "local_debug"`): locally, on dev and on
 * stage, where its DEBUG_DELIVERY_DOMAINS decides which addresses get one
 * (every address since SI-9, because stage sends no email); never on prod,
 * whatever the server says.
 */
export function testCodeFor(
  env: SignInEnvironment,
  delivery: Pick<LoginStartResponse["delivery"], "mode" | "code">,
): string | null {
  if (env === "prod") return null;
  if (delivery.mode !== "local_debug" || typeof delivery.code !== "string" || delivery.code === "") return null;
  return delivery.code;
}

// ── Where sign-in goes, and the join link ──────────────────────────

/**
 * The join code when `next` is a join link (`/join/{code}`), else null. Only
 * a same-origin path counts (`safeNextPath`), and only the join page itself —
 * not `/groups/join/…` or anything else with "join" in it.
 */
export function joinCodeFromNext(rawNext: string | null | undefined): string | null {
  const next = safeNextPath(rawNext);
  if (!next) return null;
  const pathname = next.split(/[?#]/, 1)[0] ?? "";
  const match = /^\/join\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let segment = match[1] ?? "";
  try {
    segment = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return normalizeJoinCode(segment);
}

/**
 * Google's `returnTo`: this console's `/auth/callback`, carrying a safe `next`
 * so the callback can return there even if the tab's storage did not survive
 * the round trip. identity-worker checks only the origin.
 */
export function oauthReturnTo(origin: string, rawNext: string | null | undefined): string {
  const base = `${origin.replace(/\/+$/, "")}/auth/callback`;
  const next = safeNextPath(rawNext);
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/** Cookpool offers Google only (GitHub stays wired for the admin console but is not offered, design §2). */
export function offersGoogle(providers: readonly { id: string }[] | null | undefined): boolean {
  return (providers ?? []).some((p) => p.id === "google");
}

export interface JoinCard {
  groupName: string;
  /** "Sign in to join Flat 4B"; on the Name step (SI-6) "You're joining Flat 4B". */
  title: string;
  /** "Anu invited you · 5 people are in", or null when there is nothing to say. */
  subtitle: string | null;
}

/**
 * The group card a join link shows above the form, from SI-4's signed-out
 * preview. `joining` (SI-6): the person has signed in and is on the Name
 * step, on their way into the group.
 */
export function joinCard(preview: JoinPreviewPublic, opts: { joining?: boolean } = {}): JoinCard {
  const parts: string[] = [];
  const inviter = preview.inviterFirstName?.trim();
  if (inviter) parts.push(`${inviter} invited you`);
  const n = Math.floor(preview.memberCount);
  if (n === 1) parts.push("1 person is in");
  else if (n > 1) parts.push(`${n} people are in`);
  return {
    groupName: preview.groupName,
    title: opts.joining ? `You're joining ${preview.groupName}` : `Sign in to join ${preview.groupName}`,
    subtitle: parts.length > 0 ? parts.join(" · ") : null,
  };
}

/**
 * The page's headline: the pitch, or — from a join link whose group was
 * found — who you are joining ("Sign in to join Anu and the others").
 */
export function startHeadline(preview: JoinPreviewPublic | null): string {
  if (!preview) return DEFAULT_HEADLINE;
  const inviter = preview.inviterFirstName?.trim();
  if (!inviter) return `Sign in to join ${preview.groupName}`;
  const others = Math.floor(preview.memberCount) - 1;
  if (others <= 0) return `Sign in to join ${inviter}`;
  if (others === 1) return `Sign in to join ${inviter} and one other`;
  return `Sign in to join ${inviter} and the others`;
}

/** The form's title beside the desktop panel: "Sign in", or the join headline. */
export function desktopTitle(preview: JoinPreviewPublic | null): string {
  return preview ? startHeadline(preview) : DESKTOP_TITLE;
}
