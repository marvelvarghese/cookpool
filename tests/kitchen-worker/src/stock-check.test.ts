// The stock check (PN-4, cookpool-pantry design §7): POST …/items/{itm}/check
// for group and personal items — less becomes a use by the caller, a use
// split across the group's current members, or waste under the item's rule,
// written by the same planners as …/uses and …/waste; more becomes an
// `adjust` move that moves no money; every move says `via: check`; and Undo
// of each puts the stock and every balance back exactly. Through the router,
// against real SQLite (every migration applied), the real policy grants and
// membership's answers.

import type {
  BalancesResponse,
  KitchenItem,
  KitchenItemResponse,
  KitchenStockMove,
  KitchenTxn,
  MovesResponse,
  StockMoveResponse,
} from "@saas/contracts/kitchen";
import { costOfUse } from "@saas/kitchen-engine/money";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-08T08:00:00.000Z");
const MINUTE = 60_000;

const RAHUL = "usr_rahul"; // owner of Flat 4B
const ADMIN = "usr_admin";
const MEERA = "usr_meera"; // buys the milk
const ANU = "usr_anu";
const DEV = "usr_dev";
const VIEWER = "usr_viewer";
const OUTSIDER = "usr_outsider";

let h: Harness;
let clock: Date;
let flat: Group; // six people, a viewer among them
let four: Group; // the design's Flat 4B of four: Meera, Rahul, Anu, Dev
let solo: Group; // Meera alone

beforeEach(() => {
  clock = NOW;
  h = createHarness({ deps: { now: () => clock } });
  flat = newGroup("Flat 4B");
  four = newGroup("Flat 4B");
  solo = newGroup("Meera's");
  // A roster runs oldest first: here, in the order people were first granted.
  h.grant(MEERA, four, "owner");
  h.grant(RAHUL, four, "builder");
  h.grant(ANU, four, "builder");
  h.grant(DEV, four, "builder");
  h.grant(RAHUL, flat, "owner");
  h.grant(ADMIN, flat, "admin");
  h.grant(MEERA, flat, "builder");
  h.grant(ANU, flat, "builder");
  h.grant(DEV, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(MEERA, solo, "owner");
  h.grant(OUTSIDER, newGroup("Elsewhere"), "owner");
  for (const [id, name] of [[RAHUL, "Rahul"], [MEERA, "Meera"], [ANU, "Anu"], [DEV, "Dev"], [ADMIN, "Admin"]] as const) {
    h.profile(id, { displayName: name, email: `${name.toLowerCase()}@example.com` });
  }
});

afterEach(() => h.close());

function tick(ms = MINUTE): void {
  clock = new Date(clock.getTime() + ms);
}

async function call<T>(
  method: string,
  url: string,
  as: string | null,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

const me = (rest: string) => `/v1/kitchen/me/${rest}`;
const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

const milk = { name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 6000 };
const oats = { name: "Oats", category: "Grains", quantity: "500", unit: "g", priceMinor: 9900 };

async function groupItem(as: string, g: Group, body: Record<string, unknown> = milk): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function myItem(as: string, body: Record<string, unknown> = oats): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", me("items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

type Moved = { status: number; body: Envelope<StockMoveResponse> };

const check = (as: string, g: Group, item: KitchenItem, body: unknown, headers?: Record<string, string>): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/check`), as, body, headers);
const checkMine = (as: string, item: KitchenItem, body: unknown, headers?: Record<string, string>): Promise<Moved> =>
  call<StockMoveResponse>("POST", me(`items/${item.id}/check`), as, body, headers);
const use = (as: string, g: Group, item: KitchenItem, body: unknown, headers?: Record<string, string>): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/uses`), as, body, headers);
const useMine = (as: string, item: KitchenItem, body: unknown): Promise<Moved> =>
  call<StockMoveResponse>("POST", me(`items/${item.id}/uses`), as, body);
