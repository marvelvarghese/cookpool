// Join links (Cookpool CP-3) at the edge: `/v1/join`, `/v1/join/{code}` and the
// org sub-resources `join-code`, `join-code/rotate` and `leave` reach
// membership-worker through the org facade — session resolved, actor forwarded,
// one method each, idempotency on the POSTs — and only the Solo profile hides
// them. Driven through the worker entrypoint, so no other facade can claim the
// paths first.

import worker from "@api-edge/index";
import { isOrgRoute, isJoinLinkRoute } from "@api-edge/org-facade";
import { isSoloSuppressed } from "@api-edge/solo-mode";

const ORG = "org_0123456789abcdef0123456789abcdef";

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

function membership(status = 200, data: unknown = { ok: true }): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(Response.json({ data, meta: { requestId: "req_m", cursor: null } }, { status }));
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

function env(membershipWorker: Fetcher, extra: Record<string, unknown> = {}) {
  return { ENVIRONMENT: "test", IDENTITY_WORKER: identity(), MEMBERSHIP_WORKER: membershipWorker, ...extra };
}

function req(path: string, method: string, opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}): Request {
  const headers: Record<string, string> = { "x-request-id": "req_edge", ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers.authorization = "Bearer sps_ses_abc.secret";
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://api.cookpool.test${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

const ROUTES: Array<[string, string]> = [
  ["/v1/join", "POST"],
  ["/v1/join/KTCH2345", "GET"],
  [`/v1/organizations/${ORG}/join-code`, "GET"],
  [`/v1/organizations/${ORG}/join-code/rotate`, "POST"],
  [`/v1/organizations/${ORG}/leave`, "POST"],
];

describe("join-link route matching", () => {
  it.each(ROUTES)("%s is an org-facade route", (path) => {
    expect(isJoinLinkRoute(path)).toBe(true);
    expect(isOrgRoute(path)).toBe(true);
  });

  it.each([
    "/v1/joins",
    "/v1/join/KTCH2345/extra",
    "/v1/join/",
    `/v1/organizations/${ORG}/join-code/rotate/now`,
    `/v1/organizations/${ORG}/join-codes`,
    `/v1/organizations/${ORG}/leave/me`,
  ])("does not match %s", (path) => {
    expect(isJoinLinkRoute(path)).toBe(false);
    expect(isOrgRoute(path)).toBe(false);
  });
});

describe("join-link routes through the edge", () => {
  it.each(ROUTES)("forwards %s %s to MEMBERSHIP_WORKER with the resolved actor", async (path, method) => {
    const m = membership();
    const res = await worker.fetch(req(path, method, method === "POST" ? { body: { code: "KTCH2345" } } : {}), env(m.fetcher) as never);

    expect(res.status).toBe(200);
    expect(m.calls).toHaveLength(1);
    const call = m.calls[0]!;
    expect(new URL(call.url).pathname).toBe(path);
    expect(new URL(call.url).host).toBe("membership.internal");
    expect(call.init.method).toBe(method);
    const headers = new Headers(call.init.headers as HeadersInit);
    expect(headers.get("x-actor-subject-id")).toBe("usr_anu");
    expect(headers.get("x-actor-subject-type")).toBe("user");
    expect(headers.get("x-request-id")).toBe("req_edge");
    expect(headers.get("authorization")).toBeNull();
  });

  it("forwards the join body to membership-worker", async () => {
    const m = membership(201, { orgId: ORG, slug: "flat-4b", memberId: "mem_x", alreadyMember: false });
    const res = await worker.fetch(req("/v1/join", "POST", { body: { code: "KTCH2345" } }), env(m.fetcher) as never);
    expect(res.status).toBe(201);
    const forwarded = await new Response(m.calls[0]!.init.body as BodyInit).json();
    expect(forwarded).toEqual({ code: "KTCH2345" });
  });

  it("passes membership-worker's answer through unchanged", async () => {
    const m = membership(200, { orgId: ORG, name: "Flat 4B", slug: "flat-4b", memberCount: 3, alreadyMember: false });
    const res = await worker.fetch(req("/v1/join/KTCH2345", "GET"), env(m.fetcher) as never);
    const body = (await res.json()) as { data: { memberCount: number } };
    expect(body.data.memberCount).toBe(3);
  });

  it.each([
    ["/v1/join", "GET"],
    ["/v1/join", "PUT"],
    ["/v1/join/KTCH2345", "POST"],
    ["/v1/join/KTCH2345", "DELETE"],
    [`/v1/organizations/${ORG}/join-code`, "POST"],
    [`/v1/organizations/${ORG}/join-code/rotate`, "GET"],
    [`/v1/organizations/${ORG}/leave`, "DELETE"],
    [`/v1/organizations/${ORG}/leave`, "GET"],
  ])("405s %s %s without calling membership-worker", async (path, method) => {
    const m = membership();
    const res = await worker.fetch(req(path, method), env(m.fetcher) as never);
    expect(res.status).toBe(405);
    expect(m.calls).toHaveLength(0);
  });

  it.each(ROUTES)("401s %s %s without a session", async (path, method) => {
    const m = membership();
    const res = await worker.fetch(req(path, method, { auth: false }), env(m.fetcher) as never);
    expect(res.status).toBe(401);
    expect(m.calls).toHaveLength(0);
  });

  it("forwards a well-formed Idempotency-Key on the POSTs", async () => {
    const m = membership();
    await worker.fetch(
      req("/v1/join", "POST", { body: { code: "KTCH2345" }, headers: { "idempotency-key": "join-KTCH2345-1" } }),
      env(m.fetcher) as never,
    );
    expect(new Headers(m.calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("join-KTCH2345-1");
  });

  it("rejects a malformed Idempotency-Key before reaching membership-worker", async () => {
    const m = membership();
    const res = await worker.fetch(
      req(`/v1/organizations/${ORG}/leave`, "POST", { headers: { "idempotency-key": "k".repeat(256) } }),
      env(m.fetcher) as never,
    );
    expect(res.status).toBe(400);
    expect(m.calls).toHaveLength(0);
  });
});

describe("join links and the Solo profile", () => {
  it.each(ROUTES)("SOLO_MODE on hides %s %s", async (path, method) => {
    expect(isSoloSuppressed(path, method)).toBe(true);
    const m = membership();
    const res = await worker.fetch(req(path, method), env(m.fetcher, { SOLO_MODE: "true" }) as never);
    expect(res.status).toBe(404);
    expect(m.calls).toHaveLength(0);
  });

  it.each(ROUTES)("SOLO_MODE off (Cookpool) serves %s %s", async (path, method) => {
    const m = membership();
    const res = await worker.fetch(
      req(path, method, method === "POST" ? { body: { code: "KTCH2345" } } : {}),
      env(m.fetcher, { SOLO_MODE: "false" }) as never,
    );
    expect(res.status).toBe(200);
    expect(m.calls).toHaveLength(1);
  });
});
