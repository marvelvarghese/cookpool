import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { factorForMain, factorForPortions, scaleLine, scalePortions } from "@saas/contracts/kitchen";
import {
  BLANK_SESSION_HREF,
  amountText,
  availableText,
  canEditRecipe,
  clampFactor,
  factorChip,
  floorToGrid,
  haveLine,
  haveShort,
  ingredientRows,
  lineAmountText,
  mainAmountMilli,
  mainLineOf,
  minutesText,
  offersSaveAsRecipe,
  parseRecipeRef,
  portionsAt,
  recipeByline,
  recipeEditHref,
  recipeHref,
  sessionHref,
  recipeMetaLine,
  startLine,
  stepMain,
  stepPortions,
  useAllFor,
} from "@web-console-next/components/kitchen/recipes";
import { IngredientsSection, RecipeHeader, SaveCopyView, ServingsStepper, StartCookingBar, StepsSection, UseAllChip } from "@web-console-next/components/kitchen/recipe-views";
import { ANU, CURRY_LINES, curryMatch, line, recipe } from "./kitchen-recipe-fixtures";

// cookpool-recipes RC-5 (design §3.2, §3.3, the canvas's `Recipe`): the
// recipe page scales every line by one factor — set by the main item or by
// the portions, which stay linked — rounding each line as `scaleLine` does,
// and says what your pantries hold for each line.

const CURRY = recipe();
const amounts = (f: number) => ingredientRows(CURRY, f, null).map((r) => r.amount);

describe("where a recipe's pages are", () => {
  it("are /recipes/<id>, its edit page, and the session at a factor (RC-6's address)", () => {
    expect(recipeHref("rcp_1")).toBe("/recipes/rcp_1");
    expect(recipeEditHref("rcp_1")).toBe("/recipes/rcp_1/edit");
    expect(sessionHref(null)).toBe(BLANK_SESSION_HREF);
    expect(sessionHref(null)).toBe("/cook/session");
    expect(sessionHref("rcp_1", 450)).toBe("/cook/session?recipe=rcp_1&f=450");
    expect(sessionHref("rcp_1")).toBe("/cook/session?recipe=rcp_1&f=1000");
  });

  it("keeps the factor in its range, in whole thousandths", () => {
    expect(clampFactor(449.6)).toBe(450);
    expect(clampFactor(1)).toBe(10);
    expect(clampFactor(99_999)).toBe(20_000);
    expect(clampFactor(Number.NaN)).toBe(1000);
    expect(sessionHref("rcp_1", 50_000)).toBe("/cook/session?recipe=rcp_1&f=20000");
  });

  it("reads a recipe id from the address, and nothing else", () => {
    expect(parseRecipeRef("rcp_abc123")).toBe("rcp_abc123");
    expect(parseRecipeRef("_")).toBeNull();
    expect(parseRecipeRef("dsh_1")).toBeNull();
    expect(parseRecipeRef("rcp_%ZZ")).toBeNull();
    expect(parseRecipeRef(null)).toBeNull();
  });
});

describe("amounts, as the screen says them", () => {
  it("reads grams to 1000, then kg; spoons and pieces in halves; count words in the plural", () => {
    expect(amountText(450_000, "g")).toBe("450 g");
    expect(amountText(1_050_000, "g")).toBe("1.05 kg");
    expect(amountText(1_000_000, "g")).toBe("1 kg");
    expect(amountText(750_000, "ml")).toBe("750 ml");
    expect(amountText(1_500_000, "ml")).toBe("1.5 L");
    expect(amountText(450_000, "kg")).toBe("0.45 kg");
    expect(amountText(7_500, "tsp")).toBe("1½ tsp");
    expect(amountText(2_500, "tsp")).toBe("½ tsp");
    expect(amountText(240_000, "cup")).toBe("1 cup");
    expect(amountText(480_000, "cup")).toBe("2 cups");
    expect(amountText(1_000, "pcs")).toBe("1 pc");
    expect(amountText(3_000, "pcs")).toBe("3 pcs");
    expect(amountText(1_500, "onion")).toBe("1½ onions");
    expect(amountText(1_000, "tomato")).toBe("1 tomato");
    expect(amountText(2_000, "tomato")).toBe("2 tomatoes");
  });

  it("says what you have in the line's dimension: a spoon line's stock in ml", () => {
    expect(availableText(400_000, "tbsp")).toBe("400 ml");
    expect(availableText(450_000, "g")).toBe("450 g");
    expect(availableText(1_200_000, "kg")).toBe("1.2 kg");
    expect(availableText(4_000, "onion")).toBe("4 onions");
  });

  it("says To taste for a line without an amount, and minutes as min and h", () => {
    expect(lineAmountText(line(0, "Salt", null, null), 450)).toBe("To taste");
    expect(minutesText(45)).toBe("45 min");
    expect(minutesText(60)).toBe("1 h");
    expect(minutesText(75)).toBe("1 h 15 min");
  });
});

