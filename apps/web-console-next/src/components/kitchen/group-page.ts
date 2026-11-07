/**
 * Groups and one group's page under the seven rules (Cookpool SM-11), as
 * pure view-models: a Groups row (your balance there as a number, no role
 * words), the group page's money line and its Settle up, the Balances
 * section's short lines, and the plain role words Settings uses.
 * Dependency-free apart from the app's pure helpers, so it is unit-testable.
 */

import type { BalancesResponse, MyGroupBalance } from "@saas/contracts/kitchen";
import type { GroupRole } from "./groups";
import { moneyLine, type MoneyLine } from "./home";
import { memberLabel, type MemberNames } from "./members";
import { formatMinor } from "./money";

/** Groups shows its search only from this many groups (past 8). */
export const GROUP_SEARCH_FROM = 9;

export function showGroupSearch(count: number): boolean {
  return count >= GROUP_SEARCH_FROM;
}

/** Activity rows a group's page shows before "See all". */
export const GROUP_ACTIVITY_ROWS = 5;
/** Dishes a group's page shows before "See all". */
export const GROUP_DISH_ROWS = 3;

export interface GroupListRow {
  name: string;
  /** "5 people"; null before the cross-group read has the group. */
  people: string | null;
  /** "You get back ₹86.50" / "You owe $25.00"; null when settled (no zero cells). */
  money: MoneyLine | null;
}

/** One row of Groups: its name, how many are in it and your balance there — no role words. */
export function groupListRow(
  group: { name: string },
  kitchen: Pick<MyGroupBalance, "balanceMinor" | "currency" | "memberCount"> | null | undefined,
): GroupListRow {
  return {
    name: group.name,
    people: kitchen ? `${kitchen.memberCount} ${kitchen.memberCount === 1 ? "person" : "people"}` : null,
    money: kitchen && kitchen.balanceMinor !== 0 ? moneyLine({ currency: kitchen.currency, netMinor: kitchen.balanceMinor }) : null,
  };
}

export interface GroupMoney {
  /** "You get back ₹62.50", "You owe ₹24.00", "Settled up". */
  line: MoneyLine;
  /** Settle up is offered only when you owe or are owed. */
  settleUp: boolean;
}

/** The group page's header money: your balance in the group, in its currency. */
export function groupMoney(data: Pick<BalancesResponse, "currency" | "balances">, meId: string | null): GroupMoney {
  const minor = meId ? (data.balances.find((b) => b.subjectId === meId)?.balanceMinor ?? 0) : 0;
  return { line: moneyLine({ currency: data.currency, netMinor: minor }), settleUp: minor !== 0 };
}

export interface GroupBalanceRow {
  subjectId: string;
  you: boolean;
  /** "You", "Dev Patel". */
  label: string;
  tone: "owed" | "owe";
  /** "gets back", "owes" ("get back", "owe" for you). */
  words: string;
  /** "₹86.50" */
  amount: string;
}

/**
 * The group page's Balances section: one short line for everyone else with
 * money open, the largest first — nobody at zero, and not you (your money is
 * the page's header: each amount shows once).
 */
export function groupBalanceRows(
  data: Pick<BalancesResponse, "currency" | "balances">,
  meId: string | null,
  names?: MemberNames | null,
): GroupBalanceRow[] {
  return data.balances
    .filter((b) => b.balanceMinor !== 0 && b.subjectId !== meId)
    .sort(
      (a, b) =>
        Math.abs(b.balanceMinor) - Math.abs(a.balanceMinor) ||
        (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0),
    )
    .map((b) => {
      const you = meId !== null && b.subjectId === meId;
      const owed = b.balanceMinor > 0;
      return {
        subjectId: b.subjectId,
        you,
        label: memberLabel(b.subjectId, meId, names),
        tone: owed ? "owed" : "owe",
        words: owed ? (you ? "get back" : "gets back") : you ? "owe" : "owes",
        amount: formatMinor(Math.abs(b.balanceMinor), data.currency),
      };
    });
}

/** A role in Settings, in plain words ("Can only view", not "Viewer"); null for a member, the usual case. */
export function roleWords(role: GroupRole | null): string | null {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "viewer") return "Can only view";
  return null;
}

/** Where a group's Settle up goes: People, filtered to the group (`/settle?group=` still leads there). */
export function groupSettleHref(slug: string): string {
  return `/people?group=${encodeURIComponent(slug)}`;
}
