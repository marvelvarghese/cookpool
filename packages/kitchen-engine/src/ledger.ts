// The Cookpool ledger, as pure functions. A transaction lives in one group's
// ledger and is a list of splits: who paid what, who owes what. Every
// transaction satisfies Σ paid = Σ owed = total. Balances, pairwise debts,
// the fewest-payments plan and the per-person "why" view are all derived
// from transactions; nothing here touches storage.

import { MoneyError, assertMinor, splitBy, splitByWeights, splitEqual, type SplitMode } from "./money.js";

export type TxnKind = "expense" | "use" | "dish" | "waste" | "settlement" | "reversal";

export interface Split {
  readonly subjectId: string;
  readonly paidMinor: number;
  readonly owedMinor: number;
}

export interface Txn {
  readonly id: string;
  readonly kind: TxnKind;
  readonly title: string;
  readonly totalMinor: number;
  readonly splits: readonly Split[];
  readonly occurredAt?: string | undefined;
  readonly reverses?: string | null | undefined;
}

export class LedgerError extends Error {
  constructor(
    readonly code: "unbalanced" | "invalid_split" | "claims_exceed_portions" | "no_eaters" | "same_person",
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/** Combine rows for the same person and drop all-zero rows. Order is kept. */
export function mergeSplits(rows: readonly Split[]): Split[] {
  const order: string[] = [];
  const acc = new Map<string, { paid: number; owed: number }>();
  for (const r of rows) {
    const cur = acc.get(r.subjectId);
    if (cur) {
      cur.paid += r.paidMinor;
      cur.owed += r.owedMinor;
    } else {
      order.push(r.subjectId);
      acc.set(r.subjectId, { paid: r.paidMinor, owed: r.owedMinor });
    }
  }
  return order
    .map((subjectId) => ({ subjectId, paidMinor: acc.get(subjectId)!.paid, owedMinor: acc.get(subjectId)!.owed }))
    .filter((s) => s.paidMinor !== 0 || s.owedMinor !== 0);
}

export function assertBalanced(totalMinor: number, splits: readonly Split[]): void {
  let paid = 0;
  let owed = 0;
  for (const s of splits) {
    if (!Number.isSafeInteger(s.paidMinor) || !Number.isSafeInteger(s.owedMinor)) {
      throw new LedgerError("invalid_split", "split amounts must be whole minor units");
    }
    paid += s.paidMinor;
    owed += s.owedMinor;
  }
  if (paid !== totalMinor || owed !== totalMinor) {
    throw new LedgerError("unbalanced", `paid ${paid} and owed ${owed} must both equal ${totalMinor}`);
  }
}

// ── Builders: one per kind of money event ────────────────────────────────

export interface ExpenseInput {
  readonly totalMinor: number;
  readonly payers: readonly { subjectId: string; amountMinor: number }[];
  readonly mode: SplitMode;
  /** Participants in order; `value` is ignored for equal, the amount for exact, % for percent, shares for shares. */
  readonly participants: readonly { subjectId: string; value?: number }[];
}

export function buildExpense(input: ExpenseInput): Split[] {
  assertMinor(input.totalMinor, "total");
  if (input.participants.length === 0) throw new LedgerError("invalid_split", "pick at least one person");
  const paidSum = input.payers.reduce((a, p) => a + p.amountMinor, 0);
  if (paidSum !== input.totalMinor) throw new LedgerError("unbalanced", "what was paid must equal the total");
  const owed = splitBy(input.mode, input.totalMinor, input.participants.map((p) => p.value ?? 1));
  const rows: Split[] = [
    ...input.payers.map((p) => ({ subjectId: p.subjectId, paidMinor: p.amountMinor, owedMinor: 0 })),
    ...input.participants.map((p, i) => ({ subjectId: p.subjectId, paidMinor: 0, owedMinor: owed[i]! })),
  ];
  const splits = mergeSplits(rows);
  assertBalanced(input.totalMinor, splits);
  return splits;
}

/**
 * Using some of a group item: the buyer is paid back the cost, and the people
 * who had it owe it, equally unless amounts are given. A buyer who used some
 * appears on both sides, so their own share nets to zero.
 */
export function buildUse(input: {
  readonly costMinor: number;
  readonly buyerId: string;
  readonly consumers: readonly string[];
  readonly weights?: readonly number[];
}): Split[] {
  assertMinor(input.costMinor, "cost");
  if (input.consumers.length === 0) throw new LedgerError("invalid_split", "pick who had it");
  const owed = input.weights
    ? splitByWeights(input.costMinor, input.weights)
    : splitEqual(input.costMinor, input.consumers.length);
  const splits = mergeSplits([
    { subjectId: input.buyerId, paidMinor: input.costMinor, owedMinor: 0 },
    ...input.consumers.map((c, i) => ({ subjectId: c, paidMinor: 0, owedMinor: owed[i]! })),
  ]);
  assertBalanced(input.costMinor, splits);
  return splits;
}

/**
 * Ingredients a cook took from one group's pantry for a dish: each buyer is
 * paid back, the cook owes it all. `lines` may hold several items and buyers.
 */
export function buildIngredientTake(input: {
  readonly cookId: string;
  readonly lines: readonly { buyerId: string; costMinor: number }[];
}): { totalMinor: number; splits: Split[] } {
  const totalMinor = input.lines.reduce((a, l) => a + l.costMinor, 0);
  const splits = mergeSplits([
    ...input.lines.map((l) => ({ subjectId: l.buyerId, paidMinor: l.costMinor, owedMinor: 0 })),
    { subjectId: input.cookId, paidMinor: 0, owedMinor: totalMinor },
  ]);
  assertBalanced(totalMinor, splits);
  return { totalMinor, splits };
}

export interface DishShare {
  readonly subjectId: string;
  /** Half portions (1 = ½, 2 = 1, 3 = 1½ …). */
  readonly portionsHalf?: number;
  /** A fixed amount instead of portions. */
  readonly exactMinor?: number;
}

/**
 * A dish shared with a group: the cook paid the whole total, and the eaters
 * owe it. Exact amounts come off the top; the rest is split by portions.
 * Portions nobody claimed fall to the cook.
 */
export function buildDish(input: {
  readonly cookId: string;
  readonly totalMinor: number;
  readonly portionsHalf: number;
  readonly shares: readonly DishShare[];
}): { splits: Split[]; unclaimedHalf: number; owedBy: Map<string, number> } {
  assertMinor(input.totalMinor, "total");
  if (!Number.isInteger(input.portionsHalf) || input.portionsHalf < 1) {
    throw new LedgerError("invalid_split", "a dish has at least half a portion");
  }
  const exactSum = input.shares.reduce((a, s) => a + (s.exactMinor ?? 0), 0);
  if (exactSum > input.totalMinor) throw new LedgerError("invalid_split", "fixed amounts exceed the dish total");
  const claimedHalf = input.shares.reduce((a, s) => a + (s.exactMinor === undefined ? (s.portionsHalf ?? 0) : 0), 0);
  if (claimedHalf > input.portionsHalf) {
    throw new LedgerError("claims_exceed_portions", "more portions are claimed than were cooked");
  }
  const unclaimedHalf = input.portionsHalf - claimedHalf;
  const rest = input.totalMinor - exactSum;

  // Portion weights, with unclaimed portions added to the cook.
  const portionHolders: { subjectId: string; weight: number }[] = input.shares
    .filter((s) => s.exactMinor === undefined && (s.portionsHalf ?? 0) > 0)
    .map((s) => ({ subjectId: s.subjectId, weight: s.portionsHalf! }));
  if (unclaimedHalf > 0) {
    const cook = portionHolders.find((p) => p.subjectId === input.cookId);
    if (cook) cook.weight += unclaimedHalf;
    else portionHolders.push({ subjectId: input.cookId, weight: unclaimedHalf });
  }
  const owedBy = new Map<string, number>();
  for (const s of input.shares) {
    if (s.exactMinor !== undefined) owedBy.set(s.subjectId, (owedBy.get(s.subjectId) ?? 0) + s.exactMinor);
  }
  if (rest > 0) {
    if (portionHolders.length === 0) throw new LedgerError("no_eaters", "nobody to split the rest between");
    const parts = splitByWeights(rest, portionHolders.map((p) => p.weight));
    portionHolders.forEach((p, i) => owedBy.set(p.subjectId, (owedBy.get(p.subjectId) ?? 0) + parts[i]!));
  }
  const splits = mergeSplits([
    { subjectId: input.cookId, paidMinor: input.totalMinor, owedMinor: 0 },
    ...[...owedBy.entries()].map(([subjectId, owed]) => ({ subjectId, paidMinor: 0, owedMinor: owed })),
  ]);
  assertBalanced(input.totalMinor, splits);
  return { splits, unclaimedHalf, owedBy };
}

/** Waste under "split equally": the buyer is paid back by every member. */
export function buildWaste(input: { readonly unusedMinor: number; readonly buyerId: string; readonly members: readonly string[] }): Split[] {
  return buildUse({ costMinor: input.unusedMinor, buyerId: input.buyerId, consumers: input.members });
}

/** A records paying B: A's balance goes up, B's goes down. */
export function buildSettlement(input: { readonly fromId: string; readonly toId: string; readonly amountMinor: number }): Split[] {
  assertMinor(input.amountMinor, "amount");
  if (input.amountMinor === 0) throw new MoneyError("invalid_amount", "a payment must be more than zero");
  if (input.fromId === input.toId) throw new LedgerError("same_person", "a payment needs two different people");
  return [
    { subjectId: input.fromId, paidMinor: input.amountMinor, owedMinor: 0 },
    { subjectId: input.toId, paidMinor: 0, owedMinor: input.amountMinor },
  ];
}

/** The reversal of a transaction swaps paid and owed, so the two cancel. */
export function reverseSplits(splits: readonly Split[]): Split[] {
  return splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor }));
}

