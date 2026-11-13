import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { TAB_PATHS, tabIndexOf } from "@/lib/home";

// money-inside MN-4: Tripeco's fourth tab is Money, Spliteco inside.

const src = (f: string) => readFileSync(`${cwd()}/../../apps/tripeco-web/src/${f}`, "utf8");

describe("Tripeco's Money tab", () => {
  it("is the fourth tab, at /money", () => {
    expect(TAB_PATHS).toEqual(["/", "/vehicles", "/groups", "/money"]);
    expect(tabIndexOf("/money")).toBe(3);
  });

  it("shows Spliteco's own Money screens, with the way back to Tripeco", () => {
    const tab = src("components/tabs/money-tab.tsx");
    expect(tab).toContain("<SplitecoMoneyTab");
    expect(tab).toContain('hostName="Tripeco"');
  });

  it("turns the tab bar Spliteco's navy while Money is open", () => {
    expect(src("components/ui.tsx")).toContain('active === MONEY_TAB ? "tabbar tabbar-spliteco"');
    expect(src("app/globals.css")).toMatch(/\.tabbar-spliteco \{ background: #13203A/);
  });
});
