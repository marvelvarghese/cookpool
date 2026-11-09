import type { KitchenMeasure, ReachableItem } from "@saas/contracts/kitchen";
import {
  HALF_MEASURE_MILLI,
  amountUnits,
  amountView,
  canPickStep,
  countWords,
  draftPick,
  parseTyped,
  pickAmount,
  pickQty,
  pickRequest,
  pickRest,
  pickStart,
  pickStep,
  pickTyped,
  pickUnit,
  pickWrite,
  type AmountPick,
} from "@web-console-next/components/kitchen/amount-picker";
import { itemLadder } from "@web-console-next/components/kitchen/pantry-set";
import { otherStart, otherStep, quickUseRequest, useTiles } from "@web-console-next/components/kitchen/quick-use";
import { ANU, ME, ONION, PERSONAL_REF, makeItem, makeUsual as usual, morningUsual as morning } from "./kitchen-pantry-fixtures";

// cookpool-pantry PN-11 (the canvas's AmountPicker): the amount with unit
// chips shared by the open row, the More… sheet and the item page — the
// chips per item, even steps per unit, converting on a switch, typing,
// never more than is left (The rest), what is written, and where it starts.

const GLASS: KitchenMeasure = { id: "msr_glass", one: "glass", many: "glasses", count: 1, amountMilli: 250_000 };
const CUP: KitchenMeasure = { id: "msr_cup", one: "cup", many: "cups", count: 1, amountMilli: 120_000 };
const PINCH: KitchenMeasure = { id: "msr_pinch", one: "pinch", many: "pinches", count: 1, amountMilli: 50 };
const SLICE: KitchenMeasure = { id: "msr_slice", one: "slice", many: "slices", count: 20, amountMilli: 1_000 };
const TRAY: KitchenMeasure = { id: "msr_tray", one: "tray", many: "trays", count: 1, amountMilli: 30_000 };

const withMeasures = (item: ReachableItem, measures: KitchenMeasure[]) => ({ ...item, measures });
const milk = (left = "1.5", measures: KitchenMeasure[] = [GLASS]) =>
  withMeasures(makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "2", left, priceMinor: 13600 }), measures);
const eggs = (left = "10", bought = "12") => makeItem({ name: "Eggs", category: "protein", unit: "pcs", bought, left, priceMinor: 8400, pantry: PERSONAL_REF });
const atta = (left = "3.2") => withMeasures(makeItem({ name: "Atta", category: "grains", unit: "kg", bought: "5", left, priceMinor: 25000 }), [CUP]);
const at = (unit: string, count: number, how: AmountPick["how"] = "changed"): AmountPick => ({ unit, count, rest: false, how });
const chips = (item: Parameters<typeof amountUnits>[0]) => amountUnits(item).map((u) => u.many);

describe("the unit chips", () => {
  it("lead with the item's own measures, then the plain units of its dimension", () => {
    expect(chips(milk())).toEqual(["glasses", "ml", "L"]);
    expect(chips(atta())).toEqual(["cups", "g", "kg"]);
    expect(amountUnits(milk()).map((u) => u.id)).toEqual(["m:glass", "u:ml", "u:L"]);
  });

  it("are the plain units alone without measures, with L or kg only for an item bought by the litre or kilo", () => {
    expect(chips(milk("1.5", []))).toEqual(["ml", "L"]);
    expect(chips(makeItem({ name: "Fresh cream", unit: "ml", bought: "200", left: "100" }))).toEqual(["ml"]);
    expect(chips(makeItem({ name: "Butter", unit: "g", bought: "500", left: "450" }))).toEqual(["g"]);
    // L stays while a quarter of one fits what is left.
    expect(chips(milk("0.2", []))).toEqual(["ml"]);
  });

  it("count things in their own word, and by the dozen for a dozen or more", () => {
    expect(chips(eggs())).toEqual(["eggs", "dozen"]);
    expect(amountUnits(eggs())[0]).toMatchObject({ id: "u:pcs", one: "egg", many: "eggs" });
    expect(chips(eggs("4", "6"))).toEqual(["eggs"]);
    // Half a dozen no longer fits.
    expect(chips(eggs("5"))).toEqual(["eggs"]);
    // A name that isn't a plain plural keeps pieces.
    expect(chips(makeItem({ name: "Leftovers: Dal makhani", unit: "pcs", bought: "2", left: "2" }))).toEqual(["pcs"]);
  });

  it("leave out a measure even its least amount of doesn't fit, and offer packs beside slices", () => {
    expect(chips(withMeasures(eggs(), [TRAY]))).toEqual(["eggs", "dozen"]);
    expect(chips(withMeasures(makeItem({ name: "Bread", unit: "pack", bought: "1", left: "1" }), [SLICE]))).toEqual(["slices", "packs"]);
  });
});

