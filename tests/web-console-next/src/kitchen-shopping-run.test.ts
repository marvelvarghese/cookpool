import type { RestockResponse } from "@saas/contracts/kitchen";
import {
  RUN_GROUPS,
  buyLadder,
  everyText,
  likeLastTime,
  pantryPick,
  pricePick,
  runGroups,
  runLines,
  runSummary,
  runToast,
  runWhy,
  scaledPrice,
  startStep,
  stepPick,
  tickedLine,
  toggleTick,
  type RunLine,
  type RunPicks,
} from "@web-console-next/components/kitchen/shopping-run";
import { FLAT, LUNCH, PERSONAL_REF, TRIP, groupPantry, groupRef, personalPantry } from "./kitchen-pantry-fixtures";
import { NOW, TODAY, at, finished, last, runningLow, usual } from "./kitchen-restock-fixtures";

// cookpool-pantry PN-6: the shopping run (/pantry/run) as a pure model.

const ctx = { now: NOW, today: TODAY };
const pantries = [personalPantry(), groupPantry(FLAT), groupPantry(LUNCH), groupPantry(TRIP, { currency: "USD" })];

const BREAD = finished({ name: "Bread", last: last({ unit: "pcs", qty: "1", priceMinor: 4500, itemId: "itm_bread1" }) });
const BUTTER = finished({ name: "Butter", how: "wasted", at: at(4), category: "dairy", last: last({ unit: "g", qty: "100", priceMinor: 5600, itemId: "itm_butter1", expiresAfterDays: null }) });
const ATTA = runningLow({ name: "Atta", left: 600_000, last: last({ unit: "kg", qty: "5", priceMinor: 24500, itemId: "itm_atta1", wastePolicy: "buyer_absorbs", expiresAfterDays: 60 }) });
const SAFFRON = runningLow({ name: "Saffron", pantry: groupRef(LUNCH), canAdd: false, left: 200, last: last({ unit: "g", qty: "1", priceMinor: 30000, itemId: "itm_saff1" }) });
const MILK = usual({ name: "Milk", category: "dairy", everyDays: 4, lastBoughtAt: "2026-11-01", last: last({ unit: "L", qty: "2", priceMinor: 13600, itemId: "itm_milk1", expiresAfterDays: 3 }) });
const EGGS = usual({ name: "Eggs", pantry: PERSONAL_REF, everyDays: 7, lastBoughtAt: "2026-10-27", category: "protein", last: last({ unit: "pcs", qty: "12", priceMinor: 8400, itemId: "itm_eggs1", expiresAfterDays: 14 }) });
const RESTOCK: RestockResponse = { finished: [BREAD, BUTTER], runningLow: [ATTA, SAFFRON], usual: [MILK, EGGS] };

const groups = runGroups(RESTOCK, ctx);
const lines = runLines(groups);
const lineOf = (name: string): RunLine => lines.find((l) => l.name === name)!;
const tick = (picks: RunPicks, ...names: string[]) => names.reduce((p, n) => toggleTick(p, lineOf(n)), picks);

describe("the run's groups", () => {
  it("are FINISHED, RUNNING LOW and YOU USUALLY BUY, in the server's order inside each, empty ones left out", () => {
    expect(RUN_GROUPS.map((g) => g.title)).toEqual(["FINISHED", "RUNNING LOW", "YOU USUALLY BUY"]);
    expect(groups.map((g) => [g.title, g.lines.map((l) => l.name)])).toEqual([
      ["FINISHED", ["Bread", "Butter"]],
      ["RUNNING LOW", ["Atta", "Saffron"]],
      ["YOU USUALLY BUY", ["Milk", "Eggs"]],
    ]);
    expect(runGroups({ finished: [], runningLow: [ATTA], usual: [] }, ctx).map((g) => g.id)).toEqual(["running_low"]);
    expect(runGroups(null, ctx)).toEqual([]);
  });

  it("say each line like last time until ticked, and its why", () => {
    expect(lineOf("Milk").like).toBe("Like last time: 2 L · ₹136 · Flat 4B");
    expect(lineOf("Eggs").like).toBe("Like last time: 12 pcs · ₹84 · Me");
    expect(likeLastTime(BUTTER)).toBe("Like last time: 100 g · ₹56 · Flat 4B");
    expect(lineOf("Bread").why).toBe("Finished Tue");
    expect(lineOf("Butter").why).toBe("Went bad yesterday");
    expect(lineOf("Atta").why).toBe("600 g of 5 kg left");
    expect(lineOf("Milk").why).toBe("Every 4 days · last Sun");
    expect(lineOf("Eggs").why).toBe("Every week · last 27 Oct");
    expect(runWhy(usual({ everyDays: 1, lastBoughtAt: "2026-11-04" }), ctx)).toBe("Every day · yesterday");
    expect([1, 3, 7, 14, 21, 10].map(everyText)).toEqual(["Every day", "Every 3 days", "Every week", "Every 2 weeks", "Every 3 weeks", "Every 10 days"]);
  });

  it("can't tick a line in a pantry you only view", () => {
    const saffron = lineOf("Saffron");
    expect(saffron.tickable).toBe(false);
    expect(saffron.locked).toBe("You only view Lunch club");
    expect(toggleTick({}, saffron)).toEqual({});
    expect(lineOf("Bread").locked).toBeNull();
  });
});

