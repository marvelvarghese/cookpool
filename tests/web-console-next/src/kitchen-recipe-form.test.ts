import type { FoodMatch } from "@saas/contracts/kitchen";
import { MAX_RECIPE_STEPS } from "@saas/contracts/kitchen";
import {
  DEFAULT_SERVES_HALF,
  addLine,
  addStep,
  chooseMain,
  countWordFor,
  defaultMainKey,
  errorsFromDetails,
  foodSuggestionViews,
  formFromRecipe,
  initialRecipeForm,
  lineLinkText,
  mainKeyOf,
  moveLine,
  parseQuantity,
  pickFood,
  recipeRequest,
  removeLine,
  setLine,
  setStep,
  stepServes,
  typeLineName,
  unitOptions,
  type RecipeForm,
} from "@web-console-next/components/kitchen/recipe-form";
import { recipe } from "./kitchen-recipe-fixtures";

// cookpool-recipes RC-5 (design §3.1, §3.5): writing and editing a recipe —
// exactly one main line (the first with a weight unless you choose; never a
// to-taste one), and the server's 422 on the line it names.

function keys() {
  let n = 0;
  return () => `k${(n += 1)}`;
}

const food = (key: string, name: string, dimension: FoodMatch["dimension"], matchedName = name): FoodMatch => ({
  key,
  name,
  dimension,
  eachG: dimension === "count" ? 150 : null,
  category: "veg",
  matchedName,
});

/** A form with these lines (name, quantity, unit, toTaste). */
function formWith(lines: [string, string, string, boolean?][], patch: Partial<RecipeForm> = {}): RecipeForm {
  const k = keys();
  const base = initialRecipeForm(k);
  return {
    ...base,
    name: "Chicken curry",
    lines: lines.map(([name, quantity, unit, toTaste]) => ({ key: k(), foodKey: null, foodName: null, countWord: null, name, quantity, unit, toTaste: !!toTaste })),
    ...patch,
  };
}

const sent = (f: RecipeForm) => recipeRequest(f).body;

describe("a new recipe", () => {
  it("starts serving 4, with one blank line and no steps", () => {
    const f = initialRecipeForm(keys());
    expect(f.servesHalf).toBe(DEFAULT_SERVES_HALF);
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toMatchObject({ name: "", quantity: "", unit: "g", toTaste: false, foodKey: null });
    expect(f.steps).toEqual([]);
  });

  it("asks for a name and an ingredient before it sends anything", () => {
    const r = recipeRequest(initialRecipeForm(keys()));
    expect(r.body).toBeNull();
    expect(r.errors.name).toBe("Name it");
    expect(r.errors.lines).toBe("Add an ingredient");
  });

  it("sends name, serves in halves, minutes, lines in order and steps", () => {
    const f = formWith(
      [
        ["Onions", "3", "onion"],
        ["Chicken", "1", "kg"],
        ["Salt", "", "g", true],
        ["", "", "g"],
      ],
      { servesHalf: 5, minutes: "45", steps: ["  Brown the onions. ", "", "Add the chicken."] },
    );
    expect(sent(f)).toEqual({
      name: "Chicken curry",
      servesHalf: 5,
      minutes: 45,
      lines: [
        { foodKey: null, name: "Onions", quantity: "3", unit: "onion", toTaste: false, isMain: false },
        { foodKey: null, name: "Chicken", quantity: "1", unit: "kg", toTaste: false, isMain: true },
        { foodKey: null, name: "Salt", toTaste: true, isMain: false },
      ],
      steps: ["Brown the onions.", "Add the chicken."],
    });
  });

  it("takes amounts as decimals above zero, a comma for a point", () => {
    expect(parseQuantity("450")).toBe("450");
    expect(parseQuantity("1,5")).toBe("1.5");
    expect(parseQuantity(".5")).toBe("0.5");
    for (const bad of ["0", "", "abc", "1.2345", "-1", "1/2"]) expect(parseQuantity(bad)).toBeNull();
  });

  it("sends no minutes when they are left empty", () => {
    expect(sent(formWith([["Rice", "200", "g"]]))?.minutes).toBeNull();
  });
});

