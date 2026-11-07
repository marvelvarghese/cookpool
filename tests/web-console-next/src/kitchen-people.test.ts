import type { KitchenTxn, MyBalancesResponse, PersonGroupView, PersonViewResponse } from "@saas/contracts/kitchen";
import {
  betweenSentence,
  everyoneIn,
  firstName,
  namesFromBalances,
  netsByCurrency,
  peopleRows,
  peopleMoney,
  personHeadlines,
  personMoney,
  planSentence,
  recordOptionSentence,
  recordOptions,
  recordRequest,
  shortcutPlain,
} from "@web-console-next/components/kitchen/people";
import { memberInitials, memberLabel, memberLabelInline, nameInitials, sortMembers } from "@web-console-next/components/kitchen/members";
import { canWriteInGroup, roleFromKitchen } from "@web-console-next/components/kitchen/groups";
import { activityRow, settlementTitle } from "@web-console-next/components/kitchen/activity";
import { paymentSentence } from "@web-console-next/components/kitchen/settle";

const ME = "usr_0000000000000000000000000000aaaa";
const DEV = "usr_00000000000000000000000000003f9a";
const ANU = "usr_0000000000000000000000000000b0b0";
const KIRAN = "usr_0000000000000000000000000000c1c1";
const MEERA = "usr_0000000000000000000000000000d2d2";

const FLAT = { orgId: "org_flat", slug: "flat-4b", name: "Flat 4B" };
const LUNCH = { orgId: "org_lunch", slug: "lunch-club", name: "Lunch club" };
const TRIP = { orgId: "org_trip", slug: "goa-trip", name: "Goa trip" };

const balances: MyBalancesResponse = {
  groups: [
    { ...FLAT, currency: "INR", balanceMinor: 8_650, role: "owner", memberCount: 4 },
    { ...TRIP, currency: "USD", balanceMinor: -2_500, role: "builder", memberCount: 2 },
    { ...LUNCH, currency: "INR", balanceMinor: -2_400, role: "viewer", memberCount: 3 },
  ],
  people: [
    { subjectId: MEERA, displayName: null, groups: [{ ...FLAT, currency: "INR", netMinor: 0 }] },
    {
      subjectId: DEV,
      displayName: "Dev Patel",
      groups: [
        { ...FLAT, currency: "INR", netMinor: 4_575 },
        { ...TRIP, currency: "USD", netMinor: -2_500 },
      ],
    },
    {
      subjectId: ANU,
      displayName: "Anu",
      groups: [
        { ...FLAT, currency: "INR", netMinor: 4_075 },
        { ...LUNCH, currency: "INR", netMinor: 0 },
      ],
    },
    { subjectId: KIRAN, displayName: "  ", groups: [{ ...LUNCH, currency: "INR", netMinor: -2_400 }] },
  ],
  totals: [
    { currency: "INR", owedToYouMinor: 8_650, youOweMinor: 2_400, netMinor: 6_250 },
    { currency: "USD", owedToYouMinor: 0, youOweMinor: 2_500, netMinor: -2_500 },
  ],
};

describe("names (CP-9): memberLabel with the names the app has", () => {
  const names = namesFromBalances(balances);

  it("reads every named person from the cross-group read, skipping blank names", () => {
    expect([...names]).toEqual([
      [DEV, "Dev Patel"],
      [ANU, "Anu"],
    ]);
  });

  it("labels you as You, a named person by name, and anyone else by their id's tag", () => {
    expect(memberLabel(ME, ME, names)).toBe("You");
    expect(memberLabel(DEV, ME, names)).toBe("Dev Patel");
    expect(memberLabel(KIRAN, ME, names)).toBe("Member · c1c1");
    expect(memberLabelInline(ME, ME, names)).toBe("you");
    expect(memberLabelInline(ANU, ME, names)).toBe("Anu");
  });

  it("gives a named person their initials", () => {
    expect(nameInitials("Rahul Varghese")).toBe("RV");
    expect(nameInitials("dev.patel")).toBe("DP");
    expect(nameInitials("Anu")).toBe("A");
    expect(memberInitials(DEV, ME, names)).toBe("DP");
    expect(memberInitials(KIRAN, ME, names)).toBe("C1");
  });

  it("sorts by name, you first", () => {
    expect(sortMembers([DEV, KIRAN, ME, ANU], ME, names)).toEqual([ME, ANU, DEV, KIRAN]);
  });

  it("names people in payments and activity", () => {
    expect(paymentSentence({ fromSubjectId: DEV, toSubjectId: ME, amountMinor: 100 }, ME, names)).toBe("Dev Patel pays you");
    expect(paymentSentence({ fromSubjectId: ME, toSubjectId: ANU, amountMinor: 100 }, ME, names)).toBe("You pay Anu");
    const payment: Pick<KitchenTxn, "title" | "splits" | "method"> = {
      title: "Payment",
      method: "upi",
      splits: [
        { subjectId: ANU, paidMinor: 500, owedMinor: 0 },
        { subjectId: ME, paidMinor: 0, owedMinor: 500 },
      ],
    };
    expect(settlementTitle(payment, ME, names)).toBe("Anu paid you · UPI");
  });
});

