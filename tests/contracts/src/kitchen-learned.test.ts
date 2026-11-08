import type { KitchenRecipeStep, LearnedStepRange, RecipeQuery, StepTimeRule, StepTimeSample, StepTiming } from "@saas/contracts/kitchen";
import {
  LEARNED_ABANDONED_TIMES,
  LEARNED_HIGH_PERCENTILE,
  LEARNED_LOW_PERCENTILE,
  LEARNED_MIN_COOKS,
  LEARNED_MIN_SAMPLES,
  LEARNED_MIN_SECONDS,
  LEARNED_UNTIMED_MAX_SECONDS,
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_MIN_FACTOR_MILLI,
  STEP_TIME_RULES,
  abandonedAfterSeconds,
  keepsStepTime,
  learnedStepTime,
  normalizeStepSeconds,
  percentile,
  scaleStepSeconds,
  stepTimeAt,
  stepTimeMultiplier,
  wholeStepMinutes,
} from "@saas/contracts/kitchen";
import * as recipes from "@saas/contracts/kitchen-recipes";

// Learned ranges (Cookpool GC-7, cookpool-guided design §5, risks GC-C): the
// percentile helper, the normalise-and-scale round trip by rule, the minute
// rounding, which times count (skipped, abandoned, size unknown), the
// minimums of 5 times from 3 cooks, and the range at a size — pinned by
// examples and by properties over many seeded random cases.

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
const listFrom = (rand: () => number, n: number, max = 10_000) => Array.from({ length: n }, () => Math.round(rand() * max * 1_000) / 1_000);
const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b);
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/** A plain reference: the textbook type-7 quantile over a sorted list. */
function reference(values: readonly number[], p: number): number {
  const x = sorted(values);
  const h = (x.length - 1) * p;
  const i = Math.floor(h);
  return i + 1 < x.length ? x[i]! + (h - i) * (x[i + 1]! - x[i]!) : x[i]!;
}

/** Samples from [seconds, the size cooked at, who] triples. */
const samples = (entries: ReadonlyArray<[seconds: number, factorMilli: number | null, cook: string]>): StepTimeSample[] =>
  entries.map(([seconds, factorMilli, cook]) => ({ seconds, factorMilli, cook }));

describe("contracts: the percentile helper (GC-7)", () => {
  it("interpolates linearly between the nearest ranks: 25th and 75th of five and of four", () => {
    expect([percentile([400, 450, 500, 550, 600], 0.25), percentile([400, 450, 500, 550, 600], 0.75)]).toEqual([450, 550]);
    expect([percentile([1, 2, 3, 4], 0.25), percentile([1, 2, 3, 4], 0.75)]).toEqual([1.75, 3.25]);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([600, 60, 300, 120, 900], 0.5)).toBe(300); // unsorted in, the median of the sorted copy
  });

  it("is its one value for one value, NaN for none or a p that is no number, and clamps p to 0–1", () => {
    expect([percentile([42], 0), percentile([42], 0.25), percentile([42], 1)]).toEqual([42, 42, 42]);
    expect(percentile([], 0.5)).toBeNaN();
    expect(percentile([1, 2, 3], Number.NaN)).toBeNaN();
    expect([percentile([1, 2, 3], -1), percentile([1, 2, 3], 7)]).toEqual([1, 3]);
  });

  it("leaves the list it is given as it was", () => {
    const values = [3, 1, 2];
    percentile(values, 0.75);
    expect(values).toEqual([3, 1, 2]);
  });

  it("property: matches the textbook quantile, lies within the values, ends at min and max, and grows with p", () => {
    const rand = prng(20261108);
    for (let i = 0; i < 3_000; i += 1) {
      const values = listFrom(rand, 1 + Math.floor(rand() * 40));
      const [p1, p2] = sorted([rand(), rand()]) as [number, number];
      const a = percentile(values, p1);
      const b = percentile(values, p2);
      expect(close(a, reference(values, p1))).toBe(true);
      expect(a).toBeGreaterThanOrEqual(Math.min(...values));
      expect(b).toBeLessThanOrEqual(Math.max(...values));
      expect(a).toBeLessThanOrEqual(b + 1e-9);
      expect([percentile(values, 0), percentile(values, 1)]).toEqual([Math.min(...values), Math.max(...values)]);
    }
  });

  it("property: the order of the values does not matter, and shifting or stretching them shifts or stretches it", () => {
    const rand = prng(11);
    for (let i = 0; i < 2_000; i += 1) {
      const values = listFrom(rand, 1 + Math.floor(rand() * 30));
      const shuffled = [...values].sort(() => rand() - 0.5);
      const p = rand();
      const c = rand() * 1_000;
      const k = 0.01 + rand() * 20;
      expect(percentile(shuffled, p)).toBe(percentile(values, p));
      expect(close(percentile(values.map((v) => v + c), p), percentile(values, p) + c, 1e-9)).toBe(true);
      expect(close(percentile(values.map((v) => v * k), p), percentile(values, p) * k, 1e-9)).toBe(true);
    }
  });

  it("property: the 50th of an odd count is the middle value", () => {
    const rand = prng(5);
    for (let i = 0; i < 1_000; i += 1) {
      const n = 1 + 2 * Math.floor(rand() * 20);
      const values = listFrom(rand, n);
      expect(percentile(values, 0.5)).toBe(sorted(values)[(n - 1) / 2]);
    }
  });
});

