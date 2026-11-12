/**
 * A receipt's discounts, taxes, charges and round-off (cookpool-ai AI-14) as
 * pure view-models: the one card asked after a scan — "Include taxes and
 * charges in item prices?" and "Apply discounts?", each on to start with —
 * and the allocation that spreads what is included across the food lines by
 * price, so the items' costs add up exactly to what was paid. What is left
 * out is simply not added. Dependency-free but for the money maths, so it is
 * unit-testable; AI-15 (Scan a bill in Money) can reuse `spreadAdjustment`,
 * `receiptAdjustments` and `includedAdjustMinor`.
 */

import type { AiReceiptAdjustment, AiReceiptResponse } from "@saas/contracts/kitchen";
import { splitByWeights } from "@saas/kitchen-engine/money";
import { shortMoney } from "./from-before";
import { totalText, type RunSummary } from "./shopping-run";

// ── The allocation ────────────────────────────────────────────────

/**
 * Spread a signed `adjustMinor` across lines priced `prices` (whole minor
 * units, ≥ 0) in proportion to their prices, with Cookpool's largest-
 * remainder rule (`splitByWeights`: floor each share, the paise left over
 * one each to the largest remainders, ties to the earlier line). Returns
 * each line's new price, in the same order.
 *
 * - The new prices add up to Σprices + adjustMinor exactly.
 * - No line goes below 0: a discount share larger than a line's price is
 *   capped at it, and the rest is spread over the lines still above 0. A
 *   discount larger than every line together takes them all to 0 (the sum
 *   is then 0, the most that can come off).
 * - An amount added to lines that are all free (Σprices = 0) is spread
 *   evenly.
 * - No lines: `[]` — there is nothing to spread over.
 */
export function spreadAdjustment(prices: readonly number[], adjustMinor: number): number[] {
  const out = prices.map((p) => (Number.isSafeInteger(p) && p > 0 ? p : 0));
  if (out.length === 0 || !Number.isSafeInteger(adjustMinor) || adjustMinor === 0) return out;
  if (adjustMinor > 0) {
    const sum = out.reduce((a, b) => a + b, 0);
    const shares = splitByWeights(adjustMinor, sum > 0 ? out : out.map(() => 1));
    return out.map((p, i) => p + shares[i]!);
  }
  // A discount: off by price, each line capped at what it costs, the rest spread over the lines still above 0.
  let left = Math.min(-adjustMinor, out.reduce((a, b) => a + b, 0));
  while (left > 0) {
    const shares = splitByWeights(left, out);
    let taken = 0;
    out.forEach((p, i) => {
      const take = Math.min(shares[i]!, p);
      out[i] = p - take;
      taken += take;
    });
    if (taken === 0) break;
    left -= taken;
  }
  return out;
}

// ── What the receipt adjusts by ───────────────────────────────────

export interface ReceiptAdjustments {
  /** Taxes and charges added on top of the items (≥ 0). */
  taxesMinor: number;
  /** Discounts (≤ 0). */
  discountsMinor: number;
  /** The round-off (either sign): it goes with the taxes and charges. */
  roundoffMinor: number;
  /** Whether to ask: there is a tax, a charge or a discount. Round-off alone is included without asking. */
  asks: boolean;
}

/** A read's adjustments, by kind. A read from before AI-14 (no `adjustments`) has none. */
export function receiptAdjustments(res: Pick<AiReceiptResponse, "adjustments">): ReceiptAdjustments {
  let taxesMinor = 0;
  let discountsMinor = 0;
  let roundoffMinor = 0;
  for (const a of (res.adjustments ?? []) as readonly AiReceiptAdjustment[]) {
    if (!Number.isSafeInteger(a.amountMinor) || a.amountMinor === 0) continue;
    if (a.kind === "discount") discountsMinor -= Math.abs(a.amountMinor);
    else if (a.kind === "roundoff") roundoffMinor += a.amountMinor;
    else taxesMinor += Math.abs(a.amountMinor);
  }
  return { taxesMinor, discountsMinor, roundoffMinor, asks: taxesMinor > 0 || discountsMinor < 0 };
}

/** The card's two answers; both on to start with. */
export interface ReceiptAdjustChoice {
  taxes: boolean;
  discounts: boolean;
}

export const RECEIPT_ADJUST_DEFAULT: ReceiptAdjustChoice = { taxes: true, discounts: true };

