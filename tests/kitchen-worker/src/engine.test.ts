import {
  MoneyError,
  costOfUse,
  formatMinor,
  splitByWeights,
  splitEqual,
  splitExact,
  splitPercent,
} from "@saas/kitchen-engine/money";
import {
  LedgerError,
  balances,
  buildDish,
  buildExpense,
  buildIngredientTake,
  buildSettlement,
  buildUse,
  buildWaste,
  pairLines,
  personView,
  reverseSplits,
  settlePlan,
  type Txn,
} from "@saas/kitchen-engine/ledger";
import { UnitError, formatQuantity, fromMilli, pricePerUnit, toMilli } from "@saas/kitchen-engine/units";

// A small seeded PRNG so property tests are repeatable.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("money: splitting", () => {
  it("splits equally and gives leftover paise to the earliest", () => {
    expect(splitEqual(100, 3)).toEqual([34, 33, 33]);
    expect(splitEqual(1700, 2)).toEqual([850, 850]);
  });

  it("gives the leftover to the largest remainder, ties by position", () => {
    // 21100 × [3,2,2,1] / 8 → 7912.5, 5275, 5275, 2637.5: one paisa left, tie → first.
    expect(splitByWeights(21100, [3, 2, 2, 1])).toEqual([7913, 5275, 5275, 2637]);
  });

  it("handles percentages with decimals and refuses ones that do not add to 100", () => {
    expect(sum(splitPercent(120000, [33.33, 33.33, 33.34]))).toBe(120000);
    expect(() => splitPercent(1000, [50, 40])).toThrow(MoneyError);
  });

  it("checks exact amounts add up", () => {
    expect(splitExact(120000, [50000, 30000, 25000, 15000])).toEqual([50000, 30000, 25000, 15000]);
    expect(() => splitExact(1000, [400, 500])).toThrow(MoneyError);
  });

  it("property: parts always sum to the total and stay within a paisa of exact", () => {
    const r = rng(42);
    for (let n = 0; n < 2000; n++) {
      const total = int(r, 0, 5_000_000);
      const weights = Array.from({ length: int(r, 1, 12) }, () => int(r, 0, 9));
      if (sum(weights) === 0) weights[0] = 1;
      const parts = splitByWeights(total, weights);
      expect(sum(parts)).toBe(total);
      const ws = sum(weights);
      parts.forEach((p, i) => {
        const exact = (total * weights[i]!) / ws;
        expect(p).toBeGreaterThanOrEqual(Math.floor(exact));
        expect(p).toBeLessThanOrEqual(Math.ceil(exact));
      });
    }
  });

  it("formats rupees", () => {
    expect(formatMinor(21100)).toBe("₹211.00");
    expect(formatMinor(120000)).toBe("₹1,200.00");
    expect(formatMinor(-11800)).toBe("−₹118.00");
  });
});

describe("money: cost of using an item", () => {
  const tomatoes = { priceMinor: 4000, qtyBoughtMilli: 1_000_000, qtyLeftMilli: 1_000_000, costTakenMinor: 0 };

  it("is proportional to what was paid", () => {
    expect(costOfUse(tomatoes, 300_000)).toBe(1200);
  });

  it("the last use takes whatever is left of the price", () => {
    expect(costOfUse({ ...tomatoes, qtyLeftMilli: 100_000, costTakenMinor: 3901 }, 100_000)).toBe(99);
  });

  it("refuses to use more than is left", () => {
    expect(() => costOfUse({ ...tomatoes, qtyLeftMilli: 100 }, 200)).toThrow(MoneyError);
  });

  it("property: using an item up in any steps costs exactly its price", () => {
    const r = rng(7);
    for (let n = 0; n < 500; n++) {
      const bought = int(r, 1, 5000) * 1000;
      const item = { priceMinor: int(r, 1, 2_000_000), qtyBoughtMilli: bought, qtyLeftMilli: bought, costTakenMinor: 0 };
      while (item.qtyLeftMilli > 0) {
        const take = Math.min(item.qtyLeftMilli, int(r, 1, Math.max(1, Math.floor(bought / 3))));
        const cost = costOfUse(item, take);
        expect(cost).toBeGreaterThanOrEqual(0);
        item.qtyLeftMilli -= take;
        item.costTakenMinor += cost;
      }
      expect(item.costTakenMinor).toBe(item.priceMinor);
    }
  });
});

