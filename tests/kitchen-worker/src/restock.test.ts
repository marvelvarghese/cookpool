// What to buy again (PN-3, cookpool-pantry design §6.1–§6.4):
// GET /v1/kitchen/me/restock through the router, against real SQLite (every
// migration applied), the real policy grants and membership's answers.
// Each group and its edges — a rebought item leaving Finished, the 20 % line,
// the 3-purchase threshold, the median gap — each name and pantry once, in
// the first group it fits, what "last time" fills in, who sees what, and
// that the read is one D1 statement however much history there is.

import { randomUUID } from "node:crypto";
import { RESTOCK_LOW_PERCENT, RESTOCK_USUAL_MIN_TIMES } from "@saas/contracts/kitchen";
import { dueUsual, medianGap } from "@kitchen-worker/restock";
import { ANU, MEERA, NOW, OUTSIDER, RAHUL, me, names, uuidOf, world, type World } from "./restock-helpers.js";

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.close());

/** Bought `boughtDaysAgo` days back and used up `usedDaysAgo` days back, in Flat 4B. */
async function finishedIn(name: string, boughtDaysAgo: number, usedDaysAgo: number, body: Record<string, unknown> = {}) {
  w.daysAgo(boughtDaysAgo);
  const item = await w.addTo(RAHUL, w.flat, { name, ...body });
  w.daysAgo(usedDaysAgo);
  await w.useIn(RAHUL, w.flat, item, String(item.qtyBought));
  return item;
}

describe("GET /v1/kitchen/me/restock — finished this week", () => {
  it("lists an item used up in the last 7 days, with when it finished and what was bought last time", async () => {
    expect(w.daysAgo(10)).toBe("2026-10-29");
    const bread = await w.addTo(RAHUL, w.flat, { name: "Bread", priceMinor: 4500, expiresOn: "2026-11-02" });
    w.daysAgo(5);
    const used = await w.useIn(RAHUL, w.flat, bread, "1");

    const restock = await w.restock(RAHUL);
    expect(restock).toEqual({
      finished: [
        {
          name: "Bread",
          nameKey: "bread",
          category: "Grains",
          pantry: { kind: "group", orgId: w.flat.publicId, slug: w.flat.slug, name: "Flat 4B" },
          canAdd: true,
          reason: "finished",
          why: { finishedAt: used.move.at, how: "used_up", itemId: bread.id },
          last: {
            itemId: bread.id,
            quantityMilli: 1000,
            unit: "pcs",
            priceMinor: 4500,
            currency: "INR",
            wastePolicy: null,
            expiresAfterDays: 4,
            paidBy: RAHUL,
          },
        },
      ],
      runningLow: [],
      usual: [],
    });
  });

  it("says wasted for what went to waste, and drops a finish older than 7 days", async () => {
    w.daysAgo(9);
    const curd = await w.addTo(RAHUL, w.flat, { name: "Curd", category: "Dairy" });
    w.daysAgo(2);
    await w.wasteIn(RAHUL, w.flat, curd);
    await finishedIn("Paneer", 20, 8);

    const { finished } = await w.restock(RAHUL);
    expect(finished.map((l) => [l.name, l.why.how])).toEqual([["Curd", "wasted"]]);
  });

  it("drops an item once it is bought again in the same pantry (by name, any case), but not for an older active one", async () => {
    await finishedIn("Bread", 6, 3);
    expect(names((await w.restock(RAHUL)).finished)).toEqual([["Flat 4B", "Bread"]]);

    w.daysAgo(0);
    const bought = await w.buy(RAHUL, [{ pantry: w.flat.publicId, name: "bread ", category: "Grains", quantity: "1", unit: "pcs", priceMinor: 4500 }]);
    expect(bought.status).toBe(201);
    expect((await w.restock(RAHUL)).finished).toEqual([]);

    // Atta: an older pack still active does not hide the newer one finishing.
    w.daysAgo(10);
    await w.addTo(RAHUL, w.flat, { name: "Atta", quantity: "5", unit: "kg" });
    const newer = await finishedIn("Atta", 9, 2, { quantity: "1", unit: "kg" });
    const { finished } = await w.restock(RAHUL);
    expect(finished.map((l) => [l.name, l.last.itemId, l.why.itemId])).toEqual([["Atta", newer.id, newer.id]]);
  });

  it("lists a name in two pantries twice, latest finish first", async () => {
    w.daysAgo(6);
    const mine = await w.addMine(RAHUL, { name: "Bread" });
    await finishedIn("Bread", 5, 3);
    w.daysAgo(2);
    await w.useMine(RAHUL, mine, "1");

    const { finished } = await w.restock(RAHUL);
    expect(names(finished)).toEqual([
      ["My pantry", "Bread"],
      ["Flat 4B", "Bread"],
    ]);
    expect(finished[0]!.pantry).toEqual({ kind: "personal", name: "My pantry" });
    expect(finished[0]!.last.wastePolicy).toBeNull();
  });
});

