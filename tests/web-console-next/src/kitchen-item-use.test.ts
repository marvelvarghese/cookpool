import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import { buildUse } from "@saas/kitchen-engine/ledger";
import { toMilli } from "@saas/kitchen-engine/units";
import {
  AMOUNT_STEPS,
  amountCost,
  amountStep,
  canUndoMove,
  costPerText,
  historyQty,
  historyRows,
  initialAmount,
  isUnused,
  itemFacts,
  keepAmountsTogether,
  logButtonLabel,
  logRefusal,
  logRequest,
  loggedText,
  milliToDecimal,
  orderConsumers,
  parseAmount,
  shareBreakdown,
  stepAmount,
  transferNote,
  transferTargets,
  wastePreview,
} from "@web-console-next/components/kitchen/item-use";
import {
  ANU,
  DEV,
  FLAT,
  LUNCH,
  ME,
  MEERA,
  NAMES,
  PERSONAL_REF,
  TRIP,
  groupPantry,
  groupRef,
  makeItem,
  makeMove,
  personalPantry,
} from "./kitchen-pantry-fixtures";

// Tomatoes in Flat 4B: 1 kg for ₹40.00, Anu paid; 400 g left, worth ₹16.00.
const tomatoes = () => makeItem({ unit: "kg", bought: "1", left: "0.4", priceMinor: 4000, worthMinor: 1600, paidBy: ANU });

describe("how much: the stepper", () => {
  it("steps 50 g, 50 ml, one piece, one pack", () => {
    expect(AMOUNT_STEPS).toEqual({
      mass: { unit: "g", stepMilli: 50_000 },
      volume: { unit: "ml", stepMilli: 50_000 },
      count: { unit: "pcs", stepMilli: 1_000 },
      pack: { unit: "pack", stepMilli: 1_000 },
    });
    expect(amountStep(makeItem({ unit: "L" })).unit).toBe("ml");
    expect(amountStep(makeItem({ unit: "dozen" })).unit).toBe("pcs");
  });

  it("starts at one step, or all that is left when that is less", () => {
    expect(initialAmount(tomatoes())).toBe(50_000);
    expect(initialAmount(makeItem({ unit: "g", bought: "500", left: "30" }))).toBe(30_000);
  });

  it("moves along the step grid and stays between the smallest step and what is left", () => {
    const item = makeItem({ unit: "g", bought: "500", left: "430" });
    expect(stepAmount(430_000, -1, item)).toBe(400_000);
    expect(stepAmount(400_000, 1, item)).toBe(430_000);
    expect(stepAmount(430_000, 1, item)).toBe(430_000);
    expect(stepAmount(100_000, -1, item)).toBe(50_000);
    expect(stepAmount(50_000, -1, item)).toBe(50_000);
    expect(stepAmount(120_000, 1, item)).toBe(150_000);
    const crumbs = makeItem({ unit: "g", bought: "500", left: "30" });
    expect(stepAmount(30_000, -1, crumbs)).toBe(30_000);
    expect(stepAmount(30_000, 1, crumbs)).toBe(30_000);
  });

  it("writes an amount as a plain decimal the engine reads back exactly", () => {
    expect(milliToDecimal(100_000)).toBe("100");
    expect(milliToDecimal(433_333)).toBe("433.333");
    expect(milliToDecimal(1_500)).toBe("1.5");
    expect(milliToDecimal(50)).toBe("0.05");
    for (const m of [1, 50, 999, 1_000, 433_333, 1_500_000, 12_345_678]) expect(toMilli(milliToDecimal(m), "g")).toBe(m);
  });

  it("reads a typed amount in the stepper's unit, never more than is left", () => {
    const item = tomatoes();
    expect(parseAmount("100", item)).toEqual({ ok: true, milli: 100_000 });
    expect(parseAmount("12.5", item)).toEqual({ ok: true, milli: 12_500 });
    expect(parseAmount("500", item)).toEqual({ ok: false, message: "Only 400 g left" });
    expect(parseAmount("0", item)).toEqual({ ok: false, message: "Enter more than zero" });
    expect(parseAmount("lots", item)).toEqual({ ok: false, message: "Enter a number like 100 or 1.5" });
    expect(parseAmount("", item)).toEqual({ ok: false, message: "Enter how much" });
  });
});

