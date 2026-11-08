// Usuals by time of day and the row's suggestion in the contract (Cookpool
// PN-2, cookpool-pantry design §2.1–§2.3): the buckets and the zone shift,
// each of suggestUse's five rules in order — never more than what is left —
// and isRunningLow.

import {
  USUALS_DAYS,
  USE_SOON_DAYS,
  type KitchenUsual,
  type UsualsQuery,
  type UsualsResponse,
} from "@saas/contracts/kitchen";
import {
  REST_OF_USUAL,
  RUNNING_LOW_PERCENT,
  TZ_OFFSET_MAX,
  TZ_OFFSET_MIN,
  USE_SUGGESTION_REASONS,
  USUALS_NOW_DAYS,
  USUAL_BUCKETS,
  USUAL_BUCKET_HOURS,
  USUAL_BUCKET_LABELS,
  USUAL_NOW_MIN_USES,
  USUAL_STRIP_MIN_USES,
  isRunningLow,
  isTzOffset,
  restWhy,
  suggestUse,
  usualBucketAt,
  usualBucketOfHour,
  type SuggestUseInput,
  type UsualNow,
} from "@saas/contracts/kitchen-usuals";

describe("contracts: usuals by time of day (PN-2)", () => {
  it("names four buckets in local time, and the windows and thresholds", () => {
    expect(USUAL_BUCKETS).toEqual(["morning", "midday", "evening", "night"]);
    expect(USUAL_BUCKET_LABELS).toEqual({ morning: "Morning", midday: "Midday", evening: "Evening", night: "Night" });
    expect(Array.from({ length: 24 }, (_, h) => usualBucketOfHour(h)).join(",")).toBe(
      [
        ...Array(5).fill("night"), // 00–04
        ...Array(6).fill("morning"), // 05–10
        ...Array(5).fill("midday"), // 11–15
        ...Array(5).fill("evening"), // 16–20
        ...Array(3).fill("night"), // 21–23
      ].join(","),
    );
    expect(USUAL_BUCKET_HOURS).toEqual({
      morning: [5, 6, 7, 8, 9, 10],
      midday: [11, 12, 13, 14, 15],
      evening: [16, 17, 18, 19, 20],
      night: [0, 1, 2, 3, 4, 21, 22, 23],
    });
    expect([USUALS_NOW_DAYS, USUALS_DAYS, USUAL_NOW_MIN_USES, USUAL_STRIP_MIN_USES]).toEqual([60, 90, 2, 3]);
    expect([TZ_OFFSET_MIN, TZ_OFFSET_MAX]).toEqual([-720, 840]);
    expect([REST_OF_USUAL.num / REST_OF_USUAL.den, RUNNING_LOW_PERCENT]).toEqual([1.25, 20]);
    expect(USE_SUGGESTION_REASONS).toEqual(["rest", "usual_now", "usual", "use_soon", "first"]);
  });

  it("finds the bucket in the caller's zone, across midnight", () => {
    const at = new Date("2026-11-02T23:30:00.000Z");
    expect(usualBucketAt(at, 0)).toBe("night");
    expect(usualBucketAt(at, 330)).toBe("morning"); // 05:00 the next day in India
    expect(usualBucketAt(at, 329)).toBe("night"); // 04:59
    expect(usualBucketAt(at, -150)).toBe("night"); // 21:00
    expect(usualBucketAt(at, -151)).toBe("evening"); // 20:59
    expect(usualBucketAt(new Date("2026-11-02T00:30:00.000Z"), -720)).toBe("midday"); // 12:30 the day before
    expect(usualBucketAt(new Date("2026-11-02T00:30:00.000Z"), 840)).toBe("midday"); // 14:30
  });

  it("takes whole minutes from −720 to 840 as an offset", () => {
    expect([-720, -300, 0, 330, 345, 840].every(isTzOffset)).toBe(true);
    expect([-721, 841, 5.5, Number.NaN, Infinity].some(isTzOffset)).toBe(false);
  });

  it("types the query and the answer: tzOffset, bucket, now and strip", () => {
    const query: UsualsQuery = { limit: 100, tzOffset: 330 };
    const now: UsualNow = { bucket: "morning", qtyMilli: 250_000, quantity: 250, unit: "ml", label: "1 glass", consumerIds: ["usr_rahul"], count: 3 };
    const usual: KitchenUsual = {
      itemId: "itm_1", name: "Milk", pantry: { kind: "personal", name: "My pantry" }, lastQtyMilli: 250_000, lastQuantity: 250,
      lastUnit: "ml", lastLabel: null, measures: [], consumers: ["usr_rahul"], usedCount: 4, lastUsedAt: "2026-11-02T08:00:00.000Z",
      qtyLeftMilli: 750_000, now, strip: true,
    };
    const answer: UsualsResponse = { usuals: [usual], bucket: "morning" };
    expect([query.tzOffset, answer.bucket, answer.usuals[0]!.now?.count, answer.usuals[0]!.strip]).toEqual([330, "morning", 3, true]);
  });
});

