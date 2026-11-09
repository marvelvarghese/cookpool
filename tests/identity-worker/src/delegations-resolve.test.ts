// Delegated tokens for assistants (cookpool-mcp MC-2, design §1): what
// resolveBearer answers for a `sps_dlg_` token (the user plus the delegation,
// while live; last_used_at at most hourly), and the internal refresh that
// mcp-worker calls to rotate one.

import type { RefreshDelegationResponse } from "@saas/contracts/delegations";
import { createAuthService } from "../../../apps/identity-worker/src/services/auth";
import { handleInternalRefreshDelegation } from "../../../apps/identity-worker/src/handlers/delegations";
import { route } from "../../../apps/identity-worker/src/router";
import { DAY, T0, created, env, errorOf, req, signIn, world } from "./helpers/delegation-world";

describe("resolveBearer for a delegated token", () => {
  it("resolves a live one as the user, with the delegation's id, scopes and client name and no session", async () => {
    const w = world();
    const { token, userId } = await signIn(w);
    const out = await created(w, token);
    const r = await w.auth.resolveBearer(out.token);
    expect(r).toEqual({
      actorType: "user",
      actorId: userId,
      email: "anu@cookpool.test",
      displayName: null,
      user: { id: userId, email: "anu@cookpool.test", displayName: null },
      delegation: { id: out.delegation.id, scopes: ["kitchen.read", "timers.write"], clientName: "Claude" },
    });
    expect(r).not.toHaveProperty("session");
  });

  it("leaves a session's resolution as it was: no delegation", async () => {
    const w = world();
    const { token } = await signIn(w);
    const r = await w.auth.resolveBearer(token);
    expect(r).toMatchObject({ actorType: "user", session: expect.any(Object) });
    expect(r).not.toHaveProperty("delegation");
  });

  it("refuses a wrong secret, an unknown id, a malformed token, and any token once its 90 days are up", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token);
    const [prefixAndId] = out.token.split(".");
    for (const bad of [`${prefixAndId}.${"0".repeat(64)}`, `sps_dlg_${"e".repeat(32)}.abc`, "sps_dlg_nope", "sps_dlg_.x"]) {
      expect(await w.auth.resolveBearer(bad)).toMatchObject({ error: "unauthenticated" });
    }
    w.clock.now = new Date(T0.getTime() + 90 * DAY - 1);
    expect("error" in (await w.auth.resolveBearer(out.token))).toBe(false);
    w.clock.now = new Date(T0.getTime() + 90 * DAY);
    expect(await w.auth.resolveBearer(out.token)).toMatchObject({ error: "unauthenticated" });
  });

  it("is refused by a service built without the delegations repository, and never read as an API key", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token);
    let apiKeyLookups = 0;
    const repo = { ...w.repo, getApiKeyByKeyHash: async (h: string) => (apiKeyLookups++, w.repo.getApiKeyByKeyHash(h)) };
    const bare = createAuthService({ repo, now: () => w.clock.now });
    expect(await bare.resolveBearer(out.token)).toMatchObject({ error: "unauthenticated" });
    expect(apiKeyLookups).toBe(0);
  });

  it("moves lastUsedAt on first use and then at most once an hour", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token);
    const row = () => [...w.delegations._rows.values()][0]!;

    await w.auth.resolveBearer(out.token);
    expect(row().lastUsedAt).toEqual(T0);
    for (const minutes of [1, 30, 59]) {
      w.clock.now = new Date(T0.getTime() + minutes * 60_000);
      await w.auth.resolveBearer(out.token);
    }
    expect(w.delegations._touches).toBe(1);
    w.clock.now = new Date(T0.getTime() + 60 * 60_000);
    await w.auth.resolveBearer(out.token);
    expect(w.delegations._touches).toBe(2);
    expect(row().lastUsedAt).toEqual(w.clock.now);
  });
});

