import type { KitchenMeasure, ReachableItem } from "@saas/contracts/kitchen";
import {
  TICK_EMPTY,
  USUAL_UNITS_MAX,
  cleanTyped,
  lastUseText,
  parseUsualUnits,
  putUsualUnit,
  tickAmount,
  tickLoggedText,
  tickMeta,
  tickStart,
  tickStartAt,
  tickUnitChoice,
  tickWrite,
  usualUnitKey,
} from "@web-console-next/components/kitchen/tick-row";
import { usualNowRows } from "@web-console-next/components/kitchen/pantry-look";
import { itemLadder } from "@web-console-next/components/kitchen/pantry-set";
import { FLAT, PERSONAL_REF, groupRef, makeItem, makeUsual, morningUsual } from "./kitchen-pantry-fixtures";

// cookpool-revamp RV-10 (the canvas's RvKitchen, "Tick to log"): the tick
// row's grey amount, typing over it, the unit chips that convert it and
// become the usual, what a tick logs, the line under the name, and Usual now.

const GLASS: KitchenMeasure = { id: "msr_glass", one: "glass", many: "glasses", count: 1, amountMilli: 250_000 };
const CUP: KitchenMeasure = { id: "msr_cup", one: "cup", many: "cups", count: 1, amountMilli: 120_000 };

const milk = (left = "1.5", measures: KitchenMeasure[] = [GLASS]): ReachableItem => ({
  ...makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "2", left, priceMinor: 13600, pantry: groupRef(FLAT) }),
  measures,
});
const eggs = () => makeItem({ name: "Eggs", category: "protein", unit: "pcs", bought: "12", left: "10", priceMinor: 8400, pantry: PERSONAL_REF });
const atta = () => ({ ...makeItem({ name: "Atta", category: "grains", unit: "kg", bought: "5", left: "3.2", priceMinor: 25000 }), measures: [CUP] });

/** The ghost from a morning usual of `qtyMilli`. */
const startOf = (item: ReachableItem, qtyMilli: number, usualUnit: string | null = null) =>
  tickStart(item, itemLadder(item, makeUsual(item, { lastQtyMilli: qtyMilli, now: morningUsual(qtyMilli, 4) })).suggestion, usualUnit);

describe("the ghost (the usual amount in grey)", () => {
  it("is the usual in its own measure, with the unit beside it", () => {
    const item = milk();
    const a = tickAmount(item, startOf(item, 250_000), TICK_EMPTY)!;
    expect(a).toMatchObject({ ghost: "1", word: "glass", words: "1 glass", qtyMilli: 250_000, typed: false, invalid: false });
    expect(a.unit.id).toBe("m:glass");
  });

  it("is counted things in their own word, and a plain amount in a plain unit", () => {
    const e = eggs();
    expect(tickAmount(e, startOf(e, 2_000), TICK_EMPTY)).toMatchObject({ ghost: "2", word: "eggs", words: "2 eggs" });
    const plain = milk("1.5", []);
    expect(tickAmount(plain, startOf(plain, 200_000), TICK_EMPTY)).toMatchObject({ ghost: "200", word: "ml" });
  });

  it("starts in the food's usual unit when the item offers it, and ignores one it doesn't", () => {
    const item = milk();
    expect(tickAmount(item, startOf(item, 250_000, "u:ml"), TICK_EMPTY)).toMatchObject({ ghost: "250", word: "ml", qtyMilli: 250_000 });
    expect(tickAmount(item, startOf(item, 250_000, "m:cup"), TICK_EMPTY)).toMatchObject({ ghost: "1", word: "glass" });
  });

  it("is nothing when nothing is left", () => {
    const item = milk("0");
    expect(startOf(item, 250_000)).toBeNull();
    expect(tickAmount(item, null, TICK_EMPTY)).toBeNull();
  });

  it("can start from a plain amount (the cook session's scaled recipe amount)", () => {
    const item = milk();
    expect(tickAmount(item, tickStartAt(item, 500_000), TICK_EMPTY)).toMatchObject({ ghost: "2", word: "glasses", qtyMilli: 500_000 });
    expect(tickAmount(item, tickStartAt(item, 500_000, "u:ml"), TICK_EMPTY)).toMatchObject({ ghost: "500", word: "ml" });
    const a = atta();
    expect(tickAmount(a, tickStartAt(a, 250_000), TICK_EMPTY)).toMatchObject({ ghost: "250", word: "g" });
  });
});

