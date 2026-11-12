// Passkeys (Cookpool PK-2, design §1).
//
//   POST   /v1/auth/passkeys/register/options   (session) → { options }
//   POST   /v1/auth/passkeys/register/verify    (session) { response, deviceName? } → 201 { passkey }
//   GET    /v1/auth/passkeys                    (session) → { passkeys }   newest first
//   DELETE /v1/auth/passkeys/{pky}              (session) → { id, removedAt }
//   POST   /v1/auth/passkeys/login/options      (anyone)  → { options }
//   POST   /v1/auth/passkeys/login/verify       (anyone)  { response } → the login/complete session body
//
// With PASSKEY_RP_ID empty every one answers 404 `not_found`, reason
// `passkeys_off`, before anything else. A delegated token (or an API key) gets
// 403 `forbidden`, reason `session_required`, on all of them — the public two
// included. api-edge refuses a delegated token on /v1/auth/ before this, too.

import type { Env } from "../env.js";
import type { IdentityRepository, PasskeysRepository } from "@saas/db/identity";
import { createIdentityRepository, createPasskeysRepository } from "@saas/db/identity";
import { createSqlExecutor } from "@saas/db/d1";
import { PASSKEY_ERROR_REASONS } from "@saas/contracts/passkeys";
import { createTimings } from "@saas/contracts/timing";
import { errorResponse, extractBearerToken, successResponse, withTimings } from "../http.js";
import { extractRequestContext } from "../request-context.js";
import { parseSessionToken } from "../ids.js";
import { passkeyConfig } from "../services/passkey-helpers.js";
import { createPasskeyService } from "../services/passkeys.js";
import { isServiceFailure, SESSION_REQUIRED_REASON, type ServiceFailure } from "../services/session-user.js";
import { sessionBodyResponse } from "./session-body.js";

export interface PasskeyHandlerDeps {
  repo: IdentityRepository;
  passkeys: PasskeysRepository;
  now?: () => Date;
}

type Service = ReturnType<typeof createPasskeyService>;

const PASSKEY_ID_PATH_RE = /^\/v1\/auth\/passkeys\/([^/]+)$/;

function failure(f: ServiceFailure, requestId: string): Response {
  return errorResponse(f.code, f.message, f.status, requestId, f.details);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * Run `work` with a passkey service over the request's database (or the
 * test's deps): after the off switch, and — on the public routes — after a
 * delegated token or API key is refused.
 */
async function withService(
  request: Request,
  env: Env,
  requestId: string,
  route: string,
  deps: PasskeyHandlerDeps | undefined,
  options: { public: boolean },
  work: (service: Service) => Promise<Response>,
): Promise<Response> {
  const config = passkeyConfig(env);
  if (!config) {
    return errorResponse("not_found", "Passkeys are off here", 404, requestId, {
      reason: PASSKEY_ERROR_REASONS.PASSKEYS_OFF,
    });
  }
  if (options.public) {
    // Anyone may ask, but an assistant's delegated token (or an API key) may not.
    const token = extractBearerToken(request);
    if (token && !parseSessionToken(token)) {
      return errorResponse("forbidden", "Passkey sign-in is for people, not assistants", 403, requestId, {
        reason: SESSION_REQUIRED_REASON,
      });
    }
  }
  if (!deps && !env.PLATFORM_DB) return errorResponse("internal_error", "Database not configured", 503, requestId);
  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  const timings = createTimings();
  const endTotal = timings.start("total");
  try {
    const service = createPasskeyService({
      repo: deps ? deps.repo : createIdentityRepository(executor!),
      passkeys: deps ? deps.passkeys : createPasskeysRepository(executor!),
      now: deps?.now ?? (() => new Date()),
      config,
      ctx: extractRequestContext(request, requestId),
    });
    const response = await timings.measure("db", () => work(service));
    endTotal();
    return withTimings(response, requestId, route, timings);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}

export function handlePasskeyRegisterOptions(request: Request, env: Env, requestId: string, deps?: PasskeyHandlerDeps) {
  const token = extractBearerToken(request);
  return withService(request, env, requestId, "identity.passkeys.register.options", deps, { public: false }, async (s) => {
    const result = await s.registerOptions(token);
    return isServiceFailure(result) ? failure(result, requestId) : successResponse(result, requestId);
  });
}

export function handlePasskeyRegisterVerify(request: Request, env: Env, requestId: string, deps?: PasskeyHandlerDeps) {
  const token = extractBearerToken(request);
  return withService(request, env, requestId, "identity.passkeys.register.verify", deps, { public: false }, async (s) => {
    // Who first: a delegated token is refused before its body is read.
    const result = await s.registerVerify(token, token && parseSessionToken(token) ? await readJson(request) : undefined);
    return isServiceFailure(result) ? failure(result, requestId) : successResponse(result, requestId, 201);
  });
}

export function handleListPasskeys(request: Request, env: Env, requestId: string, deps?: PasskeyHandlerDeps) {
  const token = extractBearerToken(request);
  return withService(request, env, requestId, "identity.passkeys.get", deps, { public: false }, async (s) => {
    const result = await s.list(token);
    return isServiceFailure(result) ? failure(result, requestId) : successResponse(result, requestId);
  });
}

export function handleRemovePasskey(request: Request, env: Env, requestId: string, deps?: PasskeyHandlerDeps) {
  const token = extractBearerToken(request);
  const id = new URL(request.url).pathname.match(PASSKEY_ID_PATH_RE)?.[1] ?? "";
  return withService(request, env, requestId, "identity.passkey.delete", deps, { public: false }, async (s) => {
    let decoded = "";
    try {
      decoded = decodeURIComponent(id);
    } catch {
      decoded = "";
    }
    const result = await s.remove(token, decoded);
    return isServiceFailure(result) ? failure(result, requestId) : successResponse(result, requestId);
  });
}

export function handlePasskeyLoginOptions(request: Request, env: Env, requestId: string, deps?: PasskeyHandlerDeps) {
  return withService(request, env, requestId, "identity.passkeys.login.options", deps, { public: true }, async (s) => {
    const result = await s.loginOptions();
    return isServiceFailure(result) ? failure(result, requestId) : successResponse(result, requestId);
  });
}

export function handlePasskeyLoginVerify(request: Request, env: Env, requestId: string, deps?: PasskeyHandlerDeps) {
  return withService(request, env, requestId, "identity.passkeys.login.verify", deps, { public: true }, async (s) => {
    const result = await s.loginVerify(await readJson(request));
    if (isServiceFailure(result)) return failure(result, requestId);
    // Exactly the body login/complete answers, from the same code.
    return sessionBodyResponse(env, requestId, result);
  });
}
