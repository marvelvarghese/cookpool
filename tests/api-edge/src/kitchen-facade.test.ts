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
    // Profiles and following (CM-2): forwarded with no edge change.
    "/v1/kitchen/handles/meeracooks",
    "/v1/kitchen/profiles/meeracooks/followers",
    "/v1/kitchen/people/search",
    "/v1/kitchen/me/follows/meeracooks",
    // Posts, the feed, reactions and Activity (CM-3): forwarded with no edge change.
    "/v1/kitchen/me/posts",
    "/v1/kitchen/me/posts/pst_1/restore",
    "/v1/kitchen/posts/pst_1/comments",
    "/v1/kitchen/comments/cmt_1",
    "/v1/kitchen/reports",
    "/v1/kitchen/me/feed",
    "/v1/kitchen/me/activity/unread",
    // Cooked, then split later (CM-8): forwarded with no edge change.
    "/v1/kitchen/me/dishes/dsh_1/split",
    "/v1/kitchen/me/dishes/dsh_1/split-reminder/dismiss",
    "/v1/kitchen/me/dishes/dsh_1/split-reminder/restore",
    // Cookpool AI (AI-2): the status read and sentence parsing, with no edge change.
    "/v1/kitchen/me/ai",
    "/v1/kitchen/me/ai/uses",
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

// ── kitchen-worker's internal routes are not public (CP-19) ─────
//
// GET /v1/internal/kitchen/organizations/{org}/subjects/{usr}/balance is for
// membership-worker over its service binding only. The edge must never hand
// it to kitchen-worker: no facade matches /v1/internal/…, dot segments are
// resolved before matching, an encoded slash stays inside a /v1/kitchen/…
// path (which kitchen-worker matches literally), and the header the internal
// route trusts is never forwarded.

describe("kitchen-worker's internal routes through the edge", () => {
  const BALANCE = `/v1/internal/kitchen/organizations/${ORG}/subjects/usr_anu/balance`;

  it.each([
    BALANCE,
    `/v1/internal/kitchen/organizations/${ORG}/subjects/usr_anu`,
    "/v1/internal/kitchen",
    `/v1/kitchen/../internal/kitchen/organizations/${ORG}/subjects/usr_anu/balance`,
    `/v1/kitchen/%2e%2e/internal/kitchen/organizations/${ORG}/subjects/usr_anu/balance`,
    `/v1/organizations/${ORG}/kitchen/../../../internal/kitchen/organizations/${ORG}/subjects/usr_anu/balance`,
  ])("404s %s without calling kitchen-worker", async (path) => {
    for (const method of ["GET", "POST"]) {
      const k = kitchen();
      const res = await worker.fetch(
        req(path, method, { headers: { "x-internal-actor": "membership-worker" } }),
        env(k.fetcher) as never,
      );
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
      expect(k.calls).toHaveLength(0);
    }
  });

  it("matches no facade", () => {
    expect(isKitchenRoute(BALANCE)).toBe(false);
    expect(isOrgRoute(BALANCE)).toBe(false);
    expect(isProjectRoute(BALANCE)).toBe(false);
  });

  it("keeps an encoded slash inside the /v1/kitchen/… path it forwards", async () => {
    const k = kitchen();
    await worker.fetch(
      req(`/v1/kitchen/me%2F..%2F..%2Finternal%2Fkitchen%2Forganizations%2F${ORG}%2Fsubjects%2Fusr_anu%2Fbalance`, "GET"),
      env(k.fetcher) as never,
    );
    expect(k.calls).toHaveLength(1);
    expect(new URL(k.calls[0]!.url).pathname.startsWith("/v1/kitchen/me%2F")).toBe(true);
  });

  it("never forwards x-internal-actor, the header kitchen-worker's internal routes trust", async () => {
    const k = kitchen();
    await worker.fetch(req("/v1/kitchen/me/inbox", "GET", { headers: { "x-internal-actor": "membership-worker" } }), env(k.fetcher) as never);
    expect(k.calls).toHaveLength(1);
    expect(new Headers(k.calls[0]!.init.headers as HeadersInit).get("x-internal-actor")).toBeNull();
  });
});
