// Passkeys (cookpool-passkeys PK-2): AuthClient's six passkey methods — URL,
// verb, body, and a refusal as the matching error.

import { describe, expect, it, vi } from "vitest";

import { Cookpool } from "../index.js";
import { ConflictError, UnauthenticatedError } from "../errors.js";

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

const PASSKEY = { id: "pky_0123456789abcdef", deviceName: "iPhone", createdAt: "2026-11-12T12:00:00.000Z", lastUsedAt: null, backedUp: true };
const REGISTRATION = {
  id: "cred",
  rawId: "cred",
  type: "public-key" as const,
  response: { clientDataJSON: "cdj", attestationObject: "ao", transports: ["internal" as const] },
  clientExtensionResults: {},
};
const ASSERTION = {
  id: "cred",
  rawId: "cred",
  type: "public-key" as const,
  response: { clientDataJSON: "cdj", authenticatorData: "ad", signature: "sig", userHandle: "uh" },
  clientExtensionResults: {},
};

describe("AuthClient passkeys (PK-2)", () => {
  it("passkeyRegisterOptions() POSTs /v1/auth/passkeys/register/options", async () => {
    const { fetch, calls } = captureFetch(200, ok({ options: { challenge: "c" } }));
    const out = await client(fetch).auth.passkeyRegisterOptions();
    expect([calls[0]!.url, calls[0]!.init.method]).toEqual(["https://api.test/v1/auth/passkeys/register/options", "POST"]);
    expect(out.options.challenge).toBe("c");
  });

  it("passkeyRegisterVerify() POSTs the response and device name", async () => {
    const { fetch, calls } = captureFetch(201, ok({ passkey: PASSKEY }));
    const input = { response: REGISTRATION, deviceName: "Anu's iPhone" };
    const out = await client(fetch).auth.passkeyRegisterVerify(input);
    expect([calls[0]!.url, calls[0]!.init.method]).toEqual(["https://api.test/v1/auth/passkeys/register/verify", "POST"]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(input);
    expect(out.passkey).toEqual(PASSKEY);
  });

  it("passkeys() GETs /v1/auth/passkeys", async () => {
    const { fetch, calls } = captureFetch(200, ok({ passkeys: [PASSKEY] }));
    const out = await client(fetch).auth.passkeys();
    expect([calls[0]!.url, calls[0]!.init.method]).toEqual(["https://api.test/v1/auth/passkeys", "GET"]);
    expect(out.passkeys).toHaveLength(1);
  });

  it("removePasskey() DELETEs /v1/auth/passkeys/:id, encoded", async () => {
    const { fetch, calls } = captureFetch(200, ok({ id: PASSKEY.id, removedAt: "2026-11-12T12:00:05.000Z" }));
    await client(fetch).auth.removePasskey(PASSKEY.id);
    await client(fetch).auth.removePasskey("a/b");
    expect([calls[0]!.url, calls[0]!.init.method]).toEqual([`https://api.test/v1/auth/passkeys/${PASSKEY.id}`, "DELETE"]);
    expect(calls[1]!.url).toBe("https://api.test/v1/auth/passkeys/a%2Fb");
  });

  it("passkeyLoginOptions() POSTs /v1/auth/passkeys/login/options", async () => {
    const { fetch, calls } = captureFetch(200, ok({ options: { challenge: "c", allowCredentials: [] } }));
    const out = await client(fetch).auth.passkeyLoginOptions();
    expect([calls[0]!.url, calls[0]!.init.method]).toEqual(["https://api.test/v1/auth/passkeys/login/options", "POST"]);
    expect(out.options.allowCredentials).toEqual([]);
  });

  it("passkeyLoginVerify() POSTs the assertion and answers the session body", async () => {
    const session = { token: "sps_ses_x.y", tokenType: "bearer", expiresAt: "2026-12-12T12:00:00.000Z", user: { id: "usr_1", email: "anu@cookpool.test", displayName: null } };
    const { fetch, calls } = captureFetch(200, ok(session));
    const out = await client(fetch).auth.passkeyLoginVerify({ response: ASSERTION });
    expect([calls[0]!.url, calls[0]!.init.method]).toEqual(["https://api.test/v1/auth/passkeys/login/verify", "POST"]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ response: ASSERTION });
    expect(out).toEqual(session);
  });

  it("surfaces a failed sign-in and the limit as typed errors with their reasons", async () => {
    const failed = captureFetch(401, { error: { code: "unauthenticated", message: "Passkey sign-in failed", details: { reason: "passkey_failed" }, requestId: "r" } });
    await expect(client(failed.fetch).auth.passkeyLoginVerify({ response: ASSERTION })).rejects.toBeInstanceOf(UnauthenticatedError);
    const full = captureFetch(409, { error: { code: "conflict", message: "At most 10 passkeys", details: { reason: "too_many_passkeys" }, requestId: "r" } });
    await expect(client(full.fetch).auth.passkeyRegisterOptions()).rejects.toMatchObject({ details: { reason: "too_many_passkeys" } });
    await expect(client(full.fetch).auth.passkeyRegisterOptions()).rejects.toBeInstanceOf(ConflictError);
  });
});
