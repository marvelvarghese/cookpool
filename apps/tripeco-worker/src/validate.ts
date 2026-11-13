// Request bodies, checked field by field. Each parser returns the value or the
// field errors the 422 carries (`details.fields`).

import { DRIVE_MAX_KM } from "@saas/kitchen-engine/drive";
import {
  TRIPECO_FUELS,
  TRIPECO_MAX_EXTRAS,
  TRIPECO_MAX_RIDERS,
  TRIPECO_PHOTO_MAX_BYTES,
  type TripecoExtra,
  type TripecoFuel,
  type TripecoFuelRequest,
  type TripecoMileageSource,
  type TripecoPhotoRole,
  type TripecoRideMode,
  type TripecoVehicleRequest,
} from "@saas/contracts/tripeco";

export type Fields = Record<string, string[]>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; fields: Fields };

/** The largest odometer anyone has (a million km). */
const ODO_MAX = 1_000_000;

class Checker {
  readonly fields: Fields = {};
  fail(field: string, message: string): void {
    (this.fields[field] ??= []).push(message);
  }
  get ok(): boolean {
    return Object.keys(this.fields).length === 0;
  }
  text(body: Record<string, unknown>, field: string, max: number, { required = false } = {}): string | null | undefined {
    const raw = body[field];
    if (raw === undefined) {
      if (required) this.fail(field, "Required");
      return undefined;
    }
    if (raw === null && !required) return null;
    if (typeof raw !== "string") {
      this.fail(field, "Must be text");
      return undefined;
    }
    const t = raw.replace(/\s+/g, " ").trim();
    if (t === "") {
      if (required) this.fail(field, "Required");
      return required ? undefined : null;
    }
    if (Array.from(t).length > max) {
      this.fail(field, `At most ${max} characters`);
      return undefined;
    }
    return t;
  }
  number(body: Record<string, unknown>, field: string, min: number, max: number, { required = false, nullable = false, integer = false } = {}): number | null | undefined {
    const raw = body[field];
    if (raw === undefined) {
      if (required) this.fail(field, "Required");
      return undefined;
    }
    if (raw === null && nullable) return null;
    if (typeof raw !== "number" || !Number.isFinite(raw) || (integer && !Number.isSafeInteger(raw)) || raw < min || raw > max) {
      this.fail(field, integer ? `Must be a whole number from ${min} to ${max}` : `Must be a number from ${min} to ${max}`);
      return undefined;
    }
    return raw;
  }
  bool(body: Record<string, unknown>, field: string, { required = false } = {}): boolean | undefined {
    const raw = body[field];
    if (raw === undefined) {
      if (required) this.fail(field, "Required");
      return undefined;
    }
    if (typeof raw !== "boolean") {
      this.fail(field, "Must be true or false");
      return undefined;
    }
    return raw;
  }
  oneOf<T extends string>(body: Record<string, unknown>, field: string, values: readonly T[], { required = false } = {}): T | undefined {
    const raw = body[field];
    if (raw === undefined) {
      if (required) this.fail(field, "Required");
      return undefined;
    }
    if (typeof raw !== "string" || !(values as readonly string[]).includes(raw)) {
      this.fail(field, `Must be one of ${values.join(", ")}`);
      return undefined;
    }
    return raw as T;
  }
  iso(body: Record<string, unknown>, field: string): string | undefined {
    const raw = body[field];
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(Date.parse(raw))) {
      this.fail(field, "Must be an ISO-8601 time");
      return undefined;
    }
    return new Date(raw).toISOString();
  }
}

const done = <T>(c: Checker, value: T): Parsed<T> => (c.ok ? { ok: true, value } : { ok: false, fields: c.fields });

export function parseVehicle(body: Record<string, unknown>): Parsed<Required<Omit<TripecoVehicleRequest, "plate">> & { plate: string | null }> {
  const c = new Checker();
  const name = c.text(body, "name", 60, { required: true });
  const plate = c.text(body, "plate", 20);
  const fuel = c.oneOf<TripecoFuel>(body, "fuel", TRIPECO_FUELS, { required: true });
  const odometerKm = c.number(body, "odometerKm", 0, ODO_MAX);
  const mileage = c.number(body, "mileage", 0.1, 100, { required: true });
  const priceMinor = c.number(body, "priceMinor", 0, 10_000_00, { required: true, integer: true });
  const wearMinorPerKm = c.number(body, "wearMinorPerKm", 0, 10_000, { integer: true });
  return done(c, {
    name: name!,
    plate: plate ?? null,
    fuel: fuel!,
    odometerKm: (odometerKm as number | undefined) ?? 0,
    mileage: mileage as number,
    priceMinor: priceMinor as number,
    wearMinorPerKm: (wearMinorPerKm as number | undefined) ?? 0,
  });
}

