// cookpool-revamp RV-17: Money, a balance's why, Groups and a group's page
// follow the owner-approved boards RvMoney, RvMoneyGroup, RvGroups and
// RvGroup. One net card with the only Settle up; People and Groups three,
// then All; the why one tap away; Spliteco one quiet row; group balances from
// your view; and ONE settle path — spliteco-worker's Kitchen-only
// `/money/settle` — everywhere the new frame settles.

import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { KitchenTxn, MyBalancesResponse, PersonViewResponse } from "@saas/contracts/kitchen";
import {
  MONEY_GROUP_ROWS,
  WHY_ROWS,
  balanceLabel,
  directPay,
  groupFactWhole,
  groupMeta,
  groupWhyRows,
  moneyGroupHref,
  moneyNetsWhole,
  moneyPeople,
  personFact,
  personSettleRows,
  personWhyRows,
  remindFor,
  safeSettleBack,
  settleHref,
  settleLine,
  settleSheetRows,
  signedWhole,
  wholeMoney,
  SPLITECO_LINE,
} from "@web-console-next/components/kitchen/money-page";
import { balanceFromYou, groupMoneyHref, latestFact, latestTitle, pantryFactTone } from "@web-console-next/components/kitchen/group-page";

const ANU = "usr_00000000000000000000000000000a01";
const DEV = "usr_00000000000000000000000000000d02";
const KIRAN = "usr_00000000000000000000000000000c03";
const ME = "usr_00000000000000000000000000000f05";

const net = (orgId: string, name: string, currency: string, netMinor: number) => ({ orgId, slug: name.toLowerCase().replace(/\s+/g, "-"), name, currency, netMinor });

const DATA: MyBalancesResponse = {
  groups: [
    { orgId: "org_flat", slug: "flat-4b", name: "Flat 4B", currency: "INR", balanceMinor: 8700, role: "builder", memberCount: 4 },
    { orgId: "org_lunch", slug: "lunch-club", name: "Lunch club", currency: "INR", balanceMinor: -2500, role: "builder", memberCount: 3 },
    { orgId: "org_view", slug: "parents", name: "Parents", currency: "INR", balanceMinor: -1000, role: "viewer", memberCount: 3 },
  ],
  people: [
    { subjectId: ANU, displayName: "Anu Thomas", groups: [net("org_flat", "Flat 4B", "INR", 5400)] },
    { subjectId: DEV, displayName: "Dev", groups: [net("org_lunch", "Lunch club", "INR", -2500), net("org_view", "Parents", "INR", -1000)] },
    { subjectId: KIRAN, displayName: "Kiran", groups: [net("org_flat", "Flat 4B", "INR", 3300)] },
  ],
  totals: [{ currency: "INR", owedToYouMinor: 8700, youOweMinor: 3500, netMinor: 5200 }],
};

describe("whole rupees, as the boards write them", () => {
  it("drop .00 only when whole", () => {
    expect(wholeMoney(5400, "INR")).toBe("₹54");
    expect(wholeMoney(6250, "INR")).toBe("₹62.50");
    expect(wholeMoney(-120000, "INR")).toBe("₹1,200");
    expect([signedWhole(8700, "INR"), signedWhole(-2500, "INR"), signedWhole(0, "INR")]).toEqual(["+₹87", "−₹25", "₹0"]);
  });

  it("Money's net figure is signed and whole", () => {
    expect(moneyNetsWhole(DATA)).toEqual([{ currency: "INR", tone: "owed", label: "You get back", figure: "+₹52" }]);
  });

  it("a balance's label reads from your view", () => {
    expect([balanceLabel(1), balanceLabel(-1), balanceLabel(0)]).toEqual(["You get back", "You owe", "All square"]);
  });
});

