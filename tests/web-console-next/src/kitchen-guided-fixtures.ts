import type { KitchenRecipe, KitchenRecipeStep } from "@saas/contracts/kitchen";
import { longPrepOf } from "@saas/contracts/kitchen";
import type { GuidedStep, LearnedRange } from "@web-console-next/components/kitchen/guided-steps";
import { CURRY_LINES, line, recipe } from "./kitchen-recipe-fixtures";

// Guided recipes for the GC-6 screens' tests (until GC-4 rewrites Cookpool's
// own): the canvas's Chicken curry in eight guided steps — the `GuideTimeline`
// board's — and a Rajma that soaks overnight first. Times are at the
// recipe's own size (1 kg of chicken, serves 4).

/** A guided step as the server reads it back; `learned` as GC-7 will send it. */
export function step(position: number, text: string, patch: Partial<KitchenRecipeStep> & { learned?: LearnedRange | null } = {}): GuidedStep {
  return {
    position,
    key: `key${position}`,
    text,
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
    ...patch,
  };
}

const MIN = 60;

/** The curry's steps: positions name CURRY_LINES (0 chicken, 1 onions, 2 tomatoes, 3 yogurt, 4 paste, 5 oil, 6 garam masala, 7 salt). */
export const CURRY_STEPS: GuidedStep[] = [
  step(0, "Heat the oil", { heat: 2, lines: [5], minSeconds: 2 * MIN, maxSeconds: 2 * MIN, sense: "look", checkpoint: "it shimmers" }),
  step(1, "Fry the onions with the salt until golden.", {
    heat: 2, lines: [1, 7], minSeconds: 10 * MIN, maxSeconds: 12 * MIN, timeRule: "partly", sense: "look", checkpoint: "golden brown",
    tip: "Don't rush them: browner onions, deeper curry.", learned: { lowSeconds: 10 * MIN, highSeconds: 13 * MIN, cooks: 23 },
  }),
  step(2, "Add the ginger-garlic paste", { heat: 1, lines: [4], minSeconds: 1 * MIN, maxSeconds: 1 * MIN, sense: "smell", checkpoint: "the raw smell goes" }),
  step(3, "Tomato and masala, until the oil shows", { heat: 2, lines: [2, 6], minSeconds: 6 * MIN, maxSeconds: 8 * MIN, timeRule: "partly", sense: "look", checkpoint: "the oil shows at the edges" }),
  step(4, "Sear the chicken", { heat: 3, lines: [0], minSeconds: 5 * MIN, maxSeconds: 7 * MIN, timeRule: "partly" }),
  step(5, "Stir in the yogurt and simmer, covered", { heat: 1, lines: [3], minSeconds: 20 * MIN, maxSeconds: 20 * MIN, handsOff: true }),
  step(6, "Chop the coriander", { phase: "prep", minSeconds: 2 * MIN, maxSeconds: 2 * MIN }),
  step(7, "Flame off, coriander, taste.", { heat: 0, sense: "taste", checkpoint: "salty enough" }),
];

/** The canvas's Chicken curry with guided steps and its tools. */
export function guidedCurry(patch: Partial<KitchenRecipe> = {}): KitchenRecipe {
  const guidedSteps = patch.guidedSteps ?? CURRY_STEPS;
  return recipe({
    steps: guidedSteps.map((s) => s.text),
    guidedSteps,
    tools: ["Kadai with a lid", "Wooden spoon"],
    longPrep: longPrepOf(guidedSteps),
    ...patch,
  });
}

export const RAJMA_LINES = [
  line(0, "Rajma", 200, "g", { isMain: true }),
  line(1, "Onions", 1, "onion"),
  line(2, "Salt", null, null),
];

/** Rajma: soak overnight (long prep), then three whistles, then a simmer. */
export const RAJMA_STEPS: GuidedStep[] = [
  step(0, "Soak the rajma overnight", { phase: "prep", handsOff: true, lines: [0], minSeconds: 8 * 60 * MIN, maxSeconds: 10 * 60 * MIN }),
  step(1, "Chop the onion", { phase: "prep", lines: [1], minSeconds: 3 * MIN, maxSeconds: 4 * MIN }),
  step(2, "Pressure-cook with the salt", { heat: 3, lines: [0, 2], whistles: 3, handsOff: true, sense: "sound", checkpoint: "the third whistle" }),
  step(3, "Fry the onion", { heat: 2, minSeconds: 6 * MIN, maxSeconds: 8 * MIN, timeRule: "partly" }),
  step(4, "Simmer it all together", { heat: 1, minSeconds: 15 * MIN, maxSeconds: 20 * MIN, handsOff: true }),
];

export function rajma(patch: Partial<KitchenRecipe> = {}): KitchenRecipe {
  const guidedSteps = patch.guidedSteps ?? RAJMA_STEPS;
  return recipe({
    id: "rcp_rajma",
    name: "Rajma",
    lines: RAJMA_LINES,
    main: { position: 0, foodKey: "rajma", name: "Rajma", qtyMilli: 200_000, quantity: 200, unit: "g" },
    lineCount: 3,
    steps: guidedSteps.map((s) => s.text),
    guidedSteps,
    tools: ["Pressure cooker"],
    longPrep: longPrepOf(guidedSteps),
    ...patch,
  });
}

export { CURRY_LINES };
