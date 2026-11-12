// Spliteco's six ways to split one expense (cookpool-spliteco design §1),
// as pure functions shared by spliteco-worker (the source of truth) and the
// Spliteco app (its live "adds up" bar). Every amount is integer minor units
// and every rounding is Cookpool's largest-remainder rule (`splitByWeights`
// and its integer form), so the parts always add up to the total exactly.
//
//   equal    everyone the same
//   exact    typed amounts that must add up to the total
//   pct      basis points that must reach 100% (10 000)
//   shares   weights (1, 1, 2 …)
//   adjust   equal, then + or − on top for some; the rest re-balances
//   items    item by item: exact and % shares come off each item's total,
//            people on portions share what is left by weight; tax, service
//            and discount spread in proportion to each person's items

import { MoneyError, splitByIntegerWeights, splitEqual, splitShares } from "./money.js";
import { assertBalanced, mergeSplits, type Split } from "./ledger.js";

/** A portion is stored ×1000 (½ is 500) and a percentage in basis points (25% is 2500). */
export const PORTION_SCALE = 1000;
export const PCT_SCALE = 10_000;

export type ItemShareMode = "portion" | "pct" | "exact";

export interface ItemShareSpec {
  readonly subjectId: string;
  readonly mode: ItemShareMode;
  /** portion ×1000, basis points, or minor units. */
  readonly value: number;
}

export interface ItemSpec {
  readonly totalMinor: number;
  readonly shares: readonly ItemShareSpec[];
}

export type AdjustmentKind = "tax" | "service" | "discount";

export interface AdjustmentSpec {
  readonly kind: AdjustmentKind;
  /** Always positive: a discount is taken off. */
  readonly amountMinor: number;
}

export type SplitSpec =
  | { readonly method: "equal"; readonly participants: readonly string[] }
  | { readonly method: "exact"; readonly participants: readonly { subjectId: string; amountMinor: number }[] }
  | { readonly method: "pct"; readonly participants: readonly { subjectId: string; basisPoints: number }[] }
  | { readonly method: "shares"; readonly participants: readonly { subjectId: string; shares: number }[] }
  | { readonly method: "adjust"; readonly participants: readonly { subjectId: string; adjustMinor: number }[] }
  | { readonly method: "items"; readonly items: readonly ItemSpec[]; readonly adjustments: readonly AdjustmentSpec[] };

export type SplitMethod = SplitSpec["method"];

/** Why a split cannot be saved. The app shows these; the worker refuses with them. */
export type SplitProblem =
  | { readonly kind: "no_one" }
  | { readonly kind: "duplicate_person"; readonly subjectId: string }
  | { readonly kind: "invalid_value"; readonly subjectId: string }
  /** Σ owed differs from the total: `assignedMinor` of `totalMinor` (exact amounts, items plus adjustments). */
  | { readonly kind: "total_mismatch"; readonly totalMinor: number; readonly assignedMinor: number }
  | { readonly kind: "pct_not_100"; readonly basisPoints: number }
  /** Adjustments or a discount would leave someone owing less than nothing. */
  | { readonly kind: "negative_share"; readonly subjectId: string }
  /** Money left on an item nobody (or nobody on portions) takes. */
  | { readonly kind: "item_unassigned"; readonly item: number; readonly amountMinor: number }
  /** More assigned to an item than it costs. */
  | { readonly kind: "item_over"; readonly item: number; readonly amountMinor: number }
  | { readonly kind: "item_empty"; readonly item: number }
  /** What was paid does not add up to the total. */
  | { readonly kind: "payers_mismatch"; readonly totalMinor: number; readonly paidMinor: number };

/** One person's part of an itemized bill. */
export interface BreakdownLine {
  readonly subjectId: string;
  readonly itemsMinor: number;
  readonly adjustmentsMinor: number;
  readonly owedMinor: number;
}

export interface ItemResult {
  readonly totalMinor: number;
  /** What each person on the item pays for it, in the item's share order. */
  readonly amounts: readonly { subjectId: string; amountMinor: number }[];
  /** Money still to assign (+) or assigned beyond the item's cost (−); 0 when it adds up. */
  readonly gapMinor: number;
}

export interface OwedResult {
  /** Each person's share, in order of first appearance. Σ = the total. */
  readonly owed: readonly { subjectId: string; owedMinor: number }[];
  /** Items and adjustments per person (adjustments are 0 except for `items`). */
  readonly breakdown: readonly BreakdownLine[];
  /** Per item, for `items` only. */
  readonly items: readonly ItemResult[];
}