// ── Reading the ledger ───────────────────────────────────────────────────

/** Each person's balance: Σ paid − Σ owed. Positive means they get money back. */
export function balances(txns: readonly Txn[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txns) {
    for (const s of t.splits) {
      out.set(s.subjectId, (out.get(s.subjectId) ?? 0) + s.paidMinor - s.owedMinor);
    }
  }
  return out;
}

export interface PairLine {
  readonly txnId: string;
  readonly kind: TxnKind;
  readonly title: string;
  readonly occurredAt?: string | undefined;
  /** Who owes whom, for this transaction alone. */
  readonly debtorId: string;
  readonly creditorId: string;
  readonly amountMinor: number;
}

/**
 * Attribute every transaction pairwise. Inside one transaction, each person's
 * net (paid − owed) is computed, so your own share of something you paid for
 * is never a debt; then the people who are owed are matched against the
 * people who owe, in split order. With one payer this is exactly "everyone
 * owes the payer their share"; with several payers the lines still add up to
 * every person's net to the paisa.
 */
export function pairLines(txns: readonly Txn[]): PairLine[] {
  const lines: PairLine[] = [];
  for (const t of txns) {
    const creditors = t.splits.map((s) => ({ id: s.subjectId, v: s.paidMinor - s.owedMinor })).filter((x) => x.v > 0);
    const debtors = t.splits.map((s) => ({ id: s.subjectId, v: s.owedMinor - s.paidMinor })).filter((x) => x.v > 0);
    let c = 0;
    for (const d of debtors) {
      while (d.v > 0 && c < creditors.length) {
        const cr = creditors[c]!;
        const amount = Math.min(d.v, cr.v);
        lines.push({
          txnId: t.id, kind: t.kind, title: t.title, occurredAt: t.occurredAt,
          debtorId: d.id, creditorId: cr.id, amountMinor: amount,
        });
        d.v -= amount;
        cr.v -= amount;
        if (cr.v === 0) c += 1;
      }
    }
  }
  return lines;
}

