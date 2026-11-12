// The Itemized screen's taps, as data: the chips of the "How much X had"
// panel, the badge on a face, the line under an item, and what each tap does
// to an item's shares. Values are what the wire stores: portions ×1000 (⅓ is
// 333), percentages in basis points (⅓% of the item is 3333), exact in paise.

import type { SplitecoItemShareMode } from "@saas/contracts/spliteco";
import { splitItem, type ItemResult } from "@saas/kitchen-engine/splits";
import { formatShort } from "./money";
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
