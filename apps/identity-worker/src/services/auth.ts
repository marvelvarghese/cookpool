import type { DelegationsRepository, IdentityRepository, IdentityResult, User } from "@saas/db/identity";
import type { DelegationActor } from "@saas/contracts/delegations";
import { resolveDelegatedToken } from "./delegations.js";
import {
  AUTH_ERROR_REASONS,
  LOGIN_CODES_PER_WINDOW,
  LOGIN_CODE_WINDOW_SECONDS,
} from "@saas/contracts/auth";
import { hashSha256 } from "../crypto.js";
import {
  generateUserId,
  generateSessionId,
  generateChallengeId,
  generateAuthIdentityId,
  generateSecurityEventId,
  generateCode,
  generateTokenSecret,
  buildSessionToken,
  parseSessionToken,
  userPublicId,
  sessionPublicId,
  challengePublicId,
  parseChallengePublicId,
  parseUserPublicId,
} from "../ids.js";

export interface RequestContext {
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthServiceDeps {
  repo: IdentityRepository;
  now: () => Date;
  ctx?: RequestContext;
  /**
   * Delegated tokens (cookpool-mcp MC-2). Without it a `sps_dlg_` token
   * resolves as nothing — only /v1/auth/resolve needs to pass it.
   */
  delegations?: DelegationsRepository;
}

export interface StartLoginResult {
  challengeId: string;
  expiresAt: Date;
  emailHint: string;
  rawCode: string;
}

export type StartLoginError =
  | { error: "internal_error"; message: string }
  /** SI-2: this address already asked for LOGIN_CODES_PER_WINDOW codes in the window. */
  | { error: "rate_limited"; message: string; retryAfterSeconds: number };

export interface CompleteLoginResult {
  token: string;
  expiresAt: Date;
  user: { id: string; email: string; displayName: string | null };
}

export interface CompleteLoginError {
  error: "not_found" | "precondition_failed" | "internal_error";
  message: string;
  /**
   * SI-2: `{ attemptsLeft }` on a wrong code with tries left (`not_found`);
   * `{ reason, attemptsLeft? }` on `precondition_failed`.
   */
  details?: Record<string, unknown>;
}

export interface LoginWithOAuthInput {
  /** Provider id (e.g. "github"). */
  provider: string;
  /** Stable, provider-scoped subject id. */
  subject: string;
  /** Email reported by the provider, if any. */
  email: string | null;
  /** Whether the provider asserts the email is verified (gates account linking). */
  emailVerified: boolean;
  /** Display name reported by the provider, if any. */
  displayName: string | null;
}

export interface LoginWithOAuthResult {
  token: string;
  expiresAt: Date;
  user: { id: string; email: string; displayName: string | null };
}

export interface LoginWithOAuthError {
  error: "email_required" | "email_unverified" | "internal_error";
  message: string;
}

export interface GetSessionResult {
  session: { id: string; expiresAt: Date; createdAt: Date };
  user: { id: string; email: string; displayName: string | null; lastOrgSlug: string | null };
}

export interface GetSessionError {
  error: "unauthenticated";
  message: string;
}

export interface LogoutError {
  error: "unauthenticated" | "internal_error";
  message: string;
}

export interface ResolveBearerResult {
  actorType: "user" | "service_principal";
  actorId: string;
  orgId?: string;
  projectId?: string | null;
  displayName?: string | null;
  email?: string | null;
  session?: { id: string; expiresAt: Date; createdAt: Date };
  user?: { id: string; email: string; displayName: string | null };
  /** A delegated token's (MC-2): the user acts through an assistant, within these scopes. No session. */
  delegation?: DelegationActor;
}

export interface ResolveBearerError {
  error: "unauthenticated";
  message: string;
}

export interface UpdateProfileResult {
  user: { id: string; email: string; displayName: string | null; lastOrgSlug: string | null };
}

export interface UpdateProfileError {
  error: "unauthenticated" | "forbidden" | "validation_failed" | "internal_error";
  message: string;
  details?: Record<string, unknown>;
}

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** SI-2: at most LOGIN_CODES_PER_WINDOW codes per address in LOGIN_CODE_WINDOW_SECONDS. */
const CODE_REQUEST_LIMIT = { max: LOGIN_CODES_PER_WINDOW, windowMs: LOGIN_CODE_WINDOW_SECONDS * 1000 };

function emailHint(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***@***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

export function createAuthService(deps: AuthServiceDeps) {
  const { repo, now, ctx, delegations } = deps;

  function eventBase() {
    return {
      id: generateSecurityEventId(),
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      occurredAt: now(),
    };
  }

  /**
   * Mint a session for a user who has just proved who they are, and record
   * `session.created`: the one place every sign-in (email code, OAuth,
   * passkey) gets its token from.
   */
  async function issueSession(
    user: User,
    metadata: Record<string, unknown>,
    extra: { challengeId?: string } = {},
  ): Promise<CompleteLoginResult | { error: "internal_error"; message: string }> {
    const sessionUuid = generateSessionId();
    const secret = generateTokenSecret();
    const tokenHash = await hashSha256(secret);
    const currentTime = now();
    const expiresAt = new Date(currentTime.getTime() + SESSION_TTL_MS);

    const sessionResult = await repo.createSession({
      id: sessionUuid,
      userId: user.id,
      tokenHash,
      expiresAt,
      createdAt: currentTime,
    });
    if (!sessionResult.ok) {
      return { error: "internal_error", message: "Failed to create session" };
    }

    const eventResult = await repo.recordSecurityEvent({
      ...eventBase(),
      eventType: "session.created",
      outcome: "success",
      userId: user.id,
      sessionId: sessionUuid,
      ...(extra.challengeId ? { challengeId: extra.challengeId } : {}),
      metadata,
    });
    if (!eventResult.ok) {
      return { error: "internal_error", message: "Failed to record security event" };
    }

    return {
      token: buildSessionToken(sessionUuid, secret),
      expiresAt,
      user: { id: userPublicId(user.id), email: user.email, displayName: user.displayName },
    };
  }

  async function resolveOrCreateUser(email: string, emailLower: string): Promise<IdentityResult<User>> {
    const existing = await repo.getUserByEmail(emailLower);
    if (existing.ok) return existing;

    const userId = generateUserId();
    const createResult = await repo.createUser({
      id: userId,
      email,
      emailLower,
      createdAt: now(),
    });

    if (!createResult.ok && createResult.error.kind === "conflict") {
      return repo.getUserByEmail(emailLower);
    }

    if (createResult.ok) {
      await repo.createAuthIdentity({
        id: generateAuthIdentityId(),
        userId,
        provider: "email",
        subject: emailLower,
        createdAt: now(),
      });
    }

    return createResult;
  }

  async function getSession(token: string): Promise<GetSessionResult | GetSessionError> {
    const parsed = parseSessionToken(token);
    if (!parsed) {
      return { error: "unauthenticated", message: "Invalid token format" };
    }

    const tokenHash = await hashSha256(parsed.secret);
    // PERF12d: one JOIN (session + user) instead of two serial queries.
    const sessionResult = await repo.getSessionWithUserByTokenHash(tokenHash);

    if (!sessionResult.ok) {
      return { error: "unauthenticated", message: "Session not found" };
    }

    const { session, user } = sessionResult.value;
    if (session.revokedAt !== null) {
      return { error: "unauthenticated", message: "Session has been revoked" };
    }
    if (session.expiresAt.getTime() <= now().getTime()) {
      return { error: "unauthenticated", message: "Session has expired" };
    }

    return {
      session: { id: sessionPublicId(session.id), expiresAt: session.expiresAt, createdAt: session.createdAt },
      user: {
        id: userPublicId(user.id),
        email: user.email,
        displayName: user.displayName,
        lastOrgSlug: user.lastOrgSlug,
      },
    };
  }

  return {
    issueSession,

    async startLogin(email: string): Promise<StartLoginResult | StartLoginError> {
      const emailLower = email.trim().toLowerCase();
      const userResult = await resolveOrCreateUser(email.trim(), emailLower);
      if (!userResult.ok) {
        return { error: "internal_error", message: "Failed to resolve user" };
      }

      const code = generateCode();
      const codeHash = await hashSha256(code);
      const challengeUuid = generateChallengeId();
      const currentTime = now();
      const expiresAt = new Date(currentTime.getTime() + CHALLENGE_TTL_MS);

      // Counted per address (its user), in the statement that inserts: the
      // edge's per-IP bucket does not hold against requests spread over IPs.
      const challengeResult = await repo.createLoginChallenge({
        id: challengeUuid,
        userId: userResult.value.id,
        method: "email_code",
        codeHash,
        expiresAt,
        createdAt: currentTime,
        limit: CODE_REQUEST_LIMIT,
      });

      if (!challengeResult.ok) {
        if (challengeResult.error.kind === "rate_limited") {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((challengeResult.error.retryAt.getTime() - currentTime.getTime()) / 1000),
          );
          // Best effort: the refusal stands whether or not the event lands.
          await repo.recordSecurityEvent({
            ...eventBase(),
            eventType: "login.start.failed",
            outcome: "rate_limited",
            userId: userResult.value.id,
            metadata: { method: "email_code", retryAfterSeconds },
          });
          return {
            error: "rate_limited",
            message: "Too many codes for this address. Try again later.",
            retryAfterSeconds,
          };
        }
        return { error: "internal_error", message: "Failed to create login challenge" };
      }

      const eventResult = await repo.recordSecurityEvent({
        ...eventBase(),
        eventType: "login.challenge.created",
        outcome: "success",
        userId: userResult.value.id,
        challengeId: challengeUuid,
        metadata: { method: "email_code" },
      });

      if (!eventResult.ok) {
        return { error: "internal_error", message: "Failed to record security event" };
      }

      return {
        challengeId: challengePublicId(challengeUuid),
        expiresAt,
        emailHint: emailHint(emailLower),
        rawCode: code,
      };
    },

    async completeLogin(challengeId: string, code: string): Promise<CompleteLoginResult | CompleteLoginError> {
      const challengeUuid = parseChallengePublicId(challengeId);
      if (!challengeUuid) {
        await repo.recordSecurityEvent({
          ...eventBase(),
          eventType: "login.complete.failed",
          outcome: "invalid_challenge_format",
          metadata: { method: "email_code" },
        });
        return { error: "not_found", message: "Challenge not found or code is invalid" };
      }

      const codeHash = await hashSha256(code);
      const consumeResult = await repo.consumeLoginChallenge(challengeUuid, codeHash, now());

      if (!consumeResult.ok) {
        const failure = consumeResult.error;
        const outcomeMap: Record<string, string> = {
          not_found: "invalid_code_or_challenge",
          wrong_code: "invalid_code_or_challenge",
          too_many_attempts: "too_many_attempts",
          expired: "expired_challenge",
          already_consumed: "already_consumed",
        };
        await repo.recordSecurityEvent({
          ...eventBase(),
          eventType: "login.complete.failed",
          outcome: outcomeMap[failure.kind] ?? "internal_error",
          challengeId: challengeUuid,
          metadata:
            failure.kind === "wrong_code"
              ? { method: "email_code", attemptsLeft: failure.attemptsLeft }
              : { method: "email_code" },
        });

        switch (failure.kind) {
          case "not_found":
            return { error: "not_found", message: "Challenge not found or code is invalid" };
          case "wrong_code":
            // As before (not_found), plus how many tries the code has left.
            return {
              error: "not_found",
              message: "Challenge not found or code is invalid",
              details: { attemptsLeft: failure.attemptsLeft },
            };
          case "too_many_attempts":
            // Spent: this was the last wrong try, or none were left. Even the
            // right code is refused from here on; the app asks for a new one.
            return {
              error: "precondition_failed",
              message: "Too many wrong codes. Ask for a new code.",
              details: { reason: AUTH_ERROR_REASONS.TOO_MANY_ATTEMPTS, attemptsLeft: 0 },
            };
          case "expired":
            return {
              error: "precondition_failed",
              message: "Challenge has expired",
              details: { reason: AUTH_ERROR_REASONS.CODE_EXPIRED },
            };
          case "already_consumed":
            return {
              error: "precondition_failed",
              message: "Challenge has already been used",
              details: { reason: AUTH_ERROR_REASONS.CODE_USED },
            };
          default:
            return { error: "internal_error", message: "Failed to complete login" };
        }
      }

      const challenge = consumeResult.value;
      const userResult = await repo.getUserById(challenge.userId);
      if (!userResult.ok) {
        return { error: "internal_error", message: "Failed to resolve user" };
      }

      return issueSession(userResult.value, { method: "email_code" }, { challengeId: challengeUuid });
    },

    async loginWithOAuth(
      input: LoginWithOAuthInput,
    ): Promise<LoginWithOAuthResult | LoginWithOAuthError> {
      const { provider, subject } = input;

      let userId: string;

      // 1. Returning identity: a prior login already linked this provider subject.
      const existing = await repo.getAuthIdentityByProviderSubject(provider, subject);
      if (existing.ok) {
        userId = existing.value.userId;
      } else {
        // First time we've seen this provider subject. We require a VERIFIED
        // email to safely link to (or create) an account. An unverified
        // provider email must never attach to, hijack, or seed an account —
        // and because `email_lower` is unique, we cannot create a parallel
        // account for an email an existing user already owns. So: verified or
        // bust.
        const email = (input.email ?? "").trim();
        const emailLower = email.toLowerCase();
        if (!email) {
          return { error: "email_required", message: "No email available from provider" };
        }
        if (!input.emailVerified) {
          return { error: "email_unverified", message: "Provider email is not verified" };
        }

        // Account-linking policy: link by verified email when an account
        // already exists; otherwise create a fresh one.
        let resolvedUser: User | null = null;
        let createdUser = false;
        const byEmail = await repo.getUserByEmail(emailLower);
        if (byEmail.ok) {
          resolvedUser = byEmail.value;
        } else {
          const newUserId = generateUserId();
          const created = await repo.createUser({
            id: newUserId,
            email,
            emailLower,
            displayName: input.displayName ?? null,
            createdAt: now(),
          });
          if (created.ok) {
            resolvedUser = created.value;
            createdUser = true;
          } else if (created.error.kind === "conflict") {
            // Lost a create race on the email — resolve to the winner.
            const refetch = await repo.getUserByEmail(emailLower);
            if (!refetch.ok) return { error: "internal_error", message: "Failed to resolve user" };
            resolvedUser = refetch.value;
          } else {
            return { error: "internal_error", message: "Failed to create user" };
          }
        }

        userId = resolvedUser.id;

        const link = await repo.createAuthIdentity({
          id: generateAuthIdentityId(),
          userId,
          provider,
          subject,
          metadata: { emailVerified: input.emailVerified },
          createdAt: now(),
        });
        if (!link.ok && link.error.kind === "conflict") {
          // A concurrent callback linked the same subject — defer to the winner.
          const resolved = await repo.getAuthIdentityByProviderSubject(provider, subject);
          if (resolved.ok) userId = resolved.value.userId;
        }

        await repo.recordSecurityEvent({
          ...eventBase(),
          eventType: createdUser ? "user.created" : "auth_identity.linked",
          outcome: "success",
          userId,
          metadata: { provider, method: "oauth", linkedExistingUser: !createdUser },
        });
      }

      // 2. Resolve the user record for the response payload.
      const userResult = await repo.getUserById(userId);
      if (!userResult.ok) {
        return { error: "internal_error", message: "Failed to resolve user" };
      }

      // 3. Issue a session (same opaque-token model as email login).
      return issueSession(userResult.value, { method: "oauth", provider });
    },

    async getSession(token: string): Promise<GetSessionResult | GetSessionError> {
      return getSession(token);
    },

    async getProfile(token: string): Promise<GetSessionResult | GetSessionError> {
      // Profile read reuses session resolution — same shape.
      return getSession(token);
    },

    async updateProfile(
      token: string,
      input: { displayName?: string | null; lastOrgSlug?: string | null },
    ): Promise<UpdateProfileResult | UpdateProfileError> {
      // Validate session
      const sessionResult = await getSession(token);
      if ("error" in sessionResult) {
        return { error: "unauthenticated", message: sessionResult.message };
      }

      // Reject API-key/service-principal tokens (they don't parse as session tokens)
      const parsed = parseSessionToken(token);
      if (!parsed) {
        return { error: "forbidden", message: "API keys cannot update user profiles" };
      }

      // Resolve internal user ID from public ID
      const publicId = sessionResult.user.id;
      const uuid = parseUserPublicId(publicId);
      if (!uuid) {
        return { error: "internal_error", message: "Invalid user ID format" };
      }

      // Partial update: forward only the fields the caller provided.
      const patch: { displayName?: string | null; lastOrgSlug?: string | null; updatedAt: Date } = {
        updatedAt: now(),
      };
      const changedFields: string[] = [];
      if (input.displayName !== undefined) {
        patch.displayName = input.displayName;
        changedFields.push("displayName");
      }
      if (input.lastOrgSlug !== undefined) {
        patch.lastOrgSlug = input.lastOrgSlug;
        changedFields.push("lastOrgSlug");
      }

      const updateResult = await repo.updateUserProfile(uuid, patch);

      if (!updateResult.ok) {
        return { error: "internal_error", message: "Failed to update profile" };
      }

      // Record a security event only for meaningful identity changes. The
      // last-org hint updates on routine navigation, so it must not spam the
      // audit log.
      if (changedFields.includes("displayName")) {
        await repo.recordSecurityEvent({
          ...eventBase(),
          eventType: "user.profile.updated",
          outcome: "success",
          userId: uuid,
          metadata: { changedFields },
        });
      }

      const user = updateResult.value;
      return {
        user: {
          id: userPublicId(user.id),
          email: user.email,
          displayName: user.displayName,
          lastOrgSlug: user.lastOrgSlug,
        },
      };
    },

    async resolveBearer(token: string): Promise<ResolveBearerResult | ResolveBearerError> {
      // Try session token first (sps_ses_ prefix)
      const parsed = parseSessionToken(token);
      if (parsed) {
        const sessionResult = await getSession(token);
        if ("error" in sessionResult) {
          return { error: "unauthenticated", message: sessionResult.message };
        }
        return {
          actorType: "user",
          actorId: sessionResult.user.id,
          email: sessionResult.user.email,
          displayName: sessionResult.user.displayName,
          session: sessionResult.session,
          user: sessionResult.user,
        };
      }

      // A delegated token (sps_dlg_ prefix, MC-2): the user plus the
      // delegation's scopes, while it is live. Never falls through to the
      // API-key lookup.
      if (token.startsWith("sps_dlg_")) {
        const resolved = delegations ? await resolveDelegatedToken(delegations, token, now()) : null;
        if (!resolved) return { error: "unauthenticated", message: "Invalid bearer token" };
        const user = {
          id: userPublicId(resolved.user.id),
          email: resolved.user.email,
          displayName: resolved.user.displayName,
        };
        return {
          actorType: "user",
          actorId: user.id,
          email: user.email,
          displayName: user.displayName,
          user,
          delegation: resolved.delegation,
        };
      }

      // Try API key resolution
      const keyHash = await hashSha256(token);
      const apiKeyResult = await repo.getApiKeyByKeyHash(keyHash);
      if (!apiKeyResult.ok) {
        return { error: "unauthenticated", message: "Invalid bearer token" };
      }

      const apiKey = apiKeyResult.value;
      if (apiKey.status !== "active") {
        return { error: "unauthenticated", message: "API key is not active" };
      }
      if (apiKey.revokedAt !== null) {
        return { error: "unauthenticated", message: "API key has been revoked" };
      }
      if (apiKey.expiresAt !== null && apiKey.expiresAt.getTime() <= now().getTime()) {
        return { error: "unauthenticated", message: "API key has expired" };
      }

      // Resolve service principal for display name
      const spResult = await repo.getServicePrincipalById(apiKey.servicePrincipalId);
      const displayName = spResult.ok ? spResult.value.displayName : null;
      const projectId = spResult.ok ? spResult.value.projectId : null;

      return {
        actorType: "service_principal",
        actorId: `sp_${apiKey.servicePrincipalId.replace(/-/g, "")}`,
        orgId: apiKey.orgId,
        projectId,
        displayName,
      };
    },

    async logout(token: string): Promise<{ success: true } | LogoutError> {
      const parsed = parseSessionToken(token);
      if (!parsed) {
        return { error: "unauthenticated", message: "Invalid token format" };
      }

      const tokenHash = await hashSha256(parsed.secret);
      const sessionResult = await repo.getSessionByTokenHash(tokenHash);

      if (!sessionResult.ok) {
        return { error: "unauthenticated", message: "Session not found" };
      }

      const session = sessionResult.value;
      if (session.revokedAt === null) {
        await repo.revokeSession(session.id, now());

        const eventResult = await repo.recordSecurityEvent({
          ...eventBase(),
          eventType: "session.revoked",
          outcome: "success",
          userId: session.userId,
          sessionId: session.id,
          metadata: {},
        });

        if (!eventResult.ok) {
          return { error: "internal_error", message: "Failed to record security event" };
        }
      }

      return { success: true };
    },
  };
}
