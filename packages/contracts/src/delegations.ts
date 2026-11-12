// Delegated tokens for assistants (cookpool-mcp MC-2, design §1).
//
// A delegated token is the third bearer kind, beside sessions (`sps_ses_…`)
// and API keys: `sps_dlg_<id>.<secret>`, minted by identity-worker for an MCP
// client the person connected. It resolves as that person
// (`actorType: "user"`) plus the scopes they allowed, and api-edge refuses it
// every route its scopes do not allow (403 `forbidden`, `details.reason:
// "scope"`). It is never allowed auth or account routes, admin routes, or any
// write outside the allowlist.
//
// Routes (identity-worker, through api-edge; a signed-in session only — a
// delegated token or an API key gets 403 `forbidden` with `details.reason:
// "session_required"`):
//   POST   /v1/auth/delegations        CreateDelegationRequest → CreateDelegationResponse (201)
//   GET    /v1/auth/delegations        → DelegationsListResponse
//   PATCH  /v1/auth/delegations/{id}   UpdateDelegationRequest → UpdateDelegationResponse
//          (cookpool-spliteco SE-6: change what an assistant may do, within what was allowed at connect)
//   DELETE /v1/auth/delegations/{id}   → RevokeDelegationResponse
// Internal (service binding only; api-edge routes nothing under /v1/internal/):
//   POST   /v1/internal/delegations/refresh  RefreshDelegationRequest → RefreshDelegationResponse
//          the caller names itself in `x-internal-actor` (DELEGATION_INTERNAL_ACTORS).

/**
 * Every scope a delegation can carry, in the order they are stored and shown.
 * `money.write` (cookpool-spliteco SE-6, design §0.10) lets an assistant add,
 * edit, delete, restore and move Spliteco expenses (always from a draft the
 * person saw), comment and send reminders — never record a payment.
 */
export const DELEGATION_SCOPES = ["kitchen.read", "money.read", "timers.write", "suggest.write", "money.write"] as const;
export type DelegationScope = (typeof DELEGATION_SCOPES)[number];

export function isDelegationScope(value: unknown): value is DelegationScope {
  return typeof value === "string" && (DELEGATION_SCOPES as readonly string[]).includes(value);
}

/** The bearer prefix that marks a delegated token. */
export const DELEGATION_TOKEN_PREFIX = "sps_dlg_";
/** A delegation's public id prefix (`dlg_<32 hex>`). */
export const DELEGATION_ID_PREFIX = "dlg_";
/** A delegation lasts this long after it is minted, and again after each refresh. */
export const DELEGATION_TTL_DAYS = 90;
/** `lastUsedAt` moves at most once in this many seconds. */
export const DELEGATION_LAST_USED_INTERVAL_SECONDS = 60 * 60;
export const DELEGATION_CLIENT_NAME_MAX = 80;
export const DELEGATION_CLIENT_ID_MAX = 128;

/** The header an internal caller names itself in, and who may call refresh. */
export const DELEGATION_INTERNAL_ACTOR_HEADER = "x-internal-actor";
export const DELEGATION_INTERNAL_ACTORS = ["mcp-worker"] as const;
export type DelegationInternalActor = (typeof DELEGATION_INTERNAL_ACTORS)[number];

/**
 * Headers api-edge forwards to a worker for a delegated actor, and only for
 * one: their presence is what marks a delegated caller (MC-5 requires it on
 * POST /v1/kitchen/me/suggestions). Scopes are comma-separated.
 */
export const ACTOR_DELEGATION_ID_HEADER = "x-actor-delegation-id";
export const ACTOR_SCOPES_HEADER = "x-actor-scopes";
/**
 * The delegation's client name ("Claude"), as the person saw it on the
 * consent page (self-asserted by the client, at most 80 characters, encoded
 * with encodeURIComponent). Forwarded beside the id so a worker can say
 * "via Claude" (cookpool-spliteco SE-6).
 */
export const ACTOR_DELEGATION_CLIENT_HEADER = "x-actor-delegation-client";

/** `details.reason` values that ride on the pinned error codes. */
export const DELEGATION_ERROR_REASONS = {
  /** 403 `forbidden` at api-edge: the delegated token's scopes do not allow this method and path. */
  SCOPE: "scope",
  /** 403 `forbidden` at identity: the delegation routes need a signed-in session, not a delegated token or API key. */
  SESSION_REQUIRED: "session_required",
  /** 422 `precondition_failed` on refresh: the delegation was revoked. */
  REVOKED: "revoked",
  /** 422 `precondition_failed` on refresh: the delegation's 90 days are up. */
  EXPIRED: "expired",
} as const;

/** What a resolved delegated actor carries (on /v1/auth/resolve's `actor`). */
export interface DelegationActor {
  /** `dlg_…` */
  id: string;
  scopes: DelegationScope[];
  clientName: string;
}

export interface CreateDelegationRequest {
  /** At least one; duplicates are dropped and the rest stored in DELEGATION_SCOPES order. */
  scopes: DelegationScope[];
  /** What the person sees in Connected assistants, 1–DELEGATION_CLIENT_NAME_MAX after trimming. */
  clientName: string;
  /** The MCP client's id from dynamic client registration, 1–DELEGATION_CLIENT_ID_MAX. */
  clientId: string;
  /** Accepted and not stored: the MCP authorization request this delegation answers (design §1). */
  requestId?: string;
}

export interface Delegation {
  /** `dlg_…` */
  id: string;
  /** What it may do now. */
  scopes: DelegationScope[];
  /**
   * What the person allowed when they connected it: `scopes` can be narrowed
   * and widened again within these (PATCH), never beyond — the assistant's
   * own grant only ever carries these.
   */
  grantedScopes: DelegationScope[];
  clientName: string;
  clientId: string;
  createdAt: string;
  expiresAt: string;
  /** Null until the token is first used; moves at most hourly. */
  lastUsedAt: string | null;
}

export interface CreateDelegationResponse {
  delegation: Delegation;
  /** `sps_dlg_<id>.<secret>`, shown once. */
  token: string;
}

export interface DelegationsListResponse {
  /** The person's live delegations (not revoked, not expired), newest first. */
  delegations: Delegation[];
}

/** PATCH /v1/auth/delegations/{id}: what it may do from now on (within 30 s at the edge). */
export interface UpdateDelegationRequest {
  /** At least one, every one among the delegation's `grantedScopes`. */
  scopes: DelegationScope[];
}

export interface UpdateDelegationResponse {
  delegation: Delegation;
}

export interface RevokeDelegationResponse {
  id: string;
  /** When it was revoked; revoking again answers the same time. */
  revokedAt: string;
}

export interface RefreshDelegationRequest {
  /** `dlg_…` */
  delegationId: string;
}

export interface RefreshDelegationResponse {
  /** With the new `expiresAt`, DELEGATION_TTL_DAYS from now. */
  delegation: Delegation;
  /** The new token; the old one stops working at once. */
  token: string;
}