describe("Money's People and Groups (RvMoney)", () => {
  it("say the fact after the name: owes you, you owe, square", () => {
    const rows = moneyPeople(DATA);
    const by = (id: string) => rows.find((r) => r.subjectId === id)!;
    expect(personFact(by(ANU))).toBe("owes you ₹54");
    expect(personFact(by(DEV))).toBe("you owe ₹35");
    expect(personFact({ amounts: [{ currency: "INR", tone: "settled", words: "settled", amount: null }] })).toBe("square");
  });

  it("show each group's balance from your view, Square at zero, three before All", () => {
    expect(groupFactWhole(DATA.groups[0])).toEqual({ tone: "owed", text: "+₹87" });
    expect(groupFactWhole(DATA.groups[1])).toEqual({ tone: "owe", text: "−₹25" });
    expect(groupFactWhole({ balanceMinor: 0, currency: "INR" })).toEqual({ tone: "settled", text: "Square" });
    expect(groupFactWhole(null)).toBeNull();
    expect(groupMeta(DATA.groups[0])).toEqual({ people: "4 people", fact: { tone: "owed", text: "+₹87" } });
    expect(MONEY_GROUP_ROWS).toBe(3);
  });

  it("open a group's balance and its why on Money", () => {
    expect(moneyGroupHref("org_flat")).toBe("/money?group=org_flat");
    expect(groupMoneyHref("org_flat")).toBe("/money?group=org_flat");
  });

  it("keep Spliteco to one quiet line", () => {
    expect(SPLITECO_LINE).toBe("Trips, insights, live split…");
  });
});

describe("the one settle path", () => {
  it("is spliteco-worker's Settle up, with a safe way back", () => {
    expect(settleHref("org_flat", DEV)).toBe(`/money/settle?group=org_flat&to=${DEV}`);
    expect(settleHref("org_flat", DEV, "/money")).toBe(`/money/settle?group=org_flat&to=${DEV}&back=%2Fmoney`);
    expect(settleHref("org_flat", DEV, "https://evil.example")).toBe(`/money/settle?group=org_flat&to=${DEV}`);
    expect(safeSettleBack("/money?group=org_flat")).toBe("/money?group=org_flat");
    expect(safeSettleBack(`/people/${DEV}`)).toBe(`/people/${DEV}`);
    expect(safeSettleBack("/groups/flat-4b?tab=money")).toBe("/groups/flat-4b?tab=money");
    for (const bad of ["//evil.example", "/home", "https://x.y/money", "/money/../x\\y", "", null]) expect(safeSettleBack(bad)).toBeNull();
  });

  it("lists what you pay first, then what you get, leaving out groups you only view", () => {
    const rows = settleSheetRows(DATA);
    expect(rows.map((r) => [r.subjectId, r.orgId, r.minor])).toEqual([
      [DEV, "org_lunch", -2500],
      [ANU, "org_flat", 5400],
      [KIRAN, "org_flat", 3300],
    ]);
    expect(rows.map(settleLine)).toEqual(["You pay Dev", "Anu pays you", "Kiran pays you"]);
    expect(settleSheetRows(null)).toEqual([]);
  });

  it("goes straight to Settle up from a person you owe in one group", () => {
    const rows = settleSheetRows(DATA);
    expect(directPay(rows, DEV)?.orgId).toBe("org_lunch");
    expect(directPay(rows, ANU)).toBeNull();
    const two = [...rows, { ...rows[0]!, key: "x", orgId: "org_other" }];
    expect(directPay(two, DEV)).toBeNull();
  });

  it("reminds with what they owe you, by first name, whole where whole", () => {
    expect(remindFor("Anu Thomas", [{ minor: 5400, currency: "INR" }])).toBe("Hi Anu, a reminder from Cookpool: you owe me ₹54.");
  });
});

const PERSON: PersonViewResponse = {
  subjectId: DEV,
  displayName: "Dev Patel",
  totals: [{ currency: "INR", netMinor: -2500 }],
  groups: [
    {
      orgId: "org_lunch", slug: "lunch-club", name: "Lunch club", currency: "INR", role: "builder", pairwiseMinor: -2500, planMinor: -2500, shortcutMinor: 0, shortcutVia: null,
      lines: [
        { txnId: "txn_1", kind: "expense", title: "Thali lunch", occurredAt: "2026-11-11T12:00:00Z", signedMinor: -3000, reversed: false, reverses: null },
        { txnId: "txn_2", kind: "settlement", title: "Payment", occurredAt: "2026-11-08T12:00:00Z", signedMinor: -1000, reversed: false, reverses: null },
      ],
    },
    {
      orgId: "org_view", slug: "parents", name: "Parents", currency: "INR", role: "viewer", pairwiseMinor: 0, planMinor: 900, shortcutMinor: 0, shortcutVia: null,
      lines: [{ txnId: "txn_3", kind: "dish", title: "Dal tadka", occurredAt: "2026-11-12T08:00:00Z", signedMinor: 900, reversed: true, reverses: null }],
    },
  ],
};

