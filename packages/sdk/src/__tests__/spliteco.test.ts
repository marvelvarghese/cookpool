// The SDK's Spliteco methods (cookpool-spliteco SE1): the design's paths and
// methods, bodies as given, the idempotency key passed through, CSV as text.

import { describe, expect, it, vi } from "vitest";
import { Cookpool } from "../index.js";
import { ConflictError } from "../errors.js";

function capture(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn: typeof fetch = vi.fn(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response.clone();
  });
  return { fetch: fn, calls };
}
const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data, meta: { requestId: "req", cursor: null } }), { status, headers: { "content-type": "application/json" } });
const client = (f: typeof fetch) => new Cookpool({ baseUrl: "https://api.test", fetch: f, auth: { kind: "bearer", token: "tok" } });
const ORG = "org_0123456789abcdef0123456789abcdef";
const TXN = "txn_0123456789abcdef0123456789abcdef";

describe("SplitecoClient", () => {
  it.each([
    ["home", (c: Cookpool) => c.spliteco.home(), "GET", "/v1/spliteco/me/home"],
    ["balances", (c: Cookpool) => c.spliteco.balances(), "GET", "/v1/spliteco/me/balances"],
    ["groups", (c: Cookpool) => c.spliteco.groups(), "GET", "/v1/spliteco/me/groups"],
    ["group", (c: Cookpool) => c.spliteco.group(ORG), "GET", `/v1/spliteco/groups/${ORG}`],
    ["friend", (c: Cookpool) => c.spliteco.friend("usr_a"), "GET", "/v1/spliteco/me/friends/usr_a"],
    ["direct", (c: Cookpool) => c.spliteco.directGroup("usr_a"), "POST", "/v1/spliteco/me/friends/usr_a/direct"],
    ["expense", (c: Cookpool) => c.spliteco.expense(TXN), "GET", `/v1/spliteco/expenses/${TXN}`],
    ["delete", (c: Cookpool) => c.spliteco.deleteExpense(TXN), "DELETE", `/v1/spliteco/expenses/${TXN}`],
    ["restore", (c: Cookpool) => c.spliteco.restoreExpense(TXN), "POST", `/v1/spliteco/expenses/${TXN}/restore`],
    ["activity", (c: Cookpool) => c.spliteco.activity(), "GET", "/v1/spliteco/me/activity"],
    ["group activity", (c: Cookpool) => c.spliteco.groupActivity(ORG), "GET", `/v1/spliteco/groups/${ORG}/activity`],
    ["insights", (c: Cookpool) => c.spliteco.insights({ groupId: ORG, month: "2026-11" }), "GET", `/v1/spliteco/insights?groupId=${ORG}&month=2026-11`],
    ["export json", (c: Cookpool) => c.spliteco.exportJson(ORG), "GET", `/v1/spliteco/groups/${ORG}/export.json`],
    // SE2.
    ["settle", (c: Cookpool) => c.spliteco.settle(ORG, { toSubjectId: "usr_a", amountMinor: 100, method: "cash" }), "POST", `/v1/spliteco/groups/${ORG}/settlements`],
    ["payment received", (c: Cookpool) => c.spliteco.paymentReceived({ fromSubjectId: "usr_a", amountMinor: 100 }), "POST", "/v1/spliteco/me/payments-received"],
    ["not received", (c: Cookpool) => c.spliteco.notReceived(TXN), "POST", `/v1/spliteco/settlements/${TXN}/not-received`],
    ["settle plan", (c: Cookpool) => c.spliteco.settlePlan(ORG), "GET", `/v1/spliteco/groups/${ORG}/settle-plan`],
    ["group settings", (c: Cookpool) => c.spliteco.setGroupSettings(ORG, { simplifyDebts: false }), "PUT", `/v1/spliteco/groups/${ORG}/settings`],
    ["remind", (c: Cookpool) => c.spliteco.remind({ to: "usr_a" }), "POST", "/v1/spliteco/reminders"],
    ["profile", (c: Cookpool) => c.spliteco.profile(), "GET", "/v1/spliteco/me/profile"],
    ["set profile", (c: Cookpool) => c.spliteco.setProfile({ upiVpa: "anu@okaxis" }), "PUT", "/v1/spliteco/me/profile"],
    // SE4.
    ["open live", (c: Cookpool) => c.spliteco.openLive(ORG, { title: "Dinner", payers: [], items: [], adjustments: [] }), "POST", `/v1/spliteco/groups/${ORG}/live`],
    ["live", (c: Cookpool) => c.spliteco.live("KTCH2345"), "GET", "/v1/spliteco/live/KTCH2345"],
    ["claim live", (c: Cookpool) => c.spliteco.claimLive("KTCH2345", { itemPosition: 0 }), "POST", "/v1/spliteco/live/KTCH2345/claims"],
    ["lock live", (c: Cookpool) => c.spliteco.lockLive("KTCH2345"), "POST", "/v1/spliteco/live/KTCH2345/lock"],
  ])("%s", async (_name, call, method, path) => {
    const f = capture(ok({}));
    await call(client(f.fetch));
    expect(f.calls[0]!.url).toBe(`https://api.test${path}`);
    expect(f.calls[0]!.init.method).toBe(method);
  });

  it("posts an expense with its key, and edits and moves with theirs", async () => {
    const f = capture(ok({ expense: { id: TXN } }, 201));
    const body = { title: "Dinner", totalMinor: 100, payers: [{ subjectId: "usr_a", amountMinor: 100 }], split: { method: "equal" as const, participants: ["usr_a"] } };
    await client(f.fetch).spliteco.createExpense(ORG, body, { idempotencyKey: "ikey_1" });
    await client(f.fetch).spliteco.editExpense(TXN, body, { idempotencyKey: "ikey_2" });
    await client(f.fetch).spliteco.moveExpense(TXN, { toGroupId: ORG }, { idempotencyKey: "ikey_3" });
    expect(f.calls.map((c) => [c.init.method, c.url.replace("https://api.test", "")])).toEqual([
      ["POST", `/v1/spliteco/groups/${ORG}/expenses`],
      ["PUT", `/v1/spliteco/expenses/${TXN}`],
      ["POST", `/v1/spliteco/expenses/${TXN}/move`],
    ]);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual(body);
    expect(f.calls.map((c) => new Headers(c.init.headers as HeadersInit).get("idempotency-key"))).toEqual(["ikey_1", "ikey_2", "ikey_3"]);
  });

  it("decodes a refusal", async () => {
    const f = capture(new Response(JSON.stringify({ error: { code: "conflict", message: "x", details: { reason: "not_members" }, requestId: "r" } }), { status: 409 }));
    await expect(client(f.fetch).spliteco.moveExpense(TXN, { toGroupId: ORG })).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns the CSV as text, with the bearer token", async () => {
    const f = capture(new Response("Date,Title\r\n", { status: 200, headers: { "content-type": "text/csv" } }));
    expect(await client(f.fetch).spliteco.exportCsv(ORG)).toBe("Date,Title\r\n");
    expect(f.calls[0]!.url).toBe(`https://api.test/v1/spliteco/groups/${ORG}/export.csv`);
    expect(new Headers(f.calls[0]!.init.headers as HeadersInit).get("authorization")).toBe("Bearer tok");
  });
});