describe("ticking a line", () => {
  it("ticks nothing to start with, and the footer asks for a tick", () => {
    const s = runSummary(lines, {}, { pantries, today: TODAY });
    expect(s).toMatchObject({ count: 0, label: "Tick what you bought", ready: false, problem: null, request: null });
  });

  it("starts at last time's amount, price and pantry; ticking again unticks", () => {
    const picks = tick({}, "Milk");
    expect(picks[lineOf("Milk").key]).toEqual({ step: "u:2000000", price: null, pantry: FLAT.orgId });
    const t = tickedLine(lineOf("Milk"), picks[lineOf("Milk").key]!, { pantries, today: TODAY });
    expect(t).toMatchObject({ priceText: "136", priceMinor: 13600, currency: "INR", prefix: "₹", pantryLabel: "Flat 4B", canLess: true, canMore: true });
    expect(t.step.words).toBe("2 L");
    expect(tick(picks, "Milk")).toEqual({});
  });

  it("steps through the last amount's ladder: half when it is whole, then ×2 …", () => {
    expect(buyLadder(MILK.last).map((s) => s.words)).toEqual(["1 L", "2 L", "4 L", "6 L", "8 L", "10 L", "12 L", "14 L"]);
    expect(buyLadder(EGGS.last).map((s) => s.words).slice(0, 3)).toEqual(["6 pcs", "12 pcs", "24 pcs"]);
    // One loaf has no half; 100 g has 50 g.
    expect(buyLadder(BREAD.last).map((s) => s.words).slice(0, 3)).toEqual(["1 pc", "2 pcs", "3 pcs"]);
    expect(buyLadder(BUTTER.last)[0]!.words).toBe("50 g");
    expect(startStep(ATTA.last)!.words).toBe("5 kg");

    let picks = tick({}, "Bread");
    const bread = lineOf("Bread");
    const at0 = tickedLine(bread, picks[bread.key]!, { pantries, today: TODAY });
    expect([at0.canLess, at0.canMore]).toEqual([false, true]);
    expect(stepPick(picks, bread, -1)).toBe(picks);
    picks = stepPick(picks, bread, 1);
    expect(tickedLine(bread, picks[bread.key]!, { pantries, today: TODAY })).toMatchObject({ priceText: "90", priceMinor: 9000 });
  });

  it("scales last time's price to the amount, and a typed price stands until the amount changes", () => {
    expect(scaledPrice(MILK.last, 1_000_000)).toBe(6800);
    expect(scaledPrice(MILK.last, 6_000_000)).toBe(40800);
    expect(scaledPrice({ priceMinor: 100, quantityMilli: 3000 }, 1000)).toBe(33);
    const milk = lineOf("Milk");
    let picks = stepPick(tick({}, "Milk"), milk, -1);
    expect(tickedLine(milk, picks[milk.key]!, { pantries, today: TODAY })).toMatchObject({ priceText: "68", priceMinor: 6800 });
    picks = pricePick(picks, milk.key, "72.50");
    expect(tickedLine(milk, picks[milk.key]!, { pantries, today: TODAY })).toMatchObject({ priceText: "72.50", priceMinor: 7250 });
    picks = stepPick(picks, milk, 1);
    expect(picks[milk.key]!.price).toBeNull();
    expect(tickedLine(milk, picks[milk.key]!, { pantries, today: TODAY }).priceMinor).toBe(13600);
  });

  it("moves to another pantry you add to; a price in another currency is typed again", () => {
    const milk = lineOf("Milk");
    let picks = pricePick(tick({}, "Milk"), milk.key, "140");
    picks = pantryPick(picks, milk.key, "personal", pantries);
    let t = tickedLine(milk, picks[milk.key]!, { pantries, today: TODAY });
    expect(t).toMatchObject({ pantry: "personal", pantryLabel: "Me", priceMinor: 14000, pantryRef: { kind: "personal" } });
    expect(t.request).not.toHaveProperty("wastePolicy");
    expect(t.request).toMatchObject({ pantry: "personal", fromItemId: "itm_milk1", currency: "INR" });

    picks = pantryPick(picks, milk.key, TRIP.orgId, pantries);
    t = tickedLine(milk, picks[milk.key]!, { pantries, today: TODAY });
    expect(t).toMatchObject({ currency: "USD", prefix: "$", priceText: "", priceMinor: null, request: null });
    const s = runSummary(lines, picks, { pantries, today: TODAY });
    expect(s).toMatchObject({ count: 1, ready: false, problem: "Price for Milk", request: null });
    picks = pricePick(picks, milk.key, "3.20");
    expect(runSummary(lines, picks, { pantries, today: TODAY }).request?.lines[0]).toMatchObject({ pantry: TRIP.orgId, currency: "USD", priceMinor: 320 });
    expect(pantryPick(picks, milk.key, TRIP.orgId, pantries)).toBe(picks);
  });

  it("refuses a price that doesn't read", () => {
    const picks = pricePick(tick({}, "Bread"), lineOf("Bread").key, "4.5.0");
    expect(runSummary(lines, picks, { pantries, today: TODAY })).toMatchObject({ ready: false, problem: "Price for Bread" });
  });
});

