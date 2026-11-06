/**
 * Home's small pure helpers (Cookpool CP-5): the greeting and the name it
 * uses; since CP-23 also Recent activity across groups; since SM-10 the one
 * money line (CP-23's balance by group is gone: Groups and People have it).
 * Dependency-free (contract types and the app's pure helpers), so they are
 * unit-testable.
 */

import type { CurrencyTotal, KitchenTxn, MyBalancesResponse } from "@saas/contracts/kitchen";
import { activityRow, type ActivityRow } from "./activity";
import { dishHref } from "./dish";
import { formatMinor, formatSignedMinor } from "./money";
import type { MemberNames } from "./members";

/** Home's greeting (SM-10, the canvas): "Hi, Rahul", or "Hi" with no name. */
export function homeGreeting(name: string | null): string {
  return name ? `Hi, ${name}` : "Hi";
}

// ── The money line (SM-10) ────────────────────────────────────────

export type MoneyTone = "owed" | "owe" | "settled";

/** One currency's net, in plain words: "You get back ₹62.50", "You owe $25.00", "Settled up". */
export interface MoneyLine {
  currency: string;
  tone: MoneyTone;
  /** "You get back", "You owe", "Settled up". */
  label: string;
  /** "₹62.50"; null when settled. */
  amount: string | null;
  /** The label and the amount: "You owe $25.00". */
  text: string;
}

export function moneyLine(t: Pick<CurrencyTotal, "currency" | "netMinor">): MoneyLine {
  const tone: MoneyTone = t.netMinor > 0 ? "owed" : t.netMinor < 0 ? "owe" : "settled";
  const label = tone === "owed" ? "You get back" : tone === "owe" ? "You owe" : "Settled up";
  const amount = tone === "settled" ? null : formatMinor(Math.abs(t.netMinor), t.currency);
  return { currency: t.currency, tone, label, amount, text: amount ? `${label} ${amount}` : label };
}

export interface HomeMoney {
  /** The big line: the person's own currency — the one most of their groups count in — unless it is settled and another is not. */
  main: MoneyLine;
  /** Every other currency with money open, one short line each. Never added across currencies. */
  others: MoneyLine[];
  /** In no group yet: Home offers starting or joining one instead. */
  noGroups: boolean;
}

/**
 * Home's one money line (SM-10, design §4 rule 3): "You get back ₹62.50" in
 * the person's currency, and "You owe $25.00" under it for any other currency
 * with money open. Who owes whom is People's (and each payment is one of
 * Home's to-dos), so no person is listed here: each debt shows once.
 */
export function homeMoney(data: Pick<MyBalancesResponse, "groups" | "totals">): HomeMoney {
  const groupsIn = (currency: string) => data.groups.filter((g) => g.currency === currency).length;
  const ordered = [...data.totals].sort(
    (a, b) =>
      Number(a.netMinor === 0) - Number(b.netMinor === 0) ||
      groupsIn(b.currency) - groupsIn(a.currency) ||
      Math.abs(b.netMinor) - Math.abs(a.netMinor),
  );
  const first = ordered[0] ?? { currency: data.groups[0]?.currency ?? "INR", netMinor: 0 };
  return {
    main: moneyLine(first),
    others: ordered.slice(1).filter((t) => t.netMinor !== 0).map(moneyLine),
    noGroups: data.groups.length === 0,
  };
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
/** How many rows Recent activity shows (SM-10: short, so Home fits one 390×844 screen with three to-dos). */
export const RECENT_ROWS = 2;

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
 * group's activity. Rows carry no undo or flag: those are the group's. A
 * payment shows the money that moved (SM-10, the audit's "Anu paid you" as
 * a red −₹400): one paid to you is +₹400 in blue, one you paid is −.
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
    const row = paymentAsCash(activityRow(txn, { meId: ctx.meId, canReverseAny: false, now: ctx.now, names: ctx.names ?? null, canWrite: false }), txn);
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

/**
 * A payment's row as money that moved, not as what it did to your balance: a
 * payment to you takes your "get back" down, but it is money you received.
 * Any other row is returned as it is.
 */
export function paymentAsCash(row: ActivityRow, txn: Pick<KitchenTxn, "kind" | "currency">): ActivityRow {
  if (txn.kind !== "settlement" || row.yourMinor === null || row.yourMinor === 0) return row;
  const cash = -row.yourMinor;
  const amount = formatMinor(Math.abs(cash), txn.currency);
  return {
    ...row,
    tone: cash > 0 ? "owed" : "owe",
    amountText: formatSignedMinor(cash, txn.currency),
    amountWords: cash > 0 ? `You received ${amount}` : `You paid ${amount}`,
  };
}

/** The groups Recent activity reads: the most recently opened first, then the rest by name, at most `limit`. */
export function recentGroupsToRead<T extends { slug: string; name: string }>(groups: readonly T[], recentSlugs: readonly string[], limit = RECENT_GROUPS): T[] {
  const rank = (slug: string) => {
    const i = recentSlugs.indexOf(slug);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...groups].sort((a, b) => rank(a.slug) - rank(b.slug) || a.name.localeCompare(b.name)).slice(0, limit);
}
