// Passkeys (Cookpool PK-2, design §1): register, list, remove and sign in,
// driven end to end by a software authenticator (an ES256 key made here that
// signs real WebAuthn responses). The refusals are in passkeys-refusals.test.ts.

import { handleLoginComplete } from "../../../apps/identity-worker/src/handlers/login-complete";
import { deviceNameFor } from "../../../apps/identity-worker/src/services/passkey-helpers";
import type { PasskeysListResponse, RemovePasskeyResponse } from "@saas/contracts/passkeys";
import { PASSKEY_MAX_PER_USER } from "@saas/contracts/passkeys";
import {
  T0,
  TEST_RP_ID,
  UA_IPHONE,
  addPasskey,
  call,
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
} from "./helpers/passkey-world";
import { req } from "./helpers/delegation-world";

describe("register then sign in, end to end", () => {
  it("adds a passkey after a code sign-in and signs back in with it alone", async () => {
    const w = world();
    const { token, userId } = await signIn(w);

    const options = await registerOptions(w, token);
    expect(options.rp).toEqual({ name: "Cookpool", id: TEST_RP_ID });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
    expect(options.attestation).toBe("none");
    expect(options.excludeCredentials).toEqual([]);
    expect(options.timeout).toBe(5 * 60 * 1000);
    // The user handle is the account's 16 random bytes: no email, no name.
    expect(Buffer.from(options.user.id, "base64url")).toHaveLength(16);
    expect(options.user.name).toBe("anu@cookpool.test");

    const device = await softAuthenticator();
    const response = await device.create(options);
    const added = await dataOf<{ passkey: { id: string } }>(
      await call.registerVerify(w, token, { response }, { "user-agent": UA_IPHONE }),
      201,
    );
    expect(added.passkey).toEqual({
      id: expect.stringMatching(/^pky_[0-9a-f]{16}$/),
      deviceName: "iPhone",
      createdAt: T0.toISOString(),
      lastUsedAt: null,
      backedUp: true,
    });

    const login = await loginOptions(w);
    expect(login.allowCredentials).toEqual([]);
    expect(login.userVerification).toBe("required");
    expect(login.rpId).toBe(TEST_RP_ID);

    w.clock.now = new Date(T0.getTime() + 60_000);
    const res = await call.loginVerify(w, { response: await device.get(login) });
    const body = await signedIn(res);
    expect(body).toEqual({
      token: expect.stringMatching(/^sps_ses_[0-9a-f]{32}\.[0-9a-f]{64}$/),
      tokenType: "bearer",
      expiresAt: new Date(w.clock.now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      user: { id: userId, email: "anu@cookpool.test", displayName: null },
    });
    // The new session works.
    const session = await w.auth.getSession(body.token);
    expect("error" in session).toBe(false);

    // The row moved: last use and sign count.
    const [row] = [...w.passkeys._rows.values()];
    expect(row!.lastUsedAt).toEqual(w.clock.now);
    expect(row!.signCount).toBe(1);

    const types = w.repo._securityEvents.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["passkey.added", "passkey.used"]));
    const created = w.repo._securityEvents.filter((e) => e.eventType === "session.created").at(-1);
    expect(created?.metadata).toMatchObject({ method: "passkey", passkeyId: added.passkey.id });
  });

  it("answers exactly the keys and user login/complete answers", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { device } = await addPasskey(w, token);
    const viaPasskey = (await (await passkeyLogin(w, device)).json()) as { data: Record<string, unknown>; meta: unknown };

    const start = await w.auth.startLogin("anu@cookpool.test");
    if ("error" in start) throw new Error("startLogin failed");
    const res = await handleLoginComplete(
      req("/v1/auth/login/complete", "POST", null, { challengeId: start.challengeId, code: start.rawCode }),
      w.env,
      "req_pk",
      { repo: w.repo, now: () => w.clock.now },
    );
    const viaCode = (await res.json()) as { data: Record<string, unknown>; meta: unknown };
    expect(Object.keys(viaPasskey).sort()).toEqual(Object.keys(viaCode).sort());
    expect(Object.keys(viaPasskey.data).sort()).toEqual(Object.keys(viaCode.data).sort());
    expect(viaPasskey.data.user).toEqual(viaCode.data.user);
    expect(viaPasskey.meta).toEqual(viaCode.meta);
  });

  it("keeps the name the person gave, trimmed", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { passkey } = await addPasskey(w, token, { deviceName: "  Anu's iPhone  " });
    expect(passkey.deviceName).toBe("Anu's iPhone");
  });

  it("excludes the passkeys the person already has from the next registration", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { device } = await addPasskey(w, token);
    const options = await registerOptions(w, token);
    expect(options.excludeCredentials).toEqual([{ id: device.credentialId, type: "public-key", transports: ["hybrid", "internal"] }]);
  });

  it("stores the public key only, and never puts a credential or key in a security event", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { device } = await addPasskey(w, token);
    await signedIn(await passkeyLogin(w, device));
    const [row] = [...w.passkeys._rows.values()];
    expect(row!.credentialId).toBe(device.credentialId);
    const events = JSON.stringify(w.repo._securityEvents);
    expect(events).not.toContain(device.credentialId);
    expect(events).not.toContain(row!.publicKey);
  });
});

