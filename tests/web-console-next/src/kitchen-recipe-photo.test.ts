import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiRecipeCheck, AiRecipeDraft, AiRecipeDraftStep, AiStatus } from "@saas/contracts/kitchen";
import { frameRedirect } from "@web-console-next/lib/features";
import { aiSwitchOn } from "@web-console-next/lib/ai-switches";
import { encodeAttempts } from "@web-console-next/components/kitchen/receipt-image";
import { recipeRequest, errorsFromDetails, setLine, moveLine, updateStep } from "@web-console-next/components/kitchen/recipe-form";
import { MyRecipesSection } from "@web-console-next/components/kitchen/cook-hub-views";
import {
  PHOTO_UNUSABLE,
  RECIPE_PHOTO_HREF,
  RECIPE_PHOTO_LONG_SIDE,
  checksFooter,
  formFromDraft,
  markCount,
  marksFromChecks,
  photoCard,
  photoRequested,
  photoSaveBody,
  photoSavePlan,
  readingText,
  recipePhotoError,
  recipePhotoShows,
  settleMarks,
  stepMarksByIndex,
} from "@web-console-next/components/kitchen/recipe-photo";

// cookpool-ai AI-9 (design §4, the canvas's AiImport): where Recipe from a
// photo shows, the draft as the result's card and tabs, the checks on the
// form's fields, the editor's prefill, Save's body, and the refusals.

const status = (o: { available?: boolean; import?: boolean } = {}): AiStatus => ({
  available: o.available ?? true,
  features: { sayIt: true, receipt: true, import: o.import ?? true, voice: false, swaps: false },
  budget: "ok",
  today: { actions: 3, actionsLimit: 50, voiceSeconds: 0, voiceSecondsLimit: 1800 },
});

const step = (o: Partial<AiRecipeDraftStep> & { text: string }): AiRecipeDraftStep => ({
  phase: "cook",
  lines: [],
  heat: null,
  minSeconds: null,
  maxSeconds: null,
  whistles: null,
  handsOff: false,
  timeRule: "fixed",
  sense: null,
  checkpoint: null,
  tip: null,
  ...o,
});

const DRAFT: AiRecipeDraft = {
  name: "Kerala egg roast",
  servesHalf: 8,
  minutes: 35,
  kind: "dal_curry",
  lines: [
    { foodKey: "egg", name: "Eggs", quantity: 4, unit: "egg", toTaste: false, isMain: false },
    { foodKey: "onion", name: "Onions, sliced", quantity: 300, unit: "g", toTaste: false, isMain: true },
    { foodKey: null, name: "Curry leaves", quantity: null, unit: null, toTaste: false, isMain: false },
    { foodKey: "salt", name: "Salt", quantity: null, unit: null, toTaste: true, isMain: false },
  ],
  steps: [
    step({ text: "Boil the eggs, cool and peel", heat: 2, minSeconds: 600, maxSeconds: 600, handsOff: true, lines: [0] }),
    step({ text: "Fry the onions with a pinch of salt", heat: 2, minSeconds: 480, maxSeconds: 600, sense: "look", checkpoint: "golden", lines: [1, 3] }),
    step({ text: "Add the curry leaves", heat: null, minSeconds: 60, maxSeconds: 60, lines: [2] }),
    step({ text: "Slice and serve", phase: "prep" }),
  ],
  tools: ["Kadai"],
};

const CHECKS: AiRecipeCheck[] = [
  { path: "lines[2].quantity", message: "How much? The page doesn't say" },
  { path: "steps[2].heat", message: "No flame on the page" },
];

const keys = () => {
  let n = 0;
  return () => `k${(n += 1)}`;
};

