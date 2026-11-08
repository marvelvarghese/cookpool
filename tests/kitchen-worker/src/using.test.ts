// Using things (CP-11): uses for one or several people, waste by the group's
// rule or the item's, moving a personal item into a group, undo, history,
// usuals and usable-only reads — through the router, against real SQLite
// (every migration applied), the real policy grants and membership's answers.

import type {
  BalancesResponse,
  KitchenItem,
  KitchenItemResponse,
  KitchenSettings,
  KitchenStockMove,
  KitchenTxn,
  MovesResponse,
  ReachableItemsPage,
  SearchItemsResponse,
  StockMoveResponse,
  UsualsResponse,
} from "@saas/contracts/kitchen";
import type { OrganizationRole } from "@saas/contracts/policy";
import { authorize } from "@saas/policy-engine";
import { costOfUse } from "@saas/kitchen-engine/money";
import { USE_ROLES } from "@kitchen-worker/groups-client";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-02T08:00:00.000Z");
const MINUTE = 60_000;
const DAY = 86_400_000;

const RAHUL = "usr_rahul"; // owner of Flat 4B; only a viewer in the Lunch club
const ADMIN = "usr_admin";
const MEERA = "usr_meera"; // buys the milk
const ANU = "usr_anu";
const DEV = "usr_dev";
const VIEWER = "usr_viewer";
const OUTSIDER = "usr_outsider";

let h: Harness;
let clock: Date;
let flat: Group;
let lunch: Group;
let elsewhere: Group;

beforeEach(() => {
  clock = NOW;
  h = createHarness({ deps: { now: () => clock } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  elsewhere = newGroup("Another flat");
  // Flat 4B's roster, oldest first: six people, one of them a viewer.
  h.grant(RAHUL, flat, "owner");
  h.grant(ADMIN, flat, "admin");
  h.grant(MEERA, flat, "builder");
  h.grant(ANU, flat, "builder");
  h.grant(DEV, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(ANU, lunch, "owner");
  h.grant(RAHUL, lunch, "viewer");
  h.grant(OUTSIDER, elsewhere, "owner");
});

afterEach(() => h.close());

/** Move the clock on, so moves logged one after another have distinct times. */
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

const use = (as: string, g: Group, item: KitchenItem, body: unknown, headers?: Record<string, string>): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/uses`), as, body, headers);
const useMine = (as: string, item: KitchenItem, body: unknown, headers?: Record<string, string>): Promise<Moved> =>
  call<StockMoveResponse>("POST", me(`items/${item.id}/uses`), as, body, headers);
const waste = (as: string, g: Group, item: KitchenItem, body?: unknown, headers?: Record<string, string>): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/waste`), as, body, headers);
const wasteMine = (as: string, item: KitchenItem, body?: unknown): Promise<Moved> =>
  call<StockMoveResponse>("POST", me(`items/${item.id}/waste`), as, body);
const transfer = (as: string, item: KitchenItem, orgId: unknown, headers?: Record<string, string>): Promise<Moved> =>
  call<StockMoveResponse>("POST", me(`items/${item.id}/transfer`), as, { orgId }, headers);
const reverse = (as: string, g: Group, txnId: string) =>
  call<{ txn: KitchenTxn }>("POST", groupPath(g, `txns/${txnId}/reverse`), as);
const undoGroup = (as: string, g: Group, moveId: string): Promise<Moved> =>
  call<StockMoveResponse>("POST", groupPath(g, `moves/${moveId}/undo`), as);
const undoMine = (as: string, moveId: string, headers?: Record<string, string>): Promise<Moved> =>
  call<StockMoveResponse>("POST", me(`moves/${moveId}/undo`), as, undefined, headers);

async function history(as: string, g: Group | null, item: KitchenItem, query = ""): Promise<KitchenStockMove[]> {
  const path = g ? groupPath(g, `items/${item.id}/moves${query}`) : me(`items/${item.id}/moves${query}`);
  const res = await call<MovesResponse>("GET", path, as);
  expect(res.status).toBe(200);
  return res.body.data.moves;
}

async function readItem(as: string, g: Group | null, item: KitchenItem): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("GET", g ? groupPath(g, `items/${item.id}`) : me(`items/${item.id}`), as);
  expect(res.status).toBe(200);
  return res.body.data.item;
}

