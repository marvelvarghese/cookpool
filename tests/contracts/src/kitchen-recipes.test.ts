import type {
  AlwaysHaveResponse,
  CookDishRequest,
  CookNowResponse,
  CopyRecipeRequest,
  CreateRecipeBody,
  ExploreRecipesResponse,
  FoodsResponse,
  KitchenDish,
  KitchenRecipe,
  RecipeMatchResponse,
  RecipeResponse,
  SetFoodAnswerRequest,
  UpdateRecipeRequest,
} from "@saas/contracts/kitchen";
import {
  DEFAULT_ALWAYS_HAVE,
  DEFAULT_COPY_VISIBILITY,
  DEFAULT_RECIPE_VISIBILITY,
  RECIPE_KINDS,
  RECIPE_LINK_ALPHABET,
  RECIPE_LINK_CODE_RE,
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_MIN_FACTOR_MILLI,
  RECIPE_UNITS,
  RECIPE_UNIT_KEYS,
  RECIPE_VISIBILITIES,
  factorForMain,
  factorForPortions,
  foodLookupKeys,
  foodNameKey,
  lineQuantity,
  recipeUnitOf,
  scaleLine,
  scalePortions,
} from "@saas/contracts/kitchen";
import * as recipes from "@saas/contracts/kitchen-recipes";

// Foods and recipes (Cookpool RC-4, cookpool-recipes design §2, §3): the
// scaling the screen and the server share, the food-name folding the match
// keys by, and the shapes of the routes. Scaling is pinned by examples and by
// properties checked over many seeded random cases.

/** A small deterministic generator (mulberry32), so a failing case is the same every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNITS = [...RECIPE_UNIT_KEYS, "onion", "katori"];

/** The smallest amount a line in `unit` ever reads, in thousandths of its base. */
function minimumStep(unit: string): number {
  if (unit === "g" || unit === "ml") return 5_000;
  if (unit === "kg" || unit === "L") return 10_000;
  return recipeUnitOf(unit).factor * 500;
}

/** The grid an amount `milli` sits on in `unit`. */
function gridAt(unit: string, milli: number): number {
  if (unit === "g" || unit === "ml") return milli < 100_000 ? 5_000 : milli < 1_000_000 ? 10_000 : 50_000;
  return minimumStep(unit);
}

/** A random written amount in `unit`: a sensible one, in thousandths of the base. */
function amountIn(unit: string, rand: () => number): number {
  const factor = recipeUnitOf(unit).factor;
  // Up to 20 of the unit, in thousandths of it, at least one thousandth.
  return Math.max(1, Math.floor(rand() * 20_000)) * factor;
}

const factorFrom = (rand: () => number) =>
  RECIPE_MIN_FACTOR_MILLI + Math.floor(rand() * (RECIPE_MAX_FACTOR_MILLI - RECIPE_MIN_FACTOR_MILLI + 1));

