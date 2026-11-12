// Delegated tokens at the edge, scope by scope (cookpool-mcp MC-2, design §1):
// what each scope allows alone, money.read gating, timers, the auth routes,
// the delegation headers kitchen-worker gets, the resolveActor layer for any
// facade, failing closed, and a revoked token refused once the 30 s actor
// cache lets it go.

import { resolveActor } from "@api-edge/resolve-actor";
import { ACTOR_CACHE_TTL_SECONDS } from "@api-edge/actor-cache";
import {
  ALL_SCOPES,
  DLG,
  ORG,
  SESSION_TOKEN,
  USER,
  delegatedActor,
  delegatedToken,
  edge,
  reasonOf,
  sessionActor,
} from "./delegation-fixtures";

const HEX = "0123456789abcdef0123456789abcdef";
const O = `/v1/organizations/${ORG}`;

async function status(e: ReturnType<typeof edge>, method: string, path: string, token = delegatedToken()) {
  const got = await reasonOf(await e.fetch(path, method, { token }));
  return got.status === 403 ? `403 ${got.reason}` : String(got.status);
}

describe("each scope alone", () => {
  const table: Array<[string, Array<[string, string, string]>]> = [
    [
      "kitchen.read",
      [
        ["GET", "/v1/kitchen/me/items?soon=1", "200"],
        ["GET", `/v1/kitchen/me/items/itm_${HEX}`, "200"],
        ["GET", "/v1/kitchen/me/pantries", "200"],
        ["GET", "/v1/kitchen/me/search?q=milk", "200"],
        ["GET", "/v1/kitchen/me/restock", "200"],
        ["GET", "/v1/kitchen/me/cook-now", "200"],
        ["GET", "/v1/kitchen/me/recipes", "200"],
        ["GET", `/v1/kitchen/me/recipes/rcp_${HEX}/match`, "200"],
        ["GET", "/v1/kitchen/recipes?q=dal", "200"],
        ["GET", `/v1/kitchen/recipes/rcp_${HEX}?f=500`, "200"],
        ["GET", `${O}/kitchen/items`, "200"],
        // Money needs money.read, the inbox included (it carries payments due).
        ["GET", "/v1/kitchen/me/balances", "403 scope"],
        ["GET", `/v1/kitchen/me/people/usr_${HEX}`, "403 scope"],
        ["GET", `${O}/kitchen/balances`, "403 scope"],
        ["GET", "/v1/kitchen/me/inbox", "403 scope"],
        // Reads the table does not name, and every write.
        ["GET", "/v1/kitchen/me/items/history", "403 scope"],
        ["GET", `/v1/kitchen/me/items/itm_${HEX}/moves`, "403 scope"],
        ["GET", `${O}/kitchen/items/itm_${HEX}`, "403 scope"],
        ["GET", `${O}/kitchen/activity`, "403 scope"],
        ["GET", "/v1/kitchen/me/profile", "403 scope"],
        ["POST", "/v1/kitchen/me/items", "403 scope"],
        ["POST", `/v1/kitchen/me/items/itm_${HEX}/uses`, "403 scope"],
        ["POST", "/v1/kitchen/me/purchases", "403 scope"],
        ["GET", "/v1/kitchen/me/timers", "403 scope"],
        ["POST", "/v1/kitchen/me/timers", "403 scope"],
        ["POST", "/v1/kitchen/me/suggestions", "403 scope"],
      ],
    ],
    [
      "money.read",
      [
        ["GET", "/v1/kitchen/me/balances", "200"],
        ["GET", `/v1/kitchen/me/people/usr_${HEX}`, "200"],
        ["GET", `${O}/kitchen/balances`, "200"],
        ["GET", "/v1/kitchen/me/inbox", "403 scope"],
        ["GET", "/v1/kitchen/me/items", "403 scope"],
        ["GET", `${O}/kitchen/settle-plan`, "403 scope"],
        ["POST", `${O}/kitchen/settlements`, "403 scope"],
        ["POST", `${O}/kitchen/expenses`, "403 scope"],
        ["POST", `${O}/kitchen/txns/txn_${HEX}/reverse`, "403 scope"],
      ],
    ],
    [
      "timers.write",
      [
        ["GET", "/v1/kitchen/me/timers", "200"],
        ["POST", "/v1/kitchen/me/timers", "200"],
        ["DELETE", `/v1/kitchen/me/timers/tmr_${HEX}`, "200"],
        ["PATCH", `/v1/kitchen/me/timers/tmr_${HEX}`, "403 scope"],
        ["DELETE", "/v1/kitchen/me/timers", "403 scope"],
        ["DELETE", "/v1/kitchen/me/timers/all", "403 scope"],
        ["GET", "/v1/kitchen/me/items", "403 scope"],
      ],
    ],
    [
      "suggest.write",
      [
        ["POST", "/v1/kitchen/me/suggestions", "200"],
        ["GET", "/v1/kitchen/me/suggestions", "403 scope"],
        ["POST", `/v1/kitchen/me/suggestions/sug_${HEX}/confirm`, "403 scope"],
        ["GET", "/v1/kitchen/me/items", "403 scope"],
      ],
    ],
  ];

  it.each(table)("%s", async (scope, rows) => {
    const e = edge({ [delegatedToken()]: delegatedActor([scope]) });
    const got: Array<[string, string, string]> = [];
    for (const [method, path] of rows) got.push([method, path, await status(e, method, path)]);
    expect(got).toEqual(rows);
  });

  it("the inbox needs kitchen.read and money.read together", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(["kitchen.read", "money.read"]) });
    expect(await status(e, "GET", "/v1/kitchen/me/inbox")).toBe("200");
  });
});

