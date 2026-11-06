// Your measures (Cookpool SM-13, design §6): the sizes an item's name is
// counted in, in one pantry and dimension ("1 onion ≈ 150 g", "20 slices in a
// pack"). What every handler shares: the public shape of a measure, reading
// the measures of many items in one statement, the PUT …/measures body, and a
// use or an ingredient given as a count of a measure.
//
// A measure only decides how much a use takes. The amount is the contracts'
// `measureTakeMilli` (count × size, the last use within rounding taking
// exactly what is left); from there it is any other use: the stock guard, 409
// `insufficient_stock`, the engine's proportional cost, the ledger. What the
// move keeps besides is its words ("2 onions"), `measureLabel`.

import {
  MAX_MEASURES,
  MAX_MEASURE_QUANTITY,
  MAX_MEASURE_WORD,
  findMeasure,
  measureLabel,
  measureTakeMilli,
  type KitchenMeasure,
  type KitchenMeasureInput,
} from "@saas/contracts/kitchen";
import type { KitchenItemRecord, KitchenMeasureKey, KitchenMeasureRecord, KitchenPantryOwner, KitchenRepository } from "@saas/db/kitchen";
import type { Uuid } from "@saas/db/ids";
import type { RequestContext } from "./context.js";
import { toPublicId } from "./ids.js";
import { Fields, text, type FieldErrors } from "./validate.js";

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

// ── Public shape ───────────────────────────────────────────

export function toKitchenMeasure(record: KitchenMeasureRecord): KitchenMeasure {
  return {
    id: toPublicId("msr", record.id),
    one: record.one,
    many: record.many,
    count: record.count,
    amountMilli: record.amountMilli,
  };
}

// ── Reading them ───────────────────────────────────────────

/** The pantry an item is in, as the measures key it. */
export function pantryOf(item: KitchenItemRecord): KitchenPantryOwner {
  return item.ownerKind === "group" ? { kind: "group", orgId: item.orgId as Uuid } : { kind: "user", subjectId: item.ownerSubjectId! };
}

/** Which measures an item reads: its name's, in its pantry, for its dimension. */
export function measureKeyOf(item: KitchenItemRecord): KitchenMeasureKey {
  return { owner: pantryOf(item), name: item.name, dimension: item.dimension };
}

/**
 * The same key as the database folds it: SQLite's trim() (spaces) and
 * lower() (ASCII letters only). Items that fold alike share one lookup; any
 * two the database might tell apart are looked up apart.
 */
