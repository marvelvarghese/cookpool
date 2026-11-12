// The Expense breakdown's words: what you had, and each step of its history.

import type { SplitecoExpenseDetail, SplitecoHistoryEntry } from "@saas/contracts/spliteco";
import { formatMoney } from "./money";

/** "Fish thali · 1 of 2", "Kingfisher · 2 of 6", "Bebinca · 25%", then "Tax & service, your part". */
export function myItems(e: Pick<SplitecoExpenseDetail, "items" | "breakdown">, me: string): { label: string; amountMinor: number; muted?: boolean }[] {
  const out: { label: string; amountMinor: number; muted?: boolean }[] = [];
  for (const it of e.items) {
    const s = it.shares.find((x) => x.subjectId === me);
    if (!s) continue;
    let how: string;
    if (s.mode === "portion") {
      const total = it.shares.filter((x) => x.mode === "portion").reduce((a, x) => a + x.value, 0);
      const mineP = s.value / 1000;
      const of = it.qty > 1 ? it.qty : total / 1000;
      how = `${Math.round(mineP * 100) / 100} of ${Math.round(of * 100) / 100}`;
    } else if (s.mode === "pct") {
      how = `${s.value / 100}%`;
    } else {
      how = "set amount";
    }
    out.push({ label: `${it.name} · ${how}`, amountMinor: s.amountMinor });
  }
  const adj = e.breakdown.find((b) => b.subjectId === me)?.adjustmentsMinor ?? 0;
  if (adj !== 0) out.push({ label: adj > 0 ? "Tax & service, your part" : "Discount, your part", amountMinor: adj, muted: true });
  return out;
}

export function historyText(h: SplitecoHistoryEntry, by: string, currency: string): string {
  const amount = formatMoney(h.totalMinor, currency);
  switch (h.action) {
    case "added":
      return `${by} added this for ${amount}`;
    case "edited":
      return `${by} edited it (${amount})`;
    case "deleted":
      return `${by} deleted it`;
    case "restored":
      return `${by} restored it`;
    case "moved":
      return `${by} moved it to another group`;
  }
}
