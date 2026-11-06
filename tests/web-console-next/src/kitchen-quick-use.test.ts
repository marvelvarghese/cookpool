import type { KitchenUsual, PantryRef } from "@saas/contracts/kitchen";
import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import { buildUse } from "@saas/kitchen-engine/ledger";
import { formatQuantity } from "@saas/kitchen-engine/units";
import { shareBreakdown } from "@web-console-next/components/kitchen/item-use";
import { itemRowView, quickUseHref } from "@web-console-next/components/kitchen/pantry";
import {
  DO_IT_AGAIN_ROWS,
  KITCHEN_MEASURES,
  MAX_PRESETS,
  amountPresets,
  amountWords,
  defaultConsumers,
  defaultPreset,
  doItAgainRows,
  leftAndPayer,
  matchCard,
  matchesHeading,
  quickLogLabel,
  quickUseRequest,
  usableMatches,
  usualCard,
  usualFor,
  usualRef,
  usualsThatFit,
} from "@web-console-next/components/kitchen/quick-use";
import { ANU, DEV, FLAT, LUNCH, ME, MEERA, NAMES, PERSONAL_REF, groupRef, makeItem } from "./kitchen-pantry-fixtures";

// Milk in Flat 4B: 1 L for ₹68.00, Meera paid; all of it left.
const milk = (patch: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ name: "Milk", unit: "L", bought: "1", left: "1", priceMinor: 6800, paidBy: MEERA, category: "dairy", ...patch });
// Eggs in your own pantry: 12 for ₹84.00, 7 left.
const eggs = (patch: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ name: "Eggs", pantry: PERSONAL_REF, unit: "pcs", bought: "12", left: "7", priceMinor: 8400, paidBy: ME, ...patch });
// Basmati rice in Flat 4B: 5 kg for ₹620.00, 3.2 kg left.
const rice = () => makeItem({ name: "Basmati rice", unit: "kg", bought: "5", left: "3.2", priceMinor: 62000, paidBy: ANU });
// Biscuits in Flat 4B: 4 packs for ₹120.00, 3 left.
const biscuits = () => makeItem({ name: "Biscuits", unit: "pack", bought: "4", left: "3", priceMinor: 12000, paidBy: DEV });

let usualSeq = 0;
function makeUsual(o: Partial<KitchenUsual> & { pantry?: PantryRef } = {}): KitchenUsual {
  usualSeq += 1;
  return {
    itemId: `itm_${String(9000 + usualSeq).padStart(32, "0")}`,
    name: "Milk",
    pantry: groupRef(FLAT),
    lastQtyMilli: 250_000,
    lastQuantity: 250,
    lastUnit: "ml",
    consumers: [ME, ANU],
    usedCount: 6,
    lastUsedAt: "2026-11-01T08:00:00.000Z",
    qtyLeftMilli: 1_000_000,
    ...o,
  };
}

