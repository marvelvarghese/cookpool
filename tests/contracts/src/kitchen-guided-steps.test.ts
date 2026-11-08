import type {
  CookDishRequest,
  CreateRecipeRequest,
  KitchenRecipe,
  KitchenRecipeStep,
  RecipeStepInput,
  StepTimeRule,
  UpdateRecipeRequest,
  UpdateStepTimesRequest,
} from "@saas/contracts/kitchen";
import {
  LONG_PREP_SECONDS,
  MAX_RECIPE_STEPS,
  MAX_STEP_LOG,
  MAX_STEP_SECONDS,
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_MIN_FACTOR_MILLI,
  STEP_KEY_RE,
  STEP_PHASES,
  STEP_SENSES,
  STEP_TIME_RULES,
  isLongPrep,
  longPrepOf,
  stepTimeAt,
  stepTimeMultiplier,
} from "@saas/contracts/kitchen";
import * as recipes from "@saas/contracts/kitchen-recipes";

// Guided steps (Cookpool GC-2, cookpool-guided design §1, §2): a step's time
// at a size — fixed, partly (× f^0.5) or linear (× f), rounded to whole
// minutes, never under one, min ≤ max, whistles never scaled — pinned by
// examples and by properties over many seeded random cases; long prep; and
// the shapes of the routes.

/** A small deterministic generator (mulberry32), so a failing case is the same every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const factorFrom = (rand: () => number) =>
  RECIPE_MIN_FACTOR_MILLI + Math.floor(rand() * (RECIPE_MAX_FACTOR_MILLI - RECIPE_MIN_FACTOR_MILLI + 1));
const ruleFrom = (rand: () => number): StepTimeRule => STEP_TIME_RULES[Math.floor(rand() * STEP_TIME_RULES.length)]!;
/** A written range in seconds, anything a step may say: 0 to a day, min ≤ max. */
function rangeFrom(rand: () => number): { minSeconds: number; maxSeconds: number } {
  const a = Math.floor(rand() * (MAX_STEP_SECONDS + 1));
  const b = Math.floor(rand() * (MAX_STEP_SECONDS + 1));
  return { minSeconds: Math.min(a, b), maxSeconds: Math.max(a, b) };
}
/** A written range on the minute grid, at least a minute: what an author writes ("8–10 min"). */
function minutesFrom(rand: () => number): { minSeconds: number; maxSeconds: number } {
  const a = 1 + Math.floor(rand() * 240);
  const b = a + Math.floor(rand() * 60);
  return { minSeconds: a * 60, maxSeconds: b * 60 };
}
const range = (t: ReturnType<typeof stepTimeAt>) => t as { minSeconds: number; maxSeconds: number };