describe("the auth routes and everything that is not the kitchen", () => {
  const paths: Array<[string, string]> = [
    ["POST", "/v1/auth/delegations"],
    ["GET", "/v1/auth/delegations"],
    ["DELETE", `/v1/auth/delegations/dlg_${HEX}`],
    ["GET", "/v1/auth/session"],
    ["GET", "/v1/auth/resolve"],
    ["GET", "/v1/auth/profile"],
    ["PATCH", "/v1/auth/profile"],
    ["POST", "/v1/auth/logout"],
    ["GET", "/v1/auth/security-events"],
    ["POST", "/v1/auth/login/start"],
    // Passkeys (PK-2): every one, the public sign-in two included.
    ["POST", "/v1/auth/passkeys/register/options"],
    ["POST", "/v1/auth/passkeys/register/verify"],
    ["GET", "/v1/auth/passkeys"],
    ["DELETE", "/v1/auth/passkeys/pky_0123456789abcdef"],
    ["POST", "/v1/auth/passkeys/login/options"],
    ["POST", "/v1/auth/passkeys/login/verify"],
    ["GET", "/v1/auth/oauth/github/start"],
    ["GET", "/v1/organizations"],
    ["POST", "/v1/organizations"],
    ["GET", `${O}/members`],
    ["POST", `${O}/invitations`],
    ["POST", "/v1/join"],
    ["POST", `${O}/leave`],
    ["GET", `${O}/api-keys`],
    ["GET", `${O}/billing/summary`],
    ["POST", `${O}/billing/checkout`],
    ["PUT", "/v1/notifications/preferences"],
    ["POST", "/v1/notifications/push-subscriptions"],
    ["GET", `${O}/audit`],
    ["POST", "/v1/internal/delegations/refresh"],
  ];

  it("refuses a delegated token on each with reason scope, forwarding nothing", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(ALL_SCOPES) });
    for (const [method, path] of paths) expect([method, path, await status(e, method, path)]).toEqual([method, path, "403 scope"]);
    expect(e.forwarded).toEqual([]);
    expect(e.resolves()).toBe(0);
  });

  it("still forwards a session's delegation routes to identity", async () => {
    const e = edge({ [SESSION_TOKEN]: sessionActor });
    for (const [method, path] of paths.slice(0, 3)) expect(await status(e, method, path, SESSION_TOKEN)).toBe("200");
    expect(e.forwarded.map((f) => [f.binding, new URL(f.url).pathname])).toEqual([
      ["IDENTITY_WORKER", "/v1/auth/delegations"],
      ["IDENTITY_WORKER", "/v1/auth/delegations"],
      ["IDENTITY_WORKER", `/v1/auth/delegations/dlg_${HEX}`],
    ]);
    expect(e.forwarded[0]!.headers.get("authorization")).toBe(`Bearer ${SESSION_TOKEN}`);
  });
});

