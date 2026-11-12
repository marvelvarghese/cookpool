// Always have per pantry and the shopping list (RV-21): request parsing and
// the public shapes. The handlers are ./handlers/staples.ts.

import {
  CURRENCY_CODE_RE,
  MAX_SHOPPING_CLEAR,
  SHOPPING_UNIT_MAX,
  STAPLE_NAME_MAX,
  STAPLE_STATUSES,
  type KitchenStaple,
  type ShoppingItem,
  type StapleStatus,
} from "@saas/contracts/kitchen";
import type { KitchenShoppingItemRecord, KitchenStapleRecord } from "@saas/db/kitchen";
import { toPublicId } from "./ids.js";
import { Fields, minor, oneOf, text, type FieldErrors } from "./validate.js";

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

/** The biggest amount a list line may ask for: a million of the base unit. */
const MAX_QTY_MILLI = 1_000_000_000;

export function toStaple(r: KitchenStapleRecord): KitchenStaple {
  return {
    id: toPublicId("stp", r.id),
    name: r.name,
    foodKey: r.foodKey,
    status: r.status,
    lastPriceMinor: r.lastPriceMinor,
    currency: r.currency,
    lastQtyMilli: r.lastQtyMilli,
    lastUnit: r.lastUnit,
    wantQtyMilli: r.wantQtyMilli,
    wantUnit: r.wantUnit,
    boughtAt: r.boughtAt ? r.boughtAt.toISOString() : null,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toShoppingItem(r: KitchenShoppingItemRecord): ShoppingItem {
  return {
    id: toPublicId("shp", r.id),
    name: r.name,
    qtyMilli: r.qtyMilli,
    unit: r.unit,
    addedBy: r.addedBy,
    createdAt: r.createdAt.toISOString(),
  };
}

/** An amount and its unit: both, or neither (null). */
function amount(fields: Fields, qtyName: string, unitName: string, qty: unknown, unit: unknown): { qtyMilli: number | null; unit: string | null } | undefined {
  if ((qty === undefined || qty === null) && (unit === undefined || unit === null)) return { qtyMilli: null, unit: null };
  let q: number | undefined;
  if (typeof qty !== "number" || !Number.isSafeInteger(qty) || qty <= 0 || qty > MAX_QTY_MILLI) {
    q = fields.add(qtyName, "Must be a whole number of thousandths above zero");
  } else q = qty;
  const u = text(fields, unitName, unit, SHOPPING_UNIT_MAX);
  return q === undefined || u === undefined ? undefined : { qtyMilli: q, unit: u };
}

const FOOD_KEY_RE = /^[a-z0-9_]{1,40}$/;

export function parseAddStaple(body: Record<string, unknown>): Parsed<{ name: string; foodKey: string | null }> {
  const fields = new Fields();
  const name = text(fields, "name", body.name, STAPLE_NAME_MAX);
  let foodKey: string | null = null;
  if (body.foodKey !== undefined && body.foodKey !== null) {
    if (typeof body.foodKey === "string" && FOOD_KEY_RE.test(body.foodKey)) foodKey = body.foodKey;
    else fields.add("foodKey", "Must be a food's key");
  }
  if (!fields.ok || name === undefined) return { ok: false, fields: fields.errors };
  return { ok: true, value: { name, foodKey } };
}

export function parseUpdateStaple(body: Record<string, unknown>): Parsed<{ status?: StapleStatus; want?: { qtyMilli: number | null; unit: string | null } }> {
  const fields = new Fields();
  const out: { status?: StapleStatus; want?: { qtyMilli: number | null; unit: string | null } } = {};
  if (body.status !== undefined) {
    const status = oneOf(fields, "status", body.status, STAPLE_STATUSES);
    if (status) out.status = status;
  }
  if (body.wantQtyMilli !== undefined || body.wantUnit !== undefined) {
    const want = amount(fields, "wantQtyMilli", "wantUnit", body.wantQtyMilli, body.wantUnit);
    if (want) out.want = want;
  }
  if (fields.ok && out.status === undefined && out.want === undefined) fields.add("body", "Give a status or the amount wanted");
  return fields.ok ? { ok: true, value: out } : { ok: false, fields: fields.errors };
}

export interface ParsedBought {
  priceMinor: number;
  currency: string | null;
  qtyMilli: number | null;
  unit: string | null;
}

/** A Bought: a group's must cost something (it posts that bill); yours may be ₹0. */
export function parseBought(body: Record<string, unknown>, group: boolean): Parsed<ParsedBought> {
  const fields = new Fields();
  const priceMinor = minor(fields, "priceMinor", body.priceMinor, group);
  let currency: string | null = null;
  if (body.currency !== undefined) {
    if (typeof body.currency === "string" && CURRENCY_CODE_RE.test(body.currency)) currency = body.currency;
    else fields.add("currency", "Must be a three-letter ISO 4217 code in capitals, such as INR");
  }
  const got = amount(fields, "qtyMilli", "unit", body.qtyMilli, body.unit);
  if (!fields.ok || priceMinor === undefined || !got) return { ok: false, fields: fields.errors };
  return { ok: true, value: { priceMinor, currency, ...got } };
}

export function parseAddShoppingItem(body: Record<string, unknown>): Parsed<{ name: string; qtyMilli: number | null; unit: string | null }> {
  const fields = new Fields();
  const name = text(fields, "name", body.name, STAPLE_NAME_MAX);
  const got = amount(fields, "qtyMilli", "unit", body.qtyMilli, body.unit);
  if (!fields.ok || name === undefined || !got) return { ok: false, fields: fields.errors };
  return { ok: true, value: { name, ...got } };
}

export function parseUpdateShoppingItem(body: Record<string, unknown>): Parsed<{ qtyMilli: number | null; unit: string | null }> {
  const fields = new Fields();
  const got = amount(fields, "qtyMilli", "unit", body.qtyMilli, body.unit);
  return fields.ok && got ? { ok: true, value: got } : { ok: false, fields: fields.errors };
}

/** A clear: `shp_…` and `stp_…` ids, decoded; at most MAX_SHOPPING_CLEAR in all. */
export function parseClearShopping(
  body: Record<string, unknown>,
  decode: (prefix: "shp" | "stp", id: string) => string | null,
): Parsed<{ itemIds: string[]; stapleIds: string[] }> {
  const fields = new Fields();
  const list = (name: "itemIds" | "stapleIds", prefix: "shp" | "stp"): string[] => {
    const v = body[name];
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > MAX_SHOPPING_CLEAR) {
      fields.add(name, `Must be a list of at most ${MAX_SHOPPING_CLEAR} ids`);
      return [];
    }
    const out: string[] = [];
    v.forEach((id: unknown, i) => {
      const uuid = typeof id === "string" ? decode(prefix, id) : null;
      if (uuid) out.push(uuid);
      else fields.add(`${name}[${i}]`, `Must be a ${prefix}_ id`);
    });
    return out;
  };
  const itemIds = list("itemIds", "shp");
  const stapleIds = list("stapleIds", "stp");
  if (fields.ok && itemIds.length + stapleIds.length === 0) fields.add("body", "Give the lines to clear");
  if (fields.ok && itemIds.length + stapleIds.length > MAX_SHOPPING_CLEAR) fields.add("body", `At most ${MAX_SHOPPING_CLEAR} ids`);
  return fields.ok ? { ok: true, value: { itemIds, stapleIds } } : { ok: false, fields: fields.errors };
}
