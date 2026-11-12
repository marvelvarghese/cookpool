import type { KitchenRecipe, KitchenRecipeLine, RecipeLastCook, RecipeMatchResponse } from "@saas/contracts/kitchen";
import { finishPlan, includedLines, progressText, refreshTakes, sessionFromRecipe, tickLine, type CookSession } from "@web-console-next/components/kitchen/cook-session";
import {
  cookFinishText,
  cookLineFixed,
  cookLineMeta,
  cookTickAmount,
  cookTickItem,
  cookTickLabel,
  cookTickPercent,
  cookTickState,
  cookUnitChoice,
  setLineFromTick,
} from "@web-console-next/components/kitchen/cook-tick";
import { JUST_ME } from "@web-console-next/components/kitchen/dish-maker";
import { FLAT, ME, MEERA, NAMES, PERSONAL_REF, groupRef, makeItem } from "./kitchen-pantry-fixtures";

// cookpool-revamp RV-11 (the canvas's RvCookLines, "Cooking, tick what went
// in"): the cook session's ingredients as RV-10's tick rows — the recipe's
// amount for the session in grey, in the line's own word, with the item's
// measures; a typed amount or a unit sets the line's amount; the tick is
// went in; N of M in; Finish's running cost, and only ticked rows charged.

const NOW = new Date("2026-11-08T12:00:00.000Z");
const RECIPE_ID = "rcp_00000000000000000000000000000c01";

// The pantries: chicken in yours; onions (Meera paid) and oil (you paid) in Flat 4B.
const CHICKEN = makeItem({ name: "Chicken", pantry: PERSONAL_REF, unit: "kg", bought: "1", priceMinor: 28_000, paidBy: ME });
const ONIONS = makeItem({ name: "Onions", pantry: groupRef(FLAT), unit: "kg", bought: "2", priceMinor: 8_000, paidBy: MEERA });
const OIL = makeItem({ name: "Cooking oil", pantry: groupRef(FLAT), unit: "L", bought: "1", priceMinor: 18_500, paidBy: ME });

function line(position: number, o: Partial<KitchenRecipeLine> & { name: string }): KitchenRecipeLine {
  return {
    position,
    foodKey: o.foodKey ?? o.name.toLowerCase(),
    name: o.name,
    qtyMilli: o.qtyMilli ?? null,
    quantity: o.quantity ?? null,
    unit: o.unit ?? null,
    dimension: o.dimension ?? null,
    toTaste: o.toTaste ?? false,
    isMain: o.isMain ?? false,
  };
}

// Chicken curry serves 4: 1 kg chicken (main), 4 onions, 200 g yogurt, 1 tsp garam masala, salt to taste, 2 tbsp oil.
const RECIPE: KitchenRecipe = {
  id: RECIPE_ID,
  ownerId: ME,
  ownerName: "Rahul",
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
  lineCount: 6,
  main: { position: 0, foodKey: "chicken", name: "Chicken", qtyMilli: 1_000_000, quantity: 1000, unit: "g" },
  lastCookedAt: "2026-11-01T19:00:00.000Z",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  lines: [
    line(0, { name: "Chicken", qtyMilli: 1_000_000, quantity: 1000, unit: "g", dimension: "mass", isMain: true }),
    line(1, { name: "Onions", foodKey: "onion", qtyMilli: 4_000, quantity: 4, unit: "onion", dimension: "count" }),
    line(2, { name: "Yogurt", qtyMilli: 200_000, quantity: 200, unit: "g", dimension: "mass" }),
    line(3, { name: "Garam masala", foodKey: "garam_masala", qtyMilli: 5_000, quantity: 1, unit: "tsp", dimension: "volume" }),
    line(4, { name: "Salt", toTaste: true }),
    line(5, { name: "Cooking oil", foodKey: "oil", qtyMilli: 30_000, quantity: 2, unit: "tbsp", dimension: "volume" }),
  ],
  steps: ["Brown the onions", "Add the chicken", "Stir in the yogurt", "Add the masala", "Simmer 20 minutes"],
  linkCode: null,
};

const LAST_COOK: RecipeLastCook = {
  dishId: "dsh_00000000000000000000000000000001",
  cookedAt: "2026-11-01T19:00:00.000Z",
  recipeFactorMilli: 500,
  portionsHalf: 4,
  lines: [
    { recipeLine: 0, itemId: CHICKEN.id, name: "Chicken", qtyMilli: 500_000, quantity: 500, unit: "g", label: null },
    { recipeLine: 1, itemId: ONIONS.id, name: "Onions", qtyMilli: 300_000, quantity: 2, unit: "kg", label: "2 onions" },
  ],
};

