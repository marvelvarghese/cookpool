/// <reference types="@cloudflare/workers-types" />
// Passkeys (Cookpool PK-2): everything that must not sign anyone in or add a
// passkey. A failed sign-in is always the same bare 401 (reason
// passkey_failed); a failed registration a 422 with the same reason (PK-6
// adds its step: passkeys-register-failures.test.ts). Signed
// by a software authenticator that gets one thing wrong at a time.

import { route } from "../../../apps/identity-worker/src/router";
import { PASSKEY_ERROR_REASONS } from "@saas/contracts/passkeys";
import {
  PASSKEY_ENV,
  T0,
  TEST_ORIGIN,
  addPasskey,
  call,
  createdDelegation,
  dataOf,
  errorOf,
  expectPasskeyFailed,
  loginOptions,
  passkeyLogin,
  registerOptions,
  signIn,
  signedIn,
  softAuthenticator,
  world,
  type PasskeyWorld,
} from "./helpers/passkey-world";
import { req, seedApiKey } from "./helpers/delegation-world";

async function withPasskey(w: PasskeyWorld = world()) {
  const { token, userId } = await signIn(w);
  const { device, passkey } = await addPasskey(w, token);
  return { w, token, userId, device, passkey };
}

describe("a sign-in that must fail, always as 401 passkey_failed", () => {
  it("refuses a replayed challenge: the same assertion twice signs in once", async () => {
    const { w, device } = await withPasskey();
    const options = await loginOptions(w);
    const response = await device.get(options);
    await signedIn(await call.loginVerify(w, { response }));
    await expectPasskeyFailed(await call.loginVerify(w, { response }));
    // A fresh signature over the spent challenge, too.
    await expectPasskeyFailed(await call.loginVerify(w, { response: await device.get(options) }));
    expect(w.repo._sessions.size).toBe(2); // the code sign-in and the one passkey sign-in
  });

  it("refuses an expired challenge: 5 minutes, and not a moment longer", async () => {
    const { w, device } = await withPasskey();
    const options = await loginOptions(w);
    w.clock.now = new Date(T0.getTime() + 5 * 60 * 1000);
    await expectPasskeyFailed(await call.loginVerify(w, { response: await device.get(options) }));

    w.clock.now = T0;
    const fresh = await loginOptions(w);
    w.clock.now = new Date(T0.getTime() + 5 * 60 * 1000 - 1);
    await signedIn(await call.loginVerify(w, { response: await device.get(fresh) }));
  });

  it("refuses a challenge it never issued, and a register challenge used to sign in", async () => {
    const { w, token, device } = await withPasskey();
    await expectPasskeyFailed(await call.loginVerify(w, { response: await device.get({ challenge: "bm90LWlzc3VlZA" }) }));
    const reg = await registerOptions(w, token);
    await expectPasskeyFailed(await call.loginVerify(w, { response: await device.get({ challenge: reg.challenge }) }));
  });

  it("refuses a wrong origin, a lookalike included", async () => {
    const { w, device } = await withPasskey();
    for (const origin of ["https://evil.test", "http://localhost:3001", "https://localhost:3000", `${TEST_ORIGIN}/`]) {
      await expectPasskeyFailed(await passkeyLogin(w, device, { origin }));
    }
    // Every origin on the list is accepted.
    await signedIn(await passkeyLogin(w, device, { origin: "http://127.0.0.1:3000" }));
  });

  it("refuses a wrong RP ID", async () => {
    const { w, device } = await withPasskey();
    for (const rpId of ["cookpool.store", "evil.test", "localhost.evil.test"]) {
      await expectPasskeyFailed(await passkeyLogin(w, device, { rpId }));
    }
  });

  it("refuses a sign count that went backwards or stood still", async () => {
    const { w, device } = await withPasskey();
    await signedIn(await passkeyLogin(w, device, { counter: 5 }));
    await expectPasskeyFailed(await passkeyLogin(w, device, { counter: 3 }));
    await expectPasskeyFailed(await passkeyLogin(w, device, { counter: 5 }));
    await signedIn(await passkeyLogin(w, device, { counter: 6 }));
    expect([...w.passkeys._rows.values()][0]!.signCount).toBe(6);
  });

  it("accepts a sign count that stays 0 (synced passkeys)", async () => {
    const { w, device } = await withPasskey();
    await signedIn(await passkeyLogin(w, device, { counter: 0 }));
    await signedIn(await passkeyLogin(w, device, { counter: 0 }));
  });

  it("refuses an unknown credential", async () => {
    const { w } = await withPasskey();
    const stranger = await softAuthenticator();
    stranger.userHandle = Buffer.alloc(16, 7).toString("base64url");
    await expectPasskeyFailed(await passkeyLogin(w, stranger));
  });

  it("refuses a signature from another key under a known credential id", async () => {
    const { w, device } = await withPasskey();
    const forger = await softAuthenticator();
    forger.credentialId = device.credentialId;
    forger.userHandle = device.userHandle;
    await expectPasskeyFailed(await passkeyLogin(w, forger));
  });

  it("refuses a sign-in without user verification", async () => {
    const { w, device } = await withPasskey();
    await expectPasskeyFailed(await passkeyLogin(w, device, { uv: false }));
  });

  it("refuses a user handle that is not the passkey's person", async () => {
    const { w, device } = await withPasskey();
    await expectPasskeyFailed(await passkeyLogin(w, device, { userHandle: Buffer.alloc(16, 1).toString("base64url") }));
    // No user handle at all is fine: the credential names the person.
    await signedIn(await passkeyLogin(w, device, { userHandle: null }));
  });

  it("refuses a registration ceremony offered as a sign-in", async () => {
    const { w, device } = await withPasskey();
    await expectPasskeyFailed(await passkeyLogin(w, device, { type: "webauthn.create" }));
  });

  it.each([undefined, null, "x", {}, { response: {} }, { response: { id: "a", rawId: "b", type: "public-key", response: {} } }])(
    "refuses a malformed body %j the same way",
    async (body) => {
      const w = world();
      await expectPasskeyFailed(await call.loginVerify(w, body));
    },
  );

  it("records each failure, without a credential id", async () => {
    const { w, device } = await withPasskey();
    await passkeyLogin(w, device, { origin: "https://evil.test" });
    const failed = w.repo._securityEvents.filter((e) => e.eventType === "login.complete.failed");
    expect(failed.at(-1)).toMatchObject({ outcome: "not_verified", metadata: { method: "passkey" } });
    expect(JSON.stringify(failed)).not.toContain(device.credentialId);
  });
});

