// Cookpool's own recipes and the food list's densities (Cookpool RC-7,
// cookpool-recipes design §2, §3.2, §3.3, §5.3–§5.5).
//
//   - Every recipe migration 360 seeds, checked against the contracts: one
//     main line that is not to taste; every line a food on the list (or to
//     taste); units the app knows; amounts above zero that scaleLine keeps as
//     written at × 1 and rounds onto the unit's grid at × 0.5 and × 2; 3 to 8
//     steps of at most 200 characters; serves 2 to 6; a kind Explore knows.
//   - The match through a food's density: a teaspoon of turmeric meets a
//     100 g pack, a cup of rice a 1 kg bag, 50 g of ghee a 500 ml jar, a cup
//     of chopped onion a dozen counted ones; a food without a density still
//     reads missing.
//   - Through the router: Cookpool's recipes in Explore (source=cookpool),
//     read in full by anyone, edited by no one, and in Cook now — where
//     Masala chai comes first once the pantry has its milk, tea, sugar and
//     ginger, the tea and sugar meeting their spoons by weight.

import {
  MAX_RECIPE_STEP,
  RECIPE_KINDS,
  RECIPE_UNIT_KEYS,
  recipeUnitOf,
  scaleLine,
  type CookNowResponse,
  type ExploreRecipesResponse,
  type RecipeMatchResponse,
  type RecipeResponse,
} from "@saas/contracts/kitchen";
import { migratedDatabase } from "./harness.js";
import { OLU, RAHUL, addItem, me, world, writeRecipe, type World } from "./recipes-helpers.js";

// ── The seed, read once ────────────────────────────────────

interface SeedRecipe {
  id: string;
  name: string;
  serves_half: number;
  minutes: number | null;
  kind: string | null;
  owner_id: string;
  is_system: number;
  visibility: string;
}
interface SeedLine {
  position: number;
  food_key: string | null;
  name: string;
  qty_milli: number | null;
  unit: string | null;
  to_taste: number;
  is_main: number;
}

const seed = migratedDatabase();
const RECIPES = seed.prepare("SELECT * FROM kitchen_recipes WHERE is_system = 1 ORDER BY created_at DESC, id DESC").all() as unknown as SeedRecipe[];
const linesOf = (id: string) =>
  seed.prepare("SELECT position, food_key, name, qty_milli, unit, to_taste, is_main FROM kitchen_recipe_lines WHERE recipe_id = ? ORDER BY position").all(id) as unknown as SeedLine[];
const stepsOf = (id: string) =>
  (seed.prepare("SELECT text FROM kitchen_recipe_steps WHERE recipe_id = ? ORDER BY position").all(id) as unknown as { text: string }[]).map((s) => s.text);
const FOODS = new Set((seed.prepare("SELECT key FROM kitchen_foods").all() as unknown as { key: string }[]).map((f) => f.key));
const publicId = (uuid: string) => `rcp_${uuid.replace(/-/g, "")}`;

afterAll(() => seed.close());

/** The grid design §3.2 rounds a line to, in thousandths of its base unit, for an exact amount of `exactMilli`. */
function gridOf(unit: string, exactMilli: number): number {
  if (unit === "g" || unit === "ml") return exactMilli < 100_000 ? 5_000 : exactMilli < 1_000_000 ? 10_000 : 50_000;
  if (unit === "kg" || unit === "L") return 10_000;
  return recipeUnitOf(unit).factor * 500; // pcs, tsp, tbsp, cup: half of one
}

