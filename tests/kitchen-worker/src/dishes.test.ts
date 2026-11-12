// Cooking (CP-14): a dish from any mix of pantries — the cook's own, group
// pantries they may use, and things just bought — through the router, against
// real SQLite (every migration applied), the real policy grants and
// membership's answers. design.md §3's worked example is cooked end to end.

import type {
  ActivityPage,
  BalancesResponse,
  DishResponse,
  DishesPage,
  KitchenDish,
  KitchenItem,
  KitchenItemResponse,
  KitchenTxn,
  MovesResponse,
  ReachableItemsPage,
} from "@saas/contracts/kitchen";
import type { DatabaseSync } from "node:sqlite";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";
import { paneerButterMasalaBody, stockWorkedExample, type WorkedExamplePantries } from "./worked-example-fixtures.js";

const NOW = new Date("2026-11-02T12:00:00.000Z");

const RAHUL = "usr_rahul"; // cooks; builder in Flat 4B and the Lunch club, viewer in the Book club
const ANU = "usr_anu";
const DEV = "usr_dev";
const MEERA = "usr_meera";
const KIRAN = "usr_kiran"; // the Lunch club only
const OUTSIDER = "usr_outsider";

let h: Harness;
let clock: Date;
let flat: Group;
let lunch: Group;
let books: Group;
let elsewhere: Group;

beforeEach(() => {
  clock = NOW;
  h = createHarness({ deps: { now: () => clock } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  books = newGroup("Book club");
  elsewhere = newGroup("Another flat");
  h.grant(RAHUL, flat, "builder");
  h.grant(ANU, flat, "owner");
  h.grant(DEV, flat, "builder");
  h.grant(MEERA, flat, "builder");
  h.grant(KIRAN, lunch, "owner");
  h.grant(RAHUL, lunch, "builder");
  h.grant(MEERA, books, "owner");
  h.grant(RAHUL, books, "viewer");
  h.grant(OUTSIDER, elsewhere, "owner");
});

afterEach(() => h.close());

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

async function groupItem(as: string, g: Group, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, { category: "Veg", ...body });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function myItem(as: string, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", me("items"), as, { category: "Dairy", ...body });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

const cook = (as: string, body: unknown, headers?: Record<string, string>) =>
  call<DishResponse>("POST", me("dishes"), as, body, headers);

async function readItem(as: string, g: Group | null, item: KitchenItem): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("GET", g ? groupPath(g, `items/${item.id}`) : me(`items/${item.id}`), as);
  expect(res.status).toBe(200);
  return res.body.data.item;
}

/** Every non-zero balance in the group (they always add up to zero). */
async function balances(g: Group, as: string): Promise<Record<string, number>> {
  const res = await call<BalancesResponse>("GET", groupPath(g, "balances"), as);
  expect(res.status).toBe(200);
  const all = res.body.data.balances;
  expect(all.reduce((a, b) => a + b.balanceMinor, 0)).toBe(0);
  return Object.fromEntries(all.filter((b) => b.balanceMinor !== 0).map((b) => [b.subjectId, b.balanceMinor]));
}

async function activity(g: Group, as: string): Promise<KitchenTxn[]> {
  const res = await call<ActivityPage>("GET", groupPath(g, "activity"), as);
  expect(res.status).toBe(200);
  return res.body.data.items;
}

function count(table: string, where = ""): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number }).n;
}

/** What a refused cook must leave untouched. */
function written(): Record<string, number> {
  return {
    dishes: count("kitchen_dishes"),
    ingredients: count("kitchen_dish_ingredients"),
    moves: count("kitchen_stock_moves"),
    txns: count("kitchen_txns"),
    items: count("kitchen_items"),
    events: count("events_event_log"),
  };
}

// ── design.md §3's worked example ─────────────────────────────

type Pantries = WorkedExamplePantries;

