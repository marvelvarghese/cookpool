import type { KitchenMeasure, KitchenUsual, Recipe } from "@saas/contracts/kitchen";
import { measureTakeMilli } from "@saas/contracts/kitchen";
import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import {
  askable,
  changedMeasures,
  countDecimal,
  countInLabel,
  countText,
  countedWords,
  firstAsk,
  leftInMeasure,
  maxCount,
  measureInput,
  measureRow,
  measuresPatches,
  measuresSavedText,
  parseCount,
  parseLabel,
  pendingMeasures,
  pluralOf,
  saveLabel,
  savedForText,
  sizeQuestion,
  stepCount,
  usualAmount,
  wordProblem,
  wordsForName,
} from "@web-console-next/components/kitchen/measures";
import {
  doItAgainRows,
  leftWithMeasure,
  otherLine,
  otherStart,
  otherStep,
  otherSwitch,
  parseOther,
  quickUseRequest,
  useTiles,
} from "@web-console-next/components/kitchen/quick-use";
import { historyRows, logRequest } from "@web-console-next/components/kitchen/item-use";
import {
  cookRequest,
  countLine,
  lineInEvenMeasure,
  lineView,
  pantryLine,
  refreshLines,
  stepLineCount,
  switchLine,
  withLeft,
} from "@web-console-next/components/kitchen/dish-maker";
import { recipeFill } from "@web-console-next/components/kitchen/from-before";
import { pendingMove, stockPatches, type StockChange } from "@web-console-next/components/kitchen/cache-patches";
import { applyPatches, rollbackPatches, type CacheKey, type CacheLike } from "@web-console-next/lib/optimistic";
import { qk } from "@web-console-next/lib/query-keys";
import { ANU, DEV, FLAT, MEERA, ME, NAMES, PERSONAL_REF, groupRef, makeItem } from "./kitchen-pantry-fixtures";

const money = (minor: number) => formatMinor(minor);

const onion: KitchenMeasure = { id: "msr_onion", one: "onion", many: "onions", count: 1, amountMilli: 150_000 };
const slice: KitchenMeasure = { id: "msr_slice", one: "slice", many: "slices", count: 20, amountMilli: 1_000 };

// Onions in Flat 4B: 1 kg for ₹40.00 (4 paise a gram), Meera paid; 600 g left.
const onions = (patch: Parameters<typeof makeItem>[0] = {}, measures: KitchenMeasure[] = [onion]) => ({
  ...makeItem({ name: "Onions", unit: "kg", bought: "1", left: "0.6", priceMinor: 4000, paidBy: MEERA, ...patch }),
  measures,
});
// Bread in Flat 4B: 1 pack for ₹45.00, all of it left.
const bread = (patch: Parameters<typeof makeItem>[0] = {}, measures: KitchenMeasure[] = []) => ({
  ...makeItem({ name: "Bread", unit: "pack", bought: "1", left: "1", priceMinor: 4500, paidBy: ANU, ...patch }),
  measures,
});
const milk = () => ({ ...makeItem({ name: "Milk", unit: "L", bought: "1", left: "1", priceMinor: 6800, paidBy: MEERA }), measures: [] });
const eggs = () => ({ ...makeItem({ name: "Eggs", pantry: PERSONAL_REF, unit: "pcs", bought: "12", left: "7", priceMinor: 8400, paidBy: ME }), measures: [] });

function usual(o: Partial<KitchenUsual> = {}): Pick<KitchenUsual, "lastQtyMilli" | "lastLabel"> {
  return { lastQtyMilli: 150_000, lastLabel: null, ...o };
}

