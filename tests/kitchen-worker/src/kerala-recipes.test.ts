// Cookpool's recipes replaced (Cookpool RV-20): migration 590 deletes 360's
// 42 and seeds 13 Kerala recipes in their place.
//
//   - The 13, read through the real recipe read and checked as 390's guided
//     content is (cookpool-guided): every cook step a flame and a checkpoint
//     or a time; hands-off steps timed or counted in whistles; sane ranges;
//     no amount or time in a step's words; every line used; prep before
//     cook; 590's fixed keys; tools set. Their lines' units and scaling are
//     cookpool-recipes' seed checks, which cover 590's rows too.
//   - What named an old recipe keeps working once it is deleted: a dish
//     cooked from it reads with its own name, its post with its own title
//     and no recipe link, a copy saved of it stays its saver's, and the
//     cook's history still lists it — while a new cook from it is the
//     opaque 404, as for any deleted recipe.

import {
  LONG_PREP_SECONDS,
  MAX_RECIPE_STEPS,
  stepTimeAt,
  type DishResponse,
  type KitchenRecipe,
  type KitchenRecipeStep,
  type MyRecipesResponse,
  type RecipeResponse,
  type RecipesResponse,
} from "@saas/contracts/kitchen";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { D1ApiAdapter } from "@saas/db/runner";
import { migratedDatabase } from "./harness.js";
import { OLU, world, type World } from "./recipes-helpers.js";
import { ANU, MEERA, communityWorld, cook, copy, makeProfile, me, posted, readPost, type CommunityWorld } from "./posts-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(__dirname, "../../..", "packages/db/src/migrations/590_kitchen_no_starter_recipes/up.sql");
/** 590's first statement: the soft delete of every live system recipe but its own. */
const SOFT_DELETE = D1ApiAdapter.splitStatements(readFileSync(MIGRATION, "utf8"))[0]!;

const seed = migratedDatabase();
const LIVE = seed
  .prepare("SELECT id, name FROM kitchen_recipes WHERE is_system = 1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC")
  .all() as unknown as Array<{ id: string; name: string }>;
seed.close();
const publicId = (uuid: string) => `rcp_${uuid.replace(/-/g, "")}`;
/** 360's Masala chai. */
const OLD_CHAI = "c00c0360-0000-4000-8000-000000000032";

const HOUR = 3_600;
/** A number followed by a unit of amount or time: "2 tbsp", "10 minutes", "3 whistles", "6-inch". */
const AMOUNT_IN_TEXT = /\d\s*-?\s*(?:g|kg|gm|grams?|ml|l|litres?|liters?|tsp|tbsp|teaspoons?|tablespoons?|cups?|pcs|pieces?|min|mins|minutes?|s|secs?|seconds?|h|hrs?|hours?|whistles?|inch(?:es)?|cm)\b/i;
const isTimed = (s: KitchenRecipeStep) => s.minSeconds !== null && s.maxSeconds !== null;