/** Every non-zero balance in the group (they always add up to zero). */
async function balances(g: Group): Promise<Record<string, number>> {
  const res = await call<BalancesResponse>("GET", groupPath(g, "balances"), RAHUL);
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

interface Written {
  moves: number;
  txns: number;
  splits: number;
  events: number;
  audit: number;
}

/** What is written for every stock change: moves, transactions, their splits, and audit events. */
function written(): Written {
  return {
    moves: count("kitchen_stock_moves"),
    txns: count("kitchen_txns"),
    splits: count("kitchen_txn_splits"),
    events: count("events_event_log"),
    audit: count("events_audit_entries"),
  };
}

function sumOf(splits: KitchenTxn["splits"], key: "paidMinor" | "owedMinor"): number {
  return splits.reduce((a, s) => a + s[key], 0);
}

describe("using a group item", () => {
  it("logs 250 ml of milk for me and Anu: Meera, who bought it, is paid back and each of us owes our share to the paisa", async () => {
    const item = await groupItem(MEERA, flat);
    const { status, body } = await use(RAHUL, flat, item, { quantity: "250", unit: "ml", consumers: [RAHUL, ANU] });
    expect(status).toBe(201);
    const { move, txn } = body.data;
    expect(move).toEqual({
      id: expect.stringMatching(/^mov_[0-9a-f]{32}$/),
      itemId: item.id,
      kind: "use",
      qtyMilli: 250_000,
      quantity: 250,
      unit: "ml",
      label: null,
      costMinor: 1500,
      actor: RAHUL,
      consumers: [RAHUL, ANU],
      txnId: txn!.id,
      reverses: null,
      at: NOW.toISOString(),
      undone: false,
      undoneBy: null,
    });
    expect(txn).toMatchObject({
      kind: "use",
      orgId: flat.publicId,
      title: "Milk (250 ml)",
      totalMinor: 1500,
      currency: "INR",
      createdBy: RAHUL,
      sourceKind: "item",
      sourceId: item.id,
      reversed: false,
      splits: [
        { subjectId: MEERA, paidMinor: 1500, owedMinor: 0 },
        { subjectId: RAHUL, paidMinor: 0, owedMinor: 750 },
        { subjectId: ANU, paidMinor: 0, owedMinor: 750 },
      ],
    });
    expect(body.data.item).toMatchObject({
      id: item.id,
      qtyLeftMilli: 750_000,
      qtyLeft: 0.75,
      worthMinor: 4500,
      state: "active",
      version: 2,
      pantry: { kind: "group", orgId: flat.publicId },
    });
    expect(await balances(flat)).toEqual({ [MEERA]: 1500, [RAHUL]: -750, [ANU]: -750 });

    const used = events("kitchen.item.used");
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ actor_id: RAHUL, org_id: flat.id, subject_kind: "kitchen_item", subject_id: uuidOf(item.id) });
    expect(JSON.parse(used[0]!.payload as string)).toMatchObject({
      itemId: item.id,
      moveId: move.id,
      txnId: txn!.id,
      qtyMilli: 250_000,
      costMinor: 1500,
      paidBy: MEERA,
      consumers: [RAHUL, ANU],
    });
    expect(h.decisions.map((d) => d.request.action)).toContain("kitchen.item.use");
  });

  it("gives the odd paisa to whoever is named first, and splits by weight when asked", async () => {
    const item = await groupItem(MEERA, flat, { ...milk, quantity: "3", priceMinor: 3003 });
    const first = await use(RAHUL, flat, item, { quantity: "1", consumers: [ANU, DEV] });
    expect(first.body.data.txn!.splits.slice(1)).toEqual([
      { subjectId: ANU, paidMinor: 0, owedMinor: 501 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 500 },
    ]);
    const swapped = await use(RAHUL, flat, item, { quantity: "1", consumers: [DEV, ANU] });
    expect(swapped.body.data.txn!.splits.slice(1)).toEqual([
      { subjectId: DEV, paidMinor: 0, owedMinor: 501 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 500 },
    ]);
    // 2 : 1 of ₹10.01 is 667.33 and 333.67: the paisa goes to the larger remainder.
    const weighted = await use(RAHUL, flat, item, { quantity: "1", consumers: [ANU, DEV], weights: [2, 1] });
    expect(weighted.body.data.txn).toMatchObject({
      totalMinor: 1001,
      splits: [
        { subjectId: MEERA, paidMinor: 1001, owedMinor: 0 },
        { subjectId: ANU, paidMinor: 0, owedMinor: 667 },
        { subjectId: DEV, paidMinor: 0, owedMinor: 334 },
      ],
    });
    expect(await balances(flat)).toEqual({ [MEERA]: 3003, [ANU]: -1668, [DEV]: -1335 });
  });

  it("nets the buyer's own share: alone the use posts no transaction, and with others only their shares move", async () => {
    const item = await groupItem(MEERA, flat);
    const before = written();
    const alone = await use(MEERA, flat, item, { quantity: "250", unit: "ml" });
    expect(alone.status).toBe(201);
    expect(alone.body.data.txn).toBeNull();
    expect(alone.body.data.move).toMatchObject({ consumers: [MEERA], costMinor: 1500, txnId: null });
    expect(alone.body.data.item).toMatchObject({ qtyLeftMilli: 750_000, worthMinor: 4500 });
    expect(written()).toEqual({ ...before, moves: before.moves + 1, events: before.events + 1, audit: before.audit + 1 });
    expect(await balances(flat)).toEqual({});

    const shared = await use(MEERA, flat, item, { quantity: "500", unit: "ml", consumers: [MEERA, ANU] });
    expect(shared.body.data.txn!.splits).toEqual([
      { subjectId: MEERA, paidMinor: 3000, owedMinor: 1500 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 1500 },
    ]);
    expect(await balances(flat)).toEqual({ [MEERA]: 1500, [ANU]: -1500 });
  });

  it("logs for the caller when no one is named, in the item's own unit when no unit is", async () => {
    const item = await groupItem(MEERA, flat);
    const { body } = await use(ANU, flat, item, { quantity: "0.5" });
    expect(body.data.move).toMatchObject({ qtyMilli: 500_000, quantity: 0.5, unit: "L", consumers: [ANU], costMinor: 3000 });
    expect(body.data.txn!.splits).toEqual([
      { subjectId: MEERA, paidMinor: 3000, owedMinor: 0 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 3000 },
    ]);
    // A spoonful is a volume too.
    const tbsp = await use(ANU, flat, item, { quantity: 2, unit: "tbsp" });
    expect(tbsp.body.data.move).toMatchObject({ qtyMilli: 30_000, quantity: 2, unit: "tbsp", costMinor: 180 });
  });

  it.each([
    [9999, "1", "kg", ["333", "333", "1", "7", "100", "226"], "g"],
    [10000, "7", "pcs", ["1", "1", "1", "1", "1", "1", "1"], "pcs"],
    [50, "3", "pcs", ["1", "1", "1"], "pcs"],
    [4999, "1.5", "L", ["0.333", "0.333", "0.334", "0.5"], "L"],
    [1049, "1", "L", Array.from({ length: 100 }, () => "10"), "ml"],
  ])("charges a used-up item exactly its price across all its uses (%i paise)", async (price, bought, unit, uses, useUnit) => {
    const item = await groupItem(MEERA, flat, { name: "Thing", category: "Misc", quantity: bought, unit, priceMinor: price });
    const rota = [[ANU], [DEV, RAHUL], [ANU, DEV, RAHUL], [RAHUL]];
    let charged = 0;
    let left = item;
    for (const [i, quantity] of uses.entries()) {
      const { status, body } = await use(ANU, flat, item, { quantity, unit: useUnit, consumers: rota[i % rota.length] });
      expect(status).toBe(201);
      const { move, txn } = body.data;
      // Proportional to what was paid, except the last, which takes what is left of the price.
      expect(move.costMinor).toBe(costOfUse({ ...left, costTakenMinor: left.priceMinor - left.worthMinor }, move.qtyMilli));
      expect(txn!.totalMinor).toBe(move.costMinor);
      expect(sumOf(txn!.splits, "paidMinor")).toBe(move.costMinor);
      expect(sumOf(txn!.splits, "owedMinor")).toBe(move.costMinor);
      charged += move.costMinor;
      left = body.data.item;
    }
    expect(charged).toBe(price);
    expect(left).toMatchObject({ qtyLeftMilli: 0, state: "used_up", worthMinor: 0 });
    const row = h.db.prepare("SELECT cost_taken_minor FROM kitchen_items WHERE id = ?").get(uuidOf(item.id)) as { cost_taken_minor: number };
    expect(row.cost_taken_minor).toBe(price);
    const moves = await history(ANU, flat, item, "?limit=200");
    expect(moves).toHaveLength(uses.length);
    expect(moves.reduce((a, m) => a + m.costMinor, 0)).toBe(price);
    expect((await balances(flat))[MEERA]).toBe(price);
  });

  it("refuses an over-draw with 409 insufficient_stock, writing nothing", async () => {
    const item = await groupItem(MEERA, flat);
    const before = written();
    const res = await use(ANU, flat, item, { quantity: "1.5", unit: "L" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "conflict", details: { reason: "insufficient_stock", qtyLeftMilli: 1_000_000 } });
    expect(written()).toEqual(before);

    await use(ANU, flat, item, { quantity: "1", unit: "L" });
    const gone = await use(ANU, flat, item, { quantity: "1", unit: "ml" });
    expect(gone.body.error.details).toEqual({ reason: "insufficient_stock", qtyLeftMilli: 0 });
  });

  it("lets one of two uses racing for the last 100 g win: the other is 409 and nothing of it is written", async () => {
    const item = await groupItem(MEERA, flat, { name: "Paneer", category: "Dairy", quantity: "100", unit: "g", priceMinor: 9500 });
    const before = written();
    const results = await Promise.all([
      use(ANU, flat, item, { quantity: "100", unit: "g" }),
      use(DEV, flat, item, { quantity: "100", unit: "g" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = results.find((r) => r.status === 201)!;
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.details).toMatchObject({ reason: "insufficient_stock", qtyLeftMilli: 0 });
    expect(written()).toEqual({
      moves: before.moves + 1,
      txns: before.txns + 1,
      splits: before.splits + 2,
      events: before.events + 1,
      audit: before.audit + 1,
    });
    expect(await readItem(MEERA, flat, item)).toMatchObject({ qtyLeftMilli: 0, state: "used_up", version: 2 });
    const eater = winner.body.data.move.actor;
    expect(await balances(flat)).toEqual({ [MEERA]: 9500, [eater]: -9500 });
  });

  it("plans again when another use lands between the read and the write, and refuses what no longer fits", async () => {
    const item = await groupItem(MEERA, flat, { name: "Paneer", category: "Dairy", quantity: "100", unit: "g", priceMinor: 9500 });
    // Dev takes 60 g after Anu's request read the item and before it writes.
    h.beforeNextBatch((db) =>
      db.prepare(
        "UPDATE kitchen_items SET qty_left_milli = 40000, cost_taken_minor = 5700, version = version + 1 WHERE id = ?",
      ).run(uuidOf(item.id)),
    );
    const before = written();
    const res = await use(ANU, flat, item, { quantity: "50", unit: "g" });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "insufficient_stock", qtyLeftMilli: 40_000 });
    expect(written()).toEqual(before);

    // What still fits goes through on the retry, costed from the fresh read: the last 40 g cost what is left.
    h.beforeNextBatch((db) => db.prepare("UPDATE kitchen_items SET version = version + 1 WHERE id = ?").run(uuidOf(item.id)));
    const retried = await use(ANU, flat, item, { quantity: "40", unit: "g" });
    expect(retried.status).toBe(201);
    expect(retried.body.data.move.costMinor).toBe(9500 - 5700);
    expect(retried.body.data.item).toMatchObject({ qtyLeftMilli: 0, state: "used_up", version: 4 });
  });

  it("answers 409 stale when the item moves on again during the retry, writing nothing", async () => {
    const item = await groupItem(MEERA, flat);
    const bump = (db: Harness["db"]) => db.prepare("UPDATE kitchen_items SET version = version + 1 WHERE id = ?").run(uuidOf(item.id));
    h.beforeNextBatch(bump);
    h.beforeNextBatch(bump);
    const before = written();
    const res = await use(ANU, flat, item, { quantity: "250", unit: "ml" });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "stale" });
    expect(written()).toEqual(before);
    expect(await readItem(ANU, flat, item)).toMatchObject({ qtyLeftMilli: 1_000_000, version: 3 });
  });

  it("keeps the stock CHECK as the last guard: an over-draw the read did not see fails the whole batch", async () => {
    const item = await groupItem(MEERA, flat, { name: "Paneer", category: "Dairy", quantity: "100", unit: "g", priceMinor: 9500 });
    // Stock leaves without the version moving: only the table's CHECK can catch it.
    h.beforeNextBatch((db) => db.prepare("UPDATE kitchen_items SET qty_left_milli = 30000 WHERE id = ?").run(uuidOf(item.id)));
    const before = written();
    const res = await use(ANU, flat, item, { quantity: "50", unit: "g", consumers: [ANU, DEV] });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "insufficient_stock", qtyLeftMilli: 30_000 });
    // No transaction, splits, move or audit event: D1 rolled the batch back whole.
    expect(written()).toEqual(before);
  });

  it("answers a retried use with the move it made, and refuses the key for anything else", async () => {
    const item = await groupItem(MEERA, flat);
    const headers = { "idempotency-key": "use-milk-1" };
    const first = await use(ANU, flat, item, { quantity: "250", unit: "ml" }, headers);
    const again = await use(ANU, flat, item, { quantity: "250", unit: "ml" }, headers);
    expect(again.status).toBe(201);
    expect(again.body.data.move).toEqual(first.body.data.move);
    expect(again.body.data.txn).toEqual(first.body.data.txn);
    expect(again.body.data.item.qtyLeftMilli).toBe(750_000);
    expect(count("kitchen_stock_moves")).toBe(1);
    expect(count("kitchen_txns")).toBe(1);

    const someoneElse = await use(DEV, flat, item, { quantity: "250", unit: "ml" }, headers);
    expect(someoneElse.status).toBe(409);
    expect(someoneElse.body.error.details).toEqual({ reason: "idempotency_key_reused" });

    // A key an expense already posted in this group is not this use's.
    await call("POST", groupPath(flat, "expenses"), ANU, {
      title: "Gas", totalMinor: 100, mode: "equal", payers: [{ subjectId: ANU, amountMinor: 100 }], participants: [{ subjectId: DEV }],
    }, { "idempotency-key": "spent" });
    const before = written();
    const reused = await use(ANU, flat, item, { quantity: "100", unit: "ml" }, { "idempotency-key": "spent" });
    expect(reused.status).toBe(409);
    expect(reused.body.error.details).toEqual({ reason: "idempotency_key_reused" });
    expect(written()).toEqual(before);
  });

  it.each([
    [{ quantity: "2", unit: "pcs" }, "unit"],
    [{ quantity: "2", unit: "stone" }, "unit"],
    [{ quantity: "0" }, "quantity"],
    [{ quantity: "-1" }, "quantity"],
    [{ quantity: "lots" }, "quantity"],
    [{ unit: "ml" }, "quantity"],
    [{ quantity: "1", consumers: [] }, "consumers"],
    [{ quantity: "1", consumers: "usr_anu" }, "consumers"],
    [{ quantity: "1", consumers: [ANU, ANU] }, "consumers"],
    [{ quantity: "1", consumers: ["not an id!"] }, "consumers[0]"],
    [{ quantity: "1", consumers: [ANU, DEV], weights: [1] }, "weights"],
    [{ quantity: "1", consumers: [ANU, DEV], weights: [1, 0] }, "weights"],
    [{ quantity: "1", consumers: [ANU], weights: [-1] }, "weights"],
  ])("is 422 for a malformed use (%#), writing nothing", async (body, field) => {
    const item = await groupItem(MEERA, flat);
    const before = written();
    const res = await use(ANU, flat, item, body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.details.fields).toHaveProperty([field]);
    expect(written()).toEqual(before);
  });

  it("is 422 not_in_group for someone outside the group, writing nothing", async () => {
    const item = await groupItem(MEERA, flat);
    const before = written();
    const res = await use(ANU, flat, item, { quantity: "250", unit: "ml", consumers: [ANU, OUTSIDER] });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual({ reason: "not_in_group", subjectIds: [OUTSIDER] });
    expect(written()).toEqual(before);
  });

  it("lets members use but not a viewer, and is the opaque 404 outside the group or for another pantry's item", async () => {
    const item = await groupItem(MEERA, flat);
    const mine = await myItem(ANU);
    const theirs = await groupItem(OUTSIDER, elsewhere);
    for (const [as, target, g] of [
      [VIEWER, item, flat],
      [OUTSIDER, item, flat],
      [ANU, mine, flat],
      [ANU, theirs, flat],
    ] as const) {
      const res = await use(as, g, target, { quantity: "1", unit: "ml" });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "not_found", message: "Not found" });
    }
    expect((await call("POST", groupPath(flat, "items/itm_nope/uses"), ANU, { quantity: "1" })).status).toBe(404);
    expect((await call("GET", groupPath(flat, `items/${item.id}/uses`), ANU)).status).toBe(405);
    expect(count("kitchen_stock_moves")).toBe(0);
    for (const as of [RAHUL, ADMIN, ANU]) expect((await use(as, flat, item, { quantity: "1", unit: "ml" })).status).toBe(201);
  });
});

