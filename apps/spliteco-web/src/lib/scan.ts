// Scan a receipt (cookpool-spliteco SE4, design §5): Cookpool's receipt
// reader (POST /v1/kitchen/me/ai/receipt, through api-edge's kitchen route)
// reads the photo; this file turns what it read into a draft the person
// checks. Pure: the Scan screen keeps a `ScanDraft` in state.
//
// The cookpool-ai rules hold: the read writes nothing, money never moves on
// the AI's word (nothing is saved until the normal Save on Add expense), and
// no names go to the model (only the photo does).
//
// What is doubtful:
//   - a line the reader could not read well: no price, no name, reason
//     `unclear` (AI_RECEIPT_UNCLEAR) or "not sure what …";
//   - the receipt as a whole when the lines plus the charges do not come to
//     the printed total (or no total was printed).
// The reader's other `check` reasons are about a kitchen's own purchase
// history ("no price from before", "bought in kg before") and say nothing
// about whether a restaurant line was read right, so they are not flagged.
//
// Assigning (and "Just split the total equally") stays off until every
// flagged line is confirmed or fixed and the lines plus the charges match the
// printed total.

import type { AiReceiptLine, AiReceiptResponse } from "@saas/contracts/kitchen";
import { AI_RECEIPT_UNCLEAR, KITCHEN_AI_ERROR_REASONS } from "@saas/contracts/kitchen";
import type { SplitecoAdjustmentKind } from "@saas/contracts/spliteco";
import { moneyInput } from "./money";
import { newKey, type AdjustmentForm, type ExpenseForm, type ItemForm } from "./split-form";

export interface ScanLine {
  key: string;
  /** The line as printed. */
  text: string;
  name: string;
  qty: number;
  /** The line's charged total; null when it could not be read. */
  priceMinor: number | null;
  /** Doubtful, with why (null when it read fine). */
  doubt: string | null;
  /** The person said "Looks right" or fixed it. */
  checked: boolean;
}

export interface ScanCharge {
  key: string;
  kind: SplitecoAdjustmentKind;
  label: string;
  /** Always positive; a discount is taken off. */
  amountMinor: number;
}

export interface ScanDraft {
  store: string | null;
  /** The printed total; the person can type it when none was read. */
  totalMinor: number | null;
  currency: string;
  lines: ScanLine[];
  charges: ScanCharge[];
}

const TAX_RE = /\b(c?gst|sgst|igst|vat|tax|cess)\b/i;
const SERVICE_RE = /\b(service|svc|serv\.?|s\.?\s?c\.?|tip|packing|packaging|delivery|handling)\b/i;
const DISCOUNT_RE = /\b(discount|disc|coupon|offer|promo|savings?)\b/i;
const ROUND_RE = /\bround(?:ing|ed)?[\s-]?off\b|\bround(?:ing)?\b/i;

/** A printed line that is a charge on the bill rather than an item, and which kind; null for an item. */
export function chargeKind(text: string, priceMinor: number): SplitecoAdjustmentKind | null {
  if (DISCOUNT_RE.test(text) || (priceMinor < 0 && !ROUND_RE.test(text))) return "discount";
  if (ROUND_RE.test(text)) return priceMinor < 0 ? "discount" : "tax";
  if (TAX_RE.test(text)) return "tax";
  if (SERVICE_RE.test(text)) return "service";
  return null;
}

/** Why a line is doubtful, or null when it read fine. */
export function lineDoubt(line: Pick<AiReceiptLine, "name" | "priceMinor" | "confidence" | "reason" | "text">): string | null {
  if (line.priceMinor === undefined || line.priceMinor === null) return "No price could be read";
  if (!line.name?.trim()) return "The name could not be read";
  if (line.confidence === "check" && line.reason === AI_RECEIPT_UNCLEAR) return "Hard to read";
  if (line.confidence === "check" && line.reason && /^not sure what/i.test(line.reason)) return "Not sure what this is";
  return null;
}

function qtyOf(line: AiReceiptLine): number {
  // A count of pieces is how many were on the bill; a weight or a volume is one line.
  if (line.unit === "pcs" && typeof line.quantity === "number" && line.quantity > 0 && Number.isInteger(line.quantity) && line.quantity <= 1000) {
    return line.quantity;
  }
  const printed = /\bx\s?(\d{1,3})\b|\b(\d{1,3})\s?x\b/i.exec(line.text);
  const n = printed ? Number(printed[1] ?? printed[2]) : 1;
  return n > 0 ? n : 1;
}

