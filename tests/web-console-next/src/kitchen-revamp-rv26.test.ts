// cookpool-revamp RV-26: the leftovers after RV-23..RV-25, read from the
// screens' source — the amount box's cp-box edge, full-bleed strips on the
// page gutter, The rest without a dashed edge, the expired bar's token.

import { readFileSync } from "node:fs";
import { cwd } from "node:process";

const root = `${cwd()}/../../apps/web-console-next/src`;
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

describe("RV-26's leftovers", () => {
  it("amount boxes use the cp-box edge", () => {
    expect(read("components/kitchen/tick-row-ui.tsx")).toContain('"border-[hsl(var(--cp-box))] bg-card focus-within:ring-2 focus-within:ring-ring"');
    expect(read("components/kitchen/list-run-ui.tsx").match(/: "border-\[hsl\(var\(--cp-box\)\)\]"\)/g)?.length).toBe(2);
  });

  it.each([
    "components/kitchen/list-run-ui.tsx",
    "components/kitchen/shopping-run-ui.tsx",
    "components/kitchen/new-home-parts-ui.tsx",
    "components/kitchen/now-strip-ui.tsx",
    "components/kitchen/quick-use-ui.tsx",
    "components/kitchen/plan-views.tsx",
    "components/kitchen/community-post-ui.tsx",
    "components/kitchen/cook-hub-views.tsx",
    "components/kitchen/recipe-link-views.tsx",
    "components/kitchen/explore-views.tsx",
    "app/(kitchen)/use/page.tsx",
    "app/(kitchen)/pantry/page.tsx",
  ])("%s bleeds by the page gutter, not -mx-4", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/(^|[\s"])-mx-4\s/);
    expect(src).toContain("-mx-[var(--cp-gutter,1rem)]");
    expect(src).toContain("px-[var(--cp-gutter,1rem)]");
  });

  it("The rest has no dashed edge, and the expired bar drops its fallback", () => {
    expect(read("components/kitchen/amount-picker-ui.tsx")).not.toContain("border-dashed");
    expect(read("components/kitchen/kitchen-staples-ui.tsx")).toContain('expired: "bg-[hsl(var(--cp-expired-bar))]"');
  });

  it("Home's Paid opens the one Settle up, so Settle up's useRecordPayment has no onUndoable", () => {
    expect(read("components/kitchen/settle-card.tsx")).not.toContain("onUndoable");
  });
});
