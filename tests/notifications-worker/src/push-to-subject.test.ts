// Push to a subject (Cookpool GC-3): the internal route kitchen-worker's
// timer sweep calls. Reachable only with the internal actor headers, and then
// only from kitchen-worker — api-edge's facade does not list it, and an
// api-edge caller is refused anyway. It pushes to every device of the person
// named, with no preference check, hands pushToDevices exactly the five
// message fields, and answers the push summary.

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PushMessage, PushToSubjectResponse } from "@saas/contracts/notifications";
import { route } from "@notifications-worker/router";
import { handlePushToSubject, type PushToSubjectDeps } from "@notifications-worker/handlers/push-to-subject";
import type { PushDeliveryDeps, PushSummary } from "@notifications-worker/push/deliver";
import type { Env } from "@notifications-worker/env";
import type { InternalActor } from "@notifications-worker/router";
import type { VapidLoad } from "@notifications-worker/push/vapid";
import { bodyFor, browser, keysFor, memorySubscriptions, pushService, vapidPair, type VapidPair } from "./push-fakes.js";

if (!(globalThis as Record<string, unknown>).crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const env: Env = { ENVIRONMENT: "test", NOTIFICATIONS_PROVIDER: "local-debug" };
const PATH = "/v1/notifications/push-to-subject";
const DEV = "usr_dev";
const ANU = "usr_anu";
const NOW = new Date("2026-11-08T12:00:00.000Z");

const KITCHEN: InternalActor = { subjectId: "kitchen-worker", subjectType: "system", internalCaller: "kitchen-worker" };

const timerMessage = (over: Partial<Record<keyof PushMessage, unknown>> = {}) => ({
  kind: "kitchen.timer",
  title: "Simmer · step 7",
  body: "The oil shows at the edges",
  url: "/cook/session",
  tag: "tmr_00000000000040008000000000000001",
  ...over,
});

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://nf${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const internalHeaders = (caller: string) => ({
  "x-internal-actor": caller,
  "x-actor-subject-id": caller,
  "x-actor-subject-type": "system",
});

async function json<T>(res: Response): Promise<{ data: T; error: { code: string; details: { fields?: Record<string, string[]> } } }> {
  return (await res.json()) as never;
}

let pair: VapidPair;
beforeAll(async () => {
  pair = await vapidPair();
});

