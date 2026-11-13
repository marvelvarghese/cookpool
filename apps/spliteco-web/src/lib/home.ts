/**
 * Home, Groups and Activity as one swipeable surface (spliteco-calm SL2,
 * design §2–§3). No React: which tab an address is, the address a tab
 * writes back, what a person's row swipes to, and the signed amounts are
 * unit-tested here.
 */

import type { SplitecoFriendBalance, SplitecoGroupSummary, SplitecoMoney } from "@saas/contracts/spliteco";
import { formatShort } from "./money";
import { PAGER_TABS, TABS, tabIndexOf } from "./tabs";

// ── Tabs ↔ addresses ──────────────────────────────────────────────

/** The pager's page for an address: 0 Home, 1 Groups, 2 Activity; -1 when it is not one of them (You, a pushed screen). */
export function pagerIndexOf(path: string | null | undefined): number {
  const i = tabIndexOf(path);
  return i >= 0 && i < PAGER_TABS ? i : -1;
}

/** The address the pager writes when it settles on `index` (Groups keeps Friends as `?tab=friends`). */
export function pagerPath(index: number, opts: { friends?: boolean } = {}): string {
  const i = Math.max(0, Math.min(PAGER_TABS - 1, Math.round(index)));
  const href = TABS[i]!.href;
  return i === 1 && opts.friends ? `${href}?tab=friends` : href;
}

// ── Signed amounts ────────────────────────────────────────────────

export type Tone = "get" | "owe" | "even";

/** `+₹2,410` teal when you get back, `−₹860` coral when you owe, `₹0` plain: the sign is always there (design §1). */
export function signedShort(minor: number, currency = "INR"): { text: string; tone: Tone } {
  if (minor > 0) return { text: `+${formatShort(minor, currency)}`, tone: "get" };
  if (minor < 0) return { text: formatShort(minor, currency), tone: "owe" };
  return { text: formatShort(0, currency), tone: "even" };
}

/** The balance a person's row shows: INR first, else their first non-zero one; null when all square. */
export function mainBalance(balances: readonly SplitecoMoney[]): SplitecoMoney | null {
  const open = balances.filter((b) => b.amountMinor !== 0);
  return open.find((b) => b.currency === "INR") ?? open[0] ?? null;
}

/** "You get back" / "You owe" / "All square": the one label above Home's big figure. */
export function netLabel(netMinor: number): string {
  return netMinor > 0 ? "You get back" : netMinor < 0 ? "You owe" : "All square";
}

// ── A person's row ────────────────────────────────────────────────

/**
 * What swiping a person left does: Settle when you pay them, Remind when they
 * pay you, nothing when square (SL-8).
 *
 * The groups' plans decide, not the net balance: the server settles and
 * reminds by each group's plan (`bucketedPlan`, simplified or not), where a
 * person who owes you overall may pay someone else instead. So the action
 * follows the plan's direction, the net balance's first; with no plan entry
 * either way there is nothing to do with them here. Until the groups have
 * loaded, the net balance decides, as before.
 */
export type RowAction = "settle" | "remind" | null;

export function rowAction(
  p: Pick<SplitecoFriendBalance, "balances" | "subjectId">,
  groups: readonly Pick<SplitecoGroupSummary, "myPlan">[] | null = null,
): RowAction {
  const b = mainBalance(p.balances);
  if (!b || b.amountMinor === 0) return null;
  const byNet: RowAction = b.amountMinor < 0 ? "settle" : "remind";
  if (!groups) return byNet;
  const entries = groups.flatMap((g) => g.myPlan.filter((e) => e.subjectId === p.subjectId));
  const pays = entries.some((e) => e.amountMinor < 0);
  const paid = entries.some((e) => e.amountMinor > 0);
  if (byNet === "settle") return pays ? "settle" : paid ? "remind" : null;
  return paid ? "remind" : pays ? "settle" : null;
}

/** Why a person has no swipe action although the balance isn't square: the plan routes it through others. */
export function planNote(p: Pick<SplitecoFriendBalance, "balances" | "subjectId" | "name">, groups: readonly Pick<SplitecoGroupSummary, "myPlan">[] | null): string | null {
  const b = mainBalance(p.balances);
  if (!groups || !b || b.amountMinor === 0 || rowAction(p, groups) !== null) return null;
  return "Simplified: settled through others";
}

/**
 * Where Settle goes for a person, as the friend page does: straight to the
 * one group you pay them in, else the Settle list (it shows each group).
 */
export function settleHref(subjectId: string, groups: readonly Pick<SplitecoGroupSummary, "id" | "myPlan">[] | null): string {
  const owed = (groups ?? []).filter((g) => g.myPlan.some((p) => p.subjectId === subjectId && p.amountMinor < 0));
  if (owed.length !== 1) return "/settle";
  return `/settle?group=${encodeURIComponent(owed[0]!.id)}&to=${encodeURIComponent(subjectId)}`;
}

/**
 * The Cookpool dot on a person: what you have with them sits in a group made
 * in Cookpool (a kitchen) — by the groups' plans, else (when no plan names
 * them, debts simplified away) by a shared kitchen's name.
 */
export function fromKitchen(
  p: Pick<SplitecoFriendBalance, "subjectId" | "groupNames">,
  groups: readonly Pick<SplitecoGroupSummary, "name" | "madeIn" | "myPlan">[] | null,
): boolean {
  if (!groups) return false;
  const kitchens = groups.filter((g) => g.madeIn === "cookpool");
  const inPlan = (g: (typeof groups)[number]) => g.myPlan.some((m) => m.subjectId === p.subjectId);
  if (groups.some(inPlan)) return kitchens.some(inPlan);
  const names = new Set(p.groupNames);
  return kitchens.some((g) => names.has(g.name));
}

/** Home shows three people, then "See all N". */
export const HOME_PEOPLE = 3;

// ── Remind ────────────────────────────────────────────────────────

/** What the toast says when a reminder could not go (the server keeps the 24-hour rule). */
export function remindErrorText(reason: string | null, name: string, fallback: string): string {
  if (reason === "reminded_recently") return `You reminded ${name} in the last 24 hours`;
  if (reason === "nothing_owed") return `${name} doesn't owe you anything now`;
  return fallback;
}
