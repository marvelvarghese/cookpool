// Quantities for Cookpool. Every quantity is stored as an integer number of
// thousandths of its dimension's base unit: pieces, grams, millilitres, packs.
// Display units convert inside a dimension only; there is no conversion across
// dimensions (an egg is a piece, never 50 g). Pure functions only.

export type Dimension = "count" | "mass" | "volume" | "pack";

export interface UnitDef {
  readonly dimension: Dimension;
  /** How many base units one of this unit is. */
  readonly factor: number;
  readonly singular: string;
  readonly plural: string;
}

export const UNITS = {
  pcs: { dimension: "count", factor: 1, singular: "pc", plural: "pcs" },
  dozen: { dimension: "count", factor: 12, singular: "dozen", plural: "dozen" },
  g: { dimension: "mass", factor: 1, singular: "g", plural: "g" },
  kg: { dimension: "mass", factor: 1000, singular: "kg", plural: "kg" },
  ml: { dimension: "volume", factor: 1, singular: "ml", plural: "ml" },
  L: { dimension: "volume", factor: 1000, singular: "L", plural: "L" },
  tsp: { dimension: "volume", factor: 5, singular: "tsp", plural: "tsp" },
  tbsp: { dimension: "volume", factor: 15, singular: "tbsp", plural: "tbsp" },
  cup: { dimension: "volume", factor: 240, singular: "cup", plural: "cups" },
  pack: { dimension: "pack", factor: 1, singular: "pack", plural: "packs" },
} as const satisfies Record<string, UnitDef>;

export type UnitKey = keyof typeof UNITS;

export const UNIT_KEYS = Object.keys(UNITS) as UnitKey[];

export class UnitError extends Error {
  constructor(
    readonly code: "unknown_unit" | "invalid_quantity" | "unit_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "UnitError";
  }
}

export function isUnit(value: unknown): value is UnitKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(UNITS, value);
}

export function unitDef(unit: string): UnitDef {
  if (!isUnit(unit)) throw new UnitError("unknown_unit", `unknown unit "${unit}"`);
  return UNITS[unit];
}

export function dimensionOf(unit: string): Dimension {
  return unitDef(unit).dimension;
}

/**
 * Parse a decimal quantity ("1.25", "0.5", 3) given in `unit` into integer
 * thousandths of the base unit. Parsing is done on the decimal string so
 * 0.1 + 0.2 style float error never reaches storage.
 */
export function toMilli(quantity: number | string, unit: string): number {
  const def = unitDef(unit);
  const text = typeof quantity === "number" ? numberToPlain(quantity) : quantity.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new UnitError("invalid_quantity", `"${quantity}" is not a quantity`);
  const whole = BigInt(match[1]!);
  const fracDigits = (match[2] ?? "").slice(0, 9);
  const frac = fracDigits === "" ? 0n : BigInt(fracDigits);
  const fracScale = 10n ** BigInt(fracDigits.length);
  // value × factor × 1000, rounded half up.
  const numerator = (whole * fracScale + frac) * BigInt(def.factor) * 1000n;
  const milli = (numerator * 2n + fracScale) / (2n * fracScale);
  if (milli <= 0n) throw new UnitError("invalid_quantity", "quantity must be more than zero");
  if (milli > BigInt(Number.MAX_SAFE_INTEGER)) throw new UnitError("invalid_quantity", "quantity is too large");
  return Number(milli);
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, "");
}

/** The quantity in `unit`, as a number (for display and arithmetic in the UI). */
export function fromMilli(milli: number, unit: string): number {
  const def = unitDef(unit);
  return milli / 1000 / def.factor;
}

export function assertSameDimension(a: string, b: string): void {
  if (dimensionOf(a) !== dimensionOf(b)) {
    throw new UnitError("unit_mismatch", `${a} and ${b} measure different things`);
  }
}

/** The friendliest unit to show a quantity in: kg over 1000 g, L over 1000 ml. */
export function bestUnit(milli: number, dimension: Dimension, preferred?: string): UnitKey {
  if (preferred && isUnit(preferred) && UNITS[preferred].dimension === dimension && preferred !== "dozen" && preferred !== "cup" && preferred !== "tsp" && preferred !== "tbsp") {
    if (preferred === "kg" && milli < 1_000_000) return "g";
    if (preferred === "L" && milli < 1_000_000) return "ml";
    return preferred;
  }
  switch (dimension) {
    case "mass":
      return milli >= 1_000_000 ? "kg" : "g";
    case "volume":
      return milli >= 1_000_000 ? "L" : "ml";
    case "pack":
      return "pack";
    default:
      return "pcs";
  }
}

export function formatQuantity(milli: number, dimension: Dimension, preferred?: string): string {
  const unit = bestUnit(milli, dimension, preferred);
  const value = fromMilli(milli, unit);
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  const def = UNITS[unit];
  return `${text} ${rounded === 1 ? def.singular : def.plural}`;
}

/** Price per one `unit` of an item, in minor units (for "₹40/kg" labels). */
export function pricePerUnit(priceMinor: number, qtyBoughtMilli: number, unit: string): number {
  const def = unitDef(unit);
  if (qtyBoughtMilli <= 0) return 0;
  return Math.round((priceMinor * def.factor * 1000) / qtyBoughtMilli);
}