function labelOf(line: AiReceiptLine): string {
  return (line.text || line.name || "").trim().slice(0, 60) || "Charge";
}

/** The draft the Scan screen starts from. */
export function draftFromReceipt(read: AiReceiptResponse): ScanDraft {
  const lines: ScanLine[] = [];
  const charges: ScanCharge[] = [];
  for (const line of read.lines) {
    const price = typeof line.priceMinor === "number" ? line.priceMinor : null;
    const kind = price === null ? null : chargeKind(line.text ?? line.name ?? "", price);
    if (kind && price !== null) {
      if (price !== 0) charges.push({ key: newKey("chg"), kind, label: labelOf(line), amountMinor: Math.abs(price) });
      continue;
    }
    const doubt = lineDoubt(line);
    lines.push({
      key: newKey("scn"),
      text: line.text,
      name: (line.name ?? line.text ?? "").trim(),
      qty: qtyOf(line),
      priceMinor: price,
      doubt,
      checked: doubt === null,
    });
  }
  const total = typeof read.total === "number" && read.total > 0 ? read.total : null;
  // The reader adds up the receipt's own charges (a tax added on top, a
  // discount, round-off) without listing them; when it says they come to the
  // printed total, the gap is those charges, shown as one line.
  if (total !== null && read.totalMatches) {
    const gap = total - sumOf({ lines, charges });
    if (gap !== 0) {
      charges.push({ key: newKey("chg"), kind: gap > 0 ? "tax" : "discount", label: gap > 0 ? "Taxes and charges" : "Discount", amountMinor: Math.abs(gap) });
    }
  }
  return { store: read.store?.trim() || null, totalMinor: total, currency: read.currency, lines, charges };
}

/** The items plus the charges (a discount taken off). */
export function sumOf(draft: Pick<ScanDraft, "lines" | "charges">): number {
  const items = draft.lines.reduce((s, l) => s + (l.priceMinor ?? 0), 0);
  return draft.charges.reduce((s, c) => s + (c.kind === "discount" ? -c.amountMinor : c.amountMinor), items);
}

export interface ScanStatus {
  itemsMinor: number;
  chargesMinor: number;
  sumMinor: number;
  /** Lines still waiting for "Looks right" or a fix. */
  toCheck: ScanLine[];
  /** sum − printed total (null when no total is known). */
  gapMinor: number | null;
  matches: boolean;
  /** Assign items (and Split equally) are on. */
  ready: boolean;
}

export function scanStatus(draft: ScanDraft): ScanStatus {
  const itemsMinor = draft.lines.reduce((s, l) => s + (l.priceMinor ?? 0), 0);
  const sumMinor = sumOf(draft);
  const toCheck = draft.lines.filter((l) => !l.checked);
  const gapMinor = draft.totalMinor === null ? null : sumMinor - draft.totalMinor;
  const matches = gapMinor === 0;
  const complete = draft.lines.length > 0 && draft.lines.every((l) => l.priceMinor !== null && l.priceMinor > 0 && l.name.trim() !== "");
  return { itemsMinor, chargesMinor: sumMinor - itemsMinor, sumMinor, toCheck, gapMinor, matches, ready: complete && toCheck.length === 0 && matches };
}

/** "Looks right". */
export function confirmLine(draft: ScanDraft, key: string): ScanDraft {
  return { ...draft, lines: draft.lines.map((l) => (l.key === key && l.priceMinor !== null && l.name.trim() ? { ...l, checked: true } : l)) };
}

/** "Fix it": the person's own name, count and price; it counts as checked once it has a name and a price. */
export function fixLine(draft: ScanDraft, key: string, fix: { name?: string; qty?: number; priceMinor?: number | null }): ScanDraft {
  return {
    ...draft,
    lines: draft.lines.map((l) => {
      if (l.key !== key) return l;
      const next = { ...l, ...fix };
      return { ...next, checked: next.priceMinor !== null && next.priceMinor > 0 && next.name.trim() !== "" };
    }),
  };
}

export function removeLine(draft: ScanDraft, key: string): ScanDraft {
  return { ...draft, lines: draft.lines.filter((l) => l.key !== key) };
}

