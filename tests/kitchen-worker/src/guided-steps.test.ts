// Guided steps in the server (Cookpool GC-2, cookpool-guided design §1, §2,
// §5's recording, §7) through the router over real SQLite: a recipe's steps
// carry their key, phase, lines, flame, time or whistles, hands off, rule,
// checkpoint and tip, and the recipe its tools and long prep — on create,
// read, PATCH, copies and saving a dish — every value checked; copies and
// edits keep step keys; the dish write keeps each step's time under the
// recipe root, moving money exactly as without it; and Use today's times is
// the owner's alone.

import type { CookDishResponse, KitchenRecipe, KitchenRecipeStep, RecipeResponse } from "@saas/contracts/kitchen";
import { ANU, DEV, OLU, RAHUL, VIK, addItem, chickenCurry, me, world, writeRecipe, type World } from "./recipes-helpers.js";

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.h.close());

const read = async (id: string, as: string) => (await w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${id}`, as)).body.data.recipe;
const patch = (id: string, as: string, body: unknown) => {
  w.tick();
  return w.call<RecipeResponse>("PATCH", me(`recipes/${id}`), as, body);
};
const copy = async (id: string, as: string) => {
  w.tick();
  const res = await w.call<RecipeResponse>("POST", me("recipes/copies"), as, { recipeId: id });
  if (res.status !== 201) throw new Error(`copy: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.recipe;
};
const stepTimes = (id: string, as: string, body: unknown) => {
  w.tick();
  return w.call<RecipeResponse>("PATCH", me(`recipes/${id}/step-times`), as, body);
};
/** The field names a 422 names. */
const fieldsOf = (res: { status: number; body: { error?: { details?: Record<string, unknown> } } }) => {
  expect(res.status).toBe(422);
  return Object.keys((res.body.error?.details?.fields ?? {}) as object).sort();
};

const HEX32 = /^[0-9a-f]{32}$/;

/** Rajma as a guided recipe: lines 0 rajma, 1 onions, 2 tomatoes, 3 ginger-garlic, 4 salt. */
const rajma = {
  name: "Rajma",
  servesHalf: 8,
  minutes: 60,
  kind: "dal_curry",
  lines: [
    { foodKey: "rajma", name: "Rajma", quantity: "250", unit: "g", isMain: true },
    { foodKey: "onion", name: "Onions, chopped", quantity: 2, unit: "onion" },
    { foodKey: "tomato", name: "Tomatoes", quantity: "300", unit: "g" },
    { foodKey: "ginger_garlic_paste", name: "Ginger-garlic paste", quantity: "1", unit: "tbsp" },
    { foodKey: "salt", name: "Salt", toTaste: true },
  ],
  steps: [
    { text: "Soak the rajma in plenty of water", phase: "prep", lines: [0], minSeconds: 28_800, maxSeconds: 36_000, handsOff: true, tip: "Overnight is fine" },
    { text: "Pressure-cook the rajma with salt", lines: [0, 4], heat: 3, whistles: 6, handsOff: true, sense: "sound", checkpoint: "the sixth whistle" },
    {
      text: "Fry the onions", lines: [1], heat: 2, minSeconds: 480, maxSeconds: 600, timeRule: "partly", sense: "look", checkpoint: "golden brown",
      tip: "Don't crowd the pan",
    },
    { text: "Add the paste and tomatoes", lines: [3, 2], heat: 2, minSeconds: 600, timeRule: "linear", sense: "smell", checkpoint: "the raw smell goes" },
    "Simmer it all together and serve",
  ],
  tools: ["Pressure cooker", "Kadai with a lid"],
};

/** A step as the server reads it, text only, with `patch` on top (its key not compared). */
const textOnly = (position: number, text: string): Omit<KitchenRecipeStep, "key"> => ({
  position, text, phase: "cook", lines: [], heat: null, minSeconds: null, maxSeconds: null, whistles: null, handsOff: false,
  timeRule: "fixed", sense: null, checkpoint: null, tip: null,
});
const withoutKeys = (r: Pick<KitchenRecipe, "guidedSteps">) => r.guidedSteps!.map(({ key: _key, ...s }) => s);