describe("using a personal item", () => {
  it("records the move and nothing else: no ledger, no audit event, no policy hop", async () => {
    const item = await myItem(RAHUL);
    const decisions = h.decisions.length;
    const { status, body } = await useMine(RAHUL, item, { quantity: "100", unit: "g" });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({
      item: { qtyLeftMilli: 400_000, worthMinor: 7920, pantry: { kind: "personal" }, version: 2 },
      move: { kind: "use", qtyMilli: 100_000, costMinor: 1980, consumers: [RAHUL], actor: RAHUL, txnId: null },
      txn: null,
    });
    expect(count("kitchen_txns")).toBe(0);
    expect(count("events_event_log")).toBe(0);
    expect(h.decisions.length).toBe(decisions);
  });

  it("is another person's 404, refuses an over-draw, and answers a retry with the move it made", async () => {
    const item = await myItem(RAHUL);
    expect((await useMine(ANU, item, { quantity: "1", unit: "g" })).status).toBe(404);
    const over = await useMine(RAHUL, item, { quantity: "1", unit: "kg" });
    expect(over.status).toBe(409);
    expect(over.body.error.details).toEqual({ reason: "insufficient_stock", qtyLeftMilli: 500_000 });
    const headers = { "idempotency-key": "oats-1" };
    const first = await useMine(RAHUL, item, { quantity: "50", unit: "g" }, headers);
    const again = await useMine(RAHUL, item, { quantity: "50", unit: "g" }, headers);
    expect(again.body.data.move.id).toBe(first.body.data.move.id);
    expect(again.body.data.item.qtyLeftMilli).toBe(450_000);
    expect(count("kitchen_stock_moves")).toBe(1);
  });

  it("ignores consumers and weights: a personal pantry is its owner's alone", async () => {
    const item = await myItem(RAHUL);
    const { body } = await useMine(RAHUL, item, { quantity: "10", unit: "g", consumers: [ANU], weights: [3] });
    expect(body.data.move.consumers).toEqual([RAHUL]);
  });
});

