// Shared by the delegated-token edge tests (cookpool-mcp MC-2): a fake
// identity-worker that resolves tokens from a table, recording fakes for every
// other binding, and a request builder. Driven through the worker entrypoint.

import worker from "@api-edge/index";
import type { Env } from "@api-edge/env";

export const ORG = "org_0123456789abcdef0123456789abcdef";
export const USER = "usr_0123456789abcdef0123456789abcdef";
export const DLG = "dlg_0123456789abcdef0123456789abcdef";
export const ALL_SCOPES = ["kitchen.read", "money.read", "timers.write", "suggest.write"];

export const SESSION_TOKEN = "sps_ses_0123456789abcdef0123456789abcdef.secret";
export const delegatedToken = (n = 0) => `sps_dlg_${String(n).padStart(32, "0")}.secret`;

export interface Recorded {
  binding: string;
  url: string;
  headers: Headers;
}

/** What /v1/auth/resolve answers for a token: an actor (with or without a delegation), or a refusal. */
export type Resolution =
  | { actor: Record<string, unknown> }
  | { status: number };

export function delegatedActor(scopes: string[], id = DLG): Resolution {
  return {
    actor: {
      actorType: "user",
      actorId: USER,
      email: "anu@cookpool.test",
      delegation: { id, scopes, clientName: "Claude" },
    },
  };
}

export const sessionActor: Resolution = {
  actor: { actorType: "user", actorId: USER, email: "anu@cookpool.test" },
};

const BINDINGS = [
  "MEMBERSHIP_WORKER",
  "PROJECTS_WORKER",
  "EVENTS_WORKER",
  "CONFIG_WORKER",
  "WEBHOOKS_WORKER",
  "METERING_WORKER",
  "BILLING_WORKER",
  "NOTIFICATIONS_WORKER",
  "INTEGRATIONS_WORKER",
  "KITCHEN_WORKER",
] as const;

function urlOf(input: string | Request | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

export interface Edge {
  env: Env;
  /** Every call to a worker other than identity's resolve. */
  forwarded: Recorded[];
  /** How many times /v1/auth/resolve was asked. */
  resolves: () => number;
  tokens: Map<string, Resolution>;
  fetch(path: string, method: string, opts?: { token?: string | null; authorization?: string; headers?: Record<string, string> }): Promise<Response>;
}

export function edge(tokens: Record<string, Resolution> = {}): Edge {
  const forwarded: Recorded[] = [];
  const table = new Map(Object.entries(tokens));
  let resolves = 0;

  const recording = (binding: string): Fetcher =>
    ({
      fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
        forwarded.push({ binding, url: urlOf(input), headers: new Headers(init?.headers) });
        return Promise.resolve(Response.json({ data: { ok: true }, meta: { requestId: "req_down", cursor: null } }));
      },
      connect() {
        throw new Error("not implemented");
      },
    }) as unknown as Fetcher;

  const identity = {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = urlOf(input);
      if (!url.includes("/v1/auth/resolve")) {
        forwarded.push({ binding: "IDENTITY_WORKER", url, headers: new Headers(init?.headers) });
        return Promise.resolve(Response.json({ data: { ok: true }, meta: { requestId: "req_id", cursor: null } }));
      }
      resolves += 1;
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const found = table.get(auth.replace(/^Bearer\s+/, "").trim());
      if (!found || "status" in found) {
        return Promise.resolve(Response.json({ error: { code: "unauthenticated" } }, { status: found?.status ?? 401 }));
      }
      return Promise.resolve(Response.json({ data: { actor: found.actor }, meta: { requestId: "req_id", cursor: null } }));
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;

  const env = { ENVIRONMENT: "test", IDENTITY_WORKER: identity } as Record<string, unknown>;
  for (const b of BINDINGS) env[b] = recording(b);

  return {
    env: env as unknown as Env,
    forwarded,
    resolves: () => resolves,
    tokens: table,
    fetch(path, method, opts = {}) {
      const headers: Record<string, string> = { "x-request-id": "req_edge", ...(opts.headers ?? {}) };
      if (opts.authorization !== undefined) headers.authorization = opts.authorization;
      else if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? delegatedToken()}`;
      const withBody = method === "POST" || method === "PUT" || method === "PATCH";
      if (withBody) headers["content-type"] = "application/json";
      const request = new Request(`https://api.cookpool.test${path}`, {
        method,
        headers,
        ...(withBody ? { body: JSON.stringify({}) } : {}),
      });
      return worker.fetch(request, env as unknown as Env);
    },
  };
}

export async function reasonOf(res: Response): Promise<{ status: number; code: string | undefined; reason: unknown }> {
  const json = (await res.clone().json().catch(() => ({}))) as { error?: { code?: string; details?: { reason?: unknown } } };
  return { status: res.status, code: json.error?.code, reason: json.error?.details?.reason };
}
