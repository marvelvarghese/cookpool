import {
  MAX_SHOPPING_CLEAR,
  MAX_SHOPPING_ITEMS,
  MAX_STAPLES,
  STAPLE_ERROR_REASONS,
  STAPLE_NAME_MAX,
  STAPLE_STATUSES,
  shoppingLines,
  stapleListed,
  type KitchenStaple,
  type ShoppingItem,
} from "@saas/contracts/kitchen";

// Always have per pantry and the shopping list (cookpool-revamp RV-21): the
// statuses, the limits and the one rule for what is on a pantry's list.

const staple = (o: Partial<KitchenStaple> & { name: string }): KitchenStaple => ({
  id: "stp_1", foodKey: null, status: "ok", lastPriceMinor: null, currency: null, lastQtyMilli: null, lastUnit: null,
  wantQtyMilli: null, wantUnit: null, boughtAt: null, updatedBy: "usr_a", updatedAt: "2026-11-13T00:00:00.000Z", ...o,
});
const item: ShoppingItem = { id: "shp_1", name: "Onions", qtyMilli: 1_000_000, unit: "kg", addedBy: "usr_a", createdAt: "2026-11-13T00:00:00.000Z" };

describe("kitchen staples (RV-21)", () => {
  it("pins the statuses, limits and the refusal reason", () => {
    expect(STAPLE_STATUSES).toEqual(["ok", "low", "out"]);
    expect([STAPLE_NAME_MAX, MAX_STAPLES, MAX_SHOPPING_ITEMS, MAX_SHOPPING_CLEAR]).toEqual([60, 40, 100, 200]);
    expect(STAPLE_ERROR_REASONS.ALREADY_LISTED).toBe("already_listed");
  });

  it("lists staples running low or out (wanted amount, else last bought), then the hand-added lines", () => {
    expect(stapleListed({ status: "ok" })).toBe(false);
    expect(stapleListed({ status: "low" })).toBe(true);
    const lines = shoppingLines({
      staples: [
        staple({ name: "Salt" }),
        staple({ name: "Tea", status: "out", lastQtyMilli: 250_000, lastUnit: "g" }),
        staple({ name: "Oil", status: "low", lastQtyMilli: 1_000_000, lastUnit: "L", wantQtyMilli: 2_000_000, wantUnit: "L" }),
      ],
      items: [item],
    });
    expect(lines.map((l) => [l.source, l.source === "staple" ? l.staple.name : l.item.name, l.qtyMilli, l.unit])).toEqual([
      ["staple", "Tea", 250_000, "g"],
      ["staple", "Oil", 2_000_000, "L"],
      ["hand", "Onions", 1_000_000, "kg"],
    ]);
  });
});