// ── suggestUse ──────────────────────────────────────────────

const LITRE = { qtyLeftMilli: 1_000_000, dimension: "volume", daysToUseBy: null } as const;
/** The console's ladder for milk: tiles with an amount, The rest last. */
const MILK_TILES = [
  { amount: { qtyMilli: 250_000 }, rest: false },
  { amount: { qtyMilli: 100_000 }, rest: false },
  { amount: { qtyMilli: 50_000 }, rest: false },
  { amount: { qtyMilli: 1_000_000 }, rest: true },
];
const last = { lastQtyMilli: 200_000, lastUnit: "ml", lastLabel: null, consumers: ["usr_rahul", "usr_anu"] };
const morning: UsualNow = { bucket: "morning", qtyMilli: 250_000, quantity: 250, unit: "ml", label: "1 glass", consumerIds: ["usr_rahul"], count: 3 };

function suggest(input: Partial<SuggestUseInput> & Pick<SuggestUseInput, "item">) {
  return suggestUse({ ladder: MILK_TILES, ...input });
}

describe("contracts: suggestUse (PN-2, design §2.2)", () => {
  it("1. rest: what's left is at most 1.25 × the usual — the bucket's, else the last — and it suggests all of it", () => {
    // 312.5 ml is 1.25 × the bucket's 250 ml.
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 312_500 }, usual: { ...last, now: morning } })).toEqual({
      reason: "rest", qtyMilli: 312_500, unit: null, label: null, consumerIds: ["usr_rahul", "usr_anu"], why: "The rest",
    });
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 312_501 }, usual: { ...last, now: morning } })?.reason).toBe("usual_now");
    // Without a bucket usual, the last one's 200 ml: up to 250 ml is the rest.
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 250_000 }, usual: last })).toMatchObject({ reason: "rest", qtyMilli: 250_000 });
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 250_001 }, usual: last })).toMatchObject({ reason: "usual", qtyMilli: 200_000 });
    // A usual bigger than what's left is never suggested: the rest is.
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 150_000 }, usual: last })).toMatchObject({ reason: "rest", qtyMilli: 150_000 });
  });

  it("1. rest: also at most the smallest ladder step, or with no step under what's left", () => {
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 50_000 } })).toMatchObject({ reason: "rest", qtyMilli: 50_000, why: "The rest" });
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 30_000 }, ladder: [50_000, 100_000] })).toMatchObject({ reason: "rest", qtyMilli: 30_000 });
    expect(suggest({ item: LITRE, ladder: [] })).toMatchObject({ reason: "rest", qtyMilli: 1_000_000 });
    // The rest tile is no step: only it is left on the ladder.
    expect(suggest({ item: LITRE, ladder: [{ amount: { qtyMilli: 1_000_000 }, rest: true }] })?.reason).toBe("rest");
    // Just over the smallest step: that step is the one under what's left.
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 50_001 } })).toMatchObject({ reason: "first", qtyMilli: 50_000 });
  });

  it("1. rest: reads 'only N left' for a whole count of pieces", () => {
    const eggs = { qtyLeftMilli: 1000, dimension: "count", daysToUseBy: null } as const;
    expect(suggest({ item: eggs, ladder: [1000, 2000] })).toMatchObject({ reason: "rest", qtyMilli: 1000, why: "The rest · only 1 left" });
    expect(suggest({ item: { ...eggs, qtyLeftMilli: 2000 }, ladder: [1000], usual: { ...last, lastQtyMilli: 2000 } })?.why).toBe("The rest · only 2 left");
    expect(restWhy({ qtyLeftMilli: 1500, dimension: "count" })).toBe("The rest");
    expect(restWhy({ qtyLeftMilli: 1000, dimension: "pack" })).toBe("The rest");
  });

  it("2. usual_now: the bucket usual, as it was logged, for its people — 'Morning usual'", () => {
    expect(suggest({ item: LITRE, usual: { ...last, now: morning } })).toEqual({
      reason: "usual_now", qtyMilli: 250_000, unit: "ml", label: "1 glass", consumerIds: ["usr_rahul"], why: "Morning usual",
    });
    const night: UsualNow = { ...morning, bucket: "night", qtyMilli: 100_000, label: null, unit: "ml" };
    expect(suggest({ item: LITRE, usual: last, now: night })?.why).toBe("Night usual");
    expect(suggest({ item: LITRE, usual: { ...last, now: { ...morning, bucket: "midday" } } })?.why).toBe("Midday usual");
    expect(suggest({ item: LITRE, usual: { ...last, now: { ...morning, bucket: "evening" } } })?.why).toBe("Evening usual");
    // An explicit null bucket usual sets the usual's own aside.
    expect(suggest({ item: LITRE, usual: { ...last, now: morning }, now: null })?.reason).toBe("usual");
  });

  it("3. usual: the last usual — 'Your usual'", () => {
    expect(suggest({ item: LITRE, usual: { ...last, lastLabel: "1 small glass", lastUnit: "ml", now: null } })).toEqual({
      reason: "usual", qtyMilli: 200_000, unit: "ml", label: "1 small glass", consumerIds: ["usr_rahul", "usr_anu"], why: "Your usual",
    });
    // A usual beats use soon.
    expect(suggest({ item: { ...LITRE, daysToUseBy: 0 }, usual: last })?.reason).toBe("usual");
  });

  it("4. use_soon: a use-by within USE_SOON_DAYS and no usual — the first step that fits, 'Use soon'", () => {
    for (let days = 0; days <= USE_SOON_DAYS; days += 1) {
      expect(suggest({ item: { ...LITRE, daysToUseBy: days } })).toEqual({
        reason: "use_soon", qtyMilli: 250_000, unit: null, label: null, consumerIds: null, why: "Use soon",
      });
    }
  });

  it("5. first: otherwise the first step that fits, with no reason — never more than what's left", () => {
    expect(suggest({ item: LITRE })).toEqual({ reason: "first", qtyMilli: 250_000, unit: null, label: null, consumerIds: null, why: null });
    expect(suggest({ item: { ...LITRE, daysToUseBy: USE_SOON_DAYS + 1 } })?.reason).toBe("first");
    expect(suggest({ item: { ...LITRE, daysToUseBy: -1 } })?.reason).toBe("first"); // expired: its tag says so
    // A step over what's left is passed by: 300 ml left, so 250 ml is too much and 100 ml comes first.
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 300_000 }, ladder: [500_000, 100_000, 50_000] })).toMatchObject({
      reason: "first", qtyMilli: 100_000,
    });
    // Plain amounts do as well as tiles.
    expect(suggest({ item: LITRE, ladder: [100_000, 250_000] })?.qtyMilli).toBe(100_000);
  });

  it("suggests nothing when nothing is left", () => {
    expect(suggest({ item: { ...LITRE, qtyLeftMilli: 0 }, usual: last })).toBeNull();
  });

  it("never suggests more than what's left, whatever it's given", () => {
    const usuals = [null, last, { ...last, now: morning }, { ...last, lastQtyMilli: 5_000_000, now: { ...morning, qtyMilli: 5_000_000 } }];
    for (const left of [1, 999, 50_000, 249_999, 250_000, 312_500, 400_000, 1_000_000]) {
      for (const usual of usuals) {
        for (const daysToUseBy of [null, 1]) {
          const got = suggest({ item: { ...LITRE, qtyLeftMilli: left, daysToUseBy }, usual });
          expect(got).not.toBeNull();
          expect(got!.qtyMilli).toBeGreaterThan(0);
          expect(got!.qtyMilli).toBeLessThanOrEqual(left);
        }
      }
    }
  });
});