describe("Cookpool's recipes, as migration 360 seeds them (RC-7, design §5.5)", () => {
  it("are about 40, all Cookpool's own", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(38);
    for (const r of RECIPES) expect(r).toMatchObject({ owner_id: "usr_cookpool", is_system: 1, visibility: "groups" });
  });

  it.each(RECIPES.map((r) => [r.name, r] as const))("%s: is complete, every line linked, every amount scaling", (_name, recipe) => {
    // Serves 2 to 6, in whole portions; a kind Explore files it under; how long it takes.
    expect(recipe.serves_half % 2).toBe(0);
    expect(recipe.serves_half / 2).toBeGreaterThanOrEqual(2);
    expect(recipe.serves_half / 2).toBeLessThanOrEqual(6);
    expect(RECIPE_KINDS).toContain(recipe.kind);
    expect(recipe.minutes).toBeGreaterThan(0);

    const lines = linesOf(recipe.id);
    // Exactly one main line, and it has an amount.
    const mains = lines.filter((l) => l.is_main === 1);
    expect(mains).toHaveLength(1);
    expect(mains[0]!.to_taste).toBe(0);
    expect(mains[0]!.qty_milli).toBeGreaterThan(0);

    for (const line of lines) {
      const at = `${recipe.name}: ${line.name}`;
      // A food on the list, or to taste (Cookpool's to-taste lines name their food too).
      expect([at, line.to_taste === 1 || (line.food_key !== null && FOODS.has(line.food_key))]).toEqual([at, true]);
      if (line.food_key !== null) expect([at, FOODS.has(line.food_key)]).toEqual([at, true]);
      if (line.to_taste === 1) {
        expect([at, line.qty_milli, line.unit]).toEqual([at, null, null]);
        expect(scaleLine(line.qty_milli, line.unit, 2000)).toBeNull();
        continue;
      }
      // One of the app's units, an amount above zero.
      const unit = line.unit!;
      expect([at, unit, (RECIPE_UNIT_KEYS as readonly string[]).includes(unit)]).toEqual([at, unit, true]);
      const qty = line.qty_milli!;
      expect([at, qty > 0]).toEqual([at, true]);
      // × 1 is the amount as written: it sits on its unit's grid.
      expect([at, scaleLine(qty, unit, 1000)]).toEqual([at, qty]);
      // × 0.5 and × 2: above zero, on the grid, within half a step of exact (or the smallest step), in order.
      for (const factor of [500, 2000]) {
        const scaled = scaleLine(qty, unit, factor)!;
        const exact = (qty * factor) / 1000;
        const grid = gridOf(unit, exact);
        expect([at, factor, scaled > 0, scaled % grid === 0]).toEqual([at, factor, true, true]);
        expect([at, factor, scaleLine(scaled, unit, 1000)]).toEqual([at, factor, scaled]);
        expect([at, factor, Math.abs(scaled - exact) <= grid / 2 || scaled === grid]).toEqual([at, factor, true]);
      }
      expect([at, scaleLine(qty, unit, 500)! <= qty && qty <= scaleLine(qty, unit, 2000)!]).toEqual([at, true]);
    }

    // 3 to 8 short steps.
    const steps = stepsOf(recipe.id);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(8);
    for (const step of steps) {
      expect(step.length).toBeGreaterThan(0);
      expect(step.length).toBeLessThanOrEqual(MAX_RECIPE_STEP);
    }
  });
});

// ── Through the router ─────────────────────────────────────

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.h.close());

const match = (id: string, as: string, query = "") => w.call<RecipeMatchResponse>("GET", me(`recipes/${id}/match${query}`), as);

/** A one-line recipe of `foodKey` as Rahul writes it. */
const oneLine = (name: string, foodKey: string, quantity: string, unit: string) =>
  writeRecipe(w, RAHUL, { name, servesHalf: 4, lines: [{ foodKey, name, quantity, unit, isMain: true }] });

