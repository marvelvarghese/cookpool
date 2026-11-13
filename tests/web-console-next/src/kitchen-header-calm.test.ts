import { readFileSync } from "node:fs";
import { cwd } from "node:process";

// cookpool-kitchen-calm KC-7: the Kitchen header — the kitchen picker, the list as a round button with its count.

const ui = readFileSync(`${cwd()}/../../apps/web-console-next/src/components/kitchen/kitchen-staples-ui.tsx`, "utf8");

describe("the Kitchen header", () => {
  it("draws the shopping list as a round button with a count badge, no List word", () => {
    const link = ui.slice(ui.indexOf("export function ShoppingListLink"));
    expect(link).toContain("rounded-full");
    expect(link).not.toContain("<span>List</span>");
  });

  it("titles the kitchen picker's sheet Show", () => {
    expect(ui).toContain(">Show</SheetTitle>");
  });
});
