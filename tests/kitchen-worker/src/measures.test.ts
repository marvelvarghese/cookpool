// Your measures (SM-13, cookpool-simpler design §6): an item counted the way
// people eat it — "1 onion ≈ 150 g", "16 slices in a pack" — through the
// router, against real SQLite (every migration applied), the real policy
// grants and membership's answers. Setting a name's measures (who may, what
// is checked, which items read them), every item read carrying them in a
// bounded number of statements, and a use or a dish ingredient given in a
// measure: how much it takes, that its cost is any use's (exact to the paisa,
// a pack eaten slice by slice costing exactly what was paid), and that it
// keeps its words.

import type {
  ActivityPage,
  BalancesResponse,
  DishResponse,
  KitchenItem,
  KitchenItemResponse,
  KitchenMeasure,
  KitchenStockMove,
  KitchenTxn,
  MovesResponse,
  ReachableItemsPage,
  SearchItemsResponse,
  SetMeasuresResponse,
  StockMoveResponse,
  UsualsResponse,
} from "@saas/contracts/kitchen";
import { costOfUse } from "@saas/kitchen-engine/money";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-05T08:00:00.000Z");
const MINUTE = 60_000;

const ANU = "usr_anu"; // owner of Flat 4B; buys the onions and the bread
const RAHUL = "usr_rahul"; // builder in Flat 4B and the Lunch club
const DEV = "usr_dev"; // builder in Flat 4B
const VIEWER = "usr_viewer"; // reads Flat 4B's pantry, may not use it
const OUTSIDER = "usr_outsider"; // another flat altogether

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
  h.grant(ANU, flat, "owner");
  h.grant(RAHUL, flat, "builder");
  h.grant(DEV, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(RAHUL, lunch, "builder");
  h.grant(OUTSIDER, elsewhere, "owner");
  h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
  h.profile(RAHUL, { displayName: "Rahul", email: "rahul@example.com" });
  h.profile(DEV, { displayName: "Dev", email: "dev@example.com" });
});

afterEach(() => h.close());

