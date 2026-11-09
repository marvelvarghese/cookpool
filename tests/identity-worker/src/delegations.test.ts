// Delegated tokens for assistants (cookpool-mcp MC-2, design §1):
//   POST/GET /v1/auth/delegations, DELETE /v1/auth/delegations/{dlg} — a
//   signed-in session only.

import type { DelegationsListResponse, RevokeDelegationResponse } from "@saas/contracts/delegations";
import { hashSha256 } from "../../../apps/identity-worker/src/crypto";
import { handleListDelegations, handleRevokeDelegation } from "../../../apps/identity-worker/src/handlers/delegations";
import {
  BODY,
  DAY,
  T0,
  create,
  created,
  env,
  errorOf,
  req,
  seedApiKey,
  signIn,
  world,
  type World,
} from "./helpers/delegation-world";

describe("POST /v1/auth/delegations", () => {
  it("mints a delegation for the session's user, with the token shown once", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token);
    expect(out.delegation).toEqual({
      id: expect.stringMatching(/^dlg_[0-9a-f]{32}$/),
      // Stored once each, in the contract's order.
      scopes: ["kitchen.read", "timers.write"],
      clientName: "Claude",
      clientId: "cli_abc123",
      createdAt: T0.toISOString(),
      expiresAt: new Date(T0.getTime() + 90 * DAY).toISOString(),
      lastUsedAt: null,
    });
    expect(out.token).toMatch(/^sps_dlg_[0-9a-f]{32}\.[0-9a-f]{64}$/);
    expect(out.token.slice(8, 40)).toBe(out.delegation.id.slice(4));
  });

  it("stores only the hash of the token's secret", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token);
    const [row] = [...w.delegations._rows.values()];
    const secret = out.token.split(".")[1]!;
    expect(row!.tokenHash).toBe(await hashSha256(secret));
    expect(JSON.stringify(row)).not.toContain(secret);
    // The security event names the delegation, never the token.
    const event = w.repo._securityEvents.find((e) => e.eventType === "delegation.created");
    expect(event?.metadata).toMatchObject({ delegationId: out.delegation.id, scopes: ["kitchen.read", "timers.write"] });
    expect(JSON.stringify(w.repo._securityEvents)).not.toContain(secret);
  });

  it.each([
    [{ ...BODY, scopes: [] }, "scopes"],
    [{ ...BODY, scopes: ["kitchen.read", "kitchen.write"] }, "scopes"],
    [{ ...BODY, scopes: "kitchen.read" }, "scopes"],
    [{ ...BODY, clientName: "   " }, "clientName"],
    [{ ...BODY, clientName: "x".repeat(81) }, "clientName"],
    [{ ...BODY, clientId: "" }, "clientId"],
    [{ ...BODY, clientId: "has space" }, "clientId"],
    [{ ...BODY, clientId: "c".repeat(129) }, "clientId"],
    [{ ...BODY, requestId: 7 }, "requestId"],
    ["not json", "body"],
  ])("refuses %j with field errors on %s", async (body, field) => {
    const w = world();
    const { token } = await signIn(w);
    const err = await errorOf(await create(w, token, body));
    expect(err).toMatchObject({ status: 422, code: "validation_failed" });
    expect(Object.keys(err.fields as object)).toContain(field);
    expect(w.delegations._rows.size).toBe(0);
  });

  it("accepts the design's optional requestId and ignores it", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token, { ...BODY, requestId: "areq_123" });
    expect(out.delegation.clientName).toBe("Claude");
  });
});

