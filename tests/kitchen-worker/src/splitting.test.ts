// Splitting dishes (CP-16): claims, the cook's assignment, finalize (one
// `dish` transaction, leftovers for what nobody had) and corrections (a
// reversal and a new dish transaction), through the router, against real
// SQLite (every migration applied), the real policy grants and membership's
// answers. design.md §3's worked example is cooked with CP-14's fixtures,
// claimed, finalized and netted to the paisa.

import type {
  ActivityPage,
  BalancesResponse,
  DishResponse,
  DishesPage,
  KitchenDish,
  KitchenItem,
  KitchenItemResponse,
  KitchenTxn,
  PersonViewResponse,
  SettlePlan,
  StockMoveResponse,
} from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";
import { paneerButterMasalaBody, stockWorkedExample, type WorkedExamplePantries } from "./worked-example-fixtures.js";

const NOW = new Date("2026-11-02T12:00:00.000Z");
const LATER = new Date("2026-11-02T20:00:00.000Z");

const RAHUL = "usr_rahul"; // cooks; builder in Flat 4B and the Lunch club, viewer in the Book club
const ANU = "usr_anu"; // owner of Flat 4B
const DEV = "usr_dev";
const MEERA = "usr_meera";
const KIRAN = "usr_kiran"; // the Lunch club only
const VIEWER = "usr_viewer"; // a viewer in Flat 4B
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
  h.grant(VIEWER, flat, "viewer");
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
const dishPath = (g: Group, dish: KitchenDish | string, rest: string) =>
  groupPath(g, `dishes/${typeof dish === "string" ? dish : dish.id}/${rest}`);

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

function stock(): Promise<WorkedExamplePantries> {
  return stockWorkedExample({ myItem, groupItem }, { flat, lunch }, { rahul: RAHUL, anu: ANU, dev: DEV, kiran: KIRAN });
}

/** design.md §3's dish, cooked by Rahul and open for claims in Flat 4B. */
async function cookWorkedExample(): Promise<KitchenDish> {
  const res = await call<DishResponse>("POST", me("dishes"), RAHUL, paneerButterMasalaBody(await stock(), flat));
  expect(res.status).toBe(201);
  expect(res.body.data.dish).toMatchObject({ state: "open", totalMinor: 21100, portionsHalf: 8 });
  return res.body.data.dish;
}

const claim = (as: string, dish: KitchenDish, portionsHalf: unknown, g = flat) =>
  call<DishResponse>("PUT", dishPath(g, dish, "claims/me"), as, { portionsHalf });

const assign = (as: string, dish: KitchenDish, shares: unknown, g = flat) =>
  call<DishResponse>("PUT", dishPath(g, dish, "shares"), as, { shares });

const finalize = (as: string, dish: KitchenDish, key?: string, g = flat) =>
  call<DishResponse>("POST", dishPath(g, dish, "finalize"), as, undefined, key ? { "idempotency-key": key } : undefined);

const correct = (as: string, dish: KitchenDish, body: Record<string, unknown>, key?: string, g = flat) =>
  call<DishResponse>("POST", dishPath(g, dish, "correct"), as, body, key ? { "idempotency-key": key } : undefined);

async function readDish(as: string, dish: KitchenDish): Promise<KitchenDish> {
  const res = await call<DishResponse>("GET", me(`dishes/${dish.id}`), as);
  expect(res.status).toBe(200);
  return res.body.data.dish;
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

/** The group's `dish` transactions still in effect (cooking's `use` may share their instant). */
async function dishTxns(g: Group, as: string): Promise<KitchenTxn[]> {
  return (await activity(g, as)).filter((t) => t.kind === "dish" && !t.reversed);
}

function count(table: string, where = ""): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number }).n;
}

/** What a refused or repeated split must leave untouched. */
function written(): Record<string, number> {
  return {
    shares: count("kitchen_dish_shares"),
    txns: count("kitchen_txns"),
    splits: count("kitchen_txn_splits"),
    items: count("kitchen_items"),
    events: count("events_event_log"),
    version: (h.db.prepare("SELECT COALESCE(SUM(version), 0) AS v FROM kitchen_dishes").get() as { v: number }).v,
  };
}