describe("waste", () => {
  it("splits waste equally between every current member under the group's rule, by default everything left", async () => {
    const item = await groupItem(MEERA, flat);
    await use(ANU, flat, item, { quantity: "250", unit: "ml" });
    const { status, body } = await waste(DEV, flat, item);
    expect(status).toBe(201);
    expect(body.data.move).toMatchObject({ kind: "waste", qtyMilli: 750_000, unit: "L", costMinor: 4500, consumers: null, actor: DEV });
    // Six members, the viewer included, each owe ₹7.50; Meera is paid back the ₹45.00 it was worth.
    expect(body.data.txn).toMatchObject({
      kind: "waste",
      title: "Wasted: Milk (750 ml)",
      totalMinor: 4500,
      createdBy: DEV,
      sourceKind: "item",
      sourceId: item.id,
      // The buyer first (paid), then the members in roster order.
      splits: [
        { subjectId: MEERA, paidMinor: 4500, owedMinor: 750 },
        { subjectId: RAHUL, paidMinor: 0, owedMinor: 750 },
        { subjectId: ADMIN, paidMinor: 0, owedMinor: 750 },
        { subjectId: ANU, paidMinor: 0, owedMinor: 750 },
        { subjectId: DEV, paidMinor: 0, owedMinor: 750 },
        { subjectId: VIEWER, paidMinor: 0, owedMinor: 750 },
      ],
    });
    expect(body.data.item).toMatchObject({ qtyLeftMilli: 0, state: "wasted", worthMinor: 0 });
    expect(await balances(flat)).toEqual({
      [MEERA]: 1500 + 3750, [ANU]: -1500 - 750, [RAHUL]: -750, [ADMIN]: -750, [DEV]: -750, [VIEWER]: -750,
    });
    const wasted = events("kitchen.item.wasted");
    expect(wasted).toHaveLength(1);
    expect(JSON.parse(wasted[0]!.payload as string)).toMatchObject({ wastePolicy: "split_equally", costMinor: 4500, qtyMilli: 750_000 });

    const nothingLeft = await waste(DEV, flat, item);
    expect(nothingLeft.status).toBe(409);
    expect(nothingLeft.body.error.details).toEqual({ reason: "insufficient_stock", qtyLeftMilli: 0 });
  });

  it("wastes part of an item when told how much, leaving it active", async () => {
    const item = await groupItem(MEERA, flat);
    const { body } = await waste(ANU, flat, item, { quantity: "60", unit: "ml" });
    expect(body.data.move).toMatchObject({ qtyMilli: 60_000, costMinor: 360 });
    expect(body.data.txn!.splits.find((s) => s.subjectId === ANU)).toEqual({ subjectId: ANU, paidMinor: 0, owedMinor: 60 });
    expect(body.data.item).toMatchObject({ qtyLeftMilli: 940_000, state: "active" });
  });

  it("lets the buyer absorb waste under buyer_absorbs, and the item's own rule wins over the group's either way", async () => {
    await call("PATCH", groupPath(flat, "settings"), RAHUL, { wastePolicy: "buyer_absorbs" });
    const absorbed = await groupItem(MEERA, flat);
    const before = written();
    const res = await waste(MEERA, flat, absorbed);
    expect(res.body.data).toMatchObject({ txn: null, move: { kind: "waste", costMinor: 6000 }, item: { state: "wasted" } });
    expect(written()).toEqual({ ...before, moves: before.moves + 1, events: before.events + 1, audit: before.audit + 1 });
    expect(await balances(flat)).toEqual({});

    const shared = await groupItem(MEERA, flat, { ...milk, wastePolicy: "split_equally" });
    const split = await waste(MEERA, flat, shared);
    expect(split.body.data.txn).toMatchObject({ kind: "waste", totalMinor: 6000 });
    expect(await balances(flat)).toEqual({ [MEERA]: 5000, [RAHUL]: -1000, [ADMIN]: -1000, [ANU]: -1000, [DEV]: -1000, [VIEWER]: -1000 });

    await call("PATCH", groupPath(flat, "settings"), RAHUL, { wastePolicy: "split_equally" });
    const own = await groupItem(MEERA, flat, { ...milk, wastePolicy: "buyer_absorbs" });
    expect((await waste(MEERA, flat, own)).body.data.txn).toBeNull();
  });

  it("records a personal item's waste as a move only", async () => {
    const item = await myItem(RAHUL, milk);
    const half = await wasteMine(RAHUL, item, { quantity: "0.5" });
    expect(half.body.data).toMatchObject({ txn: null, move: { kind: "waste", qtyMilli: 500_000, unit: "L", costMinor: 3000 } });
    const rest = await wasteMine(RAHUL, item);
    expect(rest.body.data.item).toMatchObject({ qtyLeftMilli: 0, state: "wasted" });
    expect(count("kitchen_txns")).toBe(0);
    expect(count("events_event_log")).toBe(0);
  });

  it("is 404 for a viewer and outside the group, and 422 for a unit without a quantity", async () => {
    const item = await groupItem(MEERA, flat);
    expect((await waste(VIEWER, flat, item)).status).toBe(404);
    expect((await waste(OUTSIDER, flat, item)).status).toBe(404);
    const unitOnly = await waste(MEERA, flat, item, { unit: "ml" });
    expect(unitOnly.status).toBe(422);
    expect(unitOnly.body.error.details.fields).toHaveProperty(["unit"]);
    expect(count("kitchen_stock_moves")).toBe(0);
  });
});

