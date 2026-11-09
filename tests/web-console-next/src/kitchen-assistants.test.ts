// Your assistant, connected (cookpool-mcp MC-4): the consent page's model and
// its Allow / Cancel flows, mcp-worker's /connect/* calls, coming back after
// sign-in, Connected assistants' model, and the pages in both frames.

import {
  ASSISTANT_SCOPES,
  CANCELLED_TEXT,
  CLIENT_NAME_MAX,
  EXPIRED_TEXT,
  SCOPE_ROWS,
  allowFlow,
  canAllow,
  cancelFlow,
  chosenScopes,
  clientNameOf,
  connectReqFrom,
  defaultSwitches,
  delegationRequest,
  flipScope,
  isExpired,
  loadOutcome,
  mcpConnectApi,
  requestedByLine,
  returnsToLine,
  safeRedirect,
  type ConnectRequestInfo,
} from "@web-console-next/components/kitchen/assistants";
import { loginPathFor, postLoginDestination } from "@web-console-next/lib/safe-next";

const REQ = "a".repeat(20) + "B_c-" + "9".repeat(12);
const INFO: ConnectRequestInfo = {
  req: REQ,
  clientId: "cli_abc",
  clientName: "Kitchen helper",
  clientDomain: null,
  redirectHost: "assistant.example",
  redirectIsLoopback: false,
  requestedScopes: ["kitchen.read"],
  expiresAt: "2026-11-09T12:10:00.000Z",
};
const DLG = "dlg_0123456789abcdef0123456789abcdef";
const TOKEN = "sps_dlg_0123456789abcdef0123456789abcdef.secret";

describe("the consent switches", () => {
  it("are the four scopes in order, all on but balances", () => {
    expect(SCOPE_ROWS.map((r) => r.scope)).toEqual([...ASSISTANT_SCOPES]);
    expect(ASSISTANT_SCOPES).toEqual(["kitchen.read", "money.read", "timers.write", "suggest.write"]);
    expect(SCOPE_ROWS.map((r) => r.label)).toEqual([
      "Read your kitchen",
      "See your balances",
      "Set cooking timers",
      "Suggest uses and purchases",
    ]);
    expect(defaultSwitches()).toEqual({ "kitchen.read": true, "money.read": false, "timers.write": true, "suggest.write": true });
    expect(chosenScopes(defaultSwitches())).toEqual(["kitchen.read", "timers.write", "suggest.write"]);
  });

  it("flip one at a time, keep the stored order, and Allow needs one on", () => {
    let s = flipScope(defaultSwitches(), "money.read");
    expect(chosenScopes(s)).toEqual(["kitchen.read", "money.read", "timers.write", "suggest.write"]);
    s = flipScope(flipScope(flipScope(flipScope(s, "kitchen.read"), "money.read"), "timers.write"), "suggest.write");
    expect(chosenScopes(s)).toEqual([]);
    expect(canAllow(s)).toBe(false);
    expect(canAllow(flipScope(s, "timers.write"))).toBe(true);
  });

  it("build identity's body: scopes, the client's name and id, and the request", () => {
    expect(delegationRequest(INFO, flipScope(defaultSwitches(), "suggest.write"))).toEqual({
      scopes: ["kitchen.read", "timers.write"],
      clientName: "Kitchen helper",
      clientId: "cli_abc",
      requestId: REQ,
    });
  });

  it("show the client's name trimmed, at most 80, never empty", () => {
    expect(clientNameOf({ clientName: "  Kitchen   helper ", clientId: "x" })).toBe("Kitchen helper");
    expect(clientNameOf({ clientName: "", clientId: "cli_9" })).toBe("cli_9");
    expect(clientNameOf({ clientName: " ", clientId: " " })).toBe("An assistant");
    expect(Array.from(clientNameOf({ clientName: "é".repeat(200), clientId: "x" }))).toHaveLength(CLIENT_NAME_MAX);
  });

  it("say who asks, as whom, and where the access goes", () => {
    expect(requestedByLine("Kitchen helper", "Meera")).toBe("Requested by Kitchen helper · signed in as Meera");
    expect(returnsToLine(INFO)).toBe("Returns to assistant.example");
    expect(returnsToLine({ redirectHost: "localhost:3334", redirectIsLoopback: true })).toBe(
      "Returns to an app on this computer (localhost:3334)",
    );
  });

  it("read req from the address only when it can be one", () => {
    expect(connectReqFrom(REQ)).toBe(REQ);
    expect(connectReqFrom(` ${REQ} `)).toBe(REQ);
    expect(connectReqFrom(null)).toBeNull();
    expect(connectReqFrom("short")).toBeNull();
    expect(connectReqFrom(`${REQ}/../x`)).toBeNull();
    expect(connectReqFrom("a".repeat(65))).toBeNull();
  });
});

