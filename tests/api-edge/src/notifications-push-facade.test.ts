// The public Web Push routes (Cookpool PW-5) at the edge: each resolves the
// session and forwards to notifications-worker with the person pinned in the
// actor headers. Nothing the caller sends can name another person: the push
// writes forward only the fields they need, and preferences keep the PX3 pin.

import { isNotificationsRoute, handleNotificationsRoute } from "@api-edge/notifications-facade";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function env(userId: string | null = "usr_dev") {
  const calls: FetchCall[] = [];
  const fetcher = (handle: (url: string, init: RequestInit) => Response) =>
    ({
      fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return Promise.resolve(handle(url, init ?? {}));
      },
      connect() {
        throw new Error("not implemented");
      },
    }) as unknown as Fetcher;
  return {
    calls,
    env: {
      ENVIRONMENT: "test",
      IDENTITY_WORKER: fetcher((url) =>
        userId && url.includes("/v1/auth/resolve")
          ? Response.json({
              data: {
                actor: { actorType: "user", actorId: userId, email: "dev@example.com" },
                session: { id: "ses_1" },
                user: { id: userId, email: "dev@example.com", displayName: "Dev" },
              },
              meta: { requestId: "r", cursor: null },
            })
          : Response.json({ error: { code: "unauthenticated", message: "no" } }, { status: 401 }),
      ),
      NOTIFICATIONS_WORKER: fetcher((url, init) => {
        calls.push({ url, init });
        return Response.json({ data: { ok: true }, meta: { requestId: "r", cursor: null } });
      }),
    },
  };
}

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { authorization: "Bearer token", "content-type": "application/json", "user-agent": UA, ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

const SUBS = "/v1/notifications/push-subscriptions";
const KEY = "/v1/notifications/push-key";
const TEST = "/v1/notifications/push-test";
const PREFS = "/v1/notifications/preferences";

describe("the push routes at the edge", () => {
  it("are notifications routes, exactly", () => {
    for (const path of [SUBS, KEY, TEST, PREFS]) expect(isNotificationsRoute(path)).toBe(true);
    for (const path of [`${SUBS}/x`, "/v1/notifications/push", "/v1/notifications/push-keys"]) expect(isNotificationsRoute(path)).toBe(false);
  });

  it.each([
    ["GET", SUBS],
    ["PUT", SUBS],
    ["POST", KEY],
    ["GET", TEST],
    ["DELETE", PREFS],
  ])("answer %s %s with 405", async (method, path) => {
    const { env: e, calls } = env();
    const res = await handleNotificationsRoute(call(method, path), e as never, "req", path);
    expect(res.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("need a session", async () => {
    const { env: e, calls } = env(null);
    const res = await handleNotificationsRoute(call("POST", SUBS, { endpoint: "https://x" }), e as never, "req", SUBS);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("subscribe the session's person, forwarding only the endpoint, the keys and the browser's User-Agent", async () => {
    const { env: e, calls } = env("usr_dev");
    const body = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      expirationTime: null,
      keys: { p256dh: "BKey", auth: "secret" },
      subjectId: "usr_victim",
      subjectKind: "organization",
    };
    const res = await handleNotificationsRoute(call("POST", SUBS, body, { "x-actor-subject-id": "usr_victim" }), e as never, "req_1", SUBS);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://notifications.internal/v1/notifications/push-subscriptions");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("x-internal-actor")).toBe("api-edge");
    expect(headers.get("x-actor-subject-id")).toBe("usr_dev");
    expect(headers.get("x-actor-subject-type")).toBe("user");
    expect(headers.get("user-agent")).toBe(UA);
    expect(headers.get("authorization")).toBeNull();
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "BKey", auth: "secret" },
    });
  });

  it("unsubscribe only the session's person, forwarding only the endpoint", async () => {
    const { env: e, calls } = env("usr_dev");
    const res = await handleNotificationsRoute(
      call("DELETE", SUBS, { endpoint: "https://fcm.googleapis.com/fcm/send/abc", subjectId: "usr_anu" }),
      e as never, "req", SUBS,
    );
    expect(res.status).toBe(200);
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(new Headers(calls[0]!.init.headers).get("x-actor-subject-id")).toBe("usr_dev");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" });
  });

  it("refuse a write body that is not a JSON object with 400", async () => {
    const { env: e, calls } = env();
    for (const body of ["not-json", "[1,2]", "null"]) {
      expect((await handleNotificationsRoute(call("POST", SUBS, body), e as never, "req", SUBS)).status).toBe(400);
    }
    expect((await handleNotificationsRoute(call("DELETE", SUBS, ""), e as never, "req", SUBS)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("read the push key for a signed-in person", async () => {
    const { env: e, calls } = env("usr_dev");
    const res = await handleNotificationsRoute(call("GET", KEY), e as never, "req", KEY);
    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe("https://notifications.internal/v1/notifications/push-key");
    expect(calls[0]!.init.method).toBe("GET");
    expect(new Headers(calls[0]!.init.headers).get("x-actor-subject-id")).toBe("usr_dev");
  });

  it("send a test push to the session's person, with or without a body", async () => {
    const { env: e, calls } = env("usr_dev");
    expect((await handleNotificationsRoute(call("POST", TEST), e as never, "req", TEST)).status).toBe(200);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({});
    await handleNotificationsRoute(call("POST", TEST, { endpoint: "https://x.example/1", subjectId: "usr_anu" }), e as never, "req", TEST);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ endpoint: "https://x.example/1" });
    expect(new Headers(calls[1]!.init.headers).get("x-actor-subject-id")).toBe("usr_dev");
  });

  it("keep push preferences on the PX3 route, pinned: no orgId needed for push", async () => {
    const { env: e, calls } = env("usr_dev");
    await handleNotificationsRoute(call("GET", `${PREFS}?channel=push&subjectId=usr_anu`), e as never, "req", PREFS);
    const read = new URL(calls[0]!.url);
    expect(read.searchParams.get("channel")).toBe("push");
    expect(read.searchParams.get("orgId")).toBeNull();
    expect(read.searchParams.get("subjectId")).toBe("usr_dev");

    await handleNotificationsRoute(
      call("PUT", PREFS, { channel: "push", kinds: { "kitchen.paid_you": true }, subjectId: "usr_anu" }),
      e as never, "req", PREFS,
    );
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      channel: "push",
      kinds: { "kitchen.paid_you": true },
      subjectKind: "user",
      subjectId: "usr_dev",
    });
  });
});
