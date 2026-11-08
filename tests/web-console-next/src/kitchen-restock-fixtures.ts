// Fixtures for restocking's view-model tests (cookpool-pantry PN-6): restock
// lines shaped like PN-3's `GET /v1/kitchen/me/restock` answers them.

import type { FinishedRestockLine, PantryRef, RestockLast, RunningLowRestockLine, UsualRestockLine } from "@saas/contracts/kitchen";
import { toMilli, type UnitKey } from "@saas/kitchen-engine/units";
import { FLAT, ME, groupRef } from "./kitchen-pantry-fixtures";

/** Thursday 5 Nov 2026, noon, in the viewer's own calendar. */
export const NOW = new Date(2026, 10, 5, 12);
export const TODAY = "2026-11-05";
/** A moment on a November day, in the viewer's calendar. */
export const at = (day: number, hour = 9): string => new Date(2026, 10, day, hour).toISOString();

/** The latest purchase: `qty` is a decimal in `unit`. */
export function last(o: Partial<RestockLast> & { unit?: UnitKey; qty?: string } = {}): RestockLast {
  const unit = o.unit ?? "pcs";
  return {
    itemId: o.itemId ?? "itm_bread1",
    quantityMilli: o.quantityMilli ?? toMilli(o.qty ?? "1", unit),
    unit,
    priceMinor: o.priceMinor ?? 4500,
    currency: o.currency ?? "INR",
    wastePolicy: o.wastePolicy ?? null,
    expiresAfterDays: o.expiresAfterDays === undefined ? 3 : o.expiresAfterDays,
    paidBy: o.paidBy ?? ME,
  };
}

interface Base {
  name?: string;
  category?: string;
  pantry?: PantryRef;
  canAdd?: boolean;
  last?: RestockLast;
}

function base(o: Base) {
  const name = o.name ?? "Bread";
  return { name, nameKey: name.trim().toLowerCase(), category: o.category ?? "grains", pantry: o.pantry ?? groupRef(FLAT), canAdd: o.canAdd ?? true, last: o.last ?? last() };
}

export function finished(o: Base & { how?: "used_up" | "wasted"; at?: string } = {}): FinishedRestockLine {
  const b = base(o);
  return { ...b, reason: "finished", why: { finishedAt: o.at ?? at(3), how: o.how ?? "used_up", itemId: b.last.itemId } };
}

export function runningLow(o: Base & { left?: number; bought?: number } = {}): RunningLowRestockLine {
  const b = base(o);
  return { ...b, reason: "running_low", why: { leftQtyMilli: o.left ?? 600_000, boughtQtyMilli: o.bought ?? b.last.quantityMilli, itemId: b.last.itemId } };
}

export function usual(o: Base & { everyDays?: number; lastBoughtAt?: string; times?: number } = {}): UsualRestockLine {
  const b = base(o);
  return { ...b, reason: "usual", why: { everyDays: o.everyDays ?? 4, lastBoughtAt: o.lastBoughtAt ?? "2026-11-01", times: o.times ?? 5 } };
}