describe("moving a personal item into a group", () => {
  const rice = { name: "Rice", category: "Grains", quantity: "1", unit: "kg", priceMinor: 12500 };

  it("makes it a group item paid for by the mover, with a transfer move and kitchen.item.transferred", async () => {
    const item = await myItem(RAHUL, rice);
    const headers = { "idempotency-key": "move-rice" };
    const { status, body } = await transfer(RAHUL, item, flat.publicId, headers);
    expect(status).toBe(201);
    expect(body.data.item).toMatchObject({
      id: item.id,
      pantry: { kind: "group", orgId: flat.publicId, name: "Flat 4B" },
      paidBy: RAHUL,
      createdBy: RAHUL,
      qtyLeftMilli: 1_000_000,
      worthMinor: 12500,
      wastePolicy: "split_equally",
      wastePolicyOverride: null,
      version: 2,
    });
    expect(body.data.move).toMatchObject({ kind: "transfer", qtyMilli: 1_000_000, unit: "kg", costMinor: 0, actor: RAHUL, txnId: null });
    expect(body.data.txn).toBeNull();
    expect((await call("GET", me(`items/${item.id}`), RAHUL)).status).toBe(404);
    expect((await readItem(ANU, flat, item)).paidBy).toBe(RAHUL);

    const moved = events("kitchen.item.transferred");
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ actor_id: RAHUL, org_id: flat.id, subject_id: uuidOf(item.id) });

    // A retry answers with the move it made.
    const again = await transfer(RAHUL, item, flat.publicId, headers);
    expect(again.status).toBe(201);
    expect(again.body.data.move.id).toBe(body.data.move.id);
    expect(count("kitchen_stock_moves")).toBe(1);

    // Now it is the group's: using it pays Rahul back.
    const used = await use(ANU, flat, item, { quantity: "250", unit: "g" });
    expect(used.body.data.txn!.splits).toEqual([
      { subjectId: RAHUL, paidMinor: 3125, owedMinor: 0 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 3125 },
    ]);
    expect((await history(VIEWER, flat, item)).map((m) => m.kind)).toEqual(["use", "transfer"]);
  });

  it("fixes a new group's currency with the item, as its first item would", async () => {
    const fresh = newGroup("New flat");
    h.grant(RAHUL, fresh, "owner");
    await transfer(RAHUL, await myItem(RAHUL, rice), fresh.publicId);
    const settings = await call<KitchenSettings>("GET", groupPath(fresh, "settings"), RAHUL);
    expect(settings.body.data).toMatchObject({ currency: "INR", updatedAt: NOW.toISOString() });
  });

  it("needs kitchen.item.create in the group: a group I only view, or am not in, is the opaque 404", async () => {
    const item = await myItem(RAHUL, rice);
    for (const g of [lunch, elsewhere]) {
      const res = await transfer(RAHUL, item, g.publicId);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "not_found", message: "Not found" });
    }
    expect(h.decisions.at(-1)?.request.action).toBe("kitchen.item.create");
    expect((await readItem(RAHUL, null, item)).pantry.kind).toBe("personal");
    expect(count("kitchen_stock_moves")).toBe(0);
  });

  it("refuses an item in another currency, one already used, another person's, and a malformed group", async () => {
    const dollars = await myItem(RAHUL, { ...rice, currency: "USD" });
    const other = await transfer(RAHUL, dollars, flat.publicId);
    expect(other.status).toBe(422);
    expect(other.body.error.details).toEqual({ reason: "currency_mismatch", currency: "INR" });

    const used = await myItem(RAHUL, rice);
    await useMine(RAHUL, used, { quantity: "1", unit: "g" });
    const refused = await transfer(RAHUL, used, flat.publicId);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual({ reason: "item_used" });

    expect((await transfer(ANU, await myItem(RAHUL, rice), flat.publicId)).status).toBe(404);
    for (const orgId of ["flat-4b", 42, undefined]) {
      const res = await transfer(RAHUL, dollars, orgId);
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields).toHaveProperty(["orgId"]);
    }
    expect(count("kitchen_stock_moves")).toBe(1);
  });
});

