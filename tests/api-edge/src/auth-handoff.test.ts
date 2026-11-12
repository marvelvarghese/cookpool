// One tap from Cookpool into Spliteco (cookpool-spliteco SE-4): the edge
// routes POST /v1/auth/handoff and POST /v1/auth/handoff/exchange to
// identity-worker, and forwards the browser's Origin, which the exchange is
// bound to.

import { isAuthRoute, handleAuthRoute } from "@api-edge/auth-facade";

function fakeIdentity() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = {
    fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, init });
      return Response.json({ data: { ok: true }, meta: { requestId: "r", cursor: null } });
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

describe("the handoff routes", () => {
  it("are auth routes, POST only", async () => {
    expect(isAuthRoute("/v1/auth/handoff")).toBe(true);
    expect(isAuthRoute("/v1/auth/handoff/exchange")).toBe(true);
    expect(isAuthRoute("/v1/auth/handoff/other")).toBe(false);
    const { fetcher } = fakeIdentity();
    const get = await handleAuthRoute(new Request("https://api.test/v1/auth/handoff", { method: "GET" }), { IDENTITY_WORKER: fetcher, ENVIRONMENT: "test" }, "r", "/v1/auth/handoff");
    expect(get.status).toBe(405);
  });

  it("forward the session and the Origin to identity-worker", async () => {
    const { fetcher, calls } = fakeIdentity();
    const origin = "https://cookpool-spliteco-web-stage.cookpool.workers.dev";
    await handleAuthRoute(
      new Request("https://api.test/v1/auth/handoff/exchange", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ code: "hoc_x" }),
      }),
      { IDENTITY_WORKER: fetcher, ENVIRONMENT: "test" },
      "req_x",
      "/v1/auth/handoff/exchange",
    );
    await handleAuthRoute(
      new Request("https://api.test/v1/auth/handoff", {
        method: "POST",
        headers: { authorization: "Bearer sps_ses_x.y", "content-type": "application/json" },
        body: JSON.stringify({ targetOrigin: origin }),
      }),
      { IDENTITY_WORKER: fetcher, ENVIRONMENT: "test" },
      "req_h",
      "/v1/auth/handoff",
    );
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/auth/handoff/exchange", "/v1/auth/handoff"]);
    expect(new Headers(calls[0]!.init.headers as HeadersInit).get("origin")).toBe(origin);
    expect(new Headers(calls[1]!.init.headers as HeadersInit).get("authorization")).toBe("Bearer sps_ses_x.y");
  });
});
