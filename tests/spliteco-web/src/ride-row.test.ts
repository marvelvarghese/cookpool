import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { SplitecoExpenseSummary } from "@saas/contracts/spliteco";
import { billMeta, billWritable, holdHref, holdTiles } from "@/lib/group-view";
import { rideLine, rideOf } from "@/lib/ride-view";

// A Tripeco ride in Spliteco (tripeco TR-7, design §7): the car mark and the
// lock, "Tripeco · You paid ₹939", no swipe to delete, its sheet with the
// ride's line and photos, and Edit in Tripeco.

const APP = `${cwd()}/../../apps/spliteco-web/src`;
const RIDE = `trp_${"a".repeat(32)}`;
const ride = {
  id: "txn_1",
  kind: "expense",
  app: "spliteco",
  locked: true,
  title: "Kochi → Munnar",
  totalMinor: 93900,
  currency: "INR",
  category: "transport",
  payers: [{ subjectId: "usr_me", paidMinor: 93900 }],
  splits: [],
  source: { kind: "tripeco", id: RIDE },
} as unknown as SplitecoExpenseSummary;
const names = new Map([["usr_me", "Rahul"]]);

describe("a Tripeco ride in Spliteco", () => {
  it("is known by its source", () => {
    expect(rideOf(ride)).toBe(RIDE);
    expect(rideOf({ source: null })).toBeNull();
    expect(rideOf({})).toBeNull();
  });
  it("reads Tripeco · who paid, and can't be swiped away or edited here", () => {
    expect(billMeta(ride, names as never, "usr_me")).toBe("Tripeco · You paid ₹939");
    expect(billWritable(ride, true)).toBe(false);
    expect(holdTiles(ride, true)).toEqual(["ride", "comment"]);
    expect(holdHref("ride", ride.id)).toBe("/expense?id=txn_1");
  });
  it("explains its amount in one line", () => {
    expect(rideLine({ km: 124, vehicleName: "Swift", mileage: 18.6, unit: "l", priceMinor: 10400, wearMinor: 0, extras: [] })).toBe("124 km · Swift · 18.6 km/l · ₹104/L");
    expect(rideLine({ km: 98.5, vehicleName: "Nexon EV", mileage: 7.1, unit: "kWh", priceMinor: 950, wearMinor: 19700, extras: [{ kind: "toll", amountMinor: 12000 }] })).toBe(
      "98.5 km · Nexon EV · 7.1 km/kWh · ₹9.5/kWh · wear ₹197 · toll ₹120",
    );
  });
  it("shows the car mark, the lock and the proof with Edit in Tripeco", () => {
    expect(readFileSync(`${APP}/components/ui.tsx`, "utf8")).toContain('expense.source?.kind === "tripeco"');
    const group = readFileSync(`${APP}/app/group/page.tsx`, "utf8");
    expect(group).toContain("<RideProof");
    expect(group).toContain("Locked: change it in Tripeco");
    const proof = readFileSync(`${APP}/components/ride-proof.tsx`, "utf8");
    expect(proof).toContain("Edit in Tripeco");
    expect(proof).toContain("tripecoRideHref");
    expect(readFileSync(`${APP}/app/expense/page.tsx`, "utf8")).toContain("From Tripeco · change it there");
  });
});