export interface Payment {
  readonly fromId: string;
  readonly toId: string;
  readonly amountMinor: number;
}

export interface SettlePlan {
  readonly payments: Payment[];
  readonly working: { readonly debts: number; readonly pairs: number; readonly payments: number };
}

/**
 * The fewest-payments plan: repeatedly pair the largest creditor with the
 * largest debtor. Ties break by subject id so the plan is stable. At most
 * n − 1 payments, and every person's net is kept exactly.
 */
export function settlePlan(txns: readonly Txn[]): SettlePlan {
  const bal = balances(txns);
  const creditors = [...bal.entries()].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const debtors = [...bal.entries()].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const order = (a: { id: string; v: number }, b: { id: string; v: number }) => (b.v - a.v) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const payments: Payment[] = [];
  creditors.sort(order);
  debtors.sort(order);
  while (creditors.length > 0 && debtors.length > 0) {
    const c = creditors[0]!;
    const d = debtors[0]!;
    const amount = Math.min(c.v, d.v);
    payments.push({ fromId: d.id, toId: c.id, amountMinor: amount });
    c.v -= amount;
    d.v -= amount;
    if (c.v === 0) creditors.shift();
    if (d.v === 0) debtors.shift();
    creditors.sort(order);
    debtors.sort(order);
  }
  // The working: directed debts the transactions created, then pairs left once
  // opposite debts between two people cancel.
  const directed = new Map<string, number>();
  for (const l of pairLines(txns)) {
    const key = `${l.debtorId}\u0000${l.creditorId}`;
    directed.set(key, (directed.get(key) ?? 0) + l.amountMinor);
  }
  const pairNet = new Map<string, number>();
  for (const [key, amount] of directed) {
    const [a, b] = key.split("\u0000") as [string, string];
    const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
    const pk = `${lo}\u0000${hi}`;
    pairNet.set(pk, (pairNet.get(pk) ?? 0) + sign * amount);
  }
  const debts = [...directed.values()].filter((v) => v !== 0).length;
  const pairs = [...pairNet.values()].filter((v) => v !== 0).length;
  return { payments, working: { debts, pairs, payments: payments.length } };
}

