import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { handoffUrlTo } from "@web-console-next/components/kitchen/spliteco-link";

// money-inside MN-3: Cookpool's Money tab was Spliteco inside. money-native
// MY-8 mounts the native pages instead (kitchen-money-native.test.ts); what is
// left here is the old tab's code, which stays until MY-13, and the hand-off.

const src = (f: string) => readFileSync(`${cwd()}/../../apps/web-console-next/src/${f}`, "utf8");

describe("Cookpool's Money tab", () => {
  it("is no longer what /money mounts, but the old tab's code is still here for MY-13", () => {
    expect(src("app/(kitchen)/money/page.tsx")).not.toContain("MoneyInside");
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

  it("no longer turns the tab bar Spliteco's navy on Money", () => {
    const bar = src("components/kitchen/tab-bar.tsx");
    expect(bar).not.toContain("SPLITECO_INSIDE");
    expect(bar).not.toContain('startsWith("/money")');
  });
});
