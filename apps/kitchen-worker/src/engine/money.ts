// Money for Cookpool. Every amount is an integer number of minor units
// (paise for INR). Splits use largest-remainder rounding so the parts of a
// total always add up to the total exactly. Pure functions only: no I/O.

export class MoneyError extends Error {
  constructor(
    readonly code: "invalid_amount" | "invalid_weights" | "exact_mismatch" | "percent_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertMinor(value: number, field = "amount"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError("invalid_amount", `${field} must be a non-negative whole number of minor units`);
  }
}

/**
 * Split `total` across `weights` with largest-remainder rounding.
 * Every share is floor(total × w / Σw); the paise left over go one each to
 * the largest fractional parts, ties broken by position (earlier first).
 * Weights are non-negative numbers; at least one must be positive.
 * Uses BigInt so a large total times a large weight cannot lose precision.
 */
export function splitByWeights(total: number, weights: readonly number[]): number[] {
  assertMinor(total, "total");
  if (weights.length === 0) throw new MoneyError("invalid_weights", "no one to split between");
  // Scale fractional weights (percents with decimals, half portions) to integers.
  const scale = weightScale(weights);
  const w = weights.map((x) => {
    if (!(x >= 0) || !Number.isFinite(x)) throw new MoneyError("invalid_weights", "weights must be non-negative");
    return BigInt(Math.round(x * scale));
  });
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new MoneyError("invalid_weights", "at least one weight must be positive");
  const t = BigInt(total);
  const shares = w.map((x) => (t * x) / sum);
  const remainders = w.map((x, i) => ({ i, r: (t * x) % sum }));
  let left = t - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    if (w[i] === 0n) continue;
    shares[i]! += 1n;
    left -= 1n;
  }
  return shares.map((s) => Number(s));
}

function weightScale(weights: readonly number[]): number {
  let decimals = 0;
  for (const x of weights) {
    const s = String(x);
    const dot = s.indexOf(".");
    if (dot >= 0) decimals = Math.max(decimals, s.length - dot - 1);
  }
  return 10 ** Math.min(decimals, 6);
}

export function splitEqual(total: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new MoneyError("invalid_weights", "split between at least one person");
  return splitByWeights(total, new Array<number>(count).fill(1));
}

/** Exact amounts must already add up to the total. */
export function splitExact(total: number, amounts: readonly number[]): number[] {
  assertMinor(total, "total");
  amounts.forEach((a) => assertMinor(a));
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    throw new MoneyError("exact_mismatch", `amounts add up to ${sum}, not ${total}`);
  }
  return [...amounts];
}

/** Percentages must add up to 100 (two decimal places allowed). */
export function splitPercent(total: number, percents: readonly number[]): number[] {
  const sum = Math.round(percents.reduce((a, b) => a + b, 0) * 100);
  if (sum !== 10000) throw new MoneyError("percent_mismatch", "percentages must add up to 100");
  return splitByWeights(total, percents);
}

export function splitShares(total: number, shares: readonly number[]): number[] {
  return splitByWeights(total, shares);
}

export type SplitMode = "equal" | "exact" | "percent" | "shares";

export function splitBy(mode: SplitMode, total: number, values: readonly number[]): number[] {
  switch (mode) {
    case "equal":
      return splitEqual(total, values.length);
    case "exact":
      return splitExact(total, values);
    case "percent":
      return splitPercent(total, values);
    case "shares":
      return splitShares(total, values);
  }
}

/**
 * What using `qtyUsed` of an item costs. Proportional to what was paid, except
 * that the use which takes the last of the item costs whatever is left of its
 * price, so a fully used item has cost exactly its price.
 */
export function costOfUse(item: {
  priceMinor: number;
  qtyBoughtMilli: number;
  qtyLeftMilli: number;
  costTakenMinor: number;
}, qtyUsedMilli: number): number {
  assertMinor(item.priceMinor, "price");
  if (!Number.isSafeInteger(qtyUsedMilli) || qtyUsedMilli <= 0) {
    throw new MoneyError("invalid_amount", "quantity used must be positive");
  }
  if (qtyUsedMilli > item.qtyLeftMilli) {
    throw new MoneyError("invalid_amount", "not enough left");
  }
  const remaining = Math.max(0, item.priceMinor - item.costTakenMinor);
  if (qtyUsedMilli === item.qtyLeftMilli) return remaining;
  if (item.qtyBoughtMilli <= 0) return 0;
  const exact = (BigInt(item.priceMinor) * BigInt(qtyUsedMilli) * 2n + BigInt(item.qtyBoughtMilli)) / (2n * BigInt(item.qtyBoughtMilli));
  return Math.min(Number(exact), remaining);
}

const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

export function formatMinor(minor: number, currency = "INR"): string {
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${SYMBOLS[currency] ?? currency + " "}${whole}.${frac}`;
}