/** Rahul's paneer and butter; Anu's tomatoes and Dev's onions in Flat 4B; Kiran's chapati flour in the Lunch club. */
function stock(): Promise<Pantries> {
  return stockWorkedExample({ myItem, groupItem }, { flat, lunch }, { rahul: RAHUL, anu: ANU, dev: DEV, kiran: KIRAN });
}

/** Paneer butter masala with rotis, shared with Flat 4B for claims; the cream is bought on the way. */
function paneerButterMasala(p: Pantries, overrides: Record<string, unknown> = {}) {
  return paneerButterMasalaBody(p, flat, overrides);
}

describe("the worked example (design.md §3), cooked through the routes", () => {
  it("costs ₹211.00 for 4 portions and charges Rahul ₹12.00 (Anu) and ₹7.00 (Dev) in Flat 4B and ₹24.00 (Kiran) in the Lunch club", async () => {
    const p = await stock();
    const res = await cook(RAHUL, paneerButterMasala(p), { "idempotency-key": "cook-paneer" });
    expect(res.status).toBe(201);
    const dish = res.body.data.dish;
    expect(dish).toMatchObject({
      cook: RAHUL,
      orgId: flat.publicId,
      name: "Paneer butter masala with rotis",
      portionsHalf: 8,
      portions: 4,
      extrasMinor: 1500,
      ingredientsMinor: 19600,
      totalMinor: 21100,
      currency: "INR",
      splitMode: "claims",
      state: "open",
      txnId: null,
      leftoverItemId: null,
      cookedAt: NOW.toISOString(),
      finalizedAt: null,
      canceledAt: null,
      fromMineMinor: 15300,
      owes: [
        { orgId: flat.publicId, buyerId: ANU, amountMinor: 1200 },
        { orgId: flat.publicId, buyerId: DEV, amountMinor: 700 },
        { orgId: lunch.publicId, buyerId: KIRAN, amountMinor: 2400 },
      ],
    });
    expect(dish.id).toMatch(/^dsh_[0-9a-f]{32}$/);
    expect(dish.ingredients.map((i) => [i.name, i.orgId, i.paidBy, i.quantity, i.unit, i.costMinor])).toEqual([
      ["Paneer", null, RAHUL, 200, "g", 9500],
      ["Butter", null, RAHUL, 100, "g", 2800],
      ["Tomatoes", flat.publicId, ANU, 300, "g", 1200],
      ["Onions", flat.publicId, DEV, 0.2, "kg", 700],
      ["Chapati flour", lunch.publicId, KIRAN, 0.5, "kg", 2400],
      ["Cream", null, RAHUL, 200, "ml", 3000],
    ]);

    // At cook time: one `use` transaction per source group, charging the cook.
    const [flatTake] = await activity(flat, MEERA);
    expect(flatTake).toMatchObject({ kind: "use", totalMinor: 1900, sourceKind: "dish", sourceId: dish.id, createdBy: RAHUL });
    expect(flatTake!.splits).toEqual([
      { subjectId: ANU, paidMinor: 1200, owedMinor: 0 },
      { subjectId: DEV, paidMinor: 700, owedMinor: 0 },
      { subjectId: RAHUL, paidMinor: 0, owedMinor: 1900 },
    ]);
    const lunchTakes = await activity(lunch, KIRAN);
    expect(lunchTakes).toHaveLength(1);
    expect(lunchTakes[0]!.splits).toEqual([
      { subjectId: KIRAN, paidMinor: 2400, owedMinor: 0 },
      { subjectId: RAHUL, paidMinor: 0, owedMinor: 2400 },
    ]);
    expect(dish.ingredients.find((i) => i.name === "Tomatoes")!.useTxnId).toBe(flatTake!.id);
    expect(dish.ingredients.find((i) => i.name === "Chapati flour")!.useTxnId).toBe(lunchTakes[0]!.id);
    expect(dish.ingredients.filter((i) => i.orgId === null).every((i) => i.useTxnId === null)).toBe(true);

    expect(await balances(flat, ANU)).toEqual({ [ANU]: 1200, [DEV]: 700, [RAHUL]: -1900 });
    expect(await balances(lunch, KIRAN)).toEqual({ [KIRAN]: 2400, [RAHUL]: -2400 });

    // One audit event in each group the dish touched, each telling that group's part.
    const events = h.db
      .prepare("SELECT org_id, payload FROM events_event_log WHERE type = 'kitchen.dish.cooked'")
      .all() as Array<{ org_id: string; payload: string }>;
    const told = Object.fromEntries(events.map((e) => [e.org_id, JSON.parse(e.payload) as Record<string, unknown>]));
    expect(Object.keys(told).sort()).toEqual([flat.id, lunch.id].sort());
    expect(told[flat.id]).toMatchObject({
      dishId: dish.id, cook: RAHUL, shared: true, totalMinor: 21100, portionsHalf: 8, txnId: flatTake!.id,
      ingredients: [
        { itemId: p.tomatoes.id, qtyMilli: 300_000, costMinor: 1200, paidBy: ANU },
        { itemId: p.onions.id, qtyMilli: 200_000, costMinor: 700, paidBy: DEV },
      ],
    });
    expect(told[lunch.id]).toMatchObject({ dishId: dish.id, shared: false, txnId: lunchTakes[0]!.id });
    expect(told[lunch.id]).not.toHaveProperty("totalMinor");
  });

  it("takes stock out of all three pantries, and files the cream in Rahul's own", async () => {
    const p = await stock();
    const res = await cook(RAHUL, paneerButterMasala(p));
    expect(res.status).toBe(201);
    const dish = res.body.data.dish;

    expect(await readItem(RAHUL, null, p.paneer)).toMatchObject({ qtyLeftMilli: 0, worthMinor: 0, state: "used_up" });
    expect(await readItem(RAHUL, null, p.butter)).toMatchObject({ qtyLeftMilli: 400_000, worthMinor: 11200, state: "active" });
    expect(await readItem(ANU, flat, p.tomatoes)).toMatchObject({ qtyLeftMilli: 700_000, worthMinor: 2800 });
    expect(await readItem(DEV, flat, p.onions)).toMatchObject({ qtyLeftMilli: 800_000, worthMinor: 2800 });
    expect(await readItem(KIRAN, lunch, p.flour)).toMatchObject({ qtyLeftMilli: 4_500_000, worthMinor: 21600 });

    const cream = dish.ingredients.find((i) => i.name === "Cream")!;
    const bought = await readItem(RAHUL, null, { id: cream.itemId } as KitchenItem);
    expect(bought).toMatchObject({
      pantry: { kind: "personal" }, name: "Cream", category: "Other", qtyBoughtMilli: 200_000, qtyLeftMilli: 0,
      priceMinor: 3000, currency: "INR", paidBy: RAHUL, createdBy: RAHUL, boughtOn: "2026-11-02", state: "used_up",
    });

    // Each pantry's history shows the dish, with the charge when there was one.
    const moves = await call<MovesResponse>("GET", groupPath(flat, `items/${p.tomatoes.id}/moves`), ANU);
    expect(moves.body.data.moves).toEqual([
      expect.objectContaining({ kind: "dish", qtyMilli: 300_000, unit: "g", costMinor: 1200, actor: RAHUL, txnId: dish.ingredients[2]!.useTxnId }),
    ]);
    const mine = await call<MovesResponse>("GET", me(`items/${p.butter.id}/moves`), RAHUL);
    expect(mine.body.data.moves).toEqual([expect.objectContaining({ kind: "dish", costMinor: 2800, txnId: null })]);
  });

  it("is read by its cook and the group it is shared with, not by the Lunch club", async () => {
    const p = await stock();
    const { body } = await cook(RAHUL, paneerButterMasala(p));
    const dish = body.data.dish;

    for (const who of [RAHUL, ANU, MEERA]) {
      const one = await call<DishResponse>("GET", me(`dishes/${dish.id}`), who);
      expect(one.status).toBe(200);
      expect(one.body.data.dish).toEqual(dish);
      const mine = await call<DishesPage>("GET", me("dishes"), who);
      expect(mine.body.data.dishes.map((d) => d.id)).toEqual([dish.id]);
    }
    // Kiran's flour went into it, but it is shared with Flat 4B: the charge is in his activity, the dish is not his to see.
    expect((await call("GET", me(`dishes/${dish.id}`), KIRAN)).status).toBe(404);
    expect((await call<DishesPage>("GET", me("dishes"), KIRAN)).body.data.dishes).toEqual([]);

    const shared = await call<DishesPage>("GET", groupPath(flat, "dishes"), DEV);
    expect(shared.status).toBe(200);
    expect(shared.body.data.dishes.map((d) => d.id)).toEqual([dish.id]);
    expect((await call<DishesPage>("GET", groupPath(lunch, "dishes"), KIRAN)).body.data.dishes).toEqual([]);
    expect((await call("GET", groupPath(flat, "dishes"), OUTSIDER)).status).toBe(404);
  });
});

