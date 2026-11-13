// The Money tab as Spliteco draws it inside Cookpool and Tripeco (money-inside
// MN-2, the canvas's "Money, calmer" B boards): one total, the groups as chips
// and rows, and a group's people and latest rows. Pure, so both apps and the
// tests share it.

import type { SplitecoActivityEntry, SplitecoGroupResponse, SplitecoGroupSummary, SplitecoPerson } from "@saas/contracts/spliteco";
import { formatShort } from "./money.js";

/** A signed whole amount: "+₹1,240", "−₹380", "₹0". */
export function signedShort(minor: number, currency: string): string {
  if (minor === 0) return formatShort(0, currency);
  const body = formatShort(Math.abs(minor), currency);
  return minor > 0 ? `+${body}` : `−${body}`;
}

export interface MoneyTotal {
  currency: string;
  minor: number;
  /** "you get back", "you owe", "all settled". */
  words: string;
}

/** Your net across groups, one per currency, the biggest first. */
export function moneyTotals(groups: readonly Pick<SplitecoGroupSummary, "currency" | "myBalanceMinor">[]): MoneyTotal[] {
  const by = new Map<string, number>();
  for (const g of groups) by.set(g.currency, (by.get(g.currency) ?? 0) + g.myBalanceMinor);
  const out = [...by.entries()].map(([currency, minor]) => ({ currency, minor, words: minor > 0 ? "you get back" : minor < 0 ? "you owe" : "all settled" }));
  out.sort((a, b) => Math.abs(b.minor) - Math.abs(a.minor));
  return out.length > 0 ? out : [{ currency: "INR", minor: 0, words: "all settled" }];
}

/** The groups in the order the tab lists them: unsettled first (the biggest first), then the rest by name. */
export function moneyTabGroups<T extends Pick<SplitecoGroupSummary, "name" | "myBalanceMinor">>(groups: readonly T[]): T[] {
  return [...groups].sort((a, b) => {
    const da = Math.abs(a.myBalanceMinor);
    const db = Math.abs(b.myBalanceMinor);
    if ((da > 0) !== (db > 0)) return da > 0 ? -1 : 1;
    if (da !== db) return db - da;
    return a.name.localeCompare(b.name);
  });
}

export type MoneyTone = "get" | "owe" | "even";

export const toneOf = (minor: number): MoneyTone => (minor > 0 ? "get" : minor < 0 ? "owe" : "even");

/** "5 people" / "1 person". */
export function peopleText(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

export interface WithYouRow {
  subjectId: string;
  name: string;
  /** Positive: they pay you; negative: you pay them. */
  minor: number;
}

/**
 * Inside a group: only the payments that involve you, from the group's plan —
 * who pays you (with Remind) and whom you pay (with Settle). Everyone else's
 * debts are theirs.
 */
export function withYou(group: Pick<SplitecoGroupResponse, "plan" | "members">, meId: string | null, people: readonly SplitecoPerson[] = []): WithYouRow[] {
  if (!meId) return [];
  const names = new Map<string, string>();
  for (const p of [...people, ...group.members]) if (p.name) names.set(p.subjectId, p.name);
  const rows: WithYouRow[] = [];
  for (const p of group.plan) {
    if (p.toSubjectId === meId) rows.push({ subjectId: p.fromSubjectId, name: names.get(p.fromSubjectId) ?? "Someone", minor: p.amountMinor });
    else if (p.fromSubjectId === meId) rows.push({ subjectId: p.toSubjectId, name: names.get(p.toSubjectId) ?? "Someone", minor: -p.amountMinor });
  }
  return rows.sort((a, b) => Math.abs(b.minor) - Math.abs(a.minor));
}

export interface LatestRow {
  key: string;
  title: string;
  /** "Asha · Tue" style: who and when, short. */
  sub: string;
  /** What it did to your balance. */
  minor: number;
  currency: string;
}

const DAY = 86_400_000;

/** "Today", "Yesterday", "Tue", "3 Nov". */
export function shortWhen(iso: string, now: Date): string {
  const t = new Date(iso);
  const start = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((start(now) - start(t)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return t.toLocaleDateString("en-IN", { weekday: "short" });
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** The three latest rows of a group, each with who did it and when. */
export function latestRows(entries: readonly SplitecoActivityEntry[], people: readonly SplitecoPerson[], meId: string | null, now: Date, limit = 3): LatestRow[] {
  const names = new Map(people.map((p) => [p.subjectId, p.name ?? "Someone"]));
  return entries.slice(0, limit).map((e) => ({
    key: `${e.txnId}:${e.at}`,
    title: e.title,
    sub: `${e.actorId === meId ? "You" : (names.get(e.actorId) ?? "Someone")} · ${shortWhen(e.at, now)}`,
    minor: e.myEffectMinor,
    currency: e.currency,
  }));
}

/** Where in the Spliteco app a Money tab tap lands: Settle up, + Expense, or the group. */
export function splitecoPath(target: { kind: "settle" | "expense" | "group"; groupId: string | null }): string {
  const g = target.groupId ? encodeURIComponent(target.groupId) : null;
  switch (target.kind) {
    case "settle":
      return g ? `/settle?group=${g}` : "/settle";
    case "expense":
      return g ? `/add?group=${g}` : "/add";
    default:
      return g ? `/group?id=${g}` : "/groups";
  }
}
