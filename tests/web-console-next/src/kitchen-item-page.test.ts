import { buildUse } from "@saas/kitchen-engine/ledger";
import type { KitchenStockMove, KitchenUsual } from "@saas/contracts/kitchen";
import {
  RUN_OUT_MIN_DAYS,
  RUN_OUT_MIN_USES,
  canUndoMove,
  checkMoveText,
  historyRows,
  runOutEstimate,
  shareText,
  whoHadIt,
  whoHadItLine,
} from "@web-console-next/components/kitchen/item-use";
import {
  QUICK_CHIP_STEPS,
  RING_COLORS,
  boughtAgainLine,
  boughtAgainTitle,
  buyAgainRefusal,
  buyLikeHref,
  canBuyAgain,
  canCheck,
  checkHref,
  chipMeasure,
  levelRing,
  quickChips,
  ringDash,
  ringTone,
} from "@web-console-next/components/kitchen/item-page";
import { itemRefOf } from "@web-console-next/components/kitchen/pantry";
import { itemLadder } from "@web-console-next/components/kitchen/pantry-set";
import { ANU, DEV, FLAT, ME, MEERA, NAMES, PERSONAL_REF, makeItem, makeMove } from "./kitchen-pantry-fixtures";

// cookpool-pantry PN-7 (design §5, the canvas's ItemPage): the new frame's
// item page — the level ring, the quick-use chips, "At this rate", who had
// it, history that names stock checks, and Bought again.

// Milk in Flat 4B: 2 L for ₹68, Meera paid; 1 L left, worth ₹34.
const milk = (o: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "2", left: "1", priceMinor: 6800, paidBy: MEERA, ...o });

const NOW = new Date("2026-11-02T12:00:00Z"); // a Monday
const use = (qtyMl: number, o: Partial<KitchenStockMove> = {}) =>
  makeMove({ kind: "use", qtyMilli: qtyMl * 1000, quantity: qtyMl, unit: "ml", costMinor: qtyMl * 34 / 10, actor: ME, consumers: [ME], ...o });