describe("Add N · ₹total", () => {
  const picks = tick({}, "Bread", "Atta", "Eggs", "Saffron");
  const s = runSummary(lines, picks, { pantries, today: TODAY });

  it("counts and totals the ticked lines, leaving the untickable out", () => {
    expect(s.count).toBe(3);
    expect(s.totalText).toBe("₹374");
    expect(s.label).toBe("Add 3 · ₹374");
    expect(s.ready).toBe(true);
    expect(runToast(s)).toBe("Added 3 to your pantries · ₹374");
  });

  it("is one purchase, in the run's order, each line into its own pantry like last time", () => {
    expect(s.request).toEqual({
      lines: [
        { pantry: FLAT.orgId, name: "Bread", category: "grains", quantity: "1", unit: "pcs", priceMinor: 4500, currency: "INR", fromItemId: "itm_bread1", wastePolicy: null, expiresOn: "2026-11-08" },
        { pantry: FLAT.orgId, name: "Atta", category: "grains", quantity: "5", unit: "kg", priceMinor: 24500, currency: "INR", fromItemId: "itm_atta1", wastePolicy: "buyer_absorbs", expiresOn: "2027-01-04" },
        { pantry: "personal", name: "Eggs", category: "protein", quantity: "12", unit: "pcs", priceMinor: 8400, currency: "INR", fromItemId: "itm_eggs1", expiresOn: "2026-11-19" },
      ],
    });
    expect(s.ticked.map((t) => t.pantryRef.kind)).toEqual(["group", "group", "personal"]);
  });

  it("sends no use-by for a line that had none, and totals currencies apart", () => {
    let p = tick({}, "Butter", "Milk");
    const one = runSummary(lines, p, { pantries, today: TODAY });
    expect(one.request!.lines[0]).not.toHaveProperty("expiresOn");
    expect(one.request!.lines[0]!.quantity).toBe("100");
    p = pricePick(pantryPick(p, lineOf("Milk").key, TRIP.orgId, pantries), lineOf("Milk").key, "3.20");
    expect(runSummary(lines, p, { pantries, today: TODAY }).label).toBe("Add 2 · ₹56 + $3.20");
  });
});
