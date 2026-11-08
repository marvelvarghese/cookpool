import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RecipeStepInput } from "@saas/contracts/kitchen";
import { MAX_RECIPE_TOOLS, MAX_STEP_SECONDS } from "@saas/contracts/kitchen";
import {
  addStep,
  addTool,
  errorsFromDetails,
  formFromRecipe,
  initialRecipeForm,
  lineChip,
  moveLine,
  noErrors,
  recipeRequest,
  removeLine,
  removeStep,
  removeTool,
  setStep,
  stepHasErrors,
  stepLineChoices,
  toolProblem,
  updateStep,
  type RecipeForm,
} from "@web-console-next/components/kitchen/recipe-form";
import {
  blankStep,
  isPlainDraft,
  minuteStep,
  pickHeat,
  pickSense,
  pickTimeKind,
  stepPreview,
  stepRange,
  stepSeconds,
  stepSummary,
  stepWhistles,
  toggleStepLine,
  type StepDraft,
} from "@web-console-next/components/kitchen/step-editor";
import { checkpointText } from "@web-console-next/components/kitchen/guided-steps";
import { PreviewCard, StepsEditor, ToolsEditor } from "@web-console-next/components/kitchen/step-editor-ui";
import { CURRY_STEPS, guidedCurry } from "./kitchen-guided-fixtures";
import { recipe } from "./kitchen-recipe-fixtures";

// cookpool-guided GC-6 (design §1, the canvas's `GuideEditor`): each step of
// the recipe form is a guided step — phase, what to do, the lines that go in
// now, flame, minutes or whistles, hands off, the rule, the checkpoint and a
// tip — saved with the key it was read with, so keys survive edits; and the
// recipe's tools. The server's 422 lands on the step's part it names.

function keys() {
  let n = 0;
  return () => `k${(n += 1)}`;
}

const MIN = 60;

/** The curry's edit form, as it starts. */
function curryForm(): RecipeForm {
  return formFromRecipe(guidedCurry(), keys());
}

/** The steps the form sends, as objects (a plain step is its text). */
function sentSteps(f: RecipeForm) {
  const r = recipeRequest(f);
  expect(r.body).not.toBeNull();
  return r.body!.steps!;
}

/** A form with the curry's lines and one new step, changed by `change`, and that step as it is sent. */
function oneStep(change: (d: StepDraft) => StepDraft): string | RecipeStepInput {
  let f = formFromRecipe(recipe({ steps: [] }), keys());
  f = addStep(f, "new");
  f = updateStep(f, "new", (d) => change({ ...d, text: "Fry the onions" }));
  return sentSteps(f)[0]!;
}

describe("a recipe's guided steps, as the edit form starts", () => {
  it("holds every step with its key, and its lines as the form's line keys", () => {
    const f = curryForm();
    expect(f.steps.map((s) => s.key)).toEqual(CURRY_STEPS.map((s) => s.key));
    const onions = f.steps[1]!;
    expect(onions.lines).toEqual([f.lines[1]!.key, f.lines[7]!.key]);
    expect(onions).toMatchObject({ text: "Fry the onions with the salt until golden.", heat: 2, timeKind: "minutes", minSeconds: 600, maxSeconds: 720, timeRule: "partly", sense: "look", checkpoint: "golden brown" });
    expect(f.steps[5]).toMatchObject({ handsOff: true, timeKind: "minutes", minSeconds: 1200, maxSeconds: 1200 });
    expect(f.steps[7]).toMatchObject({ heat: 0, timeKind: "none", sense: "taste", checkpoint: "salty enough" });
    expect(f.tools).toEqual(["Kadai with a lid", "Wooden spoon"]);
  });

  it("sends every step back as it was read: its key and every field, its lines as positions", () => {
    const steps = sentSteps(curryForm());
    expect(steps).toHaveLength(CURRY_STEPS.length);
    steps.forEach((s, i) => {
      const read = CURRY_STEPS[i]!;
      expect(s).toEqual({
        key: read.key,
        text: read.text,
        phase: read.phase,
        lines: read.lines,
        heat: read.heat,
        minSeconds: read.minSeconds,
        maxSeconds: read.maxSeconds,
        whistles: read.whistles,
        handsOff: read.handsOff,
        timeRule: read.timeRule,
        sense: read.sense,
        checkpoint: read.checkpoint,
        tip: read.tip,
      });
    });
    expect(recipeRequest(curryForm()).body!.tools).toEqual(["Kadai with a lid", "Wooden spoon"]);
  });

  it("reads a recipe with no guidedSteps (cached before GC-2) as text-only steps, sent as texts", () => {
    const f = formFromRecipe(recipe(), keys());
    expect(f.steps.every((s) => s.key === null && isPlainDraft(s))).toBe(true);
    expect(recipeRequest(f).body!.steps).toEqual(recipe().steps);
    expect(f.tools).toEqual([]);
  });

  it("keeps a whistle step's count", () => {
    const f = formFromRecipe(guidedCurry({ guidedSteps: [{ ...CURRY_STEPS[5]!, minSeconds: null, maxSeconds: null, whistles: 3 }] }), keys());
    expect(f.steps[0]).toMatchObject({ timeKind: "whistles", whistles: 3 });
    expect(sentSteps(f)[0]).toMatchObject({ key: "key5", whistles: 3, minSeconds: null, maxSeconds: null });
  });
});

