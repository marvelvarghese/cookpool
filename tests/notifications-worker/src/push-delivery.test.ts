// Sending Web Push (PW-5) with a fake push service: what goes on the wire
// (aes128gcm body the browser decrypts, VAPID header, TTL, Urgency), what each
// answer does to the subscription (2xx kept, 404/410 deleted, 429/5xx
// recorded and not retried), the per-kind push preference (default off), and
// failing closed without a VAPID pair.

import { pushForTemplate, pushToDevices, sendWebPush, PUSH_TTL_SECONDS } from "@notifications-worker/push/deliver";
import { verifyEs256Jwt, base64urlDecode } from "@notifications-worker/push/crypto";
import { loadVapidKeys } from "@notifications-worker/push/vapid";
import { renderPushMessage, testPushMessage, appPath } from "@notifications-worker/templates/push";
import { PUSH_MESSAGE_MAX_BYTES } from "@saas/contracts/notifications";
import {
  browser,
  jwtClaims,
  keysFor,
  memoryPrefs,
  memorySubscriptions,
  pushService,
  vapidHeader,
  vapidPair,
  vapidEnv,
  type VapidPair,
} from "./push-fakes.js";

const NOW = new Date("2026-11-07T10:00:00.000Z");
const DEV = "usr_dev";
const ANU = "usr_anu";
const FCM = "https://fcm.googleapis.com/fcm/send/dev-phone";
const MOZ = "https://updates.push.services.mozilla.com/wpush/v2/dev-laptop";
const APPLE = "https://web.push.apple.com/QDev-ipad";

const portionData = {
  actorName: "Anu",
  dishName: "Egg fried rice",
  groupName: "Flat 4B",
  portions: "1",
  yourShare: "₹10.00",
  dishUrl: "https://cookpool.store/dishes/dsh_0123456789abcdef0123456789abcdef",
};

let pair: VapidPair;
beforeAll(async () => {
  pair = await vapidPair();
});

async function setup() {
  const service = pushService();
  const subscriptions = memorySubscriptions();
  const prefs = memoryPrefs();
  const devices = {
    phone: await browser(FCM),
    laptop: await browser(MOZ),
    ipad: await browser(APPLE),
  };
  for (const [i, d] of [devices.phone, devices.laptop, devices.ipad].entries()) {
    await subscriptions.upsert({
      id: `sub_${i}`,
      subjectId: DEV,
      endpoint: d.endpoint,
      p256dh: d.subscription.keys.p256dh,
      auth: d.subscription.keys.auth,
      userAgent: null,
      now: NOW,
      maxPerSubject: 10,
    });
  }
  const deps = { subscriptions, prefs, keys: keysFor(pair), fetch: service.fetch, now: () => NOW };
  return { service, subscriptions, prefs, devices, deps };
}