describe("contracts: normalising to the recipe as written, and back (GC-7)", () => {
  it("divides by the rule's multiplier and scaling multiplies by it: fixed × 1, partly × √f, linear × f", () => {
    expect([normalizeStepSeconds(600, "fixed", 2_000), normalizeStepSeconds(600, "partly", 4_000), normalizeStepSeconds(600, "linear", 2_000)]).toEqual([
      600, 300, 300,
    ]);
    expect([scaleStepSeconds(600, "fixed", 450), scaleStepSeconds(600, "partly", 250), scaleStepSeconds(600, "linear", 450)]).toEqual([600, 300, 270]);
    // No rule said is fixed, and an absurd size is × 1 — as stepTimeAt reads them.
    expect([normalizeStepSeconds(600, undefined, 2_000), normalizeStepSeconds(600, null, 2_000), normalizeStepSeconds(600, "linear", 0)]).toEqual([
      600, 600, 600,
    ]);
  });

  it("property: scaling undoes normalising — and the other way — for every rule at every size", () => {
    const rand = prng(1_000);
    for (let i = 0; i < 10_000; i += 1) {
      const seconds = rand() * 86_400;
      const rule = ruleFrom(rand);
      const f = factorFrom(rand);
      expect(close(scaleStepSeconds(normalizeStepSeconds(seconds, rule, f), rule, f), seconds)).toBe(true);
      expect(close(normalizeStepSeconds(scaleStepSeconds(seconds, rule, f), rule, f), seconds)).toBe(true);
      expect(close(normalizeStepSeconds(seconds, rule, f) * stepTimeMultiplier(rule, f), seconds)).toBe(true);
    }
  });

  it("property: the recipe as written (f = 1000) is the identity for every rule, and fixed is the identity at every size", () => {
    const rand = prng(77);
    for (let i = 0; i < 5_000; i += 1) {
      const seconds = Math.floor(rand() * 86_400);
      const rule = ruleFrom(rand);
      const f = factorFrom(rand);
      expect([normalizeStepSeconds(seconds, rule, 1_000), scaleStepSeconds(seconds, rule, 1_000)]).toEqual([seconds, seconds]);
      expect([normalizeStepSeconds(seconds, "fixed", f), scaleStepSeconds(seconds, "fixed", f)]).toEqual([seconds, seconds]);
    }
  });

  it("property: a time normalised from one size and scaled to another is the time the rule says for that change", () => {
    const rand = prng(31);
    for (let i = 0; i < 5_000; i += 1) {
      const seconds = rand() * 86_400;
      const [from, to] = [factorFrom(rand), factorFrom(rand)];
      expect(close(scaleStepSeconds(normalizeStepSeconds(seconds, "linear", from), "linear", to), (seconds * to) / from)).toBe(true);
      expect(close(scaleStepSeconds(normalizeStepSeconds(seconds, "partly", from), "partly", to), seconds * Math.sqrt(to / from))).toBe(true);
    }
  });
});