function foldedKey(key: KitchenMeasureKey): string {
  const owner = key.owner.kind === "user" ? key.owner.subjectId : key.owner.orgId;
  const name = key.name.replace(/^ +| +$/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
  return JSON.stringify([key.owner.kind, owner, name, key.dimension]);
}

/** Each item's measures, as the API shows them (empty when its name has none). */
export type MeasureBook = (item: KitchenItemRecord) => KitchenMeasure[];

/**
 * The measures of every item, read in ONE statement however many items —
 * items sharing a name in a pantry share one key — and none for no items.
 * Null when the database could not be read.
 */
export async function readMeasures(
  ctx: Pick<RequestContext, "timings">,
  repo: KitchenRepository,
  items: readonly KitchenItemRecord[],
): Promise<MeasureBook | null> {
  const index = new Map<string, number>();
  const keys: KitchenMeasureKey[] = [];
  const keyOf = new Map<KitchenItemRecord, number>();
  for (const item of items) {
    const key = measureKeyOf(item);
    const folded = foldedKey(key);
    let at = index.get(folded);
    if (at === undefined) {
      at = keys.length;
      keys.push(key);
      index.set(folded, at);
    }
    keyOf.set(item, at);
  }
  if (keys.length === 0) return () => [];
  const found = await ctx.timings.measure("db", () => repo.listMeasures(keys));
  if (!found.ok) return null;
  const lists = found.value.map((records) => records.map(toKitchenMeasure));
  return (item) => {
    const at = keyOf.get(item) ?? index.get(foldedKey(measureKeyOf(item)));
    return at === undefined ? [] : [...(lists[at] ?? [])];
  };
}

// ── PUT …/items/{itm}/measures ─────────────────────────────

function wholeAboveZero(fields: Fields, name: string, value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  return fields.add(name, "Must be a whole number above zero");
}

/**
 * A PUT …/measures body: `measures`, 0 to MAX_MEASURES of `{ one, many,
 * count, amountMilli }` — words of 1 to MAX_MEASURE_WORD characters
 * (trimmed), each `one` once (case-insensitively), whole numbers above zero
 * with `amountMilli` at least `count` (a measure is at least a thousandth of
 * the unit, so half of one is never nothing).
 */
export function parseSetMeasures(body: Record<string, unknown>): Parsed<KitchenMeasureInput[]> {
  const fields = new Fields();
  const raw = body.measures;
  if (!Array.isArray(raw)) return { ok: false, fields: { measures: [`Must be a list of at most ${MAX_MEASURES} measures`] } };
  if (raw.length > MAX_MEASURES) fields.add("measures", `At most ${MAX_MEASURES} measures`);
  const measures: KitchenMeasureInput[] = [];
  const seen = new Set<string>();
  raw.slice(0, MAX_MEASURES).forEach((value: unknown, i) => {
    const at = `measures[${i}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) return fields.add(at, "Must be an object");
    const m = value as Record<string, unknown>;
    const one = text(fields, `${at}.one`, m.one, MAX_MEASURE_WORD);
    const many = text(fields, `${at}.many`, m.many, MAX_MEASURE_WORD);
    const count = wholeAboveZero(fields, `${at}.count`, m.count);
    const amountMilli = wholeAboveZero(fields, `${at}.amountMilli`, m.amountMilli);
    if (count !== undefined && amountMilli !== undefined && amountMilli < count) {
      fields.add(`${at}.amountMilli`, "Must be at least count: a measure is at least a thousandth of the unit");
    }
    if (one !== undefined) {
      const folded = one.toLowerCase();
      if (seen.has(folded)) fields.add(`${at}.one`, "Name each measure once");
      seen.add(folded);
    }
    if (one !== undefined && many !== undefined && count !== undefined && amountMilli !== undefined) {
      measures.push({ one, many, count, amountMilli });
    }
    return undefined;
  });
  return fields.ok ? { ok: true, value: measures } : { ok: false, fields: fields.errors };
}

// ── A use, or an ingredient, in a measure ──────────────────

/** A count of a measure as a request gives it: a positive multiple of ½, up to MAX_MEASURE_QUANTITY. Null otherwise. */
export function measureQuantity(value: string | number): number | null {
  let n: number;
  if (typeof value === "number") n = value;
  else if (/^\d{1,6}(\.\d{1,6})?$/.test(value.trim())) n = Number(value.trim());
  else return null;
  return Number.isFinite(n) && n > 0 && n <= MAX_MEASURE_QUANTITY && Number.isInteger(n * 2) ? n : null;
}

/** A use's `measure` field: the word, trimmed. */
export function measureWord(fields: Fields, name: string, value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_MEASURE_WORD) return value.trim();
  return fields.add(name, `Must be one of the item's measures (its one, at most ${MAX_MEASURE_WORD} characters)`);
}

export const MEASURE_QUANTITY_MESSAGE = `Must be a count of the measure above zero, in halves (such as 2 or 0.5), at most ${MAX_MEASURE_QUANTITY}`;

/** What a use of `quantity` of the measure `word` takes from `item`, as `measureTakeMilli` works it out. */
export type MeasureTake =
  | { kind: "taken"; qtyMilli: number; label: string }
  /** The item's name has no such measure: 422 `validation_failed`, `fields`. */
  | { kind: "unknown"; fields: FieldErrors }
  /** More than is left: 409 `insufficient_stock`. */
  | { kind: "short" };

export function takeInMeasure(
  item: KitchenItemRecord,
  measures: readonly KitchenMeasure[],
  use: { word: string; quantity: number },
  field = "measure",
): MeasureTake {
  const measure = findMeasure(measures, use.word);
  if (!measure) {
    const known = measures.map((m) => m.one).join(", ");
    return {
      kind: "unknown",
      fields: { [field]: [known ? `Must be one of ${item.name}'s measures: ${known}` : `${item.name} has no measures yet`] },
    };
  }
  const qtyMilli = measureTakeMilli(use.quantity, measure, item);
  if (qtyMilli === null) return { kind: "short" };
  return { kind: "taken", qtyMilli, label: measureLabel(use.quantity, measure) };
}
