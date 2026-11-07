// The Web Push routes (PW-5), as notifications-worker answers them behind the
// internal-actor gate: the person is the actor, never the body; endpoints and
// keys are validated; ten devices at most; a device moves to whoever
// subscribes it last; removing is only ever your own; the key route fails
// closed; a test push goes to your own devices.

import crypto from "node:crypto";
import { route } from "@notifications-worker/router";
import {
  handleGetPushKey,
  handlePushTest,
  handleSubscribePush,
  handleUnsubscribePush,
  type PushRouteDeps,
} from "@notifications-worker/handlers/push";
import { deviceLabel } from "@notifications-worker/push/device-label";
import { loadVapidKeys } from "@notifications-worker/push/vapid";
import type { Env } from "@notifications-worker/env";
import { browser, keysFor, memorySubscriptions, pushService, vapidPair, type VapidPair } from "./push-fakes.js";

if (!(globalThis as Record<string, unknown>).crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}

const env: Env = { ENVIRONMENT: "test", NOTIFICATIONS_PROVIDER: "local-debug" };
const DEV = "usr_dev";
const ANU = "usr_anu";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const as = (subjectId: string, subjectType = "user") => ({ subjectId, subjectType, internalCaller: "api-edge" });

function req(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://nf/v1/notifications/push-subscriptions", {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

async function json(res: Response): Promise<{ data?: Record<string, unknown>; error?: { code: string; details: { fields?: Record<string, string[]> } } }> {
  return (await res.json()) as never;
}

let pair: VapidPair;
beforeAll(async () => {
  pair = await vapidPair();
});

let clock: number;
function deps(extra: Partial<PushRouteDeps> = {}) {
  const subscriptions = memorySubscriptions();
  let id = 0;
  return {
    subscriptions,
    deps: {
      subscriptions,
      now: () => new Date(Date.parse("2026-11-07T10:00:00.000Z") + (clock += 1000)),
      generateUuid: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
      keys: keysFor(pair),
      ...extra,
    } satisfies PushRouteDeps,
  };
}

beforeEach(() => {
  clock = 0;
});

describe("POST …/push-subscriptions", () => {
  it("keeps the device for the actor — never for a subject named in the body — with a label from its User-Agent", async () => {
    const { subscriptions, deps: d } = deps();
    const phone = await browser("https://fcm.googleapis.com/fcm/send/abc");
    const res = await handleSubscribePush(
      req("POST", { ...phone.subscription, subjectId: ANU }, { "user-agent": ANDROID_CHROME }),
      env, "req_1", as(DEV), d,
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data!.subscription).toEqual({
      endpoint: phone.endpoint,
      label: "Chrome on Android",
      createdAt: "2026-11-07T10:00:01.000Z",
      updatedAt: expect.any(String),
      lastSuccessAt: null,
      lastFailureAt: null,
    });
    // Never echoes the keys.
    expect(JSON.stringify(body)).not.toContain(phone.subscription.keys.auth);
    expect([...subscriptions.rows.values()].map((r) => [r.subjectId, r.endpoint, r.p256dh, r.auth])).toEqual([
      [DEV, phone.endpoint, phone.subscription.keys.p256dh, phone.subscription.keys.auth],
    ]);
  });

  it("is a signed-in person's: a service actor is refused", async () => {
    const { subscriptions, deps: d } = deps();
    const phone = await browser("https://fcm.googleapis.com/fcm/send/abc");
    const res = await handleSubscribePush(req("POST", phone.subscription), env, "req_2", as("svc-kitchen", "service"), d);
    expect(res.status).toBe(403);
    expect((await json(res)).error!.code).toBe("forbidden");
    expect(subscriptions.rows.size).toBe(0);
  });

  it.each([
    ["an http endpoint", { endpoint: "http://fcm.googleapis.com/x" }, "endpoint"],
    ["no endpoint", { endpoint: undefined }, "endpoint"],
    ["not a URL", { endpoint: "fcm.googleapis.com/x" }, "endpoint"],
    ["credentials in the URL", { endpoint: "https://user:pw@push.example/x" }, "endpoint"],
    ["an endpoint over 2048 characters", { endpoint: `https://push.example/${"a".repeat(2048)}` }, "endpoint"],
    ["a p256dh of the wrong length", { keys: { p256dh: "BAAA", auth: "AAAAAAAAAAAAAAAAAAAAAA" } }, "keys.p256dh"],
    ["a p256dh that is not a point on the curve", { keys: { p256dh: `B${"A".repeat(86)}`, auth: "AAAAAAAAAAAAAAAAAAAAAA" } }, "keys.p256dh"],
    ["an auth secret of the wrong length", { keys: { auth: "AAAA" } }, "keys.auth"],
    ["an auth secret that is not base64url", { keys: { auth: "!!!!!!!!!!!!!!!!!!!!!!" } }, "keys.auth"],
    ["no keys", { keys: undefined }, "keys"],
  ])("is 422 for %s", async (_name, change, field) => {
    const { subscriptions, deps: d } = deps();
    const phone = await browser("https://fcm.googleapis.com/fcm/send/abc");
    const keys = "keys" in change && change.keys ? { ...phone.subscription.keys, ...change.keys } : "keys" in change ? undefined : phone.subscription.keys;
    const body = { ...phone.subscription, ...change, keys };
    const res = await handleSubscribePush(req("POST", body), env, "req_3", as(DEV), d);
    expect(res.status).toBe(422);
    expect((await json(res)).error!.details.fields).toHaveProperty([field]);
    expect(subscriptions.rows.size).toBe(0);
  });

  it("is 400 for a body that is not JSON", async () => {
    const { deps: d } = deps();
    expect((await handleSubscribePush(req("POST", "{nope"), env, "req_4", as(DEV), d)).status).toBe(400);
  });

  it("keeps at most ten devices a person: the eleventh drops the least recently subscribed", async () => {
    const { subscriptions, deps: d } = deps();
    const devices = [];
    for (let i = 0; i < 11; i++) {
      const device = await browser(`https://fcm.googleapis.com/fcm/send/dev-${i}`);
      devices.push(device);
      expect((await handleSubscribePush(req("POST", device.subscription), env, "req_cap", as(DEV), d)).status).toBe(200);
    }
    const kept = [...subscriptions.rows.values()].filter((r) => r.subjectId === DEV).map((r) => r.endpoint);
    expect(kept).toHaveLength(10);
    expect(kept).not.toContain(devices[0]!.endpoint);
    expect(kept).toContain(devices[10]!.endpoint);

    // Renewing an old one makes it the most recent: the next new device drops another.
    expect((await handleSubscribePush(req("POST", devices[1]!.subscription), env, "req_cap", as(DEV), d)).status).toBe(200);
    const twelfth = await browser("https://fcm.googleapis.com/fcm/send/dev-11");
    await handleSubscribePush(req("POST", twelfth.subscription), env, "req_cap", as(DEV), d);
    const after = [...subscriptions.rows.values()].map((r) => r.endpoint);
    expect(after).toContain(devices[1]!.endpoint);
    expect(after).not.toContain(devices[2]!.endpoint);
    // Another person's devices never count against yours.
    const anus = await browser("https://fcm.googleapis.com/fcm/send/anu-phone");
    await handleSubscribePush(req("POST", anus.subscription), env, "req_cap", as(ANU), d);
    expect([...subscriptions.rows.values()].filter((r) => r.subjectId === DEV)).toHaveLength(10);
  });

  it("moves a device that changes hands to whoever subscribes it now", async () => {
    const { subscriptions, deps: d } = deps();
    const shared = await browser("https://web.push.apple.com/shared-ipad");
    await handleSubscribePush(req("POST", shared.subscription), env, "req_5", as(DEV), d);
    const renewed = await browser(shared.endpoint);
    await handleSubscribePush(req("POST", renewed.subscription), env, "req_6", as(ANU), d);
    expect([...subscriptions.rows.values()].map((r) => [r.subjectId, r.p256dh])).toEqual([[ANU, renewed.subscription.keys.p256dh]]);
  });
});

describe("DELETE …/push-subscriptions", () => {
  it("removes only the caller's own device; someone else's reads as none and stays", async () => {
    const { subscriptions, deps: d } = deps();
    const devs = await browser("https://fcm.googleapis.com/fcm/send/dev");
    const anus = await browser("https://fcm.googleapis.com/fcm/send/anu");
    await handleSubscribePush(req("POST", devs.subscription), env, "r", as(DEV), d);
    await handleSubscribePush(req("POST", anus.subscription), env, "r", as(ANU), d);

    const theirs = await handleUnsubscribePush(req("DELETE", { endpoint: anus.endpoint, subjectId: ANU }), env, "r", as(DEV), d);
    expect(theirs.status).toBe(200);
    expect((await json(theirs)).data).toEqual({ removed: false });
    expect(subscriptions.rows.has(anus.endpoint)).toBe(true);

    const mine = await handleUnsubscribePush(req("DELETE", { endpoint: devs.endpoint }), env, "r", as(DEV), d);
    expect((await json(mine)).data).toEqual({ removed: true });
    expect(subscriptions.rows.has(devs.endpoint)).toBe(false);
    // Again: nothing left to remove, and that is not an error.
    expect((await json(await handleUnsubscribePush(req("DELETE", { endpoint: devs.endpoint }), env, "r", as(DEV), d))).data).toEqual({ removed: false });
  });

  it("needs an endpoint and a person", async () => {
    const { deps: d } = deps();
    expect((await handleUnsubscribePush(req("DELETE", {}), env, "r", as(DEV), d)).status).toBe(422);
    expect((await handleUnsubscribePush(req("DELETE", { endpoint: "x" }), env, "r", as("svc", "service"), d)).status).toBe(403);
  });
});

describe("GET …/push-key", () => {
  it("is the VAPID public key the app subscribes with", async () => {
    const res = await handleGetPushKey(env, "r", { keys: keysFor(pair) });
    expect((await json(res)).data).toEqual({ publicKey: pair.publicKey });
  });

  it("is null while push is off: no private key, or a pair that does not match", async () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      const noPrivate = await handleGetPushKey({ ...env, VAPID_PUBLIC_KEY: pair.publicKey, EMAIL_FROM_ADDRESS: "a@b.c" }, "r");
      expect((await json(noPrivate)).data).toEqual({ publicKey: null });
      const other = await vapidPair();
      const mismatched = await handleGetPushKey(
        { ...env, VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: other.privateKey, EMAIL_FROM_ADDRESS: "a@b.c" },
        "r",
      );
      expect((await json(mismatched)).data).toEqual({ publicKey: null });
    } finally {
      console.warn = original;
    }
    // Configured in full, it reads from env.
    const configured = await handleGetPushKey(
      { ...env, VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey, EMAIL_FROM_ADDRESS: "a@b.c" },
      "r",
    );
    expect((await json(configured)).data).toEqual({ publicKey: pair.publicKey });
    expect((await loadVapidKeys({ VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey, EMAIL_FROM_ADDRESS: "a@b.c" })).ok).toBe(true);
  });
});