describe("GET and DELETE /v1/auth/passkeys", () => {
  it("lists the person's own passkeys, newest first", async () => {
    const w = world();
    const { token: anu } = await signIn(w);
    const { token: meera } = await signIn(w, "meera@cookpool.test");
    const first = await addPasskey(w, anu, { deviceName: "Mac" });
    w.clock.now = new Date(T0.getTime() + 1000);
    const second = await addPasskey(w, anu, { deviceName: "iPhone" });
    await addPasskey(w, meera, { deviceName: "Pixel" });

    const list = await dataOf<PasskeysListResponse>(await call.list(w, anu));
    expect(list.passkeys.map((p) => p.id)).toEqual([second.passkey.id, first.passkey.id]);
    expect(Object.keys(list.passkeys[0]!).sort()).toEqual(["backedUp", "createdAt", "deviceName", "id", "lastUsedAt"]);
  });

  it("removes your own passkey, and it stops signing you in", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { device, passkey } = await addPasskey(w, token);
    w.clock.now = new Date(T0.getTime() + 5000);
    const out = await dataOf<RemovePasskeyResponse>(await call.remove(w, token, passkey.id));
    expect(out).toEqual({ id: passkey.id, removedAt: w.clock.now.toISOString() });
    expect((await dataOf<PasskeysListResponse>(await call.list(w, token))).passkeys).toEqual([]);
    expect(w.repo._securityEvents.find((e) => e.eventType === "passkey.removed")?.metadata).toMatchObject({ passkeyId: passkey.id });

    await expectPasskeyFailed(await passkeyLogin(w, device));
  });

  it("answers 404 for someone else's passkey, an unknown one, or one already removed", async () => {
    const w = world();
    const { token: anu } = await signIn(w);
    const { token: meera } = await signIn(w, "meera@cookpool.test");
    const { passkey } = await addPasskey(w, anu);
    for (const id of [passkey.id, "pky_0000000000000000", "not-an-id", "pky_XYZ"]) {
      expect((await errorOf(await call.remove(w, meera, id))).status).toBe(404);
    }
    expect(w.passkeys._rows.size).toBe(1);
    await dataOf(await call.remove(w, anu, passkey.id));
    expect((await errorOf(await call.remove(w, anu, passkey.id))).status).toBe(404);
  });
});

describe("at most 10 passkeys", () => {
  it(`refuses register options at ${PASSKEY_MAX_PER_USER} with 409 too_many_passkeys`, async () => {
    const w = world();
    const { token } = await signIn(w);
    for (let i = 0; i < PASSKEY_MAX_PER_USER; i++) await addPasskey(w, token);
    expect(await errorOf(await call.registerOptions(w, token))).toMatchObject({
      status: 409,
      code: "conflict",
      reason: "too_many_passkeys",
    });
    // Removing one makes room.
    const [first] = (await dataOf<PasskeysListResponse>(await call.list(w, token))).passkeys;
    await dataOf(await call.remove(w, token, first!.id));
    await addPasskey(w, token);
  });

  it("refuses the verify that would make an 11th, even with options asked for earlier", async () => {
    const w = world();
    const { token } = await signIn(w);
    for (let i = 0; i < PASSKEY_MAX_PER_USER - 1; i++) await addPasskey(w, token);
    const early = await registerOptions(w, token);
    await addPasskey(w, token);
    const device = await softAuthenticator();
    expect(await errorOf(await call.registerVerify(w, token, { response: await device.create(early) }))).toMatchObject({
      status: 409,
      reason: "too_many_passkeys",
    });
    expect(w.passkeys._rows.size).toBe(PASSKEY_MAX_PER_USER);
  });
});

describe("device names", () => {
  it.each([
    [["internal", "hybrid"], UA_IPHONE, "iPhone"],
    [["internal"], "Mozilla/5.0 (Linux; Android 15; Pixel 9)", "Android phone"],
    [["internal"], "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Mac"],
    [["internal"], "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Windows PC"],
    [["usb", "nfc"], UA_IPHONE, "Security key"],
    [["hybrid"], "Mozilla/5.0 (Windows NT 10.0)", "Phone"],
    [[], null, "Passkey"],
  ])("%j with %s → %s", (transports, ua, name) => {
    expect(deviceNameFor(transports, ua)).toBe(name);
  });
});