describe("contracts: a step's time at a size (GC-2, design §2)", () => {
  it("keeps a fixed step as written, grows a partly one by √f and a linear one by f, in whole minutes", () => {
    const fry = { minSeconds: 480, maxSeconds: 600, timeRule: "fixed" as const };
    expect(stepTimeAt(fry, 450)).toEqual({ minSeconds: 480, maxSeconds: 600 });
    expect(stepTimeAt(fry, 2_000)).toEqual({ minSeconds: 480, maxSeconds: 600 });
    const simmer = { minSeconds: 1_200, maxSeconds: 1_500, timeRule: "partly" as const };
    expect(stepTimeAt(simmer, 4_000)).toEqual({ minSeconds: 2_400, maxSeconds: 3_000 }); // × 2
    expect(stepTimeAt(simmer, 450)).toEqual({ minSeconds: 780, maxSeconds: 1_020 }); // × 0.67: 13–17 min
    const brown = { minSeconds: 600, maxSeconds: 900, timeRule: "linear" as const };
    expect(stepTimeAt(brown, 2_000)).toEqual({ minSeconds: 1_200, maxSeconds: 1_800 });
    expect(stepTimeAt(brown, 450)).toEqual({ minSeconds: 300, maxSeconds: 420 }); // 4.5 min rounds up to 5, 6.75 to 7
    // No rule said is fixed.
    expect(stepTimeAt({ minSeconds: 480, maxSeconds: 600 }, 2_000)).toEqual({ minSeconds: 480, maxSeconds: 600 });
  });

  it("rounds to the nearest minute, halves up, and never under one minute", () => {
    expect(stepTimeAt({ minSeconds: 30, maxSeconds: 30 }, 1_000)).toEqual({ minSeconds: 60, maxSeconds: 60 }); // a 30 s tempering
    expect(stepTimeAt({ minSeconds: 0, maxSeconds: 0 }, 1_000)).toEqual({ minSeconds: 60, maxSeconds: 60 });
    expect(stepTimeAt({ minSeconds: 89, maxSeconds: 90 }, 1_000)).toEqual({ minSeconds: 60, maxSeconds: 120 });
    expect(stepTimeAt({ minSeconds: 600, maxSeconds: 600, timeRule: "linear" }, 10)).toEqual({ minSeconds: 60, maxSeconds: 60 }); // 6 s
  });

  it("returns whistles as they are, at any size and by any rule, and nothing for an untimed step", () => {
    for (const rule of STEP_TIME_RULES) {
      for (const f of [10, 450, 1_000, 3_000, 20_000]) {
        expect(stepTimeAt({ whistles: 3, timeRule: rule }, f)).toEqual({ whistles: 3 });
      }
    }
    expect(stepTimeAt({ minSeconds: null, maxSeconds: null, whistles: null, timeRule: "linear" }, 2_000)).toBeNull();
    expect(stepTimeAt({}, 1_000)).toBeNull();
  });

  it("reads one end alone as one time, and an absurd factor as × 1", () => {
    expect(stepTimeAt({ minSeconds: 300 }, 1_000)).toEqual({ minSeconds: 300, maxSeconds: 300 });
    expect(stepTimeAt({ maxSeconds: 300, minSeconds: null }, 1_000)).toEqual({ minSeconds: 300, maxSeconds: 300 });
    for (const f of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stepTimeAt({ minSeconds: 600, maxSeconds: 900, timeRule: "linear" }, f)).toEqual({ minSeconds: 600, maxSeconds: 900 });
    }
    expect([stepTimeMultiplier("fixed", 4_000), stepTimeMultiplier("partly", 4_000), stepTimeMultiplier("linear", 4_000)]).toEqual([1, 2, 4]);
  });

  it("property: × 1 is the identity for every rule, and fixed is the identity at every size, for times in whole minutes", () => {
    const rand = prng(20261108);
    for (let i = 0; i < 5_000; i += 1) {
      const written = minutesFrom(rand);
      const rule = ruleFrom(rand);
      expect(stepTimeAt({ ...written, timeRule: rule }, 1_000)).toEqual(written);
      expect(stepTimeAt({ ...written, timeRule: "fixed" }, factorFrom(rand))).toEqual(written);
    }
  });

  it("property: every result is whole minutes, at least one, with min ≤ max, within half a minute of exact", () => {
    const rand = prng(7);
    for (let i = 0; i < 10_000; i += 1) {
      const written = rangeFrom(rand);
      const rule = ruleFrom(rand);
      const f = factorFrom(rand);
      const at = range(stepTimeAt({ ...written, timeRule: rule }, f));
      const m = stepTimeMultiplier(rule, f);
      for (const [seconds, exact] of [[at.minSeconds, written.minSeconds * m], [at.maxSeconds, written.maxSeconds * m]] as const) {
        expect(seconds % 60).toBe(0);
        expect(seconds).toBeGreaterThanOrEqual(60);
        if (exact >= 60) expect(Math.abs(seconds - exact)).toBeLessThanOrEqual(30 + 1e-6);
        else expect(seconds).toBe(60);
      }
      expect(at.minSeconds).toBeLessThanOrEqual(at.maxSeconds);
    }
  });

  it("property: partly and linear times grow with the size, and never shrink", () => {
    const rand = prng(42);
    for (let i = 0; i < 5_000; i += 1) {
      const written = rangeFrom(rand);
      const rule: StepTimeRule = rand() < 0.5 ? "partly" : "linear";
      const [f1, f2] = [factorFrom(rand), factorFrom(rand)].sort((a, b) => a - b) as [number, number];
      const a = range(stepTimeAt({ ...written, timeRule: rule }, f1));
      const b = range(stepTimeAt({ ...written, timeRule: rule }, f2));
      expect(a.minSeconds).toBeLessThanOrEqual(b.minSeconds);
      expect(a.maxSeconds).toBeLessThanOrEqual(b.maxSeconds);
    }
  });

  it("property: partly lies between fixed and linear — above × 1 it is longer than fixed and shorter than linear, below it the other way", () => {
    const rand = prng(99);
    for (let i = 0; i < 5_000; i += 1) {
      const written = rangeFrom(rand);
      const f = factorFrom(rand);
      const [fixed, partly, linear] = (["fixed", "partly", "linear"] as const).map((rule) => range(stepTimeAt({ ...written, timeRule: rule }, f)));
      const [lo, hi] = f >= 1_000 ? [fixed!, linear!] : [linear!, fixed!];
      expect(partly!.minSeconds).toBeGreaterThanOrEqual(lo.minSeconds);
      expect(partly!.minSeconds).toBeLessThanOrEqual(hi.minSeconds);
      expect(partly!.maxSeconds).toBeGreaterThanOrEqual(lo.maxSeconds);
      expect(partly!.maxSeconds).toBeLessThanOrEqual(hi.maxSeconds);
    }
  });

  it("property: whistles are untouched, whatever the size, the rule, or a time beside them", () => {
    const rand = prng(3);
    for (let i = 0; i < 2_000; i += 1) {
      const whistles = 1 + Math.floor(rand() * 10);
      expect(stepTimeAt({ ...rangeFrom(rand), whistles, timeRule: ruleFrom(rand) }, factorFrom(rand))).toEqual({ whistles });
    }
  });
});