describe("each field of the editor, into the write body", () => {
  it("Prep | Cook", () => {
    expect(oneStep((d) => ({ ...d, phase: "prep" }))).toMatchObject({ phase: "prep" });
  });

  it("What to do: the words, trimmed", () => {
    expect(oneStep((d) => ({ ...d, heat: 1, text: "  Fry them.  " }))).toMatchObject({ text: "Fry them." });
  });

  it("Goes in now: the lines toggled, as positions in the lines sent", () => {
    let f = formFromRecipe(recipe({ steps: [] }), keys());
    f = addStep(f, "new");
    f = setStep(f, 0, "Add the onions and salt");
    f = updateStep(f, "new", (d) => toggleStepLine(toggleStepLine(toggleStepLine(d, f.lines[7]!.key), f.lines[1]!.key), f.lines[3]!.key));
    f = updateStep(f, "new", (d) => toggleStepLine(d, f.lines[3]!.key));
    expect(sentSteps(f)[0]).toMatchObject({ lines: [1, 7] });
  });

  it("Flame: Off · Low · Medium · High, and picking the one on again says no flame", () => {
    expect(oneStep((d) => pickHeat(d, 0))).toMatchObject({ heat: 0 });
    expect(oneStep((d) => pickHeat(d, 3))).toMatchObject({ heat: 3 });
    expect(oneStep((d) => pickHeat(pickHeat(d, 2), 2))).toBe("Fry the onions");
  });

  it("Time: a range in minutes, or a whistle count — never both", () => {
    const range = oneStep((d) => stepRange(stepRange(pickTimeKind(d, "minutes"), "max", 1), "min", -1));
    // 8–10 min: the longest up a step (5 min from 10), the shortest down one.
    expect(range).toMatchObject({ minSeconds: 7 * MIN, maxSeconds: 15 * MIN, whistles: null });
    const whistles = oneStep((d) => stepWhistles(pickTimeKind(stepRange(d, "min", 1), "whistles"), 1));
    expect(whistles).toMatchObject({ whistles: 4, minSeconds: null, maxSeconds: null });
    expect(oneStep((d) => pickTimeKind(pickTimeKind(d, "minutes"), "none"))).toBe("Fry the onions");
  });

  it("Hands off", () => {
    expect(oneStep((d) => ({ ...d, handsOff: true }))).toMatchObject({ handsOff: true });
  });

  it("More food takes: Same time · A bit longer · Longer (fixed, partly, linear)", () => {
    for (const timeRule of ["fixed", "partly", "linear"] as const) {
      expect(oneStep((d) => ({ ...pickTimeKind(d, "minutes"), timeRule }))).toMatchObject({ timeRule, minSeconds: 8 * MIN });
    }
  });

  it("Done when: a sense and what to watch for — the sense only with a checkpoint", () => {
    expect(oneStep((d) => ({ ...pickSense(d, "smell"), checkpoint: " the raw smell goes " }))).toMatchObject({ sense: "smell", checkpoint: "the raw smell goes" });
    expect(oneStep((d) => ({ ...d, checkpoint: "golden brown" }))).toMatchObject({ sense: null, checkpoint: "golden brown" });
    expect(oneStep((d) => ({ ...pickSense(d, "look"), heat: 2 }))).toMatchObject({ sense: null, checkpoint: null });
    expect(oneStep((d) => ({ ...pickSense(pickSense(d, "look"), "look"), checkpoint: "soft" }))).toMatchObject({ sense: null });
  });

  it("Tip", () => {
    expect(oneStep((d) => ({ ...d, tip: " Don't rush them. " }))).toMatchObject({ tip: "Don't rush them." });
  });

  it("sends a new guided step without a key (the server mints one), and a new text-only step as its words", () => {
    const guided = oneStep((d) => ({ ...d, heat: 2 }));
    expect(guided).not.toHaveProperty("key");
    expect(oneStep((d) => d)).toBe("Fry the onions");
  });
});