describe("the main line: exactly one, never to taste", () => {
  it("is the first line with a weight by default", () => {
    const f = formWith([
      ["Onions", "3", "onion"],
      ["Oil", "2", "tbsp"],
      ["Chicken", "1", "kg"],
      ["Yogurt", "200", "g"],
    ]);
    expect(mainKeyOf(f)).toBe(f.lines[2]!.key);
    expect(sent(f)!.lines.filter((l) => l.isMain).map((l) => l.name)).toEqual(["Chicken"]);
  });

  it("is the first with an amount when nothing has a weight, and none when nothing has an amount", () => {
    expect(defaultMainKey(formWith([["Salt", "", "g", true], ["Eggs", "4", "pcs"]]).lines)).toBe(formWith([["Salt", "", "g", true], ["Eggs", "4", "pcs"]]).lines[1]!.key);
    const none = formWith([["Salt", "", "g", true]]);
    expect(mainKeyOf(none)).toBeNull();
    expect(recipeRequest(none).errors.lines).toBe("One ingredient needs an amount: it scales the rest");
  });

  it("is the one you choose, by its radio", () => {
    const f = formWith([
      ["Chicken", "1", "kg"],
      ["Onions", "3", "onion"],
    ]);
    const chosen = chooseMain(f, f.lines[1]!.key);
    expect(sent(chosen)!.lines.map((l) => [l.name, l.isMain])).toEqual([
      ["Chicken", false],
      ["Onions", true],
    ]);
  });

  it("can't be a to-taste line: choosing one does nothing, and turning the main to taste hands it to the default", () => {
    const f = formWith([
      ["Chicken", "1", "kg"],
      ["Salt", "", "g", true],
      ["Onions", "3", "onion"],
    ]);
    expect(chooseMain(f, f.lines[1]!.key)).toBe(f);
    const onions = chooseMain(f, f.lines[2]!.key);
    const tasted = setLine(onions, f.lines[2]!.key, { toTaste: true });
    expect(tasted.mainKey).toBeNull();
    expect(mainKeyOf(tasted)).toBe(f.lines[0]!.key);
  });

  it("goes back to the default when the main line is taken out", () => {
    const f = chooseMain(formWith([["Chicken", "1", "kg"], ["Onions", "3", "onion"]]), "k3");
    const k = keys();
    const out = removeLine(f, "k3", k);
    expect(out.mainKey).toBeNull();
    expect(mainKeyOf(out)).toBe("k2");
  });

  it("is never more than one in what is sent, whatever is edited", () => {
    let f = formWith([
      ["Chicken", "1", "kg"],
      ["Rice", "500", "g"],
      ["Salt", "", "g", true],
    ]);
    const k = keys();
    for (const step of [
      (x: RecipeForm) => chooseMain(x, x.lines[1]!.key),
      (x: RecipeForm) => moveLine(x, x.lines[1]!.key, -1),
      (x: RecipeForm) => setLine(x, x.lines[0]!.key, { toTaste: true }),
      (x: RecipeForm) => addLine(x, k()),
      (x: RecipeForm) => removeLine(x, x.lines[1]!.key, k),
    ]) {
      f = step(f);
      const body = recipeRequest(f).body;
      if (body) expect(body.lines.filter((l) => l.isMain)).toHaveLength(1);
      if (body) expect(body.lines.some((l) => l.isMain && l.toTaste)).toBe(false);
    }
  });
});

