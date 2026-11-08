/**
 * What counts as there without being in a pantry, and the one question that
 * links an item to the food list (cookpool-recipes RC-8, design §2, §3.4):
 *
 * - **Always have**, at the bottom of Pantry: a chip per food (salt and
 *   water until you save your own), each with ✕, and + Add from the food
 *   list. Every edit PUTs the whole list, at once and with Undo, and Cook now
 *   and every match are read again.
 * - **The food ask**, on a recipe's page: when an item your pantries hold
 *   links to no food and looks like a missing line's ("Kanda onion" for
 *   Onions), one small card asks "Is Kanda onion onion?" — Yes links that
 *   name to the line's food, No answers "none of these" — in each pantry
 *   holding that name, once.
 *
 * Pure and dependency-free (contract types and helpers), so unit-testable.
 */

import {
  MAX_ALWAYS_HAVE,
  foodNameKey,
  type AlwaysHaveResponse,
  type KitchenFood,
  type KitchenRecipeLine,
  type RecipeMatchResponse,
  type SetFoodAnswerRequest,
  type UnlinkedItem,
} from "@saas/contracts/kitchen";
import type { CachePatch } from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";

// ── Always have (design §3.4) ─────────────────────────────────────

/** The card's words. */
export const ALWAYS_HAVE_TITLE = "Always have";
export const ALWAYS_HAVE_LINE = "Count as there in Cook now";

/** The list's keys, in its order. */
export function alwaysHaveKeys(list: Pick<AlwaysHaveResponse, "foods"> | null): string[] {
  return (list?.foods ?? []).map((f) => f.key);
}

/** The list with a food added (by name, as the server orders it); the same list when it is on it or full. */
export function withFood(list: AlwaysHaveResponse, food: KitchenFood): AlwaysHaveResponse {
  if (list.foods.some((f) => f.key === food.key) || list.foods.length >= MAX_ALWAYS_HAVE) return list;
  const foods = [...list.foods, stripMatch(food)].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { foods, isDefault: false };
}

/** The list without a food; the same list when it isn't on it. */
export function withoutFood(list: AlwaysHaveResponse, key: string): AlwaysHaveResponse {
  if (!list.foods.some((f) => f.key === key)) return list;
  return { foods: list.foods.filter((f) => f.key !== key), isDefault: false };
}

/** A food as the list keeps it (a search's `matchedName` dropped). */
function stripMatch(food: KitchenFood & { matchedName?: string }): KitchenFood {
  const { matchedName: _drop, ...rest } = food;
  return rest;
}

/** Whether one more food fits (the server keeps at most MAX_ALWAYS_HAVE). */
export function canAddFood(list: Pick<AlwaysHaveResponse, "foods"> | null): boolean {
  return (list?.foods.length ?? 0) < MAX_ALWAYS_HAVE;
}

/** One edit of the list: a food added, or taken off. */
export interface AlwaysHaveChange {
  kind: "add" | "remove";
  food: KitchenFood;
}

/** The list after an edit (the same list when it changes nothing). */
export function applyAlwaysHave(list: AlwaysHaveResponse, change: AlwaysHaveChange): AlwaysHaveResponse {
  return change.kind === "add" ? withFood(list, change.food) : withoutFood(list, change.food.key);
}

/** What Undo does: the other way round. */
export function inverseChange(change: AlwaysHaveChange): AlwaysHaveChange {
  return { kind: change.kind === "add" ? "remove" : "add", food: change.food };
}

/** The toast an edit shows: "Added turmeric", "Removed salt". */
export function alwaysHaveToast(change: { kind: "add" | "remove"; food: Pick<KitchenFood, "name"> }): string {
  return `${change.kind === "add" ? "Added" : "Removed"} ${change.food.name.toLowerCase()}`;
}

function isList(d: unknown): d is AlwaysHaveResponse {
  return !!d && typeof d === "object" && Array.isArray((d as AlwaysHaveResponse).foods);
}

/** The cached list with the edit made at once — to whatever it holds then, so two quick edits both show. */
export function alwaysHavePatches(change: AlwaysHaveChange): CachePatch[] {
  return [{ prefix: qk.kitchenAlwaysHave(), update: (d) => (isList(d) ? applyAlwaysHave(d, change) : d) }];
}

/**
 * What Always have changes elsewhere: every match (its lines read "Always
 * have"), Cook now and Explore's rows. All sit under the pantry's prefix.
 */
export const ALWAYS_HAVE_REFRESHES = [qk.kitchenAllRecipeMatches(), qk.kitchenCookNow(), qk.kitchenExploreAll()] as const;

// ── The food ask (design §2) ──────────────────────────────────────

/** Words too general to pair an item with a line on their own ("Tomato paste" is not ginger-garlic paste). */
const GENERAL_WORDS = new Set([
  "fresh", "green", "red", "white", "black", "yellow", "big", "small", "large", "organic", "whole", "powder", "paste",
  "chopped", "sliced", "leaves", "leaf", "seeds", "seed", "masala", "pack", "packet", "brand", "local", "home", "made", "the", "and",
]);

