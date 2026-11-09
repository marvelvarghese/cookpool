// Fakes for mcp-worker's tests: an in-memory KV, a fake api-edge and a fake
// identity-worker, and a driver for the whole OAuth flow. Nothing here
// reaches a network; no real client, token or account is involved.

import worker from "@mcp-worker/index";
import type { Env } from "@mcp-worker/env";

export const ORIGIN = "https://mcp.test";
export const CONSOLE = "https://console.test";
export const REDIRECT = "https://assistant.test/callback";

// ── KV ─────────────────────────────────────────────────────

interface Entry {
  value: string;
  expiresAt: number | null;
  metadata: unknown;
}

export class MemoryKV {
  readonly entries = new Map<string, Entry>();
  now = (): number => Date.now();

  private live(key: string): Entry | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return e;
  }

  async get(key: string, options?: unknown): Promise<unknown> {
    const e = this.live(key);
    if (!e) return null;
    const type = typeof options === "string" ? options : (options as { type?: string } | undefined)?.type;
    return type === "json" ? JSON.parse(e.value) : e.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number; metadata?: unknown },
  ): Promise<void> {
    const expiresAt = options?.expirationTtl
      ? this.now() + options.expirationTtl * 1000
      : options?.expiration
        ? options.expiration * 1000
        : null;
    this.entries.set(key, { value: String(value), expiresAt, metadata: options?.metadata ?? null });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix ?? "";
    const names = [...this.entries.keys()].filter((k) => k.startsWith(prefix) && this.live(k)).sort();
    const start = options?.cursor ? Number(options.cursor) : 0;
    const limit = options?.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return {
      keys: page.map((name) => {
        const e = this.entries.get(name)!;
        return {
          name,
          ...(e.expiresAt !== null ? { expiration: Math.floor(e.expiresAt / 1000) } : {}),
          ...(e.metadata !== null ? { metadata: e.metadata } : {}),
        };
      }),
      list_complete: done,
      ...(done ? {} : { cursor: String(start + limit) }),
    };
  }

  keysWith(prefix: string): string[] {
    return [...this.entries.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ── api-edge and identity ──────────────────────────────────

export interface Recorded {
  method: string;
  path: string;
  search: URLSearchParams;
  headers: Headers;
  body: unknown;
}

export type Route = (req: Recorded) => Response | Promise<Response>;

export function ok(data: unknown, status = 200): Response {
  return Response.json({ data, meta: { requestId: "req_test", cursor: null } }, { status });
}

export function fail(status: number, code: string, details: Record<string, unknown> = {}, message = code): Response {
  return Response.json({ error: { code, message, details, requestId: "req_test" } }, { status });
}

/** A fake service: routes by "METHOD /path", records every call. */
export class FakeService {
  readonly calls: Recorded[] = [];
  readonly routes = new Map<string, Route>();
  /** Answered for any route not set: a 404. */
  fallback: Route = () => fail(404, "not_found");

  on(key: string, route: Route): this {
    this.routes.set(key, route);
    return this;
  }

  readonly fetcher = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = new Request(input as string, init);
      const url = new URL(req.url);
      const text = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
      const recorded: Recorded = {
        method: req.method,
        path: url.pathname,
        search: url.searchParams,
        headers: req.headers,
        body: text ? JSON.parse(text) : undefined,
      };
      this.calls.push(recorded);
      const exact = this.routes.get(`${req.method} ${url.pathname}`);
      if (exact) return exact(recorded);
      for (const [key, route] of this.routes) {
        const [method, pattern] = key.split(" ");
        if (method === req.method && pattern!.endsWith("*") && url.pathname.startsWith(pattern!.slice(0, -1))) return route(recorded);
      }
      return this.fallback(recorded);
    },
  } as unknown as Fetcher;

  last(path?: string): Recorded {
    const list = path ? this.calls.filter((c) => c.path === path) : this.calls;
    const call = list[list.length - 1];
    if (!call) throw new Error(`no call${path ? ` to ${path}` : ""}`);
    return call;
  }
}

// ── the person, their session and their delegation ─────────

export const USER = "usr_0123456789abcdef0123456789abcdef";
export const SESSION = "sps_ses_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.sessionsecret";
export const DLG_HEX = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const DELEGATION = `dlg_${DLG_HEX}`;
export const DELEGATED = `sps_dlg_${DLG_HEX}.delegatedsecret`;

export interface World {
  env: Env;
  kv: MemoryKV;
  edge: FakeService;
  identity: FakeService;
  /** What GET /v1/auth/delegations answers (mutable). */
  delegations: Array<Record<string, unknown>>;
}

