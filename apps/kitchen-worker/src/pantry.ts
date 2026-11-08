// What every pantry handler shares: the public shape of an item and of a
// pantry, the dates "use soon" and "expired" are measured from, the list
// query (filter, search, cursor), the request bodies, and how a repository
// refusal becomes a response. Quantities, unit prices and what is left of a
// price all come from the kitchen engine.

import {
  ASK_ALLOWED_MAX,
  CURRENCY_CODE_RE,
  DEFAULT_KITCHEN_CURRENCY,
  DEFAULT_WASTE_POLICY,
  ITEM_FILTERS,
  ITEM_NOTE_MAX,
  KITCHEN_ERROR_REASONS,
  USE_SOON_DAYS,
  WASTE_POLICIES,
  itemNoteLength,
  normalizeItemNote,
  type ItemFilter,
  type KitchenItem,
  type KitchenMeasure,
  type PantryRef,
  type PantryTotals,
  type WastePolicy,
} from "@saas/contracts/kitchen";
import { isUuid } from "@saas/db/ids";
import type {
  KitchenDimension,
  KitchenGroupSettings,
  KitchenItemChanges,
  KitchenItemRecord,
  KitchenItemsCursor,
  KitchenItemsQuery,
  KitchenPantryTotals,
  KitchenRepositoryError,
} from "@saas/db/kitchen";
import { costOfUse } from "@saas/kitchen-engine/money";
import { UNIT_KEYS, UnitError, dimensionOf, fromMilli, isUnit, pricePerUnit, toMilli } from "@saas/kitchen-engine/units";
import type { MemberGroup } from "./groups-client.js";
import { conflict, errorResponse, notFound, unavailable, unprocessable } from "./http.js";
import { toPublicId } from "./ids.js";
import { Fields, isoDate, minor, oneOf, subjectId, text, type FieldErrors } from "./validate.js";

/** What the caller's own pantry is called. */
export const PERSONAL_PANTRY_NAME = "My pantry";

export const MAX_NAME = 120;
export const MAX_CATEGORY = 60;
/** The longest search text; anything longer cannot be a pantry item's name. */
export const MAX_QUERY = 100;

export const DEFAULT_ITEMS_LIMIT = 50;
export const MAX_ITEMS_LIMIT = 100;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;

// ── Dates ──────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The calendar date (UTC) of an instant, as YYYY-MM-DD. */
export function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

/** The days a request measures "use soon" and "expired" from. Dates are UTC days (see risks CP-P). */
export interface Today {
  today: string;
  soonUntil: string;
}

export function todayOf(now: Date): Today {
  const today = isoDay(now);
  return { today, soonUntil: addDays(today, USE_SOON_DAYS) };
}

/** The repository's use-by filter for `filter`. */
export function expiresFilter(filter: ItemFilter, day: Today): KitchenItemsQuery["expires"] {
  switch (filter) {
    case "soon":
      return { from: day.today, to: day.soonUntil };
    case "expired":
      return { before: day.today };
    default:
      return null;
  }
}

// ── Public shapes ──────────────────────────────────────────

export function personalPantryRef(): PantryRef {
  return { kind: "personal", name: PERSONAL_PANTRY_NAME };
}

export function groupPantryRef(group: Pick<MemberGroup, "publicId" | "slug" | "name">): PantryRef {
  return { kind: "group", orgId: group.publicId, slug: group.slug, name: group.name };
}

/** A quantity in `unit` for display: three decimals at most (the exact value is the *Milli field). */
export function displayQuantity(milli: number, unit: string): number {
  return Math.round(fromMilli(milli, unit) * 1000) / 1000;
}

/**
 * The item as the API shows it. `groupWastePolicy` is its group's rule (null
 * for a personal item); `today` is the day `daysToUseBy` counts from;
 * `measures` its name's measures in its pantry (SM-13, `readMeasures`). A
 * group item says whether it asks first (PN-8); `ask` adds, for an
 * ask-first one, who may use it, whether the caller must ask and who
 * answers (`itemAskFields` in ./asks.ts), where the read resolved them.
 */
