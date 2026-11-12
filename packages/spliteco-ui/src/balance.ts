// The balance card (cookpool-spliteco SE3), as a pure view-model shared by
// both apps: a group's money between the caller and each other person, from
// the group's plan (the fewest payments, or pair by pair), with the one
// payment the caller can make next. Cookpool shows it for the Kitchen
// balance only (its `?bucket=kitchen` read); Spliteco for both, labelled.

import type { SplitecoGroupResponse } from "@saas/contracts/spliteco";

export type BalanceTone = "owe" | "owed" | "settled";

export interface BalanceRow {
  subjectId: string;
  name: string;
  /** "You owe Zoya", "Arjun owes you", "Arjun is all square". */
  text: string;
  /** What the caller owes them (−) or they owe the caller (+). */
  amountMinor: number;
  tone: BalanceTone;
}

export interface BalanceView {
  groupId: string;
  groupName: string;
  currency: string;
  /** The caller's balance in what was read: positive gets money back. */
  myBalanceMinor: number;
  tone: BalanceTone;
  /** Everyone with money open with the caller first (largest first), then the rest of the group at zero. */
  rows: BalanceRow[];
  /** The person the caller pays first (the largest they owe), or null when they owe nobody. */
  payNext: { subjectId: string; name: string; amountMinor: number } | null;
  /** Viewers see the card but record nothing. */
  canWrite: boolean;
}

export function toneOf(minor: number): BalanceTone {
  return minor < 0 ? "owe" : minor > 0 ? "owed" : "settled";
}

/** A person's name as the card says it: their name, or "Someone". */
function nameIn(names: ReadonlyMap<string, string | null>, subjectId: string): string {
  return names.get(subjectId)?.trim() || "Someone";
}

/**
 * The card for one group, from its read: the caller's plan within what was
 * read (for Cookpool, the Kitchen balance only — its read carries nothing
 * else). Members with nothing open between them read "is all square".
 */
export function balanceView(data: SplitecoGroupResponse, me: string | null, names: ReadonlyMap<string, string | null>): BalanceView {
  const currency = data.group.currency;
  const between = new Map<string, number>();
  for (const p of data.plan) {
    if (p.fromSubjectId === me) between.set(p.toSubjectId, (between.get(p.toSubjectId) ?? 0) - p.amountMinor);
    else if (p.toSubjectId === me) between.set(p.fromSubjectId, (between.get(p.fromSubjectId) ?? 0) + p.amountMinor);
  }
  const open: BalanceRow[] = [...between.entries()]
    .filter(([, v]) => v !== 0)
    .map(([subjectId, amountMinor]) => {
      const name = nameIn(names, subjectId);
      return { subjectId, name, amountMinor, tone: toneOf(amountMinor), text: amountMinor < 0 ? `You owe ${name}` : `${name} owes you` };
    })
    .sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor) || a.name.localeCompare(b.name));
  const square: BalanceRow[] = data.members
    .filter((m) => m.subjectId !== me && !between.get(m.subjectId))
    .map((m) => {
      const name = nameIn(names, m.subjectId);
      return { subjectId: m.subjectId, name, amountMinor: 0, tone: "settled" as const, text: `${name} is all square` };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const owe = open.filter((r) => r.amountMinor < 0);
  const first = owe[0];
  const myBalanceMinor = data.balances.find((b) => b.subjectId === me)?.balanceMinor ?? 0;
  return {
    groupId: data.group.id,
    groupName: data.group.kind === "direct" ? "Outside groups" : data.group.name,
    currency,
    myBalanceMinor,
    tone: toneOf(myBalanceMinor),
    rows: [...open, ...square],
    payNext: first ? { subjectId: first.subjectId, name: first.name, amountMinor: -first.amountMinor } : null,
    canWrite: data.canWrite,
  };
}

/** The card's headline: "You owe ₹860.00", "You get back ₹40.00", "All square". */
export function balanceHeadline(view: Pick<BalanceView, "myBalanceMinor" | "currency">, money: (minor: number, currency: string) => string): string {
  if (view.myBalanceMinor < 0) return `You owe ${money(-view.myBalanceMinor, view.currency)}`;
  if (view.myBalanceMinor > 0) return `You get back ${money(view.myBalanceMinor, view.currency)}`;
  return "All square";
}

/**
 * A Cookpool-made group's two balances in Spliteco (design §0.11, risk SE-I):
 * "Kitchen +₹120.00 · Other −₹40.00"; null for Spliteco's own groups.
 */
export function bucketParts(
  myBuckets: { kitchen: number; other: number } | null,
  currency: string,
  money: (minor: number, currency: string, opts?: { sign?: boolean }) => string,
): { label: string; amount: string; tone: "get" | "owe" | "even" }[] | null {
  if (!myBuckets) return null;
  const part = (label: string, v: number) => ({
    label,
    amount: v === 0 ? money(0, currency) : money(v, currency, { sign: true }),
    tone: v > 0 ? ("get" as const) : v < 0 ? ("owe" as const) : ("even" as const),
  });
  return [part("Kitchen", myBuckets.kitchen), part("Other", myBuckets.other)];
}