describe("the route's gate", () => {
  it("refuses a call without the internal actor headers (403), whatever it names", async () => {
    const res = await route(post({ subjectId: DEV, message: timerMessage() }), env);
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("forbidden");
    // A user's own headers, as a browser could send them, are not enough either.
    const asUser = await route(post({ subjectId: DEV, message: timerMessage() }, { "x-actor-subject-id": DEV, "x-actor-subject-type": "user" }), env);
    expect(asUser.status).toBe(403);
  });

  it("refuses an internal caller other than kitchen-worker — api-edge included", async () => {
    for (const caller of ["api-edge", "membership-worker", "identity-worker"]) {
      const res = await route(post({ subjectId: DEV, message: timerMessage() }, internalHeaders(caller)), env);
      expect(res.status).toBe(403);
    }
  });

  it("lets kitchen-worker through to the handler, and takes only POST", async () => {
    // No database bound here: getting as far as the 503 means the gate let it through.
    const res = await route(post({ subjectId: DEV, message: timerMessage() }, internalHeaders("kitchen-worker")), env);
    expect(res.status).toBe(503);
    const get = await route(new Request(`http://nf${PATH}`, { method: "GET", headers: internalHeaders("kitchen-worker") }), env);
    expect(get.status).toBe(405);
  });

  it("is not a path api-edge's notifications facade forwards", () => {
    const facade = resolve(ROOT, "apps/api-edge/src/notifications-facade.ts");
    if (!existsSync(facade)) return;
    const source = readFileSync(facade, "utf8");
    expect(source).not.toMatch(/push-to-subject/);
    // The facade forwards only the paths it lists, by exact match.
    expect(source).toMatch(/export function isNotificationsRoute\(pathname: string\): boolean \{\n\s+return Object\.hasOwn\(METHODS, pathname\);/);
  });
});

describe("the body", () => {
  const send = (body: unknown) => handlePushToSubject(post(body), env, "req_t", KITCHEN, { subscriptions: memorySubscriptions(), keys: keysFor(pair) });

  it.each([
    ["no subject", { message: timerMessage() }, "subjectId"],
    ["a subject that is no one's id", { subjectId: "usr dev", message: timerMessage() }, "subjectId"],
    ["no message", { subjectId: DEV }, "message"],
    ["a preference kind", { subjectId: DEV, message: timerMessage({ kind: "kitchen.portion_set" }) }, "message.kind"],
    ["the test kind", { subjectId: DEV, message: timerMessage({ kind: "test" }) }, "message.kind"],
    ["an empty title", { subjectId: DEV, message: timerMessage({ title: " " }) }, "message.title"],
    ["a 201-character body", { subjectId: DEV, message: timerMessage({ body: "x".repeat(201) }) }, "message.body"],
    ["another host's url", { subjectId: DEV, message: timerMessage({ url: "https://evil.example/" }) }, "message.url"],
    ["a protocol-relative url", { subjectId: DEV, message: timerMessage({ url: "//evil.example/" }) }, "message.url"],
    ["no tag", { subjectId: DEV, message: timerMessage({ tag: undefined }) }, "message.tag"],
  ])("refuses %s with 422", async (_why, body, field) => {
    const res = await send(body);
    expect(res.status).toBe(422);
    expect(Object.keys((await json(res)).error.details.fields ?? {})).toContain(field);
  });

  it("refuses a body that is not JSON (400)", async () => {
    expect((await send("{nope")).status).toBe(400);
  });
});

describe("the push", () => {
  function deps(extra: Partial<PushToSubjectDeps> = {}) {
    const subscriptions = memorySubscriptions();
    return { subscriptions, deps: { subscriptions, keys: keysFor(pair), now: () => NOW, ...extra } satisfies PushToSubjectDeps };
  }

  it("answers a subject with no devices as nothing sent, without trying", async () => {
    const service = pushService();
    const { deps: d } = deps({ fetch: service.fetch });
    const res = await handlePushToSubject(post({ subjectId: DEV, message: timerMessage() }), env, "req_t", KITCHEN, d);
    expect(res.status).toBe(200);
    expect((await json<PushToSubjectResponse>(res)).data).toEqual({ devices: 0, sent: 0, gone: 0, failed: 0, skipped: "no_devices" });
    expect(service.requests).toHaveLength(0);
  });

  it("hands pushToDevices the subject and exactly the five message fields — nothing else the caller sent", async () => {
    const seen: Array<{ subjectId: string; message: PushMessage; endpoint: string | undefined }> = [];
    const push = async (_d: PushDeliveryDeps, subjectId: string, message: PushMessage, endpoint?: string): Promise<PushSummary> => {
      seen.push({ subjectId, message, endpoint });
      return { devices: 2, sent: 1, gone: 1, failed: 0 };
    };
    const { deps: d } = deps({ push });
    const res = await handlePushToSubject(
      post({ subjectId: DEV, endpoint: "https://fcm.googleapis.com/fcm/send/one", message: { ...timerMessage(), icon: "/x.png", data: { a: 1 } } }),
      env,
      "req_t",
      KITCHEN,
      d,
    );
    expect(res.status).toBe(200);
    expect((await json<PushToSubjectResponse>(res)).data).toEqual({ devices: 2, sent: 1, gone: 1, failed: 0 });
    expect(seen).toEqual([
      {
        subjectId: DEV,
        message: {
          kind: "kitchen.timer",
          title: "Simmer · step 7",
          body: "The oil shows at the edges",
          url: "/cook/session",
          tag: "tmr_00000000000040008000000000000001",
        },
        // Every device: the body cannot narrow it to one.
        endpoint: undefined,
      },
    ]);
  });

  it("carries an ask's push (Cookpool PN-8) as it carries a timer's: its kind, the Home path with the ask, its tag", async () => {
    const seen: PushMessage[] = [];
    const push = async (_d: PushDeliveryDeps, _subjectId: string, message: PushMessage): Promise<PushSummary> => {
      seen.push(message);
      return { devices: 1, sent: 1, gone: 0, failed: 0 };
    };
    const { deps: d } = deps({ push });
    const ask = {
      kind: "kitchen.ask",
      title: "Dev asks for 1 pinch of your saffron",
      body: "For Dev and Anu · ₹12 to you",
      url: "/home?ask=ask_00000000000040008000000000000001",
      tag: "ask_00000000000040008000000000000001",
    };
    const res = await handlePushToSubject(post({ subjectId: ANU, message: ask }), env, "req_t", KITCHEN, d);
    expect(res.status).toBe(200);
    expect(seen).toEqual([ask]);
  });

  it("reaches every device of the subject with no push preference set — and no one else's", async () => {
    const service = pushService();
    const { subscriptions, deps: d } = deps({ fetch: service.fetch });
    const phone = await browser("https://fcm.googleapis.com/fcm/send/dev-phone");
    const laptop = await browser("https://updates.push.services.mozilla.com/wpush/v2/dev-laptop");
    const anus = await browser("https://fcm.googleapis.com/fcm/send/anu-phone");
    let id = 0;
    for (const [who, b] of [[DEV, phone], [DEV, laptop], [ANU, anus]] as const) {
      await subscriptions.upsert({
        id: `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        subjectId: who,
        endpoint: b.endpoint,
        p256dh: b.subscription.keys.p256dh,
        auth: b.subscription.keys.auth,
        userAgent: null,
        now: NOW,
        maxPerSubject: 10,
      });
    }
    service.answer(laptop.endpoint, 410);

    const res = await handlePushToSubject(post({ subjectId: DEV, message: timerMessage() }), env, "req_t", KITCHEN, d);
    expect((await json<PushToSubjectResponse>(res)).data).toEqual({ devices: 2, sent: 1, gone: 1, failed: 0 });
    expect(service.requests.map((r) => r.endpoint).sort()).toEqual([phone.endpoint, laptop.endpoint].sort());
    expect(await phone.decrypt(bodyFor(service, phone.endpoint))).toEqual(timerMessage());
    // The gone device is dropped; Anu's is untouched.
    expect([...subscriptions.rows.keys()].sort()).toEqual([anus.endpoint, phone.endpoint].sort());
  });

  it("answers nothing sent when push is off here, and 503 when the devices cannot be read", async () => {
    const { deps: off } = deps({ keys: async (): Promise<VapidLoad> => ({ ok: false, problem: "missing_private_key" }) });
    const res = await handlePushToSubject(post({ subjectId: DEV, message: timerMessage() }), env, "req_t", KITCHEN, off);
    expect(res.status).toBe(200);
    expect((await json<PushToSubjectResponse>(res)).data).toEqual({ devices: 0, sent: 0, gone: 0, failed: 0, skipped: "push_off" });

    const { subscriptions, deps: broken } = deps();
    subscriptions.listForSubject = async () => ({ ok: false, error: { kind: "internal", message: "d1 down" } }) as never;
    const unreadable = await handlePushToSubject(post({ subjectId: DEV, message: timerMessage() }), env, "req_t", KITCHEN, broken);
    expect(unreadable.status).toBe(503);
  });
});
