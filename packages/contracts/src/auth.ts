// Auth contract types for the identity-worker API surface.

export interface LoginStartRequest {
  email: string;
}

export interface LoginCompleteRequest {
  challengeId: string;
  code: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  /**
   * Slug of the org the user last worked in — a cross-device default-landing
   * hint. Optional: only the profile/session read populates it.
   */
  lastOrgSlug?: string | null;
}

export interface LoginStartResponse {
  challengeId: string;
  expiresAt: string;
  delivery: {
    /**
     * `local_debug`: the code is in `code` and nothing was emailed — only for
     * an address whose domain is in identity-worker's DEBUG_DELIVERY_DOMAINS
     * (`*` locally and on dev, `cookpool.test` on stage, none on prod).
     * `email`: the code was sent to the address and is not in the response.
     */
    mode: "local_debug" | "email";
    emailHint: string;
    code?: string;
  };
}

// ── Limits on sign-in codes (Cookpool SI-2) ─────────────────────────

/** Tries a code allows: the 5th wrong one spends it, and the right code is refused after that. */
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
/** Codes one address can ask for (POST /v1/auth/login/start) within LOGIN_CODE_WINDOW_SECONDS. */
export const LOGIN_CODES_PER_WINDOW = 5;
/** The window the per-address count looks back over: 15 minutes. */
export const LOGIN_CODE_WINDOW_SECONDS = 15 * 60;

/**
 * ERROR_CODES are pinned; sign-in outcomes ride on an existing code with
 * `details.reason` set to one of these.
 *
 * POST /v1/auth/login/complete:
 * - a wrong code while tries are left: 404 `not_found` (as before) with
 *   `details.attemptsLeft` (4, 3, 2, 1) and no reason — {@link LoginCompleteWrongCodeDetails};
 * - 422 `precondition_failed` with a reason — {@link LoginCompleteRefusedDetails}.
 *   An unknown challenge stays a bare 404 `not_found`.
 *
 * POST /v1/auth/login/start:
 * - 429 `rate_limited` with `details.reason: "too_many_codes"` and
 *   `details.retryAfterSeconds`, plus a `Retry-After` header — {@link LoginStartRateLimitedDetails}.
 *   api-edge's own per-IP limit also answers 429 `rate_limited`, but with
 *   `details.scope` and no reason.
 */
export const AUTH_ERROR_REASONS = {
  /**
   * 422 `precondition_failed` on login/complete: the code has had
   * LOGIN_CODE_MAX_ATTEMPTS wrong tries (this one may have been the last), so
   * it is spent and even the right code is refused. `details.attemptsLeft: 0`.
   * Ask for a new code.
   */
  TOO_MANY_ATTEMPTS: "too_many_attempts",
  /** 422 `precondition_failed` on login/complete: the code's 10 minutes are up. Ask for a new code. */
  CODE_EXPIRED: "code_expired",
  /** 422 `precondition_failed` on login/complete: the code has already signed someone in. */
  CODE_USED: "code_used",
  /**
   * 429 `rate_limited` on login/start: this address has asked for
   * LOGIN_CODES_PER_WINDOW codes in the last LOGIN_CODE_WINDOW_SECONDS.
   * `details.retryAfterSeconds` is when the oldest of them leaves the window.
   */
  TOO_MANY_CODES: "too_many_codes",
} as const;

export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[keyof typeof AUTH_ERROR_REASONS];

/** `error.details` of a 404 `not_found` from login/complete when the code was wrong but tries are left. */
export interface LoginCompleteWrongCodeDetails {
  /** Tries this code has left: 4, 3, 2 or 1. */
  attemptsLeft: number;
}

/** `error.details` of a 422 `precondition_failed` from login/complete. */
export interface LoginCompleteRefusedDetails {
  reason: "too_many_attempts" | "code_expired" | "code_used";
  /** Present (always 0) with `too_many_attempts`. */
  attemptsLeft?: 0;
}

/** `error.details` of a 429 `rate_limited` from login/start. */
export interface LoginStartRateLimitedDetails {
  reason: "too_many_codes";
  /** Whole seconds (at least 1) until this address may ask for a code again. */
  retryAfterSeconds: number;
}

export interface LoginCompleteResponse {
  token: string;
  tokenType: "bearer";
  expiresAt: string;
  user: AuthUser;
}

export interface SessionResponse {
  session: {
    id: string;
    expiresAt: string;
    createdAt: string;
  };
  user: AuthUser;
}

export interface LogoutResponse {
  success: true;
}

// Actor context returned by bearer resolution.
// Backward-compatible: user-session flows return actorType "user";
// API-key flows return actorType "service_principal".
export interface ActorContext {
  actorType: "user" | "service_principal";
  actorId: string;
  orgId?: string;
  projectId?: string | null;
  displayName?: string | null;
  email?: string | null;
}

// Extended session response with optional actor context.
// When `actor` is absent, the caller should infer actorType "user"
// from the existing `user` field for backward compatibility.
export interface BearerResolutionResponse {
  actor: ActorContext;
  session?: {
    id: string;
    expiresAt: string;
    createdAt: string;
  };
  user?: AuthUser;
}

// OAuth sign-in contracts.
//
// The `start` and `callback` routes are browser-redirect flows (not JSON
// endpoints), so they have no request/response body contract. The only JSON
// surface is the provider list, which lets the console render a sign-in button
// only for providers that are fully configured server-side.

export interface OAuthProviderInfo {
  /** Stable provider id used in the route path, e.g. "github". */
  id: string;
  /** Human-readable label for the sign-in button, e.g. "GitHub". */
  displayName: string;
}

export interface OAuthProvidersResponse {
  providers: OAuthProviderInfo[];
}

// Profile route contracts (self-scoped, user-session only)

export interface ProfileResponse {
  user: AuthUser;
}

export interface UpdateProfileRequest {
  /** Omit to leave unchanged (partial update). */
  displayName?: string | null;
  /** Omit to leave unchanged (partial update). */
  lastOrgSlug?: string | null;
}

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    cursor: string | null;
  };
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

// ── People by id (service-internal, Cookpool CP-9) ──────────────────
// POST /v1/internal/identity/users/lookup — for sibling workers over a service
// binding only (api-edge routes nothing under /v1/internal/). kitchen-worker
// names the people a group's members see. Ids that are malformed or unknown
// are left out of the answer; the caller decides what to show instead.

/** At most this many ids per lookup. */
export const USERS_LOOKUP_MAX = 100;

export interface UsersLookupRequest {
  /** Public user ids (`usr_…`), 1–USERS_LOOKUP_MAX; duplicates are read once. */
  subjectIds: string[];
}

export interface UserSummary {
  /** The id as it was asked for (`usr_…`). */
  subjectId: string;
  /** The name they set on their profile; null when they have not set one. */
  displayName: string | null;
  email: string;
}

export interface UsersLookupResponse {
  /** One per known id, in the order asked. */
  users: UserSummary[];
}