describe("units", () => {
  it("parses quantities exactly into thousandths of the base unit", () => {
    expect(toMilli("1", "kg")).toBe(1_000_000);
    expect(toMilli("0.25", "L")).toBe(250_000);
    expect(toMilli(0.1, "kg")).toBe(100_000);
    expect(toMilli("1", "dozen")).toBe(12_000);
    expect(toMilli("2", "cup")).toBe(480_000);
    expect(() => toMilli("abc", "g")).toThrow(UnitError);
    expect(() => toMilli("1", "furlong")).toThrow(UnitError);
  });

  it("formats in the friendliest unit", () => {
    expect(formatQuantity(400_000, "mass", "kg")).toBe("400 g");
    expect(formatQuantity(3_200_000, "mass", "kg")).toBe("3.2 kg");
    expect(formatQuantity(7_000, "count")).toBe("7 pcs");
    expect(formatQuantity(1_000, "count")).toBe("1 pc");
    expect(fromMilli(250_000, "ml")).toBe(250);
  });

  it("prices per display unit", () => {
    expect(pricePerUnit(4000, 1_000_000, "kg")).toBe(4000);
    expect(pricePerUnit(62000, 5_000_000, "kg")).toBe(12400);
  });
});

describe("ledger: the spec's worked example", () => {
  const R = "usr_rahul", A = "usr_anu", D = "usr_dev", M = "usr_meera", K = "usr_kiran";

  it("reproduces the paneer dish to the paisa", () => {
    const flatTake = buildIngredientTake({ cookId: R, lines: [{ buyerId: A, costMinor: 1200 }, { buyerId: D, costMinor: 700 }] });
    const lunchTake = buildIngredientTake({ cookId: R, lines: [{ buyerId: K, costMinor: 2400 }] });
    expect(flatTake.totalMinor).toBe(1900);
    expect(lunchTake.splits).toEqual([
      { subjectId: K, paidMinor: 2400, owedMinor: 0 },
      { subjectId: R, paidMinor: 0, owedMinor: 2400 },
    ]);
    const dish = buildDish({
      cookId: R, totalMinor: 21100, portionsHalf: 8,
      shares: [{ subjectId: R, portionsHalf: 3 }, { subjectId: A, portionsHalf: 2 }, { subjectId: D, portionsHalf: 2 }, { subjectId: M, portionsHalf: 1 }],
    });
    expect(Object.fromEntries(dish.owedBy)).toEqual({ [R]: 7913, [A]: 5275, [D]: 5275, [M]: 2637 });

    const flat: Txn[] = [
      { id: "t1", kind: "use", title: "Ingredients", totalMinor: 1900, splits: flatTake.splits },
      { id: "t2", kind: "dish", title: "Paneer butter masala", totalMinor: 21100, splits: dish.splits },
    ];
    const bal = balances(flat);
    expect(bal.get(A)).toBe(-4075);
    expect(bal.get(D)).toBe(-4575);
    expect(bal.get(M)).toBe(-2637);
    expect(bal.get(R)).toBe(4075 + 4575 + 2637);
    const plan = settlePlan(flat);
    expect(plan.payments).toEqual([
      { fromId: D, toId: R, amountMinor: 4575 },
      { fromId: A, toId: R, amountMinor: 4075 },
      { fromId: M, toId: R, amountMinor: 2637 },
    ]);
  });

  it("unclaimed portions fall to the cook", () => {
    const d = buildDish({ cookId: R, totalMinor: 1000, portionsHalf: 4, shares: [{ subjectId: A, portionsHalf: 2 }] });
    expect(d.unclaimedHalf).toBe(2);
    expect(Object.fromEntries(d.owedBy)).toEqual({ [A]: 500, [R]: 500 });
  });

  it("refuses claims beyond the portions cooked", () => {
    expect(() => buildDish({ cookId: R, totalMinor: 1000, portionsHalf: 2, shares: [{ subjectId: A, portionsHalf: 3 }] }))
      .toThrow(LedgerError);
  });

  it("a buyer's own share of a use nets to zero", () => {
    const s = buildUse({ costMinor: 1700, buyerId: M, consumers: [R, M] });
    expect(s).toEqual([
      { subjectId: M, paidMinor: 1700, owedMinor: 850 },
      { subjectId: R, paidMinor: 0, owedMinor: 850 },
    ]);
  });

  it("waste split equally pays the buyer back from every member", () => {
    const s = buildWaste({ unusedMinor: 1600, buyerId: A, members: [R, A, D, M] });
    expect(balances([{ id: "w", kind: "waste", title: "Tomatoes", totalMinor: 1600, splits: s }]).get(A)).toBe(1200);
  });
});