export interface PersonView {
  /** Every transaction line between the two, signed from `meId`'s side: + they owe me. */
  readonly lines: (PairLine & { signedMinor: number })[];
  /** Σ of the lines: positive means `otherId` owes `meId`. */
  readonly pairwiseMinor: number;
  /** What the settle plan asks this pair to pay: positive means other pays me. */
  readonly planMinor: number;
  /** The difference the group's simplification routes through this pair. */
  readonly shortcutMinor: number;
}

export function personView(txns: readonly Txn[], meId: string, otherId: string): PersonView {
  const lines = pairLines(txns)
    .filter((l) => (l.debtorId === otherId && l.creditorId === meId) || (l.debtorId === meId && l.creditorId === otherId))
    .map((l) => ({ ...l, signedMinor: l.creditorId === meId ? l.amountMinor : -l.amountMinor }));
  const pairwiseMinor = lines.reduce((a, l) => a + l.signedMinor, 0);
  const plan = settlePlan(txns).payments;
  const planMinor = plan.reduce((a, p) => {
    if (p.fromId === otherId && p.toId === meId) return a + p.amountMinor;
    if (p.fromId === meId && p.toId === otherId) return a - p.amountMinor;
    return a;
  }, 0);
  return { lines, pairwiseMinor, planMinor, shortcutMinor: planMinor - pairwiseMinor };
}
