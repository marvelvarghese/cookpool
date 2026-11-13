import type { TripecoFuel, TripecoUnit } from "@saas/contracts/tripeco";

// The words a fuel's unit takes (design §0.12).

export const UNIT_WORDS: Record<TripecoUnit, { mileage: string; price: string; qty: string; short: string }> = {
  l: { mileage: "km/l", price: "₹ / litre", qty: "Litres", short: "L" },
  kg: { mileage: "km/kg", price: "₹ / kg", qty: "Kg", short: "kg" },
  kWh: { mileage: "km/kWh", price: "₹ / kWh", qty: "kWh", short: "kWh" },
};

export const FUEL_LABEL: Record<TripecoFuel, string> = { petrol: "Petrol", diesel: "Diesel", cng: "CNG", electric: "Electric" };

export const unitOf = (fuel: TripecoFuel): TripecoUnit => (fuel === "electric" ? "kWh" : fuel === "cng" ? "kg" : "l");
