// Vehicles, the fuel log, rides and their photos (tripeco TR-2, design §3).
// Everything here is the caller's own: a row of anyone else's reads as the
// opaque 404.

import { DRIVE_MAX_KM } from "@saas/kitchen-engine/drive";
import { TRIPECO_ERROR_REASONS } from "@saas/contracts/tripeco";
import type { NewTripecoRide, TripecoFuelLogRecord, TripecoRideRecord, TripecoVehicleRecord } from "@saas/db/tripeco";
import type { RequestContext } from "../context.js";
import { conflict, notFound, readJsonObject, successResponse, validationError } from "../http.js";
import { newId, parseOrgPublicId, parseOwnId } from "../ids.js";
import { parseFuel, parsePhoto, parseRidePatch, parseStartRide, parseVehicle, parseVehiclePatch } from "../validate.js";
import { fuelView, needsOf, recompute, rideView, vehicleFigures, vehicleView, WHOLE_RIDE_KM } from "../views.js";

const badBody = (ctx: RequestContext) => validationError(ctx.requestId, { body: ["Must be a JSON object"] });

interface Owned {
  vehicles: TripecoVehicleRecord[];
  fills: TripecoFuelLogRecord[];
  rides: TripecoRideRecord[];
}

/** The caller's vehicles (archived too, for ride names), fill-ups and rides. */
async function loadOwned(ctx: RequestContext, options: { rides?: number } = {}): Promise<Owned> {
  const owner = ctx.actor.subjectId;
  const vehicles = await ctx.repo.listVehicles(owner, { archived: true });
  const [fills, rides] = await Promise.all([
    ctx.repo.listFuel(owner, vehicles.map((v) => v.id)),
    ctx.repo.listRides(owner, { limit: options.rides ?? 200 }),
  ]);
  return { vehicles, fills, rides };
}

const fillsOf = (fills: readonly TripecoFuelLogRecord[], vehicleId: string) => fills.filter((f) => f.vehicleId === vehicleId);

function viewRide(ride: TripecoRideRecord, owned: Pick<Owned, "vehicles" | "fills">) {
  const vehicle = owned.vehicles.find((v) => v.id === ride.vehicleId);
  if (!vehicle) return null;
  return rideView(ride, vehicle, vehicleFigures(vehicle, fillsOf(owned.fills, vehicle.id)).mileage);
}

// GET /v1/tripeco/me
export async function handleMe(ctx: RequestContext): Promise<Response> {
  const owned = await loadOwned(ctx);
  const now = ctx.now();
  const vehicles = owned.vehicles.filter((v) => !v.archivedAt).map((v) => vehicleView(v, fillsOf(owned.fills, v.id), owned.rides, now));
  const rides = owned.rides.flatMap((r) => viewRide(r, owned) ?? []);
  return successResponse({ vehicles, rides: rides.slice(0, 20), needs: needsOf(rides) }, ctx.requestId);
}

// GET /v1/tripeco/vehicles
export async function handleListVehicles(ctx: RequestContext): Promise<Response> {
  const owned = await loadOwned(ctx);
  const now = ctx.now();
  const vehicles = owned.vehicles.filter((v) => !v.archivedAt).map((v) => vehicleView(v, fillsOf(owned.fills, v.id), owned.rides, now));
  return successResponse({ vehicles }, ctx.requestId);
}