describe("the word: a small singular rule", () => {
  it("makes a plural name singular, and is sure of it", () => {
    expect(wordsForName("Onions")).toEqual({ one: "onion", many: "onions", sure: true });
    expect(wordsForName("Tomatoes")).toEqual({ one: "tomato", many: "tomatoes", sure: true });
    expect(wordsForName("Red onions")).toEqual({ one: "red onion", many: "red onions", sure: true });
    expect(wordsForName("Strawberries")).toEqual({ one: "strawberry", many: "strawberries", sure: true });
    expect(wordsForName("Peaches")).toEqual({ one: "peach", many: "peaches", sure: true });
    expect(wordsForName("Green chillies")).toEqual({ one: "green chilli", many: "green chillies", sure: true });
    expect(wordsForName("  Eggs ")).toEqual({ one: "egg", many: "eggs", sure: true });
  });

  it("is not sure of a name that isn't a plain plural: Rice stays rice, Onion counts onions", () => {
    expect(wordsForName("Rice")).toEqual({ one: "rice", many: "rice", sure: false });
    expect(wordsForName("Basmati rice")).toEqual({ one: "basmati rice", many: "basmati rice", sure: false });
    expect(wordsForName("Onion")).toEqual({ one: "onion", many: "onions", sure: false });
    expect(wordsForName("Hummus")).toMatchObject({ sure: false });
  });

  it("fits the server's 24 characters, counting a long name in its last word", () => {
    const w = wordsForName("Organic small red cherry tomatoes");
    expect(w).toEqual({ one: "tomato", many: "tomatoes", sure: true });
    expect(w.one.length).toBeLessThanOrEqual(24);
  });

  it("makes a typed word plural", () => {
    expect(["katori", "berry", "box", "peach", "tomato", "loaf", "slice", "rice"].map(pluralOf)).toEqual([
      "katoris",
      "berries",
      "boxes",
      "peaches",
      "tomatoes",
      "loaves",
      "slices",
      "rice",
    ]);
  });
});

describe("asking once", () => {
  it("offers 'Count in onions' for a weight, a volume or a pack with no measure — never for things you count", () => {
    expect(askable(onions({}, []))).toBe(true);
    expect(askable(bread())).toBe(true);
    expect(askable(milk())).toBe(true);
    expect(askable(eggs())).toBe(false);
    expect(askable(onions())).toBe(false);
    expect(countInLabel(firstAsk(onions({}, [])).many)).toBe("Count in onions");
  });

  it("asks one question per dimension, with four quick picks", () => {
    const o = firstAsk(onions({}, []));
    expect(o).toEqual({ one: "onion", many: "onions", editable: false, picker: null });
    expect(sizeQuestion("mass", o)).toBe("1 onion weighs about");
    const m = firstAsk(milk());
    expect(m).toMatchObject({ one: "bottle", many: "bottles", editable: true });
    expect(sizeQuestion("volume", m)).toBe("1 bottle holds about");
    const b = firstAsk(bread());
    expect(b).toMatchObject({ one: "slice", many: "slices", editable: false, picker: ["slices", "pieces", "packets"] });
    expect(sizeQuestion("pack", b)).toBe("How many slices in a pack?");
    expect(firstAsk({ name: "Rice", dimension: "mass" })).toMatchObject({ one: "rice", editable: true });
    expect(firstAsk({ name: "Biscuits", dimension: "pack" })).toMatchObject({ one: "piece", many: "pieces" });
  });

  it("saves exactly: 150 g an onion is count 1 of 150 000; 20 slices a pack is count 20 of 1 000", () => {
    expect(measureInput("mass", { one: "onion", many: "onions" }, 150)).toEqual({ one: "onion", many: "onions", count: 1, amountMilli: 150_000 });
    expect(measureInput("volume", { one: "bottle", many: "bottles" }, 500)).toEqual({ one: "bottle", many: "bottles", count: 1, amountMilli: 500_000 });
    expect(measureInput("pack", { one: "slice", many: "slices" }, 20)).toEqual({ one: "slice", many: "slices", count: 20, amountMilli: 1_000 });
    expect(measureInput("pack", { one: " piece ", many: "pieces " }, 16)).toEqual({ one: "piece", many: "pieces", count: 16, amountMilli: 1_000 });
  });

  it("says Save with the size, the hint where it's saved", () => {
    expect(saveLabel("mass", { one: "onion", many: "onions" }, 150)).toBe("Save · 1 onion ≈ 150 g");
    expect(saveLabel("pack", { one: "slice", many: "slices" }, 20)).toBe("Save · 20 slices");
    expect(saveLabel("mass", { one: "onion", many: "onions" }, null)).toBe("Pick one");
    expect(savedForText("onions", groupRef(FLAT))).toBe("Saved for onions in Flat 4B.");
    expect(savedForText("rice", PERSONAL_REF)).toBe("Saved for rice in your pantry.");
  });
});