describe("ledger: properties", () => {
  const people = ["usr_a", "usr_b", "usr_c", "usr_d", "usr_e", "usr_f"];

  function randomTxns(r: () => number, count: number): Txn[] {
    const out: Txn[] = [];
    for (let i = 0; i < count; i++) {
      const total = int(r, 1, 200_000);
      const pick = people.filter(() => r() < 0.6);
      const participants = (pick.length ? pick : [people[0]!]).map((p) => ({ subjectId: p, value: int(r, 1, 4) }));
      const payer = people[int(r, 0, people.length - 1)]!;
      const second = people[int(r, 0, people.length - 1)]!;
      const kind = r() < 0.5 ? "expense" : "use";
      const firstShare = int(r, 0, total);
      const payers = r() < 0.3 && second !== payer
        ? [{ subjectId: payer, amountMinor: firstShare }, { subjectId: second, amountMinor: total - firstShare }]
        : [{ subjectId: payer, amountMinor: total }];
      const splits = kind === "expense"
        ? buildExpense({ totalMinor: total, payers, mode: "shares", participants })
        : buildUse({ costMinor: total, buyerId: payer, consumers: participants.map((p) => p.subjectId) });
      out.push({ id: `t${i}`, kind, title: "x", totalMinor: total, splits });
    }
    return out;
  }

  it("every transaction balances and balances sum to zero", () => {
    const r = rng(99);
    for (let n = 0; n < 200; n++) {
      const txns = randomTxns(r, int(r, 1, 25));
      for (const t of txns) {
        expect(sum(t.splits.map((s) => s.paidMinor))).toBe(t.totalMinor);
        expect(sum(t.splits.map((s) => s.owedMinor))).toBe(t.totalMinor);
      }
      expect(sum([...balances(txns).values()])).toBe(0);
    }
  });

  it("settling the plan's payments brings every balance to zero, in at most n − 1 payments", () => {
    const r = rng(1234);
    for (let n = 0; n < 300; n++) {
      const txns = randomTxns(r, int(r, 1, 30));
      const plan = settlePlan(txns);
      const nonZero = [...balances(txns).values()].filter((v) => v !== 0).length;
      expect(plan.payments.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      expect(plan.working.pairs).toBeLessThanOrEqual(plan.working.debts);
      const settled = txns.concat(plan.payments.map((p, i) => ({
        id: `s${i}`, kind: "settlement" as const, title: "pay", totalMinor: p.amountMinor,
        splits: buildSettlement({ fromId: p.fromId, toId: p.toId, amountMinor: p.amountMinor }),
      })));
      for (const v of balances(settled).values()) expect(v).toBe(0);
    }
  });

  it("a reversal restores every balance exactly", () => {
    const r = rng(5);
    for (let n = 0; n < 200; n++) {
      const txns = randomTxns(r, int(r, 2, 20));
      const before = balances(txns);
      const victim = txns[int(r, 0, txns.length - 1)]!;
      const withReversal = txns.concat([{ id: "rev", kind: "reversal", title: "undo", totalMinor: victim.totalMinor, splits: reverseSplits(victim.splits) }]);
      const without = balances(txns.filter((t) => t !== victim));
      const after = balances(withReversal);
      for (const p of new Set([...before.keys(), ...after.keys()])) expect(after.get(p) ?? 0).toBe(without.get(p) ?? 0);
    }
  });

  it("pairwise lines add up to each person's balance", () => {
    const r = rng(77);
    for (let n = 0; n < 200; n++) {
      const txns = randomTxns(r, int(r, 1, 20));
      const fromLines = new Map<string, number>();
      for (const l of pairLines(txns)) {
        fromLines.set(l.creditorId, (fromLines.get(l.creditorId) ?? 0) + l.amountMinor);
        fromLines.set(l.debtorId, (fromLines.get(l.debtorId) ?? 0) - l.amountMinor);
      }
      for (const [p, v] of balances(txns)) expect(fromLines.get(p) ?? 0).toBe(v);
    }
  });

  it("the person view explains the plan: pairwise + shortcut = what the plan asks", () => {
    const r = rng(2024);
    for (let n = 0; n < 100; n++) {
      const txns = randomTxns(r, int(r, 1, 20));
      const v = personView(txns, "usr_a", "usr_b");
      expect(v.pairwiseMinor + v.shortcutMinor).toBe(v.planMinor);
      expect(v.lines.reduce((a, l) => a + l.signedMinor, 0)).toBe(v.pairwiseMinor);
    }
  });
});