describe("undo", () => {
  it("puts a use's stock back when its transaction is reversed, in the same write, and restores every balance", async () => {
    const item = await groupItem(MEERA, flat);
    const used = await use(RAHUL, flat, item, { quantity: "1", unit: "L", consumers: [RAHUL, ANU] });
    expect(used.body.data.item).toMatchObject({ qtyLeftMilli: 0, state: "used_up", worthMinor: 0 });

    const reversal = await reverse(RAHUL, flat, used.body.data.txn!.id);
    expect(reversal.status).toBe(201);
    expect(await readItem(MEERA, flat, item)).toMatchObject({ qtyLeftMilli: 1_000_000, worthMinor: 6000, state: "active", version: 3 });
    expect(await balances(flat)).toEqual({});

    const [back, original] = await history(MEERA, flat, item);
    expect(back).toMatchObject({
      kind: "reversal",
      reverses: used.body.data.move.id,
      txnId: reversal.body.data.txn.id,
      qtyMilli: 1_000_000,
      costMinor: 6000,
      actor: RAHUL,
      consumers: null,
      undone: false,
    });
    expect(original).toMatchObject({ id: used.body.data.move.id, undone: true, undoneBy: back!.id });

    // The reversal cannot itself be reversed: that would take the stock again.
    const before = written();
    const again = await reverse(RAHUL, flat, reversal.body.data.txn.id);
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ reason: "not_reversible" });
    expect((await reverse(RAHUL, flat, used.body.data.txn!.id)).body.error.details).toMatchObject({ reason: "already_reversed" });
    expect(written()).toEqual(before);

    // And the item is whole again: the last use costs its full price.
    expect((await use(ANU, flat, item, { quantity: "1", unit: "L" })).body.data.move.costMinor).toBe(6000);
  });

  it("keeps the paise invariant whichever use is reversed", async () => {
    const item = await groupItem(MEERA, flat);
    const first = await use(ANU, flat, item, { quantity: "250", unit: "ml" });
    await use(DEV, flat, item, { quantity: "750", unit: "ml" });
    await reverse(ANU, flat, first.body.data.txn!.id);
    expect(await readItem(MEERA, flat, item)).toMatchObject({ qtyLeftMilli: 250_000, worthMinor: 1500, state: "active" });
    const last = await use(RAHUL, flat, item, { quantity: "250", unit: "ml" });
    expect(last.body.data.move.costMinor).toBe(1500);
    const moves = await history(MEERA, flat, item);
    const inEffect = moves.filter((m) => m.kind !== "reversal" && !m.undone);
    expect(inEffect.reduce((a, m) => a + m.costMinor, 0)).toBe(6000);
    expect(await balances(flat)).toEqual({ [MEERA]: 6000, [DEV]: -4500, [RAHUL]: -1500 });
  });

  it("puts wasted stock back when the waste transaction is reversed", async () => {
    const item = await groupItem(MEERA, flat);
    const wasted = await waste(MEERA, flat, item);
    const reversal = await reverse(MEERA, flat, wasted.body.data.txn!.id);
    expect(reversal.status).toBe(201);
    expect(await readItem(MEERA, flat, item)).toMatchObject({ qtyLeftMilli: 1_000_000, state: "active", worthMinor: 6000 });
    expect(await balances(flat)).toEqual({});
  });

  it("undoes a personal use or waste, latest first, once", async () => {
    const item = await myItem(RAHUL);
    const a = await useMine(RAHUL, item, { quantity: "100", unit: "g" });
    tick();
    const b = await useMine(RAHUL, item, { quantity: "400", unit: "g" });
    expect(b.body.data.item.state).toBe("used_up");

    const early = await undoMine(RAHUL, a.body.data.move.id);
    expect(early.status).toBe(409);
    expect(early.body.error.details).toEqual({ reason: "not_latest", latestMoveId: b.body.data.move.id });

    tick();
    const headers = { "idempotency-key": "undo-b" };
    const undone = await undoMine(RAHUL, b.body.data.move.id, headers);
    expect(undone.status).toBe(201);
    expect(undone.body.data).toMatchObject({
      item: { qtyLeftMilli: 400_000, state: "active", worthMinor: 7920 },
      move: { kind: "reversal", reverses: b.body.data.move.id, qtyMilli: 400_000, costMinor: 7920, unit: "g" },
      txn: null,
    });
    const replay = await undoMine(RAHUL, b.body.data.move.id, headers);
    expect(replay.status).toBe(201);
    expect(replay.body.data.move.id).toBe(undone.body.data.move.id);
    const twice = await undoMine(RAHUL, b.body.data.move.id);
    expect(twice.status).toBe(409);
    expect(twice.body.error.details).toEqual({ reason: "already_reversed", undoneBy: undone.body.data.move.id });
    const ofUndo = await undoMine(RAHUL, undone.body.data.move.id);
    expect(ofUndo.body.error.details).toEqual({ reason: "not_reversible" });

    // Now the first use is the latest still in effect.
    expect((await undoMine(ANU, a.body.data.move.id)).status).toBe(404);
    const first = await undoMine(RAHUL, a.body.data.move.id);
    expect(first.body.data.item).toMatchObject({ qtyLeftMilli: 500_000, worthMinor: 9900, state: "active" });

    const wasted = await wasteMine(RAHUL, item);
    expect((await undoMine(RAHUL, wasted.body.data.move.id)).body.data.item).toMatchObject({ qtyLeftMilli: 500_000, state: "active" });
    expect(count("events_event_log")).toBe(0);
  });

  it("undoes a group move that moved no money; one that did is undone by reversing its transaction", async () => {
    const item = await groupItem(MEERA, flat);
    const own = await use(MEERA, flat, item, { quantity: "250", unit: "ml" });
    expect(own.body.data.txn).toBeNull();

    const byDev = await undoGroup(DEV, flat, own.body.data.move.id);
    expect(byDev.status).toBe(403);
    expect(byDev.body.error.details).toEqual({ reason: "not_creator" });
    expect((await undoGroup(VIEWER, flat, own.body.data.move.id)).status).toBe(404);
    expect((await undoGroup(OUTSIDER, flat, own.body.data.move.id)).status).toBe(404);

    const undone = await undoGroup(MEERA, flat, own.body.data.move.id);
    expect(undone.status).toBe(201);
    expect(undone.body.data).toMatchObject({ item: { qtyLeftMilli: 1_000_000, worthMinor: 6000 }, move: { kind: "reversal" }, txn: null });
    expect(events("kitchen.move.undone")).toHaveLength(1);

    tick();
    const shared = await use(ANU, flat, item, { quantity: "250", unit: "ml" });
    const refused = await undoGroup(ANU, flat, shared.body.data.move.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual({ reason: "has_transaction", txnId: shared.body.data.txn!.id });

    // An owner or admin may undo anyone's.
    tick();
    const again = await use(MEERA, flat, item, { quantity: "100", unit: "ml" });
    expect((await undoGroup(ADMIN, flat, again.body.data.move.id)).status).toBe(201);
    expect((await readItem(MEERA, flat, item)).qtyLeftMilli).toBe(750_000);
  });

  it("refuses to undo a transfer", async () => {
    const item = await myItem(RAHUL);
    const moved = await transfer(RAHUL, item, flat.publicId);
    const res = await undoGroup(RAHUL, flat, moved.body.data.move.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "not_reversible" });
    expect((await undoMine(RAHUL, moved.body.data.move.id)).status).toBe(404);
  });
});

