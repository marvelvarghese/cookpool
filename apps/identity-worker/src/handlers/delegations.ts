// Delegated tokens for assistants (cookpool-mcp MC-2, design §1).
//
//   POST   /v1/auth/delegations         { scopes, clientName, clientId, requestId? }
//            → 201 { delegation, token }   (the token is shown this once)
//   GET    /v1/auth/delegations         → { delegations }   (live ones, newest first)
//   DELETE /v1/auth/delegations/{dlg}   → { id, revokedAt }
//     A signed-in session only: a delegated token or an API key gets 403
//     `forbidden` with `details.reason: "session_required"` (api-edge refuses
//     a delegated token every /v1/auth/ route before it gets here, too).
//
//   POST   /v1/internal/delegations/refresh   { delegationId }
//            → { delegation, token }   (a new secret; 90 more days)
//     For mcp-worker over a service binding: api-edge routes nothing under
//     /v1/internal/, and the caller names itself in `x-internal-actor`
//     (DELEGATION_INTERNAL_ACTORS). Anyone else reads a route that does not exist.

import type { Env } from "../env.js";
import type { DelegationsRepository, IdentityRepository } from "@saas/db/identity";
import { createDelegationsRepository, createIdentityRepository } from "@saas/db/identity";
import { createSqlExecutor } from "@saas/db/d1";
import {
  DELEGATION_INTERNAL_ACTOR_HEADER,
  DELEGATION_INTERNAL_ACTORS,
  type CreateDelegationResponse,
  type DelegationsListResponse,
  type RefreshDelegationResponse,
  type RevokeDelegationResponse,
} from "@saas/contracts/delegations";
import { createTimings } from "@saas/contracts/timing";
import { errorResponse, extractBearerToken, notFound, successResponse, validationError, withTimings } from "../http.js";
import { extractRequestContext } from "../request-context.js";
import { createDelegationService, isFailure, type DelegationFailure } from "../services/delegations.js";

export interface DelegationHandlerDeps {
  repo: IdentityRepository;
  delegations: DelegationsRepository;
  now?: () => Date;
}

type Service = ReturnType<typeof createDelegationService>;

const DELEGATION_ID_RE = /^\/v1\/auth\/delegations\/([^/]+)$/;

function failure(f: DelegationFailure, requestId: string): Response {
  return errorResponse(f.code, f.message, f.status, requestId, f.details);
}

/** Run `work` with a delegation service over the request's database (or the test's deps). */
async function withService(
  request: Request,
  env: Env,
  requestId: string,
  route: string,
  deps: DelegationHandlerDeps | undefined,
  work: (service: Service) => Promise<Response>,
): Promise<Response> {
  if (!deps && !env.PLATFORM_DB) return errorResponse("internal_error", "Database not configured", 503, requestId);
  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  const timings = createTimings();
  const endTotal = timings.start("total");
  try {
    const service = createDelegationService({
      repo: deps ? deps.repo : createIdentityRepository(executor!),
      delegations: deps ? deps.delegations : createDelegationsRepository(executor!),
      now: deps?.now ?? (() => new Date()),
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

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export async function handleCreateDelegation(
  request: Request,
  env: Env,
  requestId: string,
  deps?: DelegationHandlerDeps,
): Promise<Response> {
  const token = extractBearerToken(request);
  return withService(request, env, requestId, "identity.delegations.post", deps, async (service) => {
    const parsed = await readJson(request);
    // The service checks who first: a delegated token is refused before its
    // body is looked at, and a body that is not JSON reads as `body` field errors.
    const result = await service.create(token, parsed.ok ? parsed.body : undefined);
    if (isFailure(result)) return failure(result, requestId);
    return successResponse<CreateDelegationResponse>(result, requestId, 201);
  });
}

export async function handleListDelegations(
  request: Request,
  env: Env,
  requestId: string,
  deps?: DelegationHandlerDeps,
): Promise<Response> {
  const token = extractBearerToken(request);
  return withService(request, env, requestId, "identity.delegations.get", deps, async (service) => {
    const result = await service.list(token);
    if (isFailure(result)) return failure(result, requestId);
    return successResponse<DelegationsListResponse>(result, requestId);
  });
}

export async function handleRevokeDelegation(
  request: Request,
  env: Env,
  requestId: string,
  deps?: DelegationHandlerDeps,
): Promise<Response> {
  const token = extractBearerToken(request);
  const id = new URL(request.url).pathname.match(DELEGATION_ID_RE)?.[1] ?? "";
  return withService(request, env, requestId, "identity.delegation.delete", deps, async (service) => {
    const result = await service.revoke(token, decodeURIComponent(id));
    if (isFailure(result)) return failure(result, requestId);
    return successResponse<RevokeDelegationResponse>(result, requestId);
  });
}

/** Is this request from a worker allowed to refresh delegations? */
export function isDelegationInternalCaller(request: Request): boolean {
  const caller = request.headers.get(DELEGATION_INTERNAL_ACTOR_HEADER);
  return caller !== null && (DELEGATION_INTERNAL_ACTORS as readonly string[]).includes(caller);
}

export async function handleInternalRefreshDelegation(
  request: Request,
  env: Env,
  requestId: string,
  deps?: DelegationHandlerDeps,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (!isDelegationInternalCaller(request)) return notFound(requestId, pathname);
  const parsed = await readJson(request);
  if (!parsed.ok || !parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) {
    return validationError(requestId, { body: ["Must be a valid JSON object"] });
  }
  const delegationId = (parsed.body as { delegationId?: unknown }).delegationId;
  return withService(request, env, requestId, "identity.internal.delegations.refresh.post", deps, async (service) => {
    const result = await service.refresh(delegationId);
    if (isFailure(result)) return failure(result, requestId);
    return successResponse<RefreshDelegationResponse>(result, requestId);
  });
}
