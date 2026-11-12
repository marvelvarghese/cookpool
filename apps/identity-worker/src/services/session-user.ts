import type { IdentityRepository, User } from "@saas/db/identity";
import type { ErrorCode } from "@saas/contracts/errors";
import { hashSha256 } from "../crypto.js";
import { parseSessionToken } from "../ids.js";

/** A refusal a service hands its handler: the status, a pinned code, and details. */
export interface ServiceFailure {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function isServiceFailure<T>(value: T | ServiceFailure): value is ServiceFailure {
  return typeof value === "object" && value !== null && "status" in value && "code" in value;
}

/** `details.reason` when a route needs a signed-in session and got a delegated token or an API key. */
export const SESSION_REQUIRED_REASON = "session_required";

/**
 * A signed-in session's user. A delegated token or an API key is refused with
 * 403 `forbidden` (reason `session_required`, `refusedMessage`); no token, an
 * unknown one, or a revoked or expired session is 401 `unauthenticated`.
 * Shared by the delegation routes (MC-2) and the passkey routes (PK-2).
 */
export async function requireSessionUser(
  repo: IdentityRepository,
  token: string | null,
  now: Date,
  refusedMessage: string,
): Promise<{ userId: string; sessionId: string; user: User } | ServiceFailure> {
  if (!token) return { status: 401, code: "unauthenticated", message: "Missing or invalid Authorization header" };
  const parsed = parseSessionToken(token);
  if (!parsed) {
    return { status: 403, code: "forbidden", message: refusedMessage, details: { reason: SESSION_REQUIRED_REASON } };
  }
  const found = await repo.getSessionWithUserByTokenHash(await hashSha256(parsed.secret));
  if (!found.ok) return { status: 401, code: "unauthenticated", message: "Session not found" };
  const { session, user } = found.value;
  if (session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) {
    return { status: 401, code: "unauthenticated", message: "Session has expired" };
  }
  return { userId: session.userId, sessionId: session.id, user };
}