describe("history", () => {
  it("lists an item's moves newest first, for every member, with who had it and what each cost", async () => {
    const item = await groupItem(MEERA, flat);
    const a = await use(ANU, flat, item, { quantity: "250", unit: "ml", consumers: [ANU, DEV] });
    tick();
    const b = await use(MEERA, flat, item, { quantity: "100", unit: "ml" });
    tick();
    const c = await waste(MEERA, flat, item, { quantity: "50", unit: "ml" });

    const moves = await history(VIEWER, flat, item);
    expect(moves.map((m) => m.id)).toEqual([c.body.data.move.id, b.body.data.move.id, a.body.data.move.id]);
    expect(moves[2]).toEqual({
      id: a.body.data.move.id,
      itemId: item.id,
      kind: "use",
      qtyMilli: 250_000,
      quantity: 250,
      unit: "ml",
      label: null,
      costMinor: 1500,
      actor: ANU,
      consumers: [ANU, DEV],
      txnId: a.body.data.txn!.id,
      reverses: null,
      at: NOW.toISOString(),
      undone: false,
      undoneBy: null,
    });
    expect(moves[1]).toMatchObject({ consumers: [MEERA], txnId: null });
    expect(await history(VIEWER, flat, item, "?limit=2")).toHaveLength(2);
    expect((await call("GET", groupPath(flat, `items/${item.id}/moves?limit=0`), VIEWER)).status).toBe(422);
    expect((await call("GET", groupPath(flat, `items/${item.id}/moves`), OUTSIDER)).status).toBe(404);
  });

  it("shows a personal item's history to its owner only", async () => {
    const item = await myItem(RAHUL);
    await useMine(RAHUL, item, { quantity: "2", unit: "g" });
    expect((await history(RAHUL, null, item)).map((m) => m.kind)).toEqual(["use"]);
    expect((await call("GET", me(`items/${item.id}/moves`), ANU)).status).toBe(404);
  });
});

