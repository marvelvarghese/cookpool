// How a group reads on its card and its page.

import type { SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { bucketParts as sharedBucketParts } from "@saas/spliteco-ui/balance";
import { formatMoney } from "./money";

const KIND_TINTS: Record<string, { bg: string; fg: string }> = {
  trip: { bg: "rgba(94,234,212,0.14)", fg: "#5EEAD4" },
  home: { bg: "rgba(96,165,250,0.16)", fg: "#93C5FD" },
  couple: { bg: "rgba(242,155,183,0.14)", fg: "#F29BB7" },
  other: { bg: "rgba(211,166,255,0.14)", fg: "#D3A6FF" },
  kitchen: { bg: "rgba(76,201,138,0.14)", fg: "#4CC98A" },
  direct: { bg: "#16243A", fg: "#A8B6CA" },
};

export function groupTint(g: Pick<SplitecoGroupSummary, "kind" | "madeIn">): { bg: string; fg: string } {
  if (g.madeIn === "cookpool") return KIND_TINTS.kitchen!;
  return KIND_TINTS[g.kind] ?? KIND_TINTS.other!;
}

/** "Meera owes you ₹2,090.00", "You owe Dev ₹620.00" — from the simplified plan. */
export function planLines(g: Pick<SplitecoGroupSummary, "myPlan" | "currency">, names: Map<string, string | null>): string[] {
  return g.myPlan.map((p) => {
    const who = names.get(p.subjectId) || "Someone";
    return p.amountMinor > 0
      ? `${who} owes you ${formatMoney(p.amountMinor, g.currency)}`
      : `You owe ${who} ${formatMoney(-p.amountMinor, g.currency)}`;
  });
}

/** Who on an expense is not a member of a group: empty when it can move there. */
export function missingMembers(onExpense: readonly string[], memberIds: readonly string[]): string[] {
  const inGroup = new Set(memberIds);
  return [...new Set(onExpense)].filter((id) => !inGroup.has(id));
}

/** A Cookpool-made group's two balances, for the small line under its total; null for Spliteco's groups (packages/spliteco-ui). */
export function bucketParts(
  myBuckets: { kitchen: number; other: number } | null,
  currency: string,
): { label: string; amount: string; tone: "get" | "owe" | "even" }[] | null {
  return sharedBucketParts(myBuckets, currency, (minor, c, opts) => formatMoney(minor, c, opts ?? {}));
}
