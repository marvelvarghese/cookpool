// Writes that show at once (Cookpool SM-5): each write's cache patch — what
// the screen shows before the server answers — and its rollback, which must
// give back exactly what every read held before. The cache here is a plain
// map with React Query's prefix matching, so the patches meet the same keys
// (`qk.*`) and the same shapes the reads cache.

import type {
  ActivityPage,
  CreateExpenseRequest,
  InboxResponse,
  KitchenDish,
  KitchenDishShare,
  KitchenTxn,
  KitchenUsual,
  ReachableItem,
  SettlePlan,
} from "@saas/contracts/kitchen";
import {
  applyPatches,
  isPendingId,
  pendingId,
  rollbackPatches,
  trackWrite,
  writesInFlight,
  writesSettled,
  type CacheKey,
  type CacheLike,
  type CachePatch,
} from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";
import {
  expenseTxn,
  finalizePatches,
  itemAddedPatches,
  itemRemovedPatches,
  movesPatch,
  paymentPatches,
  paymentTxn,
  pendingItem,
  pendingMove,
  portionPatches,
  stockPatches,
  stockReturnPatches,
  txnAddedPatches,
  txnReversedPatches,
  withDishFinalized,
  withItemListed,
  withPortion,
  withStockReturned,
  withStockTaken,
  withoutPayment,
  withoutPaymentDue,
  type PortionChange,
  type StockChange,
} from "@/components/kitchen/cache-patches";
import { activityRow } from "@/components/kitchen/activity";
import { canUndoMove } from "@/components/kitchen/item-use";
import { itemRefParam, itemRowView } from "@/components/kitchen/pantry";
import { refusedToast } from "@/components/kitchen/undo";
import { amountsFitShares, sharesOf, splitFor } from "@/components/kitchen/dish";
import { ANU, DEV, FLAT, ME, MEERA, PERSONAL_REF, TRIP, groupRef, makeItem, makeMove } from "./kitchen-pantry-fixtures";

// ── A cache like React Query's: exact keys, prefix lookups ─────────

function sameKey(a: CacheKey, b: CacheKey): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function startsWith(key: CacheKey, prefix: CacheKey): boolean {
  return prefix.every((p, i) => JSON.stringify(p) === JSON.stringify(key[i]));
}

class FakeCache implements CacheLike {
  readonly rows: [CacheKey, unknown][] = [];
  /** Keep a copy of what is set, as React Query's structural sharing keeps its own object. */
  copies = false;
  constructor(rows: [CacheKey, unknown][] = []) {
    for (const [k, v] of rows) this.set(k, v);
  }
  entries(prefix: CacheKey): ReadonlyArray<readonly [CacheKey, unknown]> {
    return this.rows.filter(([k]) => startsWith(k, prefix));
  }
  get(key: CacheKey): unknown {
    return this.rows.find(([k]) => sameKey(k, key))?.[1];
  }
  set(key: CacheKey, data: unknown): void {
    if (this.copies && data !== undefined) data = structuredClone(data);
    const at = this.rows.findIndex(([k]) => sameKey(k, key));
    if (at >= 0) this.rows[at] = [key, data];
    else this.rows.push([key, data]);
  }
  /** Every key with exactly the value (reference) it holds. */
  snapshot(): Map<string, unknown> {
    return new Map(this.rows.map(([k, v]) => [JSON.stringify(k), v]));
  }
}