function tick(): void {
  clock = new Date(clock.getTime() + MINUTE);
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

const onions = { name: "Onions", category: "Veg", quantity: "1", unit: "kg", priceMinor: 4000 }; // 1 kg for ₹40
const bread = { name: "Bread", category: "Bakery", quantity: "1", unit: "pack", priceMinor: 4500 }; // a pack for ₹45

const onion = { one: "onion", many: "onions", count: 1, amountMilli: 150_000 }; // 1 onion ≈ 150 g
const slice = { one: "slice", many: "slices", count: 16, amountMilli: 1_000 }; // 16 slices in a pack

async function groupItem(as: string, g: Group, body: Record<string, unknown> = onions): Promise<KitchenItem> {
  tick();
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function myItem(as: string, body: Record<string, unknown> = onions): Promise<KitchenItem> {
  tick();
  const res = await call<KitchenItemResponse>("POST", me("items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

/** PUT …/measures on a group's item, or (g null) on the caller's own. */
const setMeasures = (as: string, g: Group | null, item: KitchenItem, measures: unknown) =>
  call<SetMeasuresResponse>("PUT", g ? groupPath(g, `items/${item.id}/measures`) : me(`items/${item.id}/measures`), as, {
    measures,
  });

async function measuresOf(as: string, g: Group | null, item: KitchenItem): Promise<KitchenMeasure[] | undefined> {
  const res = await call<KitchenItemResponse>("GET", g ? groupPath(g, `items/${item.id}`) : me(`items/${item.id}`), as);
  expect(res.status).toBe(200);
  return res.body.data.item.measures;
}

type Moved = { status: number; body: Envelope<StockMoveResponse> };

const use = (as: string, g: Group, item: KitchenItem, body: unknown, headers?: Record<string, string>): Promise<Moved> => {
  tick();
  return call<StockMoveResponse>("POST", groupPath(g, `items/${item.id}/uses`), as, body, headers);
};
const useMine = (as: string, item: KitchenItem, body: unknown): Promise<Moved> => {
  tick();
  return call<StockMoveResponse>("POST", me(`items/${item.id}/uses`), as, body);
};

async function history(as: string, g: Group | null, item: KitchenItem): Promise<KitchenStockMove[]> {
  const res = await call<MovesResponse>("GET", g ? groupPath(g, `items/${item.id}/moves`) : me(`items/${item.id}/moves`), as);
  expect(res.status).toBe(200);
  return res.body.data.moves;
}

async function balances(g: Group): Promise<Record<string, number>> {
  const res = await call<BalancesResponse>("GET", groupPath(g, "balances"), ANU);
  expect(res.status).toBe(200);
  return Object.fromEntries(res.body.data.balances.filter((b) => b.balanceMinor !== 0).map((b) => [b.subjectId, b.balanceMinor]));
}

function count(table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** What every stock change writes: moves, transactions, their splits, events. */
function written(): Record<string, number> {
  return {
    moves: count("kitchen_stock_moves"),
    txns: count("kitchen_txns"),
    splits: count("kitchen_txn_splits"),
    events: count("events_event_log"),
    items: count("kitchen_items"),
    dishes: count("kitchen_dishes"),
  };
}

/** Count every statement the worker prepares on D1 from now on. */
function countStatements(): () => number {
  const real = h.env.PLATFORM_DB!;
  let statements = 0;
  (h.env as { PLATFORM_DB?: D1Database }).PLATFORM_DB = {
    prepare(query: string) {
      statements += 1;
      return real.prepare(query);
    },
    batch: (s: D1PreparedStatement[]) => real.batch(s),
  } as unknown as D1Database;
  return () => statements;
}

/** The measures as an answer shows them, without their ids. */
const words = (measures: readonly KitchenMeasure[] | undefined) =>
  (measures ?? []).map(({ one, many, count: n, amountMilli }) => ({ one, many, count: n, amountMilli }));

describe("PUT …/items/{itm}/measures", () => {
  it("sets, replaces and clears a name's measures in its pantry; a word kept keeps its id", async () => {
    const item = await groupItem(ANU, flat);
    expect(item.measures).toEqual([]);

    const first = await setMeasures(RAHUL, flat, item, [onion]);
    expect(first.status).toBe(200);
    expect(first.body.data.measures).toEqual([{ id: expect.stringMatching(/^msr_[0-9a-f]{32}$/), ...onion }]);
    expect(await measuresOf(VIEWER, flat, item)).toEqual(first.body.data.measures);
    const onionId = first.body.data.measures[0]!.id;

    // A heavier onion, and a second measure first: the onion keeps its id.
    const katori = { one: "katori", many: "katoris", count: 1, amountMilli: 120_000 };
    const second = await setMeasures(DEV, flat, item, [katori, { ...onion, amountMilli: 160_000 }]);
    expect(second.status).toBe(200);
    expect(words(second.body.data.measures)).toEqual([katori, { ...onion, amountMilli: 160_000 }]);
    expect(second.body.data.measures[1]!.id).toBe(onionId);
    expect(await measuresOf(ANU, flat, item)).toEqual(second.body.data.measures);
    // Who set it first, and who last.
    expect(h.db.prepare("SELECT created_by, updated_by FROM kitchen_measures WHERE one = 'onion'").get()).toEqual({
      created_by: RAHUL,
      updated_by: DEV,
    });

    // Words trimmed; an empty list removes them all.
    const trimmed = await setMeasures(ANU, flat, item, [{ ...onion, one: "  onion ", many: " onions" }]);
    expect(words(trimmed.body.data.measures)).toEqual([onion]);
    const cleared = await setMeasures(ANU, flat, item, []);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.measures).toEqual([]);
    expect(await measuresOf(ANU, flat, item)).toEqual([]);
    expect(count("kitchen_measures")).toBe(0);
  });

  it("takes at most three, each word once, words of 1 to 24 characters and whole numbers above zero; a refusal writes nothing", async () => {
    const item = await groupItem(ANU, flat);
    const refused = async (measures: unknown, field: string) => {
      const res = await setMeasures(RAHUL, flat, item, measures);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      expect(Object.keys(res.body.error.details.fields as object)).toContain(field);
    };
    const m = (one: string) => ({ ...onion, one, many: `${one}s` });
    await refused([m("a"), m("b"), m("c"), m("d")], "measures");
    await refused([onion, { ...onion, one: "Onion" }], "measures[1].one");
    await refused([{ ...onion, one: " " }], "measures[0].one");
    await refused([{ ...onion, many: "x".repeat(25) }], "measures[0].many");
    await refused([{ ...onion, count: 0 }], "measures[0].count");
    await refused([{ ...onion, amountMilli: 1.5 }], "measures[0].amountMilli");
    await refused([{ ...onion, amountMilli: "150000" }], "measures[0].amountMilli");
    // A measure is at least a thousandth of the unit: half of one is never nothing.
    await refused([{ ...onion, count: 20, amountMilli: 19 }], "measures[0].amountMilli");
    await refused(["onion"], "measures[0]");
    await refused("onion", "measures");
    const noList = await call("PUT", groupPath(flat, `items/${item.id}/measures`), RAHUL, { one: "onion" });
    expect(noList.status).toBe(422);
    const notJson = await h.call("PUT", groupPath(flat, `items/${item.id}/measures`), { as: RAHUL, rawBody: "[]" });
    expect(notJson.status).toBe(422);
    expect(count("kitchen_measures")).toBe(0);

    // Three is fine.
    expect((await setMeasures(RAHUL, flat, item, [m("a"), m("b"), m("c")])).status).toBe(200);
    expect(count("kitchen_measures")).toBe(3);
  });

  it("is for anyone who may use the item: a viewer, someone outside the group and anyone but a personal pantry's owner get the opaque 404", async () => {
    const item = await groupItem(ANU, flat);
    for (const who of [VIEWER, OUTSIDER]) {
      const res = await setMeasures(who, flat, item, [onion]);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "not_found", message: "Not found" });
    }
    // Not through another group they use, either.
    expect((await setMeasures(RAHUL, lunch, item, [onion])).status).toBe(404);
    expect((await call("PUT", groupPath(flat, "items/itm_nope/measures"), RAHUL, { measures: [] })).status).toBe(404);
    expect((await call("GET", groupPath(flat, `items/${item.id}/measures`), RAHUL)).status).toBe(405);
    expect((await call("PUT", groupPath(flat, `items/${item.id}/measures`), null, { measures: [] })).status).toBe(401);
    expect(count("kitchen_measures")).toBe(0);
    // Every member who uses items may: not only its buyer.
    expect((await setMeasures(DEV, flat, item, [onion])).status).toBe(200);

    const mine = await myItem(RAHUL);
    expect((await setMeasures(ANU, null, mine, [onion])).status).toBe(404);
    expect((await setMeasures(ANU, flat, mine, [onion])).status).toBe(404);
    expect((await setMeasures(RAHUL, null, mine, [onion])).status).toBe(200);
    expect(words(await measuresOf(RAHUL, null, mine))).toEqual([onion]);
  });

  it("belongs to the name, its pantry and its dimension: every purchase of Onions in Flat 4B reads it, nothing elsewhere does", async () => {
    const monday = await groupItem(ANU, flat);
    const friday = await groupItem(RAHUL, flat, { ...onions, name: "onions", priceMinor: 4400 }); // the same name, another purchase
    const byCount = await groupItem(ANU, flat, { ...onions, quantity: "6", unit: "pcs" }); // counted, not weighed
    const inLunch = await groupItem(RAHUL, lunch);
    const mine = await myItem(RAHUL);
    const shallots = await groupItem(ANU, flat, { ...onions, name: "Shallots" });

    await setMeasures(RAHUL, flat, monday, [onion]);
    expect(words(await measuresOf(RAHUL, flat, monday))).toEqual([onion]);
    expect(words(await measuresOf(RAHUL, flat, friday))).toEqual([onion]);
    for (const [g, item] of [[flat, byCount], [lunch, inLunch], [null, mine], [flat, shallots]] as const) {
      expect(await measuresOf(RAHUL, g, item)).toEqual([]);
    }
    // Asked once, never on Bought: next week's onions already count in onions.
    const nextWeek = await groupItem(DEV, flat);
    expect(words(nextWeek.measures)).toEqual([onion]);

    // Set through one purchase, changed through another: one set.
    const pieces = { one: "piece", many: "pieces", count: 1, amountMilli: 1_000 };
    await setMeasures(DEV, flat, friday, [{ ...onion, amountMilli: 140_000 }]);
    expect(words(await measuresOf(RAHUL, flat, monday))).toEqual([{ ...onion, amountMilli: 140_000 }]);
    await setMeasures(RAHUL, flat, byCount, [pieces]);
    await setMeasures(RAHUL, null, mine, [{ ...onion, amountMilli: 100_000 }]);
    expect(words(await measuresOf(RAHUL, flat, byCount))).toEqual([pieces]);
    expect(words(await measuresOf(RAHUL, null, mine))).toEqual([{ ...onion, amountMilli: 100_000 }]);
    expect(words(await measuresOf(RAHUL, flat, monday))).toEqual([{ ...onion, amountMilli: 140_000 }]);
    expect(await measuresOf(RAHUL, lunch, inLunch)).toEqual([]);
    // Clearing one name leaves the others.
    await setMeasures(RAHUL, flat, monday, []);
    expect(await measuresOf(RAHUL, flat, friday)).toEqual([]);
    expect(words(await measuresOf(RAHUL, flat, byCount))).toEqual([pieces]);
    expect(words(await measuresOf(RAHUL, null, mine))).toEqual([{ ...onion, amountMilli: 100_000 }]);
  });
});

describe("every item read carries its measures", () => {
  it("in the group's pantry, the cross-pantry reads, search, one item and usuals — in the same number of statements for one item or many", async () => {
    const first = await groupItem(ANU, flat);
    await setMeasures(ANU, flat, first, [onion]);
    const mine = await myItem(RAHUL, bread);
    await setMeasures(RAHUL, null, mine, [slice]);
    await use(RAHUL, flat, first, { quantity: 1, measure: "onion" });
    await useMine(RAHUL, mine, { quantity: 2, measure: "slice" });

    const statements = countStatements();
    const reads: Array<[string, string, (data: unknown) => Array<{ name: string; measures?: KitchenMeasure[] | undefined }>]> = [
      ["group pantry", groupPath(flat, "items"), (d) => (d as ReachableItemsPage).items],
      ["every pantry", me("items"), (d) => (d as ReachableItemsPage).items],
      ["usable", me("items?usable=1"), (d) => (d as ReachableItemsPage).items],
      ["search", me("search?q=o"), (d) => (d as SearchItemsResponse).items],
      ["group item", groupPath(flat, `items/${first.id}`), (d) => [(d as KitchenItemResponse).item]],
      ["my item", me(`items/${mine.id}`), (d) => [(d as KitchenItemResponse).item]],
      ["usuals", me("usuals"), (d) => (d as UsualsResponse).usuals.map((u) => ({ name: u.name, measures: u.measures }))],
    ];
    const measure = async () => {
      const out: Record<string, { statements: number; measures: Record<string, string[]> }> = {};
      for (const [name, url, items] of reads) {
        const before = statements();
        const res = await call<unknown>("GET", url, RAHUL);
        expect(res.status).toBe(200);
        const found = items(res.body.data);
        out[name] = {
          statements: statements() - before,
          measures: Object.fromEntries(found.map((i) => [i.name, (i.measures ?? []).map((m) => m.one)])),
        };
      }
      return out;
    };

    const few = await measure();
    expect(few).toEqual({
      "group pantry": { statements: 3, measures: { Onions: ["onion"] } },
      "every pantry": { statements: 3, measures: { Onions: ["onion"], Bread: ["slice"] } },
      usable: { statements: 3, measures: { Onions: ["onion"], Bread: ["slice"] } },
      search: { statements: 3, measures: { Onions: ["onion"] } },
      "group item": { statements: 3, measures: { Onions: ["onion"] } },
      "my item": { statements: 2, measures: { Bread: ["slice"] } },
      usuals: { statements: 2, measures: { Onions: ["onion"], Bread: ["slice"] } },
    });

    // Many more items, names and pantries, each with measures, and used: still the same statements.
    for (let i = 0; i < 12; i += 1) {
      const item = await groupItem(i % 2 ? ANU : DEV, flat, { ...onions, name: `Onion ${i}` });
      await setMeasures(ANU, flat, item, [onion, { ...onion, one: `bulb${i}`, many: `bulbs${i}` }]);
      await use(RAHUL, flat, item, { quantity: 0.5, measure: "onion" });
      const own = await myItem(RAHUL, { ...bread, name: `Loaf ${i}` });
      await setMeasures(RAHUL, null, own, [slice]);
      await useMine(RAHUL, own, { quantity: 1, measure: "slice" });
    }
    await groupItem(RAHUL, lunch, { ...onions, name: "Onion in lunch" });
    const many = await measure();
    for (const name of Object.keys(few)) expect(many[name]!.statements).toBe(few[name]!.statements);
    expect(Object.keys(many["every pantry"]!.measures).length).toBeGreaterThan(20);
    expect(many["every pantry"]!.measures["Onion 3"]).toEqual(["onion", "bulb3"]);
    expect(many["every pantry"]!.measures["Loaf 3"]).toEqual(["slice"]);
    expect(many["every pantry"]!.measures["Onion in lunch"]).toEqual([]);
    expect(many.usuals!.measures["Loaf 11"]).toEqual(["slice"]);
    expect(many.usuals!.measures["Onion 11"]).toEqual(["onion", "bulb11"]);
  });
});

describe("a use in a measure", () => {
  it("takes 2 onions of a 1 kg onion bought at ₹40 — 300 g, ₹12.00 — and reads 2 onions in the move, the activity, the history and the email", async () => {
    const item = await groupItem(ANU, flat);
    await setMeasures(ANU, flat, item, [onion]);

    const res = await use(RAHUL, flat, item, { quantity: 2, measure: "onion", consumers: [RAHUL, DEV] });
    expect(res.status).toBe(201);
    const { move, txn, item: after } = res.body.data;
    expect(move).toMatchObject({
      kind: "use",
      qtyMilli: 300_000,
      // What it took, in the item's own unit; its words beside it.
      quantity: 0.3,
      unit: "kg",
      label: "2 onions",
      costMinor: 1200,
      consumers: [RAHUL, DEV],
    });
    // The cost is any use's: the engine's proportional cost of what it took.
    expect(move.costMinor).toBe(costOfUse({ priceMinor: 4000, qtyBoughtMilli: 1_000_000, qtyLeftMilli: 1_000_000, costTakenMinor: 0 }, 300_000));
    expect(txn).toMatchObject({ kind: "use", title: "Onions (2 onions)", totalMinor: 1200 });
    expect(after).toMatchObject({ qtyLeftMilli: 700_000, worthMinor: 2800 });
    expect(words(after.measures)).toEqual([onion]);
    expect(await balances(flat)).toEqual({ [ANU]: 1200, [RAHUL]: -600, [DEV]: -600 });

    const activity = await call<ActivityPage>("GET", groupPath(flat, "activity"), DEV);
    expect(activity.body.data.items.map((t) => t.title)).toEqual(["Onions (2 onions)"]);
    expect((await history(DEV, flat, item))[0]).toMatchObject({ id: move.id, label: "2 onions", qtyMilli: 300_000 });
    const mail = h.notifications.find((n) => n.request.templateKey === "kitchen.logged_for_you");
    expect(mail?.request.templateData).toMatchObject({ what: "2 onions of Onions", total: "₹12.00", yourShare: "₹6.00" });
    const audit = h.db
      .prepare("SELECT description, payload FROM events_audit_entries WHERE event_type = 'kitchen.item.used'")
      .get() as { description: string; payload: string };
    expect(audit.description).toContain(": 2 onions for");
    expect(JSON.parse(audit.payload)).toMatchObject({ qtyMilli: 300_000, unit: "kg", label: "2 onions", costMinor: 1200 });

    // A use in a unit is as before: no words.
    const plain = await use(RAHUL, flat, item, { quantity: "100", unit: "g" });
    expect(plain.body.data.move).toMatchObject({ qtyMilli: 100_000, unit: "g", label: null, costMinor: 400 });
    expect(plain.body.data.txn!.title).toBe("Onions (100 g)");
  });

  it("says ½ onion, 1 onion and 1½ onions — the word for one up to 1 — and matches the word in any case", async () => {
    const item = await myItem(RAHUL);
    await setMeasures(RAHUL, null, item, [onion]);
    const taken: Array<[unknown, string, number, number]> = [];
    for (const [quantity, word] of [[0.5, "onion"], ["1", "Onion"], ["1.5", "ONION "], [2, "onion"]] as const) {
      const res = await useMine(RAHUL, item, { quantity, measure: word });
      expect(res.status).toBe(201);
      taken.push([quantity, res.body.data.move.label!, res.body.data.move.qtyMilli, res.body.data.move.costMinor]);
    }
    expect(taken).toEqual([
      [0.5, "½ onion", 75_000, 300],
      ["1", "1 onion", 150_000, 600],
      ["1.5", "1½ onions", 225_000, 900],
      [2, "2 onions", 300_000, 1200],
    ]);
    expect((await history(RAHUL, null, item)).map((m) => m.label)).toEqual(["2 onions", "1½ onions", "1 onion", "½ onion"]);
    // A personal pantry has no ledger.
    expect(count("kitchen_txns")).toBe(0);
  });

  it("eats a 16-slice pack slice by slice for exactly what it cost: the last slice takes what is left", async () => {
    const pack = await groupItem(ANU, flat, bread);
    await setMeasures(RAHUL, flat, pack, [slice]);
    const moves: KitchenStockMove[] = [];
    let left = pack;
    for (let i = 0; i < 16; i += 1) {
      const res = await use(RAHUL, flat, pack, { quantity: 1, measure: "slice" });
      expect(res.status).toBe(201);
      // Each slice costs what the engine charges for what it took from the pack as it was.
      expect(res.body.data.move.costMinor).toBe(costOfUse({ ...left, costTakenMinor: left.priceMinor - left.worthMinor }, res.body.data.move.qtyMilli));
      moves.push(res.body.data.move);
      left = res.body.data.item;
    }
    // A sixteenth of a pack is 62.5 thousandths: each slice takes 63, and the
    // last the 55 that are left, so the pack is used up — not 8 short of it.
    expect(moves.map((m) => m.qtyMilli)).toEqual([...Array(15).fill(63), 55]);
    expect(moves.every((m) => m.label === "1 slice")).toBe(true);
    expect(moves.reduce((a, m) => a + m.qtyMilli, 0)).toBe(1_000);
    expect(moves.reduce((a, m) => a + m.costMinor, 0)).toBe(4500);
    expect(left).toMatchObject({ qtyLeftMilli: 0, worthMinor: 0, state: "used_up" });
    expect(await balances(flat)).toEqual({ [ANU]: 4500, [RAHUL]: -4500 });
    const txns = (await call<ActivityPage>("GET", groupPath(flat, "activity?limit=50"), ANU)).body.data.items;
    expect(txns.reduce((a, t) => a + t.totalMinor, 0)).toBe(4500);

    // Nothing left: a 17th slice is refused.
    const more = await use(RAHUL, flat, pack, { quantity: 1, measure: "slice" });
    expect(more.status).toBe(409);
    expect(more.body.error.details).toMatchObject({ reason: "insufficient_stock", qtyLeftMilli: 0 });
  });

  it("refuses more than is left (409) and writes nothing; within the measure's rounding it is never short", async () => {
    const item = await groupItem(ANU, flat);
    await setMeasures(ANU, flat, item, [onion]);
    const before = written();
    const tooMany = await use(RAHUL, flat, item, { quantity: 7, measure: "onion" }); // 1 050 g of 1 kg
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.details).toEqual({ reason: "insufficient_stock", qtyLeftMilli: 1_000_000 });
    expect(written()).toEqual(before);

    // Six onions, then 100 g is left: not an onion's worth, so "1 onion" is refused and "The rest" takes it.
    expect((await use(RAHUL, flat, item, { quantity: 6, measure: "onion" })).body.data.move.qtyMilli).toBe(900_000);
    const oneMore = await use(RAHUL, flat, item, { quantity: 1, measure: "onion" });
    expect(oneMore.status).toBe(409);
    expect(oneMore.body.error.details).toEqual({ reason: "insufficient_stock", qtyLeftMilli: 100_000 });
    const half = await use(RAHUL, flat, item, { quantity: 0.5, measure: "onion" });
    expect(half.body.data.move).toMatchObject({ qtyMilli: 75_000, label: "½ onion" });
    const rest = await use(RAHUL, flat, item, { quantity: "25", unit: "g" });
    expect(rest.body.data.item).toMatchObject({ qtyLeftMilli: 0, state: "used_up" });
    expect(await balances(flat)).toEqual({ [ANU]: 4000, [RAHUL]: -4000 });
  });

  it("is 422 for a measure the name does not have, a measure with a unit, or a count that is not in halves — and writes nothing", async () => {
    const item = await groupItem(ANU, flat);
    const bare = await use(RAHUL, flat, item, { quantity: 1, measure: "onion" });
    expect(bare.status).toBe(422);
    expect(bare.body.error.details.fields).toEqual({ measure: ["Onions has no measures yet"] });

    await setMeasures(ANU, flat, item, [onion]);
    const mine = await myItem(RAHUL);
    const before = written();
    const refusals: Array<[unknown, string]> = [
      [{ quantity: 1, measure: "slice" }, "measure"],
      [{ quantity: 1, measure: "onions" }, "measure"], // the word for one names it
      [{ quantity: 1, measure: "onion", unit: "g" }, "measure"],
      [{ quantity: "0.25", measure: "onion" }, "quantity"],
      [{ quantity: 0, measure: "onion" }, "quantity"],
      [{ quantity: -1, measure: "onion" }, "quantity"],
      [{ quantity: "two", measure: "onion" }, "quantity"],
      [{ quantity: 20_000, measure: "onion" }, "quantity"],
      [{ quantity: 1, measure: "" }, "measure"],
      [{ quantity: 1, measure: 3 }, "measure"],
    ];
    for (const [body, field] of refusals) {
      const res = await use(RAHUL, flat, item, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      expect(Object.keys(res.body.error.details.fields as object)).toEqual([field]);
    }
    expect((await use(RAHUL, flat, item, { quantity: 1, measure: "slice" })).body.error.details.fields).toEqual({
      measure: ["Must be one of Onions's measures: onion"],
    });
    expect((await useMine(RAHUL, mine, { quantity: 1, measure: "onion" })).status).toBe(422); // Flat 4B's measure, not his pantry's
    expect(written()).toEqual(before);
  });

  it("changes future uses only when a size changes: a past use keeps its amount and its words, and a reversal puts it back in the same words", async () => {
    const item = await groupItem(ANU, flat);
    await setMeasures(ANU, flat, item, [onion]);
    const first = await use(RAHUL, flat, item, { quantity: 1, measure: "onion" });
    await setMeasures(DEV, flat, item, [{ ...onion, amountMilli: 200_000 }]);
    const second = await use(RAHUL, flat, item, { quantity: 1, measure: "onion" });
    expect([first.body.data.move.qtyMilli, second.body.data.move.qtyMilli]).toEqual([150_000, 200_000]);
    expect((await history(RAHUL, flat, item)).map((m) => [m.label, m.qtyMilli, m.costMinor])).toEqual([
      ["1 onion", 200_000, 800],
      ["1 onion", 150_000, 600],
    ]);

    const reversed = await call<{ txn: KitchenTxn }>("POST", groupPath(flat, `txns/${second.body.data.txn!.id}/reverse`), RAHUL);
    expect(reversed.status).toBe(201);
    expect(reversed.body.data.txn.title).toBe("Reversal: Onions (1 onion)");
    expect((await history(RAHUL, flat, item))[0]).toMatchObject({ kind: "reversal", label: "1 onion", qtyMilli: 200_000 });
    expect(await balances(flat)).toEqual({ [ANU]: 600, [RAHUL]: -600 });
  });

  it("answers a retried use with the move it made, the item with its measures, and takes nothing twice", async () => {
    const item = await groupItem(ANU, flat);
    await setMeasures(ANU, flat, item, [onion]);
    const headers = { "idempotency-key": "two-onions" };
    const once = await use(RAHUL, flat, item, { quantity: 2, measure: "onion" }, headers);
    const twice = await use(RAHUL, flat, item, { quantity: 2, measure: "onion" }, headers);
    expect(twice.status).toBe(201);
    expect(twice.body.data.move).toEqual(once.body.data.move);
    expect(words(twice.body.data.item.measures)).toEqual([onion]);
    expect(twice.body.data.item.qtyLeftMilli).toBe(700_000);
    expect(count("kitchen_stock_moves")).toBe(1);
  });

  it("puts its words on usuals: the last use's label and the item's measures", async () => {
    const item = await myItem(RAHUL);
    await setMeasures(RAHUL, null, item, [onion]);
    await useMine(RAHUL, item, { quantity: "100", unit: "g" });
    await useMine(RAHUL, item, { quantity: 1.5, measure: "onion" });
    const usuals = (await call<UsualsResponse>("GET", me("usuals"), RAHUL)).body.data.usuals;
    expect(usuals).toEqual([
      expect.objectContaining({ itemId: item.id, lastQtyMilli: 225_000, lastUnit: "kg", lastLabel: "1½ onions", measures: [expect.objectContaining(onion)] }),
    ]);
  });
});

describe("a dish ingredient in a measure", () => {
  const cook = (as: string, body: Record<string, unknown>) => {
    tick();
    return call<DishResponse>("POST", me("dishes"), as, { name: "Onion curry", portionsHalf: 4, splitMode: "assign", ...body });
  };

  it("takes count × size, costs what any take costs, and keeps its words on the dish, the move and the charge", async () => {
    const item = await groupItem(ANU, flat);
    await setMeasures(DEV, flat, item, [onion]);
    const mine = await myItem(RAHUL, bread);
    await setMeasures(RAHUL, null, mine, [slice]);

    const res = await cook(RAHUL, {
      ingredients: [
        { itemId: item.id, quantity: 2, measure: "Onion" },
        { itemId: mine.id, quantity: "0.5", measure: "slice" },
      ],
    });
    expect(res.status).toBe(201);
    const { dish } = res.body.data;
    expect(dish.ingredients.map((i) => [i.name, i.qtyMilli, i.quantity, i.unit, i.label, i.costMinor])).toEqual([
      ["Onions", 300_000, 0.3, "kg", "2 onions", 1200],
      ["Bread", 31, 0.031, "pack", "½ slice", 140],
    ]);
    expect(dish.ingredientsMinor).toBe(1340);
    const read = await call<DishResponse>("GET", me(`dishes/${dish.id}`), RAHUL);
    expect(read.body.data.dish.ingredients.map((i) => i.label)).toEqual(["2 onions", "½ slice"]);
    expect((await history(ANU, flat, item))[0]).toMatchObject({ kind: "dish", label: "2 onions", qtyMilli: 300_000 });
    const activity = await call<ActivityPage>("GET", groupPath(flat, "activity"), ANU);
    expect(activity.body.data.items.map((t) => [t.title, t.totalMinor])).toEqual([["Onion curry: Onions (2 onions)", 1200]]);
    expect(await balances(flat)).toEqual({ [ANU]: 1200, [RAHUL]: -1200 });

    // In a unit, as before: no words.
    const plain = await cook(RAHUL, { name: "Raita", ingredients: [{ itemId: item.id, quantity: "50", unit: "g" }] });
    expect(plain.body.data.dish.ingredients[0]).toMatchObject({ qtyMilli: 50_000, unit: "g", label: null });
  });

  it("is 422 for a measure the item lacks or one with a unit, 409 for more than is left — and writes nothing", async () => {
    const item = await groupItem(ANU, flat);
    await setMeasures(ANU, flat, item, [onion]);
    const before = written();

    const unknown = await cook(RAHUL, { ingredients: [{ itemId: item.id, quantity: 1, measure: "slice" }] });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details.fields).toEqual({ "ingredients[0].measure": ["Must be one of Onions's measures: onion"] });
    const both = await cook(RAHUL, { ingredients: [{ itemId: item.id, quantity: 1, measure: "onion", unit: "g" }] });
    expect(both.status).toBe(422);
    expect(Object.keys(both.body.error.details.fields as object)).toEqual(["ingredients[0].measure"]);
    const quarter = await cook(RAHUL, { ingredients: [{ itemId: item.id, quantity: 0.25, measure: "onion" }] });
    expect(Object.keys(quarter.body.error.details.fields as object)).toEqual(["ingredients[0].quantity"]);
    const tooMany = await cook(RAHUL, { ingredients: [{ itemId: item.id, quantity: 7, measure: "onion" }] });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.details).toEqual({ reason: "insufficient_stock", itemId: item.id, qtyLeftMilli: 1_000_000 });
    expect(written()).toEqual(before);
  });
});
