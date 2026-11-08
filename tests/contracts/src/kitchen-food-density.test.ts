import type { AlwaysHaveResponse, FoodMatch, FoodsResponse, KitchenFood } from "@saas/contracts/kitchen";
import { RECIPE_UNITS, RECIPE_UNIT_KEYS, recipeUnitOf } from "@saas/contracts/kitchen";

// A food's density (Cookpool RC-7, cookpool-recipes design §2, §3.3): every
// read that shows a food — the food list's search, Always have — carries
// gPerMl, grams per millilitre, so a client can say what a spoon of it
// weighs. It is null when the food has none, and optional in the type so a
// food typed before RC-7 still checks.

describe("contracts: a food's density (RC-7)", () => {
  it("types gPerMl on every food a read shows: grams per millilitre, null when it has none, absent before RC-7", () => {
    const turmeric: KitchenFood = { key: "turmeric", name: "Turmeric", dimension: "mass", eachG: null, category: "spices", gPerMl: 0.6 };
    const paneer: KitchenFood = { key: "paneer", name: "Paneer", dimension: "mass", eachG: null, category: "dairy", gPerMl: null };
    const typedBefore: KitchenFood = { key: "egg", name: "Egg", dimension: "count", eachG: 50, category: "protein" };
    const haldi: FoodMatch = { ...turmeric, matchedName: "haldi" };
    const found: FoodsResponse = { foods: [haldi] };
    const always: AlwaysHaveResponse = { foods: [turmeric, paneer, typedBefore], isDefault: false };
    expect(found.foods[0]!.gPerMl).toBe(0.6);
    expect(always.foods.map((f) => f.gPerMl ?? null)).toEqual([0.6, null, null]);
  });

  it("converts between the app's volumes and masses: a teaspoon of turmeric is 3 g, a cup of rice 192 g", () => {
    const of = (dimension: string) => RECIPE_UNIT_KEYS.filter((u) => RECIPE_UNITS[u].dimension === dimension);
    expect(of("volume")).toEqual(["ml", "L", "tsp", "tbsp", "cup"]);
    expect(of("mass")).toEqual(["g", "kg"]);
    // A unit's size in millilitres × the food's grams per millilitre.
    expect(recipeUnitOf("tsp").factor * 0.6).toBeCloseTo(3);
    expect(recipeUnitOf("cup").factor * 0.8).toBeCloseTo(192);
    expect(recipeUnitOf("tbsp").factor * 0.92).toBeCloseTo(13.8);
  });
});