/** The stored UUID behind a `<prefix>_<32 hex>` id. */
function uuidOf(publicId: string): string {
  const hex = publicId.slice(publicId.indexOf("_") + 1);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Another request's claim landing between this one's read and its write. */
function claimLands(dish: KitchenDish, who: string, portionsHalf: number, position: number) {
  return (db: Harness["db"]) => {
    db.prepare(
      `INSERT INTO kitchen_dish_shares (id, dish_id, subject_id, position, portions_half, exact_minor, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'self', ?, ?)`,
    ).run(crypto.randomUUID(), uuidOf(dish.id), who, position, portionsHalf, NOW.toISOString(), NOW.toISOString());
    db.prepare("UPDATE kitchen_dishes SET version = version + 1 WHERE id = ?").run(uuidOf(dish.id));
  };
}

// ── design.md §3's worked example ─────────────────────────────

describe("the worked example (design.md §3), claimed and finalized", () => {
  it("nets Anu −₹40.75, Dev −₹45.75 and Meera −₹26.37 with Rahul in Flat 4B, and leaves the Lunch club at Kiran +₹24.00", async () => {
    const dish = await cookWorkedExample();
    // You 1½, Anu 1, Dev 1, Meera ½ — claimed in any order: the cook is listed first, so the odd paisa is Rahul's.
    for (const [who, halves] of [[MEERA, 1], [ANU, 2], [RAHUL, 3], [DEV, 2]] as const) {
      expect((await claim(who, dish, halves)).status).toBe(200);
    }

    // Before finalizing, the dish previews the split and the netting.
    const open = await readDish(ANU, dish);
    expect(open).toMatchObject({ state: "open", myClaimHalf: 2, claimedHalf: 8, unclaimedHalf: 0, unclaimedMinor: 0 });
    expect(open.shares.map((s) => [s.subjectId, s.portionsHalf, s.exactMinor, s.source])).toEqual([
      [RAHUL, 3, null, "self"],
      [MEERA, 1, null, "self"],
      [ANU, 2, null, "self"],
      [DEV, 2, null, "self"],
    ]);
    expect(open.shares[0]!.id).toMatch(/^dsr_[0-9a-f]{32}$/);
    expect(open.amounts).toEqual([
      { subjectId: RAHUL, portionsHalf: 3, exactMinor: null, owedMinor: 7913 },
      { subjectId: MEERA, portionsHalf: 1, exactMinor: null, owedMinor: 2637 },
      { subjectId: ANU, portionsHalf: 2, exactMinor: null, owedMinor: 5275 },
      { subjectId: DEV, portionsHalf: 2, exactMinor: null, owedMinor: 5275 },
    ]);
    expect(open.netting).toEqual([
      { subjectId: MEERA, owesCookMinor: 2637, cookOwesMinor: 0, netMinor: 2637 },
      { subjectId: ANU, owesCookMinor: 5275, cookOwesMinor: 1200, netMinor: 4075 },
      { subjectId: DEV, owesCookMinor: 5275, cookOwesMinor: 700, netMinor: 4575 },
    ]);
    expect((await readDish(RAHUL, dish)).myClaimHalf).toBe(3);
    expect((await readDish(VIEWER, dish)).myClaimHalf).toBe(0);
    // Only the preview so far: no money has moved for the dish itself.
    expect(await balances(flat, ANU)).toEqual({ [ANU]: 1200, [DEV]: 700, [RAHUL]: -1900 });

    clock = LATER;
    const res = await finalize(RAHUL, dish, "finalize-paneer");
    expect(res.status).toBe(200);
    const done = res.body.data.dish;
    expect(done).toMatchObject({
      state: "finalized", finalizedAt: LATER.toISOString(), leftoverItemId: null,
      amounts: open.amounts, netting: open.netting,
    });
    expect(done.txnId).toMatch(/^txn_[0-9a-f]{32}$/);

    // One `dish` transaction in Flat 4B: Rahul paid ₹211.00; Rahul ₹79.13, Anu ₹52.75, Dev ₹52.75, Meera ₹26.37.
    const [dishTxn, take] = await activity(flat, MEERA);
    expect(dishTxn).toMatchObject({
      id: done.txnId, kind: "dish", title: "Paneer butter masala with rotis", totalMinor: 21100,
      sourceKind: "dish", sourceId: dish.id, createdBy: RAHUL, occurredAt: LATER.toISOString(), reversed: false,
    });
    expect(dishTxn!.splits).toEqual([
      { subjectId: RAHUL, paidMinor: 21100, owedMinor: 7913 },
      { subjectId: MEERA, paidMinor: 0, owedMinor: 2637 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 5275 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 5275 },
    ]);
    expect(take).toMatchObject({ kind: "use", totalMinor: 1900 });

    // Netted inside Flat 4B: Anu owes Rahul ₹40.75, Dev ₹45.75 and Meera ₹26.37.
    expect(await balances(flat, MEERA)).toEqual({ [RAHUL]: 11287, [ANU]: -4075, [DEV]: -4575, [MEERA]: -2637 });
    const plan = await call<SettlePlan>("GET", groupPath(flat, "settle-plan"), DEV);
    expect(plan.body.data.payments).toEqual([
      { fromSubjectId: DEV, toSubjectId: RAHUL, amountMinor: 4575 },
      { fromSubjectId: ANU, toSubjectId: RAHUL, amountMinor: 4075 },
      { fromSubjectId: MEERA, toSubjectId: RAHUL, amountMinor: 2637 },
    ]);
    for (const [who, net] of [[ANU, 4075], [DEV, 4575], [MEERA, 2637]] as const) {
      const view = await call<PersonViewResponse>("GET", me(`people/${who}`), RAHUL);
      expect(view.body.data.groups.find((g) => g.orgId === flat.publicId)).toMatchObject({ pairwiseMinor: net, planMinor: net });
    }

    // The Lunch club is untouched but for the flour: Rahul owes Kiran ₹24.00.
    expect(await balances(lunch, KIRAN)).toEqual({ [KIRAN]: 2400, [RAHUL]: -2400 });
    expect((await activity(lunch, KIRAN)).map((t) => [t.kind, t.totalMinor])).toEqual([["use", 2400]]);
    const kiran = await call<PersonViewResponse>("GET", me(`people/${KIRAN}`), RAHUL);
    expect(kiran.body.data.groups.map((g) => [g.orgId, g.pairwiseMinor])).toEqual([[lunch.publicId, -2400]]);

    // One audit event, in the group the dish is shared with.
    const events = h.db
      .prepare("SELECT org_id, payload FROM events_event_log WHERE type = 'kitchen.dish.finalized'")
      .all() as Array<{ org_id: string; payload: string }>;
    expect(events.map((e) => e.org_id)).toEqual([flat.id]);
    expect(JSON.parse(events[0]!.payload)).toMatchObject({
      dishId: dish.id, cook: RAHUL, totalMinor: 21100, unclaimedHalf: 0, txnId: done.txnId, leftoverItemId: null,
    });
  });

  it("files unclaimed portions as leftovers in the cook's pantry, worth what they cost him", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(ANU, dish, 2)).status).toBe(200);
    expect((await claim(DEV, dish, 1)).status).toBe(200);

    // 2½ portions nobody had fall to Rahul: ₹131.87 of the ₹211.00.
    const open = await readDish(RAHUL, dish);
    expect(open).toMatchObject({ myClaimHalf: 0, claimedHalf: 3, unclaimedHalf: 5, unclaimedMinor: 13187 });
    expect(open.amounts).toEqual([
      { subjectId: RAHUL, portionsHalf: 0, exactMinor: null, owedMinor: 13187 },
      { subjectId: ANU, portionsHalf: 2, exactMinor: null, owedMinor: 5275 },
      { subjectId: DEV, portionsHalf: 1, exactMinor: null, owedMinor: 2638 },
    ]);

    const res = await finalize(RAHUL, dish);
    expect(res.status).toBe(200);
    const done = res.body.data.dish;
    expect(done.leftoverItemId).toMatch(/^itm_[0-9a-f]{32}$/);
    const leftovers = await call<KitchenItemResponse>("GET", me(`items/${done.leftoverItemId}`), RAHUL);
    expect(leftovers.status).toBe(200);
    expect(leftovers.body.data.item).toMatchObject({
      pantry: { kind: "personal" }, name: "Leftovers: Paneer butter masala with rotis", category: "Leftovers",
      dimension: "count", displayUnit: "pcs", qtyBought: 2.5, qtyBoughtMilli: 2500, qtyLeftMilli: 2500,
      priceMinor: 13187, worthMinor: 13187, currency: "INR", paidBy: RAHUL, state: "active",
    });
    const row = h.db.prepare("SELECT source_dish_id FROM kitchen_items WHERE id = ?").get(uuidOf(done.leftoverItemId!)) as {
      source_dish_id: string;
    };
    expect(row.source_dish_id).toBe(uuidOf(dish.id));

    const [dishTxn] = await dishTxns(flat, ANU);
    expect(dishTxn!.splits).toEqual([
      { subjectId: RAHUL, paidMinor: 21100, owedMinor: 13187 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 5275 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 2638 },
    ]);
    expect(await balances(flat, ANU)).toEqual({ [RAHUL]: 6013, [ANU]: -4075, [DEV]: -1938 });
    // Leftovers are a personal item: they move no money, and Rahul can use them like any other.
    const used = await call<StockMoveResponse>("POST", me(`items/${done.leftoverItemId}/uses`), RAHUL, { quantity: "0.5" });
    expect(used.status).toBe(201);
    expect(used.body.data).toMatchObject({ txn: null, item: { qtyLeftMilli: 2000 } });
  });
});

