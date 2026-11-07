import type { ActivityPage, KitchenTxn } from "@saas/contracts/kitchen";
import {
  TXN_KIND_META,
  activityRow,
  flattenActivity,
  relativeWhen,
  settlementTitle,
  withTxnReversed,
  yourPartMinor,
} from "@web-console-next/components/kitchen/activity";

const ME = "usr_0000000000000000000000000000aaaa";
const DEV = "usr_00000000000000000000000000003f9a";
const ANU = "usr_0000000000000000000000000000b0b0";
const NOW = new Date(2026, 10, 2, 18, 0, 0); // 2 Nov 2026, 18:00 local

function txn(patch: Partial<KitchenTxn> & Pick<KitchenTxn, "splits">): KitchenTxn {
  return {
    id: "txn_1",
    orgId: "org_1",
    kind: "expense",
    title: "Groceries",
    totalMinor: patch.splits.reduce((a, s) => a + s.paidMinor, 0),
    currency: "INR",
    occurredAt: new Date(2026, 10, 2, 15, 0, 0).toISOString(),
    createdBy: ME,
    createdAt: new Date(2026, 10, 2, 15, 0, 0).toISOString(),
    sourceKind: null,
    sourceId: null,
    reverses: null,
    reversed: false,
    reversedBy: null,
    method: null,
    note: null,
    ...patch,
  };
}

/** Rahul paid ₹120 for three, split equally. */
const dinner = txn({
  splits: [
    { subjectId: ME, paidMinor: 12_000, owedMinor: 4_000 },
    { subjectId: DEV, paidMinor: 0, owedMinor: 4_000 },
    { subjectId: ANU, paidMinor: 0, owedMinor: 4_000 },
  ],
});

const ctx = { meId: ME, canReverseAny: false, now: NOW };

describe("your signed amount in a transaction (CP-8)", () => {
  it("is paid − owed for you: + when you get money back, − when you owe", () => {
    expect(yourPartMinor(dinner, ME)).toBe(8_000);
    expect(yourPartMinor(dinner, DEV)).toBe(-4_000);
    expect(yourPartMinor(dinner, "usr_other")).toBeNull();
    expect(yourPartMinor(dinner, null)).toBeNull();
  });

  it("adds up several lines for the same person", () => {
    const t = txn({
      splits: [
        { subjectId: ME, paidMinor: 500, owedMinor: 0 },
        { subjectId: ME, paidMinor: 0, owedMinor: 200 },
        { subjectId: DEV, paidMinor: 0, owedMinor: 300 },
      ],
    });
    expect(yourPartMinor(t, ME)).toBe(300);
  });
});

describe("an activity row", () => {
  it("shows the kind, title, who · when and your part in blue +", () => {
    const row = activityRow(dinner, ctx);
    expect(row).toMatchObject({
      glyph: "₹",
      kindLabel: "Expense",
      title: "Groceries",
      whoWhen: "You · 3 h ago",
      yourMinor: 8_000,
      tone: "owed",
      amountText: "+₹80.00",
      amountWords: "Adds ₹80.00 to your balance",
      totalText: "₹120.00",
      reversed: false,
    });
  });

  it("shows what you owe in orange −, and names whoever logged it", () => {
    const row = activityRow(dinner, { ...ctx, meId: DEV });
    expect(row).toMatchObject({
      tone: "owe",
      amountText: "−₹40.00",
      amountWords: "Takes ₹40.00 off your balance",
      whoWhen: "Member · aaaa · 3 h ago",
    });
  });

  it("is neutral when it nets to zero for you, or doesn't name you", () => {
    const even = txn({
      splits: [
        { subjectId: ME, paidMinor: 1_000, owedMinor: 1_000 },
        { subjectId: DEV, paidMinor: 0, owedMinor: 0 },
      ],
    });
    expect(activityRow(even, ctx)).toMatchObject({ tone: "neutral", amountText: "₹0.00", amountWords: "No change to your balance" });
    const notMine = activityRow(dinner, { ...ctx, meId: "usr_somebody" });
    expect(notMine).toMatchObject({ tone: "neutral", yourMinor: null, amountText: null, amountWords: "Doesn't involve you", canFlag: false });
  });

  it("has a glyph for every kind", () => {
    expect(Object.fromEntries(Object.entries(TXN_KIND_META).map(([k, v]) => [k, v.glyph]))).toEqual({
      expense: "₹",
      settlement: "✓",
      use: "U",
      dish: "D",
      waste: "W",
      reversal: "↺",
    });
  });

  it("lets its creator, or an owner or admin, undo it; anyone it names flag it", () => {
    expect(activityRow(dinner, ctx)).toMatchObject({ canUndo: true, canFlag: true });
    expect(activityRow(dinner, { ...ctx, meId: DEV })).toMatchObject({ canUndo: false, canFlag: true });
    expect(activityRow(dinner, { ...ctx, meId: DEV, canReverseAny: true })).toMatchObject({ canUndo: true });
    expect(activityRow(dinner, { ...ctx, meId: "usr_x", canReverseAny: true })).toMatchObject({ canUndo: true, canFlag: false });
  });

  it("strikes a reversed entry through: no undo, no flag", () => {
    const row = activityRow({ ...dinner, reversed: true, reversedBy: "txn_2" }, ctx);
    expect(row).toMatchObject({ reversed: true, canUndo: false, canFlag: false, amountText: "+₹80.00" });
  });

  it("shows a reversal as ↺ with its own (opposite) amount, and offers no undo of it", () => {
    const reversal = txn({
      id: "txn_2",
      kind: "reversal",
      title: "Reversal: Groceries",
      reverses: "txn_1",
      splits: dinner.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })),
    });
    const row = activityRow(reversal, ctx);
    expect(row).toMatchObject({ glyph: "↺", amountText: "−₹80.00", tone: "owe", canUndo: false, canFlag: true });
  });
});