/** What is spread over the items: the taxes and charges (with the round-off) when included, the discounts when applied. */
export function includedAdjustMinor(adj: ReceiptAdjustments, choice: ReceiptAdjustChoice): number {
  return (choice.taxes ? adj.taxesMinor + adj.roundoffMinor : 0) + (choice.discounts ? adj.discountsMinor : 0);
}

// ── The run's lines, adjusted ─────────────────────────────────────

/**
 * The run's footer and write with the included adjustments spread across
 * the ticked food lines in the receipt's currency, by price (`spreadAdjustment`).
 * The lines' own boxes keep the printed prices; only what is added — the
 * request's `priceMinor`, the Add button's total and the toast — changes.
 * Non-food lines (ticked after Show), lines without a price yet and lines
 * moved to a pantry in another currency take no share.
 */
export function adjustedSummary(summary: RunSummary, o: { adjustMinor: number; currency: string; nonFoodKeys: ReadonlySet<string> }): RunSummary {
  if (o.adjustMinor === 0) return summary;
  const at = summary.ticked.flatMap((t, i) => (t.currency === o.currency && t.priceMinor !== null && !o.nonFoodKeys.has(t.key) ? [i] : []));
  if (at.length === 0) return summary;
  const spread = spreadAdjustment(at.map((i) => summary.ticked[i]!.priceMinor!), o.adjustMinor);
  const price = new Map(at.map((i, n) => [i, spread[n]!] as const));
  const ticked = summary.ticked.map((t, i) => (price.has(i) ? { ...t, priceMinor: price.get(i)! } : t));
  const request = summary.request
    ? { ...summary.request, lines: summary.request.lines.map((l, i) => (price.has(i) ? { ...l, priceMinor: price.get(i)! } : l)) }
    : null;
  const total = totalText(ticked);
  return { ...summary, ticked, request, totalText: total, label: summary.count === 0 ? summary.label : `Add ${summary.count} · ${total}` };
}

// ── The card ──────────────────────────────────────────────────────

export interface AdjustRow {
  key: keyof ReceiptAdjustChoice;
  /** "Include taxes and charges in item prices?" */
  question: string;
  /** "₹38", "−₹50" */
  amount: string;
  on: boolean;
  /** One line: what it does. */
  effect: string;
}

export interface AdjustCard {
  rows: AdjustRow[];
  /** "Items cost ₹412 in total, what you paid", or "Items cost ₹450 in total · you paid ₹412". */
  total: string;
}

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/**
 * The card asked after a scan with a tax, a charge or a discount (null
 * otherwise — no card): a row per kind present, and what the items will
 * cost. `itemsMinor` is what the ticked food lines cost as printed, over
 * `itemCount` lines; `paidMinor` what was paid for them (the bill less its
 * non-food lines), when the bill's total was read.
 */
export function adjustCard(
  adj: ReceiptAdjustments,
  choice: ReceiptAdjustChoice,
  o: { itemsMinor: number; itemCount: number; paidMinor: number | null; currency: string },
): AdjustCard | null {
  if (!adj.asks) return null;
  const money = (m: number) => (m < 0 ? `−${shortMoney(-m, o.currency)}` : shortMoney(m, o.currency));
  const rows: AdjustRow[] = [];
  const taxes = adj.taxesMinor + adj.roundoffMinor;
  if (adj.taxesMinor > 0) {
    rows.push({
      key: "taxes",
      question: "Include taxes and charges in item prices?",
      amount: money(taxes),
      on: choice.taxes,
      effect: choice.taxes ? `${money(taxes)} spread over ${items(o.itemCount)} by price` : "Left out · items keep their printed prices",
    });
  }
  if (adj.discountsMinor < 0) {
    rows.push({
      key: "discounts",
      question: "Apply discounts?",
      amount: money(adj.discountsMinor),
      on: choice.discounts,
      effect: choice.discounts ? `${money(adj.discountsMinor)} taken off ${items(o.itemCount)} by price` : "Left out · items keep their printed prices",
    });
  }
  const after = Math.max(0, o.itemsMinor + (o.itemCount > 0 ? includedAdjustMinor(adj, choice) : 0));
  const paid = o.paidMinor;
  const total =
    paid === null
      ? `Items cost ${money(after)} in total`
      : after === paid
        ? `Items cost ${money(after)} in total, what you paid`
        : `Items cost ${money(after)} in total · you paid ${money(paid)}`;
  return { rows, total };
}