describe("roles (CP-9): viewers write nothing", () => {
  it("maps the kitchen's roles to the app's words", () => {
    expect(roleFromKitchen("builder")).toBe("member");
    expect(roleFromKitchen("owner")).toBe("owner");
    expect(roleFromKitchen("billing_admin")).toBeNull();
    expect(roleFromKitchen("constructor")).toBeNull();
    expect(roleFromKitchen(undefined)).toBeNull();
  });

  it("lets owners, admins and members write, never viewers", () => {
    expect(canWriteInGroup("member")).toBe(true);
    expect(canWriteInGroup("viewer")).toBe(false);
    expect(canWriteInGroup(null)).toBe(false);
  });

  it("takes Undo and Flag away from a viewer's activity rows", () => {
    const txn: KitchenTxn = {
      id: "txn_1", orgId: "org_flat", kind: "expense", title: "Dinner", totalMinor: 900, currency: "INR",
      occurredAt: "2026-11-02T08:00:00.000Z", createdBy: DEV, createdAt: "2026-11-02T08:00:00.000Z", sourceKind: null,
      sourceId: null, reverses: null, reversed: false, reversedBy: null, method: null, note: null,
      splits: [
        { subjectId: DEV, paidMinor: 900, owedMinor: 300 },
        { subjectId: ME, paidMinor: 0, owedMinor: 600 },
      ],
    };
    const now = new Date("2026-11-02T09:00:00.000Z");
    const member = activityRow(txn, { meId: ME, canReverseAny: true, now, names: new Map([[DEV, "Dev"]]) });
    expect(member).toMatchObject({ canUndo: true, canFlag: true, whoWhen: "Dev · 1 h ago" });
    const viewer = activityRow(txn, { meId: ME, canReverseAny: false, now, canWrite: false });
    expect(viewer).toMatchObject({ canUndo: false, canFlag: false });
  });
});

describe("the People list (CP-9)", () => {
  it("lists everyone largest amount first — whichever way it goes — then by name", () => {
    expect(peopleRows(balances).map((r) => r.label)).toEqual(["Dev Patel", "Anu", "Member · c1c1", "Member · d2d2"]);
  });

  it("adds a person's groups up per currency, never across, dropping currencies that net to zero", () => {
    const dev = peopleRows(balances).find((r) => r.subjectId === DEV)!;
    expect(dev.nets).toEqual([
      { currency: "INR", netMinor: 4_575 },
      { currency: "USD", netMinor: -2_500 },
    ]);
    expect(dev.settled).toBe(false);
    expect(dev.groups.map((g) => g.name)).toEqual(["Flat 4B", "Goa trip"]);
    expect(dev.initial).toBe("DP");
    expect(netsByCurrency([{ currency: "INR", netMinor: 100 }, { currency: "INR", netMinor: -100 }])).toEqual([
      { currency: "INR", netMinor: 0 },
    ]);
  });

  it("marks someone with nothing open as settled", () => {
    const meera = peopleRows(balances).find((r) => r.subjectId === MEERA)!;
    expect(meera).toMatchObject({ settled: true, nets: [{ currency: "INR", netMinor: 0 }], largestMinor: 0 });
  });

  it("searches names and shared groups, every word in any order", () => {
    expect(peopleRows(balances, "dev").map((r) => r.subjectId)).toEqual([DEV]);
    expect(peopleRows(balances, "club").map((r) => r.subjectId)).toEqual([ANU, KIRAN]);
    expect(peopleRows(balances, "4b flat").map((r) => r.subjectId)).toEqual([DEV, ANU, MEERA]);
    expect(peopleRows(balances, "nobody")).toEqual([]);
    expect(peopleRows(null)).toEqual([]);
  });

});