describe("what it costs", () => {
  it("is the engine's cost of use, from what the item has cost so far", () => {
    const item = tomatoes();
    const engine = (q: number) =>
      costOfUse({ priceMinor: 4000, qtyBoughtMilli: 1_000_000, qtyLeftMilli: 400_000, costTakenMinor: 4000 - 1600 }, q);
    expect(amountCost(item, 100_000)).toBe(engine(100_000));
    expect(amountCost(item, 100_000)).toBe(400);
    expect(amountCost(item, 50_000)).toBe(200);
  });

  it("charges the last of an item exactly what is left of its price", () => {
    const odd = makeItem({ unit: "g", bought: "300", left: "100", priceMinor: 1000, worthMinor: 334 });
    expect(amountCost(odd, 100_000)).toBe(334);
    expect(amountCost(tomatoes(), 400_000)).toBe(1600);
  });

  it("says what 100 g, 100 ml or one piece costs", () => {
    expect(costPerText(tomatoes())).toBe("₹4.00 per 100 g");
    expect(costPerText(makeItem({ unit: "L", bought: "1", priceMinor: 6800 }))).toBe("₹6.80 per 100 ml");
    expect(costPerText(makeItem({ unit: "dozen", bought: "1", priceMinor: 8400 }))).toBe("₹7.00 per piece");
    expect(costPerText(makeItem({ unit: "pack", bought: "6", priceMinor: 18000 }))).toBe("₹30.00 per pack");
  });
});

