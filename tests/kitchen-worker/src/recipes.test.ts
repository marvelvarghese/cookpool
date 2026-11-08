// Recipes (Cookpool RC-4, cookpool-recipes design §3.1, §3.5, §5.1–§5.3, §7)
// through the router: writing one, editing and deleting it, who may see it —
// the owner, someone in their group, a viewer of it, a stranger, a link
// holder, after the link is rotated or turned off, after leaving the group —
// Cookpool's own, saving a copy (and that the copy never follows its source),
// a person's recipes and Explore.

import type {
  ExploreRecipesResponse,
  KitchenRecipe,
  MyRecipesResponse,
  PersonRecipesResponse,
  RecipeResponse,
} from "@saas/contracts/kitchen";
import { RECIPE_LINK_CODE_RE, RECIPE_UNITS } from "@saas/contracts/kitchen";
import { UNITS } from "@saas/kitchen-engine/units";
import { ANU, DEV, OLU, RAHUL, VIK, chickenCurry, me, systemRecipe, world, writeRecipe, type World } from "./recipes-helpers.js";

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.h.close());

const read = (id: string, as: string, code?: string) =>
  w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${id}${code ? `?code=${code}` : ""}`, as);
const byLink = (code: string, as: string) => w.call<RecipeResponse>("GET", `/v1/kitchen/recipe-links/${code}`, as);
const statusOf = async (p: Promise<{ status: number }>) => (await p).status;

describe("writing a recipe (RC-4, design §3.1, §3.5)", () => {
  it("writes Chicken curry: My groups by default, every line in its unit, the main one scaling the rest, steps in order", async () => {
    const recipe = await writeRecipe(w, ANU, chickenCurry);
    expect(recipe).toMatchObject({
      ownerId: ANU,
      ownerName: "Anu",
      name: "Chicken curry",
      servesHalf: 8,
      serves: 4,
      minutes: 45,
      kind: "dal_curry",
      visibility: "groups",
      isSystem: false,
      mine: true,
      source: null,
      savedBy: 0,
      lineCount: 5,
      linkCode: null,
      lastCookedAt: null,
      steps: chickenCurry.steps,
      main: { position: 0, foodKey: "chicken", name: "Chicken", qtyMilli: 1_000_000, quantity: 1, unit: "kg" },
    });
    expect(recipe.id).toMatch(/^rcp_[0-9a-f]{32}$/);
    expect(recipe.lines).toEqual([
      { position: 0, foodKey: "chicken", name: "Chicken", qtyMilli: 1_000_000, quantity: 1, unit: "kg", dimension: "mass", toTaste: false, isMain: true },
      { position: 1, foodKey: "onion", name: "Onions, sliced", qtyMilli: 2_000, quantity: 2, unit: "onion", dimension: "count", toTaste: false, isMain: false },
      { position: 2, foodKey: "tomato", name: "Tomatoes", qtyMilli: 200_000, quantity: 200, unit: "g", dimension: "mass", toTaste: false, isMain: false },
      { position: 3, foodKey: "turmeric", name: "Turmeric", qtyMilli: 5_000, quantity: 1, unit: "tsp", dimension: "volume", toTaste: false, isMain: false },
      { position: 4, foodKey: "salt", name: "Salt", qtyMilli: null, quantity: null, unit: null, dimension: null, toTaste: true, isMain: false },
    ]);
  });

  it("makes the first line with a weight the main one when none says, and takes any case of a unit", async () => {
    const recipe = await writeRecipe(w, RAHUL, {
      name: "Egg bhurji",
      servesHalf: 2,
      lines: [
        { foodKey: "egg", name: "Eggs", quantity: 4, unit: "PCS" },
        { foodKey: "onion", name: "Onion", quantity: "100", unit: "G" },
        { foodKey: "oil", name: "Oil", quantity: "1", unit: "Tbsp" },
        { name: "Love", toTaste: true },
      ],
    });
    expect(recipe.lines.map((l) => [l.unit, l.isMain])).toEqual([["pcs", false], ["g", true], ["tbsp", false], [null, false]]);
    expect(recipe.steps).toEqual([]);
  });

  it("refuses what a recipe cannot be, with every field that is wrong (422)", async () => {
    const bad = async (body: Record<string, unknown>) => {
      const res = await w.call("POST", me("recipes"), RAHUL, { ...chickenCurry, ...body });
      expect(res.status).toBe(422);
      return Object.keys(res.body.error.details.fields as object).sort();
    };
    expect(await bad({ lines: [] })).toEqual(["lines"]);
    expect(await bad({ name: "", servesHalf: 0, minutes: 0, kind: "brunch", visibility: "public" })).toEqual([
      "kind", "minutes", "name", "servesHalf", "visibility",
    ]);
    expect(await bad({ lines: [{ name: "Rice", quantity: 1, unit: "kg", isMain: true }, { name: "Dal", quantity: 1, unit: "kg", isMain: true }] })).toEqual(["lines"]);
    expect(await bad({ lines: [{ name: "Salt", toTaste: true, isMain: true }] })).toEqual(["lines[0].isMain"]);
    expect(await bad({ lines: [{ name: "Salt", toTaste: true }] })).toEqual(["lines"]);
    expect(await bad({ lines: [{ name: "Salt", toTaste: true, quantity: 1, unit: "tsp" }] })).toEqual(["lines[0].quantity"]);
    expect(await bad({ lines: [{ name: "Rice", unit: "kg" }, { name: "Dal", quantity: "1", unit: "bucket of 9" }] })).toEqual([
      "lines[0].quantity", "lines[1].unit",
    ]);
    expect(await bad({ lines: [{ name: "Rice", quantity: "-1", unit: "kg" }] })).toEqual(["lines[0].quantity"]);
    expect(await bad({ lines: [{ foodKey: "dragonfruit", name: "Dragonfruit", quantity: 1, unit: "pcs" }] })).toEqual(["lines[0].foodKey"]);
    expect(await bad({ steps: ["x".repeat(201)] })).toEqual(["steps[0]"]);
    expect(await bad({ steps: Array.from({ length: 21 }, () => "Stir") })).toEqual(["steps"]);
    expect(await bad({ lines: Array.from({ length: 41 }, () => ({ name: "Rice", quantity: 1, unit: "g" })) })).toEqual(["lines"]);
    expect((await w.call<MyRecipesResponse>("GET", me("recipes"), RAHUL)).body.data.recipes).toEqual([]);
  });

  it("lists the caller's own recipes and copies, last cooked first, and no one else's", async () => {
    const curry = await writeRecipe(w, RAHUL, chickenCurry);
    const bhurji = await writeRecipe(w, RAHUL, { ...chickenCurry, name: "Bhurji" });
    await writeRecipe(w, ANU, { ...chickenCurry, name: "Anu's curry" });
    const list = await w.call<MyRecipesResponse>("GET", me("recipes"), RAHUL);
    expect(list.status).toBe(200);
    // Never cooked: newest first.
    expect(list.body.data.recipes.map((r) => r.name)).toEqual([bhurji.name, curry.name]);
    expect(list.body.data.recipes[0]).not.toHaveProperty("lines");
  });
});

describe("who may see a recipe (RC-4, design §5.1)", () => {
  it("My groups: its owner and anyone who shares a group with them now — a viewer too — and nobody else; leaving ends it", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    expect(await statusOf(read(curry.id, ANU))).toBe(200);
    expect(await statusOf(read(curry.id, RAHUL))).toBe(200);
    expect(await statusOf(read(curry.id, VIK))).toBe(200);
    expect(await statusOf(read(curry.id, OLU))).toBe(404);
    // What a co-member reads: not theirs, no link code.
    const theirs = (await read(curry.id, RAHUL)).body.data.recipe;
    expect(theirs).toMatchObject({ mine: false, ownerName: "Anu", linkCode: null });
    w.h.revoke(DEV, w.flat);
    expect(await statusOf(read(curry.id, DEV))).toBe(404);
    // A malformed id and one that never existed read the same.
    expect(await statusOf(read("rcp_nope", RAHUL))).toBe(404);
    expect(await statusOf(read(`rcp_${"0".repeat(32)}`, RAHUL))).toBe(404);
    expect((await w.call("GET", `/v1/kitchen/recipes/${curry.id}`, null)).status).toBe(401);
  });

  it("Only me: its owner alone", async () => {
    const secret = await writeRecipe(w, ANU, { ...chickenCurry, visibility: "only_me" });
    expect(await statusOf(read(secret.id, ANU))).toBe(200);
    expect(await statusOf(read(secret.id, RAHUL))).toBe(404);
    expect(await statusOf(read(secret.id, OLU))).toBe(404);
  });

  it("Anyone with the link: plus anyone signed in with the code — rotating or turning it off ends the old code at once", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    // Only its owner may share it.
    expect(await statusOf(w.call("POST", me(`recipes/${curry.id}/link`), RAHUL))).toBe(404);
    const linked = await w.call<RecipeResponse>("POST", me(`recipes/${curry.id}/link`), ANU);
    expect(linked.status).toBe(200);
    const code = linked.body.data.recipe.linkCode!;
    expect(code).toMatch(RECIPE_LINK_CODE_RE);
    expect(linked.body.data.recipe.visibility).toBe("link");

    // A stranger: only with the code.
    expect(await statusOf(read(curry.id, OLU))).toBe(404);
    const opened = await byLink(code, OLU);
    expect(opened.status).toBe(200);
    expect(opened.body.data.recipe).toMatchObject({ id: curry.id, name: "Chicken curry", mine: false, linkCode: null });
    expect(await statusOf(read(curry.id, OLU, code))).toBe(200);
    expect(await statusOf(w.call("GET", me(`recipes/${curry.id}/match?code=${code}`), OLU))).toBe(200);
    // Still My groups for the group.
    expect(await statusOf(read(curry.id, RAHUL))).toBe(200);
    expect((await w.call("GET", `/v1/kitchen/recipe-links/${code}`, null)).status).toBe(401);

    // Rotate: the old code is gone, the new one works.
    const rotated = await w.call<RecipeResponse>("POST", me(`recipes/${curry.id}/link`), ANU);
    const fresh = rotated.body.data.recipe.linkCode!;
    expect(fresh).not.toBe(code);
    expect(await statusOf(byLink(code, OLU))).toBe(404);
    expect(await statusOf(read(curry.id, OLU, code))).toBe(404);
    expect(await statusOf(byLink(fresh, OLU))).toBe(200);

    // Off: back to My groups, no code at all.
    const off = await w.call<RecipeResponse>("DELETE", me(`recipes/${curry.id}/link`), ANU);
    expect(off.body.data.recipe).toMatchObject({ visibility: "groups", linkCode: null });
    expect(await statusOf(byLink(fresh, OLU))).toBe(404);
    expect(await statusOf(read(curry.id, RAHUL))).toBe(200);
    expect(await statusOf(byLink("not-a-code", OLU))).toBe(404);
  });

  it("Cookpool's own: everyone sees them, nobody edits, deletes or shares them", async () => {
    const chai = systemRecipe(w, "Masala chai", 4, [["tea", "Tea", 10_000, "g", true], ["milk", "Milk", 250_000, "ml", false]], "drink");
    const seen = await read(chai, OLU);
    expect(seen.status).toBe(200);
    expect(seen.body.data.recipe).toMatchObject({ ownerId: "usr_cookpool", ownerName: "Cookpool", isSystem: true, mine: false });
    for (const as of [OLU, "usr_cookpool"]) {
      expect(await statusOf(w.call("PATCH", me(`recipes/${chai}`), as, { name: "Mine" }))).toBe(404);
      expect(await statusOf(w.call("DELETE", me(`recipes/${chai}`), as))).toBe(404);
      expect(await statusOf(w.call("POST", me(`recipes/${chai}/link`), as))).toBe(404);
    }
  });
});

describe("editing and deleting (RC-4, design §3.5)", () => {
  it("lets only its owner edit it — lines and steps replaced whole — and Only me ↔ link mints and drops the code", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    expect(await statusOf(w.call("PATCH", me(`recipes/${curry.id}`), RAHUL, { name: "Mine" }))).toBe(404);
    w.tick();
    const edited = await w.call<RecipeResponse>("PATCH", me(`recipes/${curry.id}`), ANU, {
      name: "Chicken curry, lighter",
      servesHalf: 6,
      minutes: null,
      lines: [{ foodKey: "chicken", name: "Chicken thighs", quantity: "750", unit: "g" }],
      steps: ["Grill it"],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data.recipe).toMatchObject({ name: "Chicken curry, lighter", servesHalf: 6, minutes: null, lineCount: 1, steps: ["Grill it"] });
    expect(edited.body.data.recipe.lines[0]).toMatchObject({ name: "Chicken thighs", qtyMilli: 750_000, isMain: true });
    const link = await w.call<RecipeResponse>("PATCH", me(`recipes/${curry.id}`), ANU, { visibility: "link" });
    expect(link.body.data.recipe.linkCode).toMatch(RECIPE_LINK_CODE_RE);
    const again = await w.call<RecipeResponse>("PATCH", me(`recipes/${curry.id}`), ANU, { visibility: "link" });
    expect(again.body.data.recipe.linkCode).toBe(link.body.data.recipe.linkCode);
    const onlyMe = await w.call<RecipeResponse>("PATCH", me(`recipes/${curry.id}`), ANU, { visibility: "only_me" });
    expect(onlyMe.body.data.recipe).toMatchObject({ visibility: "only_me", linkCode: null });
    expect(await statusOf(byLink(link.body.data.recipe.linkCode!, OLU))).toBe(404);
    expect(await statusOf(w.call("PATCH", me(`recipes/${curry.id}`), ANU, {}))).toBe(422);
    expect(await statusOf(w.call("PATCH", me(`recipes/${curry.id}`), ANU, { lines: [{ foodKey: "unicorn", name: "X", quantity: 1, unit: "g" }] }))).toBe(422);
    expect(await statusOf(w.call("GET", me(`recipes/${curry.id}`), ANU))).toBe(405);
  });

  it("deletes softly for its owner alone: gone for everyone, its copies kept", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const copy = await w.call<RecipeResponse>("POST", me("recipes/copies"), RAHUL, { recipeId: curry.id });
    expect(copy.status).toBe(201);
    expect(await statusOf(w.call("DELETE", me(`recipes/${curry.id}`), RAHUL))).toBe(404);
    const deleted = await w.call<RecipeResponse>("DELETE", me(`recipes/${curry.id}`), ANU);
    expect(deleted.status).toBe(200);
    expect(await statusOf(read(curry.id, ANU))).toBe(404);
    expect(await statusOf(read(curry.id, RAHUL))).toBe(404);
    expect(await statusOf(w.call("DELETE", me(`recipes/${curry.id}`), ANU))).toBe(404);
    const kept = await read(copy.body.data.recipe.id, RAHUL);
    expect(kept.status).toBe(200);
    expect(kept.body.data.recipe.lines).toEqual(copy.body.data.recipe.lines);
    expect(kept.body.data.recipe.source).toEqual({ recipeId: curry.id, ownerId: ANU, ownerName: "Anu" });
  });
});

describe("saving a copy (RC-4, design §5.2)", () => {
  it("makes the saver's own Only-me copy, 'from Anu', counted as saved by — and the source's later edits never reach it", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const res = await w.call<RecipeResponse>("POST", me("recipes/copies"), RAHUL, { recipeId: curry.id });
    expect(res.status).toBe(201);
    const copy: KitchenRecipe = res.body.data.recipe;
    expect(copy).toMatchObject({
      ownerId: RAHUL,
      mine: true,
      visibility: "only_me",
      name: "Chicken curry",
      servesHalf: 8,
      kind: "dal_curry",
      steps: chickenCurry.steps,
      source: { recipeId: curry.id, ownerId: ANU, ownerName: "Anu" },
    });
    expect(copy.id).not.toBe(curry.id);
    expect(copy.lines).toEqual(curry.lines);
    expect((await read(curry.id, ANU)).body.data.recipe.savedBy).toBe(1);
    // Dev saves one too.
    await w.call("POST", me("recipes/copies"), DEV, { recipeId: curry.id });
    expect((await read(curry.id, RAHUL)).body.data.recipe.savedBy).toBe(2);

    await w.call("PATCH", me(`recipes/${curry.id}`), ANU, { name: "Anu's new curry", lines: [{ foodKey: "chicken", name: "Chicken", quantity: 2, unit: "kg" }] });
    const still = await read(copy.id, RAHUL);
    expect(still.body.data.recipe.name).toBe("Chicken curry");
    expect(still.body.data.recipe.lines).toEqual(copy.lines);
    // Nobody else sees the copy: it is Only me.
    expect(await statusOf(read(copy.id, ANU))).toBe(404);
    expect((await w.call<MyRecipesResponse>("GET", me("recipes"), RAHUL)).body.data.recipes.map((r) => r.source?.ownerName)).toEqual(["Anu"]);
  });

  it("saves from a link for a stranger, from Cookpool's own for anyone, and refuses what the saver may not see", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    expect(await statusOf(w.call("POST", me("recipes/copies"), OLU, { recipeId: curry.id }))).toBe(404);
    const code = (await w.call<RecipeResponse>("POST", me(`recipes/${curry.id}/link`), ANU)).body.data.recipe.linkCode!;
    const viaLink = await w.call<RecipeResponse>("POST", me("recipes/copies"), OLU, { linkCode: code });
    expect(viaLink.status).toBe(201);
    expect(viaLink.body.data.recipe.source).toEqual({ recipeId: curry.id, ownerId: ANU, ownerName: "Anu" });
    const chai = systemRecipe(w, "Masala chai", 4, [["tea", "Tea", 10_000, "g", true]]);
    const fromCookpool = await w.call<RecipeResponse>("POST", me("recipes/copies"), OLU, { recipeId: chai });
    expect(fromCookpool.body.data.recipe.source).toEqual({ recipeId: chai, ownerId: "usr_cookpool", ownerName: "Cookpool" });
    expect(await statusOf(w.call("POST", me("recipes/copies"), OLU, { linkCode: "Zzzzzzzzzz" }))).toBe(404);
    expect(await statusOf(w.call("POST", me("recipes/copies"), OLU, {}))).toBe(422);
    expect(await statusOf(w.call("POST", me("recipes/copies"), OLU, { recipeId: curry.id, linkCode: code }))).toBe(422);
    expect(await statusOf(w.call("POST", me("recipes/copies"), OLU, { linkCode: "short" }))).toBe(422);
  });
});

describe("a person's recipes (RC-4, design §1.4, §5.1)", () => {
  it("shows someone you share a group with their My groups and link recipes — never Only me — and nobody else's", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const poha = await writeRecipe(w, ANU, { ...chickenCurry, name: "Poha" });
    await w.call("POST", me(`recipes/${poha.id}/link`), ANU);
    await writeRecipe(w, ANU, { ...chickenCurry, name: "Secret", visibility: "only_me" });
    const res = await w.call<PersonRecipesResponse>("GET", `/v1/kitchen/people/${ANU}/recipes`, RAHUL);
    expect(res.status).toBe(200);
    expect(res.body.data.subjectId).toBe(ANU);
    expect(res.body.data.displayName).toBe("Anu");
    expect(res.body.data.recipes.map((r) => r.name).sort()).toEqual([curry.name, poha.name].sort());
    expect(await statusOf(w.call("GET", `/v1/kitchen/people/${ANU}/recipes`, OLU))).toBe(404);
    expect(await statusOf(w.call("GET", `/v1/kitchen/people/${RAHUL}/recipes`, RAHUL))).toBe(404);
    expect(await statusOf(w.call("GET", `/v1/kitchen/people/usr_nobody/recipes`, RAHUL))).toBe(404);
    w.h.revoke(RAHUL, w.flat);
    expect(await statusOf(w.call("GET", `/v1/kitchen/people/${ANU}/recipes`, RAHUL))).toBe(404);
  });
});

describe("Explore (RC-4, design §5.3)", () => {
  it("lists Cookpool's own by default, and your groups' shared ones — never your own or Only-me ones — each with its match", async () => {
    systemRecipe(w, "Masala chai", 4, [["tea", "Tea", 10_000, "g", true], ["milk", "Milk", 250_000, "ml", false]], "drink");
    systemRecipe(w, "Poha", 4, [["poha", "Poha", 200_000, "g", true]], "breakfast");
    await writeRecipe(w, ANU, chickenCurry);
    await writeRecipe(w, ANU, { ...chickenCurry, name: "Anu's secret", visibility: "only_me" });
    await writeRecipe(w, RAHUL, { ...chickenCurry, name: "Rahul's own" });
    await writeRecipe(w, OLU, { ...chickenCurry, name: "Olu's" });

    const cookpool = await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes", RAHUL);
    expect(cookpool.status).toBe(200);
    expect(cookpool.body.data.recipes.map((r) => r.name).sort()).toEqual(["Masala chai", "Poha"]);
    expect(cookpool.body.data.recipes.find((r) => r.name === "Masala chai")!.match).toEqual({
      lines: 2, have: 0, short: 0, missing: 2, always: 0, missingNames: ["Tea", "Milk"], maxFactorMilli: null,
    });
    const breakfast = await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes?source=cookpool&kind=breakfast", RAHUL);
    expect(breakfast.body.data.recipes.map((r) => r.name)).toEqual(["Poha"]);

    const groups = await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes?source=groups", RAHUL);
    expect(groups.body.data.recipes.map((r) => [r.name, r.ownerName])).toEqual([["Chicken curry", "Anu"]]);
    const searched = await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes?source=groups&q=CURRY", RAHUL);
    expect(searched.body.data.recipes).toHaveLength(1);
    expect((await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes?source=groups&q=dal", RAHUL)).body.data.recipes).toEqual([]);
    expect((await w.call<ExploreRecipesResponse>("GET", "/v1/kitchen/recipes?source=groups", OLU)).body.data.recipes).toEqual([]);
    expect(await statusOf(w.call("GET", "/v1/kitchen/recipes?source=strangers", RAHUL))).toBe(422);
    expect(await statusOf(w.call("GET", "/v1/kitchen/recipes?kind=brunch", RAHUL))).toBe(422);
  });
});

describe("every RC-4 route (design §7)", () => {
  const id = `rcp_${"1".repeat(32)}`;
  const routes: Array<[string, string]> = [
    ["GET", "/v1/kitchen/foods"],
    ["PUT", "/v1/kitchen/me/food-answers"],
    ["GET", "/v1/kitchen/me/always-have"],
    ["PUT", "/v1/kitchen/me/always-have"],
    ["GET", "/v1/kitchen/me/recipes"],
    ["POST", "/v1/kitchen/me/recipes"],
    ["POST", "/v1/kitchen/me/recipes/copies"],
    ["PATCH", `/v1/kitchen/me/recipes/${id}`],
    ["DELETE", `/v1/kitchen/me/recipes/${id}`],
    ["GET", `/v1/kitchen/me/recipes/${id}/match`],
    ["POST", `/v1/kitchen/me/recipes/${id}/link`],
    ["DELETE", `/v1/kitchen/me/recipes/${id}/link`],
    ["GET", `/v1/kitchen/recipes/${id}`],
    ["GET", "/v1/kitchen/recipes"],
    ["GET", "/v1/kitchen/recipe-links/AbCdEfGhJk"],
    ["GET", `/v1/kitchen/people/${ANU}/recipes`],
    ["GET", "/v1/kitchen/me/cook-now"],
  ];

  it("asks for a signed-in caller on every one, and answers a method it does not take with 405", async () => {
    for (const [method, path] of routes) {
      const res = await w.call(method, path, null, method === "GET" || method === "DELETE" ? undefined : {});
      expect([method, path, res.status]).toEqual([method, path, 401]);
    }
    expect((await w.call("PUT", "/v1/kitchen/recipes", RAHUL, {})).status).toBe(405);
    expect((await w.call("POST", "/v1/kitchen/me/cook-now", RAHUL, {})).status).toBe(405);
    expect((await w.call("GET", "/v1/kitchen/me/recipes/copies", RAHUL)).status).toBe(405);
  });

  it("answers in the usual envelope, and a refusal as the kitchen's opaque 404", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    const ok = await read(curry.id, RAHUL);
    expect(ok.body.meta).toEqual({ requestId: "req_test", cursor: null });
    const refused = await read(curry.id, OLU);
    expect(refused.body.error).toEqual({ code: "not_found", message: "Not found", details: {}, requestId: "req_test" });
  });

  it("writes lines in the engine's own unit sizes", () => {
    for (const [unit, def] of Object.entries(RECIPE_UNITS)) {
      expect([unit, UNITS[unit as keyof typeof UNITS].dimension, UNITS[unit as keyof typeof UNITS].factor]).toEqual([unit, def.dimension, def.factor]);
    }
  });
});