describe("a person's balance and its why (RvMoneyGroup)", () => {
  const now = new Date("2026-11-13T12:00:00Z");

  it("lists the lines between you newest first, naming the group when you share several", () => {
    const rows = personWhyRows(PERSON, now);
    expect(rows.map((r) => [r.title, r.kind, r.minor, r.reversed])).toEqual([
      ["Dal tadka", "dish", 900, true],
      ["Thali lunch", "bill", -3000, false],
      ["Payment", "paid", -1000, false],
    ]);
    expect(rows[1]!.fact.startsWith("Bill · Lunch club · ")).toBe(true);
    expect(personWhyRows({ groups: [PERSON.groups[0]!] }, now)[0]!.fact.startsWith("Bill · ")).toBe(true);
    expect(personWhyRows({ groups: [PERSON.groups[0]!] }, now)[0]!.fact).not.toContain("Lunch club");
    expect(WHY_ROWS).toBe(3);
  });

  it("settles per group, leaving out a group you only view", () => {
    expect(personSettleRows(PERSON).map((r) => [r.orgId, r.minor, r.label])).toEqual([["org_lunch", -2500, "Dev Patel"]]);
  });

  it("a group's why carries each row's kind and when", () => {
    const rows = groupWhyRows(
      [{ id: "txn_9", title: "Paneer tikka", detail: "your portion", netMinor: -5400, currency: "INR", occurredAt: "2026-11-13T10:00:00Z" }],
      new Map([["txn_9", "dish"]]),
      now,
    );
    expect(rows[0]).toMatchObject({ kind: "dish", title: "Paneer tikka", minor: -5400 });
    expect(rows[0]!.fact.startsWith("your portion · ")).toBe(true);
  });
});

const txn = (over: Partial<KitchenTxn>): KitchenTxn =>
  ({
    id: "txn_a", orgId: "org_flat", kind: "expense", title: "Gas cylinder", totalMinor: 110000, currency: "INR", occurredAt: "2026-11-13T10:00:00Z",
    createdAt: "2026-11-13T10:00:00Z", createdBy: ME, method: null, reversed: false, splits: [], ...over,
  }) as KitchenTxn;

describe("a group's page (RvGroup)", () => {
  const names = new Map([[ANU, "Anu Thomas"], [DEV, "Dev"]]);

  it("Latest rows say who did what in one line", () => {
    expect(latestTitle(txn({ splits: [{ subjectId: ME, paidMinor: 110000, owedMinor: 27500 }] }), ME, names)).toBe("You paid Gas cylinder");
    expect(latestTitle(txn({ kind: "dish", title: "Dal", createdBy: ANU }), ME, names)).toBe("Anu cooked Dal");
    expect(latestTitle(txn({ kind: "use", title: "Oil", createdBy: DEV }), ME, names)).toBe("Dev used Oil");
    // Your oil, used by Dev: you are the one paid for it (RV-23).
    expect(latestTitle(txn({ kind: "use", title: "Oil", createdBy: DEV, splits: [{ subjectId: ME, paidMinor: 9200, owedMinor: 0 }, { subjectId: DEV, paidMinor: 0, owedMinor: 9200 }] }), ME, names)).toBe("Dev used your oil");
    expect(latestTitle(txn({ kind: "waste", title: "Spinach", createdBy: ANU }), ME, names)).toBe("Spinach went to waste");
  });

  it("their one fact is from your view (RV-23): + back, your share \"₹38 you\", waste red, a payment and the rest muted", () => {
    expect(latestFact(txn({ splits: [{ subjectId: ME, paidMinor: 110000, owedMinor: 27500 }] }), ME)).toEqual({ text: "+₹825", tone: "owed" });
    expect(latestFact(txn({ kind: "dish", splits: [{ subjectId: ME, paidMinor: 0, owedMinor: 3800 }] }), ME)).toEqual({ text: "₹38 you", tone: "owe" });
    expect(latestFact(txn({ kind: "waste", splits: [{ subjectId: ANU, paidMinor: 1600, owedMinor: 800 }, { subjectId: ME, paidMinor: 0, owedMinor: 800 }] }), ME)).toEqual({ text: "₹8 you", tone: "waste" });
    // Dev paying you: the money that moved, muted.
    expect(latestFact(txn({ kind: "settlement", totalMinor: 50000, splits: [{ subjectId: DEV, paidMinor: 50000, owedMinor: 0 }, { subjectId: ME, paidMinor: 0, owedMinor: 50000 }] }), ME)).toEqual({ text: "₹500", tone: "settled" });
    // A dish you weren't in: what a portion cost.
    expect(latestFact(txn({ kind: "dish", totalMinor: 9300, splits: [{ subjectId: ANU, paidMinor: 9300, owedMinor: 3100 }, { subjectId: DEV, paidMinor: 0, owedMinor: 6200 }] }), ME)).toEqual({ text: "₹31 a portion", tone: "settled" });
    expect(latestFact(txn({ totalMinor: 3100, splits: [{ subjectId: ANU, paidMinor: 3100, owedMinor: 3100 }] }), ME)).toEqual({ text: "₹31", tone: "settled" });
  });

  it("Money-tab balances are from your view, Square at zero", () => {
    expect(balanceFromYou(61000, "INR")).toEqual({ text: "+₹610", tone: "owed" });
    expect(balanceFromYou(-2400, "INR")).toEqual({ text: "−₹24", tone: "owe" });
    expect(balanceFromYou(0, "INR")).toEqual({ text: "Square", tone: "settled" });
  });

  it("colours a pantry fact only when expired", () => {
    expect([pantryFactTone({ tone: "expired" }), pantryFactTone({ tone: "soon" }), pantryFactTone(null)]).toEqual(["expired", "muted", "muted"]);
  });
});