// ── Refusals: nothing is written ──────────────────────────────

describe("refusing a dish writes nothing", () => {
  it("refuses ingredients in another currency, or not in the shared group's", async () => {
    const p = await stock();
    const dollars = await myItem(RAHUL, { name: "Maple syrup", quantity: "250", unit: "ml", priceMinor: 900, currency: "USD" });
    const usd = newGroup("Dollar house");
    h.grant(RAHUL, usd, "owner");
    expect((await call("PATCH", groupPath(usd, "settings"), RAHUL, { currency: "USD" })).status).toBe(200);
    const before = written();

    const mixed = await cook(RAHUL, {
      ...paneerButterMasala(p),
      ingredients: [{ itemId: p.tomatoes.id, quantity: "100", unit: "g" }, { itemId: dollars.id, quantity: "50", unit: "ml" }],
    });
    expect(mixed.status).toBe(422);
    expect(mixed.body.error.details).toEqual({ reason: "currency_mismatch", currency: "INR", itemIds: [dollars.id] });

    // Just for Rahul: the first ingredient's currency decides.
    const mine = await cook(RAHUL, {
      name: "Pancakes", portionsHalf: 2, splitMode: "assign",
      ingredients: [{ itemId: dollars.id, quantity: "50", unit: "ml" }, { itemId: p.butter.id, quantity: "20", unit: "g" }],
    });
    expect(mine.status).toBe(422);
    expect(mine.body.error.details).toMatchObject({ reason: "currency_mismatch", currency: "USD", itemIds: [p.butter.id] });

    // A group counting in dollars refuses rupee ingredients.
    const shared = await cook(RAHUL, {
      ...paneerButterMasala(p),
      orgId: usd.publicId,
      ingredients: [{ itemId: p.butter.id, quantity: "20", unit: "g" }],
      newItems: [],
    });
    expect(shared.status).toBe(422);
    expect(shared.body.error.details).toEqual({ reason: "currency_mismatch", currency: "USD", itemIds: [p.butter.id] });

    expect(written()).toEqual(before);
  });

  it("404s an ingredient from a group the cook is not in, or may only read; and a group to share with that is not theirs", async () => {
    const p = await stock();
    const theirs = await groupItem(OUTSIDER, elsewhere, { name: "Saffron", quantity: "1", unit: "g", priceMinor: 30000 });
    const readOnly = await groupItem(MEERA, books, { name: "Biscuits", quantity: "1", unit: "pack", priceMinor: 3000 });
    const before = written();

    for (const item of [theirs, readOnly]) {
      const res = await cook(RAHUL, paneerButterMasala(p, { ingredients: [{ itemId: p.paneer.id, quantity: "100", unit: "g" }, { itemId: item.id, quantity: "1" }] }));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    }
    // Rahul can read the Book club's pantry, but not use from it, nor cook for it.
    expect((await call<ReachableItemsPage>("GET", me(`items?pantry=${books.publicId}`), RAHUL)).body.data.items).toHaveLength(1);
    for (const g of [elsewhere, books]) {
      const res = await cook(RAHUL, { ...paneerButterMasala(p), orgId: g.publicId });
      expect(res.status).toBe(404);
    }
    // An item that does not exist reads the same.
    const missing = await cook(RAHUL, paneerButterMasala(p, { ingredients: [{ itemId: `itm_${"0".repeat(32)}`, quantity: "1" }] }));
    expect(missing.status).toBe(404);

    expect(written()).toEqual(before);
  });

  it("refuses an over-draw of any ingredient, taking nothing from the others", async () => {
    const p = await stock();
    const before = written();
    const res = await cook(RAHUL, paneerButterMasala(p, {
      ingredients: [{ itemId: p.tomatoes.id, quantity: "300", unit: "g" }, { itemId: p.onions.id, quantity: "1.5", unit: "kg" }],
    }));
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "insufficient_stock", itemId: p.onions.id, qtyLeftMilli: 1_000_000 });
    expect(written()).toEqual(before);
    expect(await readItem(ANU, flat, p.tomatoes)).toMatchObject({ qtyLeftMilli: 1_000_000, version: 1 });
  });

  it("refuses atomically when someone takes the stock between the read and the write", async () => {
    const p = await stock();
    const before = written();
    // Dev uses 900 g of his onions just as Rahul's dish is written: the dish
    // is planned again from a fresh read, and 200 g is no longer there.
    h.beforeNextBatch((db) => {
      db.prepare("UPDATE kitchen_items SET qty_left_milli = 100000, version = version + 1 WHERE name = 'Onions'").run();
    });
    const res = await cook(RAHUL, paneerButterMasala(p));
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "insufficient_stock", itemId: p.onions.id, qtyLeftMilli: 100_000 });
    expect(written()).toEqual(before);
    for (const [who, g, item] of [[RAHUL, null, p.paneer], [ANU, flat, p.tomatoes], [KIRAN, lunch, p.flour]] as const) {
      expect((await readItem(who, g, item)).qtyLeftMilli).toBe(item.qtyLeftMilli);
    }
    expect(await balances(flat, ANU)).toEqual({});
  });

  it("answers 409 stale when the items keep changing, and cooks once they settle", async () => {
    const p = await stock();
    const bump = (db: DatabaseSync) => {
      db.prepare("UPDATE kitchen_items SET version = version + 1 WHERE name = 'Tomatoes'").run();
    };
    h.beforeNextBatch(bump);
    h.beforeNextBatch(bump);
    const before = written();
    const raced = await cook(RAHUL, paneerButterMasala(p), { "idempotency-key": "cook-race" });
    expect(raced.status).toBe(409);
    expect(raced.body.error.details).toEqual({ reason: "stale" });
    expect(written()).toEqual(before);

    h.beforeNextBatch(bump);
    const settled = await cook(RAHUL, paneerButterMasala(p), { "idempotency-key": "cook-race" });
    expect(settled.status).toBe(201);
    expect(settled.body.data.dish.totalMinor).toBe(21100);
  });

  it("validates the body before reading anything", async () => {
    const p = await stock();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...paneerButterMasala(p), orgId: null }, "splitMode"], // claims need a group
      // No ingredients at all is a ₹0 dish (RV-7, tests/no-amounts): not a refusal.
      [{ ...paneerButterMasala(p), ingredients: "paneer" }, "ingredients"],
      [{ ...paneerButterMasala(p), portionsHalf: 0 }, "portionsHalf"],
      [{ ...paneerButterMasala(p), portionsHalf: 2.5 }, "portionsHalf"],
      [{ ...paneerButterMasala(p), extrasMinor: -1 }, "extrasMinor"],
      [{ ...paneerButterMasala(p), orgId: "flat-4b" }, "orgId"],
      [{ ...paneerButterMasala(p), ingredients: [{ itemId: p.paneer.id, quantity: "1" }, { itemId: p.paneer.id, quantity: "1" }] }, "ingredients"],
      [{ ...paneerButterMasala(p), ingredients: [{ itemId: "paneer", quantity: "1" }] }, "ingredients[0].itemId"],
      [{ ...paneerButterMasala(p), ingredients: [{ itemId: p.paneer.id, quantity: "1", unit: "spoon" }] }, "ingredients[0].unit"],
      [{ ...paneerButterMasala(p), newItems: [{ quantity: "1", unit: "L", priceMinor: 100 }] }, "newItems[0].name"],
      [{ ...paneerButterMasala(p), newItems: [{ name: "Cream", quantity: "200", unit: "ml", priceMinor: 3000, useQuantity: "250" }] }, "newItems[0].useQuantity"],
      [{ ...paneerButterMasala(p), newItems: [{ name: "Cream", quantity: "200", unit: "ml", priceMinor: 3000, useQuantity: "1", useUnit: "kg" }] }, "newItems[0].useUnit"],
    ];
    const before = written();
    for (const [body, field] of cases) {
      const res = await cook(RAHUL, body);
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.error.details.fields as Record<string, unknown>)).toContain(field);
    }
    // A unit that does not measure what the item does is refused once the item is read.
    const wrongDimension = await cook(RAHUL, paneerButterMasala(p, { ingredients: [{ itemId: p.paneer.id, quantity: "1", unit: "L" }] }));
    expect(wrongDimension.status).toBe(422);
    expect(Object.keys(wrongDimension.body.error.details.fields as Record<string, unknown>)).toEqual(["ingredients[0].unit"]);
    expect(written()).toEqual(before);
  });
});

