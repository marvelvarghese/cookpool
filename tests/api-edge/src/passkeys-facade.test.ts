// Passkeys at the edge (Cookpool PK-2): the auth facade forwards the six
// passkey routes to identity-worker with their methods (and the user agent,
// which names a passkey nobody named), the public two without a session; a
// delegated token is refused on every one before anything is forwarded.

import { isAuthRoute } from "@api-edge/auth-facade";
import { ALL_SCOPES, SESSION_TOKEN, delegatedActor, delegatedToken, edge, reasonOf, sessionActor } from "./delegation-fixtures";

const PKY = "pky_0123456789abcdef";

const ROUTES: Array<[string, string]> = [
  ["POST", "/v1/auth/passkeys/register/options"],
  ["POST", "/v1/auth/passkeys/register/verify"],
  ["GET", "/v1/auth/passkeys"],
  ["DELETE", `/v1/auth/passkeys/${PKY}`],
  ["POST", "/v1/auth/passkeys/login/options"],
  ["POST", "/v1/auth/passkeys/login/verify"],
];

describe("the auth facade's passkey routes (PK-2)", () => {
  it("knows the six paths, and not their neighbours", () => {
    for (const [, path] of ROUTES) expect([path, isAuthRoute(path)]).toEqual([path, true]);
    for (const path of ["/v1/auth/passkeys/register", "/v1/auth/passkeys/login", "/v1/auth/passkeys/abc", "/v1/auth/passkeys/pky_1/x"]) {
      expect([path, isAuthRoute(path)]).toEqual([path, false]);
    }
  });

  it("forwards each to identity-worker with its method, path, bearer and user agent", async () => {
    const e = edge({ [SESSION_TOKEN]: sessionActor });
    for (const [method, path] of ROUTES) {
      const res = await e.fetch(path, method, { token: SESSION_TOKEN, headers: { "user-agent": "Mozilla/5.0 (iPhone)" } });
      expect([method, path, res.status]).toEqual([method, path, 200]);
    }
    expect(e.forwarded.map((f) => [f.binding, new URL(f.url).pathname])).toEqual(ROUTES.map(([, p]) => ["IDENTITY_WORKER", p]));
    for (const f of e.forwarded) {
      expect(f.headers.get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
      expect(f.headers.get("user-agent")).toBe("Mozilla/5.0 (iPhone)");
    }
  });

  it("forwards login options and verify without a session", async () => {
    const e = edge();
    for (const path of ["/v1/auth/passkeys/login/options", "/v1/auth/passkeys/login/verify"]) {
      expect((await e.fetch(path, "POST", { token: null })).status).toBe(200);
    }
    expect(e.forwarded).toHaveLength(2);
    expect(e.forwarded.every((f) => f.headers.get("authorization") === null)).toBe(true);
  });

  it("refuses other methods with 405, forwarding nothing", async () => {
    const e = edge({ [SESSION_TOKEN]: sessionActor });
    for (const [method, path] of [
      ["GET", "/v1/auth/passkeys/login/options"],
      ["PUT", "/v1/auth/passkeys/register/verify"],
      ["POST", "/v1/auth/passkeys"],
      ["DELETE", "/v1/auth/passkeys"],
      ["GET", `/v1/auth/passkeys/${PKY}`],
    ] as const) {
      expect([method, path, (await e.fetch(path, method, { token: SESSION_TOKEN })).status]).toEqual([method, path, 405]);
    }
    expect(e.forwarded).toEqual([]);
  });

  it("refuses a delegated token on all six with reason scope — the allowlist has no auth route", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(ALL_SCOPES) });
    for (const [method, path] of ROUTES) {
      const got = await reasonOf(await e.fetch(path, method));
      expect([method, path, got.status, got.reason]).toEqual([method, path, 403, "scope"]);
    }
    expect(e.forwarded).toEqual([]);
    expect(e.resolves()).toBe(0);
  });
});
