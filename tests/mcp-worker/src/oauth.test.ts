// The OAuth flow end to end (design §2): metadata, registration, /authorize
// with PKCE, the console's hand-off, the token exchange and the first MCP
// call — against in-memory KV and fake api-edge/identity services.

import {
  CONSOLE,
  DELEGATED,
  DELEGATION,
  ORIGIN,
  REDIRECT,
  SESSION,
  addDelegation,
  authorizeUrl,
  call,
  callTool,
  completeConnect,
  connect,
  exchangeCode,
  json,
  ok,
  register,
  rpc,
  startAuthorize,
  world,
} from "./helpers.js";

describe("metadata", () => {
  test("the authorization server publishes its endpoints, PKCE S256, the four scopes and registration", async () => {
    const w = world();
    const meta = await json(await call(w, "/.well-known/oauth-authorization-server"));
    expect(meta).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["kitchen.read", "money.read", "timers.write", "suggest.write"],
    });
  });

  test("the protected resource is /mcp, issued for by this server", async () => {
    const w = world();
    const meta = await json(await call(w, "/.well-known/oauth-protected-resource/mcp"));
    expect(meta).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
  });

  test("/mcp without a token is a 401 that points at the resource metadata", async () => {
    const w = world();
    const res = await rpc(w, null, "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
  });
});

describe("registration and authorize", () => {
  test("dynamic registration returns a client id", async () => {
    const w = world();
    expect(await register(w)).toMatch(/\S+/);
  });

  test("authorize stores the request and sends the browser to the console's /connect", async () => {
    const w = world();
    const clientId = await register(w);
    const req = await startAuthorize(w, clientId);
    expect(req).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    expect(w.kv.keysWith("cookpool:connect:")).toHaveLength(1);

    const info = await call(w, `/connect/request?req=${req}`, { headers: { origin: CONSOLE } });
    expect(info.status).toBe(200);
    expect(info.headers.get("access-control-allow-origin")).toBe(CONSOLE);
    const { data } = await json<{ data: Record<string, unknown> }>(info);
    expect(data).toMatchObject({
      req,
      clientId,
      clientName: "Test assistant",
      clientDomain: null,
      redirectHost: "assistant.test",
      redirectIsLoopback: false,
      requestedScopes: ["kitchen.read", "timers.write"],
    });
    expect(Date.parse(data.expiresAt as string)).toBeGreaterThan(Date.now());
  });

  test("PKCE is required: no code_challenge is refused back to the client", async () => {
    const w = world();
    // A confidential client: the provider alone would let it skip PKCE; Cookpool does not.
    const reg = await call(w, "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Secret client", redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_post" }),
    });
    const { client_id } = await json<{ client_id: string }>(reg);
    const res = await call(w, await authorizeUrl(client_id, { code_challenge: null, code_challenge_method: null }));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe(REDIRECT);
    expect(to.searchParams.get("error")).toBe("invalid_request");
    expect(to.searchParams.get("state")).toBe("st4te");
    expect(w.kv.keysWith("cookpool:connect:")).toHaveLength(0);
  });

  test("PKCE plain is refused", async () => {
    const w = world();
    const clientId = await register(w);
    const res = await call(w, await authorizeUrl(clientId, { code_challenge: "x".repeat(43), code_challenge_method: "plain" }));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toMatch(/invalid_request/);
  });

  test("an unknown client or redirect URI is shown here, never redirected", async () => {
    const w = world();
    const clientId = await register(w);
    const res = await call(w, await authorizeUrl(clientId, { redirect_uri: "https://evil.test/cb" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    const unknown = await call(w, await authorizeUrl("nope"));
    expect(unknown.status).toBe(400);
  });

  test("an expired or unknown req is 404 with reason expired", async () => {
    const w = world();
    const res = await call(w, "/connect/request?req=" + "a".repeat(43));
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ error: { code: "not_found", details: { reason: "expired" } } });
  });
});