describe("the item page: add, change, remove (at most three)", () => {
  const katori = { one: "katori", many: "katoris", count: 1, amountMilli: 120_000 };

  it("adds at the end, changes in place, removes by changing to nothing", () => {
    expect(changedMeasures([onion], null, katori)).toEqual([{ one: "onion", many: "onions", count: 1, amountMilli: 150_000 }, katori]);
    expect(changedMeasures([onion], 0, { ...katori, one: "onion", many: "onions" })).toEqual([{ one: "onion", many: "onions", count: 1, amountMilli: 120_000 }]);
    expect(changedMeasures([onion, { id: "msr_k", ...katori }], 0, null)).toEqual([katori]);
  });

  it("keeps at most three, and a word once", () => {
    const four = changedMeasures([onion, { id: "a", ...katori }, { id: "b", one: "cup", many: "cups", count: 1, amountMilli: 200_000 }], null, {
      one: "handful",
      many: "handfuls",
      count: 1,
      amountMilli: 50_000,
    });
    expect(four.map((m) => m.one)).toEqual(["onion", "katori", "cup"]);
    expect(changedMeasures([onion], null, { ...katori, one: "Onion" }).map((m) => m.one)).toEqual(["onion"]);
    expect(wordProblem("Onion", [onion])).toBe("Already counted in onions");
    expect(wordProblem("onion", [onion], "onion")).toBeNull();
    expect(wordProblem(" ", [])).toBe("Type a word");
  });

  it("lists each: '1 onion ≈ 150 g', '1 slice · 20 in a pack'", () => {
    expect(measureRow(onion, "mass")).toEqual({ name: "1 onion", size: "≈ 150 g" });
    expect(measureRow(slice, "pack")).toEqual({ name: "1 slice", size: "20 in a pack" });
    expect(measureRow({ id: "t", one: "tray", many: "trays", count: 1, amountMilli: 30_000 }, "count")).toEqual({ name: "1 tray", size: "30 pcs" });
  });

  it("toasts what changed", () => {
    expect(measuresSavedText({ dimension: "mass", before: [], after: [measureInput("mass", { one: "onion", many: "onions" }, 150)] })).toBe("Saved · now in onions");
    expect(measuresSavedText({ dimension: "mass", before: [onion], after: [{ one: "onion", many: "onions", count: 1, amountMilli: 100_000 }] })).toBe(
      "Saved · 1 onion ≈ 100 g",
    );
    expect(measuresSavedText({ dimension: "mass", before: [onion], after: [] })).toBe("Removed · onion");
  });
});