describe("contracts: whole minutes (GC-7, as design §2 rounds)", () => {
  it("rounds to the nearest minute, halves up, and never under one minute", () => {
    expect([0, 29, 30, 89, 90, 149, 150, 450, 550].map(wholeStepMinutes)).toEqual([60, 60, 60, 60, 120, 120, 180, 480, 540]);
    expect(wholeStepMinutes(86_400)).toBe(86_400);
  });

  it("is how stepTimeAt rounds each end", () => {
    const rand = prng(8);
    for (let i = 0; i < 2_000; i += 1) {
      const seconds = Math.floor(rand() * 86_400);
      const rule = ruleFrom(rand);
      const f = factorFrom(rand);
      expect(stepTimeAt({ minSeconds: seconds, maxSeconds: seconds, timeRule: rule }, f)).toEqual({
        minSeconds: wholeStepMinutes(seconds * stepTimeMultiplier(rule, f)),
        maxSeconds: wholeStepMinutes(seconds * stepTimeMultiplier(rule, f)),
      });
    }
  });

  it("property: whole minutes, at least one, within half a minute of anything a minute or more, and never smaller for more", () => {
    const rand = prng(9);
    for (let i = 0; i < 10_000; i += 1) {
      const [a, b] = sorted([rand() * 86_400, rand() * 86_400]) as [number, number];
      const m = wholeStepMinutes(a);
      expect(m % 60).toBe(0);
      expect(m).toBeGreaterThanOrEqual(60);
      if (a >= 60) expect(Math.abs(m - a)).toBeLessThanOrEqual(30);
      expect(m).toBeLessThanOrEqual(wholeStepMinutes(b));
    }
  });
});