describe("returning after sign-in", () => {
  it("keeps /connect?req= across the sign-in page", () => {
    const login = loginPathFor(`/connect?req=${REQ}`);
    expect(login).toBe(`/login?next=${encodeURIComponent(`/connect?req=${REQ}`)}`);
    const next = new URL(login, "https://stage.cookpool.store").searchParams.get("next");
    expect(postLoginDestination(next)).toBe(`/connect?req=${REQ}`);
  });
});

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(answers: Array<{ status: number; body: unknown } | "network">) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift() ?? { status: 500, body: null };
    if (next === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  };
  return { fn, calls };
}

const ORIGIN = "https://cookpool-mcp-worker-stage.cookpool.workers.dev";
const ok = <T>(data: T) => ({ status: 200, body: { data, meta: { requestId: "r", cursor: null } } });
const err = (status: number, code: string, reason?: string) => ({
  status,
  body: { error: { code, message: "no", details: reason ? { reason } : {}, requestId: "r" } },
});

describe("mcp-worker's /connect/*", () => {
  it("reads the request without the session, and writes with it", async () => {
    const { fn, calls } = fakeFetch([ok(INFO), ok({ redirectTo: "https://assistant.example/cb?code=1" }), ok({ redirectTo: "x" }), ok({ revokedGrants: 1, delegationRevoked: true })]);
    const api = mcpConnectApi(ORIGIN, "sps_ses_1.s", fn);
    expect(await api.request(REQ)).toEqual({ ok: true, data: INFO });
    await api.complete({ req: REQ, delegationId: DLG, token: TOKEN });
    await api.deny(REQ);
    await api.disconnect(DLG);
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["GET", `${ORIGIN}/connect/request?req=${REQ}`],
      ["POST", `${ORIGIN}/connect/complete`],
      ["POST", `${ORIGIN}/connect/deny`],
      ["POST", `${ORIGIN}/connect/disconnect`],
    ]);
    const auth = calls.map((c) => new Headers(c.init.headers).get("authorization"));
    expect(auth).toEqual([null, "Bearer sps_ses_1.s", "Bearer sps_ses_1.s", "Bearer sps_ses_1.s"]);
    expect(calls.map((c) => c.init.credentials)).toEqual(["omit", "omit", "omit", "omit"]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ req: REQ, delegationId: DLG, token: TOKEN });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ req: REQ });
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({ delegationId: DLG });
  });

  it("decodes a refusal with its reason, and no answer as network_error", async () => {
    const { fn } = fakeFetch([err(404, "not_found", "expired"), "network"]);
    const api = mcpConnectApi(ORIGIN, null, fn);
    const gone = await api.request(REQ);
    expect(gone).toEqual({ ok: false, status: 404, code: "not_found", reason: "expired", message: "no" });
    expect(!gone.ok && isExpired(gone)).toBe(true);
    const down = await api.request(REQ);
    expect(down).toMatchObject({ ok: false, status: 0, code: "network_error" });
    expect(!down.ok && isExpired(down)).toBe(false);
  });

  it("opens the page, or says the request expired, or that it failed", () => {
    expect(loadOutcome({ ok: true, data: INFO })).toEqual({ kind: "ready", info: INFO });
    expect(loadOutcome({ ok: false, status: 404, code: "not_found", reason: "expired", message: "" })).toEqual({ kind: "expired" });
    expect(loadOutcome({ ok: false, status: 0, code: "network_error", message: "" })).toMatchObject({ kind: "failed" });
    expect(EXPIRED_TEXT).toBe("This request has expired · start again from your assistant");
  });
});

