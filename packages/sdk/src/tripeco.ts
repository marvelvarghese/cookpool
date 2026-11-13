import type {
  TripecoFuelRequest,
  TripecoMeResponse,
  TripecoPhotoRequest,
  TripecoPhotoResponse,
  TripecoRidePatch,
  TripecoRideResponse,
  TripecoStartRideRequest,
  TripecoVehiclePatch,
  TripecoVehicleRequest,
  TripecoVehicleResponse,
  TripecoVehiclesResponse,
  TripecoFuelLog,
  TripecoRide,
  TripecoVehicle,
  TripecoPhoto,
} from "@saas/contracts/tripeco";

import type { RequestOptions, Transport } from "./transport.js";

const BASE = "/v1/tripeco";

const seg = (id: string): string => encodeURIComponent(id);

/**
 * Tripeco (tripeco TR-2): vehicles, a private fuel log and rides, under
 * `/v1/tripeco/…`. Everything is the caller's own; a posted ride's proof is
 * also the group's (TR-3).
 */
export class TripecoClient {
  constructor(private readonly transport: Transport) {}

  /** GET /v1/tripeco/me — vehicles, recent rides and what needs you. */
  me(opts: RequestOptions = {}): Promise<TripecoMeResponse> {
    return this.transport.request<TripecoMeResponse>({ method: "GET", path: `${BASE}/me` }, opts);
  }

  vehicles(opts: RequestOptions = {}): Promise<TripecoVehiclesResponse> {
    return this.transport.request<TripecoVehiclesResponse>({ method: "GET", path: `${BASE}/vehicles` }, opts);
  }

  createVehicle(body: TripecoVehicleRequest, opts: RequestOptions = {}): Promise<{ vehicle: TripecoVehicle }> {
    return this.transport.request<{ vehicle: TripecoVehicle }>({ method: "POST", path: `${BASE}/vehicles`, body }, opts);
  }

  /** GET /v1/tripeco/vehicles/{veh} — the vehicle, its full-tank segments and its fuel log. */
  vehicle(vehicleId: string, opts: RequestOptions = {}): Promise<TripecoVehicleResponse> {
    return this.transport.request<TripecoVehicleResponse>({ method: "GET", path: `${BASE}/vehicles/${seg(vehicleId)}` }, opts);
  }

  updateVehicle(vehicleId: string, body: TripecoVehiclePatch, opts: RequestOptions = {}): Promise<TripecoVehicleResponse> {
    return this.transport.request<TripecoVehicleResponse>({ method: "PATCH", path: `${BASE}/vehicles/${seg(vehicleId)}`, body }, opts);
  }

  archiveVehicle(vehicleId: string, opts: RequestOptions = {}): Promise<{ vehicle: TripecoVehicle }> {
    return this.transport.request<{ vehicle: TripecoVehicle }>({ method: "DELETE", path: `${BASE}/vehicles/${seg(vehicleId)}` }, opts);
  }

  /** POST /v1/tripeco/vehicles/{veh}/fuel — a fill-up or charge (`logged`); answers the vehicle as it now reads. */
  logFuel(vehicleId: string, body: TripecoFuelRequest, opts: RequestOptions = {}): Promise<TripecoVehicleResponse & { logged: TripecoFuelLog }> {
    return this.transport.request<TripecoVehicleResponse & { logged: TripecoFuelLog }>(
      { method: "POST", path: `${BASE}/vehicles/${seg(vehicleId)}/fuel`, body },
      opts,
    );
  }

  deleteFuel(fuelId: string, opts: RequestOptions = {}): Promise<{ deleted: string }> {
    return this.transport.request<{ deleted: string }>({ method: "DELETE", path: `${BASE}/fuel/${seg(fuelId)}` }, opts);
  }

  rides(opts: RequestOptions = {}): Promise<{ rides: TripecoRide[] }> {
    return this.transport.request<{ rides: TripecoRide[] }>({ method: "GET", path: `${BASE}/rides` }, opts);
  }

  /** POST /v1/tripeco/rides — start a ride (Odometer or Trip reset). */
  startRide(body: TripecoStartRideRequest, opts: RequestOptions = {}): Promise<TripecoRideResponse> {
    return this.transport.request<TripecoRideResponse>({ method: "POST", path: `${BASE}/rides`, body }, opts);
  }

  ride(rideId: string, opts: RequestOptions = {}): Promise<TripecoRideResponse> {
    return this.transport.request<TripecoRideResponse>({ method: "GET", path: `${BASE}/rides/${seg(rideId)}` }, opts);
  }

  /** PATCH /v1/tripeco/rides/{trp} — readings, mileage, price, riders, extras, wear, title, group. */
  updateRide(rideId: string, body: TripecoRidePatch, opts: RequestOptions = {}): Promise<TripecoRideResponse> {
    return this.transport.request<TripecoRideResponse>({ method: "PATCH", path: `${BASE}/rides/${seg(rideId)}`, body }, opts);
  }

  discardRide(rideId: string, opts: RequestOptions = {}): Promise<{ deleted: string }> {
    return this.transport.request<{ deleted: string }>({ method: "DELETE", path: `${BASE}/rides/${seg(rideId)}` }, opts);
  }

  /** POST /v1/tripeco/rides/{trp}/photos — the start or end odometer photo, kept as proof. */
  putPhoto(rideId: string, body: TripecoPhotoRequest, opts: RequestOptions = {}): Promise<{ photo: TripecoPhoto }> {
    return this.transport.request<{ photo: TripecoPhoto }>({ method: "POST", path: `${BASE}/rides/${seg(rideId)}/photos`, body }, opts);
  }

  /** GET /v1/tripeco/photos/{pho} — the photo as base64. */
  photo(photoId: string, opts: RequestOptions = {}): Promise<TripecoPhotoResponse> {
    return this.transport.request<TripecoPhotoResponse>({ method: "GET", path: `${BASE}/photos/${seg(photoId)}` }, opts);
  }
}