describe("typing over it", () => {
  const item = milk();
  const start = startOf(item, 250_000);

  it("sets the amount in the chosen unit, ½ and decimals included", () => {
    expect(tickAmount(item, start, { typed: "2", unit: null })).toMatchObject({ ghost: "1", number: "2", word: "glasses", words: "2 glasses", qtyMilli: 500_000, typed: true });
    expect(tickAmount(item, start, { typed: "½", unit: null })).toMatchObject({ number: "½", qtyMilli: 125_000 });
    expect(tickAmount(item, start, { typed: "1,5", unit: null })).toMatchObject({ number: "1½", qtyMilli: 375_000 });
  });

  it("leaves the ghost in force for anything that isn't an amount", () => {
    expect(tickAmount(item, start, { typed: "0", unit: null })).toMatchObject({ invalid: true, typed: false, qtyMilli: 250_000, words: "1 glass" });
    expect(tickAmount(item, start, { typed: "  ", unit: null })).toMatchObject({ invalid: false, typed: false });
  });

  it("never logs more than is left", () => {
    expect(tickAmount(item, start, { typed: "40", unit: null })!.qtyMilli).toBe(item.qtyLeftMilli);
  });

  it("keeps only what an amount is typed with", () => {
    expect(cleanTyped("2 glasses")).toBe("2 ");
    expect(cleanTyped("1½")).toBe("1½");
    expect(cleanTyped("abc-1.5")).toBe("1.5");
    expect(cleanTyped("1234567890123456")).toHaveLength(12);
  });
});

describe("the unit chips", () => {
  it("are only the item's own measures and its dimension's plain units", () => {
    const item = milk();
    expect(tickAmount(item, startOf(item, 250_000), TICK_EMPTY)!.units.map((u) => u.id)).toEqual(["m:glass", "u:ml", "u:L"]);
    const e = eggs();
    expect(tickAmount(e, startOf(e, 2_000), TICK_EMPTY)!.units.map((u) => u.many)).toEqual(["eggs", "dozen"]);
  });

  it("convert the grey amount, rounded to the unit's step", () => {
    const item = milk();
    const start = startOf(item, 250_000);
    expect(tickAmount(item, start, { typed: "", unit: "u:ml" })).toMatchObject({ ghost: "250", word: "ml", qtyMilli: 250_000 });
    expect(tickAmount(item, start, { typed: "", unit: "u:L" })).toMatchObject({ ghost: "¼", word: "L", qtyMilli: 250_000 });
    const two = startOf(item, 500_000);
    expect(tickAmount(item, two, { typed: "", unit: "u:L" })).toMatchObject({ ghost: "½", qtyMilli: 500_000 });
  });

  it("clear anything typed, and keep the unit chosen", () => {
    expect(tickUnitChoice({ typed: "3", unit: null }, "u:ml")).toEqual({ typed: "", unit: "u:ml" });
  });

  it("take typing in the unit chosen", () => {
    const item = milk();
    expect(tickAmount(item, startOf(item, 250_000), { typed: "300", unit: "u:ml" })).toMatchObject({ words: "300 ml", qtyMilli: 300_000 });
  });

  it("ignore a unit the item doesn't offer", () => {
    const item = milk();
    expect(tickAmount(item, startOf(item, 250_000), { typed: "", unit: "u:g" })).toMatchObject({ ghost: "1", word: "glass" });
  });
});

describe("what a tick logs", () => {
  it("is a count of the measure, or an amount in the base unit", () => {
    const item = milk();
    const start = startOf(item, 250_000);
    expect(tickWrite(item, tickAmount(item, start, TICK_EMPTY)!)).toEqual({ qtyMilli: 250_000, what: "1 glass", measure: { measure: GLASS, quantity: 1 } });
    expect(tickWrite(item, tickAmount(item, start, { typed: "", unit: "u:L" })!)).toMatchObject({ qtyMilli: 250_000, what: "¼ L", measure: null });
    expect(tickWrite(item, tickAmount(item, start, { typed: "2", unit: null })!)).toMatchObject({ qtyMilli: 500_000, measure: { quantity: 2 } });
  });
});

