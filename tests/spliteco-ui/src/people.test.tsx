// money-native MY-5: People and a person's page.

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoPersonBalance, SplitecoPersonGroupBalance } from "@saas/contracts/spliteco";
import { personAction, personPage, personRow, searchPeople } from "@saas/spliteco-ui/people";
import { PeopleList, PersonPage } from "@saas/spliteco-ui/people-ui";
import { lookColours } from "@saas/spliteco-ui/look";

const THEMES = ["cookpool", "spliteco"] as const;

const grp = (groupId: string, groupName: string, amountMinor: number, o: Partial<SplitecoPersonGroupBalance> = {}): SplitecoPersonGroupBalance => ({
  groupId, groupName, kind: "trip", madeIn: "spliteco", currency: "INR", amountMinor, buckets: null, ...o,
});

function person(subjectId: string, name: string, groups: SplitecoPersonGroupBalance[]): SplitecoPersonBalance {
  const by = new Map<string, number>();
  for (const g of groups) by.set(g.currency, (by.get(g.currency) ?? 0) + g.amountMinor);
  const balances = [...by].filter(([, a]) => a !== 0).map(([currency, amountMinor]) => ({ currency, amountMinor }));
  return { subjectId, name, balances, settled: balances.length === 0, groups, plans: [], upiVpa: null, lastRemindedAt: null };
}

const kitchen = (amountMinor: number) => grp("org_k", "Flat 4B", amountMinor, { kind: "kitchen", madeIn: "cookpool" });

const dev = person("usr_dev", "Dev", [grp("org_goa", "Goa trip", -120000), kitchen(-30000)]); // read order is not Kitchen first
const kiran = person("usr_kiran", "Kiran", [kitchen(52000)]);
const meera = person("usr_meera", "Meera", [kitchen(0)]);
const everyone = [dev, kiran, meera];

const noop = () => undefined;
const list = (theme: (typeof THEMES)[number], people: SplitecoPersonBalance[], query = "") =>
  renderToStaticMarkup(<PeopleList theme={theme} people={people} query={query} onQuery={noop} onOpenPerson={noop} onPay={noop} onGotIt={noop} />);
const page = (theme: (typeof THEMES)[number], p: SplitecoPersonBalance) => renderToStaticMarkup(<PersonPage theme={theme} person={p} onBack={noop} />);