const matchItem = (item: typeof CHICKEN, takeMilli: number) => ({
  itemId: item.id,
  ref: item.pantry.kind === "group" ? `org:${item.pantry.orgId}:${item.id}` : `me:${item.id}`,
  orgId: item.pantry.kind === "group" ? item.pantry.orgId : null,
  pantry: item.pantry,
  name: item.name,
  qtyLeftMilli: item.qtyLeftMilli,
  takeMilli,
  unit: item.displayUnit,
  expiresOn: null,
});

// The match at ×0.45: chicken 450 g, 2 onions (300 g of Flat 4B's), no yogurt, garam masala on Always have, 1 tbsp oil.
const MATCH: RecipeMatchResponse = {
  recipeId: RECIPE_ID,
  factorMilli: 450,
  portions: { portionsHalf: 4, about: true, label: "about 2" },
  lines: [
    { position: 0, status: "have", needMilli: 450_000, needQuantity: 450, unit: "g", availableMilli: 1_000_000, items: [matchItem(CHICKEN, 450_000)] },
    { position: 1, status: "have", needMilli: 2_000, needQuantity: 2, unit: "onion", availableMilli: 13_333, items: [matchItem(ONIONS, 300_000)] },
    { position: 2, status: "missing", needMilli: 90_000, needQuantity: 90, unit: "g", availableMilli: 0, items: [] },
    { position: 3, status: "always", needMilli: 2_500, needQuantity: 0.5, unit: "tsp", availableMilli: 0, items: [] },
    { position: 4, status: "always", needMilli: null, needQuantity: null, unit: null, availableMilli: 0, items: [] },
    { position: 5, status: "have", needMilli: 15_000, needQuantity: 1, unit: "tbsp", availableMilli: 1_000_000, items: [matchItem(OIL, 15_000)] },
  ],
  summary: { lines: 6, have: 3, short: 0, missing: 1, always: 2, missingNames: ["Yogurt"], maxFactorMilli: null },
  unlinked: [],
};

const ITEMS = new Map([CHICKEN, ONIONS, OIL].map((i) => [i.id, i] as const));

/** The session from the recipe, its items read. */
function curry(): CookSession {
  return refreshTakes(sessionFromRecipe(RECIPE, LAST_COOK, MATCH, NOW), ITEMS);
}

const box: { typed: string; unit: string | null } = { typed: "", unit: null };
const lineOf = (s: CookSession, key: string) => s.lines.find((l) => l.key === key)!;
const amountOf = (s: CookSession, key: string, state = box) => {
  const t = cookTickItem(lineOf(s, key))!;
  return cookTickAmount(t, cookTickState(lineOf(s, key), t, state), null)!;
};

describe("the grey amount: the recipe's, scaled to the session", () => {
  it("reads in grams, in the line's own word, or a spoon, with the item's units as chips", () => {
    const s = curry();
    const chicken = amountOf(s, "r:0");
    expect([chicken.ghost, chicken.word]).toEqual(["450", "g"]);
    const onions = amountOf(s, "r:1");
    expect([onions.ghost, onions.word]).toEqual(["2", "onions"]);
    expect(onions.units.map((u) => u.many)).toEqual(["onions", "g", "kg"]);
    expect(onions.qtyMilli).toBe(300_000);
    const oil = amountOf(s, "r:5");
    expect([oil.ghost, oil.word, oil.qtyMilli]).toEqual(["1", "tbsp", 15_000]);
  });

  it("a line with no item reads in its own unit; to taste has none", () => {
    const s = curry();
    const masala = amountOf(s, "r:3");
    expect([masala.ghost, masala.word]).toEqual(["½", "tsp"]);
    expect(cookTickItem(lineOf(s, "r:4"))).toBeNull();
    expect(cookLineFixed(lineOf(s, "r:4"))).toBe("To taste");
  });
});

