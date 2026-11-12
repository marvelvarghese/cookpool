export type {
  User,
  AuthIdentity,
  LoginChallenge,
  Session,
  SecurityEvent,
  CreateUserInput,
  CreateAuthIdentityInput,
  CreateLoginChallengeInput,
  CreateSessionInput,
  CreateSecurityEventInput,
  SecurityEventCursorPosition,
  SecurityEventPageQueryParams,
  SecurityEventPagedResult,
  IdentityRepository,
  IdentityResult,
  IdentityRepositoryError,
  ApiKey,
  ServicePrincipal,
  CreateServicePrincipalInput,
  CreateApiKeyInput,
  ApiKeyCursorPosition,
  ApiKeyPageQueryParams,
  ApiKeyPagedResult,
  UpdateUserProfileInput,
} from "./types.js";

export { createIdentityRepository, LOGIN_CHALLENGE_MAX_ATTEMPTS } from "./repository.js";

// Delegated tokens for assistants (cookpool-mcp MC-2).
export type { Delegation, CreateDelegationInput, DelegationsRepository } from "./delegations.js";
export { createDelegationsRepository } from "./delegations.js";

// Passkeys (cookpool-passkeys PK-2).
export type {
  Passkey,
  CreatePasskeyInput,
  PasskeyChallenge,
  PasskeyChallengeKind,
  CreatePasskeyChallengeInput,
  PasskeysRepository,
} from "./passkeys.js";
export { createPasskeysRepository } from "./passkeys.js";
