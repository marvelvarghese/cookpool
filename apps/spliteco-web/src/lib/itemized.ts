// The Itemized screen's taps, as data: the chips of the "How much X had"
// panel, the badge on a face, the line under an item, and what each tap does
// to an item's shares. Values are what the wire stores: portions ×1000 (⅓ is
// 333), percentages in basis points (⅓% of the item is 3333), exact in paise.

import type { SplitecoItemShareMode } from "@saas/contracts/spliteco";
import { splitItem, type ItemResult } from "@saas/kitchen-engine/splits";
import { formatShort, parseMoney } from "./money";
import { itemTotal, type ItemForm, type ItemShareForm } from "./split-form";

export const PORTION_CHIPS: readonly { label: string; value: number }[] = [
  { label: "¼", value: 250 },
  { label: "⅓", value: 333 },
  { label: "½", value: 500 },
  { label: "1", value: 1000 },
  { label: "2", value: 2000 },
  { label: "3", value: 3000 },
  { label: "4", value: 4000 },
];

export const PCT_CHIPS: readonly { label: string; value: number }[] = [
  { label: "10%", value: 1000 },
  { label: "20%", value: 2000 },
  { label: "25%", value: 2500 },
  { label: "⅓", value: 3333 },
  { label: "50%", value: 5000 },
  { label: "75%", value: 7500 },
  { label: "100%", value: 10000 },
];

export const EXACT_STEPS = [-5000, -1000, 1000, 5000] as const;

/** Tapping a face that is not on the item adds them on one portion. */
export const DEFAULT_SHARE: ItemShareForm = { mode: "portion", value: 1000 };

/** The badge on a face: ½, ×2, 25%, "₹ set"; empty for one portion. */
export function shareBadge(share: ItemShareForm | undefined): string {
  if (!share) return "";
  if (share.mode === "exact") return "₹ set";
  if (share.mode === "pct") {
    const chip = PCT_CHIPS.find((c) => c.value === share.value && c.label === "⅓");
    return chip ? "⅓" : `${Math.round(share.value / 10) / 10}%`;
  }
  if (share.value === 1000) return "";
  const chip = PORTION_CHIPS.find((c) => c.value === share.value);
  if (chip && share.value < 1000) return chip.label;
  return `×${Math.round(share.value / 10) / 100}`;
}

/** Switching the panel's tab: Portions back to 1; Percent and Exact start from what they pay now. */
export function switchMode(mode: SplitecoItemShareMode, currentAmountMinor: number, itemTotalMinor: number): ItemShareForm {
  if (mode === "portion") return { mode, value: 1000 };
  if (mode === "pct") {
    const bp = itemTotalMinor > 0 ? Math.round((currentAmountMinor * 10_000) / itemTotalMinor / 100) * 100 : 0;
    return { mode, value: Math.min(10_000, Math.max(100, bp)) };
  }
  const rounded = Math.round(currentAmountMinor / 1000) * 1000;
  return { mode, value: Math.max(0, Math.min(itemTotalMinor, rounded || 1000)) };
}

/** −50 / −10 / +10 / +50 on an exact amount, kept between 0 and the item's total. */
export function stepExact(valueMinor: number, deltaMinor: number, itemTotalMinor: number): number {
  return Math.max(0, Math.min(itemTotalMinor, valueMinor + deltaMinor));
}

/** The item menu. */
export function everyone(item: ItemForm, members: readonly string[]): ItemForm {
  return { ...item, shares: Object.fromEntries(members.map((m) => [m, { ...DEFAULT_SHARE }])) };
}

export function splitEvenly(item: ItemForm): ItemForm {
  return { ...item, shares: Object.fromEntries(Object.keys(item.shares).map((m) => [m, { ...DEFAULT_SHARE }])) };
}

export function resetItem(item: ItemForm): ItemForm {
  return { ...item, shares: {} };
}

export function setShare(item: ItemForm, subjectId: string, share: ItemShareForm | null): ItemForm {
  const shares = { ...item.shares };
  if (share) shares[subjectId] = share;
  else delete shares[subjectId];
  return { ...item, shares };
}

/** Each person's part of one item, as the engine works it out. */
export function itemAmounts(item: ItemForm, members: readonly string[]): { result: ItemResult; total: number | null; amounts: Map<string, number> } {
  const total = itemTotal(item);
  const { result } = splitItem({
    totalMinor: total ?? 0,
    shares: members.filter((m) => item.shares[m]).map((m) => ({ subjectId: m, ...item.shares[m]! })),
  });
  return { result, total, amounts: new Map(result.amounts.map((a) => [a.subjectId, a.amountMinor])) };
}

