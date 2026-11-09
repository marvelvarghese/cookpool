// Recipe from a photo (cookpool-ai AI-4, design §4): the model's read →
// the draft in the create route's shape (RC-4 lines, GC-2 guided steps),
// the lines matched to the food list, the checks, the safe fixes, and a read
// that fails its check — mended with escalation off, retried once on Sonnet
// with it on. The request, the photo, limits and storage are
// ./ai-recipe-photo.test.ts.

import type { AiRecipeCheck, RecipeResponse } from "@saas/contracts/kitchen";
import { RAHUL, aiWorld, answer, me } from "./ai-helpers.js";
import { jpeg } from "./ai-receipt-helpers.js";
import { DAL_TADKA, ln, postPhoto, readPhotoAs, readRecipe, st } from "./ai-recipe-photo-helpers.js";

const paths = (checks: AiRecipeCheck[]) => checks.map((c) => c.path);

describe("recipe from a photo: the draft (AI-4)", () => {
  it("lays a card out in the create route's shape: serves × 2, notes in the name, units folded, food keys, the main line", async () => {
    const w = aiWorld();
    const { draft, checks } = await readPhotoAs(w, DAL_TADKA);
    expect(checks).toEqual([]);
    expect(draft).toEqual({
      name: "Dal tadka",
      servesHalf: 8,
      minutes: 40,
      kind: "dal_curry",
      lines: [
        { foodKey: "toor_dal", name: "Toor dal, washed", quantity: 1, unit: "cup", toTaste: false, isMain: false },
        { foodKey: "onion", name: "Onions, finely chopped", quantity: 2, unit: "pcs", toTaste: false, isMain: false },
        // A count word stays a count word, as the create route takes it.
        { foodKey: "garlic", name: "Garlic", quantity: 4, unit: "cloves", toTaste: false, isMain: false },
        { foodKey: "ghee", name: "Ghee", quantity: 2, unit: "tbsp", toTaste: false, isMain: false },
        { foodKey: "turmeric", name: "Turmeric", quantity: 0.5, unit: "tsp", toTaste: false, isMain: false },
        { foodKey: "salt", name: "Salt", quantity: null, unit: null, toTaste: true, isMain: false },
        // No line by weight: the first with an amount is main — here none is by weight, so the dal.
        { foodKey: "water", name: "Water", quantity: 750, unit: "ml", toTaste: false, isMain: false },
      ].map((l, i) => ({ ...l, isMain: i === 0 })),
      steps: [
        {
          text: "Soak the dal for 30 minutes.", phase: "prep", lines: [0], heat: null, minSeconds: 1800, maxSeconds: 1800,
          whistles: null, handsOff: true, timeRule: "fixed", sense: null, checkpoint: null, tip: null,
        },
        {
          text: "Pressure cook the dal with turmeric, salt and water for 3 whistles.", phase: "cook", lines: [0, 4, 5, 6], heat: 3,
          minSeconds: null, maxSeconds: null, whistles: 3, handsOff: true, timeRule: "fixed", sense: null, checkpoint: null, tip: null,
        },
        {
          text: "Heat ghee, fry the garlic and onions until golden brown.", phase: "cook", lines: [3, 2, 1], heat: 2, minSeconds: 480,
          maxSeconds: 600, whistles: null, handsOff: false, timeRule: "partly", sense: "look", checkpoint: "golden brown",
          tip: "Don't let the garlic burn.",
        },
        {
          text: "Pour the tadka over the dal and serve.", phase: "cook", lines: [], heat: null, minSeconds: null, maxSeconds: null,
          whistles: null, handsOff: false, timeRule: "fixed", sense: null, checkpoint: null, tip: null,
        },
      ],
      tools: ["Pressure cooker", "Kadai"],
    });
    w.close();
  });

  it("the main line is the first by weight when there is one", async () => {
    const w = aiWorld();
    const { draft } = await readPhotoAs(w, { lines: [ln("Milk", 1, "L"), ln("Paneer", 200, "gms"), ln("Sugar", 50, "g")] });
    expect(draft.lines.map((l) => [l.unit, l.isMain])).toEqual([["L", false], ["g", true], ["g", false]]);
    w.close();
  });

  it("is a body the create route saves as it is: the console's Save is POST /me/recipes", async () => {
    const w = aiWorld();
    const { draft } = await readPhotoAs(w, DAL_TADKA);
    const saved = await w.call<RecipeResponse>("POST", me("recipes"), RAHUL, draft);
    expect(saved.status).toBe(201);
    const recipe = saved.body.data.recipe;
    expect(recipe.lines.map((l) => [l.foodKey, l.name, l.quantity, l.unit])).toEqual(draft.lines.map((l) => [l.foodKey, l.name, l.quantity, l.unit]));
    expect(recipe.guidedSteps?.map((s) => [s.text, s.lines, s.heat, s.minSeconds, s.whistles, s.checkpoint])).toEqual(
      draft.steps.map((s) => [s.text, s.lines, s.heat, s.minSeconds, s.whistles, s.checkpoint]),
    );
    expect(recipe.tools).toEqual(["Pressure cooker", "Kadai"]);
    w.close();
  });

  it("matches foods locally by the ingredient, not its note; one it doesn't know has no food key", async () => {
    const w = aiWorld();
    const { draft } = await readPhotoAs(w, {
      lines: [ln("Pyaz", 1, "pcs", { note: "sliced" }), ln("Dragonfruit glaze", 2, "tbsp"), ln("Tomatoes", 3, "pcs")],
    });
    expect(draft.lines.map((l) => [l.name, l.foodKey])).toEqual([
      ["Pyaz, sliced", "onion"],
      ["Dragonfruit glaze", null],
      ["Tomatoes", "tomato"],
    ]);
    // One model call; the foods were one read, no second model call.
    expect(w.ai.sent).toHaveLength(1);
    w.close();
  });
});

