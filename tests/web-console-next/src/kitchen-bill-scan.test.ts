// cookpool-ai AI-15: Scan a bill on Money's Add a bill. The read fills the
// title (the store, or "Bill"), the date (the receipt's, else today) and the
// amount (the printed total, or the lines plus the included adjustments),
// with AI-14's card moving the amount as its switches change; the entry
// shows only where Scan a receipt does, the refusals are AI-8's words with
// "Type it in", and nothing is saved by the scan.

import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiReceiptLine, AiReceiptResponse, AiStatus } from "@saas/contracts/kitchen";
import {
  BILL_TITLE_FALLBACK,
  billAmount,
  billDate,
  billDateText,
  billOccurredAt,
  billPrefill,
  billReadUsable,
  billTitle,
  linesMinor,
} from "@web-console-next/components/kitchen/bill-scan";
import { BillScanPanel, ScanBillButton, type BillScan } from "@web-console-next/components/kitchen/bill-scan-ui";
import { RECEIPT_ADJUST_DEFAULT } from "@web-console-next/components/kitchen/receipt-adjust";
import { receiptError, receiptScanShows } from "@web-console-next/components/kitchen/receipt-run";

const root = `${cwd()}/../../apps/web-console-next/src`;
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

const TODAY = new Date(2026, 10, 12, 9, 30);

const line = (text: string, priceMinor: number, over: Partial<AiReceiptLine> = {}): AiReceiptLine => ({ text, name: text, priceMinor, confidence: "sure", ...over });

/** A Beach Shack bill: ₹600 of lines, ₹30 GST, ₹20 service and ₹50 off; ₹600 printed. */
function bill(over: { [K in keyof AiReceiptResponse]?: AiReceiptResponse[K] | undefined } = {}): AiReceiptResponse {
  const out = {
    store: "Beach Shack",
    date: "2026-11-08",
    total: 60000,
    currency: "INR",
    sumMinor: 60000,
    totalMatches: true,
    lines: [line("PRAWN CURRY", 36000), line("FISH THALI", 18000), line("LIME SODA 2", 6000)],
    adjustments: [
      { kind: "tax", label: "GST 5%", amountMinor: 3000 },
      { kind: "charge", label: "Service", amountMinor: 2000 },
      { kind: "discount", label: "Happy hour", amountMinor: -5000 },
    ],
    ...over,
  };
  for (const k of Object.keys(out) as (keyof typeof out)[]) if (out[k] === undefined) delete out[k];
  return out as AiReceiptResponse;
}

describe("Scan a bill: the title", () => {
  it("is the store, tidied, or Bill", () => {
    expect(billTitle({ store: "  Beach   Shack " })).toBe("Beach Shack");
    expect(billTitle({})).toBe(BILL_TITLE_FALLBACK);
    expect(billTitle({ store: "   " })).toBe("Bill");
    expect(billTitle({ store: "x".repeat(200) })).toHaveLength(120);
  });
});

describe("Scan a bill: the date", () => {
  it("is the receipt's when it is a real day, no later than today", () => {
    expect(billDate({ date: "2026-11-08" }, TODAY)).toEqual({ day: "2026-11-08", fromBill: true });
    expect(billDate({ date: "2026-11-12" }, TODAY)).toEqual({ day: "2026-11-12", fromBill: true });
    expect(billDate({ date: "2025-12-31" }, TODAY)).toEqual({ day: "2025-12-31", fromBill: true });
  });

  it("is today without one, for a day that doesn't exist, or one after today", () => {
    expect(billDate({}, TODAY)).toEqual({ day: "2026-11-12", fromBill: false });
    expect(billDate({ date: "2026-02-30" }, TODAY)).toEqual({ day: "2026-11-12", fromBill: false });
    expect(billDate({ date: "2026-13-01" }, TODAY)).toEqual({ day: "2026-11-12", fromBill: false });
    expect(billDate({ date: "2026-11-13" }, TODAY)).toEqual({ day: "2026-11-12", fromBill: false });
    expect(billDate({ date: "8 Nov" }, TODAY)).toEqual({ day: "2026-11-12", fromBill: false });
  });

  it("is sent as midday local on that day, and not at all for today (the server says now)", () => {
    expect(billOccurredAt({ day: "2026-11-12", fromBill: true }, TODAY)).toBeUndefined();
    const at = billOccurredAt({ day: "2026-11-08", fromBill: true }, TODAY)!;
    expect(at).toBe(new Date(2026, 10, 8, 12).toISOString());
    const back = new Date(at);
    expect([back.getFullYear(), back.getMonth(), back.getDate()]).toEqual([2026, 10, 8]);
  });

  it("reads as today, a day and month, or with the year when it is another", () => {
    expect(billDateText({ day: "2026-11-12", fromBill: false }, TODAY)).toBe("today");
    expect(billDateText({ day: "2026-11-08", fromBill: true }, TODAY)).toBe("8 Nov");
    expect(billDateText({ day: "2025-12-31", fromBill: true }, TODAY)).toBe("31 Dec 2025");
  });
});