describe("POST …/push-test", () => {
  it("pushes to the caller's own devices, or the one named, and says what happened", async () => {
    const service = pushService();
    const { deps: d } = deps({ fetch: service.fetch });
    const phone = await browser("https://fcm.googleapis.com/fcm/send/dev-phone");
    const laptop = await browser("https://updates.push.services.mozilla.com/wpush/v2/dev-laptop");
    const anus = await browser("https://fcm.googleapis.com/fcm/send/anu");
    for (const [device, who] of [[phone, DEV], [laptop, DEV], [anus, ANU]] as const) {
      await handleSubscribePush(req("POST", device.subscription), env, "r", as(who), d);
    }
    service.answer(laptop.endpoint, 410);

    const all = await handlePushTest(new Request("http://nf/v1/notifications/push-test", { method: "POST" }), env, "r", as(DEV), d);
    expect((await json(all)).data).toEqual({ devices: 2, sent: 1, gone: 1, failed: 0 });
    expect(service.requests.map((r) => r.endpoint).sort()).toEqual([phone.endpoint, laptop.endpoint].sort());
    expect(await phone.decrypt(service.requests.find((r) => r.endpoint === phone.endpoint)!.body)).toMatchObject({
      kind: "test",
      title: "Cookpool",
      url: "/you",
      tag: `test:${DEV}`,
    });

    // Naming someone else's device sends nothing.
    const theirs = await handlePushTest(
      new Request("http://nf/v1/notifications/push-test", { method: "POST", body: JSON.stringify({ endpoint: anus.endpoint }) }),
      env, "r", as(DEV), d,
    );
    expect((await json(theirs)).data).toEqual({ devices: 0, sent: 0, gone: 0, failed: 0 });
    expect(service.requests).toHaveLength(2);
  });

  it("is 503 while push is off here", async () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      const { deps: d } = deps({ keys: () => loadVapidKeys({}) });
      const res = await handlePushTest(new Request("http://nf/x", { method: "POST" }), env, "r", as(DEV), d);
      expect(res.status).toBe(503);
      expect((await json(res)).error!.code).toBe("unsupported");
    } finally {
      console.warn = original;
    }
  });
});

