// The signed-out join preview at the edge (Cookpool SI-4):
// GET /v1/join/{code}/preview reaches membership-worker WITHOUT a session,
// behind the per-IP `join_preview` rate limit, with Cache-Control: no-store,
// and answers exactly three fields. Everything else under /v1/join… keeps
// requiring a session. Driven through the worker entrypoint, so the routing
// order in index.ts is what is tested, not a facade on its own.

import worker from "@api-edge/index";
import { isJoinPreviewRoute } from "@api-edge/join-preview-facade";
import { isJoinLinkRoute, isOrgRoute } from "@api-edge/org-facade";
import { isSoloSuppressed } from "@api-edge/solo-mode";
import {
  enforceRateLimit,
  __rateLimitConfigForTest,
  __resetRateLimitMemoryForTest,
} from "@api-edge/rate-limit";
import type { Env } from "@api-edge/env";
import { JOIN_PREVIEW_PUBLIC_KEYS } from "@saas/contracts/membership";

const ORG = "org_0123456789abcdef0123456789abcdef";
const CODE = "KTCH2345";
const PREVIEW = `/v1/join/${CODE}/preview`;
const ANSWER = { groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 5 };

interface Call {
  url: string;
  init: RequestInit;
}

/** identity-worker: resolves only `Bearer good-token`; every call recorded. */
function identity(calls: string[] = []): Fetcher {
  return {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      const auth = new Headers(init?.headers as HeadersInit).get("authorization");
      if (url.includes("/v1/auth/resolve") && auth === "Bearer good-token") {
        return Promise.resolve(
          Response.json({
            data: {
              actor: { actorType: "user", actorId: "usr_anu", email: "anu@test.com" },
              session: { id: "ses_abc" },
              user: { id: "usr_anu", email: "anu@test.com", displayName: "Anu" },
            },
            meta: { requestId: "req_inner", cursor: null },
          }),
        );
      }
      return Promise.resolve(
        Response.json({ error: { code: "unauthenticated", message: "Invalid session", details: {} } }, { status: 401 }),
      );
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
}

type Answer = { status?: number; body?: unknown; raw?: string; throws?: boolean };

/** membership-worker: answers `answer` (the preview by default); every call recorded. */
function membership(answer: Answer = {}): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init: init ?? {} });
      if (answer.throws) return Promise.reject(new Error("membership-worker is down"));
      if (answer.raw !== undefined) {
        return Promise.resolve(new Response(answer.raw, { status: answer.status ?? 200, headers: { "content-type": "application/json" } }));
      }
      const body = answer.body ?? { data: ANSWER, meta: { requestId: "req_m", cursor: null } };
      return Promise.resolve(
        Response.json(body, { status: answer.status ?? 200, headers: { "set-cookie": "leak=1", "x-internal": "yes" } }),
      );
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

function env(membershipWorker: Fetcher | null, extra: Record<string, unknown> = {}, identityCalls: string[] = []) {
  return {
    ENVIRONMENT: "test",
    IDENTITY_WORKER: identity(identityCalls),
    ...(membershipWorker ? { MEMBERSHIP_WORKER: membershipWorker } : {}),
    ...extra,
  };
}

