import type {
  CookIngredientRequest,
  ItemScope,
  KitchenDishIngredient,
  KitchenItem,
  KitchenMeasure,
  KitchenStockMove,
  KitchenUsual,
  SetMeasuresRequest,
  SetMeasuresResponse,
  UseGroupItemRequest,
  UsePersonalItemRequest,
} from "@saas/contracts/kitchen";
import {
  MAX_MEASURES,
  MAX_MEASURE_QUANTITY,
  MAX_MEASURE_WORD,
  findMeasure,
  inMeasure,
  measureLabel,
  measureTakeMilli,
} from "@saas/contracts/kitchen";

// Your measures (Cookpool SM-13): a size an item's name is counted in, kept
// exactly as `count` of it making `amountMilli` of the stock. The words a
// use reads in, and how much of the stock it takes, are shared by the server
// and the app: these pin them.

const onion: KitchenMeasure = { id: "msr_1", one: "onion", many: "onions", count: 1, amountMilli: 150_000 }; // 1 onion ≈ 150 g
const slice: KitchenMeasure = { id: "msr_2", one: "slice", many: "slices", count: 16, amountMilli: 1_000 }; // 16 slices in a pack
const kilo = { qtyBoughtMilli: 1_000_000, qtyLeftMilli: 1_000_000 };
const pack = { qtyBoughtMilli: 1_000, qtyLeftMilli: 1_000 };

describe("contracts: your measures (Cookpool SM-13)", () => {
  it("allows three measures per name, words of 24 characters, and counts up to 10 000", () => {
    expect([MAX_MEASURES, MAX_MEASURE_WORD, MAX_MEASURE_QUANTITY]).toEqual([3, 24, 10_000]);
  });

  it("types the route, the item's measures, a use and an ingredient in a measure, and the words they keep", () => {
    const set: SetMeasuresRequest = { measures: [{ one: "onion", many: "onions", count: 1, amountMilli: 150_000 }] };
    const answer: SetMeasuresResponse = { measures: [onion] };
    const scopes: ItemScope[] = [{ kind: "personal" }, { kind: "group", orgId: "org_1" }];
    // An item's pantry is a scope.
    const pantry: KitchenItem["pantry"] = { kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B" };
    const fromItem: ItemScope = pantry;
    const use: UseGroupItemRequest = { quantity: 2, measure: "onion", consumers: ["usr_rahul"] };
    const mine: UsePersonalItemRequest = { quantity: "0.5", measure: "onion" };
    const ingredient: CookIngredientRequest = { itemId: "itm_1", quantity: 2, measure: "onion" };
    const move: Pick<KitchenStockMove, "qtyMilli" | "quantity" | "unit" | "label"> = { qtyMilli: 300_000, quantity: 0.3, unit: "kg", label: "2 onions" };
    const inDish: Pick<KitchenDishIngredient, "unit" | "label"> = { unit: "kg", label: "2 onions" };
    const usual: Pick<KitchenUsual, "lastLabel" | "measures"> = { lastLabel: "1½ onions", measures: [onion] };
    const item: Pick<KitchenItem, "measures"> = { measures: [onion, slice] };
    expect(set.measures[0]).toEqual({ one: "onion", many: "onions", count: 1, amountMilli: 150_000 });
    expect(answer.measures[0]!.id).toMatch(/^msr_/);
    expect(scopes.map((s) => s.kind)).toEqual(["personal", "group"]);
    expect(fromItem.kind).toBe("group");
    expect([use.measure, mine.measure, ingredient.measure]).toEqual(["onion", "onion", "onion"]);
    expect([move.label, inDish.label, usual.lastLabel]).toEqual(["2 onions", "2 onions", "1½ onions"]);
    expect(item.measures).toHaveLength(2);
  });

  it("says ½ onion, 1 onion, 1½ onions, 2 onions: the word for one up to 1, for many above", () => {
    expect([0.5, 1, 1.5, 2, 2.5, 10].map((q) => measureLabel(q, onion))).toEqual([
      "½ onion",
      "1 onion",
      "1½ onions",
      "2 onions",
      "2½ onions",
      "10 onions",
    ]);
    expect(measureLabel(MAX_MEASURE_QUANTITY + 0.5, slice)).toBe("10000½ slices");
    // The longest label fits the move's 64 characters.
    expect(measureLabel(MAX_MEASURE_QUANTITY - 0.5, { one: "x".repeat(24), many: "y".repeat(24) }).length).toBeLessThanOrEqual(64);
  });

  it("finds a measure by its word for one, in any case and spacing", () => {
    expect(findMeasure([onion, slice], " Slice ")).toBe(slice);
    expect(findMeasure([onion, slice], "ONION")).toBe(onion);
    expect(findMeasure([onion, slice], "onions")).toBeUndefined();
    expect(findMeasure([], "onion")).toBeUndefined();
  });

  it("takes count × size of the stock, rounded to the thousandth, halves up", () => {
    expect(measureTakeMilli(2, onion, kilo)).toBe(300_000);
    expect(measureTakeMilli(0.5, onion, kilo)).toBe(75_000);
    expect(measureTakeMilli(1, slice, pack)).toBe(63); // 62.5
    expect(measureTakeMilli(0.5, slice, pack)).toBe(31); // 31.25
    expect(measureTakeMilli(3, { count: 3, amountMilli: 1_000 }, pack)).toBe(1_000);
  });

  it("refuses more than is left, and takes exactly what is left when the rest is within the measure's rounding", () => {
    expect(measureTakeMilli(7, onion, kilo)).toBeNull(); // 1 050 g of 1 kg
    expect(measureTakeMilli(1, onion, { ...kilo, qtyLeftMilli: 100_000 })).toBeNull(); // 100 g is not an onion
    expect(measureTakeMilli(0.5, onion, { ...kilo, qtyLeftMilli: 100_000 })).toBe(75_000);
    expect(measureTakeMilli(1, onion, { ...kilo, qtyLeftMilli: 0 })).toBeNull();

    // A pack eaten slice by slice: 15 slices of 63, then the 55 that are left.
    let left = 1_000;
    const taken: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      const take = measureTakeMilli(1, slice, { ...pack, qtyLeftMilli: left })!;
      taken.push(take);
      left -= take;
    }
    expect(taken).toEqual([...Array(15).fill(63), 55]);
    expect(left).toBe(0);
    // Half by half too: 31 a time, and the last takes the 39 left.
    left = 1_000;
    let halves = 0;
    while (left > 0) {
      left -= measureTakeMilli(0.5, slice, { ...pack, qtyLeftMilli: left })!;
      halves += 1;
    }
    expect(halves).toBe(32);
    // The rounding allowed is never more than a quarter of the measure: a gram's worth of rice grains, one grain at a time, is not absorbed.
    const grain = { count: 50, amountMilli: 1_000 }; // 50 grains a gram: 20 thousandths each, exact
    expect(measureTakeMilli(1, grain, { qtyBoughtMilli: 1_000_000, qtyLeftMilli: 30 })).toBe(20);
    expect(measureTakeMilli(2, grain, { qtyBoughtMilli: 1_000_000, qtyLeftMilli: 30 })).toBeNull();
  });

  it("counts what is left in a measure, to the nearest half", () => {
    expect(inMeasure(1_000_000, onion)).toBe(6.5); // 6.67 onions
    expect(inMeasure(100_000, onion)).toBe(0.5);
    expect(inMeasure(55, slice)).toBe(1); // 0.88 of a slice
    expect(inMeasure(0, slice)).toBe(0);
  });
});