export interface VehiclePatch {
  name?: string;
  plate?: string | null;
  odometerKm?: number;
  mileage?: number;
  priceMinor?: number;
  wearMinorPerKm?: number;
}

export function parseVehiclePatch(body: Record<string, unknown>): Parsed<VehiclePatch> {
  const c = new Checker();
  if ("fuel" in body) c.fail("fuel", "A vehicle's fuel can't change; add another vehicle");
  const out: VehiclePatch = {};
  const name = c.text(body, "name", 60);
  if (name === null) c.fail("name", "Required");
  else if (name !== undefined) out.name = name;
  const plate = c.text(body, "plate", 20);
  if (plate !== undefined) out.plate = plate;
  const odometerKm = c.number(body, "odometerKm", 0, ODO_MAX);
  if (typeof odometerKm === "number") out.odometerKm = odometerKm;
  const mileage = c.number(body, "mileage", 0.1, 100);
  if (typeof mileage === "number") out.mileage = mileage;
  const priceMinor = c.number(body, "priceMinor", 0, 10_000_00, { integer: true });
  if (typeof priceMinor === "number") out.priceMinor = priceMinor;
  const wear = c.number(body, "wearMinorPerKm", 0, 10_000, { integer: true });
  if (typeof wear === "number") out.wearMinorPerKm = wear;
  return done(c, out);
}

export function parseFuel(body: Record<string, unknown>): Parsed<Required<Omit<TripecoFuelRequest, "loggedAt">> & { loggedAt: string | undefined }> {
  const c = new Checker();
  const amountMinor = c.number(body, "amountMinor", 0, 10_000_000, { required: true, integer: true });
  const quantity = c.number(body, "quantity", 0.001, 1000, { required: true });
  const odometerKm = c.number(body, "odometerKm", 0, ODO_MAX, { required: true });
  const full = c.bool(body, "full", { required: true });
  const paidBy = c.oneOf(body, "paidBy", ["me", "rider"] as const);
  const loggedAt = c.iso(body, "loggedAt");
  return done(c, {
    amountMinor: amountMinor as number,
    quantity: quantity as number,
    odometerKm: odometerKm as number,
    full: full!,
    paidBy: paidBy ?? "me",
    loggedAt,
  });
}

export interface StartRide {
  vehicleId: string;
  mode: TripecoRideMode;
  startKm: number | null;
  startedAt: string | undefined;
  groupId: string | null;
}

export function parseStartRide(body: Record<string, unknown>): Parsed<StartRide> {
  const c = new Checker();
  const vehicleId = c.text(body, "vehicleId", 40, { required: true });
  const mode = c.oneOf<TripecoRideMode>(body, "mode", ["odo", "trip"], { required: true });
  const startKm = c.number(body, "startKm", 0, ODO_MAX, { nullable: true });
  const startedAt = c.iso(body, "startedAt");
  const groupId = c.text(body, "groupId", 40);
  return done(c, { vehicleId: vehicleId!, mode: mode!, startKm: (startKm as number | null | undefined) ?? null, startedAt, groupId: groupId ?? null });
}

export interface RidePatch {
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
  riders?: Array<{ subjectId: string; on: boolean; km: number | null }>;
  extras?: TripecoExtra[];
}

