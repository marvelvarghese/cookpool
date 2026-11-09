// The stove's safety rules on their own (cookpool-ai AI-5, design §5a):
// what counts as saying food is safe to eat (and what, negated, does not),
// when an answer is about meat, eggs or seafood doneness, what says how to
// check, and how the check line is fitted within 60 words.

import { AI_STOVE_DONENESS_CHECK, AI_STOVE_SAY_MAX_WORDS } from "@saas/contracts/kitchen";
import {
  claimsSafeToEat,
  fitWords,
  isProteinDoneness,
  needsDonenessCheck,
  saysHowToCheck,
  withDonenessCheck,
  wordCount,
} from "@kitchen-worker/ai/stove-safety";
import { countedSeconds } from "@kitchen-worker/ai/transcribe";

describe("never 'safe to eat' (AI-5)", () => {
  it.each([
    "It's safe to eat now.",
    "Looks good, totally fine to eat.",
    "This is ok to serve.",
    "Don't worry, it's safe to eat.",
    "Yes. Safe for consumption.",
    "That won't make you sick.",
    "It is perfectly safe.",
    "The chicken is good to eat!",
  ])("claims it: %s", (text) => {
    expect(claimsSafeToEat(text)).toBe(true);
  });

  it.each([
    "I can't tell from a photo if it's safe to eat.",
    "A photo can't show whether it is safe to eat.",
    "It is not safe to eat yet: keep cooking.",
    "Never serve it pink. Cut the thickest piece.",
    "Add a pinch of salt and taste.",
    "Is it safe? Cut the thickest piece open to see.",
  ])("does not claim it: %s", (text) => {
    expect(claimsSafeToEat(text)).toBe(false);
  });
});

describe("meat, eggs and seafood doneness says how to check (AI-5)", () => {
  it("a question or an answer about doneness, with meat, eggs or seafood in the step or its lines", () => {
    expect(isProteinDoneness("Simmer\nChicken", "Is it done?")).toBe(true);
    expect(isProteinDoneness("Fry the prawns", "They look cooked.")).toBe(true);
    expect(isProteinDoneness("Scramble the eggs", "still runny?")).toBe(true);
    expect(isProteinDoneness("Fry the fish", "Is it ready?")).toBe(true);
    // Not about doneness, or nothing that needs checking.
    expect(isProteinDoneness("Simmer\nChicken", "How much salt?")).toBe(false);
    expect(isProteinDoneness("Fry the onions\nOnions", "Are they done?")).toBe(false);
    // A photo against a step that waits for doneness is about doneness whatever was asked.
    expect(isProteinDoneness("Simmer until the chicken is cooked through", "Looks good.", true)).toBe(true);
    expect(isProteinDoneness("Simmer until the chicken is cooked through", "Looks good.", false)).toBe(false);
  });

  it.each([
    "Cut the thickest piece open.",
    "No pink inside and the juices run clear.",
    "It should read 74 °C in the middle.",
    "Use a thermometer.",
    "The fish is opaque and flakes.",
    "The whites are set.",
    AI_STOVE_DONENESS_CHECK,
  ])("says how to check: %s", (text) => {
    expect(saysHowToCheck(text)).toBe(true);
  });

  it("needs the line only when it is about doneness and does not already say how", () => {
    expect(needsDonenessCheck("It looks done.", "Chicken", "Is it done?")).toBe(true);
    expect(needsDonenessCheck("Cut the thickest piece: no pink.", "Chicken", "Is it done?")).toBe(false);
    expect(needsDonenessCheck("Add salt.", "Chicken", "How much salt?")).toBe(false);
  });

  it("the line itself is short, says the thickest piece, no pink, clear juices and 74 °C", () => {
    for (const part of ["thickest piece", "no pink", "juices run clear", "74 °C", "chicken"]) expect(AI_STOVE_DONENESS_CHECK).toContain(part);
    expect(wordCount(AI_STOVE_DONENESS_CHECK)).toBeLessThan(25);
  });
});

describe("60 words (AI-5)", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("fitWords keeps what fits, cuts at the last sentence end, else at the limit with …", () => {
    expect(fitWords("Stir it.")).toBe("Stir it.");
    expect(fitWords(`${words(50)}. ${words(20)}.`)).toBe(`${words(50)}.`);
    expect(fitWords(words(70))).toBe(`${words(60)}…`);
    expect(wordCount(fitWords(words(70)))).toBe(AI_STOVE_SAY_MAX_WORDS);
  });

  it("withDonenessCheck makes room for the line", () => {
    const out = withDonenessCheck(`${words(50)}. More.`);
    expect(out.endsWith(AI_STOVE_DONENESS_CHECK)).toBe(true);
    expect(wordCount(out)).toBeLessThanOrEqual(AI_STOVE_SAY_MAX_WORDS);
    expect(withDonenessCheck("Looks done")).toBe(`Looks done. ${AI_STOVE_DONENESS_CHECK}`);
  });
});

describe("voice seconds (AI-5)", () => {
  it("the longer of declared and heard, whole seconds up", () => {
    expect(countedSeconds(4.2, null)).toBe(5);
    expect(countedSeconds(4, 4)).toBe(4);
    expect(countedSeconds(2, 6.01)).toBe(7);
    expect(countedSeconds(0.1, 0)).toBe(1);
  });
});