describe("Use: the tiles, per dimension", () => {
  it("onions counted in onions: 1 onion and 2 onions, then ½ kg, then the rest", () => {
    const tiles = useTiles(onions());
    expect(tiles.map((t) => [t.label, t.sub])).toEqual([
      ["1 onion", `≈ 150 g · ${money(600)}`],
      ["2 onions", `≈ 300 g · ${money(1200)}`],
      ["½ kg", money(2000)],
      ["The rest", `600 g · ${money(2400)}`],
    ]);
    expect(tiles.map((t) => t.amount.qtyMilli)).toEqual([150_000, 300_000, 500_000, 600_000]);
    expect(tiles[0]!.amount).toMatchObject({ kind: "measure", quantity: 1, label: "1 onion" });
    expect(tiles[3]).toMatchObject({ rest: true, words: "the rest", amount: { kind: "unit", qtyMilli: 600_000 } });
  });

  it("onions with no measure yet: weights, the rest — and a slot for 'Count in onions'", () => {
    const tiles = useTiles(onions({}, []));
    expect(tiles.map((t) => t.label)).toEqual(["100 g", "250 g", "The rest"]);
    expect(tiles.map((t) => t.sub)).toEqual([money(400), money(1000), `600 g · ${money(2400)}`]);
  });

  it("offers only what is under what is left", () => {
    expect(useTiles(onions({ left: "0.2" })).map((t) => t.label)).toEqual(["1 onion", "100 g", "The rest"]);
    expect(useTiles(onions({ left: "0.12" })).map((t) => t.label)).toEqual(["100 g", "The rest"]);
    expect(useTiles(onions({ left: "0" }))).toEqual([]);
  });

  it("a liquid keeps the built-in glass and splash; things you count, pieces", () => {
    expect(useTiles(milk()).map((t) => [t.label, t.sub])).toEqual([
      ["1 glass", `250 ml · ${money(1700)}`],
      ["½ glass", `125 ml · ${money(850)}`],
      ["The rest", `1 L · ${money(6800)}`],
    ]);
    expect(useTiles(eggs()).map((t) => t.label)).toEqual(["1 pc", "2 pcs", "3 pcs", "The rest"]);
  });

  it("bread in slices: a slice is a twentieth of the pack, priced by the engine, with no '≈'", () => {
    const tiles = useTiles(bread({}, [slice]));
    expect(tiles.map((t) => [t.label, t.sub])).toEqual([
      ["1 slice", money(225)],
      ["2 slices", money(450)],
      ["½ pack", money(2250)],
      ["The rest", `1 pack · ${money(4500)}`],
    ]);
    expect(tiles[0]!.amount.qtyMilli).toBe(50);
  });

  it("puts your usual first, in its measure when its words still name one", () => {
    const tiles = useTiles(onions(), usual({ lastQtyMilli: 300_000, lastLabel: "2 onions" }));
    expect(tiles.map((t) => [t.label, t.usual])).toEqual([
      ["2 onions", true],
      ["1 onion", false],
      ["½ kg", false],
      ["The rest", false],
    ]);
    // A size changed since: 2 onions take what they take now.
    const bigger = useTiles(onions({}, [{ ...onion, amountMilli: 200_000 }]), usual({ lastQtyMilli: 300_000, lastLabel: "2 onions" }));
    expect(bigger[0]).toMatchObject({ label: "2 onions", usual: true, amount: { qtyMilli: 400_000 } });
    // Words that name no measure now: the amount, in the unit.
    expect(useTiles(onions({}, []), usual({ lastQtyMilli: 300_000, lastLabel: "2 onions" }))[0]).toMatchObject({ label: "300 g", usual: true });
    // Exactly what is left: the rest is the usual.
    expect(useTiles(onions(), usual({ lastQtyMilli: 600_000 })).find((t) => t.usual)?.rest).toBe(true);
  });

  it("says what is left in the measure too", () => {
    expect(leftWithMeasure(onions())).toBe("600 g left · ≈ 4 onions");
    expect(leftWithMeasure(bread({ left: "0.7" }, [slice]))).toBe("0.7 packs left · 14 slices");
    expect(leftWithMeasure(onions({}, []))).toBe("600 g left");
    expect(leftInMeasure(onions({ left: "0.05" }))).toBe("≈ ½ onion");
  });
});