describe("where Recipe from a photo shows", () => {
  it("in the new frame, AI available reading recipe photos, with this device's switch on", () => {
    expect(recipePhotoShows({ isNewFrame: true, status: status(), switchOn: true })).toBe(true);
    expect(recipePhotoShows({ isNewFrame: true, status: status({ available: false }), switchOn: true })).toBe(false);
    expect(recipePhotoShows({ isNewFrame: true, status: status({ import: false }), switchOn: true })).toBe(false);
    expect(recipePhotoShows({ isNewFrame: true, status: status(), switchOn: false })).toBe(false);
    expect(recipePhotoShows({ isNewFrame: true, status: undefined, switchOn: true })).toBe(false);
    expect(aiSwitchOn('{"import":false}', "import")).toBe(false);
    expect(aiSwitchOn('{"receipt":false}', "import")).toBe(true);
  });

  it("opens from My recipes on New recipe (`?photo=1`)", () => {
    expect(RECIPE_PHOTO_HREF).toBe("/recipes/new?photo=1");
    expect(photoRequested("?photo=1")).toBe(true);
    expect(photoRequested("?photo=0")).toBe(false);
    expect(photoRequested("")).toBe(false);
  });

  it("never in today's frame, and today's My recipes is unchanged", () => {
    expect(recipePhotoShows({ isNewFrame: false, status: status(), switchOn: true })).toBe(false);
    expect(frameRedirect("/recipes/new", false)).toBe("/home");
    const plain = renderToStaticMarkup(React.createElement(MyRecipesSection, { cards: [], loading: false, failed: false }));
    const withNothing = renderToStaticMarkup(React.createElement(MyRecipesSection, { cards: [], loading: false, failed: false, photoAction: null }));
    expect(withNothing).toBe(plain);
    expect(plain).not.toContain("From a photo");
    const withEntry = renderToStaticMarkup(
      React.createElement(MyRecipesSection, { cards: [], loading: false, failed: false, photoAction: React.createElement("a", { href: RECIPE_PHOTO_HREF }, "From a photo") }),
    );
    expect(withEntry).toContain('href="/recipes/new?photo=1"');
  });

  it("sends the photo at 1600 px on the long side", () => {
    expect(RECIPE_PHOTO_LONG_SIDE).toBe(1600);
    expect(encodeAttempts({ width: 3000, height: 4000 }, RECIPE_PHOTO_LONG_SIDE)[0]).toEqual({ width: 1200, height: 1600, quality: 0.8 });
    // A receipt is unchanged.
    expect(encodeAttempts({ width: 3000, height: 4000 })[0]).toEqual({ width: 900, height: 1200, quality: 0.8 });
  });
});

describe("the result", () => {
  const start = formFromDraft(DRAFT, CHECKS, keys());
  const card = photoCard(DRAFT, CHECKS, start);

  it("is the recipe's card and its two tabs", () => {
    expect(card.title).toBe("Kerala egg roast");
    expect(card.meta).toBe("Serves 4 · 35 min · 4 ingredients · 4 steps");
    expect(card.stepsTab).toBe("Steps · 4");
    expect(card.linesTab).toBe("Ingredients · 4");
    expect(card.footer).toBe("2 things to check · the photo is already deleted");
    expect(checksFooter(1)).toBe("1 thing to check · the photo is already deleted");
    expect(checksFooter(0)).toBe("Nothing to check · the photo is already deleted");
  });

  it("shows each step's flame, time and checkpoint, with the check on the step it names", () => {
    expect(card.steps.map((s) => [s.n, s.text, s.meta, s.check])).toEqual([
      [1, "Boil the eggs, cool and peel", "Medium flame · 10 min · Hands off", null],
      [2, "Fry the onions with a pinch of salt", "Medium flame · 8–10 min · Until it looks golden", null],
      [3, "Add the curry leaves", "1 min", "No flame on the page"],
      [4, "Slice and serve", "Prep", null],
    ]);
  });

  it("lists the ingredients, amber where a check applies", () => {
    expect(card.lines.map((l) => [l.name, l.amount, l.check])).toEqual([
      ["Eggs", "4 egg", null],
      ["Onions, sliced", "300 g", null],
      ["Curry leaves", "—", "How much? The page doesn't say"],
      ["Salt", "To taste", null],
    ]);
  });

  it("names a recipe with no name, and puts checks on the whole recipe on the card", () => {
    const draft = { ...DRAFT, name: "", minutes: null };
    const checks = [{ path: "name", message: "No name on the page" }, { path: "servesHalf", message: "Serves isn't said" }];
    const c = photoCard(draft, checks, formFromDraft(draft, checks, keys()));
    expect(c.title).toBe("A recipe with no name");
    expect(c.meta).toBe("Serves 4 · 4 ingredients · 4 steps");
    expect(c.general).toEqual(["No name on the page", "Serves isn't said"]);
  });
});

