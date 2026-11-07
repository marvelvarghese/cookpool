import type { BalancesResponse, KitchenTxn } from "@saas/contracts/kitchen";
import {
  GROUP_SEARCH_FROM,
  groupBalanceRows,
  groupListRow,
  groupMoney,
  groupSettleHref,
  roleWords,
  showGroupSearch,
} from "@web-console-next/components/kitchen/group-page";
import { activityRow } from "@web-console-next/components/kitchen/activity";
import { expenseButton, initialExpenseForm, previewExpense } from "@web-console-next/components/kitchen/expense-form";

// Cookpool SM-11: Groups, a group's page and Bill under the seven rules.

const ME = "usr_0000000000000000000000000000aaaa";
const DEV = "usr_00000000000000000000000000003f9a";
const ANU = "usr_0000000000000000000000000000b0b0";
const VEENA = "usr_0000000000000000000000000000e3e3";
const names = new Map([
  [DEV, "Dev Patel"],
  [ANU, "Anu"],
  [VEENA, "veena.k"],
]);

describe("a Groups row", () => {
  it("shows your balance there as a number, coloured by direction, and no role words", () => {
    const owed = groupListRow({ name: "Flat 4B" }, { balanceMinor: 8_650, currency: "INR", memberCount: 5 });
    expect(owed).toEqual({
      name: "Flat 4B",
      people: "5 people",
      money: expect.objectContaining({ tone: "owed", label: "You get back", amount: "₹86.50" }),
    });
    const owe = groupListRow({ name: "Goa trip" }, { balanceMinor: -2_500, currency: "USD", memberCount: 1 });
    expect(owe).toMatchObject({ people: "1 person", money: { tone: "owe", label: "You owe", amount: "$25.00" } });
    for (const row of [owed, owe]) expect(JSON.stringify(row)).not.toMatch(/Owner|Admin|Member|Viewer/);
  });

  it("shows nothing for a settled group (no zero cells), and no count before the read has it", () => {
    expect(groupListRow({ name: "Flat 4B" }, { balanceMinor: 0, currency: "INR", memberCount: 5 }).money).toBeNull();
    expect(groupListRow({ name: "Flat 4B" }, undefined)).toEqual({ name: "Flat 4B", people: null, money: null });
  });

  it("offers a search only past 8 groups", () => {
    expect(GROUP_SEARCH_FROM).toBe(9);
    expect(showGroupSearch(3)).toBe(false);
    expect(showGroupSearch(8)).toBe(false);
    expect(showGroupSearch(9)).toBe(true);
  });
});

const flat: BalancesResponse = {
  currency: "INR",
  balances: [
    { subjectId: ME, balanceMinor: 8_650 },
    { subjectId: ANU, balanceMinor: 0 },
    { subjectId: VEENA, balanceMinor: -350 },
    { subjectId: DEV, balanceMinor: -8_300 },
  ],
};

describe("a group's money line", () => {
  it("is your balance there in plain words, with Settle up only when you owe or are owed", () => {
    expect(groupMoney(flat, ME)).toEqual({
      line: expect.objectContaining({ tone: "owed", text: "You get back ₹86.50" }),
      settleUp: true,
    });
    expect(groupMoney({ ...flat, balances: [{ subjectId: ME, balanceMinor: -2_400 }] }, ME)).toMatchObject({
      line: { tone: "owe", text: "You owe ₹24.00" },
      settleUp: true,
    });
  });

  it("is Settled up with no Settle up when you are square, or not in the list", () => {
    expect(groupMoney({ ...flat, balances: [{ subjectId: ME, balanceMinor: 0 }] }, ME)).toMatchObject({
      line: { tone: "settled", text: "Settled up", amount: null },
      settleUp: false,
    });
    expect(groupMoney(flat, null).settleUp).toBe(false);
  });

  it("sends Settle up to People, filtered to the group", () => {
    expect(groupSettleHref("flat-4b-k3x9")).toBe("/people?group=flat-4b-k3x9");
  });
});

