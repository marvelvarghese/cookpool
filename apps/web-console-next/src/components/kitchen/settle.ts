/**
 * Settling up (Cookpool CP-8) as a pure model: the working line, who pays
 * whom, a person's net from a group's plan, the "All groups" merge of every
 * group's payments that involve you, Home's summary, and the settlement a
 * Record posts. Dependency-free (contract types only), so it is unit-testable.
 *
 * Every group's plan comes from its own `…/settle-plan` (one call per group:
 * a server-side cross-group read arrives in CP-9). Groups can count in
 * different currencies, so totals are kept per currency.
 */

import type {
  CreateSettlementRequest,
  SettlePayment,
  SettlePlan,
  SettlementMethod,
} from "@saas/contracts/kitchen";
import { memberLabel, memberLabelInline } from "./members";

export interface GroupRef {
  id: string;
  name: string;
  slug: string;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "10 debts → 5 after pairs cancel → 3 payments" */
export function workingLine(working: SettlePlan["working"]): string {
  return `${plural(working.debts, "debt")} → ${working.pairs} after pairs cancel → ${plural(working.payments, "payment")}`;
}

/** The ways a payment can be recorded as made, in the order the chips show them. */
export const SETTLE_METHODS: readonly { id: Extract<SettlementMethod, "upi" | "cash" | "bank">; label: string }[] = [
  { id: "upi", label: "UPI" },
  { id: "cash", label: "Cash" },
  { id: "bank", label: "Bank" },
];

export type PaymentDirection = "you_pay" | "you_receive" | "others";

export function paymentDirection(p: SettlePayment, meId: string | null | undefined): PaymentDirection {
  if (meId && p.fromSubjectId === meId) return "you_pay";
  if (meId && p.toSubjectId === meId) return "you_receive";
  return "others";
}

/** "You pay Member · 3f9a", "Member · 3f9a pays you", "Member · 1a2b pays Member · 3f9a". */
export function paymentSentence(p: SettlePayment, meId: string | null | undefined): string {
  const from = memberLabel(p.fromSubjectId, meId);
  const to = memberLabelInline(p.toSubjectId, meId);
  return `${from} ${from === "You" ? "pay" : "pays"} ${to}`;
}

/**
 * A person's net in a group, from its plan: what they are paid minus what
 * they pay. The plan keeps every person's balance, so this is their balance
 * (positive: they get money back).
 */
export function netFromPlan(plan: Pick<SettlePlan, "payments">, subjectId: string): number {
  let net = 0;
  for (const p of plan.payments) {
    if (p.toSubjectId === subjectId) net += p.amountMinor;
    if (p.fromSubjectId === subjectId) net -= p.amountMinor;
  }
  return net;
}

/** The body Record posts: the planned payment, made by `method`. */
export function settlementRequest(p: SettlePayment, method: SettlementMethod): CreateSettlementRequest {
  return { fromSubjectId: p.fromSubjectId, toSubjectId: p.toSubjectId, amountMinor: p.amountMinor, method };
}

/** One group's plan as the screens hold it while the per-group calls come back. */
export interface GroupPlan {
  group: GroupRef;
  plan: SettlePlan | null;
  loading: boolean;
  failed: boolean;
}

export interface MergedPayment extends SettlePayment {
  group: GroupRef;
  currency: string;
  direction: Exclude<PaymentDirection, "others">;
}

export interface CurrencyTotals {
  currency: string;
  youPayMinor: number;
  youGetMinor: number;
}

export interface AllGroupsSettle {
  /** Every payment that involves you: what you pay first, then what you get; largest first, then by group. */
  payments: MergedPayment[];
  /** Per currency, in the order they first appear. */
  totals: CurrencyTotals[];
  /** Groups still loading, and groups whose plan couldn't be read. */
  pending: number;
  failed: GroupRef[];
}

/** "All groups": every group's payments that involve you, merged. */
export function mergeAllGroups(groups: readonly GroupPlan[], meId: string | null | undefined): AllGroupsSettle {
  const payments: MergedPayment[] = [];
  const failed: GroupRef[] = [];
  let pending = 0;
  for (const g of groups) {
    if (g.failed) {
      failed.push(g.group);
      continue;
    }
    if (!g.plan) {
      if (g.loading) pending += 1;
      continue;
    }
    for (const p of g.plan.payments) {
      const direction = paymentDirection(p, meId);
      if (direction === "others") continue;
      payments.push({ ...p, group: g.group, currency: g.plan.currency, direction });
    }
  }
  payments.sort(
    (x, y) =>
      (x.direction === y.direction ? 0 : x.direction === "you_pay" ? -1 : 1) ||
      y.amountMinor - x.amountMinor ||
      x.group.name.localeCompare(y.group.name, undefined, { sensitivity: "base", numeric: true }) ||
      (x.group.id < y.group.id ? -1 : x.group.id > y.group.id ? 1 : 0),
  );

  const totals: CurrencyTotals[] = [];
  for (const p of payments) {
    let t = totals.find((x) => x.currency === p.currency);
    if (!t) {
      t = { currency: p.currency, youPayMinor: 0, youGetMinor: 0 };
      totals.push(t);
    }
    if (p.direction === "you_pay") t.youPayMinor += p.amountMinor;
    else t.youGetMinor += p.amountMinor;
  }
  return { payments, totals, pending, failed };
}

export interface HomeGroupBalance {
  group: GroupRef;
  currency: string;
  /** Your balance in the group (positive: you get money back); never zero here. */
  netMinor: number;
}

export interface HomeSettleSummary {
  /** Groups where your balance isn't zero, largest first. */
  balances: HomeGroupBalance[];
  /** Some group's plan has a payment that involves you: show Settle up. */
  settleUp: boolean;
  /** Still waiting for some group's plan. */
  loading: boolean;
}

/** Home's balance card, from the same per-group plans. */
export function homeSettleSummary(groups: readonly GroupPlan[], meId: string | null | undefined): HomeSettleSummary {
  const balances: HomeGroupBalance[] = [];
  let settleUp = false;
  let loading = false;
  for (const g of groups) {
    if (!g.plan) {
      if (g.loading) loading = true;
      continue;
    }
    if (!meId) continue;
    if (g.plan.payments.some((p) => paymentDirection(p, meId) !== "others")) settleUp = true;
    const netMinor = netFromPlan(g.plan, meId);
    if (netMinor !== 0) balances.push({ group: g.group, currency: g.plan.currency, netMinor });
  }
  balances.sort(
    (x, y) =>
      Math.abs(y.netMinor) - Math.abs(x.netMinor) ||
      x.group.name.localeCompare(y.group.name, undefined, { sensitivity: "base", numeric: true }),
  );
  return { balances, settleUp, loading };
}

/** The value of the "All groups" choice in the settle-up group picker. */
export const ALL_GROUPS = "all";

/**
 * Which group /settle opens on: the `?group=` it was opened with, when that is
 * one of the person's groups, else All groups.
 */
export function initialSettleChoice(groupParam: string | null | undefined, groups: readonly GroupRef[]): string {
  if (groupParam && groups.some((g) => g.slug === groupParam)) return groupParam;
  return ALL_GROUPS;
}
