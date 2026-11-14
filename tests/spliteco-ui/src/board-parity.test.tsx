// money-native MY-18: the Money pages hold the approved boards' measurements.
// The numbers below are the boards' inline styles (Settle_Money, Money_Ocean,
// Money_People, Person_Dev), written out here on purpose: changing a page or
// BOARD alone fails this file. Browser-measured against the boards at 390x844
// in both looks when MY-18 landed; this pins them so they cannot drift.

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoGroupSummary, SplitecoPersonBalance } from "@saas/contracts/spliteco";
import { BOARD, BOARD_FONT, FOCUS_CSS } from "@saas/spliteco-ui/board";
import { GroupsPage, MoneyHeader } from "@saas/spliteco-ui/groups-ui";
import { PeopleList, PersonPage } from "@saas/spliteco-ui/people-ui";
import { COOKPOOL_LOOK, SPLITECO_LOOK, lookColours } from "@saas/spliteco-ui/look";

const noop = () => undefined;
const THEMES = ["cookpool", "spliteco"] as const;

const group = (id: string, name: string, myBalanceMinor: number): SplitecoGroupSummary =>
  ({ id, name, kind: "trip", madeIn: "spliteco", role: "owner", currency: "INR", memberCount: 3, myBalanceMinor }) as SplitecoGroupSummary;
const groups = [group("a", "Flat 4B", 84000), group("b", "Goa trip", -10000), group("c", "Mom & Dad", 0)];

const dev = {
  subjectId: "d", name: "Dev", balances: [{ currency: "INR", amountMinor: -150000 }], settled: false, plans: [], upiVpa: null, lastRemindedAt: null,
  groups: [
    { groupId: "g", groupName: "Goa trip", kind: "trip", madeIn: "spliteco", currency: "INR", amountMinor: -120000, buckets: null },
    { groupId: "k", groupName: "Flat 4B", kind: "kitchen", madeIn: "cookpool", currency: "INR", amountMinor: -30000, buckets: null },
  ],
} as unknown as SplitecoPersonBalance;

const groupsHtml = renderToStaticMarkup(<GroupsPage theme="cookpool" groups={groups} onSide={noop} onOpenGroup={noop} onAddGroup={noop} />);
const peopleHtml = renderToStaticMarkup(
  <PeopleList theme="cookpool" header={<MoneyHeader side="people" onSide={noop} />} people={[dev]} query="" onQuery={noop} onOpenPerson={noop} onPay={noop} onGotIt={noop} />,
);
const personHtml = renderToStaticMarkup(<PersonPage theme="cookpool" person={dev} onBack={noop} />);
const tag = (html: string, attr: string) => html.match(new RegExp(`<[a-z0-9]+ [^>]*${attr}[^>]*>`))![0];

describe("the boards' numbers", () => {
  it("BOARD is exactly what the boards draw", () => {
    expect(BOARD.page).toEqual({ padX: 20, padTop: 20, gapGroups: 20, gapPeople: 16, gapPerson: 18 });
    expect(BOARD.header).toMatchObject({ height: 56, titleSize: 24, poweredSize: 11, poweredGap: 1 });
    expect(BOARD.bell).toMatchObject({ size: 44, icon: 20 });
    expect(BOARD.addGroup).toMatchObject({ height: 44, padLeft: 12, padRight: 16, marginRight: 8, radius: 10, gap: 6 });
    expect(BOARD.switch).toMatchObject({ height: 52, pad: 4, gap: 4, radius: 14, tabRadius: 10, foldedWidth: 52, icon: 20, size: 15 });
    expect(BOARD.net).toMatchObject({ gap: 6, amountSize: 34, wordsSize: 14 });
    expect(BOARD.card).toEqual({ radius: 22, personGroupRadius: 20 });
    expect(BOARD.groupRow).toMatchObject({ height: 66, avatar: 36, avatarSize: 13, nameSize: 15, settledSize: 14 });
    expect(BOARD.addRow).toMatchObject({ height: 60, avatar: 36 });
    expect(BOARD.search).toMatchObject({ height: 48, radius: 16, size: 16 });
    expect(BOARD.personRow).toMatchObject({ height: 72, avatar: 40, button: 44, buttonRadius: 10 });
    expect(BOARD.personGroupRow.height).toBe(52);
    expect(BOARD.tabBar).toMatchObject({ height: 68, inset: 12, bottom: 14, radius: 26, item: 52, label: 11, icon: 22 });
    expect(BOARD_FONT).toContain("Plus Jakarta Sans");
  });

  it("every tap target is at least 44px", () => {
    expect(BOARD.bell.size).toBeGreaterThanOrEqual(BOARD.minTap);
    expect(BOARD.addGroup.height).toBeGreaterThanOrEqual(BOARD.minTap);
    expect(BOARD.switch.height - 2 * BOARD.switch.pad).toBeGreaterThanOrEqual(BOARD.minTap);
    expect(BOARD.switch.foldedWidth).toBeGreaterThanOrEqual(BOARD.minTap);
    expect(BOARD.personRow.button).toBeGreaterThanOrEqual(BOARD.minTap);
    expect(BOARD.groupRow.height).toBeGreaterThanOrEqual(BOARD.minTap);
  });
});