describe("the delegation routes take a signed-in session only", () => {
  async function callers(w: World) {
    const { token: session } = await signIn(w);
    const { token: delegated } = await created(w, session);
    const apiKey = await seedApiKey(w);
    return { session, delegated, apiKey };
  }

  const calls = (w: World, token: string | null) => [
    () => create(w, token),
    () => handleListDelegations(req("/v1/auth/delegations", "GET", token), env, "req_t", w.deps),
    () =>
      handleRevokeDelegation(
        req(`/v1/auth/delegations/dlg_${"0".repeat(32)}`, "DELETE", token),
        env,
        "req_t",
        w.deps,
      ),
  ];

  it("refuses a delegated token on create, list and revoke with reason session_required", async () => {
    const w = world();
    const { delegated } = await callers(w);
    for (const call of calls(w, delegated)) {
      expect(await errorOf(await call())).toMatchObject({ status: 403, code: "forbidden", reason: "session_required" });
    }
    // It minted nothing more.
    expect(w.delegations._rows.size).toBe(1);
  });

  it("refuses an API key the same way", async () => {
    const w = world();
    const { apiKey } = await callers(w);
    for (const call of calls(w, apiKey)) {
      expect(await errorOf(await call())).toMatchObject({ status: 403, code: "forbidden", reason: "session_required" });
    }
  });

  it("answers 401 without a token, or with a session that is unknown, revoked or expired", async () => {
    const w = world();
    const { session } = await callers(w);
    for (const call of calls(w, null)) expect((await call()).status).toBe(401);
    for (const call of calls(w, `sps_ses_${"a".repeat(32)}.nope`)) expect((await call()).status).toBe(401);
    w.clock.now = new Date(T0.getTime() + 31 * DAY);
    for (const call of calls(w, session)) expect((await call()).status).toBe(401);
  });
});

describe("GET and DELETE /v1/auth/delegations", () => {
  it("lists the user's live delegations, newest first, without anyone else's", async () => {
    const w = world();
    const { token: anu } = await signIn(w);
    const { token: meera } = await signIn(w, "meera@cookpool.test");
    const first = await created(w, anu);
    w.clock.now = new Date(T0.getTime() + 1000);
    const second = await created(w, anu, { ...BODY, clientName: "ChatGPT" });
    await created(w, meera, { ...BODY, clientName: "Gemini" });

    const res = await handleListDelegations(req("/v1/auth/delegations", "GET", anu), env, "req_t", w.deps);
    const list = ((await res.json()) as { data: DelegationsListResponse }).data.delegations;
    expect(list.map((d) => d.id)).toEqual([second.delegation.id, first.delegation.id]);
    expect(JSON.stringify(list)).not.toContain("sps_dlg_");
  });

  it("revokes one: it leaves the list, stops resolving, and revoking again answers the same time", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token);
    expect("error" in (await w.auth.resolveBearer(out.token))).toBe(false);

    w.clock.now = new Date(T0.getTime() + 5000);
    const del = () =>
      handleRevokeDelegation(req(`/v1/auth/delegations/${out.delegation.id}`, "DELETE", token), env, "req_t", w.deps);
    const res = await del();
    expect(res.status).toBe(200);
    const revoked = ((await res.json()) as { data: RevokeDelegationResponse }).data;
    expect(revoked).toEqual({ id: out.delegation.id, revokedAt: w.clock.now.toISOString() });

    expect(await w.auth.resolveBearer(out.token)).toMatchObject({ error: "unauthenticated" });
    const list = await handleListDelegations(req("/v1/auth/delegations", "GET", token), env, "req_t", w.deps);
    expect(((await list.json()) as { data: DelegationsListResponse }).data.delegations).toEqual([]);

    w.clock.now = new Date(T0.getTime() + 9000);
    expect(((await (await del()).json()) as { data: RevokeDelegationResponse }).data.revokedAt).toBe(revoked.revokedAt);
    expect(w.repo._securityEvents.filter((e) => e.eventType === "delegation.revoked")).toHaveLength(1);
  });

  it("answers 404 for someone else's delegation, an unknown one and a malformed id", async () => {
    const w = world();
    const { token: anu } = await signIn(w);
    const { token: meera } = await signIn(w, "meera@cookpool.test");
    const theirs = await created(w, meera);
    for (const id of [theirs.delegation.id, `dlg_${"f".repeat(32)}`, "dlg_nope", "ses_abc"]) {
      const res = await handleRevokeDelegation(req(`/v1/auth/delegations/${id}`, "DELETE", anu), env, "req_t", w.deps);
      expect(await errorOf(res)).toMatchObject({ status: 404, code: "not_found" });
    }
    // Meera's still works.
    expect("error" in (await w.auth.resolveBearer(theirs.token))).toBe(false);
  });
});
