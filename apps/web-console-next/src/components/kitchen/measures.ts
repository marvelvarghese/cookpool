/**
 * Your measures (Cookpool SM-14, design §6) as pure view-models: the word an
 * item is counted in (a small singular rule: "Onions" → onion / onions), the
 * one question asked the first time ("1 onion weighs about", "How many slices
 * in a pack?") with its four quick picks, the measure a pick saves (count of
 * it making amountMilli of the stock), what a measure says ("1 onion ≈
 * 150 g", "≈ 4 onions left"), a use or an ingredient given in a measure, the
 * usual's words read back into a measure, and the cache patches that show a
 * saved measure at once (SM-5's pattern).
 *
 * The arithmetic is the server's own, shared in `@saas/contracts/kitchen`
 * (`measureTakeMilli`, `measureLabel`, `inMeasure`, `findMeasure`): nothing
 * here re-derives how much a measure takes. Dependency-free (contract types,
 * the engine), so it is unit-testable.
 */

import {
  MAX_MEASURES,
  MAX_MEASURE_QUANTITY,
  MAX_MEASURE_WORD,
  findMeasure,
  inMeasure,
  measureLabel,
  measureTakeMilli,
  type KitchenDimension,
  type KitchenItem,
  type KitchenMeasure,
  type KitchenMeasureInput,
  type KitchenUsual,
  type PantryRef,
  type ReachableItem,
} from "@saas/contracts/kitchen";
import { dimensionOf, formatQuantity, isUnit } from "@saas/kitchen-engine/units";
import { pendingId, type CacheKey, type CachePatch } from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";

export { MAX_MEASURES };

/** An item's measures (none on an answer from before SM-13). */
export function measuresOf(item: { measures?: readonly KitchenMeasure[] | undefined }): readonly KitchenMeasure[] {
  return item.measures ?? [];
}

// ── The word: a small singular rule ───────────────────────────────

export interface MeasureWords {
  /** The word for one: "onion". */
  one: string;
  /** The word for more: "onions". */
  many: string;
  /** The rule is sure of it (a plain plural it knows); otherwise the sheet shows the word, to change. */
  sure: boolean;
}

/** Food names that are not counted in themselves ("2 rice"): the word is asked, prefilled. */
const UNCOUNTABLE = new Set([
  "atta", "besan", "bread", "butter", "cereal", "cheese", "chicken", "chutney", "coffee", "coriander", "cream", "curd", "dal",
  "fish", "flour", "garlic", "ghee", "ginger", "honey", "jaggery", "jam", "juice", "ketchup", "maida", "masala", "meat", "milk",
  "mint", "mutton", "oats", "oil", "pasta", "paneer", "pickle", "poha", "powder", "rava", "rice", "salt", "sauce", "semolina",
  "sooji", "spinach", "sugar", "tea", "water", "yogurt", "yoghurt",
]);

/** Plurals the endings below get wrong. */
const IRREGULAR: Record<string, string> = {
  brownies: "brownie",
  chilies: "chili",
  chillies: "chilli",
  cookies: "cookie",
  halves: "half",
  leaves: "leaf",
  loaves: "loaf",
  pies: "pie",
};
const IRREGULAR_PLURAL: Record<string, string> = Object.fromEntries(Object.entries(IRREGULAR).map(([many, one]) => [one, many]));

/** Words ending in "o" whose plural takes "es". */
const O_ES = new Set(["tomato", "potato", "mango"]);

/** The plural of a word for one: onion → onions, berry → berries, peach → peaches, tomato → tomatoes, loaf → loaves. */
export function pluralOf(one: string): string {
  const word = one.trim();
  if (!word) return word;
  const lower = word.toLowerCase();
  const space = word.lastIndexOf(" ");
  const head = word.slice(0, space + 1);
  const last = lower.slice(space + 1);
  if (UNCOUNTABLE.has(last)) return word;
  if (IRREGULAR_PLURAL[last]) return head + IRREGULAR_PLURAL[last];
  if (/[^aeiou]y$/.test(last)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(last)) return `${word}es`;
  if (O_ES.has(last)) return `${word}es`;
  return `${word}s`;
}

