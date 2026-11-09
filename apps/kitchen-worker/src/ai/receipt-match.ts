import {
  AI_RECEIPT_NOT_FOOD,
  AI_RECEIPT_UNCLEAR,
  DEFAULT_KITCHEN_CURRENCY,
  type AiReceiptLine,
  type AiReceiptResponse,
  type PantryRef,
} from "@saas/contracts/kitchen";
import type { KitchenFoodRecord, KitchenItemRecord } from "@saas/db/kitchen";
import { UNITS } from "@saas/kitchen-engine/units";
import { toPublicId } from "../ids.js";
import type { Reach } from "../restock.js";
import { personalPantryRef } from "../pantry.js";
import type { ReadLine, ReceiptRead } from "./receipt-task.js";

// Matching a receipt's lines to the caller (Cookpool AI, AI-3, design §3) —
// on the server, with no model. Each food line is looked up, by its plain
// name, against what the caller bought before (their restock read's names
// in every pantry, and their item history) and against the food list:
//
//   * a name matches a purchase when the two are the same name (folded:
//     case, punctuation, a plural "s"/"es") or name the same food ("Pyaz"
//     and "Onion" are both `onion`);
//   * the line is `sure` only when the kind of unit (count, mass, volume,
//     pack) is the purchase's and the price is within ±50% of last time's
//     for the same amount — or, with no purchase to compare (none, or one
//     with no price), when the name is exactly a food and the unit's kind
//     fits it. Anything else is `check`, with a short reason;
//   * the pantry is the one the newest matching purchase went into (that the
//     caller can still add to), with that purchase as `fromItemId`; else the
//     caller's most-used pantry for the food's kind (its category); else
//     their own.
//
// Non-food lines are `check` with reason `not_food` and no pantry.

/** ±50%: a price is plausible from half to one and a half times last time's, for the same amount. */
const PRICE_LOW = 0.5;
const PRICE_HIGH = 1.5;

/** One past purchase the matcher may compare a line with. */
export interface PastPurchase {
  record: KitchenItemRecord;
  /** How many records share its name (history), or the days it was bought (restock): weighs "most-used". */
  times: number;
}

export interface MatchInput {
  read: ReceiptRead;
  /** The restock read's newest purchase per name and pantry, then the history's newest per name. */
  purchases: readonly PastPurchase[];
  /** Foods by the exact names they were looked up with (line names, printed texts, purchase names). */
  foods: ReadonlyMap<string, KitchenFoodRecord>;
  /** Where a pantry is, as the caller reaches it; null when out of reach. */
  reach: (orgId: string | null) => Reach | null;
  /** Each group's currency, by stored org id. */
  currencies: ReadonlyMap<string, string>;
}

/** A name folded for comparing: lower case, letters and digits, single spaces. */
export function foldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The folded name and its singulars ("tomatoes" → tomato, tomatoe; "eggs" → egg). */
function nameKeys(name: string): Set<string> {
  const folded = foldName(name);
  const keys = new Set([folded]);
  if (folded.length > 3 && folded.endsWith("es")) keys.add(folded.slice(0, -2));
  if (folded.length > 2 && folded.endsWith("s")) keys.add(folded.slice(0, -1));
  return keys;
}

const sameName = (a: string, b: string): boolean => {
  const keys = nameKeys(a);
  for (const key of nameKeys(b)) if (key !== "" && keys.has(key)) return true;
  return false;
};

/** The food a line names: its plain name first, else its printed text. */
export function lineFood(line: ReadLine, foods: ReadonlyMap<string, KitchenFoodRecord>): KitchenFoodRecord | null {
  return (line.name ? foods.get(line.name) : undefined) ?? foods.get(line.text) ?? null;
}

const newestFirst = (a: PastPurchase, b: PastPurchase): number =>
  b.record.boughtOn.localeCompare(a.record.boughtOn) ||
  b.record.createdAt.getTime() - a.record.createdAt.getTime() ||
  b.record.id.localeCompare(a.record.id);

/** Does a food counted in `kind` fit a line counted in `lineKind`? A counted food fits a weight too (it has a piece weight). */
function kindFitsFood(lineKind: string, food: KitchenFoodRecord): boolean {
  if (lineKind === food.dimension) return true;
  return food.eachG !== null && ((lineKind === "count" && food.dimension === "mass") || (lineKind === "mass" && food.dimension === "count"));
}

/** Is `line`'s price within ±50% of `past`'s for the same amount? Null when `past` has no price to compare. */
function pricePlausible(line: ReadLine, past: KitchenItemRecord): boolean | null {
  if (line.milli === null || past.priceMinor <= 0 || past.qtyBoughtMilli <= 0) return null;
  const expected = (past.priceMinor * line.milli) / past.qtyBoughtMilli;
  return line.priceMinor >= expected * PRICE_LOW && line.priceMinor <= expected * PRICE_HIGH;
}

const pantryKey = (orgId: string | null): string => orgId ?? "personal";

