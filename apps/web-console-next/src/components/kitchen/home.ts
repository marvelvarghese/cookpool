/**
 * Home's small pure helpers (Cookpool CP-5): the greeting and the name it
 * uses; since CP-23 also Recent activity across groups and the balance by
 * group. Dependency-free (contract types and the app's pure helpers), so
 * they are unit-testable.
 */

import type { KitchenTxn, MyGroupBalance } from "@saas/contracts/kitchen";
import { activityRow, type ActivityRow } from "./activity";
import { dishHref } from "./dish";
import { formatMinor } from "./money";
import type { MemberNames } from "./members";

/** "Good morning" before noon, "Good afternoon" until 5pm, then "Good evening". */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The name to greet someone by: the first word of their display name, else
 * their email's local part, else null (the greeting then has no name).
 */
export function friendlyName(displayName: string | null | undefined, email: string | null | undefined): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0];
  if (first) return first;
  const local = (email ?? "").trim().split("@")[0];
  return local ? local : null;
}

// ── Home's columns (CP-23) ────────────────────────────────────────


/** How many groups Recent activity reads (their newest entries), most recently opened first. */
export const RECENT_GROUPS = 8;
/** How many entries each of those groups gives. */
export const RECENT_PER_GROUP = 5;
/** How many rows Recent activity shows. */
export const RECENT_ROWS = 6;

export interface RecentRow extends ActivityRow {
  /** "Flat 4B" */
  groupName: string;
  /** The group's `org_…` (what the row opens is read ahead from it, SM-5). */
  orgId: string;
  /** The dish it came from, else the entry in its group's activity. */
  href: string;
  occurredAt: string;
}

/**
 * Recent activity across groups: each group's newest entries merged, newest
 * first, at most `limit`, each labelled with its group ("Flat 4B · You · 3 h
 * ago"). A dish's charges open the dish; anything else opens the entry in its
 * group's activity. Rows carry no undo or flag: those are the group's.
 */
export function recentAcrossGroups(
  groups: readonly { orgId: string; name: string; slug: string; txns: readonly KitchenTxn[] }[],
  ctx: { meId: string | null; names?: MemberNames | null; now: Date; limit?: number },
): RecentRow[] {
  const all: { txn: KitchenTxn; group: (typeof groups)[number] }[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const txn of group.txns) {
      if (seen.has(txn.id)) continue;
      seen.add(txn.id);
      all.push({ txn, group });
    }
  }
  all.sort((a, b) => b.txn.occurredAt.localeCompare(a.txn.occurredAt) || a.txn.id.localeCompare(b.txn.id));
  return all.slice(0, ctx.limit ?? RECENT_ROWS).map(({ txn, group }) => {
    const row = activityRow(txn, { meId: ctx.meId, canReverseAny: false, now: ctx.now, names: ctx.names ?? null, canWrite: false });
    return {
      ...row,
      whoWhen: `${group.name} · ${row.whoWhen}`,
      groupName: group.name,
      orgId: group.orgId,
      occurredAt: txn.occurredAt,
      href:
        txn.sourceKind === "dish" && txn.sourceId
          ? dishHref(txn.sourceId)
          : `/groups/${encodeURIComponent(group.slug)}?txn=${encodeURIComponent(txn.id)}`,
    };
  });
}

/** The groups Recent activity reads: the most recently opened first, then the rest by name, at most `limit`. */
export function recentGroupsToRead<T extends { slug: string; name: string }>(groups: readonly T[], recentSlugs: readonly string[], limit = RECENT_GROUPS): T[] {
  const rank = (slug: string) => {
    const i = recentSlugs.indexOf(slug);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...groups].sort((a, b) => rank(a.slug) - rank(b.slug) || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface ByGroupRow {
  orgId: string;
  slug: string;
  name: string;
  href: string;
  balanceMinor: number;
  currency: string;
  tone: "owed" | "owe" | "settled";
  /** "you get back ₹86.50", "you owe ₹25.00", "settled up". */
  words: string;
}

/**
 * Home's "By group" (the balance card's breakdown): your balance in each
 * group, the ones with money open first (largest first), then the settled
 * ones, recently opened first.
 */
export function byGroupRows(groups: readonly MyGroupBalance[], recentSlugs: readonly string[] = []): ByGroupRow[] {
  const rank = (slug: string) => {
    const i = recentSlugs.indexOf(slug);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...groups]
    .sort(
      (a, b) =>
        Number(a.balanceMinor === 0) - Number(b.balanceMinor === 0) ||
        Math.abs(b.balanceMinor) - Math.abs(a.balanceMinor) ||
        rank(a.slug) - rank(b.slug) ||
        a.name.localeCompare(b.name),
    )
    .map((g) => {
      const tone = g.balanceMinor > 0 ? "owed" : g.balanceMinor < 0 ? "owe" : "settled";
      const amount = formatMinor(Math.abs(g.balanceMinor), g.currency);
      return {
        orgId: g.orgId,
        slug: g.slug,
        name: g.name,
        href: `/groups/${encodeURIComponent(g.slug)}`,
        balanceMinor: g.balanceMinor,
        currency: g.currency,
        tone,
        words: tone === "owed" ? `you get back ${amount}` : tone === "owe" ? `you owe ${amount}` : "settled up",
      };
    });
}