function req(path: string, method = "GET", headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request(`https://api.cookpool.test${path}`, {
    method,
    headers: { "x-request-id": "req_edge", "CF-Connecting-IP": "203.0.113.7", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  __resetRateLimitMemoryForTest();
});

// ── Matching ────────────────────────────────────────────────────────────

describe("route matching", () => {
  it("claims exactly /v1/join/{code}/preview, and the org facade never sees it", () => {
    expect(isJoinPreviewRoute(PREVIEW)).toBe(true);
    expect(isJoinPreviewRoute("/v1/join/ktch-2345/preview")).toBe(true);
    expect(isJoinLinkRoute(PREVIEW)).toBe(false);
    expect(isOrgRoute(PREVIEW)).toBe(false);
  });

  it.each([
    `/v1/join/${CODE}/preview/`,
    `/v1/join/${CODE}/preview/extra`,
    `/v1/join/${CODE}/PREVIEW`,
    `/v1/join/${CODE}/previews`,
    `/v1/join/${CODE}/preview.json`,
    `/v1/join/${CODE}/x/preview`,
    "/v1/join//preview",
    "/v1/join/preview",
    `/v1//join/${CODE}/preview`,
    `/v1/join/${CODE}`,
    "/v1/join",
    `/v1/organizations/${ORG}/join-code`,
    `/v1/organizations/${ORG}/join-code/rotate`,
    `/v1/organizations/${ORG}/leave`,
    `/v1/organizations/${ORG}/join/${CODE}/preview`,
  ])("does not claim %s", (path) => {
    expect(isJoinPreviewRoute(path)).toBe(false);
  });
});

// ── Signed out, it answers ──────────────────────────────────────────────

describe("GET /v1/join/{code}/preview without a session", () => {
  it("answers 200 with exactly the three fields, no-store, and never resolves a session", async () => {
    const m = membership();
    const identityCalls: string[] = [];
    const res = await worker.fetch(req(PREVIEW), env(m.fetcher, {}, identityCalls) as never);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { data: Record<string, unknown>; meta: { requestId: string } };
    expect(Object.keys(body).sort()).toEqual(["data", "meta"]);
    expect(Object.keys(body.data).sort()).toEqual([...JOIN_PREVIEW_PUBLIC_KEYS].sort());
    expect(body.data).toEqual(ANSWER);
    expect(body.meta.requestId).toBe("req_edge");
    expect(identityCalls).toEqual([]);
  });

  it("forwards GET to membership-worker on the rebuilt path, with no credential, actor, query or body", async () => {
    const m = membership();
    const identityCalls: string[] = [];
    await worker.fetch(
      req(`${PREVIEW}?orgId=${ORG}&debug=1`, "GET", {
        authorization: "Bearer good-token",
        cookie: "session=abc",
        "x-actor-subject-id": "usr_admin",
        "x-actor-subject-type": "user",
        "x-actor-email": "admin@test.com",
        "idempotency-key": "k1",
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      }),
      env(m.fetcher, {}, identityCalls) as never,
    );

    expect(m.calls).toHaveLength(1);
    const call = m.calls[0]!;
    const url = new URL(call.url);
    expect(url.host).toBe("membership.internal");
    expect(url.pathname).toBe(PREVIEW);
    expect(url.search).toBe("");
    expect(call.init.method).toBe("GET");
    expect(call.init.body).toBeUndefined();
    const headers = new Headers(call.init.headers as HeadersInit);
    expect([...headers.keys()].sort()).toEqual(["traceparent", "x-request-id"]);
    expect(headers.get("x-request-id")).toBe("req_edge");
    // A valid token is not even looked at: nothing goes to identity-worker.
    expect(identityCalls).toEqual([]);
  });

  it("answers the same with a stale or garbage token", async () => {
    for (const authorization of ["Bearer expired-token", "Bearer ", "Basic Zm9vOmJhcg==", "nonsense"]) {
      const m = membership();
      const res = await worker.fetch(req(PREVIEW, "GET", { authorization }), env(m.fetcher) as never);
      expect(res.status).toBe(200);
      expect(m.calls).toHaveLength(1);
    }
  });

  it("re-picks the three fields, so extra fields from membership-worker never pass", async () => {
    const m = membership({
      body: {
        data: { ...ANSWER, orgId: ORG, slug: "flat-4b", ownerEmail: "anu@test.com", joinCode: CODE, subjectId: "usr_anu" },
        meta: { requestId: "req_m", cursor: null },
        debug: { members: ["usr_anu"] },
      },
    });
    const res = await worker.fetch(req(PREVIEW), env(m.fetcher) as never);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ data: ANSWER, meta: { requestId: "req_edge", cursor: null } });
    for (const leak of [ORG, "flat-4b", "anu@test.com", CODE, "usr_anu"]) expect(raw).not.toContain(leak);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-internal")).toBeNull();
  });

  it("accepts a null inviterFirstName", async () => {
    const m = membership({ body: { data: { ...ANSWER, inviterFirstName: null } } });
    const res = await worker.fetch(req(PREVIEW), env(m.fetcher) as never);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ ...ANSWER, inviterFirstName: null });
  });

  it.each([
    ["no data", { meta: {} }],
    ["a missing groupName", { data: { inviterFirstName: "Anu", memberCount: 5 } }],
    ["a numeric inviter", { data: { ...ANSWER, inviterFirstName: 7 } }],
    ["a negative count", { data: { ...ANSWER, memberCount: -1 } }],
    ["a fractional count", { data: { ...ANSWER, memberCount: 1.5 } }],
    ["an array", { data: [ANSWER] }],
  ])("answers 503 for a 200 with %s", async (_label, body) => {
    const m = membership({ body });
    const res = await worker.fetch(req(PREVIEW), env(m.fetcher) as never);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 for a 200 that is not JSON", async () => {
    const m = membership({ raw: "<html>oops</html>" });
    const res = await worker.fetch(req(PREVIEW), env(m.fetcher) as never);
    expect(res.status).toBe(503);
  });

  it("passes membership-worker's 404 through, no-store", async () => {
    const notFound = {
      error: { code: "not_found", message: "No group found for that join link", details: {}, requestId: "req_edge" },
    };
    const m = membership({ status: 404, body: notFound });
    const res = await worker.fetch(req("/v1/join/ZZZZ2345/preview"), env(m.fetcher) as never);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(notFound);
  });

  it("answers 503 when membership-worker is unbound or unreachable", async () => {
    const unbound = await worker.fetch(req(PREVIEW), env(null) as never);
    expect(unbound.status).toBe(503);
    expect(unbound.headers.get("cache-control")).toBe("no-store");
    const down = await worker.fetch(req(PREVIEW), env(membership({ throws: true }).fetcher) as never);
    expect(down.status).toBe(503);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("405s %s without calling membership-worker", async (method) => {
    const m = membership();
    const res = await worker.fetch(req(PREVIEW, method, {}, method === "DELETE" ? undefined : {}), env(m.fetcher) as never);
    expect(res.status).toBe(405);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(m.calls).toHaveLength(0);
  });

  it("forwards a %2F inside the code as part of the one segment, for membership-worker to refuse", async () => {
    const m = membership({ status: 404, body: { error: { code: "not_found" } } });
    const res = await worker.fetch(req("/v1/join/KTCH%2F2345/preview"), env(m.fetcher) as never);
    expect(res.status).toBe(404);
    expect(new URL(m.calls[0]!.url).pathname).toBe("/v1/join/KTCH%2F2345/preview");
  });
});