describe("Use: another amount, in the measure or the unit", () => {
  it("opens on the chosen tile, in the measure, and steps by one (½ below one)", () => {
    const item = onions();
    const start = otherStart(item, { kind: "measure", measure: onion, quantity: 2, qtyMilli: 300_000, label: "2 onions" });
    expect(start).toEqual({ side: "measure", quantity: 2, qtyMilli: 300_000 });
    expect(otherStep(item, start, 1).quantity).toBe(3);
    expect(otherStep(item, otherStep(item, start, 1), 1).quantity).toBe(4);
    expect(otherStep(item, { ...start, quantity: 4 }, 1).quantity).toBe(4);
    expect(otherStep(item, { ...start, quantity: 1 }, -1).quantity).toBe(0.5);
    expect(otherStep(item, { ...start, quantity: 0.5 }, -1).quantity).toBe(0.5);
    expect(stepCount(0.5, 1, 4)).toBe(1);
    expect(stepCount(1.5, 1, 4)).toBe(2);
    expect(stepCount(2.5, -1, 4)).toBe(2);
  });

  it("switches sides with the same amount: 3 onions is 450 g, and back", () => {
    const item = onions();
    const three = { side: "measure" as const, quantity: 3, qtyMilli: 450_000 };
    const grams = otherSwitch(item, three, "unit");
    expect(grams).toMatchObject({ side: "unit", qtyMilli: 450_000 });
    expect(otherSwitch(item, { ...grams, qtyMilli: 400_000 }, "measure")).toMatchObject({ side: "measure", quantity: 2.5 });
  });

  it("shows the other side under it: '≈ 450 g · ₹18.00', '≈ 3 onions · ₹18.00'", () => {
    const item = onions();
    expect(otherLine(item, { kind: "measure", measure: onion, quantity: 3, qtyMilli: 450_000, label: "3 onions" })).toBe(`≈ 450 g · ${money(1800)}`);
    expect(otherLine(item, { kind: "unit", qtyMilli: 450_000 })).toBe(`≈ 3 onions · ${money(1800)}`);
    expect(otherLine(onions({}, []), { kind: "unit", qtyMilli: 450_000 })).toBe(money(1800));
  });

  it("reads a typed count or amount, never more than is left", () => {
    const item = onions();
    expect(parseOther(item, "measure", "1½")).toEqual({ ok: true, state: { side: "measure", quantity: 1.5, qtyMilli: 225_000 } });
    expect(parseOther(item, "measure", "5")).toEqual({ ok: false, message: "Only ≈ 4 onions left" });
    expect(parseOther(item, "unit", "450")).toEqual({ ok: true, state: { side: "unit", quantity: 0, qtyMilli: 450_000 } });
    expect(parseOther(item, "unit", "700")).toMatchObject({ ok: false });
    expect(["2", "1.5", "1½", "½", ".5", "0", "1.25", "x"].map(parseCount)).toEqual([2, 1.5, 1.5, 0.5, 0.5, null, null, null]);
    expect([0.5, 1, 1.5, 12].map(countText)).toEqual(["½", "1", "1½", "12"]);
    expect([0.5, 2, 2.5].map(countDecimal)).toEqual(["0.5", "2", "2.5"]);
  });

  it("takes no more than the server would: the most of a measure is what measureTakeMilli allows", () => {
    expect(maxCount(onions(), onion)).toBe(4);
    expect(maxCount(onions({ left: "0.1" }), onion)).toBe(0.5);
    const lastSlices = bread({ left: "0.055" }, [slice]);
    expect(maxCount(lastSlices, slice)).toBe(1);
    expect(measureTakeMilli(1, slice, lastSlices)).toBe(55);
  });
});

describe("Use: reading a usual's words", () => {
  it("finds the measure and count back from '2 onions', '½ onion', '1½ onions'", () => {
    expect(parseLabel("2 onions", [onion])).toEqual({ measure: onion, quantity: 2 });
    expect(parseLabel("½ onion", [onion])).toEqual({ measure: onion, quantity: 0.5 });
    expect(parseLabel("1½ onions", [onion])).toEqual({ measure: onion, quantity: 1.5 });
    expect(parseLabel("2 onion", [onion])).toBeNull();
    expect(parseLabel("2 katoris", [onion])).toBeNull();
    expect(parseLabel(null, [onion])).toBeNull();
    expect(usualAmount(usual({ lastLabel: "1 onion" }), onions())).toMatchObject({ kind: "measure", qtyMilli: 150_000 });
    expect(usualAmount(usual({ lastQtyMilli: 700_000 }), onions())).toBeNull();
  });
});

/** A tiny cache over `qk` keys, as the optimistic tests use. */
class MemoryCache implements CacheLike {
  readonly rows: [CacheKey, unknown][] = [];
  constructor(rows: [CacheKey, unknown][]) {
    for (const [k, v] of rows) this.set(k, v);
  }
  entries(prefix: CacheKey) {
    return this.rows.filter(([k]) => prefix.every((p, i) => JSON.stringify(k[i]) === JSON.stringify(p)));
  }
  get(key: CacheKey) {
    return this.rows.find(([k]) => JSON.stringify(k) === JSON.stringify(key))?.[1];
  }
  set(key: CacheKey, data: unknown) {
    const at = this.rows.findIndex(([k]) => JSON.stringify(k) === JSON.stringify(key));
    if (at >= 0) this.rows[at] = [key, data];
    else this.rows.push([key, data]);
  }
}