describe("at this rate (runOutEstimate)", () => {
  // Bought 31 Oct (2.5 days before NOW); two glasses since: 200 ml a day.
  const bought = { boughtOn: "2026-10-31" };
  const twoGlasses = [use(250), use(250)];

  it("needs 2 uses and 2 days", () => {
    expect([RUN_OUT_MIN_USES, RUN_OUT_MIN_DAYS]).toEqual([2, 2]);
    expect(runOutEstimate([use(250)], milk(bought), NOW)).toBeNull();
    expect(runOutEstimate(twoGlasses, milk({ boughtOn: "2026-11-01" }), NOW)).toBeNull();
    // An undone use is no use.
    expect(runOutEstimate([use(250), use(250, { undone: true })], milk(bought), NOW)).toBeNull();
    expect(runOutEstimate([use(250), use(250, { undone: true }), use(250)], milk(bought), NOW)).not.toBeNull();
  });

  it("names the weekday within 7 days, with the rate under it", () => {
    const e = runOutEstimate(twoGlasses, milk(bought), NOW)!;
    expect(e.days).toBeCloseTo(5);
    expect(e.at.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(e.when).toBe("Sat");
    expect(e.line).toBe("At this rate it runs out Sat");
    expect(e.rate).toBe("About 200 ml a day");
  });

  it("says today and tomorrow", () => {
    expect(runOutEstimate(twoGlasses, milk({ ...bought, left: "0.04" }), NOW)!.line).toBe("At this rate it runs out today");
    expect(runOutEstimate(twoGlasses, milk({ ...bought, left: "0.2" }), NOW)!.line).toBe("At this rate it runs out tomorrow");
  });

  it("says weeks after that", () => {
    // 400 ml in 2.5 days: 160 ml a day; 1.28 L lasts 8 days.
    expect(runOutEstimate([use(200), use(200)], milk({ ...bought, left: "1.28" }), NOW)!.line).toBe("At this rate it runs out in about a week");
    // 125 ml in 2.5 days: 50 ml a day; 1 L lasts 20 days.
    const slow = runOutEstimate([use(75), use(50)], milk(bought), NOW)!;
    expect(slow.line).toBe("At this rate it runs out in about 3 weeks");
    expect(slow.rate).toBe("About 50 ml a day");
  });

  it("counts dishes, and takes off what a stock check found still there", () => {
    expect(runOutEstimate([use(250), makeMove({ kind: "dish", qtyMilli: 250_000, unit: "ml", consumers: null })], milk(bought), NOW)!.when).toBe("Sat");
    // 500 ml logged, 250 ml of it still there: 100 ml a day, 10 days.
    const raised = runOutEstimate([makeMove({ kind: "adjust", qtyMilli: 250_000, unit: "ml", costMinor: 0, consumers: null, via: "check" }), ...twoGlasses], milk(bought), NOW)!;
    expect(raised.days).toBeCloseTo(10);
    expect(raised.when).toBe("in about a week");
    // An undone raise doesn't count.
    expect(runOutEstimate([makeMove({ kind: "adjust", qtyMilli: 250_000, unit: "ml", consumers: null, undone: true }), ...twoGlasses], milk(bought), NOW)!.when).toBe("Sat");
  });

  it("is never shown with a use-by inside it, nor once finished", () => {
    expect(runOutEstimate(twoGlasses, milk({ ...bought, expiresOn: "2026-11-05" }), NOW)).toBeNull();
    // A use-by the day it runs out is not inside it.
    expect(runOutEstimate(twoGlasses, milk({ ...bought, expiresOn: "2026-11-07" }), NOW)!.when).toBe("Sat");
    expect(runOutEstimate(twoGlasses, milk({ ...bought, expiresOn: "2026-10-30" }), NOW)).toBeNull();
    expect(runOutEstimate(twoGlasses, milk({ ...bought, left: "0" }), NOW)).toBeNull();
    expect(runOutEstimate(twoGlasses, milk({ ...bought, state: "used_up" }), NOW)).toBeNull();
  });

  it("says a rate too small for a day by the week", () => {
    // 100 g of cumin, 2 g in 2.5 days.
    const cumin = makeItem({ name: "Cumin", unit: "g", bought: "100", left: "98", boughtOn: "2026-10-31" });
    const pinch = (g: number) => makeMove({ kind: "use", qtyMilli: g * 1000, unit: "g" });
    const e = runOutEstimate([pinch(1), pinch(1)], cumin, NOW)!;
    expect(e.rate).toBe("About 5.6 g a week");
    expect(e.when).toBe("in about 18 weeks");
  });
});

describe("the level ring (levelRing)", () => {
  it("says what is left of what was bought, and its worth", () => {
    const ring = levelRing(milk(), { usual: null, meId: ME, names: NAMES });
    expect(ring).toEqual({
      percent: 50,
      left: "1 L",
      of: "of 2 L",
      worth: "₹34 left of ₹68",
      detail: "₹3.40 per 100 ml · Meera paid",
      tone: "ok",
      label: "50% left: 1 L of 2 L",
    });
    // Your own item has no "paid"; one that cost nothing no worth.
    const own = levelRing(milk({ pantry: PERSONAL_REF, priceMinor: 0 }), { usual: null, meId: ME });
    expect([own.detail, own.worth]).toEqual(["₹0.00 per 100 ml", null]);
    expect(levelRing(milk({ left: "0.25", worthMinor: 849 }), { meId: ME }).worth).toBe("₹8.49 left of ₹68");
  });

  it("is green, amber when running low or use soon, red once expired", () => {
    expect(RING_COLORS).toEqual({ ok: "#1F7A4D", low: "#D97706", expired: "#B42318" });
    expect(ringTone(milk())).toBe("ok");
    expect(ringTone(milk({ left: "0.3" }))).toBe("low");
    expect(ringTone(milk({ daysToUseBy: 1 }))).toBe("low");
    expect(ringTone(milk({ daysToUseBy: -1 }))).toBe("expired");
    // Under one usual amount is running low too.
    const usual = { lastQtyMilli: 1_500_000, lastUnit: "ml", consumers: [ME] };
    expect(ringTone(milk(), usual)).toBe("low");
    expect(ringTone(milk({ left: "0" }))).toBe("ok");
  });

  it("draws the ring as a share of its circle", () => {
    expect(ringDash(50, 40)).toBe("125.7 251.3");
    expect(ringDash(0, 40)).toBe("0.0 251.3");
    expect(ringDash(140, 40)).toBe("251.3 251.3");
  });
});

describe("the quick-use chips (quickChips)", () => {
  const usual = (o: Partial<KitchenUsual> = {}): KitchenUsual =>
    ({ itemId: "itm_1", lastQtyMilli: 250_000, lastUnit: "ml", lastLabel: null, consumers: [ME, ANU], ...o }) as KitchenUsual;

  it("leads with the suggestion and its reason, then the next two steps of the Pantry's ladder", () => {
    const item = milk();
    // PN-5's ladder: the Use screen's tiles and multiples of the suggestion, smallest first, then the rest.
    expect(itemLadder(item, null).steps.map((s) => [s.words, s.qtyMilli])).toEqual([
      ["½ glass", 125_000],
      ["1 glass", 250_000],
      ["2 glasses", 500_000],
      ["3 glasses", 750_000],
      ["1 L", 1_000_000],
    ]);
    const chips = quickChips(item, null);
    expect(QUICK_CHIP_STEPS).toBe(2);
    expect(chips.map((c) => [c.label, c.suggested, c.reason, c.why])).toEqual([
      ["1 glass", true, "first", null],
      ["2 glasses", false, null, null],
      ["3 glasses", false, null, null],
    ]);
    // The same suggestion as the Pantry's row.
    expect(chips[0]!.key).toBe(itemLadder(item, null).suggestion!.step.key);
    expect(quickChips(makeItem({ unit: "pcs", bought: "12", left: "7" }), null).map((c) => c.label)).toEqual(["1 pc", "2 pcs", "3 pcs"]);
  });

  it("suggests your usual for this part of the day, with its people", () => {
    const now = { bucket: "morning" as const, qtyMilli: 250_000, quantity: 250, unit: "ml", label: null, consumerIds: [ME, ANU], count: 3 };
    const chips = quickChips(milk(), usual({ now }));
    expect(chips[0]).toMatchObject({ label: "1 glass", qtyMilli: 250_000, reason: "usual_now", why: "Morning usual", consumerIds: [ME, ANU] });
    expect(chips.slice(1).map((c) => c.label)).toEqual(["2 glasses", "3 glasses"]);
    expect(quickChips(milk(), usual())[0]).toMatchObject({ label: "1 glass", why: "Your usual", reason: "usual", consumerIds: [ME, ANU] });
    expect(quickChips(milk({ daysToUseBy: 1 }), null)[0]!.why).toBe("Use soon");
  });

  it("offers the rest when little is left, with the two steps under it", () => {
    const item = milk({ left: "0.3" });
    const chips = quickChips(item, usual());
    // The rest, said as its amount, with why under it.
    expect(chips[0]).toMatchObject({ rest: true, label: "300 ml", words: "300 ml", reason: "rest", why: "The rest", qtyMilli: 300_000 });
    expect(chips.slice(1).every((c) => c.qtyMilli < 300_000)).toBe(true);
    expect(chips.slice(1).map((c) => c.qtyMilli)).toEqual([...chips.slice(1).map((c) => c.qtyMilli)].sort((a, b) => a - b));
  });

  it("never offers more than is left, and nothing once it's gone", () => {
    for (const left of ["0.01", "0.2", "0.3", "1", "1.9"]) {
      for (const c of quickChips(milk({ left }), usual())) expect(c.qtyMilli).toBeLessThanOrEqual(milk({ left }).qtyLeftMilli);
    }
    expect(quickChips(milk({ left: "0" }), usual())).toEqual([]);
  });

  it("logs a chip in the measure it names, else in the unit", () => {
    const onion = { one: "onion", many: "onions", qtyMilli: 150_000, dimension: "mass" } as never;
    expect(chipMeasure({ amount: { kind: "unit", qtyMilli: 250_000 } })).toBeNull();
    expect(chipMeasure({ amount: { kind: "measure", measure: onion, quantity: 2, qtyMilli: 300_000, label: "2 onions" } })).toEqual({ measure: onion, quantity: 2 });
  });
});

describe("who had it (whoHadIt)", () => {
  it("gives each person their part of what was used, largest first", () => {
    const moves = [
      use(300, { actor: ANU, consumers: [ANU], costMinor: 1020 }),
      use(200, { costMinor: 680 }),
      use(100, { actor: DEV, consumers: [DEV], costMinor: 340 }),
      // Not shares: an undone use, waste and a dish.
      use(500, { undone: true }),
      makeMove({ kind: "waste", qtyMilli: 100_000, unit: "ml", consumers: null }),
      makeMove({ kind: "dish", qtyMilli: 100_000, unit: "ml", consumers: null }),
    ];
    const rows = whoHadIt(moves, milk(), { meId: ME, names: NAMES });
    expect(rows.map((r) => [r.name, r.shareText, r.qtyText, r.costMinor])).toEqual([
      ["Anu", "½", "300 ml", 1020],
      ["You", "⅓", "200 ml", 680],
      ["Dev", "⅙", "100 ml", 340],
    ]);
    expect(whoHadItLine(rows)).toBe("Anu ½ · You ⅓ · Dev ⅙");
  });

  it("shares a use between the people who had it, its cost by the engine's split", () => {
    // A split stock check: 250 ml, ₹8.50, four ways — the odd paisa to the earliest.
    const split = use(250, { actor: ANU, consumers: [MEERA, ME, ANU, DEV], costMinor: 850, via: "check" });
    const rows = whoHadIt([split], milk(), { meId: ME, names: NAMES });
    const owed = new Map(buildUse({ costMinor: 850, buyerId: MEERA, consumers: [MEERA, ME, ANU, DEV] }).map((s) => [s.subjectId, s.owedMinor]));
    expect(rows.map((r) => r.costMinor).reduce((a, b) => a + b, 0)).toBe(850);
    for (const r of rows) {
      expect(r.costMinor).toBe(owed.get(r.subjectId));
      expect([r.shareText, r.qtyMilli]).toEqual(["¼", 62_500]);
    }
    // Among equals: you first, then by name.
    expect(rows.map((r) => r.name)).toEqual(["You", "Anu", "Dev", "Meera"]);
    // A use naming nobody is its logger's.
    expect(whoHadIt([use(100, { actor: DEV, consumers: null })], milk(), { meId: ME, names: NAMES })[0]).toMatchObject({ name: "Dev", shareText: "All" });
    expect(whoHadIt([], milk(), { meId: ME })).toEqual([]);
  });

  it("says a share as a simple fraction when it is one, else a percentage", () => {
    expect([1, 0.5, 1 / 3, 2 / 3, 0.25, 0.75, 0.2, 1 / 6, 0.125].map(shareText)).toEqual(["All", "½", "⅓", "⅔", "¼", "¾", "⅕", "⅙", "⅛"]);
    expect([0.45, 0.004, 0.14].map(shareText)).toEqual(["45%", "1%", "14%"]);
  });
});

describe("history names stock checks (the new frame)", () => {
  const item = milk();
  const ctx = { item, meId: ME, names: NAMES, now: NOW };
  const at = "2026-11-02T10:00:00.000Z";
  const check = (o: Partial<KitchenStockMove> & { kind: KitchenStockMove["kind"] }) =>
    makeMove({ qtyMilli: 250_000, quantity: 250, unit: "ml", actor: ANU, at, via: "check", ...o });

  it("reads each of a check's moves as the check, and who checked", () => {
    const split = check({ kind: "use", consumers: [MEERA, ME, ANU, DEV], costMinor: 850, txnId: "txn_1" });
    const mine = check({ kind: "use", consumers: [ANU], costMinor: 850 });
    const bad = check({ kind: "waste", consumers: null, costMinor: 850 });
    const more = check({ kind: "adjust", consumers: null, costMinor: 0 });
    const undid = makeMove({ kind: "reversal", qtyMilli: 250_000, unit: "ml", actor: ANU, at, consumers: null, reverses: split.id, costMinor: 0 });
    const rows = historyRows([undid, more, bad, mine, split], { ...ctx, stockChecks: true });
    expect(rows.slice(0, 5).map((r) => [r.what, r.when.replace(/ · .*$/, "").replace(/^\d+ h ago$/, "ago"), r.amount])).toEqual([
      ["Anu undid a stock check: 250 ml back", "ago", null],
      ["Stock check · 250 ml more than thought", "Anu", null],
      ["Stock check · 250 ml went bad", "Anu", "₹8.50"],
      ["Stock check · 250 ml used by Anu", "ago", "₹8.50"],
      ["Stock check · 250 ml split with Flat 4B", "Anu", "₹8.50"],
    ]);
    const undidRaise = makeMove({ kind: "reversal", qtyMilli: 250_000, unit: "ml", actor: ME, consumers: null, reverses: more.id, costMinor: 0 });
    expect(checkMoveText(undidRaise, { item, meId: ME, byId: new Map([[more.id, more]]) })!.what).toBe("You undid a stock check: 250 ml off");
    expect(checkMoveText(check({ kind: "use", actor: ME, consumers: [ME] }), { item, meId: ME, names: NAMES })).toEqual({ what: "Stock check · 250 ml used by you", by: null });
    // In the item's own unit, whatever unit the check sent.
    expect(checkMoveText(check({ kind: "adjust", qtyMilli: 1_750_000, unit: "ml", consumers: null, costMinor: 0 }), { item, meId: ME })!.what).toBe("Stock check · 1.75 L more than thought");
    // Your own item's check is always yours.
    expect(checkMoveText(check({ kind: "use", actor: ME, consumers: null }), { item: milk({ pantry: PERSONAL_REF }), meId: ME })!.what).toBe("Stock check · 250 ml used by you");
    // Anything else is not a check.
    expect(checkMoveText(use(250), { item, meId: ME })).toBeNull();
  });

  it("with newFrame false, reads every row exactly as before", () => {
    const moves = [
      check({ kind: "adjust", consumers: null, costMinor: 0 }),
      check({ kind: "use", consumers: [MEERA, ME, ANU, DEV], costMinor: 850 }),
      check({ kind: "waste", consumers: null, costMinor: 850 }),
    ];
    const plain = moves.map(({ via: _via, ...m }) => m as KitchenStockMove);
    expect(historyRows(moves, ctx)).toEqual(historyRows(plain, ctx));
    const rows = historyRows(moves, ctx);
    expect([rows[0]!.what, rows[2]!.what]).toEqual(["Anu adjusted it by 250 ml", "Anu marked 250 ml wasted"]);
    expect(rows[1]!.what).not.toMatch(/Stock check/);
    expect(rows.every((r) => !/^Anu · /.test(r.when))).toBe(true);
  });

  it("lets a check's raise be undone in the new frame only, whatever came after", () => {
    const raise = check({ kind: "adjust", actor: ME, consumers: null, costMinor: 0 });
    const later = use(100, { at: "2026-11-02T11:00:00.000Z" });
    const moves = [later, raise];
    const can = { meId: ME, personal: false, role: "member" as const, canWrite: true };
    expect(canUndoMove(raise, moves, can)).toBe(false);
    expect(canUndoMove(raise, moves, { ...can, adjusts: true })).toBe(true);
    // Someone else's: an owner or admin only.
    const theirs = check({ kind: "adjust", actor: ANU, consumers: null, costMinor: 0 });
    expect(canUndoMove(theirs, [theirs], { ...can, adjusts: true })).toBe(false);
    expect(canUndoMove(theirs, [theirs], { ...can, role: "admin", adjusts: true })).toBe(true);
    expect(canUndoMove({ ...raise, undone: true }, moves, { ...can, adjusts: true })).toBe(false);
    expect(canUndoMove(raise, moves, { ...can, canWrite: false, adjusts: true })).toBe(false);
    expect(canUndoMove(raise, moves, { ...can, personal: true, meId: DEV, adjusts: true })).toBe(true);
  });
});

describe("the actions", () => {
  const item = milk({ id: "itm_00000000000000000000000000000milk", boughtOn: "2026-10-28", expiresOn: "2026-11-04" });
  const ref = itemRefOf(item);

  it("Bought again buys one line like last time", () => {
    expect(boughtAgainLine(item, "2026-11-08")).toEqual({
      pantry: FLAT.orgId,
      name: "Milk",
      category: "dairy",
      quantity: "2",
      unit: "L",
      priceMinor: 6800,
      currency: "INR",
      fromItemId: item.id,
      // A week's use-by, a week from today.
      expiresOn: "2026-11-15",
    });
    const own = boughtAgainLine(milk({ pantry: PERSONAL_REF, unit: "g", bought: "500", left: "0", priceMinor: 4500 }), "2026-11-08");
    expect(own).toMatchObject({ pantry: "personal", quantity: "500", unit: "g", priceMinor: 4500 });
    expect(own).not.toHaveProperty("expiresOn");
    expect(boughtAgainTitle(item)).toBe("Bought Milk · ₹68");
    expect(boughtAgainTitle(milk({ priceMinor: 4550 }))).toBe("Bought Milk · ₹45.50");
  });

  it("goes where it should", () => {
    expect(checkHref(ref)).toBe(`/pantry/org:${FLAT.orgId}:${item.id}/check`);
    expect(buyLikeHref(ref)).toBe(`/pantry/new?from=org%3A${FLAT.orgId}%3A${item.id}`);
    expect(buyLikeHref({ kind: "personal", itemId: "itm_1" })).toBe("/pantry/new?from=me%3Aitm_1");
  });

  it("shows Bought again and Fix to whoever may change the pantry, finished items included", () => {
    expect([canBuyAgain(item, true), canCheck(item, true)]).toEqual([true, true]);
    expect([canBuyAgain(item, false), canCheck(item, false)]).toEqual([false, false]);
    expect([canBuyAgain({ state: "used_up" }, true), canCheck({ state: "wasted" }, true)]).toEqual([true, true]);
    expect([canBuyAgain({ state: "removed" }, true), canCheck({ state: "removed" }, true)]).toEqual([false, false]);
  });

  it("says why Bought again was refused", () => {
    expect(buyAgainRefusal({ code: "validation_failed", message: "x", details: { fields: { "lines[0].pantry": "Must be a pantry you can add to" } } }, item)).toBe("You can't add to Flat 4B any more.");
    expect(buyAgainRefusal({ code: "validation_failed", reason: "currency_mismatch", message: "x", details: { currency: "USD" } }, item)).toBe("Flat 4B counts in USD now.");
    expect(buyAgainRefusal({ code: "internal", message: "Boom" }, item)).toBe("Boom");
  });
});