export type OwedOutcome = { ok: true; value: OwedResult } | { ok: false; problems: SplitProblem[] };

const isMinor = (v: number): boolean => Number.isSafeInteger(v) && v >= 0;

function duplicates(ids: readonly string[]): SplitProblem[] {
  const seen = new Set<string>();
  const out: SplitProblem[] = [];
  for (const id of ids) {
    if (seen.has(id)) out.push({ kind: "duplicate_person", subjectId: id });
    seen.add(id);
  }
  return out;
}

function plain(owed: { subjectId: string; owedMinor: number }[]): OwedResult {
  return {
    owed,
    breakdown: owed.map((o) => ({ subjectId: o.subjectId, itemsMinor: o.owedMinor, adjustmentsMinor: 0, owedMinor: o.owedMinor })),
    items: [],
  };
}

/** Ceiling of a non-negative bigint ratio, as a number of minor units. */
function ceilDiv(n: bigint, d: bigint): number {
  return Number((n + d - 1n) / d);
}

/**
 * One item: exact amounts and percentages come off its total, people on
 * portions share what is left by weight. Rounded once, over the whole item,
 * with exact shares over a common denominator, so exact amounts stay exact
 * and the parts add up to the item's total.
 */
export function splitItem(item: ItemSpec, index = 0): { result: ItemResult; problems: SplitProblem[] } {
  const problems: SplitProblem[] = [];
  const T = item.totalMinor;
  if (!isMinor(T)) {
    return { result: { totalMinor: 0, amounts: [], gapMinor: 0 }, problems: [{ kind: "item_empty", item: index }] };
  }
  problems.push(...duplicates(item.shares.map((s) => s.subjectId)));
  for (const s of item.shares) {
    if (!isMinor(s.value) || (s.mode === "pct" && s.value > PCT_SCALE)) problems.push({ kind: "invalid_value", subjectId: s.subjectId });
  }
  if (problems.length > 0) return { result: { totalMinor: T, amounts: [], gapMinor: 0 }, problems };
  if (item.shares.length === 0) {
    if (T > 0) problems.push({ kind: "item_unassigned", item: index, amountMinor: T });
    return { result: { totalMinor: T, amounts: [], gapMinor: T }, problems };
  }

  const t = BigInt(T);
  const K = BigInt(PCT_SCALE);
  let exact = 0n;
  let bp = 0n;
  let portions = 0n;
  for (const s of item.shares) {
    if (s.mode === "exact") exact += BigInt(s.value);
    else if (s.mode === "pct") bp += BigInt(s.value);
    else portions += BigInt(s.value);
  }
  // Everything ×10 000: what is left for the people on portions.
  const rest = K * t - K * exact - t * bp;
  if (rest < 0n) {
    const over = ceilDiv(-rest, K);
    problems.push({ kind: "item_over", item: index, amountMinor: over });
    return { result: { totalMinor: T, amounts: [], gapMinor: -over }, problems };
  }
  if (rest > 0n && portions === 0n) {
    const left = ceilDiv(rest, K);
    problems.push({ kind: "item_unassigned", item: index, amountMinor: left });
    return { result: { totalMinor: T, amounts: [], gapMinor: left }, problems };
  }

  // Exact share e → e·K·W; percentage p → T·p·W; portion w → rest·w, over
  // Σ = K·T·W (W = Σ portions, or 1 when nobody is on portions).
  const W = portions > 0n ? portions : 1n;
  const weights = item.shares.map((s) => {
    const v = BigInt(s.value);
    if (s.mode === "exact") return v * K * W;
    if (s.mode === "pct") return t * v * W;
    return rest * v;
  });
  const sum = weights.reduce((a, b) => a + b, 0n);
  const parts = sum === 0n ? weights.map(() => 0) : splitByIntegerWeights(T, weights);
  return {
    result: { totalMinor: T, amounts: item.shares.map((s, i) => ({ subjectId: s.subjectId, amountMinor: parts[i]! })), gapMinor: 0 },
    problems,
  };
}

/** Spread a signed amount over people in proportion to `bases` (largest remainder). */
function spread(amount: number, bases: readonly number[]): number[] {
  if (amount === 0) return bases.map(() => 0);
  const parts = splitByIntegerWeights(Math.abs(amount), bases.map((b) => BigInt(b)));
  return amount > 0 ? parts : parts.map((p) => -p);
}

