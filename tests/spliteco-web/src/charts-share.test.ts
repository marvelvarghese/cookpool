import type { SplitecoExpenseSummary } from "@saas/contracts/spliteco";
import { barHeights, changePct, compactAmount, donutSegments, percentLabels, previousMonth } from "@/lib/charts";
import { cardText, exportFileName } from "@/lib/share";
import { byMonth, expenseTags, myRowEffect } from "@/lib/view";
import { bucketParts, missingMembers, planLines } from "@/lib/groups";
import { problemText } from "@/lib/problems";
import { myItems } from "@/lib/expense-view";

describe("charts", () => {
  it("donut arcs cover the circle in order", () => {
    const segs = donutSegments([3, 1], 100, 0);
    expect(segs.map((s) => s.dash)).toEqual(["75 25", "25 75"]);
    expect(segs.map((s) => s.offset)).toEqual([-0, -75]);
  });

  it("percent labels add up to 100", () => {
    expect(percentLabels([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentLabels([0, 0])).toEqual([0, 0]);
  });

  it("bars and labels", () => {
    expect(barHeights([0, 50, 100], 190)).toEqual([0, 95, 190]);
    expect(compactAmount(1_248_000)).toBe("12.5k");
    expect(compactAmount(64_000)).toBe("640");
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(changePct(144, 100)).toBe(44);
    expect(changePct(5, 0)).toBeNull();
  });
});

const row = (over: Partial<SplitecoExpenseSummary>): SplitecoExpenseSummary => ({
  id: "txn_1", groupId: "org_1", groupName: "Goa Trip", kind: "expense", app: "spliteco", bucket: "other", title: "Dinner", category: "food",
  method: "equal", totalMinor: 100_000, currency: "INR", occurredAt: "2026-11-10T12:00:00.000Z", createdAt: "2026-11-10T12:00:00.000Z",
  createdBy: "usr_a", payers: [{ subjectId: "usr_a", paidMinor: 100_000 }], splits: [], myNetMinor: 0, locked: false, viaDelegation: null, ...over,
});

describe("rows", () => {
  it("tags itemized, shares, several payers and Cookpool", () => {
    expect(expenseTags(row({ method: "items" }))).toEqual(["Itemized"]);
    expect(expenseTags(row({ method: "shares", payers: [{ subjectId: "a", paidMinor: 1 }, { subjectId: "b", paidMinor: 1 }] }))).toEqual(["Shares", "2 payers"]);
    expect(expenseTags(row({ app: "cookpool", kind: "use", method: null }))).toEqual(["Cookpool"]);
  });

  it("tags Spliteco's rows in a Cookpool-made group as Other", () => {
    expect(expenseTags(row({}), true)).toEqual(["Other"]);
    expect(expenseTags(row({}), false)).toEqual([]);
    expect(expenseTags(row({ app: "cookpool", kind: "use", bucket: "kitchen", method: null }), true)).toEqual(["Cookpool"]);
  });

  it("shows a kitchen group's two balances, and nothing for Spliteco's groups", () => {
    expect(bucketParts(null, "INR")).toBeNull();
    expect(bucketParts({ kitchen: 12_000, other: -4_000 }, "INR")).toEqual([
      { label: "Kitchen", amount: "+₹120.00", tone: "get" },
      { label: "Other", amount: "−₹40.00", tone: "owe" },
    ]);
    expect(bucketParts({ kitchen: 0, other: 0 }, "INR")![0]).toEqual({ label: "Kitchen", amount: "₹0.00", tone: "even" });
  });

  it("says lent or borrowed", () => {
    expect(myRowEffect(row({ myNetMinor: 270_000 }))).toEqual({ label: "you lent", amount: "₹2,700.00", tone: "get" });
    expect(myRowEffect(row({ myNetMinor: -60_000 }))).toEqual({ label: "you borrowed", amount: "₹600.00", tone: "owe" });
  });

  it("groups rows by month, newest first as given", () => {
    const m = byMonth([row({ occurredAt: "2026-11-10T00:00:00Z" }), row({ occurredAt: "2026-10-03T00:00:00Z" })]);
    expect(m.map(([k]) => k)).toEqual(["November 2026", "October 2026"]);
  });

  it("plan lines and who is missing from a group", () => {
    const names = new Map([["usr_m", "Meera"], ["usr_d", "Dev"]]);
    expect(planLines({ currency: "INR", myPlan: [{ subjectId: "usr_m", amountMinor: 209_000 }, { subjectId: "usr_d", amountMinor: -62_000 }] }, names)).toEqual([
      "Meera owes you ₹2,090.00",
      "You owe Dev ₹620.00",
    ]);
    expect(missingMembers(["usr_a", "usr_m", "usr_a"], ["usr_a", "usr_b"])).toEqual(["usr_m"]);
  });

  it("names a problem plainly", () => {
    const names = new Map([["usr_d", "Dev"]]);
    expect(problemText({ kind: "total_mismatch", totalMinor: 100_000, assignedMinor: 88_000 }, names, null)).toBe("₹120.00 left to assign");
    expect(problemText({ kind: "pct_not_100", basisPoints: 9000 }, names, null)).toBe("Percentages reach 90% — they need 100%");
    expect(problemText({ kind: "negative_share", subjectId: "usr_d" }, names, null)).toBe("Dev would owe less than nothing");
  });
});

describe("share & export", () => {
  it("text and file names", () => {
    expect(
      cardText({ heading: "Goa Trip · 10 Nov", title: "Beach shack dinner", subtitle: "₹4,416.00 · Anu paid", lines: [{ name: "You", amountMinor: 130_717 }], footer: "Split with Spliteco", currency: "INR" }),
    ).toBe("Beach shack dinner\nGoa Trip · 10 Nov — ₹4,416.00 · Anu paid\n• You: ₹1,307.17\nSplit with Spliteco");
    expect(exportFileName("Goa Trip!", "csv", new Date(2026, 10, 12))).toBe("goa-trip-2026-11-12.csv");
  });

  it("what you had", () => {
    const lines = myItems(
      {
        items: [
          { position: 0, name: "Fish thali", qty: 2, unitMinor: 42_000, totalMinor: 84_000, shares: [{ subjectId: "me", mode: "portion", value: 1000, amountMinor: 42_000 }, { subjectId: "x", mode: "portion", value: 1000, amountMinor: 42_000 }] },
          { position: 1, name: "Bebinca", qty: 1, unitMinor: null, totalMinor: 32_000, shares: [{ subjectId: "me", mode: "pct", value: 2500, amountMinor: 8_000 }] },
        ],
        breakdown: [{ subjectId: "me", itemsMinor: 50_000, adjustmentsMinor: 7_500, owedMinor: 57_500, paidMinor: 0 }],
      },
      "me",
    );
    expect(lines).toEqual([
      { label: "Fish thali · 1 of 2", amountMinor: 42_000 },
      { label: "Bebinca · 25%", amountMinor: 8_000 },
      { label: "Tax & service, your part", amountMinor: 7_500, muted: true },
    ]);
  });
});