describe("Use: the request and what shows at once", () => {
  it("sends a measure as its count and word, anything else in the unit", () => {
    const item = onions();
    const two = useTiles(item)[1]!;
    expect(quickUseRequest(item, two.amount, [ANU, ME], [ME, ANU], ME)).toEqual({ quantity: "2", measure: "onion", consumers: [ME, ANU] });
    expect(quickUseRequest(item, useTiles(item)[2]!.amount, [ME], [ME], ME)).toEqual({ quantity: "500", unit: "g", consumers: [ME] });
    expect(quickUseRequest(item, 450_000, [ME], [ME], ME)).toEqual({ quantity: "450", unit: "g", consumers: [ME] });
    expect(logRequest(eggs(), 1_500, [], { measure: { one: "half dozen" }, quantity: 0.5 })).toEqual({ quantity: "0.5", measure: "half dozen" });
  });

  it("takes off the stock what measureTakeMilli says, at the engine's cost", () => {
    const item = onions();
    const tile = useTiles(item)[1]!;
    expect(tile.amount.qtyMilli).toBe(measureTakeMilli(2, onion, item));
    const change: StockChange = { itemId: item.id, kind: "use", qtyMilli: tile.amount.qtyMilli, costMinor: 1200 };
    expect(change.costMinor).toBe(
      costOfUse({ priceMinor: 4000, qtyBoughtMilli: 1_000_000, qtyLeftMilli: 600_000, costTakenMinor: 1600 }, 300_000),
    );
    const cache = new MemoryCache([[qk.kitchenItem(`org:${FLAT.orgId}:${item.id}`), item]]);
    applyPatches(cache, stockPatches(change));
    expect(cache.get(qk.kitchenItem(`org:${FLAT.orgId}:${item.id}`))).toMatchObject({ qtyLeftMilli: 300_000, worthMinor: 1200 });
  });

  it("takes exactly what is left with the last slice, so a pack eaten by the slice costs what was paid", () => {
    // 16 slices a pack: each takes 63 thousandths, and the 16th the 55 left.
    const sixteen = { ...slice, count: 16 };
    const last = bread({ left: "0.055" }, [sixteen]);
    const tiles = useTiles(last);
    expect(tiles[0]).toMatchObject({ label: "The rest", amount: { qtyMilli: 55 } });
    expect(measureTakeMilli(1, sixteen, last)).toBe(55);
  });

  it("shows the words in the history row before the server answers", () => {
    const item = onions();
    const change: StockChange = { itemId: item.id, kind: "use", qtyMilli: 300_000, costMinor: 1200 };
    const move = pendingMove({ change, quantity: 0.3, unit: "kg", label: "2 onions", actor: ME, consumers: [ME, ANU], at: "2026-11-02T08:00:00.000Z" });
    expect(move).toMatchObject({ label: "2 onions", qtyMilli: 300_000, unit: "kg", quantity: 0.3 });
    expect(pendingMove({ change, quantity: 300, unit: "g", actor: ME, consumers: [ME], at: "2026-11-02T08:00:00.000Z" }).label).toBeNull();
  });

  it("logs a usual given in a measure in it again (Home, Pantry): words that name a measure taking exactly that much", () => {
    const item = onions();
    expect(countedWords(item, "2 onions", 300_000)).toEqual({ measure: onion, quantity: 2 });
    expect(countedWords(item, "2 onions", 250_000)).toBeNull();
    expect(countedWords({ ...milk(), measures: [{ id: "g", one: "glass", many: "glasses", count: 1, amountMilli: 200_000 }] }, "1 glass", 250_000)).toBeNull();
    const u: KitchenUsual = {
      itemId: item.id,
      name: "Onions",
      pantry: groupRef(FLAT),
      lastQtyMilli: 300_000,
      lastQuantity: 0.3,
      lastUnit: "kg",
      lastLabel: "2 onions",
      measures: [onion],
      consumers: [ME, ANU],
      usedCount: 3,
      lastUsedAt: "2026-11-01T08:00:00.000Z",
      qtyLeftMilli: 600_000,
    };
    const [row] = doItAgainRows([u], new Map([[item.id, item]]), { meId: ME, names: NAMES });
    expect(row).toMatchObject({ title: "Onions · 2 onions", words: "2 onions", qtyMilli: 300_000, measure: { measure: onion, quantity: 2 }, cost: money(1200) });
  });
});