describe("Scan a bill: the amount under the switches", () => {
  it("with every switch on, is the printed total", () => {
    expect(billAmount(bill(), RECEIPT_ADJUST_DEFAULT, "INR").amountMinor).toBe(60000);
  });

  it("without a printed total, is the lines plus the included adjustments", () => {
    const res = bill({ total: undefined });
    expect(linesMinor(res)).toBe(60000);
    expect(billAmount(res, RECEIPT_ADJUST_DEFAULT, "INR").amountMinor).toBe(60000 + 3000 + 2000 - 5000);
    expect(billAmount(res, { taxes: false, discounts: true }, "INR").amountMinor).toBe(55000);
    expect(billAmount(res, { taxes: true, discounts: false }, "INR").amountMinor).toBe(65000);
    expect(billAmount(res, { taxes: false, discounts: false }, "INR").amountMinor).toBe(60000);
  });

  it("takes what is switched off out of the printed total", () => {
    const res = bill({ total: 61000, lines: [line("THALI", 61000)], adjustments: [{ kind: "tax", label: "GST", amountMinor: 3000 }, { kind: "roundoff", label: "Round off", amountMinor: -50 }, { kind: "discount", label: "Off", amountMinor: -2950 }] });
    expect(billAmount(res, RECEIPT_ADJUST_DEFAULT, "INR").amountMinor).toBe(61000);
    // Taxes off: the tax and the round-off come out.
    expect(billAmount(res, { taxes: false, discounts: true }, "INR").amountMinor).toBe(61000 - 3000 + 50);
    // Discounts off: the discount is not taken.
    expect(billAmount(res, { taxes: true, discounts: false }, "INR").amountMinor).toBe(61000 + 2950);
  });

  it("counts every line, food or not, and never goes below 0", () => {
    expect(linesMinor({ lines: [line("SOAP", 4400, { reason: "not food" }), line("X", 0), line("Y", -5)] })).toBe(4400);
    const res = bill({ total: undefined, lines: [line("TEA", 1000)], adjustments: [{ kind: "discount", label: "Coupon", amountMinor: -5000 }] });
    expect(billAmount(res, RECEIPT_ADJUST_DEFAULT, "INR").amountMinor).toBe(0);
  });

  it("asks with AI-14's card, whose total is the amount", () => {
    const on = billAmount(bill(), RECEIPT_ADJUST_DEFAULT, "INR").card!;
    expect(on.rows.map((r) => [r.question, r.amount, r.on])).toEqual([
      ["Include taxes and charges in item prices?", "₹50", true],
      ["Apply discounts?", "−₹50", true],
    ]);
    expect(on.total).toBe("Items cost ₹600 in total, what you paid");
    const off = billAmount(bill(), { taxes: false, discounts: true }, "INR").card!;
    expect(off.rows[0]!.effect).toBe("Left out · items keep their printed prices");
    expect(off.total).toBe("Items cost ₹550 in total · you paid ₹600");
  });

  it("has no card without a tax, a charge or a discount, or without lines", () => {
    expect(billAmount(bill({ adjustments: [] }), RECEIPT_ADJUST_DEFAULT, "INR")).toEqual({ amountMinor: 60000, card: null });
    expect(billAmount(bill({ adjustments: undefined }), RECEIPT_ADJUST_DEFAULT, "INR").card).toBeNull();
    expect(billAmount(bill({ adjustments: [{ kind: "roundoff", label: "R/O", amountMinor: 40 }] }), RECEIPT_ADJUST_DEFAULT, "INR").card).toBeNull();
    expect(billAmount(bill({ lines: [] }), RECEIPT_ADJUST_DEFAULT, "INR")).toEqual({ amountMinor: 60000, card: null });
  });
});