describe("contracts: which times count (GC-7, risks GC-C)", () => {
  const brown: StepTiming = { minSeconds: 600, maxSeconds: 900, timeRule: "linear" };

  it("takes a step ticked in under 10 s as skipped", () => {
    expect(LEARNED_MIN_SECONDS).toBe(10);
    expect(keepsStepTime(brown, { seconds: 9, factorMilli: 1_000, cook: "a" })).toBe(false);
    expect(keepsStepTime(brown, { seconds: 10, factorMilli: 1_000, cook: "a" })).toBe(true);
    expect(keepsStepTime(brown, { seconds: 0, factorMilli: 1_000, cook: "a" })).toBe(false);
  });

  it("takes a time over 4 × the author's longest, at the size it was cooked at, as abandoned", () => {
    expect(LEARNED_ABANDONED_TIMES).toBe(4);
    expect(abandonedAfterSeconds(brown, 1_000)).toBe(3_600);
    expect(abandonedAfterSeconds(brown, 2_000)).toBe(7_200); // twice the size, twice as long
    expect(keepsStepTime(brown, { seconds: 7_200, factorMilli: 2_000, cook: "a" })).toBe(true);
    expect(keepsStepTime(brown, { seconds: 7_201, factorMilli: 2_000, cook: "a" })).toBe(false);
    expect(keepsStepTime(brown, { seconds: 3_601, factorMilli: 1_000, cook: "a" })).toBe(false);
    // 4 × its min when it says only that; partly grows by √f.
    expect(abandonedAfterSeconds({ minSeconds: 300 }, 1_000)).toBe(1_200);
    expect(abandonedAfterSeconds({ minSeconds: 600, maxSeconds: 900, timeRule: "partly" }, 4_000)).toBe(7_200);
    expect(abandonedAfterSeconds({ minSeconds: 600, maxSeconds: 900, timeRule: "fixed" }, 4_000)).toBe(3_600);
  });

  it("caps a step with no time — untimed, whistles, or 0 s — at 4 h, whatever the size", () => {
    expect(LEARNED_UNTIMED_MAX_SECONDS).toBe(14_400);
    for (const step of [{}, { whistles: 3 }, { minSeconds: 0, maxSeconds: 0 }, { minSeconds: null, maxSeconds: null, timeRule: "linear" as const }]) {
      expect(abandonedAfterSeconds(step, 1_000)).toBe(14_400);
      expect(abandonedAfterSeconds(step, 20_000)).toBe(14_400);
      expect(keepsStepTime(step, { seconds: 14_400, factorMilli: 450, cook: "a" })).toBe(true);
      expect(keepsStepTime(step, { seconds: 14_401, factorMilli: 450, cook: "a" })).toBe(false);
    }
  });

  it("leaves out a time whose size is not known, and one that is no number", () => {
    for (const factorMilli of [null, 0, -450, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(keepsStepTime(brown, { seconds: 700, factorMilli, cook: "a" })).toBe(false);
    }
    expect(keepsStepTime(brown, { seconds: Number.NaN, factorMilli: 1_000, cook: "a" })).toBe(false);
  });
});

describe("contracts: a step's learned range (GC-7, design §5)", () => {
  // Normalised to the recipe as written these are 10, 11, 12, 13 and 14 min, cooked at five sizes.
  const brown: StepTiming = { minSeconds: 600, maxSeconds: 900, timeRule: "linear" };
  const browned = samples([
    [600, 1_000, "anu"],
    [1_320, 2_000, "rahul"],
    [360, 500, "dev"],
    [780, 1_000, "anu"],
    [1_260, 1_500, "rahul"],
  ]);

  it("is the 25th–75th percentiles of the times normalised, scaled to the size asked for, with the counts", () => {
    expect([LEARNED_MIN_SAMPLES, LEARNED_MIN_COOKS, LEARNED_LOW_PERCENTILE, LEARNED_HIGH_PERCENTILE]).toEqual([5, 3, 0.25, 0.75]);
    expect(learnedStepTime(brown, browned, 1_000)).toEqual({ lowSeconds: 660, highSeconds: 780, cooks: 3, samples: 5 });
    // × 0.45: 4.95 and 5.85 min, in whole minutes.
    expect(learnedStepTime(brown, browned, 450)).toEqual({ lowSeconds: 300, highSeconds: 360, cooks: 3, samples: 5 });
    expect(learnedStepTime(brown, browned, 2_000)).toEqual({ lowSeconds: 1_320, highSeconds: 1_560, cooks: 3, samples: 5 });
    // A partly step: 8, 9, 10, 11 and 12 min as written, grown by √f.
    const simmer: StepTiming = { minSeconds: 480, maxSeconds: 720, timeRule: "partly" };
    const simmered = samples([[480, 1_000, "anu"], [1_080, 4_000, "rahul"], [300, 250, "dev"], [660, 1_000, "anu"], [1_440, 4_000, "dev"]]);
    expect(learnedStepTime(simmer, simmered, 1_000)).toEqual({ lowSeconds: 540, highSeconds: 660, cooks: 3, samples: 5 });
    expect(learnedStepTime(simmer, simmered, 450)).toEqual({ lowSeconds: 360, highSeconds: 420, cooks: 3, samples: 5 }); // 6.04, 7.38 min
    // A fixed step is the same at every size.
    const fry: StepTiming = { minSeconds: 480, maxSeconds: 600 };
    const fried = samples([[400, 450, "a"], [450, 2_000, "b"], [500, 1_000, "c"], [550, 1_000, "a"], [600, 450, "b"]]);
    for (const f of [10, 450, 1_000, 20_000]) expect(learnedStepTime(fry, fried, f)).toEqual({ lowSeconds: 480, highSeconds: 540, cooks: 3, samples: 5 });
  });

  it("is nothing under 5 times or under 3 cooks — counted after the times that do not count are left out", () => {
    expect(learnedStepTime(brown, browned.slice(0, 4), 1_000)).toBeNull(); // 4 times
    expect(learnedStepTime(brown, browned.map((s) => ({ ...s, cook: s.cook === "dev" ? "anu" : s.cook })), 1_000)).toBeNull(); // 2 cooks
    expect(learnedStepTime(brown, [], 1_000)).toBeNull();
    // Five times from three cooks, but one is skipped, one abandoned, one of no size: two left.
    const odd = samples([[5, 1_000, "anu"], [9_000, 1_000, "rahul"], [700, null, "dev"], [700, 1_000, "anu"], [720, 1_000, "rahul"]]);
    expect(learnedStepTime(brown, odd, 1_000)).toBeNull();
    // With them beside the five good ones, they change nothing.
    expect(learnedStepTime(brown, [...browned, ...odd.slice(0, 3)], 1_000)).toEqual({ lowSeconds: 660, highSeconds: 780, cooks: 3, samples: 5 });
    // Six times from three cooks once one cook's time no longer counts — that cook is not counted either.
    const two = samples([[600, 1_000, "anu"], [660, 1_000, "anu"], [720, 1_000, "rahul"], [780, 1_000, "rahul"], [840, 1_000, "rahul"], [5, 1_000, "dev"]]);
    expect(learnedStepTime(brown, two, 1_000)).toBeNull();
  });

  it("says how many times and how many people — and nothing about who", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ seconds: 600 + i * 10, factorMilli: 1_000, cook: `usr_${i % 4}` }));
    const range = learnedStepTime(brown, many, 1_000)!;
    expect(Object.keys(range).sort()).toEqual(["cooks", "highSeconds", "lowSeconds", "samples"]);
    expect([range.cooks, range.samples]).toEqual([4, 12]);
    expect(JSON.stringify(range)).not.toMatch(/usr_/);
  });

  it("is hardly moved by one odd cook: the range, not the mean (risks GC-C)", () => {
    const steady = samples([[600, 1_000, "a"], [620, 1_000, "b"], [640, 1_000, "c"], [660, 1_000, "a"], [680, 1_000, "b"], [700, 1_000, "c"]]);
    const before = learnedStepTime(brown, steady, 1_000)!;
    const after = learnedStepTime(brown, [...steady, { seconds: 3_500, factorMilli: 1_000, cook: "d" }], 1_000)!; // just under abandoned
    expect(before).toEqual({ lowSeconds: 600, highSeconds: 660, cooks: 3, samples: 6 });
    expect(after.highSeconds - before.highSeconds).toBeLessThanOrEqual(60);
  });

  it("property: whole minutes, at least one, low ≤ high, within the kept times at that size (to the minute), counts at the minimums", () => {
    const rand = prng(2026);
    for (let i = 0; i < 3_000; i += 1) {
      const lo = 60 + Math.floor(rand() * 3_600);
      const step: StepTiming = { minSeconds: lo, maxSeconds: lo + Math.floor(rand() * 1_800), timeRule: ruleFrom(rand) };
      const pool: StepTimeSample[] = Array.from({ length: Math.floor(rand() * 30) }, () => ({
        seconds: Math.floor(rand() * 20_000),
        factorMilli: rand() < 0.1 ? null : factorFrom(rand),
        cook: Math.floor(rand() * 6),
      }));
      const f = factorFrom(rand);
      const range = learnedStepTime(step, pool, f);
      const kept = pool.filter((s) => keepsStepTime(step, s));
      const cooks = new Set(kept.map((s) => s.cook)).size;
      if (kept.length < LEARNED_MIN_SAMPLES || cooks < LEARNED_MIN_COOKS) {
        expect(range).toBeNull();
        continue;
      }
      expect(range).not.toBeNull();
      const r = range as LearnedStepRange;
      expect([r.samples, r.cooks]).toEqual([kept.length, cooks]);
      expect(r.lowSeconds % 60 === 0 && r.highSeconds % 60 === 0).toBe(true);
      expect(r.lowSeconds).toBeGreaterThanOrEqual(60);
      expect(r.lowSeconds).toBeLessThanOrEqual(r.highSeconds);
      const atF = kept.map((s) => scaleStepSeconds(normalizeStepSeconds(s.seconds, step.timeRule, s.factorMilli!), step.timeRule, f));
      expect(r.lowSeconds).toBeGreaterThanOrEqual(wholeStepMinutes(Math.min(...atF)));
      expect(r.highSeconds).toBeLessThanOrEqual(wholeStepMinutes(Math.max(...atF)));
    }
  });

  it("property: when every cook took the same time at one size, that size reads that time back, in whole minutes", () => {
    const rand = prng(12);
    for (let i = 0; i < 3_000; i += 1) {
      const minutes = 1 + Math.floor(rand() * 120);
      const step: StepTiming = { minSeconds: 60, maxSeconds: 7_200, timeRule: ruleFrom(rand) };
      const f = factorFrom(rand);
      const seconds = minutes * 60;
      if (!keepsStepTime(step, { seconds, factorMilli: f, cook: 0 })) continue;
      const pool = Array.from({ length: 5 }, (_, c) => ({ seconds, factorMilli: f, cook: c % 3 }));
      expect(learnedStepTime(step, pool, f)).toEqual({ lowSeconds: seconds, highSeconds: seconds, cooks: 3, samples: 5 });
    }
  });

  it("property: a fixed step reads the same at every size, and partly and linear ones never shrink as the size grows", () => {
    const rand = prng(4);
    for (let i = 0; i < 2_000; i += 1) {
      const pool = Array.from({ length: 5 + Math.floor(rand() * 10) }, (_, c) => ({
        seconds: 60 + Math.floor(rand() * 1_200),
        factorMilli: factorFrom(rand),
        cook: c % 3,
      }));
      const [f1, f2] = sorted([factorFrom(rand), factorFrom(rand)]) as [number, number];
      const fixed: StepTiming = { minSeconds: 600, maxSeconds: 900 };
      expect(learnedStepTime(fixed, pool, f1)).toEqual(learnedStepTime(fixed, pool, f2));
      const rule: StepTimeRule = rand() < 0.5 ? "partly" : "linear";
      const grown: StepTiming = { timeRule: rule }; // untimed: the 4 h cap, whatever the size
      const a = learnedStepTime(grown, pool, f1);
      const b = learnedStepTime(grown, pool, f2);
      expect(a === null).toBe(b === null);
      if (a && b) {
        expect(a.lowSeconds).toBeLessThanOrEqual(b.lowSeconds);
        expect(a.highSeconds).toBeLessThanOrEqual(b.highSeconds);
      }
    }
  });
});

describe("contracts: the learned read (GC-7, design §5, §7)", () => {
  it("types `learned` as optional on a step, and the read's ?f=", () => {
    const learned: LearnedStepRange = { lowSeconds: 420, highSeconds: 540, cooks: 23, samples: 41 };
    const step: KitchenRecipeStep = {
      position: 0, key: "k0", text: "Brown the onions", phase: "cook", lines: [], heat: 2, minSeconds: 480, maxSeconds: 600, whistles: null,
      handsOff: false, timeRule: "partly", sense: "look", checkpoint: "golden brown", tip: null, learned,
    };
    // A step typed before GC-7 still checks.
    const before: KitchenRecipeStep = { ...step };
    delete before.learned;
    const query: RecipeQuery = { f: 450, code: "AbCdEfGhJk" };
    expect([step.learned, before.learned, query.f]).toEqual([learned, undefined, 450]);
  });

  it("is reachable from @saas/contracts/kitchen and its own entry point alike", () => {
    expect(recipes.learnedStepTime).toBe(learnedStepTime);
    expect(recipes.percentile).toBe(percentile);
  });
});