describe("who had it, and who owes whom", () => {
  it("names you first, then the group's order — the order the server splits in", () => {
    const roster = [ANU, DEV, ME, MEERA];
    expect(orderConsumers(new Set([MEERA, ME, DEV]), roster, ME)).toEqual([ME, DEV, MEERA]);
    expect(orderConsumers(new Set([MEERA, ANU]), roster, ME)).toEqual([ANU, MEERA]);
  });

  it("says who owes the buyer, and the buyer's own share", () => {
    const b = shareBreakdown({ item: tomatoes(), qtyMilli: 100_000, consumers: [ME, DEV], meId: ME, names: NAMES });
    expect(b.costMinor).toBe(400);
    expect(b.lines.map((l) => [l.text, formatMinor(l.amountMinor), l.tone])).toEqual([
      ["You owe Anu", "₹2.00", "owe"],
      ["Dev owes Anu", "₹2.00", "other"],
    ]);
    expect(b.posts).toBe(true);
  });

  it("from the buyer's side: others owe you, your own share nets to zero", () => {
    const mine = makeItem({ unit: "kg", bought: "1", left: "0.4", priceMinor: 4000, worthMinor: 1600, paidBy: ME });
    const b = shareBreakdown({ item: mine, qtyMilli: 100_000, consumers: [ME, ANU], meId: ME, names: NAMES });
    expect(b.lines.map((l) => [l.text, l.amountMinor, l.tone])).toEqual([
      ["Your own share", 200, "own"],
      ["Anu owes you", 200, "owed"],
    ]);
    const alone = shareBreakdown({ item: mine, qtyMilli: 100_000, consumers: [ME], meId: ME, names: NAMES });
    expect(alone.posts).toBe(false);
    expect(alone.lines).toEqual([{ subjectId: ME, text: "Your own share", amountMinor: 400, tone: "own" }]);
  });

  it("gives the odd paisa to the first person named, as the engine (and the server) do", () => {
    // ₹1.00 between three: 34 + 33 + 33.
    const item = makeItem({ unit: "g", bought: "100", priceMinor: 100, paidBy: ANU });
    const consumers = orderConsumers(new Set([DEV, MEERA, ME]), [ANU, DEV, ME, MEERA], ME);
    const b = shareBreakdown({ item, qtyMilli: 100_000, consumers, meId: ME, names: NAMES });
    expect(b.lines.map((l) => [l.text, l.amountMinor])).toEqual([
      ["You owe Anu", 34],
      ["Dev owes Anu", 33],
      ["Meera owes Anu", 33],
    ]);
    expect(b.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(b.costMinor);
    const server = buildUse({ costMinor: 100, buyerId: ANU, consumers });
    for (const l of b.lines) expect(server.find((s) => s.subjectId === l.subjectId)!.owedMinor).toBe(l.amountMinor);
  });

  it("labels the button with the amount and the people", () => {
    const item = tomatoes();
    expect(logButtonLabel({ qtyMilli: 100_000, item, consumers: [ME, DEV], meId: ME, names: NAMES })).toBe("Log 100 g for you and Dev");
    expect(logButtonLabel({ qtyMilli: 100_000, item, consumers: [ME, ANU, DEV, MEERA], meId: ME, names: NAMES })).toBe(
      "Log 100 g for you, Anu and 2 others",
    );
    expect(logButtonLabel({ qtyMilli: 2_000, item: makeItem({ unit: "pcs", bought: "12" }), consumers: null, meId: ME })).toBe("Log 2 pcs");
    expect(logButtonLabel({ qtyMilli: 100_000, item, consumers: [], meId: ME })).toBe("Pick who had it");
  });

  it("posts the amount in the stepper's unit, and who had it for a group item", () => {
    expect(logRequest(tomatoes(), 100_000, [ME, DEV])).toEqual({ quantity: "100", unit: "g", consumers: [ME, DEV] });
    const own = logRequest(makeItem({ pantry: PERSONAL_REF, unit: "L", bought: "1" }), 250_000, [ME]);
    expect(own).toEqual({ quantity: "250", unit: "ml" });
    const req = logRequest(tomatoes(), 433_333, [ME]);
    expect(toMilli(req.quantity, req.unit!)).toBe(433_333);
  });
});

describe("Mark wasted: the preview", () => {
  const roster = [ANU, ME, DEV, MEERA];

  it("splits equally across every member under the group's rule", () => {
    const p = wastePreview({ item: tomatoes(), members: roster, meId: ME, names: NAMES });
    expect(p.question).toBe("Throw away the 400 g left (₹16.00)?");
    expect(p.explain).toBe("Flat 4B splits waste equally. Anu paid, so you, Dev and Meera each owe Anu ₹4.00.");
    expect(p.lines.map((l) => [l.text, l.amountMinor])).toEqual([
      ["Anu's own share", 400],
      ["You owe Anu", 400],
      ["Dev owes Anu", 400],
      ["Meera owes Anu", 400],
    ]);
    expect(p.posts).toBe(true);
  });

  it("lists the shares when they are a paisa apart, and they add up", () => {
    // ₹16.02 between four: 401 + 401 + 400 + 400, the odd paise to the first in the group's order.
    const item = makeItem({ unit: "kg", bought: "1", left: "0.4", priceMinor: 4000, worthMinor: 1602, paidBy: ANU });
    const p = wastePreview({ item, members: roster, meId: ME, names: NAMES });
    expect(p.explain).toBe("Flat 4B splits waste equally. Anu paid, so you, Dev and Meera share it, a paisa apart.");
    expect(p.lines.map((l) => l.amountMinor)).toEqual([401, 401, 400, 400]);
    expect(p.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(1602);
  });

  it("says the buyer absorbs it under that rule — the item's own or the group's", () => {
    const own = makeItem({ wastePolicy: "buyer_absorbs", wastePolicyOverride: "buyer_absorbs", paidBy: ANU });
    expect(wastePreview({ item: own, members: roster, meId: ME, names: NAMES }).explain).toBe(
      "This item's rule: the buyer absorbs waste. Anu paid and absorbs it; nobody else is charged.",
    );
    const lunch = makeItem({ pantry: groupRef(LUNCH), wastePolicy: "buyer_absorbs", paidBy: ME });
    const p = wastePreview({ item: lunch, members: roster, meId: ME, names: NAMES });
    expect(p.explain).toBe("Lunch club's rule: the buyer absorbs waste. You paid, so you absorb it; nobody else is charged.");
    expect(p.posts).toBe(false);
  });

  it("splits nothing for your own item, or for something that cost nothing", () => {
    expect(wastePreview({ item: makeItem({ pantry: PERSONAL_REF, paidBy: ME }), members: [], meId: ME }).lines).toEqual([]);
    const free = makeItem({ priceMinor: 0, worthMinor: 0 });
    expect(wastePreview({ item: free, members: roster, meId: ME }).explain).toBe("What's left cost nothing, so nobody is charged.");
  });

  it("names one other member directly, and counts a big group", () => {
    const two = wastePreview({ item: tomatoes(), members: [ANU, ME], meId: ME, names: NAMES });
    expect(two.explain).toBe("Flat 4B splits waste equally. Anu paid, so you owe Anu ₹8.00.");
    const many = Array.from({ length: 8 }, (_, i) => `usr_${String(i).padStart(32, "0")}`);
    const big = wastePreview({ item: makeItem({ priceMinor: 4000, worthMinor: 1600, paidBy: many[0]! }), members: many, meId: ME });
    expect(big.explain).toMatch(/so the other 7 members share it, a paisa apart\.$|so the other 7 members each owe/);
  });
});

describe("the item page: what is left, and one line of facts (SM-15)", () => {
  it("says what is left of what, then worth now, the price once and who paid — the six-cell grid in one line", () => {
    const facts = itemFacts(tomatoes(), { meId: ME, names: NAMES });
    expect(facts).toEqual({ left: "400 g", of: "left of 1 kg", line: "Worth ₹16.00 · ₹4.00 per 100 g · Anu paid" });
    // "₹4.00 per 100 g" and "₹40.00/kg" were the same fact twice; "Anu paid" was said twice too.
    expect(facts.line.match(/per /g)).toHaveLength(1);
    expect(facts.line).not.toMatch(/\/kg|by Anu/);
  });

  it("counts in the item's measure beside it, says you paid, and leaves who paid off your own item", () => {
    const onions = { ...makeItem({ name: "Onions", unit: "kg", bought: "1", left: "0.6", priceMinor: 4000, paidBy: ME }), measures: [{ id: "msr_1", one: "onion", many: "onions", count: 1, amountMilli: 150_000 }] };
    expect(itemFacts(onions, { meId: ME, names: NAMES })).toMatchObject({ of: "left of 1 kg · ≈ 4 onions", line: "Worth ₹24.00 · ₹4.00 per 100 g · You paid" });
    const mine = makeItem({ pantry: PERSONAL_REF, unit: "L", bought: "1", left: "0.75", priceMinor: 6800, paidBy: ME });
    expect(itemFacts(mine, { meId: ME, names: NAMES }).line).toBe("Worth ₹51.00 · ₹6.80 per 100 ml");
    const gone = makeItem({ left: "0", worthMinor: 0, paidBy: DEV });
    expect(itemFacts(gone, { meId: ME, names: NAMES }).line).toBe("₹4.00 per 100 g · Dev paid");
  });

  it("says who pays for waste in a few words where no share list says it", () => {
    const roster = [ANU, ME, DEV, MEERA];
    expect(wastePreview({ item: tomatoes(), members: roster, meId: ME, names: NAMES }).short).toBeNull();
    expect(wastePreview({ item: makeItem({ wastePolicy: "buyer_absorbs", paidBy: ANU }), members: roster, meId: ME, names: NAMES }).short).toBe("Anu absorbs it");
    expect(wastePreview({ item: makeItem({ wastePolicy: "buyer_absorbs", paidBy: ME }), members: roster, meId: ME }).short).toBe("You absorb it");
    expect(wastePreview({ item: makeItem({ pantry: PERSONAL_REF, paidBy: ME }), members: [], meId: ME }).short).toBe("Nothing to split");
    expect(wastePreview({ item: makeItem({ priceMinor: 0, worthMinor: 0 }), members: roster, meId: ME }).short).toBe("Nobody is charged");
    expect(wastePreview({ item: tomatoes(), members: [ANU], meId: ME, names: NAMES }).short).toBe("Nobody else is charged");
  });

  it("never breaks an amount from its word in the history (the audit's \"300 / g\")", () => {
    expect(keepAmountsTogether("You and Dev Patel · 300 g")).toBe("You and Dev Patel · 300\u00a0g");
    expect(keepAmountsTogether("Anu undid a use: 2 onions back")).toBe("Anu undid a use: 2\u00a0onions back");
    expect(keepAmountsTogether("Anu · ½ onion")).toBe("Anu · ½\u00a0onion");
    expect(keepAmountsTogether("300 g · 2 h ago")).toBe("300\u00a0g · 2\u00a0h ago");
    expect(keepAmountsTogether("Meera added 1.5 kg")).toBe("Meera added 1.5\u00a0kg");
  });

  it("confirms a move to a group in one line", () => {
    expect(transferNote(makeItem({ pantry: PERSONAL_REF, unit: "kg", bought: "1", paidBy: ME }), "Flat 4B")).toBe("1 kg becomes Flat 4B's, paid by you · can't be undone");
  });
});

describe("history", () => {
  const item = makeItem({ unit: "kg", bought: "1", priceMinor: 4000, paidBy: ANU, createdBy: ANU, boughtOn: "2026-10-28" });
  const now = new Date("2026-11-02T10:00:00.000Z");

  it("says who had what, newest first, and ends with the purchase", () => {
    const moves = [
      makeMove({ kind: "use", consumers: [ME, DEV], actor: ME, costMinor: 400, at: "2026-11-02T08:00:00.000Z", txnId: "txn_1" }),
      makeMove({ kind: "use", consumers: [DEV], actor: ANU, qtyMilli: 200_000, costMinor: 800, at: "2026-10-30T08:00:00.000Z" }),
      makeMove({ kind: "waste", actor: MEERA, qtyMilli: 50_000, costMinor: 200, at: "2026-10-29T08:00:00.000Z" }),
    ];
    const rows = historyRows(moves, { item, meId: ME, names: NAMES, now });
    expect(rows.map((r) => [r.what, r.amount])).toEqual([
      ["You and Dev · 100 g", "₹4.00"],
      ["Dev · 200 g · logged by Anu", "₹8.00"],
      ["Meera marked 50 g wasted", "₹2.00"],
      ["Anu added 1 kg", "₹40.00"],
    ]);
    expect(rows[0]!.when).toBe("2 h ago");
    expect(rows[3]!.when).toBe("28 Oct");
  });

  it("scales its amounts (RV-26): 1 L, not 1000 ml", () => {
    const milk = makeItem({ unit: "ml", bought: "1000", paidBy: MEERA, createdBy: MEERA });
    const moves = [
      makeMove({ kind: "use", consumers: [ME], actor: ME, qtyMilli: 1_500_000, quantity: 1500, unit: "ml", costMinor: 0 }),
      makeMove({ kind: "use", consumers: [ME], actor: ME, qtyMilli: 250_000, quantity: 250, unit: "ml", costMinor: 0 }),
    ];
    expect(historyRows(moves, { item: milk, meId: ME, names: NAMES, now }).map((r) => r.what)).toEqual(["You · 1.5 L", "You · 250 ml", "Meera added 1 L"]);
    expect(historyQty(1_000_000, "mass", "g")).toBe("1 kg");
    expect(historyQty(500_000, "mass", "kg")).toBe("500 g");
    expect(historyQty(2_000, "count", "pcs")).toBe("2 pcs");
  });

  it("marks what was undone, says what an undo put back, and names a different payer", () => {
    const use = makeMove({ kind: "use", consumers: [ME], actor: ME, undone: true });
    const back = makeMove({ kind: "reversal", actor: ME, reverses: use.id, consumers: null, costMinor: 0 });
    const bought = makeItem({ unit: "kg", bought: "1", paidBy: ANU, createdBy: ME });
    const rows = historyRows([back, use], { item: bought, meId: ME, names: NAMES, now });
    expect(rows.map((r) => [r.what, r.undone, r.amount])).toEqual([
      ["You undid a use: 100 g back", false, null],
      ["You · 100 g", true, "₹4.00"],
      ["You added 1 kg · Anu paid", false, "₹40.00"],
    ]);
  });

  it("reads a use given in a measure by its words, the amount it took under them (SM-14)", () => {
    const onions = makeItem({ name: "Onions", unit: "kg", bought: "1", priceMinor: 4000, paidBy: MEERA, createdBy: MEERA });
    const moves = [
      makeMove({ kind: "use", consumers: [ANU], actor: ANU, qtyMilli: 300_000, quantity: 0.3, unit: "kg", label: "2 onions", costMinor: 1200, at: "2026-11-02T08:00:00.000Z" }),
      makeMove({ kind: "use", consumers: [DEV], actor: DEV, qtyMilli: 100_000, costMinor: 400, label: null, at: "2026-11-02T07:00:00.000Z" }),
      makeMove({ kind: "dish", actor: ME, qtyMilli: 450_000, unit: "kg", label: "3 onions", costMinor: 1800, consumers: null, at: "2026-11-02T06:00:00.000Z" }),
    ];
    const rows = historyRows(moves, { item: onions, meId: ME, names: NAMES, now });
    expect(rows.slice(0, 3).map((r) => [r.what, r.when, r.amount])).toEqual([
      ["Anu · 2 onions", "300 g · 2 h ago", "₹12.00"],
      ["Dev · 100 g", "3 h ago", "₹4.00"],
      ["You cooked with 3 onions", "450 g · 4 h ago", "₹18.00"],
    ]);
    const back = makeMove({ kind: "reversal", actor: ANU, reverses: moves[0]!.id, label: "2 onions", qtyMilli: 300_000, unit: "kg", costMinor: 0, consumers: null });
    expect(historyRows([back, moves[0]!], { item: onions, meId: ME, names: NAMES, now })[0]!.what).toBe("Anu undid a use: 2 onions back");
  });

  it("tells a move from your pantry, and never shows a raw id", () => {
    const moved = makeMove({ kind: "transfer", actor: "usr_00000000000000000000000000009e9e", costMinor: 0 });
    const rows = historyRows([moved], { item, meId: ME, names: NAMES, now });
    expect(rows[0]!.what).toBe("Member · 9e9e moved it here from their pantry");
    for (const r of rows) expect(r.what).not.toMatch(/usr_/);
  });
});

describe("undo from the history", () => {
  const ctx = { meId: ME, personal: false, role: "member" as const, canWrite: true };

  it("lets the logger (or an owner or admin) reverse a use that posted a transaction, at any point", () => {
    const latest = makeMove({ kind: "use", actor: DEV });
    const mineWithTxn = makeMove({ kind: "use", actor: ME, txnId: "txn_1" });
    const moves = [latest, mineWithTxn];
    expect(canUndoMove(mineWithTxn, moves, ctx)).toBe(true);
    const theirs = makeMove({ kind: "use", actor: DEV, txnId: "txn_2" });
    expect(canUndoMove(theirs, [theirs], ctx)).toBe(false);
    expect(canUndoMove(theirs, [theirs], { ...ctx, role: "admin" })).toBe(true);
  });

  it("puts back a move without money only while it is the latest still in effect", () => {
    const older = makeMove({ kind: "use", actor: ME });
    const newer = makeMove({ kind: "waste", actor: ME });
    expect(canUndoMove(newer, [newer, older], ctx)).toBe(true);
    expect(canUndoMove(older, [newer, older], ctx)).toBe(false);
    const undoneNewer = { ...newer, undone: true };
    const reversal = makeMove({ kind: "reversal", actor: ME, reverses: newer.id });
    expect(canUndoMove(older, [reversal, undoneNewer, older], ctx)).toBe(true);
  });

  it("never offers it to a viewer, for an undone move, a reversal or a transfer", () => {
    const use = makeMove({ kind: "use", actor: ME });
    expect(canUndoMove(use, [use], { ...ctx, role: "viewer", canWrite: false })).toBe(false);
    expect(canUndoMove({ ...use, undone: true }, [use], ctx)).toBe(false);
    const transfer = makeMove({ kind: "transfer", actor: ME });
    expect(canUndoMove(transfer, [transfer], ctx)).toBe(false);
    const reversal = makeMove({ kind: "reversal", actor: ME });
    expect(canUndoMove(reversal, [reversal], ctx)).toBe(false);
  });

  it("always lets you put back the latest change to your own item", () => {
    const use = makeMove({ kind: "use", actor: ME });
    expect(canUndoMove(use, [use], { meId: ME, personal: true, role: null, canWrite: true })).toBe(true);
  });
});

describe("moving your own item to a group", () => {
  it("is only for an item none of which is used", () => {
    expect(isUnused(makeItem({ pantry: PERSONAL_REF }))).toBe(true);
    expect(isUnused(makeItem({ pantry: PERSONAL_REF, left: "0.9" }))).toBe(false);
    expect(isUnused(makeItem({ pantry: PERSONAL_REF, priceMinor: 4000, worthMinor: 3999 }))).toBe(false);
    expect(isUnused(makeItem({ pantry: PERSONAL_REF, state: "wasted" }))).toBe(false);
  });

  it("offers the groups you add to, and shows one counting in another currency as unable to take it", () => {
    const pantries = [personalPantry(), groupPantry(FLAT), groupPantry(LUNCH), groupPantry(TRIP, { currency: "USD" })];
    const roles = new Map([
      [FLAT.orgId, "member" as const],
      [LUNCH.orgId, "viewer" as const],
      [TRIP.orgId, "owner" as const],
    ]);
    expect(transferTargets(pantries, { currency: "INR" }, roles)).toEqual([
      { orgId: FLAT.orgId, slug: FLAT.slug, name: "Flat 4B", disabledReason: null },
      { orgId: TRIP.orgId, slug: TRIP.slug, name: "Goa trip", disabledReason: "Counts in USD" },
    ]);
  });
});

describe("the shares never show a raw id", () => {
  it("labels an unnamed member by their tag", () => {
    const stranger = "usr_00000000000000000000000000009e9e";
    const b = shareBreakdown({ item: tomatoes(), qtyMilli: 100_000, consumers: [stranger], meId: ME, names: NAMES });
    expect(b.lines[0]!.text).toBe("Member · 9e9e owes Anu");
    const w = wastePreview({ item: makeItem({ paidBy: stranger, priceMinor: 4000, worthMinor: 1600 }), members: [stranger, ME], meId: ME, names: NAMES });
    expect(w.explain).not.toMatch(/usr_/);
    expect(FLAT.name).toBe("Flat 4B");
  });
});

describe("what a logged use says, and a refused one (shared with quick use, CP-13)", () => {
  const milk = () => makeItem({ name: "Milk", unit: "L", bought: "1", left: "1", priceMinor: 6800, paidBy: MEERA });

  it("is one line: what and what it cost, for just you (SM-14)", () => {
    expect(loggedText({ item: milk(), what: "1 glass", consumers: [ME], meId: ME, names: NAMES, costMinor: 1700 })).toBe(`Logged 1 glass · ${formatMinor(1700)}`);
    const onions = makeItem({ name: "Onions", unit: "kg", bought: "1", priceMinor: 4000, paidBy: MEERA });
    expect(loggedText({ item: onions, what: "2 onions", consumers: [ME], meId: ME, names: NAMES, costMinor: 1200 })).toBe(`Logged 2 onions · ${formatMinor(1200)}`);
  });

  it("names who, and what each owes, by the engine's split — 'You + Anu · 1 glass · ₹8.50 each'", () => {
    expect(loggedText({ item: milk(), what: "1 glass", consumers: [ANU, ME], meId: ME, names: NAMES, costMinor: 1700 })).toBe(
      `You + Anu · 1 glass · ${formatMinor(850)} each`,
    );
    // A paisa that does not divide: "≈ … each".
    expect(loggedText({ item: milk(), what: "100 g", consumers: [ME, ANU, DEV], meId: ME, names: NAMES, costMinor: 1000 })).toBe(
      `You + Anu + Dev · 100 g · ≈ ${formatMinor(333)} each`,
    );
    expect(loggedText({ item: milk(), what: "1 glass", consumers: [MEERA], meId: ME, names: NAMES, costMinor: 1700 })).toBe(`Meera · 1 glass · ${formatMinor(1700)}`);
  });

  it("is the same one line for your own pantry, whoever is named", () => {
    const eggs = makeItem({ name: "Eggs", pantry: PERSONAL_REF, unit: "pcs", bought: "12", left: "7", priceMinor: 8400, paidBy: ME });
    expect(loggedText({ item: eggs, what: "2 pcs", consumers: [ME, ANU], meId: ME, costMinor: 1400 })).toBe(`Logged 2 pcs · ${formatMinor(1400)}`);
  });

  it("explains a refusal in words, and who comes off the use", () => {
    const item = tomatoes();
    const ctx = { item, meId: ME, names: NAMES };
    expect(logRefusal({ reason: "insufficient_stock", message: "x", details: { qtyLeftMilli: 50_000 } }, ctx)).toEqual({
      message: "Only 50 g left now — someone used some meanwhile.",
      gone: [],
    });
    expect(logRefusal({ reason: "insufficient_stock", message: "x", details: { qtyLeftMilli: 0 } }, ctx).message).toBe(
      "None left now — someone used the last of it.",
    );
    expect(logRefusal({ reason: "stale", message: "x" }, ctx).message).toMatch(/changed while you were logging/);
    expect(logRefusal({ reason: "not_in_group", message: "x", details: { subjectIds: [DEV, 7] } }, ctx)).toEqual({
      message: "Dev left the group, so they're off this use. Check and log again.",
      gone: [DEV],
    });
    expect(logRefusal({ message: "Network unreachable" }, ctx)).toEqual({ message: "Network unreachable", gone: [] });
  });
});