describe("keys survive edits", () => {
  it("keeps every step's key when its words, flame and time change", () => {
    let f = curryForm();
    f = setStep(f, 1, "Fry the onions slowly until deep golden.");
    f = updateStep(f, f.steps[1]!.id, (d) => stepRange(pickHeat(d, 1), "max", 1));
    const steps = sentSteps(f) as RecipeStepInput[];
    expect(steps.map((s) => s.key)).toEqual(CURRY_STEPS.map((s) => s.key));
    expect(steps[1]).toMatchObject({ key: "key1", text: "Fry the onions slowly until deep golden.", heat: 1, maxSeconds: 15 * MIN });
  });

  it("keeps the other keys when a step comes out, and a step's lines follow the lines as they move or go", () => {
    let f = curryForm();
    f = removeStep(f, 0);
    f = moveLine(f, f.lines[1]!.key, -1); // Onions up, above Chicken
    f = removeLine(f, f.lines[7]!.key, keys()); // Salt out
    const steps = sentSteps(f) as RecipeStepInput[];
    expect(steps.map((s) => s.key)).toEqual(CURRY_STEPS.slice(1).map((s) => s.key));
    // Onions are line 0 now and Salt is gone; Chicken (the sear) is line 1.
    expect(steps[0]).toMatchObject({ key: "key1", lines: [0] });
    expect(steps[3]).toMatchObject({ key: "key4", lines: [1] });
  });

  it("leaves out a blank step of text only, but asks for words on a guided step without any", () => {
    let f = curryForm();
    f = addStep(f, "blank");
    expect(recipeRequest(f).stepIndexes).toHaveLength(CURRY_STEPS.length);
    f = updateStep(f, "blank", (d) => pickHeat(d, 2));
    const r = recipeRequest(f);
    expect(r.body).toBeNull();
    expect(r.errors.step[CURRY_STEPS.length]).toBe("Say what to do");
    expect(stepHasErrors(r.errors, CURRY_STEPS.length)).toBe(true);
    expect(stepHasErrors(r.errors, 0)).toBe(false);
  });
});

