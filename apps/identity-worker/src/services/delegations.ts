// Delegated tokens for assistants (cookpool-mcp MC-2, design §1).
//
// A delegation is minted by a person signed in with a session, for one MCP
// client and the scopes they allowed. Its token, `sps_dlg_<id>.<secret>`, is
// shown once; only the SHA-256 of the secret is stored. It resolves as that
// person plus the delegation (id, scopes, client name) — api-edge enforces the
// scopes — until it is revoked or its 90 days are up. The MCP server refreshes
// it over the internal route, which rotates the secret and restarts the 90 days.

import type { DelegationsRepository, Delegation as StoredDelegation, IdentityRepository, User } from "@saas/db/identity";
import {
  DELEGATION_CLIENT_ID_MAX,
  DELEGATION_CLIENT_NAME_MAX,
  DELEGATION_ERROR_REASONS,
  DELEGATION_LAST_USED_INTERVAL_SECONDS,
  DELEGATION_SCOPES,
  DELEGATION_TTL_DAYS,
  isDelegationScope,
  type Delegation,
  type DelegationActor,
  type DelegationScope,
} from "@saas/contracts/delegations";
import { hashSha256 } from "../crypto.js";
import {
  buildDelegationToken,
  delegationPublicId,
  generateDelegationId,
  generateSecurityEventId,
  generateTokenSecret,
  parseDelegationPublicId,
  parseDelegationToken,
  parseSessionToken,
} from "../ids.js";
import type { RequestContext } from "./auth.js";

const TTL_MS = DELEGATION_TTL_DAYS * 24 * 60 * 60 * 1000;
const LAST_USED_INTERVAL_MS = DELEGATION_LAST_USED_INTERVAL_SECONDS * 1000;
/** How many live delegations the list answers; far more than anyone connects. */
const LIST_LIMIT = 100;
/** Printable, no control characters. */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export interface DelegationServiceDeps {
  repo: IdentityRepository;
  delegations: DelegationsRepository;
  now: () => Date;
  ctx?: RequestContext;
}

export interface DelegationFailure {
  status: number;
  code: "unauthenticated" | "forbidden" | "not_found" | "validation_failed" | "precondition_failed" | "internal_error";
  message: string;
  details?: Record<string, unknown>;
}

export interface MintedDelegation {
  delegation: Delegation;
  token: string;
}

export function toDelegation(d: StoredDelegation): Delegation {
  return {
    id: delegationPublicId(d.id),
    scopes: canonicalScopes(d.scopes),
    clientName: d.clientName,
    clientId: d.clientId,
    createdAt: d.createdAt.toISOString(),
    expiresAt: d.expiresAt.toISOString(),
    lastUsedAt: d.lastUsedAt ? d.lastUsedAt.toISOString() : null,
  };
}

/** Known scopes only, once each, in DELEGATION_SCOPES order. A stored name this code does not know grants nothing. */
function canonicalScopes(raw: readonly unknown[]): DelegationScope[] {
  return DELEGATION_SCOPES.filter((s) => raw.includes(s));
}

export function isFailure<T>(value: T | DelegationFailure): value is DelegationFailure {
  return typeof value === "object" && value !== null && "status" in value && "code" in value;
}

