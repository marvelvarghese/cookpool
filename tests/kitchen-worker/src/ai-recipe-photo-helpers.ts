// Recipe from a photo (cookpool-ai AI-4): scripted model reads of a recipe
// photo, built from short line and step makers, and the call that posts one.
// The photos are AI-3's (a few real header bytes and filler); the model is a
// stub.

import type { AiRecipePhotoResponse } from "@saas/contracts/kitchen";
import type { RecipeAnswer } from "@kitchen-worker/ai/recipe-draft";
import { answer, me, RAHUL, type AiWorld, type Result } from "./ai-helpers.js";
import { jpeg } from "./ai-receipt-helpers.js";

export const RECIPE_PHOTO = me("ai/recipe-photo");

export type ModelLine = RecipeAnswer["lines"][number];
export type ModelStep = RecipeAnswer["steps"][number];

/** A line as the model reads it: an amount in a unit unless said otherwise. */
export const ln = (name: string, quantity: number | null, unit: string | null, more: Partial<ModelLine> = {}): ModelLine => ({
  name,
  note: null,
  quantity,
  unit,
  toTaste: false,
  amountUnclear: false,
  ...more,
});

/** A step as the model reads it: a cook step of text only unless said otherwise. */
export const st = (text: string, more: Partial<ModelStep> = {}): ModelStep => ({
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
  unclear: [],
  ...more,
});

/** The model's whole answer: serves 2 and a name unless said otherwise. */
export function recipe(r: Partial<RecipeAnswer>): RecipeAnswer {
  return { name: "Dal", serves: 2, minutes: null, kind: null, lines: [], steps: [], tools: [], ...r };
}

/** The model's message answering `r`. */
export const readRecipe = (r: Partial<RecipeAnswer>, opts: { model?: string; usage?: Partial<Record<string, number>> } = {}) =>
  answer(recipe(r), opts);

/** Post `image` as RAHUL. */
export function postPhoto(w: AiWorld, image: unknown, as = RAHUL): Promise<Result<AiRecipePhotoResponse>> {
  return w.call<AiRecipePhotoResponse>("POST", RECIPE_PHOTO, as, { image });
}

/** Read one photo the model is scripted to read as `r`; 200 expected. */
export async function readPhotoAs(w: AiWorld, r: Partial<RecipeAnswer>): Promise<AiRecipePhotoResponse> {
  w.ai.script.push(readRecipe(r));
  const res = await postPhoto(w, jpeg());
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** A recipe as written on a card: toor dal tadka (the mapping tests' reference read). */
export const DAL_TADKA: Partial<RecipeAnswer> = {
  name: "Dal tadka",
  serves: 4,
  minutes: 40,
  kind: "dal_curry",
  lines: [
    ln("Toor dal", 1, "cup", { note: "washed" }),
    ln("Onions", 2, "pcs", { note: "finely chopped" }),
    ln("Garlic", 4, "cloves"),
    ln("Ghee", 2, "tablespoons"),
    ln("Turmeric", 0.5, "tsp"),
    ln("Salt", null, null, { toTaste: true }),
    ln("Water", 750, "ML"),
  ],
  steps: [
    st("Soak the dal for 30 minutes.", { phase: "prep", lines: [0], minSeconds: 1800, maxSeconds: 1800, handsOff: true }),
    st("Pressure cook the dal with turmeric, salt and water for 3 whistles.", {
      lines: [0, 4, 5, 6], heat: 3, whistles: 3, handsOff: true,
    }),
    st("Heat ghee, fry the garlic and onions until golden brown.", {
      lines: [3, 2, 1], heat: 2, minSeconds: 480, maxSeconds: 600, timeRule: "partly", sense: "look", checkpoint: "golden brown",
      tip: "Don't let the garlic burn.",
    }),
    st("Pour the tadka over the dal and serve."),
  ],
  tools: ["Pressure cooker", "Kadai", "kadai"],
};