// ── Nothing else under /v1/join… comes through without a session ────────

describe("every other join route still needs a session", () => {
  const SESSION_ROUTES: Array<[string, string]> = [
    [`/v1/join/${CODE}`, "GET"],
    ["/v1/join", "POST"],
    [`/v1/organizations/${ORG}/join-code`, "GET"],
    [`/v1/organizations/${ORG}/join-code/rotate`, "POST"],
    [`/v1/organizations/${ORG}/leave`, "POST"],
  ];

  it.each(SESSION_ROUTES)("401s %s %s with no token, without reaching membership-worker", async (path, method) => {
    const m = membership();
    const res = await worker.fetch(req(path, method, {}, method === "POST" ? { code: CODE } : undefined), env(m.fetcher) as never);
    expect(res.status).toBe(401);
    expect(m.calls).toHaveLength(0);
  });

  it.each(SESSION_ROUTES)("401s %s %s with a token that does not resolve", async (path, method) => {
    const m = membership();
    const res = await worker.fetch(
      req(path, method, { authorization: "Bearer stale-token" }, method === "POST" ? { code: CODE } : undefined),
      env(m.fetcher) as never,
    );
    expect(res.status).toBe(401);
    expect(m.calls).toHaveLength(0);
  });

  it.each(SESSION_ROUTES)("still serves %s %s with a session, actor forwarded", async (path, method) => {
    const m = membership();
    const res = await worker.fetch(
      req(path, method, { authorization: "Bearer good-token" }, method === "POST" ? { code: CODE } : undefined),
      env(m.fetcher) as never,
    );
    expect(res.status).toBe(200);
    expect(new Headers(m.calls[0]!.init.headers as HeadersInit).get("x-actor-subject-id")).toBe("usr_anu");
  });

  // Paths near the preview: each lands on a session route (401) or on nothing
  // (404); none reaches membership-worker signed out. The URL parser resolves
  // dot segments (including %2e) before routing, which these pin.
  it.each([
    [`/v1/join/${CODE}/preview/`, 404],
    [`/v1/join/${CODE}/preview/extra`, 404],
    [`/v1/join/${CODE}/preview/${CODE}/preview`, 404],
    [`/v1/join/${CODE}/PREVIEW`, 404],
    [`/v1/join/${CODE}/previews`, 404],
    [`/v1/join/${CODE}/x/preview`, 404],
    ["/v1/join//preview", 404],
    [`/v1//join/${CODE}/preview`, 404],
    [`/v1/join/${CODE}/preview/..`, 404], // → /v1/join/KTCH2345/
    [`/v1/join/${CODE}/preview/.`, 404], // → /v1/join/KTCH2345/preview/
    ["/v1/join/%2e%2e/preview", 404], // → /v1/preview
    ["/v1/join/preview", 401], // the signed-in preview of a code "preview"
    [`/v1/join/x/../${CODE}`, 401], // → /v1/join/KTCH2345
    [`/v1/join/${CODE}/preview/../../${CODE}`, 401], // → /v1/join/KTCH2345
    [`/v1/join/${CODE}/%2e%2e`, 404], // → /v1/join/
    [`/v1/join/${CODE}/preview/%2e%2e/%2e%2e`, 404], // → /v1/join/
  ])("%s answers %s signed out, without reaching membership-worker", async (path, status) => {
    const m = membership();
    const res = await worker.fetch(req(path), env(m.fetcher) as never);
    expect(res.status).toBe(status);
    expect(m.calls).toHaveLength(0);
  });
});

// ── Rate limit ──────────────────────────────────────────────────────────

