// Tripeco's maths (tripeco TR-2, design §2): what a drive cost and who owes
// what, and a vehicle's real mileage from its fill-ups. Pure functions, shared
// by tripeco-worker (which stores what they say) and tripeco-web (which shows
// it while the person types). Money is integer paise; a ride is whole rupees.

import { splitByWeights } from "./money.js";

export type DriveFuel = "petrol" | "diesel" | "cng" | "electric";
export const DRIVE_FUELS: readonly DriveFuel[] = ["petrol", "diesel", "cng", "electric"];

/** What a fuel is bought in: litres, kilograms or kWh. */
export type DriveUnit = "l" | "kg" | "kWh";
export const DRIVE_UNIT: Record<DriveFuel, DriveUnit> = { petrol: "l", diesel: "l", cng: "kg", electric: "kWh" };

/** The longest a single ride may be, so a misread odometer cannot post (risk TR-A). */
export const DRIVE_MAX_KM = 2000;
/** How many full-tank segments the learned mileage averages over. */
export const DRIVE_SEGMENTS = 6;

/** Round paise to the nearest whole rupee (half up). */
export function toRupee(minor: number): number {
  return Math.round(minor / 100) * 100;
}

/** Kilometres to one decimal, as an odometer's Trip A shows them. */
export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

export interface DistanceInput {
  mode: "odo" | "trip";
  startKm: number | null;
  endKm: number | null;
  tripKm: number | null;
}

/** The ride's distance, or null while it is not known or does not make sense (end below start, past DRIVE_MAX_KM). */
export function rideKm(input: DistanceInput): number | null {
  let km: number | null = null;
  if (input.mode === "trip") km = input.tripKm;
  else if (input.startKm !== null && input.endKm !== null) km = input.endKm - input.startKm;
  if (km === null || !Number.isFinite(km) || km < 0 || km > DRIVE_MAX_KM) return null;
  return roundKm(km);
}

export interface CostInput {
  km: number;
  /** km per unit (litre, kg or kWh). */
  mileage: number;
  /** Paise per unit. */
  priceMinor: number;
  /** Paise per km; 0 when wear is off. */
  wearMinorPerKm: number;
  /** Tolls and parking, paise each. */
  extrasMinor: readonly number[];
}

export interface Cost {
  /** km ÷ mileage — what the drive burnt, in the fuel's unit. */
  quantity: number;
  fuelMinor: number;
  wearMinor: number;
  extrasMinor: number;
  totalMinor: number;
}

/** fuel = km ÷ mileage × price, wear = km × rate, both to the rupee; extras as typed (to the rupee). */
export function rideCost(input: CostInput): Cost {
  const quantity = input.mileage > 0 ? input.km / input.mileage : 0;
  const fuelMinor = toRupee(quantity * input.priceMinor);
  const wearMinor = toRupee(input.km * input.wearMinorPerKm);
  const extrasMinor = input.extrasMinor.reduce((sum, e) => sum + toRupee(Math.max(0, e)), 0);
  return { quantity, fuelMinor, wearMinor, extrasMinor, totalMinor: fuelMinor + wearMinor + extrasMinor };
}

export interface RiderInput {
  subjectId: string;
  /** In the split (false: tapped out). */
  on: boolean;
  /** How far they rode, 0 … the ride. */
  km: number;
}

export type SharesOutcome = { ok: true; shares: number[] } | { ok: false; reason: "no_riders" | "no_distance" };

/**
 * Each rider's share, in the riders' order, whole rupees by largest remainder:
 * fuel and wear by the km each rode, extras equally among those on. A rider
 * who is off owes 0. The shares add up to the cost's total exactly.
 */
