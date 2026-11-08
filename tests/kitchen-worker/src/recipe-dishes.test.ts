// Cooking from a recipe (Cookpool RC-4, cookpool-recipes design §3.5, §4.3,
// §7) through the router: the dish write keeps the recipe, its factor and
// each ingredient's line — only for a recipe the cook may see — moving money
// exactly as without it; the recipe's lastCook is the caller's last such dish;
// and a finished dish saves as a recipe (lines at the amounts used, serves
// from its portions, the heaviest ingredient the main line).

import type { CookDishResponse, DishResponse, DishesPage, KitchenItem, RecipeResponse } from "@saas/contracts/kitchen";
import { ANU, DEV, OLU, RAHUL, addItem, chickenCurry, me, world, writeRecipe, type World } from "./recipes-helpers.js";

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.h.close());

const cook = (as: string, body: Record<string, unknown>) => {
  w.tick();
  return w.call<CookDishResponse>("POST", me("dishes"), as, { portionsHalf: 4, splitMode: "assign", ...body });
};
const read = (id: string, as: string) => w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${id}`, as);
const dishCount = () => (w.h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_dishes").get() as { n: number }).n;

async function chickenAndOnions(): Promise<{ chicken: KitchenItem; onions: KitchenItem }> {
  const chicken = await addItem(w, RAHUL, null, { name: "Chicken", category: "protein", quantity: "2", unit: "kg", priceMinor: 60000 });
  const onions = await addItem(w, RAHUL, null, { name: "Onions", quantity: "1", unit: "kg", priceMinor: 4000 });
  return { chicken, onions };
}

describe("POST /v1/kitchen/me/dishes with a recipe (RC-4)", () => {
  it("keeps the recipe, its factor and each ingredient's line, returns them on every dish read, and moves money as without them", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const { chicken, onions } = await chickenAndOnions();
    const twin = await addItem(w, RAHUL, null, { name: "Chicken", category: "protein", quantity: "2", unit: "kg", priceMinor: 60000 });
    const res = await cook(RAHUL, {
      name: "Chicken curry",
      recipeId: curry.id,
      recipeFactorMilli: 450,
      ingredients: [
        { itemId: chicken.id, quantity: "450", unit: "g", recipeLine: 0 },
        { itemId: onions.id, quantity: "300", unit: "g", recipeLine: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const dish = res.body.data.dish;
    expect(dish).toMatchObject({ recipeId: curry.id, recipeFactorMilli: 450 });
    expect(dish.ingredients.map((i) => i.recipeLine)).toEqual([0, 1]);
    expect((await w.call<DishResponse>("GET", me(`dishes/${dish.id}`), RAHUL)).body.data.dish).toMatchObject({ recipeId: curry.id, recipeFactorMilli: 450 });
    expect((await w.call<DishesPage>("GET", me("dishes"), RAHUL)).body.data.dishes[0]).toMatchObject({ recipeId: curry.id });

    // The same take without a recipe costs the same.
    const plain = await cook(RAHUL, { name: "Chicken curry", ingredients: [{ itemId: twin.id, quantity: "450", unit: "g" }] });
    expect(plain.body.data.dish).toMatchObject({ recipeId: null, recipeFactorMilli: null });
    expect(plain.body.data.dish.ingredients[0]).toMatchObject({ recipeLine: null, costMinor: dish.ingredients[0]!.costMinor });
  });

  it("keeps a just-bought item's line, and the words an ingredient given in a measure was in", async () => {
    const curry = await writeRecipe(w, RAHUL, chickenCurry);
    const { onions } = await chickenAndOnions();
    w.tick();
    await w.call("PUT", me(`items/${onions.id}/measures`), RAHUL, { measures: [{ one: "onion", many: "onions", count: 1, amountMilli: 150_000 }] });
    const res = await cook(RAHUL, {
      name: "Chicken curry",
      recipeId: curry.id,
      ingredients: [{ itemId: onions.id, quantity: 2, measure: "onion", recipeLine: 1 }],
      newItems: [{ name: "Chicken", category: "protein", quantity: "1", unit: "kg", priceMinor: 30000, recipeLine: 0 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.dish.ingredients.map((i) => [i.name, i.recipeLine, i.label])).toEqual([
      ["Onions", 1, "2 onions"],
      ["Chicken", 0, null],
    ]);
    const last = (await read(curry.id, RAHUL)).body.data.lastCook!;
    expect(last.lines.map((l) => [l.recipeLine, l.label, l.qtyMilli])).toEqual([[1, "2 onions", 300_000], [0, null, 1_000_000]]);
    expect(last.recipeFactorMilli).toBeNull();
  });

  it("refuses a recipe the cook may not see (404) and lines it does not have (422), writing nothing", async () => {
    const secret = await writeRecipe(w, ANU, { ...chickenCurry, visibility: "only_me" });
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const { chicken } = await chickenAndOnions();
    const take = [{ itemId: chicken.id, quantity: "100", unit: "g", recipeLine: 0 }];
    expect((await cook(RAHUL, { name: "X", recipeId: secret.id, ingredients: take })).status).toBe(404);
    expect((await cook(RAHUL, { name: "X", recipeId: `rcp_${"0".repeat(32)}`, ingredients: take })).status).toBe(404);
    // A link holder cooks from their own copy: the dish write takes no code.
    const code = (await w.call<RecipeResponse>("POST", me(`recipes/${curry.id}/link`), ANU)).body.data.recipe.linkCode!;
    const olusChicken = await addItem(w, OLU, null, { name: "Chicken", category: "protein", quantity: "1", unit: "kg", priceMinor: 30000 });
    expect((await cook(OLU, { name: "X", recipeId: curry.id, ingredients: [{ itemId: olusChicken.id, quantity: "100", unit: "g" }] })).status).toBe(404);
    const copy = (await w.call<RecipeResponse>("POST", me("recipes/copies"), OLU, { linkCode: code })).body.data.recipe;
    expect((await cook(OLU, { name: "X", recipeId: copy.id, ingredients: [{ itemId: olusChicken.id, quantity: "100", unit: "g", recipeLine: 0 }] })).status).toBe(201);

    const before = dishCount();
    const out = await cook(RAHUL, { name: "X", recipeId: curry.id, ingredients: [{ itemId: chicken.id, quantity: "100", unit: "g", recipeLine: 5 }] });
    expect(out.status).toBe(422);
    expect(out.body.error.details.fields).toEqual({ "ingredients[0].recipeLine": ["The recipe has 5 lines"] });
    const noRecipe = await cook(RAHUL, { name: "X", recipeFactorMilli: 450, ingredients: take });
    expect(noRecipe.status).toBe(422);
    expect(Object.keys(noRecipe.body.error.details.fields as object).sort()).toEqual(["recipeFactorMilli", "recipeId"]);
    const range = await cook(RAHUL, { name: "X", recipeId: curry.id, recipeFactorMilli: 0, ingredients: [{ ...take[0], recipeLine: -1 }] });
    expect(Object.keys(range.body.error.details.fields as object).sort()).toEqual(["ingredients[0].recipeLine", "recipeFactorMilli"]);
    expect(dishCount()).toBe(before);
  });
});

describe("lastCook (RC-4, design §4.2: Last time)", () => {
  it("is the caller's last dish of the recipe that was not canceled — and nobody else's", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    expect((await read(curry.id, RAHUL)).body.data.lastCook).toBeNull();
    const { chicken, onions } = await chickenAndOnions();
    const first = await cook(RAHUL, {
      name: "Chicken curry",
      recipeId: curry.id,
      recipeFactorMilli: 450,
      ingredients: [
        { itemId: chicken.id, quantity: "450", unit: "g", recipeLine: 0 },
        { itemId: onions.id, quantity: "0.3", unit: "kg", recipeLine: 1 },
      ],
    });
    const seen = (await read(curry.id, RAHUL)).body.data;
    expect(seen.lastCook).toEqual({
      dishId: first.body.data.dish.id,
      cookedAt: first.body.data.dish.cookedAt,
      recipeFactorMilli: 450,
      portionsHalf: 4,
      lines: [
        { recipeLine: 0, itemId: chicken.id, name: "Chicken", qtyMilli: 450_000, quantity: 450, unit: "g", label: null },
        { recipeLine: 1, itemId: onions.id, name: "Onions", qtyMilli: 300_000, quantity: 0.3, unit: "kg", label: null },
      ],
    });
    expect(seen.recipe.lastCookedAt).toBe(first.body.data.dish.cookedAt);
    expect((await read(curry.id, ANU)).body.data.lastCook).toBeNull();

    // A later one, and an ingredient for no line, which last time leaves out.
    const later = await cook(RAHUL, {
      name: "Chicken curry",
      recipeId: curry.id,
      recipeFactorMilli: 1000,
      ingredients: [
        { itemId: chicken.id, quantity: "1", unit: "kg", recipeLine: 0 },
        { itemId: onions.id, quantity: "100", unit: "g" },
      ],
    });
    const now = (await read(curry.id, RAHUL)).body.data.lastCook!;
    expect([now.dishId, now.recipeFactorMilli, now.lines.length]).toEqual([later.body.data.dish.id, 1000, 1]);
    // Cancelled: last time is the one before.
    w.tick();
    expect((await w.call("POST", me(`dishes/${later.body.data.dish.id}/cancel`), RAHUL, {})).status).toBe(200);
    expect((await read(curry.id, RAHUL)).body.data.lastCook!.dishId).toBe(first.body.data.dish.id);
  });
});

describe("saving a dish as a recipe: POST /v1/kitchen/me/recipes with fromDishId (RC-4, design §3.5)", () => {
  async function dalTadka() {
    const dal = await addItem(w, RAHUL, w.flat, { name: "Toor dal", category: "grains", quantity: "1", unit: "kg", priceMinor: 16000 });
    const eggs = await addItem(w, RAHUL, null, { name: "Eggs", category: "protein", quantity: "6", unit: "pcs", priceMinor: 4200 });
    const ghee = await addItem(w, RAHUL, null, { name: "Ghee", category: "dairy", quantity: "500", unit: "ml", priceMinor: 30000 });
    const milk = await addItem(w, RAHUL, null, { name: "Amul taaza", category: "dairy", quantity: "1", unit: "L", priceMinor: 6800 });
    const res = await cook(RAHUL, {
      name: "Dal tadka",
      orgId: w.flat.publicId,
      portionsHalf: 6,
      splitMode: "claims",
      ingredients: [
        { itemId: eggs.id, quantity: "3", unit: "pcs" }, // 150 g by the egg's weight
        { itemId: dal.id, quantity: "200", unit: "g" }, // the heaviest
        { itemId: ghee.id, quantity: "1", unit: "tbsp" },
        { itemId: milk.id, quantity: "50", unit: "ml" },
      ],
    });
    expect(res.status).toBe(201);
    return res.body.data.dish;
  }

  it("makes every ingredient a line at the amount used, serves the dish's portions, and the heaviest the main line", async () => {
    const dish = await dalTadka();
    w.tick();
    const res = await w.call<RecipeResponse>("POST", me("recipes"), RAHUL, { fromDishId: dish.id });
    expect(res.status).toBe(201);
    const recipe = res.body.data.recipe;
    expect(recipe).toMatchObject({ ownerId: RAHUL, name: "Dal tadka", servesHalf: 6, visibility: "groups", source: null, steps: [] });
    expect(recipe.lines.map((l) => [l.foodKey, l.name, l.qtyMilli, l.unit, l.isMain])).toEqual([
      ["egg", "Eggs", 3_000, "pcs", false],
      ["toor_dal", "Toor dal", 200_000, "g", true],
      ["ghee", "Ghee", 15_000, "tbsp", false],
      [null, "Amul taaza", 50_000, "ml", false],
    ]);
    // A dish cooked from no recipe has no last time for it.
    expect(res.body.data.lastCook).toBeNull();
  });

  it("takes a name, kind, visibility and steps of its own; any member of the dish's group may save it; nobody else", async () => {
    const dish = await dalTadka();
    w.tick();
    const mine = await w.call<RecipeResponse>("POST", me("recipes"), DEV, {
      fromDishId: dish.id,
      name: "Rahul's dal",
      kind: "dal_curry",
      visibility: "only_me",
      steps: ["Temper the ghee"],
    });
    expect(mine.status).toBe(201);
    expect(mine.body.data.recipe).toMatchObject({ ownerId: DEV, name: "Rahul's dal", kind: "dal_curry", visibility: "only_me", steps: ["Temper the ghee"] });
    expect((await w.call("POST", me("recipes"), OLU, { fromDishId: dish.id })).status).toBe(404);
    expect((await w.call("POST", me("recipes"), RAHUL, { fromDishId: "dsh_nope" })).status).toBe(422);
    expect((await w.call("POST", me("recipes"), RAHUL, { fromDishId: dish.id, lines: [] })).status).toBe(422);

    w.tick();
    expect((await w.call("POST", me(`dishes/${dish.id}/cancel`), RAHUL, {})).status).toBe(200);
    const canceled = await w.call("POST", me("recipes"), RAHUL, { fromDishId: dish.id });
    expect(canceled.status).toBe(409);
    expect(canceled.body.error.details.reason).toBe("dish_not_open");
  });
});