// ── isRunningLow ────────────────────────────────────────────

describe("contracts: isRunningLow (PN-2, design §2.3)", () => {
  const bought = { qtyBoughtMilli: 1_000_000 };

  it("is true under 20% of what was bought", () => {
    expect(isRunningLow({ item: { ...bought, qtyLeftMilli: 199_999 } })).toBe(true);
    expect(isRunningLow({ item: { ...bought, qtyLeftMilli: 200_000 } })).toBe(false);
    expect(isRunningLow({ item: { ...bought, qtyLeftMilli: 0 } })).toBe(true);
  });

  it("is true under one usual amount — the bucket's, else the last", () => {
    const item = { ...bought, qtyLeftMilli: 240_000 };
    expect(isRunningLow({ item, usual: { ...last, lastQtyMilli: 250_000 } })).toBe(true);
    expect(isRunningLow({ item, usual: { ...last, lastQtyMilli: 240_000 } })).toBe(false);
    // A bucket usual of 200 ml says 240 ml is not low; one of 250 ml says it is.
    expect(isRunningLow({ item, usual: { ...last, lastQtyMilli: 250_000, now: { ...morning, qtyMilli: 200_000 } } })).toBe(false);
    expect(isRunningLow({ item, usual: { ...last, lastQtyMilli: 100_000 }, now: morning })).toBe(true);
    expect(isRunningLow({ item, usual: null })).toBe(false);
  });
});