const waste = (as: string, g: Group, item: KitchenItem, body?: unknown): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/waste`), as, body);
const wasteMine = (as: string, item: KitchenItem, body?: unknown): Promise<Moved> =>
  call<StockMoveResponse>("POST", me(`items/${item.id}/waste`), as, body);
const reverse = (as: string, g: Group, txnId: string) => call<{ txn: KitchenTxn }>("POST", groupPath(g, `txns/${txnId}/reverse`), as);
const undoGroup = (as: string, g: Group, moveId: string): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `moves/${moveId}/undo`), as);
const undoMine = (as: string, moveId: string): Promise<Moved> => call<StockMoveResponse>("POST", me(`moves/${moveId}/undo`), as);

const left = (quantity: string | number, unit?: string) => ({ quantity, ...(unit ? { unit } : {}) });

async function history(as: string, g: Group | null, item: KitchenItem): Promise<KitchenStockMove[]> {
  const res = await call<MovesResponse>("GET", g ? groupPath(g, `items/${item.id}/moves`) : me(`items/${item.id}/moves`), as);
  expect(res.status).toBe(200);
  return res.body.data.moves;
}

async function readItem(as: string, g: Group | null, item: KitchenItem): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("GET", g ? groupPath(g, `items/${item.id}`) : me(`items/${item.id}`), as);
  expect(res.status).toBe(200);
  return res.body.data.item;
}

/** Every non-zero balance in the group (they always add up to zero). */
async function balances(g: Group, as = MEERA): Promise<Record<string, number>> {
  const res = await call<BalancesResponse>("GET", groupPath(g, "balances"), as);
  expect(res.status).toBe(200);
  const all = res.body.data.balances;
  expect(all.reduce((a, b) => a + b.balanceMinor, 0)).toBe(0);
  return Object.fromEntries(all.filter((b) => b.balanceMinor !== 0).map((b) => [b.subjectId, b.balanceMinor]));
}

function count(table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function events(type: string): Array<Record<string, unknown>> {
  return h.db.prepare("SELECT * FROM events_event_log WHERE type = ? ORDER BY occurred_at").all(type) as Array<Record<string, unknown>>;
}

function uuidOf(publicId: string): string {
  return publicId.replace(/^[a-z]+_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

/** What a stock change writes: moves, transactions, their splits, and audit events. */
function written() {
  return {
    moves: count("kitchen_stock_moves"),
    txns: count("kitchen_txns"),
    splits: count("kitchen_txn_splits"),
    events: count("events_event_log"),
    audit: count("events_audit_entries"),
  };
}

type Written = ReturnType<typeof written>;

function plus(before: Written, more: Partial<Written>): Written {
  const after = { ...before };
  for (const [key, n] of Object.entries(more) as Array<[keyof Written, number]>) after[key] += n;
  return after;
}

/** A move or transaction without what differs between two writes of the same thing. */
function shape<T extends object>(value: T, ...drop: string[]): Partial<T> {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of ["id", "itemId", "txnId", "at", "sourceId", "createdAt", "occurredAt", ...drop]) delete copy[key];
  return copy as Partial<T>;
}

const loggedForYou = () => h.notifications.filter((n) => n.request.templateKey === "kitchen.logged_for_you");

describe("less than is left, on a group item: me", () => {
  it("writes the use …/uses would have written for the difference, by the caller, with via check", async () => {
    const checked = await groupItem(MEERA, flat);
    const used = await groupItem(MEERA, flat);
    const before = written();
    const res = await check(RAHUL, flat, checked, { left: left("750", "ml"), gone: "me" });
    expect(res.status).toBe(201);
    const { move, txn, item } = res.body.data;
    expect(move).toMatchObject({
      kind: "use", qtyMilli: 250_000, quantity: 250, unit: "ml", costMinor: 1500, actor: RAHUL, consumers: [RAHUL], via: "check",
      reverses: null, undone: false,
    });
    expect(txn).toMatchObject({
      kind: "use", title: "Milk (250 ml) · stock check", totalMinor: 1500, createdBy: RAHUL, sourceKind: "item", sourceId: checked.id,
      splits: [{ subjectId: MEERA, paidMinor: 1500, owedMinor: 0 }, { subjectId: RAHUL, paidMinor: 0, owedMinor: 1500 }],
    });
    expect(move.txnId).toBe(txn!.id);
    expect(item).toMatchObject({ qtyLeftMilli: 750_000, worthMinor: 4500, state: "active", version: 2 });
    // One move, one transaction with two splits, one audit event: what a use writes.
    expect(written()).toEqual(plus(before, { moves: 1, txns: 1, splits: 2, events: 1, audit: 1 }));

    // …/uses for the same amount writes the same move and transaction, but for via and the title's note.
    const direct = await use(RAHUL, flat, used, { quantity: "250", unit: "ml" });
    expect(shape(direct.body.data.move)).toEqual(shape(move, "via"));
    expect(direct.body.data.move.via).toBeUndefined();
    expect(shape(direct.body.data.txn!, "title")).toEqual(shape(txn!, "title"));
    expect(direct.body.data.txn!.title).toBe("Milk (250 ml)");

    const [audit] = events("kitchen.item.used");
    expect(JSON.parse(audit!.payload as string)).toMatchObject({ via: "check", qtyMilli: 250_000, costMinor: 1500, consumers: [RAHUL] });
    expect(JSON.parse(events("kitchen.item.used")[1]!.payload as string)).not.toHaveProperty("via");
    expect(await balances(flat)).toEqual({ [MEERA]: 3000, [RAHUL]: -3000 });
  });

  it("posts no transaction when the buyer checks, and the move is undone directly", async () => {
    const item = await groupItem(MEERA, flat);
    const res = await check(MEERA, flat, item, { left: left("0.6"), gone: "me" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      txn: null,
      move: { kind: "use", qtyMilli: 400_000, unit: "L", quantity: 0.4, costMinor: 2400, consumers: [MEERA], via: "check" },
      item: { qtyLeftMilli: 600_000, worthMinor: 3600 },
    });
    expect(count("kitchen_txns")).toBe(0);

    tick();
    const undone = await undoGroup(MEERA, flat, res.body.data.move.id);
    expect(undone.status).toBe(201);
    expect(undone.body.data.move).toMatchObject({ kind: "reversal", reverses: res.body.data.move.id, qtyMilli: 400_000, costMinor: 2400 });
    expect(undone.body.data.move.via).toBeUndefined();
    expect(undone.body.data.item).toMatchObject({ qtyLeftMilli: 1_000_000, worthMinor: 6000, state: "active" });
  });

  it("empties the item when the level is 0, at exactly what is left of its price", async () => {
    const item = await groupItem(MEERA, flat);
    await use(ANU, flat, item, { quantity: "333", unit: "ml" });
    const res = await check(DEV, flat, item, { left: left(0), gone: "me" });
    expect(res.status).toBe(201);
    expect(res.body.data.move).toMatchObject({ qtyMilli: 667_000, costMinor: 6000 - 1998 });
    expect(res.body.data.item).toMatchObject({ qtyLeftMilli: 0, state: "used_up", worthMinor: 0 });
  });
});

describe("less than is left, on a group item: split", () => {
  it("charges each of Flat 4B's four members a quarter of 250 ml of milk, and the buyer is paid back", async () => {
    const item = await groupItem(MEERA, four);
    const res = await check(RAHUL, four, item, { left: left("750", "ml"), gone: "split" });
    expect(res.status).toBe(201);
    const { move, txn } = res.body.data;
    // Everyone in the group, oldest first, as the roster names them.
    expect(move).toMatchObject({ kind: "use", qtyMilli: 250_000, costMinor: 1500, actor: RAHUL, consumers: [MEERA, RAHUL, ANU, DEV], via: "check" });
    expect(txn).toMatchObject({
      kind: "use",
      title: "Milk (250 ml) · stock check",
      totalMinor: 1500,
      createdBy: RAHUL,
      splits: [
        { subjectId: MEERA, paidMinor: 1500, owedMinor: 375 },
        { subjectId: RAHUL, paidMinor: 0, owedMinor: 375 },
        { subjectId: ANU, paidMinor: 0, owedMinor: 375 },
        { subjectId: DEV, paidMinor: 0, owedMinor: 375 },
      ],
    });
    expect(await balances(four)).toEqual({ [MEERA]: 1125, [RAHUL]: -375, [ANU]: -375, [DEV]: -375 });
    // The use's emails, as …/uses sends them: everyone it names but whoever logged it.
    expect(loggedForYou().map((n) => n.request.recipient.subjectId).sort()).toEqual([ANU, DEV, MEERA]);
  });

  it("gives the odd paisa to the earliest members, one each, to the paisa", async () => {
    // ₹50.51 four ways: ₹12.62 each and three paise over, to Meera, Rahul and Anu.
    const atta = await groupItem(MEERA, four, { name: "Atta", category: "Grains", quantity: "1", unit: "kg", priceMinor: 10101 });
    const res = await check(DEV, four, atta, { left: left("500", "g"), gone: "split" });
    expect(res.status).toBe(201);
    expect(res.body.data.move.costMinor).toBe(5051);
    expect(res.body.data.txn!.splits).toEqual([
      { subjectId: MEERA, paidMinor: 5051, owedMinor: 1263 },
      { subjectId: RAHUL, paidMinor: 0, owedMinor: 1263 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 1263 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 1262 },
    ]);
    expect(await balances(four)).toEqual({ [MEERA]: 5051 - 1263, [RAHUL]: -1263, [ANU]: -1263, [DEV]: -1262 });
  });

  it("counts every current member, a viewer too, as waste split equally does", async () => {
    const item = await groupItem(MEERA, flat);
    const res = await check(ANU, flat, item, { left: left("0.4"), gone: "split" });
    expect(res.body.data.move.consumers).toEqual([MEERA, RAHUL, ANU, DEV, ADMIN, VIEWER]);
    expect(res.body.data.txn!.splits.map((s) => s.owedMinor)).toEqual([600, 600, 600, 600, 600, 600]);
    // Someone who has left is no longer charged.
    h.revoke(DEV, flat);
    tick();
    const later = await check(ANU, flat, item, { left: left("0.1"), gone: "split" });
    expect(later.body.data.move.consumers).toEqual([MEERA, RAHUL, ANU, ADMIN, VIEWER]);
    expect(later.body.data.txn!.totalMinor).toBe(1800);
  });

  it("posts nothing when the buyer is the only member: the move alone, undone directly", async () => {
    const item = await groupItem(MEERA, solo);
    const before = written();
    const res = await check(MEERA, solo, item, { left: left("0.25"), gone: "split" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      txn: null,
      move: { kind: "use", qtyMilli: 750_000, costMinor: 4500, consumers: [MEERA], via: "check" },
      item: { qtyLeftMilli: 250_000, worthMinor: 1500 },
    });
    expect(written()).toEqual(plus(before, { moves: 1, events: 1, audit: 1 }));
    expect(await balances(solo)).toEqual({});
    expect(loggedForYou()).toHaveLength(0);

    const undone = await undoGroup(MEERA, solo, res.body.data.move.id);
    expect(undone.body.data.item).toMatchObject({ qtyLeftMilli: 1_000_000, worthMinor: 6000 });
  });
});

describe("less than is left, on a group item: waste", () => {
  it("wastes the difference under the group's rule: split equally, as …/waste would", async () => {
    const checked = await groupItem(MEERA, flat);
    const wasted = await groupItem(MEERA, flat);
    const res = await check(ANU, flat, checked, { left: left("900", "ml"), gone: "waste" });
    expect(res.status).toBe(201);
    const { move, txn } = res.body.data;
    expect(move).toMatchObject({ kind: "waste", qtyMilli: 100_000, unit: "ml", costMinor: 600, consumers: null, actor: ANU, via: "check" });
    expect(txn).toMatchObject({ kind: "waste", title: "Wasted: Milk (100 ml) · stock check", totalMinor: 600 });
    expect(txn!.splits.map((s) => s.owedMinor)).toEqual([100, 100, 100, 100, 100, 100]);
    expect(JSON.parse(events("kitchen.item.wasted")[0]!.payload as string)).toMatchObject({ wastePolicy: "split_equally", via: "check" });
    // Waste sends no email, through a check as directly.
    expect(loggedForYou()).toHaveLength(0);

    const direct = await waste(ANU, flat, wasted, { quantity: "100", unit: "ml" });
    expect(shape(direct.body.data.move)).toEqual(shape(move, "via"));
    expect(shape(direct.body.data.txn!, "title")).toEqual(shape(txn!, "title"));
  });

  it("lets the buyer absorb it under buyer_absorbs, and the item's own rule wins over the group's", async () => {
    await call("PATCH", groupPath(flat, "settings"), RAHUL, { wastePolicy: "buyer_absorbs" });
    const absorbed = await groupItem(MEERA, flat);
    const before = written();
    const res = await check(DEV, flat, absorbed, { left: left("0.5"), gone: "waste" });
    expect(res.body.data).toMatchObject({ txn: null, move: { kind: "waste", costMinor: 3000, via: "check" }, item: { qtyLeftMilli: 500_000 } });
    expect(written()).toEqual(plus(before, { moves: 1, events: 1, audit: 1 }));
    expect(await balances(flat)).toEqual({});

    const shared = await groupItem(MEERA, flat, { ...milk, wastePolicy: "split_equally" });
    const split = await check(DEV, flat, shared, { left: left("0.5"), gone: "waste" });
    expect(split.body.data.txn).toMatchObject({ kind: "waste", totalMinor: 3000 });
    expect(await balances(flat)).toEqual({ [MEERA]: 2500, [RAHUL]: -500, [ADMIN]: -500, [ANU]: -500, [DEV]: -500, [VIEWER]: -500 });
  });

  it("wastes everything left at 0, and the item is wasted", async () => {
    const item = await groupItem(MEERA, flat, { ...milk, wastePolicy: "buyer_absorbs" });
    const res = await check(MEERA, flat, item, { left: left("0", "ml"), gone: "waste" });
    expect(res.body.data).toMatchObject({ move: { kind: "waste", qtyMilli: 1_000_000, unit: "ml" }, item: { qtyLeftMilli: 0, state: "wasted" } });
  });
});

describe("undoing what a check took, on a group item", () => {
  it("restores the stock and every balance exactly, whichever answer it was", async () => {
    const item = await groupItem(MEERA, four);
    const mine = await check(ANU, four, item, { left: left("900", "ml"), gone: "me" });
    tick();
    const split = await check(RAHUL, four, item, { left: left("650", "ml"), gone: "split" });
    tick();
    const wasted = await check(DEV, four, item, { left: left("333", "ml"), gone: "waste" });
    expect(await balances(four)).not.toEqual({});

    for (const [as, done] of [[DEV, wasted], [RAHUL, split], [ANU, mine]] as const) {
      const reversal = await reverse(as, four, done.body.data.txn!.id);
      expect(reversal.status).toBe(201);
    }
    expect(await balances(four)).toEqual({});
    expect(await readItem(MEERA, four, item)).toMatchObject({ qtyLeftMilli: 1_000_000, worthMinor: 6000, state: "active" });
    const moves = await history(MEERA, four, item);
    expect(moves.filter((m) => m.kind !== "reversal").every((m) => m.undone && m.via === "check")).toBe(true);
    expect(moves.filter((m) => m.kind === "reversal").every((m) => m.via === undefined)).toBe(true);
  });
});