describe("scaling: every line follows the factor, rounded by scaleLine", () => {
  it("is the recipe as written at × 1", () => {
    expect(amounts(1000)).toEqual(["1 kg", "3 onions", "2 tomatoes", "200 g", "2 tbsp", "3 tbsp", "1 tsp", "To taste"]);
  });

  it("follows 1 kg of chicken down to 450 g, every line on its unit's grid", () => {
    expect(amounts(450)).toEqual(["450 g", "1½ onions", "1 tomato", "90 g", "1 tbsp", "1½ tbsp", "½ tsp", "To taste"]);
  });

  it("rounds exactly as the server will (scaleLine for every line, every factor)", () => {
    for (const f of [10, 125, 333, 450, 777, 1000, 1500, 2350, 20_000]) {
      const rows = ingredientRows(CURRY, f, null);
      CURRY_LINES.forEach((l, i) => {
        const scaled = scaleLine(l.qtyMilli, l.unit, f);
        expect(rows[i]!.amount).toBe(scaled === null ? "To taste" : amountText(scaled, l.unit!));
      });
    }
  });

  it("never scales a to-taste line, and marks the main line", () => {
    const rows = ingredientRows(CURRY, 2000, null);
    expect(rows[7]).toMatchObject({ name: "Salt", amount: "To taste", isMain: false });
    expect(rows.filter((r) => r.isMain).map((r) => r.name)).toEqual(["Chicken"]);
  });
});