describe("what is wrong, before sending", () => {
  it("names the line without words, and the amount that isn't one", () => {
    const f = formWith([
      ["", "200", "g"],
      ["Onions", "0", "onion"],
      ["Tomatoes", "", "tomato"],
    ]);
    const r = recipeRequest(f);
    expect(r.body).toBeNull();
    expect(r.errors.line[f.lines[0]!.key]).toEqual({ name: "Name it" });
    expect(r.errors.line[f.lines[1]!.key]).toEqual({ quantity: "An amount above 0" });
    expect(r.errors.line[f.lines[2]!.key]).toEqual({ quantity: "How much? Or To taste" });
  });

  it("checks minutes and the length of a step", () => {
    const f = formWith([["Rice", "200", "g"]], { minutes: "two", steps: ["x".repeat(201)] });
    const r = recipeRequest(f);
    expect(r.errors.minutes).toBe("Minutes, 1 to 1440");
    expect(r.errors.step[0]).toBe("Keep it to 200 characters");
  });
});

describe("the server's 422, on the form", () => {
  const f = formWith([
    ["Chicken", "1", "kg"],
    ["", "", "g"],
    ["Onions", "3", "onion"],
  ], { steps: ["", "Simmer."] });
  const request = recipeRequest(f);

  it("lands each field error on the line or step it names, blanks left out counted", () => {
    expect(request.lineKeys).toEqual([f.lines[0]!.key, f.lines[2]!.key]);
    expect(request.stepIndexes).toEqual([1]);
    const errors = errorsFromDetails(
      { fields: { "lines[1].unit": ["Must be one of g, kg…"], "lines[1].foodKey": ["Not on the food list"], "steps[0]": ["Too long"], name: ["Required"] } },
      request,
      "Validation failed",
    );
    expect(errors.line[f.lines[2]!.key]).toEqual({ unit: "Must be one of g, kg…", name: "Not on the food list" });
    expect(errors.step[1]).toBe("Too long");
    expect(errors.name).toBe("Required");
  });

  it("puts the rest in one line under the form", () => {
    expect(errorsFromDetails({ fields: { visibility: ["Nope"] } }, request, "Validation failed").other).toBe("Nope");
    expect(errorsFromDetails(undefined, request, "Validation failed").other).toBe("Validation failed");
    expect(errorsFromDetails({ fields: { "lines[9].name": ["Gone"] } }, request, "x").lines).toBe("Gone");
  });
});

describe("a line's food", () => {
  it("is picked from the food list: its name, its key, a unit that measures it", () => {
    const f = formWith([["oni", "", "g"]]);
    const k = f.lines[0]!.key;
    const onion = pickFood(f, k, food("onion", "Onion", "count", "pyaz")).lines[0]!;
    expect(onion).toMatchObject({ name: "Onion", foodKey: "onion", foodName: "Onion", countWord: "onion", unit: "onion" });
    expect(unitOptions(onion)).toEqual(["g", "kg", "ml", "L", "pcs", "tsp", "tbsp", "cup", "onion"]);
    expect(pickFood(f, k, food("milk", "Milk", "volume")).lines[0]!.unit).toBe("ml");
    expect(pickFood(f, k, food("rice", "Rice", "mass")).lines[0]!.unit).toBe("g");
    // An amount already in a unit that measures it keeps its unit.
    const kg = formWith([["chick", "1", "kg"]]);
    expect(pickFood(kg, kg.lines[0]!.key, food("chicken", "Chicken", "mass")).lines[0]!.unit).toBe("kg");
  });

  it("stays linked while the words still name it, and unlinks when they don't", () => {
    const f = formWith([["oni", "", "g"]]);
    const k = f.lines[0]!.key;
    const linked = pickFood(f, k, food("onion", "Onion", "count"));
    expect(typeLineName(linked, k, "Onions, sliced").lines[0]!.foodKey).toBe("onion");
    expect(typeLineName(linked, k, "Garlic").lines[0]).toMatchObject({ foodKey: null, foodName: null, countWord: null, name: "Garlic" });
  });

  it("offers a food's name as a word for one piece only when it is one plain word", () => {
    expect(countWordFor(food("egg", "Egg", "count"))).toBe("egg");
    expect(countWordFor(food("green_chilli", "Green chilli", "count"))).toBeNull();
    expect(countWordFor(food("rice", "Rice", "mass"))).toBeNull();
  });

  it("shows under the field what it is linked to", () => {
    expect(lineLinkText({ name: "Onion", foodKey: "onion", foodName: "Onion" })).toEqual({ text: "✓ On the food list", linked: true });
    expect(lineLinkText({ name: "Onions, sliced", foodKey: "onion", foodName: "Onion" })).toEqual({ text: "✓ Onion", linked: true });
    expect(lineLinkText({ name: "Grandma's masala", foodKey: null, foodName: null })?.linked).toBe(false);
    expect(lineLinkText({ name: " ", foodKey: null, foodName: null })).toBeNull();
    expect(foodSuggestionViews([food("onion", "Onion", "count", "pyaz"), food("rice", "Rice", "mass")]).map((v) => v.label)).toEqual(["Onion · pyaz", "Rice"]);
  });
});

