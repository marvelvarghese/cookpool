// Small view helpers shared by the screens, kept pure so they are tested.

import type { SplitecoActivityEntry, SplitecoExpenseSummary, SplitecoFriendBalance, SplitecoGroupKind } from "@saas/contracts/spliteco";
import { formatMoney } from "./money";
import { METHOD_LABELS } from "./split-form";

export function friendWhere(p: SplitecoFriendBalance): string {
  const groups = p.groupNames.join(", ");
  if (p.outsideGroups) return groups ? `${groups} + outside groups` : "Outside groups";
  return groups || "No groups in common";
}

/** "owes you ₹2,410.00", "you owe ₹860.00", "all square" — the first currency first. */
export function friendLine(p: SplitecoFriendBalance): { label: string; amount: string; tone: "get" | "owe" | "even" } {
  const nonzero = p.balances.filter((b) => b.amountMinor !== 0);
  if (nonzero.length === 0) return { label: "all square", amount: "settled", tone: "even" };
  const b = nonzero[0]!;
  const extra = nonzero.length > 1 ? ` +${nonzero.length - 1}` : "";
  return b.amountMinor > 0
    ? { label: "owes you", amount: `${formatMoney(b.amountMinor, b.currency)}${extra}`, tone: "get" }
    : { label: "you owe", amount: `${formatMoney(-b.amountMinor, b.currency)}${extra}`, tone: "owe" };
}


export const KIND_LABELS: Record<SplitecoGroupKind, string> = {
  kitchen: "Kitchen",
  trip: "Trip",
  home: "Home",
  couple: "Couple",
  other: "Other",
  direct: "Outside groups",
};

/** The little tags on an expense row: Itemized, Shares, 2 payers, Cookpool. */
export function expenseTags(e: SplitecoExpenseSummary, kitchenGroup = false): string[] {
  const tags: string[] = [];
  if (e.kind === "settlement") tags.push("Payment");
  else if (e.app === "cookpool") tags.push("Cookpool");
  // In a Cookpool-made group, what Spliteco added counts toward the "Other" balance.
  else if (kitchenGroup && e.bucket === "other") tags.push("Other");
  const m = e.method ? METHOD_LABELS[e.method].tag : null;
  if (m) tags.push(m);
  if (e.payers.length > 1) tags.push(`${e.payers.length} payers`);
  return tags;
}

/** The caller's side of a row: "you lent ₹2,700.00" / "you borrowed ₹600.00" / "not involved". */
export function myRowEffect(e: SplitecoExpenseSummary): { label: string; amount: string; tone: "get" | "owe" | "even" } {
  const n = e.myNetMinor;
  if (e.kind === "settlement") {
    return n > 0 ? { label: "you paid", amount: formatMoney(n, e.currency), tone: "get" } : n < 0 ? { label: "you received", amount: formatMoney(-n, e.currency), tone: "even" } : { label: "payment", amount: formatMoney(e.totalMinor, e.currency), tone: "even" };
  }
  if (n > 0) return { label: "you lent", amount: formatMoney(n, e.currency), tone: "get" };
  if (n < 0) return { label: "you borrowed", amount: formatMoney(-n, e.currency), tone: "owe" };
  const involved = e.splits.some((s) => s.paidMinor > 0 || s.owedMinor > 0);
  return { label: involved ? "settled" : "not involved", amount: formatMoney(0, e.currency), tone: "even" };
}

/** Group rows by month, newest first: [["November 2026", rows], …]. */
export function byMonth<T extends { occurredAt: string }>(rows: readonly T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  for (const r of rows) {
    const d = new Date(r.occurredAt);
    const key = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    (out.get(key) ?? out.set(key, []).get(key)!).push(r);
  }
  return [...out.entries()];
}

export type ActivityFilter = "all" | "payments" | "cookpool";

export function filterEntries(entries: readonly SplitecoActivityEntry[], filter: ActivityFilter): SplitecoActivityEntry[] {
  if (filter === "payments") return entries.filter((e) => e.action === "settled");
  if (filter === "cookpool") return entries.filter((e) => e.action === "cookpool");
  return [...entries];
}