describe("the delegation headers", () => {
  it("are sent for a delegated actor, comma-separated scopes", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(["timers.write", "kitchen.read"]) });
    await e.fetch("/v1/kitchen/me/timers", "POST");
    const h = e.forwarded[0]!.headers;
    expect([h.get("x-actor-subject-id"), h.get("x-actor-delegation-id"), h.get("x-actor-scopes")]).toEqual([
      USER,
      DLG,
      "timers.write,kitchen.read",
    ]);
  });

  it("are never sent for a session, even when the caller sends its own", async () => {
    const e = edge({ [SESSION_TOKEN]: sessionActor });
    await e.fetch("/v1/kitchen/me/items", "POST", {
      token: SESSION_TOKEN,
      headers: { "x-actor-delegation-id": DLG, "x-actor-scopes": ALL_SCOPES.join(",") },
    });
    const h = e.forwarded[0]!.headers;
    expect([h.get("x-actor-delegation-id"), h.get("x-actor-scopes")]).toEqual([null, null]);
  });
});

describe("resolveActor holds every delegated actor to its scopes", () => {
  it("whatever the token looks like and whichever facade asks", async () => {
    // A resolution carrying a delegation, for a token without the prefix.
    const e = edge({ opaque_token: delegatedActor(ALL_SCOPES) });
    expect(await status(e, "GET", `${O}/members`, "opaque_token")).toBe("403 scope");
    expect(await status(e, "POST", `${O}/kitchen/expenses`, "opaque_token")).toBe("403 scope");
    expect(await status(e, "GET", "/v1/kitchen/me/items", "opaque_token")).toBe("200");
    expect(e.forwarded.map((f) => f.binding)).toEqual(["KITCHEN_WORKER"]);
  });

  it("fails closed: a sps_dlg_ token identity answers without a delegation, or with a non-user actor", async () => {
    const plain = edge({ [delegatedToken()]: sessionActor });
    expect(await status(plain, "GET", "/v1/kitchen/me/items")).toBe("401");
    const sp = edge({
      [delegatedToken()]: { actor: { actorType: "service_principal", actorId: "sp_1", delegation: { id: DLG, scopes: ALL_SCOPES } } },
    });
    expect(await status(sp, "GET", "/v1/kitchen/me/items")).toBe("401");
    expect([...plain.forwarded, ...sp.forwarded]).toEqual([]);
  });

  it("drops scopes it does not know", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(["kitchen.write", "admin", "money.read"]) });
    expect(await status(e, "POST", "/v1/kitchen/me/items")).toBe("403 scope");
    expect(await status(e, "GET", "/v1/kitchen/me/balances")).toBe("200");
    expect(e.forwarded[0]!.headers.get("x-actor-scopes")).toBe("money.read");
  });
});

describe("a revoked token", () => {
  // The Workers Cache API, in memory, honoring max-age against a test clock.
  let clock = 0;
  const store = new Map<string, { body: string; expires: number }>();
  const fakeCaches = {
    default: {
      async match(key: string) {
        const hit = store.get(key);
        return hit && hit.expires > clock ? new Response(hit.body) : undefined;
      },
      async put(key: string, res: Response) {
        const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 0);
        store.set(key, { body: await res.text(), expires: clock + maxAge * 1000 });
      },
      async delete(key: string) {
        return store.delete(key);
      },
    },
  };
  beforeAll(() => Object.defineProperty(globalThis, "caches", { value: fakeCaches, configurable: true }));
  afterAll(() => delete (globalThis as { caches?: unknown }).caches);

  it("works from the cache for at most its 30 s, then is refused", async () => {
    const e = edge({ [delegatedToken(7)]: delegatedActor(ALL_SCOPES) });
    expect(await status(e, "GET", "/v1/kitchen/me/items", delegatedToken(7))).toBe("200");
    const resolved = e.resolves();

    // Disconnect: identity now refuses it.
    e.tokens.set(delegatedToken(7), { status: 401 });
    clock += (ACTOR_CACHE_TTL_SECONDS - 1) * 1000;
    expect(await status(e, "GET", "/v1/kitchen/me/items", delegatedToken(7))).toBe("200");
    expect(e.resolves()).toBe(resolved);
    // The cached actor still carries its scopes: no more than they allowed.
    expect(await status(e, "POST", "/v1/kitchen/me/items", delegatedToken(7))).toBe("403 scope");

    clock += 2000;
    expect(await status(e, "GET", "/v1/kitchen/me/items", delegatedToken(7))).toBe("401");
    expect(await status(e, "GET", "/v1/kitchen/me/items", delegatedToken(7))).toBe("401");
  });

  it("is refused by resolveActor directly once identity says so", async () => {
    const e = edge({ [delegatedToken(8)]: { status: 401 } });
    const request = new Request("https://edge.test/v1/kitchen/me/items", {
      headers: { authorization: `Bearer ${delegatedToken(8)}` },
    });
    const r = await resolveActor(request, e.env, "req_x");
    expect("error" in r && r.error.status).toBe(401);
  });
});
