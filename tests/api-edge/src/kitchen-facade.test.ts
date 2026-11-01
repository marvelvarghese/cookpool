// Cookpool's kitchen at the edge (CP-4): `/v1/kitchen/…` and
// `/v1/organizations/{org}/kitchen/…` reach kitchen-worker through the kitchen
// facade — session resolved, actor forwarded, bodies on POST/PATCH/PUT, the
// shared rate-limit and idempotency gate. Driven through the worker
// entrypoint, so no other facade can claim the paths first.

import worker from "@api-edge/index";
import { isKitchenRoute } from "@api-edge/kitchen-facade";
import { isOrgRoute } from "@api-edge/org-facade";
import { isProjectRoute } from "@api-edge/project-facade";
import { __rateLimitConfigForTest } from "@api-edge/rate-limit";

const ORG = "org_0123456789abcdef0123456789abcdef";
const SETTINGS = `/v1/organizations/${ORG}/kitchen/settings`;

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

function kitchen(status = 200, payload: unknown = { data: { ok: true }, meta: { requestId: "req_k", cursor: null } }) {
  const calls: Call[] = [];
  const fetcher = {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(Response.json(payload, { status }));
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

function env(kitchenWorker: Fetcher | undefined, extra: Record<string, unknown> = {}) {
  return { ENVIRONMENT: "test", IDENTITY_WORKER: identity(), KITCHEN_WORKER: kitchenWorker, ...extra };
}

function req(
  path: string,
  method: string,
  opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {},
): Request {
  const headers: Record<string, string> = { "x-request-id": "req_edge", ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers.authorization = "Bearer sps_ses_abc.secret";
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://api.cookpool.test${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe("kitchen route matching", () => {
  it.each([
    "/v1/kitchen",
    "/v1/kitchen/me/pantries",
    "/v1/kitchen/me/items/itm_1/uses",
    `/v1/organizations/${ORG}/kitchen`,
    SETTINGS,
    `/v1/organizations/${ORG}/kitchen/dishes/dsh_1/claims/me`,
  ])("%s is a kitchen route, and no other facade's", (path) => {
    expect(isKitchenRoute(path)).toBe(true);
    expect(isOrgRoute(path)).toBe(false);
    expect(isProjectRoute(path)).toBe(false);
  });

  it.each([
    "/v1/kitchens",
    "/v1/kitchenette/x",
    "/v1/organizations/kitchen",
    `/v1/organizations/${ORG}`,
    `/v1/organizations/${ORG}/kitchens`,
    `/v1/organizations/${ORG}/projects`,
    `/v1/organizations/${ORG}/projects/prj_1/kitchen`,
    `/v2/organizations/${ORG}/kitchen/settings`,
  ])("does not match %s", (path) => {
    expect(isKitchenRoute(path)).toBe(false);
  });
});

describe("kitchen routes through the edge", () => {
  it("forwards a read to KITCHEN_WORKER with the resolved actor, path and query", async () => {
    const k = kitchen();
    const res = await worker.fetch(req(`/v1/kitchen/me/items?pantry=all&q=milk`, "GET"), env(k.fetcher) as never);

    expect(res.status).toBe(200);
    expect(k.calls).toHaveLength(1);
    const call = k.calls[0]!;
    const url = new URL(call.url);
    expect(url.host).toBe("kitchen.internal");
    expect(url.pathname).toBe("/v1/kitchen/me/items");
    expect(url.search).toBe("?pantry=all&q=milk");
    expect(call.init.method).toBe("GET");
    expect(call.init.body).toBeUndefined();
    const headers = new Headers(call.init.headers as HeadersInit);
    expect(headers.get("x-actor-subject-id")).toBe("usr_anu");
    expect(headers.get("x-actor-subject-type")).toBe("user");
    expect(headers.get("x-actor-email")).toBe("anu@test.com");
    expect(headers.get("x-request-id")).toBe("req_edge");
    expect(headers.get("authorization")).toBeNull();
  });

  it.each(["POST", "PATCH", "PUT"])("forwards the body of a %s", async (method) => {
    const k = kitchen();
    const res = await worker.fetch(req(SETTINGS, method, { body: { wastePolicy: "buyer_absorbs" } }), env(k.fetcher) as never);
    expect(res.status).toBe(200);
    expect(k.calls[0]!.init.method).toBe(method);
    expect(await new Response(k.calls[0]!.init.body as BodyInit).json()).toEqual({ wastePolicy: "buyer_absorbs" });
    expect(new Headers(k.calls[0]!.init.headers as HeadersInit).get("content-type")).toBe("application/json");
  });

  it("forwards a DELETE without a body", async () => {
    const k = kitchen();
    await worker.fetch(req(`/v1/organizations/${ORG}/kitchen/items/itm_1`, "DELETE"), env(k.fetcher) as never);
    expect(k.calls[0]!.init.method).toBe("DELETE");
    expect(k.calls[0]!.init.body).toBeUndefined();
  });

  it("passes kitchen-worker's answer through unchanged, errors included", async () => {
    const k = kitchen(409, {
      error: { code: "conflict", message: "locked", details: { reason: "currency_locked", currency: "INR" }, requestId: "req_k" },
    });
    const res = await worker.fetch(req(SETTINGS, "PATCH", { body: { currency: "USD" } }), env(k.fetcher) as never);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { details: Record<string, unknown> } };
    expect(body.error.details).toEqual({ reason: "currency_locked", currency: "INR" });
  });

  it("adds the edge's phases to Server-Timing", async () => {
    const k = kitchen();
    const res = await worker.fetch(req(SETTINGS, "GET"), env(k.fetcher) as never);
    expect(res.headers.get("server-timing") ?? "").toContain("edge_downstream");
  });

  it("405s a method it does not route, without calling kitchen-worker", async () => {
    const k = kitchen();
    const res = await worker.fetch(req(SETTINGS, "PURGE"), env(k.fetcher) as never);
    expect(res.status).toBe(405);
    expect(k.calls).toHaveLength(0);
  });

  it("401s without a session, without calling kitchen-worker", async () => {
    const k = kitchen();
    const res = await worker.fetch(req(SETTINGS, "GET", { auth: false }), env(k.fetcher) as never);
    expect(res.status).toBe(401);
    expect(k.calls).toHaveLength(0);
  });

  it("503s when KITCHEN_WORKER is not bound", async () => {
    const res = await worker.fetch(req(SETTINGS, "GET"), env(undefined) as never);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({ code: "internal_error", message: "Kitchen service unavailable" });
  });

  it("forwards a well-formed Idempotency-Key", async () => {
    const k = kitchen();
    await worker.fetch(
      req(SETTINGS, "PATCH", { body: { wastePolicy: "split_equally" }, headers: { "idempotency-key": "settings-1" } }),
      env(k.fetcher) as never,
    );
    expect(new Headers(k.calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("settings-1");
  });

  it("rejects a malformed Idempotency-Key before reaching kitchen-worker", async () => {
    const k = kitchen();
    const res = await worker.fetch(
      req(SETTINGS, "PATCH", { body: { wastePolicy: "split_equally" }, headers: { "idempotency-key": "k".repeat(256) } }),
      env(k.fetcher) as never,
    );
    expect(res.status).toBe(400);
    expect(k.calls).toHaveLength(0);
  });

  it("is served with the Solo profile off (Cookpool)", async () => {
    const k = kitchen();
    const res = await worker.fetch(req(SETTINGS, "GET"), env(k.fetcher, { SOLO_MODE: "false" }) as never);
    expect(res.status).toBe(200);
    expect(k.calls).toHaveLength(1);
  });

  it("has its own rate-limit family", () => {
    expect(__rateLimitConfigForTest.kitchen.identity.limit).toBeGreaterThan(0);
    expect(__rateLimitConfigForTest.kitchen.org.limit).toBeGreaterThan(0);
  });
});