describe("the server's 422, on the step editor", () => {
  let f = curryForm();
  f = setStep(f, 0, "");
  f = updateStep(f, f.steps[0]!.id, () => blankStep(f.steps[0]!.id)); // a blank step: left out, so steps[i] is step i + 1
  f = { ...f, tools: ["", "Kadai", "Tawa"] };
  const request = recipeRequest(f);

  it("lands each field on its step's part, blanks left out counted", () => {
    expect(request.stepIndexes[0]).toBe(1);
    expect(request.toolIndexes).toEqual([1, 2]);
    const errors = errorsFromDetails(
      {
        fields: {
          "steps[0].minSeconds": ["Must be seconds"],
          "steps[1].lines": ["The recipe has 8 lines"],
          "steps[2].sense": ["Say the checkpoint it is the sense of"],
          "steps[3].heat": ["Must be the flame"],
          "steps[4].text": ["Must be at most 200 characters"],
          "steps[5]": ["Must be the step's text"],
          "steps[6].tip": ["Must be at most 160 characters"],
          "tools[1]": ["Name each tool once"],
        },
      },
      request,
      "Validation failed",
    );
    expect(errors.stepField[1]).toEqual({ time: "Must be seconds" });
    expect(errors.stepField[2]).toEqual({ lines: "The recipe has 8 lines" });
    expect(errors.stepField[3]).toEqual({ checkpoint: "Say the checkpoint it is the sense of" });
    expect(errors.stepField[4]).toEqual({ heat: "Must be the flame" });
    expect(errors.step[5]).toBe("Must be at most 200 characters");
    expect(errors.step[6]).toBe("Must be the step's text");
    expect(errors.stepField[7]).toEqual({ tip: "Must be at most 160 characters" });
    expect(errors.tool[2]).toBe("Name each tool once");
    expect(errors.other).toBeUndefined();
  });

  it("puts what names no step or tool it sent on the list as a whole", () => {
    expect(errorsFromDetails({ fields: { "steps[40].tip": ["Gone"] } }, request, "x").steps).toBe("Gone");
    expect(errorsFromDetails({ fields: { "tools[9]": ["Gone"] } }, request, "x").tools).toBe("Gone");
    expect(errorsFromDetails({ fields: { tools: ["At most 10 tools"] } }, request, "x").tools).toBe("At most 10 tools");
    expect(errorsFromDetails({ fields: { "steps[0].maxSeconds": ["Must be at least minSeconds"], "steps[0].whistles": ["Not both"] } }, request, "x").stepField[1]).toEqual({
      time: "Not both",
    });
  });
});

describe("the time stepper", () => {
  it("moves a minute under 10 min, 5 under an hour, 15 under 3 h, then an hour", () => {
    expect([minuteStep(9 * MIN, 1), minuteStep(10 * MIN, 1), minuteStep(60 * MIN, 1), minuteStep(180 * MIN, 1)]).toEqual([1, 5, 15, 60]);
    expect([minuteStep(10 * MIN, -1), minuteStep(60 * MIN, -1), minuteStep(180 * MIN, -1), minuteStep(181 * MIN, -1)]).toEqual([1, 5, 15, 60]);
    expect(stepSeconds(10 * MIN, 1)).toBe(15 * MIN);
    expect(stepSeconds(15 * MIN, -1)).toBe(10 * MIN);
    expect(stepSeconds(8 * 60 * MIN, 1)).toBe(9 * 60 * MIN);
    // Onto the grid from a time between (a 30 s tempering), never under a minute or past a day.
    expect(stepSeconds(30, 1)).toBe(MIN);
    expect(stepSeconds(MIN, -1)).toBe(MIN);
    expect(stepSeconds(MAX_STEP_SECONDS, 1)).toBe(MAX_STEP_SECONDS);
  });

  it("keeps the shortest no longer than the longest, either end pushing the other", () => {
    const d = { ...blankStep("s"), minSeconds: 8 * MIN, maxSeconds: 8 * MIN };
    expect(stepRange(d, "min", 1)).toMatchObject({ timeKind: "minutes", minSeconds: 9 * MIN, maxSeconds: 9 * MIN });
    expect(stepRange(d, "max", -1)).toMatchObject({ minSeconds: 7 * MIN, maxSeconds: 7 * MIN });
    expect(stepRange(d, "max", 1)).toMatchObject({ minSeconds: 8 * MIN, maxSeconds: 9 * MIN });
  });

  it("counts whistles from 1 to 10", () => {
    let d = blankStep("s");
    for (let i = 0; i < 12; i++) d = stepWhistles(d, 1);
    expect(d.whistles).toBe(10);
    for (let i = 0; i < 12; i++) d = stepWhistles(d, -1);
    expect(d).toMatchObject({ timeKind: "whistles", whistles: 1 });
  });
});