describe("a registration that must fail, as 422 passkey_failed", () => {
  async function refused(w: PasskeyWorld, res: Response) {
    expect(await errorOf(res)).toMatchObject({ status: 422, code: "precondition_failed", reason: "passkey_failed" });
    expect(w.passkeys._rows.size).toBe(0);
  }

  it.each([
    ["a wrong origin", { origin: "https://evil.test" }],
    ["a wrong RP ID", { rpId: "evil.test" }],
    ["no user verification", { uv: false }],
    ["a challenge it never issued", { challenge: "bm90LWlzc3VlZA" }],
  ])("refuses %s", async (_name, knobs) => {
    const w = world();
    const { token } = await signIn(w);
    const device = await softAuthenticator();
    const options = await registerOptions(w, token);
    await refused(w, await call.registerVerify(w, token, { response: await device.create(options, knobs) }));
  });

  it("refuses a replayed and an expired register challenge", async () => {
    const w = world();
    const { token } = await signIn(w);
    const options = await registerOptions(w, token);
    const first = await softAuthenticator();
    await dataOf(await call.registerVerify(w, token, { response: await first.create(options) }), 201);
    const second = await softAuthenticator();
    expect(await errorOf(await call.registerVerify(w, token, { response: await second.create(options) }))).toMatchObject({
      status: 422,
      reason: "passkey_failed",
    });

    const later = await registerOptions(w, token);
    w.clock.now = new Date(T0.getTime() + 5 * 60 * 1000);
    const third = await softAuthenticator();
    expect(await errorOf(await call.registerVerify(w, token, { response: await third.create(later) }))).toMatchObject({
      status: 422,
      reason: "passkey_failed",
    });
    expect(w.passkeys._rows.size).toBe(1);
  });

  it("refuses someone else's register challenge", async () => {
    const w = world();
    const { token: anu } = await signIn(w);
    const { token: meera } = await signIn(w, "meera@cookpool.test");
    const options = await registerOptions(w, anu);
    const device = await softAuthenticator();
    await refused(w, await call.registerVerify(w, meera, { response: await device.create(options) }));
  });

  it.each([
    [{ deviceName: "" }, "deviceName"],
    [{ deviceName: "x".repeat(61) }, "deviceName"],
    [{ deviceName: 7 }, "deviceName"],
    [{}, "response"],
  ])("answers field errors for %j", async (extra, field) => {
    const w = world();
    const { token } = await signIn(w);
    const device = await softAuthenticator();
    const options = await registerOptions(w, token);
    const response = field === "response" ? undefined : await device.create(options);
    const err = await errorOf(await call.registerVerify(w, token, { response, ...extra }));
    expect(err).toMatchObject({ status: 422, code: "validation_failed" });
    expect(Object.keys(err.fields as object)).toEqual([field]);
  });
});

