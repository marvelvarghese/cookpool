// Passkeys (Cookpool PK-2, design §1).
//
// Register, list and remove take a signed-in session (a delegated token or an
// API key is 403). Login options and verify take nobody. Every ceremony is
// checked for its challenge (one-time, 5 minutes, kept in D1), its origin (an
// exact list), the RP ID hash and user verification; a sign-in also for its
// sign count. A failed sign-in says nothing about why: 401, reason
// passkey_failed. Credential ids and public keys are never logged or put in
// a security event.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { IdentityRepository, PasskeysRepository } from "@saas/db/identity";
import {
  PASSKEY_CHALLENGE_TTL_SECONDS,
  PASSKEY_ERROR_REASONS,
  PASSKEY_ID_RE,
  PASSKEY_MAX_PER_USER,
  type PasskeyCreationOptionsJSON,
  type PasskeyLoginOptionsResponse,
  type PasskeyRegisterOptionsResponse,
  type PasskeyRegisterVerifyResponse,
  type PasskeyRequestOptionsJSON,
  type PasskeysListResponse,
  type RemovePasskeyResponse,
} from "@saas/contracts/passkeys";
import { generatePasskeyChallengeId, generatePasskeyId, generateSecurityEventId, parseSessionToken } from "../ids.js";
import { createAuthService, type CompleteLoginResult, type RequestContext } from "./auth.js";
import { requireSessionUser, type ServiceFailure } from "./session-user.js";
import {
  cleanTransports,
  deviceNameFor,
  parseDeviceName,
  readCeremony,
  toPasskey,
  userHandleBytes,
  userHandleFor,
  type PasskeyConfig,
} from "./passkey-helpers.js";

