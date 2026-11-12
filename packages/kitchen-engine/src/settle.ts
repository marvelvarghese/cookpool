// Settling up (cookpool-spliteco SE-3), as pure functions over the ledger.
//
//   - The plan a group settles by: the fewest payments (`settlePlan`) when the
//     group simplifies debts, else each pair's own net (`pairwisePlan`).
//   - What a payer owes a payee in each balance (bucket), from that plan.
//   - How one payment is split across a kitchen group's two balances
//     (design §0.11): Kitchen first, then Other, unless the payer says how;
//     never more than is owed in either, so a payment can't overshoot.

import { pairLines, settlePlan, type Payment, type Txn } from "./ledger.js";

/**
 * Each pair's own net, without routing through anyone else: Σ of the
 * pairwise lines, opposite debts cancelled. One payment per pair that owes.
 * Every person's net is kept exactly, as with the simplified plan.
 */
export function pairwisePlan(txns: readonly Txn[]): Payment[] {
  const net = new Map<string, number>();
  for (const l of pairLines(txns)) {
    const [lo, hi, sign] = l.debtorId < l.creditorId ? [l.debtorId, l.creditorId, 1] : [l.creditorId, l.debtorId, -1];
    const key = `${lo}\u0000${hi}`;
    net.set(key, (net.get(key) ?? 0) + sign * l.amountMinor);
  }
  const out: Payment[] = [];
  for (const [key, amount] of net) {
    if (amount === 0) continue;
    const [lo, hi] = key.split("\u0000") as [string, string];
    // `lo` was the debtor of a positive sum.
    out.push(amount > 0 ? { fromId: lo, toId: hi, amountMinor: amount } : { fromId: hi, toId: lo, amountMinor: -amount });
  }
  return out.sort((a, b) => b.amountMinor - a.amountMinor || (a.fromId < b.fromId ? -1 : a.fromId > b.fromId ? 1 : a.toId < b.toId ? -1 : 1));
}

/** The plan a group settles by: the fewest payments when it simplifies debts, else pair by pair. */
export function planFor(txns: readonly Txn[], simplify: boolean): Payment[] {
  return simplify ? settlePlan(txns).payments : pairwisePlan(txns);
}

/** What `fromId` is asked to pay `toId` in a plan (0 when nothing). */
export function plannedBetween(plan: readonly Payment[], fromId: string, toId: string): number {
  return plan.filter((p) => p.fromId === fromId && p.toId === toId).reduce((a, p) => a + p.amountMinor, 0);
}

export type SettleBucket = "kitchen" | "other";

/** The order a payment fills a group's balances in (design §0.11): Kitchen first. */
export const SETTLE_ORDER: readonly SettleBucket[] = ["kitchen", "other"];

export type Allocation = Record<SettleBucket, number>;

export type AllocationResult =
  | { ok: true; allocation: Allocation }
  | {
      ok: false;
      /**
       * over_owed: more than is owed in all (or, with a split given, in one balance);
       * split_mismatch: the split given does not add up to the amount;
       * nothing_owed: nothing is owed at all.
       */
      reason: "over_owed" | "split_mismatch" | "nothing_owed";
      owed: Allocation;
    };

/**
 * Split one payment of `amountMinor` across the balances it pays. `owed` is
 * what the payer owes the payee in each (negative or zero: nothing). Without
 * `split`, it fills Kitchen first, then Other. With `split`, the payer's own
 * amounts are used, each within what is owed there, adding up to the amount.
 * Paying more than is owed is refused, never parked as credit.
 */
export function allocatePayment(input: { owed: Allocation; amountMinor: number; split?: Partial<Allocation> | null }): AllocationResult {
  const owed: Allocation = { kitchen: Math.max(0, input.owed.kitchen), other: Math.max(0, input.owed.other) };
  const total = owed.kitchen + owed.other;
  if (total === 0) return { ok: false, reason: "nothing_owed", owed };
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return { ok: false, reason: "split_mismatch", owed };
  if (input.split) {
    const allocation: Allocation = { kitchen: input.split.kitchen ?? 0, other: input.split.other ?? 0 };
    for (const b of SETTLE_ORDER) {
      if (!Number.isSafeInteger(allocation[b]) || allocation[b] < 0) return { ok: false, reason: "split_mismatch", owed };
    }
    if (allocation.kitchen + allocation.other !== input.amountMinor) return { ok: false, reason: "split_mismatch", owed };
    if (allocation.kitchen > owed.kitchen || allocation.other > owed.other) return { ok: false, reason: "over_owed", owed };
    return { ok: true, allocation };
  }
  if (input.amountMinor > total) return { ok: false, reason: "over_owed", owed };
  let left = input.amountMinor;
  const allocation: Allocation = { kitchen: 0, other: 0 };
  for (const b of SETTLE_ORDER) {
    const take = Math.min(left, owed[b]);
    allocation[b] = take;
    left -= take;
  }
  return { ok: true, allocation };
}
