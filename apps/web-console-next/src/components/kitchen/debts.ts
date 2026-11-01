/**
 * "Show the debts behind this" (Cookpool CP-8): the pairwise debts a group's
 * transactions created, grouped per pair of people, with what caused each.
 *
 * The lines come from the engine's `pairLines` — the attribution
 * kitchen-worker counts the settle plan's working with — over the whole
 * activity feed, so the counts here match the server's "N debts → M after
 * pairs cancel". Pure (the engine and contract types only), so it is
 * unit-testable.
 */

import type { KitchenTxn, KitchenTxnKind } from "@saas/contracts/kitchen";
import { pairLines, type Txn } from "@saas/kitchen-engine/ledger";

/** A transaction from the API as the engine reads it. */
export function toEngineTxn(t: KitchenTxn): Txn {
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    totalMinor: t.totalMinor,
    occurredAt: t.occurredAt,
    reverses: t.reverses,
    splits: t.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor })),
  };
}

export interface DebtLine {
  txnId: string;
  kind: KitchenTxnKind;
  title: string;
  occurredAt: string;
  /** Who owes whom, for this transaction alone. */
  debtorId: string;
  creditorId: string;
  amountMinor: number;
  /** The transaction has been undone (its reversal is also in the list). */
  reversed: boolean;
}

export interface PairDebts {
  /** The two people, in id order. */
  a: string;
  b: string;
  /** Who owes whom once their debts in both directions cancel; null when they cancel out. */
  debtorId: string | null;
  creditorId: string | null;
  netMinor: number;
  /** What caused it, newest first. */
  lines: DebtLine[];
}

export interface DebtsBehind {
  /** Pairs that still owe first (largest first), then the ones that cancelled out. */
  pairs: PairDebts[];
  /** Directed debts the transactions created (A owes B and B owes A count twice). */
  debts: number;
  /** Pairs left once opposite debts cancel. */
  pairsLeft: number;
}

export function debtsBehind(txns: readonly KitchenTxn[]): DebtsBehind {
  const byId = new Map(txns.map((t) => [t.id, t] as const));
  const directed = new Map<string, number>();
  const pairs = new Map<string, { a: string; b: string; net: number; lines: DebtLine[] }>();

  for (const l of pairLines(txns.map(toEngineTxn))) {
    const dk = `${l.debtorId}\u0000${l.creditorId}`;
    directed.set(dk, (directed.get(dk) ?? 0) + l.amountMinor);

    const [a, b] = l.debtorId < l.creditorId ? [l.debtorId, l.creditorId] : [l.creditorId, l.debtorId];
    const pk = `${a}\u0000${b}`;
    let pair = pairs.get(pk);
    if (!pair) {
      pair = { a, b, net: 0, lines: [] };
      pairs.set(pk, pair);
    }
    // Net from a's side: positive means b owes a.
    pair.net += l.creditorId === a ? l.amountMinor : -l.amountMinor;
    const txn = byId.get(l.txnId);
    pair.lines.push({
      txnId: l.txnId,
      kind: l.kind,
      title: l.title,
      occurredAt: l.occurredAt ?? txn?.occurredAt ?? "",
      debtorId: l.debtorId,
      creditorId: l.creditorId,
      amountMinor: l.amountMinor,
      reversed: txn?.reversed ?? false,
    });
  }

  const out: PairDebts[] = [...pairs.values()].map((p) => ({
    a: p.a,
    b: p.b,
    debtorId: p.net > 0 ? p.b : p.net < 0 ? p.a : null,
    creditorId: p.net > 0 ? p.a : p.net < 0 ? p.b : null,
    netMinor: Math.abs(p.net),
    // Newest first; the sort is stable, so lines of one moment keep their order.
    lines: p.lines.sort((x, y) => y.occurredAt.localeCompare(x.occurredAt)),
  }));
  out.sort(
    (x, y) =>
      y.netMinor - x.netMinor ||
      (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) ||
      (x.b < y.b ? -1 : x.b > y.b ? 1 : 0),
  );

  return {
    pairs: out,
    debts: [...directed.values()].filter((v) => v !== 0).length,
    pairsLeft: out.filter((p) => p.netMinor !== 0).length,
  };
}
