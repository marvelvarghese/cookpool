// Calls to api-edge over the API_EDGE service binding.
//
// Every call carries a bearer: a tool sends the person's delegated token
// (`sps_dlg_…`), and api-edge resolves it to the person plus the scopes they
// allowed and refuses anything outside its allowlist (MC-2). The connect
// routes send the person's own session instead. Writes carry an
// Idempotency-Key, and are retried once with the same key when api-edge
// could not be reached, so a retry never does the write twice.

import type { Env } from "./env.js";
import { randomToken } from "./http.js";

/** The host is never resolved: a service binding takes the path. */
const EDGE_BASE = "https://api-edge.internal";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface EdgeOk<T> {
  ok: true;
  status: number;
  data: T;
}

export interface EdgeError {
  ok: false;
  /** The HTTP status; 0 when api-edge could not be reached. */
  status: number;
  /** The envelope's `error.code` (errors.ts), or "internal_error". */
  code: string;
  message: string;
  /** `error.details.reason`, when there is one ("scope", "too_many_timers", …). */
  reason: string | null;
  /** `error.details.fields` of a 422. */
  fields: Record<string, string[]>;
  details: Record<string, unknown>;
}

export type EdgeResult<T> = EdgeOk<T> | EdgeError;

export interface EdgeCall {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  bearer: string;
  requestId: string;
}

export function edgeUrl(path: string, query?: EdgeCall["query"]): string {
  const url = new URL(path, EDGE_BASE);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function callEdge<T>(env: Env, call: EdgeCall): Promise<EdgeResult<T>> {
  const write = WRITE_METHODS.has(call.method);
  const headers = new Headers({
    authorization: `Bearer ${call.bearer}`,
    accept: "application/json",
    "x-request-id": call.requestId,
  });
  if (call.body !== undefined) headers.set("content-type", "application/json");
  if (write) headers.set("idempotency-key", `mcp_${randomToken(18)}`);
  const url = edgeUrl(call.path, call.query);
  const init = (): RequestInit => ({
    method: call.method,
    headers,
    ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
  });

  let response: Response | null = null;
  for (let attempt = 0; attempt < (write ? 2 : 1); attempt++) {
    try {
      response = await env.API_EDGE.fetch(url, init());
    } catch {
      response = null;
    }
    // Retry only what never reached a handler: no answer, or the edge's own 503.
    if (response && response.status !== 503) break;
  }
  if (!response) {
    return edgeError(0, "internal_error", "api-edge could not be reached", {});
  }
  return parseEdgeResponse<T>(response);
}

export async function parseEdgeResponse<T>(response: Response): Promise<EdgeResult<T>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const envelope = (typeof body === "object" && body !== null ? body : {}) as {
    data?: unknown;
    error?: { code?: unknown; message?: unknown; details?: unknown };
  };
  if (response.ok) {
    return { ok: true, status: response.status, data: envelope.data as T };
  }
  const err = envelope.error ?? {};
  const details = typeof err.details === "object" && err.details !== null ? (err.details as Record<string, unknown>) : {};
  return edgeError(
    response.status,
    typeof err.code === "string" ? err.code : "internal_error",
    typeof err.message === "string" ? err.message : `HTTP ${response.status}`,
    details,
  );
}

function edgeError(status: number, code: string, message: string, details: Record<string, unknown>): EdgeError {
  const fields: Record<string, string[]> = {};
  const raw = details.fields;
  if (typeof raw === "object" && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value)) fields[key] = value.filter((v): v is string => typeof v === "string");
    }
  }
  return {
    ok: false,
    status,
    code,
    message,
    reason: typeof details.reason === "string" ? details.reason : null,
    fields,
    details,
  };
}