/** A step as the server reads it, text only, with `patch` on top. */
function step(position: number, patch: Partial<KitchenRecipeStep> = {}): KitchenRecipeStep {
  return {
    position, key: `k${position}`, text: `Step ${position}`, phase: "cook", lines: [], heat: null, minSeconds: null, maxSeconds: null,
    whistles: null, handsOff: false, timeRule: "fixed", sense: null, checkpoint: null, tip: null, ...patch,
  };
}

describe("contracts: long prep (GC-2, design §1)", () => {
  it("is a hands-off prep step of an hour or more (its shortest time), listed in step order", () => {
    const steps = [
      step(0, { phase: "prep", handsOff: true, minSeconds: 8 * 3_600, maxSeconds: 10 * 3_600, text: "Soak the rajma" }),
      step(1, { phase: "prep", handsOff: true, minSeconds: 1_800, maxSeconds: 7_200 }), // can be done in half an hour
      step(2, { phase: "prep", handsOff: false, minSeconds: 3_600, maxSeconds: 3_600 }), // hands on
      step(3, { phase: "cook", handsOff: true, minSeconds: 3_600, maxSeconds: 5_400 }), // cooking, not prep
      step(4, { phase: "prep", handsOff: true, whistles: 3 }),
      step(5, { phase: "prep", handsOff: true, minSeconds: LONG_PREP_SECONDS, maxSeconds: LONG_PREP_SECONDS, text: "Marinate" }),
    ];
    expect(steps.map(isLongPrep)).toEqual([true, false, false, false, false, true]);
    expect(longPrepOf(steps)).toEqual([
      { position: 0, key: "k0", seconds: 28_800, text: "Soak the rajma" },
      { position: 5, key: "k5", seconds: 3_600, text: "Marinate" },
    ]);
    expect(longPrepOf([])).toEqual([]);
  });
});

