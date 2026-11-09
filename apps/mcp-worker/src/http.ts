import type { ErrorCode } from "@saas/contracts/errors";

const REQUEST_ID_RE = /^[\w-]{1,128}$/;

export function requestIdOf(request: Request): string {
  const header = request.headers.get("x-request-id");
  return header && REQUEST_ID_RE.test(header) ? header : `req_${randomToken(12)}`;
}

/** URL-safe random characters from `bytes` random bytes. */
export function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function successResponse<T>(data: T, requestId: string, status = 200): Response {
  return Response.json(
    { data, meta: { requestId, cursor: null } },
    { status, headers: { "cache-control": "no-store" } },
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
    { error: { code, message, details: details ?? {}, requestId } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** A small page for an /authorize failure that must not redirect (the client is not trusted). */
export function plainError(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** The Bearer credential of a request, or null. */
export function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer /i.test(header)) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/** A JSON object body, or null when it is not one. */
export async function jsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