describe("GET /v1/kitchen/me/restock — running low", () => {
  it(`lists active items under ${RESTOCK_LOW_PERCENT} % of what was bought, least left first`, async () => {
    w.daysAgo(3);
    const milk = await w.addTo(RAHUL, w.flat, { name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 6800 });
    const oil = await w.addTo(RAHUL, w.flat, { name: "Oil", quantity: "1", unit: "L" });
    const ghee = await w.addMine(RAHUL, { name: "Ghee", quantity: "500", unit: "g" });
    await w.useIn(RAHUL, w.flat, milk, "850", "ml");
    await w.useIn(RAHUL, w.flat, oil, "800", "ml"); // exactly 20 % left: not yet running low
    await w.useMine(RAHUL, ghee, "450", "g");

    const { runningLow, finished, usual } = await w.restock(RAHUL);
    expect(finished).toEqual([]);
    expect(usual).toEqual([]);
    expect(runningLow.map((l) => [l.pantry.name, l.name, l.reason, l.why])).toEqual([
      ["My pantry", "Ghee", "running_low", { leftQtyMilli: 50_000, boughtQtyMilli: 500_000, itemId: ghee.id }],
      ["Flat 4B", "Milk", "running_low", { leftQtyMilli: 150_000, boughtQtyMilli: 1_000_000, itemId: milk.id }],
    ]);
    expect(runningLow[1]!.last).toMatchObject({ itemId: milk.id, quantityMilli: 1_000_000, unit: "L", priceMinor: 6800 });
  });

  it("leaves a name out while another active item of it is above the line", async () => {
    w.daysAgo(4);
    const old = await w.addTo(RAHUL, w.flat, { name: "Sugar", quantity: "1", unit: "kg" });
    await w.useIn(RAHUL, w.flat, old, "900", "g");
    expect(names((await w.restock(RAHUL)).runningLow)).toEqual([["Flat 4B", "Sugar"]]);
    await w.addTo(ANU, w.flat, { name: "Sugar", quantity: "1", unit: "kg" });
    expect((await w.restock(RAHUL)).runningLow).toEqual([]);
  });
});