describe("guided steps on a recipe (GC-2, design §1)", () => {
  it("writes and reads every step field, the tools and long prep; keys are the server's, one per step", async () => {
    const written = await writeRecipe(w, ANU, { ...rajma, steps: [{ ...rajma.steps[0] as object, key: "mine-not-yours" }, ...rajma.steps.slice(1)] });
    expect(written.steps).toEqual([
      "Soak the rajma in plenty of water", "Pressure-cook the rajma with salt", "Fry the onions", "Add the paste and tomatoes",
      "Simmer it all together and serve",
    ]);
    expect(withoutKeys(written)).toEqual([
      {
        position: 0, text: "Soak the rajma in plenty of water", phase: "prep", lines: [0], heat: null, minSeconds: 28_800, maxSeconds: 36_000,
        whistles: null, handsOff: true, timeRule: "fixed", sense: null, checkpoint: null, tip: "Overnight is fine",
      },
      {
        position: 1, text: "Pressure-cook the rajma with salt", phase: "cook", lines: [0, 4], heat: 3, minSeconds: null, maxSeconds: null,
        whistles: 6, handsOff: true, timeRule: "fixed", sense: "sound", checkpoint: "the sixth whistle", tip: null,
      },
      {
        position: 2, text: "Fry the onions", phase: "cook", lines: [1], heat: 2, minSeconds: 480, maxSeconds: 600, whistles: null,
        handsOff: false, timeRule: "partly", sense: "look", checkpoint: "golden brown", tip: "Don't crowd the pan",
      },
      // minSeconds alone is one time.
      {
        position: 3, text: "Add the paste and tomatoes", phase: "cook", lines: [3, 2], heat: 2, minSeconds: 600, maxSeconds: 600, whistles: null,
        handsOff: false, timeRule: "linear", sense: "smell", checkpoint: "the raw smell goes", tip: null,
      },
      textOnly(4, "Simmer it all together and serve"),
    ]);
    const keys = written.guidedSteps!.map((s) => s.key);
    for (const key of keys) expect(key).toMatch(HEX32);
    expect(new Set(keys).size).toBe(5);
    expect(keys[0]).not.toBe("mine-not-yours");
    expect(written.tools).toEqual(["Pressure cooker", "Kadai with a lid"]);
    expect(written.longPrep).toEqual([{ position: 0, key: keys[0], seconds: 28_800, text: "Soak the rajma in plenty of water" }]);

    // Everyone who may see it reads the same, keys and all.
    const seen = await read(written.id, RAHUL);
    expect(seen.guidedSteps).toEqual(written.guidedSteps);
    expect([seen.tools, seen.longPrep]).toEqual([written.tools, written.longPrep]);
  });

  it("reads a recipe of plain steps as cook steps of text only, with no tools and no long prep", async () => {
    const curry = await writeRecipe(w, ANU, chickenCurry);
    expect(withoutKeys(curry)).toEqual(chickenCurry.steps.map((text, i) => textOnly(i, text)));
    expect([curry.tools, curry.longPrep]).toEqual([[], []]);
    // Cookpool's own are guided under fixed keys: 590's Kerala recipes (RV-20; kerala-recipes), as 390's were (cookpool-guided).
    const kondattam = (await w.call<{ recipes: Array<{ id: string; name: string }> }>("GET", "/v1/kitchen/recipes?q=kondattam", RAHUL)).body.data.recipes[0]!;
    const seeded = await read(kondattam.id, RAHUL);
    expect(seeded.guidedSteps!.length).toBeGreaterThanOrEqual(3);
    for (const s of seeded.guidedSteps!) expect(s.key).toMatch(/^c00c0590-\d{2}-\d{2}$/);
    expect(seeded.tools!.length).toBeGreaterThan(0);
  });

  it("lists long prep: hands-off prep steps of an hour or more, by their shortest time", async () => {
    const r = await writeRecipe(w, ANU, {
      ...chickenCurry,
      steps: [
        { text: "Marinate the chicken", phase: "prep", handsOff: true, minSeconds: 3_600, maxSeconds: 43_200 },
        { text: "Soak the saffron", phase: "prep", handsOff: true, minSeconds: 1_800, maxSeconds: 7_200 }, // can be half an hour
        { text: "Chop everything", phase: "prep", handsOff: false, minSeconds: 3_600 }, // hands on
        { text: "Simmer", handsOff: true, minSeconds: 5_400 }, // cooking, not prep
        { text: "Rest the dough", phase: "prep", handsOff: true, minSeconds: 7_200 },
      ],
    });
    expect(r.longPrep!.map((p) => [p.position, p.seconds, p.text])).toEqual([
      [0, 3_600, "Marinate the chicken"],
      [4, 7_200, "Rest the dough"],
    ]);
    expect(r.longPrep!.map((p) => p.key)).toEqual([r.guidedSteps![0]!.key, r.guidedSteps![4]!.key]);
  });

  it("refuses every step value out of range, and the rules between them, with the field that is wrong (422)", async () => {
    const create = (step: unknown, extra: Record<string, unknown> = {}) => {
      w.tick();
      return w.call("POST", me("recipes"), ANU, { ...chickenCurry, steps: [step], ...extra });
    };
    const ok = { text: "Stir" };
    for (const [step, field] of [
      [{ ...ok, lines: [5] }, "steps[0].lines"], // Chicken curry has 5 lines
      [{ ...ok, lines: [1, 1] }, "steps[0].lines"],
      [{ ...ok, lines: "1" }, "steps[0].lines"],
      [{ ...ok, lines: [-1] }, "steps[0].lines"],
      [{ ...ok, lines: [1.5] }, "steps[0].lines"],
      [{ ...ok, phase: "serve" }, "steps[0].phase"],
      [{ ...ok, heat: 4 }, "steps[0].heat"],
      [{ ...ok, heat: "high" }, "steps[0].heat"],
      [{ ...ok, minSeconds: -1 }, "steps[0].minSeconds"],
      [{ ...ok, minSeconds: 86_401 }, "steps[0].minSeconds"],
      [{ ...ok, minSeconds: 60.5 }, "steps[0].minSeconds"],
      [{ ...ok, maxSeconds: 600 }, "steps[0].maxSeconds"], // max with no min
      [{ ...ok, minSeconds: 600, maxSeconds: 480 }, "steps[0].maxSeconds"],
      [{ ...ok, minSeconds: 60, maxSeconds: 86_401 }, "steps[0].maxSeconds"],
      [{ ...ok, whistles: 0 }, "steps[0].whistles"],
      [{ ...ok, whistles: 11 }, "steps[0].whistles"],
      [{ ...ok, whistles: 3, minSeconds: 600 }, "steps[0].whistles"], // whistles or time, not both
      [{ ...ok, handsOff: "yes" }, "steps[0].handsOff"],
      [{ ...ok, timeRule: "quadratic" }, "steps[0].timeRule"],
      [{ ...ok, sense: "look" }, "steps[0].sense"], // a sense needs its checkpoint
      [{ ...ok, sense: "hear", checkpoint: "it hisses" }, "steps[0].sense"],
      [{ ...ok, checkpoint: "x".repeat(81) }, "steps[0].checkpoint"],
      [{ ...ok, checkpoint: 5 }, "steps[0].checkpoint"],
      [{ ...ok, tip: "x".repeat(161) }, "steps[0].tip"],
      [{ ...ok, key: 7 }, "steps[0].key"],
      [{ phase: "prep" }, "steps[0].text"],
      [{ text: "x".repeat(201) }, "steps[0].text"],
      [{ text: "   " }, "steps[0].text"],
      [42, "steps[0]"],
      ["x".repeat(201), "steps[0]"],
    ] as Array<[unknown, string]>) {
      expect([step, fieldsOf(await create(step))]).toEqual([step, [field]]);
    }
    // Every limit itself is fine, and an empty checkpoint or tip is none.
    const edge = await create({
      text: "Stir", lines: [0, 4], heat: 0, minSeconds: 0, maxSeconds: 86_400, checkpoint: "x".repeat(80), sense: "taste",
      tip: "  ", timeRule: "fixed", handsOff: false,
    });
    expect(edge.status).toBe(201);
    expect((edge.body.data as RecipeResponse).recipe.guidedSteps![0]).toMatchObject({ heat: 0, minSeconds: 0, maxSeconds: 86_400, tip: null });
    // Null is the default: a cook step, fixed, no flame, no time.
    const nulls = await create({ text: "Count", whistles: 10, checkpoint: "", phase: null, timeRule: null, heat: null, minSeconds: null, sense: null, lines: null });
    expect(nulls.status).toBe(201);
    expect((nulls.body.data as RecipeResponse).recipe.guidedSteps![0]).toMatchObject({
      phase: "cook", timeRule: "fixed", heat: null, minSeconds: null, whistles: 10, checkpoint: null, sense: null, lines: [],
    });

    // Tools: up to 10, 1–40 characters each, each once (in any case).
    for (const [tools, field] of [
      [Array.from({ length: 11 }, (_, i) => `Tool ${i}`), "tools"],
      [["Kadai", "kadai"], "tools"],
      ["Kadai", "tools"],
      [["x".repeat(41)], "tools[0]"],
      [["Kadai", ""], "tools[1]"],
      [[3], "tools[0]"],
    ] as Array<[unknown, string]>) {
      expect([tools, fieldsOf(await create(ok, { tools }))]).toEqual([tools, [field]]);
    }
    const tooled = await create(ok, { tools: ["  Tawa  ", ...Array.from({ length: 9 }, (_, i) => `Pan ${i}`)] });
    expect((tooled.body.data as RecipeResponse).recipe.tools![0]).toBe("Tawa");
    expect((await create(ok, { tools: null })).status).toBe(201);
  });
});

