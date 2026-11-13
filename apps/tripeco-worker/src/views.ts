// What Tripeco answers with, built from its rows and the drive maths
// (@saas/kitchen-engine/drive). Also `recompute`: a ride's distance, cost,
// shares and state from its readings — the one place they are worked out, so
// every write stores the same numbers the view shows.

import {
  DRIVE_MAX_KM,
  DRIVE_UNIT,
  learnedMileage,
  lastPrice,
  perKmMinor,
  rideCost,
  rideKm,
  rideShares,
  unitPrice,
} from "@saas/kitchen-engine/drive";
import { tripecoDefaultTitle, type TripecoFuelLog, type TripecoNeed, type TripecoRide, type TripecoVehicle } from "@saas/contracts/tripeco";
import type { NewTripecoRide, TripecoFuelLogRecord, TripecoRideRecord, TripecoVehicleRecord } from "@saas/db/tripeco";
import { orgPublicId, txnPublicId } from "./ids.js";

/** A rider's km stored as DRIVE_MAX_KM means "the whole ride", whatever its length turns out to be. */
export const WHOLE_RIDE_KM = DRIVE_MAX_KM;

/** The month a moment falls in, in India (UTC+5:30): `YYYY-MM`. */
export function monthOf(iso: string): string {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 7);
}

const fillInput = (f: TripecoFuelLogRecord) => ({
  odometerKm: f.odometerKm,
  quantityMilli: f.quantityMilli,
  amountMinor: f.amountMinor,
  full: f.full,
  loggedAt: f.loggedAt,
});

/** The figures a new ride starts from: mileage (learned, else typed) and price (last fill-up, else typed). */
export function vehicleFigures(v: TripecoVehicleRecord, fills: readonly TripecoFuelLogRecord[]) {
  const learned = learnedMileage(fills.map(fillInput));
  const price = lastPrice(fills.map(fillInput));
  return {
    learned,
    mileage: learned.mileage ?? v.estimateMileage,
    mileageSource: (learned.mileage !== null ? "learned" : "estimate") as "learned" | "estimate",
    priceMinor: price ?? v.estimatePriceMinor,
    priceSource: (price !== null ? "last_fill" : "estimate") as "last_fill" | "estimate",
  };
}

export function vehicleView(
  v: TripecoVehicleRecord,
  fills: readonly TripecoFuelLogRecord[],
  rides: readonly TripecoRideRecord[],
  now: Date,
): TripecoVehicle {
  const f = vehicleFigures(v, fills);
  const month = monthOf(now.toISOString());
  const fuelMinor = fills.filter((x) => monthOf(x.loggedAt) === month).reduce((s, x) => s + x.amountMinor, 0);
  const riderFills = fills.filter((x) => monthOf(x.loggedAt) === month && x.paidBy === "rider").reduce((s, x) => s + x.amountMinor, 0);
  const riderShares = rides
    .filter((r) => r.vehicleId === v.id && r.state === "posted" && r.postedAt && monthOf(r.postedAt) === month)
    .reduce((s, r) => s + r.riders.filter((x) => x.subjectId !== r.ownerSubject).reduce((a, x) => a + x.shareMinor, 0), 0);
  const ridersMinor = riderFills + riderShares;
  return {
    id: v.id,
    name: v.name,
    plate: v.plate,
    fuel: v.fuel,
    unit: DRIVE_UNIT[v.fuel],
    odometerKm: v.odometerKm,
    mileage: f.mileage,
    mileageSource: f.mileageSource,
    learnedMileage: f.learned.mileage,
    estimateMileage: v.estimateMileage,
    priceMinor: f.priceMinor,
    priceSource: f.priceSource,
    estimatePriceMinor: v.estimatePriceMinor,
    wearMinorPerKm: v.wearMinorPerKm,
    perKmMinor: perKmMinor(f.priceMinor, f.mileage, v.wearMinorPerKm),
    month: { month, fuelMinor, ridersMinor, youMinor: Math.max(0, fuelMinor - ridersMinor) },
    createdAt: v.createdAt,
  };
}

export function fuelView(f: TripecoFuelLogRecord): TripecoFuelLog {
  return {
    id: f.id,
    vehicleId: f.vehicleId,
    amountMinor: f.amountMinor,
    quantity: f.quantityMilli / 1000,
    odometerKm: f.odometerKm,
    full: f.full,
    paidBy: f.paidBy,
    unitPriceMinor: unitPrice(f) ?? 0,
    loggedAt: f.loggedAt,
  };
}