describe("GET /v1/kitchen/me/restock — you usually buy", () => {
  /** Bought on each of `days` (days ago) in Flat 4B, each used up the day after. */
  async function boughtOn(name: string, days: number[], group = w.flat, as = RAHUL) {
    const items = [];
    for (const d of days) {
      w.daysAgo(d);
      const item = await w.addTo(as, group, { name });
      w.daysAgo(d - 1);
      await w.useIn(as, group, item, "1");
      items.push(item);
    }
    return items;
  }

  it(`lists a name bought on ${RESTOCK_USUAL_MIN_TIMES} days in 120 once its median gap has passed since the last`, async () => {
    const atta = await boughtOn("Atta", [30, 20, 10]);
    const { usual, finished } = await w.restock(RAHUL);
    expect(finished).toEqual([]); // the last went 9 days ago
    expect(usual).toEqual([
      expect.objectContaining({
        name: "Atta",
        nameKey: "atta",
        pantry: expect.objectContaining({ name: "Flat 4B" }),
        canAdd: true,
        reason: "usual",
        why: { everyDays: 10, lastBoughtAt: w.daysAgo(10), times: 3 },
        last: expect.objectContaining({ itemId: atta[2]!.id }),
      }),
    ]);
  });

  it("needs 3 different days: two, or two packs on one day and one more, are not a habit", async () => {
    await boughtOn("Dal", [30, 15]);
    await boughtOn("Oats", [30, 30, 15]);
    await boughtOn("Rice", [45, 30, 15]);
    expect(names((await w.restock(RAHUL)).usual)).toEqual([["Flat 4B", "Rice"]]);
  });

  it("waits for the median gap: not before it has passed, and only purchases in the last 120 days count", async () => {
    await boughtOn("Poha", [60, 40, 15]); // gaps 20 and 25: every 23 days, 15 since
    await boughtOn("Jaggery", [200, 180, 160]);
    expect((await w.restock(RAHUL)).usual).toEqual([]);
    await boughtOn("Besan", [60, 40, 25]); // gaps 20 and 15: every 18 days, 25 since
    const { usual } = await w.restock(RAHUL);
    expect(usual.map((l) => [l.name, l.why.everyDays])).toEqual([["Besan", 18]]);
  });

  it("is left out while an active item of the name is above running low", async () => {
    await boughtOn("Salt", [30, 20]);
    w.daysAgo(10);
    const salt = await w.addTo(RAHUL, w.flat, { name: "Salt", quantity: "1", unit: "kg" });
    await w.useIn(RAHUL, w.flat, salt, "500", "g");
    expect(await w.restock(RAHUL)).toEqual({ finished: [], runningLow: [], usual: [] });
  });

  it("puts each name and pantry once, in the first group it fits: finished, then running low, then usual", async () => {
    // Rice: an older pack nearly gone, a newer one finished yesterday.
    w.daysAgo(12);
    const older = await w.addTo(RAHUL, w.flat, { name: "Rice", quantity: "1", unit: "kg" });
    await w.useIn(RAHUL, w.flat, older, "900", "g");
    await finishedIn("Rice", 10, 1, { quantity: "1", unit: "kg" });
    // Eggs: a habit (21, 14, 7 days ago), and the last pack is running low.
    await boughtOn("Eggs", [21, 14]);
    w.daysAgo(7);
    const eggs = await w.addTo(RAHUL, w.flat, { name: "Eggs", quantity: "10", unit: "pcs" });
    await w.useIn(RAHUL, w.flat, eggs, "9");

    const restock = await w.restock(RAHUL);
    expect(names(restock.finished)).toEqual([["Flat 4B", "Rice"]]);
    expect(names(restock.runningLow)).toEqual([["Flat 4B", "Eggs"]]);
    expect(restock.usual).toEqual([]);
  });

  it("orders usual lines most overdue first", async () => {
    await boughtOn("Atta", [30, 20, 10]); // every 10, 10 since: 1×
    await boughtOn("Tea", [36, 30, 24]); // every 6, 24 since: 4×
    expect(names((await w.restock(RAHUL)).usual)).toEqual([
      ["Flat 4B", "Tea"],
      ["Flat 4B", "Atta"],
    ]);
  });

  it("does not count removed items or dish leftovers as purchases", async () => {
    await boughtOn("Ghee", [30, 10]);
    w.daysAgo(20);
    const mistake = await w.addTo(RAHUL, w.flat, { name: "Ghee" });
    expect((await w.call("DELETE", `/v1/organizations/${w.flat.publicId}/kitchen/items/${mistake.id}`, RAHUL)).status).toBe(200);
    const leftovers = await finishedIn("Dal makhani", 3, 1);
    w.h.db.prepare("UPDATE kitchen_items SET source_dish_id = ? WHERE id = ?").run(randomUUID(), uuidOf(leftovers.id));
    expect(await w.restock(RAHUL)).toEqual({ finished: [], runningLow: [], usual: [] });
  });
});