describe("a payment's row", () => {
  const paid = txn({
    kind: "settlement",
    title: "Payment",
    method: "upi",
    createdBy: ANU,
    splits: [
      { subjectId: ANU, paidMinor: 50_000, owedMinor: 0 },
      { subjectId: ME, paidMinor: 0, owedMinor: 50_000 },
    ],
  });

  it("is titled by who paid whom, and how", () => {
    expect(activityRow(paid, ctx).title).toBe("Member · b0b0 paid you · UPI");
    expect(settlementTitle(paid, ANU)).toBe("You paid Member · aaaa · UPI");
    expect(settlementTitle({ ...paid, method: null }, "usr_x")).toBe("Member · b0b0 paid Member · aaaa");
  });

  // SM-11: a group's feed shows a payment as the money that moved (SM-10 did it on Home).
  it("shows money paid to you as + in blue, and money you paid as − in orange", () => {
    expect(activityRow(paid, ctx)).toMatchObject({ glyph: "✓", tone: "owed", amountText: "+₹500.00", amountWords: "You received ₹500.00" });
    expect(activityRow(paid, { ...ctx, meId: ANU })).toMatchObject({ tone: "owe", amountText: "−₹500.00", amountWords: "You paid ₹500.00" });
    // What it did to your balance is unchanged underneath: you are owed ₹500 less.
    expect(activityRow(paid, ctx).yourMinor).toBe(-50_000);
  });

  it("is not involved when it doesn't name you, and leaves other kinds as what they did to your balance", () => {
    expect(activityRow(paid, { ...ctx, meId: DEV })).toMatchObject({ amountText: null, tone: "neutral" });
    expect(activityRow(dinner, ctx)).toMatchObject({ tone: "owed", amountText: "+₹80.00" });
  });
});

describe("relativeWhen", () => {
  const at = (d: Date) => d.toISOString();
  it("says just now, minutes, hours today, yesterday, then a date", () => {
    expect(relativeWhen(at(new Date(2026, 10, 2, 17, 59, 30)), NOW)).toBe("Just now");
    expect(relativeWhen(at(new Date(2026, 10, 2, 17, 55)), NOW)).toBe("5 min ago");
    expect(relativeWhen(at(new Date(2026, 10, 2, 0, 30)), NOW)).toBe("17 h ago");
    expect(relativeWhen(at(new Date(2026, 10, 1, 23, 0)), NOW)).toBe("Yesterday");
    expect(relativeWhen(at(new Date(2026, 9, 12, 9, 0)), NOW)).toBe("12 Oct");
    expect(relativeWhen(at(new Date(2025, 9, 12, 9, 0)), NOW)).toBe("12 Oct 2025");
    expect(relativeWhen("not a date", NOW)).toBe("");
  });
});

describe("the feed's pages", () => {
  const page = (items: KitchenTxn[], nextCursor: string | null): ActivityPage => ({ items, nextCursor });
  const t2 = { ...dinner, id: "txn_2", title: "Milk" };

  it("marks one entry undone without touching the rest (the optimistic step of Undo)", () => {
    const data = { pages: [page([dinner], "c1"), page([t2], null)], pageParams: [null, "c1"] };
    const next = withTxnReversed(data, "txn_2");
    expect(next.pages[1]!.items[0]!.reversed).toBe(true);
    expect(next.pages[0]).toBe(data.pages[0]);
    expect(data.pages[1]!.items[0]!.reversed).toBe(false);
    expect(next.pageParams).toBe(data.pageParams);
    expect(withTxnReversed(data, "txn_missing")).toBe(data);
  });

  it("flattens in order and drops an entry repeated across a page boundary", () => {
    expect(flattenActivity([page([dinner, t2], "c"), page([t2], null)]).map((t) => t.id)).toEqual(["txn_1", "txn_2"]);
  });
});
