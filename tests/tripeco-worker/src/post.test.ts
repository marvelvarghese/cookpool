import type { TripecoGroupRidesResponse, TripecoProofResponse, TripecoRideResponse, TripecoVehicle } from "@saas/contracts/tripeco";
import type { SplitecoExpenseResponse, SplitecoGroupResponse, SplitecoWriteResponse } from "@saas/contracts/spliteco";
import { createTripeco, envelope, usr, type Group, type TripecoHarness } from "./harness.js";

// A ride into Spliteco (tripeco TR-3): posted through spliteco-worker's own
// routes as one locked exact-split expense; Spliteco refuses to change it;
// Tripeco unposts and reposts it; the group reads its proof.

const ME = usr(1);
const ANU = usr(2);
const DEV = usr(3);
const MEERA = usr(4);
const OUTSIDER = usr(9);
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/";

let t: TripecoHarness;
let goa: Group;
let flat: Group;
beforeEach(() => {
  t = createTripeco();
  goa = t.h.group("Goa Trip", { madeIn: "spliteco", kind: "trip" });
  flat = t.h.group("Flat 4B", { madeIn: "spliteco", kind: "home" });
  for (const id of [ME, ANU, DEV, MEERA]) t.h.grant(id, goa, id === ME ? "owner" : "builder");
  for (const id of [ME, ANU]) t.h.grant(id, flat, id === ME ? "owner" : "builder");
  for (const [id, name] of [[ME, "You"], [ANU, "Anu"], [DEV, "Dev"], [MEERA, "Meera"]] as const) t.h.profile(id, { displayName: name, email: `${name}@t.test` });
});
afterEach(() => t.close());

