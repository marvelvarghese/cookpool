/**
 * Money in the Cookpool app (CP-8). Every amount is an integer number of
 * minor units (paise); nothing here uses floats. Parsing a typed amount turns
 * the decimal string into minor units by its digits, and every amount on
 * screen goes through the engine's one formatter, `formatMinor`, so the app
 * and the server print money the same way. Pure and dependency-free (the
 * engine is pure too), so it is unit-testable.
 */

import { formatMinor } from "@saas/kitchen-engine/money";

export { formatMinor };

/** The largest amount the app accepts: ₹1,00,00,00,000.00 (10¹¹ paise). */
export const MAX_MINOR = 100_000_000_000;

export type MoneyParse =
  | { ok: true; minor: number }
  | { ok: false; reason: "empty" | "invalid" | "too_precise" | "too_large" };

/**
 * Parse what someone typed as an amount ("250", "249.5", "1,200.00",
 * "₹ 80") into minor units, by its digits: "249.5" is 24950, never
 * 249.5 × 100. Thousands separators (Indian or Western grouping), spaces and a
 * leading ₹ are ignored; at most two decimal places; no sign.
 */
export function parseMoney(input: string): MoneyParse {
  const cleaned = input.replace(/[\s,₹]/g, "");
  if (cleaned === "") return { ok: false, reason: "empty" };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m) return { ok: false, reason: "invalid" };
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  if (whole === "" && frac === "") return { ok: false, reason: "invalid" };
  if (frac.length > 2) return { ok: false, reason: "too_precise" };
  const wholeDigits = whole.replace(/^0+(?=\d)/, "");
  if (wholeDigits.length > 12) return { ok: false, reason: "too_large" };
  const minor = Number(wholeDigits || "0") * 100 + Number(frac.padEnd(2, "0"));
  if (minor > MAX_MINOR) return { ok: false, reason: "too_large" };
  return { ok: true, minor };
}

/** The amount in minor units, or null when the input is not an amount. */
export function parseMinor(input: string): number | null {
  const r = parseMoney(input);
  return r.ok ? r.minor : null;
}

/** What to tell someone about an amount they typed, or null when it is fine. */
export function moneyInputMessage(r: MoneyParse): string | null {
  if (r.ok) return null;
  switch (r.reason) {
    case "empty":
      return "Enter the amount";
    case "invalid":
      return "Enter an amount like 250 or 249.50";
    case "too_precise":
      return "Use at most two decimal places";
    case "too_large":
      return "That amount is too large";
  }
}

/** Minor units back to a plain input value: 24950 → "249.50". */
export function minorToInput(minor: number): string {
  const abs = Math.abs(Math.trunc(minor));
  return `${minor < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * A percentage as hundredths of a percent ("33.33" → 3333, "100" → 10000),
 * so percentages add up exactly too. Null when it is not 0–100 with at most
 * two decimals. A trailing % is allowed.
 */
export function parsePercentHundredths(input: string): number | null {
  const cleaned = input.replace(/[\s%]/g, "");
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!m || cleaned === "" || cleaned === ".") return null;
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  if (whole.replace(/^0+(?=\d)/, "").length > 3) return null;
  const value = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
  return value <= 10_000 ? value : null;
}

/** Hundredths of a percent for display: 3333 → "33.33%", 10000 → "100%". */
export function formatPercentHundredths(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

/** What an amount input is prefixed with: "₹" for INR, "AED" for a code with no symbol. */
export function currencyPrefix(currency = "INR"): string {
  return formatMinor(0, currency).replace("0.00", "").trim();
}

/**
 * A signed amount for a balance or someone's part in a transaction:
 * "+₹40.75", "−₹24.00" (the engine's minus sign), "₹0.00".
 */
export function formatSignedMinor(minor: number, currency = "INR"): string {
  return minor > 0 ? `+${formatMinor(minor, currency)}` : formatMinor(minor, currency);
}