describe("Allow", () => {
  function deps(complete: { ok: true; data: { redirectTo: string } } | { ok: false; status: number; code: string; reason?: string; message: string }) {
    const log: string[] = [];
    const went: string[] = [];
    return {
      log,
      went,
      d: {
        createDelegation: async (body: unknown) => {
          log.push(`create ${JSON.stringify(body)}`);
          return { ok: true as const, data: { delegation: { id: DLG }, token: TOKEN } };
        },
        revokeDelegation: async (id: string) => {
          log.push(`revoke ${id}`);
        },
        complete: async (body: { req: string; delegationId: string; token: string }) => {
          log.push(`complete ${body.req} ${body.delegationId} ${body.token === TOKEN}`);
          return complete;
        },
        go: (url: string) => went.push(url),
      },
    };
  }

  it("mints the delegation, hands it to mcp-worker, and goes where it says", async () => {
    const { d, log, went } = deps({ ok: true, data: { redirectTo: "https://assistant.example/cb?code=c1&state=s" } });
    const out = await allowFlow(d, INFO, defaultSwitches());
    expect(out).toEqual({ kind: "allowed", redirectTo: "https://assistant.example/cb?code=c1&state=s" });
    expect(log).toEqual([
      `create ${JSON.stringify({ scopes: ["kitchen.read", "timers.write", "suggest.write"], clientName: "Kitchen helper", clientId: "cli_abc", requestId: REQ })}`,
      `complete ${REQ} ${DLG} true`,
    ]);
    expect(went).toEqual(["https://assistant.example/cb?code=c1&state=s"]);
  });

  it("an app's own scheme or a loopback address is a fine place to go back to", async () => {
    expect(safeRedirect("http://127.0.0.1:33418/callback?code=1")).toBe("http://127.0.0.1:33418/callback?code=1");
    expect(safeRedirect("myassistant://oauth?code=1")).toBe("myassistant://oauth?code=1");
    expect(safeRedirect("javascript:alert(1)")).toBeNull();
    expect(safeRedirect("data:text/html,x")).toBeNull();
    expect(safeRedirect("/relative")).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
  });

  it("an expired request: revokes the unused delegation and says so", async () => {
    const { d, log, went } = deps({ ok: false, status: 404, code: "not_found", reason: "expired", message: "gone" });
    expect(await allowFlow(d, INFO, defaultSwitches())).toEqual({ kind: "expired" });
    expect(log.at(-1)).toBe(`revoke ${DLG}`);
    expect(went).toEqual([]);
  });

  it("a client that can no longer connect (412) is expired too; anything else fails", async () => {
    const a = deps({ ok: false, status: 412, code: "precondition_failed", message: "x" });
    expect(await allowFlow(a.d, INFO, defaultSwitches())).toEqual({ kind: "expired" });
    const b = deps({ ok: false, status: 0, code: "network_error", message: "x" });
    expect(await allowFlow(b.d, INFO, defaultSwitches())).toEqual({ kind: "failed", message: "Couldn't connect · try again" });
    expect(b.log.at(-1)).toBe(`revoke ${DLG}`);
  });

  it("never goes to an unsafe address: revokes and fails", async () => {
    const { d, log, went } = deps({ ok: true, data: { redirectTo: "javascript:alert(1)" } });
    expect(await allowFlow(d, INFO, defaultSwitches())).toMatchObject({ kind: "failed" });
    expect(log.at(-1)).toBe(`revoke ${DLG}`);
    expect(went).toEqual([]);
  });

  it("when identity refuses, mcp-worker is never called", async () => {
    const { d, log } = deps({ ok: true, data: { redirectTo: "https://a.example" } });
    const refused = {
      ...d,
      createDelegation: async () => ({ ok: false as const, status: 403, error: { code: "forbidden", message: "Sign in again" } }),
    };
    expect(await allowFlow(refused, INFO, defaultSwitches())).toEqual({ kind: "failed", message: "Sign in again" });
    expect(log).toEqual([]);
  });

  it("with nothing switched on it sends nothing", async () => {
    const { d, log } = deps({ ok: true, data: { redirectTo: "https://a.example" } });
    const none = chosenScopes(defaultSwitches()).reduce((s, k) => flipScope(s, k), defaultSwitches());
    expect(await allowFlow(d, INFO, none)).toMatchObject({ kind: "failed" });
    expect(log).toEqual([]);
  });
});

describe("Cancel", () => {
  it("tells mcp-worker to deny, then says so and stays", async () => {
    const reqs: string[] = [];
    const out = await cancelFlow({ deny: async (r) => (reqs.push(r), { ok: true, data: { redirectTo: "https://a.example?error=access_denied" } }) }, REQ);
    expect(reqs).toEqual([REQ]);
    expect(out).toEqual({ kind: "cancelled" });
    expect(CANCELLED_TEXT).toBe("Cancelled · you can close this page");
  });

  it("an expired request says it expired; no answer still cancels here", async () => {
    expect(await cancelFlow({ deny: async () => ({ ok: false, status: 404, code: "not_found", reason: "expired", message: "" }) }, REQ)).toEqual({
      kind: "expired",
    });
    expect(await cancelFlow({ deny: async () => ({ ok: false, status: 0, code: "network_error", message: "" }) }, REQ)).toEqual({
      kind: "cancelled",
    });
  });
});
