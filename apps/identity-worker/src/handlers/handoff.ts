// One-time handoff into another app (cookpool-spliteco SE-4):
//
//   POST /v1/auth/handoff            { targetOrigin }  → 201 { code, targetOrigin, expiresAt }
//     A signed-in session only (a delegated token or an API key: 403
//     session_required). The origin must be one HANDOFF_ORIGINS lists.
//   POST /v1/auth/handoff/exchange   { code }  → 200 the sign-in session body
//     Nobody signed in; the request's Origin must be the one the code was made
//     for. 401 with details.reason handoff_invalid | handoff_expired |
//     handoff_used | handoff_wrong_origin otherwise.
// See ../services/handoff.ts.

import type { HandoffCreateResponse } from "@saas/contracts/auth";
import type { HandoffRepository, IdentityRepository } from "@saas/db/identity";
import { createHandoffRepository, createIdentityRepository } from "@saas/db/identity";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import { errorResponse, extractBearerToken, successResponse } from "../http.js";
import { extractRequestContext } from "../request-context.js";
import { createHandoffService } from "../services/handoff.js";
import { isServiceFailure, type ServiceFailure } from "../services/session-user.js";
import { sessionBodyResponse } from "./session-body.js";

export interface HandoffHandlerDeps {
  repo: IdentityRepository;
  handoffs: HandoffRepository;
  now?: () => Date;
}

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

async function withService(
  request: Request,
  env: Env,
  requestId: string,
  deps: HandoffHandlerDeps | undefined,
  work: (service: ReturnType<typeof createHandoffService>) => Promise<Response>,
): Promise<Response> {
  if (!deps && !env.PLATFORM_DB) return errorResponse("internal_error", "Database not configured", 503, requestId);
  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    return await work(
      createHandoffService({
        env,
        repo: deps ? deps.repo : createIdentityRepository(executor!),
        handoffs: deps ? deps.handoffs : createHandoffRepository(executor!),
        now: deps?.now ?? (() => new Date()),
        ctx: extractRequestContext(request, requestId),
      }),
    );
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}

export function handleCreateHandoff(request: Request, env: Env, requestId: string, deps?: HandoffHandlerDeps): Promise<Response> {
  const token = extractBearerToken(request);
  return withService(request, env, requestId, deps, async (service) => {
    const result = await service.create(token, await readJson(request));
    if (isServiceFailure(result)) return failure(result, requestId);
    return successResponse<HandoffCreateResponse>(result, requestId, 201);
  });
}

export function handleExchangeHandoff(request: Request, env: Env, requestId: string, deps?: HandoffHandlerDeps): Promise<Response> {
  return withService(request, env, requestId, deps, async (service) => {
    const result = await service.exchange(request.headers.get("origin"), await readJson(request));
    if (isServiceFailure(result)) return failure(result, requestId);
    return sessionBodyResponse(env, requestId, result);
  });
}