/** One word's spellings with a plural dropped: "tomatoes" → tomatoes, tomatoe, tomato; "chillies" → chilli, chilly. */
function spellings(word: string): string[] {
  const out = [word];
  if (word.endsWith("ies") && word.length > 4) out.push(`${word.slice(0, -3)}i`, `${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 3) out.push(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) out.push(word.slice(0, -1));
  return out;
}

/**
 * A name's words, lower-cased, three letters or more, the general ones left
 * out — each as its spellings, so "Onions" and "onion" meet.
 */
export function nameWords(name: string): string[][] {
  const out: string[][] = [];
  for (const raw of name.toLowerCase().split(/[^a-zÀ-￿]+/)) {
    if (raw.length < 3) continue;
    const forms = spellings(raw).filter((w) => w.length >= 3);
    if (forms.some((w) => GENERAL_WORDS.has(w))) continue;
    out.push(forms);
  }
  return out;
}

/** A food's key in words: `toor_dal` → "toor dal". */
export function foodWords(foodKey: string): string {
  return foodKey.replace(/_+/g, " ").trim();
}

/** How well an item's name fits a line: the words they share, and more when the item names the whole food ("Toor dal organic"). */
export function askScore(itemName: string, line: Pick<KitchenRecipeLine, "name" | "foodKey">): number {
  if (!line.foodKey) return 0;
  const lineForms = new Set([...nameWords(line.name), ...nameWords(foodWords(line.foodKey))].flat());
  let shared = 0;
  for (const forms of nameWords(itemName)) if (forms.some((w) => lineForms.has(w))) shared += 1;
  if (shared === 0) return 0;
  const whole = foodWords(line.foodKey);
  return shared + (` ${itemName.toLowerCase()} `.includes(` ${whole} `) ? 1 : 0);
}

export interface FoodAsk {
  /** The name as the item says it ("Kanda onion"). */
  itemName: string;
  /** The name as answers key it (`foodNameKey`). */
  nameKey: string;
  /** The food it may be: the missing line's. */
  foodKey: string;
  /** "Is Kanda onion onion?" */
  question: string;
  /** Every pantry holding an unlinked item of that name: null for your own, else the group's `org_…`. */
  orgIds: (string | null)[];
}

/** An answer already given (this visit, or the device remembers it): by name and the food asked. */
export function askKey(nameKey: string): string {
  return foodNameKey(nameKey);
}

/**
 * The asks a recipe's page shows: for each name among the match's unlinked
 * items, the missing line it fits best (sharing a word with the line's name
 * or its food), once per name, in the recipe's line order. Names already
 * answered (`answered`) are left out.
 */
export function foodAsks(
  recipe: { lines: readonly Pick<KitchenRecipeLine, "position" | "name" | "foodKey">[] },
  match: Pick<RecipeMatchResponse, "lines" | "unlinked"> | null,
  answered: ReadonlySet<string> = new Set(),
): FoodAsk[] {
  if (!match || match.unlinked.length === 0) return [];
  const missing = new Set(match.lines.filter((l) => l.status === "missing").map((l) => l.position));
  const lines = recipe.lines.filter((l) => missing.has(l.position) && !!l.foodKey);
  if (lines.length === 0) return [];
  const byName = new Map<string, { item: UnlinkedItem; orgIds: (string | null)[] }>();
  for (const item of match.unlinked) {
    const key = askKey(item.nameKey || item.name);
    if (answered.has(key)) continue;
    const seen = byName.get(key);
    if (seen) {
      if (!seen.orgIds.includes(item.orgId)) seen.orgIds.push(item.orgId);
    } else {
      byName.set(key, { item, orgIds: [item.orgId] });
    }
  }
  const asks: { ask: FoodAsk; at: number }[] = [];
  for (const [nameKey, { item, orgIds }] of byName) {
    let best: { line: (typeof lines)[number]; score: number } | null = null;
    for (const line of lines) {
      const score = askScore(item.name, line);
      if (score > 0 && (!best || score > best.score)) best = { line, score };
    }
    if (!best) continue;
    const foodKey = best.line.foodKey!;
    asks.push({
      at: best.line.position,
      ask: { itemName: item.name, nameKey, foodKey, question: `Is ${item.name.trim()} ${foodWords(foodKey)}?`, orgIds },
    });
  }
  return asks.sort((a, b) => a.at - b.at || a.ask.nameKey.localeCompare(b.ask.nameKey)).map((a) => a.ask);
}

/** The answers one ask sends: one PUT per pantry holding the name — the food for Yes, null ("none of these") for No. */
export function foodAnswerBodies(ask: Pick<FoodAsk, "nameKey" | "foodKey" | "orgIds">, yes: boolean): SetFoodAnswerRequest[] {
  return ask.orgIds.map((orgId) => (orgId ? { nameKey: ask.nameKey, foodKey: yes ? ask.foodKey : null, orgId } : { nameKey: ask.nameKey, foodKey: yes ? ask.foodKey : null }));
}

/** What an answer changes: every match, Cook now and Explore read again. */
export const FOOD_ANSWER_REFRESHES = ALWAYS_HAVE_REFRESHES;