describe("How much: the main item and the portions set one factor", () => {
  it("steps the main item by 50 g, and the factor follows (factorForMain)", () => {
    expect(stepMain(CURRY, 1000, -1)).toBe(950);
    expect(stepMain(CURRY, 1000, 1)).toBe(1050);
    expect(stepMain(CURRY, 450, 1)).toBe(500);
    expect(stepMain(CURRY, 500, -1)).toBe(450);
    expect(stepMain(CURRY, 450, 1)).toBe(factorForMain(1_000_000, 500_000));
  });

  it("snaps an off-grid amount to the next step (437 → 450; 440 → 400)", () => {
    // At × 0.437 the chicken reads 440 g (scaleLine's 10 g grid).
    expect(mainAmountMilli(mainLineOf(CURRY)!, 437)).toBe(440_000);
    expect(stepMain(CURRY, 437, 1)).toBe(450);
    expect(stepMain(CURRY, 437, -1)).toBe(400);
  });

  it("steps by 10 g under 100 g, and never below one step", () => {
    expect(stepMain(CURRY, 100, -1)).toBe(90);
    expect(stepMain(CURRY, 90, 1)).toBe(100);
    expect(stepMain(CURRY, 100, 1)).toBe(150);
    expect(stepMain(CURRY, 10, -1)).toBe(10);
  });

  it("steps a counted or spooned main item by ½", () => {
    const eggs = recipe({ lines: [line(0, "Eggs", 4, "pcs", { isMain: true }), line(1, "Butter", 1, "tbsp")] });
    expect(stepMain(eggs, 1000, 1)).toBe(1125);
    expect(amountText(mainAmountMilli(mainLineOf(eggs)!, 1125), "pcs")).toBe("4½ pcs");
    expect(stepMain(eggs, 1000, -1)).toBe(875);
    const half = factorForMain(4000, 500);
    expect(stepMain(eggs, half, -1)).toBe(half);
  });

  it("steps the portions a whole one at a time, down to ½ (factorForPortions)", () => {
    expect(stepPortions(CURRY, 1000, 1)).toBe(1250);
    expect(stepPortions(CURRY, 1000, -1)).toBe(750);
    expect(stepPortions(CURRY, 1000, -1)).toBe(factorForPortions(8, 6));
    // About 2 (× 0.45 is 1.8 portions): up to 2, down to 1.
    expect(stepPortions(CURRY, 450, 1)).toBe(500);
    expect(stepPortions(CURRY, 450, -1)).toBe(250);
    expect(stepPortions(CURRY, 250, -1)).toBe(125);
    expect(stepPortions(CURRY, 125, -1)).toBe(125);
  });

  it("keeps the two linked: the main item moves the portions, and the portions move every line", () => {
    expect(portionsAt(CURRY, 450).label).toBe("about 2");
    expect(portionsAt(CURRY, 500).label).toBe("2");
    const f = stepPortions(CURRY, 450, 1);
    expect(amountText(mainAmountMilli(mainLineOf(CURRY)!, f), "g")).toBe("500 g");
    expect(amounts(f)[1]).toBe("1½ onions");
    expect(portionsAt(CURRY, stepMain(CURRY, 500, 1)).label).toBe(scalePortions(8, 550).label);
  });

  it("names the factor: As written, or ×0.45 with every line following", () => {
    expect(factorChip(1000, 8)).toEqual({ text: "As written · serves 4", written: true });
    expect(factorChip(1000, 5)).toEqual({ text: "As written · serves 2½", written: true });
    expect(factorChip(450, 8)).toEqual({ text: "×0.45 · every line follows", written: false });
    expect(factorChip(1500, 8).text).toBe("×1.5 · every line follows");
  });

  it("says what Start cooking makes: For about 2 · chicken 450 g", () => {
    expect(startLine(CURRY, 450)).toBe("For about 2 · chicken 450 g");
    expect(startLine(CURRY, 1000)).toBe("For 4 · chicken 1 kg");
  });
});

describe("Use all N you have", () => {
  it("sets the main item to the stock the match found (450 g → × 0.45)", () => {
    expect(useAllFor(CURRY, 1000, curryMatch(1000))).toEqual({ factorMilli: 450, amountMilli: 450_000, text: "Use all 450 g you have" });
  });

  it("shows only while the main item is another amount", () => {
    expect(useAllFor(CURRY, 450, curryMatch(450))).toBeNull();
    expect(useAllFor(CURRY, 500, curryMatch(500))).not.toBeNull();
  });

  it("stays on the grid and never past the stock, so the line reads have", () => {
    const m = curryMatch(1000);
    m.lines[0] = { ...m.lines[0]!, availableMilli: 437_500 };
    const all = useAllFor(CURRY, 1000, m)!;
    expect(all.text).toBe("Use all 430 g you have");
    expect(scaleLine(1_000_000, "g", all.factorMilli)).toBeLessThanOrEqual(437_500);
    expect(floorToGrid(437_500, "g")).toBe(430_000);
    expect(floorToGrid(1_020_000, "g")).toBe(1_000_000);
    expect(floorToGrid(99_000, "g")).toBe(95_000);
    expect(floorToGrid(1_700, "pcs")).toBe(1_500);
  });

  it("is not offered with none of it, or no match yet", () => {
    const m = curryMatch(1000);
    m.lines[0] = { ...m.lines[0]!, availableMilli: 0, status: "missing", items: [] };
    expect(useAllFor(CURRY, 1000, m)).toBeNull();
    m.lines[0] = { ...m.lines[0]!, availableMilli: 3_000 };
    expect(useAllFor(CURRY, 1000, m)).toBeNull();
    expect(useAllFor(CURRY, 1000, null)).toBeNull();
  });
});

