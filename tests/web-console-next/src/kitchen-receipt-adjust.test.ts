import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiReceiptLine, AiReceiptResponse } from "@saas/contracts/kitchen";
import { runSummary, runToast, toggleTick } from "@web-console-next/components/kitchen/shopping-run";
import { receiptRun, receiptStartPicks } from "@web-console-next/components/kitchen/receipt-run";
import {
  RECEIPT_ADJUST_DEFAULT,
  adjustCard,
  adjustedSummary,
  includedAdjustMinor,
  receiptAdjustments,
  spreadAdjustment,
  type ReceiptAdjustChoice,
} from "@web-console-next/components/kitchen/receipt-adjust";
import { ReceiptAdjustCard } from "@web-console-next/components/kitchen/receipt-adjust-ui";
import { FLAT, ME, PERSONAL_REF, TRIP, groupPantry, groupRef, personalPantry } from "./kitchen-pantry-fixtures";
import { TODAY } from "./kitchen-restock-fixtures";

// cookpool-ai AI-14: a receipt's taxes, charges and discounts — the one card
// after a scan (both on to start with), and the allocation that spreads what
// is included over the food lines by price so the items cost exactly what was
// paid. The allocation's properties are checked over many seeded cases.

/** A small seeded PRNG (mulberry32), so every run checks the same cases. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("spreadAdjustment: the properties", () => {
  const random = rng(14);
  const int = (max: number) => Math.floor(random() * (max + 1));
  const cases = Array.from({ length: 600 }, () => {
    const prices = Array.from({ length: 1 + int(8) }, () => (random() < 0.15 ? 0 : int(random() < 0.3 ? 500 : 60_000)));
    const total = sum(prices);
    const adjust = random() < 0.5 ? int(5_000) : -int(random() < 0.2 ? total * 2 + 10 : Math.max(1, Math.floor(total * 0.6)));
    return { prices, adjust };
  });

  it("the new prices add up exactly to the lines plus the adjustment (or 0, when a discount is more than everything)", () => {
    for (const { prices, adjust } of cases) {
      const out = spreadAdjustment(prices, adjust);
      expect(out).toHaveLength(prices.length);
      expect(sum(out)).toBe(Math.max(0, sum(prices) + adjust));
      for (const p of out) expect(Number.isSafeInteger(p)).toBe(true);
    }
  });

  it("no line goes negative, and a discount never raises a line nor a tax lowers one", () => {
    for (const { prices, adjust } of cases) {
      const out = spreadAdjustment(prices, adjust);
      out.forEach((p, i) => {
        expect(p).toBeGreaterThanOrEqual(0);
        if (adjust < 0) expect(p).toBeLessThanOrEqual(prices[i]!);
        else expect(p).toBeGreaterThanOrEqual(prices[i]!);
      });
    }
  });

  it("spreads by price: shares follow the lines' prices to within a paisa", () => {
    for (const { prices, adjust } of cases) {
      const total = sum(prices);
      if (total === 0 || adjust < -total) continue;
      const out = spreadAdjustment(prices, adjust);
      out.forEach((p, i) => expect(Math.abs(p - prices[i]! - (adjust * prices[i]!) / total)).toBeLessThan(1));
    }
  });

  it("a discount larger than a line is capped at the line, and the rest is spread over the others", () => {
    // ₹50 off a ₹10 line and a ₹90 line: the small line can't take ₹50 — by price it takes ₹5, the big one ₹45.
    expect(spreadAdjustment([1000, 9000], -5000)).toEqual([500, 4500]);
    // More than the small line could ever take alone: it goes to 0 at most, never below; the rest takes the remainder.
    expect(spreadAdjustment([100, 10_000], -10_050)).toEqual([0, 50]);
    // More than everything: all free.
    expect(spreadAdjustment([300, 700], -5000)).toEqual([0, 0]);
    // A free line takes no discount.
    expect(spreadAdjustment([0, 4000], -1000)).toEqual([0, 3000]);
  });

  it("uses the remainder rule: floor each share, the paise left over to the largest remainders, ties to the earlier line", () => {
    expect(spreadAdjustment([13600, 24500, 8400], 300)).toEqual([13688, 24658, 8454]);
    expect(spreadAdjustment([100, 100, 100], 2)).toEqual([101, 101, 100]);
    expect(spreadAdjustment([100, 100, 100], -2)).toEqual([99, 99, 100]);
  });

  it("handles zero lines, a zero adjustment and lines that are all free", () => {
    expect(spreadAdjustment([], 500)).toEqual([]);
    expect(spreadAdjustment([], -500)).toEqual([]);
    expect(spreadAdjustment([1200, 800], 0)).toEqual([1200, 800]);
    expect(spreadAdjustment([0, 0, 0], 100)).toEqual([34, 33, 33]);
    expect(spreadAdjustment([0, 0], -100)).toEqual([0, 0]);
  });
});

describe("a receipt's adjustments, by kind", () => {
  it("adds taxes and charges, discounts (always taken off) and round-off; a read without adjustments has none and asks nothing", () => {
    const adj = receiptAdjustments({
      adjustments: [
        { kind: "tax", label: "CGST", amountMinor: 1150 },
        { kind: "charge", label: "Delivery", amountMinor: 2500 },
        { kind: "discount", label: "Coupon", amountMinor: -2000 },
        { kind: "roundoff", label: "Round off", amountMinor: -40 },
      ],
    });
    expect(adj).toEqual({ taxesMinor: 3650, discountsMinor: -2000, roundoffMinor: -40, asks: true });
    expect(receiptAdjustments({})).toEqual({ taxesMinor: 0, discountsMinor: 0, roundoffMinor: 0, asks: false });
    expect(receiptAdjustments({ adjustments: [] }).asks).toBe(false);
    // Round-off alone: included without asking.
    const round = receiptAdjustments({ adjustments: [{ kind: "roundoff", label: "Round off", amountMinor: 25 }] });
    expect(round.asks).toBe(false);
    expect(includedAdjustMinor(round, RECEIPT_ADJUST_DEFAULT)).toBe(25);
  });

  it("includes what is switched on: taxes and charges with the round-off, and the discounts", () => {
    const adj = { taxesMinor: 2300, discountsMinor: -2000, roundoffMinor: -40, asks: true };
    expect(RECEIPT_ADJUST_DEFAULT).toEqual({ taxes: true, discounts: true });
    expect(includedAdjustMinor(adj, { taxes: true, discounts: true })).toBe(260);
    expect(includedAdjustMinor(adj, { taxes: false, discounts: true })).toBe(-2000);
    expect(includedAdjustMinor(adj, { taxes: true, discounts: false })).toBe(2260);
    expect(includedAdjustMinor(adj, { taxes: false, discounts: false })).toBe(0);
  });
});

// A DMart bill with GST added on top, a store discount and a non-food line.
const writable = [personalPantry(), groupPantry(FLAT), groupPantry(TRIP, { currency: "USD" })];
const line = (o: Partial<AiReceiptLine> & Pick<AiReceiptLine, "text">): AiReceiptLine => ({ confidence: "sure", ...o });
const GST: AiReceiptResponse = {
  store: "DMart",
  total: 51200,
  currency: "INR",
  sumMinor: 46500,
  totalMatches: true,
  lines: [
    line({ text: "AMUL TAAZA 1L x2", name: "Milk", quantity: 2, unit: "L", priceMinor: 13600, pantry: groupRef(FLAT) }),
    line({ text: "AASHIRVAAD ATTA 5KG", name: "Atta", quantity: 5, unit: "kg", priceMinor: 24500, pantry: groupRef(FLAT) }),
    line({ text: "DISH SOAP", name: "Dish soap", priceMinor: 4400, confidence: "check", reason: "not_food" }),
    line({ text: "EGGS 12N", name: "Eggs", quantity: 12, unit: "pcs", priceMinor: 8400, pantry: PERSONAL_REF }),
  ],
  adjustments: [
    { kind: "tax", label: "CGST 2.5%", amountMinor: 1150 },
    { kind: "tax", label: "SGST 2.5%", amountMinor: 1150 },
    { kind: "discount", label: "STORE DISCOUNT", amountMinor: -2000 },
  ],
};
const ctx = { restock: { finished: [], runningLow: [], usual: [] }, pantries: writable, meId: ME };

function scanned(res: AiReceiptResponse, choice: ReceiptAdjustChoice = RECEIPT_ADJUST_DEFAULT) {
  const run = receiptRun(res, ctx);
  const summary = runSummary(run.lines, receiptStartPicks(run), { pantries: writable, today: TODAY });
  const adj = receiptAdjustments(res);
  const nonFoodKeys = new Set(run.nonFood.map((l) => l.key));
  const food = summary.ticked.filter((t) => !nonFoodKeys.has(t.key));
  const nonFoodMinor = sum(run.nonFood.map((l) => l.line.last.priceMinor));
  const card = adjustCard(adj, choice, {
    itemsMinor: sum(food.map((t) => t.priceMinor!)),
    itemCount: food.length,
    paidMinor: run.totalMinor === null ? null : run.totalMinor - nonFoodMinor,
    currency: run.currency,
  });
  const footer = adjustedSummary(summary, { adjustMinor: includedAdjustMinor(adj, choice), currency: run.currency, nonFoodKeys });
  return { run, summary, card, footer };
}

describe("the card after a scan", () => {
  it("asks both, on to start with, with each effect in one line and what the items cost", () => {
    expect(scanned(GST).card).toEqual({
      rows: [
        { key: "taxes", question: "Include taxes and charges in item prices?", amount: "₹23", on: true, effect: "₹23 spread over 3 items by price" },
        { key: "discounts", question: "Apply discounts?", amount: "−₹20", on: true, effect: "−₹20 taken off 3 items by price" },
      ],
      total: "Items cost ₹468 in total, what you paid",
    });
  });

  it("says what is left out when a switch is off, and what the items then cost against what was paid", () => {
    const card = scanned(GST, { taxes: false, discounts: true }).card!;
    expect(card.rows[0]).toMatchObject({ on: false, effect: "Left out · items keep their printed prices" });
    expect(card.total).toBe("Items cost ₹445 in total · you paid ₹468");
    expect(scanned(GST, { taxes: true, discounts: false }).card!.total).toBe("Items cost ₹488 in total · you paid ₹468");
  });

  it("shows only the rows the receipt has; no total read, no 'you paid'", () => {
    const unprinted: AiReceiptResponse = { ...GST };
    delete unprinted.total;
    const charges = scanned({ ...unprinted, adjustments: [{ kind: "charge", label: "Packing", amountMinor: 500 }] }).card!;
    expect(charges.rows.map((r) => r.key)).toEqual(["taxes"]);
    expect(charges.total).toBe("Items cost ₹470 in total");
    const discount = scanned({ ...GST, adjustments: [{ kind: "discount", label: "Coupon", amountMinor: -1000 }] }).card!;
    expect(discount.rows.map((r) => [r.key, r.amount])).toEqual([["discounts", "−₹10"]]);
  });

  it("no adjustments, or a read from before AI-14: no card, and the footer is the run's own", () => {
    const before: AiReceiptResponse = { ...GST };
    delete before.adjustments;
    for (const res of [{ ...GST, adjustments: [] }, before] as AiReceiptResponse[]) {
      const { card, summary, footer } = scanned(res);
      expect(card).toBeNull();
      expect(footer).toBe(summary);
    }
  });
});

describe("adding the items: included adjustments spread over the food lines by price", () => {
  it("both on: the food lines cost exactly what was paid for them, the boxes keep the printed prices", () => {
    const { summary, footer } = scanned(GST);
    expect(summary.label).toBe("Add 3 · ₹465");
    expect(footer.label).toBe("Add 3 · ₹468");
    expect(footer.request!.lines.map((l) => [l.name, l.priceMinor])).toEqual([
      ["Milk", 13688],
      ["Atta", 24658],
      ["Eggs", 8454],
    ]);
    expect(sum(footer.request!.lines.map((l) => l.priceMinor))).toBe(51200 - 4400);
    // Only the price changes on each line sent.
    footer.request!.lines.forEach((l, i) => expect({ ...l, priceMinor: 0 }).toEqual({ ...summary.request!.lines[i]!, priceMinor: 0 }));
    expect(summary.ticked.map((t) => t.priceText)).toEqual(["136", "245", "84"]);
    expect(runToast(footer)).toBe("Added 3 to your kitchen · ₹468");
  });

  it("excluded ones are simply left out", () => {
    expect(scanned(GST, { taxes: false, discounts: false }).footer.request!.lines.map((l) => l.priceMinor)).toEqual([13600, 24500, 8400]);
    expect(sum(scanned(GST, { taxes: false, discounts: true }).footer.request!.lines.map((l) => l.priceMinor))).toBe(46500 - 2000);
  });

  it("a non-food line ticked after Show takes no share, nor a line moved to a pantry in another currency", () => {
    const { run, summary } = scanned(GST);
    const soap = run.nonFood[0]!;
    const withSoap = runSummary(run.lines, toggleTick(receiptStartPicks(run), soap), { pantries: writable, today: TODAY });
    const at = withSoap.ticked.findIndex((t) => t.key === soap.key);
    expect(withSoap.ticked[at]!.priceMinor).toBe(4400);
    const footer = adjustedSummary(withSoap, { adjustMinor: 300, currency: "INR", nonFoodKeys: new Set([soap.key]) });
    expect(footer.ticked[at]!.priceMinor).toBe(4400);
    expect(sum(footer.ticked.map((t) => t.priceMinor!))).toBe(46500 + 4400 + 300);
    const usd = { ...summary, ticked: summary.ticked.map((t, i) => (i === 0 ? { ...t, currency: "USD" } : t)) };
    const moved = adjustedSummary(usd, { adjustMinor: 300, currency: "INR", nonFoodKeys: new Set() });
    expect(moved.ticked[0]!.priceMinor).toBe(13600);
    expect(sum(moved.ticked.slice(1).map((t) => t.priceMinor!))).toBe(24500 + 8400 + 300);
  });

  it("nothing ticked: nothing to spread, the footer as it was", () => {
    const { run } = scanned(GST);
    const none = runSummary(run.lines, {}, { pantries: writable, today: TODAY });
    expect(adjustedSummary(none, { adjustMinor: 300, currency: "INR", nonFoodKeys: new Set() })).toBe(none);
  });
});

describe("the card's look (RV rules)", () => {
  it("renders a switch per row, on, with tokens and weights 400/500 only", () => {
    const card = scanned(GST).card!;
    const html = renderToStaticMarkup(React.createElement(ReceiptAdjustCard, { card, onToggle: () => {} }));
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html).toContain("Include taxes and charges in item prices?");
    expect(html).toContain("(−₹20)");
    expect(html).toContain("Items cost ₹468 in total, what you paid");
    expect(html).toContain("min-h-[60px]");
    expect(html).not.toMatch(/font-(semibold|bold|extrabold|black)/);
    expect(html).not.toMatch(/#[0-9A-Fa-f]{3,6}\b/);
  });
});