export function toKitchenItem(
  record: KitchenItemRecord,
  pantry: PantryRef,
  groupWastePolicy: WastePolicy | null,
  today: string,
  measures: KitchenMeasure[],
  ask: Pick<KitchenItem, "allowed" | "mustAsk" | "answerer"> = {},
): KitchenItem {
  // What is left of the price is what using all that is left would cost: the
  // engine's last-use rule charges exactly price − cost taken.
  const worthMinor = record.qtyLeftMilli > 0 ? costOfUse(record, record.qtyLeftMilli) : 0;
  return {
    id: toPublicId("itm", record.id),
    pantry,
    name: record.name,
    category: record.category,
    dimension: record.dimension,
    displayUnit: record.displayUnit,
    qtyBought: displayQuantity(record.qtyBoughtMilli, record.displayUnit),
    qtyLeft: displayQuantity(record.qtyLeftMilli, record.displayUnit),
    qtyBoughtMilli: record.qtyBoughtMilli,
    qtyLeftMilli: record.qtyLeftMilli,
    priceMinor: record.priceMinor,
    currency: record.currency,
    unitPriceMinor: pricePerUnit(record.priceMinor, record.qtyBoughtMilli, record.displayUnit),
    worthMinor,
    paidBy: record.paidBy,
    boughtOn: record.boughtOn,
    expiresOn: record.expiresOn,
    daysToUseBy: record.expiresOn ? daysBetween(today, record.expiresOn) : null,
    wastePolicy: record.ownerKind === "group" ? (record.wastePolicy ?? groupWastePolicy ?? DEFAULT_WASTE_POLICY) : null,
    wastePolicyOverride: record.wastePolicy,
    state: record.state,
    version: record.version,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    measures,
    // Whoever can read the item reads its note (RC-3): every route that
    // answers with an item has already scoped it to the caller's pantries.
    note: record.note,
    // Ask before use (PN-8): every group item says; a personal item never asks.
    ...(record.ownerKind === "group" ? { askFirst: record.askFirst === true, ...ask } : {}),
  };
}

/** A group's waste rule from its settings row (the default without one). */
export function wastePolicyOf(settings: KitchenGroupSettings | null | undefined): WastePolicy {
  return settings?.wastePolicy ?? DEFAULT_WASTE_POLICY;
}

/**
 * One pantry's totals from the repository's rows (one per currency it holds
 * items in). Every item counts; the worth is summed in `currency` only, since
 * amounts in two currencies do not add up.
 */
export function pantryTotals(rows: readonly KitchenPantryTotals[], currency: string): PantryTotals {
  const totals: PantryTotals = { itemCount: 0, useSoonCount: 0, expiredCount: 0, worthMinor: 0, currency };
  for (const row of rows) {
    totals.itemCount += row.itemCount;
    totals.useSoonCount += row.useSoonCount;
    totals.expiredCount += row.expiredCount;
    if (row.currency === currency) totals.worthMinor += row.worthMinor;
  }
  return totals;
}

/**
 * The currency a personal pantry is shown in: the one most of its items are
 * in (INR on a tie that includes it, else the first alphabetically); INR when
 * it is empty. A personal item takes its currency from the request.
 */
export function personalCurrency(rows: readonly KitchenPantryTotals[]): string {
  let best: KitchenPantryTotals | null = null;
  for (const row of [...rows].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0))) {
    if (!best || row.itemCount > best.itemCount || (row.itemCount === best.itemCount && row.currency === DEFAULT_KITCHEN_CURRENCY)) {
      best = row;
    }
  }
  return best?.currency ?? DEFAULT_KITCHEN_CURRENCY;
}

// ── List queries ───────────────────────────────────────────

function toBase64Url(textValue: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(textValue)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(token: string): string | null {
  try {
    const binary = atob(token.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (token.length % 4)) % 4));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function encodeItemsCursor(cursor: KitchenItemsCursor): string {
  return toBase64Url(JSON.stringify([cursor.expiresKey, cursor.nameKey, cursor.id]));
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function decodeItemsCursor(token: string): KitchenItemsCursor | null {
  if (token.length > 1000) return null;
  const decoded = fromBase64Url(token);
  if (!decoded) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  const [expiresKey, nameKey, id] = parsed as unknown[];
  if (typeof expiresKey !== "string" || !ISO_DAY_RE.test(expiresKey)) return null;
  if (typeof nameKey !== "string" || nameKey.length === 0 || nameKey.length > MAX_NAME) return null;
  if (typeof id !== "string" || !isUuid(id)) return null;
  return { expiresKey, nameKey, id };
}

/** A whole number from 1 to `max` in the query string, or `fallback` when absent. */
export function limitParam(fields: Fields, url: URL, fallback: number, max: number): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (/^\d+$/.test(raw) && n >= 1 && n <= max) return n;
  fields.add("limit", `Must be a whole number from 1 to ${max}`);
  return fallback;
}

/** The trimmed `q` (null when empty). */
export function queryParam(fields: Fields, url: URL): string | null {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length > MAX_QUERY) {
    fields.add("q", `Must be at most ${MAX_QUERY} characters`);
    return null;
  }
  return q === "" ? null : q;
}