describe("what your pantries hold: each line's status", () => {
  const rows = ingredientRows(CURRY, 1000, curryMatch(1000));

  it("says ✓ with the pantry and the stock, Short with what you have, Missing, Always have", () => {
    expect(rows.map((r) => [r.name, r.status, r.statusText])).toEqual([
      ["Chicken", "short", "Short · you have 450 g"],
      ["Onions", "have", "✓ Flat 4B · 4 onions"],
      ["Tomatoes", "have", "✓ Flat 4B · 5 tomatoes"],
      ["Yogurt", "missing", "Missing"],
      ["Ginger-garlic paste", "have", "✓ Your kitchen · 150 ml"],
      ["Cooking oil", "have", "✓ Flat 4B +1 · 400 ml"],
      ["Garam masala", "always", "Always have"],
      ["Salt", "always", "Always have"],
    ]);
  });

  it("follows the factor: at 450 g the chicken is there", () => {
    expect(ingredientRows(CURRY, 450, curryMatch(450))[0]).toMatchObject({ status: "have", statusText: "✓ Your kitchen · 450 g", amount: "450 g" });
  });

  it("has no status until the match answers (the amounts show at once)", () => {
    expect(ingredientRows(CURRY, 450, null).every((r) => r.status === null && r.statusText === null)).toBe(true);
  });

  it("sums it up beside the heading: Have 6 of 8 · 2 to get, or Have all 8", () => {
    expect(haveLine(curryMatch(1000).summary)).toEqual({ text: "Have 6 of 8 · 2 to get", complete: false });
    expect(haveLine(curryMatch(450).summary)).toEqual({ text: "Have 7 of 8 · 1 to get", complete: false });
    expect(haveLine({ lines: 8, have: 6, always: 2, short: 0, missing: 0 })).toEqual({ text: "Have all 8", complete: true });
  });
});

describe("the header and its one action", () => {
  it("says from Anu for a copy, by Cookpool for Cookpool's own, by Anu for hers, nothing for yours", () => {
    expect(recipeByline(recipe({ source: { recipeId: "rcp_0", ownerId: ANU, ownerName: "Anu Thomas" } }))).toEqual({
      kind: "person",
      text: "from Anu",
      subjectId: ANU,
      name: "Anu Thomas",
    });
    expect(recipeByline(recipe({ isSystem: true, mine: false, ownerId: "usr_cookpool", ownerName: "Cookpool" }))).toEqual({ kind: "cookpool", text: "by Cookpool" });
    expect(recipeByline(recipe({ source: { recipeId: "rcp_0", ownerId: "usr_cookpool", ownerName: "Cookpool" } }))).toEqual({ kind: "cookpool", text: "from Cookpool" });
    expect(recipeByline(recipe({ mine: false, ownerId: ANU, ownerName: "Anu Thomas" }))).toMatchObject({ kind: "person", text: "by Anu" });
    expect(recipeByline(recipe())).toEqual({ kind: "none" });
  });

  it("offers Edit to the owner only, never on Cookpool's own", () => {
    expect(canEditRecipe(recipe())).toBe(true);
    expect(canEditRecipe(recipe({ mine: false }))).toBe(false);
    expect(canEditRecipe(recipe({ isSystem: true, mine: true }))).toBe(false);
  });

  it("draws the face and the minutes", () => {
    const html = renderToStaticMarkup(
      React.createElement(RecipeHeader, { recipe: recipe({ source: { recipeId: "rcp_0", ownerId: ANU, ownerName: "Anu Thomas" } }), meId: null }),
    );
    expect(html).toContain("Chicken curry");
    expect(html).toContain("from Anu");
    expect(html).toContain(">AT<");
    expect(html).toContain("45 min");
  });

  // RV-4 (the canvas's `RvRecipe`): one line under the name.
  it("says Serves 4 · 35 min · Have 7 of 9 under the name", () => {
    expect(haveShort(curryMatch(1000).summary)).toBe("Have 6 of 8");
    expect(haveShort({ lines: 8, have: 7, always: 1, short: 0, missing: 0 })).toBe("Have all 8");
    expect(recipeMetaLine("4", 35, "Have 7 of 9")).toBe("Serves 4 · 35 min · Have 7 of 9");
    expect(recipeMetaLine("about 2", null, null)).toBe("Serves about 2");
    const html = renderToStaticMarkup(React.createElement(RecipeHeader, { recipe: recipe(), meId: null, servesLabel: "about 2", have: "Have 6 of 8" }));
    expect(html).toContain("Serves about 2 · 45 min · Have 6 of 8");
    expect(renderToStaticMarkup(React.createElement(RecipeHeader, { recipe: recipe(), meId: null }))).toContain("Serves 4 · 45 min");
  });

  it("reads Save, then Saved — opening your copy once it is written", () => {
    expect(renderToStaticMarkup(React.createElement(SaveCopyView, { savedId: null, saving: false, onSave: () => undefined }))).toContain(">Save<");
    const saving = renderToStaticMarkup(React.createElement(SaveCopyView, { savedId: null, saving: true, onSave: () => undefined }));
    expect(saving).toContain("Saved");
    expect(saving).not.toContain("href");
    expect(renderToStaticMarkup(React.createElement(SaveCopyView, { savedId: "rcp_mine", saving: false, onSave: () => undefined }))).toContain('href="/recipes/rcp_mine"');
  });
});