describe("connect/complete", () => {
  test("the whole flow: register → authorize → complete → token → an MCP call as the person", async () => {
    const w = world();
    const clientId = await register(w);
    addDelegation(w, clientId, ["kitchen.read", "timers.write"]);
    const req = await startAuthorize(w, clientId);

    const done = await completeConnect(w, req);
    expect(done.status).toBe(200);
    expect(done.headers.get("access-control-allow-origin")).toBe(CONSOLE);
    const { redirectTo } = (await json<{ data: { redirectTo: string } }>(done)).data;
    const back = new URL(redirectTo);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st4te");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
    // The session was checked through api-edge, and the delegation is the person's.
    expect(w.edge.last("/v1/auth/session").headers.get("authorization")).toBe(`Bearer ${SESSION}`);
    expect(w.edge.last("/v1/auth/delegations").headers.get("authorization")).toBe(`Bearer ${SESSION}`);
    // Used once.
    expect(w.kv.keysWith("cookpool:connect:")).toHaveLength(0);

    const tok = await exchangeCode(w, clientId, back.searchParams.get("code")!);
    expect(tok.status).toBe(200);
    const token = await json<{ access_token: string; refresh_token: string; scope: string }>(tok);
    expect(token.scope.split(" ").sort()).toEqual(["kitchen.read", "timers.write"]);
    expect(token.refresh_token).toBeTruthy();

    w.edge.on("GET /v1/kitchen/me/timers", () => ok({ timers: [] }));
    const result = await callTool(w, token.access_token, "timer_list");
    expect(result.isError).toBeFalsy();
    // The tool reached api-edge with the delegated token, not the session or the OAuth token.
    expect(w.edge.last("/v1/kitchen/me/timers").headers.get("authorization")).toBe(`Bearer ${DELEGATED}`);
  });

  test("the delegated token is kept only encrypted: it appears nowhere in KV", async () => {
    const w = world();
    await connect(w, ["kitchen.read"]);
    for (const { value } of w.kv.entries.values()) {
      expect(value).not.toContain(DELEGATED);
      expect(value).not.toContain("delegatedsecret");
    }
  });

  test("a wrong code_verifier gets no token", async () => {
    const w = world();
    const clientId = await register(w);
    addDelegation(w, clientId, ["kitchen.read"]);
    const req = await startAuthorize(w, clientId);
    const { redirectTo } = (await json<{ data: { redirectTo: string } }>(await completeConnect(w, req))).data;
    const tok = await exchangeCode(w, clientId, new URL(redirectTo).searchParams.get("code")!, "wrong-verifier-wrong-verifier-wrong-verifier");
    expect(tok.status).toBe(400);
    expect(await json(tok)).toMatchObject({ error: "invalid_grant" });
  });

  test("needs the person's session: none is 401, a bad one is 401, a delegated token is 403", async () => {
    const w = world();
    const clientId = await register(w);
    addDelegation(w, clientId, ["kitchen.read"]);
    const req = await startAuthorize(w, clientId);
    const none = await call(w, "/connect/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ req, delegationId: DELEGATION, token: DELEGATED }),
    });
    expect(none.status).toBe(401);
    expect((await completeConnect(w, req, {}, "sps_ses_ffff.nope")).status).toBe(401);
    const delegated = await completeConnect(w, req, {}, DELEGATED);
    expect(delegated.status).toBe(403);
    expect(await json(delegated)).toMatchObject({ error: { code: "forbidden", details: { reason: "delegated" } } });
    // An API key is not a person's session either: refused before api-edge is asked.
    const before = w.edge.calls.length;
    expect((await completeConnect(w, req, {}, "sk_live_something")).status).toBe(401);
    expect(w.edge.calls.length).toBe(before);
    // Still pending: nothing above used it up.
    expect(w.kv.keysWith("cookpool:connect:")).toHaveLength(1);
  });

  test("the delegation must be the person's, live, for this client, and the token its own", async () => {
    const w = world();
    const clientId = await register(w);
    const req = await startAuthorize(w, clientId);

    // Not theirs (identity lists none).
    expect((await completeConnect(w, req)).status).toBe(404);
    // Revoked.
    const d = addDelegation(w, clientId, ["kitchen.read"], { revokedAt: new Date().toISOString() });
    expect((await completeConnect(w, req)).status).toBe(404);
    // For another client.
    d.revokedAt = null;
    d.clientId = "someone-else";
    const other = await completeConnect(w, req);
    expect(other.status).toBe(422);
    expect(await json(other)).toMatchObject({ error: { details: { fields: { delegationId: [expect.any(String)] } } } });
    d.clientId = clientId;
    // A token of another delegation.
    const wrong = await completeConnect(w, req, { token: "sps_dlg_cccccccccccccccccccccccccccccccc.x" });
    expect(wrong.status).toBe(422);
    // Not a delegated token at all.
    expect((await completeConnect(w, req, { token: SESSION })).status).toBe(422);
    // No scope Cookpool knows.
    d.scopes = ["admin"];
    expect((await completeConnect(w, req)).status).toBe(422);
    d.scopes = ["kitchen.read"];
    expect((await completeConnect(w, req)).status).toBe(200);
    // Used once: a second Allow finds nothing.
    expect((await completeConnect(w, req)).status).toBe(404);
  });

  test("the scopes come from identity's record, not from what the client asked", async () => {
    const w = world();
    const { accessToken } = await connect(w, ["money.read"]);
    const res = await rpc(w, accessToken, "tools/list");
    const tools = ((await res.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(tools).toEqual(["balances"]);
  });

  test("reconnecting the same assistant ends the old grant and revokes its delegation", async () => {
    const w = world();
    const first = await connect(w, ["kitchen.read"]);
    // A second connection of the same client, with a new delegation.
    const second = "dlg_dddddddddddddddddddddddddddddddd";
    w.delegations.push({ id: second, clientId: first.clientId, scopes: ["kitchen.read"], expiresAt: null, revokedAt: null });
    const req = await startAuthorize(w, first.clientId);
    const done = await completeConnect(w, req, { delegationId: second, token: "sps_dlg_dddddddddddddddddddddddddddddddd.s2" });
    expect(done.status).toBe(200);
    expect(w.delegations.find((d) => d.id === DELEGATION)?.revokedAt).not.toBeNull();
    expect(w.delegations.find((d) => d.id === second)?.revokedAt).toBeNull();
    // The old access token no longer works.
    expect((await rpc(w, first.accessToken, "tools/list")).status).toBe(401);
  });
});

describe("connect/deny", () => {
  test("sends the client access_denied with its state, and uses the request up", async () => {
    const w = world();
    const clientId = await register(w);
    const req = await startAuthorize(w, clientId);
    const deny = (bearer: string | null) =>
      call(w, "/connect/deny", {
        method: "POST",
        headers: { "content-type": "application/json", origin: CONSOLE, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify({ req }),
      });
    expect((await deny(null)).status).toBe(401);
    const res = await deny(SESSION);
    expect(res.status).toBe(200);
    const to = new URL((await json<{ data: { redirectTo: string } }>(res)).data.redirectTo);
    expect(`${to.origin}${to.pathname}`).toBe(REDIRECT);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("st4te");
    expect(to.searchParams.get("code")).toBeNull();
    expect((await deny(SESSION)).status).toBe(404);
    expect((await completeConnect(w, req)).status).toBe(404);
  });
});

describe("CORS on /connect/* only, for the console only", () => {
  test("the console's preflight is allowed", async () => {
    const w = world();
    const res = await call(w, "/connect/complete", {
      method: "OPTIONS",
      headers: { origin: CONSOLE, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(CONSOLE);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  test("another origin gets no CORS headers and is refused", async () => {
    const w = world();
    const pre = await call(w, "/connect/complete", { method: "OPTIONS", headers: { origin: "https://evil.test" } });
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const res = await call(w, "/connect/request?req=" + "a".repeat(43), { headers: { origin: "https://evil.test" } });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("/authorize and /mcp carry no console CORS", async () => {
    const w = world();
    const clientId = await register(w);
    const res = await call(w, await authorizeUrl(clientId), { headers: { origin: CONSOLE } });
    expect(res.headers.get("access-control-allow-origin")).not.toBe(CONSOLE);
  });
});

describe("connect/disconnect", () => {
  test("ends the grant here and revokes the delegation; the assistant must reconnect", async () => {
    const w = world();
    const { accessToken, refreshToken, clientId } = await connect(w, ["kitchen.read"]);
    const res = await call(w, "/connect/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SESSION}`, origin: CONSOLE },
      body: JSON.stringify({ delegationId: DELEGATION }),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ revokedGrants: 1, delegationRevoked: true });
    expect(w.delegations[0]!.revokedAt).not.toBeNull();
    expect((await rpc(w, accessToken, "tools/list")).status).toBe(401);
    const refresh = await call(w, "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString(),
    });
    expect(refresh.status).toBe(400);
  });

  test("only the person's own grants: another session ends nothing", async () => {
    const w = world();
    const { accessToken } = await connect(w, ["kitchen.read"]);
    w.edge.on("GET /v1/auth/session", () => ok({ user: { id: "usr_ffffffffffffffffffffffffffffffff" } }));
    const res = await call(w, "/connect/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SESSION}` },
      body: JSON.stringify({ delegationId: DELEGATION }),
    });
    expect((await json(res)).data).toMatchObject({ revokedGrants: 0 });
    // Its grant here still works (identity, not this worker, decides whose delegation it is).
    expect((await rpc(w, accessToken, "tools/list")).status).toBe(200);
  });
});