describe("delegated tokens and API keys get 403 on every passkey route", () => {
  it("refuses a delegated token, an API key, on all six, with reason session_required", async () => {
    const { w, token, device, passkey } = await withPasskey();
    const { token: delegated } = await createdDelegation(w, token);
    const apiKey = await seedApiKey(w);
    const options = await loginOptions(w);
    const response = await device.get(options);
    for (const bearer of [delegated, apiKey]) {
      const answers = [
        await call.registerOptions(w, bearer),
        await call.registerVerify(w, bearer, { response }),
        await call.list(w, bearer),
        await call.remove(w, bearer, passkey.id),
        await call.loginOptions(w, bearer),
        await call.loginVerify(w, { response }, bearer),
      ];
      for (const res of answers) {
        expect(await errorOf(res)).toMatchObject({ status: 403, code: "forbidden", reason: PASSKEY_ERROR_REASONS.SESSION_REQUIRED });
      }
    }
    // Nothing moved: the passkey is there and the challenge is unspent.
    expect(w.passkeys._rows.size).toBe(1);
    await signedIn(await call.loginVerify(w, { response }));
  });

  it("answers 401 to the session routes without a session", async () => {
    const { w, passkey } = await withPasskey();
    for (const res of [
      await call.registerOptions(w, null),
      await call.registerVerify(w, null, {}),
      await call.list(w, null),
      await call.remove(w, null, passkey.id),
    ]) {
      expect((await errorOf(res)).status).toBe(401);
    }
  });
});

describe("PASSKEY_RP_ID empty turns every route off", () => {
  it.each([
    ["an empty RP ID", { ...PASSKEY_ENV, PASSKEY_RP_ID: "" }],
    ["no RP ID", { ENVIRONMENT: "test", PASSKEY_ORIGINS: TEST_ORIGIN }],
    ["no origins", { ...PASSKEY_ENV, PASSKEY_ORIGINS: " , " }],
  ])("with %s, all six answer 404 passkeys_off before anything else", async (_name, env) => {
    const on = await withPasskey();
    const w: PasskeyWorld = { ...on.w, env: env as PasskeyWorld["env"] };
    const { token } = await signIn(w);
    const { token: delegated } = await createdDelegation(w, token);
    for (const bearer of [token, delegated, null]) {
      const answers = [
        await call.registerOptions(w, bearer),
        await call.registerVerify(w, bearer, {}),
        await call.list(w, bearer),
        await call.remove(w, bearer, on.passkey.id),
        await call.loginOptions(w, bearer),
        await call.loginVerify(w, {}, bearer),
      ];
      for (const res of answers) {
        expect(await errorOf(res)).toMatchObject({ status: 404, code: "not_found", reason: "passkeys_off" });
      }
    }
    expect(w.passkeys._rows.size).toBe(1);
  });
});

describe("the router", () => {
  it("routes the six paths and refuses other methods with 405", async () => {
    const env = { ...PASSKEY_ENV, PASSKEY_RP_ID: "" };
    const off = async (path: string, method: string) => {
      const res = await route(req(path, method, null, method === "GET" || method === "DELETE" ? undefined : {}), env);
      return res.status;
    };
    expect(await off("/v1/auth/passkeys/register/options", "POST")).toBe(404);
    expect(await off("/v1/auth/passkeys/register/verify", "POST")).toBe(404);
    expect(await off("/v1/auth/passkeys", "GET")).toBe(404);
    expect(await off("/v1/auth/passkeys/pky_0000000000000000", "DELETE")).toBe(404);
    expect(await off("/v1/auth/passkeys/login/options", "POST")).toBe(404);
    expect(await off("/v1/auth/passkeys/login/verify", "POST")).toBe(404);
    expect(await off("/v1/auth/passkeys/login/options", "GET")).toBe(405);
    expect(await off("/v1/auth/passkeys", "POST")).toBe(405);
    expect(await off("/v1/auth/passkeys/pky_0000000000000000", "GET")).toBe(405);
  });
});
