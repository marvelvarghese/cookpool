import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import {
  ADDRESS_HEADERS,
  API_PREFIX,
  BINDING_PROPS,
  CLIENT_IP_HEADER,
  apiEdgeRequest,
  createConsoleWorker,
  forwardToApiEdge,
  isApiPath,
  type ApiEdgeBinding,
  type ModuleWorker,
} from "@web-console-next/worker/api-forward.mjs";
import { redirectRules, rscFetchShim } from "@web-console-next/lib/static-pages.mjs";

// Cookpool SM-4: the console Worker answers `/api/*` on the app's own address
// by forwarding to api-edge over its API_EDGE service binding, before OpenNext
// is loaded, so the app's calls are same-origin (no CORS preflight) and an
// isolate that only serves the API never evaluates the Next bundle.

const APP = `${cwd()}/../../apps/web-console-next`;
const ORIGIN = "https://cookpool.store";

/** A binding that records what it was sent and answers `answer`. */
function binding(answer: () => Response | Promise<Response> = () => Response.json({ data: {}, meta: {} })) {
  const sent: Request[] = [];
  const b: ApiEdgeBinding = {
    fetch: async (request: Request) => {
      sent.push(request);
      return answer();
    },
  };
  return { b, sent };
}

describe("which paths are the API", () => {
  it("is /api and everything under /api/", () => {
    expect(API_PREFIX).toBe("/api");
    for (const p of ["/api", "/api/", "/api/health", "/api/v1/kitchen/me/inbox"]) expect(isApiPath(p)).toBe(true);
  });

  it("is nothing else", () => {
    for (const p of ["/", "/apis", "/api-docs", "/API/health", "/home", "/_next/static/api/x.js", "/v1/kitchen/me/inbox", "/orgs/api"]) {
      expect(isApiPath(p)).toBe(false);
    }
  });
});