describe("even steps in the chosen unit", () => {
  it("are 1 of a measure (½ below one for 100 ml or g and up), 50 ml or g, ¼ L or kg, 1 egg, ½ dozen, ½ pack", () => {
    const steps = (item: Parameters<typeof amountUnits>[0]) => amountUnits(item).map((u) => [u.id, u.step, u.min]);
    expect(steps(milk())).toEqual([["m:glass", 1, 0.5], ["u:ml", 50, 50], ["u:L", 0.25, 0.25]]);
    expect(steps(atta())).toEqual([["m:cup", 1, 0.5], ["u:g", 50, 50], ["u:kg", 0.25, 0.25]]);
    expect(steps(eggs())).toEqual([["u:pcs", 1, 1], ["u:dozen", 0.5, 0.5]]);
    expect(steps(withMeasures(makeItem({ name: "Saffron", unit: "g", bought: "2", left: "1.4" }), [PINCH]))[0]).toEqual(["m:pinch", 1, 1]);
    expect(steps(withMeasures(makeItem({ name: "Bread", unit: "pack", bought: "1" }), [SLICE]))).toEqual([["m:slice", 1, 1], ["u:pack", 0.5, 0.5]]);
    expect(HALF_MEASURE_MILLI).toBe(100_000);
  });

  it("go ½ ↔ 1 ↔ 2 glasses, stopping at the least amount", () => {
    const item = milk();
    let p = at("m:glass", 1);
    p = pickStep(item, p, -1);
    expect(p).toMatchObject({ count: 0.5, rest: false });
    expect(canPickStep(item, p, -1)).toBe(false);
    expect(pickStep(item, p, -1)).toBe(p);
    expect(pickStep(item, pickStep(item, p, 1), 1)).toMatchObject({ count: 2 });
    expect(pickStep(item, at("m:glass", 1.5), 1)).toMatchObject({ count: 2 });
    expect(pickStep(item, at("m:glass", 1.5), -1)).toMatchObject({ count: 1 });
  });

  it("land on the unit's grid (430 g − 50 g → 400 g) and never under one step", () => {
    const item = atta();
    expect(pickStep(item, at("u:g", 430), -1)).toMatchObject({ count: 400 });
    expect(pickStep(item, at("u:g", 430), 1)).toMatchObject({ count: 450 });
    expect(pickStep(item, at("u:kg", 0.25), 1)).toMatchObject({ count: 0.5 });
    expect(canPickStep(item, at("u:g", 50), -1)).toBe(false);
    expect(pickStep(eggs(), at("u:dozen", 0.5), -1)).toMatchObject({ count: 0.5 });
    expect(pickStep(eggs(), at("u:pcs", 2), 1)).toMatchObject({ count: 3 });
  });
});

describe("switching unit converts the amount", () => {
  it("2 glasses → 500 ml → ½ L, and back", () => {
    const item = milk();
    const ml = pickUnit(item, at("m:glass", 2, "suggested"), "u:ml");
    expect(ml).toMatchObject({ unit: "u:ml", count: 500, rest: false });
    const l = pickUnit(item, ml, "u:L");
    expect(l).toMatchObject({ unit: "u:L", count: 0.5 });
    expect(amountView(item, l, null, null)).toMatchObject({ number: "½", word: "L", words: "½ L", qtyMilli: 500_000 });
    expect(pickUnit(item, l, "m:glass")).toMatchObject({ count: 2 });
    // The same amount keeps how it got there: the suggestion stays the suggestion.
    expect(ml.how).toBe("suggested");
  });

  it("rounds to the new unit's step, and says it changed", () => {
    const item = milk();
    // 1½ glasses = 375 ml → 400 ml (50s) → ½ L (quarters).
    expect(pickUnit(item, at("m:glass", 1.5, "suggested"), "u:ml")).toMatchObject({ count: 400, how: "changed" });
    expect(pickUnit(item, at("m:glass", 1.5), "u:L")).toMatchObject({ count: 0.5 });
    expect(pickUnit(item, at("u:ml", 300), "m:glass")).toMatchObject({ count: 1 });
    expect(pickUnit(item, at("u:ml", 100), "m:glass")).toMatchObject({ count: 0.5 });
    expect(pickUnit(item, at("u:ml", 50), "u:L")).toMatchObject({ count: 0.25 });
    expect(pickUnit(eggs(), at("u:pcs", 2), "u:dozen")).toMatchObject({ count: 0.5 });
    expect(pickUnit(atta(), at("m:cup", 2), "u:g")).toMatchObject({ count: 250 });
  });

  it("keeps The rest as The rest, and ignores a unit the item doesn't offer", () => {
    const rest = pickRest(at("m:glass", 2));
    expect(pickUnit(milk(), rest, "u:L")).toMatchObject({ unit: "u:L", rest: true });
    expect(pickUnit(milk(), at("u:ml", 500), "u:kg")).toMatchObject({ unit: "u:ml", count: 500 });
  });
});