describe("POST /v1/internal/delegations/refresh", () => {
  const refresh = (w: ReturnType<typeof world>, body: unknown, actor: string | null = "mcp-worker") =>
    handleInternalRefreshDelegation(
      req("/v1/internal/delegations/refresh", "POST", null, body, actor ? { "x-internal-actor": actor } : {}),
      env,
      "req_t",
      w.deps,
    );

  it("rotates the secret and restarts the 90 days: the old token stops, the new one resolves", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token);
    w.clock.now = new Date(T0.getTime() + 80 * DAY);
    const res = await refresh(w, { delegationId: out.delegation.id });
    expect(res.status).toBe(200);
    const next = ((await res.json()) as { data: RefreshDelegationResponse }).data;
    expect(next.delegation).toMatchObject({ id: out.delegation.id, expiresAt: new Date(w.clock.now.getTime() + 90 * DAY).toISOString() });
    expect(next.token).toMatch(/^sps_dlg_[0-9a-f]{32}\.[0-9a-f]{64}$/);
    expect(next.token).not.toBe(out.token);
    expect(await w.auth.resolveBearer(out.token)).toMatchObject({ error: "unauthenticated" });
    w.clock.now = new Date(T0.getTime() + 150 * DAY);
    expect(await w.auth.resolveBearer(next.token)).toMatchObject({ delegation: { id: out.delegation.id } });
  });

  it("refuses a revoked or expired delegation with its reason, and an unknown one with 404", async () => {
    const w = world();
    const { token } = await signIn(w);
    const revoked = await created(w, token);
    await w.delegations.revoke([...w.delegations._rows.keys()][0]!, [...w.delegations._rows.values()][0]!.userId, T0);
    const expired = await created(w, token);
    w.clock.now = new Date(T0.getTime() + 91 * DAY);
    expect(await errorOf(await refresh(w, { delegationId: revoked.delegation.id }))).toMatchObject({
      status: 422,
      code: "precondition_failed",
      reason: "revoked",
    });
    expect(await errorOf(await refresh(w, { delegationId: expired.delegation.id }))).toMatchObject({
      status: 422,
      code: "precondition_failed",
      reason: "expired",
    });
    expect((await refresh(w, { delegationId: `dlg_${"c".repeat(32)}` })).status).toBe(404);
    expect(await errorOf(await refresh(w, { delegationId: "ses_x" }))).toMatchObject({ status: 422, code: "validation_failed" });
    expect(await errorOf(await refresh(w, "nope"))).toMatchObject({ status: 422, code: "validation_failed" });
  });

  it("reads as a route that does not exist to any caller but mcp-worker, and rotates nothing", async () => {
    const w = world();
    const { token } = await signIn(w);
    const out = await created(w, token);
    for (const actor of [null, "membership-worker", "kitchen-worker", ""]) {
      expect((await refresh(w, { delegationId: out.delegation.id }, actor)).status).toBe(404);
    }
    expect("error" in (await w.auth.resolveBearer(out.token))).toBe(false);
  });

  it("through the router: 404 before the method or the database is looked at", async () => {
    for (const [method, headers] of [
      ["POST", {}],
      ["GET", { "x-internal-actor": "mcp-worker" }],
    ] as const) {
      const res = await route(req("/v1/internal/delegations/refresh", method, null, method === "POST" ? {} : undefined, headers), env);
      expect(res.status).toBe(404);
    }
  });
});

describe("the router", () => {
  it("routes the delegation paths, and 405s the methods they do not take", async () => {
    // No database configured: a route reached answers 503, one not taken 405.
    expect((await route(req("/v1/auth/delegations", "GET", "sps_ses_x.y"), env)).status).toBe(503);
    expect((await route(req("/v1/auth/delegations", "PUT", "sps_ses_x.y"), env)).status).toBe(405);
    expect((await route(req(`/v1/auth/delegations/dlg_${"0".repeat(32)}`, "DELETE", "sps_ses_x.y"), env)).status).toBe(503);
    expect((await route(req(`/v1/auth/delegations/dlg_${"0".repeat(32)}`, "GET", "sps_ses_x.y"), env)).status).toBe(405);
  });
});