// POST /v1/tripeco/vehicles
export async function handleCreateVehicle(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return badBody(ctx);
  const parsed = parseVehicle(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const at = ctx.now().toISOString();
  const v: TripecoVehicleRecord = {
    id: newId("veh"),
    ownerSubject: ctx.actor.subjectId,
    name: parsed.value.name,
    plate: parsed.value.plate,
    fuel: parsed.value.fuel,
    odometerKm: parsed.value.odometerKm,
    estimateMileage: parsed.value.mileage,
    estimatePriceMinor: parsed.value.priceMinor,
    wearMinorPerKm: parsed.value.wearMinorPerKm,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
  };
  await ctx.repo.insertVehicle(v);
  return successResponse({ vehicle: vehicleView(v, [], [], ctx.now()) }, ctx.requestId, 201);
}

async function ownVehicle(ctx: RequestContext, raw: string): Promise<TripecoVehicleRecord | null> {
  const id = parseOwnId("veh", raw);
  return id ? ctx.repo.vehicleById(ctx.actor.subjectId, id) : null;
}

async function vehicleResponse(ctx: RequestContext, v: TripecoVehicleRecord, status = 200): Promise<Response> {
  const owner = ctx.actor.subjectId;
  const [fills, rides] = await Promise.all([ctx.repo.listFuel(owner, [v.id]), ctx.repo.listRides(owner, { vehicleId: v.id })]);
  const figures = vehicleFigures(v, fills);
  return successResponse(
    {
      vehicle: vehicleView(v, fills, rides, ctx.now()),
      segments: figures.learned.segments,
      fuel: [...fills].reverse().map(fuelView),
    },
    ctx.requestId,
    status,
  );
}

// GET /v1/tripeco/vehicles/{veh}
export async function handleVehicle(ctx: RequestContext, rawId: string): Promise<Response> {
  const v = await ownVehicle(ctx, rawId);
  return v ? vehicleResponse(ctx, v) : notFound(ctx.requestId);
}

// PATCH /v1/tripeco/vehicles/{veh}
export async function handlePatchVehicle(ctx: RequestContext, request: Request, rawId: string): Promise<Response> {
  const v = await ownVehicle(ctx, rawId);
  if (!v) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return badBody(ctx);
  const parsed = parseVehiclePatch(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  if (v.archivedAt) return conflict(ctx.requestId, "That vehicle was removed", TRIPECO_ERROR_REASONS.archived);
  const p = parsed.value;
  const next: TripecoVehicleRecord = {
    ...v,
    name: p.name ?? v.name,
    plate: p.plate !== undefined ? p.plate : v.plate,
    odometerKm: p.odometerKm ?? v.odometerKm,
    estimateMileage: p.mileage ?? v.estimateMileage,
    estimatePriceMinor: p.priceMinor ?? v.estimatePriceMinor,
    wearMinorPerKm: p.wearMinorPerKm ?? v.wearMinorPerKm,
    updatedAt: ctx.now().toISOString(),
  };
  await ctx.repo.updateVehicle(next);
  return vehicleResponse(ctx, next);
}

// DELETE /v1/tripeco/vehicles/{veh} — archived: its rides and fuel log stay.
export async function handleArchiveVehicle(ctx: RequestContext, rawId: string): Promise<Response> {
  const v = await ownVehicle(ctx, rawId);
  if (!v) return notFound(ctx.requestId);
  const at = ctx.now().toISOString();
  const next = { ...v, archivedAt: v.archivedAt ?? at, updatedAt: at };
  await ctx.repo.updateVehicle(next);
  return successResponse({ vehicle: vehicleView(next, [], [], ctx.now()) }, ctx.requestId);
}

// POST /v1/tripeco/vehicles/{veh}/fuel
export async function handleLogFuel(ctx: RequestContext, request: Request, rawId: string): Promise<Response> {
  const v = await ownVehicle(ctx, rawId);
  if (!v) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return badBody(ctx);
  const parsed = parseFuel(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  if (v.archivedAt) return conflict(ctx.requestId, "That vehicle was removed", TRIPECO_ERROR_REASONS.archived);
  const at = ctx.now().toISOString();
  const f: TripecoFuelLogRecord = {
    id: newId("ful"),
    vehicleId: v.id,
    ownerSubject: ctx.actor.subjectId,
    amountMinor: parsed.value.amountMinor,
    quantityMilli: Math.round(parsed.value.quantity * 1000),
    odometerKm: parsed.value.odometerKm,
    full: parsed.value.full,
    paidBy: parsed.value.paidBy,
    loggedAt: parsed.value.loggedAt ?? at,
    createdAt: at,
  };
  if (f.quantityMilli <= 0) return validationError(ctx.requestId, { quantity: ["Must be more than 0"] });
  await ctx.repo.insertFuel(f);
  await ctx.repo.raiseOdometer(v.ownerSubject, v.id, f.odometerKm, at);
  const fresh = (await ctx.repo.vehicleById(v.ownerSubject, v.id)) ?? v;
  const res = await vehicleResponse(ctx, fresh, 201);
  const data = ((await res.json()) as { data: Record<string, unknown> }).data;
  return successResponse({ ...data, logged: fuelView(f) }, ctx.requestId, 201);
}

// DELETE /v1/tripeco/fuel/{ful} — the app holds it for Undo before sending this.
export async function handleDeleteFuel(ctx: RequestContext, rawId: string): Promise<Response> {
  const id = parseOwnId("ful", rawId);
  if (!id || !(await ctx.repo.deleteFuel(ctx.actor.subjectId, id))) return notFound(ctx.requestId);
  return successResponse({ deleted: id }, ctx.requestId);
}

/** Readings that make no sense: an end below the start, a ride past DRIVE_MAX_KM (risk TR-A). */
function readingsProblem(r: Pick<NewTripecoRide, "mode" | "startKm" | "endKm" | "tripKm">): Record<string, string[]> | null {
  if (r.mode === "odo" && r.startKm !== null && r.endKm !== null) {
    if (r.endKm < r.startKm) return { endKm: ["Must be at least the start reading"] };
    if (r.endKm - r.startKm > DRIVE_MAX_KM) return { endKm: [`At most ${DRIVE_MAX_KM} km past the start`] };
  }
  return null;
}

// POST /v1/tripeco/rides — start one.
export async function handleStartRide(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return badBody(ctx);
  const parsed = parseStartRide(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const v = await ownVehicle(ctx, parsed.value.vehicleId);
  if (!v) return validationError(ctx.requestId, { vehicleId: ["Not one of your vehicles"] });
  if (v.archivedAt) return conflict(ctx.requestId, "That vehicle was removed", TRIPECO_ERROR_REASONS.archived);
  let orgId: string | null = null;
  if (parsed.value.groupId !== null) {
    orgId = parseOrgPublicId(parsed.value.groupId);
    if (!orgId) return validationError(ctx.requestId, { groupId: ["Must be a group id"] });
  }
  const owner = ctx.actor.subjectId;
  const fills = await ctx.repo.listFuel(owner, [v.id]);
  const figures = vehicleFigures(v, fills);
  const at = ctx.now().toISOString();
  const ride = recompute(
    {
      id: newId("trp"),
      vehicleId: v.id,
      ownerSubject: owner,
      state: "open",
      mode: parsed.value.mode,
      startKm: parsed.value.mode === "trip" ? null : parsed.value.startKm,
      endKm: null,
      tripKm: null,
      carAverage: null,
      km: null,
      mileage: figures.mileage,
      mileageSource: figures.mileageSource,
      priceMinor: figures.priceMinor,
      wearOn: v.wearMinorPerKm > 0,
      wearMinorPerKm: v.wearMinorPerKm,
      title: null,
      orgId,
      fuelMinor: 0,
      wearMinor: 0,
      extrasMinor: 0,
      totalMinor: 0,
      version: 1,
      postedTxnId: null,
      postedOrgId: null,
      postedVersion: null,
      postedAt: null,
      startedAt: parsed.value.startedAt ?? at,
      endedAt: null,
      createdAt: at,
      updatedAt: at,
      riders: [{ subjectId: owner, on: true, km: WHOLE_RIDE_KM, shareMinor: 0 }],
      extras: [],
    },
    at,
    { changed: true },
  );
  await ctx.repo.saveRide(ride, { insert: true });
  if (ride.startKm !== null) await ctx.repo.raiseOdometer(owner, v.id, ride.startKm, at);
  return successResponse({ ride: rideView({ ...ride, photos: [] }, v, figures.mileage) }, ctx.requestId, 201);
}

async function ownRide(ctx: RequestContext, raw: string): Promise<TripecoRideRecord | null> {
  const id = parseOwnId("trp", raw);
  return id ? ctx.repo.rideById(ctx.actor.subjectId, id) : null;
}

/** The ride as answered, with its vehicle's current figure. */
export async function rideResponse(ctx: RequestContext, ride: TripecoRideRecord, status = 200): Promise<Response> {
  const owner = ride.ownerSubject;
  const v = await ctx.repo.vehicleById(owner, ride.vehicleId);
  if (!v) return notFound(ctx.requestId);
  const fills = await ctx.repo.listFuel(owner, [v.id]);
  return successResponse({ ride: rideView(ride, v, vehicleFigures(v, fills).mileage) }, ctx.requestId, status);
}

// GET /v1/tripeco/rides
export async function handleListRides(ctx: RequestContext): Promise<Response> {
  const owned = await loadOwned(ctx);
  return successResponse({ rides: owned.rides.flatMap((r) => viewRide(r, owned) ?? []) }, ctx.requestId);
}

// GET /v1/tripeco/rides/{trp}
export async function handleRide(ctx: RequestContext, rawId: string): Promise<Response> {
  const ride = await ownRide(ctx, rawId);
  return ride ? rideResponse(ctx, ride) : notFound(ctx.requestId);
}

// PATCH /v1/tripeco/rides/{trp} — readings, mileage, price, riders, extras, wear, title, group.
export async function handlePatchRide(ctx: RequestContext, request: Request, rawId: string): Promise<Response> {
  const ride = await ownRide(ctx, rawId);
  if (!ride) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return badBody(ctx);
  const parsed = parseRidePatch(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const p = parsed.value;
  const owner = ctx.actor.subjectId;
  const v = await ctx.repo.vehicleById(owner, ride.vehicleId);
  if (!v) return notFound(ctx.requestId);

  const next: NewTripecoRide = { ...ride };
  if (p.mode !== undefined) next.mode = p.mode;
  if (p.startKm !== undefined) next.startKm = p.startKm;
  if (p.endKm !== undefined) next.endKm = p.endKm;
  if (p.tripKm !== undefined) next.tripKm = p.tripKm;
  if (p.carAverage !== undefined) next.carAverage = p.carAverage;
  if (p.priceMinor !== undefined) next.priceMinor = p.priceMinor;
  if (p.wearOn !== undefined) next.wearOn = p.wearOn;
  if (p.title !== undefined) next.title = p.title;
  if (p.groupId !== undefined) {
    if (p.groupId === null) next.orgId = null;
    else {
      const org = parseOrgPublicId(p.groupId);
      if (!org) return validationError(ctx.requestId, { groupId: ["Must be a group id"] });
      next.orgId = org;
    }
  }
  const source = p.mileageSource ?? next.mileageSource;
  if (source === "car") {
    if (next.carAverage === null) return validationError(ctx.requestId, { mileageSource: ["Car display needs the car's average"] });
    next.mileageSource = "car";
    next.mileage = next.carAverage;
  } else if (p.mileageSource !== undefined) {
    const figures = vehicleFigures(v, await ctx.repo.listFuel(owner, [v.id]));
    next.mileageSource = figures.mileageSource;
    next.mileage = figures.mileage;
  }
  if (p.riders !== undefined) {
    const riders = p.riders.map((r) => ({ subjectId: r.subjectId, on: r.on, km: r.km ?? WHOLE_RIDE_KM, shareMinor: 0 }));
    if (!riders.some((r) => r.subjectId === owner)) riders.unshift({ subjectId: owner, on: true, km: WHOLE_RIDE_KM, shareMinor: 0 });
    // A km slider at the ride's full length means "the whole ride".
    const km = next.mode === "trip" ? next.tripKm : next.startKm !== null && next.endKm !== null ? next.endKm - next.startKm : null;
    for (const r of riders) if (km !== null && r.km >= km) r.km = WHOLE_RIDE_KM;
    next.riders = riders;
  }
  if (p.extras !== undefined) next.extras = p.extras;
  const problem = readingsProblem(next);
  if (problem) return validationError(ctx.requestId, problem);

  const at = ctx.now().toISOString();
  const saved = recompute(next, at, { changed: true });
  await ctx.repo.saveRide(saved, { insert: false });
  if (saved.endKm !== null) await ctx.repo.raiseOdometer(owner, v.id, saved.endKm, at);
  return rideResponse(ctx, { ...saved, photos: ride.photos });
}

// DELETE /v1/tripeco/rides/{trp} — discard an unposted ride.
export async function handleDeleteRide(ctx: RequestContext, rawId: string): Promise<Response> {
  const ride = await ownRide(ctx, rawId);
  if (!ride) return notFound(ctx.requestId);
  if (ride.state === "posted") return conflict(ctx.requestId, "Undo the post first", TRIPECO_ERROR_REASONS.posted);
  await ctx.repo.deleteRide(ctx.actor.subjectId, ride.id);
  return successResponse({ deleted: ride.id }, ctx.requestId);
}

// POST /v1/tripeco/rides/{trp}/photos — a start or end photo (a retake replaces it).
export async function handlePutPhoto(ctx: RequestContext, request: Request, rawId: string): Promise<Response> {
  const ride = await ownRide(ctx, rawId);
  if (!ride) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return badBody(ctx);
  const photo = parsePhoto(body);
  if (!photo.ok) return validationError(ctx.requestId, photo.fields);
  const id = newId("pho");
  await ctx.repo.putPhoto({ id, rideId: ride.id, role: photo.role, mediaType: photo.mediaType, data: photo.image, bytes: photo.bytes, createdAt: ctx.now().toISOString() });
  return successResponse({ photo: { id, role: photo.role } }, ctx.requestId, 201);
}

/** A photo's ride when the caller may see it; TR-3 widens this to the members of the group it posted to. */
export type PhotoAccess = (ctx: RequestContext, ride: TripecoRideRecord) => Promise<boolean>;

export const ownerOnly: PhotoAccess = async (ctx, ride) => ride.ownerSubject === ctx.actor.subjectId;

// GET /v1/tripeco/photos/{pho}
export async function handlePhoto(ctx: RequestContext, rawId: string, mayRead: PhotoAccess = ownerOnly): Promise<Response> {
  const id = parseOwnId("pho", rawId);
  const photo = id ? await ctx.repo.photoById(id) : null;
  const ride = photo ? await ctx.repo.rideByIdAny(photo.rideId) : null;
  if (!photo || !ride || !(await mayRead(ctx, ride))) return notFound(ctx.requestId);
  return successResponse({ photo: { id: photo.id, role: photo.role, mediaType: photo.mediaType, image: photo.data } }, ctx.requestId);
}