function itemized(totalMinor: number, items: readonly ItemSpec[], adjustments: readonly AdjustmentSpec[]): OwedOutcome {
  const problems: SplitProblem[] = [];
  if (items.length === 0) return { ok: false, problems: [{ kind: "no_one" }] };
  const order: string[] = [];
  const itemsBy = new Map<string, number>();
  const results: ItemResult[] = [];
  items.forEach((item, i) => {
    const { result, problems: p } = splitItem(item, i);
    problems.push(...p);
    results.push(result);
    for (const a of result.amounts) {
      if (!itemsBy.has(a.subjectId)) {
        order.push(a.subjectId);
        itemsBy.set(a.subjectId, 0);
      }
      itemsBy.set(a.subjectId, itemsBy.get(a.subjectId)! + a.amountMinor);
    }
    // People on an item with nothing assigned still appear (they may owe 0).
    for (const s of item.shares) {
      if (!itemsBy.has(s.subjectId)) {
        order.push(s.subjectId);
        itemsBy.set(s.subjectId, 0);
      }
    }
  });
  let adjust = 0;
  for (const a of adjustments) {
    if (!isMinor(a.amountMinor)) {
      problems.push({ kind: "invalid_value", subjectId: a.kind });
      continue;
    }
    adjust += a.kind === "discount" ? -a.amountMinor : a.amountMinor;
  }
  const subtotal = items.reduce((s, it) => s + (isMinor(it.totalMinor) ? it.totalMinor : 0), 0);
  if (subtotal + adjust !== totalMinor) {
    problems.push({ kind: "total_mismatch", totalMinor, assignedMinor: subtotal + adjust });
  }
  if (problems.length > 0) return { ok: false, problems };

  const bases = order.map((id) => itemsBy.get(id)!);
  if (adjust !== 0 && bases.every((b) => b === 0)) return { ok: false, problems: [{ kind: "no_one" }] };
  const adjParts = spread(adjust, bases);
  const breakdown: BreakdownLine[] = order.map((subjectId, i) => ({
    subjectId,
    itemsMinor: bases[i]!,
    adjustmentsMinor: adjParts[i]!,
    owedMinor: bases[i]! + adjParts[i]!,
  }));
  const negative = breakdown.filter((b) => b.owedMinor < 0);
  if (negative.length > 0) return { ok: false, problems: negative.map((b) => ({ kind: "negative_share", subjectId: b.subjectId })) };
  return {
    ok: true,
    value: { owed: breakdown.map((b) => ({ subjectId: b.subjectId, owedMinor: b.owedMinor })), breakdown, items: results },
  };
}

