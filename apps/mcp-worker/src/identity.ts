// The person behind a connection, and their delegations (MC-2, design §1).
//
// The console completes a connection with the person's own session, which
// is checked through api-edge (GET /v1/auth/session, as any signed-in call);
// the delegation it names must be one of theirs, live, and for this client
// (GET /v1/auth/delegations). Refreshing a delegated token is identity's
// internal route, which api-edge never routes, so it goes over the direct
// IDENTITY_WORKER binding.

import type { Env } from "./env.js";
import { callEdge, parseEdgeResponse } from "./edge.js";

export const SESSION_TOKEN_PREFIX = "sps_ses_";
export const DELEGATED_TOKEN_PREFIX = "sps_dlg_";
export const DELEGATION_ID_PREFIX = "dlg_";

export type SessionCheck = { ok: true; userId: string } | { ok: false; status: 401 | 503 };

/** The signed-in person a session token belongs to, through api-edge. */
export async function sessionUser(env: Env, session: string, requestId: string): Promise<SessionCheck> {
  // Only a person's own session may consent or disconnect: never a delegated token or an API key.
  if (!session.startsWith(SESSION_TOKEN_PREFIX)) return { ok: false, status: 401 };
  const res = await callEdge<{ user?: { id?: unknown } }>(env, {
    method: "GET",
    path: "/v1/auth/session",
    bearer: session,
    requestId,
  });
  if (!res.ok) return { ok: false, status: res.status === 0 || res.status >= 500 ? 503 : 401 };
  const id = res.data?.user?.id;
  return typeof id === "string" && id.startsWith("usr_") ? { ok: true, userId: id } : { ok: false, status: 401 };
}

export interface DelegationRecord {
  id: string;
  clientId: string | null;
  clientName: string | null;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function scopesOf(value: unknown): string[] {
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = value.split(/[\s,]+/);
    }
  }
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string" && s !== "") : [];
}

/** One listed delegation, read leniently: MC-2 pins the fields, not every spelling of them. */
export function delegationOf(raw: unknown): DelegationRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = stringOrNull(r.id);
  if (!id) return null;
  return {
    id,
    clientId: stringOrNull(r.clientId ?? r.client_id),
    clientName: stringOrNull(r.clientName ?? r.client_name),
    scopes: scopesOf(r.scopes),
    expiresAt: stringOrNull(r.expiresAt ?? r.expires_at),
    revokedAt: stringOrNull(r.revokedAt ?? r.revoked_at),
  };
}

export type DelegationsList = { ok: true; delegations: DelegationRecord[] } | { ok: false; status: number };

/** The person's delegations (their session as the bearer). */
export async function listDelegations(env: Env, session: string, requestId: string): Promise<DelegationsList> {
  const res = await callEdge<unknown>(env, { method: "GET", path: "/v1/auth/delegations", bearer: session, requestId });
  if (!res.ok) return { ok: false, status: res.status };
  const data = res.data as { delegations?: unknown; items?: unknown } | unknown[] | null;
  const list = Array.isArray(data) ? data : Array.isArray(data?.delegations) ? data.delegations : Array.isArray(data?.items) ? data.items : [];
  return { ok: true, delegations: list.map(delegationOf).filter((d): d is DelegationRecord => d !== null) };
}

/** Revoke one of the person's delegations; true when identity revoked it (false when it was already gone). */
export async function revokeDelegation(env: Env, session: string, delegationId: string, requestId: string): Promise<boolean> {
  const res = await callEdge<unknown>(env, {
    method: "DELETE",
    path: `/v1/auth/delegations/${encodeURIComponent(delegationId)}`,
    bearer: session,
    requestId,
  });
  return res.ok;
}

/**
 * Does the token belong to the delegation? `sps_dlg_<id>.<secret>` carries
 * the delegation's id (design §1, as a session token carries its session's):
 * `dlg_<hex>` ↔ `sps_dlg_<hex>.…`.
 */
export function tokenMatchesDelegation(token: string, delegationId: string): boolean {
  if (!token.startsWith(DELEGATED_TOKEN_PREFIX) || !delegationId.startsWith(DELEGATION_ID_PREFIX)) return false;
  const rest = token.slice(DELEGATED_TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot < 1 || dot === rest.length - 1) return false;
  return rest.slice(0, dot) === delegationId.slice(DELEGATION_ID_PREFIX.length);
}

export type RefreshResult =
  | { kind: "rotated"; token: string; expiresAt: string | null }
  /** identity no longer knows it, or it was revoked: the grant can never work again. */
  | { kind: "gone" }
  | { kind: "unavailable" };

/**
 * Rotate a delegated token: identity's internal
 * POST /v1/internal/delegations/refresh { delegationId } (MC-2), with
 * `x-internal-actor: mcp-worker`. It answers `{ delegation, token }`, and the
 * old token stops working at once, so the caller must keep the new one.
 */
export async function refreshDelegation(env: Env, delegationId: string, requestId: string): Promise<RefreshResult> {
  if (!env.IDENTITY_WORKER) return { kind: "unavailable" };
  let response: Response;
  try {
    response = await env.IDENTITY_WORKER.fetch("https://identity.internal/v1/internal/delegations/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "x-internal-actor": "mcp-worker",
      },
      body: JSON.stringify({ delegationId }),
    });
  } catch {
    return { kind: "unavailable" };
  }
  const res = await parseEdgeResponse<{ token?: unknown; delegation?: { expiresAt?: unknown } }>(response);
  if (res.ok) {
    const token = res.data?.token;
    if (typeof token !== "string" || !token.startsWith(DELEGATED_TOKEN_PREFIX)) return { kind: "unavailable" };
    return { kind: "rotated", token, expiresAt: stringOrNull(res.data?.delegation?.expiresAt) };
  }
  // 404 (unknown), 422 precondition_failed (revoked or expired): it can never work again.
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return { kind: "gone" };
  return { kind: "unavailable" };
}
