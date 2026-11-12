// Spliteco at the edge (cookpool-spliteco SE1): `/v1/spliteco/…` reaches
// spliteco-worker through its facade — session resolved, actor forwarded,
// bodies on POST/PUT, the shared rate-limit and idempotency gate — and a
// delegated token reaches none of it. Driven through the worker entrypoint.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "@api-edge/index";
import { isSplitecoRoute } from "@api-edge/spliteco-facade";
import { isKitchenRoute } from "@api-edge/kitchen-facade";
import { fromConsoleBinding } from "@api-edge/client-ip";
import { __rateLimitConfigForTest } from "@api-edge/rate-limit";

const ORG = "org_0123456789abcdef0123456789abcdef";
const __dirname = dirname(fileURLToPath(import.meta.url));

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

function spliteco(status = 200) {
  const calls: Call[] = [];
  const fetcher = {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(Response.json({ data: { ok: true }, meta: { requestId: "req_s", cursor: null } }, { status }));
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

const env = (w: Fetcher | undefined) => ({ ENVIRONMENT: "test", IDENTITY_WORKER: identity(), SPLITECO_WORKER: w });

function req(path: string, method: string, opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}): Request {
  const headers: Record<string, string> = { "x-request-id": "req_edge", ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers.authorization = "Bearer sps_ses_abc.secret";
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://api.cookpool.test${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
}

describe("spliteco route matching", () => {
  it.each(["/v1/spliteco", "/v1/spliteco/me/home", `/v1/spliteco/groups/${ORG}/expenses`, "/v1/spliteco/expenses/txn_1/move"])("%s is Spliteco's", (path) => {
    expect(isSplitecoRoute(path)).toBe(true);
    expect(isKitchenRoute(path)).toBe(false);
  });
  it.each(["/v1/splitecox", "/v1/kitchen/me/home", `/v1/organizations/${ORG}/kitchen/balances`])("%s is not", (path) => {
    expect(isSplitecoRoute(path)).toBe(false);
  });
});

describe("the spliteco facade", () => {
  it("forwards the actor, the path and query, and a POST's body and idempotency key", async () => {
    const s = spliteco(201);
    const res = await worker.fetch(
      req(`/v1/spliteco/groups/${ORG}/expenses?x=1`, "POST", { body: { title: "Dinner" }, headers: { "idempotency-key": "ikey_spliteco_1" } }),
      env(s.fetcher) as never,
    );
    expect(res.status).toBe(201);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe(`https://spliteco.internal/v1/spliteco/groups/${ORG}/expenses?x=1`);
    const headers = new Headers(s.calls[0]!.init.headers);
    expect(headers.get("x-actor-subject-id")).toBe("usr_anu");
    expect(headers.get("x-actor-subject-type")).toBe("user");
    expect(headers.get("idempotency-key")).toBe("ikey_spliteco_1");
    expect(headers.get("authorization")).toBeNull();
  });

  it("answers 401 without a session and 503 without the binding", async () => {
    const s = spliteco();
    expect((await worker.fetch(req("/v1/spliteco/me/home", "GET", { auth: false }), env(s.fetcher) as never)).status).toBe(401);
    expect((await worker.fetch(req("/v1/spliteco/me/home", "GET"), env(undefined) as never)).status).toBe(503);
    expect(s.calls).toHaveLength(0);
  });

  it("refuses a delegated token on every Spliteco path, before the worker is asked", async () => {
    const s = spliteco();
    const res = await worker.fetch(req("/v1/spliteco/me/home", "GET", { auth: false, headers: { authorization: `Bearer sps_dlg_${"0".repeat(32)}.secret` } }), env(s.fetcher) as never);
    expect(res.status).toBe(403);
    expect(s.calls).toHaveLength(0);
  });

  it("has its own rate-limit family", () => {
    expect(__rateLimitConfigForTest.spliteco).toBeDefined();
  });

  it("trusts the Spliteco app's binding for the client address, as the console's", () => {
    expect(fromConsoleBinding({ caller: "spliteco-web" })).toBe(true);
    expect(fromConsoleBinding({ caller: "web-console-next" })).toBe(true);
    expect(fromConsoleBinding({ caller: "someone-else" })).toBe(false);
  });

  it("binds spliteco-worker per environment and waits on it", () => {
    const template = readFileSync(resolve(__dirname, "../../../apps/api-edge/wrangler.template.jsonc"), "utf8");
    expect(template).toContain('"service": "cookpool-spliteco-worker-stage"');
    expect(template).toContain('"service": "cookpool-spliteco-worker-prod"');
    const component = readFileSync(join(__dirname, "../../../apps/api-edge/component.yaml"), "utf8");
    expect(component).toMatch(/- component: spliteco-worker/);
  });
});