describe("a saved measure shows at once (SM-5's pattern)", () => {
  const ref = (i: { id: string }) => `org:${FLAT.orgId}:${i.id}`;

  it("every cached read of that name in that pantry reads it — not another pantry's, nor another name", () => {
    const item = onions({}, []);
    const again = onions({}, []);
    const mine = { ...onions({ pantry: PERSONAL_REF }, []) };
    const garlic = { ...onions({ name: "Garlic" }, []) };
    const cache = new MemoryCache([
      [qk.kitchenItem(ref(item)), item],
      [qk.kitchenPantryItems("all"), { items: [item, again, mine, garlic], truncated: false }],
      [qk.kitchenSearch("on"), [item, mine]],
      [qk.kitchenUsuals(), [{ itemId: item.id, name: "onions ", pantry: groupRef(FLAT), lastUnit: "g", measures: [] }]],
    ]);
    const shown = pendingMeasures([measureInput("mass", { one: "onion", many: "onions" }, 150)], []);
    expect(shown[0]).toMatchObject({ one: "onion", count: 1, amountMilli: 150_000 });
    expect(shown[0]!.id).toMatch(/msr_/);
    const entries = applyPatches(cache, measuresPatches({ pantry: item.pantry, name: item.name, dimension: "mass" }, shown));
    expect((cache.get(qk.kitchenItem(ref(item))) as { measures: unknown[] }).measures).toEqual(shown);
    const all = (cache.get(qk.kitchenPantryItems("all")) as { items: { measures: unknown[] }[] }).items;
    expect(all.map((i) => i.measures.length)).toEqual([1, 1, 0, 0]);
    expect((cache.get(qk.kitchenSearch("on")) as { measures: unknown[] }[]).map((i) => i.measures.length)).toEqual([1, 0]);
    expect((cache.get(qk.kitchenUsuals()) as { measures: unknown[] }[])[0]!.measures).toEqual(shown);
    // The tiles switch to onions at once.
    expect(useTiles(cache.get(qk.kitchenItem(ref(item))) as typeof item)[0]!.label).toBe("1 onion");
    // Refused: exactly as before.
    expect(rollbackPatches(cache, entries)).toEqual([]);
    expect(cache.get(qk.kitchenItem(ref(item)))).toBe(item);
  });

  it("a word kept keeps its id", () => {
    const shown = pendingMeasures([{ one: "onion", many: "onions", count: 1, amountMilli: 100_000 }], [onion]);
    expect(shown).toEqual([{ id: "msr_onion", one: "onion", many: "onions", count: 1, amountMilli: 100_000 }]);
  });
});

