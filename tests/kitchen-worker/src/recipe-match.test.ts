// What you have (Cookpool RC-4, cookpool-recipes design §3.3, §3.4, §5.4)
// through the router: each line of Chicken curry matched against every item
// the caller may use — their own pantry and each group where they hold
// kitchen.item.use — as have, short, missing or always; the items it would
// take, soonest use-by first, then the caller's own, then the most left;
// counts meeting weights through the food's piece weight or the item's own
// measure; Always have; the largest factor the stock allows; and Cook now's
// order.

import type { CookDishResponse, CookNowResponse, RecipeMatchResponse } from "@saas/contracts/kitchen";
import {
  ANU, OLU, RAHUL, VIK, addItem, chickenCurry, groupPath, me, systemRecipe, withoutCookpoolSeed, world, writeRecipe, type World,
} from "./recipes-helpers.js";

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.h.close());

const match = (id: string, as: string, query = "") => w.call<RecipeMatchResponse>("GET", me(`recipes/${id}/match${query}`), as);

/** Rahul's pantries: chicken in his own and in Flat 4B, onions in both (Flat's counted in onions of 100 g), turmeric by weight. */
async function stock() {
  const ownChicken = await addItem(w, RAHUL, null, { name: "Chicken", category: "protein", quantity: "500", unit: "g", priceMinor: 15000, expiresOn: "2026-11-12" });
  const flatChicken = await addItem(w, ANU, w.flat, { name: "Chicken", category: "protein", quantity: "300", unit: "g", priceMinor: 9000, expiresOn: "2026-11-10" });
  const flatOnions = await addItem(w, ANU, w.flat, { name: "Onions", quantity: "500", unit: "g", priceMinor: 2000 });
  w.tick();
  const measured = await w.call("PUT", groupPath(w.flat, `items/${flatOnions.id}/measures`), ANU, {
    measures: [{ one: "onion", many: "onions", count: 1, amountMilli: 100_000 }],
  });
  expect(measured.status).toBe(200);
  const ownOnions = await addItem(w, RAHUL, null, { name: "Onions", quantity: "1", unit: "kg", priceMinor: 4000 });
  const turmeric = await addItem(w, RAHUL, null, { name: "Haldi", category: "spices", quantity: "100", unit: "g", priceMinor: 3000 });
  const milk = await addItem(w, RAHUL, null, { name: "Amul taaza", category: "dairy", quantity: "1", unit: "L", priceMinor: 6800 });
  // Olu's chicken is in nobody else's pantries.
  await addItem(w, OLU, w.elsewhere, { name: "Chicken", category: "protein", quantity: "2", unit: "kg", priceMinor: 60000 });
  return { ownChicken, flatChicken, flatOnions, ownOnions, turmeric, milk };
}