describe("the signed-out per-IP rate limit", () => {
  const LIMIT = __rateLimitConfigForTest.join_preview.identity.limit;

  it("has its own family, tighter than signed-in reads and looser than sign-in", () => {
    expect(LIMIT).toBeLessThan(__rateLimitConfigForTest.org.identity.limit);
    expect(LIMIT).toBeGreaterThan(__rateLimitConfigForTest.auth.identity.limit);
  });

  it(`admits ${LIMIT} a minute from one IP, then answers 429 no-store without reaching membership-worker`, async () => {
    const m = membership();
    const e = env(m.fetcher) as never;
    for (let i = 0; i < LIMIT; i++) {
      const res = await worker.fetch(req(PREVIEW), e);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit-identity")).toBe(String(LIMIT));
      // No org segment: no org bucket.
      expect(res.headers.get("X-RateLimit-Limit-org")).toBeNull();
    }
    const limited = await worker.fetch(req(PREVIEW), e);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(limited.headers.get("Retry-After")).not.toBeNull();
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect(m.calls).toHaveLength(LIMIT);
  });

  it("keys by IP even when a token is sent: a fresh token per request buys no fresh bucket", async () => {
    const m = membership();
    const e = env(m.fetcher) as never;
    for (let i = 0; i < LIMIT; i++) {
      await worker.fetch(req(PREVIEW, "GET", { authorization: `Bearer random-${i}` }), e);
    }
    const res = await worker.fetch(req(PREVIEW, "GET", { authorization: "Bearer good-token" }), e);
    expect(res.status).toBe(429);
  });

  it("keys anonymous traffic as anon:join_preview:<ip> whatever the Authorization header", async () => {
    const e = { ENVIRONMENT: "test" } as Env;
    const ip = "198.51.100.9";
    for (let i = 0; i < LIMIT; i++) {
      const r = await enforceRateLimit(
        new Request(`https://api.cookpool.test${PREVIEW}`, {
          headers: { "CF-Connecting-IP": ip, authorization: `Bearer t${i}` },
        }),
        `r${i}`,
        e,
        "join_preview",
      );
      expect(r.kind).toBe("allowed");
    }
    const denied = await enforceRateLimit(
      new Request(`https://api.cookpool.test${PREVIEW}`, { headers: { "CF-Connecting-IP": ip } }),
      "r_over",
      e,
      "join_preview",
    );
    expect(denied.kind).toBe("denied");
  });

  it("gives another IP its own bucket", async () => {
    const m = membership();
    const e = env(m.fetcher) as never;
    for (let i = 0; i < LIMIT; i++) await worker.fetch(req(PREVIEW), e);
    expect((await worker.fetch(req(PREVIEW), e)).status).toBe(429);
    const other = await worker.fetch(req(PREVIEW, "GET", { "CF-Connecting-IP": "203.0.113.8" }), e);
    expect(other.status).toBe(200);
  });

  it("does not share a bucket with sign-in: a spent preview budget leaves auth reads alone", async () => {
    const m = membership();
    const e = env(m.fetcher) as never;
    for (let i = 0; i < LIMIT; i++) await worker.fetch(req(PREVIEW), e);
    expect((await worker.fetch(req(PREVIEW), e)).status).toBe(429);
    const providers = await worker.fetch(req("/v1/auth/oauth/providers"), e);
    expect(providers.status).not.toBe(429);
  });

  it("still keys signed-in families by token", async () => {
    const e = { ENVIRONMENT: "test" } as Env;
    const path = `/v1/organizations/${ORG}/members`;
    const limit = __rateLimitConfigForTest.org.identity.limit;
    for (let i = 0; i < limit; i++) {
      await enforceRateLimit(
        new Request(`https://api.cookpool.test${path}`, { headers: { "CF-Connecting-IP": "192.0.2.1", authorization: "Bearer a" } }),
        `r${i}`,
        e,
        "org",
      );
    }
    const otherToken = await enforceRateLimit(
      new Request(`https://api.cookpool.test${path}`, { headers: { "CF-Connecting-IP": "192.0.2.1", authorization: "Bearer b" } }),
      "r_b",
      e,
      "org",
    );
    expect(otherToken.kind).toBe("allowed");
  });
});

// ── Solo profile ────────────────────────────────────────────────────────

describe("the Solo profile", () => {
  it("hides the signed-out preview with the other join routes", async () => {
    expect(isSoloSuppressed(PREVIEW, "GET")).toBe(true);
    const m = membership();
    const res = await worker.fetch(req(PREVIEW), env(m.fetcher, { SOLO_MODE: "true" }) as never);
    expect(res.status).toBe(404);
    expect(m.calls).toHaveLength(0);
  });

  it("serves it with SOLO_MODE off (Cookpool)", async () => {
    const m = membership();
    const res = await worker.fetch(req(PREVIEW), env(m.fetcher, { SOLO_MODE: "false" }) as never);
    expect(res.status).toBe(200);
  });
});
