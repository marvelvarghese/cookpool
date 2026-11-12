import {
  PCT_CHIPS,
  PORTION_CHIPS,
  everyone,
  itemAmounts,
  itemStatus,
  resetItem,
  setShare,
  shareBadge,
  splitEvenly,
  stepExact,
  switchMode,
} from "@/lib/itemized";
import type { ItemForm } from "@/lib/split-form";
import * as itemizedLib from "@/lib/itemized";

const PEOPLE = ["usr_a", "usr_b", "usr_c", "usr_d"];
const item = (over: Partial<ItemForm> = {}): ItemForm => ({ key: "i", name: "Kingfisher", qtyText: "6", unitText: "180", totalText: "", shares: {}, ...over });

describe("the panel's values are what the wire stores", () => {
  it("portions ×1000, ⅓ as 333", () => {
    expect(PORTION_CHIPS.map((c) => [c.label, c.value])).toEqual([
      ["¼", 250], ["⅓", 333], ["½", 500], ["1", 1000], ["2", 2000], ["3", 3000], ["4", 4000],
    ]);
  });

  it("percentages in basis points, ⅓ as 3333", () => {
    expect(PCT_CHIPS.map((c) => c.value)).toEqual([1000, 2000, 2500, 3333, 5000, 7500, 10000]);
  });

  it("badges a face", () => {
    expect(shareBadge(undefined)).toBe("");
    expect(shareBadge({ mode: "portion", value: 1000 })).toBe("");
    expect(shareBadge({ mode: "portion", value: 500 })).toBe("½");
    expect(shareBadge({ mode: "portion", value: 2000 })).toBe("×2");
    expect(shareBadge({ mode: "pct", value: 2500 })).toBe("25%");
    expect(shareBadge({ mode: "pct", value: 3333 })).toBe("⅓");
    expect(shareBadge({ mode: "exact", value: 5000 })).toBe("₹ set");
  });
});

describe("taps", () => {
  it("switching tabs starts from what they pay now", () => {
    expect(switchMode("portion", 12_345, 100_000)).toEqual({ mode: "portion", value: 1000 });
    expect(switchMode("pct", 25_000, 100_000)).toEqual({ mode: "pct", value: 2500 });
    expect(switchMode("exact", 18_450, 100_000)).toEqual({ mode: "exact", value: 18_000 });
  });

  it("±10 and ±50 stay inside the item's price", () => {
    expect(stepExact(1000, -5000, 108_000)).toBe(0);
    expect(stepExact(100_000, 5000, 108_000)).toBe(105_000);
    expect(stepExact(106_000, 5000, 108_000)).toBe(108_000);
  });

  it("the item menu: Everyone, Split evenly, Reset", () => {
    let it = everyone(item(), PEOPLE);
    expect(Object.keys(it.shares)).toEqual(PEOPLE);
    it = setShare(it, "usr_b", { mode: "pct", value: 5000 });
    it = setShare(it, "usr_d", null);
    expect(Object.keys(splitEvenly(it).shares)).toEqual(["usr_a", "usr_b", "usr_c"]);
    expect(splitEvenly(it).shares["usr_b"]).toEqual({ mode: "portion", value: 1000 });
    expect(resetItem(it).shares).toEqual({});
  });
});

describe("the line under an item", () => {
  it("asks for people, then shows what is left or over", () => {
    expect(itemStatus(item(), PEOPLE).text).toBe("Tap who had this");
    const one = setShare(item(), "usr_a", { mode: "exact", value: 50_000 });
    expect(itemStatus(one, PEOPLE)).toEqual({ text: "₹580 still not assigned", tone: "bad" });
    const over = setShare(setShare(item(), "usr_a", { mode: "pct", value: 8000 }), "usr_b", { mode: "pct", value: 4000 });
    expect(itemStatus(over, PEOPLE).text).toBe("₹216 more than the item costs");
  });

  it("says when portions claimed differ from the bill's count", () => {
    const it = setShare(setShare(item(), "usr_a", { mode: "portion", value: 2000 }), "usr_b", { mode: "portion", value: 2000 });
    expect(itemStatus(it, PEOPLE)).toEqual({ text: "4 claimed, bill says 6 — shared to fit", tone: "warn" });
  });

  it("works out each person's part to the paisa", () => {
    const it = setShare(setShare(setShare(item(), "usr_a", { mode: "portion", value: 333 }), "usr_b", { mode: "portion", value: 333 }), "usr_c", { mode: "portion", value: 333 });
    const { amounts } = itemAmounts(it, PEOPLE);
    expect([...amounts.values()].reduce((s, v) => s + v, 0)).toBe(108_000);
    expect([...amounts.values()]).toEqual([36_000, 36_000, 36_000]);
  });
});

describe("V2Itemized (SL4)", () => {
  const it1 = (over: Partial<ItemForm> = {}): ItemForm => ({ key: "i1", name: "Prawns", qtyText: "2", unitText: "380", totalText: "", shares: {}, ...over });
  it("badges a face only when not one portion: ¼ ½ 2 % ₹", () => {
    const { faceBadge } = itemizedLib;
    expect(faceBadge({ mode: "portion", value: 1000 })).toBe("");
    expect(faceBadge({ mode: "portion", value: 250 })).toBe("¼");
    expect(faceBadge({ mode: "portion", value: 500 })).toBe("½");
    expect(faceBadge({ mode: "portion", value: 2000 })).toBe("2");
    expect(faceBadge({ mode: "portion", value: 1500 })).toBe("1.5");
    expect(faceBadge({ mode: "pct", value: 2500 })).toBe("25%");
    expect(faceBadge({ mode: "exact", value: 12000 })).toBe("₹");
    expect(faceBadge(undefined)).toBe("");
  });
  it("shows qty × unit over the name", () => {
    expect(itemizedLib.qtyLine(it1())).toBe("2 × ₹380");
    expect(itemizedLib.qtyLine(it1({ unitText: "", qtyText: "3" }))).toBe("Qty 3");
  });
  it("totals each person on some item: the engine's when it adds up, else the item parts", () => {
    const a = it1({ shares: { A: { mode: "portion", value: 1000 }, B: { mode: "portion", value: 1000 } } });
    expect(itemizedLib.personTotals({ members: ["A", "B", "C"], items: [a] }, null)).toEqual([
      { subjectId: "A", minor: 38000 },
      { subjectId: "B", minor: 38000 },
    ]);
    expect(itemizedLib.personTotals({ members: ["A", "B", "C"], items: [a] }, new Map([["A", 40000], ["B", 40000]]))[0]).toEqual({ subjectId: "A", minor: 40000 });
  });
});