/** After a rollback, every read holds the very object it held before (not a copy). */
function expectExactlyAsBefore(cache: FakeCache, before: Map<string, unknown>): void {
  const now = cache.snapshot();
  expect([...now.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [k, v] of before) expect(now.get(k)).toBe(v);
}

// ── Fixtures ───────────────────────────────────────────────────────

const AT = "2026-11-04T09:00:00.000Z";

const milk = makeItem({ id: "itm_milk", name: "Milk", unit: "L", bought: "1", left: "1", priceMinor: 6800, paidBy: MEERA, daysToUseBy: 1 });
const eggs = makeItem({ id: "itm_eggs", name: "Eggs", pantry: PERSONAL_REF, unit: "pcs", bought: "12", left: "7", priceMinor: 8400, paidBy: ME, daysToUseBy: 2 });
const rice = makeItem({ id: "itm_rice", name: "Basmati rice", unit: "kg", bought: "5", left: "3.2", priceMinor: 62000, daysToUseBy: null });
const milkRef = itemRefParam({ kind: "group", orgId: FLAT.orgId, itemId: milk.id });

function usual(item: ReachableItem, qtyMilli: number): KitchenUsual {
  return {
    itemId: item.id,
    name: item.name,
    pantry: item.pantry,
    lastQtyMilli: qtyMilli,
    lastQuantity: qtyMilli / 1000,
    lastUnit: "ml",
    consumers: [ME],
    usedCount: 4,
    lastUsedAt: AT,
    qtyLeftMilli: item.qtyLeftMilli,
  };
}

function inbox(items: InboxResponse["items"]): InboxResponse {
  const count = (k: string) => items.filter((i) => i.kind === k).length;
  return {
    items,
    counts: {
      total: items.length,
      claim_dish: count("claim_dish"),
      finalize_dish: count("finalize_dish"),
      use_soon: count("use_soon"),
      payment_due: count("payment_due"),
      flag: count("flag"),
    },
  };
}

function useSoonEntry(item: ReachableItem): InboxResponse["items"][number] {
  return {
    kind: "use_soon",
    item: {
      id: item.id,
      ref: item.pantry.kind === "personal" ? `me:${item.id}` : `org:${FLAT.orgId}:${item.id}`,
      name: item.name,
      pantry: item.pantry,
      orgId: item.pantry.kind === "group" ? item.pantry.orgId : null,
      qtyLeftMilli: item.qtyLeftMilli,
      quantity: 1,
      unit: item.displayUnit,
      expiresOn: item.expiresOn ?? "2026-11-05",
      daysToUseBy: item.daysToUseBy ?? 1,
      canUse: true,
    },
    usual: null,
  };
}

function share(subjectId: string, portionsHalf: number): KitchenDishShare {
  return { id: `dsr_${subjectId.slice(-4)}`, subjectId, portionsHalf, exactMinor: null, source: "self", setBy: subjectId, createdAt: AT, updatedAt: AT };
}

function friedRice(patch: Partial<KitchenDish> = {}): KitchenDish {
  return {
    id: "dsh_fried",
    cook: MEERA,
    orgId: FLAT.orgId,
    name: "Egg fried rice",
    portionsHalf: 10,
    portions: 5,
    extrasMinor: 0,
    ingredientsMinor: 15600,
    totalMinor: 15600,
    currency: "INR",
    splitMode: "claims",
    state: "open",
    txnId: null,
    leftoverItemId: null,
    cookedAt: AT,
    finalizedAt: null,
    canceledAt: null,
    createdAt: AT,
    updatedAt: AT,
    ingredients: [],
    fromMineMinor: 15600,
    owes: [],
    shares: [share(ANU, 2)],
    myClaimHalf: 0,
    claimedHalf: 2,
    unclaimedHalf: 8,
    unclaimedMinor: 12480,
    amounts: [
      { subjectId: MEERA, portionsHalf: 0, exactMinor: null, owedMinor: 12480 },
      { subjectId: ANU, portionsHalf: 2, exactMinor: null, owedMinor: 3120 },
    ],
    netting: [],
    ...patch,
  };
}

function inboxDish(dish: KitchenDish, kind: "claim_dish" | "finalize_dish"): InboxResponse["items"][number] {
  return {
    kind,
    dish: {
      id: dish.id,
      orgId: dish.orgId,
      groupName: FLAT.name,
      groupSlug: FLAT.slug,
      name: dish.name,
      cook: dish.cook,
      cookName: "Meera",
      state: "open",
      splitMode: "claims",
      portionsHalf: dish.portionsHalf,
      claimedHalf: dish.claimedHalf,
      unclaimedHalf: dish.unclaimedHalf,
      perPortionMinor: 3120,
      totalMinor: dish.totalMinor,
      currency: "INR",
      cookedAt: AT,
    },
  };
}

function txn(id: string, patch: Partial<KitchenTxn> = {}): KitchenTxn {
  return {
    id,
    orgId: FLAT.orgId,
    kind: "expense",
    title: "Groceries",
    totalMinor: 1000,
    currency: "INR",
    occurredAt: AT,
    createdBy: DEV,
    createdAt: AT,
    sourceKind: null,
    sourceId: null,
    reverses: null,
    reversed: false,
    reversedBy: null,
    method: null,
    note: null,
    splits: [
      { subjectId: DEV, paidMinor: 1000, owedMinor: 500 },
      { subjectId: ME, paidMinor: 0, owedMinor: 500 },
    ],
    ...patch,
  };
}

function feed(...pages: KitchenTxn[][]): { pages: ActivityPage[]; pageParams: unknown[] } {
  return { pages: pages.map((items, i) => ({ items, nextCursor: i < pages.length - 1 ? `c${i}` : null })), pageParams: pages.map((_, i) => (i === 0 ? null : `c${i - 1}`)) };
}

/** Everything a phone has read after Home, Pantry, the item page, a dish and a group. */
function warmCache(): FakeCache {
  const plan: SettlePlan = {
    currency: "INR",
    payments: [
      { fromSubjectId: ME, toSubjectId: DEV, amountMinor: 4575 },
      { fromSubjectId: ANU, toSubjectId: MEERA, amountMinor: 1200 },
    ],
    working: { debts: 4, pairs: 3, payments: 2 },
  };
  const dish = friedRice();
  return new FakeCache([
    [qk.kitchenItem(milkRef), milk],
    [qk.kitchenItem(itemRefParam({ kind: "personal", itemId: eggs.id })), eggs],
    [qk.kitchenItemMoves(milkRef), [makeMove({ kind: "use", itemId: milk.id })]],
    [qk.kitchenPantryItems("all"), { items: [milk, eggs, rice], truncated: false }],
    [qk.kitchenPantryItems(FLAT.orgId), { items: [milk, rice], truncated: false }],
    [qk.kitchenPantryItems("personal"), { items: [eggs], truncated: false }],
    [qk.kitchenUseSoon(), { soon: [milk, eggs], expired: [] }],
    [qk.kitchenUsuals(), [usual(milk, 250_000), usual(eggs, 2000)]],
    [qk.kitchenSearch("mi"), [milk]],
    [qk.kitchenUsable(), [milk, eggs, rice]],
    [qk.kitchenCookable(), [milk, eggs, rice]],
    [qk.kitchenPantries(), [{ kind: "personal", name: "My pantry", itemCount: 1, useSoonCount: 1, expiredCount: 0, worthMinor: 4900, currency: "INR" }]],
    [
      qk.kitchenInbox(),
      inbox([
        useSoonEntry(milk),
        inboxDish(dish, "claim_dish"),
        inboxDish(friedRice({ id: "dsh_mine", cook: ME }), "finalize_dish"),
        { kind: "payment_due", orgId: FLAT.orgId, groupName: FLAT.name, groupSlug: FLAT.slug, toSubjectId: DEV, toName: "Dev", amountMinor: 4575, currency: "INR", canRecord: true },
      ]),
    ],
    [qk.kitchenDish(dish.id), dish],
    [qk.kitchenDish("dsh_mine"), friedRice({ id: "dsh_mine", cook: ME })],
    [qk.kitchenGroupDishes(FLAT.orgId), { pages: [{ dishes: [dish, friedRice({ id: "dsh_mine", cook: ME })], nextCursor: null }], pageParams: [null] }],
    [qk.kitchenActivity(FLAT.orgId), feed([txn("txn_1")], [txn("txn_0")])],
    [qk.kitchenRecentActivity(FLAT.orgId), [txn("txn_1")]],
    [qk.kitchenActivityAll(FLAT.orgId), { txns: [txn("txn_1"), txn("txn_0")], truncated: false }],
    [qk.kitchenBalances(FLAT.orgId), { currency: "INR", balances: [{ subjectId: ME, balanceMinor: -4575 }] }],
    [qk.kitchenSettlePlan(FLAT.orgId), plan],
    [qk.kitchenMyBalances(), { groups: [], people: [], totals: [] }],
    [qk.kitchenActivity(TRIP.orgId), feed([txn("txn_t", { orgId: TRIP.orgId })])],
  ]);
}

// ── The machinery ─────────────────────────────────────────────────

describe("applyPatches / rollbackPatches", () => {
  const bump: CachePatch = { prefix: ["n"], update: (d) => (typeof d === "number" ? d + 1 : d) };

  it("changes only the reads a patch changes, and remembers what each held first", () => {
    const cache = new FakeCache([
      [["n", 1], 1],
      [["n", 2], "text"],
      [["other"], 5],
    ]);
    const entries = applyPatches(cache, [bump, bump]);
    expect(cache.get(["n", 1])).toBe(3);
    expect(cache.get(["n", 2])).toBe("text");
    expect(cache.get(["other"])).toBe(5);
    expect(entries).toEqual([{ key: ["n", 1], before: 1, after: 3 }]);
  });

  it("skips reads that hold nothing yet", () => {
    const cache = new FakeCache([[["n", 1], undefined]]);
    expect(applyPatches(cache, [bump])).toEqual([]);
    expect(cache.get(["n", 1])).toBeUndefined();
  });

  it("rolls back a cache that keeps its own copy of what is set (React Query's structural sharing)", () => {
    const cache = new FakeCache([[["d"], { n: 1, list: [1, 2] }]]);
    cache.copies = true;
    const patch: CachePatch = { prefix: ["d"], update: (d) => ({ ...(d as { n: number }), n: 2 }) };
    const entries = applyPatches(cache, [patch]);
    expect(entries[0]!.after).toBe(cache.get(["d"]));
    expect(rollbackPatches(cache, entries)).toEqual([]);
    expect(cache.get(["d"])).toEqual({ n: 1, list: [1, 2] });
  });

  it("puts back exactly what was there, and names reads something else changed since", () => {
    const cache = new FakeCache([
      [["n", 1], 1],
      [["n", 2], 10],
    ]);
    const entries = applyPatches(cache, [bump]);
    cache.set(["n", 2], 99); // the server's answer, or another write
    const stale = rollbackPatches(cache, entries);
    expect(cache.get(["n", 1])).toBe(1);
    expect(cache.get(["n", 2])).toBe(99);
    expect(stale).toEqual([["n", 2]]);
  });
});

describe("writes on their way", () => {
  it("counts a write until it settles, refused or not", async () => {
    const owner = {};
    let finish!: (v: string) => void;
    let fail!: (e: Error) => void;
    const a = trackWrite(owner, new Promise<string>((r) => (finish = r)));
    const b = trackWrite(owner, new Promise<string>((_, r) => (fail = r)));
    b.catch(() => undefined);
    expect(writesInFlight(owner)).toBe(2);
    let settled = false;
    const waiting = writesSettled(owner).then(() => (settled = true));
    finish("ok");
    await a;
    await Promise.resolve();
    expect(settled).toBe(false);
    fail(new Error("refused"));
    await waiting;
    expect(settled).toBe(true);
    expect(writesInFlight(owner)).toBe(0);
  });

  it("resolves at once when nothing is on its way", async () => {
    await expect(writesSettled({})).resolves.toBeUndefined();
  });

  it("marks rows the server has not made yet", () => {
    const id = pendingId("itm", () => "abc");
    expect(id).toBe("pending_itm_abc");
    expect(isPendingId(id)).toBe(true);
    expect(isPendingId("itm_0001")).toBe(false);
    expect(isPendingId(null)).toBe(false);
  });
});

// ── A use, Used it, waste ─────────────────────────────────────────

describe("stock patches", () => {
  const glass: StockChange = { itemId: milk.id, kind: "use", qtyMilli: 250_000, costMinor: 1700 };

  it("takes the use off what is left and what it is worth", () => {
    const after = withStockTaken(milk, glass);
    expect(after.qtyLeftMilli).toBe(750_000);
    expect(after.worthMinor).toBe(milk.worthMinor - 1700);
    expect(after.qtyLeft).toBeCloseTo(milk.qtyLeft * 0.75, 3);
    expect(after.state).toBe("active");
    expect(withStockTaken(rice, glass)).toBe(rice);
  });

  it("the last of it is used up (or wasted), worth nothing", () => {
    const all: StockChange = { itemId: milk.id, kind: "use", qtyMilli: milk.qtyLeftMilli, costMinor: milk.worthMinor };
    expect(withStockTaken(milk, all)).toMatchObject({ qtyLeftMilli: 0, qtyLeft: 0, worthMinor: 0, state: "used_up" });
    expect(withStockTaken(milk, { ...all, kind: "waste" })).toMatchObject({ state: "wasted" });
  });

  it("Undo after the answer puts it back", () => {
    const back = withStockReturned(withStockTaken(milk, glass), glass);
    expect(back).toMatchObject({ qtyLeftMilli: milk.qtyLeftMilli, worthMinor: milk.worthMinor, state: "active" });
  });

  it("patches every read that shows the item, and only those", () => {
    const cache = warmCache();
    applyPatches(cache, stockPatches(glass));
    expect((cache.get(qk.kitchenItem(milkRef)) as ReachableItem).qtyLeftMilli).toBe(750_000);
    for (const key of [qk.kitchenPantryItems("all"), qk.kitchenPantryItems(FLAT.orgId)]) {
      const list = (cache.get(key) as { items: ReachableItem[] }).items;
      expect(list.find((i) => i.id === milk.id)?.qtyLeftMilli).toBe(750_000);
    }
    expect((cache.get(qk.kitchenUseSoon()) as { soon: ReachableItem[] }).soon[0]!.qtyLeftMilli).toBe(750_000);
    expect((cache.get(qk.kitchenUsuals()) as KitchenUsual[])[0]!.qtyLeftMilli).toBe(750_000);
    expect((cache.get(qk.kitchenSearch("mi")) as ReachableItem[])[0]!.qtyLeftMilli).toBe(750_000);
    const home = cache.get(qk.kitchenInbox()) as InboxResponse;
    const card = home.items.find((i) => i.kind === "use_soon");
    expect(card && card.kind === "use_soon" ? card.item.qtyLeftMilli : null).toBe(750_000);
    // Totals are the server's; other items and other pantries are untouched.
    const warm = warmCache();
    expect(cache.get(qk.kitchenPantries())).toEqual(warm.get(qk.kitchenPantries()));
    expect(cache.get(qk.kitchenPantryItems("personal"))).toEqual(warm.get(qk.kitchenPantryItems("personal")));
  });

  it("an item with nothing left leaves the lists and Home, and stays on its page as used up", () => {
    const cache = warmCache();
    applyPatches(cache, stockPatches({ itemId: milk.id, kind: "use", qtyMilli: milk.qtyLeftMilli, costMinor: milk.worthMinor }));
    expect((cache.get(qk.kitchenItem(milkRef)) as ReachableItem).state).toBe("used_up");
    expect((cache.get(qk.kitchenPantryItems("all")) as { items: ReachableItem[] }).items.map((i) => i.id)).toEqual([eggs.id, rice.id]);
    expect((cache.get(qk.kitchenUsuals()) as KitchenUsual[]).map((u) => u.itemId)).toEqual([eggs.id]);
    const home = cache.get(qk.kitchenInbox()) as InboxResponse;
    expect(home.items.some((i) => i.kind === "use_soon")).toBe(false);
    expect(home.counts).toMatchObject({ total: 3, use_soon: 0 });
  });

  it("adds the use to the item's history, on that item's read only", () => {
    const cache = warmCache();
    const move = pendingMove({ change: glass, quantity: 250, unit: "ml", actor: ME, consumers: [ME, ANU], at: AT, id: "pending_mov_1" });
    applyPatches(cache, [movesPatch(milkRef, move)]);
    const moves = cache.get(qk.kitchenItemMoves(milkRef)) as { id: string }[];
    expect(moves[0]).toMatchObject({ id: "pending_mov_1", kind: "use", qtyMilli: 250_000, costMinor: 1700, consumers: [ME, ANU], txnId: null, undone: false });
    expect(moves).toHaveLength(2);
    // Not undoable from the history until the server has it.
    expect(canUndoMove(move, [move], { meId: ME, personal: false, role: "owner", canWrite: true })).toBe(false);
  });

  it("a refused use puts every read back exactly", () => {
    const cache = warmCache();
    const before = cache.snapshot();
    const move = pendingMove({ change: glass, quantity: 250, unit: "ml", actor: ME, consumers: [ME], at: AT });
    const entries = applyPatches(cache, [...stockPatches(glass), movesPatch(milkRef, move)]);
    expect(entries.length).toBeGreaterThan(5);
    expect(rollbackPatches(cache, entries)).toEqual([]);
    expectExactlyAsBefore(cache, before);
  });

  it("Undo once the server's item has arrived uses the inverse", () => {
    const cache = warmCache();
    applyPatches(cache, stockPatches(glass));
    const server = { ...withStockTaken(milk, glass), version: 2 };
    cache.set(qk.kitchenItem(milkRef), server);
    applyPatches(cache, stockReturnPatches(glass));
    expect(cache.get(qk.kitchenItem(milkRef))).toMatchObject({ qtyLeftMilli: milk.qtyLeftMilli, version: 2 });
  });
});

// ── A portion (the caller's claim today, anyone's with SM-7) ──────

describe("portion patches", () => {
  const mine = (half: number): PortionChange => ({ dishId: "dsh_fried", subjectId: ME, half, setBy: ME, meId: ME, at: AT });

  it("adds a claim after everyone else, with the counts", () => {
    const dish = friedRice();
    const after = withPortion(dish, mine(2));
    expect(after.shares.map((s) => [s.subjectId, s.portionsHalf, s.setBy])).toEqual([
      [ANU, 2, ANU],
      [ME, 2, ME],
    ]);
    expect(isPendingId(after.shares[1]!.id)).toBe(true);
    expect(after).toMatchObject({ myClaimHalf: 2, claimedHalf: 4, unclaimedHalf: 6 });
    // Money stays the server's until it answers.
    expect(after.amounts).toBe(dish.amounts);
  });

  it("changes a claim in place, and 0 takes it back", () => {
    const dish = friedRice({ shares: [share(ANU, 2), share(ME, 2)], myClaimHalf: 2, claimedHalf: 4, unclaimedHalf: 6 });
    expect(withPortion(dish, mine(3)).shares.map((s) => s.portionsHalf)).toEqual([2, 3]);
    expect(withPortion(dish, mine(0))).toMatchObject({ myClaimHalf: 0, claimedHalf: 2, unclaimedHalf: 8 });
    expect(withPortion(dish, mine(0)).shares.map((s) => s.subjectId)).toEqual([ANU]);
    expect(withPortion(dish, mine(2))).toBe(dish);
  });

  it("sets someone else's portion, by the caller, leaving the caller's claim alone (SM-7)", () => {
    const forDev = withPortion(friedRice(), { dishId: "dsh_fried", subjectId: DEV, half: 1, setBy: ME, meId: ME, at: AT });
    expect(forDev.shares.find((s) => s.subjectId === DEV)).toMatchObject({ portionsHalf: 1, setBy: ME });
    expect(forDev).toMatchObject({ myClaimHalf: 0, claimedHalf: 3, unclaimedHalf: 7 });
  });

  it("the dish's money is previewed by the engine while its amounts lag the shares", () => {
    const dish = friedRice();
    expect(amountsFitShares(dish)).toBe(true);
    const claimed = withPortion(dish, mine(2));
    expect(amountsFitShares(claimed)).toBe(false);
    const split = splitFor(claimed, sharesOf(claimed));
    // 10 portions of ₹156.00: you have 1 of them, ₹31.20 — not the ₹0.00 the old amounts say.
    expect(split.amounts.find((a) => a.subjectId === ME)?.owedMinor).toBe(3120);
    const takenBack = withPortion(friedRice({ shares: [share(ANU, 2), share(ME, 2)], amounts: [...dish.amounts, { subjectId: ME, portionsHalf: 2, exactMinor: null, owedMinor: 3120 }] }), mine(0));
    expect(amountsFitShares(takenBack)).toBe(false);
    expect(amountsFitShares({ ...claimed, state: "finalized" })).toBe(true);
  });

  it("patches the dish, its group's Dishes tab and Home's card count", () => {
    const cache = warmCache();
    applyPatches(cache, portionPatches(mine(2), 0));
    expect((cache.get(qk.kitchenDish("dsh_fried")) as KitchenDish).myClaimHalf).toBe(2);
    const tab = cache.get(qk.kitchenGroupDishes(FLAT.orgId)) as { pages: { dishes: KitchenDish[] }[] };
    expect(tab.pages[0]!.dishes[0]!.claimedHalf).toBe(4);
    expect(tab.pages[0]!.dishes[1]!.claimedHalf).toBe(2);
    const card = (cache.get(qk.kitchenInbox()) as InboxResponse).items.find((i) => i.kind === "claim_dish");
    expect(card && card.kind === "claim_dish" ? [card.dish.claimedHalf, card.dish.unclaimedHalf] : null).toEqual([4, 6]);
  });

  it("a refused claim puts every read back exactly", () => {
    const cache = warmCache();
    const before = cache.snapshot();
    const entries = applyPatches(cache, portionPatches(mine(2), 0));
    applyPatches(cache, portionPatches(mine(3), 2), entries); // a second tap in the same burst
    expect((cache.get(qk.kitchenDish("dsh_fried")) as KitchenDish).myClaimHalf).toBe(3);
    expect(rollbackPatches(cache, entries)).toEqual([]);
    expectExactlyAsBefore(cache, before);
  });
});

// ── Finalize ──────────────────────────────────────────────────────

describe("finalize patches", () => {
  it("the dish reads finalized everywhere and Home's card goes", () => {
    const cache = warmCache();
    applyPatches(cache, finalizePatches("dsh_mine", AT));
    expect(cache.get(qk.kitchenDish("dsh_mine"))).toMatchObject({ state: "finalized", finalizedAt: AT });
    const home = cache.get(qk.kitchenInbox()) as InboxResponse;
    expect(home.items.some((i) => i.kind === "finalize_dish")).toBe(false);
    expect(home.counts.finalize_dish).toBe(0);
    expect(home.counts.total).toBe(3);
    // Another dish, and a canceled one, are left alone.
    expect(cache.get(qk.kitchenDish("dsh_fried"))).toMatchObject({ state: "open" });
    const canceled = friedRice({ state: "canceled" });
    expect(withDishFinalized(canceled, canceled.id, AT)).toBe(canceled);
  });

  it("a refused finalize puts every read back exactly", () => {
    const cache = warmCache();
    const before = cache.snapshot();
    const entries = applyPatches(cache, finalizePatches("dsh_mine", AT));
    rollbackPatches(cache, entries);
    expectExactlyAsBefore(cache, before);
  });
});

// ── Paid ──────────────────────────────────────────────────────────

describe("payment patches", () => {
  const change = { orgId: FLAT.orgId, fromSubjectId: ME, toSubjectId: DEV, amountMinor: 4575 };
  const row = paymentTxn(change, { currency: "INR", method: "upi", createdBy: ME, at: AT, id: "pending_txn_pay" });

  it("is a settlement row: the payer paid, the payee is owed", () => {
    expect(row).toMatchObject({ kind: "settlement", title: "Payment", totalMinor: 4575, method: "upi", reversed: false });
    expect(row.splits).toEqual([
      { subjectId: ME, paidMinor: 4575, owedMinor: 0 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 4575 },
    ]);
  });

  it("takes the payment off the plan and off Home, and tops the activity; balances wait", () => {
    const cache = warmCache();
    applyPatches(cache, paymentPatches(change, row));
    const plan = cache.get(qk.kitchenSettlePlan(FLAT.orgId)) as SettlePlan;
    expect(plan.payments).toEqual([{ fromSubjectId: ANU, toSubjectId: MEERA, amountMinor: 1200 }]);
    expect(plan.working).toEqual({ debts: 4, pairs: 3, payments: 1 });
    expect((cache.get(qk.kitchenInbox()) as InboxResponse).items.some((i) => i.kind === "payment_due")).toBe(false);
    const feedNow = cache.get(qk.kitchenActivity(FLAT.orgId)) as { pages: ActivityPage[] };
    expect(feedNow.pages[0]!.items.map((t) => t.id)).toEqual(["pending_txn_pay", "txn_1"]);
    expect(feedNow.pages[1]!.items.map((t) => t.id)).toEqual(["txn_0"]);
    expect((cache.get(qk.kitchenRecentActivity(FLAT.orgId)) as KitchenTxn[])[0]!.id).toBe("pending_txn_pay");
    expect((cache.get(qk.kitchenActivityAll(FLAT.orgId)) as { txns: KitchenTxn[] }).txns[0]!.id).toBe("pending_txn_pay");
    const warm = warmCache();
    expect(cache.get(qk.kitchenBalances(FLAT.orgId))).toEqual(warm.get(qk.kitchenBalances(FLAT.orgId)));
    expect(cache.get(qk.kitchenActivity(TRIP.orgId))).toEqual(warm.get(qk.kitchenActivity(TRIP.orgId)));
  });

  it("only the payment recorded comes off (another amount stays)", () => {
    const plan = warmCache().get(qk.kitchenSettlePlan(FLAT.orgId)) as SettlePlan;
    expect(withoutPayment(plan, { ...change, amountMinor: 100 })).toBe(plan);
    const inboxNow = warmCache().get(qk.kitchenInbox()) as InboxResponse;
    expect(withoutPaymentDue(inboxNow, { ...change, toSubjectId: ANU })).toBe(inboxNow);
  });

  it("the pending row can't be undone or flagged from the feed", () => {
    expect(activityRow(row, { meId: ME, canReverseAny: true, now: new Date(AT) })).toMatchObject({ canUndo: false, canFlag: false });
  });

  it("a refused payment puts every read back exactly", () => {
    const cache = warmCache();
    const before = cache.snapshot();
    const entries = applyPatches(cache, paymentPatches(change, row));
    rollbackPatches(cache, entries);
    expectExactlyAsBefore(cache, before);
  });

  it("Undo strikes the posted row through wherever it is listed", () => {
    const cache = warmCache();
    applyPatches(cache, txnReversedPatches(FLAT.orgId, "txn_0"));
    const pages = (cache.get(qk.kitchenActivity(FLAT.orgId)) as { pages: ActivityPage[] }).pages;
    expect(pages[1]!.items[0]!.reversed).toBe(true);
    expect((cache.get(qk.kitchenActivityAll(FLAT.orgId)) as { txns: KitchenTxn[] }).txns[1]!.reversed).toBe(true);
  });
});

// ── An expense ────────────────────────────────────────────────────

describe("expense patches", () => {
  const request: CreateExpenseRequest = {
    title: "Vegetables",
    totalMinor: 1000,
    payers: [{ subjectId: ANU, amountMinor: 1000 }],
    mode: "equal",
    participants: [{ subjectId: ME }, { subjectId: ANU }, { subjectId: DEV }],
  };
  const owed = new Map([
    [ME, 334],
    [ANU, 333],
    [DEV, 333],
  ]);

  it("is the form's split, in the form's order", () => {
    const row = expenseTxn(FLAT.orgId, request, owed, { currency: "INR", createdBy: ME, at: AT, order: [ME, ANU, DEV, MEERA] });
    expect(isPendingId(row.id)).toBe(true);
    expect(row).toMatchObject({ kind: "expense", title: "Vegetables", totalMinor: 1000, createdBy: ME });
    expect(row.splits).toEqual([
      { subjectId: ME, paidMinor: 0, owedMinor: 334 },
      { subjectId: ANU, paidMinor: 1000, owedMinor: 333 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 333 },
    ]);
    expect(activityRow(row, { meId: ME, canReverseAny: true, now: new Date(AT) })).toMatchObject({ amountText: "−₹3.34", canUndo: false });
  });

  it("tops the group's activity once, and a refusal puts it back exactly", () => {
    const cache = warmCache();
    const before = cache.snapshot();
    const row = expenseTxn(FLAT.orgId, request, owed, { currency: "INR", createdBy: ME, at: AT, order: [ME, ANU, DEV], id: "pending_txn_x" });
    const entries = applyPatches(cache, [...txnAddedPatches(row), ...txnAddedPatches(row)]);
    expect((cache.get(qk.kitchenRecentActivity(FLAT.orgId)) as KitchenTxn[]).map((t) => t.id)).toEqual(["pending_txn_x", "txn_1"]);
    rollbackPatches(cache, entries);
    expectExactlyAsBefore(cache, before);
  });
});

// ── An item added ─────────────────────────────────────────────────

describe("item added", () => {
  const body = { name: "Paneer", category: "dairy", quantity: "200", unit: "g", priceMinor: 9500, expiresOn: "2026-11-06" };

  it("is the item the add will make: the engine's quantity, nothing used, worth what was paid", () => {
    const item = pendingItem({ body, pantry: PERSONAL_REF, currency: "INR", meId: ME, today: "2026-11-04", at: AT, id: "pending_itm_p" });
    expect(item).toMatchObject({
      id: "pending_itm_p",
      dimension: "mass",
      displayUnit: "g",
      qtyBought: 200,
      qtyLeft: 200,
      qtyBoughtMilli: 200_000,
      qtyLeftMilli: 200_000,
      worthMinor: 9500,
      paidBy: ME,
      daysToUseBy: 2,
      wastePolicy: null,
      state: "active",
    });
    const group = pendingItem({ body: { ...body, paidBy: ANU }, pantry: groupRef(FLAT), currency: "INR", groupWastePolicy: "buyer_absorbs", meId: ME, today: "2026-11-04", at: AT });
    expect(group).toMatchObject({ paidBy: ANU, wastePolicy: "buyer_absorbs", wastePolicyOverride: null, createdBy: ME });
    expect(pendingItem({ body: { ...body, unit: "bushel" }, pantry: PERSONAL_REF, currency: "INR", meId: ME, today: "2026-11-04", at: AT })).toBeNull();
  });

  it("is listed in its pantry and All, in use-by order, inert until the server answers", () => {
    const cache = warmCache();
    const item = pendingItem({ body, pantry: PERSONAL_REF, currency: "INR", meId: ME, today: "2026-11-04", at: AT, id: "pending_itm_p" })!;
    applyPatches(cache, itemAddedPatches(item));
    expect((cache.get(qk.kitchenPantryItems("personal")) as { items: ReachableItem[] }).items.map((i) => i.id)).toEqual([eggs.id, "pending_itm_p"]);
    expect((cache.get(qk.kitchenPantryItems("all")) as { items: ReachableItem[] }).items.map((i) => i.id)).toContain("pending_itm_p");
    expect((cache.get(qk.kitchenPantryItems(FLAT.orgId)) as { items: ReachableItem[] }).items.map((i) => i.id)).not.toContain("pending_itm_p");
    expect(itemRowView(item, { meId: ME })).toMatchObject({ pending: true, canUse: false });
    expect(itemRowView(eggs, { meId: ME })).toMatchObject({ pending: false });
    // The server's item takes the row's place.
    applyPatches(cache, itemAddedPatches({ ...item, id: "itm_real" }, "pending_itm_p"));
    const ids = (cache.get(qk.kitchenPantryItems("personal")) as { items: ReachableItem[] }).items.map((i) => i.id);
    expect(ids).toEqual([eggs.id, "itm_real"]);
    applyPatches(cache, itemRemovedPatches("itm_real"));
    expect((cache.get(qk.kitchenPantryItems("personal")) as { items: ReachableItem[] }).items.map((i) => i.id)).toEqual([eggs.id]);
  });

  it("orders by use-by, none last, then name", () => {
    type Row = { id: string; expiresOn: string | null; name: string };
    const a: Row = { id: "a", expiresOn: "2026-11-05", name: "B" };
    const b: Row = { id: "b", expiresOn: null, name: "A" };
    expect(withItemListed([b], a).map((i) => i.id)).toEqual(["a", "b"]);
    expect(withItemListed<Row>([a], { id: "c", expiresOn: "2026-11-05", name: "A" }).map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("a refused add puts every read back exactly", () => {
    const cache = warmCache();
    const before = cache.snapshot();
    const item = pendingItem({ body, pantry: groupRef(FLAT), currency: "INR", meId: ME, today: "2026-11-04", at: AT })!;
    rollbackPatches(cache, applyPatches(cache, itemAddedPatches(item)));
    expectExactlyAsBefore(cache, before);
  });
});

// ── The refusal's toast ───────────────────────────────────────────

describe("refusedToast", () => {
  it("says what did not happen, and why in one line", () => {
    expect(refusedToast("Couldn't log Milk", "None left now — someone used the last of it.")).toEqual({
      kind: "error",
      title: "Couldn't log Milk",
      description: "None left now — someone used the last of it.",
    });
    expect(refusedToast("Couldn't log Milk", "  ")).toEqual({ kind: "error", title: "Couldn't log Milk" });
  });
});
