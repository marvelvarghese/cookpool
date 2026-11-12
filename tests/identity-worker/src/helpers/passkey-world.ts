// Shared by the passkey tests (Cookpool PK-2): the identity fake, the
// delegations and passkeys fakes, a clock, sign-in by code, the six handlers
// and a software authenticator to drive them.

import type { LoginCompleteResponse } from "@saas/contracts/auth";
import type {
  PasskeyLoginOptionsResponse,
  PasskeyRegisterOptionsResponse,
  PasskeyRegisterVerifyResponse,
} from "@saas/contracts/passkeys";
import type { Env } from "../../../../apps/identity-worker/src/env";
import {
  handleListPasskeys,
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
  handleRemovePasskey,
} from "../../../../apps/identity-worker/src/handlers/passkeys";
import { createFakePasskeys } from "./fake-passkeys";
import { T0, created, errorOf, req, signIn, world as baseWorld, type World as BaseWorld } from "./delegation-world";
import { softAuthenticator, TEST_ORIGIN, TEST_RP_ID, type CeremonyKnobs, type SoftAuthenticator } from "./soft-authenticator";

export { T0, errorOf, signIn, softAuthenticator, TEST_ORIGIN, TEST_RP_ID, created as createdDelegation };
export type { SoftAuthenticator };

export const PASSKEY_ENV = {
  ENVIRONMENT: "test",
  PASSKEY_RP_ID: TEST_RP_ID,
  PASSKEY_RP_NAME: "Cookpool",
  PASSKEY_ORIGINS: `${TEST_ORIGIN}, http://127.0.0.1:3000`,
} as Env;

export const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

export interface PasskeyWorld extends BaseWorld {
  passkeys: ReturnType<typeof createFakePasskeys>;
  pdeps: { repo: BaseWorld["repo"]; passkeys: ReturnType<typeof createFakePasskeys>; now: () => Date };
  env: Env;
}

export function world(env: Env = PASSKEY_ENV): PasskeyWorld {
  const base = baseWorld();
  const passkeys = createFakePasskeys();
  return { ...base, passkeys, pdeps: { repo: base.repo, passkeys, now: () => base.clock.now }, env };
}

const RID = "req_pk";

export const call = {
  registerOptions: (w: PasskeyWorld, token: string | null, headers: Record<string, string> = {}) =>
    handlePasskeyRegisterOptions(req("/v1/auth/passkeys/register/options", "POST", token, {}, headers), w.env, RID, w.pdeps),
  registerVerify: (w: PasskeyWorld, token: string | null, body: unknown, headers: Record<string, string> = {}) =>
    handlePasskeyRegisterVerify(req("/v1/auth/passkeys/register/verify", "POST", token, body, headers), w.env, RID, w.pdeps),
  list: (w: PasskeyWorld, token: string | null) => handleListPasskeys(req("/v1/auth/passkeys", "GET", token), w.env, RID, w.pdeps),
  remove: (w: PasskeyWorld, token: string | null, id: string) =>
    handleRemovePasskey(req(`/v1/auth/passkeys/${id}`, "DELETE", token), w.env, RID, w.pdeps),
  loginOptions: (w: PasskeyWorld, token: string | null = null) =>
    handlePasskeyLoginOptions(req("/v1/auth/passkeys/login/options", "POST", token, {}), w.env, RID, w.pdeps),
  loginVerify: (w: PasskeyWorld, body: unknown, token: string | null = null) =>
    handlePasskeyLoginVerify(req("/v1/auth/passkeys/login/verify", "POST", token, body), w.env, RID, w.pdeps),
};

export async function dataOf<T>(res: Response, status = 200): Promise<T> {
  const json = (await res.json()) as { data?: T; error?: unknown };
  expect([res.status, json.error]).toEqual([status, undefined]);
  return json.data as T;
}

export async function registerOptions(w: PasskeyWorld, token: string): Promise<PasskeyRegisterOptionsResponse["options"]> {
  return (await dataOf<PasskeyRegisterOptionsResponse>(await call.registerOptions(w, token))).options;
}

export async function loginOptions(w: PasskeyWorld): Promise<PasskeyLoginOptionsResponse["options"]> {
  return (await dataOf<PasskeyLoginOptionsResponse>(await call.loginOptions(w))).options;
}

/** Register a new software passkey for this session; answers the device and the stored passkey. */
export async function addPasskey(
  w: PasskeyWorld,
  token: string,
  opts: { deviceName?: string; knobs?: CeremonyKnobs; device?: SoftAuthenticator; headers?: Record<string, string> } = {},
): Promise<{ device: SoftAuthenticator; passkey: PasskeyRegisterVerifyResponse["passkey"] }> {
  const device = opts.device ?? (await softAuthenticator());
  const options = await registerOptions(w, token);
  const response = await device.create(options, opts.knobs);
  const body = opts.deviceName === undefined ? { response } : { response, deviceName: opts.deviceName };
  const out = await dataOf<PasskeyRegisterVerifyResponse>(await call.registerVerify(w, token, body, opts.headers), 201);
  return { device, passkey: out.passkey };
}

/** One sign-in attempt with a device: fresh login options, an assertion, verify. */
export async function passkeyLogin(w: PasskeyWorld, device: SoftAuthenticator, knobs: CeremonyKnobs = {}): Promise<Response> {
  const options = await loginOptions(w);
  return call.loginVerify(w, { response: await device.get(options, knobs) });
}

export async function signedIn(res: Response): Promise<LoginCompleteResponse> {
  return dataOf<LoginCompleteResponse>(res);
}

/** The one answer every failed passkey sign-in gets. */
export async function expectPasskeyFailed(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({
    error: { code: "unauthenticated", message: "Passkey sign-in failed", details: { reason: "passkey_failed" }, requestId: RID },
  });
}