describe("contracts: recipes scale by their unit (RC-4, design §3.2)", () => {
  it("scales Chicken curry from 1 kg of chicken to 450 g: every line, by its unit's rounding", () => {
    const f = factorForMain(1_000_000, 450_000);
    expect(f).toBe(450);
    expect(scaleLine(1_000_000, "kg", f)).toBe(450_000); // 0.45 kg
    expect(scaleLine(500_000, "g", f)).toBe(230_000); // 225 g → nearest 10
    expect(scaleLine(200_000, "g", f)).toBe(90_000); // 90 g, on the 5 g grid
    expect(scaleLine(2_000, "onion", f)).toBe(1_000); // 0.9 onion → 1
    expect(scaleLine(2_000, "pcs", f)).toBe(1_000);
    expect(scaleLine(5_000, "tsp", f)).toBe(2_500); // ½ tsp, the least a spoon reads
    expect(scaleLine(15_000, "tbsp", f)).toBe(7_500);
    expect(scaleLine(720_000, "cup", f)).toBe(360_000); // 1.35 cups → 1½
    expect(scaleLine(2_000_000, "ml", 1_000)).toBe(2_000_000);
    expect(scaleLine(2_345_000, "g", 1_000)).toBe(2_350_000); // the nearest 50 above 1 kg
    expect(scaleLine(1_234_000, "L", 1_000)).toBe(1_230_000); // two decimals of a litre
    expect([lineQuantity(450_000, "kg"), lineQuantity(2_500, "tsp"), lineQuantity(360_000, "cup"), lineQuantity(1_000, "onion")]).toEqual([
      0.45, 0.5, 1.5, 1,
    ]);
  });

  it("never scales a to-taste line", () => {
    for (const f of [10, 450, 1_000, 20_000]) expect(scaleLine(null, null, f)).toBeNull();
    expect(scaleLine(null, "tsp", 450)).toBeNull();
  });

  it("rounds to the nearest step, halves up, and never below one step", () => {
    expect(scaleLine(97_500, "g", 1_000)).toBe(100_000); // 97.5 → 100
    expect(scaleLine(97_499, "g", 1_000)).toBe(95_000);
    expect(scaleLine(995_000, "g", 1_000)).toBe(1_000_000);
    expect(scaleLine(1_024_999, "g", 1_000)).toBe(1_000_000);
    expect(scaleLine(1_025_000, "g", 1_000)).toBe(1_050_000);
    expect(scaleLine(1_000, "g", 10)).toBe(5_000); // a hundredth of a gram is still 5 g
    expect(scaleLine(500, "pcs", 10)).toBe(500);
    expect(scaleLine(1_000, "kg", 10)).toBe(10_000);
  });

  it("property: scaling by 1 is the identity after rounding, and every result sits on its unit's grid, never below one step", () => {
    const rand = prng(20261108);
    for (let i = 0; i < 5_000; i += 1) {
      const unit = UNITS[Math.floor(rand() * UNITS.length)]!;
      const written = amountIn(unit, rand);
      const f = factorFrom(rand);
      const scaled = scaleLine(written, unit, f)!;
      expect(scaled).toBeGreaterThanOrEqual(minimumStep(unit));
      expect(scaled % gridAt(unit, scaled)).toBe(0);
      expect(scaleLine(scaled, unit, 1_000)).toBe(scaled);
    }
  });

  it("property: an amount already on the grid scales by 1 to itself", () => {
    const rand = prng(7);
    for (let i = 0; i < 2_000; i += 1) {
      const unit = UNITS[Math.floor(rand() * UNITS.length)]!;
      const onGrid = scaleLine(amountIn(unit, rand), unit, 1_000)!;
      expect(scaleLine(onGrid, unit, 1_000)).toBe(onGrid);
    }
  });

  it("property: the result is within half a step of the exact amount (or the least one step), and grows with the factor", () => {
    const rand = prng(42);
    for (let i = 0; i < 3_000; i += 1) {
      const unit = UNITS[Math.floor(rand() * UNITS.length)]!;
      const written = amountIn(unit, rand);
      const f1 = factorFrom(rand);
      const f2 = factorFrom(rand);
      const [lo, hi] = f1 <= f2 ? [f1, f2] : [f2, f1];
      const exact = (written * lo) / 1000;
      const scaled = scaleLine(written, unit, lo)!;
      if (scaled > minimumStep(unit)) {
        // The tier is chosen from the exact amount, so the step is the exact amount's.
        expect(Math.abs(scaled - exact)).toBeLessThanOrEqual(gridAt(unit, exact) / 2);
      } else {
        expect(exact).toBeLessThan(minimumStep(unit) * 1.5);
      }
      expect(scaleLine(written, unit, hi)!).toBeGreaterThanOrEqual(scaled);
    }
  });
});