describe("the checks, on the form's fields", () => {
  it("land on the line or step they name, the field they name, or as other", () => {
    const m = marksFromChecks(
      [
        { path: "name", message: "No name" },
        { path: "lines[1].quantity", message: "Unclear amount" },
        { path: "lines[1].unit", message: "Unit guessed" },
        { path: "steps[0].minSeconds", message: "No time" },
        { path: "steps", message: "Steps 21+ dropped" },
        { path: "lines[9].quantity", message: "Out of range" },
        { path: "kind", message: "Odd" },
      ],
      ["a", "b"],
      ["s1"],
    );
    expect(m.name).toBe("No name");
    expect(m.line).toEqual({ b: "Unclear amount · Unit guessed" });
    expect(m.step).toEqual({ s1: "No time" });
    expect(m.steps).toBe("Steps 21+ dropped");
    expect(m.lines).toBe("Out of range");
    expect(m.other).toEqual(["Odd"]);
    expect(markCount(m)).toBe(6);
  });

  it("follow their line or step, and go when it is edited", () => {
    const start = formFromDraft(DRAFT, CHECKS, keys());
    const curry = start.lineKeys[2]!;
    const third = start.stepIds[2]!;
    expect(start.marks.line).toEqual({ [curry]: "How much? The page doesn't say" });
    expect(stepMarksByIndex(start.marks, start.form.steps)).toEqual({ 2: "No flame on the page" });

    const moved = moveLine(start.form, curry, -1);
    const afterMove = settleMarks(start.marks, start.form, moved);
    expect(afterMove.line).toEqual({ [curry]: "How much? The page doesn't say" });

    const filled = setLine(moved, curry, { quantity: "2", unit: "sprig" });
    expect(settleMarks(afterMove, moved, filled).line).toEqual({});

    const flame = updateStep(start.form, third, (d) => ({ ...d, heat: 2 }));
    const settled = settleMarks(start.marks, start.form, flame);
    expect(settled.step).toEqual({});
    expect(settled.line).toEqual(start.marks.line);
    expect(settleMarks(start.marks, start.form, start.form)).toBe(start.marks);
  });
});

describe("Open in editor", () => {
  it("prefills the form: lines, the main, guided steps by line keys, tools", () => {
    const { form, lineKeys } = formFromDraft(DRAFT, CHECKS, keys());
    expect(form.name).toBe("Kerala egg roast");
    expect(form.servesHalf).toBe(8);
    expect(form.minutes).toBe("35");
    expect(form.mainKey).toBe(lineKeys[1]);
    expect(form.lines.map((l) => [l.name, l.foodKey, l.quantity, l.unit, l.toTaste, l.countWord])).toEqual([
      ["Eggs", "egg", "4", "egg", false, "egg"],
      ["Onions, sliced", "onion", "300", "g", false, null],
      ["Curry leaves", null, "", "g", false, null],
      ["Salt", "salt", "", "g", true, null],
    ]);
    expect(form.steps[1]).toMatchObject({ key: null, heat: 2, timeKind: "minutes", minSeconds: 480, maxSeconds: 600, sense: "look", checkpoint: "golden", lines: [lineKeys[1], lineKeys[3]] });
    expect(form.steps[0]).toMatchObject({ handsOff: true, lines: [lineKeys[0]] });
    expect(form.tools).toEqual(["Kadai"]);
  });

  it("sends what the draft said once the check is answered", () => {
    const { form, lineKeys } = formFromDraft(DRAFT, CHECKS, keys());
    expect(recipeRequest(form).body).toBeNull();
    const body = recipeRequest(setLine(form, lineKeys[2]!, { quantity: "2", unit: "sprig" })).body!;
    expect(body.lines.map((l) => [l.name, l.quantity ?? null, l.unit ?? null, l.isMain])).toEqual([
      ["Eggs", "4", "egg", false],
      ["Onions, sliced", "300", "g", true],
      ["Curry leaves", "2", "sprig", false],
      ["Salt", null, null, false],
    ]);
    expect(body.steps?.[1]).toMatchObject({ heat: 2, minSeconds: 480, maxSeconds: 600, lines: [1, 3], checkpoint: "golden", sense: "look" });
    expect(body.steps?.[3]).toMatchObject({ phase: "prep", text: "Slice and serve" });
    expect(body.tools).toEqual(["Kadai"]);
  });
});

