// Tripeco (tripeco TR-2, design §3): vehicles, a private fuel log and rides,
// under /v1/tripeco/… on api-edge. Money is integer paise; a ride's amounts
// are whole rupees. Ids cross the wire with their prefix: veh_ a vehicle,
// ful_ a fill-up, trp_ a ride, pho_ a photo; groups are Spliteco's org_ ids.

export const TRIPECO_FUELS = ["petrol", "diesel", "cng", "electric"] as const;
export type TripecoFuel = (typeof TRIPECO_FUELS)[number];

/** What the fuel is bought in. */
export type TripecoUnit = "l" | "kg" | "kWh";

export const TRIPECO_RIDE_STATES = ["open", "done", "posted"] as const;
export type TripecoRideState = (typeof TRIPECO_RIDE_STATES)[number];
export type TripecoRideMode = "odo" | "trip";
export type TripecoMileageSource = "learned" | "estimate" | "car";
export type TripecoExtraKind = "toll" | "parking";
export type TripecoPaidBy = "me" | "rider";
export type TripecoPhotoRole = "start" | "end";

/** The source_kind a posted ride carries on its Spliteco expense (design §0.4). */
export const TRIPECO_SOURCE_KIND = "tripeco";
/** The header tripeco-worker sends spliteco-worker with a ride's id; api-edge never forwards it. */
export const TRIPECO_RIDE_HEADER = "x-tripeco-ride";

/** The biggest photo a ride keeps, decoded. */
export const TRIPECO_PHOTO_MAX_BYTES = 400 * 1024;
/** The most riders on one ride (the owner included). */
export const TRIPECO_MAX_RIDERS = 12;
export const TRIPECO_MAX_EXTRAS = 8;

/** `details.reason` on Tripeco's 409s and 422s. */
export const TRIPECO_ERROR_REASONS = {
  /** The ride has no distance yet (no end reading or Trip A). */
  notDone: "ride_not_done",
  /** Every rider is left out, or nobody rode any km. */
  noRiders: "no_riders",
  /** Posting needs a group. */
  noGroup: "no_group",
  /** Only the owner is on the ride: nothing to post (save it as a solo drive). */
  solo: "solo_drive",
  /** A posted ride can't be discarded; unpost it first. */
  posted: "ride_posted",
  /** The ride isn't posted. */
  notPosted: "ride_not_posted",
  /** The vehicle is archived. */
  archived: "vehicle_archived",
} as const;

export interface TripecoMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Every fill-up logged this month. */
  fuelMinor: number;
  /** What riders covered: their shares of this vehicle's posted rides, plus fill-ups a rider paid. */
  ridersMinor: number;
  /** fuel − riders, at least 0. */
  youMinor: number;
}

export interface TripecoVehicle {
  id: string;
  name: string;
  plate: string | null;
  fuel: TripecoFuel;
  unit: TripecoUnit;
  odometerKm: number;
  /** The mileage a new ride uses: learned once there is a full-tank segment, else the estimate. */
  mileage: number;
  mileageSource: "learned" | "estimate";
  learnedMileage: number | null;
  estimateMileage: number;
  /** Paise per unit a new ride uses: the last fill-up's, else the estimate. */
  priceMinor: number;
  priceSource: "last_fill" | "estimate";
  estimatePriceMinor: number;
  wearMinorPerKm: number;
  /** price ÷ mileage + wear, paise. */
  perKmMinor: number;
  month: TripecoMonth;
  createdAt: string;
}

export interface TripecoVehicleRequest {
  name: string;
  plate?: string | null;
  fuel: TripecoFuel;
  odometerKm?: number;
  /** km per unit, a rough guess. */
  mileage: number;
  /** Paise per unit. */
  priceMinor: number;
  wearMinorPerKm?: number;
}

export type TripecoVehiclePatch = Partial<Omit<TripecoVehicleRequest, "fuel">>;

export interface TripecoFuelLog {
  id: string;
  vehicleId: string;
  amountMinor: number;
  /** Litres, kg or kWh. */
  quantity: number;
  odometerKm: number;
  full: boolean;
  paidBy: TripecoPaidBy;
  /** amount ÷ quantity, paise. */
  unitPriceMinor: number;
  loggedAt: string;
}