describe("GET /v1/kitchen/me/recipes/{rcp}/match (RC-4, design §3.3)", () => {
  it("marks each line have, short, missing or always and names the items it would take, soonest use-by first", async () => {
    const s = await stock();
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const res = await match(curry.id, RAHUL);
    expect(res.status).toBe(200);
    const m = res.body.data;
    expect(m).toMatchObject({ recipeId: curry.id, factorMilli: 1000, portions: { portionsHalf: 8, about: false, label: "4" } });
    expect(m.lines.map((l) => [l.position, l.status, l.needMilli, l.availableMilli])).toEqual([
      [0, "short", 1_000_000, 800_000], // 300 g in Flat 4B and 500 g of his own
      [1, "have", 2_000, 11_666], // 5 onions of 100 g in the flat, 1 kg of his own at 150 g each
      [2, "missing", 200_000, 0],
      [3, "have", 5_000, 166_666], // a spoon of turmeric meets 100 g of it through its density, 0.6 g/ml (RC-7)
      [4, "always", null, 0], // salt, to taste
    ]);
    // The flat's chicken goes first: it is to be used by the 10th; his own by the 12th.
    expect(m.lines[0]!.items.map((i) => [i.itemId, i.orgId, i.qtyLeftMilli, i.takeMilli, i.ref])).toEqual([
      [s.flatChicken.id, w.flat.publicId, 300_000, 300_000, `org:${w.flat.publicId}:${s.flatChicken.id}`],
      [s.ownChicken.id, null, 500_000, 500_000, `me:${s.ownChicken.id}`],
    ]);
    expect(m.lines[0]!.items[0]!.pantry).toMatchObject({ kind: "group", orgId: w.flat.publicId });
    // Neither onion has a use-by date: his own pantry first, two onions at 150 g each.
    expect(m.lines[1]!.items.map((i) => [i.itemId, i.takeMilli, i.unit])).toEqual([[s.ownOnions.id, 300_000, "kg"]]);
    // The teaspoon is 3 g of the pack.
    expect(m.lines[3]!.items.map((i) => [i.itemId, i.takeMilli, i.unit])).toEqual([[s.turmeric.id, 3_000, "g"]]);
    expect(m.summary).toEqual({ lines: 5, have: 2, short: 1, missing: 1, always: 1, missingNames: ["Tomatoes"], maxFactorMilli: null });
    // What he could be asked about: the milk links to no food.
    expect(m.unlinked).toEqual([{ itemId: s.milk.id, orgId: null, name: "Amul taaza", nameKey: "amul taaza" }]);
  });

  it("scales every line by the factor first: at 450 g of chicken there is enough, and the portions read about 2", async () => {
    const s = await stock();
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const m = (await match(curry.id, RAHUL, "?f=450")).body.data;
    expect(m.factorMilli).toBe(450);
    expect(m.portions).toEqual({ portionsHalf: 4, about: true, label: "about 2" });
    expect(m.lines.map((l) => [l.status, l.needMilli, l.needQuantity, l.unit])).toEqual([
      ["have", 450_000, 0.45, "kg"],
      ["have", 1_000, 1, "onion"], // 0.9 onion rounds to 1
      ["missing", 90_000, 90, "g"],
      ["have", 2_500, 0.5, "tsp"],
      ["always", null, null, null],
    ]);
    expect(m.lines[0]!.items.map((i) => [i.itemId, i.takeMilli])).toEqual([
      [s.flatChicken.id, 300_000],
      [s.ownChicken.id, 150_000],
    ]);
  });

  it("counts what is on Always have as there, and allows the largest factor the stock does once nothing is missing", async () => {
    await stock();
    const curry = await writeRecipe(w, ANU, chickenCurry);
    await w.call("PUT", me("always-have"), RAHUL, { foodKeys: ["salt", "turmeric"] });
    await addItem(w, RAHUL, w.lunch, { name: "Tomatoes", quantity: "1", unit: "kg", priceMinor: 3000 });
    const m = (await match(curry.id, RAHUL)).body.data;
    expect(m.lines.map((l) => l.status)).toEqual(["short", "have", "have", "always", "always"]);
    // Chicken limits it: 800 g of 1 kg.
    expect(m.summary).toMatchObject({ missing: 0, always: 2, missingNames: [], maxFactorMilli: 800 });
    expect(m.lines[2]!.items[0]!.orgId).toBe(w.lunch.publicId);
  });

  it("counts only what the caller may use: a viewer of Flat 4B has nothing of it", async () => {
    await stock();
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const m = (await match(curry.id, VIK)).body.data;
    expect(m.lines.map((l) => [l.status, l.availableMilli])).toEqual([
      ["missing", 0], ["missing", 0], ["missing", 0], ["missing", 0], ["always", 0],
    ]);
    expect(m.unlinked).toEqual([]);
  });

  it("meets a weighed line with counted items through the food's piece weight, and a free-text line with nothing", async () => {
    const eggs = await addItem(w, RAHUL, null, { name: "Eggs", category: "protein", quantity: "6", unit: "pcs", priceMinor: 4200 });
    const bhurji = await writeRecipe(w, RAHUL, {
      name: "Egg bhurji",
      servesHalf: 2,
      lines: [
        { foodKey: "egg", name: "Eggs", quantity: "100", unit: "g", isMain: true },
        { name: "A pinch of love", quantity: 1, unit: "pcs" },
      ],
    });
    const m = (await match(bhurji.id, RAHUL)).body.data;
    expect(m.lines[0]).toMatchObject({ status: "have", needMilli: 100_000, availableMilli: 300_000 });
    expect(m.lines[0]!.items).toEqual([expect.objectContaining({ itemId: eggs.id, takeMilli: 2_000, unit: "pcs" })]); // two eggs of 50 g
    expect(m.lines[1]).toMatchObject({ status: "missing", availableMilli: 0, items: [] });
  });

  it("is a read for whoever may see the recipe, and refuses a factor out of range", async () => {
    const curry = await writeRecipe(w, ANU, { ...chickenCurry, visibility: "only_me" });
    expect((await match(curry.id, RAHUL)).status).toBe(404);
    expect((await match(curry.id, ANU)).status).toBe(200);
    for (const f of ["5", "20001", "abc", "0.5"]) {
      const res = await match(curry.id, ANU, `?f=${f}`);
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields).toHaveProperty("f");
    }
    // Nothing was taken: the match reserves nothing.
    expect((w.h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_stock_moves").get() as { n: number }).n).toBe(0);
  });
});

describe("GET /v1/kitchen/me/cook-now (RC-4, design §5.4)", () => {
  it("ranks every recipe the caller can see by fewest missing, then the largest factor, then the most recently cooked", async () => {
    withoutCookpoolSeed(w);
    await addItem(w, RAHUL, null, { name: "Rice", category: "grains", quantity: "1", unit: "kg", priceMinor: 9000 });
    const salt = await addItem(w, RAHUL, null, { name: "Salt", category: "spices", quantity: "1", unit: "kg", priceMinor: 2500 });
    const rice = (name: string, grams: string, servesHalf: number) => ({
      name,
      servesHalf,
      lines: [{ foodKey: "rice", name: "Rice", quantity: grams, unit: "g" }],
    });
    const bowl = await writeRecipe(w, RAHUL, rice("Rice bowl", "500", 4)); // × 2 of what he has
    const big = await writeRecipe(w, RAHUL, rice("Big rice", "2000", 8)); // × 0.5
    const again = await writeRecipe(w, RAHUL, rice("Rice again", "2000", 8)); // × 0.5, cooked below
    const anus = await writeRecipe(w, ANU, rice("Anu's rice", "1000", 8)); // × 1, through Flat 4B
    await writeRecipe(w, ANU, { ...rice("Anu's secret", "100", 2), visibility: "only_me" });
    await writeRecipe(w, OLU, rice("Olu's rice", "100", 2));
    const tikka = await writeRecipe(w, RAHUL, {
      name: "Paneer tikka",
      servesHalf: 4,
      lines: [{ foodKey: "paneer", name: "Paneer", quantity: "200", unit: "g" }, { foodKey: "rice", name: "Rice", quantity: "100", unit: "g" }],
    });
    systemRecipe(w, "Masala chai", 4, [["tea", "Tea", 10_000, "g", true], ["milk", "Milk", 250_000, "ml", false]]);

    // "Rice again" was cooked (from something else entirely): that only breaks its tie with "Big rice".
    w.tick();
    const cooked = await w.call<CookDishResponse>("POST", me("dishes"), RAHUL, {
      name: "Rice again",
      portionsHalf: 2,
      splitMode: "assign",
      recipeId: again.id,
      ingredients: [{ itemId: salt.id, quantity: "10", unit: "g" }],
    });
    expect(cooked.status).toBe(201);

    const res = await w.call<CookNowResponse>("GET", me("cook-now"), RAHUL);
    expect(res.status).toBe(200);
    expect(res.body.data.recipes.map((e) => [e.recipe.name, e.match.missing, e.match.maxFactorMilli, e.forPortionsHalf])).toEqual([
      ["Rice bowl", 0, 2000, 8], // serves 2 × 2, at most twice its serves
      ["Anu's rice", 0, 1000, 8],
      ["Rice again", 0, 500, 4],
      ["Big rice", 0, 500, 4],
      ["Paneer tikka", 1, null, null],
      ["Masala chai", 2, null, null],
    ]);
    expect(res.body.data.recipes[0]!.recipe.id).toBe(bowl.id);
    expect(res.body.data.recipes.find((e) => e.recipe.id === big.id)!.recipe.lastCookedAt).toBeNull();
    expect(res.body.data.recipes.find((e) => e.recipe.id === again.id)!.recipe.lastCookedAt).not.toBeNull();
    expect(res.body.data.recipes.find((e) => e.recipe.id === anus.id)!.recipe.ownerName).toBe("Anu");
    expect(res.body.data.recipes.find((e) => e.recipe.id === tikka.id)!.match.missingNames).toEqual(["Paneer"]);
    expect(res.body.data.recipes.find((e) => e.recipe.name === "Masala chai")!.match.missingNames).toEqual(["Tea", "Milk"]);
  });

  it("returns at most 20, each naming at most three missing lines", async () => {
    withoutCookpoolSeed(w);
    for (let i = 0; i < 24; i += 1) {
      systemRecipe(w, `Staple ${String(i).padStart(2, "0")}`, 4, [
        ["tea", "Tea", 10_000, "g", true], ["milk", "Milk", 1_000, "ml", false], ["sugar", "Sugar", 1_000, "g", false], ["ginger", "Ginger", 1_000, "g", false],
      ]);
    }
    const res = await w.call<CookNowResponse>("GET", me("cook-now"), OLU);
    expect(res.body.data.recipes).toHaveLength(20);
    expect(res.body.data.recipes[0]!.match).toMatchObject({ missing: 4, missingNames: ["Tea", "Milk", "Sugar"] });
    // Same everything: by name.
    expect(res.body.data.recipes[0]!.recipe.name).toBe("Staple 00");
  });

  it("lifts a recipe that needed turmeric once turmeric is on Always have", async () => {
    await addItem(w, RAHUL, null, { name: "Toor dal", category: "grains", quantity: "1", unit: "kg", priceMinor: 16000 });
    const dal = await writeRecipe(w, RAHUL, {
      name: "Dal",
      servesHalf: 4,
      lines: [{ foodKey: "toor_dal", name: "Toor dal", quantity: "200", unit: "g" }, { foodKey: "turmeric", name: "Turmeric", quantity: "0.5", unit: "tsp" }],
    });
    await writeRecipe(w, RAHUL, { name: "Plain rice", servesHalf: 4, lines: [{ foodKey: "rice", name: "Rice", quantity: "200", unit: "g" }] });
    const before = (await w.call<CookNowResponse>("GET", me("cook-now"), RAHUL)).body.data.recipes;
    expect(before.find((e) => e.recipe.id === dal.id)!.match.missing).toBe(1);
    await w.call("PUT", me("always-have"), RAHUL, { foodKeys: ["turmeric"] });
    const after = (await w.call<CookNowResponse>("GET", me("cook-now"), RAHUL)).body.data.recipes;
    expect(after[0]).toMatchObject({ recipe: { id: dal.id }, match: { missing: 0, always: 1, maxFactorMilli: 5000 }, forPortionsHalf: 8 });
  });
});