describe("the match through a food's density (RC-7, design §3.3)", () => {
  it("meets a teaspoon of turmeric with a 100 g pack: the spoon is 3 g of it", async () => {
    const haldi = await addItem(w, RAHUL, null, { name: "Haldi", category: "spices", quantity: "100", unit: "g", priceMinor: 3000 });
    const recipe = await oneLine("Turmeric milk", "turmeric", "1", "tsp");
    const m = (await match(recipe.id, RAHUL)).body.data;
    expect(m.lines[0]).toMatchObject({ status: "have", needMilli: 5_000, needQuantity: 1, unit: "tsp", availableMilli: 166_666 });
    expect(m.lines[0]!.items).toEqual([expect.objectContaining({ itemId: haldi.id, takeMilli: 3_000, unit: "g" })]);
    // 100 g is more than enough: the factor caps.
    expect(m.summary).toMatchObject({ have: 1, missing: 0, maxFactorMilli: 20_000 });
  });

  it("meets a cup of rice with a 1 kg bag, and scales by it", async () => {
    const bag = await addItem(w, RAHUL, null, { name: "Basmati rice", category: "grains", quantity: "1", unit: "kg", priceMinor: 12000 });
    const recipe = await oneLine("Plain rice", "rice", "1", "cup");
    const m = (await match(recipe.id, RAHUL)).body.data;
    // 1 kg at 0.8 g/ml is 1.25 L of rice; a cup (240 ml) is 192 g of the bag.
    expect(m.lines[0]).toMatchObject({ status: "have", needMilli: 240_000, availableMilli: 1_250_000 });
    expect(m.lines[0]!.items).toEqual([expect.objectContaining({ itemId: bag.id, takeMilli: 192_000, unit: "kg" })]);
    expect(m.summary.maxFactorMilli).toBe(5_208);
    // Five and a half cups is more than the bag: short.
    const big = (await match(recipe.id, RAHUL, "?f=5500")).body.data;
    expect(big.lines[0]).toMatchObject({ status: "short", needMilli: 1_320_000, availableMilli: 1_250_000 });
  });

  it("meets a weight with a bottle the other way round: 50 g of ghee from a 500 ml jar", async () => {
    const jar = await addItem(w, RAHUL, null, { name: "Ghee", category: "dairy", quantity: "500", unit: "ml", priceMinor: 32000 });
    const recipe = await oneLine("Ghee rice", "ghee", "50", "g");
    const m = (await match(recipe.id, RAHUL)).body.data;
    // 500 ml at 0.9 g/ml is 450 g, to the gram; 50 g is about 56 ml of the jar.
    expect(m.lines[0]).toMatchObject({ status: "have", needMilli: 50_000, availableMilli: 450_000 });
    expect(m.lines[0]!.items).toEqual([expect.objectContaining({ itemId: jar.id, takeMilli: 55_556, unit: "ml" })]);
    expect(m.summary.maxFactorMilli).toBe(9_000);
  });

  it("meets a cup of chopped onion with onions counted by the piece, through density and piece weight", async () => {
    await addItem(w, RAHUL, null, { name: "Onions", quantity: "12", unit: "pcs", priceMinor: 6000 });
    const recipe = await oneLine("Onion bhaji", "onion", "1", "cup");
    const m = (await match(recipe.id, RAHUL)).body.data;
    // A cup at 0.65 g/ml is 156 g: just over one 150 g onion.
    expect(m.lines[0]).toMatchObject({ status: "have", needMilli: 240_000 });
    expect(m.lines[0]!.items[0]).toMatchObject({ takeMilli: 1_040, unit: "pcs" });
  });

  it("still reads missing for a food with no density: a cup of paneer never meets 200 g of it", async () => {
    await addItem(w, RAHUL, null, { name: "Paneer", category: "dairy", quantity: "200", unit: "g", priceMinor: 9000 });
    const recipe = await oneLine("Paneer cup", "paneer", "1", "cup");
    const m = (await match(recipe.id, RAHUL)).body.data;
    expect(m.lines[0]).toMatchObject({ status: "missing", availableMilli: 0, items: [] });
    expect(m.summary).toMatchObject({ missing: 1, missingNames: ["Paneer cup"], maxFactorMilli: null });
    // The same weight in grams meets it as before.
    const grams = await oneLine("Paneer grams", "paneer", "150", "g");
    expect((await match(grams.id, RAHUL)).body.data.lines[0]!.status).toBe("have");
  });

  it("drops back to missing when a food's density is taken away", async () => {
    await addItem(w, RAHUL, null, { name: "Haldi", category: "spices", quantity: "100", unit: "g", priceMinor: 3000 });
    const recipe = await oneLine("Turmeric milk", "turmeric", "1", "tsp");
    w.h.db.prepare("UPDATE kitchen_foods SET g_per_ml = NULL WHERE key = 'turmeric'").run();
    expect((await match(recipe.id, RAHUL)).body.data.lines[0]).toMatchObject({ status: "missing", availableMilli: 0 });
  });
});