export function matchReceipt(input: MatchInput): AiReceiptResponse {
  const { read, foods, reach, currencies } = input;
  const purchases = [...input.purchases].sort(newestFirst);
  const foodOf = (record: KitchenItemRecord) => foods.get(record.name) ?? null;

  // The caller's most-used pantries they can add to: by category, and overall.
  const used = new Map<string, Map<string, { orgId: string | null; times: number }>>();
  const tally = (kind: string, orgId: string | null, times: number) => {
    const byPantry = used.get(kind) ?? new Map<string, { orgId: string | null; times: number }>();
    const entry = byPantry.get(pantryKey(orgId)) ?? { orgId, times: 0 };
    entry.times += times;
    byPantry.set(pantryKey(orgId), entry);
    used.set(kind, byPantry);
  };
  for (const p of purchases) {
    if (!reach(p.record.orgId)?.canAdd) continue;
    tally(p.record.category.toLowerCase(), p.record.orgId, p.times);
    tally("", p.record.orgId, p.times);
  }
  const mostUsed = (kind: string | null): { pantry: PantryRef; orgId: string | null } => {
    const pick = (byPantry: Map<string, { orgId: string | null; times: number }> | undefined) =>
      byPantry ? [...byPantry.values()].sort((a, b) => b.times - a.times || (a.orgId === null ? -1 : 1))[0] : undefined;
    const best = (kind ? pick(used.get(kind.toLowerCase())) : undefined) ?? pick(used.get(""));
    const where = best ? reach(best.orgId) : null;
    return where && best ? { pantry: where.pantry, orgId: best.orgId } : { pantry: personalPantryRef(), orgId: null };
  };

  const chosenPantries: Array<string | null> = [];
  const matchLine = (line: ReadLine): AiReceiptLine => {
    const base: AiReceiptLine = { text: line.text, confidence: "check" };
    if (line.name) base.name = line.name;
    if (line.quantity !== null && line.unit !== null) {
      base.quantity = line.quantity;
      base.unit = line.unit;
    }
    base.priceMinor = line.priceMinor;
    if (!line.isFood) return { ...base, reason: AI_RECEIPT_NOT_FOOD };

    const food = lineFood(line, foods);
    if (food) base.foodId = food.key;
    const lineName = line.name ?? line.text;
    // Same name first, then the same food; newest first within each.
    const byName = purchases.filter((p) => sameName(lineName, p.record.name));
    const byFood = food ? purchases.filter((p) => !byName.includes(p) && foodOf(p.record)?.key === food.key) : [];
    const matches = [...byName, ...byFood];
    const last = matches[0];

    // Where it goes: the newest match the caller can add to, else their most-used pantry for its kind.
    const addable = matches.find((p) => reach(p.record.orgId)?.canAdd);
    let orgId: string | null;
    if (addable) {
      base.pantry = reach(addable.record.orgId)!.pantry;
      orgId = addable.record.orgId;
      base.fromItemId = toPublicId("itm", addable.record.id);
    } else {
      const kind = food?.category ?? last?.record.category ?? null;
      const most = mostUsed(kind);
      base.pantry = most.pantry;
      orgId = most.orgId;
      if (last) base.fromItemId = toPublicId("itm", last.record.id);
    }
    chosenPantries.push(orgId);
    if (last) base.name = last.record.name;
    else if (food && !line.name) base.name = food.name;

    const check = (reason: string): AiReceiptLine => ({ ...base, confidence: "check", reason });
    if (line.unit === null || line.milli === null) return check("no amount on the line");
    const kind = UNITS[line.unit].dimension;

    // Compare with the newest purchase counted in the same kind of unit.
    const sameKind = matches.find((p) => p.record.dimension === kind);
    if (matches.length > 0 && !sameKind) return check(`bought in ${last!.record.displayUnit} before`);
    const plausible = sameKind ? pricePlausible(line, sameKind.record) : null;
    if (plausible === false) return check("price far from last time's");
    if (plausible === true) return { ...base, confidence: "sure" };

    // Nothing to compare the price with: sure only on an exact food whose kind fits.
    if (!food) return check(matches.length > 0 ? "no price from before" : `not sure what ${line.text} is`);
    if (!kindFitsFood(kind, food)) return check(`${food.name} isn't counted in ${line.unit}`);
    return { ...base, confidence: "sure" };
  };
  // A line salvaged from a read that failed its check (AI-13) is matched as any other, but never `sure`.
  const lines: AiReceiptLine[] = read.lines.map((line) => {
    const matched = matchLine(line);
    return line.unclear && line.isFood ? { ...matched, confidence: "check", reason: AI_RECEIPT_UNCLEAR } : matched;
  });

  // The currency: the chosen pantries' (most lines'), INR when none.
  const counts = new Map<string, number>();
  for (const orgId of chosenPantries) {
    const currency = orgId === null ? DEFAULT_KITCHEN_CURRENCY : (currencies.get(orgId) ?? DEFAULT_KITCHEN_CURRENCY);
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
  }
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_KITCHEN_CURRENCY;

  const sumMinor = read.lines.reduce((sum, l) => sum + (l.isFood ? l.priceMinor : 0), 0);
  const allMinor = read.lines.reduce((sum, l) => sum + l.priceMinor, 0);
  const totalMatches =
    read.total !== null && (Math.abs(allMinor + read.adjustmentsMinor - read.total) <= 1 || Math.abs(allMinor - read.total) <= 1);

  return {
    ...(read.store ? { store: read.store } : {}),
    ...(read.total !== null ? { total: read.total } : {}),
    currency,
    sumMinor,
    totalMatches,
    lines,
  };
}