describe("the live preview: what the cook sees at the recipe's size", () => {
  const f = curryForm();
  const chipOf = (key: string) => stepLineChoices(f).find((c) => c.key === key)?.chip ?? null;

  it("says the flame and time in words, the text and its chips as written, and the checkpoint", () => {
    const p = stepPreview({ ...f.steps[1]!, handsOff: true, minSeconds: 8 * MIN, maxSeconds: 10 * MIN }, f.servesHalf, chipOf);
    expect(p.label).toBe("The cook sees · serves 4");
    expect(p.heading).toBe("Medium flame · 8–10 min · Hands off");
    expect(p.text).toBe("Fry the onions with the salt until golden.");
    expect(p.chips).toEqual(["3 onions", "Salt"]);
    expect(p.checkpoint).toBe("Until it looks golden brown");
    expect(p.tip).toBe("Don't rush them: browner onions, deeper curry.");
  });

  it("reads one time, whistles, flame off, prep and a sentence of a checkpoint", () => {
    expect(stepPreview(f.steps[0]!, 8, chipOf)).toMatchObject({ heading: "Medium flame · 2 min", chips: ["3 tbsp cooking oil"], checkpoint: "Until it shimmers" });
    expect(stepPreview(f.steps[2]!, 8, chipOf)).toMatchObject({ heading: "Low flame · 1 min", chips: ["2 tbsp ginger-garlic paste"], checkpoint: "Until the raw smell goes" });
    expect(stepPreview({ ...f.steps[5]!, timeKind: "whistles", whistles: 3 }, 8, chipOf).heading).toBe("Low flame · 3 whistles · Hands off");
    expect(stepPreview(f.steps[7]!, 8, chipOf)).toMatchObject({ heading: "Flame off", checkpoint: "Until it tastes salty enough" });
    expect(stepPreview(f.steps[6]!, 8, chipOf)).toMatchObject({ phase: "Prep", heading: "2 min", checkpoint: null });
    expect(stepPreview(blankStep("s"), 3, chipOf)).toMatchObject({ label: "The cook sees · serves 1½", heading: null, text: "Say what to do", chips: [] });
  });

  it("draws it", () => {
    const html = renderToStaticMarkup(React.createElement(PreviewCard, { preview: stepPreview({ ...f.steps[1]!, handsOff: true }, 8, chipOf) }));
    expect(html).toContain("The cook sees · serves 4");
    expect(html).toContain("Medium flame · 10–12 min · Hands off");
    expect(html).toContain("3 onions");
    expect(html).toContain("Until it looks golden brown");
  });

  it("names the checkpoint by its sense, or as the sentence it is", () => {
    expect(checkpointText("look", "golden brown")).toBe("Until it looks golden brown");
    expect(checkpointText(null, "golden brown")).toBe("Until golden brown");
    expect(checkpointText("feel", "soft")).toBe("Until it feels soft");
    expect(checkpointText("sound", "it stops sizzling")).toBe("Until it stops sizzling");
    expect(checkpointText("look", "Until golden")).toBe("Until it looks golden");
    expect(checkpointText("look", "  ")).toBeNull();
  });

  it("gives each line its chip as written, for the lines with words", () => {
    expect(stepLineChoices(f).map((c) => c.chip)).toEqual(["1 kg chicken", "3 onions", "2 tomatoes", "200 g yogurt", "2 tbsp ginger-garlic paste", "3 tbsp cooking oil", "1 tsp garam masala", "Salt"]);
    expect(lineChip({ ...f.lines[1]!, name: "  " })).toBeNull();
    expect(lineChip({ ...f.lines[1]!, quantity: "" })).toBe("Onions");
  });

  it("sums a folded step up in one line", () => {
    expect(stepSummary(f.steps[1]!)).toBe("Medium flame · 10–12 min · Until it looks golden brown");
    expect(stepSummary(f.steps[5]!)).toBe("Low flame · 20 min · Hands off");
    expect(stepSummary(f.steps[6]!)).toBe("Prep · 2 min");
    expect(stepSummary(blankStep("s", "Serve."))).toBeNull();
  });
});