describe("the line under the name", () => {
  const now = new Date(2026, 10, 9, 10, 0);
  const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();

  it("is the last use, with the time today and yesterday, the day before that", () => {
    const item = milk();
    expect(lastUseText(makeUsual(item, { lastQtyMilli: 250_000, lastLabel: "1 glass", lastUsedAt: at(8, 20, 10) }), item, now)).toBe("1 glass · yesterday, 8:10 pm");
    expect(lastUseText(makeUsual(item, { lastQtyMilli: 50_000, lastLabel: null, lastUsedAt: at(9, 8, 5) }), { name: "Paneer", dimension: "mass" }, now)).toBe("50 g · today, 8:05 am");
    expect(lastUseText(makeUsual(item, { lastQtyMilli: 250_000, lastLabel: "1 glass", lastUsedAt: at(3, 9, 0) }), item, now)).toBe("1 glass · 3 Nov");
    expect(lastUseText(null, item, now)).toBeNull();
    // Counted things in their own word.
    expect(lastUseText(makeUsual(eggs(), { lastQtyMilli: 2_000, lastLabel: null, lastUsedAt: at(8, 8, 10) }), eggs(), now)).toBe("2 eggs · yesterday, 8:10 am");
  });

  it("is amber with the day for use soon, red with what is left once expired, else muted", () => {
    expect(tickMeta({ last: "50 g · 3 Nov", left: "200 g left", expired: false, soon: true, useBy: "tomorrow" })).toEqual({ text: "50 g · 3 Nov · use by tomorrow", tone: "soon" });
    expect(tickMeta({ last: "1 cup · today", left: "100 g left", expired: true, soon: false, useBy: "today" })).toEqual({ text: "Expired · 100 g left", tone: "expired" });
    expect(tickMeta({ last: null, left: "1.5 L left", expired: false, soon: false, useBy: null })).toEqual({ text: "1.5 L left", tone: "muted" });
    expect(tickMeta({ last: "2 eggs · yesterday, 8:10 am", left: "10 left", expired: false, soon: false, useBy: null }).text).toBe("2 eggs · yesterday, 8:10 am");
  });

  it("counts what is logged in a section", () => {
    expect(tickLoggedText(0)).toBe("");
    expect(tickLoggedText(2)).toBe("2 logged");
  });
});

describe("the usual unit, kept per food on the device", () => {
  it("is keyed by pantry, name and dimension", () => {
    expect(usualUnitKey(milk())).toBe(`${FLAT.orgId}:milk:volume`);
    expect(usualUnitKey(eggs())).toBe("me:eggs:count");
  });

  it("reads only unit ids, and survives junk", () => {
    expect(parseUsualUnits('{"a":"m:glass","b":"u:ml","c":3,"d":"glass"}')).toEqual({ a: "m:glass", b: "u:ml" });
    expect(parseUsualUnits("not json")).toEqual({});
    expect(parseUsualUnits("[1]")).toEqual({});
    expect(parseUsualUnits(null)).toEqual({});
  });

  it("puts the newest last and keeps at most the limit", () => {
    expect(putUsualUnit({ a: "u:ml", b: "u:g" }, "a", "m:glass")).toEqual({ b: "u:g", a: "m:glass" });
    let units: Record<string, string> = {};
    for (let i = 0; i < USUAL_UNITS_MAX + 5; i++) units = putUsualUnit(units, `k${i}`, "u:ml");
    expect(Object.keys(units)).toHaveLength(USUAL_UNITS_MAX);
    expect(units["k0"]).toBeUndefined();
  });
});

describe("Usual now", () => {
  const rows = ["a", "b", "c", "d"].map((id) => ({ id, canUse: id !== "d", pending: false }));
  const usual = (itemId: string, count: number, usedCount = 3) => ({ itemId, usedCount, now: count > 0 ? morningUsual(250_000, count) : null });

  it("lists what you use at this time of day, most uses in it first, only what you can use", () => {
    const got = usualNowRows(rows, [usual("a", 2), usual("b", 5), usual("c", 0), usual("d", 9), usual("x", 9)], { show: { kind: "all" } });
    expect(got.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("is empty while searching, on another chip, or without usuals", () => {
    expect(usualNowRows(rows, [usual("a", 2)], { show: { kind: "all" }, query: "mi" })).toEqual([]);
    expect(usualNowRows(rows, [usual("a", 2)], { show: { kind: "soon" } })).toEqual([]);
    expect(usualNowRows(rows, null, { show: { kind: "all" } })).toEqual([]);
  });
});