describe("recipe from a photo: checks (AI-4)", () => {
  it("marks what the model had to guess, and what the page leaves out, without failing the read", async () => {
    const w = aiWorld();
    const { draft, checks } = await readPhotoAs(w, {
      name: null,
      serves: null,
      lines: [ln("Rice", 1, "cup", { amountUnclear: true }), ln("Cumin", null, null)],
      steps: [
        st("Fry the cumin.", { heat: 2, unclear: ["flame"], checkpoint: "it splutters", sense: "sound" }),
        st("Add rce and simmer.", { heat: 1, minSeconds: 600, unclear: ["text", "time"] }),
        // On the flame, no time, nothing to watch for: the server marks it.
        st("Add the water and cook.", { heat: 2 }),
        // Off the flame, untimed: fine.
        st("Fluff with a fork.", { heat: 0 }),
      ],
    });
    expect(draft.name).toBe("");
    expect(draft.servesHalf).toBe(4);
    expect(draft.lines[1]).toMatchObject({ name: "Cumin", quantity: null, unit: null, toTaste: false });
    expect(checks).toEqual([
      { path: "name", message: "No name on the page: name it" },
      { path: "servesHalf", message: "Serves isn't on the page: check it" },
      { path: "lines[0].quantity", message: "Check the amount against the photo" },
      { path: "lines[1].quantity", message: "No amount on the page: add one, or say to taste" },
      { path: "steps[0].heat", message: "The flame isn't on the page: check it" },
      { path: "steps[1].text", message: "Check the words against the photo" },
      { path: "steps[1].minSeconds", message: "Check the time against the photo" },
      { path: "steps[2].minSeconds", message: "No time for this step: add one, or what to watch for" },
    ]);
    expect(w.ai.sent).toHaveLength(1);
    w.close();
  });

  it("makes the safe fixes itself, each with a check, and the read still passes", async () => {
    const w = aiWorld({ escalate: true });
    const long = `Stir ${"gently and keep stirring ".repeat(10)}until done.`;
    const { draft, checks } = await readPhotoAs(w, {
      serves: 900,
      minutes: 5000,
      lines: [ln("Rice", 1, "Cups"), ln("Water", 2, "cups")],
      steps: [
        // A ref past the lines, and one named twice: dropped.
        st("Wash the rice.", { phase: "prep", lines: [0, 7, 0] }),
        // A max alone is one time; a range given backwards is turned round.
        st("Boil the water.", { heat: 3, maxSeconds: 300 }),
        st("Simmer the rice.", { heat: 1, minSeconds: 900, maxSeconds: 600 }),
        // A sense with no checkpoint is dropped; a long text is shortened.
        st(long, { sense: "look" }),
      ],
    });
    expect(w.ai.sent).toHaveLength(1);
    expect(draft).toMatchObject({ servesHalf: 4, minutes: null });
    expect(draft.lines.map((l) => l.unit)).toEqual(["cup", "cup"]);
    expect(draft.steps[0]!.lines).toEqual([0]);
    expect(draft.steps[1]).toMatchObject({ minSeconds: 300, maxSeconds: 300 });
    expect(draft.steps[2]).toMatchObject({ minSeconds: 600, maxSeconds: 900 });
    expect(draft.steps[3]!.sense).toBeNull();
    expect(draft.steps[3]!.text.length).toBeLessThanOrEqual(200);
    expect(long.startsWith(draft.steps[3]!.text)).toBe(true);
    expect(paths(checks)).toEqual(["servesHalf", "minutes", "steps[0].lines", "steps[2].minSeconds", "steps[3].text"]);
    w.close();
  });

  it("keeps the first 30 lines and 20 steps, saying so", async () => {
    const w = aiWorld();
    const { draft, checks } = await readPhotoAs(w, {
      lines: Array.from({ length: 34 }, (_, i) => ln(`Spice ${i}`, 1, "tsp")),
      steps: Array.from({ length: 23 }, (_, i) => st(`Step ${i}.`, { lines: [i + 10] })),
    });
    expect(draft.lines).toHaveLength(30);
    expect(draft.steps).toHaveLength(20);
    // Step 19 named line 29 (kept); step 20 on were dropped.
    expect(draft.steps[19]!.lines).toEqual([29]);
    expect(checks).toEqual(
      expect.arrayContaining([
        { path: "lines", message: "Only the first 30 lines were kept" },
        { path: "steps", message: "Only the first 20 steps were kept" },
      ]),
    );
    w.close();
  });
});

