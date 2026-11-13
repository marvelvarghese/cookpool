// Tripeco at the edge (tripeco TR-2): `/v1/tripeco/…` reaches tripeco-worker
// through its facade — session resolved, actor forwarded, bodies on
// POST/PATCH, the shared rate-limit and idempotency gate — and a delegated
// token reaches none of it. The edge never forwards `x-tripeco-ride`, so no
// client can unlock a ride's row in Spliteco (design §0.4).

import worker from "@api-edge/index";
import { isTripecoRoute } from "@api-edge/tripeco-facade";
import { isSplitecoRoute } from "@api-edge/spliteco-facade";
import { TRUSTED_CALLERS } from "@api-edge/client-ip";

interface Call {
  url: string;
  init: RequestInit;
}

function identity(userId = "usr_anu"): Fetcher {
  return {
    fetch(input: string | Request | URL): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/v1/auth/resolve")) {
        return Promise.resolve(
          Response.json({
            data: {
              actor: { actorType: "user", actorId: userId, email: "anu@test.com" },
              session: { id: "ses_abc" },
              user: { id: userId, email: "anu@test.com", displayName: "Anu" },
            },
            meta: { requestId: "req_inner", cursor: null },
          }),
        );
      }
      return Promise.resolve(Response.json({ error: { code: "not_found" } }, { status: 404 }));
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
}

function tripeco(status = 200) {
  const calls: Call[] = [];
  const fetcher = {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(Response.json({ data: { ok: true }, meta: { requestId: "req_t", cursor: null } }, { status }));
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

const env = (w: Fetcher | undefined) => ({ ENVIRONMENT: "test", IDENTITY_WORKER: identity(), TRIPECO_WORKER: w });

function req(path: string, method: string, opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}): Request {
  const headers: Record<string, string> = { "x-request-id": "req_edge", ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers.authorization = "Bearer sps_ses_abc.secret";
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://api.cookpool.test${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
}

const TRP = `trp_${"a".repeat(32)}`;

describe("tripeco route matching", () => {
  it.each(["/v1/tripeco", "/v1/tripeco/me", `/v1/tripeco/rides/${TRP}/photos`])("%s is Tripeco's", (path) => {
    expect(isTripecoRoute(path)).toBe(true);
    expect(isSplitecoRoute(path)).toBe(false);
  });
  it.each(["/v1/tripecox", "/v1/spliteco/me/home"])("%s is not", (path) => {
    expect(isTripecoRoute(path)).toBe(false);
  });
});

describe("the tripeco facade", () => {
  it("forwards the actor, the path and query, and a PATCH's body and idempotency key — never x-tripeco-ride", async () => {
    const s = tripeco();
    const res = await worker.fetch(
      req(`/v1/tripeco/rides/${TRP}?x=1`, "PATCH", { body: { endKm: 48336 }, headers: { "idempotency-key": "ikey_tripeco_1", "x-tripeco-ride": TRP } }),
      env(s.fetcher) as never,
    );
    expect(res.status).toBe(200);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe(`https://tripeco.internal/v1/tripeco/rides/${TRP}?x=1`);
    const headers = new Headers(s.calls[0]!.init.headers);
    expect(headers.get("x-actor-subject-id")).toBe("usr_anu");
    expect(headers.get("idempotency-key")).toBe("ikey_tripeco_1");
    expect(headers.get("x-tripeco-ride")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("answers 401 without a session and 503 without the binding", async () => {
    const s = tripeco();
    expect((await worker.fetch(req("/v1/tripeco/me", "GET", { auth: false }), env(s.fetcher) as never)).status).toBe(401);
    expect((await worker.fetch(req("/v1/tripeco/me", "GET"), env(undefined) as never)).status).toBe(503);
    expect(s.calls).toHaveLength(0);
  });

  it("refuses a delegated token every route, before the worker is asked", async () => {
    const s = tripeco();
    for (const [path, method] of [
      ["/v1/tripeco/me", "GET"],
      ["/v1/tripeco/vehicles", "POST"],
      [`/v1/tripeco/rides/${TRP}`, "PATCH"],
    ] as const) {
      const res = await worker.fetch(req(path, method, { auth: false, ...(method === "GET" ? {} : { body: {} }), headers: { authorization: `Bearer sps_dlg_${"0".repeat(32)}.secret` } }), env(s.fetcher) as never);
      expect([path, res.status]).toEqual([path, 403]);
    }
    expect(s.calls).toHaveLength(0);
  });

  it("trusts the Tripeco app's binding like Spliteco's", () => {
    expect(TRUSTED_CALLERS).toContain("tripeco-web");
  });
});
