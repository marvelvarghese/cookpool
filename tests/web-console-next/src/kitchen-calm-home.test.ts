import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { homeQuickActions } from "@web-console-next/components/kitchen/home-actions";
import { RECEIPT_SCAN_HREF } from "@web-console-next/components/kitchen/receipt-run";
import { boughtHref, quickUseFieldHref } from "@web-console-next/components/kitchen/pantry-list";

// cookpool-home HM-2: the calm Home (the canvas's Main, AllClear and Cooking boards).

const kitchen = (f: string) => readFileSync(`${cwd()}/../../apps/web-console-next/src/components/kitchen/${f}`, "utf8");

describe("the quick actions", () => {
  it("are Scan bill, Log use, Cook and Groceries, each where its own flow starts", () => {
    expect(homeQuickActions(true)).toEqual([
      { key: "scan", label: "Scan bill", href: RECEIPT_SCAN_HREF },
      { key: "use", label: "Log use", href: quickUseFieldHref(true) },
      { key: "cook", label: "Cook", href: "/cook" },
      { key: "groceries", label: "Groceries", href: boughtHref() },
    ]);
  });

  it("drop Scan bill while receipt scan does not show, never offering a refusal", () => {
    expect(homeQuickActions(false).map((a) => a.label)).toEqual(["Log use", "Cook", "Groceries"]);
  });
});

describe("the calm Home's page", () => {
  const home = kitchen("new-home-ui.tsx");

  it("has no date line and no summary under Hi, and no groups feed", () => {
    expect(home).not.toMatch(/morning|evening|things need you/i);
    expect(home).not.toContain("<FromYourGroups");
    expect(home).not.toContain("<HomeCookNow");
    expect(home).toContain("<HomeCookTonight");
  });

  it("asks Needs you for All caught up instead of hiding it", () => {
    expect(home).toMatch(/<NeedsYou[^>]*caughtUp/);
    expect(kitchen("inbox-needs-ui.tsx")).toContain("All caught up");
  });

  it.each(["new-home-ui.tsx", "new-home-parts-ui.tsx", "inbox-needs-ui.tsx"])("%s uses tokens only, so dark is RV-14's black theme", (f) => {
    const src = kitchen(f);
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(src).not.toMatch(/font-(semibold|bold|extrabold)/);
  });
});
