import {
  API_PREFIX,
  BINDING_PROPS,
  CLIENT_IP_HEADER,
  apiEdgeRequest,
  createConsoleWorker,
  forwardToApiEdge,
  isApiPath,
  type ApiEdgeBinding,
  type ModuleWorker,
} from "@spliteco-web/worker/api-forward.mjs";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";

// The Spliteco Worker answers `/api/*` on the app's own address by forwarding
// to api-edge over API_EDGE (props { caller: "spliteco-web" }), before
// OpenNext is loaded.

const APP = `${cwd()}/../../apps/spliteco-web`;

function binding() {
  const sent: Request[] = [];
  const b: ApiEdgeBinding = {
    fetch: async (request: Request) => {
      sent.push(request);
      return Response.json({ data: { ok: true }, meta: {} });
    },
  };
  return { b, sent };
}

describe("/api forwarding", () => {
  it("matches /api and below only", () => {
    expect(API_PREFIX).toBe("/api");
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/v1/spliteco/me/home")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
    expect(isApiPath("/groups")).toBe(false);
  });

  it("strips /api, keeps the query, auth and body, and sets the client address from Cloudflare's", async () => {
    const req = new Request("https://spliteco.test/api/v1/spliteco/groups/org_1/expenses?x=1", {
      method: "POST",
      headers: { authorization: "Bearer t", "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4", [CLIENT_IP_HEADER]: "6.6.6.6" },
      body: JSON.stringify({ a: 1 }),
      duplex: "half",
    } as RequestInit);
    const out = apiEdgeRequest(req);
    const url = new URL(out.url);
    expect(url.pathname).toBe("/v1/spliteco/groups/org_1/expenses");
    expect(url.search).toBe("?x=1");
    expect(out.headers.get("authorization")).toBe("Bearer t");
    expect(out.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
    expect(out.headers.get("x-forwarded-for")).toBeNull();
    expect(await out.text()).toBe('{"a":1}');
  });

  it("answers 503 without a binding", async () => {
    const r = await forwardToApiEdge(new Request("https://spliteco.test/api/health"), undefined);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("api_edge_unbound");
  });

  it("sends /api to the binding and everything else to OpenNext", async () => {
    const { b, sent } = binding();
    let pages = 0;
    const worker = createConsoleWorker(async () => ({
      default: { fetch: async () => { pages += 1; return new Response("page"); } } as ModuleWorker,
    }));
    await worker.fetch(new Request("https://spliteco.test/api/health"), { API_EDGE: b }, {});
    expect(sent).toHaveLength(1);
    expect(pages).toBe(0);
    expect(await (await worker.fetch(new Request("https://spliteco.test/"), { API_EDGE: b }, {})).text()).toBe("page");
  });

  it("names itself spliteco-web, as its wrangler.jsonc binding props do", () => {
    expect(BINDING_PROPS).toEqual({ caller: "spliteco-web" });
    const wrangler = readFileSync(`${APP}/wrangler.jsonc`, "utf8");
    expect(wrangler.match(/"caller": "spliteco-web"/g)).toHaveLength(2);
    expect(wrangler).toMatch(/"service": "cookpool-api-edge-stage"/);
    expect(wrangler).toMatch(/"service": "cookpool-api-edge-prod"/);
  });
});