describe("the screens' source", () => {
  const root = `${cwd()}/../../apps/web-console-next/src`;
  const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

  it.each([
    "components/kitchen/money-ui.tsx",
    "components/kitchen/money-group-ui.tsx",
    "components/kitchen/kitchen-money-ui.tsx",
    "components/kitchen/kitchen-settle-ui.tsx",
    "components/kitchen/profile-ui.tsx",
    "components/kitchen/group-detail-ui.tsx",
    "components/kitchen/activity-feed.tsx",
    "components/kitchen/new-group-dialog.tsx",
    "components/kitchen/join-group-dialog.tsx",
    "app/(kitchen)/join/[code]/page.tsx",
    "app/(kitchen)/groups/page.tsx",
    "app/(kitchen)/groups/[orgSlug]/settings/page.tsx",
    "app/(kitchen)/groups/[orgSlug]/expense/page.tsx",
  ])("%s uses tokens, no raw hex or rgba, weights of 400 and 500 only", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(src).not.toMatch(/rgba\(/);
    expect(src).not.toMatch(/font-(semibold|bold|extrabold|black)\b/);
  });

  it.each(["components/kitchen/money-ui.tsx", "components/kitchen/money-group-ui.tsx", "components/kitchen/profile-ui.tsx", "components/kitchen/group-detail-ui.tsx"])(
    "%s settles only through spliteco-worker's Settle up",
    (file) => {
      const src = read(file);
      expect(src).not.toMatch(/useRecordPayment|RecordPayment|createSettlement|PaymentMethodChips/);
      expect(src).not.toContain("groupSettleHref(");
    },
  );

  it("Money has one Settle up (on the net card), Add a bill with scan, and no kitchen chips", () => {
    const money = read("components/kitchen/money-ui.tsx");
    // One Settle up button (the net card's); the other "Settle up" is its sheet's title.
    expect(money.match(/>\s*Settle up\s*<\/Button>/g)?.length).toBe(1);
    expect(money).toContain(">Settle up</SheetTitle>");
    expect(money).toContain('aria-label="Scan a bill"');
    expect(money).toContain("startScan={bill.scan}");
    expect(read("components/kitchen/kitchen-money-ui.tsx")).not.toContain("KitchenChips");
    expect(read("components/kitchen/money-group-ui.tsx")).toContain("settleHref(row.orgId, row.subjectId, back)");
  });

  it("the settle screen goes back where it came from, with a quiet Back to Money", () => {
    const settle = read("components/kitchen/kitchen-settle-ui.tsx");
    expect(settle).toContain('safeSettleBack(params?.get("back"))');
    expect(settle).not.toContain('variant="outline"');
  });

  it("People leads to Money in the new frame, today's page in prod", () => {
    const people = read("app/(kitchen)/people/page.tsx");
    expect(people).toContain("newFrame() ? <PeopleToMoney /> : <TodayPeople />");
    expect(people).toContain('"/money?settle=1"');
    expect(people).toContain("moneyGroupHref(orgId)");
  });

  it("a group's Latest is one line with See all in the heading, and its Add sits on the bottom-bar variable", () => {
    const group = read("components/kitchen/group-detail-ui.tsx");
    expect(group).toContain('variant="line"');
    expect(group).toContain("expanded={latestAll}");
    expect(group).toContain("bottom-[var(--cp-bottom-bar,");
    expect(group).toContain("href={groupMoneyHref(group.id)}");
  });
});