describe("typing and the unit set the line's amount", () => {
  it("3 onions over the grey 2 takes 450 g, and clearing it puts the recipe's back", () => {
    const s = curry();
    const t = cookTickItem(lineOf(s, "r:1"))!;
    const typed = { typed: "3", unit: null };
    const after = setLineFromTick(s, "r:1", t, cookTickAmount(t, typed));
    expect(lineOf(after, "r:1").qtyMilli).toBe(3_000);
    // Back on the screen later, the box shows what was set.
    const again = cookTickItem(lineOf(after, "r:1"))!;
    expect(cookTickState(lineOf(after, "r:1"), again, undefined)).toEqual({ typed: "3", unit: "m:onion" });
    const cleared = setLineFromTick(after, "r:1", again, cookTickAmount(again, box));
    expect(lineOf(cleared, "r:1").qtyMilli).toBe(2_000);
  });

  it("a unit picked converts the grey amount and the line follows it", () => {
    const s = curry();
    const t = cookTickItem(lineOf(s, "r:0"))!;
    const kg = cookTickAmount(t, { typed: "0.5", unit: "u:kg" });
    expect(kg?.word).toBe("kg");
    expect(lineOf(setLineFromTick(s, "r:0", t, kg), "r:0").qtyMilli).toBe(500_000);
  });

  it("1 tbsp in ml is 15 ml exactly (not a 50 ml step), and typed onions keep their amount in grams", () => {
    const s = curry();
    const oil = cookTickItem(lineOf(s, "r:5"))!;
    const ml = cookTickAmount(oil, { typed: "", unit: "u:ml" })!;
    expect([ml.ghost, ml.word, ml.qtyMilli]).toEqual(["15", "ml", 15_000]);
    expect(lineOf(setLineFromTick(s, "r:5", oil, ml), "r:5").qtyMilli).toBe(15_000);
    const onions = cookTickItem(lineOf(s, "r:1"))!;
    const three = cookTickAmount(onions, { typed: "3", unit: null })!;
    expect(cookUnitChoice(onions, three, "u:g")).toEqual({ typed: "450", unit: "u:g" });
    expect(cookUnitChoice(onions, cookTickAmount(onions, box)!, "u:g")).toEqual({ typed: "", unit: "u:g" });
  });

  it("junk leaves the line as it is", () => {
    const s = curry();
    const t = cookTickItem(lineOf(s, "r:0"))!;
    const junk = cookTickAmount(t, { typed: "abc", unit: null })!;
    expect(junk.invalid).toBe(true);
    expect(setLineFromTick(s, "r:0", t, junk)).toBe(s);
  });
});

describe("the line under the name", () => {
  it("names the kitchen and who paid, Mine, Always have, and Not in your kitchen in the owe tone", () => {
    const s = curry();
    expect(cookLineMeta(lineOf(s, "r:1"), ME, NAMES).text).toMatch(/^Flat 4B · .+ paid$/);
    expect(cookLineMeta(lineOf(s, "r:0"), ME, NAMES)).toEqual({ text: "Mine", tone: "muted" });
    expect(cookLineMeta(lineOf(s, "r:3"), ME, NAMES).text).toBe("Always have");
    expect(cookLineMeta(lineOf(s, "r:2"), ME, NAMES)).toEqual({ text: "Not in your kitchen", tone: "owe" });
  });
});

describe("the tick is went in: N of M in, the bar, and Finish's cost", () => {
  it("counts and costs only the ticked lines", () => {
    const s = curry();
    expect(progressText(s)).toBe("0 of 5 in");
    expect(cookTickPercent(s)).toBe(0);
    expect(cookFinishText(s)).toBe("₹0 · nothing taken from the kitchen");
    const two = tickLine(tickLine(s, "r:0"), "r:1");
    expect(progressText(two)).toBe("2 of 5 in");
    expect(cookTickPercent(two)).toBe(40);
    expect(cookFinishText(two)).toBe("₹138 so far · 2 in");
    expect(cookTickLabel("Onions", "2 onions", false)).toBe("Tick Onions, 2 onions");
    expect(cookTickLabel("Onions", "2 onions", true)).toBe("Onions went in, 2 onions, untick");
    expect(cookTickPercent(tickLine(s, "r:1"))).toBe(20);
  });

  it("Finish always works: with nothing ticked it posts a dish of nothing; ticked lines go in at their amounts", () => {
    const s = curry();
    const choices = { unticked: "out" as const, postTo: JUST_ME, halves: {}, roster: null, meId: ME, save: false };
    const none = finishPlan(s, choices, { groups: [] });
    expect(none.ok && none.plan.request.ingredients).toBeFalsy();
    const t = cookTickItem(lineOf(s, "r:1"))!;
    const three = tickLine(setLineFromTick(s, "r:1", t, cookTickAmount(t, { typed: "3", unit: null })), "r:1");
    expect(includedLines(three, "out").map((l) => l.key)).toEqual(["r:1"]);
    const plan = finishPlan(three, choices, { groups: [] });
    expect(plan.ok && plan.plan.request.ingredients).toEqual([{ itemId: ONIONS.id, quantity: "450", unit: "g", recipeLine: 1 }]);
  });
});
