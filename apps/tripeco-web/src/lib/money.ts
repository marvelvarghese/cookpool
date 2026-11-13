// Rupees as Tripeco shows them (design §0.8): whole rupees, Indian grouping.

/** ₹1,234 — paise rounded to the rupee. */
export function rupees(minor: number): string {
  const r = Math.round(minor / 100);
  return `${r < 0 ? "−" : ""}₹${Math.abs(r).toLocaleString("en-IN")}`;
}

/** +₹519 / −₹173 / ₹0. */
export function signedRupees(minor: number): string {
  const r = Math.round(minor / 100);
  if (r === 0) return "₹0";
  return `${r > 0 ? "+" : "−"}₹${Math.abs(r).toLocaleString("en-IN")}`;
}

/** ₹5.6 — paise per km or per unit with one decimal. */
export function rupeesDecimal(minor: number, digits = 1): string {
  return `₹${(minor / 100).toFixed(digits)}`;
}

/** A ₹ amount typed by a person ("104", "104.5") as paise; null when it isn't one. */
export function parseRupees(raw: string): number | null {
  const t = raw.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** 48,336 — an odometer with grouping. */
export function km(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? value.toLocaleString("en-IN") : value.toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}