describe("keys that stay (GC-2, design §1, §5)", () => {
  it("a copy keeps every step's key and field and the tools — and so does a copy of a copy", async () => {
    const original = await writeRecipe(w, ANU, rajma);
    const rahuls = await copy(original.id, RAHUL);
    // A copy starts at Only me: Rahul shows his to his groups, and Dev copies that.
    await patch(rahuls.id, RAHUL, { visibility: "groups" });
    const devs = await copy(rahuls.id, DEV);
    for (const c of [rahuls, devs]) {
      expect(c.guidedSteps).toEqual(original.guidedSteps);
      expect([c.tools, c.longPrep]).toEqual([original.tools, original.longPrep]);
    }
    expect(devs.source).toMatchObject({ recipeId: rahuls.id, ownerName: "Rahul" });
    // A copy is its own: its edits leave the source's steps as they were, keys and all.
    await patch(rahuls.id, RAHUL, { steps: ["Just one step"] });
    expect((await read(original.id, ANU)).guidedSteps).toEqual(original.guidedSteps);
  });

  it("a PATCH keeps the key of each step it sends back, and gives a new step — or an unknown or repeated key — a new one", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    const [soak, cook, fry, paste, simmer] = r.guidedSteps!;
    const res = await patch(r.id, ANU, {
      steps: [
        { ...fry, text: "Fry the onions slowly", minSeconds: 600, maxSeconds: 720 },
        { text: "A new step", heat: 1 },
        { ...soak },
        { ...paste, key: "not-a-key-of-this-recipe" },
        { ...cook, text: "Pressure-cook it" },
        { ...simmer, key: cook!.key, text: "Simmer and serve" }, // the same key twice: the first keeps it
      ],
    });
    expect(res.status).toBe(200);
    const steps = res.body.data.recipe.guidedSteps!;
    expect(steps.map((s) => s.text)).toEqual(["Fry the onions slowly", "A new step", "Soak the rajma in plenty of water", "Add the paste and tomatoes", "Pressure-cook it", "Simmer and serve"]);
    expect(steps.map((s) => s.key)).toEqual([fry!.key, expect.stringMatching(HEX32), soak!.key, expect.stringMatching(HEX32), cook!.key, expect.stringMatching(HEX32)]);
    const fresh = [steps[1]!.key, steps[3]!.key, steps[5]!.key];
    for (const key of fresh) expect(r.guidedSteps!.map((s) => s.key)).not.toContain(key);
    expect(new Set(steps.map((s) => s.key)).size).toBe(6);
    // A kept step takes the fields it was sent: its position is where it is now.
    expect(steps[0]).toEqual({ ...fry, position: 0, text: "Fry the onions slowly", minSeconds: 600, maxSeconds: 720 });
    expect(steps[2]).toEqual({ ...soak, position: 2 });
    expect(res.body.data.recipe.longPrep).toEqual([{ position: 2, key: soak!.key, seconds: 28_800, text: soak!.text }]);
  });

  it("steps sent as plain text keep the step with that text — key and guided fields — as RC-5's form writes them", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    // The form sends every text, one changed and one moved, and its lines in full.
    const texts = r.steps.slice();
    texts[4] = "Simmer for 10 minutes and serve";
    const [first, ...rest] = texts;
    const res = await patch(r.id, ANU, { name: "Rajma masala", lines: rajma.lines, steps: [...rest, first] });
    const steps = res.body.data.recipe.guidedSteps!;
    const byText = new Map(r.guidedSteps!.map((s) => [s.text, s]));
    for (const s of steps.slice(0, 3).concat(steps[4]!)) {
      const was = byText.get(s.text)!;
      expect(s).toEqual({ ...was, position: s.position });
    }
    expect(steps[3]).toMatchObject({ text: "Simmer for 10 minutes and serve", phase: "cook", lines: [], heat: null, key: expect.stringMatching(HEX32) });
    expect(steps[3]!.key).not.toBe(r.guidedSteps![4]!.key);
    expect(res.body.data.recipe.tools).toEqual(rajma.tools);
  });

  it("a PATCH of fewer lines keeps the steps and their keys, without the lines that are gone; one of its steps' lines must exist", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    const threeLines = rajma.lines.slice(0, 3);
    const res = await patch(r.id, ANU, { lines: threeLines });
    expect(res.status).toBe(200);
    const steps = res.body.data.recipe.guidedSteps!;
    expect(steps.map((s) => s.key)).toEqual(r.guidedSteps!.map((s) => s.key));
    expect(steps.map((s) => s.lines)).toEqual([[0], [0], [1], [2], []]);
    // Steps sent with the lines are checked against them; sent alone, against the recipe's.
    expect(fieldsOf(await patch(r.id, ANU, { lines: threeLines.slice(0, 2), steps: [{ text: "Stir", lines: [2] }] }))).toEqual(["steps[0].lines"]);
    expect(fieldsOf(await patch(r.id, ANU, { steps: [{ text: "Stir", lines: [3] }] }))).toEqual(["steps[0].lines"]);
    expect((await patch(r.id, ANU, { steps: [{ text: "Stir", lines: [2] }] })).status).toBe(200);
  });

  it("a PATCH of other fields leaves steps and tools be; tools alone are a PATCH, and replace the list", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    const renamed = await patch(r.id, ANU, { name: "Rajma chawal" });
    expect([renamed.body.data.recipe.guidedSteps, renamed.body.data.recipe.tools]).toEqual([r.guidedSteps, r.tools]);
    const tooled = await patch(r.id, ANU, { tools: ["Heavy pan"] });
    expect(tooled.status).toBe(200);
    expect([tooled.body.data.recipe.tools, tooled.body.data.recipe.guidedSteps]).toEqual([["Heavy pan"], r.guidedSteps]);
    expect((await patch(r.id, ANU, { tools: [] })).body.data.recipe.tools).toEqual([]);
    expect(fieldsOf(await patch(r.id, ANU, { tools: ["Kadai", "KADAI"] }))).toEqual(["tools"]);
    expect(fieldsOf(await patch(r.id, ANU, {}))).toEqual(["body"]);
  });

  it("saving a dish as a recipe takes guided steps and tools, its steps' lines pointing at the dish's ingredients", async () => {
    const curry = await writeRecipe(w, RAHUL, chickenCurry);
    const chicken = await addItem(w, RAHUL, null, { name: "Chicken", category: "protein", quantity: "1", unit: "kg", priceMinor: 30000 });
    const onions = await addItem(w, RAHUL, null, { name: "Onions", quantity: "1", unit: "kg", priceMinor: 4000 });
    w.tick();
    const dish = (await w.call<CookDishResponse>("POST", me("dishes"), RAHUL, {
      name: "Chicken curry", portionsHalf: 4, splitMode: "assign", recipeId: curry.id,
      ingredients: [{ itemId: chicken.id, quantity: "500", unit: "g" }, { itemId: onions.id, quantity: "200", unit: "g" }],
    })).body.data.dish;
    const save = (steps: unknown[]) => {
      w.tick();
      return w.call<RecipeResponse>("POST", me("recipes"), RAHUL, { fromDishId: dish.id, steps, tools: ["Kadai"] });
    };
    expect(fieldsOf(await save([{ text: "Brown the onions", lines: [2] }]))).toEqual(["steps[0].lines"]);
    const saved = await save([{ text: "Brown the onions", lines: [1], heat: 2, minSeconds: 480, sense: "look", checkpoint: "golden" }, "Add the chicken"]);
    expect(saved.status).toBe(201);
    expect(saved.body.data.recipe.tools).toEqual(["Kadai"]);
    expect(withoutKeys(saved.body.data.recipe)).toEqual([
      { ...textOnly(0, "Brown the onions"), lines: [1], heat: 2, minSeconds: 480, maxSeconds: 480, sense: "look", checkpoint: "golden" },
      textOnly(1, "Add the chicken"),
    ]);
  });
});