describe("one push on the wire", () => {
  it("is an aes128gcm body the browser decrypts, with a VAPID token for the push service's origin", async () => {
    const { service, devices } = await setup();
    const loaded = await loadVapidKeys(vapidEnv(pair));
    if (!loaded.ok) throw new Error(loaded.problem);
    const message = renderPushMessage("kitchen.portion_set", portionData, `kitchen.portion_set:dsh_x:${DEV}`)!;

    const device = { endpoint: FCM, ...devices.phone.subscription.keys };
    expect(await sendWebPush(device, message, loaded.keys, { fetch: service.fetch, now: () => NOW })).toEqual({ kind: "sent", status: 201 });
    const [sent] = service.requests;
    expect(sent!.endpoint).toBe(FCM);
    expect(sent!.headers).toMatchObject({
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(24 * 60 * 60),
      urgency: "normal",
    });
    expect(PUSH_TTL_SECONDS).toBe(86400);

    const { jwt, k } = vapidHeader(sent!.headers.authorization);
    expect(k).toBe(pair.publicKey);
    const claims = await verifyEs256Jwt(jwt, base64urlDecode(pair.publicKey)!);
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: NOW.getTime() / 1000 + 12 * 60 * 60,
      sub: "mailto:no-reply@mail.cookpool.store",
    });

    expect(await devices.phone.decrypt(sent!.body)).toEqual({
      kind: "kitchen.portion_set",
      title: "Cookpool",
      body: "Anu said you had 1 portion of Egg fried rice",
      url: "/dishes/dsh_0123456789abcdef0123456789abcdef",
      tag: `kitchen.portion_set:dsh_x:${DEV}`,
    });
    // Another device's key cannot read it.
    await expect(devices.laptop.decrypt(sent!.body)).rejects.toThrow();
  });

  it.each([
    [200, "sent"],
    [201, "sent"],
    [202, "sent"],
    [404, "gone"],
    [410, "gone"],
    [429, "failed"],
    [500, "failed"],
    [503, "failed"],
    [413, "failed"],
  ] as const)("reads a %i as %s", async (status, kind) => {
    const { service, devices } = await setup();
    const loaded = await loadVapidKeys(vapidEnv(pair));
    if (!loaded.ok) throw new Error(loaded.problem);
    service.answer(FCM, status);
    const outcome = await sendWebPush({ endpoint: FCM, ...devices.phone.subscription.keys }, testPushMessage(DEV), loaded.keys, {
      fetch: service.fetch,
      now: () => NOW,
    });
    expect(outcome.kind).toBe(kind);
    if (outcome.kind === "failed") expect(outcome.reason).toBe(`push_service_${status}`);
  });

  it("never throws: a network error and keys that do not decode are failures", async () => {
    const { service, devices } = await setup();
    const loaded = await loadVapidKeys(vapidEnv(pair));
    if (!loaded.ok) throw new Error(loaded.problem);
    service.answer(FCM, "network_error");
    const deps = { fetch: service.fetch, now: () => NOW };
    expect(await sendWebPush({ endpoint: FCM, ...devices.phone.subscription.keys }, testPushMessage(DEV), loaded.keys, deps)).toEqual({
      kind: "failed",
      status: null,
      reason: "push_service_unreachable",
    });
    expect(await sendWebPush({ endpoint: MOZ, p256dh: "short", auth: "x" }, testPushMessage(DEV), loaded.keys, deps)).toMatchObject({
      kind: "failed",
      reason: "invalid_subscription_keys",
    });
  });
});

describe("pushing to a person's devices", () => {
  it("sends to every device; a 404 or 410 deletes that subscription, a 429 or 5xx is recorded and not retried", async () => {
    const { service, subscriptions, devices, deps } = await setup();
    service.answer(MOZ, 410);
    service.answer(APPLE, 429);
    const summary = await pushToDevices(deps, DEV, testPushMessage(DEV));
    expect(summary).toEqual({ devices: 3, sent: 1, gone: 1, failed: 1 });
    expect(service.requests).toHaveLength(3);

    expect(subscriptions.rows.get(FCM)).toMatchObject({ lastSuccessAt: NOW, lastFailureAt: null });
    expect(subscriptions.rows.has(MOZ)).toBe(false);
    expect(subscriptions.rows.get(APPLE)).toMatchObject({ lastFailureAt: NOW, lastFailureReason: "push_service_429", lastSuccessAt: null });

    // The next push goes to what is left, once each.
    service.answer(APPLE, 503);
    expect(await pushToDevices(deps, DEV, testPushMessage(DEV))).toEqual({ devices: 2, sent: 1, gone: 0, failed: 1 });
    expect(subscriptions.rows.get(APPLE)).toMatchObject({ lastFailureReason: "push_service_503" });
    expect(service.requests).toHaveLength(5);
    expect(devices.ipad.endpoint).toBe(APPLE);
  });

  it("signs one VAPID token per push service origin per run", async () => {
    const { service, subscriptions, deps } = await setup();
    const second = await browser("https://fcm.googleapis.com/fcm/send/dev-tablet");
    await subscriptions.upsert({
      id: "sub_tab", subjectId: DEV, endpoint: second.endpoint, ...second.subscription.keys, userAgent: null, now: NOW, maxPerSubject: 10,
    });
    await pushToDevices(deps, DEV, testPushMessage(DEV));
    const tokens = new Map(service.requests.map((r) => [new URL(r.endpoint).origin, vapidHeader(r.headers.authorization).jwt]));
    const fcm = service.requests.filter((r) => r.endpoint.startsWith("https://fcm.googleapis.com/"));
    expect(fcm).toHaveLength(2);
    expect(vapidHeader(fcm[0]!.headers.authorization).jwt).toBe(vapidHeader(fcm[1]!.headers.authorization).jwt);
    expect(new Set(tokens.values()).size).toBe(3);
    for (const [origin, jwt] of tokens) expect(jwtClaims(jwt).aud).toBe(origin);
  });

  it("only the device asked for, when an endpoint is given; nobody else's", async () => {
    const { service, deps } = await setup();
    expect(await pushToDevices(deps, DEV, testPushMessage(DEV), MOZ)).toEqual({ devices: 1, sent: 1, gone: 0, failed: 0 });
    expect(service.requests.map((r) => r.endpoint)).toEqual([MOZ]);
    expect(await pushToDevices(deps, ANU, testPushMessage(ANU), MOZ)).toMatchObject({ devices: 0, skipped: "no_devices" });
    expect(service.requests).toHaveLength(1);
  });
});