/** The body of POST /v1/auth/delegations, checked; field errors when it is wrong. */
export function parseCreateDelegation(
  body: unknown,
):
  | { ok: true; value: { scopes: DelegationScope[]; clientName: string; clientId: string } }
  | { ok: false; fields: Record<string, string[]> } {
  const fields: Record<string, string[]> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, fields: { body: ["Must be a JSON object"] } };
  const b = body as Record<string, unknown>;

  let scopes: DelegationScope[] = [];
  if (!Array.isArray(b.scopes) || b.scopes.length === 0) {
    fields.scopes = ["Must be a non-empty array of scopes"];
  } else if (!b.scopes.every(isDelegationScope)) {
    fields.scopes = [`Every scope must be one of ${DELEGATION_SCOPES.join(", ")}`];
  } else {
    scopes = canonicalScopes(b.scopes);
  }

  const clientName = typeof b.clientName === "string" ? b.clientName.trim() : "";
  if (clientName.length < 1 || clientName.length > DELEGATION_CLIENT_NAME_MAX || CONTROL_RE.test(clientName)) {
    fields.clientName = [`Must be 1–${DELEGATION_CLIENT_NAME_MAX} characters`];
  }

  const clientId = typeof b.clientId === "string" ? b.clientId : "";
  if (clientId.length < 1 || clientId.length > DELEGATION_CLIENT_ID_MAX || CONTROL_RE.test(clientId) || /\s/.test(clientId)) {
    fields.clientId = [`Must be 1–${DELEGATION_CLIENT_ID_MAX} characters with no spaces`];
  }

  if (b.requestId !== undefined && (typeof b.requestId !== "string" || b.requestId.length > 128)) {
    fields.requestId = ["Must be a string of at most 128 characters"];
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { scopes, clientName, clientId } };
}

/**
 * Resolve a delegated token: the user and the delegation when it is live;
 * null when it is malformed, unknown, revoked or expired. Moves last_used_at
 * at most once an hour (best-effort: a failed write never fails the resolve).
 */
export async function resolveDelegatedToken(
  delegations: DelegationsRepository,
  token: string,
  now: Date,
): Promise<{ user: User; delegation: DelegationActor } | null> {
  const parsed = parseDelegationToken(token);
  if (!parsed) return null;
  const tokenHash = await hashSha256(parsed.secret);
  const found = await delegations.getWithUserByIdAndTokenHash(parsed.delegationId, tokenHash);
  if (!found.ok) return null;
  const { delegation, user } = found.value;
  if (delegation.revokedAt !== null) return null;
  if (delegation.expiresAt.getTime() <= now.getTime()) return null;
  const scopes = canonicalScopes(delegation.scopes);
  if (scopes.length === 0) return null;

  if (delegation.lastUsedAt === null || now.getTime() - delegation.lastUsedAt.getTime() >= LAST_USED_INTERVAL_MS) {
    await delegations.touch(delegation.id, now, new Date(now.getTime() - LAST_USED_INTERVAL_MS));
  }

  return {
    user,
    delegation: { id: delegationPublicId(delegation.id), scopes, clientName: delegation.clientName },
  };
}

