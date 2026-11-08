// Fixtures for the pantry screens' view-model tests (Cookpool CP-12): people,
// groups, pantries and items shaped like the kitchen API answers them, with
// quantities and unit prices worked out by the engine.

import type {
  GroupPantry,
  KitchenMeasure,
  KitchenStockMove,
  KitchenUsual,
  PantryRef,
  PersonalPantry,
  ReachableItem,
  WastePolicy,
} from "@saas/contracts/kitchen";
import type { UsualNow } from "@saas/contracts/kitchen-usuals";
import { dimensionOf, pricePerUnit, toMilli, type UnitKey } from "@saas/kitchen-engine/units";

export const ME = "usr_000000000000000000000000000000aa";
export const ANU = "usr_0000000000000000000000000000b0b0";
export const DEV = "usr_00000000000000000000000000003f9a";
export const MEERA = "usr_0000000000000000000000000000d2d2";
export const KIRAN = "usr_0000000000000000000000000000c1c1";

export const NAMES = new Map<string, string>([
  [ANU, "Anu"],
  [DEV, "Dev"],
  [MEERA, "Meera"],
  [KIRAN, "Kiran"],
]);

export const FLAT = { orgId: "org_00000000000000000000000000000f1a", slug: "flat-4b-k3x9", name: "Flat 4B" };
export const LUNCH = { orgId: "org_00000000000000000000000000000c1b", slug: "lunch-club-a1b2", name: "Lunch club" };
export const TRIP = { orgId: "org_00000000000000000000000000000b0a", slug: "goa-trip-z9z9", name: "Goa trip" };

export const PERSONAL_REF: PantryRef = { kind: "personal", name: "My pantry" };
export const groupRef = (g: { orgId: string; slug: string; name: string }): PantryRef => ({ kind: "group", ...g });

export function personalPantry(patch: Partial<PersonalPantry> = {}): PersonalPantry {
  return { kind: "personal", name: "My pantry", itemCount: 0, useSoonCount: 0, expiredCount: 0, worthMinor: 0, currency: "INR", ...patch };
}

export function groupPantry(
  g: { orgId: string; slug: string; name: string },
  patch: Partial<GroupPantry> = {},
): GroupPantry {
  return {
    kind: "group",
    ...g,
    itemCount: 0,
    useSoonCount: 0,
    expiredCount: 0,
    worthMinor: 0,
    currency: "INR",
    wastePolicy: "split_equally",
    ...patch,
  };
}

/** The day the fixtures' `daysToUseBy` counts from. */
export const FIXTURE_TODAY = "2026-11-02";

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

let seq = 0;

/**
 * An item: `bought` and `left` are decimals in `unit` ("1", "0.4"), turned
 * into thousandths by the engine; the unit price is the engine's. `worthMinor`
 * defaults to the proportional remainder of the price.
 */
export function makeItem(o: {
  name?: string;
  pantry?: PantryRef;
  unit?: UnitKey;
  bought?: string;
  left?: string;
  priceMinor?: number;
  worthMinor?: number;
  paidBy?: string;
  createdBy?: string;
  daysToUseBy?: number | null;
  expiresOn?: string | null;
  category?: string;
  canUse?: boolean;
  wastePolicy?: WastePolicy | null;
  wastePolicyOverride?: WastePolicy | null;
  state?: ReachableItem["state"];
  currency?: string;
  boughtOn?: string;
  createdAt?: string;
  id?: string;
  /** Its note (RC-3); left out unless given, as an item read before RC-3. */
  note?: string | null;
}): ReachableItem {
  const unit = o.unit ?? "kg";
  const bought = toMilli(o.bought ?? "1", unit);
  const left = o.left === "0" ? 0 : toMilli(o.left ?? o.bought ?? "1", unit);
  const priceMinor = o.priceMinor ?? 4000;
  const pantry = o.pantry ?? groupRef(FLAT);
  seq += 1;
  return {
    id: o.id ?? `itm_${String(seq).padStart(32, "0")}`,
    pantry,
    name: o.name ?? "Tomatoes",
    category: o.category ?? "veg",
    dimension: dimensionOf(unit),
    displayUnit: unit,
    qtyBought: bought / 1000,
    qtyLeft: left / 1000,
    qtyBoughtMilli: bought,
    qtyLeftMilli: left,
    priceMinor,
    currency: o.currency ?? "INR",
    unitPriceMinor: pricePerUnit(priceMinor, bought, unit),
    worthMinor: o.worthMinor ?? Math.round((priceMinor * left) / bought),
    paidBy: o.paidBy ?? ANU,
    boughtOn: o.boughtOn ?? "2026-10-28",
    expiresOn: o.expiresOn !== undefined ? o.expiresOn : o.daysToUseBy == null ? null : addDays(FIXTURE_TODAY, o.daysToUseBy),
    daysToUseBy: o.daysToUseBy === undefined ? null : o.daysToUseBy,
    wastePolicy: pantry.kind === "personal" ? null : (o.wastePolicy ?? "split_equally"),
    wastePolicyOverride: o.wastePolicyOverride ?? null,
    state: o.state ?? "active",
    version: 1,
    createdBy: o.createdBy ?? o.paidBy ?? ANU,
    createdAt: o.createdAt ?? "2026-10-28T08:00:00.000Z",
    updatedAt: o.createdAt ?? "2026-10-28T08:00:00.000Z",
    ...(o.note !== undefined ? { note: o.note } : {}),
    canUse: o.canUse ?? true,
  };
}

export function makeMove(o: Partial<KitchenStockMove> & { kind: KitchenStockMove["kind"] }): KitchenStockMove {
  seq += 1;
  return {
    id: `mov_${String(seq).padStart(32, "0")}`,
    itemId: "itm_1",
    qtyMilli: 100_000,
    quantity: 100,
    unit: "g",
    costMinor: 400,
    actor: ME,
    consumers: o.kind === "use" ? [ME] : null,
    txnId: null,
    reverses: null,
    at: "2026-11-02T08:00:00.000Z",
    undone: false,
    undoneBy: null,
    ...o,
  };
}

// ── Usuals (cookpool-pantry PN-5) ─────────────────────────────────

/** The caller's usual of `item`: by default 1 glass (250 ml), last had by you, three times. */
export function makeUsual(item: ReachableItem, o: Partial<KitchenUsual> & { now?: UsualNow | null } = {}): KitchenUsual {
  return {
    itemId: item.id,
    name: item.name,
    pantry: item.pantry,
    lastQtyMilli: 250_000,
    lastQuantity: 250,
    lastUnit: "ml",
    lastLabel: null,
    measures: [],
    consumers: [ME],
    usedCount: 3,
    lastUsedAt: "2026-11-08T02:40:00.000Z",
    qtyLeftMilli: item.qtyLeftMilli,
    now: null,
    strip: false,
    ...o,
  };
}

/** A morning usual of `qtyMilli` (in ml), `count` uses of the food in the bucket. */
export function morningUsual(qtyMilli: number, count: number, consumerIds: string[] = [ME], label: string | null = null): UsualNow {
  return { bucket: "morning", qtyMilli, quantity: qtyMilli / 1000, unit: "ml", label, consumerIds, count };
}

/** Onions counted one at a time, 150 g each. */
export const ONION: KitchenMeasure = { id: "msr_onion", one: "onion", many: "onions", count: 1, amountMilli: 150_000 };