// ── Claims ───────────────────────────────────────────────────

describe("claiming half portions", () => {
  it("never lets the claims exceed the portions, and writes nothing when refused", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(ANU, dish, 6)).body.data.dish).toMatchObject({ myClaimHalf: 6, claimedHalf: 6, unclaimedHalf: 2 });

    const before = written();
    const over = await claim(DEV, dish, 3);
    expect(over.status).toBe(409);
    expect(over.body.error.details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 2 });
    expect(written()).toEqual(before);

    expect((await claim(DEV, dish, 2)).body.data.dish).toMatchObject({ myClaimHalf: 2, claimedHalf: 8, unclaimedHalf: 0 });
    // Anu may change her own claim, within what the others leave her.
    const greedy = await claim(ANU, dish, 7);
    expect(greedy.status).toBe(409);
    expect(greedy.body.error.details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 6 });
    const less = await claim(ANU, dish, 4);
    expect(less.body.data.dish).toMatchObject({ myClaimHalf: 4, claimedHalf: 6 });
    // 0 takes the claim back; taking back nothing is fine too.
    expect((await claim(ANU, dish, 0)).body.data.dish).toMatchObject({ myClaimHalf: 0, claimedHalf: 2 });
    expect((await claim(ANU, dish, 0)).status).toBe(200);
    expect((await readDish(DEV, dish)).shares.map((s) => [s.subjectId, s.portionsHalf])).toEqual([[DEV, 2]]);
  });

  it("refuses atomically when another claim lands between the read and the write", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(DEV, dish, 2)).status).toBe(200);
    // Meera claims 3 portions just as Anu's claim of 1½ is written: only 1 is left.
    h.beforeNextBatch(claimLands(dish, MEERA, 6, 1));
    const res = await claim(ANU, dish, 3);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 0 });
    expect((await readDish(ANU, dish)).shares.map((s) => [s.subjectId, s.portionsHalf])).toEqual([[DEV, 2], [MEERA, 6]]);
  });

  it("validates the claim", async () => {
    const dish = await cookWorkedExample();
    const before = written();
    for (const portionsHalf of [-1, 1.5, "2", null, 201]) {
      const res = await claim(ANU, dish, portionsHalf);
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.error.details.fields as Record<string, unknown>)).toEqual(["portionsHalf"]);
    }
    const tooMany = await claim(ANU, dish, 9);
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.details).toMatchObject({ reason: "claims_exceed_portions", availableHalf: 8 });
    expect((await call("PUT", dishPath(flat, dish, "claims/me"), ANU, [2])).status).toBe(422);
    expect(written()).toEqual(before);
  });

  it("is a member's: a viewer cannot claim, and outside the dish's group it is not there", async () => {
    const dish = await cookWorkedExample();
    const before = written();
    for (const [who, g] of [[VIEWER, flat], [OUTSIDER, flat], [KIRAN, lunch], [RAHUL, lunch], [RAHUL, books], [OUTSIDER, elsewhere]] as const) {
      const res = await claim(who, dish, 2, g);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    }
    expect((await call("PUT", groupPath(flat, `dishes/dsh_${"0".repeat(32)}/claims/me`), ANU, { portionsHalf: 2 })).status).toBe(404);
    expect((await call("PUT", groupPath(flat, "dishes/paneer/claims/me"), ANU, { portionsHalf: 2 })).status).toBe(404);
    expect((await call("PUT", dishPath(flat, dish, "claims/me"), null, { portionsHalf: 2 })).status).toBe(401);
    expect((await call("POST", dishPath(flat, dish, "claims/me"), ANU, { portionsHalf: 2 })).status).toBe(405);
    expect(written()).toEqual(before);
    // The viewer still reads it.
    expect((await readDish(VIEWER, dish)).claimedHalf).toBe(0);
  });

  it("is only for an open dish: not an assigned draft, nor once finalized or canceled", async () => {
    const p = await stock();
    const assigned = await call<DishResponse>("POST", me("dishes"), RAHUL, paneerButterMasalaBody(p, flat, { splitMode: "assign", newItems: [] }));
    expect(assigned.body.data.dish.state).toBe("draft");
    const draft = await claim(ANU, assigned.body.data.dish, 2);
    expect(draft.status).toBe(409);
    expect(draft.body.error.details).toEqual({ reason: "dish_not_open", state: "draft" });

    const rice = await myItem(RAHUL, { name: "Rice", category: "Grains", quantity: "1", unit: "kg", priceMinor: 8000 });
    const cooked = await call<DishResponse>("POST", me("dishes"), RAHUL, {
      name: "Khichdi", orgId: flat.publicId, portionsHalf: 4, splitMode: "claims", ingredients: [{ itemId: rice.id, quantity: "250", unit: "g" }],
    });
    const khichdi = cooked.body.data.dish;
    expect((await finalize(RAHUL, khichdi)).status).toBe(200);
    expect((await claim(ANU, khichdi, 1)).body.error.details).toEqual({ reason: "dish_not_open", state: "finalized" });

    const dal = await call<DishResponse>("POST", me("dishes"), RAHUL, {
      name: "Dal", orgId: flat.publicId, portionsHalf: 4, splitMode: "claims", ingredients: [{ itemId: rice.id, quantity: "100", unit: "g" }],
    });
    expect((await call("POST", me(`dishes/${dal.body.data.dish.id}/cancel`), RAHUL)).status).toBe(200);
    expect((await claim(ANU, dal.body.data.dish, 1)).body.error.details).toEqual({ reason: "dish_not_open", state: "canceled" });
  });
});