async function data<T>(res: Response, status = 200): Promise<T> {
  const env = await envelope<T>(res);
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status} ${JSON.stringify(env.error)}`);
  return env.data;
}
const reason = async (res: Response) => ((await envelope(res)).error?.details as { reason?: string } | undefined)?.reason;

async function doneRide(riders = [ME, ANU, DEV, MEERA], group: Group | null = goa) {
  const { vehicle } = await data<{ vehicle: TripecoVehicle }>(
    await t.call("POST", "/v1/tripeco/vehicles", { as: ME, body: { name: "Swift", fuel: "petrol", mileage: 18.6, priceMinor: 10400 } }),
    201,
  );
  const { ride } = await data<TripecoRideResponse>(await t.call("POST", "/v1/tripeco/rides", { as: ME, body: { vehicleId: vehicle.id, mode: "odo", startKm: 48212 } }), 201);
  const patched = await data<TripecoRideResponse>(
    await t.call("PATCH", `/v1/tripeco/rides/${ride.id}`, {
      as: ME,
      body: { endKm: 48336, title: "Kochi → Munnar", groupId: group?.publicId ?? null, riders: riders.map((subjectId) => ({ subjectId, on: true })) },
    }),
  );
  return patched.ride;
}

const balances = async (as = ME) => (await data<SplitecoGroupResponse>(await t.spliteco("GET", `/v1/spliteco/groups/${goa.publicId}`, { as }))) as SplitecoGroupResponse & {
  balances?: unknown;
};

describe("posting a ride", () => {
  it("is one exact-split expense the owner paid, locked to Tripeco, that moves the group's balances", async () => {
    const ride = await doneRide();
    expect(ride.totalMinor).toBe(69300);
    const posted = (await data<TripecoRideResponse>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/post`, { as: ME }))).ride;
    expect(posted.state).toBe("posted");
    expect(posted.posted).toMatchObject({ groupId: goa.publicId, stale: false });

    const expense = (await data<SplitecoExpenseResponse>(await t.spliteco("GET", `/v1/spliteco/expenses/${posted.posted!.txnId}`, { as: ANU }))).expense;
    expect(expense).toMatchObject({ title: "Kochi → Munnar", totalMinor: 69300, category: "transport", locked: true, source: { kind: "tripeco", id: ride.id } });
    expect(expense.payers).toEqual([{ subjectId: ME, paidMinor: 69300 }]);
    expect(expense.splits.find((s) => s.subjectId === ANU)?.owedMinor).toBe(17300);
    expect(expense.myNetMinor).toBe(-17300);

    const group = JSON.stringify(await balances());
    expect(group).toContain(posted.posted!.txnId);
    // Posting again unchanged changes nothing.
    const again = (await data<TripecoRideResponse>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/post`, { as: ME }))).ride;
    expect(again.posted!.txnId).toBe(posted.posted!.txnId);
    // Everyone on it is told, as for any expense.
    expect(t.h.sent.length).toBeGreaterThan(0);
  });

  it("is refused by Spliteco: edit, delete and move answer owned_by_tripeco", async () => {
    const ride = await doneRide();
    const txn = (await data<TripecoRideResponse>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/post`, { as: ME }))).ride.posted!.txnId;
    const edit = await t.spliteco("PUT", `/v1/spliteco/expenses/${txn}`, {
      as: ME,
      headers: { "idempotency-key": "ikey_edit_1" },
      body: { title: "Mine", totalMinor: 100, payers: [{ subjectId: ME, amountMinor: 100 }], split: { method: "equal", participants: [ME, ANU] } },
    });
    expect([edit.status, await reason(edit)]).toEqual([409, "owned_by_tripeco"]);
    const del = await t.spliteco("DELETE", `/v1/spliteco/expenses/${txn}`, { as: ME, headers: { "idempotency-key": "ikey_del_1" } });
    expect([del.status, await reason(del)]).toEqual([409, "owned_by_tripeco"]);
    const move = await t.spliteco("POST", `/v1/spliteco/expenses/${txn}/move`, { as: ME, headers: { "idempotency-key": "ikey_mv_1" }, body: { toGroupId: flat.publicId } });
    expect([move.status, await reason(move)]).toEqual([409, "owned_by_tripeco"]);
    // A forged header for another ride is no key either.
    const forged = await t.spliteco("DELETE", `/v1/spliteco/expenses/${txn}`, { as: ME, headers: { "idempotency-key": "ikey_del_2", "x-tripeco-ride": `trp_${"f".repeat(32)}` } });
    expect([forged.status, await reason(forged)]).toEqual([409, "owned_by_tripeco"]);
    // Comments stay open.
    expect((await t.spliteco("POST", `/v1/spliteco/expenses/${txn}/comments`, { as: ANU, body: { body: "Thanks!" } })).status).toBe(201);
  });

  it("can't use the ride header to change an ordinary bill", async () => {
    const bill = await t.spliteco("POST", `/v1/spliteco/groups/${goa.publicId}/expenses`, {
      as: ME,
      headers: { "idempotency-key": "ikey_bill" },
      body: { title: "Dinner", totalMinor: 400, payers: [{ subjectId: ME, amountMinor: 400 }], split: { method: "equal", participants: [ME, ANU] } },
    });
    const id = (await data<SplitecoWriteResponse>(bill, 201)).expense.id;
    const del = await t.spliteco("DELETE", `/v1/spliteco/expenses/${id}`, { as: ME, headers: { "idempotency-key": "ikey_x", "x-tripeco-ride": `trp_${"a".repeat(32)}` } });
    expect([del.status, await reason(del)]).toEqual([409, "owned_by_tripeco"]);
  });

  it("undoes, and reposts a change as Spliteco's edit", async () => {
    const ride = await doneRide();
    const first = (await data<TripecoRideResponse>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/post`, { as: ME }))).ride;
    const undone = (await data<TripecoRideResponse>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/unpost`, { as: ME }))).ride;
    expect(undone).toMatchObject({ state: "done", posted: null });
    const gone = (await data<SplitecoExpenseResponse>(await t.spliteco("GET", `/v1/spliteco/expenses/${first.posted!.txnId}`, { as: ANU }))) as unknown as { deleted?: unknown };
    expect(JSON.stringify(gone)).toMatch(/deleted/i);

    const again = (await data<TripecoRideResponse>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/post`, { as: ME }))).ride;
    expect(again.posted!.txnId).not.toBe(first.posted!.txnId);
    // Leave Meera out: the ride is stale until reposted, and the repost is an edit.
    const changed = (
      await data<TripecoRideResponse>(
        await t.call("PATCH", `/v1/tripeco/rides/${ride.id}`, { as: ME, body: { riders: [ME, ANU, DEV].map((subjectId) => ({ subjectId, on: true })) } }),
      )
    ).ride;
    expect(changed.posted!.stale).toBe(true);
    const reposted = (await data<TripecoRideResponse>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/post`, { as: ME }))).ride;
    expect(reposted.posted!.stale).toBe(false);
    const edited = (await data<SplitecoExpenseResponse>(await t.spliteco("GET", `/v1/spliteco/expenses/${reposted.posted!.txnId}`, { as: ANU }))).expense;
    expect(edited.splits.find((s) => s.subjectId === MEERA)).toBeUndefined();
    expect(edited.splits.find((s) => s.subjectId === ANU)?.owedMinor).toBe(23100);
    // A posted ride can't be discarded.
    const discard = await t.call("DELETE", `/v1/tripeco/rides/${ride.id}`, { as: ME });
    expect([discard.status, await reason(discard)]).toEqual([409, "ride_posted"]);
  });

  it("is refused without a group, a solo drive, or someone outside the group", async () => {
    const noGroup = await doneRide([ME, ANU], null);
    const r1 = await t.call("POST", `/v1/tripeco/rides/${noGroup.id}/post`, { as: ME });
    expect([r1.status, await reason(r1)]).toEqual([409, "no_group"]);
    const solo = await doneRide([ME]);
    const r2 = await t.call("POST", `/v1/tripeco/rides/${solo.id}/post`, { as: ME });
    expect([r2.status, await reason(r2)]).toEqual([409, "solo_drive"]);
    const outsider = await doneRide([ME, OUTSIDER]);
    const r3 = await t.call("POST", `/v1/tripeco/rides/${outsider.id}/post`, { as: ME });
    expect([r3.status, await reason(r3)]).toEqual([422, "not_in_group"]);
    // Another group: Flat 4B has no Dev.
    const ride = await doneRide([ME, ANU, DEV]);
    const r4 = await t.call("POST", `/v1/tripeco/rides/${ride.id}/post`, { as: ME, body: { groupId: flat.publicId } });
    expect([r4.status, await reason(r4)]).toEqual([422, "not_in_group"]);
  });
});