describe("Cookpool's recipes through the router (RC-7, design §5.3–§5.5)", () => {
  it("lists every one in Explore under source=cookpool, newest first, by Cookpool, each with its match", async () => {
    const res = await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes?source=cookpool", OLU);
    expect(res.status).toBe(200);
    const listed = res.body.data.recipes;
    expect(listed.map((r) => r.name)).toEqual(RECIPES.map((r) => r.name));
    expect(listed.map((r) => r.id)).toEqual(RECIPES.map((r) => publicId(r.id)));
    for (const r of listed) {
      expect(r).toMatchObject({ ownerId: "usr_cookpool", ownerName: "Cookpool", isSystem: true, mine: false, visibility: "groups", source: null });
      expect(r.match.lines).toBe(r.lineCount);
      expect(r.main).not.toBeNull();
    }
    // Olu's pantry is empty: nothing can be made, and what is missing is named.
    expect(listed.every((r) => r.match.missing > 0 && r.match.maxFactorMilli === null)).toBe(true);
    // The default source is Cookpool; kind and q narrow it.
    expect((await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes", OLU)).body.data.recipes).toHaveLength(listed.length);
    const breakfast = (await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes?source=cookpool&kind=breakfast", OLU)).body.data.recipes;
    expect(breakfast.length).toBeGreaterThanOrEqual(3);
    expect(breakfast.every((r) => r.kind === "breakfast")).toBe(true);
    expect(breakfast.map((r) => r.name)).toContain("Kanda poha");
    const poha = (await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes?source=cookpool&q=POHA", OLU)).body.data.recipes;
    expect(poha.map((r) => r.name)).toEqual(["Kanda poha"]);
  });

  it("reads one in full for anyone signed in, its lines in the app's units — and nobody may change it", async () => {
    const chai = RECIPES.find((r) => r.name === "Masala chai")!;
    const id = publicId(chai.id);
    const res = await w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${id}`, OLU);
    expect(res.status).toBe(200);
    expect(res.body.data.recipe).toMatchObject({ name: "Masala chai", kind: "drink", servesHalf: 4, isSystem: true, linkCode: null });
    expect(res.body.data.recipe.lines.map((l) => [l.foodKey, l.quantity, l.unit, l.isMain, l.toTaste])).toEqual([
      ["milk", 1, "cup", true, false],
      ["water", 1, "cup", false, false],
      ["tea", 2, "tsp", false, false],
      ["sugar", 2, "tsp", false, false],
      ["ginger", 5, "g", false, false],
      ["cardamom", null, null, false, true],
    ]);
    expect(res.body.data.recipe.steps.length).toBeGreaterThanOrEqual(3);
    expect((await w.call("PATCH", me(`recipes/${id}`), OLU, { name: "Mine" })).status).toBe(404);
    expect((await w.call("DELETE", me(`recipes/${id}`), "usr_cookpool")).status).toBe(404);
    // Anyone may save a copy, from Cookpool.
    w.tick();
    const copy = await w.call<RecipeResponse>("POST", me("recipes/copies"), OLU, { recipeId: id });
    expect(copy.status).toBe(201);
    expect(copy.body.data.recipe).toMatchObject({ mine: true, visibility: "only_me", source: { recipeId: id, ownerName: "Cookpool" } });
  });

  it("puts Masala chai first in Cook now once the pantry has its milk, tea, sugar and ginger — the spoons meeting packs by weight", async () => {
    await addItem(w, RAHUL, null, { name: "Milk", category: "dairy", quantity: "1", unit: "L", priceMinor: 6800 });
    await addItem(w, RAHUL, null, { name: "Chai patti", category: "other", quantity: "250", unit: "g", priceMinor: 14000 });
    await addItem(w, RAHUL, null, { name: "Sugar", category: "other", quantity: "1", unit: "kg", priceMinor: 4500 });
    await addItem(w, RAHUL, null, { name: "Adrak", category: "veg", quantity: "100", unit: "g", priceMinor: 1500 });

    const res = await w.call<CookNowResponse>("GET", me("cook-now"), RAHUL);
    expect(res.status).toBe(200);
    const first = res.body.data.recipes[0]!;
    expect(first.recipe).toMatchObject({ name: "Masala chai", isSystem: true, ownerName: "Cookpool" });
    // Water is on everyone's Always have to start with, and cardamom is to taste.
    expect(first.match).toEqual({ lines: 6, have: 4, short: 0, missing: 0, always: 2, missingNames: [], maxFactorMilli: 4_166 });
    // A litre of milk makes a little over four times the recipe; serves 2, so "for 4" (twice its serves at most).
    expect(first.forPortionsHalf).toBe(8);
    // What it would take: 2 tsp of tea is 5 g, 2 tsp of sugar 8.5 g.
    const chai = await match(first.recipe.id, RAHUL);
    expect(chai.body.data.lines.map((l) => [l.status, l.items.map((i) => [i.name, i.takeMilli])])).toEqual([
      ["have", [["Milk", 240_000]]],
      ["always", []],
      ["have", [["Chai patti", 5_000]]],
      ["have", [["Sugar", 8_500]]],
      ["have", [["Adrak", 5_000]]],
      ["always", []],
    ]);

    // Without a density, the spoons of tea and sugar would not have met their packs.
    w.h.db.prepare("UPDATE kitchen_foods SET g_per_ml = NULL WHERE key IN ('tea', 'sugar')").run();
    const without = (await w.call<CookNowResponse>("GET", me("cook-now"), RAHUL)).body.data.recipes;
    expect(without.find((e) => e.recipe.name === "Masala chai")!.match).toMatchObject({ missing: 2, missingNames: ["Tea leaves", "Sugar"] });
  });
});
