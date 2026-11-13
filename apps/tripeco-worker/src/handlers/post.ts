// A ride into Spliteco (tripeco TR-3, design §0.3, §0.4, §3).
//
//   POST /v1/tripeco/rides/{trp}/post     the ride as one exact-split expense in its group
//   POST /v1/tripeco/rides/{trp}/unpost   take it back out (Spliteco's delete)
//   GET  /v1/tripeco/rides/{trp}/proof    its numbers and photos, for the group
//   GET  /v1/tripeco/groups/{org}/rides   every ride posted to a group you are in
//
// Tripeco keeps no money: posting calls spliteco-worker's own add, edit and
// delete routes over SPLITECO_WORKER, as the caller, with `x-tripeco-ride`.
// So the member check, the split check, the currency guard, idempotency and
// the "expense for you" notification are Spliteco's. The header locks the row
// there: only a request carrying that ride's id may change it.

import {
  TRIPECO_ERROR_REASONS,
  TRIPECO_RIDE_HEADER,
  tripecoDefaultTitle,
  type TripecoGroupRidesResponse,
  type TripecoProof,
} from "@saas/contracts/tripeco";
import type { SplitecoExpenseRequest, SplitecoWriteResponse } from "@saas/contracts/spliteco";
import type { NewTripecoRide, TripecoRideRecord, TripecoVehicleRecord } from "@saas/db/tripeco";
import type { RequestContext } from "../context.js";
import { conflict, notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { orgPublicId, parseOrgPublicId, parseOwnId, parseTxnPublicId, txnPublicId } from "../ids.js";
import { hasOthers, recompute, WHOLE_RIDE_KM } from "../views.js";
import { rideResponse, type PhotoAccess } from "./drive.js";

type Spliteco = { ok: true; status: number; data: unknown } | { ok: false; response: Response };

/** One call to spliteco-worker as the caller, for `rideId` when it is a write. */
async function spliteco(ctx: RequestContext, method: string, path: string, options: { rideId?: string; body?: unknown; idemKey?: string } = {}): Promise<Spliteco> {
  if (!ctx.env.SPLITECO_WORKER) return { ok: false, response: unavailable(ctx.requestId) };
  const headers = ctx.actorHeaders();
  if (options.rideId) headers.set(TRIPECO_RIDE_HEADER, options.rideId);
  if (options.idemKey) headers.set("idempotency-key", options.idemKey);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await ctx.env.SPLITECO_WORKER.fetch(`https://spliteco.internal${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    return { ok: false, response: unavailable(ctx.requestId) };
  }
  const text = await res.text();
  if (!res.ok) {
    // Spliteco's refusal, as it said it (not in group, another currency, not found).
    return { ok: false, response: new Response(text, { status: res.status, headers: { "content-type": "application/json" } }) };
  }
  try {
    return { ok: true, status: res.status, data: (JSON.parse(text) as { data: unknown }).data };
  } catch {
    return { ok: false, response: unavailable(ctx.requestId) };
  }
}

/** The ride as a Spliteco expense: the owner paid it all; each rider who is on owes their share. */
export function expenseOf(ride: TripecoRideRecord | NewTripecoRide, vehicleName: string): SplitecoExpenseRequest {
  const owing = ride.riders.filter((r) => r.on && r.shareMinor > 0);
  return {
    title: ride.title ?? tripecoDefaultTitle(vehicleName, ride.km),
    totalMinor: ride.totalMinor,
    currency: "INR",
    category: "transport",
    occurredAt: ride.endedAt ?? ride.startedAt,
    payers: [{ subjectId: ride.ownerSubject, amountMinor: ride.totalMinor }],
    split: { method: "exact", participants: owing.map((r) => ({ subjectId: r.subjectId, amountMinor: r.shareMinor })) },
  };
}

async function ownRide(ctx: RequestContext, raw: string): Promise<TripecoRideRecord | null> {
  const id = parseOwnId("trp", raw);
  return id ? ctx.repo.rideById(ctx.actor.subjectId, id) : null;
}

async function unpostAt(ctx: RequestContext, ride: TripecoRideRecord): Promise<Response | null> {
  if (!ride.postedTxnId) return null;
  const res = await spliteco(ctx, "DELETE", `/v1/spliteco/expenses/${txnPublicId(ride.postedTxnId)}`, {
    rideId: ride.id,
    idemKey: `${ride.id}_unpost_${ride.postedTxnId.slice(0, 8)}`,
  });
  // Already gone there (deleted, or the group left) is gone: nothing to undo.
  if (!res.ok && res.response.status !== 404) return res.response;
  return null;
}

// POST /v1/tripeco/rides/{trp}/post
export async function handlePost(ctx: RequestContext, request: Request, rawId: string): Promise<Response> {
  const ride = await ownRide(ctx, rawId);
  if (!ride) return notFound(ctx.requestId);
  const body = await readJsonObject(request, { optional: true });
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  let orgId = ride.orgId;
  if (body.groupId !== undefined) {
    orgId = typeof body.groupId === "string" ? parseOrgPublicId(body.groupId) : null;
    if (!orgId) return validationError(ctx.requestId, { groupId: ["Must be a group id"] });
  }
  if (ride.km === null) return conflict(ctx.requestId, "Add the end reading first", TRIPECO_ERROR_REASONS.notDone);
  if (!orgId) return conflict(ctx.requestId, "Pick a group first", TRIPECO_ERROR_REASONS.noGroup);
  if (!hasOthers(ride)) return conflict(ctx.requestId, "Only you rode: nothing to post", TRIPECO_ERROR_REASONS.solo);
  if (!ride.riders.some((r) => r.on && r.shareMinor > 0)) return conflict(ctx.requestId, "Nobody owes anything on this ride", TRIPECO_ERROR_REASONS.noRiders);
  const v = await ctx.repo.vehicleById(ride.ownerSubject, ride.vehicleId);
  if (!v) return notFound(ctx.requestId);

  // Posted already, unchanged, to the same group: nothing to do.
  if (ride.state === "posted" && ride.postedOrgId === orgId && ride.postedVersion === ride.version) return rideResponse(ctx, ride);

  const expense = expenseOf(ride, v.name);
  const key = `${ride.id}_v${ride.version}`;
  let res: Spliteco;
  if (ride.state === "posted" && ride.postedTxnId && ride.postedOrgId === orgId) {
    // A change since posting: Spliteco's edit (a reversal plus the new version).
    res = await spliteco(ctx, "PUT", `/v1/spliteco/expenses/${txnPublicId(ride.postedTxnId)}`, { rideId: ride.id, body: expense, idemKey: key });
  } else {
    // First post, or another group: out of the old one first, then in.
    if (ride.state === "posted") {
      const refused = await unpostAt(ctx, ride);
      if (refused) return refused;
    }
    res = await spliteco(ctx, "POST", `/v1/spliteco/groups/${orgPublicId(orgId)}/expenses`, { rideId: ride.id, body: expense, idemKey: `${key}_${orgId.slice(0, 8)}` });
  }
  if (!res.ok) return res.response;
  const posted = (res.data as SplitecoWriteResponse).expense;
  const txnId = parseTxnPublicId(posted.id);
  if (!txnId) return unavailable(ctx.requestId);
  const at = ctx.now().toISOString();
  const next: NewTripecoRide = {
    ...ride,
    orgId,
    state: "posted",
    postedTxnId: txnId,
    postedOrgId: orgId,
    postedVersion: ride.version,
    postedAt: ride.postedAt && ride.postedOrgId === orgId ? ride.postedAt : at,
    updatedAt: at,
  };
  await ctx.repo.saveRide(next, { insert: false });
  return rideResponse(ctx, { ...next, photos: ride.photos });
}

// POST /v1/tripeco/rides/{trp}/unpost — Posted's Undo.
export async function handleUnpost(ctx: RequestContext, rawId: string): Promise<Response> {
  const ride = await ownRide(ctx, rawId);
  if (!ride) return notFound(ctx.requestId);
  if (ride.state !== "posted") return conflict(ctx.requestId, "This ride isn't posted", TRIPECO_ERROR_REASONS.notPosted);
  const refused = await unpostAt(ctx, ride);
  if (refused) return refused;
  const at = ctx.now().toISOString();
  const next = recompute(
    { ...ride, state: "done", postedTxnId: null, postedOrgId: null, postedVersion: null, postedAt: null, version: ride.version + 1, updatedAt: at },
    at,
    { changed: false },
  );
  await ctx.repo.saveRide(next, { insert: false });
  return rideResponse(ctx, { ...next, photos: ride.photos });
}

/** Is the caller in the group `orgId`? Asked of Spliteco as the caller: its group read answers only members. */
async function isMember(ctx: RequestContext, orgId: string): Promise<boolean | Response> {
  const res = await spliteco(ctx, "GET", `/v1/spliteco/groups/${orgPublicId(orgId)}`);
  if (res.ok) return true;
  return res.response.status === 404 || res.response.status === 403 ? false : res.response;
}

/** The owner, or a member of the group the ride is posted to. */
export const ownerOrGroup: PhotoAccess = async (ctx, ride) => {
  if (ride.ownerSubject === ctx.actor.subjectId) return true;
  if (ride.state !== "posted" || !ride.postedOrgId) return false;
  const member = await isMember(ctx, ride.postedOrgId);
  return member === true;
};

export function proofOf(ride: TripecoRideRecord, v: Pick<TripecoVehicleRecord, "name" | "fuel">): TripecoProof {
  const unit = v.fuel === "electric" ? "kWh" : v.fuel === "cng" ? "kg" : "l";
  const km = ride.km;
  return {
    id: ride.id,
    ownerSubject: ride.ownerSubject,
    title: ride.title ?? tripecoDefaultTitle(v.name, km),
    vehicleName: v.name,
    fuel: v.fuel,
    unit,
    mode: ride.mode,
    startKm: ride.startKm,
    endKm: ride.endKm,
    tripKm: ride.tripKm,
    km,
    mileage: ride.mileage,
    mileageSource: ride.mileageSource,
    priceMinor: ride.priceMinor,
    wearMinorPerKm: ride.wearOn ? ride.wearMinorPerKm : 0,
    fuelMinor: ride.fuelMinor,
    wearMinor: ride.wearMinor,
    extras: ride.extras.map((e) => ({ kind: e.kind, amountMinor: e.amountMinor })),
    totalMinor: ride.totalMinor,
    riders: ride.riders.map((r) => ({ subjectId: r.subjectId, on: r.on, km: km === null ? 0 : Math.min(r.km >= WHOLE_RIDE_KM ? km : r.km, km), shareMinor: r.shareMinor })),
    photos: ride.photos.map((p) => ({ id: p.id, role: p.role })),
    groupId: ride.postedOrgId ? orgPublicId(ride.postedOrgId) : null,
    txnId: ride.postedTxnId ? txnPublicId(ride.postedTxnId) : null,
    postedAt: ride.postedAt,
    startedAt: ride.startedAt,
  };
}

// GET /v1/tripeco/rides/{trp}/proof
export async function handleProof(ctx: RequestContext, rawId: string): Promise<Response> {
  const id = parseOwnId("trp", rawId);
  const ride = id ? await ctx.repo.rideByIdAny(id) : null;
  if (!ride) return notFound(ctx.requestId);
  if (!(await ownerOrGroup(ctx, ride))) return notFound(ctx.requestId);
  const [v] = await ctx.repo.vehiclesByIds([ride.vehicleId]);
  if (!v) return notFound(ctx.requestId);
  return successResponse({ proof: proofOf(ride, v) }, ctx.requestId);
}

// GET /v1/tripeco/groups/{org}/rides
export async function handleGroupRides(ctx: RequestContext, orgParam: string): Promise<Response> {
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const member = await isMember(ctx, orgId);
  if (member instanceof Response) return member;
  if (!member) return notFound(ctx.requestId);
  const rides = await ctx.repo.ridesPostedTo(orgId);
  const vehicles = new Map((await ctx.repo.vehiclesByIds([...new Set(rides.map((r) => r.vehicleId))])).map((v) => [v.id, v]));
  const proofs = rides.flatMap((r) => {
    const v = vehicles.get(r.vehicleId);
    return v ? [proofOf(r, v)] : [];
  });
  const owed = new Map<string, number>();
  for (const p of proofs) for (const r of p.riders) if (r.shareMinor > 0) owed.set(r.subjectId, (owed.get(r.subjectId) ?? 0) + r.shareMinor);
  const out: TripecoGroupRidesResponse = {
    groupId: orgPublicId(orgId),
    rides: proofs,
    kmTotal: Math.round(proofs.reduce((s, p) => s + (p.km ?? 0), 0) * 10) / 10,
    totalMinor: proofs.reduce((s, p) => s + p.totalMinor, 0),
    owed: [...owed].map(([subjectId, shareMinor]) => ({ subjectId, shareMinor })).sort((a, b) => b.shareMinor - a.shareMinor),
  };
  return successResponse(out, ctx.requestId);
}