describe("moving things around", () => {
  it("moves a line up and down, never past either end", () => {
    const f = formWith([["A", "1", "g"], ["B", "1", "g"], ["C", "1", "g"]]);
    expect(moveLine(f, f.lines[2]!.key, -1).lines.map((l) => l.name)).toEqual(["A", "C", "B"]);
    expect(moveLine(f, f.lines[0]!.key, 1).lines.map((l) => l.name)).toEqual(["B", "A", "C"]);
    expect(moveLine(f, f.lines[0]!.key, -1)).toBe(f);
    expect(moveLine(f, f.lines[2]!.key, 1)).toBe(f);
  });

  it("empties the last line instead of taking it out", () => {
    const f = formWith([["A", "1", "g"]]);
    const out = removeLine(f, f.lines[0]!.key, () => "fresh");
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({ key: "fresh", name: "" });
  });

  it("serves in halves, ½ at the least", () => {
    let f = formWith([["A", "1", "g"]], { servesHalf: 2 });
    f = stepServes(f, -1);
    expect(f.servesHalf).toBe(1);
    expect(stepServes(f, -1)).toBe(f);
    expect(stepServes(f, 1).servesHalf).toBe(2);
  });

  it("holds up to 20 steps", () => {
    let f = formWith([["A", "1", "g"]]);
    for (let i = 0; i < 25; i++) f = addStep(f);
    expect(f.steps).toHaveLength(MAX_RECIPE_STEPS);
    f = setStep(f, 0, "First");
    expect(recipeRequest(f).body?.steps).toEqual(["First"]);
  });
});

describe("editing a recipe", () => {
  it("starts from every line, its main marked, its steps — and sends them back as they were", () => {
    const r = recipe();
    const f = formFromRecipe(r, keys());
    expect(f.name).toBe("Chicken curry");
    expect(f.minutes).toBe("45");
    expect(f.lines.map((l) => [l.name, l.quantity, l.unit, l.toTaste])).toEqual([
      ["Chicken", "1000", "g", false],
      ["Onions", "3", "onion", false],
      ["Tomatoes", "2", "tomato", false],
      ["Yogurt", "200", "g", false],
      ["Ginger-garlic paste", "2", "tbsp", false],
      ["Cooking oil", "3", "tbsp", false],
      ["Garam masala", "1", "tsp", false],
      ["Salt", "", "g", true],
    ]);
    expect(mainKeyOf(f)).toBe(f.lines[0]!.key);
    expect(unitOptions(f.lines[1]!)).toContain("onion");
    const body = sent(f)!;
    expect(body.lines.map((l) => l.isMain)).toEqual([true, false, false, false, false, false, false, false]);
    expect(body.lines.map((l) => l.foodKey)).toEqual(r.lines.map((l) => l.foodKey));
    expect(body.steps).toEqual(r.steps);
    expect(body.servesHalf).toBe(8);
  });
});