describe("typing the amount", () => {
  it("takes decimals, a comma, halves and quarters, and fractions", () => {
    expect(["2", "1.5", "1,5", ".5", "2.", "½", "1½", "1 ½", "¾", "2¼", "1/2", "1 1/2", " 3 "].map(parseTyped)).toEqual([2, 1.5, 1.5, 0.5, 2, 0.5, 1.5, 1.5, 0.75, 2.25, 0.5, 1.5, 3]);
  });

  it("refuses junk, zero and below", () => {
    for (const junk of ["", " ", "abc", "1.2.3", "-1", "0", "0.0", "1/0", "½½", "1.5½", "2 eggs", "."]) expect(parseTyped(junk)).toBeNull();
    expect(pickTyped(milk(), at("m:glass", 2), "lots")).toBeNull();
  });

  it("keeps a typed amount to the unit's grain, reading Typed", () => {
    const item = milk();
    expect(pickTyped(item, at("m:glass", 2), "1½")).toMatchObject({ count: 1.5, how: "typed" });
    // Halves of a measure, as the server takes them.
    expect(pickTyped(item, at("m:glass", 2), "1.3")).toMatchObject({ count: 1.5 });
    expect(pickTyped(item, at("u:ml", 50), "333")).toMatchObject({ count: 333 });
    expect(pickTyped(item, at("u:L", 1), "0.3")).toMatchObject({ count: 0.3 });
    expect(pickTyped(eggs(), at("u:pcs", 1), "2.4")).toMatchObject({ count: 2 });
    // A typed amount may be under one step: you meant it.
    const small = pickTyped(item, at("u:ml", 50), "20")!;
    expect(small).toMatchObject({ count: 20 });
    expect(amountView(item, small, null, null).reason).toBe("Typed");
  });
});

describe("never more than what is left", () => {
  it("+ reaches The rest and stops there", () => {
    const item = atta();
    let p = at("u:kg", 2.75);
    p = pickStep(item, p, 1);
    expect(p).toMatchObject({ count: 3, rest: false });
    p = pickStep(item, p, 1);
    expect(p).toMatchObject({ rest: true });
    expect(pickQty(item, p)).toBe(3_200_000);
    expect(canPickStep(item, p, 1)).toBe(false);
    expect(amountView(item, p, null, null)).toMatchObject({ reason: "The rest", canMore: false, number: "3.2", words: "3.2 kg" });
  });

  it("− from The rest is the most under it on the unit's grid", () => {
    expect(pickStep(atta(), pickRest(at("u:kg", 1)), -1)).toMatchObject({ count: 3, rest: false });
    // Exactly 6 glasses left: − is 5.
    expect(pickStep(milk(), pickRest(at("m:glass", 1)), -1)).toMatchObject({ count: 5 });
    expect(pickStep(milk("0.1"), pickRest(at("m:glass", 1)), -1)).toMatchObject({ rest: true });
    expect(canPickStep(milk("0.1"), pickRest(at("m:glass", 1)), -1)).toBe(false);
  });

  it("makes a typed or converted amount past what is left The rest", () => {
    expect(pickTyped(milk(), at("m:glass", 1), "9")).toMatchObject({ rest: true });
    expect(pickTyped(milk(), at("u:L", 1), "1.5")).toMatchObject({ rest: true });
    // 380 ml is 1.52 quarters of a litre: ½ L, more than the 400 ml left.
    expect(pickUnit(milk("0.4"), at("u:ml", 380), "u:L")).toMatchObject({ rest: true });
    expect(pickUnit(milk("0.4"), at("u:ml", 350), "u:L")).toMatchObject({ count: 0.25, rest: false });
  });

  it("shows The rest in a measure it doesn't divide into as about so many", () => {
    const v = amountView(atta(), pickRest(at("m:cup", 1)), null, null);
    expect(v).toMatchObject({ number: "≈ 26½", word: "cups", words: "3.2 kg", hint: "Step 1 cup · ≈ 3.2 kg", rest: true });
    expect(amountView(milk(), pickRest(at("m:glass", 1)), null, null)).toMatchObject({ number: "6", words: "1.5 L" });
  });

  it("never takes more than is left, whatever is picked", () => {
    for (const left of ["0.05", "0.3", "1", "1.5"]) {
      const item = milk(left);
      for (const u of amountUnits(item)) {
        let p: AmountPick = { unit: u.id, count: u.min, rest: false, how: "changed" };
        for (let i = 0; i < 40; i++) {
          p = pickStep(item, p, 1);
          expect(pickQty(item, p)).toBeLessThanOrEqual(item.qtyLeftMilli);
          expect(pickAmount(item, p).qtyMilli).toBeLessThanOrEqual(item.qtyLeftMilli);
        }
        expect(p.rest).toBe(true);
      }
    }
  });
});

