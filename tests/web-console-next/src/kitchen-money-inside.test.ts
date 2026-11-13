import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { handoffUrlTo } from "@web-console-next/components/kitchen/spliteco-link";

// money-inside MN-3: Cookpool's Money tab is Spliteco inside.

const src = (f: string) => readFileSync(`${cwd()}/../../apps/web-console-next/src/${f}`, "utf8");

describe("Cookpool's Money tab", () => {
  it("is Spliteco's own Money screens, with the way back to Cookpool", () => {
    expect(src("app/(kitchen)/money/page.tsx")).toContain("<MoneyInside />");
    const inside = src("components/kitchen/money-inside-ui.tsx");
    expect(inside).toContain("<SplitecoMoneyTab");
    expect(inside).toContain('hostName="Cookpool"');
  });

  it("opens Spliteco signed in, at the path the tab asked for, with the way back", () => {
    const url = new URL(handoffUrlTo("https://s.example", "code1", "/settle?group=org_1", "https://c.example/money"));
    expect(url.pathname).toBe("/handoff");
    expect(url.searchParams.get("next")).toBe("/settle?group=org_1");
    expect(url.searchParams.get("back")).toBe("https://c.example/money");
  });

  it("turns the tab bar Spliteco's navy on Money", () => {
    const bar = src("components/kitchen/tab-bar.tsx");
    expect(bar).toContain('pathname?.startsWith("/money")');
    expect(bar).toContain("SPLITECO_INSIDE");
  });
});
