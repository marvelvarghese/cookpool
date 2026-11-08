// Fixtures for guided mode's tests (cookpool-guided GC-5): RC-6's Chicken
// curry with guided steps, as GC-4 will write Cookpool's (prep, a hands-off
// rest, flames, ranges, rules, checkpoints, a tip, a learned range), and a
// rajma with long prep and a pressure cooker. Until GC-4 lands, these stand
// in for Cookpool's 42.

import type {
  KitchenRecipe,
  KitchenRecipeLine,
  KitchenRecipeStep,
  RecipeLastCook,
  RecipeMatchResponse,
} from "@saas/contracts/kitchen";
import { refreshTakes, type CookSession } from "@web-console-next/components/kitchen/cook-session";
import { guidedSessionFromRecipe } from "@web-console-next/components/kitchen/cook-guided";
import { FLAT, ME, MEERA, PERSONAL_REF, groupRef, makeItem } from "./kitchen-pantry-fixtures";

export const NOW = new Date("2026-11-08T12:00:00.000Z");
/** `NOW` plus `seconds`. */
export const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

export const CURRY_ID = "rcp_00000000000000000000000000000c01";
export const RAJMA_ID = "rcp_00000000000000000000000000000e03";

export const CHICKEN = makeItem({ name: "Chicken", pantry: PERSONAL_REF, unit: "kg", bought: "1", priceMinor: 28_000, paidBy: ME });
export const ONIONS = makeItem({ name: "Onions", pantry: groupRef(FLAT), unit: "kg", bought: "2", priceMinor: 8_000, paidBy: MEERA });
export const OIL = makeItem({ name: "Cooking oil", pantry: groupRef(FLAT), unit: "L", bought: "1", priceMinor: 18_500, paidBy: ME });
export const ITEMS = new Map([CHICKEN, ONIONS, OIL].map((i) => [i.id, i] as const));

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

/** A guided step: text only unless told otherwise. */
export function step(position: number, key: string, text: string, o: Partial<KitchenRecipeStep> = {}): KitchenRecipeStep {
  return {
    position,
    key,
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
    ...o,
  };
}

/** Chicken curry's guided steps: two prep (one a 15 min rest), eight cook steps, a simmer among them. */
export const CURRY_STEPS: KitchenRecipeStep[] = [
  step(0, "p-chop", "Chop the onions finely", { phase: "prep", lines: [1], minSeconds: 300, maxSeconds: 420, timeRule: "linear" }),
  step(1, "p-rub", "Rub the chicken with turmeric and salt, and let it rest", { phase: "prep", lines: [0, 4], minSeconds: 900, maxSeconds: 900, handsOff: true }),
  step(2, "c-oil", "Heat the oil", { lines: [5], heat: 2, minSeconds: 60, maxSeconds: 120, sense: "look", checkpoint: "it shimmers" }),
  step(3, "c-onions", "Add the onions and a pinch of salt. Stir now and then.", {
    lines: [1, 4],
    heat: 2,
    minSeconds: 480,
    maxSeconds: 600,
    timeRule: "partly",
    sense: "look",
    checkpoint: "golden brown",
    tip: "Do not rush them: browner onions, deeper curry.",
    learned: { lowSeconds: 420, highSeconds: 540, cooks: 23, samples: 40 },
  }),
  step(4, "c-sear", "Add the chicken and sear it", { lines: [0], heat: 3, minSeconds: 240, maxSeconds: 300, timeRule: "linear", sense: "look", checkpoint: "no pink left on the outside" }),
  step(5, "c-yogurt", "Stir in the yogurt and garam masala", { lines: [2, 3], heat: 1, sense: "smell", checkpoint: "the raw smell goes" }),
  step(6, "c-simmer", "Add the water, cover and simmer", { heat: 1, minSeconds: 1200, maxSeconds: 1200, handsOff: true, sense: "look", checkpoint: "it bubbles gently" }),
  step(7, "c-coriander", "Chop the coriander"),
  step(8, "c-check", "Cut the thickest piece open", { heat: 1, sense: "feel", checkpoint: "white right through" }),
  step(9, "c-salt", "Turn off the flame and taste for salt", { heat: 0, sense: "taste", checkpoint: "the salt is right" }),
];

/** Chicken curry serves 4: RC-6's six lines, with guided steps and tools. */
export const CURRY: KitchenRecipe = {
  id: CURRY_ID,
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
  lastCookedAt: null,
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
  steps: CURRY_STEPS.map((s) => s.text),
  guidedSteps: CURRY_STEPS,
  tools: ["Kadai with a lid", "Knife and board"],
  longPrep: [],
  linkCode: null,
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

/** RC-6's match at ×0.45: chicken 450 g, 2 onions, no yogurt, garam masala and salt on Always have, 1 tbsp oil. */
export const CURRY_MATCH: RecipeMatchResponse = {
  recipeId: CURRY_ID,
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

export const NO_LAST_COOK: RecipeLastCook | null = null;

/** The curry's session at ×0.45, its items read: at the prompt. */
export function curry(): CookSession {
  return refreshTakes(guidedSessionFromRecipe(CURRY, NO_LAST_COOK, CURRY_MATCH, NOW), ITEMS);
}

/** Rajma: soak 8 h first, then a pressure cooker for 3 whistles (cooks usually take 12–14 min), the pressure dropping, the masala. */
export const RAJMA_STEPS: KitchenRecipeStep[] = [
  step(0, "r-soak", "Soak the rajma in plenty of water", { phase: "prep", lines: [0], minSeconds: 28_800, maxSeconds: 28_800, handsOff: true }),
  step(1, "r-cooker", "Pressure-cook the rajma with 3 cups of water", {
    lines: [0],
    heat: 3,
    whistles: 3,
    handsOff: true,
    learned: { lowSeconds: 720, highSeconds: 840, cooks: 6, samples: 9 },
  }),
  step(2, "r-drop", "Let the pressure drop on its own", { heat: 0, minSeconds: 600, maxSeconds: 600, handsOff: true }),
  step(3, "r-masala", "Fry the onion and tomato masala", { heat: 2, minSeconds: 360, maxSeconds: 480, sense: "look", checkpoint: "the oil shows at the edges" }),
];

export const RAJMA: KitchenRecipe = {
  ...CURRY,
  id: RAJMA_ID,
  name: "Rajma",
  lineCount: 1,
  main: { position: 0, foodKey: "rajma", name: "Rajma", qtyMilli: 200_000, quantity: 200, unit: "g" },
  lines: [line(0, { name: "Rajma", qtyMilli: 200_000, quantity: 200, unit: "g", dimension: "mass", isMain: true })],
  steps: RAJMA_STEPS.map((s) => s.text),
  guidedSteps: RAJMA_STEPS,
  tools: ["Pressure cooker"],
  longPrep: [{ position: 0, key: "r-soak", seconds: 28_800, text: "Soak the rajma in plenty of water" }],
};

export const RAJMA_MATCH: RecipeMatchResponse = {
  recipeId: RAJMA_ID,
  factorMilli: 1000,
  portions: { portionsHalf: 8, about: false, label: "4" },
  lines: [{ position: 0, status: "always", needMilli: 200_000, needQuantity: 200, unit: "g", availableMilli: 0, items: [] }],
  summary: { lines: 1, have: 0, short: 0, missing: 0, always: 1, missingNames: [], maxFactorMilli: null },
  unlinked: [],
};

/** Rajma as written, at the prompt. */
export function rajma(): CookSession {
  return guidedSessionFromRecipe(RAJMA, null, RAJMA_MATCH, NOW);
}
