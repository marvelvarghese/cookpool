import type { KitchenSplit, KitchenTxn } from "@saas/contracts/kitchen";
import { settlePlan } from "@saas/kitchen-engine/ledger";
import { debtsBehind, toEngineTxn } from "@web-console-next/components/kitchen/debts";

const RAHUL = "usr_r";
const ANU = "usr_a";
const DEV = "usr_d";
const MEERA = "usr_m";

function txn(id: string, occurredAt: string, splits: KitchenSplit[], patch: Partial<KitchenTxn> = {}): KitchenTxn {
  return {
    id,
    orgId: "org_flat4b",
    kind: "expense",
    title: id,
    totalMinor: splits.reduce((a, s) => a + s.paidMinor, 0),
    currency: "INR",
    occurredAt,
    createdBy: RAHUL,
    createdAt: occurredAt,
    sourceKind: null,
    sourceId: null,
    reverses: null,
    reversed: false,
    reversedBy: null,
    method: null,
    note: null,
    splits,
    ...patch,
  };
}

// design.md §3, the worked example, inside Flat 4B (splits as the API
// answers them: one line per person).
const use = txn(
  "txn_use",
  "2026-11-01T18:00:00.000Z",
  [
    { subjectId: ANU, paidMinor: 1_200, owedMinor: 0 },
    { subjectId: DEV, paidMinor: 700, owedMinor: 0 },
    { subjectId: RAHUL, paidMinor: 0, owedMinor: 1_900 },
  ],
  { kind: "use", title: "Tomatoes and onions" },
);
const dish = txn(
  "txn_dish",
  "2026-11-01T20:00:00.000Z",
  [
    { subjectId: RAHUL, paidMinor: 21_100, owedMinor: 7_913 },
    { subjectId: ANU, paidMinor: 0, owedMinor: 5_275 },
    { subjectId: DEV, paidMinor: 0, owedMinor: 5_275 },
    { subjectId: MEERA, paidMinor: 0, owedMinor: 2_637 },
  ],
  { kind: "dish", title: "Paneer butter masala" },
);

describe("the debts behind a settle plan (CP-8)", () => {
  it("groups the worked example per pair, with what caused each debt", () => {
    const d = debtsBehind([dish, use]);
    expect(d.pairs.map((p) => [p.debtorId, p.creditorId, p.netMinor])).toEqual([
      [DEV, RAHUL, 4_575],
      [ANU, RAHUL, 4_075],
      [MEERA, RAHUL, 2_637],
    ]);
    const anu = d.pairs[1]!;
    // Newest first: the dish, then the tomatoes Rahul took from Anu.
    expect(anu.lines.map((l) => [l.title, l.kind, l.debtorId, l.creditorId, l.amountMinor])).toEqual([
      ["Paneer butter masala", "dish", ANU, RAHUL, 5_275],
      ["Tomatoes and onions", "use", RAHUL, ANU, 1_200],
    ]);
  });

  it("counts the working exactly as the server's settle plan does", () => {
    const txns = [dish, use];
    const d = debtsBehind(txns);
    const plan = settlePlan(txns.map(toEngineTxn));
    expect({ debts: d.debts, pairs: d.pairsLeft }).toEqual({ debts: 5, pairs: 3 });
    expect({ debts: plan.working.debts, pairs: plan.working.pairs }).toEqual({ debts: d.debts, pairs: d.pairsLeft });
  });

  it("is the same whatever order the feed comes in", () => {
    expect(debtsBehind([use, dish]).pairs).toEqual(debtsBehind([dish, use]).pairs);
  });

  it("shows an undone entry and its reversal cancelling out, last", () => {
    const groceries = txn(
      "txn_g",
      "2026-11-02T09:00:00.000Z",
      [
        { subjectId: DEV, paidMinor: 600, owedMinor: 300 },
        { subjectId: MEERA, paidMinor: 0, owedMinor: 300 },
      ],
      { title: "Groceries", reversed: true, reversedBy: "txn_rev" },
    );
    const reversal = txn(
      "txn_rev",
      "2026-11-02T09:05:00.000Z",
      [
        { subjectId: DEV, paidMinor: 300, owedMinor: 600 },
        { subjectId: MEERA, paidMinor: 300, owedMinor: 0 },
      ],
      { kind: "reversal", title: "Reversal: Groceries", reverses: "txn_g" },
    );
    const d = debtsBehind([reversal, groceries, dish, use]);
    const last = d.pairs[d.pairs.length - 1]!;
    expect([last.a, last.b, last.debtorId, last.netMinor]).toEqual([DEV, MEERA, null, 0]);
    expect(last.lines.map((l) => [l.title, l.reversed])).toEqual([
      ["Reversal: Groceries", false],
      ["Groceries", true],
    ]);
    const plan = settlePlan([reversal, groceries, dish, use].map(toEngineTxn));
    expect({ debts: d.debts, pairs: d.pairsLeft }).toEqual({ debts: plan.working.debts, pairs: plan.working.pairs });
    expect(d.pairsLeft).toBe(3);
  });

  it("is empty for an empty ledger", () => {
    expect(debtsBehind([])).toEqual({ pairs: [], debts: 0, pairsLeft: 0 });
  });
});