describe("what is written", () => {
  it("is the measure chosen, by its word", () => {
    expect(pickRequest(milk(), at("m:glass", 2), [ME, ANU])).toEqual({ quantity: "2", measure: "glass", consumers: [ME, ANU] });
    expect(pickRequest(milk(), at("m:glass", 0.5), [ME])).toEqual({ quantity: "0.5", measure: "glass", consumers: [ME] });
    expect(pickWrite(milk(), at("m:glass", 2))).toEqual({ qtyMilli: 500_000, what: "2 glasses", measure: { measure: GLASS, quantity: 2 } });
  });

  it("is quantity and unit in the item's base unit for a plain unit", () => {
    expect(pickRequest(milk(), at("u:ml", 500), [ME])).toEqual({ quantity: "500", unit: "ml", consumers: [ME] });
    expect(pickRequest(milk(), at("u:L", 0.5), [ME])).toEqual({ quantity: "500", unit: "ml", consumers: [ME] });
    expect(pickRequest(atta(), at("u:kg", 1.25), [ME])).toEqual({ quantity: "1250", unit: "g", consumers: [ME] });
    expect(pickWrite(milk(), at("u:L", 0.5))).toEqual({ qtyMilli: 500_000, what: "½ L", measure: null });
  });

  it("names nobody in your own pantry, and counts eggs by the piece", () => {
    expect(pickRequest(eggs(), at("u:dozen", 0.5), [ME])).toEqual({ quantity: "6", unit: "pcs" });
    expect(pickWrite(eggs(), at("u:pcs", 2))).toMatchObject({ qtyMilli: 2_000, what: "2 eggs" });
  });

  it("is exactly what is left for The rest, even in a measure", () => {
    expect(pickRequest(atta(), pickRest(at("m:cup", 1)), [ME])).toEqual({ quantity: "3200", unit: "g", consumers: [ME] });
    expect(pickWrite(atta(), pickRest(at("m:cup", 1)))).toEqual({ qtyMilli: 3_200_000, what: "3.2 kg", measure: null });
  });
});