describe("Save recipe", () => {
  it("posts the draft, exactly, to the create route", () => {
    const fine = { ...DRAFT, lines: DRAFT.lines.map((l, i) => (i === 2 ? { ...l, quantity: 2, unit: "sprig" } : l)) };
    expect(photoSaveBody(fine)).toBe(fine);
    const plan = photoSavePlan(fine, formFromDraft(fine, [], keys()).form);
    expect(plan).toEqual({ kind: "post", body: fine });
  });

  it("opens the editor instead when the form would refuse it (a line with no amount)", () => {
    const start = formFromDraft(DRAFT, CHECKS, keys());
    const plan = photoSavePlan(DRAFT, start.form);
    expect(plan.kind).toBe("editor");
    if (plan.kind === "editor") expect(plan.errors.line[start.lineKeys[2]!]).toEqual({ quantity: "How much? Or To taste" });
  });

  it("puts the server's 422 on the line and step it names", () => {
    const start = formFromDraft(DRAFT, CHECKS, keys());
    const e = errorsFromDetails(
      { fields: { "lines[0].unit": ["Not a unit"], "steps[1].minSeconds": ["Too long"] } },
      { lineKeys: start.lineKeys, stepIndexes: [0, 1, 2, 3], toolIndexes: [0] },
      "Couldn't save",
    );
    expect(e.line[start.lineKeys[0]!]).toEqual({ unit: "Not a unit" });
    expect(e.stepField[1]).toEqual({ time: "Too long" });
  });
});

describe("Reading and the refusals", () => {
  it("says how the read is going", () => {
    expect(readingText(0)).toBe("Finding the ingredients…");
    expect(readingText(3000)).toBe("✓ Ingredients · reading the steps…");
    expect(readingText(9000)).toBe("✓ Ingredients · ✓ Steps · flames and timings…");
  });

  it("hides without a key, rests until the 1st on the budget, waits a day at the limit, else asks for a clearer photo", () => {
    expect(recipePhotoError({ code: "internal", reason: "ai_unavailable" }, 503)).toEqual({ kind: "unavailable", title: "AI isn't set up yet · type it in" });
    expect(recipePhotoError({ code: "internal" }, 503).kind).toBe("unavailable");
    expect(recipePhotoError({ code: "internal", details: { reason: "budget" } }, 503)).toEqual({ kind: "budget", title: "Cookpool AI is resting until the 1st · type it in" });
    expect(recipePhotoError({ code: "rate_limited", reason: "ai_daily_limit" }, 429)).toEqual({ kind: "limit", title: "You've used today's AI · try tomorrow" });
    expect(recipePhotoError({ code: "rate_limited" }, 429).kind).toBe("limit");
    expect(recipePhotoError({ code: "internal", reason: "ai_failed" }, 502)).toEqual({ kind: "failed", title: "Couldn't read this page · try a clearer photo or type it in" });
    expect(recipePhotoError(null).kind).toBe("failed");
    expect(PHOTO_UNUSABLE).toBe("Couldn't use this photo · try another");
  });
});
