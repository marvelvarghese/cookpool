import type { ErrorCode } from "@saas/contracts/errors";
import { shouldEmitTimingLog, type Timings } from "@saas/contracts/timing";

// The response envelopes every Tripeco route answers with: `{ data, meta }` on
// success, `{ error: { code, message, details, requestId } }` on failure. The
// codes are the pinned ERROR_CODES; anything more specific travels in
// `details.reason` (see TRIPECO_ERROR_REASONS in @saas/contracts/tripeco).

/** Attach a `Server-Timing` header (when phases exist) and emit a structured
 *  timing log line. Returns the same response for chaining. */
export function withTimings(response: Response, requestId: string, route: string, timings: Timings): Response {
  const header = timings.header();
  if (header) response.headers.set("Server-Timing", header);
  // PERF14b: header always set; the log line is sampled to bound Workers Logs cost.
  const phases = timings.toJSON();
  if (shouldEmitTimingLog(phases)) {
    // eslint-disable-next-line no-console -- structured timing line for prod observability
    console.log(JSON.stringify({ level: "info", msg: "timing", route, requestId, phases }));
  }
  return response;
}

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
  code: ErrorCode,
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

/** No route answers this path. */
export function routeNotFound(requestId: string, path: string): Response {
  return errorResponse("not_found", `Route not found: ${path}`, 404, requestId);
}

/**
 * The opaque 404: a malformed id, a resource that does not exist, and a caller
 * who may not see it all read the same, so nobody outside a group learns
 * anything about it.
 */
export function notFound(requestId: string): Response {
  return errorResponse("not_found", "Not found", 404, requestId);
}

export function methodNotAllowed(requestId: string): Response {
  return errorResponse("unsupported", "Method not allowed", 405, requestId);
}

export function unauthenticated(requestId: string): Response {
  return errorResponse("unauthenticated", "Authentication required", 401, requestId);
}

/** A binding or the database is missing or failing. */
export function unavailable(requestId: string): Response {
  return errorResponse("internal_error", "Service unavailable", 503, requestId);
}

export function validationError(requestId: string, fields: Record<string, string[]>): Response {
  return errorResponse("validation_failed", "Validation failed", 422, requestId, { fields });
}

/**
 * A well-formed request the group's members or currency refuse (a person not
 * in the group, another currency); `reason` says which (TRIPECO_ERROR_REASONS).
 */
export function unprocessable(
  requestId: string,
  message: string,
  reason: string,
  details: Record<string, unknown> = {},
): Response {
  return errorResponse("validation_failed", message, 422, requestId, { reason, ...details });
}

/**
 * A member of the group asking for something only certain members may do
 * (the people a payment is between, a transaction's creator). Not the opaque
 * 404: the caller can already see the group and the transaction.
 */
export function forbidden(requestId: string, message: string, reason: string): Response {
  return errorResponse("forbidden", message, 403, requestId, { reason });
}

/** A request the current state refuses; `reason` says why (TRIPECO_ERROR_REASONS). */
export function conflict(
  requestId: string,
  message: string,
  reason: string,
  details: Record<string, unknown> = {},
): Response {
  return errorResponse("conflict", message, 409, requestId, { reason, ...details });
}

/**
 * Read a JSON object body. `null` when the body is not JSON or not an object;
 * callers answer that with `validationError(requestId, { body: [...] })`.
 * With `optional`, an empty body reads as `{}`.
 */
export async function readJsonObject(
  request: Request,
  options: { optional?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (options.optional && text.trim() === "") return {};
    const body: unknown = JSON.parse(text);
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
