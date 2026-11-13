import type { TripecoMeResponse, TripecoRideResponse, TripecoVehicle, TripecoVehicleResponse } from "@saas/contracts/tripeco";
import { createTripeco, envelope, usr, type TripecoHarness } from "./harness.js";

// tripeco-worker (tripeco TR-2): vehicles, the fuel log, learned mileage,
// rides and their photos — the real router over SQLite with migration 610.

const ME = usr(1);
const ANU = usr(2);
const DEV = usr(3);
const MEERA = usr(4);
const OUTSIDER = usr(9);

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/";

let t: TripecoHarness;
beforeEach(() => {
  t = createTripeco();
});
afterEach(() => t.close());

async function data<T>(res: Response, status = 200): Promise<T> {
  const env = await envelope<T>(res);
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status} ${JSON.stringify(env.error)}`);
  return env.data;
}

async function swift(as = ME): Promise<TripecoVehicle> {
  const { vehicle } = await data<{ vehicle: TripecoVehicle }>(
    await t.call("POST", "/v1/tripeco/vehicles", {
      as,
      body: { name: "Swift", plate: "KL 07 CX 4412", fuel: "petrol", odometerKm: 47000, mileage: 18, priceMinor: 10400, wearMinorPerKm: 200 },
    }),
    201,
  );
  return vehicle;
}

const fuel = (veh: string, body: Record<string, unknown>, as = ME) => t.call("POST", `/v1/tripeco/vehicles/${veh}/fuel`, { as, body });

describe("vehicles", () => {
  it("are added, listed, changed and archived — their owner's only", async () => {
    const v = await swift();
    expect(v).toMatchObject({ name: "Swift", unit: "l", mileage: 18, mileageSource: "estimate", priceMinor: 10400, priceSource: "estimate", wearMinorPerKm: 200 });
    expect(v.perKmMinor).toBe(578 + 200);
    expect(v.id).toMatch(/^veh_[0-9a-f]{32}$/);

    const me = await data<TripecoMeResponse>(await t.call("GET", "/v1/tripeco/me", { as: ME }));
    expect(me.vehicles.map((x) => x.name)).toEqual(["Swift"]);
    expect((await data<TripecoMeResponse>(await t.call("GET", "/v1/tripeco/me", { as: OUTSIDER }))).vehicles).toEqual([]);

    expect((await t.call("GET", `/v1/tripeco/vehicles/${v.id}`, { as: OUTSIDER })).status).toBe(404);
    expect((await t.call("PATCH", `/v1/tripeco/vehicles/${v.id}`, { as: OUTSIDER, body: { wearMinorPerKm: 0 } })).status).toBe(404);

    const changed = await data<TripecoVehicleResponse>(await t.call("PATCH", `/v1/tripeco/vehicles/${v.id}`, { as: ME, body: { wearMinorPerKm: 250 } }));
    expect(changed.vehicle.wearMinorPerKm).toBe(250);
    expect((await t.call("PATCH", `/v1/tripeco/vehicles/${v.id}`, { as: ME, body: { fuel: "diesel" } })).status).toBe(422);

    await data(await t.call("DELETE", `/v1/tripeco/vehicles/${v.id}`, { as: ME }));
    expect((await data<TripecoMeResponse>(await t.call("GET", "/v1/tripeco/me", { as: ME }))).vehicles).toEqual([]);
  });

  it("refuses a body that makes no sense", async () => {
    const res = await t.call("POST", "/v1/tripeco/vehicles", { as: ME, body: { name: "", fuel: "steam", mileage: 0, priceMinor: 1.5 } });
    expect(res.status).toBe(422);
    const env = await envelope(res);
    expect(Object.keys((env.error?.details as { fields: object }).fields).sort()).toEqual(["fuel", "mileage", "name", "priceMinor"]);
  });

  it("speaks EV: kWh, ₹ per kWh", async () => {
    const { vehicle } = await data<{ vehicle: TripecoVehicle }>(
      await t.call("POST", "/v1/tripeco/vehicles", { as: ME, body: { name: "Nexon EV", fuel: "electric", mileage: 7.1, priceMinor: 950 } }),
      201,
    );
    expect(vehicle.unit).toBe("kWh");
    expect(vehicle.perKmMinor).toBe(134);
  });
});

describe("the fuel log", () => {
  it("learns the mileage from two full tanks, counting a part fill in between", async () => {
    const v = await swift();
    await data(await fuel(v.id, { amountMinor: 416000, quantity: 40, odometerKm: 47000, full: true, loggedAt: "2026-11-01T08:00:00Z" }), 201);
    let read = await data<TripecoVehicleResponse>(await t.call("GET", `/v1/tripeco/vehicles/${v.id}`, { as: ME }));
    expect(read.vehicle.mileageSource).toBe("estimate");
    expect(read.vehicle.priceMinor).toBe(10400);

    await data(await fuel(v.id, { amountMinor: 104000, quantity: 10, odometerKm: 47300, full: false, loggedAt: "2026-11-03T08:00:00Z" }), 201);
    const logged = await data<TripecoVehicleResponse & { logged: unknown }>(
      await fuel(v.id, { amountMinor: 428500, quantity: 41.2, odometerKm: 47920, full: true, loggedAt: "2026-11-12T08:00:00Z" }),
      201,
    );
    expect(logged.vehicle.mileageSource).toBe("learned");
    expect(logged.vehicle.learnedMileage).toBe(18);
    expect(logged.vehicle.priceMinor).toBe(10400);
    expect(logged.vehicle.odometerKm).toBe(47920);

    read = await data<TripecoVehicleResponse>(await t.call("GET", `/v1/tripeco/vehicles/${v.id}`, { as: ME }));
    expect(read.segments).toEqual([{ endKm: 47920, km: 920, quantity: 51.2, mileage: 18 }]);
    expect(read.fuel.map((f) => f.odometerKm)).toEqual([47920, 47300, 47000]);
  });

  it("deletes a fill-up only for its owner", async () => {
    const v = await swift();
    const { logged: f } = await data<{ logged: { id: string } }>(await fuel(v.id, { amountMinor: 1000, quantity: 1, odometerKm: 47010, full: false }), 201);
    expect((await t.call("DELETE", `/v1/tripeco/fuel/${f.id}`, { as: OUTSIDER })).status).toBe(404);
    expect((await t.call("DELETE", `/v1/tripeco/fuel/${f.id}`, { as: ME })).status).toBe(200);
    expect((await t.call("DELETE", `/v1/tripeco/fuel/${f.id}`, { as: ME })).status).toBe(404);
  });

  it("keeps the month's fuel for the Vehicle bar", async () => {
    const now = new Date();
    const v = await swift();
    await data(await fuel(v.id, { amountMinor: 198000, quantity: 19, odometerKm: 47100, full: true, loggedAt: now.toISOString() }), 201);
    await data(await fuel(v.id, { amountMinor: 114000, quantity: 11, odometerKm: 47200, full: false, paidBy: "rider", loggedAt: now.toISOString() }), 201);
    const read = await data<TripecoVehicleResponse>(await t.call("GET", `/v1/tripeco/vehicles/${v.id}`, { as: ME }));
    expect(read.vehicle.month).toMatchObject({ fuelMinor: 312000, ridersMinor: 114000, youMinor: 198000 });
  });
});

describe("rides", () => {
  const start = async (veh: string, body: Record<string, unknown> = {}) =>
    (await data<TripecoRideResponse>(await t.call("POST", "/v1/tripeco/rides", { as: ME, body: { vehicleId: veh, mode: "odo", startKm: 48212, ...body } }), 201)).ride;
  const patch = async (id: string, body: Record<string, unknown>, status = 200) =>
    (await data<TripecoRideResponse>(await t.call("PATCH", `/v1/tripeco/rides/${id}`, { as: ME, body }), status)).ride;

  it("start open, become done with the end reading, and split by who rode", async () => {
    const v = await swift();
    const ride = await start(v.id);
    expect(ride).toMatchObject({ state: "open", km: null, mileage: 18, mileageSource: "estimate", priceMinor: 10400, wearOn: true, title: "Swift" });
    let me = await data<TripecoMeResponse>(await t.call("GET", "/v1/tripeco/me", { as: ME }));
    expect(me.needs).toEqual([{ kind: "end", rideId: ride.id, title: "Swift end km", amountMinor: null }]);

    const done = await patch(ride.id, {
      endKm: 48336,
      wearOn: false,
      riders: [ME, ANU, DEV, MEERA].map((subjectId) => ({ subjectId, on: true })),
    });
    // 124 km ÷ 18 km/l × ₹104 = ₹716.4 → ₹716; 4 ways.
    expect(done).toMatchObject({ state: "done", km: 124, fuelMinor: 71600, totalMinor: 71600, title: "Swift · 124 km", solo: false });
    expect(done.riders.map((r) => r.shareMinor)).toEqual([17900, 17900, 17900, 17900]);
    expect(done.riders.every((r) => r.km === 124)).toBe(true);

    me = await data<TripecoMeResponse>(await t.call("GET", "/v1/tripeco/me", { as: ME }));
    expect(me.needs).toEqual([{ kind: "post", rideId: ride.id, title: "Swift · 124 km", amountMinor: 71600 }]);
    expect(me.vehicles[0]!.odometerKm).toBe(48336);

    // Meera rode half; the owner leaves themselves out; a toll.
    const split = await patch(ride.id, {
      title: "Kochi → Munnar",
      riders: [
        { subjectId: ME, on: false },
        { subjectId: ANU, on: true },
        { subjectId: DEV, on: true },
        { subjectId: MEERA, on: true, km: 62 },
      ],
      extras: [{ kind: "toll", amountMinor: 12000 }],
    });
    expect(split.totalMinor).toBe(71600 + 12000);
    expect(split.riders.map((r) => [r.km, r.shareMinor])).toEqual([
      [124, 0],
      // ₹716 by km 124 : 124 : 62 is 286.4 / 286.4 / 143.2 — the spare rupee to the first; the toll ₹40 each.
      [124, 28700 + 4000],
      [124, 28600 + 4000],
      [62, 14300 + 4000],
    ]);
    expect(split.riders.reduce((s, r) => s + r.shareMinor, 0)).toBe(split.totalMinor);
    expect(split.title).toBe("Kochi → Munnar");
  });

  it("use the car's own average in Trip reset when asked, and switch back", async () => {
    const v = await swift();
    const ride = await start(v.id, { mode: "trip", startKm: undefined });
    const read = await patch(ride.id, { tripKm: 124, carAverage: 20.4, mileageSource: "car", wearOn: false });
    expect(read).toMatchObject({ km: 124, mileage: 20.4, mileageSource: "car", learnedMileage: 18, fuelMinor: 63200 });
    const back = await patch(ride.id, { mileageSource: "learned" });
    expect(back).toMatchObject({ mileage: 18, mileageSource: "estimate", fuelMinor: 71600 });
    expect((await t.call("PATCH", `/v1/tripeco/rides/${ride.id}`, { as: ME, body: { carAverage: null, mileageSource: "car" } })).status).toBe(422);
  });

  it("count a solo drive as done with nothing to post", async () => {
    const v = await swift();
    const ride = await start(v.id);
    const done = await patch(ride.id, { endKm: 48234 });
    expect(done).toMatchObject({ state: "done", solo: true, km: 22 });
    expect((await data<TripecoMeResponse>(await t.call("GET", "/v1/tripeco/me", { as: ME }))).needs).toEqual([]);
  });

  it("refuse readings that make no sense (risk TR-A)", async () => {
    const v = await swift();
    const ride = await start(v.id);
    expect((await t.call("PATCH", `/v1/tripeco/rides/${ride.id}`, { as: ME, body: { endKm: 48000 } })).status).toBe(422);
    expect((await t.call("PATCH", `/v1/tripeco/rides/${ride.id}`, { as: ME, body: { endKm: 51000 } })).status).toBe(422);
    expect((await t.call("PATCH", `/v1/tripeco/rides/${ride.id}`, { as: ME, body: { riders: [{ subjectId: ANU, on: true }, { subjectId: ANU, on: true }] } })).status).toBe(422);
  });

  it("are their owner's only, and an unposted one can be discarded", async () => {
    const v = await swift();
    const ride = await start(v.id);
    expect((await t.call("GET", `/v1/tripeco/rides/${ride.id}`, { as: OUTSIDER })).status).toBe(404);
    expect((await t.call("PATCH", `/v1/tripeco/rides/${ride.id}`, { as: OUTSIDER, body: { endKm: 48300 } })).status).toBe(404);
    expect((await t.call("POST", "/v1/tripeco/rides", { as: OUTSIDER, body: { vehicleId: v.id, mode: "odo" } })).status).toBe(422);
    expect((await t.call("DELETE", `/v1/tripeco/rides/${ride.id}`, { as: OUTSIDER })).status).toBe(404);
    expect((await t.call("DELETE", `/v1/tripeco/rides/${ride.id}`, { as: ME })).status).toBe(200);
    expect((await t.call("GET", `/v1/tripeco/rides/${ride.id}`, { as: ME })).status).toBe(404);
  });

  it("keep their start and end photos, a retake replacing the first", async () => {
    const v = await swift();
    const ride = await start(v.id);
    const first = await data<{ photo: { id: string } }>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/photos`, { as: ME, body: { role: "start", image: JPEG } }), 201);
    const retake = await data<{ photo: { id: string } }>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/photos`, { as: ME, body: { role: "start", image: `data:image/jpeg;base64,${JPEG}` } }), 201);
    await data(await t.call("POST", `/v1/tripeco/rides/${ride.id}/photos`, { as: ME, body: { role: "end", image: JPEG } }), 201);
    const read = (await data<TripecoRideResponse>(await t.call("GET", `/v1/tripeco/rides/${ride.id}`, { as: ME }))).ride;
    expect(read.photos.map((p) => p.role)).toEqual(["start", "end"]);
    expect(read.photos[0]!.id).toBe(retake.photo.id);
    expect((await t.call("GET", `/v1/tripeco/photos/${first.photo.id}`, { as: ME })).status).toBe(404);
    const photo = await data<{ photo: { image: string; mediaType: string } }>(await t.call("GET", `/v1/tripeco/photos/${retake.photo.id}`, { as: ME }));
    expect(photo.photo).toMatchObject({ image: JPEG, mediaType: "image/jpeg" });
    expect((await t.call("GET", `/v1/tripeco/photos/${retake.photo.id}`, { as: OUTSIDER })).status).toBe(404);
    expect((await t.call("POST", `/v1/tripeco/rides/${ride.id}/photos`, { as: ME, body: { role: "start", image: "aGVsbG8gd29ybGQhISE=" } })).status).toBe(422);
  });
});

describe("the door", () => {
  it("is 401 without an actor and 403 for an assistant", async () => {
    expect((await t.call("GET", "/v1/tripeco/me", { as: null })).status).toBe(401);
    expect((await t.call("GET", "/v1/tripeco/me", { as: ME, headers: { "x-actor-delegation-id": "dlg_x" } })).status).toBe(403);
    expect((await t.call("GET", "/v1/tripeco/nope", { as: ME })).status).toBe(404);
  });
});