describe("how much: presets per dimension", () => {
  it("offers a glass, half a glass and a splash of something you pour, then the rest", () => {
    const presets = amountPresets(milk());
    expect(presets.map((p) => [p.label, p.amount])).toEqual([
      ["1 glass", "250 ml"],
      ["½ glass", "125 ml"],
      ["A splash", "50 ml"],
      ["The rest", "1 L"],
    ]);
    expect(presets.map((p) => p.qtyMilli)).toEqual([250_000, 125_000, 50_000, 1_000_000]);
    expect(presets.map((p) => p.words)).toEqual(["1 glass", "½ glass", "a splash", "1 L"]);
    expect(presets.some((p) => p.usual)).toBe(false);
    expect(defaultPreset(presets)?.label).toBe("1 glass");
  });

  it("offers weights of something you weigh — no guessed cup or spoon (SM-14) — then the rest", () => {
    expect(amountPresets(rice()).map((p) => [p.label, p.amount])).toEqual([
      ["100 g", "100 g"],
      ["250 g", "250 g"],
      ["½ kg", "500 g"],
      ["The rest", "3.2 kg"],
    ]);
  });

  it("counts pieces one, two, three, then the rest; packs a half, one, then the rest", () => {
    expect(amountPresets(eggs()).map((p) => [p.label, p.amount])).toEqual([
      ["1 pc", "1 pc"],
      ["2 pcs", "2 pcs"],
      ["3 pcs", "3 pcs"],
      ["The rest", "7 pcs"],
    ]);
    expect(amountPresets(biscuits()).map((p) => [p.label, p.amount])).toEqual([
      ["½ pack", "0.5 packs"],
      ["1 pack", "1 pack"],
      ["The rest", "3 packs"],
    ]);
  });

  it("puts your usual first, marked and chosen — 'your usual n, 1, 3, the rest' for things you count", () => {
    const presets = amountPresets(eggs(), 2_000);
    expect(presets.map((p) => p.label)).toEqual(["2 pcs", "1 pc", "3 pcs", "The rest"]);
    expect(presets.map((p) => p.usual)).toEqual([true, false, false, false]);
    expect(defaultPreset(presets)?.qtyMilli).toBe(2_000);
  });

  it("names a usual that is a measure by the measure, and any other by its amount", () => {
    const half = amountPresets(milk(), 125_000);
    expect(half.map((p) => p.label)).toEqual(["½ glass", "1 glass", "A splash", "The rest"]);
    expect(half[0]!.usual).toBe(true);
    const odd = amountPresets(milk(), 200_000);
    expect(odd.map((p) => [p.label, p.usual])).toEqual([
      ["200 ml", true],
      ["1 glass", false],
      ["½ glass", false],
      ["The rest", false],
    ]);
  });

  it("never offers more than is left: smaller measures step in, and the rest closes the row", () => {
    const low = amountPresets(milk({ left: "0.1" }));
    expect(low.map((p) => [p.label, p.amount])).toEqual([
      ["A splash", "50 ml"],
      ["A spoon", "15 ml"],
      ["The rest", "100 ml"],
    ]);
    expect(amountPresets(eggs({ left: "1" })).map((p) => [p.label, p.amount])).toEqual([["The rest", "1 pc"]]);
    expect(amountPresets(milk({ left: "0" }))).toEqual([]);
  });

  it("drops a usual that no longer fits, and marks the rest when the usual is exactly what is left", () => {
    const tooMuch = amountPresets(milk({ left: "0.2" }), 250_000);
    expect(tooMuch.some((p) => p.usual)).toBe(false);
    expect(tooMuch.map((p) => p.label)).toEqual(["½ glass", "A splash", "A spoon", "The rest"]);
    const exact = amountPresets(milk({ left: "0.25" }), 250_000);
    expect(exact[exact.length - 1]).toMatchObject({ rest: true, usual: true, amount: "250 ml" });
    expect(defaultPreset(exact)?.rest).toBe(true);
  });

  it("always shows at most four tiles, each once, the last being everything left, and amounts by the engine", () => {
    for (const item of [milk(), rice(), eggs(), biscuits(), milk({ left: "0.3" })]) {
      for (const usual of [null, 1_000, 125_000, 200_000, 260_000]) {
        const presets = amountPresets(item, usual);
        expect(presets.length).toBeLessThanOrEqual(MAX_PRESETS);
        expect(new Set(presets.map((p) => p.qtyMilli)).size).toBe(presets.length);
        expect(presets[presets.length - 1]).toMatchObject({ rest: true, qtyMilli: item.qtyLeftMilli });
        for (const p of presets) {
          expect(p.qtyMilli).toBeGreaterThan(0);
          expect(p.qtyMilli).toBeLessThanOrEqual(item.qtyLeftMilli);
          expect(p.amount).toBe(formatQuantity(p.qtyMilli, item.dimension));
        }
        expect(presets.filter((p) => p.usual).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("knows every measure by name, and other amounts by the engine", () => {
    expect(amountWords(250_000, "volume")).toBe("1 glass");
    expect(amountWords(200_000, "mass")).toBe("200 g");
    expect(amountWords(500_000, "mass")).toBe("½ kg");
    expect(amountWords(300_000, "volume")).toBe("300 ml");
    expect(amountWords(2_000, "count")).toBe("2 pcs");
    expect(amountWords(1_500_000, "volume")).toBe("1.5 L");
    for (const list of Object.values(KITCHEN_MEASURES)) {
      expect(new Set(list.map((m) => m.qtyMilli)).size).toBe(list.length);
    }
  });
});

describe("who had it, to start with", () => {
  const roster = [ME, ANU, DEV, MEERA];

  it("is the people of your last use who are still in the group", () => {
    expect(defaultConsumers({ consumers: [ME, ANU] }, roster, ME)).toEqual([ME, ANU]);
    expect(defaultConsumers({ consumers: [ANU, "usr_00000000000000000000000000000gone"] }, roster, ME)).toEqual([ANU]);
  });

  it("is just you without a usual, or when everyone of it has left", () => {
    expect(defaultConsumers(null, roster, ME)).toEqual([ME]);
    expect(defaultConsumers({ consumers: ["usr_00000000000000000000000000000gone"] }, roster, ME)).toEqual([ME]);
  });

  it("keeps your usual people while the group's members load", () => {
    expect(defaultConsumers({ consumers: [ME, ANU] }, null, ME)).toEqual([ME, ANU]);
  });
});

describe("the Log button and the request", () => {
  it("says the amount and what it costs: 'Log 1 glass · ₹17.00'", () => {
    const item = milk();
    const cost = costOfUse({ priceMinor: 6800, qtyBoughtMilli: 1_000_000, qtyLeftMilli: 1_000_000, costTakenMinor: 0 }, 250_000);
    expect(cost).toBe(1700);
    expect(quickLogLabel({ words: "1 glass", costMinor: cost, currency: item.currency, consumers: [ME, ANU] })).toBe(
      `Log 1 glass · ${formatMinor(1700)}`,
    );
    expect(quickLogLabel({ words: "2 pcs", costMinor: 1400, currency: "INR", consumers: null })).toBe(`Log 2 pcs · ${formatMinor(1400)}`);
  });

  it("asks for who had it, or how much, before it can log", () => {
    expect(quickLogLabel({ words: "1 glass", costMinor: 1700, currency: "INR", consumers: [] })).toBe("Pick who had it");
    expect(quickLogLabel({ words: null, costMinor: null, currency: "INR", consumers: [ME] })).toBe("Enter how much");
  });

  it("sends a group use in the base unit, you first, then the group's order", () => {
    const item = milk();
    const roster = [MEERA, ANU, ME, DEV];
    expect(quickUseRequest(item, 250_000, new Set([ANU, ME]), roster, ME)).toEqual({
      quantity: "250",
      unit: "ml",
      consumers: [ME, ANU],
    });
    expect(quickUseRequest(item, item.qtyLeftMilli, [DEV, ANU], roster, ME)).toEqual({
      quantity: "1000",
      unit: "ml",
      consumers: [ANU, DEV],
    });
    expect(quickUseRequest(rice(), 200_000, [ME], [ME], ME)).toEqual({ quantity: "200", unit: "g", consumers: [ME] });
    expect(quickUseRequest(biscuits(), 500, [ME], [ME], ME)).toEqual({ quantity: "0.5", unit: "pack", consumers: [ME] });
  });

  it("names nobody for your own pantry's item", () => {
    expect(quickUseRequest(eggs(), 2_000, [ME, ANU], [], ME)).toEqual({ quantity: "2", unit: "pcs" });
  });

  it("previews who owes whom the way the server splits it", () => {
    const item = milk();
    const consumers = [ME, ANU];
    const b = shareBreakdown({ item, qtyMilli: 250_000, consumers, meId: ME, names: NAMES });
    expect(b.costMinor).toBe(1700);
    expect(b.lines.map((l) => [l.text, l.amountMinor])).toEqual([
      ["You owe Meera", 850],
      ["Anu owes Meera", 850],
    ]);
    const splits = buildUse({ costMinor: 1700, buyerId: MEERA, consumers });
    expect(b.lines.map((l) => l.amountMinor)).toEqual(consumers.map((c) => splits.find((s) => s.subjectId === c)!.owedMinor));
  });
});

describe("picking the item: the strip and search", () => {
  it("shows a usual as its pantry, your usual amount and what is left", () => {
    const card = usualCard(makeUsual({ qtyLeftMilli: 750_000 }))!;
    expect(card).toMatchObject({ name: "Milk", pantry: "Flat 4B", sub: "Usually 1 glass", meta: "750 ml left", item: null });
    expect(card.ref).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: card.key });
    const own = usualCard(makeUsual({ name: "Eggs", pantry: PERSONAL_REF, lastQtyMilli: 2_000, lastUnit: "pcs", qtyLeftMilli: 7_000 }))!;
    expect(own).toMatchObject({ pantry: "Personal", sub: "Usually 2 pcs", meta: "7 pcs left" });
    expect(own.ref).toEqual({ kind: "personal", itemId: own.key });
    expect(usualCard(makeUsual({ lastUnit: "bushel" }))).toBeNull();
  });

  it("shows a match as how much is left and who paid — by name", () => {
    const item = milk({ left: "0.6" });
    const card = matchCard(item, { meId: ME, names: NAMES });
    expect(card).toMatchObject({ name: "Milk", pantry: "Flat 4B", sub: "600 ml left · Meera paid", item });
    expect(leftAndPayer(eggs(), ME, NAMES)).toBe("7 pcs left · you paid");
    expect(leftAndPayer(milk({ paidBy: "usr_00000000000000000000000000009e9e" }), ME, NAMES)).toBe("1 L left · Member · 9e9e paid");
  });

  it("offers only what you may use, with something left", () => {
    const usable = milk();
    const viewers = milk({ pantry: groupRef(LUNCH), canUse: false });
    const gone = milk({ left: "0", state: "used_up" });
    expect(usableMatches([usable, viewers, gone])).toEqual([usable]);
  });

  it("counts matches across your pantries", () => {
    expect(matchesHeading(3)).toBe("3 matches across your pantries");
    expect(matchesHeading(1)).toBe("1 match across your pantries");
  });

  it("finds your usual of an item", () => {
    const u = makeUsual();
    expect(usualFor(u.itemId, [makeUsual(), u])).toBe(u);
    expect(usualFor("itm_none", [u])).toBeNull();
    expect(usualFor(u.itemId, null)).toBeNull();
    expect(usualRef(u)).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: u.itemId });
  });

  it("opens from a pantry row's Use with the item chosen", () => {
    const item = milk();
    expect(quickUseHref(item)).toBe(`/use?item=org:${FLAT.orgId}:${item.id}`);
    expect(quickUseHref({ kind: "personal", itemId: "itm_1" })).toBe("/use?item=me:itm_1");
    expect(itemRowView(item, { meId: ME, names: NAMES }).useHref).toBe(quickUseHref(item));
  });
});

describe("Do it again (the + Add sheet)", () => {
  it("reads 'Milk · 1 glass — Flat 4B · you and Anu · ₹17.00' and logs that again", () => {
    const item = milk();
    const usual = makeUsual({ itemId: item.id });
    const [row] = doItAgainRows([usual], new Map([[item.id, item]]), { meId: ME, names: NAMES });
    expect(row).toMatchObject({
      title: "Milk · 1 glass",
      meta: "Flat 4B · you and Anu",
      cost: formatMinor(1700),
      qtyMilli: 250_000,
      words: "1 glass",
      consumers: [ME, ANU],
      item,
    });
    expect(row!.label).toBe(`Log 1 glass of Milk for you and Anu in Flat 4B, ${formatMinor(1700)}`);
    expect(row!.ref).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: item.id });
  });

  it("says 'you' when you had it alone, and names nobody for your own pantry", () => {
    const item = milk();
    const alone = doItAgainRows([makeUsual({ itemId: item.id, consumers: [ME] })], new Map([[item.id, item]]), { meId: ME, names: NAMES });
    expect(alone[0]!.meta).toBe("Flat 4B · you");
    const own = eggs();
    const usual = makeUsual({ itemId: own.id, name: "Eggs", pantry: PERSONAL_REF, lastQtyMilli: 2_000, lastUnit: "pcs", consumers: [ME], qtyLeftMilli: 7_000 });
    const [row] = doItAgainRows([usual], new Map([[own.id, own]]), { meId: ME, names: NAMES });
    expect(row).toMatchObject({ title: "Eggs · 2 pcs", meta: "Personal", consumers: [] });
    expect(row!.label).toBe(`Log 2 pcs of Eggs from your pantry, ${row!.cost}`);
  });

  it("costs it on the item as it is now — the last of it costs what is left of the price", () => {
    const item = milk({ left: "0.25", worthMinor: 1500 });
    const [row] = doItAgainRows([makeUsual({ itemId: item.id, qtyLeftMilli: 250_000 })], new Map([[item.id, item]]), { meId: ME });
    expect(row!.cost).toBe(formatMinor(1500));
  });

  it("waits for the item without a cost, and leaves out one that can't be read", () => {
    const loading = makeUsual();
    const gone = makeUsual();
    const rows = doItAgainRows([loading, gone], new Map([[gone.itemId, null]]), { meId: ME, names: NAMES });
    expect(rows.map((r) => r.key)).toEqual([loading.itemId]);
    expect(rows[0]).toMatchObject({ cost: null, item: null, title: "Milk · 1 glass" });
    expect(rows[0]!.label).toBe("Log 1 glass of Milk for you and Anu in Flat 4B");
  });

  it("hides a usual whose amount no longer fits what is left, or whose item is used up — the next takes its place", () => {
    const short = milk({ left: "0.2" });
    const usedUp = milk({ left: "0", state: "used_up" });
    const fits = [1, 2, 3, 4, 5].map(() => milk());
    const usuals = [
      makeUsual({ itemId: short.id }),
      makeUsual({ itemId: usedUp.id }),
      makeUsual({ name: "Stale read", qtyLeftMilli: 100_000 }),
      ...fits.map((i) => makeUsual({ itemId: i.id })),
    ];
    const items = new Map([short, usedUp, ...fits].map((i) => [i.id, i] as const));
    const rows = doItAgainRows(usuals, items, { meId: ME, names: NAMES });
    expect(rows).toHaveLength(DO_IT_AGAIN_ROWS);
    expect(rows.map((r) => r.key)).toEqual(fits.slice(0, DO_IT_AGAIN_ROWS).map((i) => i.id));
  });

  it("reads items only for usuals that still fit", () => {
    const fit = makeUsual();
    const over = makeUsual({ lastQtyMilli: 500_000, qtyLeftMilli: 300_000 });
    const odd = makeUsual({ lastUnit: "bushel" });
    expect(usualsThatFit([fit, over, odd])).toEqual([fit]);
  });

  it("never shows a raw id", () => {
    const item = milk();
    const stranger = "usr_00000000000000000000000000009e9e";
    const [row] = doItAgainRows([makeUsual({ itemId: item.id, consumers: [stranger, ME] })], new Map([[item.id, item]]), { meId: ME, names: NAMES });
    expect(row!.meta).toBe("Flat 4B · you and Member · 9e9e");
    expect(`${row!.title} ${row!.meta} ${row!.label}`).not.toMatch(/usr_/);
  });
});