export function createDelegationService(deps: DelegationServiceDeps) {
  const { repo, delegations, now, ctx } = deps;

  function event(eventType: string, userId: string, sessionId: string | null, metadata: Record<string, unknown>) {
    // Best-effort, like the session events: the write it records has happened.
    return repo.recordSecurityEvent({
      id: generateSecurityEventId(),
      eventType,
      outcome: "success",
      userId,
      sessionId,
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      occurredAt: now(),
      metadata,
    });
  }

  /** A signed-in session's user; a delegated token or an API key is refused. */
  async function sessionUser(token: string | null): Promise<{ userId: string; sessionId: string } | DelegationFailure> {
    if (!token) return { status: 401, code: "unauthenticated", message: "Missing or invalid Authorization header" };
    const parsed = parseSessionToken(token);
    if (!parsed) {
      return {
        status: 403,
        code: "forbidden",
        message: "Assistants are connected from a signed-in session",
        details: { reason: DELEGATION_ERROR_REASONS.SESSION_REQUIRED },
      };
    }
    const found = await repo.getSessionWithUserByTokenHash(await hashSha256(parsed.secret));
    if (!found.ok) return { status: 401, code: "unauthenticated", message: "Session not found" };
    const { session } = found.value;
    if (session.revokedAt !== null || session.expiresAt.getTime() <= now().getTime()) {
      return { status: 401, code: "unauthenticated", message: "Session has expired" };
    }
    return { userId: session.userId, sessionId: session.id };
  }

  async function mint(id: string): Promise<{ secret: string; tokenHash: string; token: string }> {
    const secret = generateTokenSecret();
    return { secret, tokenHash: await hashSha256(secret), token: buildDelegationToken(id, secret) };
  }

  return {
    async create(token: string | null, body: unknown): Promise<MintedDelegation | DelegationFailure> {
      const who = await sessionUser(token);
      if (isFailure(who)) return who;
      const input = parseCreateDelegation(body);
      if (!input.ok) {
        return { status: 422, code: "validation_failed", message: "Validation failed", details: { fields: input.fields } };
      }
      const valid = input.value;

      const id = generateDelegationId();
      const { tokenHash, token: raw } = await mint(id);
      const createdAt = now();
      const created = await delegations.create({
        id,
        userId: who.userId,
        clientName: valid.clientName,
        clientId: valid.clientId,
        scopes: valid.scopes,
        tokenHash,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + TTL_MS),
      });
      if (!created.ok) return { status: 500, code: "internal_error", message: "Failed to create delegation" };

      await event("delegation.created", who.userId, who.sessionId, {
        delegationId: delegationPublicId(id),
        clientName: valid.clientName,
        clientId: valid.clientId,
        scopes: valid.scopes,
      });
      return { delegation: toDelegation(created.value), token: raw };
    },

    async list(token: string | null): Promise<{ delegations: Delegation[] } | DelegationFailure> {
      const who = await sessionUser(token);
      if (isFailure(who)) return who;
      const found = await delegations.listLiveForUser(who.userId, now(), LIST_LIMIT);
      if (!found.ok) return { status: 500, code: "internal_error", message: "Failed to list delegations" };
      return { delegations: found.value.map(toDelegation) };
    },

    async revoke(token: string | null, publicId: string): Promise<{ id: string; revokedAt: string } | DelegationFailure> {
      const who = await sessionUser(token);
      if (isFailure(who)) return who;
      const notFound: DelegationFailure = { status: 404, code: "not_found", message: "Delegation not found" };
      const uuid = parseDelegationPublicId(publicId);
      if (!uuid) return notFound;
      const revokedAt = now();
      const revoked = await delegations.revoke(uuid.toLowerCase(), who.userId, revokedAt);
      if (!revoked.ok) {
        return revoked.error.kind === "not_found"
          ? notFound
          : { status: 500, code: "internal_error", message: "Failed to revoke delegation" };
      }
      const at = revoked.value.revokedAt ?? revokedAt;
      if (at.getTime() === revokedAt.getTime()) {
        await event("delegation.revoked", who.userId, who.sessionId, {
          delegationId: delegationPublicId(revoked.value.id),
          clientName: revoked.value.clientName,
        });
      }
      return { id: delegationPublicId(revoked.value.id), revokedAt: at.toISOString() };
    },

    /** Internal (mcp-worker): a new secret and 90 more days, while the delegation is live. */
    async refresh(publicId: unknown): Promise<MintedDelegation | DelegationFailure> {
      const uuid = typeof publicId === "string" ? parseDelegationPublicId(publicId) : null;
      if (!uuid) {
        return {
          status: 422,
          code: "validation_failed",
          message: "Validation failed",
          details: { fields: { delegationId: ["Must be a delegation id (dlg_…)"] } },
        };
      }
      const id = uuid.toLowerCase();
      const at = now();
      const { tokenHash, token: raw } = await mint(id);
      const rotated = await delegations.rotate(id, tokenHash, new Date(at.getTime() + TTL_MS), at);
      if (rotated.ok) {
        await event("delegation.refreshed", rotated.value.userId, null, { delegationId: delegationPublicId(id) });
        return { delegation: toDelegation(rotated.value), token: raw };
      }
      if (rotated.error.kind !== "not_found") {
        return { status: 500, code: "internal_error", message: "Failed to refresh delegation" };
      }
      // Say why: unknown, revoked or expired.
      const existing = await delegations.getById(id);
      if (!existing.ok) return { status: 404, code: "not_found", message: "Delegation not found" };
      const reason = existing.value.revokedAt !== null ? DELEGATION_ERROR_REASONS.REVOKED : DELEGATION_ERROR_REASONS.EXPIRED;
      return {
        status: 422,
        code: "precondition_failed",
        message: reason === "revoked" ? "Delegation has been revoked" : "Delegation has expired",
        details: { reason },
      };
    },
  };
}