export interface ItemsListParams {
  q: string | null;
  filter: ItemFilter;
  cursor: KitchenItemsCursor | null;
  limit: number;
}

/** `q`, `filter`, `cursor` and `limit`, as GET …/items takes them. */
export function parseItemsListParams(fields: Fields, url: URL): ItemsListParams {
  const q = queryParam(fields, url);
  const rawFilter = url.searchParams.get("filter");
  const filter = rawFilter === null || rawFilter === "" ? "all" : oneOf(fields, "filter", rawFilter, ITEM_FILTERS) ?? "all";
  let cursor: KitchenItemsCursor | null = null;
  const rawCursor = url.searchParams.get("cursor");
  if (rawCursor !== null && rawCursor !== "") {
    cursor = decodeItemsCursor(rawCursor);
    if (!cursor) fields.add("cursor", "Must be a nextCursor this route returned");
  }
  const limit = limitParam(fields, url, DEFAULT_ITEMS_LIMIT, MAX_ITEMS_LIMIT);
  return { q, filter, cursor, limit };
}

// ── Request bodies ─────────────────────────────────────────

export interface ParsedQuantity {
  dimension: KitchenDimension;
  displayUnit: string;
  qtyMilli: number;
}

/** A decimal quantity in a unit, in thousandths of the unit's base, by the engine's rules. */
function quantity(fields: Fields, value: unknown, unit: string): ParsedQuantity | undefined {
  if (typeof value !== "string" && typeof value !== "number") return fields.add("quantity", 'Must be a decimal such as "1.25"');
  try {
    return { dimension: dimensionOf(unit), displayUnit: unit, qtyMilli: toMilli(value, unit) };
  } catch (err) {
    if (err instanceof UnitError) return fields.add("quantity", "Must be a quantity above zero, such as \"1.25\"");
    throw err;
  }
}

function unitValue(fields: Fields, value: unknown): string | undefined {
  if (isUnit(value)) return value;
  return fields.add("unit", `Must be one of: ${UNIT_KEYS.join(", ")}`);
}

function currencyValue(fields: Fields, value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === "string" && CURRENCY_CODE_RE.test(value)) return value;
  fields.add("currency", "Must be a three-letter ISO 4217 code in capitals, such as INR");
  return null;
}

function wastePolicyValue(fields: Fields, value: unknown): WastePolicy | null | undefined {
  if (value === null) return null;
  return oneOf(fields, "wastePolicy", value, WASTE_POLICIES);
}

/**
 * An item's note (RC-3): text, trimmed; empty (or null) is none, stored as
 * NULL. At most ITEM_NOTE_MAX characters, counted as the table's CHECK counts
 * them. Undefined when it was not sent (or is wrong, recorded in `fields`).
 */
function noteValue(fields: Fields, value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "string") return fields.add("note", "Must be text, or null for none");
  const note = normalizeItemNote(value);
  if (note !== null && itemNoteLength(note) > ITEM_NOTE_MAX) return fields.add("note", `Must be at most ${ITEM_NOTE_MAX} characters`);
  return note;
}

export interface ParsedNewItem extends ParsedQuantity {
  name: string;
  category: string;
  priceMinor: number;
  /** As sent; null when the request named none. */
  currency: string | null;
  boughtOn: string | null;
  expiresOn: string | null;
  /** Group items only: null means the caller. */
  paidBy: string | null;
  /** Group items only: null follows the group. */
  wastePolicy: WastePolicy | null;
  /** Trimmed; null when none was sent (or only spaces). */
  note: string | null;
  /** Ask before use (PN-8), group items only: "Ask me first", and who never needs to ask. */
  askFirst: boolean;
  allowed: string[];
}

/** The most people an item may let use it without asking (PN-8). */
export const MAX_ALLOWED = ASK_ALLOWED_MAX;

/**
 * `askFirst` and `allowed` (PN-8): a group item's, as sent; on a personal
 * item either one is a field error — a personal item never asks.
 */