// ── The cook's assignment ─────────────────────────────────────

describe("the cook assigning shares", () => {
  /** Jeera rice for 3 portions from Rahul's own rice: ₹50.00 of rice and ₹5.00 of extras, assigned. */
  async function jeeraRice(): Promise<KitchenDish> {
    const rice = await myItem(RAHUL, { name: "Rice", category: "Grains", quantity: "5", unit: "kg", priceMinor: 50000 });
    const res = await call<DishResponse>("POST", me("dishes"), RAHUL, {
      name: "Jeera rice", orgId: flat.publicId, portionsHalf: 6, extrasMinor: 500, splitMode: "assign",
      ingredients: [{ itemId: rice.id, quantity: "500", unit: "g" }],
    });
    expect(res.body.data.dish).toMatchObject({ state: "draft", totalMinor: 5500 });
    return res.body.data.dish;
  }

  it("assigns portions and exact amounts — exact off the top, the rest by portions — and finalizes them", async () => {
    const dish = await jeeraRice();
    const shares = [{ subjectId: ANU, exactMinor: 1000 }, { subjectId: DEV, portionsHalf: 2 }, { subjectId: MEERA, portionsHalf: 2 }];
    const res = await assign(RAHUL, dish, shares);
    expect(res.status).toBe(200);
    const assigned = res.body.data.dish;
    expect(assigned).toMatchObject({ state: "draft", claimedHalf: 4, unclaimedHalf: 2, unclaimedMinor: 1500, myClaimHalf: 0 });
    expect(assigned.shares.map((s) => [s.subjectId, s.portionsHalf, s.exactMinor, s.source])).toEqual([
      [ANU, null, 1000, "cook"],
      [DEV, 2, null, "cook"],
      [MEERA, 2, null, "cook"],
    ]);
    expect(assigned.amounts).toEqual([
      { subjectId: RAHUL, portionsHalf: 0, exactMinor: null, owedMinor: 1500 },
      { subjectId: ANU, portionsHalf: null, exactMinor: 1000, owedMinor: 1000 },
      { subjectId: DEV, portionsHalf: 2, exactMinor: null, owedMinor: 1500 },
      { subjectId: MEERA, portionsHalf: 2, exactMinor: null, owedMinor: 1500 },
    ]);
    // Nothing came from the group's pantry: the netting is the dish alone.
    expect(assigned.netting).toEqual([
      { subjectId: ANU, owesCookMinor: 1000, cookOwesMinor: 0, netMinor: 1000 },
      { subjectId: DEV, owesCookMinor: 1500, cookOwesMinor: 0, netMinor: 1500 },
      { subjectId: MEERA, owesCookMinor: 1500, cookOwesMinor: 0, netMinor: 1500 },
    ]);
    // An owner may split a stuck dish too; the last assignment wins.
    expect((await assign(ANU, dish, [{ subjectId: DEV, portionsHalf: 6 }])).body.data.dish.claimedHalf).toBe(6);
    expect((await assign(RAHUL, dish, shares)).status).toBe(200);

    const done = await finalize(RAHUL, dish);
    expect(done.status).toBe(200);
    expect(done.body.data.dish).toMatchObject({ state: "finalized", unclaimedMinor: 1500 });
    const [txn] = await dishTxns(flat, DEV);
    expect(txn!.splits).toEqual([
      { subjectId: RAHUL, paidMinor: 5500, owedMinor: 1500 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 1000 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 1500 },
      { subjectId: MEERA, paidMinor: 0, owedMinor: 1500 },
    ]);
    expect(await balances(flat, DEV)).toEqual({ [RAHUL]: 4000, [ANU]: -1000, [DEV]: -1500, [MEERA]: -1500 });
    const leftovers = await call<KitchenItemResponse>("GET", me(`items/${done.body.data.dish.leftoverItemId}`), RAHUL);
    expect(leftovers.body.data.item).toMatchObject({ name: "Leftovers: Jeera rice", qtyBoughtMilli: 1000, priceMinor: 1500 });

    // Finalized: the shares are fixed — a correction is the way.
    const late = await assign(RAHUL, dish, shares);
    expect(late.status).toBe(409);
    expect(late.body.error.details).toEqual({ reason: "dish_not_open", state: "finalized" });
  });

  it("refuses shares that do not fit the dish or the group, and writes nothing", async () => {
    const dish = await jeeraRice();
    const before = written();

    const outsider = await assign(RAHUL, dish, [{ subjectId: ANU, portionsHalf: 2 }, { subjectId: OUTSIDER, portionsHalf: 2 }]);
    expect(outsider.status).toBe(422);
    expect(outsider.body.error.details).toEqual({ reason: "not_in_group", subjectIds: [OUTSIDER] });

    const over = await assign(RAHUL, dish, [{ subjectId: ANU, portionsHalf: 4 }, { subjectId: DEV, portionsHalf: 4 }]);
    expect(over.status).toBe(409);
    expect(over.body.error.details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 6, availableHalf: 6 });

    const tooMuch = await assign(RAHUL, dish, [{ subjectId: ANU, exactMinor: 4000 }, { subjectId: DEV, exactMinor: 2000 }]);
    expect(tooMuch.status).toBe(422);
    expect(Object.keys(tooMuch.body.error.details.fields as Record<string, unknown>)).toEqual(["shares"]);

    const cases: Array<[unknown, string]> = [
      [[{ subjectId: ANU, portionsHalf: 2 }, { subjectId: ANU, exactMinor: 100 }], "shares"],
      [[{ subjectId: ANU, portionsHalf: 2, exactMinor: 100 }], "shares[0]"],
      [[{ subjectId: ANU }], "shares[0]"],
      [[{ subjectId: ANU, portionsHalf: 0 }], "shares[0].portionsHalf"],
      [[{ subjectId: ANU, exactMinor: -5 }], "shares[0].exactMinor"],
      [[{ subjectId: "", portionsHalf: 2 }], "shares[0].subjectId"],
      ["Anu", "shares"],
    ];
    for (const [shares, field] of cases) {
      const res = await assign(RAHUL, dish, shares);
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.error.details.fields as Record<string, unknown>)).toContain(field);
    }
    expect(written()).toEqual(before);
  });

  it("is the cook's, or an owner's or admin's: a member is refused, a viewer and an outsider find nothing", async () => {
    const dish = await jeeraRice();
    const before = written();
    const member = await assign(DEV, dish, [{ subjectId: DEV, portionsHalf: 6 }]);
    expect(member.status).toBe(403);
    expect(member.body.error.details).toEqual({ reason: "not_creator" });
    for (const who of [VIEWER, OUTSIDER]) expect((await assign(who, dish, [])).status).toBe(404);
    expect((await assign(RAHUL, dish, [], lunch)).status).toBe(404);
    expect(written()).toEqual(before);
  });
});

