// A ride as it is being edited (tripeco TR-6): the numbers the screen shows
// are worked out here with the same drive maths tripeco-worker stores
// (@saas/kitchen-engine/drive), so they move as the person types; the
// worker's answer to each save replaces them. Pure.

import { DRIVE_MAX_KM, rideCost, rideKm, rideShares } from "@saas/kitchen-engine/drive";
import type { TripecoExtra, TripecoRide, TripecoRidePatch } from "@saas/contracts/tripeco";

export interface DraftRider {
  subjectId: string;
  name: string;
  on: boolean;
  /** null: the whole ride */
  km: number | null;
}

export interface Draft {
  mode: TripecoRide["mode"];
  startKm: string;
  endKm: string;
  tripKm: string;
  priceRupees: string;
  mileage: number;
  wearOn: boolean;
  wearMinorPerKm: number;
  title: string;
  groupId: string | null;
  riders: DraftRider[];
  extras: TripecoExtra[];
}

const num = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function draftOf(ride: TripecoRide, names: Map<string, string>): Draft {
  return {
    mode: ride.mode,
    startKm: ride.startKm === null ? "" : String(ride.startKm),
    endKm: ride.endKm === null ? "" : String(ride.endKm),
    tripKm: ride.tripKm === null ? "" : String(ride.tripKm),
    priceRupees: String(ride.priceMinor / 100),
    mileage: ride.mileage,
    wearOn: ride.wearOn,
    wearMinorPerKm: ride.wearMinorPerKm,
    title: ride.titleTyped ? ride.title : "",
    groupId: ride.groupId,
    riders: ride.riders.map((r) => ({ subjectId: r.subjectId, name: names.get(r.subjectId) ?? "Someone", on: r.on, km: ride.km !== null && r.km < ride.km ? r.km : null })),
    extras: ride.extras,
  };
}

export interface Worked {
  km: number | null;
  fuelMinor: number;
  wearMinor: number;
  extrasMinor: number;
  totalMinor: number;
  quantity: number;
  /** per rider, in the riders' order */
  shares: number[];
  /** what everyone but the owner owes */
  othersMinor: number;
}

export function work(d: Draft, owner: string): Worked {
  const km = rideKm({ mode: d.mode, startKm: num(d.startKm), endKm: num(d.endKm), tripKm: num(d.tripKm) });
  const price = Math.round((num(d.priceRupees) ?? 0) * 100);
  if (km === null) return { km: null, fuelMinor: 0, wearMinor: 0, extrasMinor: 0, totalMinor: 0, quantity: 0, shares: d.riders.map(() => 0), othersMinor: 0 };
  const cost = rideCost({ km, mileage: d.mileage, priceMinor: price, wearMinorPerKm: d.wearOn ? d.wearMinorPerKm : 0, extrasMinor: d.extras.map((e) => e.amountMinor) });
  const s = rideShares(cost, d.riders.map((r) => ({ subjectId: r.subjectId, on: r.on, km: r.km === null ? km : Math.min(r.km, km) })));
  const shares = s.ok ? s.shares : d.riders.map(() => 0);
  const othersMinor = d.riders.reduce((sum, r, i) => (r.subjectId === owner ? sum : sum + shares[i]!), 0);
  return { km, fuelMinor: cost.fuelMinor, wearMinor: cost.wearMinor, extrasMinor: cost.extrasMinor, totalMinor: cost.totalMinor, quantity: cost.quantity, shares, othersMinor };
}

/** The PATCH a draft saves as. */
export function patchOf(d: Draft): TripecoRidePatch {
  const price = num(d.priceRupees);
  return {
    mode: d.mode,
    startKm: d.mode === "odo" ? num(d.startKm) : null,
    endKm: d.mode === "odo" ? num(d.endKm) : null,
    tripKm: d.mode === "trip" ? num(d.tripKm) : null,
    ...(price !== null ? { priceMinor: Math.round(price * 100) } : {}),
    wearOn: d.wearOn,
    title: d.title.trim() === "" ? null : d.title.trim().slice(0, 80),
    groupId: d.groupId,
    riders: d.riders.map((r) => ({ subjectId: r.subjectId, on: r.on, ...(r.km !== null ? { km: Math.min(r.km, DRIVE_MAX_KM) } : {}) })),
    extras: d.extras,
  };
}

/** Is there anyone but the owner on? */
export const hasOthers = (d: Draft, owner: string) => d.riders.some((r) => r.on && r.subjectId !== owner);
