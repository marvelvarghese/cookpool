// Restocking in the contract (Cookpool PN-3, cookpool-pantry design §6.4):
// the windows and thresholds the restock read uses, the size of a shopping
// run, the three reasons in the order a name is placed, and the shapes of
// the routes — carried by `@saas/contracts/kitchen`.

import {
  PURCHASE_MAX_LINES,
  RESTOCK_FINISHED_DAYS,
  RESTOCK_LOW_PERCENT,
  RESTOCK_MAX_LINES,
  RESTOCK_REASONS,
  RESTOCK_USUAL_DAYS,
  RESTOCK_USUAL_MIN_TIMES,
  type CreatePurchaseRequest,
  type PurchaseResponse,
  type RestockLine,
  type RestockResponse,
  type UndoPurchaseResponse,
} from "@saas/contracts/kitchen";

describe("restocking's numbers", () => {
  it("are 7 days for finished, 3 purchase days in 120 for a usual, 20 % for running low, and 1 to 30 lines a run", () => {
    expect([RESTOCK_FINISHED_DAYS, RESTOCK_USUAL_DAYS, RESTOCK_USUAL_MIN_TIMES, RESTOCK_LOW_PERCENT]).toEqual([7, 120, 3, 20]);
    expect([PURCHASE_MAX_LINES, RESTOCK_MAX_LINES]).toEqual([30, 50]);
  });

  it("places a name in the first group it fits, in this order", () => {
    expect(RESTOCK_REASONS).toEqual(["finished", "running_low", "usual"]);
  });
});

describe("the routes' shapes", () => {
  it("type a restock line by its reason, with its why and the last purchase", () => {
    const last = {
      itemId: "itm_1",
      quantityMilli: 1000,
      unit: "pcs",
      priceMinor: 4500,
      currency: "INR",
      wastePolicy: null,
      expiresAfterDays: 4,
      paidBy: "usr_rahul",
    };
    const pantry = { kind: "personal", name: "My pantry" } as const;
    const lines: RestockLine[] = [
      { name: "Bread", nameKey: "bread", category: "Grains", pantry, canAdd: true, last, reason: "finished", why: { finishedAt: "2026-11-03T08:00:00.000Z", how: "used_up", itemId: "itm_1" } },
      { name: "Milk", nameKey: "milk", category: "Dairy", pantry, canAdd: true, last, reason: "running_low", why: { leftQtyMilli: 150_000, boughtQtyMilli: 1_000_000, itemId: "itm_2" } },
      { name: "Atta", nameKey: "atta", category: "Grains", pantry, canAdd: true, last, reason: "usual", why: { everyDays: 10, lastBoughtAt: "2026-10-29", times: 3 } },
    ];
    const restock: RestockResponse = { finished: [], runningLow: [], usual: [] };
    for (const line of lines) {
      if (line.reason === "finished") restock.finished.push(line);
      else if (line.reason === "running_low") restock.runningLow.push(line);
      else restock.usual.push(line);
    }
    expect([restock.finished.length, restock.runningLow.length, restock.usual.length]).toEqual([1, 1, 1]);

    const run: CreatePurchaseRequest = {
      lines: [{ pantry: "personal", name: "Bread", category: "Grains", quantity: "1", unit: "pcs", priceMinor: 4500, fromItemId: last.itemId }],
    };
    const made: PurchaseResponse = { purchaseId: "pur_1", items: [] };
    const undone: UndoPurchaseResponse = { purchaseId: made.purchaseId, removed: [], kept: [] };
    expect([run.lines.length, undone.purchaseId]).toEqual([1, "pur_1"]);
  });
});