/** The line under an item's name. */
export function itemStatus(item: ItemForm, members: readonly string[], currency = "INR"): { text: string; tone: "muted" | "warn" | "bad" } {
  const { result, total } = itemAmounts(item, members);
  const on = members.filter((m) => item.shares[m]).length;
  if (total === null) return { text: "Add the price", tone: "bad" };
  if (on === 0) return { text: "Tap who had this", tone: "bad" };
  if (result.gapMinor > 0) return { text: `${formatShort(result.gapMinor, currency)} still not assigned`, tone: "bad" };
  if (result.gapMinor < 0) return { text: `${formatShort(-result.gapMinor, currency)} more than the item costs`, tone: "bad" };
  const qty = Number(item.qtyText);
  const portions = members.filter((m) => item.shares[m]?.mode === "portion");
  if (qty > 1 && portions.length === on) {
    const claimed = portions.reduce((s, m) => s + item.shares[m]!.value, 0) / 1000;
    if (Math.abs(claimed - qty) > 0.01) {
      return { text: `${Math.round(claimed * 100) / 100} claimed, bill says ${qty} — shared to fit`, tone: "warn" };
    }
  }
  const unit = item.unitText.trim() && qty > 1 ? `${qty} × ${item.unitText.trim()} · ` : "";
  return { text: `${unit}shared by ${on}`, tone: "muted" };
}

/** Panel hint per mode, as on the canvas. */
export function modeHint(mode: SplitecoItemShareMode, qty: number): string {
  if (mode === "portion") {
    return `${qty > 1 ? `How many of the ${qty} they had. ` : ""}People on portions share whatever is left after any % or ₹ amounts.`;
  }
  if (mode === "pct") return "Their percentage comes off the top; everyone on portions shares the rest.";
  return "A fixed amount for them; everyone on portions shares the rest.";
}

// ── V2Itemized (spliteco-calm SL4) ───────────────────────────────

/** The adjust sheet's chips: Portions ¼ ½ 1 2 3, Percent 10–100. */
export const FACE_PORTION_CHIPS: readonly { label: string; value: number }[] = [
  { label: "¼", value: 250 },
  { label: "½", value: 500 },
  { label: "1", value: 1000 },
  { label: "2", value: 2000 },
  { label: "3", value: 3000 },
];
export const FACE_PCT_CHIPS: readonly { label: string; value: number }[] = [
  { label: "10%", value: 1000 },
  { label: "25%", value: 2500 },
  { label: "50%", value: 5000 },
  { label: "75%", value: 7500 },
  { label: "100%", value: 10000 },
];
/** The ₹ − / + step: ₹10. */
export const FACE_EXACT_STEP = 1000;

/** The badge on a face when it is not one portion: ¼, ½, ⅓, 2, 25%, ₹. */
export function faceBadge(share: ItemShareForm | undefined): string {
  if (!share) return "";
  if (share.mode === "exact") return "₹";
  if (share.mode === "pct") return share.value === 3333 ? "⅓" : `${Math.round(share.value) / 100}%`;
  if (share.value === 1000) return "";
  const chip = PORTION_CHIPS.find((c) => c.value === share.value);
  if (chip) return chip.label;
  return String(Math.round(share.value / 10) / 100);
}

/** The line over an item's name: "2 × ₹380", or "Qty 3" with no price of one. */
export function qtyLine(item: ItemForm, currency = "INR"): string {
  const qty = Number(item.qtyText);
  const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const unit = item.unitText.trim() ? parseMoney(item.unitText) : null;
  if (unit !== null) return `${q} × ${formatShort(unit, currency)}`;
  return `Qty ${q}`;
}

/**
 * Each person's total for the strip at the bottom: what the engine works out
 * (tax and discount spread in) when the bill adds up, else the sum of their
 * item parts so far. Only people on some item.
 */
export function personTotals(form: { members: string[]; items: ItemForm[] }, owed: ReadonlyMap<string, number> | null): { subjectId: string; minor: number }[] {
  const sums = new Map<string, number>();
  for (const it of form.items) {
    const { amounts } = itemAmounts(it, form.members);
    for (const m of form.members) if (it.shares[m]) sums.set(m, (sums.get(m) ?? 0) + (amounts.get(m) ?? 0));
  }
  return form.members.filter((m) => sums.has(m)).map((m) => ({ subjectId: m, minor: owed?.get(m) ?? sums.get(m) ?? 0 }));
}
