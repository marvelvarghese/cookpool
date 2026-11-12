// Passkeys (cookpool-passkeys PK-2, design §1–2).
//
// WebAuthn passkeys that live on the device (discoverable), with user
// verification required: Face ID, a fingerprint or the screen lock. The
// server keeps only the public key. Each environment has its own RP ID
// (identity-worker's PASSKEY_RP_ID) and an exact list of origins
// (PASSKEY_ORIGINS); with no RP ID every route below answers 404
// `not_found` with `details.reason: "passkeys_off"`.
//
// Routes (identity-worker, through api-edge's auth facade):
//   POST   /v1/auth/passkeys/register/options  (session)  → PasskeyRegisterOptionsResponse
//   POST   /v1/auth/passkeys/register/verify   (session)  PasskeyRegisterVerifyRequest → PasskeyRegisterVerifyResponse (201)
//   GET    /v1/auth/passkeys                   (session)  → PasskeysListResponse
//   DELETE /v1/auth/passkeys/{pky}             (session)  → RemovePasskeyResponse
//   POST   /v1/auth/passkeys/login/options     (anyone)   → PasskeyLoginOptionsResponse
//   POST   /v1/auth/passkeys/login/verify      (anyone)   PasskeyLoginVerifyRequest → LoginCompleteResponse
//
// ERROR_CODES are pinned; passkey outcomes ride on existing codes with
// `details.reason` (PASSKEY_ERROR_REASONS):
//   - 404 `not_found`, reason `passkeys_off`: this environment has no RP ID.
//   - 403 `forbidden`, reason `session_required`: a delegated token (or an API
//     key) on any passkey route. api-edge refuses a delegated token on every
//     /v1/auth/ route before it gets here (reason `scope`).
//   - 409 `conflict`, reason `too_many_passkeys`: register at PASSKEY_MAX_PER_USER.
//   - 422 `precondition_failed`, reason `passkey_failed`: a registration that
//     did not verify (challenge, origin, RP ID, user verification).
//   - 401 `unauthenticated`, reason `passkey_failed`: any sign-in that did not
//     verify, whatever the cause, with no more detail.
//   - 404 `not_found` on DELETE: not one of your passkeys.

import type { LoginCompleteResponse } from "./auth.js";

/** A person may hold at most this many passkeys. */
export const PASSKEY_MAX_PER_USER = 10;
/** A challenge is good for this long, and once. */
export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;
/** A device name is 1 to this many characters. */
export const PASSKEY_DEVICE_NAME_MAX = 60;
/** A passkey's public id: `pky_` plus 16 hex characters. */
export const PASSKEY_ID_PREFIX = "pky_";
export const PASSKEY_ID_RE = /^pky_[0-9a-f]{16}$/;

/** `details.reason` values that ride on the pinned error codes. */
export const PASSKEY_ERROR_REASONS = {
  /** 404 `not_found` on every passkey route: PASSKEY_RP_ID is empty here. */
  PASSKEYS_OFF: "passkeys_off",
  /** 409 `conflict` on register: the person already holds PASSKEY_MAX_PER_USER. */
  TOO_MANY_PASSKEYS: "too_many_passkeys",
  /** 401 on login/verify, 422 on register/verify: it did not verify. Never says why. */
  PASSKEY_FAILED: "passkey_failed",
  /** 403 `forbidden`: passkey routes take a signed-in session or nothing; never a delegated token. */
  SESSION_REQUIRED: "session_required",
} as const;
export type PasskeyErrorReason = (typeof PASSKEY_ERROR_REASONS)[keyof typeof PASSKEY_ERROR_REASONS];

/** A passkey as the person sees it under Sign-in and security. Never the key or credential id. */
export interface Passkey {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Synced (iCloud Keychain, Google Password Manager): survives losing the device. */
  backedUp: boolean;
}

export type AuthenticatorTransport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

export interface PasskeyCredentialDescriptor {
  id: string;
  type: "public-key";
  transports?: AuthenticatorTransport[];
}

/** WebAuthn PublicKeyCredentialCreationOptionsJSON, as `navigator.credentials.create` (or a browser helper) takes it. */
export interface PasskeyCreationOptionsJSON {
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: Array<{ alg: number; type: "public-key" }>;
  timeout?: number;
  excludeCredentials?: PasskeyCredentialDescriptor[];
  authenticatorSelection?: {
    authenticatorAttachment?: "platform" | "cross-platform";
    requireResidentKey?: boolean;
    residentKey?: "discouraged" | "preferred" | "required";
    userVerification?: "discouraged" | "preferred" | "required";
  };
  hints?: string[];
  attestation?: "none" | "indirect" | "direct" | "enterprise";
  extensions?: Record<string, unknown>;
}

/** WebAuthn PublicKeyCredentialRequestOptionsJSON. */
export interface PasskeyRequestOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PasskeyCredentialDescriptor[];
  userVerification?: "discouraged" | "preferred" | "required";
  hints?: string[];
  extensions?: Record<string, unknown>;
}

/** WebAuthn RegistrationResponseJSON: what the browser hands back after create(). */
export interface PasskeyRegistrationResponseJSON {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject: string;
    authenticatorData?: string;
    transports?: AuthenticatorTransport[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
  };
  authenticatorAttachment?: "platform" | "cross-platform";
  clientExtensionResults: Record<string, unknown>;
}

/** WebAuthn AuthenticationResponseJSON: what the browser hands back after get(). */
export interface PasskeyAuthenticationResponseJSON {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  authenticatorAttachment?: "platform" | "cross-platform";
  clientExtensionResults: Record<string, unknown>;
}

/** POST /v1/auth/passkeys/register/options — no body. */
export interface PasskeyRegisterOptionsResponse {
  options: PasskeyCreationOptionsJSON;
}

/** POST /v1/auth/passkeys/register/verify. With no deviceName, one is made from the transports and the user agent. */
export interface PasskeyRegisterVerifyRequest {
  response: PasskeyRegistrationResponseJSON;
  deviceName?: string;
}

export interface PasskeyRegisterVerifyResponse {
  passkey: Passkey;
}

/** GET /v1/auth/passkeys — newest first. */
export interface PasskeysListResponse {
  passkeys: Passkey[];
}

/** DELETE /v1/auth/passkeys/{pky}. */
export interface RemovePasskeyResponse {
  id: string;
  removedAt: string;
}

/** POST /v1/auth/passkeys/login/options — no body. `allowCredentials` is empty: the device offers its passkeys. */
export interface PasskeyLoginOptionsResponse {
  options: PasskeyRequestOptionsJSON;
}

/** POST /v1/auth/passkeys/login/verify. */
export interface PasskeyLoginVerifyRequest {
  response: PasskeyAuthenticationResponseJSON;
}

/** Exactly the session body POST /v1/auth/login/complete returns. */
export type PasskeyLoginVerifyResponse = LoginCompleteResponse;