// ── Just bought it, just for me, and the cook's own group items ──

describe("what a dish can be made of", () => {
  it("cooks from things just bought, for the cook alone: their pantry, no ledger, a draft", async () => {
    const res = await cook(RAHUL, {
      name: "Rice and dal",
      portionsHalf: 2,
      splitMode: "assign",
      newItems: [
        { name: "Rice", category: "Grains", quantity: "1", unit: "kg", priceMinor: 8000, useQuantity: "250", useUnit: "g", expiresOn: "2027-06-01" },
        { name: "Dal", quantity: "500", unit: "g", priceMinor: 6000, useQuantity: "0.1", useUnit: "kg" },
      ],
    });
    expect(res.status).toBe(201);
    const dish = res.body.data.dish;
    expect(dish).toMatchObject({
      orgId: null, state: "draft", splitMode: "assign", portions: 1, extrasMinor: 0,
      ingredientsMinor: 3200, totalMinor: 3200, fromMineMinor: 3200, owes: [],
    });
    const items = (await call<ReachableItemsPage>("GET", me("items?pantry=personal"), RAHUL)).body.data.items;
    expect(items.map((i) => [i.name, i.qtyBoughtMilli, i.qtyLeftMilli, i.worthMinor, i.paidBy, i.expiresOn])).toEqual([
      ["Rice", 1_000_000, 750_000, 6000, RAHUL, "2027-06-01"],
      ["Dal", 500_000, 400_000, 4800, RAHUL, null],
    ]);
    // A personal pantry is in no group: no transaction, no event.
    expect([count("kitchen_txns"), count("events_event_log")]).toEqual([0, 0]);
  });

  it("charges nobody for the cook's own purchases in a group, but still takes the stock", async () => {
    const rice = await groupItem(RAHUL, flat, { name: "Rice", category: "Grains", quantity: "5", unit: "kg", priceMinor: 50000 });
    const res = await cook(RAHUL, {
      name: "Jeera rice", orgId: flat.publicId, portionsHalf: 6, extrasMinor: 500, splitMode: "assign",
      ingredients: [{ itemId: rice.id, quantity: "500", unit: "g" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.dish).toMatchObject({
      state: "draft", ingredientsMinor: 5000, totalMinor: 5500, fromMineMinor: 5000, owes: [],
      ingredients: [expect.objectContaining({ orgId: flat.publicId, paidBy: RAHUL, useTxnId: null })],
    });
    expect(await activity(flat, ANU)).toEqual([]);
    expect((await readItem(RAHUL, flat, rice)).qtyLeftMilli).toBe(4_500_000);
    expect(count("events_event_log", "WHERE type = 'kitchen.dish.cooked'")).toBe(1);
  });

  it("charges the last of an item exactly what is left of its price", async () => {
    const tomatoes = await groupItem(ANU, flat, { name: "Tomatoes", quantity: "3", unit: "pcs", priceMinor: 1000 });
    const first = await call("POST", groupPath(flat, `items/${tomatoes.id}/uses`), ANU, { quantity: "1" });
    expect(first.status).toBe(201); // ₹3.33
    const res = await cook(RAHUL, {
      name: "Salad", orgId: flat.publicId, portionsHalf: 2, splitMode: "claims",
      ingredients: [{ itemId: tomatoes.id, quantity: "2" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.dish.owes).toEqual([{ orgId: flat.publicId, buyerId: ANU, amountMinor: 667 }]);
    expect(await readItem(ANU, flat, tomatoes)).toMatchObject({ qtyLeftMilli: 0, worthMinor: 0, state: "used_up" });
  });

  it("cooks once per Idempotency-Key", async () => {
    const p = await stock();
    const first = await cook(RAHUL, paneerButterMasala(p), { "idempotency-key": "cook-once" });
    expect(first.status).toBe(201);
    const after = written();
    const again = await cook(RAHUL, paneerButterMasala(p), { "idempotency-key": "cook-once" });
    expect(again.status).toBe(201);
    expect(again.body.data.dish).toEqual(first.body.data.dish);
    expect(written()).toEqual(after);
  });

  it("lists dishes newest first, by state, a page at a time", async () => {
    const rice = await myItem(RAHUL, { name: "Rice", category: "Grains", quantity: "5", unit: "kg", priceMinor: 50000 });
    const made: KitchenDish[] = [];
    for (const [i, splitMode] of (["assign", "claims", "assign"] as const).entries()) {
      clock = new Date(NOW.getTime() + i * 60_000);
      const res = await cook(RAHUL, {
        name: `Dish ${i}`, orgId: flat.publicId, portionsHalf: 2, splitMode,
        ingredients: [{ itemId: rice.id, quantity: "100", unit: "g" }],
      });
      expect(res.status).toBe(201);
      made.push(res.body.data.dish);
    }
    const all = await call<DishesPage>("GET", me("dishes"), RAHUL);
    expect(all.body.data.dishes.map((d) => d.name)).toEqual(["Dish 2", "Dish 1", "Dish 0"]);
    const drafts = await call<DishesPage>("GET", me("dishes?state=draft"), ANU);
    expect(drafts.body.data.dishes.map((d) => d.name)).toEqual(["Dish 2", "Dish 0"]);
    const open = await call<DishesPage>("GET", groupPath(flat, "dishes?state=open"), MEERA);
    expect(open.body.data.dishes.map((d) => d.id)).toEqual([made[1]!.id]);

    const page1 = await call<DishesPage>("GET", me("dishes?limit=2"), RAHUL);
    expect(page1.body.data.dishes.map((d) => d.name)).toEqual(["Dish 2", "Dish 1"]);
    expect(page1.body.meta.cursor).toBe(page1.body.data.nextCursor);
    const page2 = await call<DishesPage>("GET", me(`dishes?limit=2&cursor=${page1.body.data.nextCursor}`), RAHUL);
    expect(page2.body.data).toMatchObject({ dishes: [expect.objectContaining({ name: "Dish 0" })], nextCursor: null });

    for (const query of ["state=eaten", "limit=0", "cursor=nope"]) {
      expect((await call("GET", me(`dishes?${query}`), RAHUL)).status).toBe(422);
    }
  });
});

// ── Cancelling ────────────────────────────────────────────────

describe("cancelling a dish", () => {
  it("reverses every charge and puts every quantity back, in all three pantries", async () => {
    const p = await stock();
    const { body } = await cook(RAHUL, paneerButterMasala(p));
    const dish = body.data.dish;
    clock = new Date(NOW.getTime() + 3_600_000);

    const res = await call<DishResponse>("POST", me(`dishes/${dish.id}/cancel`), RAHUL, undefined, { "idempotency-key": "cancel-1" });
    expect(res.status).toBe(200);
    expect(res.body.data.dish).toMatchObject({ id: dish.id, state: "canceled", canceledAt: clock.toISOString(), totalMinor: 21100 });

    for (const [who, g, item] of [
      [RAHUL, null, p.paneer],
      [RAHUL, null, p.butter],
      [ANU, flat, p.tomatoes],
      [DEV, flat, p.onions],
      [KIRAN, lunch, p.flour],
    ] as const) {
      expect(await readItem(who, g, item)).toMatchObject({
        qtyLeftMilli: item.qtyBoughtMilli, worthMinor: item.priceMinor, state: "active",
      });
    }
    const cream = dish.ingredients.find((i) => i.name === "Cream")!;
    expect(await readItem(RAHUL, null, { id: cream.itemId } as KitchenItem)).toMatchObject({ qtyLeftMilli: 200_000, state: "active" });

    expect(await balances(flat, ANU)).toEqual({});
    expect(await balances(lunch, KIRAN)).toEqual({});
    const [reversal, original] = await activity(flat, DEV);
    expect(reversal).toMatchObject({ kind: "reversal", reverses: original!.id, sourceKind: "dish", sourceId: dish.id, createdBy: RAHUL });
    expect(original).toMatchObject({ reversed: true, reversedBy: reversal!.id });
    expect(count("events_event_log", "WHERE type = 'kitchen.dish.canceled'")).toBe(2);

    // Again: the dish is as it is, and nothing more is written.
    const after = written();
    const again = await call<DishResponse>("POST", me(`dishes/${dish.id}/cancel`), RAHUL);
    expect(again.status).toBe(200);
    expect(again.body.data.dish.state).toBe("canceled");
    expect(written()).toEqual(after);
  });

  it("is the cook's alone, and only until the dish is finalized", async () => {
    const p = await stock();
    const { body } = await cook(RAHUL, paneerButterMasala(p));
    const dish = body.data.dish;

    const member = await call("POST", me(`dishes/${dish.id}/cancel`), ANU);
    expect(member.status).toBe(403);
    expect(member.body.error.details).toEqual({ reason: "not_creator" });
    expect((await call("POST", me(`dishes/${dish.id}/cancel`), KIRAN)).status).toBe(404);
    expect((await call("POST", me(`dishes/dsh_${"0".repeat(32)}/cancel`), RAHUL)).status).toBe(404);

    // Finalizing arrives with CP-16; a finalized dish cannot be canceled.
    h.db.prepare("UPDATE kitchen_dishes SET state = 'finalized', finalized_at = ? WHERE cook = ?").run(NOW.toISOString(), RAHUL);
    const before = written();
    const late = await call("POST", me(`dishes/${dish.id}/cancel`), RAHUL);
    expect(late.status).toBe(409);
    expect(late.body.error.details).toEqual({ reason: "dish_not_open", state: "finalized" });
    expect(written()).toEqual(before);
  });

  it("is the only way back: the ledger's reverse refuses a dish's charge", async () => {
    const p = await stock();
    const { body } = await cook(RAHUL, paneerButterMasala(p));
    const [take] = await activity(flat, RAHUL);
    const res = await call("POST", groupPath(flat, `txns/${take!.id}/reverse`), RAHUL);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "not_reversible", dishId: body.data.dish.id });
    expect(await balances(flat, ANU)).toEqual({ [ANU]: 1200, [DEV]: 700, [RAHUL]: -1900 });
    // Nor can a dish's stock move be undone on its own.
    const moves = await call<MovesResponse>("GET", me(`items/${p.butter.id}/moves`), RAHUL);
    const undo = await call("POST", me(`moves/${moves.body.data.moves[0]!.id}/undo`), RAHUL);
    expect(undo.status).toBe(409);
    expect(undo.body.error.details).toEqual({ reason: "not_reversible" });
  });
});