describe("GET /v1/kitchen/me/usuals", () => {
  it("ranks what I use most, then most recently, with how much and for whom the last time", async () => {
    const myOats = await myItem(RAHUL);
    const rice = await myItem(RAHUL, { name: "Rice", category: "Grains", quantity: "5", unit: "kg", priceMinor: 40000 });
    const tea = await myItem(RAHUL, { name: "Tea", category: "Drinks", quantity: "100", unit: "g", priceMinor: 2000 });
    const flatMilk = await groupItem(MEERA, flat, { ...milk, quantity: "5" });
    const bread = await groupItem(MEERA, flat, { name: "Bread", category: "Bakery", quantity: "1", unit: "pack", priceMinor: 4500 });
    const flour = await groupItem(ANU, lunch, { name: "Flour", category: "Grains", quantity: "5", unit: "kg", priceMinor: 24000 });

    // Long ago: too old to be usual.
    clock = new Date(NOW.getTime() - 100 * DAY);
    await use(RAHUL, flat, bread, { quantity: "0.1" });
    await use(RAHUL, flat, bread, { quantity: "0.1" });
    clock = NOW;

    for (const grams of ["50", "50", "30"]) {
      tick();
      await useMine(RAHUL, myOats, { quantity: grams, unit: "g" });
    }
    tick();
    await useMine(RAHUL, rice, { quantity: "0.5", unit: "kg" });
    tick();
    await use(RAHUL, flat, flatMilk, { quantity: "200", unit: "ml" });
    tick();
    await use(ANU, flat, flatMilk, { quantity: "250", unit: "ml", consumers: [ANU, RAHUL] });
    tick();
    await use(RAHUL, flat, flatMilk, { quantity: "100", unit: "ml", consumers: [ANU] });
    // Undone, used up, or in a group where I only read: not usual.
    tick();
    const undone = await use(RAHUL, flat, bread, { quantity: "0.2" });
    await reverse(RAHUL, flat, undone.body.data.txn!.id);
    await useMine(RAHUL, tea, { quantity: "100", unit: "g" });
    await use(ANU, lunch, flour, { quantity: "100", unit: "g", consumers: [ANU, RAHUL] });
    const lastMilk = clock;

    const { status, body } = await call<UsualsResponse>("GET", me("usuals"), RAHUL);
    expect(status).toBe(200);
    expect(body.data.usuals).toEqual([
      {
        itemId: flatMilk.id,
        name: "Milk",
        pantry: { kind: "group", orgId: flat.publicId, slug: flat.slug, name: "Flat 4B" },
        lastQtyMilli: 100_000,
        lastQuantity: 100,
        lastUnit: "ml",
        lastLabel: null,
        consumers: [ANU],
        usedCount: 3,
        lastUsedAt: new Date(lastMilk.getTime() - MINUTE).toISOString(),
        qtyLeftMilli: 5_000_000 - 550_000,
        measures: [],
        // All three at 08:0x UTC, morning at the default tzOffset=0: three
        // different amounts, so the most recent wins (PN-2).
        now: { bucket: "morning", qtyMilli: 100_000, quantity: 100, unit: "ml", label: null, consumerIds: [ANU], count: 3 },
        strip: true,
      },
      {
        itemId: myOats.id,
        name: "Oats",
        pantry: { kind: "personal", name: "My pantry" },
        lastQtyMilli: 30_000,
        lastQuantity: 30,
        lastUnit: "g",
        lastLabel: null,
        consumers: [RAHUL],
        usedCount: 3,
        lastUsedAt: new Date(NOW.getTime() + 3 * MINUTE).toISOString(),
        qtyLeftMilli: 370_000,
        measures: [],
        // 50 g twice and 30 g once: the most frequent amount (PN-2).
        now: { bucket: "morning", qtyMilli: 50_000, quantity: 50, unit: "g", label: null, consumerIds: [RAHUL], count: 3 },
        strip: true,
      },
      expect.objectContaining({ itemId: rice.id, usedCount: 1, lastQuantity: 0.5, lastUnit: "kg" }),
    ]);

    const one = await call<UsualsResponse>("GET", me("usuals?limit=1"), RAHUL);
    expect(one.body.data.usuals.map((u) => u.name)).toEqual(["Milk"]);
    expect((await call("GET", me("usuals?limit=0"), RAHUL)).status).toBe(422);
    // Anu's: the milk she had with me, and the flour she logged.
    const anus = await call<UsualsResponse>("GET", me("usuals"), ANU);
    expect(anus.body.data.usuals.map((u) => [u.name, u.usedCount])).toEqual([["Milk", 2], ["Flour", 1]]);
  });

  it("is empty for someone who has used nothing, and 503 when membership cannot say which groups they are in", async () => {
    expect((await call<UsualsResponse>("GET", me("usuals"), "usr_new")).body.data.usuals).toEqual([]);
    h.failGroups = true;
    expect((await call("GET", me("usuals"), RAHUL)).status).toBe(503);
  });
});

describe("usable items: canUse and usable=1", () => {
  async function stock() {
    return {
      oats: await myItem(RAHUL),
      milk: await groupItem(MEERA, flat),
      flour: await groupItem(ANU, lunch, { name: "Flour", category: "Grains", quantity: "5", unit: "kg", priceMinor: 24000 }),
    };
  }

  it("says which items I may use, and usable=1 keeps only those", async () => {
    const { oats: mine, milk: shared, flour } = await stock();
    const all = await call<ReachableItemsPage>("GET", me("items"), RAHUL);
    expect(Object.fromEntries(all.body.data.items.map((i) => [i.name, i.canUse]))).toEqual({ Oats: true, Milk: true, Flour: false });

    const usable = await call<ReachableItemsPage>("GET", me("items?usable=1"), RAHUL);
    expect(usable.body.data.items.map((i) => i.id).sort()).toEqual([mine.id, shared.id].sort());
    expect(usable.body.data.items.every((i) => i.canUse)).toBe(true);
    expect((await call<ReachableItemsPage>("GET", me(`items?pantry=${lunch.publicId}&usable=1`), RAHUL)).body.data.items).toEqual([]);
    expect((await call<ReachableItemsPage>("GET", me(`items?pantry=${lunch.publicId}`), RAHUL)).body.data.items.map((i) => i.id)).toEqual([
      flour.id,
    ]);

    const found = await call<SearchItemsResponse>("GET", me("search?q="), RAHUL);
    expect(found.body.data.items.find((i) => i.id === flour.id)?.canUse).toBe(false);
    const usableFound = await call<SearchItemsResponse>("GET", me("search?q=&usable=true"), RAHUL);
    expect(usableFound.body.data.items.map((i) => i.id)).not.toContain(flour.id);
    expect(usableFound.body.data.items).toHaveLength(2);

    // A viewer of Flat 4B reads its milk but may not use it.
    const viewer = await call<ReachableItemsPage>("GET", me("items"), VIEWER);
    expect(viewer.body.data.items.map((i) => [i.name, i.canUse])).toEqual([["Milk", false]]);
    expect((await call<ReachableItemsPage>("GET", me("items?usable=1"), VIEWER)).body.data.items).toEqual([]);
    // …and indeed may not.
    expect((await use(RAHUL, lunch, flour, { quantity: "1", unit: "g" })).status).toBe(404);
  });

  it("is 422 for a usable that is not 1 or 0", async () => {
    await stock();
    for (const path of ["items?usable=maybe", "search?usable=yes"]) {
      const res = await call("GET", me(path), RAHUL);
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields).toHaveProperty(["usable"]);
    }
    expect((await call("GET", me("items?usable=0"), RAHUL)).status).toBe(200);
  });

  it("decides canUse with the roles the policy engine grants kitchen.item.use", () => {
    for (const role of ["owner", "admin", "builder", "viewer", "billing_admin"] as OrganizationRole[]) {
      const decision = authorize({
        subject: { type: "user", id: "usr_x" },
        action: "kitchen.item.use",
        resource: { kind: "organization", orgId: "org" },
        context: { memberships: [{ kind: "role_assignment", role, scope: { kind: "organization", orgId: "org" } }] },
      });
      expect([role, USE_ROLES.has(role)]).toEqual([role, decision.allow]);
    }
  });
});