describe("the push that goes with an email", () => {
  const push = (templateKey: string, templateData: Record<string, string | null> = portionData) => ({
    subjectId: DEV,
    templateKey,
    templateData,
    tag: `${templateKey}:dsh_x:${DEV}`,
  });

  it("is off by default: no push row, nothing sent", async () => {
    const { service, deps } = await setup();
    expect(await pushForTemplate(deps, push("kitchen.portion_set"))).toBeNull();
    expect(service.requests).toHaveLength(0);
  });

  it("goes out per kind, only for the kinds turned on, independently of email", async () => {
    const { service, prefs, devices, deps } = await setup();
    // Email turned off for the group, push turned on for portions only.
    prefs.set(DEV, "email", { "kitchen.portion_set": false }, "11111111-1111-4111-8111-111111111111");
    prefs.set(DEV, "push", { "kitchen.portion_set": true, "kitchen.dish_posted": false });

    expect(await pushForTemplate(deps, push("kitchen.portion_set"))).toEqual({ devices: 3, sent: 3, gone: 0, failed: 0 });
    expect(await pushForTemplate(deps, push("kitchen.dish_posted", { dishName: "Dal", dishUrl: "" }))).toBeNull();
    expect(await pushForTemplate(deps, push("kitchen.paid_you", { payerName: "Dev", amount: "₹400.00" }))).toBeNull();
    // Not one of the kinds at all.
    expect(await pushForTemplate(deps, push("kitchen.logged_for_you"))).toBeNull();
    expect(service.requests).toHaveLength(3);
    expect((await devices.ipad.decrypt(service.requests[2]!.body)).kind).toBe("kitchen.portion_set");
  });

  it("is a person's own: someone else's push row turns nothing on for them", async () => {
    const { service, prefs, deps } = await setup();
    prefs.set(ANU, "push", { "kitchen.portion_set": true });
    expect(await pushForTemplate(deps, push("kitchen.portion_set"))).toBeNull();
    // A push row under a group (not the person's own, everywhere) is not read either.
    prefs.set(DEV, "push", { "kitchen.portion_set": true }, "11111111-1111-4111-8111-111111111111");
    expect(await pushForTemplate(deps, push("kitchen.portion_set"))).toBeNull();
    expect(service.requests).toHaveLength(0);
  });

  it("fails closed without a VAPID pair: nothing sent, one log line naming what is missing, never a key", async () => {
    const { service, prefs, deps } = await setup();
    prefs.set(DEV, "push", { "kitchen.portion_set": true });
    const original = console.warn;
    const lines: string[] = [];
    console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      const noPrivate = { ...deps, keys: () => loadVapidKeys({ VAPID_PUBLIC_KEY: pair.publicKey, EMAIL_FROM_ADDRESS: "a@b.c" }) };
      expect(await pushForTemplate(noPrivate, push("kitchen.portion_set"))).toMatchObject({ devices: 0, skipped: "push_off" });
      expect(await pushForTemplate(noPrivate, push("kitchen.portion_set"))).toMatchObject({ skipped: "push_off" });
      const other = await vapidPair();
      const mismatched = { ...deps, keys: () => loadVapidKeys({ ...vapidEnv(pair), VAPID_PRIVATE_KEY: other.privateKey }) };
      expect(await pushForTemplate(mismatched, push("kitchen.portion_set"))).toMatchObject({ skipped: "push_off" });
      const garbage = { ...deps, keys: () => loadVapidKeys({ ...vapidEnv(pair), VAPID_PUBLIC_KEY: "not-a-key" }) };
      expect(await pushForTemplate(garbage, push("kitchen.portion_set"))).toMatchObject({ skipped: "push_off" });
      expect(service.requests).toHaveLength(0);

      expect(lines.filter((l) => l.includes("VAPID_PRIVATE_KEY is not set"))).toHaveLength(1);
      expect(lines.some((l) => l.includes("does not sign for VAPID_PUBLIC_KEY"))).toBe(true);
      expect(lines.some((l) => l.includes("VAPID_PUBLIC_KEY is not a base64url"))).toBe(true);
      for (const line of lines) {
        expect(line).toContain("Email is unaffected");
        expect(line).not.toContain(pair.privateKey);
        expect(line).not.toContain(other.privateKey);
      }
    } finally {
      console.warn = original;
    }
  });
});