// ── Finalize ──────────────────────────────────────────────────

describe("finalizing", () => {
  it("is idempotent: once finalized, it answers as it is and writes nothing more", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(ANU, dish, 2)).status).toBe(200);
    const first = await finalize(RAHUL, dish, "finalize-1");
    expect(first.status).toBe(200);
    const after = written();
    for (const key of ["finalize-1", "finalize-2", undefined]) {
      const again = await finalize(RAHUL, dish, key);
      expect(again.status).toBe(200);
      expect(again.body.data.dish).toEqual(first.body.data.dish);
    }
    // An owner finalizing it again changes nothing either.
    expect((await finalize(ANU, dish)).body.data.dish.txnId).toBe(first.body.data.dish.txnId);
    expect(written()).toEqual(after);
    expect(count("kitchen_txns", "WHERE kind = 'dish'")).toBe(1);
  });

  it("plans again when a claim lands between the read and the write, so the dish transaction includes it", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(ANU, dish, 2)).status).toBe(200);
    h.beforeNextBatch(claimLands(dish, DEV, 2, 1));
    const res = await finalize(RAHUL, dish);
    expect(res.status).toBe(200);
    expect(res.body.data.dish).toMatchObject({ claimedHalf: 4, unclaimedHalf: 4, unclaimedMinor: 10550 });
    const [txn] = await dishTxns(flat, ANU);
    expect(txn!.splits).toEqual([
      { subjectId: RAHUL, paidMinor: 21100, owedMinor: 10550 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 5275 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 5275 },
    ]);
    expect(count("kitchen_txns", "WHERE kind = 'dish'")).toBe(1);
    expect(count("kitchen_items", "WHERE category = 'Leftovers'")).toBe(1);
  });

  it("answers 409 stale when the claims keep changing, and writes nothing", async () => {
    const dish = await cookWorkedExample();
    const bump = (db: Harness["db"]) => {
      db.prepare("UPDATE kitchen_dishes SET version = version + 1 WHERE id = ?").run(uuidOf(dish.id));
    };
    h.beforeNextBatch(bump);
    h.beforeNextBatch(bump);
    const before = written();
    const res = await finalize(RAHUL, dish);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "stale" });
    expect({ ...written(), version: 0 }).toEqual({ ...before, version: 0 });
    expect((await readDish(RAHUL, dish)).state).toBe("open");
  });

  it("is the cook's, or an owner's or admin's for a stuck dish", async () => {
    const dish = await cookWorkedExample();
    const before = written();
    const member = await finalize(DEV, dish);
    expect(member.status).toBe(403);
    expect(member.body.error.details).toEqual({ reason: "not_creator" });
    for (const [who, g] of [[VIEWER, flat], [OUTSIDER, flat], [KIRAN, lunch]] as const) {
      expect((await finalize(who, dish, undefined, g)).status).toBe(404);
    }
    expect(written()).toEqual(before);

    // Anu owns Flat 4B: she finalizes Rahul's stuck dish, and the dish transaction says so.
    const res = await finalize(ANU, dish);
    expect(res.status).toBe(200);
    const [txn] = await dishTxns(flat, ANU);
    expect(txn).toMatchObject({ kind: "dish", createdBy: ANU, splits: [{ subjectId: RAHUL, paidMinor: 21100, owedMinor: 21100 }] });
    // Nobody claimed: every portion is Rahul's leftovers, and nobody owes anything for the dish.
    expect(res.body.data.dish).toMatchObject({ unclaimedHalf: 8, unclaimedMinor: 21100 });
    expect(await balances(flat, ANU)).toEqual({ [ANU]: 1200, [DEV]: 700, [RAHUL]: -1900 });
  });

  it("refuses a canceled dish, and a finalized dish can no longer be canceled", async () => {
    const dish = await cookWorkedExample();
    expect((await call("POST", me(`dishes/${dish.id}/cancel`), RAHUL)).status).toBe(200);
    const canceled = await finalize(RAHUL, dish);
    expect(canceled.status).toBe(409);
    expect(canceled.body.error.details).toEqual({ reason: "dish_not_open", state: "canceled" });

    const other = await cookWorkedExample();
    expect((await finalize(RAHUL, other)).status).toBe(200);
    const cancel = await call("POST", me(`dishes/${other.id}/cancel`), RAHUL);
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.details).toEqual({ reason: "dish_not_open", state: "finalized" });
  });

  it("finalizes a dish just for the cook with no transaction and no leftovers, on the cook's own route", async () => {
    const res = await call<DishResponse>("POST", me("dishes"), RAHUL, {
      name: "Rice and dal", portionsHalf: 2, splitMode: "assign",
      newItems: [{ name: "Rice", category: "Grains", quantity: "1", unit: "kg", priceMinor: 8000, useQuantity: "250", useUnit: "g" }],
    });
    const dish = res.body.data.dish;
    expect(dish).toMatchObject({ orgId: null, state: "draft", shares: [], netting: [] });
    expect(dish.amounts).toEqual([{ subjectId: RAHUL, portionsHalf: 0, exactMinor: null, owedMinor: 2000 }]);
    // It is in no group: the group routes do not find it.
    for (const path of ["finalize", "correct"]) {
      expect((await call("POST", dishPath(flat, dish, path), RAHUL, { shares: [] })).status).toBe(404);
    }
    expect((await claim(RAHUL, dish, 1)).status).toBe(404);

    const before = written();
    clock = LATER;
    const done = await call<DishResponse>("POST", me(`dishes/${dish.id}/finalize`), RAHUL);
    expect(done.status).toBe(200);
    expect(done.body.data.dish).toMatchObject({ state: "finalized", finalizedAt: LATER.toISOString(), txnId: null, leftoverItemId: null });
    expect({ ...written(), version: 0 }).toEqual({ ...before, version: 0 });
    expect((await call<DishResponse>("POST", me(`dishes/${dish.id}/finalize`), RAHUL)).status).toBe(200);
  });

  it("finalizes a shared dish on the cook's own route too, but only for its cook", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(ANU, dish, 2)).status).toBe(200);
    const member = await call("POST", me(`dishes/${dish.id}/finalize`), ANU);
    expect(member.status).toBe(403);
    expect(member.body.error.details).toEqual({ reason: "not_creator" });
    expect((await call("POST", me(`dishes/${dish.id}/finalize`), KIRAN)).status).toBe(404);

    const res = await call<DishResponse>("POST", me(`dishes/${dish.id}/finalize`), RAHUL);
    expect(res.status).toBe(200);
    expect(res.body.data.dish).toMatchObject({ state: "finalized", unclaimedHalf: 6 });
    expect(await balances(flat, ANU)).toEqual({ [RAHUL]: -1900 + 21100 - 15825, [ANU]: 1200 - 5275, [DEV]: 700 });
  });
});

