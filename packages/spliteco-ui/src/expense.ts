// Money-native MY-7: the expense box's logic. Two splits only, Equal and Exact
// (percent, shares and itemized stay in Spliteco). Pure: the box (expense-ui)
// draws it. Equal uses Cookpool's largest-remainder rule: floor each share,
// then the leftover paise go one each to the earliest people.

import type { SplitecoExpenseRequest } from "@saas/contracts/spliteco";
import { parseMoney } from "./money.js";

export type ExpenseSplitMethod = "equal" | "exact";

export interface ExpenseMember {
  subjectId: string;
  name: string | null;
}

/** A group the box can add to. A Cookpool group has exactly one currency. */
export interface ExpenseGroup {
  id: string;
  name: string;
  currency: string;
  members: readonly ExpenseMember[];
}

export interface ExpenseDraft {
  groupId: string;
  /** As typed: "860", "1,234.50". */
  amount: string;
  description: string;
  payerId: string;
  method: ExpenseSplitMethod;
  /** Equal: who shares it. */
  between: readonly string[];
  /** Exact: what each person typed, by subjectId. */
  exact: Readonly<Record<string, string>>;
}

export type ExpenseErrors = Partial<Record<"amount" | "description" | "group" | "payer" | "between" | "exact", string>>;

export type ExpenseCheck = { ok: true; request: SplitecoExpenseRequest } | { ok: false; errors: ExpenseErrors };

export const EXPENSE_TITLE_MAX = 120;

/** Split `total` minor units across `n` people; the parts add up to `total`, the first `total % n` get one more. */
export function equalShares(total: number, n: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || n < 1) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export function newExpense(group: ExpenseGroup | undefined, me: string): ExpenseDraft {
  const ids = group?.members.map((m) => m.subjectId) ?? [];
  return {
    groupId: group?.id ?? "",
    amount: "",
    description: "",
    payerId: ids.includes(me) ? me : (ids[0] ?? ""),
    method: "equal",
    between: ids,
    exact: {},
  };
}

/** Pick another group: who paid and who shares reset to its people. */
export function withGroup(draft: ExpenseDraft, group: ExpenseGroup, me: string): ExpenseDraft {
  return { ...newExpense(group, me), amount: draft.amount, description: draft.description, method: draft.method };
}

export function toggleSharer(draft: ExpenseDraft, subjectId: string): ExpenseDraft {
  const on = draft.between.includes(subjectId);
  return { ...draft, between: on ? draft.between.filter((id) => id !== subjectId) : [...draft.between, subjectId] };
}

export interface ShareRow {
  subjectId: string;
  /** Minor units; null while an Exact share is blank or not a number. */
  shareMinor: number | null;
}

/** Each person's share as the box shows it, in the group's order. Equal lists only those ticked. */
export function shareRows(draft: ExpenseDraft, group: ExpenseGroup | undefined): ShareRow[] {
  const members = group?.members ?? [];
  if (draft.method === "exact") {
    return members.map((m) => {
      const typed = draft.exact[m.subjectId] ?? "";
      return { subjectId: m.subjectId, shareMinor: typed.trim() === "" ? 0 : parseMoney(typed) };
    });
  }
  const sharing = members.filter((m) => draft.between.includes(m.subjectId));
  const total = parseMoney(draft.amount);
  const parts = total !== null && total > 0 ? equalShares(total, sharing.length) : [];
  const byId = new Map(sharing.map((m, i) => [m.subjectId, parts[i] ?? null]));
  return members.map((m) => ({ subjectId: m.subjectId, shareMinor: byId.has(m.subjectId) ? (byId.get(m.subjectId) ?? null) : 0 }));
}

/** Exact: the amount minus what the shares add to. 0 when it adds up, positive when short, negative when over; null when it cannot be told. */
export function exactGap(draft: ExpenseDraft, group: ExpenseGroup | undefined): number | null {
  const total = parseMoney(draft.amount);
  const rows = shareRows({ ...draft, method: "exact" }, group);
  if (total === null || rows.some((r) => r.shareMinor === null)) return null;
  return total - rows.reduce((a, r) => a + (r.shareMinor ?? 0), 0);
}

/** The request Save sends (the same body Spliteco's createExpense takes), or what is wrong. */
export function expenseRequest(draft: ExpenseDraft, groups: readonly ExpenseGroup[]): ExpenseCheck {
  const errors: ExpenseErrors = {};
  const group = groups.find((g) => g.id === draft.groupId);
  if (!group) errors.group = "Pick a group";
  const title = draft.description.trim().replace(/\s+/g, " ");
  if (!title) errors.description = "Say what it was";
  else if (title.length > EXPENSE_TITLE_MAX) errors.description = `At most ${EXPENSE_TITLE_MAX} characters`;
  const totalMinor = parseMoney(draft.amount);
  if (totalMinor === null || totalMinor <= 0) errors.amount = "Type the amount";
  const ids = (group?.members ?? []).map((m) => m.subjectId);
  if (!ids.includes(draft.payerId)) errors.payer = "Pick who paid";

  let split: SplitecoExpenseRequest["split"] | null = null;
  if (draft.method === "equal") {
    const participants = ids.filter((id) => draft.between.includes(id));
    if (participants.length === 0) errors.between = "Pick at least one person";
    else split = { method: "equal", participants };
  } else {
    const rows = shareRows(draft, group);
    const gap = exactGap(draft, group);
    const parts = rows.filter((r) => (r.shareMinor ?? 0) > 0).map((r) => ({ subjectId: r.subjectId, amountMinor: r.shareMinor! }));
    if (gap !== 0) errors.exact = gap === null ? "Type each share" : "Shares must add up to the amount";
    else if (parts.length === 0) errors.exact = "Type each share";
    else split = { method: "exact", participants: parts };
  }

  if (Object.keys(errors).length > 0 || !group || totalMinor === null || !split) return { ok: false, errors };
  return {
    ok: true,
    request: {
      title,
      totalMinor,
      currency: group.currency,
      payers: [{ subjectId: draft.payerId, amountMinor: totalMinor }],
      split,
    },
  };
}