describe("Groups holds Settle_Money", () => {
  it("page: padding 20 20, gap 20, tabular numbers, line-height normal, Plus Jakarta Sans", () => {
    expect(tag(groupsHtml, 'data-page="groups"')).toMatch(/padding:20px 20px 120px;display:flex;flex-direction:column;gap:20px/);
    const root = groupsHtml.match(/^<div data-look="cookpool" style="([^"]*)"/)![1]!;
    expect(root).toContain("font-variant-numeric:tabular-nums");
    expect(root).toContain("line-height:normal");
    expect(root).toContain("Plus Jakarta Sans");
  });

  it("header: 56 high, 24px title, one 11px Powered by Spliteco line 1px under it", () => {
    expect(tag(groupsHtml, "data-header")).toMatch(/align-items:center;height:56px/);
    expect(groupsHtml).toMatch(/<h1 style="[^"]*font-size:24px;font-weight:500;letter-spacing:-0\.02em[^"]*">Money<\/h1>/);
    expect(tag(groupsHtml, "data-powered-by")).toContain("font-size:11px");
    expect(groupsHtml.match(/Powered by Spliteco/g)).toHaveLength(1);
  });

  it("+ Group: 44 high, 10 radius, padding 0 16 0 12, 8 from the bell, an 18px plus and the word Group", () => {
    const btn = groupsHtml.match(/<button[^>]*data-action="add-group-top"[^>]*>.*?<\/button>/)![0];
    expect(btn).toContain("height:44px");
    expect(btn).toContain("padding:0 16px 0 12px");
    expect(btn).toContain("margin-right:8px");
    expect(btn).toContain("border-radius:10px");
    expect(btn).toContain("gap:6px");
    expect(btn).toContain('width="18"');
    expect(btn).toContain('stroke-width="2.4"');
    expect(btn).toMatch(/Group<\/button>$/);
    expect(btn).not.toContain("+ Group");
  });

  it("bell: a 44px surface circle with a 20px icon", () => {
    const btn = groupsHtml.match(/<button[^>]*data-action="reminders"[^>]*>.*?<\/button>/)![0];
    expect(btn).toMatch(/width:44px;height:44px;border-radius:50%/);
    expect(btn).toContain("background:var(--look-surface)");
    expect(btn).toContain('width="20"');
  });

  it("switch: 52 high, padding 4, gap 4, radius 14; open tab radius 10 with a 20px icon; folded tab 52 wide", () => {
    expect(tag(groupsHtml, "data-switch")).toMatch(/gap:4px;height:52px;padding:4px;border-radius:14px;background:var\(--look-surface\);box-sizing:border-box/);
    const open = groupsHtml.match(/<button[^>]*data-side="groups"[^>]*>.*?<\/button>/)![0];
    const folded = groupsHtml.match(/<button[^>]*data-side="people"[^>]*>.*?<\/button>/)![0];
    expect(open).toContain("border-radius:10px");
    expect(open).toContain("font-size:15px;font-weight:500");
    expect(open).toContain("gap:8px");
    expect(open).toContain('width="20"');
    expect(folded).toContain("width:52px");
    expect(folded).toContain('width="20"');
  });

  it("net: 34px/500 signed, 6px above its words, 4px side padding", () => {
    expect(tag(groupsHtml, "data-net")).toContain("padding:4px 4px 0");
    expect(tag(groupsHtml, "data-amount")).toMatch(/font-size:34px;font-weight:500;letter-spacing:-0\.02em;color:var\(--look-money\)/);
    expect(groupsHtml).toContain("+₹740"); // 840 - 100, shown signed
  });

  it("card: radius 22; rows 66 high, a 36px initial circle, name 15/500, amount 15/500, Settled 14 muted; Add group 60 high", () => {
    expect(tag(groupsHtml, "data-groups")).toContain("border-radius:22px");
    const row = groupsHtml.match(/<button[^>]*data-group="a"[^>]*>.*?<\/button>/)![0];
    expect(row).toContain("height:66px");
    expect(row).toContain("gap:12px");
    expect(row).toMatch(/width:36px;height:36px;border-radius:50%;background:var\(--look-soft\)[^"]*font-size:13px/);
    expect(row).toContain(">F</span>");
    const settled = groupsHtml.match(/<span data-balance="" style="([^"]*)">Settled/)![1]!;
    expect(settled).toContain("font-size:14px");
    expect(settled).not.toContain("font-weight");
    expect(groupsHtml.match(/<button[^>]*data-action="add-group-row"[^>]*>/)![0]).toMatch(/height:60px;[^"]*color:var\(--look-primary\)/);
  });
});

describe("People holds Money_People", () => {
  it("page: gap 16; no + Group; bell only", () => {
    expect(tag(peopleHtml, 'data-page="people"')).toContain("gap:16px");
    expect(peopleHtml).not.toContain("add-group-top");
    expect(peopleHtml).toContain('data-action="reminders"');
  });

  it("search: 48 high, radius 16, 10 gap, 14 padding, 16px input", () => {
    const label = peopleHtml.match(/<label style="([^"]*)"/)![1]!;
    expect(label).toContain("height:48px;border-radius:16px");
    expect(label).toContain("gap:10px");
    expect(label).toContain("padding:0 14px");
    expect(peopleHtml.match(/<input[^>]*style="([^"]*)"/)![1]).toContain("font-size:16px");
  });

  it("row: 72 high, padding 0 12 0 16, 40px avatar, 13px muted groups line, 44px Pay button radius 10, card radius 22", () => {
    const row = peopleHtml.match(/<div data-person="d" style="([^"]*)"/)![1]!;
    expect(row).toContain("height:72px");
    expect(row).toContain("padding:0 12px 0 16px");
    expect(peopleHtml).toMatch(/width:40px;height:40px;border-radius:50%/);
    expect(peopleHtml).toMatch(/font-size:13px;color:var\(--look-muted\)">Flat 4B · Goa trip/);
    expect(peopleHtml).toMatch(/<button[^>]*style="height:44px;padding:0 18px;border-radius:10px[^"]*">Pay<\/button>/);
    expect(peopleHtml).toContain("border-radius:22px");
  });
});

describe("Person holds Person_Dev", () => {
  it("page gap 18; header 56 with a 44px Back 10px out; title 24px", () => {
    expect(tag(personHtml, 'data-page="person"')).toContain("gap:18px");
    expect(personHtml).toMatch(/aria-label="Back"[^>]*style="width:44px;height:44px;margin-left:-10px/);
    expect(personHtml).toMatch(/height:56px/);
    expect(personHtml).toMatch(/<h1 style="[^"]*font-size:24px/);
  });

  it("net: signed 34px headline in owe, 4px above its words; groups card radius 20, rows 52", () => {
    expect(personHtml).toMatch(/font-size:34px;font-weight:500;letter-spacing:-0\.02em;color:var\(--look-owe\)">−₹1,500</);
    expect(personHtml).toContain("you owe Dev");
    expect(tag(personHtml, "data-groups")).toContain("border-radius:20px");
    expect(personHtml.match(/height:52px/g)).toHaveLength(2);
    expect(personHtml.indexOf("Kitchen · Flat 4B")).toBeLessThan(personHtml.indexOf("Goa trip"));
  });
});

describe("tokens, focus and dark", () => {
  it.each(THEMES)("%s: the page carries the Theme_Tokens board's values", (theme) => {
    const html = renderToStaticMarkup(<GroupsPage theme={theme} groups={groups} onSide={noop} onOpenGroup={noop} onAddGroup={noop} />);
    for (const [token, value] of Object.entries(lookColours(theme))) expect(html).toContain(`--look-${token}:${value}`);
  });

  it("Theme_Tokens values, token by token", () => {
    expect(COOKPOOL_LOOK).toEqual({ bg: "#F6F5F0", surface: "#FFFFFF", ink: "#1B2420", muted: "#5E6862", line: "#EFEDE6", primary: "#1F7A4D", onPrimary: "#FFFFFF", soft: "#E3EFE7", softInk: "#1A6A43", get: "#1A6A43", owe: "#A3360A", money: "#1A6A43", navInk: "#1F7A4D", grab: "#D8D5CA" });
    expect(SPLITECO_LOOK).toEqual({ bg: "#0B1426", surface: "#13203A", ink: "#E8EEF8", muted: "#94A3B8", line: "#1E2C4A", primary: "#2563EB", onPrimary: "#FFFFFF", soft: "#1A2B4D", softInk: "#BFD3FF", get: "#2DD4BF", owe: "#FB7185", money: "#F5B53D", navInk: "#F5B53D", grab: "#33466B" });
  });

  it("a keyboard focus ring comes with the page and draws only on focus-visible", () => {
    expect(groupsHtml).toContain("data-focus-ring");
    expect(FOCUS_CSS).toContain(":focus-visible{outline:2px solid var(--look-primary)");
    expect(FOCUS_CSS).not.toMatch(/(^|\})[^{]*(?<!:focus-visible)\{outline/);
  });
});
