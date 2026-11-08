import type { MyBalancesResponse, MyGroupBalance, PersonBalance } from "@saas/contracts/kitchen";
import {
  SETTLE_UP_HREF,
  moneyGroups,
  moneyHref,
  moneyListFrom,
  moneyPeople,
  moneyTotals,
  sharedGroupText,
} from "@web-console-next/components/kitchen/money-page";
import { frameRedirect } from "@web-console-next/lib/features";

// cookpool-recipes RC-2 (design §1.3, §1.4): Money, the new frame's tab —
// your money one figure per currency, Settle up and Bill, then People |
// Groups. Money lives only here, and only in the new frame.

const ANU = "usr_00000000000000000000000000000a01";
const DEV = "usr_00000000000000000000000000000d02";
const KIRAN = "usr_00000000000000000000000000000c03";
const MEERA = "usr_00000000000000000000000000000e04";

const group = (orgId: string, name: string, currency: string, balanceMinor: number, memberCount = 3): MyGroupBalance => ({
  orgId,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  currency,
  balanceMinor,
  role: "builder",
  memberCount,
});

const person = (subjectId: string, displayName: string | null, groups: PersonBalance["groups"]): PersonBalance => ({ subjectId, displayName, groups });
const net = (orgId: string, name: string, currency: string, netMinor: number) => ({ orgId, slug: name.toLowerCase().replace(/\s+/g, "-"), name, currency, netMinor });

const DATA: MyBalancesResponse = {
  groups: [group("org_flat", "Flat 4B", "INR", 4000, 4), group("org_lunch", "Lunch club", "INR", -1250, 6), group("org_trip", "Goa trip", "USD", 0, 3)],
  people: [
    person(ANU, "Anu Thomas", [net("org_flat", "Flat 4B", "INR", 4000)]),
    person(DEV, "Dev", [net("org_lunch", "Lunch club", "INR", -1250), net("org_trip", "Goa trip", "USD", 900)]),
    person(KIRAN, null, [net("org_flat", "Flat 4B", "INR", 0)]),
    person(MEERA, "Meera", [net("org_flat", "Flat 4B", "INR", 0), net("org_lunch", "Lunch club", "INR", 0)]),
  ],
  totals: [
    { currency: "INR", owedToYouMinor: 4000, youOweMinor: 1250, netMinor: 2750 },
    { currency: "USD", owedToYouMinor: 900, youOweMinor: 0, netMinor: 900 },
  ],
};

describe("Money's figures", () => {
  it("are one per currency with money open, your currency first", () => {
    expect(moneyTotals(DATA).map((l) => l.text)).toEqual(["You get back ₹27.50", "You get back $9.00"]);
  });

  it("say you owe in the owe colour's tone, and Settled up when nothing is open", () => {
    expect(moneyTotals({ groups: DATA.groups, totals: [{ currency: "INR", owedToYouMinor: 0, youOweMinor: 1250, netMinor: -1250 }] })).toMatchObject([
      { tone: "owe", label: "You owe", amount: "₹12.50" },
    ]);
    expect(moneyTotals({ groups: DATA.groups, totals: [{ currency: "INR", owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 }] })).toMatchObject([
      { tone: "settled", label: "Settled up", amount: null },
    ]);
  });
});

describe("Money's People", () => {
  const rows = moneyPeople(DATA);

  it("lists everyone you share a group with, the largest amount first, then by name", () => {
    expect(rows.map((r) => r.label)).toEqual(["Anu Thomas", "Dev", "Meera", "Member · 0c03"]);
  });

  it("shows a shared group, with +N for more", () => {
    expect(rows.map((r) => r.group)).toEqual(["Flat 4B", "Lunch club +1", "Flat 4B +1", "Flat 4B"]);
    expect(sharedGroupText([])).toBeNull();
  });

  it("gives each amount its direction, one per currency, never added across", () => {
    expect(rows[0]!.amounts).toEqual([{ currency: "INR", tone: "owed", words: "you get back", amount: "₹40.00" }]);
    expect(rows[1]!.amounts).toEqual([
      { currency: "INR", tone: "owe", words: "you owe", amount: "₹12.50" },
      { currency: "USD", tone: "owed", words: "you get back", amount: "$9.00" },
    ]);
    expect(rows[2]!.amounts).toEqual([{ currency: "INR", tone: "settled", words: "settled", amount: null }]);
  });

  it("opens each person's page", () => {
    expect(rows[0]!.href).toBe(`/people/${ANU}`);
  });

  it("is empty with no one else", () => {
    expect(moneyPeople({ people: [] })).toEqual([]);
    expect(moneyPeople(null)).toEqual([]);
  });
});

describe("Money's Groups", () => {
  const orgs = [
    { id: "org_flat", slug: "flat-4b", name: "Flat 4B", createdAt: "2026-01-01T00:00:00Z" },
    { id: "org_lunch", slug: "lunch-club", name: "Lunch club", createdAt: "2026-03-01T00:00:00Z" },
    { id: "org_trip", slug: "goa-trip", name: "Goa trip", createdAt: "2026-02-01T00:00:00Z" },
  ];
  const balances = new Map(DATA.groups.map((g) => [g.orgId, g] as const));

  it("lists your groups, the ones you opened last first, then the newest", () => {
    expect(moneyGroups(orgs, balances, ["goa-trip"]).map((r) => r.name)).toEqual(["Goa trip", "Lunch club", "Flat 4B"]);
  });

  it("shows how many are in each and your balance there, nothing when settled", () => {
    const rows = moneyGroups(orgs, balances);
    expect(rows.map((r) => [r.name, r.people, r.money?.text ?? null])).toEqual([
      ["Lunch club", "6 people", "You owe ₹12.50"],
      ["Goa trip", "3 people", null],
      ["Flat 4B", "4 people", "You get back ₹40.00"],
    ]);
  });

  it("opens today's group page", () => {
    expect(moneyGroups(orgs, balances)[0]!.href).toBe("/groups/lunch-club");
  });

  it("waits for the balances without making up a number", () => {
    expect(moneyGroups(orgs, new Map()).map((r) => [r.people, r.money])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
  });
});

describe("Money's list and actions", () => {
  it("shows People unless the address says Groups, and keeps the choice in the address", () => {
    expect(moneyListFrom(null)).toBe("people");
    expect(moneyListFrom("groups")).toBe("groups");
    expect(moneyListFrom("nope")).toBe("people");
    expect(moneyHref("people")).toBe("/money");
    expect(moneyHref("groups")).toBe("/money?list=groups");
  });

  it("settles up on today's settle screen", () => {
    expect(SETTLE_UP_HREF).toBe("/people");
  });

  it("is a new-frame page: a prod visitor is sent Home", () => {
    expect(frameRedirect("/money", false)).toBe("/home");
    expect(frameRedirect("/money", true)).toBeNull();
  });
});