const TTL_MS = PASSKEY_CHALLENGE_TTL_SECONDS * 1000;
/** Challenges are deleted a day after they expire. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
const REFUSED_MESSAGE = "Passkeys are managed from a signed-in session";

export interface PasskeyServiceDeps {
  repo: IdentityRepository;
  passkeys: PasskeysRepository;
  now: () => Date;
  config: PasskeyConfig;
  ctx?: RequestContext;
}

const loginFailed: ServiceFailure = {
  status: 401,
  code: "unauthenticated",
  message: "Passkey sign-in failed",
  details: { reason: PASSKEY_ERROR_REASONS.PASSKEY_FAILED },
};

const registerFailed: ServiceFailure = {
  status: 422,
  code: "precondition_failed",
  message: "The passkey could not be verified",
  details: { reason: PASSKEY_ERROR_REASONS.PASSKEY_FAILED },
};

const tooMany: ServiceFailure = {
  status: 409,
  code: "conflict",
  message: `At most ${PASSKEY_MAX_PER_USER} passkeys`,
  details: { reason: PASSKEY_ERROR_REASONS.TOO_MANY_PASSKEYS },
};

const internal = (message: string): ServiceFailure => ({ status: 500, code: "internal_error", message });

export function createPasskeyService(deps: PasskeyServiceDeps) {
  const { repo, passkeys, now, config, ctx } = deps;

  function event(
    eventType: string,
    outcome: string,
    userId: string | null,
    sessionId: string | null,
    metadata: Record<string, unknown>,
  ) {
    // Best-effort: the write it records has happened (or been refused).
    return repo.recordSecurityEvent({
      id: generateSecurityEventId(),
      eventType,
      outcome,
      userId,
      sessionId,
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      occurredAt: now(),
      metadata: { method: "passkey", ...metadata },
    });
  }

  async function newChallenge(kind: "register" | "login", userId: string | null, challenge: string) {
    const at = now();
    return passkeys.createChallenge({
      id: generatePasskeyChallengeId(),
      kind,
      userId,
      challenge,
      createdAt: at,
      expiresAt: new Date(at.getTime() + TTL_MS),
      pruneBefore: new Date(at.getTime() - PRUNE_AFTER_MS),
    });
  }

  /** A sign-in that did not verify: recorded, and answered the same whatever the cause. */
  async function refuseLogin(outcome: string, userId: string | null = null, passkeyId?: string): Promise<ServiceFailure> {
    await event("login.complete.failed", outcome, userId, null, passkeyId ? { passkeyId } : {});
    return loginFailed;
  }

  return {
    async registerOptions(token: string | null): Promise<PasskeyRegisterOptionsResponse | ServiceFailure> {
      const who = await requireSessionUser(repo, token, now(), REFUSED_MESSAGE);
      if ("status" in who) return who;
      const existing = await passkeys.listForUser(who.userId);
      if (!existing.ok) return internal("Failed to read passkeys");
      if (existing.value.length >= PASSKEY_MAX_PER_USER) return tooMany;

      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpId,
        userID: userHandleBytes(who.user.id),
        userName: who.user.email,
        userDisplayName: who.user.displayName ?? who.user.email,
        timeout: TTL_MS,
        attestationType: "none",
        excludeCredentials: existing.value.map((p) => ({ id: p.credentialId, transports: p.transports })),
        authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      });
      const stored = await newChallenge("register", who.userId, options.challenge);
      if (!stored.ok) return internal("Failed to create passkey challenge");
      return { options: options as PasskeyCreationOptionsJSON };
    },

    async registerVerify(token: string | null, body: unknown): Promise<PasskeyRegisterVerifyResponse | ServiceFailure> {
      const who = await requireSessionUser(repo, token, now(), REFUSED_MESSAGE);
      if ("status" in who) return who;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { status: 422, code: "validation_failed", message: "Validation failed", details: { fields: { body: ["Must be a JSON object"] } } };
      }
      const b = body as { response?: unknown; deviceName?: unknown };
      const fields: Record<string, string[]> = {};
      const deviceName = parseDeviceName(b.deviceName);
      if (deviceName === null) fields.deviceName = ["Must be 1–60 characters"];
      const ceremony = readCeremony(b.response);
      if (!ceremony) fields.response = ["Must be a WebAuthn registration response"];
      if (Object.keys(fields).length > 0 || !ceremony) {
        return { status: 422, code: "validation_failed", message: "Validation failed", details: { fields } };
      }

      // One-time: the challenge is spent whether or not what follows verifies.
      const used = await passkeys.consumeChallenge(ceremony.challenge, "register", who.userId, now());
      if (!used.ok) return registerFailed;

      const response = b.response as RegistrationResponseJSON;
      let info;
      try {
        const verified = await verifyRegistrationResponse({
          response,
          expectedChallenge: ceremony.challenge,
          expectedOrigin: config.origins,
          expectedRPID: config.rpId,
          requireUserVerification: true,
        });
        if (!verified.verified) return registerFailed;
        info = verified.registrationInfo;
      } catch {
        return registerFailed;
      }
      if (!info.userVerified) return registerFailed;
      // A passkey lives on the device. When the browser says this one does not, refuse it.
      const credProps = (response.clientExtensionResults as { credProps?: { rk?: unknown } } | undefined)?.credProps;
      if (credProps?.rk === false) return registerFailed;

      const transports = cleanTransports(info.credential.transports ?? response.response.transports);
      const created = await passkeys.create({
        id: generatePasskeyId(),
        userId: who.userId,
        credentialId: info.credential.id,
        publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
        signCount: info.credential.counter,
        transports,
        aaguid: info.aaguid,
        deviceName: deviceName ?? deviceNameFor(transports, ctx?.userAgent),
        backedUp: info.credentialBackedUp,
        createdAt: now(),
        limit: PASSKEY_MAX_PER_USER,
      });
      if (!created.ok) {
        if (created.error.kind === "conflict" && created.error.entity === "passkey_limit") return tooMany;
        if (created.error.kind === "conflict") return { status: 409, code: "conflict", message: "This passkey is already added" };
        return internal("Failed to store passkey");
      }

      const passkey = created.value;
      await event("passkey.added", "success", who.userId, who.sessionId, {
        passkeyId: passkey.id,
        deviceName: passkey.deviceName,
        backedUp: passkey.backedUp,
        aaguid: passkey.aaguid,
      });
      return { passkey: toPasskey(passkey) };
    },

    async list(token: string | null): Promise<PasskeysListResponse | ServiceFailure> {
      const who = await requireSessionUser(repo, token, now(), REFUSED_MESSAGE);
      if ("status" in who) return who;
      const found = await passkeys.listForUser(who.userId);
      if (!found.ok) return internal("Failed to list passkeys");
      return { passkeys: found.value.map(toPasskey) };
    },

    async remove(token: string | null, publicId: string): Promise<RemovePasskeyResponse | ServiceFailure> {
      const who = await requireSessionUser(repo, token, now(), REFUSED_MESSAGE);
      if ("status" in who) return who;
      const notFound: ServiceFailure = { status: 404, code: "not_found", message: "Passkey not found" };
      const id = publicId.toLowerCase();
      if (!PASSKEY_ID_RE.test(id)) return notFound;
      const removed = await passkeys.remove(id, who.userId);
      if (!removed.ok) return removed.error.kind === "not_found" ? notFound : internal("Failed to remove passkey");
      const removedAt = now();
      await event("passkey.removed", "success", who.userId, who.sessionId, {
        passkeyId: removed.value.id,
        deviceName: removed.value.deviceName,
      });
      return { id: removed.value.id, removedAt: removedAt.toISOString() };
    },

    async loginOptions(): Promise<PasskeyLoginOptionsResponse | ServiceFailure> {
      const options = await generateAuthenticationOptions({
        rpID: config.rpId,
        allowCredentials: [],
        userVerification: "required",
        timeout: TTL_MS,
      });
      const stored = await newChallenge("login", null, options.challenge);
      if (!stored.ok) return internal("Failed to create passkey challenge");
      return { options: options as PasskeyRequestOptionsJSON };
    },

    async loginVerify(body: unknown): Promise<CompleteLoginResult | ServiceFailure> {
      const raw = body && typeof body === "object" && !Array.isArray(body) ? (body as { response?: unknown }).response : undefined;
      const ceremony = readCeremony(raw);
      if (!ceremony) return refuseLogin("malformed");

      // One-time: spent before anything else is checked.
      const used = await passkeys.consumeChallenge(ceremony.challenge, "login", null, now());
      if (!used.ok) return refuseLogin("invalid_challenge");

      const found = await passkeys.getByCredentialId(ceremony.id);
      if (!found.ok) return refuseLogin("unknown_credential");
      const passkey = found.value;
      if (ceremony.userHandle !== null && ceremony.userHandle !== userHandleFor(passkey.userId)) {
        return refuseLogin("user_handle_mismatch", passkey.userId, passkey.id);
      }

      let info;
      try {
        const verified = await verifyAuthenticationResponse({
          response: raw as AuthenticationResponseJSON,
          expectedChallenge: ceremony.challenge,
          expectedOrigin: config.origins,
          expectedRPID: config.rpId,
          credential: {
            id: passkey.credentialId,
            publicKey: isoBase64URL.toBuffer(passkey.publicKey),
            counter: passkey.signCount,
            transports: passkey.transports,
          },
          requireUserVerification: true,
        });
        if (!verified.verified) return refuseLogin("not_verified", passkey.userId, passkey.id);
        info = verified.authenticationInfo;
      } catch {
        return refuseLogin("not_verified", passkey.userId, passkey.id);
      }
      if (!info.userVerified) return refuseLogin("not_verified", passkey.userId, passkey.id);
      // The sign count goes up, or both stay 0 (synced passkeys keep it at 0).
      if ((info.newCounter > 0 || passkey.signCount > 0) && info.newCounter <= passkey.signCount) {
        return refuseLogin("counter", passkey.userId, passkey.id);
      }
      const recorded = await passkeys.recordUse(passkey.id, passkey.signCount, info.newCounter, info.credentialBackedUp, now());
      if (!recorded.ok) return refuseLogin("counter", passkey.userId, passkey.id);

      const user = await repo.getUserById(passkey.userId);
      if (!user.ok) return refuseLogin("unknown_user", passkey.userId, passkey.id);

      const auth = createAuthService({ repo, now, ...(ctx ? { ctx } : {}) });
      const session = await auth.issueSession(user.value, { method: "passkey", passkeyId: passkey.id });
      if ("error" in session) return internal(session.message);
      await event("passkey.used", "success", passkey.userId, parseSessionToken(session.token)?.sessionId ?? null, {
        passkeyId: passkey.id,
      });
      return session;
    },
  };
}