describe("the dish write's step log (GC-2, design §5)", () => {
  const at = (minutes: number, seconds = 0) => new Date(Date.UTC(2026, 10, 8, 12, minutes, seconds)).toISOString();
  type TimeRow = { dish_id: string; step_key: string; recipe_root_id: string; seconds: number; factor_milli: number | null; cook_id: string };
  const times = () =>
    w.h.db.prepare("SELECT dish_id, step_key, recipe_root_id, seconds, factor_milli, cook_id FROM kitchen_dish_step_times ORDER BY rowid").all() as unknown as TimeRow[];
  const uuidOf = (publicId: string) => publicId.replace(/^[a-z]+_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  const cook = (as: string, body: Record<string, unknown>) => {
    w.tick();
    return w.call<CookDishResponse>("POST", me("dishes"), as, { name: "Rajma", portionsHalf: 4, splitMode: "assign", ...body });
  };

  it("keeps one time per step of the recipe — seconds, the dish's factor, the cook — under the recipe its copies came from", async () => {
    const original = await writeRecipe(w, ANU, rajma);
    const rahuls = await copy(original.id, RAHUL);
    await patch(rahuls.id, RAHUL, { visibility: "groups" });
    const devs = await copy(rahuls.id, DEV);
    const [soak, pressure, fry, paste, simmer] = devs.guidedSteps!.map((s) => s.key);
    const beans = await addItem(w, DEV, null, { name: "Rajma", category: "grains", quantity: "1", unit: "kg", priceMinor: 20000 });
    const res = await cook(DEV, {
      recipeId: devs.id,
      recipeFactorMilli: 450,
      ingredients: [{ itemId: beans.id, quantity: "110", unit: "g", recipeLine: 0 }],
      stepLog: [
        { key: soak, startedAt: "2026-11-07T22:00:00.000Z", doneAt: "2026-11-08T07:00:00.000Z" }, // 9 h
        { key: pressure, startedAt: at(0), doneAt: at(18, 20) },
        { key: fry, startedAt: at(1), doneAt: "2026-11-08T12:09:30.600Z" }, // 510.6 s, rounded to the second
        { key: fry, startedAt: at(1), doneAt: at(30) }, // the same step again: the first is kept
        { key: paste, startedAt: at(10), doneAt: at(9) }, // ticked before it started: left out
        { key: simmer, startedAt: "2026-11-07T11:00:00.000Z", doneAt: at(1) }, // more than a day: left out
        { key: "not-a-step-of-this-recipe", startedAt: at(0), doneAt: at(5) },
        { key: original.guidedSteps![0]!.key.replace(/^./, "0"), startedAt: at(0), doneAt: at(5) },
      ],
    });
    expect(res.status).toBe(201);
    const dishId = uuidOf(res.body.data.dish.id);
    const root = uuidOf(original.id);
    expect(times()).toEqual([
      { dish_id: dishId, step_key: soak, recipe_root_id: root, seconds: 32_400, factor_milli: 450, cook_id: DEV },
      { dish_id: dishId, step_key: pressure, recipe_root_id: root, seconds: 1_100, factor_milli: 450, cook_id: DEV },
      { dish_id: dishId, step_key: fry, recipe_root_id: root, seconds: 511, factor_milli: 450, cook_id: DEV },
    ]);
    // The original's own cook pools under the same root and keys.
    const anus = await addItem(w, ANU, null, { name: "Rajma", category: "grains", quantity: "1", unit: "kg", priceMinor: 20000 });
    await cook(ANU, {
      recipeId: original.id, ingredients: [{ itemId: anus.id, quantity: "250", unit: "g", recipeLine: 0 }],
      stepLog: [{ key: fry, startedAt: at(0), doneAt: at(0) }],
    });
    expect(times().filter((t) => t.step_key === fry).map((t) => [t.recipe_root_id, t.cook_id, t.seconds, t.factor_milli])).toEqual([
      [root, DEV, 511, 450],
      [root, ANU, 0, null], // the dish said no factor
    ]);
  });

  it("moves money exactly as without a step log, and writes no time for a log of nothing it knows", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    const keys = r.guidedSteps!.map((s) => s.key);
    // Anu's beans in Flat 4B: Rahul owes her for what he takes.
    const take = async (stepLog?: unknown) => {
      const beans = await addItem(w, ANU, w.flat, { name: "Rajma", category: "grains", quantity: "1", unit: "kg", priceMinor: 20000 });
      const res = await cook(RAHUL, {
        recipeId: r.id, recipeFactorMilli: 1_000, ingredients: [{ itemId: beans.id, quantity: "250", unit: "g", recipeLine: 0 }],
        ...(stepLog !== undefined ? { stepLog } : {}),
      });
      expect(res.status).toBe(201);
      return res.body.data.dish;
    };
    const plain = await take();
    const logged = await take(keys.map((key, i) => ({ key, startedAt: at(i * 10), doneAt: at(i * 10 + 8) })));
    const money = (d: typeof plain) => ({
      ingredientsMinor: d.ingredientsMinor, totalMinor: d.totalMinor, fromMineMinor: d.fromMineMinor,
      owes: d.owes.map((o) => ({ ...o })), costs: d.ingredients.map((i) => [i.costMinor, i.paidBy, i.useTxnId !== null]),
    });
    expect(money(logged)).toEqual(money(plain));
    expect(money(logged).owes).toEqual([expect.objectContaining({ buyerId: ANU, amountMinor: 5_000 })]);
    expect(times()).toHaveLength(5);
    // A log of nothing the recipe has keeps nothing, and still cooks.
    await take([{ key: "nope", startedAt: at(0), doneAt: at(5) }]);
    await take([]);
    await take(null);
    expect(times()).toHaveLength(5);
  });

  it("refuses a step log that is not one (422), or one without the recipe, writing nothing", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    const key = r.guidedSteps![2]!.key;
    const beans = await addItem(w, RAHUL, null, { name: "Rajma", category: "grains", quantity: "1", unit: "kg", priceMinor: 20000 });
    const ingredients = [{ itemId: beans.id, quantity: "100", unit: "g" }];
    const dishes = () => (w.h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_dishes").get() as { n: number }).n;
    const before = dishes();
    for (const [stepLog, extra, field] of [
      [{ key }, { recipeId: r.id }, "stepLog"],
      [Array.from({ length: 21 }, () => ({ key, startedAt: at(0), doneAt: at(1) })), { recipeId: r.id }, "stepLog"],
      [["fry"], { recipeId: r.id }, "stepLog[0]"],
      [[{ key: 5, startedAt: at(0), doneAt: at(1) }], { recipeId: r.id }, "stepLog[0].key"],
      [[{ key, startedAt: "yesterday", doneAt: at(1) }], { recipeId: r.id }, "stepLog[0].startedAt"],
      [[{ key, startedAt: at(0) }], { recipeId: r.id }, "stepLog[0].doneAt"],
      [[{ key, startedAt: at(0), doneAt: at(1) }], {}, "stepLog"],
    ] as Array<[unknown, Record<string, unknown>, string]>) {
      expect([stepLog, fieldsOf(await cook(RAHUL, { ingredients, stepLog, ...extra }))]).toEqual([stepLog, [field]]);
    }
    expect(dishes()).toBe(before);
    expect(times()).toEqual([]);
  });
});