describe("a group's Balances section", () => {
  it("is one short line for everyone else with money open, largest first — not you, nobody at zero", () => {
    expect(groupBalanceRows(flat, ME, names)).toEqual([
      { subjectId: DEV, you: false, label: "Dev Patel", tone: "owe", words: "owes", amount: "₹83.00" },
      { subjectId: VEENA, you: false, label: "veena.k", tone: "owe", words: "owes", amount: "₹3.50" },
    ]);
    expect(groupBalanceRows(flat, DEV, names).map((r) => [r.label, r.words, r.amount])).toEqual([
      ["Member · aaaa", "gets back", "₹86.50"],
      ["veena.k", "owes", "₹3.50"],
    ]);
  });
});

describe("a group's activity: payments in the direction money moved", () => {
  const NOW = new Date(2026, 10, 2, 18, 0, 0);
  const payment = (from: string, to: string, minor: number): KitchenTxn => ({
    id: "txn_pay",
    orgId: "org_flat",
    kind: "settlement",
    title: "Payment",
    totalMinor: minor,
    currency: "INR",
    occurredAt: NOW.toISOString(),
    createdBy: from,
    createdAt: NOW.toISOString(),
    sourceKind: null,
    sourceId: null,
    reverses: null,
    reversed: false,
    reversedBy: null,
    method: "upi",
    note: null,
    splits: [
      { subjectId: from, paidMinor: minor, owedMinor: 0 },
      { subjectId: to, paidMinor: 0, owedMinor: minor },
    ],
  });
  const ctx = { meId: ME, canReverseAny: false, now: NOW, names };

  it("reads 'Anu paid you' as +₹400.00 in blue, not −₹400.00", () => {
    expect(activityRow(payment(ANU, ME, 40_000), ctx)).toMatchObject({
      title: "Anu paid you · UPI",
      amountText: "+₹400.00",
      tone: "owed",
    });
  });

  it("reads 'You paid Dev' as −₹25.00 in orange", () => {
    expect(activityRow(payment(ME, DEV, 2_500), ctx)).toMatchObject({
      title: "You paid Dev Patel · UPI",
      amountText: "−₹25.00",
      tone: "owe",
    });
  });
});

describe("Bill: equally by default (SM-11)", () => {
  const people = [ME, ANU, DEV];

  it("starts equally between everyone, so a title and an amount are all a bill needs", () => {
    const f = { ...initialExpenseForm(people, ME), title: "Vegetables", amount: "100" };
    expect(f.mode).toBe("equal");
    const preview = previewExpense(f, people);
    expect(preview.request).toEqual({
      title: "Vegetables",
      totalMinor: 10_000,
      currency: "INR",
      payers: [{ subjectId: ME, amountMinor: 10_000 }],
      mode: "equal",
      participants: [{ subjectId: ME }, { subjectId: ANU }, { subjectId: DEV }],
    });
    expect(preview.people.map((p) => p.owedMinor)).toEqual([3_334, 3_333, 3_333]);
  });

  it("names its one button: Add a bill, then the amount and who it is for", () => {
    const start = initialExpenseForm(people, ME);
    expect(expenseButton({ preview: previewExpense(start, people), mode: "equal", meId: ME, names, currency: "INR" }).title).toBe("Add a bill");
    const two = { ...start, amount: "17", included: { [ME]: true, [ANU]: true, [DEV]: false } };
    expect(expenseButton({ preview: previewExpense(two, people), mode: "equal", meId: ME, names, currency: "INR" })).toEqual({
      title: "Add · ₹17.00",
      who: "You + Anu · ₹8.50 each",
    });
  });
});

describe("Settings in plain words", () => {
  it("says roles plainly, and nothing for a member", () => {
    expect(roleWords("owner")).toBe("Owner");
    expect(roleWords("admin")).toBe("Admin");
    expect(roleWords("viewer")).toBe("Can only view");
    expect(roleWords("member")).toBeNull();
    expect(roleWords(null)).toBeNull();
  });
});
