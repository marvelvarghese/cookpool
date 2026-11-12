/// <reference types="@cloudflare/workers-types" />
// Passkey fixes from the first phone test (Cookpool PK-6). A passkey whose
// browser reports credProps.rk false is stored (iPhone Safari can say so for
// one it has just saved). Every refused registration writes
// `passkey.add.failed` with the step as its outcome, never the credential, and
// its 422 says which step in `details.step`. Sign-in refusals stay opaque.

import { PASSKEY_REGISTER_STEPS, type PasskeyRegisterStep } from "@saas/contracts/passkeys";
import {
  addPasskey,
  call,
  dataOf,
  expectPasskeyFailed,
  passkeyLogin,
  registerOptions,
  signIn,
  signedIn,
  softAuthenticator,
  world,
  type PasskeyWorld,
} from "./helpers/passkey-world";

async function errorBody(res: Response) {
  const json = (await res.json()) as { error: { code: string; details?: Record<string, unknown> } };
  return { status: res.status, code: json.error.code, details: json.error.details ?? {} };
}

function addFailures(w: PasskeyWorld) {
  return w.repo._securityEvents.filter((e) => e.eventType === "passkey.add.failed");
}

function expectRecorded(w: PasskeyWorld, step: PasskeyRegisterStep, credentialId?: string) {
  const failed = addFailures(w);
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ outcome: step, metadata: { method: "passkey", step } });
  expect(failed[0]!.userId).toBeTruthy();
  expect(failed[0]!.sessionId).toBeTruthy();
  if (credentialId) expect(JSON.stringify(failed)).not.toContain(credentialId);
}

describe("credProps.rk is a hint, not a check", () => {
  it("stores a passkey whose browser reports rk false, and it signs in", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { device, passkey } = await addPasskey(w, token, { knobs: { rk: false } });
    expect(passkey.id).toMatch(/^pky_/);
    expect(w.passkeys._rows.size).toBe(1);
    expect(addFailures(w)).toHaveLength(0);
    expect(w.repo._securityEvents.some((e) => e.eventType === "passkey.added")).toBe(true);
    await signedIn(await passkeyLogin(w, device));
  });
});

describe("a refused registration names its step", () => {
  it.each([
    ["a challenge it never issued", { challenge: "bm90LWlzc3VlZA" }, PASSKEY_REGISTER_STEPS.INVALID_CHALLENGE],
    ["a wrong origin", { origin: "https://evil.test" }, PASSKEY_REGISTER_STEPS.NOT_VERIFIED],
    ["a wrong RP ID", { rpId: "evil.test" }, PASSKEY_REGISTER_STEPS.NOT_VERIFIED],
    ["no user verification", { uv: false }, PASSKEY_REGISTER_STEPS.NOT_USER_VERIFIED],
  ])("%s: 422 passkey_failed with details.step, and passkey.add.failed", async (_name, knobs, step) => {
    const w = world();
    const { token } = await signIn(w);
    const device = await softAuthenticator();
    const options = await registerOptions(w, token);
    const res = await call.registerVerify(w, token, { response: await device.create(options, knobs) });
    expect(await errorBody(res)).toEqual({ status: 422, code: "precondition_failed", details: { reason: "passkey_failed", step } });
    expect(w.passkeys._rows.size).toBe(0);
    expectRecorded(w, step, device.credentialId);
  });

  it("a replayed challenge is invalid_challenge", async () => {
    const w = world();
    const { token } = await signIn(w);
    const options = await registerOptions(w, token);
    await dataOf(await call.registerVerify(w, token, { response: await (await softAuthenticator()).create(options) }), 201);
    const res = await call.registerVerify(w, token, { response: await (await softAuthenticator()).create(options) });
    expect((await errorBody(res)).details).toEqual({ reason: "passkey_failed", step: "invalid_challenge" });
    expectRecorded(w, "invalid_challenge");
  });

  it("the same credential twice is duplicate (409)", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { device } = await addPasskey(w, token);
    const options = await registerOptions(w, token);
    const res = await call.registerVerify(w, token, { response: await device.create(options) });
    expect(await errorBody(res)).toMatchObject({ status: 409, code: "conflict" });
    expectRecorded(w, "duplicate", device.credentialId);
  });

  it("a store that fails is store_failed (500)", async () => {
    const w = world();
    const { token } = await signIn(w);
    const device = await softAuthenticator();
    const options = await registerOptions(w, token);
    w.passkeys.create = async () => ({ ok: false, error: { kind: "internal", message: "d1 down" } });
    const res = await call.registerVerify(w, token, { response: await device.create(options) });
    expect(await errorBody(res)).toMatchObject({ status: 500, code: "internal_error" });
    expectRecorded(w, "store_failed", device.credentialId);
  });

  it("the 10-passkey limit is too_many, at options and at verify", async () => {
    const w = world();
    const { token } = await signIn(w);
    for (let i = 0; i < 9; i++) await addPasskey(w, token);
    const early = await registerOptions(w, token);
    await addPasskey(w, token);
    const atOptions = await errorBody(await call.registerOptions(w, token));
    expect(atOptions).toMatchObject({ status: 409, details: { reason: "too_many_passkeys" } });
    const device = await softAuthenticator();
    const atVerify = await errorBody(await call.registerVerify(w, token, { response: await device.create(early) }));
    expect(atVerify).toMatchObject({ status: 409, details: { reason: "too_many_passkeys" } });
    const failed = addFailures(w);
    expect(failed.map((e) => e.outcome)).toEqual(["too_many", "too_many"]);
    expect(JSON.stringify(failed)).not.toContain(device.credentialId);
  });

  it("never puts the key or the credential in the event", async () => {
    const w = world();
    const { token } = await signIn(w);
    const device = await softAuthenticator();
    const options = await registerOptions(w, token);
    const response = await device.create(options, { uv: false });
    await call.registerVerify(w, token, { response });
    const text = JSON.stringify(addFailures(w));
    for (const secret of [response.id, response.rawId, response.response.attestationObject, response.response.clientDataJSON]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("sign-in refusals stay opaque", () => {
  it("answers the bare 401 with no step, and writes no passkey.add.failed", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { device } = await addPasskey(w, token);
    await expectPasskeyFailed(await passkeyLogin(w, device, { uv: false }));
    await expectPasskeyFailed(await passkeyLogin(w, device, { origin: "https://evil.test" }));
    expect(addFailures(w)).toHaveLength(0);
  });
});
