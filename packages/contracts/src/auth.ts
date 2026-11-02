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
    mode: "local_debug" | "email";
    emailHint: string;
    code?: string;
  };
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