describe("the push messages", () => {
  it("say the three kinds in the app's words and open the email's page", () => {
    expect(renderPushMessage("kitchen.portion_set", { ...portionData, portions: "1½" }, "t")).toMatchObject({
      body: "Anu said you had 1½ portions of Egg fried rice",
      url: "/dishes/dsh_0123456789abcdef0123456789abcdef",
    });
    expect(
      renderPushMessage("kitchen.dish_posted", { cookName: "Rahul", dishName: "Egg fried rice", dishUrl: "https://cookpool.store/dishes/dsh_1" }, "t"),
    ).toEqual({ kind: "kitchen.dish_posted", title: "Cookpool", body: "Egg fried rice is ready to claim", url: "/dishes/dsh_1", tag: "t" });
    expect(
      renderPushMessage("kitchen.paid_you", { payerName: "Dev", amount: "₹400.00", method: "UPI", personUrl: "https://cookpool.store/people/usr_dev" }, "t"),
    ).toMatchObject({ body: "Dev paid you ₹400.00 · UPI", url: "/people/usr_dev" });
    expect(renderPushMessage("kitchen.paid_you", { payerName: null, amount: "₹50.00", method: null, personUrl: "" }, "t")).toMatchObject({
      body: "Someone paid you ₹50.00",
      url: "/home",
    });
    expect(renderPushMessage("kitchen.use_soon", {}, "t")).toBeNull();
  });

  it("stays one line and small, and links only into the app", () => {
    const long = renderPushMessage("kitchen.dish_posted", { dishName: `Dal\n\n${"x".repeat(5000)}`, dishUrl: "javascript:alert(1)" }, "t".repeat(500))!;
    expect(long.body).not.toContain("\n");
    expect(long.body.length).toBeLessThanOrEqual(200);
    expect(long.tag.length).toBeLessThanOrEqual(200);
    expect(long.url).toBe("/home");
    expect(new TextEncoder().encode(JSON.stringify(long)).length).toBeLessThan(PUSH_MESSAGE_MAX_BYTES);
    // A path that a browser would read as another host ("//other.example") is not a path in the app.
    expect(appPath("https://cookpool.store//other.example/x")).toBe("/home");
    expect(appPath("https://cookpool.store/dishes/dsh_1?from=push")).toBe("/dishes/dsh_1?from=push");
  });
});
