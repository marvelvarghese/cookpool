import type { ErrorCode } from "@saas/contracts/errors";

export function successResponse<T>(data: T, requestId: string, status = 200, cursor: string | null = null): Response {
  return Response.json(
    {
      data,
      meta: { requestId, cursor },
    },
    { status, headers: { "content-type": "application/json" } },
  );
}

export function errorResponse(
  code: ErrorCode | string,
  message: string,
  status: number,
  requestId: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(
    {
      error: { code, message, details: details ?? {}, requestId },
    },
    { status, headers: { "content-type": "application/json" } },
  );
}

export function notFound(requestId: string, path: string): Response {
  return errorResponse("not_found", `Route not found: ${path}`, 404, requestId);
}

export function methodNotAllowed(requestId: string): Response {
  return errorResponse("unsupported", "Method not allowed", 405, requestId);
}

export function validationError(requestId: string, fields: Record<string, string[]>): Response {
  return errorResponse("validation_failed", "Validation failed", 422, requestId, { fields });
}

/**
 * One log line for an error a handler turns into a 500 (Cookpool PW-10): where
 * it happened, the request id, and the error's name and message. Never the
 * request body, a token, a key or an address, so it is safe in the
 * Worker's logs.
 */
export function logUnexpected(where: string, requestId: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[notifications-worker] ${where} ${requestId}: ${name}: ${message.slice(0, 300)}`);
}