// SM-11: People and Settle are one screen.
describe("People's headline: one per currency, no zero cells (SM-11)", () => {
  it("says each currency with money open in plain words, yours first, never added across", () => {
    expect(peopleMoney(balances).map((l) => l.text)).toEqual(["You get back ₹62.50", "You owe $25.00"]);
    expect(peopleMoney(balances).map((l) => l.tone)).toEqual(["owed", "owe"]);
  });

  it("drops a settled currency instead of showing a zero, and is one 'Settled up' when nothing is open", () => {
    const usdSettled = { ...balances, totals: [balances.totals[0]!, { currency: "USD", owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 }] };
    expect(peopleMoney(usdSettled).map((l) => l.text)).toEqual(["You get back ₹62.50"]);
    const allSettled = { ...balances, totals: balances.totals.map((t) => ({ ...t, owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 })) };
    expect(peopleMoney(allSettled)).toEqual([expect.objectContaining({ text: "Settled up", amount: null, tone: "settled" })]);
  });

  it("filtered to a group, is your balance there, in its currency", () => {
    expect(peopleMoney(balances, TRIP.orgId).map((l) => l.text)).toEqual(["You owe $25.00"]);
    expect(peopleMoney(balances, FLAT.orgId).map((l) => l.text)).toEqual(["You get back ₹86.50"]);
  });

  it("lists everyone (or everyone in the group) by name, without repeating any amount", () => {
    expect(everyoneIn(balances).map((r) => r.label)).toEqual(["Anu", "Dev Patel", "Member · c1c1", "Member · d2d2"]);
    expect(everyoneIn(balances, LUNCH.orgId).map((r) => r.subjectId)).toEqual([ANU, KIRAN]);
    expect(everyoneIn(null)).toEqual([]);
  });
});

function group(overrides: Partial<PersonGroupView> = {}): PersonGroupView {
  return {
    ...FLAT,
    currency: "INR",
    role: "builder",
    lines: [],
    pairwiseMinor: 0,
    planMinor: 9_000,
    shortcutMinor: 9_000,
    shortcutVia: { fromSubjectId: DEV, viaSubjectId: ANU, toSubjectId: ME, amountMinor: 9_000, thirdDisplayName: "Anu" },
    ...overrides,
  };
}

