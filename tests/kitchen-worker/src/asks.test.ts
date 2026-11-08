// Ask before use (PN-8, cookpool-pantry design §8): a group item's buyer
// turns on "Ask me first" and names who never needs to ask; anyone else is
// refused by the use, waste, dish and stock-check routes (`ask_first`) and
// asks instead; the buyer — or an owner or admin once the buyer has left —
// approves (posting the use exactly as the asker would have, `via: ask`),
// declines or reopens, the asker cancels, a pending ask lapses after 24 h or
// when its item is finished or stops asking first, Undo of an approval puts
// the ask back, Home's inbox carries the asks to answer, both sides hear a
// push, and a shopping run's Bought again copies the settings. Through the
// router, against real SQLite (every migration applied), the real policy
// grants, membership's answers, identity's names and a faked
// notifications-worker.

import type {
  AsksResponse,
  ApproveAskResponse,
  AskResponse,
  BalancesResponse,
  InboxResponse,
  KitchenAsk,
  KitchenItem,
  KitchenItemResponse,
  KitchenTxn,
  PurchaseResponse,
  ReachableItemsPage,
  StockMoveResponse,
  UsualsResponse,
} from "@saas/contracts/kitchen";
import { ASK_LAPSE_MS, KITCHEN_ASK_PUSH_KIND } from "@saas/contracts/kitchen";
import type { PushToSubjectRequest } from "@saas/contracts/notifications";
import type { OrganizationRole } from "@saas/contracts/policy";
import { authorize } from "@saas/policy-engine";
import { MANAGE_ROLES } from "@kitchen-worker/asks";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-08T08:00:00.000Z");
const MINUTE = 60_000;

const RAHUL = "usr_rahul"; // owner of Flat 4B
const ADMIN = "usr_admin";
const MEERA = "usr_meera"; // buys the saffron
const ANU = "usr_anu";
const DEV = "usr_dev";
const VIEWER = "usr_viewer";
const OUTSIDER = "usr_outsider";

/**
 * notifications-worker, faked: the push to a subject is recorded (or fails,
 * with `failPushes`); an email enqueue is answered as sent.
 */
function fakeNotifications() {
  const pushes: PushToSubjectRequest[] = [];
  const state = { failPushes: false };
  const binding = {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/v1/notifications/push-to-subject") {
        expect(new Headers(init?.headers).get("x-internal-actor")).toBe("kitchen-worker");
        pushes.push(JSON.parse(String(init?.body)) as PushToSubjectRequest);
        if (state.failPushes) return Response.json({ error: { code: "internal_error" } }, { status: 500 });
        return Response.json({ data: { devices: 1, sent: 1, gone: 0, failed: 0 }, meta: { requestId: "req_n", cursor: null } });
      }
      return Response.json(
        { data: { notification: { id: `ntf_${pushes.length}`, status: "sent" } }, meta: { requestId: "req_n", cursor: null } },
        { status: 201 },
      );
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { binding, pushes, state };
}

let h: Harness;
let clock: Date;
let flat: Group;
let lunch: Group;
let notifications: ReturnType<typeof fakeNotifications>;

beforeEach(() => {
  clock = NOW;
  notifications = fakeNotifications();
  h = createHarness({ deps: { now: () => clock }, env: { NOTIFICATIONS_WORKER: notifications.binding } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  h.grant(MEERA, flat, "builder");
  h.grant(RAHUL, flat, "owner");
  h.grant(ADMIN, flat, "admin");
  h.grant(DEV, flat, "builder");
  h.grant(ANU, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(MEERA, lunch, "owner");
  h.grant(DEV, lunch, "builder");
  h.grant(OUTSIDER, newGroup("Elsewhere"), "owner");
  for (const [id, name] of [[RAHUL, "Rahul"], [MEERA, "Meera"], [ANU, "Anu"], [DEV, "Dev"], [ADMIN, "Admin"]] as const) {
    h.profile(id, { displayName: name, email: `${name.toLowerCase()}@example.com` });
  }
});

afterEach(() => h.close());

function tick(ms = MINUTE): void {
  clock = new Date(clock.getTime() + ms);
}

let keys = 0;

async function call<T>(
  method: string,
  url: string,
  as: string | null,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Envelope<T> }> {
  // Every write gets a fresh key unless the test names one.
  const key = method === "GET" ? {} : { "idempotency-key": `key-${++keys}` };
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}), headers: { ...key, ...(headers ?? {}) } });
  return { status: res.status, body: await envelope<T>(res) };
}

const me = (rest: string) => `/v1/kitchen/me/${rest}`;
const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

// 2 g of saffron for ₹240: a pinch (0.1 g) costs ₹12.
const saffron = { name: "Saffron", category: "Spices", quantity: "2", unit: "g", priceMinor: 24000 };
const pinch = { one: "pinch", many: "pinches", count: 1, amountMilli: 100 };