describe("contracts: portions at a factor (RC-4, design §3.2)", () => {
  it("reads whole and half portions exactly, and anything else as about", () => {
    expect(scalePortions(8, 1_000)).toEqual({ portionsHalf: 8, about: false, label: "4" });
    expect(scalePortions(8, 500)).toEqual({ portionsHalf: 4, about: false, label: "2" });
    expect(scalePortions(6, 750)).toEqual({ portionsHalf: 5, about: true, label: "about 2½" }); // 2.25
    expect(scalePortions(8, 450)).toEqual({ portionsHalf: 4, about: true, label: "about 2" }); // 1.8
    expect(scalePortions(3, 1_000)).toEqual({ portionsHalf: 3, about: false, label: "1½" });
    expect(scalePortions(1, 10)).toEqual({ portionsHalf: 1, about: true, label: "about ½" });
    expect(factorForPortions(8, 4)).toBe(500);
    expect(factorForPortions(6, 4)).toBe(667);
  });

  it("property: by 1 a recipe serves what it says; never below ½; exact exactly when serves × f is a whole or half", () => {
    const rand = prng(99);
    for (let i = 0; i < 3_000; i += 1) {
      const servesHalf = 1 + Math.floor(rand() * 200);
      const f = factorFrom(rand);
      expect(scalePortions(servesHalf, 1_000)).toMatchObject({ portionsHalf: servesHalf, about: false });
      const scaled = scalePortions(servesHalf, f);
      expect(scaled.portionsHalf).toBeGreaterThanOrEqual(1);
      expect(scaled.about).toBe((servesHalf * f) % 1000 !== 0);
      if (!scaled.about) expect(scaled.portionsHalf).toBe((servesHalf * f) / 1000);
      else expect(scaled.label.startsWith("about ")).toBe(true);
      expect(Math.abs(scaled.portionsHalf - Math.max(1, (servesHalf * f) / 1000))).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("contracts: the food list (RC-4, design §2)", () => {
  it("folds a name as SQLite's lower(trim()) does, and looks it up as itself, then without a plural es or s", () => {
    expect(foodNameKey("  Kanda ")).toBe("kanda");
    expect(foodNameKey("Jalapeño")).toBe("jalapeño");
    expect(foodLookupKeys("Tomatoes")).toEqual({ nameKey: "tomatoes", plurals: ["tomato", "tomatoe"] });
    expect(foodLookupKeys("Eggs")).toEqual({ nameKey: "eggs", plurals: ["egg"] });
    expect(foodLookupKeys("Rice")).toEqual({ nameKey: "rice", plurals: [] });
    expect(foodLookupKeys("s")).toEqual({ nameKey: "s", plurals: [] });
  });

  it("starts everyone with salt and water", () => {
    expect(DEFAULT_ALWAYS_HAVE).toEqual(["salt", "water"]);
  });

  it("types the food, answer and Always have routes", () => {
    const foods: FoodsResponse = { foods: [{ key: "onion", name: "Onion", dimension: "mass", eachG: 150, category: "veg", matchedName: "pyaz" }] };
    const answer: SetFoodAnswerRequest = { nameKey: "kanda", foodKey: "onion", orgId: "org_1" };
    const none: SetFoodAnswerRequest = { nameKey: "amul taaza", foodKey: null };
    const always: AlwaysHaveResponse = { foods: [], isDefault: false };
    expect([foods.foods[0]!.matchedName, answer.foodKey, none.foodKey, always.isDefault]).toEqual(["pyaz", "onion", null, false]);
  });
});

describe("contracts: recipes (RC-4, design §3.1, §5, §7)", () => {
  it("has three cumulative levels — a recipe you write starts at My groups, a copy at Only me — and Explore's kinds", () => {
    expect(RECIPE_VISIBILITIES).toEqual(["only_me", "groups", "link"]);
    expect([DEFAULT_RECIPE_VISIBILITY, DEFAULT_COPY_VISIBILITY]).toEqual(["groups", "only_me"]);
    expect(RECIPE_KINDS).toEqual(expect.arrayContaining(["breakfast", "dal_curry", "rice", "snack", "sweet"]));
  });

  it("writes link codes in 10 base-58 characters", () => {
    expect(RECIPE_LINK_ALPHABET).toHaveLength(58);
    expect(new Set(RECIPE_LINK_ALPHABET).size).toBe(58);
    for (const c of "0OIl") expect(RECIPE_LINK_ALPHABET).not.toContain(c);
    expect(RECIPE_LINK_CODE_RE.test("3xK9mPqR2s")).toBe(true);
    expect(RECIPE_LINK_CODE_RE.test("3xK9mPqR2")).toBe(false);
    expect(RECIPE_LINK_CODE_RE.test("3xK9mPqR2O")).toBe(false);
  });

  it("knows the app's units, each a size in its dimension's base, and any other word as a count", () => {
    expect(RECIPE_UNITS).toEqual({
      g: { dimension: "mass", factor: 1 },
      kg: { dimension: "mass", factor: 1000 },
      ml: { dimension: "volume", factor: 1 },
      L: { dimension: "volume", factor: 1000 },
      pcs: { dimension: "count", factor: 1 },
      tsp: { dimension: "volume", factor: 5 },
      tbsp: { dimension: "volume", factor: 15 },
      cup: { dimension: "volume", factor: 240 },
    });
    expect(recipeUnitOf("onion")).toEqual({ dimension: "count", factor: 1 });
  });

  it("types every recipe route, and the dish write's recipe fields", () => {
    const create: CreateRecipeBody = {
      name: "Chicken curry",
      servesHalf: 8,
      lines: [
        { foodKey: "chicken", name: "Chicken", quantity: "1", unit: "kg", isMain: true },
        { foodKey: "onion", name: "Onions", quantity: 2, unit: "onion" },
        { foodKey: "salt", name: "Salt", toTaste: true },
      ],
      steps: ["Brown the onions"],
    };
    const fromDish: CreateRecipeBody = { fromDishId: "dsh_1", visibility: "only_me" };
    const patch: UpdateRecipeRequest = { visibility: "link" };
    const copies: CopyRecipeRequest[] = [{ recipeId: "rcp_1" }, { linkCode: "3xK9mPqR2s" }];
    const cook: CookDishRequest = {
      name: "Chicken curry",
      portionsHalf: 4,
      splitMode: "assign",
      recipeId: "rcp_1",
      recipeFactorMilli: 450,
      ingredients: [{ itemId: "itm_1", quantity: "0.45", unit: "kg", recipeLine: 0 }],
      newItems: [{ name: "Onions", quantity: 1, unit: "kg", priceMinor: 4000, recipeLine: 1 }],
    };
    const dish: Pick<KitchenDish, "recipeId" | "recipeFactorMilli"> = { recipeId: "rcp_1", recipeFactorMilli: 450 };
    const recipe: Pick<KitchenRecipe, "visibility" | "linkCode" | "source"> = {
      visibility: "only_me",
      linkCode: null,
      source: { recipeId: "rcp_2", ownerId: "usr_anu", ownerName: "Anu" },
    };
    const reads: [RecipeResponse["lastCook"], RecipeMatchResponse["summary"]["maxFactorMilli"], CookNowResponse, ExploreRecipesResponse] = [
      null,
      null,
      { recipes: [] },
      { recipes: [] },
    ];
    expect(["lines" in create, "fromDishId" in fromDish, patch.visibility, copies.length]).toEqual([true, true, "link", 2]);
    expect([cook.recipeId, cook.ingredients![0]!.recipeLine, cook.newItems![0]!.recipeLine, dish.recipeFactorMilli]).toEqual(["rcp_1", 0, 1, 450]);
    expect(recipe.source!.ownerName).toBe("Anu");
    expect(reads[2].recipes).toEqual([]);
  });

  it("is reachable from @saas/contracts/kitchen and its own entry point alike", () => {
    expect(recipes.scaleLine).toBe(scaleLine);
    expect(recipes.RECIPE_UNITS).toBe(RECIPE_UNITS);
  });
});