// ── Corrections ───────────────────────────────────────────────

describe("correcting a finalized dish", () => {
  /** The worked example, claimed (You 1½, Anu 1, Dev 1, Meera ½) and finalized. */
  async function finalizedWorkedExample(): Promise<KitchenDish> {
    const dish = await cookWorkedExample();
    for (const [who, halves] of [[RAHUL, 3], [ANU, 2], [DEV, 2], [MEERA, 1]] as const) {
      expect((await claim(who, dish, halves)).status).toBe(200);
    }
    clock = new Date(NOW.getTime() + 30 * 60_000); // after cooking, so the activity reads in order
    const res = await finalize(RAHUL, dish);
    expect(res.status).toBe(200);
    return res.body.data.dish;
  }

  const withoutMeera = [{ subjectId: RAHUL, portionsHalf: 3 }, { subjectId: ANU, portionsHalf: 2 }, { subjectId: DEV, portionsHalf: 2 }];
  const asClaimed = [...withoutMeera, { subjectId: MEERA, portionsHalf: 1 }];

  it("reverses the dish transaction and posts the new one, in one write, and the balances follow exactly", async () => {
    const dish = await finalizedWorkedExample();
    const original = (await activity(flat, RAHUL))[0]!;
    expect(original.id).toBe(dish.txnId);

    clock = LATER;
    const res = await correct(RAHUL, dish, { shares: withoutMeera, note: "Meera was out" }, "fix-1");
    expect(res.status).toBe(200);
    const fixed = res.body.data.dish;
    expect(fixed).toMatchObject({ state: "finalized", finalizedAt: dish.finalizedAt, claimedHalf: 7, unclaimedHalf: 1, unclaimedMinor: 2637 });
    expect(fixed.txnId).not.toBe(dish.txnId);
    expect(fixed.shares.map((s) => [s.subjectId, s.portionsHalf, s.source])).toEqual([[RAHUL, 3, "cook"], [ANU, 2, "cook"], [DEV, 2, "cook"]]);
    expect(fixed.amounts.map((a) => [a.subjectId, a.owedMinor])).toEqual([[RAHUL, 10550], [ANU, 5275], [DEV, 5275]]);

    // History is kept: the original stands, reversed, beside its reversal and the new dish transaction.
    const txns = await activity(flat, MEERA);
    expect(txns).toHaveLength(4);
    const byId = new Map(txns.map((t) => [t.id, t]));
    expect(byId.get(original.id)).toMatchObject({ reversed: true, splits: original.splits });
    const reversal = txns.find((t) => t.kind === "reversal")!;
    expect(reversal).toMatchObject({
      reverses: original.id, totalMinor: 21100, sourceKind: "dish", sourceId: dish.id, note: "Meera was out", createdBy: RAHUL,
    });
    expect(byId.get(original.id)!.reversedBy).toBe(reversal.id);
    expect(reversal.splits).toEqual(original.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })));
    expect(byId.get(fixed.txnId!)).toMatchObject({ kind: "dish", totalMinor: 21100, reversed: false, sourceId: dish.id });
    expect(byId.get(fixed.txnId!)!.splits).toEqual([
      { subjectId: RAHUL, paidMinor: 21100, owedMinor: 10550 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 5275 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 5275 },
    ]);
    expect(await balances(flat, MEERA)).toEqual({ [RAHUL]: 8650, [ANU]: -4075, [DEV]: -4575 });
    expect(await balances(lunch, KIRAN)).toEqual({ [KIRAN]: 2400, [RAHUL]: -2400 });

    // Meera's half portion is now Rahul's leftovers.
    const leftovers = await call<KitchenItemResponse>("GET", me(`items/${fixed.leftoverItemId}`), RAHUL);
    expect(leftovers.body.data.item).toMatchObject({ qtyBoughtMilli: 500, priceMinor: 2637, category: "Leftovers" });
    expect(count("events_event_log", "WHERE type = 'kitchen.dish.corrected'")).toBe(1);

    // The same request again writes nothing.
    const after = written();
    const again = await correct(RAHUL, dish, { shares: withoutMeera, note: "Meera was out" }, "fix-1");
    expect(again.status).toBe(200);
    expect(again.body.data.dish).toEqual(fixed);
    expect(written()).toEqual(after);

    // Neither the new dish transaction nor its reversal can be undone on its own.
    for (const txnId of [fixed.txnId!, reversal.id]) {
      const undo = await call("POST", groupPath(flat, `txns/${txnId}/reverse`), RAHUL);
      expect(undo.status).toBe(409);
      expect(undo.body.error.details).toEqual({ reason: "not_reversible", dishId: dish.id });
    }

    // Corrected back (by Anu, an owner): the untouched leftovers go, and the balances are the worked example's again.
    const back = await correct(ANU, fixed, { shares: asClaimed }, "fix-2");
    expect(back.status).toBe(200);
    expect(back.body.data.dish).toMatchObject({ leftoverItemId: null, unclaimedHalf: 0 });
    expect((await call("GET", me(`items/${fixed.leftoverItemId}`), RAHUL)).status).toBe(404);
    expect(await balances(flat, MEERA)).toEqual({ [RAHUL]: 11287, [ANU]: -4075, [DEV]: -4575, [MEERA]: -2637 });
    expect(count("kitchen_txns", "WHERE kind = 'reversal'")).toBe(2);
  });

  it("adjusts untouched leftovers, and leaves them be once the cook has had some", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(ANU, dish, 2)).status).toBe(200);
    const done = (await finalize(RAHUL, dish)).body.data.dish; // 3 portions left over
    const leftoverId = done.leftoverItemId!;
    expect((await call<KitchenItemResponse>("GET", me(`items/${leftoverId}`), RAHUL)).body.data.item.qtyBoughtMilli).toBe(3000);

    // Dev had a portion after all: the leftovers shrink to 2 portions, priced at their part.
    const fixed = await correct(RAHUL, done, { shares: [{ subjectId: ANU, portionsHalf: 2 }, { subjectId: DEV, portionsHalf: 2 }] });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.dish).toMatchObject({ leftoverItemId: leftoverId, unclaimedHalf: 4, unclaimedMinor: 10550 });
    expect((await call<KitchenItemResponse>("GET", me(`items/${leftoverId}`), RAHUL)).body.data.item).toMatchObject({
      qtyBoughtMilli: 2000, qtyLeftMilli: 2000, priceMinor: 10550, state: "active",
    });

    // Rahul eats half a portion of them; a later correction leaves them as they are.
    expect((await call("POST", me(`items/${leftoverId}/uses`), RAHUL, { quantity: "0.5" })).status).toBe(201);
    const later = await correct(RAHUL, fixed.body.data.dish, { shares: [{ subjectId: ANU, portionsHalf: 2 }, { subjectId: DEV, portionsHalf: 4 }] });
    expect(later.status).toBe(200);
    expect(later.body.data.dish).toMatchObject({ leftoverItemId: leftoverId, unclaimedHalf: 2 });
    expect((await call<KitchenItemResponse>("GET", me(`items/${leftoverId}`), RAHUL)).body.data.item).toMatchObject({
      qtyBoughtMilli: 2000, qtyLeftMilli: 1500, priceMinor: 10550,
    });
  });

  it("is for a finalized dish only, by its cook or an owner or admin, with shares that fit", async () => {
    const dish = await cookWorkedExample();
    const before = written();
    const open = await correct(RAHUL, dish, { shares: withoutMeera });
    expect(open.status).toBe(409);
    expect(open.body.error.details).toEqual({ reason: "dish_not_open", state: "open" });
    expect(written()).toEqual(before);

    const finalized = (await finalize(RAHUL, dish)).body.data.dish;
    const after = written();
    const member = await correct(DEV, finalized, { shares: withoutMeera });
    expect(member.status).toBe(403);
    expect(member.body.error.details).toEqual({ reason: "not_creator" });
    expect((await correct(VIEWER, finalized, { shares: withoutMeera })).status).toBe(404);
    expect((await correct(KIRAN, finalized, { shares: withoutMeera }, undefined, lunch)).status).toBe(404);
    const over = await correct(RAHUL, finalized, { shares: [...asClaimed, { subjectId: VIEWER, portionsHalf: 1 }] });
    expect(over.status).toBe(409);
    expect(over.body.error.details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 8 });
    const outsider = await correct(RAHUL, finalized, { shares: [{ subjectId: KIRAN, portionsHalf: 1 }] });
    expect(outsider.status).toBe(422);
    expect(outsider.body.error.details).toEqual({ reason: "not_in_group", subjectIds: [KIRAN] });
    expect((await correct(RAHUL, finalized, { shares: withoutMeera, note: 7 })).status).toBe(422);
    expect(written()).toEqual(after);
  });
});

// ── Reading the split ─────────────────────────────────────────

describe("reading a dish's split", () => {
  it("shows the split in every dish list, with the caller's own claim", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(MEERA, dish, 1)).status).toBe(200);
    const shared = await call<DishesPage>("GET", groupPath(flat, "dishes"), MEERA);
    expect(shared.body.data.dishes[0]).toMatchObject({ id: dish.id, myClaimHalf: 1, claimedHalf: 1, unclaimedHalf: 7 });
    const mine = await call<DishesPage>("GET", me("dishes?state=open"), ANU);
    expect(mine.body.data.dishes[0]).toMatchObject({ id: dish.id, myClaimHalf: 0, claimedHalf: 1 });
    expect(mine.body.data.dishes[0]!.amounts.reduce((sum, a) => sum + a.owedMinor, 0)).toBe(21100);
  });

  it("shows nothing moving for a canceled dish", async () => {
    const dish = await cookWorkedExample();
    expect((await claim(MEERA, dish, 1)).status).toBe(200);
    const res = await call<DishResponse>("POST", me(`dishes/${dish.id}/cancel`), RAHUL);
    expect(res.body.data.dish).toMatchObject({ state: "canceled", amounts: [], netting: [], claimedHalf: 1 });
  });
});