async function groupItem(as: string, g: Group, body: Record<string, unknown> = saffron): Promise<KitchenItem> {
  tick();
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

const patch = (as: string, g: Group, item: KitchenItem, body: unknown) =>
  call<KitchenItemResponse>("PATCH", groupPath(g, `items/${item.id}`), as, body);

/** Meera's saffron, counted in pinches, asking first. */
async function guarded(allowed: string[] = [], g: Group = flat): Promise<KitchenItem> {
  const item = await groupItem(MEERA, g);
  expect((await call("PUT", groupPath(g, `items/${item.id}/measures`), MEERA, { measures: [pinch] })).status).toBe(200);
  const res = await patch(MEERA, g, item, { askFirst: true, allowed });
  expect(res.status).toBe(200);
  return res.body.data.item;
}

async function readItem(as: string, g: Group, item: KitchenItem): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("GET", groupPath(g, `items/${item.id}`), as);
  expect(res.status).toBe(200);
  return res.body.data.item;
}

type Moved = { status: number; body: Envelope<StockMoveResponse> };
const use = (as: string, g: Group, item: KitchenItem, body: unknown): Promise<Moved> => {
  tick();
  return call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/uses`), as, body);
};
const waste = (as: string, g: Group, item: KitchenItem, body?: unknown): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/waste`), as, body ?? {});
const check = (as: string, g: Group, item: KitchenItem, body: unknown): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/check`), as, body);
const reverse = (as: string, g: Group, txnId: string) => call<{ txn: KitchenTxn }>("POST", groupPath(g, `txns/${txnId}/reverse`), as);
const undoMove = (as: string, g: Group, moveId: string): Promise<Moved> => call<StockMoveResponse>("POST", groupPath(g, `moves/${moveId}/undo`), as);

const ask = (as: string, g: Group, item: KitchenItem, body: unknown, headers?: Record<string, string>) => {
  tick();
  return call<AskResponse>("POST", groupPath(g, `items/${item.id}/asks`), as, body, headers);
};
const approve = (as: string, g: Group, askId: string, body?: unknown, headers?: Record<string, string>) => {
  tick();
  return call<ApproveAskResponse>("POST", groupPath(g, `asks/${askId}/approve`), as, body, headers);
};
const answer = (verb: "decline" | "reopen" | "cancel", as: string, g: Group, askId: string, headers?: Record<string, string>) => {
  tick();
  return call<AskResponse>("POST", groupPath(g, `asks/${askId}/${verb}`), as, undefined, headers);
};

/** Dev asks for a pinch for himself and Anu. */
async function devAsks(item: KitchenItem, g: Group = flat, body: Record<string, unknown> = {}): Promise<KitchenAsk> {
  const res = await ask(DEV, g, item, { quantity: 1, measure: "pinch", consumers: [DEV, ANU], ...body });
  expect(res.status).toBe(201);
  return res.body.data.ask;
}

async function asks(as: string): Promise<AsksResponse> {
  const res = await call<AsksResponse>("GET", me("asks"), as);
  expect(res.status).toBe(200);
  return res.body.data;
}

/** Every non-zero balance in the group (they always add up to zero). */
async function balances(g: Group, as = RAHUL): Promise<Record<string, number>> {
  const res = await call<BalancesResponse>("GET", groupPath(g, "balances"), as);
  expect(res.status).toBe(200);
  const all = res.body.data.balances;
  expect(all.reduce((a, b) => a + b.balanceMinor, 0)).toBe(0);
  return Object.fromEntries(all.filter((b) => b.balanceMinor !== 0).map((b) => [b.subjectId, b.balanceMinor]));
}

function expectRefused(res: { status: number; body: Envelope<unknown> }, status: number, reason: string): void {
  expect(res.status).toBe(status);
  expect(res.body.error.details.reason).toBe(reason);
}

const pushesTo = (who: string) => notifications.pushes.filter((p) => p.subjectId === who);

// ── The setting ────────────────────────────────────────────

describe("who sets Ask me first and who may use it (§8.1)", () => {
  it("is the buyer's: every group item says whether it asks, and an ask-first one says who may use it, who must ask and who answers", async () => {
    const plain = await groupItem(MEERA, flat);
    expect(plain.askFirst).toBe(false);
    expect(plain).not.toHaveProperty("mustAsk");

    const item = await guarded([ANU]);
    expect(item).toMatchObject({ askFirst: true, allowed: [ANU], mustAsk: false, answerer: MEERA });
    expect(await readItem(DEV, flat, item)).toMatchObject({ askFirst: true, allowed: [ANU], mustAsk: true, answerer: MEERA });
    expect(await readItem(ANU, flat, item)).toMatchObject({ mustAsk: false });
    // An owner or admin asks too while the buyer is in the group.
    expect(await readItem(RAHUL, flat, item)).toMatchObject({ mustAsk: true });

    // Every pantry the caller reads says the same.
    const all = await call<ReachableItemsPage>("GET", me("items"), DEV);
    expect(all.body.data.items.find((i) => i.id === item.id)).toMatchObject({ askFirst: true, mustAsk: true, answerer: MEERA });
    const listed = await call<{ items: KitchenItem[] }>("GET", groupPath(flat, "items"), ANU);
    expect(listed.body.data.items.find((i) => i.id === item.id)).toMatchObject({ mustAsk: false, allowed: [ANU] });

    // Replacing the list, and turning it off (the list is kept for next time).
    expect((await patch(MEERA, flat, item, { allowed: [ANU, DEV] })).body.data.item).toMatchObject({ allowed: [ANU, DEV] });
    const off = await patch(MEERA, flat, item, { askFirst: false });
    expect(off.body.data.item.askFirst).toBe(false);
    expect(off.body.data.item).not.toHaveProperty("allowed");
    expect((await patch(MEERA, flat, item, { askFirst: true })).body.data.item).toMatchObject({ allowed: [ANU, DEV] });
  });

  it("is refused to anyone else while the buyer is in the group — owners and admins included — and to an outsider in the list", async () => {
    const item = await groupItem(MEERA, flat);
    expectRefused(await patch(RAHUL, flat, item, { askFirst: true }), 403, "not_buyer");
    expectRefused(await patch(ADMIN, flat, item, { allowed: [DEV] }), 403, "not_buyer");
    expectRefused(await patch(DEV, flat, item, { askFirst: true }), 403, "not_buyer");
    // An owner may still edit the rest of it, as before; not with the setting in the same edit.
    expect((await patch(RAHUL, flat, item, { note: "Top shelf" })).status).toBe(200);
    expectRefused(await patch(RAHUL, flat, item, { note: "x", askFirst: true }), 403, "not_buyer");
    expect((await readItem(MEERA, flat, item)).askFirst).toBe(false);

    const outsider = await patch(MEERA, flat, item, { askFirst: true, allowed: [OUTSIDER] });
    expectRefused(outsider, 422, "not_in_group");
    expect(outsider.body.error.details.subjectIds).toEqual([OUTSIDER]);
    expect((await patch(MEERA, flat, item, { askFirst: "yes" })).body.error.details.fields).toHaveProperty(["askFirst"]);
    expect((await patch(MEERA, flat, item, { allowed: "everyone" })).body.error.details.fields).toHaveProperty(["allowed"]);
  });

  it("passes to the owners and admins once the buyer has left", async () => {
    const item = await guarded();
    h.revoke(MEERA, flat);
    expect(await readItem(RAHUL, flat, item)).toMatchObject({ answerer: null, mustAsk: false });
    expect(await readItem(DEV, flat, item)).toMatchObject({ answerer: null, mustAsk: true });
    expectRefused(await patch(DEV, flat, item, { askFirst: false }), 403, "not_buyer");
    expect((await patch(ADMIN, flat, item, { allowed: [DEV] })).body.data.item).toMatchObject({ allowed: [DEV] });
    expect((await patch(RAHUL, flat, item, { askFirst: false })).body.data.item.askFirst).toBe(false);
  });

  it("is set on Add item for an item the caller pays for, and never on a personal item", async () => {
    const added = await call<KitchenItemResponse>("POST", groupPath(flat, "items"), MEERA, { ...saffron, askFirst: true, allowed: [ANU] });
    expect(added.status).toBe(201);
    expect(added.body.data.item).toMatchObject({ askFirst: true, allowed: [ANU], answerer: MEERA, mustAsk: false });
    const forSomeoneElse = await call("POST", groupPath(flat, "items"), MEERA, { ...saffron, paidBy: DEV, askFirst: true });
    expect(forSomeoneElse.status).toBe(422);
    expect(forSomeoneElse.body.error.details.fields).toHaveProperty(["askFirst"]);

    const mine = await call<KitchenItemResponse>("POST", me("items"), MEERA, saffron);
    expect(mine.body.data.item).not.toHaveProperty("askFirst");
    const refused = await call("PATCH", me(`items/${mine.body.data.item.id}`), MEERA, { askFirst: true });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.fields).toHaveProperty(["askFirst"]);
    expect((await call("POST", me("items"), MEERA, { ...saffron, allowed: [] })).body.error.details.fields).toHaveProperty(["allowed"]);
  });

  it("MANAGE_ROLES are the roles the policy engine grants kitchen.item.manage", () => {
    const roles: OrganizationRole[] = ["owner", "admin", "builder", "viewer", "billing_admin"];
    for (const role of roles) {
      const decision = authorize({
        subject: { type: "user", id: "usr_x" },
        action: "kitchen.item.manage",
        resource: { kind: "organization", orgId: "org" },
        context: { memberships: [{ kind: "role_assignment", role, scope: { kind: "organization", orgId: "org" } }] },
      });
      expect([role, decision.allow]).toEqual([role, MANAGE_ROLES.has(role)]);
    }
  });
});

// ── Who must ask ───────────────────────────────────────────

describe("who must ask is refused the direct paths (§8.2)", () => {
  it("refuses Dev's use, waste and dish with ask_first, naming the answerer, and writes nothing", async () => {
    const item = await guarded([ANU]);
    for (const res of [
      await use(DEV, flat, item, { quantity: 1, measure: "pinch" }),
      await use(DEV, flat, item, { quantity: "0.1", unit: "g", consumers: [ANU] }),
      await waste(DEV, flat, item),
      await waste(DEV, flat, item, { quantity: "0.5", unit: "g" }),
      await call("POST", me("dishes"), DEV, { name: "Kesar milk", portionsHalf: 2, splitMode: "assign", ingredients: [{ itemId: item.id, quantity: "0.1", unit: "g" }] }),
    ]) {
      expectRefused(res, 403, "ask_first");
      expect(res.body.error.details).toMatchObject({ itemId: item.id, answerer: MEERA });
    }
    expect(await readItem(MEERA, flat, item)).toMatchObject({ qtyLeftMilli: 2000, version: item.version });
    expect(await balances(flat)).toEqual({});

    // The buyer and the people allowed use it directly.
    expect((await use(MEERA, flat, item, { quantity: 1, measure: "pinch" })).status).toBe(201);
    expect((await use(ANU, flat, item, { quantity: 1, measure: "pinch", consumers: [ANU, DEV] })).status).toBe(201);
    const dish = await call("POST", me("dishes"), ANU, { name: "Kesar milk", portionsHalf: 2, splitMode: "assign", ingredients: [{ itemId: item.id, quantity: "0.1", unit: "g" }] });
    expect(dish.status).toBe(201);
    // An owner asks too while the buyer is in the group.
    expectRefused(await use(RAHUL, flat, item, { quantity: "0.1", unit: "g" }), 403, "ask_first");
  });

  it("refuses the stock check's me and split to whoever must ask; owners, admins and the buyer may always check", async () => {
    const item = await guarded();
    expectRefused(await check(DEV, flat, item, { left: { quantity: "1.5", unit: "g" }, gone: "me" }), 403, "ask_first");
    expectRefused(await check(DEV, flat, item, { left: { quantity: "1.5", unit: "g" }, gone: "split" }), 403, "ask_first");
    expect(await balances(flat)).toEqual({});
    const split = await check(RAHUL, flat, item, { left: { quantity: "1.5", unit: "g" }, gone: "split" });
    expect(split.status).toBe(201);
    expect(split.body.data.move).toMatchObject({ via: "check", qtyMilli: 500 });
    expect((await check(MEERA, flat, item, { left: { quantity: "1.4", unit: "g" }, gone: "me" })).status).toBe(201);
    // Raising the level moves no money, and stays open to anyone who may use it.
    expect((await check(DEV, flat, item, { left: { quantity: "1.6", unit: "g" } })).status).toBe(201);
  });

  it("answers no_need to someone who needn't ask, and the opaque 404 to a viewer or outsider", async () => {
    const item = await guarded([ANU]);
    const plain = await groupItem(MEERA, flat);
    for (const [who, what] of [[MEERA, item], [ANU, item], [DEV, plain]] as const) {
      expectRefused(await ask(who, flat, what, { quantity: "0.1", unit: "g" }), 409, "no_need");
    }
    expect((await ask(VIEWER, flat, item, { quantity: "0.1", unit: "g" })).status).toBe(404);
    expect((await ask(OUTSIDER, flat, item, { quantity: "0.1", unit: "g" })).status).toBe(404);
    // Once the buyer has left, owners and admins answer, so they needn't ask either.
    h.revoke(MEERA, flat);
    expectRefused(await ask(RAHUL, flat, item, { quantity: "0.1", unit: "g" }), 409, "no_need");
    expect((await use(ADMIN, flat, item, { quantity: "0.1", unit: "g" })).status).toBe(201);
    expectRefused(await use(DEV, flat, item, { quantity: "0.1", unit: "g" }), 403, "ask_first");
  });

  it("checks an ask as it checks a use: the amount, the unit, the measure and who it is for", async () => {
    const item = await guarded();
    expectRefused(await ask(DEV, flat, item, { quantity: "3", unit: "g" }), 409, "insufficient_stock");
    expect((await ask(DEV, flat, item, { quantity: "1", unit: "L" })).body.error.details.fields).toHaveProperty(["unit"]);
    expect((await ask(DEV, flat, item, { quantity: 1, measure: "spoon" })).body.error.details.fields).toHaveProperty(["measure"]);
    expectRefused(await ask(DEV, flat, item, { quantity: "0.1", unit: "g", consumers: [DEV, OUTSIDER] }), 422, "not_in_group");
    expect((await ask(DEV, flat, item, { quantity: "0.1", unit: "g", source: "fridge" })).body.error.details.fields).toHaveProperty(["source"]);
    expect((await ask(DEV, flat, item, { quantity: "0.1", unit: "g", weights: [1, 2] })).status).toBe(422);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_asks").get()).toEqual({ n: 0 });
  });
});

// ── Asking and approving ───────────────────────────────────

describe("asking, and approving (§8.2, §8.3)", () => {
  it("asks without moving anything, pushes the buyer, and lists it for both sides and on the buyer's Home", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    expect(asked).toMatchObject({
      orgId: flat.publicId,
      item: { id: item.id, ref: `org:${flat.publicId}:${item.id}`, name: "Saffron", qtyLeftMilli: 2000, state: "active" },
      asker: DEV,
      askerName: "Dev",
      qtyMilli: 100,
      label: "1 pinch",
      amount: "1 pinch",
      consumers: [DEV, ANU],
      consumerNames: ["Dev", "Anu"],
      weights: null,
      source: "pantry",
      state: "pending",
      createdAt: clock.toISOString(),
      expiresAt: new Date(clock.getTime() + ASK_LAPSE_MS).toISOString(),
      answeredAt: null,
      answeredBy: null,
      answerer: MEERA,
      answererName: "Meera",
      paidBy: MEERA,
      costMinor: 1200,
      backMinor: 1200,
      currency: "INR",
      enough: true,
      moveId: null,
      txnId: null,
    });
    expect(asked.id).toMatch(/^ask_[0-9a-f]{32}$/);
    expect(await readItem(MEERA, flat, item)).toMatchObject({ qtyLeftMilli: 2000, version: item.version });
    expect(await balances(flat)).toEqual({});

    expect(notifications.pushes).toEqual([
      {
        subjectId: MEERA,
        message: {
          kind: KITCHEN_ASK_PUSH_KIND,
          title: "Dev asks for 1 pinch of your saffron",
          body: "For Dev and Anu · ₹12 to you",
          url: `/home?ask=${asked.id}`,
          tag: asked.id,
        },
      },
    ]);
    expect(await asks(MEERA)).toEqual({ toAnswer: [asked], mine: [] });
    expect(await asks(DEV)).toEqual({ toAnswer: [], mine: [asked] });
    expect(await asks(ANU)).toEqual({ toAnswer: [], mine: [] });
    const home = await call<InboxResponse>("GET", me("inbox"), MEERA);
    expect(home.body.data.asks).toEqual([{ kind: "ask", ask: asked }]);
    expect((await call<InboxResponse>("GET", me("inbox"), DEV)).body.data.asks).toEqual([]);
  });

  it("approves only by the answerer, posting the use exactly as Dev would have, at that moment's price, with Dev as its logger", async () => {
    const item = await guarded();
    const twin = await groupItem(MEERA, flat);
    expect((await call("PUT", groupPath(flat, `items/${twin.id}/measures`), MEERA, { measures: [pinch] })).status).toBe(200);
    const asked = await devAsks(item);
    expectRefused(await approve(DEV, flat, asked.id), 403, "not_buyer");
    expectRefused(await approve(RAHUL, flat, asked.id), 403, "not_buyer");
    expect((await approve(VIEWER, flat, asked.id)).status).toBe(403);
    expect((await approve(OUTSIDER, flat, asked.id)).status).toBe(404);
    expect((await approve(MEERA, lunch, asked.id)).status).toBe(404);

    const approved = await approve(MEERA, flat, asked.id, {}, { "idempotency-key": "approve-1" });
    expect(approved.status).toBe(201);
    const { move, txn, ask: after } = approved.body.data;
    expect(move).toMatchObject({ kind: "use", qtyMilli: 100, costMinor: 1200, label: "1 pinch", actor: DEV, consumers: [DEV, ANU], via: "ask" });
    expect(txn).toMatchObject({ kind: "use", title: "Saffron (1 pinch)", totalMinor: 1200, createdBy: DEV });
    expect(after).toMatchObject({ state: "approved", answeredBy: MEERA, moveId: move.id, txnId: txn!.id, costMinor: 1200, backMinor: 1200 });
    expect(approved.body.data.item).toMatchObject({ qtyLeftMilli: 1900, worthMinor: 22800, askFirst: true, mustAsk: false });
    expect(await balances(flat)).toEqual({ [MEERA]: 1200, [DEV]: -600, [ANU]: -600 });

    // The same use, logged directly on a twin no one guards, writes the same money.
    const direct = await use(DEV, flat, twin, { quantity: 1, measure: "pinch", consumers: [DEV, ANU] });
    expect(direct.body.data.txn!.splits).toEqual(txn!.splits);
    expect(direct.body.data.move).toMatchObject({ qtyMilli: move.qtyMilli, costMinor: move.costMinor, label: move.label });
    expect(direct.body.data.move).not.toHaveProperty("via");

    // Dev hears yes; the event says who approved it.
    expect(pushesTo(DEV).map((p) => p.message)).toEqual([
      { kind: KITCHEN_ASK_PUSH_KIND, title: "Meera said yes · 1 pinch of saffron logged", body: "Flat 4B", url: `/pantry/org:${flat.publicId}:${item.id}`, tag: asked.id },
    ]);
    const event = h.db.prepare("SELECT actor_id, payload FROM events_event_log WHERE type = 'kitchen.item.used' AND payload LIKE ?").get(`%${asked.id}%`) as
      | { actor_id: string; payload: string }
      | undefined;
    expect(event?.actor_id).toBe(MEERA);
    expect(JSON.parse(event!.payload)).toMatchObject({ askId: asked.id, askedBy: DEV, approvedBy: MEERA, via: "ask", consumers: [DEV, ANU] });

    // The same key again answers the same; another approval is refused.
    const pushed = notifications.pushes.length;
    const again = await approve(MEERA, flat, asked.id, {}, { "idempotency-key": "approve-1" });
    expect(again.status).toBe(201);
    expect(again.body.data.move.id).toBe(move.id);
    expect(notifications.pushes.length).toBe(pushed);
    const twice = await approve(MEERA, flat, asked.id);
    expectRefused(twice, 409, "not_pending");
    expect(twice.body.error.details.state).toBe("approved");
    expect(await balances(flat)).toEqual({ [MEERA]: 2400, [DEV]: -1200, [ANU]: -1200 });
  });

  it("with Always let, adds Dev to the allowed list in the same write, so his next pinch logs directly", async () => {
    const item = await guarded([ANU]);
    const asked = await devAsks(item);
    const approved = await approve(MEERA, flat, asked.id, { alwaysAllow: true });
    expect(approved.status).toBe(201);
    expect(approved.body.data.item).toMatchObject({ allowed: [ANU, DEV] });
    expect(await readItem(DEV, flat, item)).toMatchObject({ mustAsk: false, allowed: [ANU, DEV] });
    expect((await use(DEV, flat, item, { quantity: 1, measure: "pinch" })).status).toBe(201);
    expectRefused(await ask(DEV, flat, item, { quantity: 1, measure: "pinch" }), 409, "no_need");
    expect((await approve(MEERA, flat, asked.id, { alwaysAllow: "yes" })).status).toBe(422);
  });

  it("offers what is left when less is left than was asked, and approves it with takeWhatsLeft", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    expect((await use(MEERA, flat, item, { quantity: "1.96", unit: "g" })).status).toBe(201);
    expect((await asks(MEERA)).toAnswer[0]).toMatchObject({ enough: false, item: { qtyLeftMilli: 40 }, costMinor: 480 });

    const short = await approve(MEERA, flat, asked.id);
    expectRefused(short, 409, "insufficient_stock");
    expect(short.body.error.details.qtyLeftMilli).toBe(40);
    const rest = await approve(MEERA, flat, asked.id, { takeWhatsLeft: true });
    expect(rest.status).toBe(201);
    // The last of it costs exactly what is left of the price.
    expect(rest.body.data.move).toMatchObject({ qtyMilli: 40, costMinor: 480, label: null, via: "ask", actor: DEV });
    expect(rest.body.data.item).toMatchObject({ qtyLeftMilli: 0, state: "used_up", worthMinor: 0 });
    expect(rest.body.data.ask).toMatchObject({ state: "approved", qtyMilli: 100, costMinor: 480 });
    expect(pushesTo(DEV).at(-1)!.message.title).toBe("Meera said yes · 0.04 g of saffron logged");
  });

  it("asks an owner or admin once the buyer has left, and pays the buyer back all the same", async () => {
    const item = await guarded();
    h.revoke(MEERA, flat);
    const asked = await devAsks(item);
    expect(asked).toMatchObject({ answerer: null, backMinor: 1200 });
    expect(notifications.pushes.map((p) => [p.subjectId, p.message.title, p.message.body])).toEqual([
      [RAHUL, "Dev asks for 1 pinch of the saffron", "For Dev and Anu · ₹12 to Meera"],
      [ADMIN, "Dev asks for 1 pinch of the saffron", "For Dev and Anu · ₹12 to Meera"],
    ]);
    expect((await asks(RAHUL)).toAnswer.map((a) => a.id)).toEqual([asked.id]);
    expect((await asks(ANU)).toAnswer).toEqual([]);
    expectRefused(await approve(ANU, flat, asked.id), 403, "not_buyer");
    expect((await approve(ADMIN, flat, asked.id)).status).toBe(201);
    expect(await balances(flat)).toEqual({ [MEERA]: 1200, [DEV]: -600, [ANU]: -600 });
  });

  it("refuses an approval when someone it is for has left the group", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    h.revoke(ANU, flat);
    expectRefused(await approve(MEERA, flat, asked.id), 422, "not_in_group");
    expect(await balances(flat)).toEqual({});
  });
});

// ── Undo ───────────────────────────────────────────────────

describe("undoing an approval (§8.3)", () => {
  it("reverses the use by the answerer, puts the ask back to pending and takes back Always let", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    const approved = await approve(MEERA, flat, asked.id, { alwaysAllow: true });
    const txnId = approved.body.data.txn!.id;
    // The use is Dev's, but Meera approved it: she may reverse it; Anu may not.
    expectRefused(await reverse(ANU, flat, txnId), 403, "not_creator");
    expect((await reverse(MEERA, flat, txnId)).status).toBe(201);

    expect(await balances(flat)).toEqual({});
    expect(await readItem(DEV, flat, item)).toMatchObject({ qtyLeftMilli: 2000, mustAsk: true, allowed: [] });
    expect((await asks(MEERA)).toAnswer).toEqual([
      expect.objectContaining({ id: asked.id, state: "pending", answeredBy: null, moveId: null, txnId: null }),
    ]);
    // And it can be answered again.
    const again = await approve(MEERA, flat, asked.id);
    expect(again.status).toBe(201);
    expect(await balances(flat)).toEqual({ [MEERA]: 1200, [DEV]: -600, [ANU]: -600 });
  });

  it("cancels the ask when the asker undoes it himself", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    const approved = await approve(MEERA, flat, asked.id);
    expect((await reverse(DEV, flat, approved.body.data.txn!.id)).status).toBe(201);
    expect((await asks(DEV)).mine[0]).toMatchObject({ id: asked.id, state: "canceled", answeredBy: DEV });
    expect((await asks(MEERA)).toAnswer).toEqual([]);
    expect(await balances(flat)).toEqual({});
  });

  it("undoes a use that moved no money (it was for the buyer) with the move's undo, by the answerer", async () => {
    const item = await guarded();
    const asked = await devAsks(item, flat, { consumers: [MEERA] });
    expect(asked.backMinor).toBe(0);
    expect(notifications.pushes[0]!.message.body).toBe("For you");
    const approved = await approve(MEERA, flat, asked.id);
    expect(approved.body.data.txn).toBeNull();
    expect(approved.body.data.move.actor).toBe(DEV);
    expect((await undoMove(ANU, flat, approved.body.data.move.id)).status).toBe(403);
    expect((await undoMove(MEERA, flat, approved.body.data.move.id)).status).toBe(201);
    expect(await readItem(MEERA, flat, item)).toMatchObject({ qtyLeftMilli: 2000 });
    expect((await asks(MEERA)).toAnswer.map((a) => a.state)).toEqual(["pending"]);
  });
});

// ── Decline, reopen, cancel ────────────────────────────────

describe("declining, reopening and cancelling (§8.3)", () => {
  it("declines with a push to the asker; reopening is the answerer's Undo, inside the 24 hours", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    expectRefused(await answer("decline", DEV, flat, asked.id), 403, "not_buyer");
    const declined = await answer("decline", MEERA, flat, asked.id, { "idempotency-key": "no-1" });
    expect(declined.status).toBe(200);
    expect(declined.body.data.ask).toMatchObject({ state: "declined", answeredBy: MEERA, answeredAt: clock.toISOString() });
    expect(pushesTo(DEV).map((p) => p.message.title)).toEqual(["Meera said no to the saffron"]);
    expect((await asks(DEV)).mine[0]).toMatchObject({ state: "declined" });
    expect((await asks(MEERA)).toAnswer).toEqual([]);
    // The same answer again answers the same, and pushes nothing more.
    expect((await answer("decline", MEERA, flat, asked.id, { "idempotency-key": "no-1" })).body.data.ask.state).toBe("declined");
    expect(pushesTo(DEV)).toHaveLength(1);
    expectRefused(await approve(MEERA, flat, asked.id), 409, "not_pending");
    expectRefused(await answer("cancel", DEV, flat, asked.id), 409, "not_pending");

    const reopened = await answer("reopen", MEERA, flat, asked.id);
    expect(reopened.body.data.ask).toMatchObject({ state: "pending", answeredBy: null, answeredAt: null });
    expect((await asks(MEERA)).toAnswer.map((a) => a.id)).toEqual([asked.id]);
    expect((await answer("decline", MEERA, flat, asked.id)).status).toBe(200);
    tick(ASK_LAPSE_MS);
    expectRefused(await answer("reopen", MEERA, flat, asked.id), 409, "lapsed");
  });

  it("is cancelled by its asker alone, and a cancelled ask is answered by nobody", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    expectRefused(await answer("cancel", ANU, flat, asked.id), 403, "not_creator");
    expectRefused(await answer("cancel", MEERA, flat, asked.id), 403, "not_creator");
    const canceled = await answer("cancel", DEV, flat, asked.id);
    expect(canceled.body.data.ask).toMatchObject({ state: "canceled", answeredBy: DEV });
    expect((await answer("cancel", DEV, flat, asked.id)).status).toBe(200);
    expectRefused(await approve(MEERA, flat, asked.id), 409, "not_pending");
    expectRefused(await answer("decline", MEERA, flat, asked.id), 409, "not_pending");
    expectRefused(await answer("reopen", MEERA, flat, asked.id), 409, "not_pending");
    expect((await asks(MEERA)).toAnswer).toEqual([]);
    expect(pushesTo(DEV)).toEqual([]);
  });

  it("answers an ask in another group, or a malformed id, with the opaque 404", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    expect((await answer("decline", MEERA, lunch, asked.id)).status).toBe(404);
    expect((await answer("cancel", DEV, flat, "ask_nope")).status).toBe(404);
    expect((await answer("cancel", DEV, flat, item.id)).status).toBe(404);
    expect((await call("GET", groupPath(flat, `asks/${asked.id}/approve`), MEERA)).status).toBe(405);
    expect((await call("GET", me("asks"), null)).status).toBe(401);
  });
});

// ── Lapsing ────────────────────────────────────────────────

describe("an ask lapses (§8.3, read-side)", () => {
  it("24 hours after it was made: it reads lapsed, leaves the answerer's list and can't be approved", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    tick(ASK_LAPSE_MS - MINUTE * 2);
    expect((await asks(MEERA)).toAnswer).toHaveLength(1);
    tick(MINUTE * 2);
    expect((await asks(MEERA)).toAnswer).toEqual([]);
    expect((await call<InboxResponse>("GET", me("inbox"), MEERA)).body.data.asks).toEqual([]);
    expect((await asks(DEV)).mine[0]).toMatchObject({ id: asked.id, state: "lapsed" });
    expectRefused(await approve(MEERA, flat, asked.id), 409, "lapsed");
    expectRefused(await answer("decline", MEERA, flat, asked.id), 409, "lapsed");
    expectRefused(await answer("cancel", DEV, flat, asked.id), 409, "lapsed");
    expect(await balances(flat)).toEqual({});
    // Gone from Dev's own list a day after that.
    tick(24 * 60 * MINUTE);
    expect((await asks(DEV)).mine).toEqual([]);
  });

  it("when the item is finished, and when it stops asking first", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    expect((await waste(MEERA, flat, item)).status).toBe(201);
    expect((await asks(DEV)).mine[0]).toMatchObject({ state: "lapsed", enough: false });
    expectRefused(await approve(MEERA, flat, asked.id), 409, "lapsed");

    const other = await guarded();
    const second = await devAsks(other);
    expect((await patch(MEERA, flat, other, { askFirst: false })).status).toBe(200);
    expect((await asks(DEV)).mine.find((a) => a.id === second.id)).toMatchObject({ state: "lapsed" });
    expectRefused(await approve(MEERA, flat, second.id), 409, "lapsed");
    // Turned back on, a pending ask still inside its 24 hours can be answered again.
    expect((await patch(MEERA, flat, other, { askFirst: true })).status).toBe(200);
    expect((await approve(MEERA, flat, second.id)).status).toBe(201);
  });
});

// ── Retries, races and pushes ──────────────────────────────

describe("retries, races and pushes", () => {
  it("answers a retried ask with the ask it made, pushing once; a key someone else used is refused", async () => {
    const item = await guarded();
    const first = await ask(DEV, flat, item, { quantity: 1, measure: "pinch", source: "cook" }, { "idempotency-key": "ask-1" });
    const again = await ask(DEV, flat, item, { quantity: 1, measure: "pinch", source: "cook" }, { "idempotency-key": "ask-1" });
    expect(first.status).toBe(201);
    expect(again.body.data.ask).toEqual(first.body.data.ask);
    expect(first.body.data.ask.source).toBe("cook");
    expect(notifications.pushes).toHaveLength(1);
    h.grant(RAHUL, flat, "builder");
    expectRefused(await ask(RAHUL, flat, item, { quantity: "0.1", unit: "g" }, { "idempotency-key": "ask-1" }), 409, "idempotency_key_reused");
  });

  it("plans the approval again when the item moved on in between, from the stock as it is then", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    // Meera uses half of it just before the approval writes: a use's update moves the item's version.
    h.beforeNextBatch((db) => {
      db.prepare("UPDATE kitchen_items SET qty_left_milli = 1000, cost_taken_minor = 12000, version = version + 1 WHERE id = ?").run(
        item.id.replace(/^itm_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"),
      );
    });
    const approved = await approve(MEERA, flat, asked.id);
    expect(approved.status).toBe(201);
    expect(approved.body.data.item).toMatchObject({ qtyLeftMilli: 900 });
    expect(approved.body.data.move.costMinor).toBe(1200);
  });

  it("never fails a write when a push fails", async () => {
    notifications.state.failPushes = true;
    const item = await guarded();
    const asked = await devAsks(item);
    expect(notifications.pushes).toHaveLength(1);
    expect((await approve(MEERA, flat, asked.id)).status).toBe(201);
    const second = await devAsks(item);
    expect((await answer("decline", MEERA, flat, second.id)).status).toBe(200);
    expect(notifications.pushes.map((p) => p.subjectId)).toEqual([MEERA, DEV, MEERA, DEV]);
  });

  it("asks and answers without notifications-worker at all", async () => {
    h.close();
    h = createHarness({ deps: { now: () => clock }, env: { NOTIFICATIONS_WORKER: undefined } });
    h.grant(MEERA, flat, "builder");
    h.grant(DEV, flat, "builder");
    h.grant(ANU, flat, "builder");
    const item = await guarded();
    const asked = await devAsks(item);
    expect((await approve(MEERA, flat, asked.id)).status).toBe(201);
  });
});

// ── Bought again ───────────────────────────────────────────

describe("a shopping run's Bought again copies the settings (§8.1)", () => {
  it("copies Ask me first and who may use it into the same group, never into another", async () => {
    const item = await guarded([ANU]);
    const plainOther = await groupItem(MEERA, lunch);
    const line = { name: "Saffron", category: "Spices", quantity: "2", unit: "g", priceMinor: 25000 };
    const res = await call<PurchaseResponse>("POST", me("purchases"), MEERA, {
      lines: [
        { ...line, pantry: flat.publicId, fromItemId: item.id },
        { ...line, pantry: lunch.publicId, fromItemId: item.id },
        { ...line, pantry: lunch.publicId, fromItemId: plainOther.id },
        // A line's own askFirst is not read: settings come from the item it buys again.
        { ...line, pantry: flat.publicId, askFirst: true },
      ],
    });
    expect(res.status).toBe(201);
    const [again, elsewhere, plain, own] = res.body.data.items;
    expect(again).toMatchObject({ askFirst: true, allowed: [ANU], answerer: MEERA, mustAsk: false });
    expect(elsewhere!.askFirst).toBe(false);
    expect(plain!.askFirst).toBe(false);
    expect(own!.askFirst).toBe(false);
    expect(await readItem(DEV, flat, again!)).toMatchObject({ mustAsk: true });
    expectRefused(await use(DEV, flat, again!, { quantity: "0.1", unit: "g" }), 403, "ask_first");
    expect((await use(ANU, flat, again!, { quantity: "0.1", unit: "g" })).status).toBe(201);
  });

  it("makes whoever buys it again the one asked", async () => {
    const item = await guarded([ANU]);
    const res = await call<PurchaseResponse>("POST", me("purchases"), DEV, {
      lines: [{ name: "Saffron", category: "Spices", quantity: "1", unit: "g", priceMinor: 12000, pantry: flat.publicId, fromItemId: item.id }],
    });
    expect(res.body.data.items[0]).toMatchObject({ paidBy: DEV, askFirst: true, allowed: [ANU], answerer: DEV, mustAsk: false });
    expect(await readItem(MEERA, flat, res.body.data.items[0]!)).toMatchObject({ mustAsk: true });
  });
});

// ── Usuals ─────────────────────────────────────────────────

describe("an approved ask's use is a real use", () => {
  it("counts as Dev's usual, and Anu's who had it too", async () => {
    const item = await guarded();
    const asked = await devAsks(item);
    expect((await approve(MEERA, flat, asked.id)).status).toBe(201);
    for (const who of [DEV, ANU]) {
      const res = await call<UsualsResponse>("GET", me("usuals"), who);
      expect(res.body.data.usuals.find((u) => u.itemId === item.id)).toMatchObject({ lastQtyMilli: 100, lastLabel: "1 pinch" });
    }
  });
});
