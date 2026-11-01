import type { MyBalancesResponse, SettlePlan } from "@saas/contracts/kitchen";
import {
  ALL_GROUPS,
  SETTLE_METHODS,
  groupPlansFromBalances,
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

describe("All groups from the cross-group read (CP-9)", () => {
  // What GET /v1/kitchen/me/balances says for the flat, lunch and trip plans above.
  const balances: MyBalancesResponse = {
    groups: [
      { orgId: FLAT.id, slug: FLAT.slug, name: FLAT.name, currency: "INR", balanceMinor: 8_650, role: "owner", memberCount: 3 },
      { orgId: TRIP.id, slug: TRIP.slug, name: TRIP.name, currency: "USD", balanceMinor: -5_000, role: "builder", memberCount: 2 },
      { orgId: LUNCH.id, slug: LUNCH.slug, name: LUNCH.name, currency: "INR", balanceMinor: -2_400, role: "viewer", memberCount: 2 },
    ],
    people: [
      {
        subjectId: DEV,
        displayName: "Dev",
        groups: [
          { orgId: FLAT.id, slug: FLAT.slug, name: FLAT.name, currency: "INR", netMinor: 4_575 },
          { orgId: TRIP.id, slug: TRIP.slug, name: TRIP.name, currency: "USD", netMinor: -5_000 },
        ],
      },
      { subjectId: ANU, displayName: "Anu", groups: [{ orgId: FLAT.id, slug: FLAT.slug, name: FLAT.name, currency: "INR", netMinor: 4_075 }] },
      { subjectId: KIRAN, displayName: null, groups: [{ orgId: LUNCH.id, slug: LUNCH.slug, name: LUNCH.name, currency: "INR", netMinor: -2_400 }] },
    ],
    totals: [
      { currency: "INR", owedToYouMinor: 8_650, youOweMinor: 2_400, netMinor: 6_250 },
      { currency: "USD", owedToYouMinor: 0, youOweMinor: 5_000, netMinor: -5_000 },
    ],
  };

  it("turns each person's net in a group into the payment that group's plan has between you", () => {
    const plans = groupPlansFromBalances(balances, ME);
    expect(plans.map((p) => p.group)).toEqual([FLAT, TRIP, LUNCH]);
    expect(plans[0]!.plan).toEqual({
      currency: "INR",
      payments: [
        { fromSubjectId: DEV, toSubjectId: ME, amountMinor: 4_575 },
        { fromSubjectId: ANU, toSubjectId: ME, amountMinor: 4_075 },
      ],
    });
    expect(plans[1]!.plan).toEqual({ currency: "USD", payments: [{ fromSubjectId: ME, toSubjectId: DEV, amountMinor: 5_000 }] });
    expect(plans.every((p) => !p.loading && !p.failed)).toBe(true);
  });

  it("merges into the same payments and per-currency totals as every group's own plan", () => {
    const fromBalances = mergeAllGroups(groupPlansFromBalances(balances, ME), ME);
    const fromPlans = mergeAllGroups([loaded(FLAT, flatPlan), loaded(LUNCH, lunchPlan), loaded(TRIP, tripPlan)], ME);
    expect(fromBalances.payments).toEqual(fromPlans.payments);
    expect(fromBalances.totals).toEqual(fromPlans.totals);
  });

  it("is empty when nothing is open between you and anyone", () => {
    const settled: MyBalancesResponse = {
      ...balances,
      people: balances.people.map((p) => ({ ...p, groups: p.groups.map((g) => ({ ...g, netMinor: 0 })) })),
    };
    expect(mergeAllGroups(groupPlansFromBalances(settled, ME), ME).payments).toEqual([]);
  });
});

describe("which group Settle up opens on", () => {
  it("the group you came from, else All groups", () => {
    expect(initialSettleChoice("flat-4b-k3x9", [FLAT, LUNCH])).toBe("flat-4b-k3x9");
    expect(initialSettleChoice("not-mine", [FLAT, LUNCH])).toBe(ALL_GROUPS);
    expect(initialSettleChoice(null, [FLAT])).toBe(ALL_GROUPS);
  });
});
