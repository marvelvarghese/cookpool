export type { SqlExecutor, SqlExecutorResult, SqlRow } from "../d1/executor.js";
import type { Uuid } from "../ids/index.js";

export type IdentityRepositoryError =
  | { kind: "not_found" }
  | { kind: "conflict"; entity: string }
  | { kind: "expired" }
  | { kind: "already_consumed" }
  /** A login challenge took a wrong code and has `attemptsLeft` (1 or more) tries left (SI-2). */
  | { kind: "wrong_code"; attemptsLeft: number }
  /**
   * A login challenge is spent: it has taken LOGIN_CHALLENGE_MAX_ATTEMPTS wrong
   * codes (the last of them may be this one), so even the right code is refused.
   */
  | { kind: "too_many_attempts" }
  /**
   * A new login challenge was refused: the person already has the most a
   * window allows. `retryAt` is when the oldest one that counts leaves it.
   */
  | { kind: "rate_limited"; retryAt: Date }
  | { kind: "internal"; message: string };

export type IdentityResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IdentityRepositoryError };

export interface User {
  id: string;
  email: string;
  emailLower: string;
  displayName: string | null;
  /** Slug of the org the user last worked in; a soft UI hint (see migration 160). */
  lastOrgSlug: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthIdentity {
  id: string;
  userId: string;
  provider: string;
  subject: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginChallenge {
  id: string;
  userId: string;
  method: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  /** Wrong codes taken so far (migration 280); at LOGIN_CHALLENGE_MAX_ATTEMPTS the challenge is spent. */
  attempts: number;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface CreateUserInput {
  id: string;
  email: string;
  emailLower: string;
  displayName?: string | null;
  createdAt: Date;
}

export interface CreateAuthIdentityInput {
  id: string;
  userId: string;
  provider: string;
  subject: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateLoginChallengeInput {
  id: string;
  userId: string;
  method: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
  /**
   * Refuse the challenge when the user already has `max` challenges created in
   * the `windowMs` before `createdAt` (SI-2: 5 codes per address per 15
   * minutes). The count and the insert are one statement, so requests racing
   * each other cannot get past it. Refused → `rate_limited` with `retryAt`.
   */
  limit?: { max: number; windowMs: number };
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SecurityEvent {
  id: string;
  eventType: string;
  outcome: string;
  userId: string | null;
  sessionId: string | null;
  challengeId: string | null;
  requestId: string | null;
  correlationId: string | null;
  ip: string | null;
  userAgent: string | null;
  occurredAt: Date;
  createdAt: Date;
  metadata: Record<string, unknown>;
  redactPaths: string[];
}

export interface CreateSecurityEventInput {
  id: string;
  eventType: string;
  outcome: string;
  userId?: string | null;
  sessionId?: string | null;
  challengeId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
  redactPaths?: string[];
}

// --- Service Principals ---

export interface ServicePrincipal {
  id: string;
  orgId: string;
  projectId: string | null;
  displayName: string;
  description: string | null;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateServicePrincipalInput {
  id: string;
  orgId: Uuid;
  projectId?: Uuid | null;
  displayName: string;
  description?: string | null;
  createdBy: Uuid;
  createdAt: Date;
}

// --- API Keys ---

export interface ApiKey {
  id: string;
  servicePrincipalId: string;
  orgId: string;
  keyPrefix: string;
  label: string;
  status: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApiKeyInput {
  id: string;
  servicePrincipalId: string;
  orgId: Uuid;
  keyPrefix: string;
  keyHash: string;
  label?: string;
  expiresAt?: Date | null;
  createdBy: Uuid;
  createdAt: Date;
}

export interface ApiKeyCursorPosition {
  createdAt: string;
  id: string;
}

export interface ApiKeyPageQueryParams {
  orgId: string;
  limit: number;
  cursor: ApiKeyCursorPosition | null;
}

export interface ApiKeyPagedResult {
  items: ApiKey[];
  nextCursor: ApiKeyCursorPosition | null;
}

export interface SecurityEventCursorPosition {
  occurredAt: string;
  id: string;
}

export interface SecurityEventPageQueryParams {
  userId: string;
  limit: number;
  cursor: SecurityEventCursorPosition | null;
}

export interface SecurityEventPagedResult {
  items: SecurityEvent[];
  nextCursor: SecurityEventCursorPosition | null;
}

export interface UpdateUserProfileInput {
  /** Provide to change; omit to leave unchanged (partial update). */
  displayName?: string | null;
  /** Provide to change; omit to leave unchanged (partial update). */
  lastOrgSlug?: string | null;
  updatedAt: Date;
}

export interface IdentityRepository {
  createUser(input: CreateUserInput): Promise<IdentityResult<User>>;
  getUserById(id: string): Promise<IdentityResult<User>>;
  getUserByEmail(emailLower: string): Promise<IdentityResult<User>>;
  updateUserProfile(userId: string, input: UpdateUserProfileInput): Promise<IdentityResult<User>>;

  createAuthIdentity(input: CreateAuthIdentityInput): Promise<IdentityResult<AuthIdentity>>;
  getAuthIdentityByProviderSubject(provider: string, subject: string): Promise<IdentityResult<AuthIdentity>>;

  createLoginChallenge(input: CreateLoginChallengeInput): Promise<IdentityResult<LoginChallenge>>;
  getLoginChallengeById(id: string): Promise<IdentityResult<LoginChallenge>>;
  /**
   * Try a code against a challenge, in ONE guarded statement (SI-2): the right
   * code consumes it; a wrong one adds a try. Only an unconsumed, unexpired
   * challenge with tries left is touched, so parallel guesses each count and
   * none gets past LOGIN_CHALLENGE_MAX_ATTEMPTS. Refusals: `wrong_code`
   * (`attemptsLeft` ≥ 1), `too_many_attempts` (this was the last try, or none
   * were left), `expired`, `already_consumed`, `not_found`.
   */
  consumeLoginChallenge(id: string, codeHash: string, consumedAt: Date): Promise<IdentityResult<LoginChallenge>>;

  createSession(input: CreateSessionInput): Promise<IdentityResult<Session>>;
  getSessionByTokenHash(tokenHash: string): Promise<IdentityResult<Session>>;
  /**
   * Session lookup folded with its user fetch into a single JOIN (PERF12d), so a
   * bearer-cache miss costs one DB round-trip instead of two. Same filters and
   * `not_found`/`expired` semantics as `getSessionByTokenHash`.
   */
  getSessionWithUserByTokenHash(tokenHash: string): Promise<IdentityResult<{ session: Session; user: User }>>;
  revokeSession(id: string, revokedAt: Date): Promise<IdentityResult<Session>>;

  recordSecurityEvent(input: CreateSecurityEventInput): Promise<IdentityResult<SecurityEvent>>;
  querySecurityEventsByUser(params: SecurityEventPageQueryParams): Promise<IdentityResult<SecurityEventPagedResult>>;

  // Service Principals
  createServicePrincipal(input: CreateServicePrincipalInput): Promise<IdentityResult<ServicePrincipal>>;
  getServicePrincipalById(id: string): Promise<IdentityResult<ServicePrincipal>>;
  listServicePrincipalsByOrg(orgId: string): Promise<IdentityResult<ServicePrincipal[]>>;

  // API Keys
  createApiKey(input: CreateApiKeyInput): Promise<IdentityResult<ApiKey>>;
  getApiKeyByKeyHash(keyHash: string): Promise<IdentityResult<ApiKey>>;
  listApiKeysByOrg(params: ApiKeyPageQueryParams): Promise<IdentityResult<ApiKeyPagedResult>>;
  revokeApiKey(id: string, revokedBy: Uuid, revokedAt: Date): Promise<IdentityResult<ApiKey>>;
}