/** Each person's share of `totalMinor` under `spec`, or every reason it cannot be saved. */
export function owedBySplit(totalMinor: number, spec: SplitSpec): OwedOutcome {
  if (!isMinor(totalMinor)) return { ok: false, problems: [{ kind: "total_mismatch", totalMinor: 0, assignedMinor: 0 }] };
  if (spec.method === "items") return itemized(totalMinor, spec.items, spec.adjustments);

  const ids: string[] =
    spec.method === "equal" ? [...spec.participants] : spec.participants.map((p: { subjectId: string }) => p.subjectId);
  if (ids.length === 0) return { ok: false, problems: [{ kind: "no_one" }] };
  const dup = duplicates(ids);
  if (dup.length > 0) return { ok: false, problems: dup };
  const zip = (parts: number[]) => ids.map((subjectId, i) => ({ subjectId, owedMinor: parts[i]! }));

  try {
    switch (spec.method) {
      case "equal":
        return { ok: true, value: plain(zip(splitEqual(totalMinor, ids.length))) };
      case "exact": {
        const bad = spec.participants.filter((p) => !isMinor(p.amountMinor));
        if (bad.length > 0) return { ok: false, problems: bad.map((p) => ({ kind: "invalid_value", subjectId: p.subjectId })) };
        const sum = spec.participants.reduce((s, p) => s + p.amountMinor, 0);
        if (sum !== totalMinor) return { ok: false, problems: [{ kind: "total_mismatch", totalMinor, assignedMinor: sum }] };
        return { ok: true, value: plain(zip(spec.participants.map((p) => p.amountMinor))) };
      }
      case "pct": {
        const bad = spec.participants.filter((p) => !isMinor(p.basisPoints) || p.basisPoints > PCT_SCALE);
        if (bad.length > 0) return { ok: false, problems: bad.map((p) => ({ kind: "invalid_value", subjectId: p.subjectId })) };
        const bp = spec.participants.reduce((s, p) => s + p.basisPoints, 0);
        if (bp !== PCT_SCALE) return { ok: false, problems: [{ kind: "pct_not_100", basisPoints: bp }] };
        return { ok: true, value: plain(zip(splitByIntegerWeights(totalMinor, spec.participants.map((p) => BigInt(p.basisPoints))))) };
      }
      case "shares": {
        const bad = spec.participants.filter((p) => !(Number.isFinite(p.shares) && p.shares >= 0 && p.shares <= 1_000_000));
        if (bad.length > 0) return { ok: false, problems: bad.map((p) => ({ kind: "invalid_value", subjectId: p.subjectId })) };
        if (spec.participants.every((p) => p.shares === 0)) return { ok: false, problems: [{ kind: "no_one" }] };
        return { ok: true, value: plain(zip(splitShares(totalMinor, spec.participants.map((p) => p.shares)))) };
      }
      case "adjust": {
        const bad = spec.participants.filter((p) => !Number.isSafeInteger(p.adjustMinor));
        if (bad.length > 0) return { ok: false, problems: bad.map((p) => ({ kind: "invalid_value", subjectId: p.subjectId })) };
        const adjusted = spec.participants.reduce((s, p) => s + p.adjustMinor, 0);
        const base = totalMinor - adjusted;
        if (base < 0) return { ok: false, problems: [{ kind: "total_mismatch", totalMinor, assignedMinor: adjusted }] };
        const equal = splitEqual(base, ids.length);
        const owed = equal.map((e, i) => e + spec.participants[i]!.adjustMinor);
        const negative = ids.filter((_, i) => owed[i]! < 0);
        if (negative.length > 0) return { ok: false, problems: negative.map((subjectId) => ({ kind: "negative_share", subjectId })) };
        return { ok: true, value: plain(zip(owed)) };
      }
    }
  } catch (err) {
    if (err instanceof MoneyError) return { ok: false, problems: [{ kind: "no_one" }] };
    throw err;
  }
}

export interface PayerSpec {
  readonly subjectId: string;
  readonly amountMinor: number;
}

export type SplitecoSplitsOutcome =
  | { ok: true; splits: Split[]; result: OwedResult }
  | { ok: false; problems: SplitProblem[] };

/**
 * The ledger splits of one expense: who paid (one or several people, adding
 * up to the total) and each person's share under `spec`. Someone who paid and
 * shares appears once, with both. Σ paid = Σ owed = total.
 */
export function buildSplitecoSplits(totalMinor: number, payers: readonly PayerSpec[], spec: SplitSpec): SplitecoSplitsOutcome {
  const problems: SplitProblem[] = [];
  if (payers.length === 0) problems.push({ kind: "payers_mismatch", totalMinor, paidMinor: 0 });
  problems.push(...duplicates(payers.map((p) => p.subjectId)));
  const bad = payers.filter((p) => !isMinor(p.amountMinor));
  problems.push(...bad.map((p) => ({ kind: "invalid_value" as const, subjectId: p.subjectId })));
  const paid = payers.reduce((s, p) => s + (isMinor(p.amountMinor) ? p.amountMinor : 0), 0);
  if (payers.length > 0 && paid !== totalMinor) problems.push({ kind: "payers_mismatch", totalMinor, paidMinor: paid });
  const owed = owedBySplit(totalMinor, spec);
  if (!owed.ok) problems.push(...owed.problems);
  if (problems.length > 0 || !owed.ok) return { ok: false, problems };

  const splits = mergeSplits([
    ...payers.map((p) => ({ subjectId: p.subjectId, paidMinor: p.amountMinor, owedMinor: 0 })),
    ...owed.value.owed.map((o) => ({ subjectId: o.subjectId, paidMinor: 0, owedMinor: o.owedMinor })),
  ]);
  if (splits.length === 0) return { ok: false, problems: [{ kind: "no_one" }] };
  assertBalanced(totalMinor, splits);
  return { ok: true, splits, result: owed.value };
}

/** Everyone a split names (payers aside), in order. */
export function splitPeople(spec: SplitSpec): string[] {
  if (spec.method === "equal") return [...spec.participants];
  if (spec.method === "items") {
    const out: string[] = [];
    for (const item of spec.items) for (const s of item.shares) if (!out.includes(s.subjectId)) out.push(s.subjectId);
    return out;
  }
  return spec.participants.map((p: { subjectId: string }) => p.subjectId);
}
