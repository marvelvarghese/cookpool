// Tripeco's storage (tripeco TR-2, migration 610_tripeco_drive).
//
// Vehicles, fuel logs, rides (with their riders and extras) and ride photos.
// Every read and write but the proof reads (`rideByIdAny`, `photoById`) is
// scoped by the owner's subject id; tripeco-worker checks a group member's
// right to a posted ride's proof before calling those. A ride with its riders
// and extras is written as ONE batch, so a half-saved ride never exists.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";

export type TripecoFuelKind = "petrol" | "diesel" | "cng" | "electric";
export type TripecoRideStateKind = "open" | "done" | "posted";

export interface TripecoVehicleRecord {
  id: string;
  ownerSubject: string;
  name: string;
  plate: string | null;
  fuel: TripecoFuelKind;
  odometerKm: number;
  estimateMileage: number;
  estimatePriceMinor: number;
  wearMinorPerKm: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TripecoFuelLogRecord {
  id: string;
  vehicleId: string;
  ownerSubject: string;
  amountMinor: number;
  quantityMilli: number;
  odometerKm: number;
  full: boolean;
  paidBy: "me" | "rider";
  loggedAt: string;
  createdAt: string;
}

export interface TripecoRiderRecord {
  subjectId: string;
  on: boolean;
  km: number;
  shareMinor: number;
}

export interface TripecoExtraRecord {
  kind: "toll" | "parking";
  amountMinor: number;
}

export interface TripecoRideRecord {
  id: string;
  vehicleId: string;
  ownerSubject: string;
  state: TripecoRideStateKind;
  mode: "odo" | "trip";
  startKm: number | null;
  endKm: number | null;
  tripKm: number | null;
  carAverage: number | null;
  km: number | null;
  mileage: number;
  mileageSource: "learned" | "estimate" | "car";
  priceMinor: number;
  wearOn: boolean;
  wearMinorPerKm: number;
  title: string | null;
  /** The chosen group, a bare UUID. */
  orgId: string | null;
  fuelMinor: number;
  wearMinor: number;
  extrasMinor: number;
  totalMinor: number;
  version: number;
  /** The Spliteco expense, a bare UUID. */
  postedTxnId: string | null;
  postedOrgId: string | null;
  postedVersion: number | null;
  postedAt: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  riders: TripecoRiderRecord[];
  extras: TripecoExtraRecord[];
  photos: Array<{ id: string; role: "start" | "end" }>;
}

export interface TripecoPhotoRecord {
  id: string;
  rideId: string;
  role: "start" | "end";
  mediaType: "image/jpeg" | "image/webp";
  data: string;
  bytes: number;
  createdAt: string;
}

export type NewTripecoRide = Omit<TripecoRideRecord, "photos">;

export interface TripecoRepository {
  listVehicles(owner: string, options?: { archived?: boolean }): Promise<TripecoVehicleRecord[]>;
  vehicleById(owner: string, id: string): Promise<TripecoVehicleRecord | null>;
  /** Vehicles by id whoever owns them: only for rides a group member was checked for. */
  vehiclesByIds(ids: readonly string[]): Promise<TripecoVehicleRecord[]>;
  insertVehicle(v: TripecoVehicleRecord): Promise<void>;
  /** Replace the changeable fields; false when it is not the owner's. */
  updateVehicle(v: TripecoVehicleRecord): Promise<boolean>;
  /** Raise the vehicle's odometer to `km` if higher. */
  raiseOdometer(owner: string, id: string, km: number, at: string): Promise<void>;
  /** Every fill-up of these vehicles, oldest first. */
  listFuel(owner: string, vehicleIds: readonly string[]): Promise<TripecoFuelLogRecord[]>;
  insertFuel(f: TripecoFuelLogRecord): Promise<void>;
  /** False when it was not the owner's (or is gone). */
  deleteFuel(owner: string, id: string): Promise<boolean>;
  /** The owner's rides, newest first. */
  listRides(owner: string, options?: { limit?: number; vehicleId?: string }): Promise<TripecoRideRecord[]>;
  rideById(owner: string, id: string): Promise<TripecoRideRecord | null>;
  /** Any owner's ride: only for a proof read the caller was checked for. */
  rideByIdAny(id: string): Promise<TripecoRideRecord | null>;
  /** Every ride posted to a group, newest first. */
  ridesPostedTo(orgId: string): Promise<TripecoRideRecord[]>;
  /** Insert or replace a ride with its riders and extras, in one batch. */
  saveRide(ride: NewTripecoRide, options: { insert: boolean }): Promise<void>;
  /** An unposted ride, its riders, extras and photos; false when not the owner's or posted. */
  deleteRide(owner: string, id: string): Promise<boolean>;
  /** A start or end photo; a second of the same role replaces the first. */
  putPhoto(p: TripecoPhotoRecord): Promise<void>;
  photoById(id: string): Promise<TripecoPhotoRecord | null>;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const VEHICLE_COLUMNS =
  "id, owner_subject, name, plate, fuel, odometer_km, estimate_mileage, estimate_price_minor, wear_minor_per_km, created_at, updated_at, archived_at";

function mapVehicle(r: Row): TripecoVehicleRecord {
  return {
    id: String(r.id),
    ownerSubject: String(r.owner_subject),
    name: String(r.name),
    plate: str(r.plate),
    fuel: String(r.fuel) as TripecoFuelKind,
    odometerKm: Number(r.odometer_km),
    estimateMileage: Number(r.estimate_mileage),
    estimatePriceMinor: Number(r.estimate_price_minor),
    wearMinorPerKm: Number(r.wear_minor_per_km),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    archivedAt: str(r.archived_at),
  };
}

const FUEL_COLUMNS = "id, vehicle_id, owner_subject, amount_minor, quantity_milli, odometer_km, full, paid_by, logged_at, created_at";

function mapFuel(r: Row): TripecoFuelLogRecord {
  return {
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    ownerSubject: String(r.owner_subject),
    amountMinor: Number(r.amount_minor),
    quantityMilli: Number(r.quantity_milli),
    odometerKm: Number(r.odometer_km),
    full: Number(r.full) === 1,
    paidBy: String(r.paid_by) === "rider" ? "rider" : "me",
    loggedAt: String(r.logged_at),
    createdAt: String(r.created_at),
  };
}

const RIDE_COLUMNS = [
  "id", "vehicle_id", "owner_subject", "state", "mode", "start_km", "end_km", "trip_km", "car_average", "km",
  "mileage", "mileage_source", "price_minor", "wear_on", "wear_minor_per_km", "title", "org_id",
  "fuel_minor", "wear_minor", "extras_minor", "total_minor", "version",
  "posted_txn_id", "posted_org_id", "posted_version", "posted_at",
  "started_at", "ended_at", "created_at", "updated_at",
] as const;

function mapRide(r: Row): TripecoRideRecord {
  return {
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    ownerSubject: String(r.owner_subject),
    state: String(r.state) as TripecoRideStateKind,
    mode: String(r.mode) === "trip" ? "trip" : "odo",
    startKm: num(r.start_km),
    endKm: num(r.end_km),
    tripKm: num(r.trip_km),
    carAverage: num(r.car_average),
    km: num(r.km),
    mileage: Number(r.mileage),
    mileageSource: String(r.mileage_source) as TripecoRideRecord["mileageSource"],
    priceMinor: Number(r.price_minor),
    wearOn: Number(r.wear_on) === 1,
    wearMinorPerKm: Number(r.wear_minor_per_km),
    title: str(r.title),
    orgId: str(r.org_id),
    fuelMinor: Number(r.fuel_minor),
    wearMinor: Number(r.wear_minor),
    extrasMinor: Number(r.extras_minor),
    totalMinor: Number(r.total_minor),
    version: Number(r.version),
    postedTxnId: str(r.posted_txn_id),
    postedOrgId: str(r.posted_org_id),
    postedVersion: num(r.posted_version),
    postedAt: str(r.posted_at),
    startedAt: String(r.started_at),
    endedAt: str(r.ended_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    riders: [],
    extras: [],
    photos: [],
  };
}

function rideParams(ride: NewTripecoRide): unknown[] {
  return [
    ride.id, ride.vehicleId, ride.ownerSubject, ride.state, ride.mode, ride.startKm, ride.endKm, ride.tripKm, ride.carAverage, ride.km,
    ride.mileage, ride.mileageSource, ride.priceMinor, ride.wearOn ? 1 : 0, ride.wearMinorPerKm, ride.title, ride.orgId,
    ride.fuelMinor, ride.wearMinor, ride.extrasMinor, ride.totalMinor, ride.version,
    ride.postedTxnId, ride.postedOrgId, ride.postedVersion, ride.postedAt,
    ride.startedAt, ride.endedAt, ride.createdAt, ride.updatedAt,
  ];
}

const placeholders = (n: number, from = 1): string => Array.from({ length: n }, (_, i) => `$${i + from}`).join(", ");

export function createTripecoRepository(executor: SqlExecutor): TripecoRepository {
  /** Attach riders, extras and photos to rides read without them. */
  async function hydrate(rides: TripecoRideRecord[]): Promise<TripecoRideRecord[]> {
    if (rides.length === 0) return rides;
    const ids = rides.map((r) => r.id);
    const inList = placeholders(ids.length);
    const [riders, extras, photos] = await Promise.all([
      executor.execute<Row>(`SELECT ride_id, subject_id, on_ride, km, share_minor FROM tripeco_ride_riders WHERE ride_id IN (${inList}) ORDER BY ride_id, position`, ids),
      executor.execute<Row>(`SELECT ride_id, kind, amount_minor FROM tripeco_ride_extras WHERE ride_id IN (${inList}) ORDER BY ride_id, position`, ids),
      executor.execute<Row>(`SELECT id, ride_id, role FROM tripeco_photos WHERE ride_id IN (${inList}) ORDER BY ride_id, role DESC`, ids),
    ]);
    const byId = new Map(rides.map((r) => [r.id, r]));
    for (const r of riders.rows) {
      byId.get(String(r.ride_id))?.riders.push({ subjectId: String(r.subject_id), on: Number(r.on_ride) === 1, km: Number(r.km), shareMinor: Number(r.share_minor) });
    }
    for (const r of extras.rows) {
      byId.get(String(r.ride_id))?.extras.push({ kind: String(r.kind) === "parking" ? "parking" : "toll", amountMinor: Number(r.amount_minor) });
    }
    for (const r of photos.rows) {
      byId.get(String(r.ride_id))?.photos.push({ id: String(r.id), role: String(r.role) === "end" ? "end" : "start" });
    }
    return rides;
  }

  const SELECT_RIDES = `SELECT ${RIDE_COLUMNS.join(", ")} FROM tripeco_rides`;

  return {
    async listVehicles(owner, { archived = false } = {}) {
      const result = await executor.execute<Row>(
        `SELECT ${VEHICLE_COLUMNS} FROM tripeco_vehicles WHERE owner_subject = $1 ${archived ? "" : "AND archived_at IS NULL"} ORDER BY created_at, id`,
        [owner],
      );
      return result.rows.map(mapVehicle);
    },

    async vehicleById(owner, id) {
      const result = await executor.execute<Row>(`SELECT ${VEHICLE_COLUMNS} FROM tripeco_vehicles WHERE id = $1 AND owner_subject = $2`, [id, owner]);
      const row = result.rows[0];
      return row ? mapVehicle(row) : null;
    },

    async vehiclesByIds(ids) {
      if (ids.length === 0) return [];
      const result = await executor.execute<Row>(`SELECT ${VEHICLE_COLUMNS} FROM tripeco_vehicles WHERE id IN (${placeholders(ids.length)})`, [...ids]);
      return result.rows.map(mapVehicle);
    },

    async insertVehicle(v) {
      await executor.execute(`INSERT INTO tripeco_vehicles (${VEHICLE_COLUMNS}) VALUES (${placeholders(12)})`, [
        v.id, v.ownerSubject, v.name, v.plate, v.fuel, v.odometerKm, v.estimateMileage, v.estimatePriceMinor, v.wearMinorPerKm, v.createdAt, v.updatedAt, v.archivedAt,
      ]);
    },

    async updateVehicle(v) {
      const result = await executor.execute(
        `UPDATE tripeco_vehicles
            SET name = $3, plate = $4, odometer_km = $5, estimate_mileage = $6, estimate_price_minor = $7,
                wear_minor_per_km = $8, updated_at = $9, archived_at = $10
          WHERE id = $1 AND owner_subject = $2
          RETURNING id`,
        [v.id, v.ownerSubject, v.name, v.plate, v.odometerKm, v.estimateMileage, v.estimatePriceMinor, v.wearMinorPerKm, v.updatedAt, v.archivedAt],
      );
      return result.rowCount > 0;
    },

    async raiseOdometer(owner, id, km, at) {
      await executor.execute(
        `UPDATE tripeco_vehicles SET odometer_km = $3, updated_at = $4 WHERE id = $1 AND owner_subject = $2 AND odometer_km < $3`,
        [id, owner, km, at],
      );
    },

    async listFuel(owner, vehicleIds) {
      if (vehicleIds.length === 0) return [];
      const result = await executor.execute<Row>(
        `SELECT ${FUEL_COLUMNS} FROM tripeco_fuel_logs WHERE owner_subject = $1 AND vehicle_id IN (${placeholders(vehicleIds.length, 2)}) ORDER BY logged_at, id`,
        [owner, ...vehicleIds],
      );
      return result.rows.map(mapFuel);
    },

    async insertFuel(f) {
      await executor.execute(`INSERT INTO tripeco_fuel_logs (${FUEL_COLUMNS}) VALUES (${placeholders(10)})`, [
        f.id, f.vehicleId, f.ownerSubject, f.amountMinor, f.quantityMilli, f.odometerKm, f.full ? 1 : 0, f.paidBy, f.loggedAt, f.createdAt,
      ]);
    },

    async deleteFuel(owner, id) {
      const result = await executor.execute(`DELETE FROM tripeco_fuel_logs WHERE id = $1 AND owner_subject = $2 RETURNING id`, [id, owner]);
      return result.rowCount > 0;
    },

    async listRides(owner, { limit = 200, vehicleId } = {}) {
      const result = await executor.execute<Row>(
        `${SELECT_RIDES} WHERE owner_subject = $1 ${vehicleId ? "AND vehicle_id = $3" : ""} ORDER BY started_at DESC, id DESC LIMIT $2`,
        vehicleId ? [owner, limit, vehicleId] : [owner, limit],
      );
      return hydrate(result.rows.map(mapRide));
    },

    async rideById(owner, id) {
      const result = await executor.execute<Row>(`${SELECT_RIDES} WHERE id = $1 AND owner_subject = $2`, [id, owner]);
      const rides = await hydrate(result.rows.map(mapRide));
      return rides[0] ?? null;
    },

    async rideByIdAny(id) {
      const result = await executor.execute<Row>(`${SELECT_RIDES} WHERE id = $1`, [id]);
      const rides = await hydrate(result.rows.map(mapRide));
      return rides[0] ?? null;
    },

    async ridesPostedTo(orgId) {
      const result = await executor.execute<Row>(`${SELECT_RIDES} WHERE posted_org_id = $1 AND state = 'posted' ORDER BY posted_at DESC, id DESC`, [orgId]);
      return hydrate(result.rows.map(mapRide));
    },

    async saveRide(ride, { insert }) {
      const statements: SqlStatement[] = [];
      if (insert) {
        statements.push({ text: `INSERT INTO tripeco_rides (${RIDE_COLUMNS.join(", ")}) VALUES (${placeholders(RIDE_COLUMNS.length)})`, params: rideParams(ride) });
      } else {
        const sets = RIDE_COLUMNS.slice(3).map((c, i) => `${c} = $${i + 4}`).join(", ");
        statements.push({ text: `UPDATE tripeco_rides SET ${sets} WHERE id = $1 AND vehicle_id = $2 AND owner_subject = $3`, params: rideParams(ride) });
        statements.push({ text: `DELETE FROM tripeco_ride_riders WHERE ride_id = $1`, params: [ride.id] });
        statements.push({ text: `DELETE FROM tripeco_ride_extras WHERE ride_id = $1`, params: [ride.id] });
      }
      ride.riders.forEach((r, position) =>
        statements.push({
          text: `INSERT INTO tripeco_ride_riders (ride_id, position, subject_id, on_ride, km, share_minor) VALUES ($1, $2, $3, $4, $5, $6)`,
          params: [ride.id, position, r.subjectId, r.on ? 1 : 0, r.km, r.shareMinor],
        }),
      );
      ride.extras.forEach((e, position) =>
        statements.push({
          text: `INSERT INTO tripeco_ride_extras (ride_id, position, kind, amount_minor) VALUES ($1, $2, $3, $4)`,
          params: [ride.id, position, e.kind, e.amountMinor],
        }),
      );
      await executeBatch(executor, statements);
    },

    async deleteRide(owner, id) {
      const found = await executor.execute<Row>(`SELECT id FROM tripeco_rides WHERE id = $1 AND owner_subject = $2 AND state <> 'posted'`, [id, owner]);
      if (found.rowCount === 0) return false;
      await executeBatch(executor, [
        { text: `DELETE FROM tripeco_photos WHERE ride_id = $1`, params: [id] },
        { text: `DELETE FROM tripeco_ride_riders WHERE ride_id = $1`, params: [id] },
        { text: `DELETE FROM tripeco_ride_extras WHERE ride_id = $1`, params: [id] },
        { text: `DELETE FROM tripeco_rides WHERE id = $1 AND owner_subject = $2 AND state <> 'posted'`, params: [id, owner] },
      ]);
      return true;
    },

    async putPhoto(p) {
      await executor.execute(
        `INSERT INTO tripeco_photos (id, ride_id, role, media_type, data, bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (ride_id, role) DO UPDATE SET id = excluded.id, media_type = excluded.media_type, data = excluded.data,
                                                   bytes = excluded.bytes, created_at = excluded.created_at`,
        [p.id, p.rideId, p.role, p.mediaType, p.data, p.bytes, p.createdAt],
      );
    },

    async photoById(id) {
      const result = await executor.execute<Row>(`SELECT id, ride_id, role, media_type, data, bytes, created_at FROM tripeco_photos WHERE id = $1`, [id]);
      const r = result.rows[0];
      if (!r) return null;
      return {
        id: String(r.id),
        rideId: String(r.ride_id),
        role: String(r.role) === "end" ? "end" : "start",
        mediaType: String(r.media_type) === "image/webp" ? "image/webp" : "image/jpeg",
        data: String(r.data),
        bytes: Number(r.bytes),
        createdAt: String(r.created_at),
      };
    },
  };
}
