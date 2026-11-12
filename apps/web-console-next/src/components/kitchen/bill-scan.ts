/**
 * Scan a bill in Money (cookpool-ai AI-15) as pure view-models: what the
 * receipt reader read, turned into the Add a bill form's start — the title
 * (the store, or "Bill"), the date (the receipt's, else today) and the amount
 * (the printed total, or the lines plus the included adjustments) — with
 * AI-14's one card ("Include taxes and charges?", "Apply discounts?") moving
 * the amount as its switches change. Nothing here saves: the person still
 * picks who paid and the split, and saves with the form's own button.
 *
 * Reuses AI-14's `receiptAdjustments`, `includedAdjustMinor` and
 * `adjustCard`; the gate and the refusals are AI-8's (`receiptScanShows`,
 * `receiptError`). Itemized splitting (who had which line) is Spliteco
 * SE4's, which reads the same route; the Money form splits equally only.
 */

import type { AiReceiptResponse } from "@saas/contracts/kitchen";
import { BILL_TITLE_MAX } from "@saas/spliteco-ui/bill";
import { moneyInput } from "@saas/spliteco-ui/money";
import { shortMoney } from "./from-before";
import { adjustCard, includedAdjustMinor, receiptAdjustments, type AdjustCard, type ReceiptAdjustChoice } from "./receipt-adjust";

/** The title when the bill names no store. */
export const BILL_TITLE_FALLBACK = "Bill";

/** The words on the entry. */
export const SCAN_BILL_LABEL = "Scan a bill";

/** "Type it in": back to the plain form, the scan closed. */
export const TYPE_IT_IN = "Type it in";

/** The store as the title, clipped to what Spliteco keeps; "Bill" when there is none. */
export function billTitle(res: Pick<AiReceiptResponse, "store">): string {
  const store = (res.store ?? "").trim().replace(/\s+/g, " ");
  return store ? store.slice(0, BILL_TITLE_MAX).trim() : BILL_TITLE_FALLBACK;
}

/** A local calendar day as `YYYY-MM-DD`. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `YYYY-MM-DD` that is a real calendar day, or null. */
function calendarDay(s: string | undefined): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(y, mo - 1, d);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? { y, m: mo, d } : null;
}

export interface BillDate {
  /** `YYYY-MM-DD`, local. */
  day: string;
  /** Read from the bill (false: today, because none was read, or it wasn't a day, or it was after today). */
  fromBill: boolean;
}

/** The receipt's date when it is a real day no later than today; else today. */
export function billDate(res: Pick<AiReceiptResponse, "date">, today: Date): BillDate {
  const read = calendarDay(res.date);
  const now = localDay(today);
  if (!read || res.date! > now) return { day: now, fromBill: false };
  return { day: res.date!, fromBill: true };
}

/**
 * What the request carries as `occurredAt`: nothing for today (the server
 * says now), else midday local on that day, so the day is the same in every
 * time zone near the person's.
 */
export function billOccurredAt(date: BillDate, today: Date): string | undefined {
  if (date.day === localDay(today)) return undefined;
  const d = calendarDay(date.day);
  return d ? new Date(d.y, d.m - 1, d.d, 12).toISOString() : undefined;
}

/** "today", "8 Nov", or "8 Nov 2025" in another year. */
export function billDateText(date: BillDate, today: Date): string {
  if (date.day === localDay(today)) return "today";
  const d = calendarDay(date.day);
  if (!d) return "today";
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.m - 1];
  return d.y === today.getFullYear() ? `${d.d} ${month}` : `${d.d} ${month} ${d.y}`;
}

/** Every line on the bill, food or not: a bill is split whole. */
export function linesMinor(res: Pick<AiReceiptResponse, "lines">): number {
  return res.lines.reduce((sum, l) => sum + (Number.isSafeInteger(l.priceMinor) && l.priceMinor! > 0 ? l.priceMinor! : 0), 0);
}

/** Whether a read can fill the form: a line or a printed total. */
export function billReadUsable(res: Pick<AiReceiptResponse, "lines" | "total">): boolean {
  return res.lines.length > 0 || (typeof res.total === "number" && res.total > 0);
}

export interface BillAmount {
  /** What the form's amount starts at. */
  amountMinor: number;
  /** The card (null without a tax, a charge or a discount, or without lines to spread them over). */
  card: AdjustCard | null;
}

/**
 * The amount under the card's switches. The base is the printed total, else
 * the lines plus every adjustment; what is switched off comes out of it
 * (taxes and charges with the round-off, or the discounts). With every switch
 * on it is the printed total — or, without one, the lines plus the
 * adjustments. Never below 0.
 */
export function billAmount(res: Pick<AiReceiptResponse, "lines" | "total" | "adjustments">, choice: ReceiptAdjustChoice, currency: string): BillAmount {
  const adj = receiptAdjustments(res);
  const all = adj.taxesMinor + adj.roundoffMinor + adj.discountsMinor;
  const total = typeof res.total === "number" && res.total >= 0 ? res.total : null;
  const base = total ?? linesMinor(res) + all;
  const itemsMinor = base - all;
  const amountMinor = Math.max(0, itemsMinor + includedAdjustMinor(adj, choice));
  const card = res.lines.length > 0 ? adjustCard(adj, choice, { itemsMinor, itemCount: res.lines.length, paidMinor: total, currency }) : null;
  return { amountMinor, card };
}

export interface BillPrefill {
  title: string;
  /** The amount as the form's field shows it ("618", "1234.50"). */
  amount: string;
  amountMinor: number;
  date: BillDate;
  /** What the request carries (undefined: today). */
  occurredAt: string | undefined;
  /** The scan's card: "Beach Shack". */
  heading: string;
  /** "8 Nov · 6 lines · bill ₹642". */
  sub: string;
  card: AdjustCard | null;
}

/** The form's start from a read, under the card's switches. */
export function billPrefill(res: AiReceiptResponse, choice: ReceiptAdjustChoice, o: { today: Date; currency: string }): BillPrefill {
  const title = billTitle(res);
  const date = billDate(res, o.today);
  const { amountMinor, card } = billAmount(res, choice, o.currency);
  const n = res.lines.length;
  const parts = [billDateText(date, o.today)];
  if (n > 0) parts.push(`${n} ${n === 1 ? "line" : "lines"}`);
  if (typeof res.total === "number") parts.push(`bill ${shortMoney(res.total, o.currency)}`);
  return {
    title,
    amount: moneyInput(amountMinor),
    amountMinor,
    date,
    occurredAt: billOccurredAt(date, o.today),
    heading: title,
    sub: parts.join(" · "),
    card,
  };
}