describe("recipe from a photo: a read that fails its check (AI-4)", () => {
  /** Haiku's read with every kind of problem: a nameless line, an amount that doesn't parse, a textless step, times, flame, whistles. */
  const BROKEN = {
    lines: [ln("Rice", 1, "cup"), ln("  ", 1, "tsp"), ln("Ghee", 0, "tbsp"), ln("Salt", 1, "1/2 tsp"), ln("Water", 2, "cup")],
    steps: [
      st("Soak the rice.", { phase: "prep" as const, lines: [0], minSeconds: 200_000 }),
      st("   "),
      st("Fry in ghee.", { lines: [2, 1], heat: 5 }),
      st("Cook with water.", { lines: [4], whistles: 2, minSeconds: 600 }),
      st("Rest it.", { whistles: 40 }),
    ],
  };

  it("escalation off: one Haiku call, and the mended draft with a check on every mend", async () => {
    const w = aiWorld();
    const { draft, checks } = await readPhotoAs(w, BROKEN);
    expect(w.ai.sent.map((s) => s.model)).toEqual(["claude-haiku-5-5"]);
    // The nameless line is dropped; refs to the lines after it move up.
    expect(draft.lines.map((l) => [l.name, l.quantity, l.unit])).toEqual([
      ["Rice", 1, "cup"],
      ["Ghee", null, null],
      ["Salt", null, null],
      ["Water", 2, "cup"],
    ]);
    expect(draft.steps.map((s) => s.text)).toEqual(["Soak the rice.", "Fry in ghee.", "Cook with water.", "Rest it."]);
    expect(draft.steps[0]).toMatchObject({ minSeconds: null, maxSeconds: null });
    expect(draft.steps[1]).toMatchObject({ lines: [1], heat: null });
    expect(draft.steps[2]).toMatchObject({ lines: [3], whistles: 2, minSeconds: null });
    expect(draft.steps[3]).toMatchObject({ whistles: null });
    expect(checks).toEqual([
      { path: "lines", message: "A line couldn't be read: check the list against the photo" },
      { path: "lines[1].quantity", message: "Couldn't read the amount: add it" },
      { path: "lines[2].quantity", message: "Couldn't read the amount: add it" },
      { path: "steps[0].minSeconds", message: "Couldn't read the time: set it" },
      { path: "steps", message: "A step couldn't be read: check the steps against the photo" },
      { path: "steps[1].lines", message: "A line it named isn't in the list: check its lines" },
      { path: "steps[1].heat", message: "Couldn't read the flame: set it" },
      { path: "steps[2].whistles", message: "Both whistles and a time: check which" },
      { path: "steps[3].whistles", message: "Couldn't read the whistles: set them" },
    ]);
    expect(w.usageRows()).toEqual([expect.objectContaining({ feature: "recipe_import", model: "claude-haiku-5-5", ok: 1 })]);
    w.close();
  });

  it("escalation off: nothing usable (no line, no step) is 502 ai_failed, counted", async () => {
    const w = aiWorld();
    w.ai.script.push(readRecipe({ name: null, lines: [ln("", 1, "cup")], steps: [st("")] }));
    const res = await postPhoto(w, jpeg());
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: "ai_failed" } });
    expect(w.ai.sent).toHaveLength(1);
    expect(w.usageRows()).toEqual([expect.objectContaining({ feature: "recipe_import", ok: 0 })]);
    w.close();
  });

  it("a photo that isn't a recipe (empty lines and steps) is 502 ai_failed", async () => {
    const w = aiWorld();
    w.ai.script.push(readRecipe({ name: null }));
    expect((await postPhoto(w, jpeg())).status).toBe(502);
    w.close();
  });

  it("escalation on: the same request goes once to Sonnet, and Sonnet's clean draft is returned", async () => {
    const w = aiWorld({ escalate: true });
    w.ai.script.push(readRecipe(BROKEN), readRecipe(DAL_TADKA, { model: "claude-sonnet-5-5" }));
    const res = await postPhoto(w, jpeg());
    expect(res.status).toBe(200);
    expect(res.body.data.draft.name).toBe("Dal tadka");
    expect(res.body.data.checks).toEqual([]);
    const [haiku, sonnet] = w.ai.sent;
    expect([haiku!.model, sonnet!.model]).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    // The same request but the model and Haiku's `thinking`.
    const rest = (p: object) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== "model" && k !== "thinking"));
    expect(rest(sonnet!)).toEqual(rest(haiku!));
    expect(sonnet!.thinking).toBeUndefined();
    expect(w.usageRows()).toEqual([expect.objectContaining({ feature: "recipe_import", model: "claude-sonnet-5-5", ok: 1 })]);
    w.close();
  });

  it("escalation on: both fail → 502 ai_failed, never the mended draft; one row, ok 0", async () => {
    const w = aiWorld({ escalate: true });
    w.ai.script.push(readRecipe(BROKEN), readRecipe(BROKEN));
    const res = await postPhoto(w, jpeg());
    expect(res.status).toBe(502);
    expect(w.ai.sent).toHaveLength(2);
    expect(w.usageRows()).toEqual([expect.objectContaining({ feature: "recipe_import", model: "claude-sonnet-5-5", ok: 0 })]);
    w.close();
  });

  it("not JSON, cut short or refused is 502 with no retry (escalation off)", async () => {
    const w = aiWorld();
    w.ai.script.push(answer("{ not json"), answer({ name: "x" }, { stop: "max_tokens" }), answer("", { stop: "refusal" }));
    for (let i = 0; i < 3; i++) expect((await postPhoto(w, jpeg())).status).toBe(502);
    expect(w.ai.sent).toHaveLength(3);
    expect(w.usageRows().map((r) => r.ok)).toEqual([0, 0, 0]);
    w.close();
  });
});