function askFields(fields: Fields, body: Record<string, unknown>, group: boolean): { askFirst?: boolean; allowed?: string[] } {
  const out: { askFirst?: boolean; allowed?: string[] } = {};
  if (!group) {
    if (body.askFirst !== undefined) fields.add("askFirst", "A personal item never asks: only a group item can ask first");
    if (body.allowed !== undefined) fields.add("allowed", "A personal item never asks: only a group item can ask first");
    return out;
  }
  if (body.askFirst !== undefined) {
    if (typeof body.askFirst === "boolean") out.askFirst = body.askFirst;
    else fields.add("askFirst", "Must be true or false");
  }
  if (body.allowed !== undefined) {
    if (body.allowed === null) out.allowed = [];
    else if (!Array.isArray(body.allowed) || body.allowed.length > MAX_ALLOWED) {
      fields.add("allowed", `List who may use it without asking: up to ${MAX_ALLOWED} people`);
    } else {
      const named = body.allowed.map((v: unknown, i) => subjectId(fields, `allowed[${i}]`, v));
      if (named.every((v): v is string => v !== undefined)) out.allowed = [...new Set(named)];
    }
  }
  return out;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

/** Validate a POST …/items body. Unknown fields are ignored, as on every baseline route. */
export function parseNewItem(body: Record<string, unknown>, options: { group: boolean }): Parsed<ParsedNewItem> {
  const fields = new Fields();
  const name = text(fields, "name", body.name, MAX_NAME);
  const category = text(fields, "category", body.category, MAX_CATEGORY);
  const unit = unitValue(fields, body.unit);
  const qty = unit === undefined ? undefined : quantity(fields, body.quantity, unit);
  const priceMinor = minor(fields, "priceMinor", body.priceMinor);
  const currency = currencyValue(fields, body.currency);
  const boughtOn = body.boughtOn === undefined || body.boughtOn === null ? null : isoDate(fields, "boughtOn", body.boughtOn) ?? null;
  const expiresOn = body.expiresOn === undefined || body.expiresOn === null ? null : isoDate(fields, "expiresOn", body.expiresOn) ?? null;
  const note = noteValue(fields, body.note) ?? null;
  const ask = askFields(fields, body, options.group);
  let paidBy: string | null = null;
  let wastePolicy: WastePolicy | null = null;
  if (options.group) {
    if (body.paidBy !== undefined && body.paidBy !== null) paidBy = subjectId(fields, "paidBy", body.paidBy) ?? null;
    if (body.wastePolicy !== undefined) wastePolicy = wastePolicyValue(fields, body.wastePolicy) ?? null;
  }
  if (boughtOn !== null && expiresOn !== null && expiresOn < boughtOn) {
    fields.add("expiresOn", "Must not be before boughtOn");
  }
  if (!fields.ok || name === undefined || category === undefined || qty === undefined || priceMinor === undefined) {
    return { ok: false, fields: fields.errors };
  }
  return {
    ok: true,
    value: {
      name,
      category,
      ...qty,
      priceMinor,
      currency,
      boughtOn,
      expiresOn,
      paidBy,
      wastePolicy,
      note,
      askFirst: ask.askFirst ?? false,
      allowed: ask.allowed ?? [],
    },
  };
}

/** An edit as sent: `quantity` keeps its raw value until the item's unit is known. */
export interface ParsedItemEdit {
  name?: string;
  category?: string;
  expiresOn?: string | null;
  quantity?: { value: string | number; unit: string | null };
  priceMinor?: number;
  wastePolicy?: WastePolicy | null;
  /** Trimmed; null clears it. */
  note?: string | null;
  /** Ask before use (PN-8), group items only. */
  askFirst?: boolean;
  /** Replaces who never needs to ask. */
  allowed?: string[];
  version?: number;
}

/** Validate a PATCH …/items/{itm} body: at least one field. */
export function parseItemEdit(body: Record<string, unknown>, options: { group: boolean }): Parsed<ParsedItemEdit> {
  const fields = new Fields();
  const edit: ParsedItemEdit = {};
  if (body.name !== undefined) {
    const name = text(fields, "name", body.name, MAX_NAME);
    if (name !== undefined) edit.name = name;
  }
  if (body.category !== undefined) {
    const category = text(fields, "category", body.category, MAX_CATEGORY);
    if (category !== undefined) edit.category = category;
  }
  if (body.expiresOn !== undefined) {
    if (body.expiresOn === null) edit.expiresOn = null;
    else {
      const expiresOn = isoDate(fields, "expiresOn", body.expiresOn);
      if (expiresOn !== undefined) edit.expiresOn = expiresOn;
    }
  }
  if (body.quantity !== undefined) {
    const unit = body.unit === undefined ? null : unitValue(fields, body.unit);
    if (typeof body.quantity !== "string" && typeof body.quantity !== "number") {
      fields.add("quantity", 'Must be a decimal such as "1.25"');
    } else if (unit !== undefined) {
      edit.quantity = { value: body.quantity, unit };
    }
  } else if (body.unit !== undefined) {
    fields.add("unit", "Send unit with quantity");
  }
  if (body.priceMinor !== undefined) {
    const priceMinor = minor(fields, "priceMinor", body.priceMinor);
    if (priceMinor !== undefined) edit.priceMinor = priceMinor;
  }
  if (options.group && body.wastePolicy !== undefined) {
    const wastePolicy = wastePolicyValue(fields, body.wastePolicy);
    if (wastePolicy !== undefined) edit.wastePolicy = wastePolicy;
  }
  if (body.note !== undefined) {
    const note = noteValue(fields, body.note);
    if (note !== undefined) edit.note = note;
  }
  Object.assign(edit, askFields(fields, body, options.group));
  if (body.version !== undefined) {
    if (typeof body.version === "number" && Number.isSafeInteger(body.version) && body.version >= 1) edit.version = body.version;
    else fields.add("version", "Must be the item's version, a whole number from 1");
  }
  const changes = Object.keys(edit).filter((k) => k !== "version");
  if (fields.ok && changes.length === 0) {
    fields.add("body", `Provide at least one of: name, category, expiresOn, quantity, priceMinor${options.group ? ", wastePolicy" : ""}, note${options.group ? ", askFirst, allowed" : ""}`);
  }
  return fields.ok ? { ok: true, value: edit } : { ok: false, fields: fields.errors };
}

/** Resolve an edit's quantity in its unit (the item's own when none was sent). */
export function resolveQuantity(
  edit: ParsedItemEdit,
  current: KitchenItemRecord,
): Parsed<ParsedQuantity | undefined> {
  if (!edit.quantity) return { ok: true, value: undefined };
  const fields = new Fields();
  const unit = edit.quantity.unit ?? current.displayUnit;
  if (!isUnit(unit)) return { ok: false, fields: { unit: [`Must be one of: ${UNIT_KEYS.join(", ")}`] } };
  const qty = quantity(fields, edit.quantity.value, unit);
  return qty ? { ok: true, value: qty } : { ok: false, fields: fields.errors };
}

/** The repository's change set for an edit, with its quantity resolved. */
export function itemChanges(edit: ParsedItemEdit, quantity: ParsedQuantity | undefined): KitchenItemChanges {
  const changes: KitchenItemChanges = {};
  if (edit.name !== undefined) changes.name = edit.name;
  if (edit.category !== undefined) changes.category = edit.category;
  if (edit.expiresOn !== undefined) changes.expiresOn = edit.expiresOn;
  if (quantity !== undefined) changes.quantity = quantity;
  if (edit.priceMinor !== undefined) changes.priceMinor = edit.priceMinor;
  if (edit.wastePolicy !== undefined) changes.wastePolicy = edit.wastePolicy;
  if (edit.note !== undefined) changes.note = edit.note;
  if (edit.askFirst !== undefined) changes.askFirst = edit.askFirst;
  return changes;
}

/** An edit's expected version, as the repository takes it (absent when the request sent none). */
export function expectedVersion(edit: ParsedItemEdit): { expectedVersion?: number } {
  return edit.version === undefined ? {} : { expectedVersion: edit.version };
}

// ── Outcomes ───────────────────────────────────────────────

/** The response to a refused item write. */
export function itemErrorResponse(requestId: string, error: KitchenRepositoryError): Response {
  switch (error.kind) {
    case "not_found":
      return notFound(requestId);
    case "item_used":
      return conflict(
        requestId,
        "Some of this item has been used: what was bought can no longer change, and it cannot be removed (mark it wasted instead)",
        KITCHEN_ERROR_REASONS.ITEM_USED,
      );
    case "version_conflict":
      return conflict(requestId, "This item has changed since it was read", KITCHEN_ERROR_REASONS.VERSION_CONFLICT, {
        version: error.version,
      });
    case "currency_mismatch":
      return unprocessable(requestId, `The group counts in ${error.currency}`, KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH, {
        currency: error.currency,
      });
    case "invalid":
      // Every value the table CHECKs is validated first, so this is a bug, not a bad request.
      return errorResponse("internal_error", "The item was out of range", 500, requestId, { reason: error.reason });
    default:
      return unavailable(requestId);
  }
}