describe("where it starts: the suggestion (design §2.2)", () => {
  it("is the usual in the item's own measure, with its reason", () => {
    const item = milk();
    const ladder = itemLadder(item, usual(item, { now: morning(250_000, 3) }));
    const start = pickStart(item, ladder.suggestion)!;
    expect(start).toEqual({ unit: "m:glass", count: 1, rest: false, how: "suggested" });
    expect(amountView(item, start, start, ladder.suggestion!.why)).toMatchObject({ number: "1", word: "glass", reason: "Morning usual", hint: "Step 1 glass · ≈ 250 ml" });
  });

  it("is in a plain unit without a measure for it", () => {
    const item = milk("1.5", []);
    expect(pickStart(item, itemLadder(item, usual(item)).suggestion)).toMatchObject({ unit: "u:ml", count: 250 });
    const kilo = makeItem({ name: "Atta", unit: "kg", bought: "5", left: "3" });
    expect(pickStart(kilo, itemLadder(kilo, usual(kilo, { lastQtyMilli: 1_000_000, lastUnit: "g" })).suggestion)).toMatchObject({ unit: "u:kg", count: 1 });
    const onions = withMeasures(makeItem({ name: "Onions", unit: "kg", bought: "1", left: "0.9" }), [ONION]);
    const said = usual(onions, { lastQtyMilli: 300_000, lastLabel: "2 onions", lastUnit: "g" });
    expect(pickStart(onions, itemLadder(onions, said).suggestion)).toMatchObject({ unit: "m:onion", count: 2 });
  });

  it("is The rest when little is left, and the first chip's least amount with no suggestion", () => {
    const item = milk("0.3");
    const ladder = itemLadder(item, usual(item));
    const start = pickStart(item, ladder.suggestion)!;
    expect(start).toMatchObject({ rest: true, how: "suggested" });
    expect(amountView(item, start, start, ladder.suggestion!.why).reason).toBe("The rest");
    expect(pickStart(eggs(), null)).toEqual({ unit: "u:pcs", count: 1, rest: false, how: "suggested" });
    expect(pickStart(milk("0"), null)).toBeNull();
  });

  it("reads Changed once moved, and the suggestion's reason again back where it started", () => {
    const item = milk();
    const start = pickStart(item, itemLadder(item, usual(item)).suggestion)!;
    const moved = pickStep(item, start, 1);
    expect(amountView(item, moved, start, "Your usual").reason).toBe("Changed");
    expect(amountView(item, pickStep(item, moved, -1), start, "Your usual").reason).toBe("Your usual");
    expect(amountView(item, pickRest(start), start, "Your usual").reason).toBe("The rest");
  });
});

describe("the draft remembers the unit and amount", () => {
  it("comes back as kept, at most what is left now", () => {
    expect(draftPick(milk(), { unit: "u:L", count: 0.5, rest: false, how: "changed" })).toEqual({ unit: "u:L", count: 0.5, rest: false, how: "changed" });
    expect(draftPick(milk("0.4"), { unit: "u:ml", count: 500, rest: false, how: "changed" })).toMatchObject({ rest: true });
    expect(draftPick(milk(), { unit: "u:ml", count: 0, rest: true, how: "rest" })).toMatchObject({ rest: true, unit: "u:ml" });
  });

  it("is dropped when its unit is gone or nothing is left", () => {
    expect(draftPick(milk("1.5", []), { unit: "m:glass", count: 2, rest: false, how: "changed" })).toBeNull();
    expect(draftPick(milk("0"), { unit: "u:ml", count: 50, rest: false, how: "changed" })).toBeNull();
    expect(draftPick(milk(), null)).toBeNull();
  });
});

describe("the box's words", () => {
  it("say quarters and halves as such, else up to two decimals", () => {
    expect([0.25, 0.5, 0.75, 1, 1.5, 2.25, 0.3, 433.333, 0].map(countWords)).toEqual(["¼", "½", "¾", "1", "1½", "2¼", "0.3", "433.33", "0"]);
  });

  it("give the step and, away from the base unit, what it comes to", () => {
    expect(amountView(milk(), at("u:ml", 500), null, null).hint).toBe("Step 50 ml");
    expect(amountView(milk(), at("u:L", 0.5), null, null).hint).toBe("Step ¼ L · = 500 ml");
    expect(amountView(eggs(), at("u:dozen", 0.5), null, null)).toMatchObject({ hint: "Step ½ dozen · = 6 eggs", word: "dozen" });
  });
});

describe("today's frame (newFrame false) keeps its Use screen", () => {
  // The old frame's /use tiles, Another amount and request are untouched by the picker.
  it("still offers the same tiles, steps and request", () => {
    const item = milk("1.5", []);
    expect(useTiles(item, null).map((t) => t.label)).toEqual(["1 glass", "½ glass", "The rest"]);
    expect(otherStep(item, otherStart(item, null), 1)).toEqual({ side: "unit", quantity: 0, qtyMilli: 100_000 });
    expect(quickUseRequest(item, 250_000, [ME], [ME, ANU], ME)).toEqual({ quantity: "250", unit: "ml", consumers: [ME] });
  });
});
