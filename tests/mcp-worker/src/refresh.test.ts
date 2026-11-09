// Keeping a connection alive (design §1, §2): the token refresh rotates the
// delegated token through identity's internal refresh when it nears its end,
// and ends the grant when identity says the delegation is gone.

import {
  DELEGATION,
  addDelegation,
  call,
  callTool,
  completeConnect,
  exchangeCode,
  fail,
  json,
  ok,
  register,
  startAuthorize,
  world,
  type World,
} from "./helpers.js";

const DAY = 86_400_000;
const ROTATED = "sps_dlg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.rotatedsecret";

async function connectExpiringIn(w: World, days: number): Promise<{ clientId: string; refreshToken: string }> {
  const clientId = await register(w);
  addDelegation(w, clientId, ["timers.write"], { expiresAt: new Date(Date.now() + days * DAY).toISOString() });
  const req = await startAuthorize(w, clientId);
  const { redirectTo } = (await json<{ data: { redirectTo: string } }>(await completeConnect(w, req))).data;
  const tok = await json<{ refresh_token: string }>(await exchangeCode(w, clientId, new URL(redirectTo).searchParams.get("code")!));
  return { clientId, refreshToken: tok.refresh_token };
}

function refresh(w: World, clientId: string, refreshToken: string): Promise<Response> {
  return call(w, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString(),
  });
}

test("far from its end, a refresh leaves the delegated token alone and never asks identity", async () => {
  const w = world();
  const { clientId, refreshToken } = await connectExpiringIn(w, 80);
  const res = await refresh(w, clientId, refreshToken);
  expect(res.status).toBe(200);
  expect(w.identity.calls).toHaveLength(0);
});

test("near its end, identity rotates it and the next tool call carries the new token", async () => {
  const w = world();
  w.identity.on("POST /v1/internal/delegations/refresh", () =>
    ok({ delegation: { id: DELEGATION, expiresAt: new Date(Date.now() + 90 * DAY).toISOString() }, token: ROTATED }),
  );
  w.edge.on("GET /v1/kitchen/me/timers", () => ok({ timers: [] }));
  const { clientId, refreshToken } = await connectExpiringIn(w, 10);
  const res = await refresh(w, clientId, refreshToken);
  expect(res.status).toBe(200);
  const call0 = w.identity.last("/v1/internal/delegations/refresh");
  expect(call0.headers.get("x-internal-actor")).toBe("mcp-worker");
  expect(call0.body).toEqual({ delegationId: DELEGATION });
  const { access_token, refresh_token } = await json<{ access_token: string; refresh_token: string }>(res);
  await callTool(w, access_token, "timer_list");
  expect(w.edge.last("/v1/kitchen/me/timers").headers.get("authorization")).toBe(`Bearer ${ROTATED}`);

  // The grant keeps the new token with its new 90 days: the next refresh does not rotate again.
  expect((await refresh(w, clientId, refresh_token)).status).toBe(200);
  expect(w.identity.calls).toHaveLength(1);
  for (const { value } of w.kv.entries.values()) expect(value).not.toContain("rotatedsecret");
});

test.each([
  [404, "not_found", {}],
  [422, "precondition_failed", { reason: "revoked" }],
  [422, "precondition_failed", { reason: "expired" }],
])("identity says the delegation is gone (%i %s): invalid_grant, and the grant is deleted", async (status, code, details) => {
  const w = world();
  w.identity.on("POST /v1/internal/delegations/refresh", () => fail(status, code, details));
  const { clientId, refreshToken } = await connectExpiringIn(w, 1);
  const res = await refresh(w, clientId, refreshToken);
  expect(res.status).toBe(400);
  expect(await json(res)).toMatchObject({ error: "invalid_grant" });
  expect(w.kv.keysWith("grant:")).toHaveLength(0);
});

test("identity unavailable: temporarily_unavailable, and the grant stays", async () => {
  const w = world();
  w.identity.on("POST /v1/internal/delegations/refresh", () => fail(500, "internal_error"));
  const { clientId, refreshToken } = await connectExpiringIn(w, 1);
  const res = await refresh(w, clientId, refreshToken);
  expect(res.status).toBe(503);
  expect(await json(res)).toMatchObject({ error: "temporarily_unavailable" });
  expect(w.kv.keysWith("grant:")).toHaveLength(1);
});
