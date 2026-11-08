// Cookpool's own recipes, cooking with you (Cookpool GC-4, cookpool-guided
// design §1, §2, §5): every recipe migration 390 rewrites, read through the
// real recipe read (`GET /v1/kitchen/recipes/{id}`, its `guidedSteps`,
// `tools` and `longPrep`) and checked as content:
//
//   - every cook step has a flame, and a checkpoint or a time (or whistles);
//   - every hands-off step has a time or whistles;
//   - every line goes in at some step, and every line a step names exists;
//   - ranges are sane: at least 30 s, at most 12 h for prep and 2 h for cook,
//     and the longest at most three times the shortest;
//   - no step's text has a number with a unit in it — the lines carry the
//     amounts, and the range the time;
//   - prep comes before cook, keys are 390's fixed ones, tools are set.
//
// Then: rajma and chole lead with their overnight soak as long prep; Chicken
// curry (GC1's milestone dish) shows a flame, lines, a range and a checkpoint
// on every cook step, and its plan reads differently at 450 g and 1 kg; a copy
// keeps every key; and a cook's times pool under Cookpool's recipe by those
// keys, through a copy too.

import {
  LONG_PREP_SECONDS,
  MAX_RECIPE_STEPS,
  stepTimeAt,
  type CookDishResponse,
  type KitchenRecipe,
  type KitchenRecipeStep,
  type RecipeResponse,
} from "@saas/contracts/kitchen";
import { migratedDatabase } from "./harness.js";
import { DEV, OLU, RAHUL, addItem, me, world, type World } from "./recipes-helpers.js";

// ── The seed, read once ────────────────────────────────────

interface SeedRecipe {
  id: string;
  name: string;
}

const seed = migratedDatabase();
const RECIPES = seed.prepare("SELECT id, name FROM kitchen_recipes WHERE is_system = 1 ORDER BY created_at DESC, id DESC").all() as unknown as SeedRecipe[];
seed.close();
const publicId = (uuid: string) => `rcp_${uuid.replace(/-/g, "")}`;
/** Cookpool recipe `n` (1–42) of 360's fixed ids. */
const numberOf = (uuid: string) => Number(uuid.slice(-2));

const HOUR = 3_600;
/** A number followed by a unit of amount or time: "2 tbsp", "10 minutes", "3 whistles", "6-inch". */
const AMOUNT_IN_TEXT = /\d\s*-?\s*(?:g|kg|gm|grams?|ml|l|litres?|liters?|tsp|tbsp|teaspoons?|tablespoons?|cups?|pcs|pieces?|min|mins|minutes?|s|secs?|seconds?|h|hrs?|hours?|whistles?|inch(?:es)?|cm)\b/i;

let w: World;
const read = new Map<string, KitchenRecipe>();