describe("590's 13 Kerala recipes, cooking with you (RV-20)", () => {
  let w: World;
  const read = new Map<string, KitchenRecipe>();

  beforeAll(async () => {
    w = world();
    for (const r of LIVE) {
      const res = await w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${publicId(r.id)}`, OLU);
      if (res.status !== 200) throw new Error(`read ${r.name}: ${res.status}`);
      read.set(r.name, res.body.data.recipe);
    }
  });
  afterAll(() => w.h.close());

  it("are the 13, all Cookpool's, each for four", () => {
    expect(LIVE).toHaveLength(13);
    for (const r of read.values()) expect(r).toMatchObject({ isSystem: true, ownerName: "Cookpool", servesHalf: 8 });
  });

  it.each(LIVE.map((r, i) => [r.name, i + 1] as const))("%s: cooks step by step", (name, n) => {
    const r = read.get(name)!;
    const steps = r.guidedSteps!;
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(MAX_RECIPE_STEPS);
    expect(r.steps).toEqual(steps.map((s) => s.text));
    expect(r.tools!.length).toBeGreaterThanOrEqual(1);
    expect(steps.map((s) => s.phase).join(" ")).toMatch(/^(prep )*cook( cook)*$/);

    const used = new Set<number>();
    steps.forEach((s, i) => {
      const at = `${name} step ${i + 1}: ${s.text}`;
      expect([at, s.position, s.key]).toEqual([at, i, `c00c0590-${String(n).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`]);
      if (s.phase === "cook") {
        expect([at, s.heat !== null]).toEqual([at, true]);
        expect([at, s.checkpoint !== null || isTimed(s) || s.whistles !== null]).toEqual([at, true]);
      }
      if (s.handsOff) expect([at, isTimed(s) || s.whistles !== null]).toEqual([at, true]);
      if (s.whistles !== null) {
        expect([at, s.minSeconds, s.maxSeconds]).toEqual([at, null, null]);
        expect(stepTimeAt(s, 2_000)).toEqual({ whistles: s.whistles });
      }
      if (isTimed(s)) {
        const [lo, hi] = [s.minSeconds!, s.maxSeconds!];
        expect([at, lo >= 30]).toEqual([at, true]);
        expect([at, hi <= (s.phase === "prep" ? 12 * HOUR : 2 * HOUR)]).toEqual([at, true]);
        expect([at, lo <= hi && hi <= 3 * lo]).toEqual([at, true]);
      }
      if (s.sense !== null) expect([at, s.checkpoint]).toEqual([at, expect.any(String)]);
      expect([at, AMOUNT_IN_TEXT.test(s.text)]).toEqual([at, false]);
      for (const line of s.lines) expect([at, line, line >= 0 && line < r.lines.length]).toEqual([at, line, true]);
      expect([at, new Set(s.lines).size]).toEqual([at, s.lines.length]);
      s.lines.forEach((l) => used.add(l));
    });
    expect(r.lines.filter((l) => !used.has(l.position)).map((l) => l.name)).toEqual([]);
    expect(r.longPrep!.map((p) => p.key)).toEqual(
      steps.filter((s) => s.phase === "prep" && s.handsOff && s.minSeconds !== null && s.minSeconds >= LONG_PREP_SECONDS).map((s) => s.key),
    );
  });

  it("counts whistles for the pressure-cooked meats, then a low flame or the pressure dropping", () => {
    for (const name of ["Beef roast (Kerala ularthiyathu)", "Beef fry (Kerala)", "Chilli pork"]) {
      const s = read.get(name)!.guidedSteps!;
      const cooker = s.findIndex((x) => x.whistles !== null);
      expect([name, cooker >= 0, s[cooker]!.heat, s[cooker]!.handsOff]).toEqual([name, true, 3, true]);
      expect(s.slice(cooker + 1).find((x) => x.heat === 0)!.checkpoint).toBe("the pressure valve has dropped");
    }
    // Only pork vindaloo waits long beforehand: its marinade, hours in the fridge.
    expect(LIVE.filter((r) => read.get(r.name)!.longPrep!.length > 0).map((r) => r.name)).toEqual(["Pork vindaloo"]);
  });
});

describe("what named an old Cookpool recipe, once 590 deletes it (RV-20)", () => {
  let w: CommunityWorld;
  beforeEach(async () => {
    w = communityWorld();
    // 360's Masala chai as it was before 590: live, so it can be cooked, posted and saved.
    w.h.db.prepare("UPDATE kitchen_recipes SET deleted_at = NULL WHERE id = ?").run(OLD_CHAI);
    await makeProfile(w, MEERA, "meera", "Meera K");
  });
  afterEach(() => w.h.close());

  it("keeps the dish, its post, a saved copy and the cook's history, each on its own words", async () => {
    const chai = publicId(OLD_CHAI);
    const dishId = await cook(w, MEERA, { name: "Masala chai", recipeId: chai });
    const post = await posted(w, MEERA, dishId, "followers");
    expect(post.recipe).toMatchObject({ id: chai, name: "Masala chai" }); // Cookpool's recipes are linked
    const saved = await copy(w, ANU, chai);

    w.h.db.exec(SOFT_DELETE);

    // The dish: its own name, and the recipe it was cooked from.
    const dish = await w.call<DishResponse>("GET", me(`dishes/${dishId}`), MEERA);
    expect(dish.status).toBe(200);
    expect(dish.body.data.dish).toMatchObject({ name: "Masala chai", recipeId: chai });
    // The post: its own title, and no link to a recipe that is gone.
    const read = await readPost(w, MEERA, post.id);
    expect(read.status).toBe(200);
    expect(read.post).toMatchObject({ title: "Masala chai", recipe: null });
    // The copy is Anu's: live, from Cookpool.
    const mine = await w.call<MyRecipesResponse>("GET", me("recipes"), ANU);
    expect(mine.body.data.recipes.find((r) => r.id === saved.id)).toMatchObject({ name: "Masala chai", mine: true, source: { recipeId: chai, ownerName: "Cookpool" } });
    expect((await w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${saved.id}`, ANU)).status).toBe(200);
    // Cook history (from before) lists what Meera cooked.
    const history = await w.call<RecipesResponse>("GET", me("dishes/recipes"), MEERA);
    expect(history.status).toBe(200);
    expect(history.body.data.recipes.map((r) => r.name)).toContain("Masala chai");
    // The recipe itself is gone: reading it, or cooking from it now, is the opaque 404.
    expect((await w.call("GET", `/v1/kitchen/recipes/${chai}`, MEERA)).status).toBe(404);
    await expect(cook(w, MEERA, { name: "Masala chai", recipeId: chai })).rejects.toThrow(/cook: 404/);
  });
});
