// The "why" list (cookpool-spliteco SE3): the rows behind the caller's
// balance in a group, newest first — each one line, what it was and what it
// did to the caller's balance — grouped into This week and Earlier. Pure;
// both apps draw it, Cookpool from its Kitchen-only read.

import type { SplitecoExpenseSummary } from "@saas/contracts/spliteco";
import { toneOf, type BalanceTone } from "./balance.js";

export interface WhyRow {
  id: string;
  /** "Paneer tikka", "You paid Zoya". */
  title: string;
  /** "your portion", "your use", "you paid", "split 3 ways", "UPI". */
  detail: string;
  /** What it did to the caller's balance: + they get back, − they owe. */
  netMinor: number;
  currency: string;
  tone: BalanceTone;
  occurredAt: string;
}

export interface WhySection {
  title: "This week" | "Earlier";
  rows: WhyRow[];
}

const DAY = 24 * 60 * 60 * 1000;

const METHOD: Record<string, string> = { upi: "UPI", cash: "Cash", bank: "Bank" };

function detailOf(t: SplitecoExpenseSummary, me: string): string {
  const mine = t.splits.find((s) => s.subjectId === me);
  const sharing = t.splits.filter((s) => s.owedMinor > 0).length;
  switch (t.kind) {
    case "use":
      return mine && mine.owedMinor > 0 ? "your use" : "used";
    case "dish":
      return mine && mine.owedMinor > 0 ? "your portion" : "you cooked";
    case "waste":
      return "waste, shared";
    case "settlement":
      return t.paymentMethod ? (METHOD[t.paymentMethod] ?? "Payment") : "Payment";
    default:
      if (mine && mine.paidMinor > 0) return sharing > 1 ? `you paid · split ${sharing} ways` : "you paid";
      return sharing > 1 ? `split ${sharing} ways` : "your share";
  }
}

function titleOf(t: SplitecoExpenseSummary, me: string, names: ReadonlyMap<string, string | null>): string {
  if (t.kind !== "settlement") return t.title;
  const from = t.splits.find((s) => s.paidMinor > 0)?.subjectId;
  const to = t.splits.find((s) => s.owedMinor > 0)?.subjectId;
  const name = (id: string | undefined) => (id ? names.get(id)?.trim() || "Someone" : "Someone");
  if (from === me) return `You paid ${name(to)}`;
  if (to === me) return `${name(from)} paid you`;
  return `${name(from)} paid ${name(to)}`;
}

/** The rows that touch the caller, newest first, each with its effect on their balance. */
export function whyRows(expenses: readonly SplitecoExpenseSummary[], me: string | null, names: ReadonlyMap<string, string | null>): WhyRow[] {
  if (!me) return [];
  return expenses
    .filter((t) => t.splits.some((s) => s.subjectId === me))
    .map((t) => ({
      id: t.id,
      title: titleOf(t, me, names),
      detail: detailOf(t, me),
      netMinor: t.myNetMinor,
      currency: t.currency,
      tone: toneOf(t.myNetMinor),
      occurredAt: t.occurredAt,
    }))
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
}

/** This week (the last 7 days) and Earlier, each kept only when it has rows. */
export function whySections(rows: readonly WhyRow[], now: Date): WhySection[] {
  const cut = now.getTime() - 7 * DAY;
  const week = rows.filter((r) => new Date(r.occurredAt).getTime() >= cut);
  const earlier = rows.filter((r) => new Date(r.occurredAt).getTime() < cut);
  return [
    ...(week.length > 0 ? [{ title: "This week" as const, rows: week }] : []),
    ...(earlier.length > 0 ? [{ title: "Earlier" as const, rows: earlier }] : []),
  ];
}

/** A row's amount as the list shows it: "₹212.00" owed, "+₹40.00" back, "₹0.00" for nothing. */
export function whyAmount(row: Pick<WhyRow, "netMinor" | "currency">, money: (minor: number, currency: string) => string): string {
  if (row.netMinor > 0) return `+${money(row.netMinor, row.currency)}`;
  return money(Math.abs(row.netMinor), row.currency);
}
