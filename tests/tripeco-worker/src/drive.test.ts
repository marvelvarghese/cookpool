import { learnedMileage, lastPrice, perKmMinor, rideCost, rideKm, rideShares, toRupee } from "@saas/kitchen-engine/drive";

// The drive maths (tripeco TR-2, design §2), on the canvas's own numbers.

describe("distance", () => {
  it("is end − start on the odometer, Trip A in trip mode", () => {
    expect(rideKm({ mode: "odo", startKm: 48212, endKm: 48336, tripKm: null })).toBe(124);
    expect(rideKm({ mode: "trip", startKm: null, endKm: null, tripKm: 124.04 })).toBe(124);
  });
  it("is unknown until both readings are in, and never below zero or past 2,000 km", () => {
    expect(rideKm({ mode: "odo", startKm: 48212, endKm: null, tripKm: null })).toBeNull();
    expect(rideKm({ mode: "odo", startKm: 48336, endKm: 48212, tripKm: null })).toBeNull();
    expect(rideKm({ mode: "odo", startKm: 0, endKm: 2001, tripKm: null })).toBeNull();
  });
});

describe("cost", () => {
  it("is km ÷ mileage × price to the rupee: 124 km at 18.6 km/l and ₹104/L is ₹693", () => {
    const c = rideCost({ km: 124, mileage: 18.6, priceMinor: 10400, wearMinorPerKm: 0, extrasMinor: [] });
    expect(c.fuelMinor).toBe(69300);
    expect(c.totalMinor).toBe(69300);
  });
  it("adds wear per km and the extras", () => {
    const c = rideCost({ km: 124, mileage: 18.6, priceMinor: 10400, wearMinorPerKm: 200, extrasMinor: [12000, 5000] });
    expect(c.wearMinor).toBe(24800);
    expect(c.extrasMinor).toBe(17000);
    expect(c.totalMinor).toBe(69300 + 24800 + 17000);
  });
  it("rounds to whole rupees", () => {
    expect(toRupee(12349)).toBe(12300);
    expect(toRupee(12350)).toBe(12400);
  });
});

describe("shares", () => {
  const cost = { fuelMinor: 69300, wearMinor: 0, extrasMinor: 0 };
  it("are equal among the riders who are on, in whole rupees, adding up to the total", () => {
    const r = rideShares(cost, ["a", "b", "c", "d"].map((s) => ({ subjectId: s, on: true, km: 124 })));
    expect(r).toEqual({ ok: true, shares: [17400, 17300, 17300, 17300] });
  });
  it("leave a rider who is off out (the owner paying nothing included)", () => {
    const r = rideShares(cost, [
      { subjectId: "me", on: false, km: 124 },
      { subjectId: "a", on: true, km: 124 },
      { subjectId: "b", on: true, km: 124 },
      { subjectId: "c", on: true, km: 124 },
    ]);
    expect(r).toEqual({ ok: true, shares: [0, 23100, 23100, 23100] });
  });
  it("weigh fuel by the km each rode and split extras equally", () => {
    const r = rideShares({ fuelMinor: 30000, wearMinor: 0, extrasMinor: 10000 }, [
      { subjectId: "me", on: true, km: 100 },
      { subjectId: "a", on: true, km: 50 },
    ]);
    expect(r).toEqual({ ok: true, shares: [25000, 15000] });
  });
  it("refuse a ride nobody is on", () => {
    expect(rideShares(cost, [{ subjectId: "me", on: false, km: 10 }])).toEqual({ ok: false, reason: "no_riders" });
  });
});

describe("learned mileage", () => {
  const fill = (odometerKm: number, litres: number, full: boolean, day: number) => ({
    odometerKm,
    quantityMilli: litres * 1000,
    amountMinor: litres * 10400,
    full,
    loggedAt: `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z`,
  });
  it("needs two full tanks", () => {
    expect(learnedMileage([fill(47000, 40, true, 1)]).mileage).toBeNull();
    const m = learnedMileage([fill(47000, 40, true, 1), fill(47744, 40, true, 5)]);
    expect(m.mileage).toBe(18.6);
    expect(m.segments).toEqual([{ endKm: 47744, km: 744, quantity: 40, mileage: 18.6 }]);
  });
  it("counts a part fill toward the next full one", () => {
    const m = learnedMileage([fill(47000, 40, true, 1), fill(47300, 10, false, 3), fill(47900, 40, true, 6)]);
    expect(m.mileage).toBe(18);
  });
  it("is Σkm ÷ Σlitres over the last six segments", () => {
    const fills = [fill(0, 40, true, 1)];
    for (let i = 1; i <= 8; i++) fills.push(fill(i * 800, 40, true, i + 1));
    const m = learnedMileage(fills);
    expect(m.segments).toHaveLength(6);
    expect(m.mileage).toBe(20);
  });
  it("prices from the newest fill-up", () => {
    expect(lastPrice([fill(1, 10, true, 1), { ...fill(2, 41.2, true, 12), amountMinor: 428500 }])).toBe(10400);
    expect(perKmMinor(10400, 18.6, 200)).toBe(559 + 200);
  });
});