beforeAll(async () => {
  w = world();
  for (const r of RECIPES) {
    const res = await w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${publicId(r.id)}`, OLU);
    if (res.status !== 200) throw new Error(`read ${r.name}: ${res.status}`);
    read.set(r.name, res.body.data.recipe);
  }
});

afterAll(() => w.h.close());

const recipe = (name: string) => read.get(name)!;
const isTimed = (s: KitchenRecipeStep) => s.minSeconds !== null && s.maxSeconds !== null;

describe("Cookpool's recipes with guided steps, as migration 390 writes them (GC-4, design §1)", () => {
  it("are all 42 of Cookpool's own, read in full", () => {
    expect(RECIPES).toHaveLength(42);
    expect(read.size).toBe(42);
  });

  it.each(RECIPES.map((r) => [r.name, r] as const))("%s: cooks step by step", (name, seeded) => {
    const r = recipe(name);
    const steps = r.guidedSteps!;
    const n = String(numberOf(seeded.id)).padStart(2, "0");
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(MAX_RECIPE_STEPS);
    expect(r.steps).toEqual(steps.map((s) => s.text));
    // Tools to gather before starting.
    expect(r.tools!.length).toBeGreaterThanOrEqual(1);

    // Prep first (Before you start), then the cooking.
    expect(steps.map((s) => s.phase).join(" ")).toMatch(/^(prep )*cook( cook)*$/);

    const used = new Set<number>();
    steps.forEach((s, i) => {
      const at = `${name} step ${i + 1}: ${s.text}`;
      expect([at, s.position, s.key]).toEqual([at, i, `c00c0390-${n}-${String(i + 1).padStart(2, "0")}`]);

      // A cook step says its flame, and what to watch for or how long it takes.
      if (s.phase === "cook") {
        expect([at, s.heat !== null]).toEqual([at, true]);
        expect([at, s.checkpoint !== null || isTimed(s) || s.whistles !== null]).toEqual([at, true]);
      }
      // A wait runs a timer: a time, or whistles to count.
      if (s.handsOff) expect([at, isTimed(s) || s.whistles !== null]).toEqual([at, true]);
      // Whistles never with seconds, and they never scale.
      if (s.whistles !== null) {
        expect([at, s.minSeconds, s.maxSeconds]).toEqual([at, null, null]);
        expect(stepTimeAt(s, 2_000)).toEqual({ whistles: s.whistles });
      }
      // A sane range.
      if (isTimed(s)) {
        const [lo, hi] = [s.minSeconds!, s.maxSeconds!];
        expect([at, lo >= 30]).toEqual([at, true]);
        expect([at, hi <= (s.phase === "prep" ? 12 * HOUR : 2 * HOUR)]).toEqual([at, true]);
        expect([at, lo <= hi && hi <= 3 * lo]).toEqual([at, true]);
      }
      // A sense comes with its checkpoint.
      if (s.sense !== null) expect([at, s.checkpoint]).toEqual([at, expect.any(String)]);
      // The lines carry the amounts; the text says none.
      expect([at, AMOUNT_IN_TEXT.test(s.text)]).toEqual([at, false]);
      // Every line a step names is one of the recipe's, named once.
      for (const line of s.lines) expect([at, line, line >= 0 && line < r.lines.length]).toEqual([at, line, true]);
      expect([at, new Set(s.lines).size]).toEqual([at, s.lines.length]);
      s.lines.forEach((l) => used.add(l));
    });
    // Every line goes in at some step.
    expect(r.lines.filter((l) => !used.has(l.position)).map((l) => l.name)).toEqual([]);

    // Long prep is exactly the hands-off prep of an hour or more.
    expect(r.longPrep!.map((p) => p.key)).toEqual(
      steps.filter((s) => s.phase === "prep" && s.handsOff && s.minSeconds !== null && s.minSeconds >= LONG_PREP_SECONDS).map((s) => s.key),
    );
  });

  it("puts the overnight soak first for rajma and chole, as long prep", () => {
    for (const name of ["Rajma", "Chole"]) {
      const r = recipe(name);
      expect(r.longPrep).toHaveLength(1);
      const [soak] = r.longPrep!;
      expect(soak).toMatchObject({ position: 0, key: r.guidedSteps![0]!.key });
      expect(soak!.text).toMatch(/soak/i);
      expect(soak!.seconds).toBeGreaterThanOrEqual(6 * HOUR);
      // The pressure cooker follows: whistles, a low flame, then the pressure dropping.
      const cooker = r.guidedSteps!.findIndex((s) => s.whistles !== null);
      expect(r.guidedSteps!.slice(cooker, cooker + 3).map((s) => [s.handsOff, s.heat, s.whistles !== null, isTimed(s)])).toEqual([
        [true, 3, true, false],
        [true, 1, false, true],
        [true, 0, false, true],
      ]);
    }
    // Only recipes that need it wait that long beforehand.
    expect(RECIPES.filter((r) => recipe(r.name).longPrep!.length > 0).map((r) => r.name)).toEqual([
      "Sabudana khichdi", "Rajma", "Chole", "Veg fried rice",
    ]);
  });

  it("shows Chicken curry's every cook step with a flame, its lines, a range and a checkpoint — and its plan reads differently at 450 g and 1 kg", () => {
    const r = recipe("Chicken curry");
    const cooking = r.guidedSteps!.filter((s) => s.phase === "cook");
    expect(cooking.length).toBeGreaterThanOrEqual(5);
    for (const s of cooking) {
      expect([s.text, s.heat !== null, s.lines.length > 0, isTimed(s), s.checkpoint !== null]).toEqual([s.text, true, true, true, true]);
    }
    // The main line is 750 g of chicken: 450 g is × 0.6, a kilo × 1.333.
    expect(r.main).toMatchObject({ foodKey: "chicken", qtyMilli: 750_000, unit: "g" });
    const plan = (factorMilli: number) =>
      r.guidedSteps!.map((s) => stepTimeAt(s, factorMilli)).reduce(
        (sum, t) => (t && "minSeconds" in t ? [sum[0]! + t.minSeconds, sum[1]! + t.maxSeconds] : sum),
        [0, 0],
      );
    const [small, own, big] = [plan(600), plan(1_000), plan(1_333)];
    expect(small[0]).toBeLessThan(own[0]!);
    expect(own[0]).toBeLessThan(big[0]!);
    expect(small[1]).toBeLessThan(big[1]!);
    // Frying the onions, searing and simmering take longer at a kilo; tempering the whole spices doesn't.
    const at = (text: RegExp, f: number) => stepTimeAt(r.guidedSteps!.find((s) => text.test(s.text))!, f);
    expect(at(/sear/i, 1_333)).not.toEqual(at(/sear/i, 600));
    expect(at(/simmer/i, 1_333)).not.toEqual(at(/simmer/i, 600));
    expect(at(/bay leaf/i, 1_333)).toEqual(at(/bay leaf/i, 600));
  });

  it("keeps every step, key and tool in a copy someone saves", async () => {
    const rajma = recipe("Rajma");
    w.tick();
    const res = await w.call<RecipeResponse>("POST", me("recipes/copies"), RAHUL, { recipeId: rajma.id });
    expect(res.status).toBe(201);
    const copy = res.body.data.recipe;
    expect(copy.guidedSteps).toEqual(rajma.guidedSteps);
    expect([copy.tools, copy.longPrep]).toEqual([rajma.tools, rajma.longPrep]);
  });

  it("pools a cook's step times under Cookpool's recipe by its fixed keys — through a copy too", async () => {
    const chai = recipe("Masala chai");
    w.tick();
    const copied = await w.call<RecipeResponse>("POST", me("recipes/copies"), DEV, { recipeId: chai.id });
    const milk = await addItem(w, DEV, null, { name: "Milk", category: "dairy", quantity: "1", unit: "L", priceMinor: 6800 });
    const [boil, , milkStep] = chai.guidedSteps!.filter((s) => s.phase === "cook").map((s) => s.key);
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 8, 8, minutes)).toISOString();
    w.tick();
    const dish = await w.call<CookDishResponse>("POST", me("dishes"), DEV, {
      name: "Masala chai", portionsHalf: 4, splitMode: "assign", recipeId: copied.body.data.recipe.id, recipeFactorMilli: 1_000,
      ingredients: [{ itemId: milk.id, quantity: "240", unit: "ml", recipeLine: 0 }],
      stepLog: [{ key: boil, startedAt: at(0), doneAt: at(3) }, { key: milkStep, startedAt: at(4), doneAt: at(7) }],
    });
    expect(dish.status).toBe(201);
    const rows = w.h.db.prepare("SELECT step_key, recipe_root_id, seconds FROM kitchen_dish_step_times ORDER BY step_key").all();
    const root = RECIPES.find((r) => r.name === "Masala chai")!.id;
    expect(rows).toEqual([
      { step_key: boil, recipe_root_id: root, seconds: 180 },
      { step_key: milkStep, recipe_root_id: root, seconds: 180 },
    ]);
    expect([boil, milkStep]).toEqual(["c00c0390-32-02", "c00c0390-32-04"]);
  });
});
