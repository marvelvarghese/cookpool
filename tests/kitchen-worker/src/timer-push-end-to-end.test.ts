// A timer reaches a locked phone (Cookpool GC-3), end to end as far as a test
// can take it: Dev's phone subscribes through the route api-edge exposes,
// Dev sets a timer through kitchen-worker's route, and the per-minute sweep
// asks the REAL notifications-worker — its push-to-subject gate, its
// subscriptions, VAPID keys and aes128gcm encryption, over the same SQLite
// database — to push it. The fake push service gets one request, which the
// phone decrypts to the timer's own words. No push preference is ever turned
// on: a timer is something Dev asked for. A cancelled timer never arrives.

import { route as notificationsRoute } from "@notifications-worker/router";
import type { Env as NotificationsEnv } from "@notifications-worker/env";
import { base64urlEncode, ecdhWith } from "@notifications-worker/push/crypto";
import type { KitchenTimer, KitchenTimerResponse } from "@saas/contracts/kitchen";
import type { PushMessage } from "@saas/contracts/notifications";
import { runTimerSweep } from "@kitchen-worker/timer-sweep";
import { createHarness, envelope, type Harness } from "./harness.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const DEV = "usr_dev";
const ANU = "usr_anu";
const DEV_PHONE = "https://fcm.googleapis.com/fcm/send/dev-phone";
const after = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** A browser's side of RFC 8291: its subscription, and decryption of what it is sent. */
async function phone(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const text = new TextEncoder();
  return {
    subscription: { endpoint, expirationTime: null, keys: { p256dh: base64urlEncode(uaPublic), auth: base64urlEncode(auth) } },
    async decrypt(body: Uint8Array): Promise<PushMessage> {
      const salt = body.slice(0, 16);
      const asPublic = body.slice(21, 86);
      const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(asKey), pair.privateKey, 256));
      const info = new Uint8Array([...text.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
      const ikm = await hkdf(auth, ecdh, info, 32);
      const cek = await hkdf(salt, ikm, text.encode("Content-Encoding: aes128gcm\0"), 16);
      const nonce = await hkdf(salt, ikm, text.encode("Content-Encoding: nonce\0"), 12);
      const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body.slice(86)));
      return JSON.parse(new TextDecoder().decode(plain.slice(0, -1))) as PushMessage;
    },
  };
}

let h: Harness;
let notificationsEnv: NotificationsEnv;
let pushes: Array<{ endpoint: string; body: Uint8Array }>;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  h = createHarness({ deps: { now: () => NOW } });
  const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  notificationsEnv = {
    ENVIRONMENT: "test",
    PLATFORM_DB: h.env.PLATFORM_DB!,
    EMAIL_FROM_ADDRESS: "no-reply@mail.cookpool.store",
    VAPID_PUBLIC_KEY: base64urlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", vapid.publicKey)) as ArrayBuffer)),
    VAPID_PRIVATE_KEY: base64urlEncode(new Uint8Array((await crypto.subtle.exportKey("pkcs8", vapid.privateKey)) as ArrayBuffer)),
  };
  h.env.NOTIFICATIONS_WORKER = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => notificationsRoute(new Request(input, init), notificationsEnv),
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  pushes = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    pushes.push({ endpoint, body: init?.body instanceof ArrayBuffer ? new Uint8Array(init.body) : new Uint8Array() });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  h.close();
});

async function setTimer(as: string, body: Record<string, unknown>): Promise<KitchenTimer> {
  const res = await h.call("POST", "/v1/kitchen/me/timers", { as, body });
  expect(res.status).toBe(201);
  return (await envelope<KitchenTimerResponse>(res)).data.timer;
}

describe("a timer, kitchen-worker to Dev's locked phone", () => {
  it("arrives once, in the timer's own words, within the minute it ends — and a cancelled one never does", async () => {
    const devPhone = await phone(DEV_PHONE);
    const subscribed = await notificationsRoute(
      new Request("https://notifications.internal/v1/notifications/push-subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-actor": "api-edge", "x-actor-subject-id": DEV, "x-actor-subject-type": "user" },
        body: JSON.stringify(devPhone.subscription),
      }),
      notificationsEnv,
    );
    expect(subscribed.status).toBe(200);

    const simmer = await setTimer(DEV, {
      label: "Simmer · step 7",
      body: "The oil shows at the edges",
      endsAt: after(600).toISOString(),
    });
    const paused = await setTimer(DEV, { label: "Rest", endsAt: after(300).toISOString() });
    expect((await h.call("DELETE", `/v1/kitchen/me/timers/${paused.id}`, { as: DEV })).status).toBe(200);
    // Anu set one too, with no device to hear it.
    await setTimer(ANU, { label: "Anu's", endsAt: after(600).toISOString() });

    expect(await runTimerSweep(h.env, { now: () => after(540) })).toMatchObject({ due: 0 });
    expect(pushes).toEqual([]);

    const outcome = await runTimerSweep(h.env, { now: () => after(645) });
    expect(outcome).toEqual({ due: 2, pushed: 2, devices: 1, sent: 1, unheard: 1, failed: 0, purged: 0 });
    expect(pushes.map((p) => p.endpoint)).toEqual([DEV_PHONE]);
    expect(await devPhone.decrypt(pushes[0]!.body)).toEqual({
      kind: "kitchen.timer",
      title: "Simmer · step 7",
      body: "The oil shows at the edges",
      url: "/cook/session",
      tag: simmer.id,
    });

    // The next minutes: nothing more.
    await runTimerSweep(h.env, { now: () => after(705) });
    await runTimerSweep(h.env, { now: () => after(765) });
    expect(pushes).toHaveLength(1);
  });
});