describe("the page as it draws", () => {
  // RV-4: the servings − 4 + beside Ingredients, and Use all as a quiet chip (the main item's own − + is gone).
  it("has the servings stepper and Use all", () => {
    const html = renderToStaticMarkup(React.createElement(ServingsStepper, { recipe: CURRY, factorMilli: 1000, onFactor: () => undefined }));
    expect(html).toContain('aria-label="Servings"');
    expect(html).toContain('aria-label="Fewer portions"');
    expect(html).toContain('aria-label="More portions"');
    expect(html).toContain(">4<");
    expect(renderToStaticMarkup(React.createElement(ServingsStepper, { recipe: CURRY, factorMilli: 450, onFactor: () => undefined }))).toContain("about 2");
    expect(renderToStaticMarkup(React.createElement(UseAllChip, { recipe: CURRY, factorMilli: 1000, match: curryMatch(1000), onFactor: () => undefined }))).toContain("Use all 450 g you have");
    expect(renderToStaticMarkup(React.createElement(UseAllChip, { recipe: CURRY, factorMilli: 450, match: curryMatch(450), onFactor: () => undefined }))).toBe("");
  });

  it("lists the ingredients with their statuses and the main line marked", () => {
    const html = renderToStaticMarkup(
      React.createElement(IngredientsSection, { rows: ingredientRows(CURRY, 1000, curryMatch(1000)), match: curryMatch(1000) }),
    );
    // RV-4: one line per row — the dot, the name, the amount; the status is said to a screen reader.
    expect(html).toContain(" · main");
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("border-2 border-cp-owe");
    expect(html).toContain("Short · you have 450 g");
    expect(html).toContain("Missing");
  });

  it("folds the steps under Steps · N, and opens numbered", () => {
    const steps = ["One", "Two"];
    const folded = renderToStaticMarkup(React.createElement(StepsSection, { steps }));
    expect(folded).toContain("Steps · 2");
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).not.toContain("One");
    expect(renderToStaticMarkup(React.createElement(StepsSection, { steps, initiallyOpen: true }))).toContain("One");
  });

  it("starts cooking at the factor on screen", () => {
    const html = renderToStaticMarkup(React.createElement(StartCookingBar, { href: sessionHref("rcp_curry", 450), line: startLine(CURRY, 450) }));
    expect(html).toContain('href="/cook/session?recipe=rcp_curry&amp;f=450"');
    expect(html).toContain("Start cooking");
    // RV-4: under the button no more; a screen reader still hears it.
    expect(html).toContain('<span class="sr-only">, For about 2 · chicken 450 g</span>');
  });
});

describe("Save as recipe, on a dish's page", () => {
  it("shows in the new frame for a dish that was cooked, never a canceled one, and never in prod", () => {
    for (const state of ["open", "draft", "finalized"]) expect(offersSaveAsRecipe(true, { state })).toBe(true);
    expect(offersSaveAsRecipe(true, { state: "canceled" })).toBe(false);
    for (const state of ["open", "finalized"]) expect(offersSaveAsRecipe(false, { state })).toBe(false);
  });
});