describe("the router", () => {
  const internal = (method: string, path: string, body?: unknown) =>
    new Request(`http://nf${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-internal-actor": "api-edge",
        "x-actor-subject-id": DEV,
        "x-actor-subject-type": "user",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  it("keeps every push route behind the internal-actor gate", async () => {
    for (const [method, path] of [
      ["POST", "/v1/notifications/push-subscriptions"],
      ["DELETE", "/v1/notifications/push-subscriptions"],
      ["GET", "/v1/notifications/push-key"],
      ["POST", "/v1/notifications/push-test"],
    ] as const) {
      const res = await route(new Request(`http://nf${path}`, { method }), env);
      expect(res.status).toBe(403);
    }
  });

  it("routes them (not as notification ids), with 405 for other methods", async () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      expect((await route(internal("GET", "/v1/notifications/push-key"), env)).status).toBe(200);
      expect((await route(internal("PUT", "/v1/notifications/push-subscriptions"), env)).status).toBe(405);
      expect((await route(internal("POST", "/v1/notifications/push-key"), env)).status).toBe(405);
      expect((await route(internal("GET", "/v1/notifications/push-test"), env)).status).toBe(405);
      // Without a database a valid subscribe is 503, as every write here.
      const phone = await browser("https://fcm.googleapis.com/fcm/send/abc");
      expect((await route(internal("POST", "/v1/notifications/push-subscriptions", phone.subscription), env)).status).toBe(503);
    } finally {
      console.warn = original;
    }
  });
});

describe("device labels", () => {
  it.each([
    [ANDROID_CHROME, "Chrome on Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", "Safari on iPhone"],
    ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet on Android"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Edge on Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox on Mac"],
    ["curl/8.0", null],
    [null, null],
  ])("%s → %s", (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});