describe("GET /v1/kitchen/me/restock — whose pantries", () => {
  it("reads a viewer's group without offering to buy for it, and never a group the caller is not in", async () => {
    w.daysAgo(5);
    const biscuits = await w.addTo(MEERA, w.books, { name: "Biscuits" });
    w.daysAgo(2);
    await w.useIn(MEERA, w.books, biscuits, "1");
    for (const d of [30, 20, 10]) {
      w.daysAgo(d);
      const tea = await w.addTo(MEERA, w.books, { name: "Tea" });
      w.daysAgo(d - 1);
      await w.useIn(MEERA, w.books, tea, "1");
    }
    w.daysAgo(4);
    const theirs = await w.addTo(OUTSIDER, w.elsewhere, { name: "Bread" });
    w.daysAgo(3);
    await w.useIn(OUTSIDER, w.elsewhere, theirs, "1");

    const mine = await w.restock(RAHUL);
    expect(mine.finished.map((l) => [l.pantry.name, l.name, l.canAdd])).toEqual([["Book club", "Biscuits", false]]);
    expect(mine.usual).toEqual([]);
    // Meera, its owner, is offered Tea.
    expect(names((await w.restock(MEERA)).usual)).toEqual([["Book club", "Tea"]]);
  });

  it("stops reading a group the caller has left", async () => {
    await finishedIn("Bread", 5, 2);
    w.h.revoke(RAHUL, w.flat);
    expect((await w.restock(RAHUL)).finished).toEqual([]);
    expect(names((await w.restock(ANU)).finished)).toEqual([["Flat 4B", "Bread"]]);
  });

  it("is one D1 statement however much there is, 503 when membership cannot be read, and 401 without an actor", async () => {
    await finishedIn("Bread", 5, 2);
    await finishedIn("Milk", 6, 3);
    const real = w.h.env.PLATFORM_DB!;
    let statements = 0;
    (w.h.env as { PLATFORM_DB?: D1Database }).PLATFORM_DB = {
      prepare(query: string) {
        statements += 1;
        return real.prepare(query);
      },
      batch: (s: D1PreparedStatement[]) => real.batch(s),
    } as unknown as D1Database;
    expect((await w.restock(RAHUL)).finished).toHaveLength(2);
    expect(statements).toBe(1);

    w.h.failGroups = true;
    expect((await w.call("GET", me("restock"), RAHUL)).status).toBe(503);
    w.h.failGroups = false;
    expect((await w.call("GET", me("restock"), null)).status).toBe(401);
    expect((await w.call("POST", me("restock"), RAHUL, {})).status).toBe(405);
  });
});

describe("the usual's gap", () => {
  it("is the median of the gaps between purchase days: the middle one, or the mean of the middle two", () => {
    expect(medianGap(["2026-10-01"])).toBeNull();
    expect(medianGap(["2026-10-01", "2026-10-11", "2026-10-15"])).toBe(7); // gaps 10, 4
    expect(medianGap(["2026-10-01", "2026-10-11", "2026-10-13", "2026-10-21", "2026-10-31"])).toBe(9); // gaps 10, 2, 8, 10
    expect(medianGap(["2026-10-01", "2026-10-04", "2026-10-30", "2026-11-02"])).toBe(3); // gaps 3, 26, 3
  });

  it("is due once the rounded gap has passed since the last purchase", () => {
    const today = NOW.toISOString().slice(0, 10);
    expect(dueUsual(["2026-10-01", "2026-10-11"], "2026-10-11", today)).toBeNull(); // two days only
    expect(dueUsual(["2026-11-01", "2026-11-04", "2026-11-06"], "2026-11-06", today)).toBeNull(); // every 3 (2.5), 2 since
    expect(dueUsual(["2026-11-01", "2026-11-04", "2026-11-05"], "2026-11-05", today)).toEqual({
      everyDays: 2, // 2 (gaps 3 and 1)
      lastBoughtAt: "2026-11-05",
      times: 3,
      overdue: 1.5,
    });
    expect(dueUsual(["2026-11-06", "2026-11-07", "2026-11-08"], "2026-11-08", today)).toBeNull(); // every day, bought today
  });
});
