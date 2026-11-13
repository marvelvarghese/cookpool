import type { KitchenDimension, KitchenMeasure, KitchenMeasureInput } from "@saas/contracts/kitchen";
import { MAX_MEASURES, measureInput, wordProblem, wordsFor } from "./measures";

/**
 * The Measure drawer's pure parts (cookpool-kitchen-calm KC-2, the canvas's
 * `UnitDrawer` and `NewMeasure`): what a new measure is counted against, and
 * reading "1 box = 500 g" into the server's measure. Pure, so it is
 * unit-testable.
 */

/** What one of a new measure is counted in: g for weighed, ml for poured, pieces for a pack or a count. */
export function measureBase(dimension: KitchenDimension): string {
  switch (dimension) {
    case "mass":
      return "g";
    case "volume":
      return "ml";
    case "pack":
      return "pieces";
    default:
      return "pcs";
  }
}

export type NewMeasureRead = { ok: true; input: KitchenMeasureInput; id: string } | { ok: false; problem: string | null };

/**
 * "1 [box] = [500] g", read: a word (not one the item already has, at most
 * the server's count) and a size above zero. Nothing typed yet is no problem
 * to show (`problem: null`).
 */
export function readNewMeasure(dimension: KitchenDimension, word: string, size: string, measures: readonly Pick<KitchenMeasure, "one" | "many">[]): NewMeasureRead {
  const one = word.trim();
  const n = Number(size.trim());
  if (!one && !size.trim()) return { ok: false, problem: null };
  if (measures.length >= MAX_MEASURES) return { ok: false, problem: `${MAX_MEASURES} measures at most` };
  if (!one) return { ok: false, problem: "Name the measure" };
  const clash = wordProblem(one, measures);
  if (clash) return { ok: false, problem: clash };
  if (!Number.isFinite(n) || n <= 0) return { ok: false, problem: "Say how much one is" };
  const words = wordsFor(one);
  return { ok: true, input: measureInput(dimension, words, n), id: `m:${words.one.toLowerCase()}` };
}
