// money-inside MN-2: Spliteco inside — the Money tab Cookpool and Tripeco share.

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { latestRows, moneyTabGroups, moneyTotals, peopleText, shortWhen, signedShort, splitecoPath, withYou } from "@saas/spliteco-ui/money-tab";
import { SplitecoMoneyTab } from "@saas/spliteco-ui/money-tab-ui";

const ME = "usr_me";

describe("the Money tab's numbers", () => {
  it("signs whole amounts", () => {
    expect(signedShort(124000, "INR")).toBe("+₹1,240");
    expect(signedShort(-38000, "INR")).toBe("−₹380");
    expect(signedShort(0, "INR")).toBe("₹0");
  });

  it("totals your groups per currency, biggest first, and says which way", () => {
    expect(moneyTotals([{ currency: "INR", myBalanceMinor: 84000 }, { currency: "INR", myBalanceMinor: -120000 }, { currency: "USD", myBalanceMinor: 500 }])).toEqual([
      { currency: "INR", minor: -36000, words: "you owe" },
      { currency: "USD", minor: 500, words: "you get back" },
    ]);
    expect(moneyTotals([])).toEqual([{ currency: "INR", minor: 0, words: "all settled" }]);
  });

  it("lists unsettled groups first, biggest first, then the settled by name", () => {
    const g = (name: string, myBalanceMinor: number) => ({ name, myBalanceMinor });
    expect(moneyTabGroups([g("Mom", 0), g("Flat", 84000), g("Goa", -120000), g("Art", 0)]).map((x) => x.name)).toEqual(["Goa", "Flat", "Art", "Mom"]);
  });

  it("counts people", () => {
    expect(peopleText(1)).toBe("1 person");
    expect(peopleText(4)).toBe("4 people");
  });
});

describe("inside a group", () => {
  const group = {
    members: [
      { subjectId: ME, name: "You", role: "owner" },
      { subjectId: "usr_a", name: "Asha", role: "builder" },
      { subjectId: "usr_k", name: "Kiran", role: "builder" },
      { subjectId: "usr_d", name: "Dev", role: "builder" },
    ],
    plan: [
      { fromSubjectId: "usr_a", toSubjectId: ME, amountMinor: 32000 },
      { fromSubjectId: ME, toSubjectId: "usr_k", amountMinor: 52000 },
      { fromSubjectId: "usr_d", toSubjectId: "usr_k", amountMinor: 1000 },
    ],
  };

  it("shows only the payments that involve you, the biggest first", () => {
    expect(withYou(group, ME)).toEqual([
      { subjectId: "usr_k", name: "Kiran", minor: -52000 },
      { subjectId: "usr_a", name: "Asha", minor: 32000 },
    ]);
    expect(withYou(group, null)).toEqual([]);
  });

  it("reads the three latest rows with who and when", () => {
    const now = new Date("2026-11-13T10:00:00.000Z");
    const e = (title: string, at: string, actorId: string) => ({ txnId: `txn_${title}`, at, actorId, title, myEffectMinor: 8600, currency: "INR" });
    const rows = latestRows([e("Milk", "2026-11-13T08:00:00.000Z", ME), e("Rent", "2026-11-12T08:00:00.000Z", "usr_a"), e("Wi-Fi", "2026-11-01T08:00:00.000Z", "usr_a"), e("Old", "2026-10-01T08:00:00.000Z", ME)] as never, [{ subjectId: "usr_a", name: "Asha" }], ME, now);
    expect(rows.map((r) => `${r.title} · ${r.sub}`)).toEqual(["Milk · You · Today", "Rent · Asha · Yesterday", `Wi-Fi · Asha · ${shortWhen("2026-11-01T08:00:00.000Z", now)}`]);
  });
});

describe("where Spliteco takes over", () => {
  it("opens Settle up, + Expense and the group at Spliteco's own paths", () => {
    expect(splitecoPath({ kind: "settle", groupId: null })).toBe("/settle");
    expect(splitecoPath({ kind: "settle", groupId: "org_1" })).toBe("/settle?group=org_1");
    expect(splitecoPath({ kind: "expense", groupId: "org_1" })).toBe("/add?group=org_1");
    expect(splitecoPath({ kind: "group", groupId: "org_1" })).toBe("/group?id=org_1");
    expect(splitecoPath({ kind: "group", groupId: null })).toBe("/groups");
  });
});

describe("the tab", () => {
  it("draws the way back and the Spliteco mark, whatever the host", () => {
    const api = { groups: () => new Promise<never>(() => undefined), group: () => new Promise<never>(() => undefined), groupActivity: () => new Promise<never>(() => undefined), remind: async () => undefined };
    const html = renderToStaticMarkup(<SplitecoMoneyTab api={api} hostName="Tripeco" onBack={() => undefined} meId={ME} onOpen={() => undefined} />);
    expect(html).toContain("Tripeco");
    expect(html).toContain("Spliteco");
    expect(html).toContain("data-spliteco-inside");
  });
});