/** Is anyone but the owner on the ride? */
export function hasOthers(r: Pick<TripecoRideRecord, "riders" | "ownerSubject">): boolean {
  return r.riders.some((x) => x.on && x.subjectId !== r.ownerSubject);
}

/**
 * Work out the ride from its readings: distance, cost, each rider's share
 * (riders' km clamped to the ride; "whole ride" follows it), the state
 * (open until the distance is known; a posted ride stays posted, and any
 * change bumps its version so it needs a repost).
 */
export function recompute(ride: NewTripecoRide, at: string, options: { changed: boolean }): NewTripecoRide {
  const km = rideKm(ride);
  const riders = ride.riders.map((r) => ({ ...r, km: Math.max(0, r.km) }));
  let fuelMinor = 0;
  let wearMinor = 0;
  let extrasMinor = 0;
  let totalMinor = 0;
  if (km !== null) {
    const cost = rideCost({
      km,
      mileage: ride.mileage,
      priceMinor: ride.priceMinor,
      wearMinorPerKm: ride.wearOn ? ride.wearMinorPerKm : 0,
      extrasMinor: ride.extras.map((e) => e.amountMinor),
    });
    ({ fuelMinor, wearMinor, extrasMinor, totalMinor } = cost);
    const shares = rideShares(cost, riders.map((r) => ({ subjectId: r.subjectId, on: r.on, km: Math.min(r.km, km) })));
    riders.forEach((r, i) => (r.shareMinor = shares.ok ? shares.shares[i]! : 0));
  } else {
    riders.forEach((r) => (r.shareMinor = 0));
  }
  const state = ride.state === "posted" ? "posted" : km === null ? "open" : "done";
  return {
    ...ride,
    km,
    riders,
    fuelMinor,
    wearMinor,
    extrasMinor,
    totalMinor,
    state,
    version: ride.state === "posted" && options.changed ? ride.version + 1 : ride.version,
    endedAt: km !== null ? (ride.endedAt ?? at) : null,
    updatedAt: options.changed ? at : ride.updatedAt,
  };
}

export function rideView(r: TripecoRideRecord, vehicle: Pick<TripecoVehicleRecord, "name" | "fuel">, vehicleMileage: number): TripecoRide {
  const km = r.km;
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    vehicleName: vehicle.name,
    fuel: vehicle.fuel,
    unit: DRIVE_UNIT[vehicle.fuel],
    state: r.state,
    solo: r.state === "done" && !hasOthers(r),
    mode: r.mode,
    startKm: r.startKm,
    endKm: r.endKm,
    tripKm: r.tripKm,
    carAverage: r.carAverage,
    km,
    mileage: r.mileage,
    mileageSource: r.mileageSource,
    learnedMileage: r.mileageSource === "car" ? vehicleMileage : r.mileage,
    priceMinor: r.priceMinor,
    wearOn: r.wearOn,
    wearMinorPerKm: r.wearMinorPerKm,
    title: r.title ?? tripecoDefaultTitle(vehicle.name, km),
    titleTyped: r.title !== null,
    groupId: r.orgId ? orgPublicId(r.orgId) : null,
    riders: r.riders.map((x) => ({
      subjectId: x.subjectId,
      on: x.on,
      km: km === null ? (x.km >= WHOLE_RIDE_KM ? 0 : x.km) : Math.min(x.km, km),
      shareMinor: x.shareMinor,
    })),
    extras: r.extras.map((e) => ({ kind: e.kind, amountMinor: e.amountMinor })),
    fuelMinor: r.fuelMinor,
    wearMinor: r.wearMinor,
    extrasMinor: r.extrasMinor,
    totalMinor: r.totalMinor,
    photos: r.photos.map((p) => ({ id: p.id, role: p.role })),
    posted:
      r.state === "posted" && r.postedTxnId && r.postedOrgId && r.postedAt
        ? { txnId: txnPublicId(r.postedTxnId), groupId: orgPublicId(r.postedOrgId), postedAt: r.postedAt, stale: r.postedVersion !== r.version }
        : null,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    updatedAt: r.updatedAt,
  };
}

/** What needs the owner: a ride with no end yet, a ride with riders not posted, a posted ride changed since. */
export function needsOf(rides: readonly TripecoRide[]): TripecoNeed[] {
  const out: TripecoNeed[] = [];
  for (const r of rides) {
    if (r.state === "open") {
      out.push({ kind: "end", rideId: r.id, title: `${r.vehicleName} end km`, amountMinor: null });
    } else if ((r.state === "done" && !r.solo) || r.posted?.stale) {
      out.push({ kind: "post", rideId: r.id, title: r.title, amountMinor: r.totalMinor });
    }
  }
  return out;
}
