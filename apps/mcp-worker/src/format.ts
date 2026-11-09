// Compact, plain words for tool results: numbers with their units and money
// in its currency, as the app shows them.

import { formatMinor } from "@saas/kitchen-engine/money";
import type { PantryRef } from "@saas/contracts/kitchen";

/** A quantity without float noise: 1.5, 0.25, 450. */
export function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function qty(value: number, unit: string): string {
  return `${num(value)} ${unit}`;
}

/** Money in its currency: "₹1,200.00". */
export function money(minor: number, currency: string): string {
  return formatMinor(minor, currency);
}

export function pantryName(ref: PantryRef): string {
  return ref.kind === "personal" ? "Your pantry" : ref.name;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a, b and c" (at most `max` names, then "and N more"). */
export function listNames(names: string[], max = 5): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length === 1) return shown[0]!;
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** Whole minutes from now until an ISO instant (at least 0). */
export function minutesUntil(iso: string, now: number): number {
  return Math.max(0, Math.round((Date.parse(iso) - now) / 60000));
}
