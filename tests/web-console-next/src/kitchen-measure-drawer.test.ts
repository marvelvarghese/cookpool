import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { measureBase, readNewMeasure } from "@web-console-next/components/kitchen/measure-drawer";

// cookpool-kitchen-calm KC-2 and KC-3: the canvas's Kitchen, UnitDrawer, NewMeasure and Item boards.

const src = (f: string) => readFileSync(`${cwd()}/../../apps/web-console-next/src/${f}`, "utf8");
const kitchen = (f: string) => src(`components/kitchen/${f}`);

describe("New measure", () => {
  it("is counted in g, ml or pieces", () => {
    expect(measureBase("mass")).toBe("g");
    expect(measureBase("volume")).toBe("ml");
    expect(measureBase("count")).toBe("pcs");
    expect(measureBase("pack")).toBe("pieces");
  });

  it("reads 1 box = 500 g into the server's measure and its unit id", () => {
    const r = readNewMeasure("mass", " Box ", "500", []);
    expect(r).toEqual({ ok: true, input: { one: "Box", many: "Boxes", count: 1, amountMilli: 500_000 }, id: "m:box" });
  });

  it("reads 20 in a pack as a count", () => {
    const r = readNewMeasure("pack", "slice", "20", []);
    expect(r.ok && r.input).toEqual({ one: "slice", many: "slices", count: 20, amountMilli: 1_000 });
  });

  it("shows nothing while empty, and says what is missing", () => {
    expect(readNewMeasure("mass", "", "", [])).toEqual({ ok: false, problem: null });
    expect(readNewMeasure("mass", "", "50", [])).toEqual({ ok: false, problem: "Name the measure" });
    expect(readNewMeasure("mass", "bowl", "0", [])).toEqual({ ok: false, problem: "Say how much one is" });
  });

  it("refuses a word the item already counts in", () => {
    const r = readNewMeasure("mass", "bowl", "150", [{ one: "bowl", many: "bowls" }]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toMatch(/Already counted in bowls/);
  });
});

describe("the Measure drawer is where units are picked", () => {
  it("opens from a Kitchen tick row's unit, with New measure", () => {
    expect(kitchen("tick-row-ui.tsx")).toContain("<MeasureDrawer");
    expect(kitchen("kitchen-tick-ui.tsx")).toMatch(/drawer=\{\{/);
  });

  it("replaces Add item's unit chips, and the title is Add item", () => {
    const page = src("app/(kitchen)/pantry/new/page.tsx");
    expect(page).toContain("<MeasureDrawer");
    expect(page).not.toContain("Chip key={u}");
    expect(page).toContain("Add item</h1>");
  });
});