/** The singular of a plural it knows ("onions" → "onion"), or null when the word is not a plain plural. */
function singularOf(word: string): string | null {
  if (IRREGULAR[word]) return IRREGULAR[word]!;
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (/(ches|shes|sses|xes|zzes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return null;
}

/** At most MAX_MEASURE_WORD characters: a long name counts in its last word. */
function fit(text: string): string {
  if (text.length <= MAX_MEASURE_WORD) return text;
  const last = text.slice(text.lastIndexOf(" ") + 1);
  return last.slice(0, MAX_MEASURE_WORD);
}

/**
 * The words an item's name is counted in: "Onions" → onion / onions,
 * "Tomatoes" → tomato / tomatoes, "Red onions" → red onion / red onions
 * (sure); "Rice" → rice / rice and "Onion" → onion / onions (not sure: the
 * sheet shows the word, to change).
 */
export function wordsForName(name: string): MeasureWords {
  const lower = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (!lower) return { one: "piece", many: "pieces", sure: false };
  const space = lower.lastIndexOf(" ");
  const head = lower.slice(0, space + 1);
  const last = lower.slice(space + 1);
  if (UNCOUNTABLE.has(last)) {
    const word = fit(lower);
    return { one: word, many: word, sure: false };
  }
  const single = singularOf(last);
  if (single) return { one: fit(head + single), many: fit(lower), sure: true };
  const one = fit(lower);
  return { one, many: fit(pluralOf(one)), sure: false };
}

/** The words for a word someone typed (or picked): "katori" → katori / katoris. */
export function wordsFor(one: string): { one: string; many: string } {
  const word = one.trim().replace(/\s+/g, " ").slice(0, MAX_MEASURE_WORD);
  return { one: word, many: pluralOf(word).slice(0, MAX_MEASURE_WORD) };
}

// ── Asking once ───────────────────────────────────────────────────

/** Mass, volume and packs can be counted another way; a counted item already is. */
export function canCountAnotherWay(dimension: KitchenDimension): boolean {
  return dimension === "mass" || dimension === "volume" || dimension === "pack";
}

/** The "Count in onions" tile is offered while the item has no measure of its own. */
export function askable(item: Pick<KitchenItem, "dimension"> & { measures?: readonly KitchenMeasure[] | undefined }): boolean {
  return canCountAnotherWay(item.dimension) && measuresOf(item).length === 0;
}

/** The four quick picks: grams for a weight, ml for a volume, how many in a pack. */
export const SIZE_CHOICES: Record<KitchenDimension, readonly number[]> = {
  mass: [50, 100, 150, 200],
  volume: [200, 250, 500, 1000],
  pack: [10, 16, 20, 24],
  count: [2, 6, 12, 30],
};

/** The words a pack is counted in (a picker, then "type one"). */
export const PACK_WORDS: readonly string[] = ["slices", "pieces", "packets"];

/** The word a pack starts counted in: slices of bread, pieces of anything else. */
export function packWords(name: string): { one: string; many: string } {
  return /bread|loaf|loaves|toast/i.test(name) ? { one: "slice", many: "slices" } : { one: "piece", many: "pieces" };
}

/** A pack's word from the picker ("slices") as one / many. */
export function packWord(many: string): { one: string; many: string } {
  const one = singularOf(many) ?? many;
  return { one, many };
}

export interface FirstAsk {
  /** The word it starts with. */
  one: string;
  many: string;
  /** Show the word, to change (the rule is not sure, or it is a volume's container). */
  editable: boolean;
  /** A pack picks its word: slices · pieces · packets · type one. */
  picker: readonly string[] | null;
}

/**
 * What the first question starts with: the singular of the item's name for
 * a weight (shown to change when the rule is not sure: "Rice" → rice); a
 * bottle for a volume, unless the name is a plain plural; slices or pieces,
 * from a picker, for a pack.
 */
export function firstAsk(item: Pick<KitchenItem, "name" | "dimension">): FirstAsk {
  const words = wordsForName(item.name);
  switch (item.dimension) {
    case "pack":
      return { ...packWords(item.name), editable: false, picker: PACK_WORDS };
    case "volume":
      return words.sure ? { one: words.one, many: words.many, editable: false, picker: null } : { one: "bottle", many: "bottles", editable: true, picker: null };
    default:
      return { one: words.one, many: words.many, editable: !words.sure, picker: null };
  }
}

/** The dashed tile: "Count in onions". */
export function countInLabel(many: string): string {
  return `Count in ${many}`;
}

/** The one question: "1 onion weighs about", "1 bottle holds about", "How many slices in a pack?". */
export function sizeQuestion(dimension: KitchenDimension, words: { one: string; many: string }): string {
  switch (dimension) {
    case "mass":
      return `1 ${words.one} weighs about`;
    case "volume":
      return `1 ${words.one} holds about`;
    case "pack":
      return `How many ${words.many} in a pack?`;
    default:
      return `How many in 1 ${words.one}?`;
  }
}

/** A quick pick on its chip: "150 g", "250 ml", "20", "12 pcs". */
export function choiceLabel(dimension: KitchenDimension, n: number): string {
  if (dimension === "mass") return `${n} g`;
  if (dimension === "volume") return `${n} ml`;
  if (dimension === "count") return `${n} pcs`;
  return String(n);
}

/**
 * The measure a pick saves, exactly: one of it is `n` g (or ml, or pcs) of
 * the stock — `count` 1, `amountMilli` n × 1 000 — or `n` of it make one pack
 * (`count` n, `amountMilli` 1 000): 20 slices are 1 000 milli-pack, so one is
 * exactly a twentieth.
 */
export function measureInput(dimension: KitchenDimension, words: { one: string; many: string }, n: number): KitchenMeasureInput {
  const word = { one: words.one.trim(), many: words.many.trim() };
  return dimension === "pack" ? { ...word, count: n, amountMilli: 1_000 } : { ...word, count: 1, amountMilli: n * 1_000 };
}

/** The pick a measure stands for (150 for 1 onion ≈ 150 g, 20 for 20 slices a pack), when it is one. */
export function choiceOf(dimension: KitchenDimension, m: Pick<KitchenMeasure, "count" | "amountMilli">): number | null {
  if (dimension === "pack") return m.amountMilli === 1_000 ? m.count : null;
  return m.count === 1 && m.amountMilli % 1_000 === 0 ? m.amountMilli / 1_000 : null;
}

/** The four chips for a measure being changed: its own size among them. */
export function choicesWith(dimension: KitchenDimension, base: readonly number[], current: number | null): number[] {
  if (current === null || base.includes(current)) return [...base];
  return [...base.slice(0, 3), current].sort((a, b) => a - b);
}

/** Save's words: "Save · 1 onion ≈ 150 g", "Save · 20 slices"; "Pick one" before a pick. */
export function saveLabel(dimension: KitchenDimension, words: { one: string; many: string }, n: number | null): string {
  if (n === null) return "Pick one";
  if (dimension === "pack") return `Save · ${n} ${words.many}`;
  return `Save · 1 ${words.one} ≈ ${choiceLabel(dimension, n)}`;
}

/** The sheet's one hint: "Saved for onions in Flat 4B." */
export function savedForText(many: string, pantry: PantryRef): string {
  return `Saved for ${many} in ${pantry.kind === "personal" ? "your kitchen" : pantry.name}.`;
}

// ── Adding one on the item page ───────────────────────────────────

export interface MeasureKind {
  /** The word for one ("katori"); "" for "type a word". */
  one: string;
  many: string;
  choices: readonly number[];
}

/**
 * "Add a measure" on the item page: kitchen words with their own quick
 * picks, then "type a word" — katori · cup · handful for something weighed;
 * cup · bottle · katori for something poured; slices · pieces · packets in a
 * pack; tray · box for something counted.
 */
export const ADD_KINDS: Record<KitchenDimension, readonly MeasureKind[]> = {
  mass: [
    { one: "katori", many: "katoris", choices: [100, 120, 150, 200] },
    { one: "cup", many: "cups", choices: [150, 200, 250, 300] },
    { one: "handful", many: "handfuls", choices: [30, 50, 80, 100] },
  ],
  volume: [
    { one: "cup", many: "cups", choices: [150, 200, 250, 300] },
    { one: "bottle", many: "bottles", choices: SIZE_CHOICES.volume },
    { one: "katori", many: "katoris", choices: [100, 120, 150, 200] },
  ],
  pack: PACK_WORDS.map((many) => ({ ...packWord(many), choices: SIZE_CHOICES.pack })),
  count: [
    { one: "tray", many: "trays", choices: [6, 12, 24, 30] },
    { one: "box", many: "boxes", choices: [4, 6, 10, 12] },
  ],
};

/** The quick picks for a word: its kind's, else the dimension's. */
export function choicesForWord(dimension: KitchenDimension, one: string): readonly number[] {
  const kind = ADD_KINDS[dimension].find((k) => k.one === one.trim().toLowerCase());
  return kind ? kind.choices : SIZE_CHOICES[dimension];
}

/** The kinds still free to add (a word the name already has is not offered again). */
export function freeKinds(dimension: KitchenDimension, measures: readonly Pick<KitchenMeasure, "one">[]): MeasureKind[] {
  return ADD_KINDS[dimension].filter((k) => !findMeasure(measures, k.one));
}

/** The measures as a request sends them (`id` is the server's). */
export function measureInputs(measures: readonly KitchenMeasure[]): KitchenMeasureInput[] {
  return measures.map((m) => ({ one: m.one, many: m.many, count: m.count, amountMilli: m.amountMilli }));
}

/**
 * The item's measures after a change on its page: `at` the one changed (or
 * null to add one at the end), `next` what it becomes (null removes it).
 * At most MAX_MEASURES; a word twice keeps the first.
 */
export function changedMeasures(
  measures: readonly KitchenMeasure[],
  at: number | null,
  next: KitchenMeasureInput | null,
): KitchenMeasureInput[] {
  const out = measureInputs(measures);
  if (at === null) {
    if (next) out.push(next);
  } else if (next) out[at] = next;
  else out.splice(at, 1);
  const seen = new Set<string>();
  return out
    .filter((m) => {
      const key = m.one.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MEASURES);
}

/** A word is fit to save: 1–24 characters, not one the name already has (other than the one being changed). */
export function wordProblem(one: string, measures: readonly Pick<KitchenMeasure, "one" | "many">[], changing: string | null = null): string | null {
  const word = one.trim();
  if (!word) return "Type a word";
  if (word.length > MAX_MEASURE_WORD) return `At most ${MAX_MEASURE_WORD} letters`;
  const same = findMeasure(measures, word);
  if (same && same.one.toLowerCase() !== (changing ?? "").toLowerCase()) return `Already counted in ${same.many}`;
  return null;
}

// ── A measure, said ───────────────────────────────────────────────

/** Weights and volumes vary ("≈"); a slice of a pack or a tray of eggs is exact. */
export function isApprox(dimension: KitchenDimension): boolean {
  return dimension === "mass" || dimension === "volume";
}

/** One of a measure as the item page lists it: name "1 onion", size "≈ 150 g"; "1 slice", "20 in a pack". */
export function measureRow(m: KitchenMeasure, dimension: KitchenDimension): { name: string; size: string } {
  const name = `1 ${m.one}`;
  if (dimension === "pack") {
    const packs = m.amountMilli === 1_000 ? "a pack" : formatQuantity(m.amountMilli, "pack");
    return { name, size: `${m.count} in ${packs}` };
  }
  const one = formatQuantity(Math.round(m.amountMilli / m.count), dimension);
  return { name, size: isApprox(dimension) ? `≈ ${one}` : one };
}

/** What is left, in the item's first measure: "≈ 4 onions", "14 slices"; null without one or when it rounds to nothing. */
export function leftInMeasure(item: Pick<KitchenItem, "qtyLeftMilli" | "dimension"> & { measures?: readonly KitchenMeasure[] | undefined }): string | null {
  const m = measuresOf(item)[0];
  if (!m || item.qtyLeftMilli <= 0) return null;
  const n = inMeasure(item.qtyLeftMilli, m);
  if (n <= 0) return null;
  const words = measureLabel(n, m);
  return isApprox(item.dimension) ? `≈ ${words}` : words;
}

// ── An amount given in a measure ──────────────────────────────────

/** A count of a measure (halves allowed) as a request sends it: 2 → "2", 1.5 → "1.5". */
export function countDecimal(quantity: number): string {
  const halves = Math.round(quantity * 2);
  return halves % 2 === 0 ? String(halves / 2) : `${(halves - 1) / 2}.5`;
}

/** "½", "1", "1½": a count as the stepper shows it. */
export function countText(quantity: number): string {
  const halves = Math.round(quantity * 2);
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1 ? "½" : "";
  return whole === 0 ? half || "0" : `${whole}${half}`;
}

/** A count as typed: "2", "1.5", "1½", "½", ".5" → a positive multiple of ½; null otherwise. */
export function parseCount(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  let n: number;
  const half = t.match(/^(\d*)½$/);
  if (half) n = (half[1] ? Number(half[1]) : 0) + 0.5;
  else if (/^\d*\.?\d+$/.test(t)) n = Number(t);
  else return null;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MEASURE_QUANTITY || !Number.isInteger(n * 2)) return null;
  return n;
}

type StockItem = Pick<KitchenItem, "qtyBoughtMilli" | "qtyLeftMilli">;

/** How much `quantity` of `m` takes from the item (the server's `measureTakeMilli`); null when more than is left. */
export function takeOf(item: StockItem, m: Pick<KitchenMeasure, "count" | "amountMilli">, quantity: number): number | null {
  if (quantity <= 0) return null;
  return measureTakeMilli(quantity, m, item);
}

/** The most of `m` the item can give, in halves (0 when not even half of one fits). */
export function maxCount(item: StockItem, m: Pick<KitchenMeasure, "count" | "amountMilli">): number {
  let q = Math.min(MAX_MEASURE_QUANTITY, Math.floor(inMeasure(item.qtyLeftMilli, m) * 2 + 2) / 2);
  while (q > 0 && takeOf(item, m, q) === null) q -= 0.5;
  return Math.max(0, q);
}

/** One step of a count: ½ ↔ 1, then whole ones; never past `max`; below ½ is 0. */
export function stepCount(current: number, delta: 1 | -1, max: number): number {
  if (delta > 0) {
    const next = current < 1 ? 1 : Math.floor(current) + 1;
    return Math.max(current, Math.min(next, max));
  }
  if (current <= 0.5) return 0;
  if (current <= 1) return 0.5;
  return Math.min(Math.ceil(current) - 1, max);
}

/** `qtyMilli` as the nearest count of `m` (halves), at least ½ and at most `max`. */
export function nearestCount(qtyMilli: number, m: Pick<KitchenMeasure, "count" | "amountMilli">, max: number): number {
  return Math.min(Math.max(inMeasure(qtyMilli, m), 0.5), max);
}

/** An amount someone chose: a count of a measure, or thousandths of the item's base unit. */
export type UseAmount =
  | { kind: "unit"; qtyMilli: number }
  | { kind: "measure"; measure: KitchenMeasure; quantity: number; qtyMilli: number; label: string };

/** `quantity` of `m` from the item, as an amount: what it takes and its words ("2 onions"); null when it doesn't fit. */
export function measureAmount(item: StockItem, m: KitchenMeasure, quantity: number): Extract<UseAmount, { kind: "measure" }> | null {
  const qtyMilli = takeOf(item, m, quantity);
  if (qtyMilli === null || qtyMilli <= 0) return null;
  return { kind: "measure", measure: m, quantity, qtyMilli, label: measureLabel(quantity, m) };
}

/**
 * The measure and count a use's words were given in ("2 onions", "½ onion",
 * "1½ onions"), among the item's measures now — or null when they name none
 * of them (the measure was removed or renamed since), so the amount is used
 * in the unit instead.
 */
export function parseLabel(label: string | null | undefined, measures: readonly KitchenMeasure[]): { measure: KitchenMeasure; quantity: number } | null {
  if (!label) return null;
  const match = label.trim().match(/^(\d*)(½?)\s+(.+)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const quantity = (match[1] ? Number(match[1]) : 0) + (match[2] ? 0.5 : 0);
  if (quantity <= 0) return null;
  const word = match[3]!.toLowerCase();
  const measure = measures.find((m) => (quantity <= 1 ? m.one : m.many).toLowerCase() === word);
  if (!measure || measureLabel(quantity, measure) !== label.trim()) return null;
  return { measure, quantity };
}

/** Your usual as an amount: in its measure when its words still name one, else in the unit. */
export function usualAmount(usual: Pick<KitchenUsual, "lastQtyMilli" | "lastLabel"> | null, item: StockItem & { measures?: readonly KitchenMeasure[] | undefined }): UseAmount | null {
  if (!usual || usual.lastQtyMilli <= 0) return null;
  const said = parseLabel(usual.lastLabel, measuresOf(item));
  if (said) return measureAmount(item, said.measure, said.quantity);
  return usual.lastQtyMilli <= item.qtyLeftMilli ? { kind: "unit", qtyMilli: usual.lastQtyMilli } : null;
}

/**
 * An amount in the item's unit (a recipe's, last time's) in a measure when it
 * divides evenly into halves of one — the first of the item's measures that
 * takes exactly that much — else null.
 */
export function evenCount(item: StockItem & { measures?: readonly KitchenMeasure[] | undefined }, qtyMilli: number): { measure: KitchenMeasure; quantity: number } | null {
  if (qtyMilli <= 0) return null;
  for (const m of measuresOf(item)) {
    const quantity = inMeasure(qtyMilli, m);
    if (quantity > 0 && takeOf(item, m, quantity) === qtyMilli) return { measure: m, quantity };
  }
  return null;
}

// ── Showing a saved measure at once (SM-5) ────────────────────────

/** Which items a name's measures belong to: its pantry, its name (case and spaces aside), its dimension. */
export interface MeasureTarget {
  pantry: PantryRef;
  name: string;
  dimension: KitchenDimension;
}

export function measureTarget(item: Pick<KitchenItem, "pantry" | "name" | "dimension">): MeasureTarget {
  return { pantry: item.pantry, name: item.name, dimension: item.dimension };
}

const nameKey = (name: string) => name.trim().toLowerCase();

function samePantry(a: PantryRef, b: PantryRef): boolean {
  return a.kind === "personal" ? b.kind === "personal" : b.kind === "group" && a.orgId === b.orgId;
}

/** The item reads the target's measures (it is of that name, in that pantry, in that dimension). */
export function isTarget(item: Pick<KitchenItem, "pantry" | "name" | "dimension">, t: MeasureTarget): boolean {
  return item.dimension === t.dimension && nameKey(item.name) === nameKey(t.name) && samePantry(item.pantry, t.pantry);
}

/**
 * The measures shown while a save is on its way: a word kept keeps its id,
 * a new one has a pending id until the server's answer replaces them.
 */
export function pendingMeasures(inputs: readonly KitchenMeasureInput[], before: readonly KitchenMeasure[]): KitchenMeasure[] {
  return inputs.map((m) => ({
    id: findMeasure(before, m.one)?.id ?? pendingId("msr"),
    one: m.one.trim(),
    many: m.many.trim(),
    count: m.count,
    amountMilli: m.amountMilli,
  }));
}

/** An item with the target's measures, when it reads them; the same object otherwise. */
export function withMeasures<T extends Pick<KitchenItem, "pantry" | "name" | "dimension"> & { measures?: KitchenMeasure[] | undefined }>(
  item: T,
  t: MeasureTarget,
  measures: readonly KitchenMeasure[],
): T {
  return isTarget(item, t) ? { ...item, measures: [...measures] } : item;
}

function listWith<T extends Pick<KitchenItem, "pantry" | "name" | "dimension">>(list: readonly T[], t: MeasureTarget, measures: readonly KitchenMeasure[]): readonly T[] {
  return list.some((i) => isTarget(i, t)) ? list.map((i) => withMeasures(i, t, measures)) : list;
}

function usualsWith(list: readonly KitchenUsual[], t: MeasureTarget, measures: readonly KitchenMeasure[]): readonly KitchenUsual[] {
  const hit = (u: KitchenUsual) =>
    isUnit(u.lastUnit) && dimensionOf(u.lastUnit) === t.dimension && nameKey(u.name) === nameKey(t.name) && samePantry(u.pantry, t.pantry);
  return list.some(hit) ? list.map((u) => (hit(u) ? { ...u, measures: [...measures] } : u)) : list;
}

/**
 * Every cached read that lists an item of the target's name in its pantry:
 * the item's page, every pantry list, Home's strip, search, the usable and
 * cookable lists, and the usuals — each now reads `measures`.
 */
export function measuresPatches(t: MeasureTarget, measures: readonly KitchenMeasure[]): CachePatch[] {
  return [
    {
      prefix: qk.kitchenPantry(),
      update: (data: unknown, key: CacheKey) => {
        if (data === null || typeof data !== "object") return data;
        switch (key[1]) {
          case "item":
            return withMeasures(data as KitchenItem, t, measures);
          case "items": {
            const d = data as { items: ReachableItem[]; truncated: boolean };
            const items = listWith(d.items, t, measures);
            return items === d.items ? d : { ...d, items };
          }
          case "useSoon": {
            const d = data as { soon: ReachableItem[]; expired: ReachableItem[] };
            const soon = listWith(d.soon, t, measures);
            const expired = listWith(d.expired, t, measures);
            return soon === d.soon && expired === d.expired ? d : { soon, expired };
          }
          case "search":
          case "usable":
          case "cookable":
            return Array.isArray(data) ? listWith(data as ReachableItem[], t, measures) : data;
          case "usuals":
            return Array.isArray(data) ? usualsWith(data as KitchenUsual[], t, measures) : data;
          default:
            return data;
        }
      },
    },
  ];
}

/** The toast after a save: "Saved · now in onions", "Saved · 1 katori ≈ 120 g", "Removed · katori". */
export function measuresSavedText(input: {
  dimension: KitchenDimension;
  before: readonly KitchenMeasure[];
  after: readonly KitchenMeasureInput[];
}): string {
  const { before, after, dimension } = input;
  if (before.length === 0 && after.length > 0) return `Saved · now in ${after[0]!.many}`;
  const gone = before.find((m) => !findMeasure(after, m.one));
  if (gone && after.length < before.length) return `Removed · ${gone.one}`;
  const changed = after.find((m) => {
    const was = findMeasure(before, m.one);
    return !was || was.count !== m.count || was.amountMilli !== m.amountMilli;
  });
  if (!changed) return "Saved";
  const row = measureRow({ id: "", ...changed }, dimension);
  const added = !findMeasure(before, changed.one);
  return `${added ? "Added" : "Saved"} · ${row.name} ${dimension === "pack" ? `· ${row.size}` : row.size}`;
}

/**
 * The measure a caller's words name, when they are one of the item's own
 * ("2 onions") and it takes exactly `qtyMilli` — so a usual logged again from
 * Home or the Pantry list goes in its measure, with its words, as it was
 * shown. Built-in words ("1 glass" of 250 ml) beside a measure of the same
 * word but another size stay in the unit.
 */
export function countedWords(
  item: StockItem & { measures?: readonly KitchenMeasure[] | undefined },
  words: string | null | undefined,
  qtyMilli: number,
): { measure: KitchenMeasure; quantity: number } | null {
  const said = parseLabel(words, measuresOf(item));
  return said && takeOf(item, said.measure, said.quantity) === qtyMilli ? said : null;
}