export function world(): World {
  const kv = new MemoryKV();
  const edge = new FakeService();
  const identity = new FakeService();
  const delegations: Array<Record<string, unknown>> = [];
  edge.on("GET /v1/auth/session", (req) =>
    req.headers.get("authorization") === `Bearer ${SESSION}`
      ? ok({ session: { id: "ses_1" }, user: { id: USER, email: "cook@cookpool.test" } })
      : fail(401, "unauthenticated"),
  );
  edge.on("GET /v1/auth/delegations", (req) =>
    req.headers.get("authorization") === `Bearer ${SESSION}` ? ok({ delegations }) : fail(401, "unauthenticated"),
  );
  edge.on("DELETE /v1/auth/delegations/*", (req) => {
    const id = req.path.split("/").pop();
    const d = delegations.find((x) => x.id === id && x.revokedAt === null);
    if (!d) return fail(404, "not_found");
    d.revokedAt = new Date().toISOString();
    return ok({ delegation: d });
  });
  const env = {
    MCP_OAUTH_KV: kv as unknown as KVNamespace,
    API_EDGE: edge.fetcher,
    IDENTITY_WORKER: identity.fetcher,
    ENVIRONMENT: "test",
    CONSOLE_ORIGIN: CONSOLE,
    MCP_PUBLIC_ORIGIN: ORIGIN,
  } as Env;
  return { env, kv, edge, identity, delegations };
}

export function addDelegation(
  w: World,
  clientId: string,
  scopes: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const d = {
    id: DELEGATION,
    clientId,
    clientName: "Test assistant",
    scopes,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    revokedAt: null,
    ...overrides,
  };
  w.delegations.push(d);
  return d;
}

// ── driving the worker ─────────────────────────────────────

const ctx = (): ExecutionContext =>
  ({ waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} }) as unknown as ExecutionContext;

export function call(w: World, path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), w.env, ctx());
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function register(w: World, body: Record<string, unknown> = {}): Promise<string> {
  const res = await call(w, "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Test assistant", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", ...body }),
  });
  if (res.status !== 201) throw new Error(`register: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

export const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-and-some-more";

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

export async function authorizeUrl(clientId: string, extra: Record<string, string | null> = {}): Promise<string> {
  const params: Record<string, string | null> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: "st4te",
    scope: "kitchen.read timers.write",
    resource: `${ORIGIN}/mcp`,
    code_challenge: await challengeOf(VERIFIER),
    code_challenge_method: "S256",
    ...extra,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null) q.set(k, v);
  return `/authorize?${q.toString()}`;
}

/** /authorize → the console's /connect?req= ; returns the req id. */
export async function startAuthorize(w: World, clientId: string): Promise<string> {
  const res = await call(w, await authorizeUrl(clientId));
  if (res.status !== 302) throw new Error(`authorize: ${res.status} ${await res.text()}`);
  const to = new URL(res.headers.get("location")!);
  if (to.origin !== CONSOLE || to.pathname !== "/connect") throw new Error(`authorize went to ${to}`);
  return to.searchParams.get("req")!;
}

export function completeConnect(w: World, req: string, body: Record<string, unknown> = {}, bearer = SESSION): Promise<Response> {
  return call(w, "/connect/complete", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, origin: CONSOLE },
    body: JSON.stringify({ req, delegationId: DELEGATION, token: DELEGATED, ...body }),
  });
}

export async function exchangeCode(w: World, clientId: string, code: string, verifier = VERIFIER): Promise<Response> {
  return call(w, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }).toString(),
  });
}

export interface Connected {
  clientId: string;
  accessToken: string;
  refreshToken: string;
}

/** register → authorize → connect/complete → token, with the given scopes allowed. */
export async function connect(w: World, scopes: string[]): Promise<Connected> {
  const clientId = await register(w);
  addDelegation(w, clientId, scopes);
  const req = await startAuthorize(w, clientId);
  const done = await completeConnect(w, req);
  if (done.status !== 200) throw new Error(`complete: ${done.status} ${await done.text()}`);
  const { redirectTo } = ((await done.json()) as { data: { redirectTo: string } }).data;
  const code = new URL(redirectTo).searchParams.get("code")!;
  const tok = await exchangeCode(w, clientId, code);
  if (tok.status !== 200) throw new Error(`token: ${tok.status} ${await tok.text()}`);
  const body = (await tok.json()) as { access_token: string; refresh_token: string };
  return { clientId, accessToken: body.access_token, refreshToken: body.refresh_token };
}

let rpcId = 0;

/** One JSON-RPC call to /mcp (stateless: no session header). */
export async function rpc(w: World, accessToken: string | null, method: string, params?: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return call(w, "/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params === undefined ? {} : { params }) }),
  });
}

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

export async function listTools(w: World, accessToken: string): Promise<string[]> {
  const res = await rpc(w, accessToken, "tools/list");
  const body = (await res.json()) as { result?: { tools: Array<{ name: string }> }; error?: unknown };
  if (!body.result) throw new Error(`tools/list: ${JSON.stringify(body)}`);
  return body.result.tools.map((t) => t.name);
}

export async function callTool(w: World, accessToken: string, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const res = await rpc(w, accessToken, "tools/call", { name, arguments: args });
  const body = (await res.json()) as { result?: ToolResult; error?: { message: string } };
  if (!body.result) throw new Error(`tools/call ${name}: ${JSON.stringify(body)}`);
  return body.result;
}

/** The compact JSON block of a successful tool result. */
export function dataOf<T = Record<string, unknown>>(result: ToolResult): T {
  return JSON.parse(result.content[1]!.text) as T;
}
