// Delegated tokens for assistants (cookpool-mcp MC-2): AuthClient's
// delegations(), createDelegation() and revokeDelegation() — URL, verb, body,
// the caller's idempotency key, and a refusal as a ForbiddenError.

import { describe, expect, it, vi } from "vitest";

import { Cookpool, DELEGATION_SCOPES } from "../index.js";
import { ForbiddenError } from "../errors.js";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function captureFetch(status: number, body: unknown): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fn: typeof fetch = vi.fn(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch: fn, calls };
}

const ok = <T>(data: T) => ({ data, meta: { requestId: "req_test", cursor: null } });
const client = (f: typeof fetch) => new Cookpool({ baseUrl: "https://api.test", fetch: f });

const DELEGATION = {
  id: "dlg_0123456789abcdef0123456789abcdef",
  scopes: ["kitchen.read", "timers.write"],
  clientName: "Claude",
  clientId: "cli_abc",
  createdAt: "2026-11-09T12:00:00.000Z",
  expiresAt: "2027-02-07T12:00:00.000Z",
  lastUsedAt: null,
};

describe("AuthClient delegations (MC-2)", () => {
  it("publishes the five scopes in order (money.write added by Spliteco SE5)", () => {
    expect(DELEGATION_SCOPES).toEqual(["kitchen.read", "money.read", "timers.write", "suggest.write", "money.write"]);
  });

  it("delegations() GETs /v1/auth/delegations", async () => {
    const { fetch, calls } = captureFetch(200, ok({ delegations: [DELEGATION] }));
    const out = await client(fetch).auth.delegations();
    expect(calls[0]!.url).toBe("https://api.test/v1/auth/delegations");
    expect(calls[0]!.init.method).toBe("GET");
    expect(out.delegations[0]!.id).toBe(DELEGATION.id);
  });

  it("createDelegation() POSTs the body and passes the caller's idempotency key", async () => {
    const token = "sps_dlg_0123456789abcdef0123456789abcdef.secret";
    const { fetch, calls } = captureFetch(201, ok({ delegation: DELEGATION, token }));
    const input = { scopes: ["kitchen.read" as const, "timers.write" as const], clientName: "Claude", clientId: "cli_abc" };
    const out = await client(fetch).auth.createDelegation(input, { idempotencyKey: "ik_1" });
    expect(calls[0]!.url).toBe("https://api.test/v1/auth/delegations");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(input);
    expect(new Headers(calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ik_1");
    expect(out.token).toBe(token);
  });

  it("revokeDelegation() DELETEs /v1/auth/delegations/:id, encoded", async () => {
    const { fetch, calls } = captureFetch(200, ok({ id: DELEGATION.id, revokedAt: "2026-11-09T13:00:00.000Z" }));
    const out = await client(fetch).auth.revokeDelegation(DELEGATION.id);
    expect(calls[0]!.url).toBe(`https://api.test/v1/auth/delegations/${DELEGATION.id}`);
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(out.revokedAt).toBe("2026-11-09T13:00:00.000Z");

    await client(fetch).auth.revokeDelegation("a/b");
    expect(calls[1]!.url).toBe("https://api.test/v1/auth/delegations/a%2Fb");
  });

  it("a refusal surfaces as a ForbiddenError with its reason", async () => {
    const { fetch } = captureFetch(403, {
      error: { code: "forbidden", message: "no", details: { reason: "scope" }, requestId: "req_err" },
    });
    const err = await client(fetch).auth.delegations().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).details).toMatchObject({ reason: "scope" });
  });
});