describe("Cook: an ingredient in its measure or its unit", () => {
  const ctx = { meId: ME, names: NAMES, currency: "INR" };

  it("starts in the item's measure — 1 onion — and steps by one, ½ below one, out below ½", () => {
    const line = pantryLine(onions());
    expect(line).toMatchObject({ qtyMilli: 150_000, counted: { measure: onion, quantity: 1 } });
    const view = lineView(line, ctx);
    expect(view.counted).toMatchObject({ count: "1", word: "onion", max: 4 });
    expect(view.sides).toEqual({ measure: "onions", unit: "g", on: "measure" });
    expect(view.leftNote).toBe("≈ 150 g");
    const three = stepLineCount(stepLineCount(line, 1)!, 1)!;
    expect(three).toMatchObject({ qtyMilli: 450_000, counted: { quantity: 3 } });
    expect(lineView(three, ctx).leftNote).toBe("≈ 450 g");
    expect(lineView(three, ctx).costMinor).toBe(1800);
    const half = stepLineCount(line, -1)!;
    expect(half.counted?.quantity).toBe(0.5);
    expect(stepLineCount(half, -1)).toBeNull();
    // An item without a measure starts in its unit, with no switch.
    const plain = pantryLine(onions({}, []));
    expect(plain.counted ?? null).toBeNull();
    expect(lineView(plain, ctx).sides).toBeNull();
  });

  it("switches to grams and back with the same amount", () => {
    const three = countLine(pantryLine(onions()), onion, 3)!;
    const grams = switchLine(three, "unit");
    expect(grams).toMatchObject({ qtyMilli: 450_000, counted: null });
    expect(lineView(grams, ctx).sides?.on).toBe("unit");
    expect(lineView(grams, ctx).leftNote).toBe("150 g left");
    expect(switchLine(grams, "measure")).toMatchObject({ counted: { quantity: 3 }, qtyMilli: 450_000 });
  });

  it("sends a counted ingredient as its measure, the rest in the unit", () => {
    const three = countLine(pantryLine(onions()), onion, 3)!;
    const rice = pantryLine({ ...makeItem({ name: "Rice", unit: "kg", bought: "5", left: "3", priceMinor: 60000, paidBy: ME }), measures: [] });
    const request = cookRequest({ name: "Onion pakoda", lines: [three, rice], extrasMinor: 0, portionsHalf: 8, share: FLAT.orgId, mode: "claims" });
    expect(request.ingredients).toEqual([
      { itemId: three.item.id, quantity: "3", measure: "onion" },
      { itemId: rice.item.id, quantity: "400", unit: "g" },
    ]);
  });

  it("fills a recipe's amount in the measure when it divides evenly to a half, else in the unit", () => {
    const item = onions();
    expect(lineInEvenMeasure({ kind: "pantry", key: item.id, item, qtyMilli: 300_000 })).toMatchObject({ counted: { measure: onion, quantity: 2 } });
    expect(lineInEvenMeasure({ kind: "pantry", key: item.id, item, qtyMilli: 75_000 })).toMatchObject({ counted: { quantity: 0.5 } });
    expect(lineInEvenMeasure({ kind: "pantry", key: item.id, item, qtyMilli: 250_000 }).counted ?? null).toBeNull();
    const recipe: Recipe = {
      name: "Onion pakoda",
      times: 2,
      lastCookedAt: "2026-11-01T08:00:00.000Z",
      orgId: FLAT.orgId,
      portionsHalf: 8,
      extrasMinor: 0,
      totalMinor: 1800,
      currency: "INR",
      ingredients: [
        {
          name: "Onions",
          qtyMilli: 450_000,
          quantity: 450,
          unit: "g",
          dimension: "mass",
          pantry: null,
          match: { itemId: item.id, ref: `org:${FLAT.orgId}:${item.id}`, pantry: groupRef(FLAT), qtyLeftMilli: 600_000, canUse: true },
        },
      ],
    };
    const fill = recipeFill(recipe, { usable: new Map([[item.id, item]]), groups: [] });
    expect(fill.lines[0]).toMatchObject({ qtyMilli: 450_000, counted: { quantity: 3 } });
  });

  it("keeps the count when the item is read again, taking what it takes now; a measure gone puts it in the unit", () => {
    const line = countLine(pantryLine(onions()), onion, 2)!;
    const resized = { ...line.item, version: 2, measures: [{ ...onion, amountMilli: 100_000 }] };
    expect(refreshLines([line], new Map([[line.key, resized]]))[0]).toMatchObject({ qtyMilli: 200_000, counted: { quantity: 2 } });
    const gone = { ...line.item, version: 2, measures: [] };
    expect(refreshLines([line], new Map([[line.key, gone]]))[0]).toMatchObject({ qtyMilli: 300_000, counted: null });
    expect(withLeft([line], line.key, 200_000)[0]).toMatchObject({ qtyMilli: 200_000, counted: null });
  });
});

describe("Activity: a stock move reads its words", () => {
  it("is the history's row (the shared view model of an item's moves)", () => {
    const item = onions();
    const rows = historyRows(
      [
        { ...pendingMove({ change: { itemId: item.id, kind: "use", qtyMilli: 300_000, costMinor: 1200 }, quantity: 0.3, unit: "kg", label: "2 onions", actor: ANU, consumers: [ANU], at: "2026-11-02T08:00:00.000Z", id: "mov_1" }) },
        { ...pendingMove({ change: { itemId: item.id, kind: "use", qtyMilli: 100_000, costMinor: 400 }, quantity: 100, unit: "g", actor: DEV, consumers: [DEV], at: "2026-11-02T07:00:00.000Z", id: "mov_2" }) },
      ],
      { item, meId: ME, names: NAMES, now: new Date("2026-11-02T10:00:00.000Z") },
    );
    expect(rows.slice(0, 2).map((r) => [r.what, r.when])).toEqual([
      ["Anu · 2 onions", "300 g · 2 h ago"],
      ["Dev · 100 g", "3 h ago"],
    ]);
  });
});