describe("the request api-edge gets", () => {
  it("strips the prefix and keeps the query, method, headers and body", async () => {
    const r = apiEdgeRequest(
      new Request(`${ORIGIN}/api/v1/organizations/org_1/kitchen/items?filter=soon&limit=16`, {
        method: "POST",
        headers: {
          authorization: "Bearer tok_1",
          "content-type": "application/json",
          "idempotency-key": "idem_1",
          "x-request-id": "req_1",
          traceparent: "00-abc-def-01",
          origin: ORIGIN,
        },
        body: JSON.stringify({ name: "Milk" }),
      }),
    );
    expect(r.url).toBe(`${ORIGIN}/v1/organizations/org_1/kitchen/items?filter=soon&limit=16`);
    expect(r.method).toBe("POST");
    expect(r.redirect).toBe("manual");
    for (const [name, value] of [
      ["authorization", "Bearer tok_1"],
      ["content-type", "application/json"],
      ["idempotency-key", "idem_1"],
      ["x-request-id", "req_1"],
      ["traceparent", "00-abc-def-01"],
    ]) {
      expect(r.headers.get(name!)).toBe(value);
    }
    expect(await r.json()).toEqual({ name: "Milk" });
  });

  it.each([
    ["/api", "/"],
    ["/api/", "/"],
    ["/api/health", "/health"],
    ["/api/v1/join/AB%2FCD/preview", "/v1/join/AB%2FCD/preview"],
  ])("%s reaches api-edge as %s", (from, to) => {
    expect(new URL(apiEdgeRequest(new Request(`${ORIGIN}${from}`)).url).pathname).toBe(to);
  });

  it("passes the browser's user-agent through, which names a passkey nobody named (PK-4)", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const r = apiEdgeRequest(
      new Request(`${ORIGIN}/api/v1/auth/passkeys/register/verify`, {
        method: "POST",
        headers: { "user-agent": ua, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(new URL(r.url).pathname).toBe("/v1/auth/passkeys/register/verify");
    expect(r.headers.get("user-agent")).toBe(ua);
  });

  it("keeps a doubled slash a path on this origin, never another host", () => {
    const url = new URL(apiEdgeRequest(new Request(`${ORIGIN}/api//evil.test/v1/x`)).url);
    expect(url.host).toBe("cookpool.store");
    expect(url.pathname).toBe("//evil.test/v1/x");
  });

  it("sends no body for GET and HEAD", () => {
    expect(apiEdgeRequest(new Request(`${ORIGIN}/api/health`)).body).toBeNull();
    expect(apiEdgeRequest(new Request(`${ORIGIN}/api/health`, { method: "HEAD" })).body).toBeNull();
  });
});

describe("the client's address", () => {
  it("goes on as x-console-client-ip, from Cloudflare's CF-Connecting-IP only", () => {
    expect(CLIENT_IP_HEADER).toBe("x-console-client-ip");
    const r = apiEdgeRequest(new Request(`${ORIGIN}/api/health`, { headers: { "cf-connecting-ip": "203.0.113.7" } }));
    expect(r.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
    expect(r.headers.has("cf-connecting-ip")).toBe(false);
  });

  it("is never one the client chose: every address header it sends is removed", () => {
    const spoofed: Record<string, string> = {};
    for (const name of ADDRESS_HEADERS) spoofed[name] = "198.51.100.66";
    const r = apiEdgeRequest(new Request(`${ORIGIN}/api/v1/join/X/preview`, { headers: { ...spoofed, "cf-connecting-ip": "203.0.113.7" } }));
    expect(r.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
    for (const name of ADDRESS_HEADERS.filter((n) => n !== CLIENT_IP_HEADER)) expect(r.headers.has(name)).toBe(false);
  });

  it("is absent when the request had none (api-edge then trusts none)", () => {
    const r = apiEdgeRequest(new Request(`${ORIGIN}/api/health`, { headers: { [CLIENT_IP_HEADER]: "198.51.100.66" } }));
    expect(r.headers.has(CLIENT_IP_HEADER)).toBe(false);
  });

  it("covers the usual proxy headers and the binding's props name the console", () => {
    expect([...ADDRESS_HEADERS].sort()).toEqual(
      ["cf-connecting-ip", "cf-connecting-ipv6", "cf-pseudo-ipv4", "forwarded", "true-client-ip", "x-console-client-ip", "x-forwarded-for", "x-real-ip"].sort(),
    );
    expect(BINDING_PROPS).toEqual({ caller: "web-console-next" });
  });
});

describe("forwardToApiEdge", () => {
  it("returns api-edge's answer as it is, a redirect included", async () => {
    const { b, sent } = binding(() => new Response(null, { status: 302, headers: { location: "https://accounts.example/x", "set-cookie": "a=1" } }));
    const res = await forwardToApiEdge(new Request(`${ORIGIN}/api/v1/auth/oauth/google/start`), b);
    expect(sent).toHaveLength(1);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://accounts.example/x");
    expect(res.headers.get("set-cookie")).toBe("a=1");
  });

  it("answers 503 api_edge_unbound with no binding (local dev), echoing a request id", async () => {
    const res = await forwardToApiEdge(new Request(`${ORIGIN}/api/health`, { headers: { "x-request-id": "req_abc" } }), undefined);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: { code: "internal_error", message: "The API is unavailable", details: { reason: "api_edge_unbound" }, requestId: "req_abc" },
    });
  });

  it("answers 502 api_edge_unreachable when the call fails, with a fresh request id for a bad one", async () => {
    const { b } = binding(() => {
      throw new Error("down");
    });
    const res = await forwardToApiEdge(new Request(`${ORIGIN}/api/health`, { headers: { "x-request-id": "bad id!" } }), b);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; details: { reason: string }; requestId: string } };
    expect(body.error.code).toBe("internal_error");
    expect(body.error.details.reason).toBe("api_edge_unreachable");
    expect(body.error.requestId).toMatch(/^req_[0-9a-f]{32}$/);
  });
});

describe("the console Worker", () => {
  function worker() {
    const loads: number[] = [];
    const pages: Request[] = [];
    const openNext: ModuleWorker = {
      fetch: async (request) => {
        pages.push(request);
        return new Response("<html>page</html>", { headers: { "content-type": "text/html", "x-opennext": "1" } });
      },
    };
    const w = createConsoleWorker(async () => {
      loads.push(Date.now());
      return { default: openNext };
    });
    return { w, loads, pages };
  }

  it("answers /api without ever loading OpenNext", async () => {
    const { w, loads } = worker();
    const { b, sent } = binding();
    for (const path of ["/api/health", "/api/v1/kitchen/me/inbox", "/api"]) {
      expect((await w.fetch(new Request(`${ORIGIN}${path}`), { API_EDGE: b }, {})).status).toBe(200);
    }
    expect(sent.map((r) => new URL(r.url).pathname)).toEqual(["/health", "/v1/kitchen/me/inbox", "/"]);
    expect(loads).toHaveLength(0);
  });

  it("hands everything else to OpenNext, loaded on the first such request, with the same env and ctx", async () => {
    const { w, loads, pages } = worker();
    const env = { API_EDGE: binding().b, CONSOLE_PRODUCT_NAME: "cookpool" };
    const ctx = { waitUntil() {} };
    const res = await w.fetch(new Request(`${ORIGIN}/orgs`), env, ctx);
    expect(res.headers.get("x-opennext")).toBe("1");
    expect(pages.map((r) => r.url)).toEqual([`${ORIGIN}/orgs`]);
    expect(loads).toHaveLength(1);
  });

  it("is the Worker's entry, which imports OpenNext only lazily and re-exports its Durable Object classes", () => {
    const entry = new TextDecoder().decode(readFileSync(`${APP}/src/worker/index.mjs`));
    const code = entry.replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain('createConsoleWorker(() => import("../../.open-next/worker.js"))');
    // No static import of OpenNext's worker (or of anything under .open-next but its two small classes).
    expect(code).not.toMatch(/^\s*import[^(\n]*\.open-next/m);
    expect(code).toMatch(/export \{ DOQueueHandler \} from "\.\.\/\.\.\/\.open-next\/\.build\/durable-objects\/queue\.js";/);
    expect(code).toMatch(/export \{ DOShardedTagCache \} from "\.\.\/\.\.\/\.open-next\/\.build\/durable-objects\/sharded-tag-cache\.js";/);
  });
});

describe("/api is never a file", () => {
  it("no _redirects rule (SM-2) catches it", () => {
    for (const rule of redirectRules()) expect(isApiPath(rule.split(" ")[0]!)).toBe(false);
  });

  it("the RSC fetch shim (SM-2) leaves the app's same-origin API calls alone", async () => {
    const calls: string[] = [];
    const win = {
      location: { href: `${ORIGIN}/home`, origin: ORIGIN },
      fetch: async (input: RequestInfo | URL, _init?: RequestInit) => {
        calls.push(String(input instanceof Request ? input.url : input));
        return new Response("{}", { status: 200 });
      },
    };
    new Function("window", rscFetchShim())(win);
    await win.fetch(`${ORIGIN}/api/v1/kitchen/me/inbox`, { headers: { authorization: "Bearer t" } });
    await win.fetch(new URL(`${ORIGIN}/api/v1/kitchen/me/home?_rsc=1`), { headers: { RSC: "1" } });
    expect(calls).toEqual([`${ORIGIN}/api/v1/kitchen/me/inbox`, `${ORIGIN}/api/v1/kitchen/me/home?_rsc=1`]);
  });
});
