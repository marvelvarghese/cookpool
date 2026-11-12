// The kitchen engine's Spliteco splits (packages/kitchen-engine/src/splits.ts):
// pure maths, every rounding the largest-remainder rule, every part adding up
// to the total to the paisa.

import { splitByIntegerWeights, splitByWeights } from "@saas/kitchen-engine/money";
import { buildSplitecoSplits, owedBySplit, splitItem, splitPeople, type SplitSpec } from "@saas/kitchen-engine/splits";

const owed = (total: number, spec: SplitSpec) => {
  const r = owedBySplit(total, spec);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return Object.fromEntries(r.value.owed.map((o) => [o.subjectId, o.owedMinor]));
};

describe("splitByIntegerWeights", () => {
  it("is splitByWeights for whole weights, and takes weights past 2^53", () => {
    expect(splitByIntegerWeights(1000, [1n, 1n, 1n])).toEqual(splitByWeights(1000, [1, 1, 1]));
    expect(splitByIntegerWeights(10, [3n, 3n, 4n])).toEqual([3, 3, 4]);
    const big = 10n ** 30n;
    expect(splitByIntegerWeights(100, [big, big, big])).toEqual([34, 33, 33]);
    expect(() => splitByIntegerWeights(1, [0n, 0n])).toThrow();
  });
});

describe("the five plain methods", () => {
  it("equal: leftover paise to the earliest", () => {
    expect(owed(1000, { method: "equal", participants: ["a", "b", "c"] })).toEqual({ a: 334, b: 333, c: 333 });
  });
  it("exact must add up", () => {
    expect(owed(1000, { method: "exact", participants: [{ subjectId: "a", amountMinor: 400 }, { subjectId: "b", amountMinor: 600 }] })).toEqual({ a: 400, b: 600 });
    const r = owedBySplit(1000, { method: "exact", participants: [{ subjectId: "a", amountMinor: 400 }] });
    expect(r).toEqual({ ok: false, problems: [{ kind: "total_mismatch", totalMinor: 1000, assignedMinor: 400 }] });
  });
  it("pct must reach 100% in basis points", () => {
    expect(owed(1800000, { method: "pct", participants: [{ subjectId: "a", basisPoints: 2500 }, { subjectId: "b", basisPoints: 2500 }, { subjectId: "c", basisPoints: 2000 }, { subjectId: "d", basisPoints: 3000 }] }))
      .toEqual({ a: 450000, b: 450000, c: 360000, d: 540000 });
    expect(owedBySplit(100, { method: "pct", participants: [{ subjectId: "a", basisPoints: 9999 }] })).toEqual({ ok: false, problems: [{ kind: "pct_not_100", basisPoints: 9999 }] });
  });
  it("shares as weights", () => {
    expect(owed(1800000, { method: "shares", participants: [{ subjectId: "a", shares: 1 }, { subjectId: "b", shares: 1 }, { subjectId: "c", shares: 1 }, { subjectId: "d", shares: 2 }] }))
      .toEqual({ a: 360000, b: 360000, c: 360000, d: 720000 });
  });
  it("adjust: equal on what is left, then + or − on top", () => {
    expect(owed(1800000, { method: "adjust", participants: [{ subjectId: "a", adjustMinor: 0 }, { subjectId: "b", adjustMinor: 0 }, { subjectId: "c", adjustMinor: 0 }, { subjectId: "d", adjustMinor: 120000 }] }))
      .toEqual({ a: 420000, b: 420000, c: 420000, d: 540000 });
    const r = owedBySplit(100, { method: "adjust", participants: [{ subjectId: "a", adjustMinor: -200 }, { subjectId: "b", adjustMinor: 0 }] });
    expect(r.ok).toBe(false);
  });
  it("refuses nobody and duplicates", () => {
    expect(owedBySplit(100, { method: "equal", participants: [] })).toEqual({ ok: false, problems: [{ kind: "no_one" }] });
    expect(owedBySplit(100, { method: "equal", participants: ["a", "a"] })).toEqual({ ok: false, problems: [{ kind: "duplicate_person", subjectId: "a" }] });
  });
});

