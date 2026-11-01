import type { SettlePlan } from "@saas/contracts/kitchen";
import {
  ALL_GROUPS,
  SETTLE_METHODS,
  homeSettleSummary,
  initialSettleChoice,
  mergeAllGroups,
  netFromPlan,
  paymentDirection,
  paymentSentence,
  settlementRequest,
  workingLine,
  type GroupPlan,
} from "@web-console-next/components/kitchen/settle";

const ME = "usr_0000000000000000000000000000aaaa";
const DEV = "usr_00000000000000000000000000003f9a";
const ANU = "usr_0000000000000000000000000000b0b0";
const KIRAN = "usr_0000000000000000000000000000c1c1";

const FLAT = { id: "org_flat", name: "Flat 4B", slug: "flat-4b-k3x9" };
const LUNCH = { id: "org_lunch", name: "Lunch club", slug: "lunch-club-a1b2" };
const TRIP = { id: "org_trip", name: "Goa trip", slug: "goa-trip-z9z9" };
const OFFICE = { id: "org_office", name: "Office", slug: "office-q1q1" };

const flatPlan: SettlePlan = {
  currency: "INR",
  payments: [
    { fromSubjectId: DEV, toSubjectId: ME, amountMinor: 4_575 },
    { fromSubjectId: ANU, toSubjectId: ME, amountMinor: 4_075 },
    { fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 1_000 },
  ],
  working: { debts: 10, pairs: 5, payments: 3 },
};
const lunchPlan: SettlePlan = {
  currency: "INR",
  payments: [{ fromSubjectId: ME, toSubjectId: KIRAN, amountMinor: 2_400 }],
  working: { debts: 1, pairs: 1, payments: 1 },
};
const tripPlan: SettlePlan = {
  currency: "USD",
  payments: [{ fromSubjectId: ME, toSubjectId: DEV, amountMinor: 5_000 }],
  working: { debts: 2, pairs: 1, payments: 1 },
};

const loaded = (group: GroupPlan["group"], plan: SettlePlan): GroupPlan => ({ group, plan, loading: false, failed: false });

describe("the working line (CP-8)", () => {
  it("reads debts → pairs → payments", () => {
    expect(workingLine({ debts: 10, pairs: 5, payments: 3 })).toBe("10 debts → 5 after pairs cancel → 3 payments");
    expect(workingLine({ debts: 1, pairs: 1, payments: 1 })).toBe("1 debt → 1 after pairs cancel → 1 payment");
    expect(workingLine({ debts: 0, pairs: 0, payments: 0 })).toBe("0 debts → 0 after pairs cancel → 0 payments");
  });
});

describe("one payment", () => {
  it("says who pays whom, from your side", () => {
    expect(paymentSentence({ fromSubjectId: ME, toSubjectId: DEV, amountMinor: 1 }, ME)).toBe("You pay Member · 3f9a");
    expect(paymentSentence({ fromSubjectId: DEV, toSubjectId: ME, amountMinor: 1 }, ME)).toBe("Member · 3f9a pays you");
    expect(paymentSentence({ fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 1 }, ME)).toBe("Member · b0b0 pays Member · 3f9a");
    expect(paymentDirection({ fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 1 }, ME)).toBe("others");
  });

  it("records as the planned payment with the method chosen", () => {
    expect(SETTLE_METHODS.map((m) => m.label)).toEqual(["UPI", "Cash", "Bank"]);
    expect(settlementRequest(flatPlan.payments[0]!, "upi")).toEqual({
      fromSubjectId: DEV,
      toSubjectId: ME,
      amountMinor: 4_575,
      method: "upi",
    });
  });

  it("a person's net from a plan is their balance", () => {
    expect(netFromPlan(flatPlan, ME)).toBe(8_650);
    expect(netFromPlan(flatPlan, ANU)).toBe(-5_075);
    expect(netFromPlan(flatPlan, DEV)).toBe(-3_575);
    expect(netFromPlan(flatPlan, KIRAN)).toBe(0);
  });
});

describe("All groups: every group's payments that involve you", () => {
  it("merges them — what you pay first, then what you get, largest first — and leaves others' payments out", () => {
    const merged = mergeAllGroups([loaded(FLAT, flatPlan), loaded(LUNCH, lunchPlan), loaded(TRIP, tripPlan)], ME);
    expect(merged.payments.map((p) => [p.group.name, p.direction, p.amountMinor, p.currency])).toEqual([
      ["Goa trip", "you_pay", 5_000, "USD"],
      ["Lunch club", "you_pay", 2_400, "INR"],
      ["Flat 4B", "you_receive", 4_575, "INR"],
      ["Flat 4B", "you_receive", 4_075, "INR"],
    ]);
    expect(merged.payments.some((p) => p.fromSubjectId === ANU && p.toSubjectId === DEV)).toBe(false);
  });

  it("totals per currency, never mixing them", () => {
    const merged = mergeAllGroups([loaded(FLAT, flatPlan), loaded(LUNCH, lunchPlan), loaded(TRIP, tripPlan)], ME);
    expect(merged.totals).toEqual([
      { currency: "USD", youPayMinor: 5_000, youGetMinor: 0 },
      { currency: "INR", youPayMinor: 2_400, youGetMinor: 8_650 },
    ]);
  });

  it("counts groups still loading and names the ones that failed", () => {
    const merged = mergeAllGroups(
      [
        loaded(FLAT, flatPlan),
        { group: LUNCH, plan: null, loading: true, failed: false },
        { group: OFFICE, plan: null, loading: false, failed: true },
      ],
      ME,
    );
    expect(merged.pending).toBe(1);
    expect(merged.failed).toEqual([OFFICE]);
    expect(merged.payments).toHaveLength(2);
  });

  it("is empty when you're settled up everywhere", () => {
    expect(mergeAllGroups([loaded(FLAT, { ...flatPlan, payments: [] })], ME)).toEqual({
      payments: [],
      totals: [],
      pending: 0,
      failed: [],
    });
  });
});

describe("Home's balance card", () => {
  it("lists your non-zero balance per group, largest first, and shows Settle up", () => {
    const s = homeSettleSummary(
      [loaded(FLAT, flatPlan), loaded(LUNCH, lunchPlan), loaded(OFFICE, { ...lunchPlan, payments: [] })],
      ME,
    );
    expect(s.balances.map((b) => [b.group.name, b.netMinor, b.currency])).toEqual([
      ["Flat 4B", 8_650, "INR"],
      ["Lunch club", -2_400, "INR"],
    ]);
    expect(s.settleUp).toBe(true);
    expect(s.loading).toBe(false);
  });

  it("keeps the empty state (no balances, no Settle up) when no plan involves you", () => {
    const others: SettlePlan = { ...flatPlan, payments: [{ fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 1_000 }] };
    expect(homeSettleSummary([loaded(FLAT, others)], ME)).toEqual({ balances: [], settleUp: false, loading: false });
    expect(homeSettleSummary([{ group: FLAT, plan: null, loading: true, failed: false }], ME).loading).toBe(true);
    expect(homeSettleSummary([loaded(FLAT, flatPlan)], null).settleUp).toBe(false);
  });
});

describe("which group Settle up opens on", () => {
  it("the group you came from, else All groups", () => {
    expect(initialSettleChoice("flat-4b-k3x9", [FLAT, LUNCH])).toBe("flat-4b-k3x9");
    expect(initialSettleChoice("not-mine", [FLAT, LUNCH])).toBe(ALL_GROUPS);
    expect(initialSettleChoice(null, [FLAT])).toBe(ALL_GROUPS);
  });
});
