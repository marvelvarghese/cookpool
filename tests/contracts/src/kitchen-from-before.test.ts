import type {
  FromBeforePantry,
  FromBeforeQuery,
  ItemHistoryQuery,
  ItemHistoryResponse,
  RecipesQuery,
  RecipesResponse,
} from "@saas/contracts/kitchen";
import { FROM_BEFORE_DEFAULT_LIMIT, FROM_BEFORE_MAX_LIMIT } from "@saas/contracts/kitchen";

describe("contracts: from before (Cookpool SM-8)", () => {
  it("suggests 8 by default and at most 20", () => {
    expect(FROM_BEFORE_DEFAULT_LIMIT).toBe(8);
    expect(FROM_BEFORE_MAX_LIMIT).toBe(20);
    const query: FromBeforeQuery = { q: "mi", limit: FROM_BEFORE_MAX_LIMIT };
    const items: ItemHistoryQuery = query;
    const recipes: RecipesQuery = {};
    expect([items, recipes]).toEqual([{ q: "mi", limit: 20 }, {}]);
  });

  it("names last time's pantry with its org id, or null for the caller's own", () => {
    const pantries: FromBeforePantry[] = [
      { kind: "personal", orgId: null, name: "My pantry" },
      { kind: "group", orgId: "org_1", name: "Flat 4B" },
    ];
    expect(pantries.map((p) => p.orgId)).toEqual([null, "org_1"]);
  });

  it("types GET /v1/kitchen/me/items/history: one entry per name, with everything the add form takes from last time", () => {
    const history: ItemHistoryResponse = {
      items: [
        {
          name: "Milk",
          category: "Dairy",
          dimension: "volume",
          unit: "L",
          quantity: 1,
          qtyMilli: 1_000_000,
          priceMinor: 6800,
          currency: "INR",
          pantry: { kind: "group", orgId: "org_1", name: "Flat 4B" },
          paidBy: "usr_anu",
          wastePolicy: null,
          useByDays: 5,
          times: 6,
          lastBoughtOn: "2026-11-01",
        },
        {
          name: "Mint leaves",
          category: "Veg",
          dimension: "pack",
          unit: "pack",
          quantity: 1,
          qtyMilli: 1_000,
          priceMinor: 2000,
          currency: "INR",
          pantry: { kind: "personal", orgId: null, name: "My pantry" },
          paidBy: "usr_rahul",
          wastePolicy: null,
          useByDays: null,
          times: 2,
          lastBoughtOn: "2026-10-28",
        },
      ],
    };
    expect(history.items.map((i) => [i.name, i.times, i.useByDays])).toEqual([["Milk", 6, 5], ["Mint leaves", 2, null]]);
  });

  it("types GET /v1/kitchen/me/dishes/recipes: last time's dish, each ingredient matched to an item usable now or null", () => {
    const recipes: RecipesResponse = {
      recipes: [
        {
          name: "Egg fried rice",
          times: 3,
          lastCookedAt: "2026-11-03T13:00:00.000Z",
          portionsHalf: 10,
          extrasMinor: 1500,
          totalMinor: 15600,
          currency: "INR",
          orgId: "org_1",
          ingredients: [
            {
              name: "Basmati rice",
              qtyMilli: 250_000,
              quantity: 250,
              unit: "g",
              dimension: "mass",
              pantry: { kind: "group", orgId: "org_1", name: "Flat 4B" },
              match: {
                itemId: "itm_1",
                ref: "org:org_1:itm_1",
                pantry: { kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B" },
                qtyLeftMilli: 750_000,
                canUse: true,
              },
            },
            {
              name: "Spring onions",
              qtyMilli: 1_000,
              quantity: 1,
              unit: "pack",
              dimension: "pack",
              pantry: null,
              match: null,
            },
          ],
        },
      ],
    };
    const [recipe] = recipes.recipes;
    expect(recipe!.ingredients.map((i) => i.match?.ref ?? null)).toEqual(["org:org_1:itm_1", null]);
  });
});
