import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { MyBalancesResponse } from "@saas/contracts/kitchen";
import {
  MONEY_PEOPLE_ROWS,
  groupFact,
  groupMeta,
  moneyGroups,
  moneyNets,
  moneyPeople,
  personAction,
  personLine,
  personTone,
  remindText,
  signedMoney,
} from "@web-console-next/components/kitchen/money-page";
import {
  GROUP_TABS,
  GROUP_TAB_ROWS,
  balanceFact,
  groupAddChoices,
  groupFaces,
  groupPill,
  groupTabFrom,
  groupTabHref,
} from "@web-console-next/components/kitchen/group-page";

// The revamp RV-5 (the canvas's RvMoney, RvGroups, RvGroup): Money, Groups and
// a group's page in the new look — the same numbers, said shorter, one button
// per row.

const ANU = "usr_00000000000000000000000000000a01";
const DEV = "usr_00000000000000000000000000000d02";
const KIRAN = "usr_00000000000000000000000000000c03";
const ME = "usr_00000000000000000000000000000f05";

const net = (orgId: string, name: string, currency: string, netMinor: number) => ({ orgId, slug: name.toLowerCase().replace(/\s+/g, "-"), name, currency, netMinor });

const DATA: MyBalancesResponse = {
  groups: [
    { orgId: "org_flat", slug: "flat-4b", name: "Flat 4B", currency: "INR", balanceMinor: 8700, role: "builder", memberCount: 4 },
    { orgId: "org_lunch", slug: "lunch-club", name: "Lunch club", currency: "INR", balanceMinor: -2500, role: "builder", memberCount: 1 },
    { orgId: "org_trip", slug: "goa-trip", name: "Goa trip", currency: "INR", balanceMinor: 0, role: "builder", memberCount: 5 },
  ],
  people: [
    { subjectId: ANU, displayName: "Anu Thomas", groups: [net("org_flat", "Flat 4B", "INR", 5400)] },
    { subjectId: DEV, displayName: "Dev", groups: [net("org_lunch", "Lunch club", "INR", -2500), net("org_trip", "Goa trip", "USD", 900)] },
    { subjectId: KIRAN, displayName: "Kiran", groups: [net("org_flat", "Flat 4B", "INR", 0)] },
  ],
  totals: [{ currency: "INR", owedToYouMinor: 8700, youOweMinor: 2500, netMinor: 6200 }],
};

describe("Money's big figure", () => {
  it("is the net, signed and coloured by direction", () => {
    expect(moneyNets(DATA)).toEqual([{ currency: "INR", tone: "owed", label: "You get back", figure: "+₹62.00" }]);
    expect(moneyNets({ groups: DATA.groups, totals: [{ currency: "INR", owedToYouMinor: 0, youOweMinor: 2500, netMinor: -2500 }] })).toMatchObject([
      { tone: "owe", label: "You owe", figure: "−₹25.00" },
    ]);
  });

  it("says All settled at zero", () => {
    expect(moneyNets({ groups: DATA.groups, totals: [{ currency: "INR", owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 }] })).toMatchObject([
      { tone: "settled", label: "All settled", figure: "₹0.00" },
    ]);
  });

  it("signs an amount without changing it", () => {
    expect([signedMoney(8700, "INR"), signedMoney(-2500, "INR"), signedMoney(0, "INR")]).toEqual(["+₹87.00", "−₹25.00", "₹0.00"]);
  });
});

describe("Money's people rows", () => {
  const rows = moneyPeople(DATA);
  const by = (id: string) => rows.find((r) => r.subjectId === id)!;

  it("show three, then See all", () => {
    expect(MONEY_PEOPLE_ROWS).toBe(3);
  });

  it("read in one line, one part per currency", () => {
    expect(personLine(by(ANU))).toBe("Owes you ₹54.00");
    expect(personLine(by(DEV))).toBe("You owe ₹25.00 · Owes you $9.00");
    expect(personLine(by(KIRAN))).toBe("Settled");
  });

  it("colour the line by direction, muted when the currencies go both ways", () => {
    expect([personTone(by(ANU)), personTone(by(DEV)), personTone(by(KIRAN))]).toEqual(["owed", "settled", "settled"]);
  });

  it("have one button: Pay when you owe them anything, Remind when they owe you, none when settled", () => {
    expect([personAction(by(ANU)), personAction(by(DEV)), personAction(by(KIRAN))]).toEqual(["remind", "pay", null]);
  });

  it("remind with what they owe you, by first name", () => {
    expect(remindText("Anu Thomas", by(ANU))).toBe("Hi Anu, a reminder from Cookpool: you owe me ₹54.00.");
  });
});

