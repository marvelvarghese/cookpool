/**
 * Manage group (money-native MY-11), as pure rules: where its page lives,
 * who may change what, and when a group's currency may change. No React, so it
 * is unit-testable. The page itself is `money-manage-ui.tsx`.
 */

import type { SplitecoGroupResponse, SplitecoGroupSummary } from "@saas/contracts/spliteco";
import type { WastePolicy } from "@saas/contracts/kitchen";

/** A group's Manage page: its id (`org_…`) in the query, so any group on Money's list opens. */
export function moneyManageHref(groupId: string): string {
  return `/money/group?id=${encodeURIComponent(groupId)}`;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/** The group `/money/group?id=` names, or null when it is missing or malformed. */
export function manageGroupIdFrom(params: { get(name: string): string | null } | null | undefined): string | null {
  const id = params?.get("id") ?? null;
  return id && ID.test(id) ? id : null;
}

/** A kitchen group is one made in Cookpool; its page says "Linked to Kitchen". */
export function isKitchenGroup(group: Pick<SplitecoGroupSummary, "kind" | "madeIn">): boolean {
  return group.kind === "kitchen" || group.madeIn === "cookpool";
}

/** Owners and admins change a group's rules, currency and join link. */
export function canManageRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** What this person may change on the page. Everyone else sees the rows read only. */
export interface ManageRights {
  /** Simplify debts: whoever may write in the group (the server's `canWrite`). */
  simplify: boolean;
  /** Food that goes off, currency, join link: owners and admins of a kitchen group. */
  rules: boolean;
}

export function manageRights(detail: Pick<SplitecoGroupResponse, "group" | "canWrite">): ManageRights {
  const kitchen = isKitchenGroup(detail.group);
  return { simplify: detail.canWrite, rules: kitchen && canManageRole(detail.group.role) };
}

/**
 * Currency (risks Q1, default until the owner answers): entries are stored in
 * the currency they were made in, so changing it re-labels money. It may change
 * only while the group has no money entries; otherwise the setting warns and is
 * blocked, with the reason.
 */
export const CURRENCY_BLOCKED = "Can't change the currency: this group already has entries.";

export function hasMoneyEntries(detail: Pick<SplitecoGroupResponse, "expenses" | "balances" | "totalSpentMinor">): boolean {
  return detail.expenses.length > 0 || detail.totalSpentMinor !== 0 || detail.balances.some((b) => b.balanceMinor !== 0);
}

export type CurrencyChange = { ok: true } | { ok: false; reason: string };

export function currencyChange(
  detail: Pick<SplitecoGroupResponse, "expenses" | "balances" | "totalSpentMinor">,
  current: string,
  next: string,
): CurrencyChange {
  if (next === current) return { ok: true };
  return hasMoneyEntries(detail) ? { ok: false, reason: CURRENCY_BLOCKED } : { ok: true };
}

/** What a rule row says on the page. */
export const WASTE_ROW_WORDS: Record<WastePolicy, string> = {
  split_equally: "Split equally",
  buyer_absorbs: "The buyer absorbs it",
};

/** People rows: you first, then by name; each with their balance in the group's currency. */
export interface ManagePerson {
  subjectId: string;
  name: string;
  you: boolean;
  balanceMinor: number;
}

export function managePeople(detail: Pick<SplitecoGroupResponse, "members" | "balances">, meId: string | null): ManagePerson[] {
  const balance = new Map(detail.balances.map((b) => [b.subjectId, b.balanceMinor] as const));
  const rows = detail.members.map((m) => ({
    subjectId: m.subjectId,
    name: m.name ?? "Member",
    you: m.subjectId === meId,
    balanceMinor: balance.get(m.subjectId) ?? 0,
  }));
  return rows.sort((a, b) => Number(b.you) - Number(a.you) || a.name.localeCompare(b.name));
}