describe("Scan a bill: the form's start", () => {
  it("fills the title, the amount and the date, and says where they came from", () => {
    const p = billPrefill(bill(), RECEIPT_ADJUST_DEFAULT, { today: TODAY, currency: "INR" });
    expect([p.title, p.amount, p.amountMinor, p.date.day]).toEqual(["Beach Shack", "600", 60000, "2026-11-08"]);
    expect(p.occurredAt).toBe(new Date(2026, 10, 8, 12).toISOString());
    expect(p.sub).toBe("8 Nov · 3 lines · bill ₹600");
    expect(billPrefill(bill(), { taxes: false, discounts: true }, { today: TODAY, currency: "INR" }).amount).toBe("550");
  });

  it("a bill with no store or date: Bill, today, nothing to send as the date", () => {
    const p = billPrefill(bill({ store: undefined, date: undefined, total: 12345, adjustments: [] }), RECEIPT_ADJUST_DEFAULT, { today: TODAY, currency: "INR" });
    expect([p.title, p.amount, p.occurredAt, p.sub]).toEqual(["Bill", "123.45", undefined, "today · 3 lines · bill ₹123.45"]);
  });

  it("a read fills the form only with a line or a printed total", () => {
    expect(billReadUsable({ lines: [] })).toBe(false);
    expect(billReadUsable({ lines: [], total: 0 })).toBe(false);
    expect(billReadUsable({ lines: [], total: 500 })).toBe(true);
    expect(billReadUsable({ lines: [line("A", 1)] })).toBe(true);
  });
});

const status = (over: Partial<AiStatus> = {}): AiStatus =>
  ({ available: true, features: { sayIt: true, receipt: true, import: true, voice: false, swaps: false }, budget: "ok", today: { actions: 0, actionsLimit: 50, voiceSeconds: 0, voiceSecondsLimit: 300, receipts: 0, receiptsLimit: 10 }, ...over }) as AiStatus;

describe("Scan a bill: where it shows (as Scan a receipt)", () => {
  it("shows in the new frame with AI available, receipts read and the switch on", () => {
    expect(receiptScanShows({ isNewFrame: true, status: status(), switchOn: true })).toBe(true);
  });

  it("hides without a key or past the month's budget (available false), without receipts, with the switch off, while loading, and in today's frame", () => {
    expect(receiptScanShows({ isNewFrame: true, status: status({ available: false }), switchOn: true })).toBe(false);
    expect(receiptScanShows({ isNewFrame: true, status: status({ available: false, budget: "reached" }), switchOn: true })).toBe(false);
    expect(receiptScanShows({ isNewFrame: true, status: status({ features: { sayIt: true, receipt: false, import: true, voice: false, swaps: false } }), switchOn: true })).toBe(false);
    expect(receiptScanShows({ isNewFrame: true, status: status(), switchOn: false })).toBe(false);
    expect(receiptScanShows({ isNewFrame: true, status: undefined, switchOn: true })).toBe(false);
    expect(receiptScanShows({ isNewFrame: false, status: status(), switchOn: true })).toBe(false);
  });

  it("the Add a bill form reads that gate, and fills the shared form without saving", () => {
    const ui = read("components/kitchen/bill-scan-ui.tsx");
    expect(ui).toContain("export const useScanBillShows = useReceiptScanShows;");
    expect(ui).toContain("shrinkReceiptPhoto(file)");
    expect(ui).toContain("readReceipt(image, controller.signal)");
    expect(ui).not.toMatch(/createExpense|addKitchenBill/);
    const money = read("components/kitchen/kitchen-money-ui.tsx");
    expect(money).toContain("const scanShows = useScanBillShows();");
    expect(money).toContain("prefill={formStart}");
    expect(money).toContain("occurredAt ? { ...request, occurredAt } : request");
  });
});