describe("the person view (CP-9)", () => {
  it("says the plan's other way in plain words: who pays whom directly instead of through whom (SM-11)", () => {
    const ctx = { meId: ME, otherId: DEV, otherName: "Dev" };
    expect(shortcutPlain(group(), ctx)).toBe("Dev pays you directly instead of through Anu");
    // Seen from Anu: Dev pays you instead of Anu.
    expect(
      shortcutPlain(
        group({ pairwiseMinor: 9_000, planMinor: 0, shortcutMinor: -9_000, shortcutVia: { fromSubjectId: DEV, viaSubjectId: ANU, toSubjectId: ME, amountMinor: 9_000, thirdDisplayName: "Dev Patel" } }),
        { meId: ME, otherId: ANU, otherName: "Anu" },
      ),
    ).toBe("Dev pays you directly instead of through Anu");
    // You at the start: you pay across.
    expect(
      shortcutPlain(
        group({ planMinor: -5_000, shortcutMinor: -5_000, shortcutVia: { fromSubjectId: ME, viaSubjectId: ANU, toSubjectId: DEV, amountMinor: 5_000, thirdDisplayName: null } }),
        { ...ctx, names: new Map([[ANU, "Anu"]]) },
      ),
    ).toBe("You pay Dev directly instead of through Anu");
    // You in the middle.
    expect(
      shortcutPlain(group({ shortcutVia: { fromSubjectId: KIRAN, viaSubjectId: ME, toSubjectId: DEV, amountMinor: 1_000, thirdDisplayName: "Kiran" } }), ctx),
    ).toBe("Kiran pays Dev directly instead of through you");
  });

  it("without one person who explains it, says how much is for others; nothing when the plan is just what you owe", () => {
    const ctx = { meId: ME, otherId: DEV, otherName: "Dev" };
    expect(shortcutPlain(group({ shortcutVia: null }), ctx)).toBe("Dev also pays you ₹90.00 for others");
    expect(shortcutPlain(group({ shortcutMinor: -900, shortcutVia: null }), ctx)).toBe("You also pay Dev ₹9.00 for others");
    expect(shortcutPlain(group({ shortcutMinor: 0 }), ctx)).toBeNull();
    for (const g of [group(), group({ shortcutVia: null })]) expect(shortcutPlain(g, ctx)).not.toMatch(/shortcut|route|netting/i);
  });

  it("states what you owe each other directly and what the plan asks", () => {
    expect(betweenSentence("Dev", { pairwiseMinor: 4_075, currency: "INR" })).toBe("Dev owes you ₹40.75");
    expect(betweenSentence("Dev", { pairwiseMinor: -2_400, currency: "INR" })).toBe("You owe Dev ₹24.00");
    expect(betweenSentence("Dev", { pairwiseMinor: 0, currency: "INR" })).toBe("Nothing either way");
    expect(planSentence("Dev", { planMinor: 9_000, currency: "INR", name: "Flat 4B" })).toBe("Dev pays you ₹90.00");
    expect(planSentence("Dev", { planMinor: 0, currency: "INR", name: "Flat 4B" })).toBe("Nothing to pay in Flat 4B");
  });

  const view: PersonViewResponse = {
    subjectId: DEV,
    displayName: "Dev",
    groups: [
      group(),
      group({ ...TRIP, currency: "USD", planMinor: -2_500, shortcutMinor: 0, shortcutVia: null }),
      group({ ...LUNCH, role: "viewer", planMinor: 700, shortcutMinor: 0, shortcutVia: null }),
    ],
    totals: [
      { currency: "INR", netMinor: 9_700 },
      { currency: "USD", netMinor: -2_500 },
    ],
  };

  it("puts the big number per currency: who pays whom", () => {
    expect(personHeadlines(view).map((h) => [h.tone, h.text])).toEqual([
      ["owed", "Dev pays you ₹97.00"],
      ["owe", "You pay Dev $25.00"],
    ]);
    expect(personHeadlines({ ...view, totals: [{ currency: "INR", netMinor: 0 }] }).map((h) => h.text)).toEqual(["Settled"]);
  });

  it("is one headline per currency between you two, by first name, with no zero cells (SM-11)", () => {
    const dev = { ...view, displayName: "Dev Patel" };
    expect(firstName(dev)).toBe("Dev");
    expect(firstName({ subjectId: DEV, displayName: null })).toBe("Member · 3f9a");
    expect(personMoney(dev)).toEqual([
      { currency: "INR", tone: "owed", label: "Dev pays you", amount: "₹97.00" },
      { currency: "USD", tone: "owe", label: "You pay Dev", amount: "$25.00" },
    ]);
    // A settled currency is left out; all settled is one "Settled up".
    expect(personMoney({ ...dev, totals: [{ currency: "INR", netMinor: 9_700 }, { currency: "USD", netMinor: 0 }] }).map((m) => m.currency)).toEqual(["INR"]);
    expect(personMoney({ ...dev, totals: [{ currency: "INR", netMinor: 0 }] })).toEqual([
      { currency: "INR", tone: "settled", label: "Settled up", amount: null },
    ]);
  });

  it("records a payment only in groups where the plan has one between you, and you're not a viewer", () => {
    const options = recordOptions(view, ME);
    expect(options.map((o) => [o.groupName, o.fromSubjectId, o.toSubjectId, o.amountMinor])).toEqual([
      ["Flat 4B", DEV, ME, 9_000],
      ["Goa trip", ME, DEV, 2_500],
    ]);
    expect(recordRequest(options[1]!, "cash")).toEqual({ fromSubjectId: ME, toSubjectId: DEV, amountMinor: 2_500, method: "cash" });
    expect(recordOptionSentence(options[0]!, "Dev", ME)).toBe("Dev pays you ₹90.00 in Flat 4B");
    expect(recordOptionSentence(options[1]!, "Dev", ME)).toBe("You pay Dev $25.00 in Goa trip");
    expect(recordOptions(view, null)).toEqual([]);
  });
});