const SUBJECT_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRidePatch(body: Record<string, unknown>): Parsed<RidePatch> {
  const c = new Checker();
  const out: RidePatch = {};
  const mode = c.oneOf<TripecoRideMode>(body, "mode", ["odo", "trip"]);
  if (mode) out.mode = mode;
  for (const field of ["startKm", "endKm"] as const) {
    const v = c.number(body, field, 0, ODO_MAX, { nullable: true });
    if (v !== undefined) out[field] = v;
  }
  const tripKm = c.number(body, "tripKm", 0, DRIVE_MAX_KM, { nullable: true });
  if (tripKm !== undefined) out.tripKm = tripKm;
  const carAverage = c.number(body, "carAverage", 0.1, 100, { nullable: true });
  if (carAverage !== undefined) out.carAverage = carAverage;
  const mileageSource = c.oneOf<TripecoMileageSource>(body, "mileageSource", ["learned", "estimate", "car"]);
  if (mileageSource) out.mileageSource = mileageSource;
  const priceMinor = c.number(body, "priceMinor", 0, 10_000_00, { integer: true });
  if (typeof priceMinor === "number") out.priceMinor = priceMinor;
  const wearOn = c.bool(body, "wearOn");
  if (wearOn !== undefined) out.wearOn = wearOn;
  const title = c.text(body, "title", 80);
  if (title !== undefined) out.title = title;
  const groupId = c.text(body, "groupId", 40);
  if (groupId !== undefined) out.groupId = groupId;

  if (body.riders !== undefined) {
    if (!Array.isArray(body.riders) || body.riders.length > TRIPECO_MAX_RIDERS) {
      c.fail("riders", `Must be a list of at most ${TRIPECO_MAX_RIDERS}`);
    } else {
      const seen = new Set<string>();
      const riders: NonNullable<RidePatch["riders"]> = [];
      body.riders.forEach((raw: unknown, i) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        if (typeof r.subjectId !== "string" || !SUBJECT_RE.test(r.subjectId)) return c.fail(`riders[${i}].subjectId`, "Must be a person's id");
        if (seen.has(r.subjectId)) return c.fail(`riders[${i}].subjectId`, "Listed twice");
        seen.add(r.subjectId);
        if (typeof r.on !== "boolean") return c.fail(`riders[${i}].on`, "Must be true or false");
        if (r.km !== undefined && r.km !== null && (typeof r.km !== "number" || !Number.isFinite(r.km) || r.km < 0 || r.km > DRIVE_MAX_KM)) {
          return c.fail(`riders[${i}].km`, `Must be a number from 0 to ${DRIVE_MAX_KM}`);
        }
        riders.push({ subjectId: r.subjectId, on: r.on, km: typeof r.km === "number" ? r.km : null });
      });
      out.riders = riders;
    }
  }
  if (body.extras !== undefined) {
    if (!Array.isArray(body.extras) || body.extras.length > TRIPECO_MAX_EXTRAS) {
      c.fail("extras", `Must be a list of at most ${TRIPECO_MAX_EXTRAS}`);
    } else {
      const extras: TripecoExtra[] = [];
      body.extras.forEach((raw: unknown, i) => {
        const e = (raw ?? {}) as Record<string, unknown>;
        if (e.kind !== "toll" && e.kind !== "parking") return c.fail(`extras[${i}].kind`, "Must be toll or parking");
        if (typeof e.amountMinor !== "number" || !Number.isSafeInteger(e.amountMinor) || e.amountMinor < 0 || e.amountMinor > 10_000_000) {
          return c.fail(`extras[${i}].amountMinor`, "Must be whole paise, 0 or more");
        }
        extras.push({ kind: e.kind, amountMinor: e.amountMinor });
      });
      out.extras = extras;
    }
  }
  return done(c, out);
}

export type Photo = { ok: true; role: TripecoPhotoRole; image: string; mediaType: "image/jpeg" | "image/webp"; bytes: number } | { ok: false; fields: Fields };

/** A start or end photo: base64 JPEG or WebP (a data: prefix dropped), at most TRIPECO_PHOTO_MAX_BYTES decoded. */
export function parsePhoto(body: Record<string, unknown>): Photo {
  const c = new Checker();
  const role = c.oneOf<TripecoPhotoRole>(body, "role", ["start", "end"], { required: true });
  const raw = body.image;
  if (typeof raw !== "string" || raw.trim() === "") {
    c.fail("image", "Must be a photo, in base64");
    return { ok: false, fields: c.fields };
  }
  const image = raw.replace(/^data:[^,]{0,100};base64,/, "").replace(/\s+/g, "");
  if (image.length < 16 || image.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    c.fail("image", "Must be a JPEG or WebP photo, in base64");
    return { ok: false, fields: c.fields };
  }
  const padding = image.endsWith("==") ? 2 : image.endsWith("=") ? 1 : 0;
  const bytes = (image.length / 4) * 3 - padding;
  if (bytes > TRIPECO_PHOTO_MAX_BYTES) c.fail("image", "Must be at most 400 KB");
  const head = Uint8Array.from(atob(image.slice(0, 16)), (ch) => ch.charCodeAt(0));
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  let mediaType: "image/jpeg" | "image/webp" | null = null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) mediaType = "image/jpeg";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") mediaType = "image/webp";
  else c.fail("image", "Must be a JPEG or WebP photo, in base64");
  if (!c.ok || !role || !mediaType) return { ok: false, fields: c.fields };
  return { ok: true, role, image, mediaType, bytes };
}