describe("Money's and Groups' group rows", () => {
  it("show your balance signed, Settled at zero, nothing before the read", () => {
    expect(groupFact(DATA.groups[0])).toEqual({ tone: "owed", text: "+₹87.00" });
    expect(groupFact(DATA.groups[1])).toEqual({ tone: "owe", text: "−₹25.00" });
    expect(groupFact(DATA.groups[2])).toEqual({ tone: "settled", text: "Settled" });
    expect(groupFact(undefined)).toBeNull();
  });

  // RV-17: whole rupees where whole, as RvGroups writes them.
  it("read '4 people · +₹87' on Groups", () => {
    expect(groupMeta(DATA.groups[0])).toEqual({ people: "4 people", fact: { tone: "owed", text: "+₹87" } });
    expect(groupMeta(DATA.groups[1])).toEqual({ people: "1 person", fact: { tone: "owe", text: "−₹25" } });
    expect(groupMeta(DATA.groups[2])).toEqual({ people: "5 people", fact: { tone: "settled", text: "settled" } });
    expect(groupMeta(null)).toBeNull();
  });

  it("carry the fact on Money's rows", () => {
    const orgs = [{ id: "org_flat", slug: "flat-4b", name: "Flat 4B", createdAt: "2026-01-01T00:00:00Z" }];
    expect(moneyGroups(orgs, new Map(DATA.groups.map((g) => [g.orgId, g] as const)))[0]!.fact).toEqual({ tone: "owed", text: "+₹87.00" });
    expect(moneyGroups(orgs, new Map())[0]!.fact).toBeNull();
  });
});

describe("a group's page", () => {
  it("has Activity · Pantry · Money, in the address, Activity by default", () => {
    expect(GROUP_TABS.map((t) => t.label)).toEqual(["Activity", "Pantry", "Money"]);
    expect([groupTabFrom(null), groupTabFrom("pantry"), groupTabFrom("money"), groupTabFrom("nope")]).toEqual(["activity", "pantry", "money", "activity"]);
    expect(groupTabHref("flat-4b", "activity")).toBe("/groups/flat-4b");
    expect(groupTabHref("flat-4b", "money")).toBe("/groups/flat-4b?tab=money");
    expect(GROUP_TAB_ROWS).toBe(3);
  });

  it("stacks you first, at most four faces, and counts the rest", () => {
    expect(groupFaces([ANU, DEV, ME], ME)).toEqual({ shown: [ME, ANU, DEV], more: 0 });
    expect(groupFaces([ANU, DEV, KIRAN, ME, "usr_x", "usr_y"], ME)).toEqual({ shown: [ME, ANU, DEV, KIRAN], more: 2 });
  });

  it("shows your balance as a signed pill, Square at zero (RV-23)", () => {
    const data = { currency: "INR", balances: [{ subjectId: ME, balanceMinor: 84_200 }, { subjectId: ANU, balanceMinor: -84_200 }] };
    // RV-17: whole rupees where whole, as RvGroup writes it.
    expect(groupPill(data, ME)).toEqual({ tone: "owed", text: "+₹842" });
    expect(groupPill(data, ANU)).toEqual({ tone: "owe", text: "−₹842" });
    expect(groupPill({ currency: "INR", balances: [{ subjectId: ME, balanceMinor: 2450 }] }, ME)).toEqual({ tone: "owed", text: "+₹24.50" });
    expect(groupPill(data, DEV)).toEqual({ tone: "settled", text: "Square" });
  });

  it("signs a balance by which way it goes for them", () => {
    expect(balanceFact({ tone: "owed", amount: "₹610.00" })).toBe("+₹610.00");
    expect(balanceFact({ tone: "owe", amount: "₹24.00" })).toBe("−₹24.00");
  });

  it("adds an expense, a pantry item or a dish, for this group", () => {
    expect(groupAddChoices({ slug: "flat-4b", id: "org_flat" })).toEqual([
      { id: "expense", label: "Expense", href: "/groups/flat-4b/expense" },
      { id: "item", label: "Pantry item", href: "/pantry/new?pantry=org_flat" },
      { id: "cook", label: "Dish I cooked", href: "/cook" },
    ]);
  });
});

describe("the revamped screens' source", () => {
  const root = `${cwd()}/../../apps/web-console-next/src`;
  const files = [
    "components/kitchen/group-detail-ui.tsx",
    "app/(kitchen)/groups/page.tsx",
    "app/(kitchen)/groups/[orgSlug]/page.tsx",
  ];

  it.each(files)("%s uses tokens, no raw hex, and weights of 400 and 500 only", (file) => {
    const src = readFileSync(`${root}/${file}`, "utf8");
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(src).not.toMatch(/font-(semibold|bold|extrabold|black)\b/);
  });


  it("Groups has New group and Join with link at the top, and no round +", () => {
    const src = readFileSync(`${root}/app/(kitchen)/groups/page.tsx`, "utf8");
    expect(src).toContain("Join with link");
    expect(src).not.toContain("AddGroupSheet");
  });
});