describe("one item", () => {
  it("portions share it by weight", () => {
    const { result, problems } = splitItem({ totalMinor: 1000, shares: [{ subjectId: "a", mode: "portion", value: 1000 }, { subjectId: "b", mode: "portion", value: 2000 }] });
    expect(problems).toEqual([]);
    expect(result.amounts).toEqual([{ subjectId: "a", amountMinor: 333 }, { subjectId: "b", amountMinor: 667 }]);
  });
  it("exact and % come off the top; portions share the rest; exact stays exact", () => {
    const { result } = splitItem({
      totalMinor: 24000,
      shares: [
        { subjectId: "m", mode: "exact", value: 10000 },
        { subjectId: "p", mode: "pct", value: 2500 },
        { subjectId: "a", mode: "portion", value: 500 },
        { subjectId: "d", mode: "portion", value: 1000 },
      ],
    });
    // 24 000 − 10 000 − 6 000 = 8 000 shared ½ : 1.
    expect(result.amounts.map((x) => x.amountMinor)).toEqual([10000, 6000, 2667, 5333]);
    expect(result.amounts.reduce((s, x) => s + x.amountMinor, 0)).toBe(24000);
  });
  it("⅓ portions (333) still add up", () => {
    const { result } = splitItem({ totalMinor: 100, shares: ["a", "b", "c"].map((subjectId) => ({ subjectId, mode: "portion" as const, value: 333 })) });
    expect(result.amounts.map((x) => x.amountMinor)).toEqual([34, 33, 33]);
  });
  it("money left over with nobody on portions, nobody at all, or more than it costs, are problems", () => {
    expect(splitItem({ totalMinor: 1000, shares: [{ subjectId: "a", mode: "exact", value: 600 }] }, 2).problems).toEqual([{ kind: "item_unassigned", item: 2, amountMinor: 400 }]);
    expect(splitItem({ totalMinor: 1000, shares: [] }, 0).problems).toEqual([{ kind: "item_unassigned", item: 0, amountMinor: 1000 }]);
    expect(splitItem({ totalMinor: 1000, shares: [{ subjectId: "a", mode: "exact", value: 800 }, { subjectId: "b", mode: "pct", value: 5000 }] }, 1).problems)
      .toEqual([{ kind: "item_over", item: 1, amountMinor: 300 }]);
    // Exactly covered by exact and %, with portions left at 0: adds up.
    const covered = splitItem({ totalMinor: 1000, shares: [{ subjectId: "a", mode: "exact", value: 500 }, { subjectId: "b", mode: "pct", value: 5000 }, { subjectId: "c", mode: "portion", value: 1000 }] });
    expect(covered.problems).toEqual([]);
    expect(covered.result.amounts.map((x) => x.amountMinor)).toEqual([500, 500, 0]);
  });
});

describe("an itemized bill", () => {
  const bill = (adjustments: { kind: "tax" | "service" | "discount"; amountMinor: number }[], _totalMinor: number): SplitSpec & { method: "items" } => ({
    method: "items",
    items: [
      { totalMinor: 68000, shares: [{ subjectId: "anu", mode: "portion", value: 1000 }, { subjectId: "meera", mode: "portion", value: 1000 }] },
      { totalMinor: 84000, shares: [{ subjectId: "you", mode: "portion", value: 1000 }, { subjectId: "dev", mode: "portion", value: 1000 }] },
      { totalMinor: 32000, shares: ["you", "anu", "dev", "meera"].map((subjectId) => ({ subjectId, mode: "portion" as const, value: 1000 })) },
    ],
    adjustments,
  });

  it("spreads tax, service and a discount by each person's items, to the paisa", () => {
    const spec = bill([{ kind: "tax", amountMinor: 9200 }, { kind: "service", amountMinor: 18400 }, { kind: "discount", amountMinor: 5000 }], 184000 + 22600);
    const r = owedBySplit(206600, spec);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    const items = Object.fromEntries(r.value.breakdown.map((b) => [b.subjectId, b.itemsMinor]));
    expect(items).toEqual({ anu: 42000, meera: 42000, you: 50000, dev: 50000 });
    const adj = Object.fromEntries(r.value.breakdown.map((b) => [b.subjectId, b.adjustmentsMinor]));
    // 22 600 by 42 : 42 : 50 : 50 (largest remainder, ties to the earlier).
    expect(adj).toEqual({ anu: 5159, meera: 5159, you: 6141, dev: 6141 });
    expect(r.value.owed.reduce((s, o) => s + o.owedMinor, 0)).toBe(206600);
  });

  it("must match the bill's total", () => {
    const r = owedBySplit(184001, bill([], 184001));
    expect(r).toEqual({ ok: false, problems: [{ kind: "total_mismatch", totalMinor: 184001, assignedMinor: 184000 }] });
  });

  it("several payers, merged with what each owes", () => {
    const built = buildSplitecoSplits(206600, [{ subjectId: "anu", amountMinor: 100000 }, { subjectId: "you", amountMinor: 106600 }], bill([{ kind: "tax", amountMinor: 22600 }], 206600));
    if (!built.ok) throw new Error(JSON.stringify(built.problems));
    expect(built.splits.find((s) => s.subjectId === "anu")).toEqual({ subjectId: "anu", paidMinor: 100000, owedMinor: 47159 });
    expect(built.splits.reduce((s, x) => s + x.paidMinor, 0)).toBe(206600);
    expect(buildSplitecoSplits(100, [{ subjectId: "a", amountMinor: 99 }], { method: "equal", participants: ["a"] })).toEqual({
      ok: false,
      problems: [{ kind: "payers_mismatch", totalMinor: 100, paidMinor: 99 }],
    });
  });

  it("names everyone on it", () => {
    expect(splitPeople(bill([], 0))).toEqual(["anu", "meera", "you", "dev"]);
  });
});