function scan(over: Partial<BillScan> = {}): BillScan {
  const no = () => undefined;
  return { phase: "idle", photoUrl: null, read: null, choice: RECEIPT_ADJUST_DEFAULT, error: null, pickProblem: null, open: no, take: no, cancel: no, close: no, toggle: no, ...over };
}
const html = (el: React.ReactElement | null) => (el ? renderToStaticMarkup(el) : "");

describe("Scan a bill: the entry and the scan, rendered", () => {
  it("the entry is one quiet button with a camera, and nothing where AI isn't available", () => {
    const on = html(React.createElement(ScanBillButton, { shows: true, onClick: () => undefined }));
    expect(on).toContain("Scan a bill");
    expect(on).toContain("lucide-camera");
    expect(on).toContain("bg-cp-accent-tint");
    expect(on.match(/<button/g)).toHaveLength(1);
    expect(html(React.createElement(ScanBillButton, { shows: false, onClick: () => undefined }))).toBe("");
    expect(html(React.createElement(BillScanPanel, { scan: scan(), prefill: null, shows: false }))).toBe("");
    expect(html(React.createElement(BillScanPanel, { scan: scan(), prefill: null, shows: true }))).toContain("Scan a bill");
  });

  it("the pick step takes a photo or chooses one", () => {
    const out = html(React.createElement(BillScanPanel, { scan: scan({ phase: "pick", pickProblem: "Couldn't use this photo · try another" }), prefill: null, shows: true }));
    expect(out).toContain("Take a photo");
    expect(out).toContain("From photos");
    expect(out).toContain('capture="environment"');
    expect(out).toContain("Couldn&#x27;t use this photo · try another");
  });

  it("the refusals are AI-8's words, with Type it in (and Retake when the read failed)", () => {
    const words = (kind: Parameters<typeof receiptError>) => receiptError(...kind).title;
    expect(words([{ reason: "budget" }, 503])).toBe("Cookpool AI is resting until the 1st · add by hand");
    expect(words([{ code: "rate_limited", reason: "receipt_daily_limit" }, 429])).toBe("You've used today's AI scans · try tomorrow");
    expect(words([{ reason: "ai_failed" }, 502])).toBe("Couldn't read this receipt · Retake or add by hand");
    const limit = html(React.createElement(BillScanPanel, { scan: scan({ phase: "problem", error: receiptError({ code: "rate_limited" }, 429) }), prefill: null, shows: true }));
    expect(limit).toContain("You&#x27;ve used today&#x27;s AI scans · try tomorrow");
    expect(limit).toContain("Type it in");
    expect(limit).not.toContain("Retake");
    const failed = html(React.createElement(BillScanPanel, { scan: scan({ phase: "problem", error: receiptError({ reason: "ai_failed" }, 502) }), prefill: null, shows: true }));
    expect(failed).toContain("Retake");
    expect(failed).toContain("Type it in");
  });

  it("after a read: the bill's card and AI-14's switches, both on", () => {
    const res = bill();
    const prefill = billPrefill(res, RECEIPT_ADJUST_DEFAULT, { today: TODAY, currency: "INR" });
    const out = html(React.createElement(BillScanPanel, { scan: scan({ phase: "result", read: { res, at: TODAY } }), prefill, shows: true }));
    expect(out).toContain("Beach Shack");
    expect(out).toContain("8 Nov · 3 lines · bill ₹600");
    expect(out.match(/role="switch" aria-checked="true"/g)).toHaveLength(2);
    expect(out).toContain("Items cost ₹600 in total, what you paid");
    const plain = billPrefill(bill({ adjustments: [] }), RECEIPT_ADJUST_DEFAULT, { today: TODAY, currency: "INR" });
    expect(html(React.createElement(BillScanPanel, { scan: scan({ phase: "result", read: { res: bill({ adjustments: [] }), at: TODAY } }), prefill: plain, shows: true }))).not.toContain('role="switch"');
  });

  it.each(["components/kitchen/bill-scan.ts", "components/kitchen/bill-scan-ui.tsx"])("%s uses tokens, no raw hex, weights 400 and 500 only", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(src).not.toMatch(/font-(semibold|bold|extrabold|black)\b/);
  });
});