export function setTotal(draft: ScanDraft, totalMinor: number | null): ScanDraft {
  return { ...draft, totalMinor: totalMinor !== null && totalMinor > 0 ? totalMinor : null };
}

export function setCharge(draft: ScanDraft, key: string, charge: Partial<Omit<ScanCharge, "key">> | null): ScanDraft {
  if (charge === null) return { ...draft, charges: draft.charges.filter((c) => c.key !== key) };
  return { ...draft, charges: draft.charges.map((c) => (c.key === key ? { ...c, ...charge } : c)) };
}

export function addCharge(draft: ScanDraft, kind: SplitecoAdjustmentKind, amountMinor = 0): ScanDraft {
  const label = kind === "tax" ? "Tax" : kind === "service" ? "Service charge" : "Discount";
  return { ...draft, charges: [...draft.charges, { key: newKey("chg"), kind, label, amountMinor }] };
}

/** The headline: "Read 6 items and 2 charges." */
export function readSummary(draft: ScanDraft): string {
  const n = draft.lines.length;
  const c = draft.charges.length;
  const items = `${n} item${n === 1 ? "" : "s"}`;
  return c > 0 ? `Read ${items} and ${c} charge${c === 1 ? "" : "s"}.` : `Read ${items}.`;
}

/** What Assign items opens the Itemized screen with: the items (no one on them yet) and the charges as amounts. */
export function prefillItems(draft: ScanDraft): { items: ItemForm[]; adjustments: AdjustmentForm[] } {
  return {
    items: draft.lines.map((l) => ({
      key: newKey("itm"),
      name: l.name.trim(),
      qtyText: String(l.qty),
      unitText: "",
      totalText: moneyInput(l.priceMinor ?? 0) || "0",
      shares: {},
    })),
    adjustments: draft.charges
      .filter((c) => c.amountMinor > 0)
      .map((c) => ({ key: newKey("adj"), kind: c.kind, label: c.label, mode: "amount" as const, valueText: moneyInput(c.amountMinor) })),
  };
}

/** The scan applied to a fresh Add expense form: itemized with the items, or equal for the printed total. */
export function applyScan(form: ExpenseForm, draft: ScanDraft, how: "items" | "equal"): ExpenseForm {
  const title = form.title.trim() || draft.store || "Restaurant bill";
  if (how === "equal") {
    return { ...form, title, category: form.category ?? "food", method: "equal", amountText: moneyInput(draft.totalMinor ?? sumOf(draft)), items: [], adjustments: [] };
  }
  return { ...form, title, category: form.category ?? "food", method: "items", ...prefillItems(draft) };
}

// ── Handing the draft to Add expense ───────────────────────
//
// Nothing is saved until Save, so the draft travels in this tab's
// sessionStorage, read once by Add expense.

export const SCAN_DRAFT_KEY = "spliteco.scanDraft";

export interface ScanHandoff {
  groupId: string | null;
  how: "items" | "equal";
  draft: ScanDraft;
}

export function stashScan(storage: Pick<Storage, "setItem"> | null, handoff: ScanHandoff): void {
  try {
    storage?.setItem(SCAN_DRAFT_KEY, JSON.stringify(handoff));
  } catch {
    /* private mode: Add expense starts empty */
  }
}

/** Read and forget the handed-over draft. */
export function takeScan(storage: Pick<Storage, "getItem" | "removeItem"> | null): ScanHandoff | null {
  try {
    const raw = storage?.getItem(SCAN_DRAFT_KEY);
    storage?.removeItem(SCAN_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScanHandoff;
    return parsed && Array.isArray(parsed.draft?.lines) ? parsed : null;
  } catch {
    return null;
  }
}

// ── When the reader is not there ───────────────────────────

/** The receipt route's refusals that mean "enter the items by hand" rather than "try another photo". */
export function aiFallback(reason: string | null, status: number): "unavailable" | "limit" | null {
  if (reason === KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE || reason === KITCHEN_AI_ERROR_REASONS.BUDGET) return "unavailable";
  if (reason === KITCHEN_AI_ERROR_REASONS.AI_DAILY_LIMIT || reason === KITCHEN_AI_ERROR_REASONS.RECEIPT_DAILY_LIMIT) return "limit";
  if (status === 503 || status === 429) return status === 429 ? "limit" : "unavailable";
  return null;
}
