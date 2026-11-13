// How a Tripeco ride reads in Spliteco (tripeco TR-7). Pure.

import type { SplitecoExpenseSummary, TripecoProof } from "@saas/sdk";

/** The ride (trp_…) behind a row, when Tripeco posted it. */
export function rideOf(e: Pick<SplitecoExpenseSummary, "source">): string | null {
  return e.source?.kind === "tripeco" ? e.source.id : null;
}

const UNIT: Record<TripecoProof["unit"], { mileage: string; per: string }> = {
  l: { mileage: "km/l", per: "/L" },
  kg: { mileage: "km/kg", per: "/kg" },
  kWh: { mileage: "km/kWh", per: "/kWh" },
};

/** "124 km · Swift · 18.6 km/l · ₹104/L" (+ wear, tolls and parking when there were any). */
export function rideLine(p: Pick<TripecoProof, "km" | "vehicleName" | "mileage" | "unit" | "priceMinor" | "wearMinor" | "extras">): string {
  const u = UNIT[p.unit];
  const price = p.priceMinor % 100 === 0 ? String(p.priceMinor / 100) : (p.priceMinor / 100).toFixed(1);
  const parts = [`${p.km === null ? "—" : Number.isInteger(p.km) ? p.km : p.km.toFixed(1)} km`, p.vehicleName, `${p.mileage} ${u.mileage}`, `₹${price}${u.per}`];
  if (p.wearMinor > 0) parts.push(`wear ₹${Math.round(p.wearMinor / 100)}`);
  const toll = p.extras.filter((e) => e.kind === "toll").reduce((s, e) => s + e.amountMinor, 0);
  const parking = p.extras.filter((e) => e.kind === "parking").reduce((s, e) => s + e.amountMinor, 0);
  if (toll > 0) parts.push(`toll ₹${Math.round(toll / 100)}`);
  if (parking > 0) parts.push(`parking ₹${Math.round(parking / 100)}`);
  return parts.join(" · ");
}
