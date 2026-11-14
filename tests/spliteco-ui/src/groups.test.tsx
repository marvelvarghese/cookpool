// money-native MY-4: the Money shell and the Groups page.

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { GroupsPage, MoneyHeader } from "@saas/spliteco-ui/groups-ui";
import { PeopleList } from "@saas/spliteco-ui/people-ui";
import { lookColours } from "@saas/spliteco-ui/look";

const THEMES = ["cookpool", "spliteco"] as const;
const noop = () => undefined;

const group = (id: string, name: string, myBalanceMinor: number, o: Partial<SplitecoGroupSummary> = {}): SplitecoGroupSummary =>
  ({ id, name, kind: "trip", madeIn: "spliteco", role: "owner", currency: "INR", memberCount: 3, myBalanceMinor, ...o }) as SplitecoGroupSummary;

const groups = [group("org_a", "Flat 4B", 52000), group("org_b", "Goa trip", -120000), group("org_c", "Office", 0)];
const page = (theme: (typeof THEMES)[number], gs: SplitecoGroupSummary[] = groups, floatingButton?: React.ReactNode) =>
  renderToStaticMarkup(<GroupsPage theme={theme} groups={gs} onSide={noop} onOpenGroup={noop} onAddGroup={noop} floatingButton={floatingButton} />);

describe("Money shell", () => {
  it.each(THEMES)("%s: one 11px Powered by Spliteco line, no other mark", (theme) => {
    const html = page(theme);
    expect(html.match(/Powered by Spliteco/g)).toHaveLength(1);
    expect(html).toContain("font-size:11px");
    expect(html.match(/Spliteco/g)).toHaveLength(1);
    expect(html).toContain(`--look-primary:${lookColours(theme).primary}`);
  });

  it("the old Overall label and group sub-lines are gone", () => {
    const html = page("cookpool");
    expect(html).not.toContain("Overall");
    expect(html).not.toMatch(/\d+ people|1 person/);
  });

  it("the open side is a tinted block with icon and label; the other folds to an icon", () => {
    const html = renderToStaticMarkup(<MoneyHeader side="groups" onSide={noop} />);
    const open = html.match(/<button[^>]*data-side="groups"[^>]*>.*?<\/button>/)![0];
    const folded = html.match(/<button[^>]*data-side="people"[^>]*>.*?<\/button>/)![0];
    expect(open).toContain('data-open="true"');
    expect(open).toContain("<svg");
    expect(open).toContain("<span>Groups</span>");
    expect(open).toContain("var(--look-soft)");
    expect(folded).toContain('data-open="false"');
    expect(folded).toContain("<svg");
    expect(folded).not.toContain("<span>People</span>");
    expect(folded).toContain('aria-label="People"');
  });

  it("the switch flips: People open, Groups folded", () => {
    const html = renderToStaticMarkup(<MoneyHeader side="people" onSide={noop} />);
    expect(html.match(/<button[^>]*data-side="people"[^>]*>.*?<\/button>/)![0]).toContain("<span>People</span>");
    expect(html.match(/<button[^>]*data-side="groups"[^>]*>.*?<\/button>/)![0]).not.toContain("<span>Groups</span>");
  });

  it("clicking a side calls onSide", () => {
    const seen: string[] = [];
    const el = MoneyHeader({ side: "groups", onSide: (s) => seen.push(s) }) as React.ReactElement<{ children: React.ReactElement[] }>;
    const sw = (el.props.children as React.ReactElement<{ onSide: (s: string) => void }>[])[1]!;
    sw.props.onSide("people");
    expect(seen).toEqual(["people"]);
  });

  it("+ Group shows only on Groups", () => {
    expect(renderToStaticMarkup(<MoneyHeader side="groups" onSide={noop} onAddGroup={noop} />)).toContain("add-group-top");
    expect(renderToStaticMarkup(<MoneyHeader side="people" onSide={noop} onAddGroup={noop} />)).not.toContain("add-group-top");
    const people = renderToStaticMarkup(
      <PeopleList theme="cookpool" header={<MoneyHeader side="people" onSide={noop} onAddGroup={noop} />} people={[]} query="" onQuery={noop} onOpenPerson={noop} onPay={noop} onGotIt={noop} />,
    );
    expect(people).toContain("Powered by Spliteco");
    expect(people).not.toContain("add-group-top");
    expect(people).not.toContain("Add group");
  });
});

describe("Groups", () => {
  it.each(THEMES)("%s: the net, a row per group, + Group on top and Add group last", (theme) => {
    const html = page(theme);
    expect(html).toContain("you owe"); // 520 - 1200 = net owe 680
    expect(html).toContain("₹680");
    expect(html.indexOf("add-group-top")).toBeLessThan(html.indexOf('data-group="org_a"'));
    expect(html.lastIndexOf("Add group")).toBeGreaterThan(html.indexOf('data-group="org_c"'));
    expect(html.match(/data-group="/g)).toHaveLength(3);
  });

  it("each group shows its name and one balance; unsettled first", () => {
    const html = page("cookpool");
    expect(html).toContain("+₹520");
    expect(html).toContain("−₹1,200");
    expect(html.indexOf("Goa trip")).toBeLessThan(html.indexOf("Flat 4B"));
    expect(html.indexOf("Flat 4B")).toBeLessThan(html.indexOf("Office"));
  });

  it("an even group reads Settled", () => {
    const html = page("cookpool", [group("org_c", "Office", 0)]);
    expect(html.match(/data-balance="" style="[^"]*">Settled/g)).toHaveLength(1);
    expect(html).toContain("all settled");
  });

  it("no groups: only the Add group row", () => {
    const html = page("spliteco", []);
    expect(html).not.toContain("data-group=");
    expect(html).not.toContain('data-net');
    expect(html).toContain("Add group");
    expect(html).toContain("add-group-top");
  });

  it("currencies are never summed", () => {
    const html = page("cookpool", [group("a", "Home", 10000), group("b", "Trip", -5000, { currency: "USD" })]);
    expect(html).toContain('data-currency="INR"');
    expect(html).toContain('data-currency="USD"');
  });

  it("colours are tokens only", () => {
    expect(page("cookpool").replace(/<style[\s\S]*?<\/style>/g, "").replace(/--look-[a-zA-Z]+:#[0-9A-Fa-f]+;?/g, "")).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  it("has a named slot for the floating Expense button", () => {
    const html = page("cookpool", groups, <button data-test="fab">Expense</button>);
    expect(html).toContain('data-slot="floating-button"');
    expect(html).toContain("Expense");
    expect(page("cookpool")).toContain('data-slot="floating-button"');
  });
});