export interface TripecoFuelRequest {
  amountMinor: number;
  quantity: number;
  odometerKm: number;
  full: boolean;
  paidBy?: TripecoPaidBy;
  /** ISO; now when omitted. */
  loggedAt?: string;
}

export interface TripecoSegment {
  endKm: number;
  km: number;
  quantity: number;
  mileage: number;
}

export interface TripecoVehicleResponse {
  vehicle: TripecoVehicle;
  /** The full-tank segments behind the learned mileage, oldest first. */
  segments: TripecoSegment[];
  /** Newest first. */
  fuel: TripecoFuelLog[];
}

export interface TripecoRider {
  subjectId: string;
  on: boolean;
  km: number;
  /** Whole rupees, as paise. */
  shareMinor: number;
}

export interface TripecoExtra {
  kind: TripecoExtraKind;
  amountMinor: number;
}

export interface TripecoPhoto {
  id: string;
  role: TripecoPhotoRole;
}

export interface TripecoRide {
  id: string;
  vehicleId: string;
  vehicleName: string;
  fuel: TripecoFuel;
  unit: TripecoUnit;
  state: TripecoRideState;
  /** Done with nobody on but the owner: nothing to post. */
  solo: boolean;
  mode: TripecoRideMode;
  startKm: number | null;
  endKm: number | null;
  tripKm: number | null;
  carAverage: number | null;
  /** The distance, once known. */
  km: number | null;
  mileage: number;
  mileageSource: TripecoMileageSource;
  /** The vehicle's own figure when the ride was started (learned or estimate), so Car display can be switched back. */
  learnedMileage: number;
  priceMinor: number;
  wearOn: boolean;
  wearMinorPerKm: number;
  /** The title as typed, or "Swift · 124 km". */
  title: string;
  titleTyped: boolean;
  /** The Spliteco group chosen (org_…). */
  groupId: string | null;
  riders: TripecoRider[];
  extras: TripecoExtra[];
  fuelMinor: number;
  wearMinor: number;
  extrasMinor: number;
  totalMinor: number;
  photos: TripecoPhoto[];
  /** Where it posted, when it did; `stale` when it changed since. */
  posted: { txnId: string; groupId: string; postedAt: string; stale: boolean } | null;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
}

export interface TripecoStartRideRequest {
  vehicleId: string;
  mode: TripecoRideMode;
  startKm?: number | null;
  /** ISO; now when omitted (a start kept on the device while offline, risk TR-D). */
  startedAt?: string;
  groupId?: string | null;
}

export interface TripecoRidePatch {
  mode?: TripecoRideMode;
  startKm?: number | null;
  endKm?: number | null;
  tripKm?: number | null;
  carAverage?: number | null;
  mileageSource?: TripecoMileageSource;
  priceMinor?: number;
  wearOn?: boolean;
  title?: string | null;
  groupId?: string | null;
  /** The whole list, the owner included; replaces what was there. */
  riders?: Array<{ subjectId: string; on: boolean; km?: number }>;
  extras?: TripecoExtra[];
}

export interface TripecoPhotoRequest {
  role: TripecoPhotoRole;
  /** A JPEG or WebP, base64 (a data: prefix is dropped). */
  image: string;
}

export interface TripecoRideResponse {
  ride: TripecoRide;
}

export interface TripecoNeed {
  kind: "end" | "post";
  rideId: string;
  /** "Swift end km" or "Airport drop · ₹257". */
  title: string;
  amountMinor: number | null;
}

export interface TripecoMeResponse {
  vehicles: TripecoVehicle[];
  /** Newest first, at most 20. */
  rides: TripecoRide[];
  needs: TripecoNeed[];
}

export interface TripecoVehiclesResponse {
  vehicles: TripecoVehicle[];
}

export interface TripecoPhotoResponse {
  photo: TripecoPhoto & { mediaType: "image/jpeg" | "image/webp"; image: string };
}

/** The label a ride gets until it is named: "Swift · 124 km". */
export function tripecoDefaultTitle(vehicleName: string, km: number | null): string {
  return km === null ? vehicleName : `${vehicleName} · ${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}
