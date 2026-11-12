// Money as Spliteco types and shows it (moved here from apps/spliteco-web in
// cookpool-spliteco SE3, so both apps share it). Every amount is integer minor
// units (paise for INR); nothing here uses floating point for money.

const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? `${currency} `;
}

function groupDigits(whole: number, currency: string): string {
  const s = String(whole);
  if (currency !== "INR") return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Indian grouping: 12,34,567
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** ₹2,870.00 — always two decimals; a negative sign is a true minus (−). */
export function formatMoney(minor: number, currency = "INR", opts: { sign?: boolean } = {}): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const body = `${currencySymbol(currency)}${groupDigits(Math.floor(abs / 100), currency)}.${String(abs % 100).padStart(2, "0")}`;
  if (neg) return `−${body}`;
  if (opts.sign && minor > 0) return `+${body}`;
  return body;
}

/** ₹2,870 when whole, ₹2,870.50 otherwise. */
export function formatShort(minor: number, currency = "INR"): string {
  const abs = Math.abs(Math.trunc(minor));
  const sign = minor < 0 ? "−" : "";
  const whole = `${currencySymbol(currency)}${groupDigits(Math.floor(abs / 100), currency)}`;
  return abs % 100 === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** The whole part and the paise apart, for the big balance figures (₹2,870 + .00). */
export function splitMoney(minor: number, currency = "INR"): { whole: string; fraction: string } {
  const abs = Math.abs(Math.trunc(minor));
  return {
    whole: `${currencySymbol(currency)}${groupDigits(Math.floor(abs / 100), currency)}`,
    fraction: `.${String(abs % 100).padStart(2, "0")}`,
  };
}

/**
 * What someone typed, as minor units: "1,234.5" → 123450. Commas and spaces
 * are ignored; at most two decimals; null for anything else (empty included).
 * With `signed`, a leading + or − is allowed (Adjust's "+1,200").
 */
export function parseMoney(text: string, opts: { signed?: boolean } = {}): number | null {
  let t = text.replace(/[\s,₹]/g, "").replace(/−/g, "-");
  let sign = 1;
  if (opts.signed && (t.startsWith("-") || t.startsWith("+"))) {
    sign = t.startsWith("-") ? -1 : 1;
    t = t.slice(1);
  }
  const m = /^(\d{0,12})(?:\.(\d{0,2}))?$/.exec(t);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const minor = Number(m[1] || "0") * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(minor) ? sign * minor : null;
}

/** Minor units as the text an amount field starts with: 123450 → "1234.50", 0 → "". */
export function moneyInput(minor: number): string {
  if (!minor) return "";
  const abs = Math.abs(minor);
  const s = `${Math.floor(abs / 100)}${abs % 100 ? `.${String(abs % 100).padStart(2, "0")}` : ""}`;
  return minor < 0 ? `-${s}` : s;
}

/** Colour role of a balance: positive gets money back. */
export function balanceTone(minor: number): "get" | "owe" | "even" {
  return minor > 0 ? "get" : minor < 0 ? "owe" : "even";
}
