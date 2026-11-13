import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { payerMatches } from "@web-console-next/components/kitchen/payer-picker";

// cookpool-kitchen-calm KC-6: Paid by is one selector, Who paid? searches the group.

const names: Record<string, string> = { u1: "You", u2: "Asha", u3: "Kiran", u4: "Meera" };
const label = (id: string) => names[id] ?? id;

describe("Who paid?'s search", () => {
  it("lists everyone, in the group's order, before anything is typed", () => {
    expect(payerMatches(["u1", "u2", "u3"], "  ", label)).toEqual(["u1", "u2", "u3"]);
  });

  it("keeps those whose name has the typed letters, any case", () => {
    expect(payerMatches(["u1", "u2", "u3", "u4"], "ER", label)).toEqual(["u4"]);
    expect(payerMatches(["u1", "u2", "u3", "u4"], "a", label)).toEqual(["u2", "u3", "u4"]);
  });
});

describe("Add item's Paid by", () => {
  const page = readFileSync(`${cwd()}/../../apps/web-console-next/src/app/(kitchen)/pantry/new/page.tsx`, "utf8");
  it("is the one selector, not a row of chips", () => {
    expect(page).toContain("<PayerPicker");
    expect(page).not.toContain("payerChips");
  });
});