describe("PATCH /v1/kitchen/me/recipes/{rcp}/step-times — Use today's times (GC-2, design §3.6)", () => {
  it("sets those steps' ranges on the owner's recipe, by key, and nothing else", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    const [soak, pressure, fry, paste, simmer] = r.guidedSteps!;
    const res = await stepTimes(r.id, ANU, {
      steps: [
        { key: fry!.key, minSeconds: 420, maxSeconds: 540 },
        { key: simmer!.key, minSeconds: 300, maxSeconds: 300 },
      ],
    });
    expect(res.status).toBe(200);
    const after = res.body.data.recipe;
    expect(after.guidedSteps).toEqual([soak, pressure, { ...fry, minSeconds: 420, maxSeconds: 540 }, paste, { ...simmer, minSeconds: 300, maxSeconds: 300 }]);
    expect(after.updatedAt > r.updatedAt).toBe(true);
    expect(res.body.data).toHaveProperty("lastCook", null);
    expect((await read(r.id, ANU)).guidedSteps).toEqual(after.guidedSteps);
    // A copy of it keeps its own times.
    const rahuls = await copy(r.id, RAHUL);
    await stepTimes(r.id, ANU, { steps: [{ key: fry!.key, minSeconds: 60, maxSeconds: 60 }] });
    expect((await read(rahuls.id, RAHUL)).guidedSteps![2]).toMatchObject({ key: fry!.key, minSeconds: 420, maxSeconds: 540 });
    // …and its owner sets their own.
    expect((await stepTimes(rahuls.id, RAHUL, { steps: [{ key: fry!.key, minSeconds: 900, maxSeconds: 960 }] })).status).toBe(200);
    expect((await read(r.id, ANU)).guidedSteps![2]).toMatchObject({ minSeconds: 60, maxSeconds: 60 });
  });

  it("is its owner's alone: anyone else — one who can see it too — and Cookpool's own read as the opaque 404", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    const body = { steps: [{ key: r.guidedSteps![2]!.key, minSeconds: 60, maxSeconds: 120 }] };
    for (const who of [RAHUL, DEV, VIK, OLU]) expect([who, (await stepTimes(r.id, who, body)).status]).toEqual([who, 404]);
    expect((await read(r.id, ANU)).guidedSteps![2]).toMatchObject({ minSeconds: 480, maxSeconds: 600 });
    const kondattam = (await w.call<{ recipes: Array<{ id: string }> }>("GET", "/v1/kitchen/recipes?q=kondattam", RAHUL)).body.data.recipes[0]!;
    const seeded = await read(kondattam.id, RAHUL);
    expect((await stepTimes(kondattam.id, RAHUL, { steps: [{ key: seeded.guidedSteps![0]!.key, minSeconds: 60, maxSeconds: 60 }] })).status).toBe(404);
    expect((await stepTimes(`rcp_${"0".repeat(32)}`, ANU, body)).status).toBe(404);
    expect((await stepTimes("nonsense", ANU, body)).status).toBe(404);
    await w.call("DELETE", me(`recipes/${r.id}`), ANU);
    expect((await stepTimes(r.id, ANU, body)).status).toBe(404);
  });

  it("refuses a body that is not one, a key the recipe does not have, a whistle step and a range out of order (422)", async () => {
    const r = await writeRecipe(w, ANU, rajma);
    const [, pressure, fry] = r.guidedSteps!;
    const one = (step: unknown) => ({ steps: [step] });
    for (const [body, fields] of [
      [{}, ["steps"]],
      [{ steps: [] }, ["steps"]],
      [{ steps: Array.from({ length: 21 }, () => ({ key: fry!.key, minSeconds: 60, maxSeconds: 60 })) }, ["steps"]],
      [one("fry"), ["steps[0]"]],
      [one({ minSeconds: 60, maxSeconds: 60 }), ["steps[0].key"]],
      [one({ key: fry!.key, maxSeconds: 60 }), ["steps[0].minSeconds"]],
      [one({ key: fry!.key, minSeconds: 60, maxSeconds: null }), ["steps[0].maxSeconds"]],
      [one({ key: fry!.key, minSeconds: 600, maxSeconds: 480 }), ["steps[0].maxSeconds"]],
      [one({ key: fry!.key, minSeconds: -1, maxSeconds: 60 }), ["steps[0].minSeconds"]],
      [one({ key: fry!.key, minSeconds: 60, maxSeconds: 86_401 }), ["steps[0].maxSeconds"]],
      [{ steps: [{ key: fry!.key, minSeconds: 60, maxSeconds: 60 }, { key: fry!.key, minSeconds: 60, maxSeconds: 60 }] }, ["steps[1].key"]],
      [one({ key: "not-a-step", minSeconds: 60, maxSeconds: 60 }), ["steps[0].key"]],
      [one({ key: pressure!.key, minSeconds: 600, maxSeconds: 900 }), ["steps[0].key"]], // it counts whistles
    ] as Array<[unknown, string[]]>) {
      expect([body, fieldsOf(await stepTimes(r.id, ANU, body))]).toEqual([body, fields]);
    }
    expect((await read(r.id, ANU)).guidedSteps).toEqual(r.guidedSteps);
    expect((await stepTimes(r.id, ANU, one({ key: fry!.key, minSeconds: 0, maxSeconds: 86_400 }))).status).toBe(200);
  });

  it("asks for a signed-in caller, and answers a method it does not take with 405", async () => {
    const id = `rcp_${"1".repeat(32)}`;
    expect((await w.call("PATCH", me(`recipes/${id}/step-times`), null, {})).status).toBe(401);
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      expect([method, (await w.call(method, me(`recipes/${id}/step-times`), ANU, method === "GET" || method === "DELETE" ? undefined : {})).status]).toEqual([method, 405]);
    }
  });
});
