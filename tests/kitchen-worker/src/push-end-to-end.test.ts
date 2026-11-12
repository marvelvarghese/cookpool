// Web Push end to end (PW-5): kitchen-worker's enqueues reach the REAL
// notifications-worker — its routes, preferences, subscriptions, VAPID keys
// and aes128gcm encryption — over the same SQLite database (every migration
// applied, 310 and 320 included), and its pushes reach a fake push service.
// A simulated phone subscribes through the routes api-edge exposes, turns
// kinds on, and decrypts what it is sent.
//
// "A portion set by Anu reaches Dev's locked phone", as far as a test can
// take it: once, in the app's words, linking to the dish.

import { route as notificationsRoute } from "@notifications-worker/router";
import type { Env as NotificationsEnv } from "@notifications-worker/env";
import { base64urlEncode, ecdhWith } from "@notifications-worker/push/crypto";
import type { DishResponse, KitchenDish, KitchenItemResponse } from "@saas/contracts/kitchen";
import type { PushMessage } from "@saas/contracts/notifications";
import { createHarness, envelope, newGroup, seedDebt, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const RAHUL = "usr_rahul";
const ANU = "usr_anu";
const DEV = "usr_dev";
const DEV_PHONE = "https://fcm.googleapis.com/fcm/send/dev-phone";
const DEV_OLD_LAPTOP = "https://updates.push.services.mozilla.com/wpush/v2/dev-old-laptop";

interface Phone {
  endpoint: string;
  subscription: { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
  decrypt(body: Uint8Array): Promise<PushMessage>;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** A browser's side of RFC 8291: its key pair and auth secret, and decryption. */
async function phone(endpoint: string): Promise<Phone> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const text = new TextEncoder();
  return {
    endpoint,
    subscription: { endpoint, expirationTime: null, keys: { p256dh: base64urlEncode(uaPublic), auth: base64urlEncode(auth) } },
    async decrypt(body) {
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
let flat: Group;
let notificationsEnv: NotificationsEnv;
let pushes: Array<{ endpoint: string; headers: Headers; body: Uint8Array }>;
let answers: Map<string, number>;
let emails: string[];
const realFetch = globalThis.fetch;

beforeEach(async () => {
  h = createHarness({ deps: { now: () => NOW } });
  flat = newGroup("Flat 4B");
  h.grant(RAHUL, flat, "builder");
  h.grant(ANU, flat, "owner");
  h.grant(DEV, flat, "builder");
  for (const [who, name] of [[RAHUL, "Rahul"], [ANU, "Anu"], [DEV, "Dev"]] as const) {
    h.profile(who, { displayName: name, email: `${name.toLowerCase()}@example.com` });
  }

  // The environment's VAPID pair, in the forms scripts/vapid-keys.mjs prints.
  const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  emails = [];
  notificationsEnv = {
    ENVIRONMENT: "test",
    PLATFORM_DB: h.env.PLATFORM_DB!,
    NOTIFICATIONS_PROVIDER: "cloudflare-email",
    EMAIL_FROM_ADDRESS: "no-reply@mail.cookpool.store",
    EMAIL_FROM_NAME: "cookpool",
    EMAIL: {
      async send(message) {
        emails.push(`${message.to}: ${message.subject}`);
        return { messageId: `msg_${emails.length}` };
      },
    },
    VAPID_PUBLIC_KEY: base64urlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", vapid.publicKey)) as ArrayBuffer)),
    VAPID_PRIVATE_KEY: base64urlEncode(new Uint8Array((await crypto.subtle.exportKey("pkcs8", vapid.privateKey)) as ArrayBuffer)),
  };
  h.env.NOTIFICATIONS_WORKER = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => notificationsRoute(new Request(input, init), notificationsEnv),
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;

  // The push services, behind the worker's global fetch.
  pushes = [];
  answers = new Map();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body instanceof ArrayBuffer ? new Uint8Array(init.body) : new Uint8Array();
    pushes.push({ endpoint, headers: new Headers(init?.headers), body });
    return new Response(null, { status: answers.get(endpoint) ?? 201 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  h.close();
});

/** A call to notifications-worker as api-edge makes it: the person pinned in the actor headers. */
async function asPerson(person: string, method: string, path: string, body?: unknown): Promise<Response> {
  return notificationsRoute(
    new Request(`https://notifications.internal${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-internal-actor": "api-edge",
        "x-actor-subject-id": person,
        "x-actor-subject-type": "user",
        "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    notificationsEnv,
  );
}

async function kitchen<T>(method: string, path: string, as: string, body?: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, path, { as, ...(body !== undefined ? { body } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

async function eggFriedRice(): Promise<KitchenDish> {
  const rice = await kitchen<KitchenItemResponse>("POST", "/v1/kitchen/me/items", RAHUL, {
    name: "Rice", category: "Grains", quantity: "1", unit: "kg", priceMinor: 6000,
  });
  const res = await kitchen<DishResponse>("POST", "/v1/kitchen/me/dishes", RAHUL, {
    name: "Egg fried rice", orgId: flat.publicId, portionsHalf: 8, extrasMinor: 1000, splitMode: "claims",
    ingredients: [{ itemId: rice.body.data.item.id, quantity: "500", unit: "g" }],
  });
  expect(res.status).toBe(201);
  return res.body.data.dish;
}

const setPortion = (as: string, dish: KitchenDish, who: string, portionsHalf: number) =>
  kitchen<DishResponse>("PUT", `/v1/organizations/${flat.publicId}/kitchen/dishes/${dish.id}/claims/${who}`, as, { portionsHalf });

describe("Web Push, kitchen-worker to Dev's phone", () => {
  it("a portion Anu set reaches Dev's phone once, in the app's words; a dish to claim does not until he turns it on", async () => {
    const devPhone = await phone(DEV_PHONE);
    expect((await asPerson(DEV, "POST", "/v1/notifications/push-subscriptions", devPhone.subscription)).status).toBe(200);
    const key = (await (await asPerson(DEV, "GET", "/v1/notifications/push-key")).json()) as { data: { publicKey: string } };
    expect(key.data.publicKey).toBe(notificationsEnv.VAPID_PUBLIC_KEY);

    // Off until turned on: the dish Rahul posts is emailed to Dev, not pushed.
    const dish = await eggFriedRice();
    expect(emails).toContain("dev@example.com: Rahul made Egg fried rice — claim yours");
    expect(pushes).toEqual([]);

    // Dev turns on "someone set my portion" only.
    const on = await asPerson(DEV, "PUT", "/v1/notifications/preferences", {
      subjectKind: "user", subjectId: DEV, channel: "push", kinds: { "kitchen.portion_set": true },
    });
    expect(on.status).toBe(200);

    expect((await setPortion(ANU, dish, DEV, 2)).status).toBe(200);
    expect(emails).toContain("dev@example.com: Anu said you had 1 portion of Egg fried rice");
    expect(pushes.map((p) => p.endpoint)).toEqual([DEV_PHONE]);
    const [push] = pushes;
    expect(push!.headers.get("content-encoding")).toBe("aes128gcm");
    expect(push!.headers.get("ttl")).toBe("86400");
    expect(push!.headers.get("urgency")).toBe("normal");
    expect(push!.headers.get("authorization")).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${notificationsEnv.VAPID_PUBLIC_KEY}$`));
    expect(await devPhone.decrypt(push!.body)).toEqual({
      kind: "kitchen.portion_set",
      title: "Cookpool",
      body: "Anu said you had 1 portion of Egg fried rice",
      url: `/dishes/${dish.id}`,
      tag: `kitchen.portion_set:${dish.id}:${DEV}`,
    });

    // Changed again: the email's key is spent, so no second push either.
    expect((await setPortion(ANU, dish, DEV, 3)).status).toBe(200);
    expect(pushes).toHaveLength(1);

    const stored = h.db.prepare("SELECT subject_id, user_agent, last_success_at FROM notifications_push_subscriptions").all();
    // notifications-worker keeps its own clock: a success was recorded, whenever it was.
    expect(stored).toEqual([{ subject_id: DEV, user_agent: "Chrome on Android", last_success_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) }]);
  });

  it("someone paid you reaches every device; a device its push service has forgotten is deleted", async () => {
    const devPhone = await phone(DEV_PHONE);
    const oldLaptop = await phone(DEV_OLD_LAPTOP);
    for (const device of [devPhone, oldLaptop]) {
      expect((await asPerson(DEV, "POST", "/v1/notifications/push-subscriptions", device.subscription)).status).toBe(200);
    }
    await asPerson(DEV, "PUT", "/v1/notifications/preferences", { subjectKind: "user", subjectId: DEV, channel: "push", kinds: { "kitchen.paid_you": true } });
    answers.set(DEV_OLD_LAPTOP, 410);
    // SE3: a payment recorded in Cookpool pays a Kitchen debt, never more than it.
    await seedDebt(h, flat, ANU, DEV, 40100);
    emails.length = 0;
    pushes.length = 0;

    const paid = await kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/settlements`, ANU, {
      fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 40000, method: "upi",
    });
    expect(paid.status).toBe(201);
    expect(emails).toContain("dev@example.com: Anu paid you ₹400.00 · UPI");
    expect(pushes.map((p) => p.endpoint).sort()).toEqual([DEV_OLD_LAPTOP, DEV_PHONE].sort());
    const message = await devPhone.decrypt(pushes.find((p) => p.endpoint === DEV_PHONE)!.body);
    expect(message).toMatchObject({ kind: "kitchen.paid_you", body: "Anu paid you ₹400.00 · UPI", url: `/people/${ANU}` });

    expect(h.db.prepare("SELECT endpoint FROM notifications_push_subscriptions").all()).toEqual([{ endpoint: DEV_PHONE }]);

    // A payment Dev records himself, as the one paid, tells nobody.
    const own = await kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/settlements`, DEV, {
      fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 100, method: "cash",
    });
    expect(own.status).toBe(201);
    expect(pushes).toHaveLength(2);
  });

  it("another person's device is never theirs to remove, and a push to Anu never reaches Dev", async () => {
    const devPhone = await phone(DEV_PHONE);
    await asPerson(DEV, "POST", "/v1/notifications/push-subscriptions", devPhone.subscription);
    const removed = (await (await asPerson(ANU, "DELETE", "/v1/notifications/push-subscriptions", { endpoint: DEV_PHONE })).json()) as {
      data: { removed: boolean };
    };
    expect(removed.data.removed).toBe(false);
    await asPerson(ANU, "PUT", "/v1/notifications/preferences", { subjectKind: "user", subjectId: ANU, channel: "push", kinds: { "kitchen.portion_set": true } });

    const dish = await eggFriedRice();
    expect((await setPortion(DEV, dish, ANU, 2)).status).toBe(200);
    // Anu turned it on but has no device; Dev has a device but set it himself.
    expect(pushes).toEqual([]);
    expect(h.db.prepare("SELECT subject_id FROM notifications_push_subscriptions").all()).toEqual([{ subject_id: DEV }]);
  });

  it("with no VAPID private key, email still goes and nothing is pushed", async () => {
    delete notificationsEnv.VAPID_PRIVATE_KEY;
    const original = console.warn;
    const lines: string[] = [];
    console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      const devPhone = await phone(DEV_PHONE);
      await asPerson(DEV, "POST", "/v1/notifications/push-subscriptions", devPhone.subscription);
      await asPerson(DEV, "PUT", "/v1/notifications/preferences", { subjectKind: "user", subjectId: DEV, channel: "push", kinds: { "kitchen.portion_set": true } });
      const key = (await (await asPerson(DEV, "GET", "/v1/notifications/push-key")).json()) as { data: { publicKey: string | null } };
      expect(key.data.publicKey).toBeNull();

      const dish = await eggFriedRice();
      expect((await setPortion(ANU, dish, DEV, 2)).status).toBe(200);
      expect(emails).toContain("dev@example.com: Anu said you had 1 portion of Egg fried rice");
      expect(pushes).toEqual([]);
    } finally {
      console.warn = original;
    }
  });
});