export function rideShares(cost: Pick<Cost, "fuelMinor" | "wearMinor" | "extrasMinor">, riders: readonly RiderInput[]): SharesOutcome {
  const on = riders.map((r) => r.on);
  if (!on.some(Boolean)) return { ok: false, reason: "no_riders" };
  const driveRupees = (cost.fuelMinor + cost.wearMinor) / 100;
  const extrasRupees = cost.extrasMinor / 100;
  const kmWeights = riders.map((r) => (r.on ? Math.max(0, roundKm(r.km)) : 0));
  if (driveRupees > 0 && !kmWeights.some((w) => w > 0)) return { ok: false, reason: "no_distance" };
  const drive = driveRupees > 0 ? splitByWeights(driveRupees, kmWeights) : riders.map(() => 0);
  const extras = extrasRupees > 0 ? splitByWeights(extrasRupees, on.map((o) => (o ? 1 : 0))) : riders.map(() => 0);
  return { ok: true, shares: riders.map((_, i) => (drive[i]! + extras[i]!) * 100) };
}

export interface FillInput {
  odometerKm: number;
  /** Quantity ×1000 (millilitres, grams, Wh). */
  quantityMilli: number;
  amountMinor: number;
  full: boolean;
  /** When it was logged (ISO); ties on odometer are ordered by it. */
  loggedAt: string;
}

export interface MileageSegment {
  /** The odometer at the full fill-up that closed it. */
  endKm: number;
  km: number;
  quantity: number;
  /** km per unit, one decimal. */
  mileage: number;
}

export interface LearnedMileage {
  /** Oldest first, at most DRIVE_SEGMENTS. */
  segments: MileageSegment[];
  /** Σkm ÷ Σquantity over the segments, one decimal; null before the first segment. */
  mileage: number | null;
}

const byOdometer = (a: FillInput, b: FillInput): number => a.odometerKm - b.odometerKm || a.loggedAt.localeCompare(b.loggedAt);

/**
 * The mileage a vehicle really gets: every full fill-up after an earlier one
 * closes a segment — the km between the two, over everything put in after the
 * first up to and including the second (part fills count). Σkm ÷ Σquantity of
 * the last DRIVE_SEGMENTS segments (design §0.5).
 */
export function learnedMileage(fills: readonly FillInput[]): LearnedMileage {
  const sorted = [...fills].sort(byOdometer);
  const segments: MileageSegment[] = [];
  let lastFull: FillInput | null = null;
  let sinceMilli = 0;
  for (const fill of sorted) {
    if (lastFull) sinceMilli += fill.quantityMilli;
    if (!fill.full) continue;
    if (lastFull) {
      const km = fill.odometerKm - lastFull.odometerKm;
      const quantity = sinceMilli / 1000;
      if (km > 0 && quantity > 0) segments.push({ endKm: fill.odometerKm, km, quantity, mileage: roundKm(km / quantity) });
    }
    lastFull = fill;
    sinceMilli = 0;
  }
  const last = segments.slice(-DRIVE_SEGMENTS);
  const km = last.reduce((s, x) => s + x.km, 0);
  const quantity = last.reduce((s, x) => s + x.quantity, 0);
  return { segments: last, mileage: quantity > 0 ? roundKm(km / quantity) : null };
}

/** Paise per unit at a fill-up (amount ÷ quantity), or null when it has no quantity. */
export function unitPrice(fill: Pick<FillInput, "amountMinor" | "quantityMilli">): number | null {
  if (!(fill.quantityMilli > 0)) return null;
  return Math.round((fill.amountMinor * 1000) / fill.quantityMilli);
}

/** The price of the newest fill-up (by when it was logged), else null. */
export function lastPrice(fills: readonly FillInput[]): number | null {
  const newest = [...fills].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))[0];
  return newest ? unitPrice(newest) : null;
}

/** Paise per km: price ÷ mileage, plus wear. */
export function perKmMinor(priceMinor: number, mileage: number, wearMinorPerKm = 0): number {
  if (!(mileage > 0)) return 0;
  return Math.round(priceMinor / mileage) + wearMinorPerKm;
}