describe("the step editor as it draws", () => {
  const f = curryForm();
  const props = {
    steps: f.steps,
    choices: stepLineChoices(f),
    servesHalf: f.servesHalf,
    onAdd: () => null,
    onText: () => undefined,
    onChange: () => undefined,
    onRemove: () => undefined,
  };

  it("folds each step to its words and what is set", () => {
    const html = renderToStaticMarkup(React.createElement(StepsEditor, { ...props, errors: noErrors() }));
    expect(html).toContain("Steps · 8");
    expect(html).toContain("Medium flame · 10–12 min · Until it looks golden brown");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("GOES IN NOW");
  });

  it("opens a step with an error, every field there and the error on its part", () => {
    const errors = { ...noErrors(), stepField: { 1: { time: "Must be seconds" } } };
    const html = renderToStaticMarkup(React.createElement(StepsEditor, { ...props, errors }));
    for (const words of ["Prep", "Cook", "What to do", "GOES IN NOW", "Flame", "Medium", "Minutes", "Whistles", "Shortest", "Longest", "Hands off", "The cook can do the next steps meanwhile", "MORE FOOD TAKES", "A bit longer", "Done when", "Smell", "Tip", "Must be seconds", "The cook sees · serves 4"]) {
      expect(html).toContain(words);
    }
    expect(html).toMatch(/aria-pressed="true"[^>]*>A bit longer/);
    expect(html).toContain("✓ </span>Onions");
  });
});

describe("tools", () => {
  it("adds a short name once, up to 10, and takes one out", () => {
    let f = initialRecipeForm(keys());
    f = addTool(f, "  Kadai with a lid ");
    f = addTool(f, "kadai WITH a lid");
    f = addTool(f, "   ");
    expect(f.tools).toEqual(["Kadai with a lid"]);
    expect(toolProblem(f.tools, "Kadai with a lid")).toBe("Already on the list");
    expect(toolProblem(f.tools, "x".repeat(41))).toBe("Keep it to 40 characters");
    for (let i = 0; i < 12; i++) f = addTool(f, `Tool ${i}`);
    expect(f.tools).toHaveLength(MAX_RECIPE_TOOLS);
    expect(toolProblem(f.tools, "One more")).toBe("At most 10 tools");
    f = removeTool(f, 0);
    expect(f.tools[0]).toBe("Tool 0");
  });

  it("sends them in order, every time (a PATCH replaces the list); blanks left out, a repeat refused", () => {
    const base = { ...initialRecipeForm(keys()), name: "Tea" };
    const f: RecipeForm = { ...base, lines: [{ ...base.lines[0]!, name: "Water", quantity: "500", unit: "ml" }] };
    expect(recipeRequest(f).body!.tools).toEqual([]);
    expect(recipeRequest({ ...f, tools: ["Pan", " ", "Strainer"] }).body!.tools).toEqual(["Pan", "Strainer"]);
    const twice = recipeRequest({ ...f, tools: ["Pan", "pan"] });
    expect(twice.body).toBeNull();
    expect(twice.errors.tool[1]).toBe("Already on the list");
  });

  it("draws the list, each with its ×, and Add", () => {
    const html = renderToStaticMarkup(React.createElement(ToolsEditor, { tools: ["Kadai with a lid"], errors: {}, error: undefined, onAdd: () => undefined, onRemove: () => undefined }));
    expect(html).toContain("Tools");
    expect(html).toContain("1 of 10");
    expect(html).toContain("Kadai with a lid");
    expect(html).toContain('aria-label="Remove Kadai with a lid"');
    expect(html).toContain(">Add<");
    const wrong = renderToStaticMarkup(React.createElement(ToolsEditor, { tools: ["Kadai"], errors: { 0: "Name each tool once" }, error: undefined, onAdd: () => undefined, onRemove: () => undefined }));
    expect(wrong).toContain("Kadai: Name each tool once");
  });
});