describe("the group's view", () => {
  it("shows a posted ride's proof and photos to members only, and lists the group's rides", async () => {
    const ride = await doneRide();
    const photo = (await data<{ photo: { id: string } }>(await t.call("POST", `/v1/tripeco/rides/${ride.id}/photos`, { as: ME, body: { role: "end", image: JPEG } }), 201)).photo;
    // Before posting: the owner's only.
    expect((await t.call("GET", `/v1/tripeco/rides/${ride.id}/proof`, { as: ANU })).status).toBe(404);
    expect((await t.call("GET", `/v1/tripeco/photos/${photo.id}`, { as: ANU })).status).toBe(404);
    await data(await t.call("POST", `/v1/tripeco/rides/${ride.id}/post`, { as: ME }));

    const proof = (await data<TripecoProofResponse>(await t.call("GET", `/v1/tripeco/rides/${ride.id}/proof`, { as: ANU }))).proof;
    expect(proof).toMatchObject({ km: 124, vehicleName: "Swift", mileage: 18.6, priceMinor: 10400, totalMinor: 69300, ownerSubject: ME, groupId: goa.publicId });
    expect(proof.photos).toEqual([{ id: photo.id, role: "end" }]);
    expect((await t.call("GET", `/v1/tripeco/photos/${photo.id}`, { as: MEERA })).status).toBe(200);
    expect((await t.call("GET", `/v1/tripeco/rides/${ride.id}/proof`, { as: OUTSIDER })).status).toBe(404);
    expect((await t.call("GET", `/v1/tripeco/photos/${photo.id}`, { as: OUTSIDER })).status).toBe(404);

    const list = await data<TripecoGroupRidesResponse>(await t.call("GET", `/v1/tripeco/groups/${goa.publicId}/rides`, { as: DEV }));
    expect(list).toMatchObject({ groupId: goa.publicId, kmTotal: 124, totalMinor: 69300 });
    expect(list.rides.map((r) => r.id)).toEqual([ride.id]);
    expect(list.owed.find((o) => o.subjectId === DEV)?.shareMinor).toBe(17300);
    expect((await t.call("GET", `/v1/tripeco/groups/${goa.publicId}/rides`, { as: OUTSIDER })).status).toBe(404);
  });
});