describe("contracts: the guided step routes (GC-2, design §7)", () => {
  it("types guided steps on every recipe write and read, the dish's step log, and Use today's times", () => {
    const guided: RecipeStepInput = {
      text: "Brown the onions",
      phase: "cook",
      lines: [1, 5],
      heat: 2,
      minSeconds: 480,
      maxSeconds: 600,
      handsOff: false,
      timeRule: "partly",
      sense: "look",
      checkpoint: "golden brown",
      tip: "Don't crowd the pan",
    };
    const create: CreateRecipeRequest = {
      name: "Chicken curry",
      servesHalf: 8,
      lines: [{ foodKey: "chicken", name: "Chicken", quantity: "1", unit: "kg", isMain: true }],
      steps: ["Heat the oil", guided, { text: "Pressure-cook", whistles: 3, handsOff: true }],
      tools: ["Kadai with a lid", "Pressure cooker"],
    };
    const patch: UpdateRecipeRequest = { steps: [{ ...guided, key: "6f1d0c3a9b2e4d5f8a7c6b5e4d3c2b1a" }], tools: [] };
    const times: UpdateStepTimesRequest = { steps: [{ key: "6f1d0c3a9b2e4d5f8a7c6b5e4d3c2b1a", minSeconds: 420, maxSeconds: 540 }] };
    const cook: CookDishRequest = {
      name: "Chicken curry",
      portionsHalf: 4,
      splitMode: "assign",
      recipeId: "rcp_1",
      recipeFactorMilli: 450,
      ingredients: [{ itemId: "itm_1", quantity: "0.45", unit: "kg", recipeLine: 0 }],
      stepLog: [{ key: "6f1d0c3a9b2e4d5f8a7c6b5e4d3c2b1a", startedAt: "2026-11-08T12:00:00.000Z", doneAt: "2026-11-08T12:08:30.000Z" }],
    };
    const read: Pick<KitchenRecipe, "steps" | "guidedSteps" | "tools" | "longPrep"> = {
      steps: ["Brown the onions"],
      guidedSteps: [step(0, { text: "Brown the onions", heat: 2, sense: "look", checkpoint: "golden brown" })],
      tools: ["Kadai with a lid"],
      longPrep: [],
    };
    // A recipe typed before GC-2 still checks: the new read fields are optional.
    const before: Pick<KitchenRecipe, "steps" | "linkCode"> & Partial<KitchenRecipe> = { steps: ["Stir"], linkCode: null };
    expect([create.steps!.length, patch.steps![0], times.steps.length, cook.stepLog![0]!.key, read.guidedSteps![0]!.text, before.guidedSteps]).toEqual([
      3, expect.objectContaining({ key: "6f1d0c3a9b2e4d5f8a7c6b5e4d3c2b1a" }), 1, "6f1d0c3a9b2e4d5f8a7c6b5e4d3c2b1a", "Brown the onions", undefined,
    ]);
  });

  it("names the step vocabulary and limits the server checks by", () => {
    expect(STEP_PHASES).toEqual(["prep", "cook"]);
    expect(STEP_TIME_RULES).toEqual(["fixed", "partly", "linear"]);
    expect(STEP_SENSES).toEqual(["look", "smell", "sound", "feel", "taste"]);
    expect([MAX_STEP_SECONDS, MAX_STEP_LOG, LONG_PREP_SECONDS]).toEqual([86_400, MAX_RECIPE_STEPS, 3_600]);
    expect(STEP_KEY_RE.test("6f1d0c3a9b2e4d5f8a7c6b5e4d3c2b1a")).toBe(true);
    expect(STEP_KEY_RE.test("curry-01_soak")).toBe(true);
    for (const bad of ["", "has space", "x".repeat(65), "a.b"]) expect(STEP_KEY_RE.test(bad)).toBe(false);
  });

  it("is reachable from @saas/contracts/kitchen and its own entry point alike", () => {
    expect(recipes.stepTimeAt).toBe(stepTimeAt);
    expect(recipes.longPrepOf).toBe(longPrepOf);
  });
});