describe("People rows", () => {
  it("Pay when you owe, Got it when they owe, nothing when settled", () => {
    expect(personAction(dev)).toBe("pay");
    expect(personAction(kiran)).toBe("got");
    expect(personAction(meera)).toBe("settled");
  });

  it("lists each person once, with the net and the groups behind it, Kitchen first", () => {
    const row = personRow(dev);
    expect(row.groupsText).toBe("Flat 4B · Goa trip");
    expect(row.amounts.map((a) => a.text)).toEqual(["−₹1,500"]);
  });

  it("a settled person reads Settled with no button, and names what they share", () => {
    const html = list("cookpool", [meera]);
    expect(html).toContain("Settled");
    expect(html).not.toContain(">Pay<");
    expect(html).not.toContain(">Got it<");
    expect(personRow(meera).groupsText).toBe("Flat 4B");
  });

  it.each(THEMES)("renders Pay and Got it in %s from tokens only", (theme) => {
    const html = list(theme, everyone);
    expect(html).toContain(`data-look="${theme}"`);
    expect(html).toContain(">Pay<");
    expect(html).toContain(">Got it<");
    expect(html).toContain("var(--look-owe)");
    expect(html).toContain("var(--look-get)");
    expect(html).not.toMatch(/#[0-9A-Fa-f]{6}(?![0-9A-Fa-f])(?=[^"]*"[^<]*<\/)/); // no hex outside the variable block
    const c = lookColours(theme);
    const body = html.replace(/<div data-look[^>]*>/, "");
    expect(body).not.toContain(c.owe);
    expect(body).not.toContain(c.get);
    expect(body).not.toContain(c.primary);
  });

  it("leaves the floating button's slot, empty", () => {
    expect(list("cookpool", everyone)).toContain('data-slot="floating-button"');
    const withButton = renderToStaticMarkup(
      <PeopleList theme="cookpool" people={everyone} query="" onQuery={noop} onOpenPerson={noop} onPay={noop} onGotIt={noop} floatingButton={<b>Settle up</b>} />,
    );
    expect(withButton).toContain("<b>Settle up</b>");
  });

  it("an empty People says so", () => {
    expect(list("cookpool", [])).toContain('data-empty="people"');
  });
});

describe("search", () => {
  it("narrows by name, case-insensitively, keeping the read's order", () => {
    expect(searchPeople(everyone, "  KI ").map((p) => p.name)).toEqual(["Kiran"]);
    expect(searchPeople(everyone, "").map((p) => p.name)).toEqual(["Dev", "Kiran", "Meera"]);
    expect(searchPeople(everyone, "e").map((p) => p.name)).toEqual(["Dev", "Meera"]);
  });

  it("shows the narrowed list, or says no one matched", () => {
    const html = list("cookpool", everyone, "kir");
    expect(html).toContain("Kiran");
    expect(html).not.toContain("Meera");
    expect(list("cookpool", everyone, "zzz")).toContain('data-empty="search"');
  });
});

describe("multi-currency", () => {
  const abroad = person("usr_zoya", "Zoya", [grp("org_a", "Flat", 30000), grp("org_b", "Lisbon", -4000, { currency: "EUR" })]);

  it("keeps each currency apart, never summed", () => {
    expect(personRow(abroad).amounts.map((a) => [a.currency, a.text])).toEqual([["INR", "+₹300"], ["EUR", "−€40"]]);
    const html = list("cookpool", [abroad]);
    expect(html).toContain("+₹300");
    expect(html).toContain("−€40");
  });

  it("offers Pay when you owe in any currency", () => {
    expect(personAction(abroad)).toBe("pay");
  });

  it("the person's page has a net per currency and a row per group", () => {
    const v = personPage(abroad);
    expect(v.nets.map((n) => [n.currency, n.text, n.words])).toEqual([["INR", "+₹300", "Zoya owes you"], ["EUR", "−€40", "you owe Zoya"]]);
    expect(v.groups.map((g) => [g.label, g.text, g.currency])).toEqual([["Flat", "₹300", "INR"], ["Lisbon", "€40", "EUR"]]);
  });
});

describe("a person's page", () => {
  it("shows the net and a row per group, the Kitchen first", () => {
    const v = personPage(dev);
    expect(v.nets.map((n) => [n.text, n.words])).toEqual([["−₹1,500", "you owe Dev"]]);
    expect(v.groups.map((g) => [g.label, g.text])).toEqual([["Kitchen · Flat 4B", "₹300"], ["Goa trip", "₹1,200"]]);
    const html = page("cookpool", dev);
    expect(html.indexOf("Kitchen · Flat 4B")).toBeLessThan(html.indexOf("Goa trip"));
  });

  it("has no Latest list and no caption beyond the board's", () => {
    const html = page("cookpool", dev);
    expect(html).not.toMatch(/latest|recent|activity/i);
    expect(html).toContain("By group · Kitchen first");
  });

  it("a settled person reads Settled, with the shared group at Settled", () => {
    const v = personPage(meera);
    expect(v.settled).toBe(true);
    expect(v.groups.map((g) => g.text)).toEqual(["Settled"]);
    const html = page("cookpool", meera);
    expect(html).toContain("Settled");
    expect(html).not.toContain("owes you");
  });

  it("a person who owes you reads as owed", () => {
    expect(personPage(kiran).nets[0]).toMatchObject({ text: "+₹520", words: "Kiran owes you", tone: "get" });
  });

  it.each(THEMES)("renders in %s with the settle slot and Back", (theme) => {
    const html = page(theme, dev);
    expect(html).toContain(`data-look="${theme}"`);
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('data-slot="floating-button"');
    expect(html).toContain("var(--look-owe)");
  });
});
