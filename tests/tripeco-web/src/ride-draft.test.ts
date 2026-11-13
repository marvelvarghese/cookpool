import { draftOf, hasOthers, patchOf, work } from "@/lib/ride-draft";
import type { TripecoRide } from "@saas/contracts/tripeco";

// A ride as it is being edited (tripeco TR-6): the numbers New ride and Split
// show while you type are the drive maths the worker stores.

const ride = (over: Partial<TripecoRide> = {}): TripecoRide =>
  ({
    id: "trp_1",
    mode: "odo",
    startKm: 48212,
    endKm: 48336,
    tripKm: null,
    km: 124,
    mileage: 18.6,
    priceMinor: 10400,
    wearOn: false,
    wearMinorPerKm: 200,
    title: "Swift · 124 km",
    titleTyped: false,
    groupId: "org_goa",
    riders: ["me", "anu", "dev", "meera"].map((subjectId) => ({ subjectId, on: true, km: 124, shareMinor: 0 })),
    extras: [],
    ...over,
  }) as TripecoRide;

const names = new Map([["me", "You"], ["anu", "Anu"], ["dev", "Dev"], ["meera", "Meera"]]);

describe("the ride draft", () => {
  it("works out the canvas's ride: 124 km at 18.6 km/l and ₹104/L, four ways", () => {
    const d = draftOf(ride(), names);
    expect(d.riders.every((r) => r.km === null)).toBe(true);
    expect(d.title).toBe("");
    const w = work(d, "me");
    expect(w).toMatchObject({ km: 124, fuelMinor: 69300, totalMinor: 69300, othersMinor: 17300 * 3 });
    expect(w.shares).toEqual([17400, 17300, 17300, 17300]);
  });
  it("follows the typing: a new end reading, a rider tapped out, a km slider, a toll, wear", () => {
    const d = draftOf(ride(), names);
    const typed = { ...d, endKm: "48398", riders: d.riders.map((r) => (r.subjectId === "me" ? { ...r, on: false } : r.subjectId === "meera" ? { ...r, km: 93 } : r)), extras: [{ kind: "toll" as const, amountMinor: 12000 }], wearOn: true };
    const w = work(typed, "me");
    expect(w.km).toBe(186);
    expect(w.shares[0]).toBe(0);
    expect(w.shares.reduce((a, b) => a + b, 0)).toBe(w.totalMinor);
    expect(w.othersMinor).toBe(w.totalMinor);
    expect(w.wearMinor).toBe(37200);
  });
  it("shows nothing to split before the end reading", () => {
    expect(work({ ...draftOf(ride(), names), endKm: "" }, "me")).toMatchObject({ km: null, totalMinor: 0 });
  });
  it("saves what the screen shows", () => {
    const d = { ...draftOf(ride(), names), title: "  Kochi → Munnar ", priceRupees: "104.5" };
    expect(patchOf(d)).toMatchObject({ mode: "odo", startKm: 48212, endKm: 48336, tripKm: null, priceMinor: 10450, title: "Kochi → Munnar", groupId: "org_goa" });
    expect(patchOf({ ...d, title: "" }).title).toBeNull();
    expect(patchOf(d).riders).toEqual(["me", "anu", "dev", "meera"].map((subjectId) => ({ subjectId, on: true })));
  });
  it("knows a solo drive", () => {
    const d = draftOf(ride({ riders: [{ subjectId: "me", on: true, km: 124, shareMinor: 0 }] }), names);
    expect(hasOthers(d, "me")).toBe(false);
    expect(hasOthers(draftOf(ride(), names), "me")).toBe(true);
  });
});
